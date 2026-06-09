'use client';

/**
 * <ExtractIcd10FromAssessmentButton /> — v3.8 explicit "Extract ICD-10
 * codes from the assessment prose" button.
 *
 * Doctor writes prose like "HTN + T2DM, both well-controlled" in the
 * assessment textarea. Clicking this button sends the prose to
 * /api/icd10/interpret with encounter context, renders extracted codes
 * below the button. Each clickable to add as a chip.
 */
import { useState } from 'react';

type Suggestion = { code: string; label: string; rationale: string; confidence: number };

export function ExtractIcd10FromAssessmentButton({
  encounterId,
  assessmentText,
  alreadyAddedCodes,
  onAdd,
}: {
  encounterId: string;
  assessmentText: string;
  alreadyAddedCodes: Set<string>;
  onAdd: (item: { code: string; label: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const extract = async () => {
    if (assessmentText.trim().length < 3) return;
    setLoading(true);
    setSuggestions(null);
    setErr(null);
    console.log('[Extract ICD-10] submitting', { encounter_id: encounterId, len: assessmentText.trim().length });
    try {
      const res = await fetch('/api/icd10/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ free_text: assessmentText.trim(), encounter_id: encounterId }),
        credentials: 'same-origin',
      });
      const text = await res.text();
      let json: { ok?: boolean; suggestions?: Suggestion[]; latency_ms?: number; error?: string };
      try { json = JSON.parse(text); }
      catch { json = { ok: false, error: 'non-json response: ' + text.slice(0, 100) }; }
      console.log('[Extract ICD-10] response', { status: res.status, ok: json.ok, count: json.suggestions?.length, error: json.error });
      if (!res.ok) {
        setErr(`Server returned ${res.status}: ${json.error ?? 'unknown'}`);
      } else if (!json.ok) {
        setErr(`AI error: ${json.error ?? 'unknown'}`);
      } else if (!Array.isArray(json.suggestions)) {
        setErr('Bad response shape — no suggestions array');
      } else {
        setSuggestions(json.suggestions);
        setLatencyMs(json.latency_ms ?? null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Extract ICD-10] fetch failed', msg);
      setErr(`Network error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* v4.0.6 — compact sparkle button (was full-text button). */}
      <button
        type="button"
        onClick={extract}
        disabled={loading || assessmentText.trim().length < 3}
        title="Read the assessment text and extract ICD-10 codes"
        className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
      >
        {loading ? (
          <>
            <span>⟳</span>
            <span>Reading…</span>
          </>
        ) : (
          <>
            <span aria-hidden>✨</span>
            <span>Extract codes</span>
          </>
        )}
      </button>

      {suggestions && suggestions.length > 0 && (
        // v4.0.6 — flat chip wall, no bordered card.
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
            <span aria-hidden>✨</span>
            Extracted from assessment
          </span>
          {latencyMs !== null && (
            <span className="text-[10px] text-even-ink-400">
              {suggestions.length} code{suggestions.length === 1 ? '' : 's'} · {(latencyMs / 1000).toFixed(1)}s
            </span>
          )}
          {suggestions.map((s) => {
            const added = alreadyAddedCodes.has(s.code);
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => !added && onAdd({ code: s.code, label: s.label })}
                disabled={added}
                title={`${s.label}${s.rationale ? ' · ' + s.rationale : ''} · ${(s.confidence * 100).toFixed(0)}%`}
                className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                  added
                    ? 'cursor-default bg-even-ink-50 text-even-ink-400 ring-1 ring-even-ink-200'
                    : 'bg-violet-50 text-violet-900 ring-1 ring-violet-300 hover:ring-violet-500'
                }`}
              >
                <span>{added ? '✓' : '+'}</span>
                <span className="font-mono font-semibold">{s.code}</span>
                <span className="truncate max-w-[14rem] text-even-ink-600">{s.label}</span>
                <span className="text-[10px] text-violet-700">{(s.confidence * 100).toFixed(0)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {suggestions && suggestions.length === 0 && !loading && (
        <p className="text-[11px] italic text-even-ink-400">
          Couldn&apos;t extract codes from this assessment. Try writing more, or add via the search above.
        </p>
      )}

      {err && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-rose-200">
          {err}
        </p>
      )}
    </div>
  );
}
