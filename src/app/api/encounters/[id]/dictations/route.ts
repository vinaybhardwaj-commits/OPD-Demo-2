/**
 * GET  /api/encounters/[id]/dictations  — list dictations for this encounter
 * POST /api/encounters/[id]/dictations  — upload audio + transcribe inline
 *
 * POST accepts multipart/form-data with:
 *   - audio:    File (audio/webm, audio/mp4, etc.)
 *   - section:  string (chief_complaint | exam_findings | assessment | …)
 *   - duration_seconds: number
 *
 * Server flow:
 *   1. Validate session + ownership
 *   2. Upload audio to Vercel Blob (private, scoped to the encounter)
 *   3. POST audio bytes to Deepgram (nova-3-medical, en-IN). Short clips
 *      transcribe in 1-3s — block on response.
 *   4. INSERT section_dictations row with audio_blob_url + transcript
 *   5. Return the row, including transcript text and confidence
 *
 * If transcription fails the row is still saved with audio_blob_url and
 * transcript_text=null — the audio isn't lost.
 */
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { transcribeAudio } from '@/lib/transcribe';
import { runTranscriptionCompare } from '@/lib/transcribe-compare';
import { makeNdjsonStream, ndjsonHeaders } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_SECTIONS = new Set([
  'chief_complaint',
  'exam_findings',
  'assessment',
  'prescription',
  'disposition',
]);

async function ownerCheck(encId: string, doctorEmail: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
       WHERE e.id = $1 AND lower(d.email) = $2
     ) AS exists`,
    [encId, doctorEmail.toLowerCase()],
  );
  return rows[0]?.exists ?? false;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownerCheck(id, session.email))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const { rows } = await pool.query<{
    id: string;
    section: string;
    audio_blob_url: string | null;
    duration_seconds: number;
    transcript_text: string | null;
    created_at: string;
  }>(
    `SELECT id, section, audio_blob_url, duration_seconds, transcript_text, created_at
     FROM section_dictations
     WHERE encounter_id = $1
     ORDER BY created_at DESC`,
    [id],
  );
  return NextResponse.json({ ok: true, dictations: rows });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownerCheck(id, session.email))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  // Branch: JSON body (legacy, no audio — M3.3 placeholder path; still
  // useful for "I tried to dictate but couldn't grant mic permission")
  if (contentType.includes('application/json')) {
    let body: { section?: string; duration_seconds?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const section = (body.section ?? '').trim();
    const duration = Math.max(0, Math.min(600, Math.floor(Number(body.duration_seconds) || 0)));
    if (!ALLOWED_SECTIONS.has(section)) {
      return NextResponse.json({ ok: false, error: 'invalid_section' }, { status: 400 });
    }
    const { rows } = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO section_dictations (encounter_id, section, duration_seconds)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [id, section, duration],
    );
    return NextResponse.json({
      ok: true,
      dictation: {
        id: rows[0].id,
        section,
        duration_seconds: duration,
        created_at: rows[0].created_at,
        audio_blob_url: null,
        transcript_text: null,
      },
    });
  }

  // Branch: multipart with audio
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'expected_multipart_or_json' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_multipart' }, { status: 400 });
  }

  const section = String(form.get('section') ?? '').trim();
  const duration = Math.max(
    0,
    Math.min(600, Math.floor(Number(form.get('duration_seconds')) || 0)),
  );
  const audio = form.get('audio');
  if (!ALLOWED_SECTIONS.has(section)) {
    return NextResponse.json({ ok: false, error: 'invalid_section' }, { status: 400 });
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: 'missing_audio' }, { status: 400 });
  }
  if (audio.size > 4 * 1024 * 1024) {
    // 4MB ceiling for section dictation — pushes ~3 minutes at typical
    // opus rates. Ambient recording (Sprint 5.2) uses direct uploads.
    return NextResponse.json({ ok: false, error: 'audio_too_large' }, { status: 413 });
  }

  // 1. Upload to Vercel Blob (private)
  const mime = audio.type || 'audio/webm';
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
  const blobPath = `dictations/${id}/${section}-${Date.now()}.${ext}`;
  const audioBuffer = await audio.arrayBuffer();

  let audioBlobUrl: string;
  try {
    // Store is configured private — `access: 'private'` produces a URL
    // that requires the BLOB_READ_WRITE_TOKEN (or a signed URL) to
    // serve. We never expose the URL to the doctor's browser; the
    // server retrieves it later via @vercel/blob if needed.
    const uploaded = await put(blobPath, Buffer.from(audioBuffer), {
      access: 'private',
      contentType: mime,
      addRandomSuffix: true,
    });
    audioBlobUrl = uploaded.url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'blob_upload_failed', detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }

  // v6.0 Phase 2B — Accept-header branch (Q8). If the client wants
  // streaming, open a trace + NDJSON stream and fire the compare in a
  // fire-and-forget IIFE that emits progress events. Otherwise fall
  // through to the existing JSON path below.
  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('application/x-ndjson');

  if (wantsStream) {
    const trace = await openTrace({
      surface: 'transcribe-compare',
      encounter_id: id,
      doctor_email: session.email,
      request_input: { section, duration_seconds: duration, mime },
    });
    const { stream, emit, close } = makeNdjsonStream();
    const tStart = Date.now();

    (async () => {
      try {
        const cmp = await runTranscriptionCompare(Buffer.from(audioBuffer), mime, {
          context: `Section: ${section}. OPD encounter dictation.`,
          emit: (ev) => {
            emit(ev);
            if (ev.type === 'progress') trace.event(ev.stage, ev.msg, ev.ms);
          },
        });
        const transcript = cmp.winning_transcript;

        const { rows } = await pool.query<{ id: string; created_at: string }>(
          `INSERT INTO section_dictations
             (encounter_id, section, audio_blob_url, duration_seconds, transcript_text)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at`,
          [id, section, audioBlobUrl, duration, transcript],
        );
        const dictationId = rows[0].id;
        let compareId: string | null = null;
        try {
          const { rows: cmpRows } = await pool.query<{ id: string }>(
            `INSERT INTO transcription_comparisons (
               encounter_id, section_dictation_id, audio_blob_url, audio_duration_seconds, audio_mime, section,
               deepgram_transcript, deepgram_confidence, deepgram_latency_ms, deepgram_error,
               whisper_transcript, whisper_latency_ms, whisper_error,
               judge_winner, judge_deepgram_score, judge_whisper_score, judge_delta_score, judge_reasoning, judge_latency_ms, judge_error,
               total_elapsed_ms
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10,
               $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20,
               $21
             ) RETURNING id`,
            [
              id, dictationId, audioBlobUrl, duration, mime, section,
              cmp.deepgram.transcript, cmp.deepgram.confidence ?? null, cmp.deepgram.latency_ms, cmp.deepgram.error,
              cmp.whisper.transcript, cmp.whisper.latency_ms, cmp.whisper.error,
              cmp.judge.winner, cmp.judge.deepgram_score, cmp.judge.whisper_score, cmp.judge.delta_score, cmp.judge.reasoning, cmp.judge.latency_ms, cmp.judge.error,
              cmp.total_elapsed_ms,
            ],
          );
          compareId = cmpRows[0].id;
        } catch (e) {
          console.warn('transcription_comparisons insert failed (stream branch)', e);
        }

        const payload = {
          ok: true,
          dictation: {
            id: rows[0].id,
            section,
            audio_blob_url: audioBlobUrl,
            duration_seconds: duration,
            transcript_text: transcript,
            confidence: cmp.deepgram.confidence ?? null,
            transcribe_latency_ms: cmp.deepgram.latency_ms || null,
            transcribe_error: cmp.deepgram.error,
            created_at: rows[0].created_at,
          },
          compare: {
            id: compareId,
            deepgram: cmp.deepgram,
            whisper: cmp.whisper,
            judge: cmp.judge,
            total_elapsed_ms: cmp.total_elapsed_ms,
          },
        };
        emit({ type: 'result', data: payload });
        emit({ type: 'done', ms: Date.now() - tStart });
        await trace.finalise({
          status: 'completed',
          result_summary: { winner: cmp.judge.winner, total_elapsed_ms: cmp.total_elapsed_ms },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: 'error', message: msg });
        await trace.finalise({ status: 'errored', error_message: msg });
      } finally {
        close();
      }
    })();

    return new Response(stream, {
      headers: {
        ...Object.fromEntries(ndjsonHeaders()),
        'X-Trace-Id': trace.id,
      },
    });
  }

  // 2. Dual-engine compare — Deepgram + Whisper in parallel, qwen judge.
  //    v4.1.4 — replaces the single-Deepgram call. winning_transcript
  //    becomes the section text; both transcripts persist.
  const cmp = await runTranscriptionCompare(Buffer.from(audioBuffer), mime, {
    context: `Section: ${section}. OPD encounter dictation.`,
  });
  const transcript = cmp.winning_transcript;
  const confidence = cmp.deepgram.confidence ?? null;

  // 3. Store the section_dictations row first (transcript = winner)
  const { rows } = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO section_dictations
       (encounter_id, section, audio_blob_url, duration_seconds, transcript_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [id, section, audioBlobUrl, duration, transcript],
  );
  const dictationId = rows[0].id;

  // 3a. Store the transcription_comparisons row (v36).
  //     Best-effort — a failure here shouldn't block the dictation.
  let compareId: string | null = null;
  try {
    const { rows: cmpRows } = await pool.query<{ id: string }>(
      `INSERT INTO transcription_comparisons (
         encounter_id, section_dictation_id, audio_blob_url, audio_duration_seconds, audio_mime, section,
         deepgram_transcript, deepgram_confidence, deepgram_latency_ms, deepgram_error,
         whisper_transcript, whisper_latency_ms, whisper_error,
         judge_winner, judge_deepgram_score, judge_whisper_score, judge_delta_score, judge_reasoning, judge_latency_ms, judge_error,
         total_elapsed_ms
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20,
         $21
       ) RETURNING id`,
      [
        id, dictationId, audioBlobUrl, duration, mime, section,
        cmp.deepgram.transcript, cmp.deepgram.confidence ?? null, cmp.deepgram.latency_ms, cmp.deepgram.error,
        cmp.whisper.transcript, cmp.whisper.latency_ms, cmp.whisper.error,
        cmp.judge.winner, cmp.judge.deepgram_score, cmp.judge.whisper_score, cmp.judge.delta_score, cmp.judge.reasoning, cmp.judge.latency_ms, cmp.judge.error,
        cmp.total_elapsed_ms,
      ],
    );
    compareId = cmpRows[0].id;
  } catch (e) {
    // Logged — but don't fail the dictation. Most likely cause: v36
    // migration hasn't been applied yet on this DB. The winning transcript
    // is still in section_dictations.
    console.warn('transcription_comparisons insert failed', e);
  }

  return NextResponse.json({
    ok: true,
    dictation: {
      id: rows[0].id,
      section,
      audio_blob_url: audioBlobUrl,
      duration_seconds: duration,
      transcript_text: transcript,
      confidence,
      transcribe_latency_ms: cmp.deepgram.latency_ms || null,
      transcribe_error: cmp.deepgram.error,
      created_at: rows[0].created_at,
    },
    compare: {
      id: compareId,
      deepgram: cmp.deepgram,
      whisper: cmp.whisper,
      judge: cmp.judge,
      total_elapsed_ms: cmp.total_elapsed_ms,
    },
  });
}
