import type { Requirement } from "@hellotest/platform/frontend/src/types";
import { isDeliveryStatusComplete } from "./deliveryStatus";

const STORY_STATUS_RANK: Record<string, number> = {
  open: 0,
  in_progress: 2,
  ready: 4,
  blocked: 2,
  dev_ready: 1,
  dev_in_progress: 2,
  dev_blocked: 2,
  dev_done: 3,
  qa_ready: 4,
  qa_in_progress: 5,
  qa_blocked: 5,
  qa_done: 6,
  done: 7
};

export const storyStatusRank = (value?: string | null) => (isDeliveryStatusComplete(value) ? 7 : STORY_STATUS_RANK[String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? 0);
export const isStoryAssignedToSprint = (story?: Requirement | null) => Boolean(
  story?.iteration_id || story?.sprint_id || String(story?.sprint || "").trim()
);
export const deriveStoryDeliveryRisk = (story: Requirement, now = Date.now()) => {
  const today = new Date(now).toISOString().slice(0, 10);
  const missed = (value?: string | null) => {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) < today;
  };
  const devSlipped = missed(story.dev_completion_target_date) && storyStatusRank(story.status) < storyStatusRank("dev_done");
  const qaSlipped = missed(story.qa_completion_target_date) && storyStatusRank(story.status) < storyStatusRank("qa_done");
  return { isRisk: story.catalog_metrics?.slipped ?? (devSlipped || qaSlipped), devSlipped, qaSlipped };
};

