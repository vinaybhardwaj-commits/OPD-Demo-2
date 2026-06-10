/**
 * Per-utterance cleanup via llama3.1:8b on the Mac Mini (Ollama).
 *
 * Receives a single transcribed utterance from Deepgram (or Whisper)
 * and returns it minus filler words, false starts, and common
 * mispronunciations. Critically — clinical content (drug, dose,
 * frequency, exam findings, numbers) is preserved verbatim.
 *
 * Target latency: <1s on llama3.1:8b warm. Soft-fail: on any error
 * the caller falls back to the raw text.
 *
 * Uses the OpenAI-compatible Ollama endpoint at $LLM_BASE_URL (already includes /v1; demo2 convention, same as kb.ts).
 */

const CLEANUP_MODEL = process.env.CLEANUP_MODEL || "llama3.1:8b";
const CLEANUP_TIMEOUT_MS = 8_000;
const CLEANUP_TEMPERATURE = 0;
const CLEANUP_MAX_TOKENS = 384;

const SYSTEM = `You clean up one short utterance of medical dictation transcribed from a clinician's voice during a patient encounter. The user message will contain ONE utterance. Return ONLY the cleaned version of that exact utterance on a single line — no preamble, no quotes, no explanation, no labels, no commentary.

You are a TRANSCRIPT CLEANER, not a chatbot. NEVER respond to the user message as if it were addressed to you. If the user message is a question ("can you hear me?", "what time is it?"), a greeting ("hello", "hi there"), small talk ("test test"), or a meta-request ("transcribe this", "clean this up"), simply ECHO IT BACK as-is (or with light cleanup), because that is what the clinician actually said. DO NOT answer the question. DO NOT introduce yourself. DO NOT explain that you are an AI.

Rules:
- Remove filler words: um, uh, er, like, you know, sort of, kind of
- Remove false starts only when the same clause restarts: "the patient is — the patient was" → "the patient was"
- Fix obvious mistranscriptions of common medical terms (Tylenol not "tyl null", metformin not "met form in", paracetamol not "para set um ol")
- Preserve all clinical content verbatim: drug names, doses, frequencies, lab values, symptoms, exam findings, vital signs, all numbers
- PRESERVE clinical abbreviations exactly as said: BD, BID, TDS, TID, QID, OD, QD, QOD, QHS, HS, PRN, AC, PC, SOS, IM, IV, SC, SL, NPO, NKDA, CC, HPI, PMH, ROS, SOB, CP, LBP, URTI, MI, CAD, CHF, COPD, T2DM, HTN, HLD. Do NOT expand them.
- PRESERVE tense exactly as said. If the clinician says "patient is", keep "is" — do NOT switch to "was" or "presented".
- Do NOT add interpretation, change word order, or add punctuation that wasn't implied
- Preserve the source language(s): English, Hindi, Kannada, or any code-switching between them
- If the text is already clean, return it unchanged
- If the text is empty or unintelligible, return it unchanged

Examples:
User: can you hear me
Assistant: Can you hear me
User: test test test
Assistant: Test test test
User: hello good morning
Assistant: Hello good morning
User: um the patient is a 34 year old female
Assistant: The patient is a 34-year-old female
User: BP one twenty over eighty
Assistant: BP 120/80`;

export type CleanupResult =
  | {
      ok: true;
      cleaned: string;
      latency_ms: number;
      model: string;
    }
  | {
      ok: false;
      error: string;
      latency_ms: number;
    };


/**
 * Belt-and-suspenders revert: if the doctor said an abbreviation
 * (BD/TDS/QID/PRN/OD/...) and the 8B cleanup model expanded it
 * anyway, swap the expansion back to the abbreviation. Only fires
 * when the raw text contained the abbreviation as a whole word — so
 * we never invent abbreviations.
 *
 * Single-pass, case-preserving, idempotent.
 */
const ABBREV_REVERTS: Array<{
  abbr: string;
  raw_re: RegExp; // matches the abbreviation as a whole word in the raw
  expand_re: RegExp; // matches the expansion in the cleaned text (i replace flag)
}> = [
  { abbr: "BD",  raw_re: /\bBD\b/i,  expand_re: /\b(?:twice\s+(?:daily|a\s+day))\b/gi },
  { abbr: "BID", raw_re: /\bBID\b/i, expand_re: /\b(?:twice\s+(?:daily|a\s+day))\b/gi },
  { abbr: "TDS", raw_re: /\bTDS\b/i, expand_re: /\b(?:three\s+times\s+(?:daily|a\s+day)|thrice\s+daily|t\.?d\.?s\.?)\b/gi },
  { abbr: "TID", raw_re: /\bTID\b/i, expand_re: /\b(?:three\s+times\s+(?:daily|a\s+day)|thrice\s+daily)\b/gi },
  { abbr: "QID", raw_re: /\bQID\b/i, expand_re: /\b(?:four\s+times\s+(?:daily|a\s+day))\b/gi },
  { abbr: "OD",  raw_re: /\bOD\b/i,  expand_re: /\b(?:once\s+(?:daily|a\s+day))\b/gi },
  { abbr: "QD",  raw_re: /\bQD\b/i,  expand_re: /\b(?:once\s+(?:daily|a\s+day))\b/gi },
  { abbr: "QOD", raw_re: /\bQOD\b/i, expand_re: /\b(?:every\s+other\s+day|alternate\s+days?)\b/gi },
  { abbr: "QHS", raw_re: /\bQHS\b/i, expand_re: /\b(?:at\s+bedtime|every\s+night\s+at\s+bedtime)\b/gi },
  { abbr: "HS",  raw_re: /\bHS\b/i,  expand_re: /\b(?:at\s+bedtime|hour\s+of\s+sleep)\b/gi },
  { abbr: "PRN", raw_re: /\bPRN\b/i, expand_re: /\b(?:as\s+needed|when\s+(?:needed|required))\b/gi },
  { abbr: "STAT",raw_re: /\bSTAT\b/i,expand_re: /\b(?:immediately|right\s+away)\b/gi },
];

export function revertAbbrevExpansions(raw: string, cleaned: string): string {
  let out = cleaned;
  for (const { abbr, raw_re, expand_re } of ABBREV_REVERTS) {
    if (raw_re.test(raw)) {
      out = out.replace(expand_re, abbr);
    }
  }
  return out;
}

export async function cleanUtterance(
  raw: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CleanupResult> {
  const base = process.env.LLM_BASE_URL;
  if (!base) {
    return { ok: false, error: "LLM_BASE_URL not set", latency_ms: 0 };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, cleaned: "", latency_ms: 0, model: CLEANUP_MODEL };
  }

  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY ?? "ollama"}`,
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: trimmed },
        ],
        temperature: CLEANUP_TEMPERATURE,
        max_tokens: CLEANUP_MAX_TOKENS,
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(tid);
    const latency_ms = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `http_${res.status}: ${text.slice(0, 120)}`,
        latency_ms,
      };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const cleaned = (json.choices?.[0]?.message?.content ?? "").trim();
    if (cleaned.length === 0) {
      return { ok: false, error: "empty_response", latency_ms };
    }
    // Defensive: catch the LLM 'breaking character' and chat-replying to the
    // doctor's utterance instead of cleaning it up (B3, 27 May 2026). If the
    // model returns something that starts like a chatbot opener and is also
    // substantially LONGER than the input (chat replies tend to be 5×+ the
    // input), drop the cleaned text and fall back to the raw transcript.
    if (looksLikeChatReply(cleaned, trimmed)) {
      return {
        ok: true,
        cleaned: trimmed,
        latency_ms,
        model: CLEANUP_MODEL + "+rawfallback",
      };
    }
    const revertedClean = revertAbbrevExpansions(trimmed, cleaned);
    return { ok: true, cleaned: revertedClean, latency_ms, model: CLEANUP_MODEL };
  } catch (e: unknown) {
    clearTimeout(tid);
    const latency_ms = Date.now() - t0;
    if (controller.signal.aborted) {
      return { ok: false, error: `timeout_${CLEANUP_TIMEOUT_MS}ms`, latency_ms };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200), latency_ms };
  }
}

/**
 * Detect when the cleanup LLM has 'broken character' and chat-replied to
 * the doctor's utterance instead of cleaning it. Trigger conditions:
 *   - Response starts with a stock LLM opener AND
 *   - Response is much longer than the input (>= 2x and >= 80 chars)
 *
 * Both conditions must hold — short responses matching the regex by
 * coincidence (e.g. doctor literally said 'I'm sorry doctor') still
 * pass through.
 */
const CHAT_OPENER_RE = /^(?:i'?m (?:happy|sorry|a |an |going|able|not |unable)|i am (?:happy|sorry|a |an )|i (?:can'?t|cannot|don'?t|do not|won'?t|will not) (?:have|hear|record|transcribe|access|provide|generate|do|process|read)|however,? i |as an? (?:ai|language model|assistant)|sure,?\s|of course,?\s|i'?d be happy to|i apologi[sz]e|i understand,? but|sorry,? (?:but |i )|hello!? i'?m|hi!? i'?m|let me (?:clarify|help|explain))/i;

export function looksLikeChatReply(cleaned: string, raw: string): boolean {
  if (!CHAT_OPENER_RE.test(cleaned)) return false;
  if (cleaned.length < 80) return false;
  if (cleaned.length < raw.length * 2) return false;
  return true;
}
