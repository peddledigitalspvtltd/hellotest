import { isNonElementRepositoryEntry } from "../../lib/automationWorkspaceSupport";
import { collectCaseRepositoryPages } from "../../lib/repositoryCaseBindings";
import { automationQueryKeys } from "../../lib/automationQueryKeys";
import { parseAutomationStepDraft, buildAutomationApiRequest, buildAutomationCodeFromDraft } from "../../lib/automationStepDraft";
import { automationBuildPipelineRequest } from "../../lib/automationBuildPipeline";
import { buildAutomationGherkin } from "../../lib/automationGherkin";
import { useAutomationExportPreview } from "../../hooks/useAutomationExportPreview";
import { canonicalizeSavedLocatorWrappers } from "../../../shared/automationProgramCompatibility.mjs";
import { evaluateTestDataTemplate, hasTestDataGeneratorTemplate } from "@hellotest/testing/frontend/lib/testDataGenerators";
import { collectRepositoryPages } from "../../lib/repositoryEntries";
import { parseApiRequestSource } from "../../lib/apiRequestSource";
import { applyAutomationStepOptions, parseAutomationStepOptions } from "../../lib/automationStepOptions";
import { inspectAutomationTargets } from "../../lib/automationReadiness";
import { automationStartUrlError } from "../../lib/automationStartUrl";
import { initialEngineerParameterValues } from "../../lib/automationEngineerData";
import { casePrivateParameterNames, collectPrivateParameterNames, caseParameterSaveOptions } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { useAutomationBuildParameters } from "../../hooks/useAutomationBuildParameters";
import { getAutomationBuildRuntimeTypes, getRecorderPlatform, getAllowedAutomationStepTypes, resolveAutomationCaseType, incompatibleAutomationRuntimes } from "../../lib/automationRuntime";
import { mapCaseHooksToExecutionHooks } from "@hellotest/testing/frontend/lib/runHooks";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRepositoryInspectAgent } from "@hellotest/automation/frontend/hooks/useRepositoryInspectAgent";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { getAutomationKeywordInputSpec } from "../../lib/automationKeywordInputs";
import { automationMappingIsComplete, isAutomationPrecondition } from "../../lib/automationPlan";
import { automationMappingFieldsEqual, resolveAutomationMappingSave } from "../../lib/automationStepPersistence";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { collectCaseStepParameters, buildCaseParameterValues, collectSensitiveDataSetParameterNames, excludeSensitiveStepParameterValues, combineStepParameterValues, parseStepParameterName, type StepParameterScope } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AutomationLearningCacheEntry, SharedStepGroup, TestCase, TestDataSet, TestStep } from "@hellotest/platform/frontend/src/types";
import { AUTOMATION_CASE_DETAIL_STALE_TIME_MS, automationCaseDetailQueryKey, normalizeAutomationParameterValues, REPOSITORY_PAGE_SIZE, isAutomatedCase, isManualCase } from "../../lib/automationWorkspaceSupport";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
export function useAutomationCaseModel(input: AutomationCaseScope & AutomationCaseState) {
    const {canRunLocalAutomation, session, projectId, buildVerificationMode, allowBrowserActions, appTypeId, selectedCaseId, selectedParameterSuiteId, selectedExecutionEnvironmentId, selectedExecutionConfigurationId, selectedExecutionDataSetId, canInspectRepository, canUseRecorder, canUseAutomationBuilder, isBatchAgentOpen, canViewExecutionMetrics, activeAutomationWorkspaceTab, canViewTestData, canUseAutomationAi, isSharedGroupLibraryOpen, canDeleteAutomationCases, canViewAutomationCode, automationDraftStore, agentMission, builderContext, batchBuildTargetIds, testCaseParameterValues, caseDataSetId, suiteParameterValues, privateCaseParameterDraft, caseParameterOverrideDraftRef, parameterPreviewRevision, parameterPreviewCache, lastAutomationCaseDraftSeedRef, caseDraft, recorderParameterBindings, isAutomationCodePreviewOpen, automationStepView, executionHookDraft, overrideSharedSteps, startUrl, batchStartUrl, recordingTargetStepId, canUseMobileAppium} = input;
    const { reviewBuildParameters, parameterReviewDialog } = useAutomationBuildParameters(JSON.stringify([
        projectId, appTypeId, selectedCaseId, selectedParameterSuiteId,
        selectedExecutionEnvironmentId, selectedExecutionConfigurationId, selectedExecutionDataSetId
    ]));
    const inspectAgent = useRepositoryInspectAgent(Boolean(session) && (canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder), projectId);
    const needsAutomationEditorData = Boolean(selectedCaseId || false);
    const needsAutomationRepository = needsAutomationEditorData || isBatchAgentOpen;
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
    const selectedAutomationCaseDetailQuery = useQuery({
        queryKey: automationCaseDetailQueryKey(projectId, selectedCaseId),
        queryFn: ({ signal }) => api.testCases.get(selectedCaseId, { project_id: projectId }, { signal }),
        enabled: Boolean(projectId && selectedCaseId && session && true),
        staleTime: AUTOMATION_CASE_DETAIL_STALE_TIME_MS
    });
    const selectedAutomationCaseDetail = selectedAutomationCaseDetailQuery.data?.id === selectedCaseId
        && selectedAutomationCaseDetailQuery.data.detail_complete !== false
        ? selectedAutomationCaseDetailQuery.data
        : null;
    const isAutomationCaseDetailPending = Boolean(selectedCaseId
        && !selectedAutomationCaseDetail
        && (selectedAutomationCaseDetailQuery.isPending || selectedAutomationCaseDetailQuery.isFetching));
    const learningCacheQuery = useQuery({
        queryKey: automationQueryKeys.repository(projectId, appTypeId),
        queryFn: async ({ signal }) => {
            const queryScope = appTypeId
                ? { app_type_id: appTypeId }
                : { project_id: projectId || undefined };
            return collectRepositoryPages<AutomationLearningCacheEntry>(page => api.testCases.learningCache({ ...queryScope, ...page }, { signal }), { signal, pageSize: REPOSITORY_PAGE_SIZE });
        },
        enabled: Boolean((projectId || appTypeId) && session && needsAutomationRepository)
    });
    const automatedStepsQuery = useQuery({
        queryKey: automationQueryKeys.steps(selectedCaseId),
        queryFn: ({ signal }) => api.testSteps.list({ test_case_id: selectedCaseId }, { signal }),
        enabled: Boolean(selectedAutomationCaseDetail && session && true)
    });
    const automationMetricsQuery = useQuery({
        queryKey: ["test-case-metrics", "automation", projectId, appTypeId, canViewExecutionMetrics],
        queryFn: () => api.testCases.metrics({ project_id: projectId, app_type_id: appTypeId, automated: "yes", include_execution: canViewExecutionMetrics }),
        enabled: Boolean(projectId && appTypeId && session && true)
    });
    const automationMetrics = automationMetricsQuery.data?.catalog;
    const selectedCaseHistoryQuery = useQuery({
        queryKey: ["execution-results", "automation-case-history", "summary", projectId, selectedCaseId],
        queryFn: ({ signal }) => api.executionResults.list({ project_id: projectId, test_case_id: selectedCaseId, projection: "summary", limit: 5000 }, { signal }),
        enabled: Boolean(selectedAutomationCaseDetail && session && true && activeAutomationWorkspaceTab === "runs" && canViewExecutionMetrics),
        staleTime: AUTOMATION_CASE_DETAIL_STALE_TIME_MS
    });
    const suitesQuery = useQuery({
        queryKey: ["test-case-suites", appTypeId],
        queryFn: ({ signal }) => api.testSuites.list({ app_type_id: appTypeId }, { signal }),
        enabled: Boolean(appTypeId && session && needsAutomationEditorData)
    });
    const requirementsQuery = useQuery({ queryKey: ["requirements", "automation-workspace", projectId], queryFn: ({ signal }) => api.requirements.list({ project_id: projectId }, { signal }), enabled: Boolean(projectId && session && needsAutomationEditorData) });
    const modulesQuery = useQuery({ queryKey: ["test-case-modules", "automation-workspace", appTypeId], queryFn: ({ signal }) => api.testCaseModules.list({ app_type_id: appTypeId }, { signal }), enabled: Boolean(appTypeId && session && needsAutomationEditorData) });
    const testDataSetsQuery = useQuery({
        queryKey: ["test-data-sets", "automation-workspace", projectId, appTypeId],
        queryFn: ({ signal }) => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }, { signal }),
        enabled: Boolean(projectId && session && needsAutomationEditorData && canViewTestData)
    });
    const automationLlmIntegrationsQuery = useQuery({ queryKey: ["integrations", "automation-llm", projectId], queryFn: () => api.integrations.list({ type: "llm", is_active: true }), enabled: Boolean(projectId && session && (needsAutomationEditorData || isBatchAgentOpen) && canUseAutomationAi && hasPermission(session, "integration.view", projectId)) });
    const testEngineIntegrationsQuery = useQuery({
        queryKey: ["integrations", "testengine", projectId],
        queryFn: ({ signal }) => api.integrations.list({ type: "testengine", is_active: true }, { signal }),
        enabled: Boolean(projectId && session && (needsAutomationEditorData || false))
    });
    const sharedStepGroupsQuery = useQuery({
        queryKey: ["shared-step-groups", "automation-workspace", appTypeId],
        queryFn: ({ signal }) => api.sharedStepGroups.list({ app_type_id: appTypeId }, { signal }),
        enabled: Boolean(appTypeId && session && (isSharedGroupLibraryOpen || asArray<TestStep>(automatedStepsQuery.data).some(step => step.reusable_group_id)))
    });
    const appTypes = asArray(appTypesQuery.data);
    const selectedRuntimeType = appTypes.find((item) => item.id === appTypeId)?.type || "web";
    const testCases = asArray(testCasesQuery.data);
    const testDataSets = asArray<TestDataSet>(testDataSetsQuery.data);
    const automationRequirements = asArray(requirementsQuery.data);
    const automationModules = asArray(modulesQuery.data);
    const learningCache = asArray(learningCacheQuery.data);
    const suites = asArray(suitesQuery.data);
    const testEngineIntegration = asArray(testEngineIntegrationsQuery.data).find((integration) => String(integration.config?.project_id || "") === projectId) || asArray(testEngineIntegrationsQuery.data).find((integration) => !String(integration.config?.project_id || "").trim()) || asArray(testEngineIntegrationsQuery.data)[0] || null;
    const mobileRemoteRecorderEnabled = Boolean(testEngineIntegration?.config?.mobile_cloud_provider
        && testEngineIntegration.config.mobile_cloud_provider !== "none"
        && testEngineIntegration.config.mobile_remote_url);
    const sharedStepGroups = useMemo(() => asArray<SharedStepGroup>(sharedStepGroupsQuery.data), [sharedStepGroupsQuery.data]);
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
    const selectedCaseSummary = automatedCases.find((testCase) => testCase.id === selectedCaseId) || null;
    const activeCase = selectedAutomationCaseDetail;
    const canRemoveAutomationCase = canDeleteAutomationCases && Boolean(activeCase);
    const isAutomationCaseDetailReady = Boolean(activeCase);
    const linkedManualCases = useMemo(() => {
        const linkedIds = activeCase?.manual_test_case_ids?.length
            ? activeCase.manual_test_case_ids
            : activeCase?.manual_test_case_id ? [activeCase.manual_test_case_id] : [];
        return linkedIds.map((id) => manualCases.find((testCase) => testCase.id === id)).filter(Boolean) as TestCase[];
    }, [activeCase?.manual_test_case_id, activeCase?.manual_test_case_ids, manualCases]);
    const linkedManualCaseIds = activeCase?.manual_test_case_ids?.length
        ? activeCase.manual_test_case_ids : activeCase?.manual_test_case_id ? [activeCase.manual_test_case_id] : [];
    const linkedManualStepsQuery = useQuery({
        queryKey: ["automation-linked-manual-steps", projectId, appTypeId, activeCase?.id, linkedManualCaseIds],
        queryFn: async ({ signal }) => Promise.all(linkedManualCaseIds.map(async (manualCaseId) => {
            const [source, steps] = await Promise.all([
                api.testCases.get(manualCaseId, { project_id: projectId }, { signal }),
                api.testSteps.list({ test_case_id: manualCaseId }, { signal })
            ]);
            if (source.app_type_id !== appTypeId || source.automated !== "no" || steps.some(step => step.test_case_id !== manualCaseId)) {
                throw new Error("The linked manual case is unavailable in this application.");
            }
            return steps.map(step => ({
                test_case_id: activeCase!.id, manual_test_case_id: manualCaseId, manual_step_id: step.id,
                manual_step_order: step.step_order, action: step.action || "", expected_result: step.expected_result || ""
            }));
        })),
        enabled: Boolean(activeCase && linkedManualCaseIds.length && activeAutomationWorkspaceTab === "build"
            && canUseAutomationAi && canUseAutomationBuilder && canViewAutomationCode && hasPermission(session, "testcase.view", projectId)),
        retry: false
    });
    const automatedSteps = useMemo(() => asArray<TestStep>(automatedStepsQuery.data).map(step => canViewAutomationCode ? step : { ...step, automation_code: null, automation_source_sha256: null, api_request: null }), [automatedStepsQuery.data, canViewAutomationCode]);
    const unsavedAutomationStepIds = automatedSteps.filter(step => (automationDraftStore.read("steps")[step.id] && JSON.stringify(automationDraftStore.read("steps")[step.id]) !== JSON.stringify(parseAutomationStepDraft(step)))
        || (automationDraftStore.read("code")[step.id] !== undefined && automationDraftStore.read("code")[step.id] !== (step.automation_code || ""))
        || (automationDraftStore.read("options")[step.id] && JSON.stringify(automationDraftStore.read("options")[step.id]) !== JSON.stringify(parseAutomationStepOptions(step)))
        || (automationDraftStore.read("api")[step.id] !== undefined && automationDraftStore.read("api")[step.id] !== JSON.stringify(step.api_request || {}, null, 2))).map(step => step.id);
    const inspectSavedPlans = (ids: string[], intent: "build" | "run" = "run") => inspectAutomationTargets(ids, appTypeId, {
        getCase: id => api.testCases.get(id, { project_id: projectId }),
        getSteps: id => api.testSteps.list({ test_case_id: id })
    }, intent, unsavedAutomationStepIds, undefined, canViewAutomationCode, intent === "build" ? [agentMission, builderContext].filter(Boolean).join("\n\n") : "", selectedRuntimeType);
    const batchBuildReadinessQuery = useQuery({
        queryKey: ["automation-build-preflight", projectId, appTypeId, batchBuildTargetIds, unsavedAutomationStepIds, Boolean(agentMission.trim() || builderContext.trim())],
        queryFn: () => inspectSavedPlans(batchBuildTargetIds, "build"),
        enabled: isBatchAgentOpen && Boolean(batchBuildTargetIds.length),
        staleTime: 0, retry: false
    });
    const activeCaseHistory = activeCase ? asArray(selectedCaseHistoryQuery.data) : [];
    const activeCaseSuiteIds = useMemo(() => activeCase?.suite_ids || (activeCase?.suite_id ? [activeCase.suite_id] : []), [activeCase]);
    const selectedParameterSuite = suites.find((suite) => suite.id === selectedParameterSuiteId) || null;
    const inheritedManualParameterValues = useMemo(() => canViewTestData ? normalizeAutomationParameterValues(activeCase?.inherited_parameter_values, "t") : {}, [activeCase?.inherited_parameter_values, canViewTestData]);
    const effectiveCaseParameterValues = useMemo(() => combineStepParameterValues(inheritedManualParameterValues, testCaseParameterValues), [inheritedManualParameterValues, testCaseParameterValues]);
    const effectiveCaseDataSetId = caseDataSetId || (!activeCase?.test_data_set_ids?.length ? activeCase?.effective_test_data_set_ids?.[0] : "") || "";
    const casePrivateNames = useMemo(() => casePrivateParameterNames(activeCase), [activeCase?.test_data_options?.private_parameter_names, activeCase?.effective_private_parameter_names]);
    const caseParameterPrivacyScope = `${projectId}:${activeCase?.id || selectedCaseId}`;
    const visiblePrivateNames = useMemo(() => collectPrivateParameterNames([effectiveCaseParameterValues, suiteParameterValues], [
        ...casePrivateNames, ...collectSensitiveDataSetParameterNames(testDataSets.find(item => item.id === effectiveCaseDataSetId)),
        ...(privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : [])
    ]), [effectiveCaseParameterValues, suiteParameterValues, casePrivateNames, testDataSets, effectiveCaseDataSetId, privateCaseParameterDraft, caseParameterPrivacyScope]);
    const initialEngineerValues = useMemo(() => canViewTestData ? initialEngineerParameterValues(effectiveCaseParameterValues, testDataSets.find(item => item.id === (selectedExecutionDataSetId || effectiveCaseDataSetId)), { ...activeCase?.test_data_options, parameter_overrides: activeCase?.effective_parameter_overrides || activeCase?.test_data_options?.parameter_overrides, effective_private_parameter_names: [...visiblePrivateNames] }) : {}, [canViewTestData, effectiveCaseParameterValues, testDataSets, selectedExecutionDataSetId, effectiveCaseDataSetId, activeCase?.test_data_options, activeCase?.effective_parameter_overrides, visiblePrivateNames]);
    const inheritedParameterDefaults = useMemo(() => buildCaseParameterValues({ inheritedValues: inheritedManualParameterValues, dataSet: testDataSets.find(item => item.id === effectiveCaseDataSetId), inheritedOverrideNames: activeCase?.inherited_parameter_overrides }), [testDataSets, effectiveCaseDataSetId, inheritedManualParameterValues, activeCase?.inherited_parameter_overrides]);
    const mergedParameterValues = useMemo(() => excludeSensitiveStepParameterValues(combineStepParameterValues(buildCaseParameterValues({
        ownValues: testCaseParameterValues, inheritedValues: inheritedManualParameterValues,
        dataSet: testDataSets.find(item => item.id === effectiveCaseDataSetId),
        inheritedOverrideNames: activeCase?.inherited_parameter_overrides,
        overrideNames: caseParameterSaveOptions(activeCase?.test_data_options, testCaseParameterValues, activeCase?.parameter_values, visiblePrivateNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : [], privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : []).parameter_overrides
    }), suiteParameterValues), visiblePrivateNames), [suiteParameterValues, testCaseParameterValues, inheritedManualParameterValues, testDataSets, effectiveCaseDataSetId, activeCase?.test_data_options, activeCase?.parameter_values, activeCase?.inherited_parameter_overrides, visiblePrivateNames]);
    const resolvedParameterValues = useMemo(() => {
        const nextCache = new Map<string, string>();
        const values = Object.fromEntries(Object.entries(mergedParameterValues).map(([name, value]) => {
            if (!hasTestDataGeneratorTemplate(value))
                return [name, value];
            const key = `${projectId}:${selectedCaseId}:${effectiveCaseDataSetId}:${parameterPreviewRevision}:${name}:${value}`;
            const resolved = parameterPreviewCache.current.get(key) ?? evaluateTestDataTemplate(value);
            nextCache.set(key, resolved);
            return [name, resolved];
        }));
        parameterPreviewCache.current = nextCache;
        return values;
    }, [mergedParameterValues, projectId, selectedCaseId, effectiveCaseDataSetId, parameterPreviewRevision]);
    const detectedStepParameters = useMemo(() => lastAutomationCaseDraftSeedRef.current?.caseKey !== `case:${projectId}:${activeCase?.id}` ? [] : collectCaseStepParameters({ steps: [{ id: "automation-case-metadata", action: caseDraft.title, expected_result: richTextToPlainText(caseDraft.description) }, ...automatedSteps.map((step) => ({
                id: step.id,
                action: [automationDraftStore.read("steps")[step.id]?.name ?? step.action, automationDraftStore.read("steps")[step.id]?.objectRef, automationDraftStore.read("steps")[step.id]?.value].filter(Boolean).join(" "),
                expected_result: automationDraftStore.read("steps")[step.id]?.expected_result ?? step.expected_result,
                automation_code: automationDraftStore.read("code")[step.id] ?? step.automation_code,
                api_request: step.api_request
            }))], ownValues: testCaseParameterValues, inheritedValues: inheritedManualParameterValues,
        availableValues: mergedParameterValues, dataSet: testDataSets.find(item => item.id === effectiveCaseDataSetId),
        privateNames: [...casePrivateNames, ...(privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : [])]
    }).map(parameter => {
        const protectedParameter = visiblePrivateNames.has(parameter.name) ? { ...parameter, sensitive: true } : parameter;
        const source = activeCase?.parameter_sources?.[parameter.name];
        return Object.prototype.hasOwnProperty.call(inheritedManualParameterValues, parameter.name)
            ? { ...protectedParameter, sourceLabel: source?.kind === "linked_manual" ? `Manual case ${source.display_id || source.test_case_id}` : "Manual case" } : protectedParameter;
    }), [projectId, activeCase?.id, automatedSteps, automationDraftStore.read("code"), automationDraftStore.read("steps"), mergedParameterValues, testDataSets, effectiveCaseDataSetId, caseDraft.title, caseDraft.description, activeCase?.parameter_sources, inheritedManualParameterValues, testCaseParameterValues, visiblePrivateNames, casePrivateNames, privateCaseParameterDraft, caseParameterPrivacyScope]);
    const recorderParameterDefinitions = useMemo(() => {
        const parameters = new Map(detectedStepParameters.map(parameter => [parameter.name, parameter]));
        for (const name of [...Object.keys(suiteParameterValues), ...Object.values(recorderParameterBindings)]) {
            const parsed = parseStepParameterName(name);
            if (parsed && !parameters.has(parsed.name))
                parameters.set(parsed.name, {
                    ...parsed, label: parsed.rawName, stepIds: [], occurrenceCount: 0, sensitive: visiblePrivateNames.has(parsed.name)
                });
        }
        return [...parameters.values()];
    }, [detectedStepParameters, suiteParameterValues, recorderParameterBindings, visiblePrivateNames]);
    const automationStepGroups = useMemo(() => {
        const groups: {
            id: string;
            title: string;
            subtitle: string;
            steps: TestStep[];
            isStandalone: boolean;
        }[] = [];
        for (const step of [...automatedSteps].sort((left, right) => left.step_order - right.step_order)) {
            const previous = groups[groups.length - 1];
            if (step.group_id && previous?.steps[0]?.group_id === step.group_id && isAutomationPrecondition(previous.steps[0]) === isAutomationPrecondition(step))
                previous.steps.push(step);
            else
                groups.push({ id: `plan-${step.id}`, title: step.group_name || "Step group", subtitle: "", steps: [step], isStandalone: !step.group_id });
        }
        return groups;
    }, [automatedSteps]);
    const inlineTestDataGroups = useMemo(() => {
        const buildRows = (scope: StepParameterScope) => {
            const names = new Set(detectedStepParameters.filter(parameter => parameter.scope === scope).map(parameter => parameter.name));
            return Array.from(names)
                .sort((left, right) => left.localeCompare(right))
                .map((name) => {
                const parsed = parseStepParameterName(name, scope);
                return {
                    name: parsed?.name || name,
                    token: parsed?.token || `@${name.replace(/^@/, "")}`,
                    value: mergedParameterValues[parsed?.name || name] ?? "",
                    locked: Boolean(detectedStepParameters.find(parameter => parameter.name === name)?.sensitive)
                };
            });
        };
        return [
            { scope: "t" as const, title: "Test case data", rows: buildRows("t") },
            { scope: "s" as const, title: selectedParameterSuite ? `Suite data · ${selectedParameterSuite.name}` : "Suite-shared data", rows: buildRows("s") },
            { scope: "r" as const, title: "Run data", rows: buildRows("r") }
        ].filter((group) => group.rows.length);
    }, [detectedStepParameters, selectedParameterSuite, suiteParameterValues, testCaseParameterValues, mergedParameterValues]);
    const automationDataTokens = useMemo(() => Array.from(new Set([
        ...inlineTestDataGroups.flatMap((group) => group.rows.map((row) => row.token)),
        ...detectedStepParameters.map((parameter) => parameter.token)
    ])).sort((left, right) => left.localeCompare(right)), [inlineTestDataGroups, detectedStepParameters]);
    const needsAutomationSource = canViewAutomationCode && isAutomationCaseDetailReady && Boolean(activeCase)
        && (isAutomationCodePreviewOpen || (activeAutomationWorkspaceTab === "steps" && automationStepView === "code"));
    const needsAutomationGherkin = isAutomationCaseDetailReady && activeAutomationWorkspaceTab === "steps" && automationStepView === "gherkin";
    const exportEnvironmentsQuery = useQuery({ queryKey: ["test-environments", projectId, appTypeId], queryFn: () => api.testEnvironments.list({ project_id: projectId, app_type_id: appTypeId || undefined }), enabled: Boolean(projectId && selectedExecutionEnvironmentId && needsAutomationSource) });
    const exportConfigurationsQuery = useQuery({ queryKey: ["test-configurations", projectId, appTypeId], queryFn: () => api.testConfigurations.list({ project_id: projectId, app_type_id: appTypeId || undefined }), enabled: Boolean(projectId && selectedExecutionConfigurationId && needsAutomationSource) });
    const exportSourceSnapshot = useMemo(() => {
        if (!needsAutomationSource && !needsAutomationGherkin)
            return { steps: [], errors: [] };
        const errors: string[] = [];
        const steps = automatedSteps.map(step => {
            const draft = automationDraftStore.read("steps")[step.id] || parseAutomationStepDraft(step);
            const unchanged = automationMappingFieldsEqual(draft, parseAutomationStepDraft(step));
            const options = automationDraftStore.read("options")[step.id] || parseAutomationStepOptions(step);
            const mapping = resolveAutomationMappingSave({ currentCode: automationDraftStore.read("code")[step.id] ?? step.automation_code ?? "",
                previousMappingCode: buildAutomationCodeFromDraft(parseAutomationStepDraft(step)),
                nextMappingCode: automationMappingIsComplete(draft) ? buildAutomationCodeFromDraft(draft) : "", mappingUnchanged: unchanged });
            if (mapping.requiresProgramEditor)
                errors.push(`Section ${step.step_order}: edit its complete instructions or bind its inputs to change a recorded program. The original source is preserved.`);
            let code = canonicalizeSavedLocatorWrappers(mapping.code).source;
            if (!unchanged || JSON.stringify(options) !== JSON.stringify(parseAutomationStepOptions(step)))
                code = applyAutomationStepOptions(code, options);
            let request = unchanged || mapping.requiresProgramEditor ? step.api_request : buildAutomationApiRequest(draft, step.api_request);
            if (draft.step_type === "api" && automationDraftStore.read("api")[step.id] !== undefined) {
                try {
                    request = parseApiRequestSource(automationDraftStore.read("api")[step.id]);
                }
                catch (error) {
                    request = null;
                    errors.push(`Section ${step.step_order}: ${error instanceof Error ? error.message : "API source is invalid."}`);
                }
            }
            return { ...step, action: draft.name, expected_result: draft.expected_result, step_type: draft.step_type, automation_code: code, api_request: request };
        });
        return { steps, errors };
    }, [needsAutomationSource, needsAutomationGherkin, automatedSteps, automationDraftStore.read("steps"), automationDraftStore.read("code"), automationDraftStore.read("options"), automationDraftStore.read("api")]);
    const exportSteps = exportSourceSnapshot.steps;
    const exportInput = useMemo(() => ({
        testCase: {
            ...(activeCase || { id: "draft" }),
            title: caseDraft.title,
            execution_hooks: mapCaseHooksToExecutionHooks(executionHookDraft)
        },
        steps: exportSteps,
        values: effectiveCaseParameterValues,
        suiteValues: suiteParameterValues,
        dataSet: testDataSets.find(item => item.id === (selectedExecutionDataSetId || effectiveCaseDataSetId)),
        repository: learningCache,
        baseURL: asArray(exportEnvironmentsQuery.data).find(item => item.id === selectedExecutionEnvironmentId)?.base_url || "",
        sensitiveNames: detectedStepParameters.filter(parameter => parameter.sensitive).map(parameter => parameter.name),
        sharedGroups: sharedStepGroups,
        dataSets: testDataSets,
        overrideSharedSteps,
        suiteOptions: selectedParameterSuite?.test_data_options,
        environment: asArray(exportEnvironmentsQuery.data).find(item => item.id === selectedExecutionEnvironmentId),
        configuration: asArray(exportConfigurationsQuery.data).find(item => item.id === selectedExecutionConfigurationId),
        runtimeSettings: testEngineIntegration?.config ?? undefined
    }), [activeCase, caseDraft.title, executionHookDraft, exportSteps, effectiveCaseParameterValues, suiteParameterValues,
        testDataSets, selectedExecutionDataSetId, effectiveCaseDataSetId, learningCache, exportEnvironmentsQuery.data,
        exportConfigurationsQuery.data, selectedExecutionEnvironmentId, selectedExecutionConfigurationId, detectedStepParameters,
        sharedStepGroups, overrideSharedSteps, selectedParameterSuite?.test_data_options, parameterPreviewRevision, testEngineIntegration?.config]);
    const exportContextQueries = [automatedStepsQuery, testDataSetsQuery, learningCacheQuery, sharedStepGroupsQuery, exportEnvironmentsQuery, exportConfigurationsQuery, testEngineIntegrationsQuery];
    const exportDataLoading = exportContextQueries.some(query => query.isFetching);
    const exportDataError = exportContextQueries.some(query => query.isError);
    const exportSourceInvalid = exportSourceSnapshot.errors.length > 0;
    const exportPreview = useAutomationExportPreview({ enabled: needsAutomationSource, ready: !exportDataLoading && !exportDataError && !exportSourceInvalid, input: exportInput });
    const completeAutomationCode = exportPreview.code;
    const exportContextLoading = exportDataLoading || exportPreview.loading;
    const exportContextError = exportDataError || Boolean(exportPreview.error);
    const exportPreviewCode = exportContextLoading ? "// Loading execution context and source compiler…" : exportContextError ? "// Automation source could not be prepared. Retry before copying the export." : exportSourceInvalid ? `// Correct the current API source before exporting.\n${exportSourceSnapshot.errors.map(message => `// ${message}`).join("\n")}` : completeAutomationCode;
    const retryExportContext = () => { exportPreview.retry(); void Promise.all(exportContextQueries.filter(query => query.isError).map(query => query.refetch())); };
    const automationGherkin = useMemo(() => needsAutomationGherkin ? buildAutomationGherkin(caseDraft.title, exportSteps, testDataSets.find(item => item.id === effectiveCaseDataSetId), { repository: learningCache, parameterValues: resolvedParameterValues }) : "", [needsAutomationGherkin, caseDraft.title, exportSteps, testDataSets, effectiveCaseDataSetId, learningCache, resolvedParameterValues]);
    const caseRepositorySteps = useMemo(() => automatedSteps.map((step) => {
        const draft = automationDraftStore.read("steps")[step.id];
        const spec = draft ? getAutomationKeywordInputSpec(draft.keyword, draft.step_type) : null;
        return {
            id: step.id,
            automation_source_sha256: automationDraftStore.read("code")[step.id] === undefined || automationDraftStore.read("code")[step.id] === step.automation_code ? step.automation_source_sha256 || undefined : undefined,
            automation_context_sha256: automatedSteps.slice(0, automatedSteps.findIndex(row => row.id === step.id)).every(row => automationDraftStore.read("code")[row.id] === undefined || automationDraftStore.read("code")[row.id] === row.automation_code) ? step.automation_context_sha256 || undefined : undefined,
            automation_code: automationDraftStore.read("code")[step.id] ?? step.automation_code,
            objectRefs: [spec?.target === "repository" ? draft?.objectRef || "" : "", spec?.valueTarget === "repository" ? draft?.value || "" : ""]
        };
    }), [automatedSteps, automationDraftStore.read("code"), automationDraftStore.read("steps")]);
    const repositoryMemberCount = useMemo(() => learningCache.filter(entry => !isNonElementRepositoryEntry(entry)).length, [learningCache]);
    const caseObjectBindingCount = useMemo(() => collectCaseRepositoryPages({ entries: learningCache, steps: caseRepositorySteps, values: resolvedParameterValues, caseId: activeCase?.id || '' }).members.length, [learningCache, caseRepositorySteps, resolvedParameterValues, activeCase?.id]);
    const activeAutomationCaseType = resolveAutomationCaseType(activeCase, automatedSteps, selectedRuntimeType);
    const automationRuntimeTypes = getAutomationBuildRuntimeTypes(automatedSteps, activeAutomationCaseType);
    const canVerifyBuild = automationRuntimeTypes.every(type => type === "web") && canRunLocalAutomation && hasPermission(session, "run.create", projectId);
    const buildPipelineOptions = automationBuildPipelineRequest({ mode: buildVerificationMode, driver: "mcp", canVerify: canVerifyBuild, interactive: allowBrowserActions, hasEnvironment: Boolean(selectedExecutionEnvironmentId) });
    const detailIncompatibleRuntimes = incompatibleAutomationRuntimes(caseDraft.automationCaseType, automatedSteps);
    const automationStartUrlRequired = automationRuntimeTypes.includes("web");
    const automationStartUrlValidation = automationStartUrlError(startUrl, automationStartUrlRequired);
    const batchBuildRuntimes = batchBuildReadinessQuery.data?.flatMap(result => result.runtimes) || [];
    const batchStartUrlRequired = batchBuildRuntimes.includes("web");
    const batchHasUrlRuntime = batchStartUrlRequired || batchBuildRuntimes.includes("api");
    const batchStartUrlValidation = automationStartUrlError(batchStartUrl, batchStartUrlRequired);
    const inferredRecorderPlatform = getRecorderPlatform(automatedSteps, recordingTargetStepId, activeAutomationCaseType);
    const recorderPlatform: ReturnType<typeof getRecorderPlatform> = !recordingTargetStepId && (!automatedSteps.length || inferredRecorderPlatform === "api") && activeAutomationCaseType !== "api"
        ? activeAutomationCaseType : inferredRecorderPlatform;
    const canRecordCurrentPlan = canUseRecorder && recorderPlatform !== "api" && (!["android", "ios"].includes(recorderPlatform) || canUseMobileAppium);
    const allowedStepTypes = getAllowedAutomationStepTypes(activeAutomationCaseType, canUseMobileAppium);
    return { canVerifyBuild, buildPipelineOptions, reviewBuildParameters, parameterReviewDialog, inspectAgent, needsAutomationEditorData, needsAutomationRepository, appTypesQuery, testCasesQuery, selectedAutomationCaseDetailQuery, selectedAutomationCaseDetail, isAutomationCaseDetailPending, learningCacheQuery, automatedStepsQuery, automationMetricsQuery, automationMetrics, selectedCaseHistoryQuery, suitesQuery, requirementsQuery, modulesQuery, testDataSetsQuery, automationLlmIntegrationsQuery, testEngineIntegrationsQuery, sharedStepGroupsQuery, appTypes, testCases, testDataSets, automationRequirements, automationModules, learningCache, suites, testEngineIntegration, mobileRemoteRecorderEnabled, sharedStepGroups, automatedCases, automationDisplayIdByCaseId, manualCases, metadataOptions, selectedCaseSummary, activeCase, canRemoveAutomationCase, isAutomationCaseDetailReady, linkedManualCases, linkedManualCaseIds, linkedManualStepsQuery, automatedSteps, unsavedAutomationStepIds, inspectSavedPlans, batchBuildReadinessQuery, activeCaseHistory, activeCaseSuiteIds, selectedParameterSuite, inheritedManualParameterValues, effectiveCaseParameterValues, effectiveCaseDataSetId, casePrivateNames, caseParameterPrivacyScope, visiblePrivateNames, initialEngineerValues, inheritedParameterDefaults, mergedParameterValues, resolvedParameterValues, detectedStepParameters, recorderParameterDefinitions, automationStepGroups, inlineTestDataGroups, automationDataTokens, needsAutomationSource, needsAutomationGherkin, exportEnvironmentsQuery, exportConfigurationsQuery, exportSourceSnapshot, exportSteps, exportInput, exportContextQueries, exportDataLoading, exportDataError, exportSourceInvalid, exportPreview, completeAutomationCode, exportContextLoading, exportContextError, exportPreviewCode, retryExportContext, automationGherkin, caseRepositorySteps, repositoryMemberCount, caseObjectBindingCount, selectedRuntimeType, activeAutomationCaseType, automationRuntimeTypes, detailIncompatibleRuntimes, automationStartUrlRequired, automationStartUrlValidation, batchStartUrlRequired, batchHasUrlRuntime, batchStartUrlValidation, inferredRecorderPlatform, recorderPlatform, canRecordCurrentPlan, allowedStepTypes };
}
export type AutomationCaseModel = ReturnType<typeof useAutomationCaseModel>;
