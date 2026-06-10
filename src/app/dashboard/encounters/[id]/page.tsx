/**
 * /dashboard/encounters/[id] — encounter screen.
 *
 * Server component: validates ownership, loads the full encounter +
 * patient row, hands editable fields to <EncounterEditor> (client).
 * Read-only viewers (completed encounters) still get the same shell —
 * the editor itself decides what to disable.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { EncounterEditor, type EncounterEditable } from '@/components/EncounterEditor';
import { CdmssCard, type CdmssPayload, type CdmssItemRow } from '@/components/room/CdmssCard';

import { AskTheChartSlider } from '@/components/AskTheChartSlider';
import { EncounterTopBar } from '@/components/encounter/EncounterTopBar';
import { PatientContextStrip } from '@/components/encounter/PatientContextStrip';
import { EncounterLabResults } from '@/components/EncounterLabResults';
import { VoiceQueryFab } from '@/components/VoiceQueryFab';
import AiActivityList from '@/components/llm-trace/AiActivityList';
import BackgroundTraceToaster from '@/components/llm-trace/BackgroundTraceToaster';
import { HandoffBanner } from '@/components/HandoffBanner';
import type { PrescriptionLine } from '@/components/DrugRow';
import {
  HistoryPanel,
  type HPEncounterCard,
  type HPSummary,
  type HPProblem,
  type HPAllergy,
} from '@/components/HistoryPanel';
import { loadLabTrends } from '@/lib/lab-trends';

export const dynamic = 'force-dynamic';

type Row = EncounterEditable & {
  patient_id: string;

  // P4.1 — review surface fields
  clinical_status: string | null;
  cdmss_json: unknown | null;
  cdmss_error: string | null;

  // v4.1.1 — pause-aware doctor-active clock (see migration v34 + lib/encounter-timer.ts)
  active_ms_accumulated: number | string | null;
  active_since: string | null;

  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  patient_phone_e164: string | null;
  patient_allergies: string | null;
  encounter_number: string;
  chief_complaint_chips: string[] | null;
  assessment_codes: string[] | null;
  disposition_label_override: string | null;
  // v2.0.5 triage attribution
  intake_visit_reason: string | null;
  triage_completed_at: string | null;
  triage_nurse_name: string | null;
  ddi_findings: unknown | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ddx_findings: any | null;
  // v2.3 handoff fields
  handoff_note: string | null;
  handoff_ack_by: string | null;
  handoff_ack_at: string | null;
  handoff_flagged_at: string | null; // = encounters.updated_at at flag time
  contributors_json: Array<{ doctor_id: string; joined_at: string; via: string }> | null;
  section_editors: Record<string, { doctor_id: string; edited_at: string }> | null;
  // v3.9.4 — Rx ↔ comorbidity coherence audit log
  rx_comorbidity_overrides: Array<{
    drug_name: string;
    comorbidity_code: string;
    comorbidity_label: string;
    decision: 'added' | 'overridden';
    reason?: string;
    source: 'static' | 'qwen';
    confidence: number;
    at: string;
  }> | null;
  prev_owner_name: string | null;
};

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { rows } = await pool.query<Row>(
    `SELECT
       e.id,
       e.patient_id,
       e.encounter_number,
       e.status::text AS status,
       e.clinical_status,
       e.cdmss_json,
       e.cdmss_error,
       e.started_at,
       e.active_ms_accumulated,
       e.active_since::text AS active_since,
       e.pending_diagnostic_test,
       e.chief_complaint_chips,
       e.chief_complaint_text,
       e.exam_findings,
       e.vitals,
       e.intake_visit_reason,
       e.triage_completed_at::text AS triage_completed_at,
       tn.name AS triage_nurse_name,
       e.assessment_codes,
       e.assessment_text,
       e.disposition::text AS disposition,
       e.follow_up_days,
       e.referral_target,
       e.disposition_label_override,
       e.ddi_findings,
       e.ddx_findings,
       e.handoff_note,
       e.handoff_ack_by,
       e.handoff_ack_at::text AS handoff_ack_at,
       e.updated_at::text AS handoff_flagged_at,
       e.contributors_json,
       e.section_editors,
       e.rx_comorbidity_overrides,
       (
         SELECT d2.name FROM doctors d2
         WHERE d2.id = (e.contributors_json->0->>'doctor_id')::uuid
           AND d2.id <> e.doctor_id
         LIMIT 1
       ) AS prev_owner_name,
       p.id AS patient_id,
       p.name AS patient_name,
       p.mrn AS patient_mrn,
       p.age_years AS patient_age_years,
       p.sex AS patient_sex,
       p.phone_e164 AS patient_phone_e164,
       p.known_allergies AS patient_allergies
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     JOIN doctors d ON d.id = e.doctor_id
     LEFT JOIN doctors tn ON tn.id = e.triage_nurse_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [id, session.email.toLowerCase()],
  );
  const row = rows[0];
  if (!row) notFound();

  // Load any existing prescription draft (+ dispatch state) for this encounter
  const { rows: rxRows } = await pool.query<{
    id: string;
    prescription_number: string;
    lines: PrescriptionLine[] | null;
    pdf_blob_url: string | null;
    patient_sent_at: string | null;
    pharmacy_sent_at: string | null;
  }>(
    `SELECT id, prescription_number, lines, pdf_blob_url,
            patient_sent_at, pharmacy_sent_at
     FROM prescriptions WHERE encounter_id = $1 LIMIT 1`,
    [id],
  );
  const rx = rxRows[0];
  const prescriptionLines: PrescriptionLine[] = rx?.lines ?? [];

  // v2.1.5 — lightweight lab summary for the ResumeBanner. One COUNT
  // query feeds posted/abnormal/critical so the banner can give the
  // doctor a one-line read on what came back.
  const { rows: labSumRows } = await pool.query<{
    posted: string;
    abnormal: string;
    critical: string;
  }>(
    `SELECT
       COUNT(*)::text AS posted,
       COUNT(*) FILTER (
         WHERE abnormal_flag IS NOT NULL
           AND abnormal_flag NOT IN ('normal','unknown')
       )::text AS abnormal,
       COUNT(*) FILTER (
         WHERE abnormal_flag IN ('critical_low','critical_high')
       )::text AS critical
     FROM lab_results lr
     JOIN lab_orders lo ON lo.id = lr.lab_order_id
     WHERE lo.encounter_id = $1`,
    [id],
  );
  const labSummary = {
    posted_count: Number(labSumRows[0]?.posted ?? 0),
    abnormal_count: Number(labSumRows[0]?.abnormal ?? 0),
    critical_count: Number(labSumRows[0]?.critical ?? 0),
  };

  // v2.3 — resolve section_editors doctor_ids to names for attribution
  // chips. One IN query gets every name we need.
  const sectionEditorsMap = row.section_editors ?? {};
  const editorIds = Array.from(
    new Set(Object.values(sectionEditorsMap).map((v) => v.doctor_id).filter(Boolean)),
  );
  let editorNames = new Map<string, string>();
  if (editorIds.length > 0) {
    const { rows: nameRows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM doctors WHERE id = ANY($1::uuid[])`,
      [editorIds],
    );
    editorNames = new Map(nameRows.map((r) => [r.id, r.name]));
  }
  // Resolve viewer's own doctors-row id so the strip can hide self-edits.
  const { rows: selfRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const selfDoctorId = selfRows[0]?.id ?? null;
  const sectionEditorsResolved: Record<string, { name: string; edited_at: string }> = {};
  for (const [section, info] of Object.entries(sectionEditorsMap)) {
    if (!info?.doctor_id || info.doctor_id === selfDoctorId) continue;
    const name = editorNames.get(info.doctor_id);
    if (!name) continue;
    sectionEditorsResolved[section] = { name, edited_at: info.edited_at };
  }

  // Load patient history for the PH.3 left panel — cached Qwen summary
  // + last 5 completed encounters. Cheap, runs in parallel-ish with
  // the prescription fetch (network round-trip dominates).
  const panelData = await loadHistoryPanelData(row.patient_id, id);

  // P4.1 — CDMSS item rows for the violet review card (accept/ignore state).
  const { rows: cdmssItemRows } = await pool.query(
    `SELECT id, item_group, payload, status
       FROM encounter_cdmss_items
      WHERE encounter_id = $1
      ORDER BY created_at ASC`,
    [id],
  );
  const cdmssItems = cdmssItemRows as CdmssItemRow[];

  // D.1 — counselling gate eligibility: a terminal-kind plan already exists
  // (kinds whose submit completes the encounter; diagnostics/imaging excluded).
  const { rows: termPlans } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM encounter_plans
      WHERE encounter_id = $1
        AND kind::text NOT IN ('diagnostics', 'imaging')`,
    [id],
  );
  const counsellingEligible = parseInt(termPlans[0]?.n ?? '0', 10) > 0;

  // P4.2 — final-counselling sessions (faithful transcripts, no review gate).
  const { rows: counselling } = await pool.query<{
    seq: number;
    transcript_en: string | null;
    transcribe_error: string | null;
    started_at: string | null;
  }>(
    `SELECT seq, transcript_en, transcribe_error, started_at::text AS started_at
       FROM encounter_sessions
      WHERE encounter_id = $1 AND phase = 'final_disposition'
      ORDER BY seq ASC`,
    [id],
  );
  // Polish #3 — lab trends for the HistoryPanel. Cheap single query.
  const labTrends = await loadLabTrends(row.patient_id);
  const prescriptionMeta = rx
    ? {
        id: rx.id,
        number: rx.prescription_number,
        has_pdf: !!rx.pdf_blob_url,
        patient_sent_at: rx.patient_sent_at,
        pharmacy_sent_at: rx.pharmacy_sent_at,
      }
    : null;

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      {/* D.7 — the places swap: Ask-the-Chart slides from the LEFT;
          patient history lives naked in the right rail below. */}
      <AskTheChartSlider encounterId={row.id} readOnly={row.status === 'completed'} />
      {/* v4.0.1 — new EncounterTopBar replaces the legacy header */}
      <EncounterTopBar
        encounterId={row.id}
        encounterNumber={row.encounter_number}
        status={row.status as Parameters<typeof EncounterTopBar>[0]['status']}
        activeMsAccumulated={Number(row.active_ms_accumulated ?? 0)}
        activeSince={row.active_since ?? null}
        patientName={row.patient_name}
        patientAge={row.patient_age_years}
        patientSex={row.patient_sex}
      />

      {/* v4.0.1 — compact patient context strip replaces the patient
          banner + lab orders banner + comorbidity banner cards */}
      <PatientContextStrip
        patientId={row.patient_id}
        phoneE164={row.patient_phone_e164}
        allergies={row.patient_allergies}
        intakeVisitReason={row.intake_visit_reason}
        triageNurseName={row.triage_nurse_name}
        triageCompletedAt={row.triage_completed_at}
        lastVisitAgo={null}
      />

      <section className="mx-auto max-w-7xl px-6 py-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          <div className="min-w-0 max-w-3xl">
{/* v4.0.1 — patient name card removed; identity lives in EncounterTopBar + PatientContextStrip */}
        {row.status === 'completed' && prescriptionMeta && (
          <div className="mb-4 rounded-lg border border-even-blue-100 bg-even-blue-50/60 px-3 py-2.5 text-xs text-even-navy">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">Dispatched</span>
                <span className="ml-1 font-mono text-[11px] text-even-ink-500">
                  {prescriptionMeta.number}
                </span>
                {prescriptionMeta.patient_sent_at && (
                  <span className="ml-2 text-even-ink-500"> · patient sent</span>
                )}
                {prescriptionMeta.pharmacy_sent_at && (
                  <span className="text-even-ink-500"> · pharmacy sent</span>
                )}
              </div>
              {prescriptionMeta.has_pdf && (
                <Link
                  href={`/api/prescriptions/${prescriptionMeta.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-even-blue-300 bg-white px-3 py-1 text-[11px] font-semibold text-even-blue-700 hover:bg-even-blue-50"
                >
                  View prescription PDF →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* v2.3 — Handoff banner. Renders when an unacknowledged
            handoff_note exists AND the viewing doctor is now the owner
            (after claiming from /dashboard). The Acknowledge button
            is idempotent for the current owner. */}
        {row.handoff_note && !row.handoff_ack_by && row.prev_owner_name && (
          <HandoffBanner
            encounterId={row.id}
            note={row.handoff_note}
            fromDoctorName={row.prev_owner_name}
            flaggedAt={row.handoff_flagged_at}
          />
        )}

        {/* P4.1 — Review surface (Surface C): banner + the violet CDMSS card.
            The board's Review-lane card lands here; accepts smart-route into
            plans (section 7), the Rx composer, and the Assessment. */}
        {row.clinical_status === 'ready_for_review' && (
          <div className="mb-4 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3">
            <p className="text-sm font-semibold text-violet-800">
              📋 Background note ready for review
            </p>
            <p className="mt-0.5 text-xs text-violet-700">
              The recording was transcribed, speaker-tagged, and drafted into the sections below
              (your typed text was never overwritten). Review the AI suggestions, then
              Submit &amp; finish to finalize the encounter.
            </p>
          </div>
        )}
        {row.cdmss_json ? (
          <div className="mb-6">
            <CdmssCard
              encounterId={row.id}
              cdmss={row.cdmss_json as CdmssPayload}
              items={cdmssItems}
            />
          </div>
        ) : row.cdmss_error && row.clinical_status === 'ready_for_review' ? (
          <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            AI suggestions unavailable ({String(row.cdmss_error).slice(0, 60)}…) — the hourly sweep retries. Review and finalize as usual.
          </p>
        ) : null}

        {/* v2.1.5 — doctor-side lab orders + results panel. */}
        <div id="encounter-lab-results" className="mb-6">
          <EncounterLabResults encounterId={row.id} />
        </div>

        <EncounterEditor
          counsellingEligible={counsellingEligible}
          counsellingTranscripts={counselling}
          patient={{
            id: row.patient_id,
            name: row.patient_name,
            mrn: row.patient_mrn,
            age_years: row.patient_age_years,
            sex: row.patient_sex,
            phone_e164: row.patient_phone_e164,
          }}
          ai={panelData.ai}
          labSummary={labSummary}
          sectionEditors={sectionEditorsResolved}
          selfDoctorId={selfDoctorId}
          initial={{
            id: row.id,
            encounter_number: row.encounter_number,
            status: row.status as EncounterEditable['status'],
            started_at: row.started_at,
            pending_diagnostic_test: row.pending_diagnostic_test,
            chief_complaint_chips: row.chief_complaint_chips,
            chief_complaint_text: row.chief_complaint_text,
            exam_findings: row.exam_findings,
            vitals: row.vitals,
            assessment_codes: row.assessment_codes,
            assessment_text: row.assessment_text,
            disposition: row.disposition as EncounterEditable['disposition'],
            follow_up_days: row.follow_up_days,
            referral_target: row.referral_target,
            disposition_label_override: row.disposition_label_override ?? null,
            prescription_lines: prescriptionLines,
            ddi_findings: row.ddi_findings ?? null,
            ddx_findings: row.ddx_findings ?? null,
            rx_comorbidity_overrides: row.rx_comorbidity_overrides ?? null,
          }}
        />
          </div>
          <div className="mt-6 lg:mt-0">
            {/* D.7 — patient history, always visible (was the left slider). */}
            <HistoryPanel
              inline
              patientId={row.patient_id}
              patientName={row.patient_name}
              summary={panelData.summary}
              encounters={panelData.encounters}
              labTrends={labTrends}
            />
          </div>
        </div>
        <div className="mx-auto mt-6 max-w-7xl">
          <AiActivityList encounterId={row.id} />
        </div>
      </section>
      <BackgroundTraceToaster encounterId={row.id} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// HistoryPanel data loader (PH.3.1)
// ---------------------------------------------------------------------------

/**
 * Build the props the <HistoryPanel> needs: cached summary + last 5
 * completed encounters EXCLUDING the current one (we're already in it).
 * All queries run in parallel.
 */
export type AiSmartening = {
  cc_chip_rankings: string[];
  cc_chip_additions: string[];
  disposition_recommendation: string | null;
  disposition_additions: string[];
};

async function loadHistoryPanelData(
  patientId: string,
  currentEncounterId: string,
): Promise<{
  summary: HPSummary;
  encounters: HPEncounterCard[];
  ai: AiSmartening;
}> {
  const [summaryRows, encounterRows, patientRows] = await Promise.all([
    pool.query<{
      summary: Record<string, unknown> | null;
      status: string;
      computed_at: string | null;
      fail_reason: string | null;
    }>(
      `SELECT summary, status,
              computed_at::text AS computed_at,
              fail_reason
         FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
      [patientId],
    ),
    pool.query<{
      id: string;
      encounter_date: string;
      encounter_number: string;
      chief_complaint_chips: string[] | null;
      assessment_codes: string[] | null;
      disposition: string | null;
    }>(
      `SELECT e.id,
              e.encounter_date::text AS encounter_date,
              e.encounter_number,
              e.chief_complaint_chips,
              e.assessment_codes,
              e.disposition::text AS disposition
         FROM encounters e
        WHERE e.patient_id = $1
          AND e.status = 'completed'
          AND e.id <> $2
        ORDER BY e.encounter_date DESC, e.completed_at DESC NULLS LAST
        LIMIT 5`,
      [patientId, currentEncounterId],
    ),
    pool.query<{ known_allergies: string | null }>(
      `SELECT known_allergies FROM patients WHERE id = $1 LIMIT 1`,
      [patientId],
    ),
  ]);

  const sRow = summaryRows.rows[0];
  const sObj = (sRow?.summary ?? {}) as {
    summary_text?: string;
    problem_list?: HPProblem[];
    allergy_aggregation?: { allergen?: string; source?: string }[];
    red_flags?: { kind?: string; text?: string }[];
    cc_chip_rankings?: string[];
    cc_chip_additions?: string[];
    disposition_recommendation?: string;
    disposition_additions?: string[];
  };

  // Build the allergy list (same merge logic as /patients/[id], compact).
  const seen = new Set<string>();
  const allergies: HPAllergy[] = [];
  const ownerAllergies = patientRows.rows[0]?.known_allergies ?? null;
  if (ownerAllergies && ownerAllergies !== 'None') {
    for (const piece of ownerAllergies.split(/[,;]/)) {
      const a = piece.trim();
      if (!a) continue;
      const k = a.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      allergies.push({ allergen: a, source: 'on file', fromOwner: true });
    }
  }
  for (const a of sObj.allergy_aggregation ?? []) {
    if (!a.allergen) continue;
    const k = a.allergen.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    allergies.push({ allergen: a.allergen, source: a.source ?? 'AI' });
  }
  for (const f of sObj.red_flags ?? []) {
    if (f.kind !== 'allergy' || !f.text) continue;
    const k = f.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    allergies.push({ allergen: f.text, source: 'AI red flag' });
  }

  const summary: HPSummary = {
    status: sRow?.status ?? 'missing',
    summary_text: sObj.summary_text ?? null,
    problems: (sObj.problem_list ?? []).slice(0, 4),
    allergies,
    computed_at: sRow?.computed_at ?? null,
    fail_reason: sRow?.fail_reason ?? null,
  };

  const encounters: HPEncounterCard[] = encounterRows.rows.map((r) => ({
    id: r.id,
    encounter_date: r.encounter_date,
    encounter_number: r.encounter_number,
    chief_complaint_chips: r.chief_complaint_chips,
    primary_code: (r.assessment_codes ?? [])[0] ?? null,
    disposition: r.disposition,
  }));

  const ai: AiSmartening = {
    cc_chip_rankings: (sObj.cc_chip_rankings ?? []).filter((s): s is string => typeof s === 'string'),
    cc_chip_additions: (sObj.cc_chip_additions ?? []).filter((s): s is string => typeof s === 'string').slice(0, 3),
    disposition_recommendation: sObj.disposition_recommendation ?? null,
    disposition_additions: (sObj.disposition_additions ?? []).filter((s): s is string => typeof s === 'string').slice(0, 2),
  };

  return { summary, encounters, ai };
}

function triageAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'just now';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
