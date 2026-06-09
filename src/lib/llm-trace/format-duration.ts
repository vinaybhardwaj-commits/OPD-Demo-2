/**
 * v1.7 Sprint G — pipeline-tracker time formatter (lock #24).
 * <60s: 1-decimal seconds (e.g. "4.2s", "47.5s")
 * ≥60s: min:sec (e.g. "1:21", "2:14")
 * null/undefined → "—"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}
