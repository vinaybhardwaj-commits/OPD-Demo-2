/**
 * POST /api/lab-orders/[id]/upload
 *
 * Lab tech uploads a scanned report (PDF or image). v2.1.3 Lab
 * Workstation.
 *
 * Architecture decision (v2.1.3):
 *   PDF → PNG rendering happens CLIENT-SIDE via pdf.js. That keeps the
 *   Vercel function lightweight (no @napi-rs/canvas / pdf2pic native
 *   deps to bundle). The server receives the original file (for
 *   archival in private Blob) PLUS the rendered PNG page(s) as
 *   base64. For native image uploads (PNG/JPEG) the client just
 *   passes the file through as a single page.
 *
 * Multipart body:
 *   original       — File (PDF or PNG/JPEG)
 *   page_count     — string number of PNGs to follow
 *   page_0..N      — base64 PNG content (no data: prefix)
 *
 * Server flow:
 *   1. Auth: lab_tech or admin, and the order must be in_progress
 *      AND claimed by this tech (or admin overriding).
 *   2. Upload `original` to private Blob at lab-results/<order>/<filename>.
 *   3. For each page, call extractLabPage(b64).
 *   4. Merge → ExtractedLabItem[] + overall_confidence.
 *   5. Update lab_orders:
 *        status = 'awaiting_confirmation'
 *        source_pdf_url = blob url
 *        extracted_at = NOW()
 *        extraction_confidence = overall_confidence
 *        extraction_raw = { items, overall_confidence }
 *        extraction_lab_tech_id = tech
 *      (lab_results rows are NOT written here — they're written by
 *       /confirm after the 10s countdown or manual confirm.)
 *   6. notifyQueue('queue:lab', 'extracted:<id>')
 *   7. Return { ok, items, overall_confidence, auto_post_eligible }
 *
 * On Qwen failure (timeout, network, parse): we still archive the PDF
 * and flip to awaiting_confirmation with an empty extraction_raw +
 * extraction_confidence=0; the tech can then key-in manually (manual
 * edit grid lands in v2.1.4 with full editing).
 */
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';
import { extractLabPage, type ExtractedLabItem } from '@/lib/qwen-vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AUTO_POST_THRESHOLD = 0.9; // PRD lock L.6

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'lab_tech' && session.role !== 'admin') {
    return NextResponse.json(
      { ok: false, error: 'forbidden_role' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  // Resolve tech doctors-row id.
  const { rows: techRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const techId = techRows[0]?.id;
  if (!techId) {
    return NextResponse.json({ ok: false, error: 'tech_not_seeded' }, { status: 500 });
  }

  // Order must be claimed (or admin override).
  const { rows: orderRows } = await pool.query<{
    id: string;
    status: string;
    claimed_by_lab_tech_id: string | null;
  }>(
    `SELECT id, status, claimed_by_lab_tech_id
     FROM lab_orders WHERE id = $1 LIMIT 1`,
    [id],
  );
  const order = orderRows[0];
  if (!order) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (order.status === 'resulted' || order.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, error: 'order_closed', detail: `Order is ${order.status}.` },
      { status: 409 },
    );
  }
  if (
    session.role !== 'admin' &&
    order.claimed_by_lab_tech_id !== techId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_your_claim',
        detail: 'Claim the order before uploading results.',
      },
      { status: 403 },
    );
  }

  // Parse multipart.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'invalid_multipart', detail: msg.slice(0, 200) },
      { status: 400 },
    );
  }

  const original = form.get('original');
  if (!(original instanceof File)) {
    return NextResponse.json(
      { ok: false, error: 'original_file_missing' },
      { status: 400 },
    );
  }
  const pageCount = parseInt(String(form.get('page_count') ?? '0'), 10);
  if (!Number.isFinite(pageCount) || pageCount < 1 || pageCount > 20) {
    return NextResponse.json(
      { ok: false, error: 'bad_page_count', detail: 'Must be 1-20.' },
      { status: 400 },
    );
  }
  const pageB64s: string[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const v = form.get(`page_${i}`);
    if (typeof v !== 'string' || v.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'page_missing', detail: `page_${i} not in body` },
        { status: 400 },
      );
    }
    pageB64s.push(v);
  }

  // 1. Archive the original to private Blob.
  let blobUrl: string;
  try {
    const safeName =
      (original.name || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const uploaded = await put(
      `lab-results/${id}/${safeName}`,
      Buffer.from(await original.arrayBuffer()),
      {
        access: 'private',
        contentType: original.type || 'application/octet-stream',
        addRandomSuffix: true,
      },
    );
    blobUrl = uploaded.url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'blob_upload_failed', detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }

  // 2a. Polish #5 — Resize each rendered page to max 1024px longest
  //     edge + re-encode as JPEG 85 BEFORE forwarding to Qwen-VL.
  //     Saves ~70% payload + Qwen latency per page. Per the Vision-LLM
  //     guide §7.1. If sharp throws (malformed PNG, etc.), fall back
  //     to the original base64.
  const resizedB64s: string[] = await Promise.all(
    pageB64s.map(async (b64) => {
      try {
        const inputBuf = Buffer.from(b64, 'base64');
        const outBuf = await sharp(inputBuf)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return outBuf.toString('base64');
      } catch {
        return b64;
      }
    }),
  );

  // 2b. Run Qwen-VL extraction across pages.
  let items: ExtractedLabItem[] = [];
  let overall_confidence = 0;
  let extraction_raw: unknown = null;
  let extraction_error: string | null = null;

  try {
    const perPage = await Promise.all(
      resizedB64s.map((b64) => extractLabPage(b64, { mimeType: 'image/jpeg' })),
    );
    items = perPage.flatMap((p) => p.items);
    overall_confidence =
      items.length === 0
        ? 0
        : Math.min(...items.map((i) => i.confidence));
    extraction_raw = {
      pages: perPage.map((p) => p.raw),
      items,
      overall_confidence,
    };
  } catch (e) {
    // We don't fail the request — we still want the order to advance
    // to awaiting_confirmation so the tech can manually key in values
    // (v2.1.4 edit grid). The error is recorded for audit.
    extraction_error = e instanceof Error ? e.message : String(e);
    extraction_raw = { error: extraction_error };
  }

  // 3. Persist.
  await pool.query(
    `UPDATE lab_orders
     SET status = 'awaiting_confirmation',
         source_pdf_url = $2,
         extracted_at = NOW(),
         extraction_confidence = $3,
         extraction_raw = $4::jsonb,
         extraction_lab_tech_id = $5
     WHERE id = $1`,
    [id, blobUrl, overall_confidence, JSON.stringify(extraction_raw), techId],
  );

  await notifyQueue('queue:lab', `extracted:${id}`);

  return NextResponse.json({
    ok: true,
    order_id: id,
    blob_url: blobUrl,
    items,
    overall_confidence,
    auto_post_eligible:
      items.length > 0 &&
      overall_confidence >= AUTO_POST_THRESHOLD &&
      extraction_error === null,
    extraction_error,
  });
}
