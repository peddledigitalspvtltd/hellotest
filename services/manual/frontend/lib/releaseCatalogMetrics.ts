import type { RequirementRelease, RequirementReleaseReadiness } from "@hellotest/platform/frontend/src/types";
import { isDevelopmentStatusComplete, summarizeDeliveryCompletion } from "./deliveryStatus";

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

// Overdue describes the schedule; an overdue active Release remains in progress.
export const releaseLifecycleCounts = (releases: readonly RequirementRelease[]) => ({
  total: releases.length,
  planned: releases.filter((release) => release.persisted_state === "planned").length,
  inProgress: releases.filter((release) => release.persisted_state === "in_progress").length,
  overdue: releases.filter((release) => release.state === "overdue").length
});

/** Classify the complete project catalog once so card counts and their evidence agree. */
export const releasePortfolioHealth = (
  releases: readonly RequirementRelease[],
  readinessByReleaseId: ReadonlyMap<string, ReleaseCatalogReadiness>
) => {
  const scope = [...new Map(releases.map(release => [release.id, release])).values()];
  const overdue = scope.filter(release => release.persisted_state !== "released" && release.state === "overdue");
  const ready = scope.filter(release => {
    const readiness = readinessByReleaseId.get(release.id);
    return Boolean(readiness && readiness.total_stories > 0 && readiness.readiness_state === "ready");
  });
  const atRisk = scope.filter(release => {
    if (release.persisted_state === "released") return false;
    const readiness = readinessByReleaseId.get(release.id);
    return release.state === "overdue" || Boolean(readiness && readiness.total_stories > 0
      && ["at_risk", "not_ready"].includes(readiness.readiness_state));
  });
  const missingEvidence = scope.filter(release => !readinessByReleaseId.has(release.id));
  return { scope, ready, atRisk, overdue, missingEvidence };
};

export const releaseStoryCompletion = (release: RequirementRelease, stage: "qa" | "dev" = "qa") => {
  if (release.story_scope_visible === false || release.requirement_count === null) return { completed: 0, total: 0, percent: null };
  const stories = [...new Map((release.requirements || []).map((story) => [story.id, story])).values()];
  const total = Math.max(release.requirement_count || 0, stories.length);
  const completed = stage === "dev"
    ? stories.filter(story => isDevelopmentStatusComplete(story.status)).length
    : summarizeDeliveryCompletion(stories).completed;
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
