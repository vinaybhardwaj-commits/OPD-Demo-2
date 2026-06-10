/**
 * POST /api/transcribe/sarvam-live — OPD-Demo-2 P1.4.
 *
 * Server proxy for Sarvam AI (multilingual live engine). The browser sends
 * a SHORT, self-contained, decodable webm window (<=30s of audio: the
 * MediaRecorder header chunk + a recent block of media chunks); we run
 * Sarvam codemix on it and return the text + detected language.
 *
 * Ported from ETA app/[slug]/api/transcribe/sarvam-live/route.ts
 * (auth adapted: doctor-slug cookie → opd_session via getCurrentUser).
 *
 * Body: multipart/form-data
 *   - audio:        Blob (a decodable webm window, <=~25s)
 *   - encounter_id: string (optional, for logging)
 *   - block_idx:    string (optional, echoed)
 *
 * Returns: { ok, block_idx, text (codemix), language_code, latency_ms, error }
 * Soft-fail: a failed engine returns null text + error string; never throws.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sarvamCodemix } from '@/lib/sarvam';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected_multipart' }, { status: 400 });
  }
  const audio = form.get('audio');
  const blockIdx = String(form.get('block_idx') ?? '0');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: 'audio_missing' }, { status: 400 });
  }

  const contentType = audio.type || 'audio/webm';
  const buf = Buffer.from(await audio.arrayBuffer());

  // Code-mixed transcription: one engine, one continuous transcript that keeps
  // English in English and Indic in native script — drives the single live box.
  const cm = await sarvamCodemix(buf, contentType);

  return NextResponse.json({
    ok: true,
    block_idx: blockIdx,
    text: cm.ok ? cm.transcript : null,
    language_code: cm.ok ? cm.languageCode : null,
    latency_ms: cm.latencyMs,
    error: cm.ok ? null : cm.error,
  });
}
