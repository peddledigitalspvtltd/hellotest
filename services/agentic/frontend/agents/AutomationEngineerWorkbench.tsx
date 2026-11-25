import { IconArrowLeft, IconArrowRight, IconHistory, IconShieldCheck } from "@tabler/icons-react";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import type { WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";

const AutomationWorkspace = capabilityView<{ initialView: "engineer" }>(
  "automation", "AutomationPage", () => import("@hellotest/automation/frontend/pages/AutomationPage"), "Automation Engineer"
);

export function clearAutomationWorkbenchRoute(params: URLSearchParams) {
  for (const key of ["case", "tab", "create", "manual", "editor", "build_method", "agent_activity"]) params.delete(key);
}

export function AutomationEngineerWorkbench({ projectId, appTypeId, reviews, onBack, onOpenReview, formatTimestamp }: {
  projectId: string;
  appTypeId: string;
  reviews: WorkspaceTransaction[];
  onBack: () => void;
  onOpenReview: (id: string) => void;
  formatTimestamp: (value?: string | null) => string;
}) {
  const { can, snapshot } = useCapabilityAccess(projectId);
  const allowed = can("automation.view") && areFeatureFlagsEnabled(snapshot, requiredFeatureFlagsForPath("/automation"));
  return <section className="agent-specialist-workspace" aria-label="Automation Engineer workspace">
    <div className="agent-specialist-heading">
      <div>
        <button aria-label="Back to all AI Agents" className="ghost-button" type="button" onClick={onBack}><IconArrowLeft size={16} /><span>Back</span></button>
        <span className="agent-specialist-mode"><IconShieldCheck size={16} aria-hidden="true" />Browser automation</span>
      </div>
    </div>
    {!projectId || !appTypeId ? <p className="agent-specialist-ready">Select a project and application to build automation.</p>
      : allowed ? <AutomationWorkspace initialView="engineer" />
        : <p className="agent-specialist-ready">Automation workspace access is required to open and build cases.</p>}
    {reviews.length > 0 && <details className="agent-specialist-history">
      <summary>Earlier planning reviews ({reviews.length})</summary>
      {reviews.map(item => <button type="button" key={item.id} onClick={() => onOpenReview(item.id)}>
        <IconHistory size={17} aria-hidden="true" />
        <span><strong>{item.title}</strong><small>{item.status}</small></span>
        <time>{formatTimestamp(item.created_at)}</time><IconArrowRight size={16} />
      </button>)}
    </details>}
  </section>;
}
