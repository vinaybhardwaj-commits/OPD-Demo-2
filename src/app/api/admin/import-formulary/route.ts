/**
 * POST /api/admin/import-formulary
 *
 * Accepts the Pharmacy Formulary 2026 CSV as the raw request body
 * (Content-Type: text/csv). UPSERTs into drug_master by item_code so the
 * route is safe to re-run when V updates the Drive sheet.
 *
 * Auth: x-migration-secret header must equal MIGRATION_SECRET.
 *
 * Response (200):
 *   {
 *     ok: true,
 *     parsed: N,            // rows the CSV had (excluding header)
 *     imported: N,          // rows that were inserted or updated
 *     skipped: [{ reason, itemCode }, ...],  // capped at 50
 *     skip_counts: { reason: count, ... },
 *     ms: number
 *   }
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { parseCsv } from '@/lib/csv';
import {
  mapCsvRowToDrug,
  validateCsvHeaders,
  type FormularyDrug,
} from '@/lib/formulary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'migration_secret_not_configured' },
      { status: 500 },
    );
  }
  if (req.headers.get('x-migration-secret') !== secret) return unauthorized();

  const t0 = Date.now();
  const csvText = await req.text();
  if (!csvText || csvText.length < 100) {
    return NextResponse.json({ ok: false, error: 'empty_or_tiny_body' }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_rows_parsed' }, { status: 400 });
  }

  const headerCheck = validateCsvHeaders(Object.keys(rows[0]));
  if (headerCheck.length > 0) {
    return NextResponse.json(
      { ok: false, error: 'missing_required_columns', missing: headerCheck },
      { status: 400 },
    );
  }

  const drugs: FormularyDrug[] = [];
  const skipped: Array<{ reason: string; itemCode: string }> = [];
  for (const row of rows) {
    const r = mapCsvRowToDrug(row);
    if (r.ok) drugs.push(r.drug);
    else skipped.push({ reason: r.reason, itemCode: r.itemCode });
  }

  // Batched UPSERT — 200 rows per query to keep stmt size manageable.
  const BATCH = 200;
  let imported = 0;
  for (let i = 0; i < drugs.length; i += BATCH) {
    const batch = drugs.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders = batch.map((d, idx) => {
      const base = idx * 9;
      values.push(
        d.item_code,
        d.brand_name,
        d.generic_name,
        d.dosage_form,
        d.strength,
        d.major_grouping,
        d.schedule_dc,
        d.is_high_risk,
        d.lasa_alternates,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::drug_schedule, $${base + 8}, $${base + 9}::text[])`;
    });
    const sql = `
      INSERT INTO drug_master (
        item_code, brand_name, generic_name, dosage_form, strength,
        major_grouping, schedule_dc, is_high_risk, lasa_alternates
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (item_code) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        generic_name = EXCLUDED.generic_name,
        dosage_form = EXCLUDED.dosage_form,
        strength = EXCLUDED.strength,
        major_grouping = EXCLUDED.major_grouping,
        schedule_dc = EXCLUDED.schedule_dc,
        is_high_risk = EXCLUDED.is_high_risk,
        lasa_alternates = EXCLUDED.lasa_alternates
    `;
    await pool.query(sql, values);
    imported += batch.length;
  }

  // Aggregate skip reasons
  const skip_counts: Record<string, number> = {};
  for (const s of skipped) skip_counts[s.reason] = (skip_counts[s.reason] || 0) + 1;

  return NextResponse.json({
    ok: true,
    parsed: rows.length,
    imported,
    skipped: skipped.slice(0, 50),
    skip_counts,
    ms: Date.now() - t0,
  });
}

export async function GET() {
  // Helpful state probe — counts current rows in drug_master without
  // exposing data. Public, no auth.
  try {
    const { rows } = await pool.query<{ count: string; high_risk: string }>(
      `SELECT COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE is_high_risk)::text AS high_risk
       FROM drug_master`,
    );
    return NextResponse.json({
      ok: true,
      drug_master_count: parseInt(rows[0]?.count ?? '0', 10),
      high_risk_count: parseInt(rows[0]?.high_risk ?? '0', 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 503 });
  }
}
