/**
 * GET  /api/encounters/[id]/recordings  — list snippets + transcripts
 * POST /api/encounters/[id]/recordings  — upload one snippet's audio
 *
 * Sprint 5 ships the simple shape: each ambient recording session is
 * uploaded as ONE blob, immediately transcribed inline by Deepgram, and
 * stored as a single encounter_recordings row + one encounter_recording_chunks
 * row. Sprint 6's pause/resume creates additional snippets (snippet_index
 * 1, 2, …) tied to the same encounter_id. Sprint 8 polish swaps the
 * upload pattern for chunked + offline-queued — for now we trust the
 * doctor's tab stays open until the recording stops.
 *
 * Audio body cap is 4MB (Vercel function body limit). ~12 minutes of
 * webm/opus at 48kbps. Pilot OPD visits are typically 4-8 minutes, so
 * margin is fine. Longer-form recordings will need the chunked path.
 */
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { transcribeAudio } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type EncMini = { id: string };

async function loadEncIfOwned(
  encId: string,
  doctorEmail: string,
): Promise<EncMini | null> {
  const { rows } = await pool.query<EncMini>(
    `SELECT e.id FROM encounters e JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2 LIMIT 1`,
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
  if (!(await loadEncIfOwned(id, session.email))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const { rows } = await pool.query<{
    id: string;
    snippet_index: number;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    transcript_status: string;
    transcript_text: string | null;
    chunk_count: string;
  }>(
    `SELECT r.id, r.snippet_index, r.started_at, r.ended_at,
            r.duration_seconds, r.transcript_status::text AS transcript_status,
            r.transcript_text,
            COALESCE(c.cnt, 0)::text AS chunk_count
     FROM encounter_recordings r
     LEFT JOIN (
       SELECT recording_id, COUNT(*)::int AS cnt
       FROM encounter_recording_chunks
       GROUP BY recording_id
     ) c ON c.recording_id = r.id
     WHERE r.encounter_id = $1
     ORDER BY r.snippet_index`,
    [id],
  );

  return NextResponse.json({
    ok: true,
    recordings: rows.map((r) => ({
      ...r,
      chunk_count: parseInt(r.chunk_count, 10),
    })),
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await loadEncIfOwned(id, session.email))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'expected_multipart' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_multipart' }, { status: 400 });
  }

  const audio = form.get('audio');
  const durationField = form.get('duration_seconds');
  const duration = Math.max(0, Math.floor(Number(durationField) || 0));
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: 'missing_audio' }, { status: 400 });
  }
  if (audio.size > 4 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, error: 'audio_too_large', detail: 'Ambient snippets capped at ~12 min for now.' },
      { status: 413 },
    );
  }

  const mime = audio.type || 'audio/webm';
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';

  // Next snippet index = max(existing) + 1, defaults to 0
  const { rows: idxRows } = await pool.query<{ next: string }>(
    `SELECT COALESCE(MAX(snippet_index) + 1, 0)::text AS next
     FROM encounter_recordings
     WHERE encounter_id = $1`,
    [id],
  );
  const snippetIndex = parseInt(idxRows[0]?.next ?? '0', 10);

  // 1. Create the recording row first so we have its id for the blob path
  const recSession = crypto.randomUUID();
  const { rows: recRows } = await pool.query<{ id: string; started_at: string }>(
    `INSERT INTO encounter_recordings (
       encounter_id, recording_session_id, snippet_index,
       duration_seconds, transcript_status
     ) VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id, started_at`,
    [id, recSession, snippetIndex, duration],
  );
  const recordingId = recRows[0].id;

  // 2. Upload audio to Blob
  const blobPath = `recordings/${id}/${recordingId}/snippet-${snippetIndex}.${ext}`;
  const audioBuffer = await audio.arrayBuffer();
  let blobUrl: string;
  try {
    const uploaded = await put(blobPath, Buffer.from(audioBuffer), {
      access: 'private',
      contentType: mime,
      addRandomSuffix: true,
    });
    blobUrl = uploaded.url;
  } catch (e) {
    // Clean up the empty recording row
    await pool.query('DELETE FROM encounter_recordings WHERE id = $1', [recordingId]).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'blob_upload_failed', detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }

  // 3. Insert the chunk row (one chunk per snippet for Sprint 5)
  await pool.query(
    `INSERT INTO encounter_recording_chunks
       (recording_id, chunk_index, blob_url, bytes)
     VALUES ($1, 0, $2, $3)`,
    [recordingId, blobUrl, audioBuffer.byteLength],
  );

  // 4. Transcribe inline (Sprint 5 simple path)
  const tx = await transcribeAudio(Buffer.from(audioBuffer), mime);
  const transcript = tx.ok ? tx.transcript : null;
  const status = tx.ok ? 'complete' : 'failed';

  await pool.query(
    `UPDATE encounter_recordings
     SET ended_at = NOW(),
         transcript_text = $2,
         transcript_status = $3::transcription_status
     WHERE id = $1`,
    [recordingId, transcript, status],
  );

  return NextResponse.json({
    ok: true,
    recording: {
      id: recordingId,
      snippet_index: snippetIndex,
      duration_seconds: duration,
      transcript_status: status,
      transcript_text: transcript,
      bytes: audioBuffer.byteLength,
      transcribe_latency_ms: tx.ok ? tx.latency_ms : null,
      transcribe_error: tx.ok ? null : tx.error,
    },
  });
}
