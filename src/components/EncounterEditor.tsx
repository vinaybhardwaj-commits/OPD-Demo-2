'use client';

/**
 * <EncounterEditor /> — the working surface of an OPD encounter.
 *
 * Sprint 2 (M2.3) scope: chief complaint, vitals, exam findings,
 * assessment, disposition, Submit & finish. Auto-save 800ms after
 * the doctor pauses typing. The "saved" indicator quietly tracks
 * whether the local state matches the server.
 *
 * Sprints 3-7 add: CC chips + ICD-10 typeahead + section dictation
 * (S3), prescription compose row (S4), recording (S5), pause/send to
 * diagnostics (S6), confirmation modal + PDF + Twilio (S7).
 *
 * Read-only when status is 'completed'. Editable in 'active' and
 * 'ready_to_resume'. 'paused_diagnostics' is editable too (doctor
 * may want to update notes while waiting for the test) but the
 * Submit button is gated until the encounter is resumed (Sprint 6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CC_CHIPS } from '@/lib/cc-chips';
import { lookupIcd10 } from '@/lib/icd10';
import { Icd10Typeahead } from './Icd10Typeahead';
import { ComorbidityBand } from './ComorbidityBand';
import { isChronicIcd10 } from '@/lib/chronic-icd10-patterns';
import { Icd10SuggestedChips } from './Icd10SuggestedChips';
import { ExtractIcd10FromAssessmentButton } from './ExtractIcd10FromAssessmentButton';
import { DictateButton } from './DictateButton';
import { CollapsedSuggestions } from './CollapsedSuggestions';
import { PrescriptionCompose } from './PrescriptionCompose';
import type { PrescriptionLine } from './DrugRow';
import { useRxCoherence, RxCoherencePanel, type OverrideRecord } from './RxCoherencePanel';
import { Section } from './encounter/Section';
import { ShortcutsOverlay } from './encounter/ShortcutsOverlay';
import { CommandPalette, type CommandAction } from './encounter/CommandPalette';
import { PausedDiagnosticsBanner } from './encounter/PausedDiagnosticsBanner';
import { AmbientRecorder } from './AmbientRecorder';
import { TranscriptViewer, type TranscriptViewerHandle } from './TranscriptViewer';
import { SendToDiagnosticsModal } from './SendToDiagnosticsModal';
import { DiagnosticOrderModal } from './DiagnosticOrderModal';
import { SubmitConfirmModal } from './SubmitConfirmModal';
import { FlagHandoffModal } from './FlagHandoffModal';
import { DdxOnDemand } from './DdxOnDemand';
import { DiagnosticsQuickAddStrip } from './DiagnosticsQuickAddStrip';
import PlanSection from './PlanSection';
import { CounsellingGate, type CounsellingTranscript } from './CounsellingGate';

type Vitals = {
  bp_sys?: number | '';
  bp_dia?: number | '';
  hr?: number | '';
  rr?: number | '';
  temp_c?: number | '';
  spo2?: number | '';
};

export type Disposition =
  | 'discharge'
  | 'follow_up'
  | 'refer'
  | 'diagnostics'
  | 'admit'
  | 'vaccinate';

export type EncounterEditable = {
  id: string;
  encounter_number: string;
  status:
    | 'active'
    | 'paused_diagnostics'
    | 'ready_to_resume'
    | 'completed';
  started_at: string;
  pending_diagnostic_test: string | null;
  chief_complaint_chips: string[] | null;
  chief_complaint_text: string | null;
  exam_findings: string | null;
  vitals: Vitals | null;
  assessment_codes: string[] | null;
  assessment_code_labels?: Record<string, string> | null;
  assessment_text: string | null;
  disposition: Disposition | null;
  follow_up_days: number | null;
  referral_target: string | null;
  disposition_label_override: string | null;
  /** v3.9.4 — audit log of Rx ↔ comorbidity coherence decisions per encounter. */
  rx_comorbidity_overrides?: Array<{
    drug_name: string;
    comorbidity_code: string;
    comorbidity_label: string;
    decision: 'added' | 'overridden';
    reason?: string;
    source: 'static' | 'qwen';
    confidence: number;
    at: string;
  }> | null;
  prescription_lines: PrescriptionLine[];
  /** v2.2.1 — cached Qwen DDI scan output. Banner pre-renders from this. */
  ddi_findings?: unknown | null;
  /**
   * v2.2.2 / Polish #1 — cached Qwen DDx output. DdxOnDemand and
   * SubmitConfirmModal both seed from this.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ddx_findings?: any | null;
  /**
   * v2.3 — per-section last-edited-by map for multi-doctor attribution.
   * Shape: { section_name: { doctor_id, edited_at } }
   */
  section_editors?: Record<string, { doctor_id: string; edited_at: string }> | null;
};

/**
 * v2.3 — pre-resolved name map for the section_editors chips, so the
 * client doesn't need to round-trip a doctor lookup per chip.
 */
export type SectionEditorNameMap = Record<string, { name: string; edited_at: string }>;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const DISPOSITIONS: { value: Disposition; label: string; hint: string }[] = [
  { value: 'discharge', label: 'Discharge', hint: 'Done — patient leaves.' },
  { value: 'follow_up', label: 'Follow-up', hint: 'See again later.' },
  { value: 'refer', label: 'Refer', hint: 'Send to specialist.' },
  { value: 'diagnostics', label: 'Diagnostics', hint: 'Order tests.' },
  { value: 'admit', label: 'Admit', hint: 'Inpatient.' },
  { value: 'vaccinate', label: 'Vaccinate', hint: 'Routine immunisation.' },
];

export type EncounterPatient = {
  id: string;
  name: string;
  mrn: string;
  age_years: number;
  sex: string;
  phone_e164: string | null;
};

/**
 * PH.4 — patient-specific smartening fed by the cached Qwen summary.
 * Empty arrays mean "no AI guidance, fall back to default order".
 */
export type EncounterAi = {
  cc_chip_rankings: string[];
  cc_chip_additions: string[];
  disposition_recommendation: string | null;
  disposition_additions: string[];
};

const AI_EMPTY: EncounterAi = {
  cc_chip_rankings: [],
  cc_chip_additions: [],
  disposition_recommendation: null,
  disposition_additions: [],
};

/**
 * v2.1.5 — labSummary feeds the ResumeBanner so the doctor sees at a
 * glance what came back from the lab. Server-computed once on the
 * encounter page from lab_results aggregates.
 */
export type LabReturnSummary = {
  posted_count: number;
  abnormal_count: number;
  critical_count: number;
};

export function EncounterEditor({
  initial,
  patient,
  ai,
  labSummary,
  sectionEditors,
  selfDoctorId,
  counsellingEligible,
  counsellingTranscripts,
}: {
  initial: EncounterEditable;
  patient: EncounterPatient;
  ai?: EncounterAi;
  labSummary?: LabReturnSummary | null;
  /** v2.3 — pre-resolved {section: {name, edited_at}} for attribution chips. */
  sectionEditors?: SectionEditorNameMap | null;
  /** v2.3 — viewing doctor's doctors-row id; chips suppressed when self. */
  selfDoctorId?: string | null;
  /** D.1 — server-computed: a terminal-kind plan already exists (gate shows immediately). */
  counsellingEligible?: boolean;
  /** D.1 — existing final-counselling sessions (faithful transcripts). */
  counsellingTranscripts?: CounsellingTranscript[];
}) {
  const aiSafe: EncounterAi = ai ?? AI_EMPTY;
  const router = useRouter();
  const readOnly = initial.status === 'completed';
  const submitGated = initial.status === 'paused_diagnostics';
  const canSendToDiagnostics =
    initial.status === 'active' || initial.status === 'ready_to_resume';
  const [diagModalOpen, setDiagModalOpen] = useState(false);
  const [labModalOpen, setLabModalOpen] = useState(false);
  const [handoffModalOpen, setHandoffModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  // v3.9.4 — Rx ↔ comorbidity coherence
  const [rxLinesMirror, setRxLinesMirror] = useState<PrescriptionLine[]>(initial.prescription_lines ?? []);
  const [rxOverrides, setRxOverrides] = useState<OverrideRecord[]>(initial.rx_comorbidity_overrides ?? []);
  const [coherenceModalOpen, setCoherenceModalOpen] = useState(false);
  const rxCoherence = useRxCoherence({
    encounterId: initial.id,
    patientId: patient.id,
    lines: rxLinesMirror,
    initialOverrides: rxOverrides,
    readOnly,
    onOverridesChange: (next) => {
      setRxOverrides(next);
      // Best-effort persist; auto-save loop also picks it up via buildBody if wired
      void fetch(`/api/encounters/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rx_comorbidity_overrides: next }),
      }).catch(() => {});
    },
  });

  const [ccChips, setCcChips] = useState<string[]>(initial.chief_complaint_chips ?? []);

  // v4.0.8 — keyboard shortcuts overlay (? to open, Esc to close).
  // Ignores '?' when an input/textarea has focus so doctors can type a
  // literal question mark.
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — command palette (allowed even when typing in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommand((v) => !v);
        return;
      }
      // ? — shortcuts overlay (only when no input/textarea focused)
      if (e.key === '?') {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // v4.0.9 — command list for the palette. Recomputed when readOnly changes
  // so the action set matches what the doctor can actually do.
  const commands: CommandAction[] = useMemo(() => {
    const scrollTo = (id: string) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const list: CommandAction[] = [
      { id: 'jump-reason', group: 'Jump to', label: '1. Reason for visit', run: () => scrollTo('enc-section-reason') },
      { id: 'jump-vitals', group: 'Jump to', label: 'Vitals', run: () => scrollTo('enc-section-vitals') },
      { id: 'jump-exam', group: 'Jump to', label: '2. Exam findings', run: () => scrollTo('enc-section-exam') },
      { id: 'jump-ddx', group: 'Jump to', label: '3. Differential', run: () => scrollTo('enc-section-differential') },
      { id: 'jump-dx', group: 'Jump to', label: '4. Diagnostics', run: () => scrollTo('enc-section-diagnostics') },
      { id: 'jump-assess', group: 'Jump to', label: '5. Assessment', run: () => scrollTo('enc-section-assessment') },
      { id: 'jump-rx', group: 'Jump to', label: '6. Treatment', run: () => scrollTo('enc-section-treatment') },
      { id: 'jump-plan', group: 'Jump to', label: '7. Plan', run: () => scrollTo('enc-section-plan') },
      { id: 'act-shortcuts', group: 'Action', label: 'Show keyboard shortcuts', hint: '?', run: () => setShowShortcuts(true) },
      { id: 'nav-queue', group: 'Navigation', label: 'Back to queue', hint: '← Queue', run: () => { window.location.href = '/dashboard'; } },
    ];
    return list;
  }, []);
  const [cc, setCc] = useState(initial.chief_complaint_text ?? '');
  const [exam, setExam] = useState(initial.exam_findings ?? '');
  const [assessmentCodes, setAssessmentCodes] = useState<string[]>(initial.assessment_codes ?? []);
  // v3.8 — labels for Qwen-supplied ICD-10 codes (codes not in lib/icd10's
  // static table). Falls back to lookupIcd10() in chip rendering.
  const [assessmentCodeLabels, setAssessmentCodeLabels] = useState<Record<string, string>>(
    initial.assessment_code_labels ?? {},
  );
  // v3.9.1b — canonical comorbidity codes for cross-link UX (the small
  // "↗ on comorbidity list" tag + "Add as chronic comorbidity?" soft prompt).
  // Refetched on add via the soft prompt so the tag flips immediately.
  const [comorbidityCodes, setComorbidityCodes] = useState<Set<string>>(new Set());
  const [pendingComorbidityAdd, setPendingComorbidityAdd] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    const fetchCodes = async () => {
      const res = await fetch(`/api/patients/${patient.id}/comorbidities`);
      const json = await res.json();
      if (!cancel && json.ok) {
        const active = (json.comorbidities ?? []).filter((c: { is_resolved: boolean }) => !c.is_resolved);
        setComorbidityCodes(new Set(active.map((c: { code: string }) => c.code)));
      }
    };
    fetchCodes();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id]);
  const addAsComorbidity = async (code: string, label: string) => {
    setPendingComorbidityAdd(code);
    try {
      const res = await fetch(`/api/patients/${patient.id}/comorbidities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ code, label }] }),
      });
      const json = await res.json();
      if (json.ok) setComorbidityCodes((cur) => { const next = new Set(cur); next.add(code); return next; });
    } finally { setPendingComorbidityAdd(null); }
  };

  // v3.8.1 — backfill labels for any codes that lack one (e.g. codes added
  // in a prior session before label persistence shipped). One-shot on mount.
  useEffect(() => {
    const needed = assessmentCodes.filter(
      (c) => !assessmentCodeLabels[c] && !lookupIcd10(c),
    );
    if (needed.length === 0) return;
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/icd10/lookup-batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ codes: needed }),
        });
        const json = await res.json();
        if (cancel || !json.ok || !json.labels) return;
        setAssessmentCodeLabels((cur) => ({ ...json.labels, ...cur }));
      } catch {
        // silent — chip will show … placeholder, harmless
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [assessment, setAssessment] = useState(initial.assessment_text ?? '');
  const [vitals, setVitals] = useState<Vitals>(initial.vitals ?? {});
  const [disposition, setDisposition] = useState<Disposition | null>(initial.disposition);
  const [followUpDays, setFollowUpDays] = useState<number | ''>(initial.follow_up_days ?? '');
  const [referralTarget, setReferralTarget] = useState<string>(initial.referral_target ?? '');
  const [dispositionLabel, setDispositionLabel] = useState<string | null>(
    initial.disposition_label_override ?? null,
  );

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const transcriptRef = useRef<TranscriptViewerHandle | null>(null);

  // NOTE — v4.1.1: encounter timer moved to EncounterTopBar exclusively.
  // It now reads the doctor-active-time clock from encounters.active_since
  // / active_ms_accumulated (maintained by the encounters_active_time_trg
  // DB trigger; see lib/encounter-timer.ts). The old body-side ⏱ duplicate
  // was removed below — top bar is sticky, one timer is enough.

  // Build the canonical body for PATCH from current state
  const buildBody = useCallback(() => {
    const cleanVitals: Vitals = {};
    (Object.keys(vitals) as (keyof Vitals)[]).forEach((k) => {
      const v = vitals[k];
      if (v !== '' && v !== undefined && v !== null) cleanVitals[k] = v;
    });
    return {
      chief_complaint_chips: ccChips.length > 0 ? ccChips : null,
      chief_complaint_text: cc || null,
      exam_findings: exam || null,
      vitals: Object.keys(cleanVitals).length > 0 ? cleanVitals : null,
      assessment_codes: assessmentCodes.length > 0 ? assessmentCodes : null,
      assessment_code_labels: assessmentCodes.length > 0 ? assessmentCodeLabels : null,
      assessment_text: assessment || null,
      disposition: disposition,
      follow_up_days: disposition === 'follow_up' && followUpDays !== '' ? Number(followUpDays) : null,
      referral_target: disposition === 'refer' ? referralTarget || null : null,
      disposition_label_override: dispositionLabel,
    };
  }, [ccChips, cc, exam, assessmentCodes, assessment, vitals, disposition, followUpDays, referralTarget, dispositionLabel]);

  // Debounced auto-save
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirstRef = useRef(true);
  useEffect(() => {
    if (readOnly) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    setSaveState('dirty');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await fetch(`/api/encounters/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveState('saved');
        setLastSavedAt(Date.now());
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [ccChips, cc, exam, assessmentCodes, assessment, vitals, disposition, followUpDays, referralTarget, dispositionLabel, initial.id, readOnly, buildBody]);

  async function onSubmit() {
    if (readOnly || submitting || submitGated || !disposition) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Flush any pending save before opening the confirm modal — the
      // modal's /complete + /dispatch chain reads server-side state, so
      // we want everything persisted first.
      if (saveState === 'dirty' || saveState === 'saving') {
        await fetch(`/api/encounters/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
        });
      }
      // v3.9.4 — refresh coherence one more time before submit, then
      // either gate on the coherence modal or proceed to the normal
      // confirm modal.
      await rxCoherence.refresh();
      if (rxCoherence.warnings.length > 0) {
        setCoherenceModalOpen(true);
      } else {
        setConfirmModalOpen(true);
      }
    } catch {
      setSubmitError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const saveLabel =
    saveState === 'idle'
      ? ''
      : saveState === 'dirty'
      ? '· editing'
      : saveState === 'saving'
      ? '· saving…'
      : saveState === 'error'
      ? '· save failed'
      : `· saved${lastSavedAt ? ` ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;

  const saveTone =
    saveState === 'error' ? 'text-even-pink-700' : 'text-even-ink-400';

  return (
    <div className="space-y-8">
      {/* Ambient recorder + save indicator (v4.1.1 — timer lives in EncounterTopBar) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-even-ink-500">
        <div className="flex items-center gap-4">
          {!readOnly && (
            <AmbientRecorder
              encounterId={initial.id}
              onSnippetSaved={() => transcriptRef.current?.refresh()}
            />
          )}
        </div>
        <span className={`text-[11px] tabular-nums ${saveTone}`}>{saveLabel}</span>
      </div>

      {initial.status === 'ready_to_resume' && (
        <ResumeBanner
          encounterId={initial.id}
          test={initial.pending_diagnostic_test}
          labSummary={labSummary ?? null}
        />
      )}

      {initial.status === 'paused_diagnostics' && (
        <PausedDiagnosticsBanner
          encounterId={initial.id}
          pendingTest={initial.pending_diagnostic_test ?? null}
          dispositionPicked={!!disposition}
        />
      )}

      {/* v2.3 — per-section attribution strip when multiple doctors
          have touched the chart. Hidden when section_editors is empty or
          only shows self. */}
      {sectionEditors && (
        <AttributionStrip
          sectionEditors={sectionEditors}
          selfDoctorId={selfDoctorId ?? null}
        />
      )}


      {/* v3.9.1 — Comorbidity band + tier badge. Sits at the very top of
          the editor working area so it sets context for everything below.
          Per v3.9 PRD §4.1 placement decision. */}
      <ComorbidityBand
        patientId={patient.id}
        patientName={patient.name}
        patientAge={patient.age_years}
        patientSex={patient.sex}
        encounterId={initial.id}
        visitReasonHint={cc}
        readOnly={readOnly}
      />
      <Section
        n={1}
        id="enc-section-reason"
        label="Reason for visit"
        dictate={
          !readOnly
            ? {
                encounterId: initial.id,
                section: 'chief_complaint',
                onTranscript: (t) => setCc((cur) => appendTranscript(cur, t)),
              }
            : undefined
        }
      >
        <CollapsedSuggestions label="Show quick options" count={CC_CHIPS.length}>
          <CcChipGrid
            selected={ccChips}
            onToggle={(label) =>
              setCcChips((cur) =>
                cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
              )
            }
            readOnly={readOnly}
            ccRankings={aiSafe.cc_chip_rankings}
            ccAdditions={aiSafe.cc_chip_additions}
          />
        </CollapsedSuggestions>
        <textarea
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          disabled={readOnly}
          rows={4}
          placeholder="Add detail — onset, duration, severity, what brought them in today."
          className={`mt-3 ${textareaCls}`}
        />
      </Section>

      <Section id="enc-section-vitals" label="Vitals">
        <VitalsPillRow
          vitals={vitals}
          onChange={(patch) => setVitals({ ...vitals, ...patch })}
          readOnly={readOnly}
        />
      </Section>

      <Section
        n={2}
        id="enc-section-exam"
        label="Exam findings"
        dictate={
          !readOnly
            ? {
                encounterId: initial.id,
                section: 'exam_findings',
                onTranscript: (t) => setExam((cur) => appendTranscript(cur, t)),
              }
            : undefined
        }
      >
        <textarea
          value={exam}
          onChange={(e) => setExam(e.target.value)}
          disabled={readOnly}
          rows={5}
          placeholder="What you observed — general appearance, system-specific findings, anything reassuring or concerning."
          className={textareaCls}
        />
      </Section>

      {/* v4.0.5 — Section 3 — Differential. DdxOnDemand wraps in a numbered
          collapsible Section; the inner header was removed in v4.0.5 so the
          Section heading is the sole title. */}
      {!readOnly && (
        <Section
          n={3}
          id="enc-section-differential"
          label="Differential"
          collapsible
          encounterId={initial.id}
          sectionKey="differential"
          defaultCollapsed={!initial.ddx_findings}
        >
          <DdxOnDemand
            encounterId={initial.id}
            initialPayload={initial.ddx_findings ?? null}
            hidden={initial.status === 'completed'}
            currentAssessment={assessment}
            currentCcText={cc}
          />
        </Section>
      )}

      {/* v4.0.5 — Section 4 — Diagnostics. DiagnosticsQuickAddStrip wraps in
          a numbered collapsible Section. Default expanded (most encounters
          benefit from seeing the quick-add chips). */}
      {!(readOnly || initial.status === 'completed') && (
        <Section
          n={4}
          id="enc-section-diagnostics"
          label="Diagnostics"
          collapsible
          encounterId={initial.id}
          sectionKey="diagnostics"
        >
          {/* v5.0.4 — unwrapped from CollapsedSuggestions. The strip itself
              now renders DiagnosticSearch always-visible and tucks
              suggestions inside its own inner CollapsedSuggestions. */}
          <DiagnosticsQuickAddStrip
            encounterId={initial.id}
            readOnly={readOnly}
          />
        </Section>
      )}

      <Section
        n={5}
        id="enc-section-assessment"
        label="Assessment"
        dictate={
          !readOnly
            ? {
                encounterId: initial.id,
                section: 'assessment',
                onTranscript: (t) => setAssessment((cur) => appendTranscript(cur, t)),
              }
            : undefined
        }
      >
        {assessmentCodes.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {assessmentCodes.map((code) => {
              const label = assessmentCodeLabels[code] ?? lookupIcd10(code);
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 rounded-full bg-even-blue-50 px-2.5 py-1 text-[11px] font-medium text-even-blue-800 ring-1 ring-even-blue-200"
                  title={label}
                >
                  <span className="font-mono font-semibold">{code}</span>
                  <span className="truncate max-w-[18rem] text-even-blue-700">
                    {label ?? <span className="italic text-even-ink-400">…</span>}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        setAssessmentCodes((cur) => cur.filter((c) => c !== code))
                      }
                      aria-label={`Remove ${code}`}
                      className="rounded-full text-even-blue-500 hover:text-even-pink-700"
                    >
                      ×
                    </button>
                  )}
                  {/* v3.9.1b — already on comorbidity list tag */}
                  {comorbidityCodes.has(code) && (
                    <span className="ml-1 text-[10px] italic text-even-ink-400" title="This code is on the patient's comorbidity list">
                      ↗ on comorbidity list
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {/* v3.9.1b — soft prompts: chronic-pattern code in Assessment but
            not on the comorbidity list → one-tap add */}
        {!readOnly && assessmentCodes
          .filter((code) => isChronicIcd10(code) && !comorbidityCodes.has(code))
          .slice(0, 4)
          .map((code) => {
            const label = assessmentCodeLabels[code] ?? lookupIcd10(code) ?? code;
            const pending = pendingComorbidityAdd === code;
            return (
              <div
                key={`chronic-prompt-${code}`}
                className="mb-2 flex items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] text-violet-800"
              >
                <span>
                  <span className="font-mono font-semibold">{code}</span>
                  {' '}is a chronic-pattern code. Add as chronic comorbidity?
                </span>
                <button
                  type="button"
                  onClick={() => addAsComorbidity(code, label)}
                  disabled={pending}
                  className="rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {pending ? 'Adding…' : '+ Add to comorbidities'}
                </button>
              </div>
            );
          })}
        {!readOnly && (
          <div className="mb-3 space-y-2">
            {/* v3.8 — passive Qwen ICD-10 chips above the typeahead */}
            {/* v4.1.6 — hidden by default; voice-first input is the primary path */}
            <CollapsedSuggestions label="Show ICD-10 suggestions">
              <Icd10SuggestedChips
                encounterId={initial.id}
                alreadyAddedCodes={new Set(assessmentCodes)}
                onAdd={(item) => {
                  setAssessmentCodes((cur) =>
                    cur.includes(item.code) ? cur : [...cur, item.code],
                  );
                  setAssessmentCodeLabels((cur) => ({ ...cur, [item.code]: item.label }));
                }}
              />
            </CollapsedSuggestions>
            <Icd10Typeahead
              excludeCodes={assessmentCodes}
              encounterId={initial.id}
              onSelect={(item) => {
                setAssessmentCodes((cur) =>
                  cur.includes(item.code) ? cur : [...cur, item.code],
                );
                setAssessmentCodeLabels((cur) => ({ ...cur, [item.code]: item.label }));
              }}
            />
          </div>
        )}
        <textarea
          value={assessment}
          onChange={(e) => setAssessment(e.target.value)}
          disabled={readOnly}
          rows={6}
          placeholder="Your impression — likely diagnoses, certainty, what you're ruling out or considering."
          className={textareaCls}
        />
        {!readOnly && (
          <ExtractIcd10FromAssessmentButton
            encounterId={initial.id}
            assessmentText={assessment}
            alreadyAddedCodes={new Set(assessmentCodes)}
            onAdd={(item) => {
              setAssessmentCodes((cur) =>
                cur.includes(item.code) ? cur : [...cur, item.code],
              );
              setAssessmentCodeLabels((cur) => ({ ...cur, [item.code]: item.label }));
            }}
          />
        )}
      </Section>

      <Section
        n={6}
        id="enc-section-treatment"
        label="Treatment"
        dictate={!readOnly ? { encounterId: initial.id, section: 'prescription' } : undefined}
      >
        <PrescriptionCompose
          encounterId={initial.id}
          initialLines={initial.prescription_lines ?? []}
          readOnly={readOnly}
          initialDdi={initial.ddi_findings ?? null}
          onLinesChange={setRxLinesMirror}
        />
        {/* v3.9.4 — Rx ↔ comorbidity coherence inline panel */}
        <RxCoherencePanel state={rxCoherence} mode="inline" />
      </Section>

      <PlanSection
        encounterId={initial.id}
        n={7}
        encounterStatus={initial.status}
        predictionTrigger={
          ccChips.length + cc.length + exam.length + assessment.length + assessmentCodes.length
        }
        onSubmitted={() => router.refresh()}
      />

      {/* D.1 — final counselling lives at the disposition beat: appears once a
          terminal-kind plan exists, right above Submit & finish (V, 10 Jun). */}
      <CounsellingGate
        encounterId={initial.id}
        initialEligible={counsellingEligible ?? false}
        transcripts={counsellingTranscripts ?? []}
      />

      <TranscriptViewer ref={transcriptRef} encounterId={initial.id} />

      {!readOnly && (
        <div className="sticky bottom-0 -mx-6 border-t border-even-ink-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {submitError && (
                <p className="text-xs text-even-pink-700">{submitError}</p>
              )}
              {false && (
                <p className="text-xs text-even-ink-500">
                  Pick a disposition to submit.
                </p>
              )}
              {submitGated && (
                <p className="text-xs text-even-ink-500">
                  Paused for diagnostics — submit unlocks once the encounter is back as Ready to resume.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canSendToDiagnostics && (
                <button
                  type="button"
                  onClick={() => setLabModalOpen(true)}
                  className="rounded-lg border border-even-blue-300 bg-white px-4 py-2.5 text-sm font-semibold text-even-blue-800 transition hover:bg-even-blue-50"
                  title="Roomier diagnostic-ordering workspace — all modalities, shares state with the inline strip"
                >
                  Diagnostics workspace
                </button>
              )}
              {canSendToDiagnostics && (
                <button
                  type="button"
                  onClick={() => setHandoffModalOpen(true)}
                  className="rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-50"
                  title="Flag this encounter for another doctor's review (v2.3)"
                >
                  Flag for handoff
                </button>
              )}
              {canSendToDiagnostics && (
                <button
                  type="button"
                  onClick={() => setDiagModalOpen(true)}
                  className="rounded-lg border border-even-pink-300 bg-white px-4 py-2.5 text-sm font-semibold text-even-pink-800 transition hover:bg-even-pink-50"
                  title="Imaging / radiology (CXR, ECG, USG, Echo)"
                >
                  Imaging
                </button>
              )}
              <button
                type="button"
                onClick={onSubmit}
                disabled={true}
                className="rounded-lg bg-even-blue px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-even-blue-700 focus:outline-none focus:ring-2 focus:ring-even-blue-100"
                title={submitGated ? 'Encounter is paused — resume first.' : ''}
              >
                {submitting ? 'Finishing…' : 'Submit & finish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v3.9.4 — Rx coherence submit-time modal */}
      <RxCoherencePanel
        state={rxCoherence}
        mode="modal"
        open={coherenceModalOpen}
        onClose={() => setCoherenceModalOpen(false)}
        onConfirm={() => {
          setCoherenceModalOpen(false);
          setConfirmModalOpen(true);
        }}
      />

      <SendToDiagnosticsModal
        encounterId={initial.id}
        patientName={patient.name}
        open={diagModalOpen}
        onClose={() => setDiagModalOpen(false)}
      />

      <DiagnosticOrderModal
        encounterId={initial.id}
        patientName={patient.name}
        open={labModalOpen}
        onClose={() => setLabModalOpen(false)}
      />

      <FlagHandoffModal
        encounterId={initial.id}
        patientName={patient.name}
        open={handoffModalOpen}
        onClose={() => setHandoffModalOpen(false)}
      />

      <SubmitConfirmModal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        encounterId={initial.id}
        patient={{
          name: patient.name,
          age_years: patient.age_years,
          sex: patient.sex,
          mrn: patient.mrn,
          phone_e164: patient.phone_e164,
        }}
        assessment={{
          text: assessment || null,
          codes: assessmentCodes,
        }}
        disposition={disposition}
        follow_up_days={typeof followUpDays === 'number' ? followUpDays : null}
        referral_target={referralTarget || null}
      />

      {/* v4.0.8 — keyboard shortcuts overlay (? key) */}
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {/* v4.0.9 — command palette (⌘K / Ctrl+K) */}
      <CommandPalette open={showCommand} onClose={() => setShowCommand(false)} commands={commands} />
    </div>
  );
}

const textareaCls =
  'w-full rounded-lg border border-even-ink-200 bg-white px-3 py-2 text-sm text-even-navy placeholder-even-ink-300 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100 disabled:bg-even-ink-50 disabled:text-even-ink-500';



/**
 * v2.3 — Compact attribution strip across the top of the editor. Shows
 * "Section: Dr X · Ym ago" pills for every section that someone OTHER
 * than the current viewer last edited. Self-edits are hidden so the
 * strip stays signal-rich.
 */
const SECTION_LABELS: Record<string, string> = {
  chief_complaint: 'CC',
  exam_findings: 'Exam',
  vitals: 'Vitals',
  assessment: 'Assessment',
  prescription: 'Rx',
  disposition: 'Disposition',
};

function AttributionStrip({
  sectionEditors,
  selfDoctorId,
}: {
  sectionEditors: SectionEditorNameMap;
  selfDoctorId: string | null;
}) {
  // Filter out self-edits and unknown editors.
  const items: Array<{ section: string; name: string; edited_at: string }> = [];
  for (const [section, info] of Object.entries(sectionEditors)) {
    if (!info?.name) continue;
    items.push({ section, name: info.name, edited_at: info.edited_at });
  }
  if (items.length === 0) return null;

  // Order: stable section order (CC → Exam → Vitals → Assessment → Rx → Disposition).
  const order = ['chief_complaint', 'exam_findings', 'vitals', 'assessment', 'prescription', 'disposition'];
  items.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));

  return (
    <div className="rounded-lg border border-even-ink-100 bg-even-ink-50/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
        Chart contributors
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {items.map((it) => (
          <li
            key={it.section}
            className="inline-flex items-center gap-1 rounded-full border border-even-ink-200 bg-white px-2 py-0.5 text-[10px] text-even-ink-700"
            title={`${SECTION_LABELS[it.section] ?? it.section} last edited by ${it.name} · ${new Date(it.edited_at).toLocaleString('en-IN')}`}
          >
            <span className="font-semibold text-even-navy">
              {SECTION_LABELS[it.section] ?? it.section}
            </span>
            <span>·</span>
            <span>{firstName(it.name)}</span>
            <span className="text-even-ink-400">
              · {relativeAge(it.edited_at)}
            </span>
          </li>
        ))}
      </ul>
      {selfDoctorId && (
        <p className="mt-1 text-[10px] text-even-ink-400">
          Your edits aren&apos;t shown.
        </p>
      )}
    </div>
  );
}

function firstName(full: string): string {
  // v5.0.3 — strip 'Dr.'/'Dr'/'Nurse' prefix FIRST, then split. The
  // previous order split first and tried to strip a 'Dr.' token that
  // had no trailing whitespace, leaving 'Dr.' as the result.
  const stripped = (full || '').replace(/^(Dr\.?|Nurse)\s*/i, '').trim();
  return stripped.split(/\s+/)[0] || stripped || full;
}

function relativeAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ResumeBanner({
  encounterId,
  test,
  labSummary,
}: {
  encounterId: string;
  test: string | null;
  labSummary: LabReturnSummary | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onResume() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/resume`, {
        method: 'POST',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'Could not resume.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // v2.1.5 — prefer the structured lab summary copy when available;
  // fall back to the v1 generic diagnostic line otherwise.
  const hasLabs = labSummary && labSummary.posted_count > 0;

  return (
    <div className="rounded-lg border border-even-blue-200 bg-even-blue-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-even-blue-700">
            Ready to resume
          </p>
          {hasLabs ? (
            <p className="mt-0.5 text-xs text-even-navy">
              <span className="font-medium">
                {labSummary!.posted_count} lab result
                {labSummary!.posted_count === 1 ? '' : 's'} back
              </span>
              {labSummary!.critical_count > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-even-pink-800">
                    {labSummary!.critical_count} critical
                  </span>
                </>
              )}
              {labSummary!.abnormal_count > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-amber-700">
                    {labSummary!.abnormal_count} abnormal
                  </span>
                </>
              )}
              . Review the results below, then continue with assessment,
              prescription, and disposition.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-even-navy">
              Diagnostic{' '}
              <span className="font-medium">{test ?? 'result'}</span> available in
              Pulse. Read the result, then continue with assessment, prescription,
              and disposition.
            </p>
          )}
          {error && (
            <p className="mt-2 text-[11px] text-even-pink-700">{error}</p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-even-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Resuming…' : 'Resume encounter'}
        </button>
      </div>
    </div>
  );
}

/** Append a transcript to an existing field. Drops the trailing
 *  newline if the field is empty so the result doesn't lead with one. */
function appendTranscript(current: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return current;
  if (!current.trim()) return t;
  return `${current.trimEnd()}\n${t}`;
}

function CcChipGrid({
  selected,
  onToggle,
  readOnly,
  ccRankings,
  ccAdditions,
}: {
  selected: string[];
  onToggle: (label: string) => void;
  readOnly?: boolean;
  ccRankings: string[];
  ccAdditions: string[];
}) {
  const sel = new Set(selected);

  // v4.0.3: flat chip wall with subtle text-only category dividers.
  // No more nested bordered boxes. AI ranking still re-orders within
  // each category band; chips not in `ccRankings` keep original position.
  const rankIndex = new Map<string, number>();
  ccRankings.forEach((label, i) => rankIndex.set(label, i));
  const orderInBand = (a: { label: string }, b: { label: string }) => {
    const ai = rankIndex.has(a.label) ? rankIndex.get(a.label)! : Number.POSITIVE_INFINITY;
    const bi = rankIndex.has(b.label) ? rankIndex.get(b.label)! : Number.POSITIVE_INFINITY;
    return ai - bi;
  };

  const bands = [
    { name: 'Acute', cat: 'acute' as const },
    { name: 'Follow-up', cat: 'chronic' as const },
    { name: 'Routine', cat: 'routine' as const },
  ];

  // De-dupe AI additions against the standard catalogue and each other.
  const standardSet = new Set(CC_CHIPS.map((c) => c.label));
  const seenAdd = new Set<string>();
  const additions = ccAdditions.filter((label) => {
    if (!label || standardSet.has(label)) return false;
    if (seenAdd.has(label)) return false;
    seenAdd.add(label);
    return true;
  });

  return (
    <div className="space-y-3">
      {additions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
            <span aria-hidden>✨</span>
            For this patient
          </span>
          {additions.map((label) => {
            const on = sel.has(label);
            return (
              <button
                key={`add-${label}`}
                type="button"
                disabled={readOnly}
                onClick={() => onToggle(label)}
                aria-pressed={on}
                className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                  on
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-violet-50 text-violet-900 ring-1 ring-violet-300 hover:ring-violet-500'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* v4.0.3 — flat wall with inline category labels. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {bands.map((b, bi) => {
          const chips = CC_CHIPS.filter((c) => c.category === b.cat).slice().sort(orderInBand);
          if (chips.length === 0) return null;
          return (
            <span key={b.cat} className="contents">
              {bi > 0 && (
                <span aria-hidden className="text-even-ink-300">
                  ·
                </span>
              )}
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-even-ink-500">
                {b.name}
              </span>
              {chips.map((c) => {
                const on = sel.has(c.label);
                return (
                  <button
                    key={c.label}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onToggle(c.label)}
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                      on
                        ? 'bg-even-blue text-white shadow-sm'
                        : 'bg-white text-even-navy ring-1 ring-even-ink-200 hover:ring-even-blue-300'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// v4.0.4 — VitalsPillRow renders a compact inline pill row:
//   BP 130/82 · HR 78 · RR 16 · Temp 36.8°C · SpO₂ 97%
// Click a pill to enter inline edit mode (number input + tab/enter to commit
// and move to next; blur to commit; esc to cancel). Empty values show as
// '—' which the doctor can tap to enter. ReadOnly hides edit affordances.
// Lossless: writes back the same Vitals shape via the onChange patch.
type VitalsPatch = Partial<{
  bp_sys: number | '';
  bp_dia: number | '';
  hr: number | '';
  rr: number | '';
  temp_c: number | '';
  spo2: number | '';
}>;

function VitalsPillRow({
  vitals,
  onChange,
  readOnly,
}: {
  vitals: Vitals;
  onChange: (patch: VitalsPatch) => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<null | 'bp' | 'hr' | 'rr' | 'temp' | 'spo2'>(null);

  // Local draft values for the active editor (so typing doesn't fire
  // autosave on every keystroke).
  const [draftBpSys, setDraftBpSys] = useState<string>('');
  const [draftBpDia, setDraftBpDia] = useState<string>('');
  const [draftScalar, setDraftScalar] = useState<string>('');

  const openEdit = (key: 'bp' | 'hr' | 'rr' | 'temp' | 'spo2') => {
    if (readOnly) return;
    if (key === 'bp') {
      setDraftBpSys(vitals.bp_sys != null && vitals.bp_sys !== '' ? String(vitals.bp_sys) : '');
      setDraftBpDia(vitals.bp_dia != null && vitals.bp_dia !== '' ? String(vitals.bp_dia) : '');
    } else if (key === 'hr') {
      setDraftScalar(vitals.hr != null && vitals.hr !== '' ? String(vitals.hr) : '');
    } else if (key === 'rr') {
      setDraftScalar(vitals.rr != null && vitals.rr !== '' ? String(vitals.rr) : '');
    } else if (key === 'temp') {
      setDraftScalar(vitals.temp_c != null && vitals.temp_c !== '' ? String(vitals.temp_c) : '');
    } else if (key === 'spo2') {
      setDraftScalar(vitals.spo2 != null && vitals.spo2 !== '' ? String(vitals.spo2) : '');
    }
    setEditing(key);
  };

  const parseNum = (raw: string): number | '' => {
    const t = raw.trim();
    if (t === '') return '';
    const n = Number(t);
    return Number.isFinite(n) ? n : '';
  };

  const commit = () => {
    if (editing === 'bp') {
      onChange({ bp_sys: parseNum(draftBpSys), bp_dia: parseNum(draftBpDia) });
    } else if (editing === 'hr') {
      onChange({ hr: parseNum(draftScalar) });
    } else if (editing === 'rr') {
      onChange({ rr: parseNum(draftScalar) });
    } else if (editing === 'temp') {
      onChange({ temp_c: parseNum(draftScalar) });
    } else if (editing === 'spo2') {
      onChange({ spo2: parseNum(draftScalar) });
    }
    setEditing(null);
  };

  const cancel = () => setEditing(null);

  // Display helpers
  const fmt = (v: number | '' | null | undefined, decimals = 0) =>
    v == null || v === '' ? '—' : decimals > 0 ? Number(v).toFixed(decimals) : String(v);
  const bpDisplay = () => {
    const s = vitals.bp_sys;
    const d = vitals.bp_dia;
    if ((s == null || s === '') && (d == null || d === '')) return '—';
    return `${fmt(s)}/${fmt(d)}`;
  };

  const inputCls =
    'w-12 bg-transparent text-sm font-semibold text-even-navy focus:outline-none ' +
    'border-0 border-b border-even-blue px-0 py-0 text-center [appearance:textfield] ' +
    '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  const pillCls = (active: boolean) =>
    `inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-sm transition ${
      active
        ? 'bg-even-blue-50 ring-1 ring-even-blue'
        : readOnly
        ? 'bg-transparent'
        : 'bg-white hover:bg-even-ink-50 ring-1 ring-even-ink-100 hover:ring-even-ink-200 cursor-pointer'
    }`;

  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-even-ink-500';
  const unitCls = 'text-[10px] text-even-ink-400';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {/* BP — compound pill: sys/dia */}
      {editing === 'bp' ? (
        <span className={pillCls(true)}>
          <span className={labelCls}>BP</span>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={draftBpSys}
            onChange={(e) => setDraftBpSys(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                (e.currentTarget.parentElement?.querySelector('input[data-dia]') as HTMLInputElement | null)?.focus();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className={inputCls}
            placeholder="—"
          />
          <span className="text-sm text-even-ink-400">/</span>
          <input
            data-dia
            type="number"
            inputMode="numeric"
            value={draftBpDia}
            onChange={(e) => setDraftBpDia(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className={inputCls}
            placeholder="—"
          />
          <span className={unitCls}>mmHg</span>
        </span>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => openEdit('bp')}
          className={pillCls(false)}
        >
          <span className={labelCls}>BP</span>
          <span className="text-sm font-semibold text-even-navy">{bpDisplay()}</span>
          <span className={unitCls}>mmHg</span>
        </button>
      )}

      <ScalarVitalPill
        editing={editing === 'hr'}
        label="HR"
        unit="bpm"
        display={fmt(vitals.hr)}
        draft={draftScalar}
        setDraft={setDraftScalar}
        onOpen={() => openEdit('hr')}
        onCommit={commit}
        onCancel={cancel}
        readOnly={readOnly}
      />
      <ScalarVitalPill
        editing={editing === 'rr'}
        label="RR"
        unit="/min"
        display={fmt(vitals.rr)}
        draft={draftScalar}
        setDraft={setDraftScalar}
        onOpen={() => openEdit('rr')}
        onCommit={commit}
        onCancel={cancel}
        readOnly={readOnly}
      />
      <ScalarVitalPill
        editing={editing === 'temp'}
        label="Temp"
        unit="°C"
        display={fmt(vitals.temp_c, 1)}
        draft={draftScalar}
        setDraft={setDraftScalar}
        onOpen={() => openEdit('temp')}
        onCommit={commit}
        onCancel={cancel}
        readOnly={readOnly}
        step="0.1"
      />
      <ScalarVitalPill
        editing={editing === 'spo2'}
        label="SpO₂"
        unit="%"
        display={fmt(vitals.spo2)}
        draft={draftScalar}
        setDraft={setDraftScalar}
        onOpen={() => openEdit('spo2')}
        onCommit={commit}
        onCancel={cancel}
        readOnly={readOnly}
      />
    </div>
  );
}

function ScalarVitalPill({
  editing,
  label,
  unit,
  display,
  draft,
  setDraft,
  onOpen,
  onCommit,
  onCancel,
  readOnly,
  step,
}: {
  editing: boolean;
  label: string;
  unit: string;
  display: string;
  draft: string;
  setDraft: (s: string) => void;
  onOpen: () => void;
  onCommit: () => void;
  onCancel: () => void;
  readOnly?: boolean;
  step?: string;
}) {
  const inputCls =
    'w-14 bg-transparent text-sm font-semibold text-even-navy focus:outline-none ' +
    'border-0 border-b border-even-blue px-0 py-0 text-center [appearance:textfield] ' +
    '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
  const pillCls = editing
    ? 'inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-sm bg-even-blue-50 ring-1 ring-even-blue'
    : `inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-sm transition ${
        readOnly
          ? 'bg-transparent'
          : 'bg-white hover:bg-even-ink-50 ring-1 ring-even-ink-100 hover:ring-even-ink-200 cursor-pointer'
      }`;
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-even-ink-500';
  const unitCls = 'text-[10px] text-even-ink-400';

  if (editing) {
    return (
      <span className={pillCls}>
        <span className={labelCls}>{label}</span>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          className={inputCls}
          placeholder="—"
        />
        <span className={unitCls}>{unit}</span>
      </span>
    );
  }
  return (
    <button type="button" disabled={readOnly} onClick={onOpen} className={pillCls}>
      <span className={labelCls}>{label}</span>
      <span className="text-sm font-semibold text-even-navy">{display}</span>
      <span className={unitCls}>{unit}</span>
    </button>
  );
}

function VitalInput({
  label,
  suffix,
  value,
  onChange,
  step,
  readOnly,
}: {
  label: string;
  suffix: string;
  value: number | '';
  onChange: (v: number | '') => void;
  step?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-even-ink-500">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-md border border-even-ink-200 bg-white pr-2 focus-within:border-even-blue focus-within:ring-2 focus-within:ring-even-blue-100">
        <input
          type="number"
          step={step}
          disabled={readOnly}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full bg-transparent px-3 py-1.5 text-sm text-even-navy focus:outline-none disabled:text-even-ink-500"
        />
        <span className="text-[10px] text-even-ink-400">{suffix}</span>
      </div>
    </label>
  );
}
