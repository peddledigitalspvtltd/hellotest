import { MousePointerIcon, SparkIcon, SelectionToggleIcon, PlayIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
export function AutomationWorkflowRail({ active, stepCount, mappedCount, canCapture, canGenerate, canRun, busy, onCapture, onGenerate, onReview, onRun }: {
  active: "capture" | "generate" | "review" | "run"; stepCount: number; mappedCount: number;
  canCapture: boolean; canGenerate: boolean; canRun: boolean; busy: boolean;
  onCapture: () => void; onGenerate: () => void; onReview: () => void; onRun: () => void;
}) {
  return <nav className="automation-workflow-rail" aria-label="Automation lifecycle">
    {[
      { id: "capture", label: "Capture", detail: "Record a flow", icon: <MousePointerIcon />, hidden: !canCapture, onClick: onCapture },
      { id: "generate", label: "Generate", detail: "Build from behavior", icon: <SparkIcon />, hidden: !canGenerate, onClick: onGenerate },
      { id: "review", label: "Review", detail: stepCount ? `${mappedCount} / ${stepCount} mapped` : "Define the plan", icon: <SelectionToggleIcon checked={false} />, onClick: onReview },
      { id: "run", label: "Run", detail: "Validate & execute", icon: <PlayIcon />, hidden: !canRun, onClick: onRun }
    ].filter(stage => !stage.hidden).map(stage => <button aria-current={active === stage.id ? "step" : undefined} disabled={busy} key={stage.id} onClick={stage.onClick} type="button">{stage.icon}<span><strong>{stage.label}</strong><small>{stage.detail}</small></span><span aria-hidden="true">↗</span></button>)}
  </nav>;
}
