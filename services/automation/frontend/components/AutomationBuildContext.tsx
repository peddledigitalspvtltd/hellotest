import { AUTOMATION_RUNTIMES } from "../lib/automationRuntime";
import type { TestStepType } from "@hellotest/platform/frontend/src/types";

export function AutomationBuildContext({ stepCount, expectedResultCount, manualCaseCount, repositoryCount, runtimes }: {
  stepCount: number;
  expectedResultCount: number;
  manualCaseCount: number;
  repositoryCount: number;
  runtimes: TestStepType[];
}) {
  return <section className="automation-build-context" aria-label="Context included in the build">
    <div><strong>Included in this build</strong><p>The agent reads the saved plan, chooses the implementation, and returns editable steps.</p></div>
    <dl>
      <div><dt>Behavior</dt><dd>{stepCount} steps · {expectedResultCount} expected results</dd></div>
      <div><dt>Coverage</dt><dd>{manualCaseCount} linked manual cases, plus accessible linked and related stories</dd></div>
      <div><dt>Reusable assets</dt><dd>Relevant objects from {repositoryCount} available repository fields, step groups and scoped test data</dd></div>
      <div><dt>Execution</dt><dd>{runtimes.map((type) => `${AUTOMATION_RUNTIMES[type].label} · ${AUTOMATION_RUNTIMES[type].engine}`).join(" / ")}</dd></div>
    </dl>
    <p>Review the generated plan, then run it to verify the outcome and collect evidence.</p>
  </section>;
}
