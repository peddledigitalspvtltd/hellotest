import { AUTOMATION_RUNTIMES, getAutomationRuntimeTypes } from "../lib/automationRuntime";

/** One compact execution contract alongside the plan, data and results navigation. */
export function AutomationRuntimeGuide({ steps, fallback }: { steps: Array<{ step_type?: string | null }>; fallback: string }) {
  const types = getAutomationRuntimeTypes(steps, fallback);
  return <details className="automation-runtime-guide">
    <summary><span className="automation-runtime-guide-title">Execution setup</span><span className="automation-runtime-chips">{types.map((type) => <span key={type}>{AUTOMATION_RUNTIMES[type].label}<small>{steps.filter((step) => step.step_type === type).length} steps</small></span>)}</span></summary>
    <div className="automation-runtime-grid">{types.map((type) => {
      const runtime = AUTOMATION_RUNTIMES[type];
      return <article key={type}><header><strong>{runtime.label}</strong><span>{runtime.engine}</span></header><dl><div><dt>Author</dt><dd>{runtime.authoring}</dd></div><div><dt>Target</dt><dd>{runtime.target}</dd></div><div><dt>Evidence</dt><dd>{runtime.evidence}</dd></div></dl><p>{runtime.agent}</p></article>;
    })}</div>
    <p className="automation-runtime-lifecycle">Author the plan → bind objects and data → configure setup and teardown → run in a suite or on its own → inspect results. Agent builds produce code for review; a passing run verifies it.</p>
  </details>;
}
