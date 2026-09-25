import type { RequirementImpactPreviewResponse } from "@hellotest/platform/frontend/src/types";

export function storyImpactGroups(response: RequirementImpactPreviewResponse, showAutomation = true) {
  const unavailable = new Set(response.scope?.unavailable_sources || []);
  const groups = [
    { key: "test_cases" as const, label: "Test cases", permission: "testcase.view" },
    { key: "test_suites" as const, label: "Test suites", permission: "suite.view" },
    { key: "test_runs" as const, label: "Runs", permission: "run.view" },
    ...(showAutomation ? [{ key: "automation_assets" as const, label: "Automation", permission: "automation.view" }] : [])
  ];
  return groups.map(group => ({
    ...group,
    available: !unavailable.has(group.permission),
    items: unavailable.has(group.permission) ? [] : response.impact[group.key] || [],
    total: unavailable.has(group.permission) ? null : response.impact.totals[group.key] ?? (response.impact[group.key] || []).length
  }));
}
