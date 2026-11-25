import { admitAutomationBuild } from "../cases/admitAutomationBuild";
import { automationAgentRequest } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { requireReadyAutomation } from "../../lib/automationReadiness";
import { reviewedAutomationStartUrl } from "../../lib/automationStartUrl";
import { automationBuildRuntimeRequest } from "../../lib/automationBuildPipeline";
import { useMutation } from "@tanstack/react-query";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { getAutomationSchedule } from "../../lib/automationPlan";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
import type { AutomationCaseModel } from './useAutomationCaseModel';
import type { AutomationCaseServices } from './useAutomationCaseServices';
export function useAutomationCaseBuildActions(input: AutomationCaseScope & AutomationCaseState & AutomationCaseModel & AutomationCaseServices) {
    const {authoring, agentBriefScope, canUseAutomationBuilder, canUseAutomationAi, activeCase, startUrl, projectId, agentScheduledAt, flushAutomationBuildParameters, inspectSavedPlans, reviewBuildParameters, selectedParameterSuiteId, selectedExecutionEnvironmentId, selectedExecutionConfigurationId, selectedExecutionDataSetId, rememberAutomationBuildDrafts, reviewBuildSource, appTypeId, buildAgentSelection, allowBrowserActions, buildBrowserLocation, buildPipelineOptions, builderContext, agentMission, automatedSteps, setSearchParams, reviewBuildAccepted, reviewBuildNotice, showSuccess, invalidateAutomationData, showError, agentBuildTracking, reviewBuildCancelled, queryClient, batchBuildTargetIds, batchStartUrl, automatedCases, setIsBatchAgentOpen, selectAutomationCase, setActiveAutomationWorkspaceTab, selectBuildMethod} = input;
    const queueBuild=async(request:Parameters<typeof api.testCases.buildAutomationBatch>[0])=>{
        const ids=request.test_case_ids||[];
        for(const id of ids)await authoring.syncAuthoringState(id);
        return admitAutomationBuild(authoring,ids,request.scheduled_at,()=>api.testCases.buildAutomationBatch(request));
    };
    const buildSingleAutomation = useMutation({
        onMutate: () => {
            return { briefScope: agentBriefScope };
        },
        mutationFn: async (forceReview: boolean) => {
            if (!canUseAutomationBuilder || !canUseAutomationAi) {
                throw new Error("Permission required: automation.build and automation.ai");
            }
            if (!activeCase) {
                throw new Error("Select an automation case first.");
            }
            const caseId = activeCase.id;
            const buildProjectId = projectId;
            const scheduledAt = getAutomationSchedule(agentScheduledAt);
            await flushAutomationBuildParameters([caseId]);
            const savedPlans = await inspectSavedPlans([caseId], "build");
            requireReadyAutomation(savedPlans);
            const runtimes = savedPlans.flatMap(result => result.runtimes);
            const requestedStartUrl = reviewedAutomationStartUrl(startUrl, runtimes.includes("web"));
            const reviewedParameters = await reviewBuildParameters([caseId], {
                test_suite_id: selectedParameterSuiteId || undefined,
                test_environment_id: selectedExecutionEnvironmentId || undefined,
                test_configuration_id: selectedExecutionConfigurationId || undefined,
                test_data_set_id: selectedExecutionDataSetId || undefined
            }, { [caseId]: activeCase.title }, { forceReview });
            if (!reviewedParameters)
                return null;
            rememberAutomationBuildDrafts();
            reviewBuildSource({ changes: [] });
            const response = await queueBuild({
                ...reviewedParameters,
                ai_feature: "ai.agentic.automation-engineer",
                app_type_id: appTypeId, test_case_ids: [caseId],
                integration_id: buildAgentSelection.integrationId || undefined, agent_context: automationAgentRequest(buildAgentSelection),
                ...automationBuildRuntimeRequest(runtimes, buildBrowserLocation, allowBrowserActions, buildPipelineOptions),
                scheduled_at: scheduledAt,
                start_url: requestedStartUrl,
                additional_context: [
                    builderContext,
                    agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : !automatedSteps.length && richTextToPlainText(activeCase.description).trim() ? richTextToPlainText(activeCase.description).trim() : "Automate the saved behavior plan and verify its expected results.",
                ].filter(Boolean).join("\n\n"),
                test_environment_id: selectedExecutionEnvironmentId || undefined,
                test_configuration_id: selectedExecutionConfigurationId || undefined,
                test_data_set_id: selectedExecutionDataSetId || undefined,
                ai_requested: true
            });
            return { ...response, caseId, buildProjectId };
        },
        onSuccess: (response, _forceReview, context) => {
            if (!response) return;
            setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete("agent_activity"); return next; }, { replace: true });
            reviewBuildAccepted({ transactionId: response.transaction_id, projectId: response.buildProjectId, caseIds: [response.caseId], scheduledAt: response.scheduled_at || null, startedAt: Date.now() });
            reviewBuildNotice(`${agentScheduledAt ? "Build scheduled" : "Build queued"} · ${response.transaction_id}`);
            showSuccess(`Automation build ${agentScheduledAt ? "scheduled" : "queued"}. Its output will appear in this case's step plan.`);
            invalidateAutomationData();
        },
        onError: (error, _forceReview, context) => {
            showError(error, "Unable to queue automation.");
        }
    });
    const cancelAutomationBuild = useMutation({
        mutationFn: async (transactionId: string) => {
            if (!canUseAutomationBuilder || !canUseAutomationAi)
                throw new Error("Permission required: automation.build and automation.ai");
            return api.testCases.cancelAutomationBuild(transactionId);
        },
        onSuccess: async (response, transactionId) => {
            if (response.cancelled && agentBuildTracking?.transactionId === transactionId && agentBuildTracking.projectId === projectId) {
                authoring.buildUpdated(transactionId, "cancelled");
                reviewBuildCancelled(transactionId);
                reviewBuildNotice("Build stopped. Saved sections and evidence retained.");
            }
            await Promise.all(["automation-agent-activity", "automation-agent-history", "automation-agent-record"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
            showSuccess(response.cancelled ? "Build stopped. Saved sections and evidence retained." : "This build has already finished. Activity refreshed.");
        },
        onError: error => showError(error, "Unable to stop automation build.")
    });
    const scheduleAiAutomation = useMutation({
        mutationFn: async () => {
            if (!canUseAutomationBuilder || !canUseAutomationAi) {
                throw new Error("Permission required: automation.build and automation.ai");
            }
            if (!appTypeId || !batchBuildTargetIds.length) {
                throw new Error("Select at least one Automation Case to schedule.");
            }
            const caseIds = [...batchBuildTargetIds];
            await flushAutomationBuildParameters(caseIds);
            const buildProjectId = projectId;
            const savedPlans = await inspectSavedPlans(caseIds, "build");
            const runtimes = savedPlans.flatMap(result => result.runtimes);
            const requestedStartUrl = reviewedAutomationStartUrl(batchStartUrl, runtimes.includes("web"));
            requireReadyAutomation(savedPlans);
            const reviewedParameters = await reviewBuildParameters(caseIds, {
                test_suite_ids_by_case: activeCase && selectedParameterSuiteId ? { [activeCase.id]: selectedParameterSuiteId } : undefined,
                test_environment_id: selectedExecutionEnvironmentId || undefined,
                test_configuration_id: selectedExecutionConfigurationId || undefined,
                test_data_set_id: selectedExecutionDataSetId || undefined
            }, Object.fromEntries(automatedCases.map(item => [item.id, item.title])));
            if (!reviewedParameters)
                return null;
            rememberAutomationBuildDrafts();
            reviewBuildSource({ changes: [] });
            const response = await queueBuild({
                ...reviewedParameters,
                ai_feature: "ai.agentic.automation-engineer",
                ...automationBuildRuntimeRequest(runtimes, buildBrowserLocation, allowBrowserActions, buildPipelineOptions),
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
            });
            return { ...response, caseIds, buildProjectId };
        },
        onSuccess: (response) => {
            if (!response)
                return;
            if (response.caseIds[0])
            reviewBuildAccepted({ transactionId: response.transaction_id, projectId: response.buildProjectId, caseIds: response.caseIds, scheduledAt: response.scheduled_at || null, startedAt: Date.now() });
            reviewBuildNotice(`${response.scheduled_at ? "Build scheduled" : "Build queued"} · ${response.transaction_id.slice(0, 8)}`);
            invalidateAutomationData();
            setIsBatchAgentOpen(false);
            if (response.caseIds[0]) {
                selectAutomationCase(response.caseIds[0]);
                setActiveAutomationWorkspaceTab("build");
                selectBuildMethod("agent");
            }
            showSuccess(`AI automation scheduled as ${response.transaction_id.slice(0, 8)} for ${response.caseIds.length} Automation Case${response.caseIds.length === 1 ? "" : "s"}.`);
        },
        onError: (error) => showError(error, "Unable to schedule AI automation.")
    });
    return { buildSingleAutomation, cancelAutomationBuild, scheduleAiAutomation };
}
export type AutomationCaseBuildActions = ReturnType<typeof useAutomationCaseBuildActions>;
