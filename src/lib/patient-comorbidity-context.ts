/**
 * Server-side helper to load a patient's comorbidity context for Qwen
 * prompt injection. Used by every encounter Qwen endpoint in v3.9.1b
 * to make AI features comorbidity-aware.
 *
 * Returns a compact shape suitable for inclusion in a Qwen user message
 * — minimizes token cost while preserving clinical signal.
 *
 * Falls back gracefully: if the patient has no comorbidities yet
 * (cold-start), returns the Qwen-auto-derived problems[] from
 * patient_summaries.summary.problems so the prompt still has SOME
 * context. The 'source' field tells Qwen which it received.
 */
import { pool } from './db';
import { computeTier, type TierBreakdown } from './comorbidity-tier';
import { lookupByIcd10Anchor, lookupByCatalogId } from './comorbidities-catalog';

export type ComorbidityContext = {
  source: 'canonical' | 'fallback_auto_derived' | 'none';
  active: Array<{ code: string; label: string; onset_year: number | null }>;
  resolved_count: number;
  tier: TierBreakdown | null;
  /** Only present when source='fallback_auto_derived'. */
  auto_derived_problems?: string[];
};

export async function loadComorbidityContext(patientId: string): Promise<ComorbidityContext> {
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) {
    return { source: 'none', active: [], resolved_count: 0, tier: null };
  }

  // 1. Patient + canonical comorbidities + admit history (for T_05 modifier).
  const [comRes, patRes, admitRes, summaryRes] = await Promise.all([
    pool.query<{
      code: string;
      label: string;
      onset_date: string | null;
      is_resolved: boolean;
    }>(
      `SELECT code, label, onset_date::text AS onset_date, is_resolved
       FROM patient_comorbidities WHERE patient_id = $1`,
      [patientId],
    ),
    pool.query<{ age_years: number }>(
      `SELECT age_years FROM patients WHERE id = $1 LIMIT 1`,
      [patientId],
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM encounters
       WHERE patient_id = $1 AND disposition = 'admit'
         AND encounter_date >= CURRENT_DATE - INTERVAL '6 months'`,
      [patientId],
    ),
    pool.query<{ summary: { problems?: Array<{ label?: string }> } | null }>(
      `SELECT summary FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
      [patientId],
    ),
  ]);

  const active = comRes.rows.filter((r) => !r.is_resolved);
  const resolved_count = comRes.rows.length - active.length;

  // 2. Canonical path — at least 1 comorbidity.
  if (active.length > 0) {
    const activeCatalogIds = active
      .map((c) => lookupByIcd10Anchor(c.code)?.catalog_id ?? lookupByCatalogId(c.code)?.catalog_id)
      .filter((id): id is string => !!id);

    const tier = computeTier({
      activeCatalogIds,
      uncontrolledCatalogIds: [],
      patient_age_years: patRes.rows[0]?.age_years ?? 0,
      hospitalizedLast6Mo: (admitRes.rows[0]?.n ?? 0) > 0,
      edVisitsLast12Mo: 0,
      recentFallWithInjuryLast6Mo: false,
      recentEdLast90Days: false,
    });

    return {
      source: 'canonical',
      active: active.map((c) => ({
        code: c.code,
        label: c.label,
        onset_year: c.onset_date ? parseInt(c.onset_date.slice(0, 4), 10) : null,
      })),
      resolved_count,
      tier,
    };
  }

  // 3. Fallback — auto-derived problems from patient_summaries.
  const problems = summaryRes.rows[0]?.summary?.problems ?? [];
  if (problems.length > 0) {
    return {
      source: 'fallback_auto_derived',
      active: [],
      resolved_count: 0,
      tier: null,
      auto_derived_problems: problems
        .map((p) => p.label)
        .filter((l): l is string => !!l)
        .slice(0, 10),
    };
  }

  return { source: 'none', active: [], resolved_count: 0, tier: null };
}

/**
 * Compact prompt fragment ready to drop into a Qwen user message JSON.
 * Renders the context as a plain object the LLM can read directly.
 */
export function comorbidityContextForPrompt(ctx: ComorbidityContext) {
  if (ctx.source === 'none') {
    return { comorbidity_context: 'No comorbidities on record. No auto-derived problems available.' };
  }
  if (ctx.source === 'fallback_auto_derived') {
    return {
      comorbidity_context: {
        source: 'auto_derived_from_past_encounters',
        problems: ctx.auto_derived_problems ?? [],
        note: 'These are Qwen-auto-derived from past encounter assessments, not curated by a doctor. Treat as likely but unverified.',
      },
    };
  }
  return {
    comorbidity_context: {
      source: 'canonical_curated',
      active_conditions: ctx.active,
      resolved_count: ctx.resolved_count,
      panel_risk_tier: ctx.tier ? {
        tier: ctx.tier.tier,
        score: ctx.tier.score,
        trigger_reasons: ctx.tier.trigger_reasons,
      } : null,
    },
  };
}
