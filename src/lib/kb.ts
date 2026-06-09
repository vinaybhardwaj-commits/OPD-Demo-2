/**
 * lib/kb.ts — v3.10.0 (KB foundation)
 *
 * Thin client over the shared Even clinical knowledge base:
 *  - Neon Postgres + pgvector (~280k cited clinical chunks)
 *  - Self-hosted Ollama tunnel (6 models)
 *
 * Per Even-Clinical-Knowledge-Base-Integration-Guide.md §5. Implements
 * the 3-phase RAG pattern (HyDE → retrieve → answer) plus retrieve-only
 * and embed-only helpers. Soft-fail on every error so callers can
 * gracefully degrade (Mini offline, Neon timeout, etc.).
 *
 * Env vars (set in Vercel project Settings → Environment Variables):
 *   - KB_DATABASE_URL — Neon connection string for the shared KB
 *   - LLM_BASE_URL — existing Ollama tunnel URL including /v1 suffix
 *     (already set for OPD's existing qwen.ts client)
 *
 * Model selection per V's lock (hybrid):
 *   - Fast paths (Ask, ICD-10, real-time chips):  llama3.1:8b
 *   - Safety-critical (DDx, drug interactions):    qwen2.5:14b
 *   - HyDE expansion (cheap):                      qwen2.5:7b
 *   - Embeddings:                                  nomic-embed-text
 */
import { Pool } from 'pg';

export const KB_EMBED_MODEL = 'nomic-embed-text';
export const KB_HYDE_MODEL = 'qwen2.5:7b';
export const KB_ANSWER_MODEL_FAST = 'llama3.1:8b';
export const KB_ANSWER_MODEL_DEEP = 'qwen2.5:14b';
export const KB_TOP_K_DEFAULT = 8;
export const KB_TIMEOUT_MS = 30_000;

export type KbChunk = {
  id: number;
  source: string;     // 'mksap-19' | 'statpearls' | 'uptodate' | 'textbook' | 'openfda' | 'pubmed' | 'guideline'
  book: string;
  chapter: string | null;
  section: string | null;
  page_start: number | null;
  page_end: number | null;
  item_number: string | null;
  chunk_type: string | null;
  text: string;
  similarity: number; // 0..1, higher = more similar
};

export type KbRetrieveOptions = {
  sources?: string[];          // filter to e.g. ['openfda','textbook']
  books?: string[];            // filter to specific books
  topK?: number;               // default KB_TOP_K_DEFAULT
  hyde?: boolean;              // default true; set false to embed raw question
  timeoutMs?: number;          // default KB_TIMEOUT_MS
};

export type KbAskOptions = KbRetrieveOptions & {
  deep?: boolean;              // default false; use qwen2.5:14b for safety-critical
  systemPromptOverride?: string;
};

export type KbAskResult = {
  ok: true;
  question: string;
  answer: string;
  citations: Array<{
    n: number;
    source: string;
    book: string;
    chapter: string | null;
    section: string | null;
    page: number | null;
    similarity: number;
  }>;
  latency_ms: { hyde?: number; embed: number; retrieve: number; generate: number; total: number };
  model: string;
};

export type KbAskFailure = {
  ok: false;
  error: 'embed_failed' | 'retrieve_failed' | 'generate_failed' | 'hyde_failed' | 'no_chunks' | 'no_env' | 'unknown';
  detail: string;
  /** Partial: if retrieve succeeded but generate failed, callers can still show chunks. */
  partial_chunks?: KbChunk[];
};

// ----- KB pool (separate from OPD's main DATABASE_URL) -----

let _kbPool: Pool | null = null;
function kbPool(): Pool | null {
  if (_kbPool) return _kbPool;
  const url = process.env.KB_DATABASE_URL;
  if (!url) return null;
  _kbPool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false },
  });
  return _kbPool;
}

function vectorLiteral(v: number[]): string {
  return '[' + v.map((x) => x.toFixed(7)).join(',') + ']';
}

// ----- Low-level Ollama calls -----

async function ollamaFetch(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const base = process.env.LLM_BASE_URL;
  if (!base) throw new Error('no_env:LLM_BASE_URL');
  const url = `${base.replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama_http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

/** Embed a text → 768-dim vector. Returns null on failure. */
export async function kbEmbed(text: string, timeoutMs = KB_TIMEOUT_MS): Promise<number[] | null> {
  try {
    const json = (await ollamaFetch(
      '/embeddings',
      { model: KB_EMBED_MODEL, input: text.slice(0, 8000) },
      timeoutMs,
    )) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/** HyDE expansion: ask qwen2.5:7b for a brief reference answer to embed instead of the question. */
export async function kbHyDE(question: string, timeoutMs = KB_TIMEOUT_MS): Promise<string | null> {
  try {
    const json = (await ollamaFetch(
      '/chat/completions',
      {
        model: KB_HYDE_MODEL,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content:
            'Write a 2-3 sentence answer to the medical question below, in the voice of a clinical reference. ' +
            'Do not say "I don\'t know"; give the most plausible answer based on standard care.\n\nQ: ' + question,
        }],
      },
      timeoutMs,
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ----- Vector search -----

export async function kbVectorSearch(
  queryVec: number[],
  opts: { sources?: string[]; books?: string[]; topK?: number } = {},
): Promise<KbChunk[]> {
  const pool = kbPool();
  if (!pool) return [];
  const filters: string[] = [];
  const params: unknown[] = [vectorLiteral(queryVec)];
  if (opts.sources?.length) {
    filters.push(`source = ANY($${params.length + 1})`);
    params.push(opts.sources);
  }
  if (opts.books?.length) {
    filters.push(`book = ANY($${params.length + 1})`);
    params.push(opts.books);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const topK = Math.min(Math.max(1, opts.topK ?? KB_TOP_K_DEFAULT), 12);

  try {
    const { rows } = await pool.query<KbChunk>(
      `SELECT id, source, book, chapter, section, page_start, page_end,
              item_number, chunk_type, text,
              1 - (embedding <=> $1::vector) AS similarity
       FROM mksap_chunks
       ${where}
       ORDER BY embedding <=> $1::vector
       LIMIT ${topK}`,
      params,
    );
    return rows;
  } catch {
    return [];
  }
}

// ----- High-level helpers -----

/**
 * kbRetrieve — embed (optionally HyDE-expanded) + vector search. No LLM
 * generation. Use for "show me relevant snippets" UI panels.
 */
export async function kbRetrieve(
  question: string,
  opts: KbRetrieveOptions = {},
): Promise<KbChunk[]> {
  const useHyde = opts.hyde !== false;
  const seed = useHyde ? (await kbHyDE(question, opts.timeoutMs)) ?? question : question;
  const vec = await kbEmbed(seed, opts.timeoutMs);
  if (!vec) return [];
  return kbVectorSearch(vec, opts);
}

/**
 * kbAsk — full 3-phase RAG with citations. Soft-fail with detailed
 * error shape so callers can render partial results.
 */
export async function kbAsk(
  question: string,
  opts: KbAskOptions = {},
): Promise<KbAskResult | KbAskFailure> {
  if (!process.env.KB_DATABASE_URL) {
    return { ok: false, error: 'no_env', detail: 'KB_DATABASE_URL not set' };
  }
  if (!process.env.LLM_BASE_URL) {
    return { ok: false, error: 'no_env', detail: 'LLM_BASE_URL not set' };
  }

  const timeoutMs = opts.timeoutMs ?? KB_TIMEOUT_MS;
  const useHyde = opts.hyde !== false;
  const model = opts.deep ? KB_ANSWER_MODEL_DEEP : KB_ANSWER_MODEL_FAST;

  // Phase 1 — HyDE
  let hydeText = question;
  let hyde_ms: number | undefined;
  if (useHyde) {
    const t0 = Date.now();
    const expanded = await kbHyDE(question, timeoutMs);
    hyde_ms = Date.now() - t0;
    if (!expanded) {
      // HyDE failed, but we can still embed the raw question. Don't abort.
      hydeText = question;
    } else {
      hydeText = expanded;
    }
  }

  // Phase 2a — Embed
  const tEmbed = Date.now();
  const vec = await kbEmbed(hydeText, timeoutMs);
  const embed_ms = Date.now() - tEmbed;
  if (!vec) return { ok: false, error: 'embed_failed', detail: 'embedding model returned no vector' };

  // Phase 2b — Retrieve
  const tRetrieve = Date.now();
  const chunks = await kbVectorSearch(vec, opts);
  const retrieve_ms = Date.now() - tRetrieve;
  if (chunks.length === 0) {
    return { ok: false, error: 'no_chunks', detail: 'no chunks matched the query', partial_chunks: [] };
  }

  // Phase 3 — Answer
  const context = chunks
    .map((r, i) =>
      `[${i + 1}] ${r.book}${r.chapter ? ' — ' + r.chapter : ''}${r.section ? ' › ' + r.section : ''}` +
      `${r.page_start ? ` (p${r.page_start})` : ''}\n${r.text}`,
    )
    .join('\n\n---\n\n');

  const systemPrompt =
    opts.systemPromptOverride ??
    'You are a clinical decision support assistant for hospital doctors at Even Hospital. ' +
      'Answer the question using ONLY the provided context. Cite sources inline as [1], [2], etc. ' +
      'matching the numbered context blocks. If the context does not contain the answer, say ' +
      '"I cannot answer that from the available sources" — do not invent facts.';

  const tGen = Date.now();
  let answerText: string;
  try {
    const json = (await ollamaFetch(
      '/chat/completions',
      {
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Question: ${question}\n\nContext:\n${context}` },
        ],
      },
      timeoutMs * 2, // generation can be slow
    )) as { choices?: Array<{ message?: { content?: string } }> };
    answerText = json.choices?.[0]?.message?.content ?? '';
    if (!answerText) {
      return {
        ok: false,
        error: 'generate_failed',
        detail: 'empty generation',
        partial_chunks: chunks,
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: 'generate_failed',
      detail: e instanceof Error ? e.message : String(e),
      partial_chunks: chunks,
    };
  }
  const generate_ms = Date.now() - tGen;

  return {
    ok: true,
    question,
    answer: answerText,
    citations: chunks.map((r, i) => ({
      n: i + 1,
      source: r.source,
      book: r.book,
      chapter: r.chapter,
      section: r.section,
      page: r.page_start,
      similarity: r.similarity,
    })),
    latency_ms: {
      ...(hyde_ms !== undefined ? { hyde: hyde_ms } : {}),
      embed: embed_ms,
      retrieve: retrieve_ms,
      generate: generate_ms,
      total: (hyde_ms ?? 0) + embed_ms + retrieve_ms + generate_ms,
    },
    model,
  };
}

// ----- Drug indication helper (v3.10.2 Rx coherence backfill) -----

export type KbDrugIndication = {
  drug_name: string;
  citations: Array<{
    source: string;
    book: string;
    chapter: string | null;
    section: string | null;
    text_excerpt: string;
    similarity: number;
  }>;
};

/**
 * kbDrugIndication — fast non-LLM lookup for the OpenFDA
 * indications_and_usage section of a given drug. Used to back the
 * v3.9.4 Rx coherence warnings with FDA-label citations.
 *
 * Strategy: direct SQL filter on source='openfda' AND chapter ILIKE
 * '%<drug_name>%' AND chunk_type='indications_and_usage'. No vector
 * search needed — exact-name match is more precise for drug labels.
 *
 * Returns up to 2 matching chunks (typically: the indication section
 * + the precautions section if cleanly chunked). Empty array if no
 * match — caller's warning still shows from the static map.
 */
export async function kbDrugIndication(
  drugName: string,
): Promise<KbDrugIndication | null> {
  const pool = kbPool();
  if (!pool) return null;
  const name = drugName.toLowerCase().trim();
  if (name.length < 3) return null;

  try {
    const { rows } = await pool.query<{
      source: string;
      book: string;
      chapter: string | null;
      section: string | null;
      text: string;
    }>(
      `SELECT source, book, chapter, section, text
       FROM mksap_chunks
       WHERE source = 'openfda'
         AND lower(chapter) LIKE '%' || $1 || '%'
         AND (chunk_type = 'indications_and_usage' OR section ILIKE '%indications%')
       ORDER BY
         CASE WHEN chunk_type = 'indications_and_usage' THEN 0 ELSE 1 END,
         length(chapter) ASC
       LIMIT 2`,
      [name],
    );
    if (rows.length === 0) return null;
    return {
      drug_name: drugName,
      citations: rows.map((r) => ({
        source: r.source,
        book: r.book,
        chapter: r.chapter,
        section: r.section,
        text_excerpt: r.text.slice(0, 600),
        similarity: 1, // exact name match, not vector-scored
      })),
    };
  } catch {
    return null;
  }
}

// ----- Drug monograph helper (v3.10.5) -----

export type KbDrugMonograph = {
  drug_name: string;
  indication: KbMonographChunk[];
  warnings: KbMonographChunk[];
};

export type KbMonographChunk = {
  book: string;
  chapter: string | null;
  section: string | null;
  chunk_type: string | null;
  text: string;
};

/**
 * kbDrugMonograph — bigger sibling of kbDrugIndication for the v3.10.5
 * Drug Monograph drawer. Returns up to 2 indication chunks AND up to
 * 3 warning/contraindication chunks for a given drug name.
 *
 * Direct SQL on the openfda corpus, no vector search needed — drug
 * label sections are already indexed by chapter (drug name) + chunk_type
 * (SPL section key).
 */
export async function kbDrugMonograph(
  drugName: string,
): Promise<KbDrugMonograph | null> {
  const pool = kbPool();
  if (!pool) return null;
  const name = drugName.toLowerCase().trim();
  if (name.length < 3) return null;

  try {
    const [indRes, warnRes] = await Promise.all([
      pool.query<KbMonographChunk>(
        `SELECT book, chapter, section, chunk_type, text
         FROM mksap_chunks
         WHERE source = 'openfda'
           AND lower(chapter) LIKE '%' || $1 || '%'
           AND (chunk_type = 'indications_and_usage' OR section ILIKE '%indications%')
         ORDER BY CASE WHEN chunk_type = 'indications_and_usage' THEN 0 ELSE 1 END,
                  length(chapter) ASC
         LIMIT 2`,
        [name],
      ),
      pool.query<KbMonographChunk>(
        `SELECT book, chapter, section, chunk_type, text
         FROM mksap_chunks
         WHERE source = 'openfda'
           AND lower(chapter) LIKE '%' || $1 || '%'
           AND (
             chunk_type IN ('contraindications','warnings','boxed_warning','warnings_and_cautions')
             OR section ILIKE '%contraindication%'
             OR section ILIKE '%warning%'
           )
         ORDER BY CASE WHEN chunk_type = 'boxed_warning' THEN 0
                       WHEN chunk_type = 'contraindications' THEN 1
                       WHEN chunk_type = 'warnings_and_cautions' THEN 2
                       ELSE 3 END,
                  length(chapter) ASC
         LIMIT 3`,
        [name],
      ),
    ]);
    if (indRes.rows.length === 0 && warnRes.rows.length === 0) return null;
    return {
      drug_name: drugName,
      indication: indRes.rows,
      warnings: warnRes.rows,
    };
  } catch {
    return null;
  }
}

// ----- Health -----

export type KbHealth = {
  kb_db: { ok: boolean; latency_ms?: number; chunk_count?: number; error?: string };
  llm: { ok: boolean; latency_ms?: number; models?: string[]; error?: string };
};

export async function kbHealth(): Promise<KbHealth> {
  const out: KbHealth = {
    kb_db: { ok: false },
    llm: { ok: false },
  };

  // KB DB
  const pool = kbPool();
  if (!pool) {
    out.kb_db = { ok: false, error: 'no_env:KB_DATABASE_URL' };
  } else {
    const t0 = Date.now();
    try {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM mksap_chunks`,
      );
      out.kb_db = {
        ok: true,
        latency_ms: Date.now() - t0,
        chunk_count: parseInt(rows[0]?.n ?? '0', 10),
      };
    } catch (e) {
      out.kb_db = { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
    }
  }

  // LLM tunnel
  const base = process.env.LLM_BASE_URL;
  if (!base) {
    out.llm = { ok: false, error: 'no_env:LLM_BASE_URL' };
  } else {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${base.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: 'Bearer ollama' },
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        out.llm = {
          ok: true,
          latency_ms: Date.now() - t0,
          models: (json.data ?? []).map((m) => m.id),
        };
      } else {
        out.llm = { ok: false, error: `http_${res.status}` };
      }
    } catch (e) {
      out.llm = { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
    }
  }

  return out;
}
