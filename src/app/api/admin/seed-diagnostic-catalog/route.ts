/**
 * POST /api/admin/seed-diagnostic-catalog
 *
 * Seeds (or re-seeds) `diagnostic_catalog` from the bundled
 * `src/lib/seed/diagnostic-catalog.json` snapshot of EHRC_Latest_21052026.xlsx.
 *
 * Idempotent. ON CONFLICT (service_code):
 *   - display_name / department / sub_department / service_type / modality
 *     / patient_types / is_outsourced / schedulable / multiple_sittings
 *     / description / patient_instructions / standard_codes  → OVERWRITTEN
 *     (truth comes from the rate-card)
 *   - synonyms / tags                                          → PRESERVED
 *     (admin-curated; never trampled by re-seed)
 *
 * Auth: x-migration-secret header must equal MIGRATION_SECRET env var.
 *
 * Designed for v3.1 first-seed AND for future xlsx re-uploads. Returns
 * counts so admin tooling can show 'inserted: X, updated: Y, preserved
 * synonyms on Z rows'.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import seedData from '@/lib/seed/diagnostic-catalog.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type SeedRow = {
  service_code: string;
  display_name: string;
  department: string;
  sub_department: string;
  service_type: string;
  modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
  patient_types: string[];
  is_outsourced: boolean;
  schedulable: boolean;
  multiple_sittings: boolean;
  description: string | null;
  patient_instructions: string | null;
  standard_codes: Record<string, unknown>;
  tags: string[];
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'migration_secret_not_configured' }, { status: 500 });
  }
  if (req.headers.get('x-migration-secret') !== secret) return unauthorized();

  const rows = seedData as SeedRow[];
  const t0 = Date.now();

  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  // Batch in groups of 100 — pg parameter limit is 65535, well clear
  // at our ~14 params per row × 100 = 1400 per batch.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    try {
      // Build multi-row VALUES clause
      const values: unknown[] = [];
      const placeholders: string[] = [];
      chunk.forEach((r, idx) => {
        const base = idx * 14;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}::text[], $${base + 8}, $${base + 9}, $${base + 10}, ` +
          `$${base + 11}, $${base + 12}, $${base + 13}::jsonb, $${base + 14}::text[])`,
        );
        values.push(
          r.service_code, r.display_name, r.department, r.sub_department, r.service_type,
          r.modality, r.patient_types, r.is_outsourced, r.schedulable, r.multiple_sittings,
          r.description, r.patient_instructions, JSON.stringify(r.standard_codes ?? {}), r.tags,
        );
      });

      const sql = `
        INSERT INTO diagnostic_catalog (
          service_code, display_name, department, sub_department, service_type,
          modality, patient_types, is_outsourced, schedulable, multiple_sittings,
          description, patient_instructions, standard_codes, tags
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (service_code) DO UPDATE SET
          display_name         = EXCLUDED.display_name,
          department           = EXCLUDED.department,
          sub_department       = EXCLUDED.sub_department,
          service_type         = EXCLUDED.service_type,
          modality             = EXCLUDED.modality,
          patient_types        = EXCLUDED.patient_types,
          is_outsourced        = EXCLUDED.is_outsourced,
          schedulable          = EXCLUDED.schedulable,
          multiple_sittings    = EXCLUDED.multiple_sittings,
          description          = EXCLUDED.description,
          patient_instructions = EXCLUDED.patient_instructions,
          standard_codes       = EXCLUDED.standard_codes,
          -- preserve admin-edited fields:
          --   synonyms STAYS as diagnostic_catalog.synonyms
          --   tags     STAYS as diagnostic_catalog.tags
          updated_at = NOW()
        RETURNING (xmax = 0) AS was_inserted
      `;

      const { rows: result } = await pool.query<{ was_inserted: boolean }>(sql, values);
      for (const r of result) {
        if (r.was_inserted) inserted++; else updated++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`batch ${i}-${i + chunk.length}: ${msg.slice(0, 200)}`);
      if (errors.length > 10) break;
    }
  }

  const elapsed_ms = Date.now() - t0;

  // Per-modality count after seed
  const { rows: counts } = await pool.query<{ modality: string; n: number }>(
    `SELECT modality, COUNT(*)::int AS n FROM diagnostic_catalog GROUP BY modality ORDER BY n DESC`,
  );

  return NextResponse.json({
    ok: errors.length === 0,
    source: 'EHRC_Latest_21052026.xlsx (bundled snapshot)',
    total_in_seed: rows.length,
    inserted,
    updated,
    elapsed_ms,
    by_modality: Object.fromEntries(counts.map((c) => [c.modality, c.n])),
    errors,
  });
}
