import type { TestCaseImpactPreviewResponse } from "@hellotest/platform/frontend/src/types";

export function testCaseImpactGroups(response: TestCaseImpactPreviewResponse, showAutomation = true) {
  const unavailable = new Set(response.scope?.unavailable_sources || []);
  const groups = [
    { key: "requirements" as const, label: "Stories", permission: "requirement.view" },
    { key: "test_suites" as const, label: "Test suites", permission: "suite.view" },
    { key: "test_runs" as const, label: "Runs", permission: "run.view" },
    ...(showAutomation ? [
      { key: "automation_assets" as const, label: "Automation", permission: "automation.view" },
      { key: "object_repository_items" as const, label: "Object dependencies", permission: "automation.view" }
    ] : [])
  ];
  return groups.map(group => ({
    ...group,
    available: !unavailable.has(group.permission),
    items: unavailable.has(group.permission) ? [] : response.impact[group.key] || [],
    total: unavailable.has(group.permission) ? null : response.impact.totals[group.key] ?? (response.impact[group.key] || []).length
  }));
}
