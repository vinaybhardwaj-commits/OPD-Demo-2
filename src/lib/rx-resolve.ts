/**
 * rx-resolve — RX.1 resolver core, extracted (P4.1) so both the typeahead
 * route (/api/drugs/resolve) and the CDMSS accept smart-routing can turn
 * free text ("start a PPI for 4 weeks", "brufen 400 tds") into a formulary
 * match + parsed sig server-side.
 */
import { pool } from './db';
import { qwenJson, QwenError } from './qwen';

const RESOLVE_MODEL = process.env.RX_RESOLVE_MODEL || 'llama3.1:8b';
const FREQ = new Set(['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']);
const TIMING = new Set(['Before meals', 'After meals', 'Empty stomach', 'At bedtime', 'With water']);

const SYSTEM = `You normalize a doctor's shorthand drug order from an Indian outpatient clinic. Extract the drug and the sig. Brand names are common (Brufen=ibuprofen, Crocin/Dolo=paracetamol, Augmentin=amoxicillin+clavulanic acid, Pan=pantoprazole, etc.) — give the INN generic name. Expand shorthand: od/bd/tds/qid/sos/hs (case-insensitive) are frequencies; "1-0-1"=BD, "1-1-1"=TDS, "1-0-0"/"0-0-1"=OD; "x5d"/"for 5 days"=5 days; "a/f"/"after food"=After meals, "b/f"=Before meals, "hs"=At bedtime.

Return ONLY a JSON object:
{
  "is_drug": boolean,
  "generic_name": string,
  "brand_hint": string,
  "strength": string,
  "frequency": "OD"|"BD"|"TDS"|"QID"|"SOS"|"HS"|"",
  "duration_days": number|null,
  "timing": "Before meals"|"After meals"|"Empty stomach"|"At bedtime"|"With water"|"",
  "corrected_spelling": string
}
Do not invent a sig the doctor didn't state — leave fields empty/null when absent.`;

type LlmParsed = {
  is_drug: boolean;
  generic_name: string;
  brand_hint: string;
  strength: string;
  frequency: string;
  duration_days: number | null;
  timing: string;
  corrected_spelling: string;
};

export type RxMatch = {
  item_code: string;
  brand_name: string;
  generic_name: string;
  dosage_form: string;
  strength: string | null;
  major_grouping: string;
  schedule_dc: string;
  is_high_risk: boolean;
  lasa_alternates: string[];
  score: number;
};

export type RxResolveResult = {
  ok: boolean;
  resolved_name: string;
  is_drug: boolean;
  parsed: { strength: string | null; frequency: string | null; duration_days: number | null; timing: string | null };
  matches: RxMatch[];
  off_formulary: boolean;
  llm_used: boolean;
  llm_error: string | null;
};

async function trigram(terms: string[], limit: number): Promise<RxMatch[]> {
  const clean = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3)));
  if (clean.length === 0) return [];
  const { rows } = await pool.query<RxMatch>(
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

export async function resolveDrugText(qRaw: string): Promise<RxResolveResult> {
  const q = qRaw.trim().slice(0, 200);
  const empty: RxResolveResult = {
    ok: false, resolved_name: q, is_drug: false,
    parsed: { strength: null, frequency: null, duration_days: null, timing: null },
    matches: [], off_formulary: false, llm_used: false, llm_error: null,
  };
  if (q.length < 3) return empty;

  let parsed: LlmParsed | null = null;
  let llmError: string | null = null;
  try {
    const r = await qwenJson<LlmParsed>(SYSTEM, `Order text: ${q}`, {
      model: RESOLVE_MODEL, temperature: 0, timeoutMs: 12_000,
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

  const rawNameOnly = q
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|gm|g|ml|%|iu)\b/gi, ' ')
    .replace(/\b(od|bd|tds|qid|sos|hs|prn|stat|x?\s?\d+\s?(d|days?|weeks?|wks?)|after food|before food|a\/f|b\/f|\d-\d-\d)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = [rawNameOnly, q, parsed?.generic_name ?? '', parsed?.brand_hint ?? '', parsed?.corrected_spelling ?? ''];
  let matches: RxMatch[] = [];
  try {
    matches = await trigram(terms, 12);
  } catch {
    matches = [];
  }
  const brandTyped = (parsed?.brand_hint || rawNameOnly).toLowerCase();
  const strengthDigits = strength ? strength.replace(/[^0-9.]/g, '') : null;
  const boost = (m: RxMatch): number => {
    let b = Number(m.score) || 0;
    const mb = m.brand_name.toLowerCase();
    if (brandTyped && (mb.startsWith(brandTyped) || mb.split(/\s/)[0] === brandTyped.split(/\s/)[0])) b += 0.5;
    if (strengthDigits && m.strength && m.strength.replace(/[^0-9.]/g, '') === strengthDigits) b += 0.3;
    return b;
  };
  matches = matches.sort((a, b) => boost(b) - boost(a)).slice(0, 8);

  const isDrug = parsed ? parsed.is_drug !== false : true;
  return {
    ok: true,
    resolved_name: (parsed?.corrected_spelling || parsed?.generic_name || rawNameOnly || q).trim(),
    is_drug: isDrug,
    parsed: { strength, frequency, duration_days: duration, timing },
    matches,
    off_formulary: isDrug && matches.length === 0,
    llm_used: !!parsed,
    llm_error: llmError,
  };
}
