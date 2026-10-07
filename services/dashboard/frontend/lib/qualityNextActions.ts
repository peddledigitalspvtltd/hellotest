import type { QualityOverview } from "./qualityAnalytics";

export type QualityNextAction = { id: string; to: string; title: string; detail: string; action: string; count?: number; permission?: string };

/** Recommend from observed evidence only. Missing or restricted counts never mean zero. */
export function qualityNextActions(data: QualityOverview): QualityNextAction[] {
  const { inventory, execution, visibility } = data;
  const actions: QualityNextAction[] = [];
  if (visibility.runs && (execution.failed || execution.blocked)) actions.push({ id: "investigate", to: "/executions", title: "nextInvestigate", detail: "nextInvestigateHelp", action: "openRuns", count: (execution.failed || 0) + (execution.blocked || 0) });
  if (visibility.bugs && inventory.open_defects != null && inventory.open_defects > 0) actions.push({ id: "defects", to: "/issues", title: "nextDefects", detail: "nextDefectsHelp", action: "openBugs", count: inventory.open_defects });
  if (visibility.cases && inventory.cases === 0) actions.push({ id: "first-case", to: "/test-cases", title: "nextFirstCase", detail: "nextFirstCaseHelp", action: "openCases", permission: "testcase.create" });
  if (visibility.stories && visibility.cases && inventory.stories != null && inventory.covered_stories != null && inventory.stories > inventory.covered_stories) actions.push({ id: "coverage", to: "/stories", title: "nextCoverage", detail: "nextCoverageHelp", action: "openStories", count: inventory.stories - inventory.covered_stories });
  if (visibility.cases && inventory.cases != null && inventory.designed_cases != null && inventory.cases > inventory.designed_cases) actions.push({ id: "design", to: "/test-cases", title: "nextDesign", detail: "nextDesignHelp", action: "openCases", count: inventory.cases - inventory.designed_cases });
  if (visibility.runs && execution.pending != null && execution.pending > 0) actions.push({ id: "pending", to: "/executions", title: "nextPending", detail: "nextPendingHelp", action: "openRuns", count: execution.pending });
  if (visibility.suites && visibility.cases && inventory.cases != null && inventory.cases > 0 && inventory.suites === 0) actions.push({ id: "suite", to: "/design", title: "nextSuite", detail: "nextSuiteHelp", action: "openSuites", permission: "suite.create" });
  if (visibility.runs && visibility.suites && inventory.suites != null && inventory.suites > 0 && data.recent_runs.length === 0) actions.push({ id: "run", to: "/executions", title: "nextRun", detail: "nextRunHelp", action: "openRuns", permission: "run.create" });
  return actions;
}
