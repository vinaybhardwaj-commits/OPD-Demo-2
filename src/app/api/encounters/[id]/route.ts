/**
 * GET  /api/encounters/[id]  — fetch one encounter (auth-gated to its
 *                              owning doctor)
 * PATCH /api/encounters/[id] — partial update of mutable fields
 *
 * Mutable fields (anything below disposition):
 *   chief_complaint_text, exam_findings, vitals, assessment_text,
 *   disposition, follow_up_days, referral_target
 *
 * `status`, `started_at`, `encounter_number`, `patient_id`,
 * `doctor_id` are not mutable here — they flow through dedicated
 * lifecycle routes (start, send-to-diagnostics in Sprint 6, complete).
 *
 * The PATCH endpoint touches updated_at on every write so future
 * "edited at" UI has a real value to lean on.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EncounterFull = {
  id: string;
  encounter_number: string;
  patient_id: string;
  doctor_id: string;
  encounter_date: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  paused_reason: string | null;
  pending_diagnostic_test: string | null;
  chief_complaint_chips: string[] | null;
  chief_complaint_text: string | null;
  exam_findings: string | null;
  vitals: Record<string, unknown> | null;
  assessment_codes: string[] | null;
  assessment_code_labels: Record<string, string> | null;
  assessment_text: string | null;
  disposition: string | null;
  follow_up_days: number | null;
  referral_target: string | null;
  updated_at: string;
};

async function loadEncounterIfOwned(
  encId: string,
  doctorEmail: string,
): Promise<EncounterFull | null> {
  const { rows } = await pool.query<EncounterFull>(
    `SELECT e.id, e.encounter_number, e.patient_id, e.doctor_id,
            e.encounter_date::text AS encounter_date,
            e.status::text AS status,
            e.started_at, e.completed_at, e.paused_reason,
            e.pending_diagnostic_test,
            e.chief_complaint_chips, e.chief_complaint_text,
            e.exam_findings, e.vitals,
            e.assessment_codes, e.assessment_code_labels, e.assessment_text,
            e.disposition::text AS disposition,
            e.follow_up_days, e.referral_target, e.updated_at
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [encId, doctorEmail.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const enc = await loadEncounterIfOwned(id, session.email);
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, encounter: enc });
}

type PatchBody = {
  chief_complaint_chips?: string[] | null;
  chief_complaint_text?: string | null;
  exam_findings?: string | null;
  vitals?: Record<string, unknown> | null;
  assessment_codes?: string[] | null;
  assessment_code_labels?: Record<string, string> | null;
  assessment_text?: string | null;
  disposition?: string | null;
  follow_up_days?: number | null;
  referral_target?: string | null;
  disposition_label_override?: string | null;
  rx_comorbidity_overrides?: Array<{
    drug_name: string;
    comorbidity_code: string;
    comorbidity_label: string;
    decision: 'added' | 'overridden';
    reason?: string;
    source: 'static' | 'qwen';
    confidence: number;
    at: string;
  }>;
};

const ALLOWED_DISPOSITIONS = new Set([
  'discharge',
  'follow_up',
  'refer',
  'diagnostics',
  'admit',
  'vaccinate',
]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await loadEncounterIfOwned(id, session.email);
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  if (existing.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  if (body.disposition !== undefined && body.disposition !== null) {
    if (!ALLOWED_DISPOSITIONS.has(body.disposition)) {
      return NextResponse.json({ ok: false, error: 'invalid_disposition' }, { status: 400 });
    }
  }

  // Build dynamic UPDATE — only the keys present in the body are touched.
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, raw: unknown, cast = '') => {
    vals.push(raw);
    sets.push(`${col} = $${vals.length}${cast}`);
  };
  if ('chief_complaint_chips' in body) push('chief_complaint_chips', body.chief_complaint_chips, '::text[]');
  if ('chief_complaint_text' in body) push('chief_complaint_text', body.chief_complaint_text);
  if ('exam_findings' in body) push('exam_findings', body.exam_findings);
  if ('vitals' in body) push('vitals', body.vitals === null ? null : JSON.stringify(body.vitals), '::jsonb');
  if ('assessment_codes' in body) push('assessment_codes', body.assessment_codes, '::text[]');
  if ('assessment_code_labels' in body) push('assessment_code_labels', JSON.stringify(body.assessment_code_labels ?? {}), '::jsonb');
  if ('assessment_text' in body) push('assessment_text', body.assessment_text);
  if ('disposition' in body) push('disposition', body.disposition, '::disposition_kind');
  if ('follow_up_days' in body) push('follow_up_days', body.follow_up_days);
  if ('referral_target' in body) push('referral_target', body.referral_target);
  if ('disposition_label_override' in body)
    push('disposition_label_override', body.disposition_label_override);
  if ('rx_comorbidity_overrides' in body)
    push('rx_comorbidity_overrides', JSON.stringify(body.rx_comorbidity_overrides ?? []), '::jsonb');

  if (sets.length === 0) {
    return NextResponse.json({ ok: true, encounter: existing, noop: true });
  }

  // v2.3 — Stamp section_editors for each section this PATCH touches.
  // Sections roll up multiple body keys (e.g. chief_complaint_chips +
  // chief_complaint_text → 'chief_complaint'; disposition + follow_up_days
  // + referral_target → 'disposition').
  const sectionsTouched: string[] = [];
  if ('chief_complaint_chips' in body || 'chief_complaint_text' in body)
    sectionsTouched.push('chief_complaint');
  if ('exam_findings' in body) sectionsTouched.push('exam_findings');
  if ('vitals' in body) sectionsTouched.push('vitals');
  if ('assessment_codes' in body || 'assessment_text' in body)
    sectionsTouched.push('assessment');
  if (
    'disposition' in body ||
    'follow_up_days' in body ||
    'referral_target' in body ||
    'disposition_label_override' in body
  ) {
    sectionsTouched.push('disposition');
  }

  if (sectionsTouched.length > 0) {
    // Look up the caller's doctors-row id once.
    const { rows: meRows } = await pool.query<{ id: string }>(
      `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [session.email],
    );
    const editorId = meRows[0]?.id;
    if (editorId) {
      // Build a jsonb_build_object for the merge — single-statement
      // upsert into section_editors via concatenation.
      const editorPayload: Record<string, { doctor_id: string; edited_at: string }> = {};
      const now = new Date().toISOString();
      for (const s of sectionsTouched) {
        editorPayload[s] = { doctor_id: editorId, edited_at: now };
      }
      // Append a section_editors update to the same SQL.
      sets.push(`section_editors = section_editors || $${vals.push(JSON.stringify(editorPayload))}::jsonb`);
    }
  }

  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const sql = `UPDATE encounters SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`;
  await pool.query(sql, vals);

  const after = await loadEncounterIfOwned(id, session.email);
  return NextResponse.json({ ok: true, encounter: after });
}
