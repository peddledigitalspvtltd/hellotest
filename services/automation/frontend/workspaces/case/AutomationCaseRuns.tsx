import { TraceabilityRunHistory } from "@hellotest/manual/frontend/components/TraceabilityRunHistory";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { AutomationRepairReview } from "../../components/AutomationRepairReview";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { useState } from "react";
import type { useAutomationCaseDetailController } from "./useAutomationCaseDetailController";
type Controller = ReturnType<typeof useAutomationCaseDetailController>;
export type AutomationCaseRunsProps = Pick<Controller, "activeCase" | "appTypeId" | "automationLlmIntegrationsQuery" | "canUseAutomationAi" | "featureFlagsQuery" | "projectId" | "session"> & { activeCase: NonNullable<Controller["activeCase"]> };
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
export function AutomationCaseRuns({ activeCase, appTypeId, automationLlmIntegrationsQuery, canUseAutomationAi, featureFlagsQuery, projectId, session }: AutomationCaseRunsProps) {
  const [openedRepair, setOpenedRepair] = useState(false);
  const canRepair = canUseAutomationAi && hasPermission(session, "agentic_workflow.run", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]);
  return <div className="detail-section-panel" role="tabpanel">
    <TraceabilityRunHistory appTypeId={appTypeId || undefined} projectId={projectId} testCaseId={activeCase.id} compact/>
    {canRepair ? <details className="automation-run-profile" onToggle={event => { if (event.currentTarget.open) setOpenedRepair(true); }}>
      <summary>Automation Repair</summary>
      {openedRepair ? <section className="automation-agent-workspace automation-maintenance-workspace" aria-label="Automation Repair">
        <AiLifecycleReview key={activeCase.id} projectId={projectId} appTypeId={appTypeId} inputs={{ test_case_id: activeCase.id }}
          renderAutomationRepair={summary => <AutomationRepairReview summary={summary}/>} features={["automation-repair"]}
          integrations={asArray(automationLlmIntegrationsQuery.data)} title="Automation Repair"/>
      </section> : null}
    </details> : null}
  </div>;
}
