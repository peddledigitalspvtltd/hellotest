import type { TestCaseCatalogRow } from "@hellotest/testing/frontend/lib/testCaseCatalog";

const outcomes = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked"
} as const;

function isFinalized(status: string): status is keyof typeof outcomes {
  return Object.prototype.hasOwnProperty.call(outcomes, status);
}

export function automationCatalogEvidence(testCase: TestCaseCatalogRow) {
  const history = testCase.recent_results || [];
  const finalized = history.slice(0, 10).filter(result => isFinalized(result.status));
  const passed = finalized.filter(result => result.status === "passed").length;
  const latest = testCase.latest_finalized_status !== undefined
    ? testCase.latest_finalized_status
    : finalized.find(result => isFinalized(result.status))?.status;
  return {
    finalized, passed,
    outcomeLabel: latest && isFinalized(latest) ? outcomes[latest] : null,
    runCount: testCase.run_count ?? new Set(history.map(result => result.execution_id || result.id)).size,
    passRate: finalized.length ? Math.round(100 * passed / finalized.length) : null
  };
}
