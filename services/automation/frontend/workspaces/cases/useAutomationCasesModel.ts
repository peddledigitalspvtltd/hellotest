import { inspectAutomationTargets } from "../../lib/automationReadiness";
import { automationStartUrlError } from "../../lib/automationStartUrl";
import { shouldSeedLinkedAutomationPlan } from "../../lib/automationPlan";
import { getAutomationBuildRuntimeTypes, getAllowedAutomationStepTypes, incompatibleAutomationRuntimes } from "../../lib/automationRuntime";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildAutomationCreateParameters } from "../../lib/automationCreateParameters";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { isAutomatedCase, isManualCase, type AutomationCreationMode } from "../../lib/automationWorkspaceSupport";
import type { AutomationCasesState } from './useAutomationCasesState';
import type { AutomationCasesAccess } from './useAutomationCasesAccess';
import type { AutomationCasesQueries } from './useAutomationCasesQueries';

type CasesScope={projectId:string;appTypeId:string};
export function useAutomationCasesModel(ports:CasesScope&AutomationCasesState&AutomationCasesAccess&AutomationCasesQueries&{
    automationCreationMode: AutomationCreationMode; importedApiPlanReady: boolean;
}){
const {
    testCases,
    manualSourceCases,
    automationRequirements,
    automationModules,
    suites,
    testDataSets,
    selectedAutomationCaseIds,
    isAutomationWorkspaceEnabled,
    featureFlagsQuery,
    session,
    projectId,
    appTypeId,
    canViewAutomationCode,
    agentMission,
    builderContext,
    batchBuildTargetIds,
    isBatchAgentOpen,
    catalogFilters, canViewExecutionMetrics,
    automationCreateMetadata,
    automationCreateManualCaseIds,
    createSourcesQuery,
    automationCreateSteps,
    automationApiSourceParameters,
    automationApiSourcePrivateNames,
    appTypes,
    canUseMobileAppium,
    automationCreateStartUrl,
    batchStartUrl,
    setBatchStartUrl,
    setBatchBuildTargetIds,
    setIsBatchAgentOpen,
    canUseRecorder,
} = ports;
const automatedCases = useMemo(() => testCases.filter(isAutomatedCase), [testCases]);
const automationDisplayIdByCaseId = useMemo(() => automatedCases.reduce<Record<string, string>>((accumulator, testCase) => {
    accumulator[testCase.id] = testCase.display_id || testCase.id;
    return accumulator;
}, {}), [automatedCases]);
const manualCases = useMemo(() => manualSourceCases.filter(isManualCase), [manualSourceCases]);
const metadataOptions = {
    manualCases: manualCases.map((item) => ({ id: item.id, title: item.title, detail: item.display_id || undefined })),
    requirements: automationRequirements.map((item) => ({ id: item.id, title: item.title, detail: item.display_id || undefined })),
    modules: automationModules.map((item) => ({ id: item.id, title: item.name })),
    suites: suites.map((item) => ({ id: item.id, title: item.name })),
    dataSets: testDataSets.map((item) => ({ id: item.id, title: item.name }))
};
const availableManualCases = manualCases;
const selectedAutomationActionTargetIds = selectedAutomationCaseIds.filter((testCaseId) => automatedCases.some((testCase) => testCase.id === testCaseId));
const automationActionTargetIds = selectedAutomationActionTargetIds;
const canDeleteAutomationCases = isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.builder"])
    && hasPermission(session, "testcase.delete", projectId);
const selectedRuntimeType = appTypes.find((item) => item.id === appTypeId)?.type || "web";
const inspectSavedPlans = (ids: string[], intent: "build" | "run" = "run") => inspectAutomationTargets(ids, appTypeId, {
    getCase: id => api.testCases.get(id, { project_id: projectId }),
    getSteps: id => api.testSteps.list({ test_case_id: id })
}, intent, [], undefined, canViewAutomationCode, intent === "build" ? [agentMission, builderContext].filter(Boolean).join("\n\n") : "", selectedRuntimeType);
const batchBuildReadinessQuery = useQuery({
    queryKey: ["automation-build-preflight", projectId, appTypeId, batchBuildTargetIds, [], Boolean(agentMission.trim() || builderContext.trim())],
    queryFn: () => inspectSavedPlans(batchBuildTargetIds, "build"),
    enabled: isBatchAgentOpen && Boolean(batchBuildTargetIds.length),
    staleTime: 0, retry: false
});
const filteredAutomationCases = automatedCases;
const activeAutomationCaseSearchCount = [catalogFilters.search.trim(), catalogFilters.plan, catalogFilters.platform,
    canViewExecutionMetrics && catalogFilters.outcome].filter(Boolean).length;
const areAllFilteredAutomationCasesSelected = Boolean(filteredAutomationCases.length) && filteredAutomationCases.every((testCase) => selectedAutomationCaseIds.includes(testCase.id));
const automationCreateParameters = useMemo(() => buildAutomationCreateParameters({
    dataSet: testDataSets.find((item) => item.id === automationCreateMetadata.dataSetId),
    sources: automationCreateManualCaseIds.flatMap((id) => {
        const source = createSourcesQuery.data?.find((item) => item.testCase.id === id);
        return source ? [source] : [];
    }),
    draftSteps: automationCreateSteps,
    draftParameterValues: automationApiSourceParameters, privateParameterNames: automationApiSourcePrivateNames,
    suites,
    suiteIds: automationCreateMetadata.suiteIds
}), [testDataSets, automationCreateMetadata.dataSetId, automationCreateMetadata.suiteIds, automationCreateManualCaseIds, createSourcesQuery.data, automationCreateSteps, automationApiSourceParameters, automationApiSourcePrivateNames, suites]);
const includeLinkedBehavior = shouldSeedLinkedAutomationPlan(automationCreateMetadata.automationCaseType, ports.automationCreationMode, ports.importedApiPlanReady);
const automationCreatePlanSteps = [
    ...(includeLinkedBehavior ? automationCreateManualCaseIds.flatMap((id) => createSourcesQuery.data?.find((source) => source.testCase.id === id)?.steps || []) : []),
    ...automationCreateSteps.filter((step) => step.action.trim() || step.expected_result.trim())
];
const automationCreateRuntimeTypes = automationCreateMetadata.automationCaseType
    ? getAutomationBuildRuntimeTypes(automationCreatePlanSteps, automationCreateMetadata.automationCaseType) : [];
const creationAllowedStepTypes = getAllowedAutomationStepTypes(automationCreateMetadata.automationCaseType, canUseMobileAppium);
const creationIncompatibleRuntimes = incompatibleAutomationRuntimes(automationCreateMetadata.automationCaseType, automationCreatePlanSteps);
const automationCreateStartUrlRequired = automationCreateRuntimeTypes.includes("web");
const automationCreateStartUrlValidation = automationStartUrlError(automationCreateStartUrl, automationCreateStartUrlRequired);
const batchBuildRuntimes = batchBuildReadinessQuery.data?.flatMap(result => result.runtimes) || [];
const batchStartUrlRequired = batchBuildRuntimes.includes("web");
const batchHasUrlRuntime = batchStartUrlRequired || batchBuildRuntimes.includes("api");
const batchStartUrlValidation = automationStartUrlError(batchStartUrl, batchStartUrlRequired);
const openAutomationBuild = (ids: string[]) => { const savedUrls = ids.map(id => automatedCases.find(testCase => testCase.id === id)?.automation_start_url?.trim() || ""); setBatchStartUrl(savedUrls.length && savedUrls.every(url => url === savedUrls[0]) ? savedUrls[0] : ""); setBatchBuildTargetIds(ids); setIsBatchAgentOpen(true); };
const canRecordCreation = canUseRecorder && Boolean(automationCreateMetadata.automationCaseType) && automationCreateMetadata.automationCaseType !== "api" && (["web", "unified"].includes(automationCreateMetadata.automationCaseType) || canUseMobileAppium);
return {automatedCases,automationDisplayIdByCaseId,manualCases,metadataOptions,availableManualCases,selectedAutomationActionTargetIds,automationActionTargetIds,canDeleteAutomationCases,inspectSavedPlans,batchBuildReadinessQuery,filteredAutomationCases,activeAutomationCaseSearchCount,areAllFilteredAutomationCasesSelected,automationCreateParameters,selectedRuntimeType,automationCreatePlanSteps,automationCreateRuntimeTypes,creationAllowedStepTypes,creationIncompatibleRuntimes,automationCreateStartUrlRequired,automationCreateStartUrlValidation,batchStartUrlRequired,batchHasUrlRuntime,batchStartUrlValidation,openAutomationBuild,canRecordCreation,includeLinkedBehavior};
}
export type AutomationCasesModel=ReturnType<typeof useAutomationCasesModel>;
