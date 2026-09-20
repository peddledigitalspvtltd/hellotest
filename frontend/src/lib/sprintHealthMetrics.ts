import type { RequirementIterationHealth } from "../types";
import type { QualityMetric } from "../components/QualityMetricStrip";

export function sprintHealthMetrics(health?: RequirementIterationHealth, unavailable = "Sprint health is unavailable.") {
  const labels = ["Stories", "QA Story Completion", "At Risk", "Test Coverage", "Pass Rate", "Slippage", "Defect Density", "Open Critical/High Defects", "Linked Test Cases", "Executed Test Cases", "Total Defects"];
  if (!health) return {
    count: "—" as number | string,
    countLabel: "Stories",
    summary: unavailable,
    metrics: labels.map(label => ({ label, value: "—", tone: "neutral", detail: unavailable } as QualityMetric))
  };

  const exact = new Set(health.exact_fields || []);
  const reasons = (health.completeness?.reasons || []).map(reason => reason.replace(/_/g, " ")).join(", ");
  const summary = health.completeness?.partial
    ? `Metrics cover the filtered Sprint scope. Some evidence is partial${reasons ? ` (${reasons})` : ""}. ≥ indicates an observed minimum; incomplete ratios remain unavailable.`
    : "Metrics cover the visible Stories in this Sprint matching the current catalog filters, across all pages.";
  const number = (field: string, value: number | null | undefined) => exact.has(field) && typeof value === "number" && Number.isFinite(value) ? value : null;
  const count = (field: string, value: number | null | undefined, observed = 0): number | string => number(field, value) ?? (observed > 0 ? `≥${observed}` : "—");
  const stories = number("total_stories", health.total_stories);
  const executed = number("executed_linked_cases", health.executed_linked_cases);
  const defects = number("total_bugs", health.total_bugs);
  const density = stories !== null && stories > 0 && defects !== null ? defects / stories : null;
  const ratio = (field: string, value: number | null, denominator: number | null, empty = "N/A") => denominator === 0 ? empty : denominator === null || number(field, value) === null ? "—" : `${value}%`;
  const evidence = (complete: boolean, text: string, observed: string) => complete ? text : `${observed} ${summary} This metric is not a complete total.`;
  const observed = health.observed;
  const risk = number("at_risk_stories", health.at_risk_stories);
  const slipped = number("slippage_stories", health.slippage_stories);
  const high = number("open_p1_p2_bugs", health.open_p1_p2_bugs);
  const metrics: QualityMetric[] = [
    { label: "Stories", value: count("total_stories", health.total_stories, observed.stories_scanned),
      detail: evidence(stories !== null, `${stories} distinct Stories in the current Sprint scope.`, `${observed.stories_scanned} Stories observed.`),
      methodology: "Counts the complete filtered server scope, independently of loaded Story pages." },
    { label: "QA Story Completion", value: ratio("completed_percent", health.completed_percent, stories), tone: stories ? "info" : "neutral",
      detail: evidence(exact.has("completed_percent"), `${health.completed_stories} of ${health.total_stories} Stories have reached QA Done or Done.`, `${observed.completed_stories} completed Stories observed among ${observed.stories_scanned} scanned Stories.`),
      methodology: "QA-completed Stories ÷ total Sprint Stories × 100. An empty Sprint has no completion percentage." },
    { label: "At Risk", value: count("at_risk_stories", health.at_risk_stories, observed.at_risk_stories), tone: risk === null ? "neutral" : risk ? "danger" : "success",
      detail: evidence(risk !== null, `${risk} distinct Stories meet the current Sprint risk policy.`, `${observed.at_risk_stories} at-risk Stories observed.`),
      methodology: "Stories that slipped, have a blocked workflow status, or are Critical/High priority without linked test coverage. Each Story counts once." },
    { label: "Test Coverage", value: ratio("coverage_percent", health.coverage_percent, stories),
      detail: evidence(exact.has("coverage_percent"), `${health.covered_stories} of ${health.total_stories} Stories have a directly linked visible Test Case.`, `${observed.covered_stories} covered Stories observed among ${observed.stories_scanned} scanned Stories.`),
      methodology: "Stories with linked Test Cases ÷ total Sprint Stories × 100." },
    { label: "Pass Rate", value: ratio("pass_percent", health.pass_percent, executed, "No Runs"),
      detail: evidence(exact.has("pass_percent"), `${health.passed_cases} of ${health.executed_linked_cases} distinct linked Test Cases have a latest terminal outcome of passed.`, typeof observed.passed_cases === "number" && typeof observed.executed_linked_cases === "number" ? `${observed.passed_cases} passed cases observed among ${observed.executed_linked_cases} executed cases.` : "Complete execution evidence is unavailable."),
      methodology: "Passed cases ÷ executed linked cases × 100. No execution evidence produces no pass rate." },
    { label: "Slippage", value: count("slippage_stories", health.slippage_stories, observed.slippage_stories), tone: slipped === null ? "neutral" : slipped ? "danger" : "success",
      detail: evidence(slipped !== null, `${slipped} Stories missed a Dev or QA target before reaching the corresponding Done stage.`, `${observed.slippage_stories || 0} slipped Stories observed.`) },
    { label: "Defect Density", value: stories === 0 ? "N/A" : density === null ? "—" : density.toFixed(2),
      detail: density !== null ? `${defects} distinct linked Defects across ${stories} Stories.` : `${observed.total_bugs} linked Defects and ${observed.stories_scanned} Stories observed. ${stories === 0 ? "An empty Sprint has no density." : summary}`,
      methodology: "Distinct linked Defects ÷ total Sprint Stories. Partial counts are never divided to imply an exact density." },
    { label: "Open Critical/High Defects", value: count("open_p1_p2_bugs", health.open_p1_p2_bugs, observed.open_p1_p2_bugs), tone: high === null ? "neutral" : high ? "danger" : "success",
      detail: evidence(high !== null, `${high} distinct open critical or high-priority Defects affect this Sprint.`, `${observed.open_p1_p2_bugs} open critical/high Defects observed.`) },
    { label: "Linked Test Cases", value: count("linked_cases", health.linked_cases, observed.linked_cases), detail: "Distinct visible Test Cases linked to Stories in this Sprint; a case shared by several Stories counts once." },
    { label: "Executed Test Cases", value: count("executed_linked_cases", health.executed_linked_cases, observed.executed_linked_cases), detail: "Distinct linked Test Cases with a latest terminal outcome in the scoped execution evidence." },
    { label: "Total Defects", value: count("total_bugs", health.total_bugs, observed.total_bugs), detail: "Distinct linked Defects in the current Sprint scope, including resolved Defects." }
  ];
  return { count: metrics[0].value as number | string, countLabel: stories === null && observed.stories_scanned ? "Stories Seen" : "Stories", summary, metrics };
}
