import { admitAutomationBuild } from './admitAutomationBuild';
import type { AutomationCasesActionPorts as ActionPorts } from './automationCasesTypes';

import { automationAgentRequest } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { requireReadyAutomation } from "../../lib/automationReadiness";
import { reviewedAutomationStartUrl } from "../../lib/automationStartUrl";

import { useMutation } from "@tanstack/react-query";

import { getAutomationSchedule } from "../../lib/automationPlan";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { api } from "@hellotest/platform/frontend/src/lib/api";

export function useAutomationCaseBatchBuild(ports:ActionPorts){
const {
    canUseAutomationBuilder,
    canUseAutomationAi,
    appTypeId,
    batchBuildTargetIds,
    projectId,
    inspectSavedPlans,
    batchStartUrl,
    selectedRuntimeType,
    reviewBuildParameters,
    selectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    selectedExecutionDataSetId,
    automatedCases,
    setAgentBuildChanges,
    setAgentBuildRetryIds,
    setAgentBuildOutputIds,
    testCases,
    allowBrowserActions,
    buildBrowserLocation,
    buildPipelineOptions,
    agentScheduledAt,
    buildAgentSelection,
    builderContext,
    agentMission,
    invalidateAutomationData,
    setIsBatchAgentOpen,
    searchParams,
    navigate,
    showError,
    isBatchAgentOpen,
    authoring,
} = ports;
const scheduleAiAutomation = useMutation({
    mutationFn: async () => {
        if (!canUseAutomationBuilder || !canUseAutomationAi) {
            throw new Error("Permission required: automation.build and automation.ai");
        }
        if (!appTypeId || !batchBuildTargetIds.length) {
            throw new Error("Select at least one Automation Case to schedule.");
        }
        const caseIds = [...batchBuildTargetIds];
        const buildProjectId = projectId;
        const savedPlans = await inspectSavedPlans(caseIds, "build");
        const requestedStartUrl = reviewedAutomationStartUrl(batchStartUrl, savedPlans.some(result => result.runtimes.includes("web") || !result.stepCount && ["web", "unified"].includes(selectedRuntimeType)));
        requireReadyAutomation(savedPlans);
        const reviewedParameters = await reviewBuildParameters(caseIds, {
            test_suite_ids_by_case: undefined,
            test_environment_id: selectedExecutionEnvironmentId || undefined,
            test_configuration_id: selectedExecutionConfigurationId || undefined,
            test_data_set_id: selectedExecutionDataSetId || undefined
        }, Object.fromEntries(automatedCases.map(item => [item.id, item.title])));
        if (!reviewedParameters)
            return null;
        setAgentBuildChanges([]);
        setAgentBuildRetryIds([]);
        setAgentBuildOutputIds([]);
        const response = await admitAutomationBuild(authoring,caseIds,getAutomationSchedule(agentScheduledAt),()=>api.testCases.buildAutomationBatch({
            ...reviewedParameters,
            ai_feature: "ai.agentic.automation-engineer",
            allow_browser_actions: allowBrowserActions,
            browser_location: buildBrowserLocation,
            ...buildPipelineOptions,
            scheduled_at: getAutomationSchedule(agentScheduledAt),
            app_type_id: appTypeId,
            test_case_ids: caseIds,
            integration_id: buildAgentSelection.integrationId || undefined,
            agent_context: automationAgentRequest(buildAgentSelection),
            start_url: requestedStartUrl,
            additional_context: [builderContext, agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : "Automate the saved behavior plan and verify its expected results."].filter(Boolean).join("\n\n"),
            test_environment_id: selectedExecutionEnvironmentId || undefined,
            test_configuration_id: selectedExecutionConfigurationId || undefined,
            test_data_set_id: selectedExecutionDataSetId || undefined,
            ai_requested: true
        }));
        return { ...response, caseIds, buildProjectId };
    },
    onSuccess: response => {
        if (!response)
            return;
        invalidateAutomationData();
        setIsBatchAgentOpen(false);
        const next = new URLSearchParams(searchParams);
        next.set("case", response.caseIds[0]);
        next.set("tab", "build");
        next.set("agent_activity", response.transaction_id);
        navigate({ pathname: "/automation", search: next.toString() }, { replace: true });
    },
    onError: (error) => showError(error, "Unable to schedule AI automation.")
});
const batchAgentDialogRef = useDialogFocus<HTMLDivElement>({ active: isBatchAgentOpen, closeDisabled: scheduleAiAutomation.isPending, onClose: () => setIsBatchAgentOpen(false) });
return {scheduleAiAutomation,batchAgentDialogRef};
}

