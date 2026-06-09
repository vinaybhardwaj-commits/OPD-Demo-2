/**
 * POST /api/encounters/[id]/ask
 *
 * v3.10.4 — Ask-the-chart. Doctor asks any clinical question; system
 * auto-prefixes the full encounter context, retrieves grounded chunks,
 * generates a cited answer.
 *
 * Body: { question: string, deep?: boolean }
 * Returns: KbAskResult shape (answer + citations + latency)
 *
 * Context auto-loaded server-side (V's lock — doctor only types question):
 *   - Patient: age + sex + allergies
 *   - Active comorbidities: ICD-10 + label + control/severity (v3.9.5)
 *   - Current encounter: cc text + chips + assessment text
 *   - Active medications: from patient_summaries cached list
 *
 * Default model: llama3.1:8b (fast path, ~5s). deep:true → qwen2.5:14b.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { kbAsk } from '@/lib/kb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type EncContext = {
  patient_id: string;
  age_years: number;
  sex: string;
  allergies: string | null;
  cc_text: string | null;
  cc_chips: string[] | null;
  assessment_text: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { id: encounterId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(encounterId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }

    const body = (await req.json()) as { question?: string; deep?: boolean };
    const question = (body.question ?? '').trim();
    if (question.length < 3) {
      return NextResponse.json({ ok: false, error: 'question_too_short' }, { status: 400 });
    }
    if (question.length > 1200) {
      return NextResponse.json({ ok: false, error: 'question_too_long' }, { status: 400 });
    }

    // Load encounter + patient context
    const encRes = await pool.query<EncContext>(
      `SELECT e.patient_id,
              p.age_years, p.sex, p.known_allergies AS allergies,
              e.chief_complaint_text AS cc_text,
              e.chief_complaint_chips AS cc_chips,
              e.assessment_text
       FROM encounters e
       JOIN patients p ON p.id = e.patient_id
       WHERE e.id = $1 LIMIT 1`,
      [encounterId],
    );
    if (encRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    }
    const enc = encRes.rows[0];

    // Active comorbidities with state
    const comRes = await pool.query<{
      code: string;
      label: string;
      control_state: string | null;
      severity_state: string | null;
    }>(
      `SELECT code, label, control_state, severity_state
       FROM patient_comorbidities
       WHERE patient_id = $1 AND is_resolved = false
       ORDER BY added_at DESC LIMIT 20`,
      [enc.patient_id],
    );

    // Active meds via patient_summaries cache (best-effort)
    const medRes = await pool.query<{ summary: { active_meds?: Array<{ name?: string; dose?: string }> } | null }>(
      `SELECT summary FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
      [enc.patient_id],
    ).catch(() => ({ rows: [] as { summary: null }[] }));
    const activeMeds = (medRes.rows[0]?.summary?.active_meds ?? [])
      .map((m) => `${m.name ?? ''} ${m.dose ?? ''}`.trim())
      .filter(Boolean)
      .slice(0, 12);

    // Build a compact context paragraph for the LLM system prompt
    const lines: string[] = [];
    lines.push(`This patient: ${enc.age_years}-year-old ${enc.sex === 'M' ? 'male' : enc.sex === 'F' ? 'female' : 'patient'}.`);
    if (enc.allergies) lines.push(`Allergies: ${enc.allergies}.`);
    if (comRes.rows.length > 0) {
      const com = comRes.rows.map((c) => {
        const state = c.control_state === 'uncontrolled'
          ? ' (uncontrolled)'
          : c.severity_state === 'severe' ? ' (severe)' : '';
        return `${c.code} ${c.label}${state}`;
      }).join(', ');
      lines.push(`Active comorbidities: ${com}.`);
    }
    if (activeMeds.length > 0) lines.push(`Active meds: ${activeMeds.join('; ')}.`);
    if (enc.cc_text || (enc.cc_chips ?? []).length > 0) {
      const cc = [enc.cc_text, (enc.cc_chips ?? []).join(' / ')].filter(Boolean).join(' · ');
      lines.push(`Today's chief complaint: ${cc}.`);
    }
    if (enc.assessment_text) {
      lines.push(`Doctor's working assessment: ${enc.assessment_text.slice(0, 600)}.`);
    }
    const ctxPara = lines.join(' ');

    const systemPrompt =
      'You are a clinical decision-support assistant for hospital doctors at Even Hospital. ' +
      'The doctor is asking a question about the patient below; answer it using ONLY the provided context chunks. ' +
      'Cite sources inline as [1], [2], etc. matching the numbered context blocks. ' +
      'Tailor your answer to this specific patient where relevant (age, sex, comorbidities, current encounter). ' +
      'If the context does not contain the answer, say "I cannot answer that from the available sources" — do not invent facts.\n\n' +
      'PATIENT CONTEXT: ' + ctxPara;

    const result = await kbAsk(question, {
      deep: !!body.deep,
      topK: 8,
      hyde: true,
      systemPromptOverride: systemPrompt,
      timeoutMs: 45_000,
    });

    return NextResponse.json({
      ok: result.ok,
      ...(result.ok
        ? {
            answer: result.answer,
            citations: result.citations,
            model: result.model,
            latency_ms: result.latency_ms,
          }
        : {
            error: result.error,
            detail: result.detail,
            partial_chunks: result.partial_chunks,
          }),
      context_summary: ctxPara.slice(0, 400),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
