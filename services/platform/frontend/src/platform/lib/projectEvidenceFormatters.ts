import type {Execution} from "../../types";

export const formatProjectTimeAgo = (value?: string | null) => {
  if (!value) {
    return "No run yet";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "Not recorded";
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return "Just now";
  }

  if (absMs < hour) {
    const minutes = Math.round(absMs / minute);
    return `${minutes}m ago`;
  }

  if (absMs < day) {
    const hours = Math.round(absMs / hour);
    return `${hours}h ago`;
  }

  const days = Math.round(absMs / day);
  return `${days}d ago`;
};

export const formatProjectDuration = (execution?: Execution | null) => {
  if (!execution?.started_at || !execution.ended_at) {
    return "Not recorded";
  }

  const startedAt = new Date(execution.started_at).getTime();
  const endedAt = new Date(execution.ended_at).getTime();
  const durationMs = endedAt - startedAt;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Not recorded";
  }

  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

