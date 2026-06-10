/**
 * POST /api/drugs/resolve — RX.1 smart drug resolution.
 *
 * Turns vague free text ("brufen 400 tds 5 days", "ibuprofin", "augmentin
 * bd") into formulary matches + a parsed sig. Two stages:
 *   1. llama3.1:8b (JSON, fast) normalizes the text → generic name, brand
 *      hint, strength + frequency/duration/timing (Indian OPD shorthand:
 *      OD/BD/TDS/QID/SOS/HS, "x5d", "1-0-1"…).
 *   2. Trigram search over drug_master on (raw query ∪ generic ∪ brand),
 *      ranked by best similarity — same indexes as /api/drugs/search.
 *
 * Response: { ok, resolved_name, is_drug, parsed: {strength, frequency,
 * duration_days, timing}, matches: DrugSearchResult[], off_formulary }.
 * off_formulary = the model is confident it's a real drug but nothing in
 * the formulary matches (UI offers a flagged add-as-written — RX.1 lock).
 *
 * Soft behaviour: if the LLM is down, falls back to trigram on the raw
 * text alone (still better than nothing); never 5xxs for LLM reasons.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RESOLVE_MODEL = process.env.RX_RESOLVE_MODEL || 'llama3.1:8b';
const FREQ = new Set(['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']);
const TIMING = new Set(['Before meals', 'After meals', 'Empty stomach', 'At bedtime', 'With water']);

const SYSTEM = `You normalize a doctor's shorthand drug order from an Indian outpatient clinic. Extract the drug and the sig. Brand names are common (Brufen=ibuprofen, Crocin/Dolo=paracetamol, Augmentin=amoxicillin+clavulanic acid, Pan=pantoprazole, etc.) — give the INN generic name. Expand shorthand: od/bd/tds/qid/sos/hs (case-insensitive) are frequencies; "1-0-1"=BD, "1-1-1"=TDS, "1-0-0"/"0-0-1"=OD; "x5d"/"for 5 days"=5 days; "a/f"/"after food"=After meals, "b/f"=Before meals, "hs"=At bedtime.

Return ONLY a JSON object:
{
  "is_drug": boolean,              // false if the text is not a medication order at all
  "generic_name": string,          // INN generic, lowercase; "" if unknown
  "brand_hint": string,            // brand name as written/corrected; "" if none
  "strength": string,              // e.g. "400MG", "" if not stated
  "frequency": "OD"|"BD"|"TDS"|"QID"|"SOS"|"HS"|"",
  "duration_days": number|null,
  "timing": "Before meals"|"After meals"|"Empty stomach"|"At bedtime"|"With water"|"",
  "corrected_spelling": string     // the drug name with spelling fixed, as best display text
}
Do not invent a sig the doctor didn't state — leave fields empty/null when absent.`;

type Parsed = {
  is_drug: boolean;
  generic_name: string;
  brand_hint: string;
  strength: string;
  frequency: string;
  duration_days: number | null;
  timing: string;
  corrected_spelling: string;
};

async function trigram(terms: string[], limit: number) {
  const clean = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3)));
  if (clean.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT item_code, brand_name, generic_name, dosage_form, strength,
            major_grouping, schedule_dc::text AS schedule_dc, is_high_risk,
            COALESCE(lasa_alternates, '{}') AS lasa_alternates,
            (SELECT MAX(GREATEST(similarity(lower(brand_name), t), similarity(lower(generic_name), t)))
               FROM unnest($1::text[]) AS t) AS score
       FROM drug_master
      WHERE EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS t
         WHERE lower(brand_name) % t OR lower(generic_name) % t
            OR lower(brand_name) LIKE t || '%' OR lower(generic_name) LIKE t || '%')
      ORDER BY score DESC NULLS LAST, brand_name ASC
      LIMIT $2`,
    [clean, limit],
  );
  return rows;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = (body.q ?? '').trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ ok: false, error: 'query_too_short' }, { status: 400 });

  // Stage 1 — LLM normalize (soft: tunnel down → raw trigram only).
  let parsed: Parsed | null = null;
  let llmError: string | null = null;
  try {
    const r = await qwenJson<Parsed>(SYSTEM, `Order text: ${q}`, {
      model: RESOLVE_MODEL,
      temperature: 0,
      timeoutMs: 12_000,
    });
    parsed = r.json;
  } catch (e) {
    llmError = e instanceof QwenError ? `${e.kind}: ${e.message}`.slice(0, 120) : String(e).slice(0, 120);
  }

  const frequency = parsed && FREQ.has((parsed.frequency || '').toUpperCase()) ? (parsed.frequency || '').toUpperCase() : null;
  const timing = parsed && TIMING.has(parsed.timing || '') ? parsed.timing : null;
  const duration = parsed && typeof parsed.duration_days === 'number' && parsed.duration_days > 0 && parsed.duration_days <= 365
    ? Math.round(parsed.duration_days) : null;
  const strength = parsed && typeof parsed.strength === 'string' && /\d/.test(parsed.strength)
    ? parsed.strength.toUpperCase().replace(/\s+/g, '').slice(0, 20) : null;

  // Stage 2 — trigram over raw text + LLM-normalized names. Strip sig-ish
  // tokens from the raw query so "brufen 400 tds 5 days" still matches.
  const rawNameOnly = q
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|gm|g|ml|%|iu)\b/gi, ' ')
    .replace(/\b(od|bd|tds|qid|sos|hs|prn|stat|x?\s?\d+\s?(d|days?|weeks?|wks?)|after food|before food|a\/f|b\/f|\d-\d-\d)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = [rawNameOnly, q, parsed?.generic_name ?? '', parsed?.brand_hint ?? '', parsed?.corrected_spelling ?? ''];
  type Match = { brand_name: string; strength: string | null; score: number };
  let matches: Match[] = [];
  try {
    matches = (await trigram(terms, 12)) as Match[];
  } catch {
    matches = [];
  }
  // Re-rank: the brand the doctor actually TYPED beats alphabetical
  // similarity-ties (dolo → Dolo, not Calpol), and a strength match
  // ("650") floats the right SKU to the top.
  const brandTyped = (parsed?.brand_hint || rawNameOnly).toLowerCase();
  const strengthDigits = strength ? strength.replace(/[^0-9.]/g, '') : null;
  const boost = (m: Match): number => {
    let b = Number(m.score) || 0;
    const mb = m.brand_name.toLowerCase();
    if (brandTyped && (mb.startsWith(brandTyped) || mb.split(/\s/)[0] === brandTyped.split(/\s/)[0])) b += 0.5;
    if (strengthDigits && m.strength && m.strength.replace(/[^0-9.]/g, '') === strengthDigits) b += 0.3;
    return b;
  };
  matches = matches.sort((a, b) => boost(b) - boost(a)).slice(0, 8);

  const isDrug = parsed ? parsed.is_drug !== false : true;
  const resolvedName =
    (parsed?.corrected_spelling || parsed?.generic_name || rawNameOnly || q).trim();

  return NextResponse.json({
    ok: true,
    resolved_name: resolvedName,
    is_drug: isDrug,
    parsed: { strength, frequency, duration_days: duration, timing },
    matches,
    off_formulary: isDrug && matches.length === 0,
    llm_used: !!parsed,
    llm_error: llmError,
  });
}
