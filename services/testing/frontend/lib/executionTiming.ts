export const DEFAULT_DURATION_LABEL = "0s";

export function formatDuration(ms?: number | null, fallback = DEFAULT_DURATION_LABEL) {
  if (ms == null || Number.isNaN(ms)) {
    return fallback;
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
