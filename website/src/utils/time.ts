/**
 * Time formatting utilities for playback state display.
 * All formatters are locale-independent to avoid SSR hydration mismatches.
 */

/**
 * Formats seconds into HH:MM:SS or MM:SS display string.
 * Uses integer math only — no Date or Intl objects.
 */
export function formatPlaybackTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');

  if (h > 0) {
    const hh = String(h).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Formats a drift value (seconds) into a human-readable string.
 * e.g. +2.3s ahead, -0.8s behind
 */
export function formatDrift(drift: number): string {
  if (Math.abs(drift) < 0.5) return '±0.0s';
  const sign = drift > 0 ? '+' : '-';
  return `${sign}${Math.abs(drift).toFixed(1)}s`;
}

/**
 * Formats an ISO timestamp into a short time string HH:MM:SS in the viewer's
 * local time zone. Only used for client-rendered values (chat, event log), so
 * there is no SSR hydration concern; UTC getters here made every displayed
 * time wrong by the viewer's UTC offset.
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Returns a relative time label like "just now", "2m ago".
 * Static locale-independent string.
 */
export function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
