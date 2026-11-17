import { automationQueryKeys } from "../../lib/automationQueryKeys";
import { useQuery } from "@tanstack/react-query";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { TestDataSet } from "@hellotest/platform/frontend/src/types";
import type { AutomationCasesState } from './useAutomationCasesState';
import type { AutomationCasesAccess } from './useAutomationCasesAccess';

type CasesScope={projectId:string;appTypeId:string};
export function useAutomationCasesQueries(ports:CasesScope&AutomationCasesState&AutomationCasesAccess&{needsAutomationEditorData:boolean}){
const {
    projectId,
    session,
    appTypeId,
    featureFlagsQuery,
    needsAutomationEditorData,
    automationCreateManualCaseIds,
    isCreateAutomationOpen,
    isBatchAgentOpen,
    canUseAutomationAi,
} = ports;
const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: ({ signal }) => api.appTypes.list({ project_id: projectId }, { signal }),
    enabled: Boolean(projectId && session)
});
const testCasesQuery = useQuery({
    queryKey: automationQueryKeys.cases(appTypeId),
    queryFn: ({ signal }) => api.testCases.list({ app_type_id: appTypeId, projection: "summary" }, { signal }),
    enabled: Boolean(appTypeId && session && true)
});
const canViewExecutionMetrics = hasPermission(session, "run.view", projectId) && hasPermission(session, "result.view", projectId);
const canViewTestData = hasPermission(session, "data.view", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.test_data"]);
const automationMetricsQuery = useQuery({
    queryKey: ["test-case-metrics", "automation", projectId, appTypeId, canViewExecutionMetrics],
    queryFn: () => api.testCases.metrics({ project_id: projectId, app_type_id: appTypeId, automated: "yes", include_execution: canViewExecutionMetrics }),
    enabled: Boolean(projectId && appTypeId && session && true)
});
const automationMetrics = automationMetricsQuery.data?.catalog;
const executionResultsQuery = useQuery({
    queryKey: ["execution-results", "automation-workspace", "summary", projectId, appTypeId],
    queryFn: ({ signal }) => api.executionResults.list({ project_id: projectId, app_type_id: appTypeId, projection: "summary", limit: 5000 }, { signal }),
    enabled: Boolean(appTypeId && session && true && canViewExecutionMetrics)
});
const suitesQuery = useQuery({
    queryKey: ["test-case-suites", appTypeId],
    queryFn: ({ signal }) => api.testSuites.list({ app_type_id: appTypeId }, { signal }),
    enabled: Boolean(appTypeId && session && needsAutomationEditorData)
});
const requirementsQuery = useQuery({ queryKey: ["requirements", "automation-workspace", projectId], queryFn: ({ signal }) => api.requirements.list({ project_id: projectId }, { signal }), enabled: Boolean(projectId && session && needsAutomationEditorData) });
const modulesQuery = useQuery({ queryKey: ["test-case-modules", "automation-workspace", appTypeId], queryFn: ({ signal }) => api.testCaseModules.list({ app_type_id: appTypeId }, { signal }), enabled: Boolean(appTypeId && session && needsAutomationEditorData) });
const createSourcesQuery = useQuery({
    queryKey: ["automation-create-sources", projectId, automationCreateManualCaseIds],
    queryFn: ({ signal }) => Promise.all(automationCreateManualCaseIds.map(async (id) => {
        const [testCase, steps] = await Promise.all([
            api.testCases.get(id, { project_id: projectId }, { signal }),
            api.testSteps.list({ test_case_id: id }, { signal })
        ]);
        return { testCase, steps };
    })),
    enabled: Boolean(isCreateAutomationOpen && automationCreateManualCaseIds.length)
});
const testDataSetsQuery = useQuery({
    queryKey: ["test-data-sets", "automation-workspace", projectId, appTypeId],
    queryFn: ({ signal }) => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }, { signal }),
    enabled: Boolean(projectId && session && needsAutomationEditorData && canViewTestData)
});
const automationLlmIntegrationsQuery = useQuery({ queryKey: ["integrations", "automation-llm", projectId], queryFn: () => api.integrations.list({ type: "llm", is_active: true }), enabled: Boolean(projectId && session && (needsAutomationEditorData || isBatchAgentOpen) && canUseAutomationAi && hasPermission(session, "integration.view", projectId)) });
const appTypes = asArray(appTypesQuery.data);
const testCases = asArray(testCasesQuery.data);
const testDataSets = asArray<TestDataSet>(testDataSetsQuery.data);
const automationRequirements = asArray(requirementsQuery.data);
const automationModules = asArray(modulesQuery.data);
const suites = asArray(suitesQuery.data);
return {appTypesQuery,testCasesQuery,canViewExecutionMetrics,canViewTestData,automationMetricsQuery,automationMetrics,executionResultsQuery,suitesQuery,requirementsQuery,modulesQuery,createSourcesQuery,testDataSetsQuery,automationLlmIntegrationsQuery,appTypes,testCases,testDataSets,automationRequirements,automationModules,suites};
}
export type AutomationCasesQueries=ReturnType<typeof useAutomationCasesQueries>;
