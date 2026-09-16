import type { RequirementRelease, RequirementReleaseReadiness } from "../types";
import { summarizeDeliveryCompletion } from "./deliveryStatus";

export type ReleaseStoryMetrics = {
  linked_cases: number;
  executed_cases: number;
  passed_cases: number;
  pass_rate_percent: number | null;
  automated_cases: number;
  automation_coverage_percent: number;
  total_bugs: number;
  open_bugs: number;
  readiness_score: number | null;
};

export type ReleaseCatalogReadiness = Omit<RequirementReleaseReadiness, "readiness_score"> & {
  readiness_score: number | null;
  story_metrics?: Record<string, ReleaseStoryMetrics>;
};

export const releaseStoryCompletion = (release: RequirementRelease) => {
  const stories = [...new Map((release.requirements || []).map((story) => [story.id, story])).values()];
  const total = Math.max(release.requirement_count || 0, stories.length);
  const completed = summarizeDeliveryCompletion(stories).completed;
  return { completed, total, percent: stories.length < total ? null : total ? Math.round(completed / total * 100) : 0 };
};

// A Story shared by two Releases is still one Story in the portfolio.
export const releasePortfolioCompletion = (releases: readonly RequirementRelease[]) => {
  const stories = new Map<string, NonNullable<RequirementRelease["requirements"]>[number]>();
  let complete = true;
  for (const release of releases) {
    if (releaseStoryCompletion(release).percent === null) complete = false;
    for (const story of release.requirements || []) {
      const current = stories.get(story.id);
      const updatedAt = (value?: string) => value ? Date.parse(value) || 0 : 0;
      if (!current || updatedAt(story.updated_at) >= updatedAt(current.updated_at)) stories.set(story.id, story);
    }
  }
  const result = summarizeDeliveryCompletion([...stories.values()]);
  return { ...result, percent: complete ? result.percent : null };
};
