/**
 * GET /api/llm/stage-medians?surface=<LLMSurface>
 *
 * Returns rolling-30d p50 per stage for a given surface, used by the
 * TracePanel to draw a calibrated ETA + progress bar.
 *
 * v6.0 (this version) — returns hard-coded fallbacks per surface
 * because we don't yet have enough llm_traces data to compute real
 * medians.
 *
 * v6.1 — will replace the static return with a Neon query against
 * llm_traces, percentile_cont(0.5) per stage by surface, restricted
 * to status='completed' and started_at > NOW() - INTERVAL '30 days'.
 *
 * Decision Q9: keep these inline in this route file. Single source of
 * truth. Edit + redeploy to tune.
 */

import { NextResponse } from 'next/server';
import type { LLMSurface } from '@/components/llm-trace/TracePanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StageMedians = {
  expanding?: number;
  retrieving?: number;
  drafting: number;
  reviewing?: number;
  revising?: number;
  generating?: number;
  parsing?: number;
  total_p50: number;
  total_p90: number;
};

/**
 * Initial guesses. Refined by V's observation + the staff portal's
 * own calibrated medians. Times in ms.
 *
 * Total_p50/p90 is what the time-only Tier C bar uses; per-stage
 * fields are reserved for v6.1 hybrid surfaces (none in OPD today).
 */
const FALLBACK: Record<LLMSurface, StageMedians> = {
  ddx: {
    expanding: 2_000,
    retrieving: 3_000,
    drafting: 18_000,
    reviewing: 6_000,
    revising: 8_000,
    parsing: 1_500,
    total_p50: 25_000,
    total_p90: 60_000,
  },
  'transcribe-compare': {
    drafting: 4_000,
    total_p50: 6_000,
    total_p90: 15_000,
  },
  'suggest-orders': {
    expanding: 1_500,
    drafting: 7_000,
    parsing: 800,
    total_p50: 9_000,
    total_p90: 22_000,
  },
  'icd10-suggest': {
    drafting: 4_500,
    total_p50: 6_000,
    total_p90: 14_000,
  },
  'rx-coherence': {
    drafting: 12_000,
    total_p50: 15_000,
    total_p90: 30_000,
  },
  'ddi-scan': {
    retrieving: 2_000,
    drafting: 7_000,
    parsing: 1_000,
    total_p50: 10_000,
    total_p90: 20_000,
  },
  'comorbidity-history': {
    expanding: 3_000,
    drafting: 22_000,
    parsing: 2_000,
    total_p50: 28_000,
    total_p90: 55_000,
  },
  'comorbidity-context': {
    drafting: 5_000,
    total_p50: 6_000,
    total_p90: 14_000,
  },
  'comorbidity-states': {
    drafting: 4_000,
    total_p50: 5_000,
    total_p90: 12_000,
  },
  'voice-query': {
    expanding: 2_000,
    drafting: 9_000,
    total_p50: 12_000,
    total_p90: 25_000,
  },
  'patient-summary': {
    expanding: 4_000,
    drafting: 30_000,
    parsing: 2_000,
    total_p50: 40_000,
    total_p90: 80_000,
  },
  'predict-plans': {
    expanding: 1_000,
    drafting: 2_500,
    parsing: 500,
    total_p50: 4_000,
    total_p90: 12_000,
  },
  'diagnostics-interpret': {
    expanding: 3_000,
    drafting: 11_000,
    total_p50: 15_000,
    total_p90: 30_000,
  },
  'comorbidities-interpret': {
    drafting: 8_000,
    total_p50: 9_000,
    total_p90: 20_000,
  },
  'icd10-interpret': {
    drafting: 3_500,
    total_p50: 4_000,
    total_p90: 10_000,
  },
};

const DEFAULT_FALLBACK: StageMedians = {
  drafting: 12_000,
  total_p50: 15_000,
  total_p90: 35_000,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const surface = (url.searchParams.get('surface') ?? '') as LLMSurface;
  const data = FALLBACK[surface] ?? DEFAULT_FALLBACK;
  // v6.0: static. v6.1 will swap for a real Neon percentile query.
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    },
  });
}
