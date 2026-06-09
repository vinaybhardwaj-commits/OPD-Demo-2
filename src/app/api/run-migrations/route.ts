/**
 * POST /api/run-migrations
 *
 * Idempotent runner over MIGRATIONS[]. Reads schema_migrations to see what
 * has already been applied; runs the rest in order; records each one
 * inside the same transaction as the migration itself so a partial failure
 * leaves the recorded version in sync with reality.
 *
 * Auth: x-migration-secret header must equal MIGRATION_SECRET env var.
 *
 * Response (200):
 *   {
 *     applied: [{ version, name, statements, ms }],
 *     skipped: [{ version, name }],
 *     total_after: N
 *   }
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { MIGRATIONS, splitSqlStatements } from '@/lib/migrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'migration_secret_not_configured' }, { status: 500 });
  }
  const provided = req.headers.get('x-migration-secret');
  if (provided !== secret) return unauthorized();

  // 1. Ensure schema_migrations table exists by running version 0 inline.
  //    This bootstrap is safe because v0's SQL uses IF NOT EXISTS.
  const bootstrap = MIGRATIONS.find((m) => m.version === 0);
  if (bootstrap) {
    for (const stmt of splitSqlStatements(bootstrap.sql)) {
      await pool.query(stmt);
    }
  }

  const applied: Array<{ version: number; name: string; statements: number; ms: number }> = [];
  const skipped: Array<{ version: number; name: string }> = [];

  // 2. Discover what's already applied.
  const { rows: appliedRows } = await pool.query<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  // 3. Apply the rest in order.
  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  for (const m of ordered) {
    if (m.version === 0) {
      if (!appliedSet.has(0)) {
        await pool.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [m.version, m.name]);
        applied.push({ version: m.version, name: m.name, statements: 1, ms: 0 });
      } else {
        skipped.push({ version: m.version, name: m.name });
      }
      continue;
    }

    if (appliedSet.has(m.version)) {
      skipped.push({ version: m.version, name: m.name });
      continue;
    }

    const stmts = splitSqlStatements(m.sql);
    const t0 = Date.now();
    try {
      await pool.query('BEGIN');
      for (const stmt of stmts) {
        await pool.query(stmt);
      }
      await pool.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [m.version, m.name],
      );
      await pool.query('COMMIT');
      applied.push({ version: m.version, name: m.name, statements: stmts.length, ms: Date.now() - t0 });
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          error: 'migration_failed',
          failed_version: m.version,
          failed_name: m.name,
          detail: msg.slice(0, 400),
          applied,
        },
        { status: 500 },
      );
    }
  }

  const { rows: countRows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM schema_migrations',
  );

  return NextResponse.json({
    ok: true,
    applied,
    skipped,
    total_after: parseInt(countRows[0]?.count ?? '0', 10),
  });
}

export async function GET(req: Request) {
  // GET variant returns current migration state (no auth required for read).
  void req;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const { rows } = await pool.query<{ version: number; name: string; applied_at: string }>(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
    );
    return NextResponse.json({
      applied: rows,
      registered: MIGRATIONS.map((m) => ({ version: m.version, name: m.name })),
      pending: MIGRATIONS.filter((m) => !rows.find((r) => r.version === m.version)).map((m) => ({
        version: m.version,
        name: m.name,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 503 });
  }
}
