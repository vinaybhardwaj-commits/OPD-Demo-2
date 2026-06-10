/**
 * stitch — OPD-Demo-2 P3a. The hybrid multi-session note stitch (design
 * §12.1/§12.4, LOCKED: hybrid): the EARLIER sessions' compact draft notes +
 * the FINAL session's verbatim (speaker-tagged) transcript + a timestamped
 * chronology of what happened between visits (orders placed, lab results
 * as they arrived, still-awaited tests — P3 lock: orders + results) →
 * one unified OPD note. The draft is provisional and correctable: the
 * model may revise Visit-1 impressions in light of Visit-2 + results.
 *
 * Bounded context by design — long Visit-1 audio never re-enters the
 * prompt, only its distilled draft (§12.4 rationale).
 */
import { pool } from './db';
import { qwenJson, QwenError } from './qwen';
import {
  OPD_NOTE_SCHEMA_BLOCK,
  normalizeOpdNote,
  transcriptForNote,
  NOTE_MODEL,
  type OpdNote,
} from './note-generation';

const STITCH_TIMEOUT_MS = 150_000;

const STITCH_SYSTEM = `You are assembling the FINAL unified note for an outpatient encounter that spanned multiple visits to the consultation room (the patient went out for tests in between). You receive:
1. PROVISIONAL DRAFT NOTE(S) from the earlier visit(s) — structured but provisional; you may revise their impressions where later information supersedes them
2. A CHRONOLOGY — timestamped orders, lab results (with values, units, reference ranges, critical flags) and still-awaited tests between visits
3. The VERBATIM transcript of the final visit (speaker-tagged when available)

Write ONE coherent note for the whole encounter as if it were a single visit, in clear clinical English:
- History/exam from the earlier draft(s) stay unless the final visit corrects them
- Results belong in the assessment narrative where they changed thinking ("troponin 0.8 — ACS confirmed"), and in plan.investigations as completed/awaited
- The final visit's decisions (diagnosis, treatment, disposition) take precedence
- Still-awaited tests must appear in plan.follow_up or plan.investigations as awaited
- Use ONLY stated information — never invent symptoms, values, doses, or plans
- Preserve exact doses, values, shorthand (BD/TDS/SOB) as in the sources

Return ONLY a JSON object matching exactly this schema (no preamble, no markdown fence):

${OPD_NOTE_SCHEMA_BLOCK}`;

export type ChronologyResult = {
  text: string;
  orders: number;
  results: number;
  awaited: number;
};

function fmtT(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Timestamped orders + results + awaited tests for one encounter (P3 lock). */
export async function buildChronology(encounterId: string): Promise<ChronologyResult> {
  const lines: Array<{ ts: string; line: string }> = [];
  let orders = 0;
  let results = 0;
  let awaited = 0;

  // Submitted plan rows that send work out (diagnostics / imaging / referral).
  try {
    const { rows } = await pool.query<{ kind: string; payload: Record<string, unknown>; submitted_at: string | null }>(
      `SELECT kind::text AS kind, payload, submitted_at::text AS submitted_at
         FROM encounter_plans
        WHERE encounter_id = $1 AND submitted_at IS NOT NULL
          AND kind::text IN ('diagnostics', 'imaging', 'refer')
        ORDER BY submitted_at ASC`,
      [encounterId],
    );
    for (const r of rows) {
      const p = r.payload ?? {};
      const what =
        (Array.isArray(p.tests) && p.tests.length ? (p.tests as string[]).join('; ') : null) ??
        (typeof p.modality === 'string' ? `${p.modality} ${typeof p.region === 'string' ? p.region : ''}`.trim() : null) ??
        (typeof p.target === 'string' ? `referral → ${p.target}` : null) ??
        (typeof p.summary === 'string' ? p.summary : r.kind);
      orders++;
      lines.push({ ts: r.submitted_at ?? '', line: `[${fmtT(r.submitted_at)}] ORDERED (${r.kind}): ${what}` });
    }
  } catch { /* intentional: chronology is best-effort — stitch works without it */ }

  // Lab orders + their results (FIRST-result rule drives the return; show all).
  try {
    const { rows } = await pool.query<{
      display_name: string | null;
      raw_text: string;
      status: string;
      ordered_at: string;
      r_name: string | null;
      value_numeric: string | null;
      value_text: string | null;
      unit: string | null;
      reference_range: string | null;
      is_critical: boolean | null;
      entered_at: string | null;
    }>(
      `SELECT o.display_name, o.raw_text, o.status, o.ordered_at::text AS ordered_at,
              r.display_name AS r_name, r.value_numeric::text AS value_numeric, r.value_text,
              r.unit, r.reference_range, r.is_critical, r.entered_at::text AS entered_at
         FROM lab_orders o
         LEFT JOIN lab_results r ON r.lab_order_id = o.id
        WHERE o.encounter_id = $1
        ORDER BY o.ordered_at ASC, r.entered_at ASC`,
      [encounterId],
    );
    for (const r of rows) {
      const name = r.r_name ?? r.display_name ?? r.raw_text;
      if (r.entered_at) {
        results++;
        const val = r.value_numeric ?? r.value_text ?? '—';
        lines.push({
          ts: r.entered_at,
          line: `[${fmtT(r.entered_at)}] RESULT: ${name} = ${val}${r.unit ? ' ' + r.unit : ''}${r.reference_range ? ` (ref ${r.reference_range})` : ''}${r.is_critical ? ' ⚠ CRITICAL' : ''}`,
        });
      } else if (r.status !== 'cancelled') {
        awaited++;
        lines.push({ ts: r.ordered_at, line: `[${fmtT(r.ordered_at)}] AWAITED: ${name} (no result yet)` });
      }
    }
  } catch { /* intentional: best-effort */ }

  // Unlinked results (lab_orders is a v3 compat VIEW — results entered
  // outside the order linkage, incl. legacy paths, land with
  // lab_order_id NULL). Pick up the patient's unlinked results inside the
  // encounter window so the chronology never silently drops a value.
  try {
    const { rows } = await pool.query<{
      display_name: string;
      value_numeric: string | null;
      value_text: string | null;
      unit: string | null;
      reference_range: string | null;
      is_critical: boolean | null;
      entered_at: string;
    }>(
      `SELECT r.display_name, r.value_numeric::text AS value_numeric, r.value_text,
              r.unit, r.reference_range, r.is_critical, r.entered_at::text AS entered_at
         FROM lab_results r
        WHERE r.lab_order_id IS NULL
          AND r.patient_id = (SELECT patient_id FROM encounters WHERE id = $1)
          AND r.entered_at >= COALESCE(
                (SELECT MIN(started_at) FROM encounter_sessions WHERE encounter_id = $1),
                (SELECT created_at FROM encounters WHERE id = $1))
        ORDER BY r.entered_at ASC`,
      [encounterId],
    );
    for (const r of rows) {
      results++;
      const val = r.value_numeric ?? r.value_text ?? '—';
      lines.push({
        ts: r.entered_at,
        line: `[${fmtT(r.entered_at)}] RESULT: ${r.display_name} = ${val}${r.unit ? ' ' + r.unit : ''}${r.reference_range ? ` (ref ${r.reference_range})` : ''}${r.is_critical ? ' ⚠ CRITICAL' : ''}`,
      });
    }
  } catch { /* intentional: best-effort */ }

  lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { text: lines.map((l) => l.line).join('\n'), orders, results, awaited };
}

export type StitchInputSession = {
  seq: number;
  started_at: string | null;
  ended_at: string | null;
  note_json: unknown;
  tagged_transcript: unknown;
  transcript_en: string | null;
};

export type StitchResult =
  | { ok: true; note: OpdNote; latency_ms: number; model: string; chronology: ChronologyResult }
  | { ok: false; error: string; latency_ms: number };

/**
 * Hybrid stitch: drafts of all sessions but the last + the last session's
 * verbatim transcript + the chronology → unified OpdNote. Never throws.
 */
export async function generateStitchedNote(
  encounterId: string,
  sessions: StitchInputSession[],
): Promise<StitchResult> {
  const t0 = Date.now();
  if (sessions.length < 2) return { ok: false, error: 'needs_two_sessions', latency_ms: 0 };
  const last = sessions[sessions.length - 1];
  const earlier = sessions.slice(0, -1);

  const draftBlocks = earlier
    .map((s) => {
      const n = s.note_json;
      if (!n) return null;
      return `--- VISIT ${s.seq} (${fmtT(s.started_at)}–${fmtT(s.ended_at)}) PROVISIONAL DRAFT ---\n${JSON.stringify(n, null, 1)}`;
    })
    .filter((b): b is string => b !== null);
  const lastVerbatim = transcriptForNote(last.tagged_transcript, last.transcript_en);
  if (draftBlocks.length === 0 && !lastVerbatim) {
    return { ok: false, error: 'no_stitch_inputs', latency_ms: Date.now() - t0 };
  }

  const chronology = await buildChronology(encounterId);
  const user = [
    draftBlocks.join('\n\n') || '(no earlier draft available)',
    `--- CHRONOLOGY (between visits) ---\n${chronology.text || '(no orders or results recorded)'}`,
    `--- FINAL VISIT ${last.seq} (${fmtT(last.started_at)}–${fmtT(last.ended_at)}) VERBATIM ---\n${lastVerbatim || '(no transcript)'}`,
    'Return the unified note JSON.',
  ].join('\n\n');

  try {
    const r = await qwenJson<unknown>(STITCH_SYSTEM, user, {
      model: NOTE_MODEL,
      temperature: 0.2,
      timeoutMs: STITCH_TIMEOUT_MS,
    });
    return { ok: true, note: normalizeOpdNote(r.json), latency_ms: r.latency_ms, model: r.model, chronology };
  } catch (e) {
    const latency_ms = Date.now() - t0;
    const msg = e instanceof QwenError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 300), latency_ms };
  }
}
