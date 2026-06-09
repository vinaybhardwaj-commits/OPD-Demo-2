/**
 * POST /api/kb/evidence
 *
 * v3.10.3 — generic lazy-backfill citation endpoint. Used by the UI
 * to fetch a small set of KB chunks evidencing a single concept (ICD-10
 * code label, suggested comorbidity, etc.) without a Qwen call.
 *
 * Body: { query: string, topK?: 1-3 (default 2), sources?: string[] }
 * Returns: { ok: true, chunks: [{ source, book, chapter, section, page, text_excerpt }] }
 *
 * No HyDE (we want the literal label/code mapped to chunks, not an
 * imagined answer). No LLM in the path — pure embed + cosine search.
 * Soft-fail per house style.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { kbEmbed, kbVectorSearch } from '@/lib/kb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = (await req.json()) as { query?: unknown; topK?: unknown; sources?: unknown };
    const query = String(body.query ?? '').trim().slice(0, 600);
    if (query.length < 3) {
      return NextResponse.json({ ok: false, error: 'query_too_short' }, { status: 400 });
    }
    const topK = Math.min(Math.max(1, Number(body.topK) || 2), 3);
    const sources = Array.isArray(body.sources)
      ? (body.sources as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 8)
      : undefined;

    const vec = await kbEmbed(query, 12_000);
    if (!vec) return NextResponse.json({ ok: true, chunks: [] });

    const rows = await kbVectorSearch(vec, { sources, topK });
    return NextResponse.json({
      ok: true,
      chunks: rows.map((r) => ({
        source: r.source,
        book: r.book,
        chapter: r.chapter,
        section: r.section,
        page: r.page_start,
        text_excerpt: r.text.slice(0, 360),
        similarity: r.similarity,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
