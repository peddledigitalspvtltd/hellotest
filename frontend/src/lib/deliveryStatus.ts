export const COMPLETED_DELIVERY_STATUS_VALUES = [
  "qa_done",
  "qa done",
  "done",
  "closed",
  "resolved",
  "accepted",
  "complete",
  "completed"
] as const;

const completedDeliveryStatuses = new Set<string>(COMPLETED_DELIVERY_STATUS_VALUES);

export const normalizeDeliveryStatus = (value?: string | null) => String(value || "").trim().toLowerCase();

export const isDeliveryStatusComplete = (value?: string | null) => completedDeliveryStatuses.has(normalizeDeliveryStatus(value));

export const summarizeDeliveryCompletion = <T extends { status?: string | null }>(stories: readonly T[]) => {
  const completed = stories.reduce((count, story) => count + Number(isDeliveryStatusComplete(story.status)), 0);
  const total = stories.length;
  return {
    completed,
    incomplete: total - completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    total
  };
};
