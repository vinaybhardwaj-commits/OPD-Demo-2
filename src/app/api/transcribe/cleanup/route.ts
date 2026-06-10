/**
 * POST /api/transcribe/cleanup — OPD-Demo-2 P1.4.
 *
 * Body: { utterance_id: string, raw: string }
 * Returns:
 *   - { ok, utterance_id, cleaned, raw, latency_ms, model, fallback: false }
 *   - { ok, utterance_id, cleaned: raw, raw, latency_ms, error, fallback: true } on soft-fail
 *
 * Soft-fail philosophy: cleanup is a polish — never block transcription
 * on it. If the LLM fails, return the raw text as the "cleaned" version
 * with fallback=true so the client just keeps what Deepgram gave us.
 *
 * Ported from ETA app/[slug]/api/transcribe/cleanup/route.ts (opd_session auth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { cleanUtterance } from '@/lib/llm-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { utterance_id?: string; raw?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const utteranceId = (body.utterance_id ?? '').trim();
  const raw = (body.raw ?? '').trim();
  if (!utteranceId || !raw) {
    return NextResponse.json({ ok: false, error: 'utterance_id_and_raw_required' }, { status: 400 });
  }

  const result = await cleanUtterance(raw);
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      utterance_id: utteranceId,
      cleaned: result.cleaned,
      raw,
      latency_ms: result.latency_ms,
      model: result.model,
      fallback: false,
    });
  }
  return NextResponse.json({
    ok: true,
    utterance_id: utteranceId,
    cleaned: raw,
    raw,
    latency_ms: result.latency_ms,
    error: result.error,
    fallback: true,
  });
}
