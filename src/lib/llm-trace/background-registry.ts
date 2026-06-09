/**
 * src/lib/llm-trace/background-registry.ts
 *
 * In-memory registry of currently-running background LLM fires.
 * Used by BackgroundTraceToaster (Q4) to render compact toasts for
 * the patient/encounter the doctor is currently viewing.
 *
 * Lifecycle:
 *   - Any client-side async caller invoking a background route
 *     pushes a BackgroundTrace into the registry at request start.
 *   - The caller updates the trace's events array as NDJSON arrives.
 *   - On done / error, the trace lingers for 3s (long enough for the
 *     doctor to see the result land) then is removed.
 *
 * Pure client-side state. No localStorage — refreshes clear the
 * registry. Server-side llm_traces row is the source of audit truth;
 * this registry is purely for ephemeral UI.
 */

import type { TraceEvent } from '@/components/llm-trace/TracePanel';

export type BackgroundTrace = {
  id: string;
  surface: string;
  encounter_id?: string | null;
  patient_id?: string | null;
  events: TraceEvent[];
  totalMs?: number;
  startedAt: number;
};

type Listener = (traces: BackgroundTrace[]) => void;

let traces: BackgroundTrace[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...traces];
  for (const fn of listeners) fn(snapshot);
}

export function subscribeBackgroundTraces(fn: Listener): () => void {
  listeners.add(fn);
  fn([...traces]);
  return () => {
    listeners.delete(fn);
  };
}

export function pushBackgroundTrace(t: BackgroundTrace): void {
  traces = [...traces, t];
  emit();
}

export function updateBackgroundTrace(id: string, mut: (t: BackgroundTrace) => BackgroundTrace): void {
  traces = traces.map((t) => (t.id === id ? mut(t) : t));
  emit();
}

export function completeBackgroundTrace(id: string, totalMs: number): void {
  updateBackgroundTrace(id, (t) => ({ ...t, totalMs }));
  // Linger 3s then drop so the doctor sees the green checkmark land.
  setTimeout(() => {
    traces = traces.filter((t) => t.id !== id);
    emit();
  }, 3_000);
}

export function dropBackgroundTrace(id: string): void {
  traces = traces.filter((t) => t.id !== id);
  emit();
}
