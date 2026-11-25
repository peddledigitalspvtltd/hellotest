import { admitAutomationBuild } from './admitAutomationBuild';
import type { AutomationCasesActionPorts as ActionPorts } from './automationCasesTypes';
import { type ApiAutomationSourceResult } from "../../components/ApiAutomationSourceIntake";

import { automationAgentRequest } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { reviewedAutomationStartUrl } from "../../lib/automationStartUrl";
import { automationBuildRuntimeRequest } from "../../lib/automationBuildPipeline";
import { getAutomationBuildRuntimeTypes } from "../../lib/automationRuntime";

import { useMutation } from "@tanstack/react-query";

import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { emptyAutomationMetadata, type AutomationMetadata } from "../../components/AutomationCaseMetadata";
import { getAutomationSchedule, isAutomationPrecondition, seedAutomationPlan, shouldSeedLinkedAutomationPlan } from "../../lib/automationPlan";
import { automationCaseMappingStatus } from "../../lib/automationStepPersistence";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { normalizeAutomationParameterValues } from "../../lib/automationWorkspaceSupport";

export function useAutomationCaseCreation(ports:ActionPorts, engineerPath?: string){
const {
    automationCreateParameters,
    automationApiSourceParameters,
    automationCreateManualCaseIds,
    showError,
    automationCreateSteps,
    setAutomationCreateSteps,
    setAutomationApiSourceParameters,
    setAutomationApiSourcePrivateNames,
    automationApiSourcePrivateNames,
    setAutomationCreateMetadata,
    setIsCreateAutomationOpen,
    automationCreateTouchedMetadataRef,
    setAutomationCreateManualCaseIds,
    setAutomationCreateStartUrl,
    setSearchParams,
    canCreateAutomationCase,
    appTypeId,
    automationCreateMetadata,
    creationIncompatibleRuntimes,
    automationCreateStartUrl,
    automationCreateStartUrlRequired,
    automationCreationMode,
    canUseAutomationAi,
    canUseRecorder,
    agentMission,
    builderContext,
    importedApiPlanReady,
    agentScheduledAt,
    createSourcesQuery,
    projectId,
    automationModules,
    reviewBuildParameters,
    selectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    buildAgentSelection,
    allowBrowserActions,
    buildBrowserLocation,
    buildPipelineOptions,
    message,
    invalidateAutomationData,
    searchParams,
    navigate,
    isCreateAutomationOpen,
    authoring,
} = ports;
const applyApiSourceDraft = (result: ApiAutomationSourceResult, mode: "append" | "replace") => {
    const existing = { ...automationCreateParameters.values, ...normalizeAutomationParameterValues(automationApiSourceParameters, "t") };
    const conflicts = Object.keys(result.parameter_values).filter(key => (mode === "append" || automationCreateManualCaseIds.length > 0) && Object.prototype.hasOwnProperty.call(existing, `t.${key}`) && existing[`t.${key}`] !== result.parameter_values[key]);
    if (conflicts.length) {
        showError(new Error(`Imported parameter defaults conflict: ${conflicts.join(", ")}. Replace the draft or rename the source variables before adding requests.`), "Review API source parameters");
        return false;
    }
    const incoming = result.steps.map(step => ({ id: crypto.randomUUID(), action: step.action, expected_result: step.expected_result, step_type: "api" as const, precondition: false, api_request: step.api_request }));
    const retained = mode === "replace" ? [] : automationCreateSteps;
    setAutomationCreateSteps([...retained, ...incoming]);
    setAutomationApiSourceParameters(mode === "replace" ? result.parameter_values : { ...automationApiSourceParameters, ...result.parameter_values });
    setAutomationApiSourcePrivateNames(mode === "replace" ? result.private_parameter_names : [...new Set([...automationApiSourcePrivateNames, ...result.private_parameter_names])]);
    setAutomationCreateMetadata(current => ({ ...current, title: current.title.trim() ? current.title : result.title, description: current.description.trim() ? current.description : result.description, automationCaseType: retained.some(step => step.step_type !== "api") ? "unified" : "api" }));
};
const closeCreateAutomation = () => {
    if (createAutomationCase.isPending)
        return;
    setIsCreateAutomationOpen(false);
    setAutomationCreateMetadata(emptyAutomationMetadata);
    setAutomationCreateSteps([]);
    setAutomationApiSourceParameters({});
    setAutomationApiSourcePrivateNames([]);
    automationCreateTouchedMetadataRef.current.clear();
    setAutomationCreateManualCaseIds([]);
    setAutomationCreateStartUrl("");
    setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete("create");
        next.delete("manual");
        next.delete("editor");
        return next;
    }, { replace: true });
};
const updateAutomationCreateMetadata = (change: Partial<AutomationMetadata>) => {
    (Object.keys(change) as Array<keyof AutomationMetadata>).forEach((key) => {
        if (key !== "manualCaseIds")
            automationCreateTouchedMetadataRef.current.add(key);
    });
    setAutomationCreateMetadata((current) => ({ ...current, ...change }));
    if (change.manualCaseIds !== undefined)
        setAutomationCreateManualCaseIds(change.manualCaseIds);
};
const createAutomationCase = useMutation({
    mutationFn: async () => {
        if (!canCreateAutomationCase)
            throw new Error("Automation authoring access is required.");
        if (!appTypeId)
            throw new Error("Select an application before creating automation.");
        const metadata = { ...automationCreateMetadata, manualCaseIds: [...automationCreateManualCaseIds] };
        const title = metadata.title.trim();
        if (!title)
            throw new Error("Enter an automation case name.");
        if (!metadata.automationCaseType)
            throw new Error("Select an automation case type.");
        if (creationIncompatibleRuntimes.length)
            throw new Error(`The selected case type does not support ${creationIncompatibleRuntimes.join(", ")} steps. Choose Unified or change the linked plan.`);
        const requestedStartUrl = reviewedAutomationStartUrl(automationCreateStartUrl, automationCreateStartUrlRequired);
        if (automationCreationMode === "ai" && !canUseAutomationAi)
            throw new Error("Permission required: automation.ai");
        if (automationCreationMode === "record" && !canUseRecorder)
            throw new Error("Permission required: automation.record");
        const authoredSteps = automationCreateSteps.filter((step) => step.action.trim() || step.expected_result.trim());
        if (automationCreationMode === "ai" && !metadata.manualCaseIds.length && !authoredSteps.length && !agentMission.trim() && !builderContext.trim() && !richTextToPlainText(metadata.description).trim()) {
            throw new Error("Describe the requested flow, link a source Test Case or add a step before starting an AI build.");
        }
        const scheduledAt = automationCreationMode === "ai" && !importedApiPlanReady ? getAutomationSchedule(agentScheduledAt) : undefined;
        const sources = await Promise.all(metadata.manualCaseIds.map(async (id) => {
            const preview = createSourcesQuery.data?.find((source) => source.testCase.id === id);
            if (preview)
                return preview;
            const [testCase, steps] = await Promise.all([
                api.testCases.get(id, { project_id: projectId }),
                api.testSteps.list({ test_case_id: id })
            ]);
            return { testCase, steps };
        }));
        const sourceCases = sources.map((source) => source.testCase);
        const source = sourceCases[0];
        const preconditionGroupId = `automation-preconditions-${crypto.randomUUID()}`;
        const includeLinkedBehavior = shouldSeedLinkedAutomationPlan(metadata.automationCaseType, automationCreationMode, importedApiPlanReady);
        const steps = [
            ...(includeLinkedBehavior ? seedAutomationPlan(sources, () => `automation-${crypto.randomUUID()}`) : []),
            ...authoredSteps.map((step) => ({
                action: step.action,
                expected_result: step.expected_result,
                step_type: step.step_type,
                automation_code: undefined,
                api_request: step.step_type === "api" ? step.api_request || undefined : undefined,
                group_id: step.precondition ? preconditionGroupId : undefined,
                group_name: step.precondition ? "Preconditions" : undefined,
                group_kind: step.precondition ? "local" as const : undefined,
                reusable_group_id: undefined
            }))
        ].sort((left, right) => Number(isAutomationPrecondition(right)) - Number(isAutomationPrecondition(left)))
            .map((step, index) => ({ ...step, step_order: index + 1 }));
        const result = await api.testCases.create({
            app_type_id: appTypeId,
            title,
            description: metadata.description,
            external_references: [...new Set(sourceCases.flatMap((item) => item.external_references || []))],
            labels: [...new Set(sourceCases.flatMap((item) => item.labels || []))],
            parameter_values: automationApiSourceParameters,
            automated: "yes",
            automation_case_type: metadata.automationCaseType,
            automation_status: automationCaseMappingStatus(steps),
            automation_start_url: requestedStartUrl || null,
            manual_test_case_id: metadata.manualCaseIds[0] || null,
            manual_test_case_ids: metadata.manualCaseIds,
            execution_hooks: sourceCases.flatMap(item => item.execution_hooks || []).filter((hook, index, hooks) => hooks.findIndex(other => other.phase === hook.phase && other.target_kind === hook.target_kind && other.target_id === hook.target_id) === index).map((hook, index) => ({ ...hook, id: `source-hook-${index + 1}` })),
            test_case_type: source?.test_case_type || "functional",
            test_data_set_ids: metadata.dataSetId ? [metadata.dataSetId] : [],
            test_data_options: { ...source?.test_data_options, ...(selectedExecutionEnvironmentId ? { test_environment_id: selectedExecutionEnvironmentId } : {}), override_shared_sections: source?.test_data_options?.override_shared_steps !== false, shared_data_kind: "sections" as const, private_parameter_names: [...new Set([...(source?.test_data_options?.private_parameter_names || []), ...automationApiSourcePrivateNames])] },
            priority: Number(metadata.priority) || 3,
            status: metadata.status,
            requirement_id: metadata.requirementIds[0],
            requirement_ids: metadata.requirementIds,
            suite_id: metadata.suiteIds[0],
            suite_ids: metadata.suiteIds,
            steps
        });
        // The case is durable now. Follow-up failures must return this ID so a
        // retry opens the saved case instead of creating a duplicate.
        const followUpFailures: string[] = [];
        const moduleResults = await Promise.allSettled(metadata.moduleIds.map((moduleId) => api.testCaseModules.assignCases(moduleId, [result.id], true)));
        moduleResults.forEach((assignment, index) => {
            if (assignment.status === "rejected") {
                const name = automationModules.find((module) => module.id === metadata.moduleIds[index])?.name || metadata.moduleIds[index];
                followUpFailures.push(`Module ${name} could not be linked.`);
            }
        });
        let transactionId = "";
        let buildCancelled = false;
        if (automationCreationMode === "ai" && !importedApiPlanReady) {
            try {
                const reviewedParameters = await reviewBuildParameters([result.id], {
                    test_suite_id: metadata.suiteIds.length === 1 ? metadata.suiteIds[0] : undefined,
                    test_environment_id: selectedExecutionEnvironmentId || undefined,
                    test_configuration_id: selectedExecutionConfigurationId || undefined,
                    test_data_set_id: metadata.dataSetId || undefined
                }, { [result.id]: title });
                if (!reviewedParameters)
                    buildCancelled = true;
                else {
                    const queued = await admitAutomationBuild(authoring,[result.id],scheduledAt,()=>api.testCases.buildAutomationBatch({
                        ...reviewedParameters,
                        ai_feature: "ai.agentic.automation-engineer",
                        app_type_id: appTypeId,
                        test_case_ids: [result.id],
                        integration_id: buildAgentSelection.integrationId || undefined,
                        agent_context: automationAgentRequest(buildAgentSelection),
                        ...automationBuildRuntimeRequest(getAutomationBuildRuntimeTypes(steps, metadata.automationCaseType), buildBrowserLocation, allowBrowserActions, buildPipelineOptions),
                        scheduled_at: scheduledAt,
                        start_url: requestedStartUrl,
                        additional_context: [
                            agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : !steps.length && richTextToPlainText(metadata.description).trim() ? richTextToPlainText(metadata.description).trim() : "Automate the saved behavior plan and verify its expected results.",
                            builderContext.trim(),
                        ].filter(Boolean).join("\n\n"),
                        test_environment_id: selectedExecutionEnvironmentId || undefined,
                        test_configuration_id: selectedExecutionConfigurationId || undefined,
                        test_data_set_id: metadata.dataSetId || undefined,
                        ai_requested: true
                    }));
                    transactionId = queued.transaction_id;
                }
            }
            catch (error) {
                followUpFailures.push(`AI build was not queued. ${error instanceof Error ? error.message : "Retry from this case's Build tab."}`);
            }
        }
        return { id: result.id, title, transactionId, mode: importedApiPlanReady ? "blank" as const : automationCreationMode, scheduledAt, followUpFailures, buildCancelled, startUrl: requestedStartUrl || "" };
    },
    onSuccess: async ({ id, title, transactionId, mode, scheduledAt, followUpFailures, buildCancelled }) => {
        setIsCreateAutomationOpen(false);
        invalidateAutomationData();
        const tone = followUpFailures.length ? "error" : buildCancelled ? "info" : "success";
        const message = followUpFailures.length ? title + " was created and its plan was saved. " + followUpFailures.join(" ") + " Continue in the saved case to retry." : buildCancelled ? title + " was created. The build was cancelled before it started." : mode === "ai" ? title + " created and AI build " + (scheduledAt ? "scheduled" : "queued") + "." : mode === "record" ? title + " created. The recorder is ready in Build." : title + " created with its step plan.";
        const next = new URLSearchParams(searchParams);
        next.delete("create");
        next.delete("manual");
        next.delete("editor");
        next.delete("repository");
        next.delete("agent_activity");
        next.set("case", id);
        next.set("tab", mode === "blank" && !engineerPath ? "steps" : "build");
        if (mode === "record")
            next.set("build_method", "record");
        else
            next.delete("build_method");
        if (transactionId)
            next.set("agent_activity", transactionId);
        navigate({ pathname: engineerPath || "/automation", search: next.toString() }, { replace: true, state: { automationNotice: { tone, message } } });
    },
    onError: (error) => showError(error, "Unable to create automation case.")
});
const createAutomationDialogRef = useDialogFocus<HTMLDivElement>({
    active: isCreateAutomationOpen,
    closeDisabled: createAutomationCase.isPending,
    onClose: closeCreateAutomation
});
return {applyApiSourceDraft,closeCreateAutomation,updateAutomationCreateMetadata,createAutomationCase,createAutomationDialogRef};
}

