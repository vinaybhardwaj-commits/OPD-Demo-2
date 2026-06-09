/**
 * GET /api/health
 *
 * Probe Neon, return latency + server version + which migration version
 * has been applied + count of user-defined tables. Used by uptime checks
 * and sprint smoke tests.
 *
 * Response (200):
 *   {
 *     ok: true,
 *     db: { connected, latency_ms, server_version, host_hint },
 *     schema: { latest_migration, total_migrations, table_count },
 *     build: { sha, region },
 *     now
 *   }
 *
 * On DB failure: 503 with { ok: false, db: { connected: false, error } }
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { kbHealth } from '@/lib/kb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const t0 = Date.now();

  try {
    const { rows: vRows } = await pool.query<{ version: string; host: string | null }>(
      `SELECT version() AS version, inet_server_addr()::text AS host`,
    );
    const latency_ms = Date.now() - t0;
    const v = vRows[0] || { version: '', host: null };
    const server_version = (v.version || '').slice(0, 50);

    // Schema state — tolerant of pre-migration state
    let latest_migration: number | null = null;
    let total_migrations = 0;
    let table_count = 0;
    try {
      const { rows } = await pool.query<{ latest: number | null; total: string }>(
        `SELECT MAX(version) AS latest, COUNT(*)::text AS total FROM schema_migrations`,
      );
      latest_migration = rows[0]?.latest ?? null;
      total_migrations = parseInt(rows[0]?.total ?? '0', 10);
    } catch {
      // schema_migrations not yet created
    }
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      table_count = parseInt(rows[0]?.count ?? '0', 10);
    } catch {
      // ignore
    }

    // v3.10.0 — also probe shared KB (Neon + Ollama tunnel). Soft-fail —
    // these don't gate OPD's primary health; surfaced as extra fields.
    const kbProbe = await kbHealth();

    return NextResponse.json(
      {
        ok: true,
        db: {
          connected: true,
          latency_ms,
          server_version,
          host_hint: v.host ?? undefined,
        },
        schema: {
          latest_migration,
          total_migrations,
          table_count,
        },
        kb: kbProbe.kb_db,
        llm: kbProbe.llm,
        build: {
          sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          region: process.env.VERCEL_REGION ?? null,
        },
        now: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        db: { connected: false, error: msg.slice(0, 200) },
        build: {
          sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
          region: process.env.VERCEL_REGION ?? null,
        },
        now: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
