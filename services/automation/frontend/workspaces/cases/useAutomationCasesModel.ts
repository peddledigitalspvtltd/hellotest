import { inspectAutomationTargets } from "../../lib/automationReadiness";
import { automationStartUrlError } from "../../lib/automationStartUrl";
import { getAutomationBuildRuntimeTypes, getAllowedAutomationStepTypes, incompatibleAutomationRuntimes } from "../../lib/automationRuntime";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildAutomationCreateParameters } from "../../lib/automationCreateParameters";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { ExecutionResult } from "@hellotest/platform/frontend/src/types";
import { isAutomatedCase, isManualCase } from "../../lib/automationWorkspaceSupport";
import type { AutomationCasesState } from './useAutomationCasesState';
import type { AutomationCasesAccess } from './useAutomationCasesAccess';
import type { AutomationCasesQueries } from './useAutomationCasesQueries';

type CasesScope={projectId:string;appTypeId:string};
export function useAutomationCasesModel(ports:CasesScope&AutomationCasesState&AutomationCasesAccess&AutomationCasesQueries){
const {
    testCases,
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
    executionResultsQuery,
    automationCaseSearch,
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
const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
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
const inspectSavedPlans = (ids: string[], intent: "build" | "run" = "run") => inspectAutomationTargets(ids, appTypeId, {
    getCase: id => api.testCases.get(id, { project_id: projectId }),
    getSteps: id => api.testSteps.list({ test_case_id: id })
}, intent, [], undefined, canViewAutomationCode, intent === "build" ? [agentMission, builderContext].filter(Boolean).join("\n\n") : "");
const batchBuildReadinessQuery = useQuery({
    queryKey: ["automation-build-preflight", projectId, appTypeId, batchBuildTargetIds, [], Boolean(agentMission.trim() || builderContext.trim())],
    queryFn: () => inspectSavedPlans(batchBuildTargetIds, "build"),
    enabled: isBatchAgentOpen && Boolean(batchBuildTargetIds.length),
    staleTime: 0, retry: false
});
const executionResults = asArray(executionResultsQuery.data);
const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};
    executionResults.forEach((result) => {
        map[result.test_case_id] = map[result.test_case_id] || [];
        map[result.test_case_id].push(result);
    });
    Object.values(map).forEach((items) => {
        items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });
    return map;
}, [executionResults]);
const filteredAutomationCases = useMemo(() => {
    const normalizedSearch = automationCaseSearch.trim().toLowerCase();
    if (!normalizedSearch) {
        return automatedCases;
    }
    return automatedCases.filter((testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const searchContent = [
            testCase.id,
            testCase.display_id,
            automationDisplayIdByCaseId[testCase.id],
            testCase.title,
            testCase.description,
            testCase.status,
            testCase.automation_status,
            `p${testCase.priority || 3}`,
            `${history.length} runs`
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        return searchContent.includes(normalizedSearch);
    });
}, [automatedCases, automationCaseSearch, automationDisplayIdByCaseId, historyByCaseId]);
const activeAutomationCaseSearchCount = automationCaseSearch.trim() ? 1 : 0;
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
const selectedRuntimeType = appTypes.find((item) => item.id === appTypeId)?.type || "web";
const automationCreatePlanSteps = [
    ...automationCreateManualCaseIds.flatMap((id) => createSourcesQuery.data?.find((source) => source.testCase.id === id)?.steps || []),
    ...automationCreateSteps.filter((step) => step.action.trim() || step.expected_result.trim())
];
const automationCreateRuntimeTypes = automationCreateMetadata.automationCaseType
    ? getAutomationBuildRuntimeTypes(automationCreatePlanSteps, automationCreateMetadata.automationCaseType) : [];
const creationAllowedStepTypes = getAllowedAutomationStepTypes(automationCreateMetadata.automationCaseType, canUseMobileAppium);
const creationIncompatibleRuntimes = incompatibleAutomationRuntimes(automationCreateMetadata.automationCaseType, automationCreatePlanSteps);
const automationCreateStartUrlRequired = automationCreateRuntimeTypes.includes("web");
const automationCreateStartUrlValidation = automationStartUrlError(automationCreateStartUrl, automationCreateStartUrlRequired);
const batchStartUrlRequired = batchBuildReadinessQuery.data
    ? batchBuildReadinessQuery.data.some(result => result.runtimes.includes("web") || !result.stepCount && ["web", "unified"].includes(selectedRuntimeType))
    : selectedRuntimeType === "web" || selectedRuntimeType === "unified";
const batchHasUrlRuntime = batchBuildReadinessQuery.data
    ? batchBuildReadinessQuery.data.some(result => result.runtimes.some(type => type === "web" || type === "api") || !result.stepCount && !["android", "ios"].includes(selectedRuntimeType))
    : !["android", "ios"].includes(selectedRuntimeType);
const batchStartUrlValidation = automationStartUrlError(batchStartUrl, batchStartUrlRequired);
const openAutomationBuild = (ids: string[]) => { const savedUrls = ids.map(id => automatedCases.find(testCase => testCase.id === id)?.automation_start_url?.trim() || ""); setBatchStartUrl(savedUrls.length && savedUrls.every(url => url === savedUrls[0]) ? savedUrls[0] : ""); setBatchBuildTargetIds(ids); setIsBatchAgentOpen(true); };
const canRecordCreation = canUseRecorder && Boolean(automationCreateMetadata.automationCaseType) && automationCreateMetadata.automationCaseType !== "api" && (["web", "unified"].includes(automationCreateMetadata.automationCaseType) || canUseMobileAppium);
return {automatedCases,automationDisplayIdByCaseId,manualCases,metadataOptions,availableManualCases,selectedAutomationActionTargetIds,automationActionTargetIds,canDeleteAutomationCases,inspectSavedPlans,batchBuildReadinessQuery,executionResults,historyByCaseId,filteredAutomationCases,activeAutomationCaseSearchCount,areAllFilteredAutomationCasesSelected,automationCreateParameters,selectedRuntimeType,automationCreatePlanSteps,automationCreateRuntimeTypes,creationAllowedStepTypes,creationIncompatibleRuntimes,automationCreateStartUrlRequired,automationCreateStartUrlValidation,batchStartUrlRequired,batchHasUrlRuntime,batchStartUrlValidation,openAutomationBuild,canRecordCreation};
}
export type AutomationCasesModel=ReturnType<typeof useAutomationCasesModel>;
