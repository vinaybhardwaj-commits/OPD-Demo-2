/**
 * GET  /api/patients/[id]/comorbidities — list + computed tier + extended visibility
 * POST /api/patients/[id]/comorbidities — add ({ items: [{ catalog_id?, code, label, onset_date? }] })
 *
 * Tier algorithm runs server-side per EHS Comorbidity Catalog v1.0
 * Tiering_Algorithm sheet. Doctor's UI surfaces tier as a badge in the
 * patient queue + HistoryPanel.
 *
 * For modifiers we approximate:
 *   - hospitalized last 6 mo  → encounters with disposition='admit' in window
 *   - ED visits last 12 mo    → not directly tracked, returns 0 for v3.9.0
 *   - fall with injury        → not directly tracked, returns false for v3.9.0
 *   - clinician override      → not yet stored, defaults to none for v3.9.0
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { isValidIcd10, lookupByCatalogId, lookupByIcd10Anchor } from '@/lib/comorbidities-catalog';
import { computeTier } from '@/lib/comorbidity-tier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const { id: patientId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(patientId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }

    const [comRes, patRes, admitRes] = await Promise.all([
      pool.query<{
        id: string;
        code: string;
        label: string;
        onset_date: string | null;
        is_resolved: boolean;
        resolved_at: string | null;
        added_by_doctor_id: string | null;
        added_by_name: string | null;
        added_at: string;
        updated_at: string;
        control_state: 'well' | 'partial' | 'uncontrolled' | null;
        severity_state: 'mild' | 'moderate' | 'severe' | null;
        state_updated_at: string | null;
      }>(
        `SELECT pc.id, pc.code, pc.label, pc.onset_date::text AS onset_date,
                pc.is_resolved, pc.resolved_at::text AS resolved_at,
                pc.added_by_doctor_id, d.name AS added_by_name,
                pc.added_at::text AS added_at, pc.updated_at::text AS updated_at,
                pc.control_state, pc.severity_state,
                pc.state_updated_at::text AS state_updated_at
         FROM patient_comorbidities pc
         LEFT JOIN doctors d ON d.id = pc.added_by_doctor_id
         WHERE pc.patient_id = $1
         ORDER BY pc.is_resolved ASC, pc.added_at DESC`,
        [patientId],
      ),
      pool.query<{ age_years: number; sex: string; name: string }>(
        `SELECT age_years, sex, name FROM patients WHERE id = $1 LIMIT 1`,
        [patientId],
      ),
      // T_05: hospitalization in last 6 months — approximate via disposition='admit'
      pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM encounters
         WHERE patient_id = $1 AND disposition = 'admit'
           AND encounter_date >= CURRENT_DATE - INTERVAL '6 months'`,
        [patientId],
      ),
    ]);

    if (patRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'patient_not_found' }, { status: 404 });
    }

    // Annotate each comorbidity with catalog metadata (if matched)
    const annotated = comRes.rows.map((c) => {
      // Try ICD-10 anchor match first; fallback to catalog_id-as-code (unlikely)
      const cat = lookupByIcd10Anchor(c.code) ?? lookupByCatalogId(c.code);
      return {
        ...c,
        catalog_id: cat?.catalog_id ?? null,
        tier: cat?.tier ?? null,
        captured_as: cat?.captured_as ?? null,
        panel_risk_weight: cat?.panel_risk_weight ?? 0,
        triggers_extended_capture: cat?.triggers_extended_capture ?? false,
        condition_name_canonical: cat?.condition_name ?? null,
      };
    });

    // Build tier input from active comorbidities
    const active = annotated.filter((c) => !c.is_resolved);
    const activeCatalogIds = active.map((c) => c.catalog_id).filter((id): id is string => !!id);
    // v3.9.5 — feed control_state='uncontrolled' + severity_state='severe' into tier algorithm
    const uncontrolledCatalogIds = active
      .filter((c) => c.control_state === 'uncontrolled' || c.severity_state === 'severe')
      .map((c) => c.catalog_id)
      .filter((id): id is string => !!id);

    const tierBreakdown = computeTier({
      activeCatalogIds,
      uncontrolledCatalogIds, // v3.9.5
      patient_age_years: patRes.rows[0].age_years,
      hospitalizedLast6Mo: (admitRes.rows[0]?.n ?? 0) > 0,
      edVisitsLast12Mo: 0,         // v3.9.6+
      recentFallWithInjuryLast6Mo: false, // v3.9.6+
      recentEdLast90Days: false,   // v3.9.6+
    });

    return NextResponse.json({
      ok: true,
      patient: patRes.rows[0],
      comorbidities: annotated,
      tier: tierBreakdown,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const { id: patientId } = await ctx.params;
    const body = (await req.json()) as {
      items: Array<{ catalog_id?: string; code: string; label: string; onset_date?: string | null }>;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return NextResponse.json({ ok: false, error: 'empty_items' }, { status: 400 });

    // For items with catalog_id, use catalog's icd10_anchor as the stored code.
    // For free-typed items, validate ICD-10 format.
    const resolved = items.map((it) => {
      if (it.catalog_id) {
        const c = lookupByCatalogId(it.catalog_id);
        if (c) return { code: c.icd10_anchor, label: c.condition_name, onset_date: it.onset_date ?? null };
      }
      return { code: it.code.trim().toUpperCase(), label: (it.label ?? '').trim() || it.code, onset_date: it.onset_date ?? null };
    });

    // Skip the ICD format check for codes that match a catalog entry (catalog allows ranges like 'I05-I08')
    const invalid = resolved.filter((r) => !lookupByIcd10Anchor(r.code) && !isValidIcd10(r.code));
    if (invalid.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'invalid_icd10_format', invalid: invalid.map((r) => r.code) },
        { status: 400 },
      );
    }

    const inserted: { id: string; code: string }[] = [];
    for (const it of resolved) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO patient_comorbidities (patient_id, code, label, onset_date, added_by_doctor_id)
         VALUES ($1, $2, $3, $4::date, $5)
         ON CONFLICT (patient_id, code) DO UPDATE SET
           label = EXCLUDED.label,
           onset_date = COALESCE(EXCLUDED.onset_date, patient_comorbidities.onset_date),
           is_resolved = false,
           resolved_at = NULL,
           updated_at = NOW()
         RETURNING id`,
        [patientId, it.code, it.label, it.onset_date, session.id ?? null],
      );
      inserted.push({ id: rows[0].id, code: it.code });
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
