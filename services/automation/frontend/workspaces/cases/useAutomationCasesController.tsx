import { automationBuildPipelineRequest } from "../../lib/automationBuildPipeline";
import { automationAgentSelection } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { useAutomationBuildParameters } from "../../hooks/useAutomationBuildParameters";
import { useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useRepositoryInspectAgent } from "@hellotest/automation/frontend/hooks/useRepositoryInspectAgent";
import { emptyAutomationMetadata, type AutomationMetadata } from "../../components/AutomationCaseMetadata";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { findByRoutableId, getRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import { useAutomationCasesAccess } from './useAutomationCasesAccess';
import { useAutomationCasesState } from './useAutomationCasesState';
import { useAutomationCasesQueries } from './useAutomationCasesQueries';
import { useAutomationCasesModel } from './useAutomationCasesModel';
import { useAutomationCaseCreation } from './useAutomationCaseCreation';
import { useAutomationCaseBatchBuild } from './useAutomationCaseBatchBuild';
import { useAutomationCaseRuns } from './useAutomationCaseRuns';
import { useAutomationCaseColumns } from './useAutomationCaseColumns';
export function useAutomationCasesController({projectId,appTypeId,setAppTypeId,engineer=false}:{projectId:string;appTypeId:string;setAppTypeId:(id:string)=>void;engineer?:boolean}){
const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
const navigate = useNavigate();
const location = useLocation();
const [searchParams, setSearchParams] = useSearchParams();
const queryClient = useQueryClient();
const access=useAutomationCasesAccess(projectId);const {
    session,
    featureFlagsQuery,
    canViewAutomationCode,
    canUseAutomationBuilder,
    canCreateAutomationDraft,
    canUseAutomationAi,
    canUseRecorder,
    canInspectRepository,
    canRunLocalAutomation,
    canRunRemoteAutomation,
} = access;
const state=useAutomationCasesState();const {
    consumedAutomationCreateRouteRef,
    automationCatalogViewMode,
    setAutomationCatalogViewMode,
    catalogFilters, filterCatalog,
    selectedAutomationCaseIds,
    setSelectedAutomationCaseIds,
    isCreateAutomationOpen,
    setIsCreateAutomationOpen,
    requestedCreationMode,
    setAutomationCreationMode,
    automationCreateManualCaseIds,
    setAutomationCreateManualCaseIds,
    agentMission,
    setAgentMission,
    automationCreateMetadata,
    setAutomationCreateMetadata,
    automationCreateSteps,
    setAutomationCreateSteps,
    automationCreateTouchedMetadataRef,
    buildAgentSelection,
    setBuildAgentSelection,
    isExecutionContextOpen,
    setIsExecutionContextOpen,
    agentScheduledAt,
    setAgentScheduledAt,
    runReviewRequest,
    setRunReviewRequest,
    pendingRemoteRun,
    setPendingRemoteRun,
    runReviewError,
    setRunReviewError,
    batchBuildTargetIds,
    setBatchBuildTargetIds,
    isBatchAgentOpen,
    setIsBatchAgentOpen,
    lastAutomationCaseDraftSeedRef,
    automationCreateStartUrl,
    setAutomationCreateStartUrl,
    batchStartUrl,
    setBatchStartUrl,
    builderContext,
    setBuilderContext,
    allowBrowserActions,
    setAllowBrowserActions,
    buildBrowserLocation,
    setBuildBrowserLocation,
    buildVerificationMode,
    setBuildVerificationMode,
    selectedExecutionEnvironmentId,
    setSelectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    setSelectedExecutionConfigurationId,
    selectedExecutionDataSetId,
    setSelectedExecutionDataSetId,
    message,
    setMessage,
    messageTone,
    setMessageTone,
    authoring,
    selection,
} = state;
const automationCreationMode = requestedCreationMode === "ai" && !canUseAutomationAi
    || requestedCreationMode === "record" && !canUseRecorder ? "blank" : requestedCreationMode;
const canCreateAutomationCase = canCreateAutomationDraft
    && (automationCreationMode !== "ai" || canUseAutomationAi)
    && (automationCreationMode !== "record" || canUseRecorder);
const importedApiPlanReady = automationCreateSteps.length > 0 && automationCreateMetadata.automationCaseType === "api" && automationCreateSteps.every(step => step.step_type === "api" && Boolean(step.api_request?.url));
useEffect(() => setBuildAgentSelection(automationAgentSelection()), [projectId, appTypeId, ""]);
useEffect(() => {
    setIsExecutionContextOpen(false);
}, [projectId, appTypeId, ""]);
useEffect(() => {
    setRunReviewRequest(null);
    setPendingRemoteRun(null);
    setRunReviewError("");
    setIsBatchAgentOpen(false);
    setBatchBuildTargetIds([]);
}, [projectId, appTypeId, session?.user.id]);
const canVerifyBuild = canRunLocalAutomation && hasPermission(session, "run.create", projectId);
const buildPipelineOptions = automationBuildPipelineRequest({ mode: buildVerificationMode, driver: "mcp", canVerify: canVerifyBuild, interactive: allowBrowserActions, hasEnvironment: Boolean(selectedExecutionEnvironmentId) });
const { reviewBuildParameters, parameterReviewDialog } = useAutomationBuildParameters(JSON.stringify([
    projectId, appTypeId,
    "",
    "",
    selectedExecutionEnvironmentId, selectedExecutionConfigurationId, selectedExecutionDataSetId
]));
const inspectAgent = useRepositoryInspectAgent(Boolean(session) && (canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder), projectId);
const needsAutomationEditorData = Boolean(isCreateAutomationOpen);
const prepareManualSource = searchParams.get("create") === "1" && Boolean(searchParams.get("manual"));
const queries=useAutomationCasesQueries({...access,...state,projectId,appTypeId,needsAutomationEditorData,prepareManualSource});const {
    appTypesQuery,
    testCasesQuery,
    canViewExecutionMetrics,
    automationMetricsQuery,
    automationMetrics,
    manualCasesQuery,
    createSourcesQuery,
    automationLlmIntegrationsQuery,
    appTypes,
    testCases,
} = queries;
const model=useAutomationCasesModel({...access,...state,...queries,projectId,appTypeId,automationCreationMode,importedApiPlanReady});const {
    automatedCases,
    automationDisplayIdByCaseId,
    metadataOptions,
    availableManualCases,
    automationActionTargetIds,
    canDeleteAutomationCases,
    batchBuildReadinessQuery,
    filteredAutomationCases,
    activeAutomationCaseSearchCount,
    areAllFilteredAutomationCasesSelected,
    automationCreateParameters,
    automationCreateRuntimeTypes,
    creationAllowedStepTypes,
    creationIncompatibleRuntimes,
    includeLinkedBehavior,
    automationCreateStartUrlRequired,
    automationCreateStartUrlValidation,
    batchStartUrlRequired,
    batchHasUrlRuntime,
    batchStartUrlValidation,
    openAutomationBuild,
    canRecordCreation,
} = model;
useEffect(() => {
    if (!isCreateAutomationOpen)
        return;
    const sources = automationCreateManualCaseIds.map((id) => createSourcesQuery.data?.find((source) => source.testCase.id === id));
    if (sources.some((source) => !source))
        return;
    const cases = sources.flatMap((source) => source ? [source.testCase] : []);
    const first = cases[0];
    const defaults: AutomationMetadata = {
        ...emptyAutomationMetadata,
        title: first ? `${first.title} · Automation` : "",
        description: first?.description || "",
        priority: String(first?.priority || 3),
        manualCaseIds: automationCreateManualCaseIds,
        requirementIds: [...new Set(cases.flatMap((item) => item.requirement_ids || (item.requirement_id ? [item.requirement_id] : [])))],
        moduleIds: [...new Set(cases.flatMap((item) => item.module_ids || []))],
        suiteIds: [...new Set(cases.flatMap((item) => item.suite_ids || (item.suite_id ? [item.suite_id] : [])))],
        dataSetId: first?.test_data_set_ids?.[0] || ""
    };
    setAutomationCreateMetadata((current) => {
        const next = { ...current };
        (Object.keys(defaults) as Array<keyof AutomationMetadata>).forEach((key) => {
            if (!automationCreateTouchedMetadataRef.current.has(key))
                Object.assign(next, { [key]: defaults[key] });
        });
        return next;
    });
}, [automationCreateManualCaseIds, createSourcesQuery.data, isCreateAutomationOpen]);
useEffect(() => {
    if (isCreateAutomationOpen && requestedCreationMode === "record" && !canRecordCreation)
        setAutomationCreationMode("blank");
}, [isCreateAutomationOpen, requestedCreationMode, canRecordCreation]);
useEffect(() => {
    setSelectedAutomationCaseIds((current) => current.filter((testCaseId) => automatedCases.some((testCase) => testCase.id === testCaseId)));
}, [automatedCases]);
useEffect(() => {
    if (appTypesQuery.isPending) {
        return;
    }
    const scopedAppTypes = projectId ? appTypes.filter((appType) => String(appType.project_id) === String(projectId)) : appTypes;
    if (!scopedAppTypes.length) {
        setAppTypeId("");
        return;
    }
    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
        setAppTypeId(scopedAppTypes[0].id);
    }
}, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);
useEffect(() => {
    const requestedManualId = searchParams.get("manual") || "";
    const apiTwin = searchParams.get("editor") === "api";
    if (searchParams.get("create") !== "1") {
        consumedAutomationCreateRouteRef.current = "";
        return;
    }
    if (isCreateAutomationOpen || testCasesQuery.isLoading || (prepareManualSource && manualCasesQuery.isPending)) {
        return;
    }
    // Closing locally can render before the router removes the creation query.
    // Consume the request once so a successful save or Cancel cannot reopen it.
    const routeKey = `${projectId}:${appTypeId}:${requestedManualId}:${apiTwin}`;
    if (consumedAutomationCreateRouteRef.current === routeKey)
        return;
    consumedAutomationCreateRouteRef.current = routeKey;
    const manualCase = findByRoutableId(availableManualCases, requestedManualId);
    if (requestedManualId && !manualCase) {
        setMessageTone("error");
        setMessage("The linked manual case could not be loaded. You can select a source in the case editor.");
    }
    automationCreateTouchedMetadataRef.current.clear();
    if (apiTwin) { automationCreateTouchedMetadataRef.current.add("automationCaseType"); setAutomationCreationMode("blank"); setAutomationCreateSteps([]); }
    setAutomationCreateManualCaseIds(manualCase ? [manualCase.id] : []);
    setAutomationCreateMetadata({ ...emptyAutomationMetadata, title: manualCase ? `${manualCase.title} · Automation` : "", automationCaseType: apiTwin ? "api" : "", manualCaseIds: manualCase ? [manualCase.id] : [] });
    setIsCreateAutomationOpen(true);
}, [availableManualCases, searchParams, testCasesQuery.isLoading, prepareManualSource, manualCasesQuery.isPending, isCreateAutomationOpen, projectId, appTypeId]);
useEffect(() => {
    {
        if (lastAutomationCaseDraftSeedRef.current) {
            setSelectedExecutionDataSetId("");
            setSelectedExecutionEnvironmentId("");
            lastAutomationCaseDraftSeedRef.current = null;
        }
        return;
    }
    return;
}, [null, projectId, ""]);
const invalidateAutomationData = () => {
    for (const key of ["test-cases", "test-case-detail", "global-test-cases", "global-test-case-results", "test-case-metrics",
        "test-case-picker", "test-case-picker-selected", "design-test-cases", "design-run-scope-cases", "test-steps",
        "automation-learning-cache", "automation-repository-context", "workspace-transactions", "test-case-suites",
        "test-case-modules", "test-suites", "execution-results", "execution-history"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
    }
};
const selectAutomationCase = useCallback((testCaseId: string) => {
    selection.openCase(testCaseId);
    const targetCase = automatedCases.find(testCase => testCase.id === testCaseId);
    setSearchParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete("repository");
        next.delete("agent_activity");
        next.delete("build_method");
        if (engineer) next.set("tab", "build"); else next.delete("tab");
        next.set("case", getRoutableId(targetCase) || testCaseId);
        return next;
    }, { replace: true });
}, [automatedCases, engineer, setSearchParams, selection.openCase]);
const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
};
const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
};
const ports={queryClient,canCreateAutomationCase,automationCreationMode,importedApiPlanReady,...access,...state,...queries,...model,projectId,appTypeId,navigate,searchParams,setSearchParams,invalidateAutomationData,showError,showSuccess,selectAutomationCase,reviewBuildParameters,buildPipelineOptions};
const creation=useAutomationCaseCreation(ports, engineer ? location.pathname : undefined),batch=useAutomationCaseBatchBuild(ports),runs=useAutomationCaseRuns(ports),columns=useAutomationCaseColumns(ports);
const {
    applyApiSourceDraft,
    closeCreateAutomation,
    updateAutomationCreateMetadata,
    createAutomationCase,
    createAutomationDialogRef,
} = creation;const {
    scheduleAiAutomation,
    batchAgentDialogRef,
} = batch;const {
    requestAutomationRun,
    runSelectedAutomationCases,
    retryRemoteAutomationStart,
} = runs;const {
    automationCaseListColumns,
} = columns;
const deleteSelectedAutomationCases = useMutation({
    mutationFn: async (ids: string[]) => {
        if (!canDeleteAutomationCases || !projectId || !appTypeId)
            throw new Error("Permission to delete automation cases is required.");
        await api.testCases.deleteAutomationCases({ project_id: projectId, app_type_id: appTypeId, test_case_ids: ids });
        return ids;
    },
    onSuccess: (ids) => {
        setSelectedAutomationCaseIds(current => current.filter(id => !ids.includes(id)));
        invalidateAutomationData();
        showSuccess(`${ids.length} automation case${ids.length === 1 ? "" : "s"} deleted. Manual cases are preserved and coverage has been updated.`);
    },
    onError: error => showError(error, "Unable to delete the selected automation cases.")
});
const automationPageHeader = {
    eyebrow: "Automation",
    title: "Automation",
    description: "From behavior to executable evidence."
};
return {
    authoring,
    confirmationDialog,
    canInspectRepository,
    canUseRecorder,
    canRunLocalAutomation,
    canUseAutomationBuilder,
    inspectAgent,
    automationPageHeader,
    automationMetricsQuery,
    automationMetrics,
    canViewExecutionMetrics,
    message,
    setMessage,
    messageTone,
    setAutomationCatalogViewMode,
    automationCatalogViewMode,
    activeAutomationCaseSearchCount,
    catalogFilters, filterCatalog,
    areAllFilteredAutomationCasesSelected,
    filteredAutomationCases,
    setSelectedAutomationCaseIds,
    selectedAutomationCaseIds,
    automationActionTargetIds,
    canDeleteAutomationCases,
    deleteSelectedAutomationCases,
    confirmDelete,
    canUseAutomationAi,
    appTypeId,
    scheduleAiAutomation,
    openAutomationBuild,
    projectId,
    runSelectedAutomationCases,
    requestAutomationRun,
    canRunRemoteAutomation,
    canCreateAutomationDraft,
    setIsCreateAutomationOpen,
    testCasesQuery,
    automatedCases,
    session,
    featureFlagsQuery,
    navigate,
    selectAutomationCase,
    automationDisplayIdByCaseId,
    automationCaseListColumns,
    isExecutionContextOpen,
    setIsExecutionContextOpen,
    setSelectedExecutionConfigurationId,
    setSelectedExecutionDataSetId,
    setSelectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    selectedExecutionDataSetId,
    selectedExecutionEnvironmentId,
    runReviewRequest,
    canViewAutomationCode,
    retryRemoteAutomationStart,
    runReviewError,
    pendingRemoteRun,
    setRunReviewRequest,
    setRunReviewError,
    isBatchAgentOpen,
    setIsBatchAgentOpen,
    batchAgentDialogRef,
    batchBuildTargetIds,
    setAgentMission,
    agentMission,
    batchHasUrlRuntime,
    batchStartUrlRequired,
    setBatchStartUrl,
    batchStartUrl,
    batchStartUrlValidation,
    setAgentScheduledAt,
    agentScheduledAt,
    automationLlmIntegrationsQuery,
    buildAgentSelection,
    setBuildAgentSelection,
    setBuilderContext,
    builderContext,
    buildBrowserLocation,
    setBuildBrowserLocation,
    allowBrowserActions,
    setAllowBrowserActions,
    buildVerificationMode,
    setBuildVerificationMode,
    canVerifyBuild,
    createAutomationCase,
    batchBuildReadinessQuery,
    isCreateAutomationOpen,
    closeCreateAutomation,
    createAutomationDialogRef,
    metadataOptions,
    updateAutomationCreateMetadata,
    automationCreateMetadata,
    automationCreateManualCaseIds,
    automationCreationMode,
    setAutomationCreationMode,
    canRecordCreation,
    automationCreateRuntimeTypes,
    automationCreateStartUrlRequired,
    setAutomationCreateStartUrl,
    automationCreateStartUrl,
    automationCreateStartUrlValidation,
    importedApiPlanReady,
    automationCreateSteps,
    createSourcesQuery,
    creationIncompatibleRuntimes,
    includeLinkedBehavior,
    creationAllowedStepTypes,
    applyApiSourceDraft,
    automationCreateParameters,
    setAutomationCreateSteps,
    canCreateAutomationCase,
    parameterReviewDialog,
};
}
export type AutomationCasesController=ReturnType<typeof useAutomationCasesController>;
