/**
 * /api/admin/bundles
 *
 * GET  — lists all diagnostic_bundles with item counts. Used by
 *        /admin/bundles list page + the bundle picker chip-row in
 *        DiagnosticsQuickAddStrip + future DiagnosticOrderModal.
 * POST — creates a new bundle { name, description, specialty_tag, items[] }.
 *        items[] is an array of { service_code, order_n, is_optional }.
 *        Validated against diagnostic_catalog.
 *
 * Auth: signed-in user (admin curates in v3, doctors read).
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BundleItemInput = { service_code: string; order_n?: number; is_optional?: boolean };

export async function GET(req: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get('active') === 'all';

  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    specialty_tag: string | null;
    is_active: boolean;
    n_items: number;
    created_at: string;
  }>(
    `SELECT b.id, b.name, b.description, b.specialty_tag, b.is_active,
            (SELECT COUNT(*)::int FROM diagnostic_bundle_items WHERE bundle_id = b.id) AS n_items,
            b.created_at::text AS created_at
     FROM diagnostic_bundles b
     ${includeInactive ? '' : 'WHERE b.is_active = true'}
     ORDER BY b.name ASC`,
  );

  return NextResponse.json({ ok: true, bundles: rows });
}

export async function POST(req: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    name: string;
    description?: string;
    specialty_tag?: string;
    items?: BundleItemInput[];
  };

  if (!body.name || body.name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'name_required' }, { status: 400 });
  }

  // Validate item service_codes against catalog
  const items = body.items ?? [];
  if (items.length > 0) {
    const codes = items.map((i) => i.service_code);
    const catRes = await pool.query<{ service_code: string }>(
      `SELECT service_code FROM diagnostic_catalog WHERE service_code = ANY($1::text[])`,
      [codes],
    );
    const known = new Set(catRes.rows.map((r) => r.service_code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, error: 'unknown_service_codes', missing }, { status: 400 });
    }
  }

  // Create bundle + items
  try {
    const { rows: bRows } = await pool.query<{ id: string }>(
      `INSERT INTO diagnostic_bundles (name, description, specialty_tag, created_by_doctor_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [body.name.trim(), body.description ?? null, body.specialty_tag ?? null, session.id ?? null],
    );
    const bundleId = bRows[0].id;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await pool.query(
        `INSERT INTO diagnostic_bundle_items (bundle_id, service_code, order_n, is_optional)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (bundle_id, service_code) DO NOTHING`,
        [bundleId, it.service_code, it.order_n ?? i, it.is_optional ?? false],
      );
    }

    return NextResponse.json({ ok: true, id: bundleId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('diagnostic_bundles_name_key') || msg.includes('duplicate key')) {
      return NextResponse.json({ ok: false, error: 'name_taken' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'db_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
