import { IconListDetails, IconLink, IconTargetArrow, IconCpu } from "@tabler/icons-react";
import { AUTOMATION_RUNTIMES } from "../lib/automationRuntime";
import type { TestStepType } from "@hellotest/platform/frontend/src/types";

export function AutomationBuildContext({ stepCount, expectedResultCount, manualCaseCount, repositoryCount, runtimes }: {
  stepCount: number;
  expectedResultCount: number;
  manualCaseCount: number;
  repositoryCount: number;
  runtimes: TestStepType[];
}) {
  return <details className="automation-build-context" aria-label="Context included in the build">
    <summary><span className="automation-context-token"><IconListDetails size={14} />{stepCount} sections</span><span className="automation-context-token"><IconLink size={14} />{manualCaseCount} cases</span><span className="automation-context-token"><IconTargetArrow size={14} />{repositoryCount} objects</span><span className="automation-context-token"><IconCpu size={14} />{runtimes.map(type => AUTOMATION_RUNTIMES[type].label).join(" / ")}</span><span className="automation-context-expand">Context details</span></summary>
    <dl><div><dt>Behavior</dt><dd>{stepCount} saved sections · {expectedResultCount} expected results</dd></div><div><dt>Coverage</dt><dd>{manualCaseCount} linked manual cases and accessible related stories</dd></div><div><dt>Reusable assets</dt><dd>Relevant repository fields, Shared Step Groups and scoped test data</dd></div><div><dt>Execution</dt><dd>{runtimes.map(type => `${AUTOMATION_RUNTIMES[type].label} · ${AUTOMATION_RUNTIMES[type].engine}`).join(" / ")}</dd></div></dl>
  </details>;
}
