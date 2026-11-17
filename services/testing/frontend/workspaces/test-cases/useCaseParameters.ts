import type { SessionPayload } from "@hellotest/platform/frontend/src/types";
import type { UseInfiniteQueryResult, UseQueryResult } from "@tanstack/react-query";
import type { SafePagedResult } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type { QueryClient, UseMutationResult, InfiniteData } from '@tanstack/react-query';
import { testCaseDetailQueryKey, normalizeTestCaseParameterValues, normalizeSuiteParameterValues, areTestCaseParameterValuesEqual, readStoredTestCaseParameterDraft, hasStoredTestCaseParameterDraft, writeStoredTestCaseParameterDraft, clearStoredTestCaseParameterDraft } from "./testCaseWorkspaceUtils";
import { type TestCaseDraft, type StepDraft, type DraftTestStep } from "./testCaseWorkspaceTypes";
import { useEffect, useMemo } from "react";

import { normalizeGherkinParameterReferences } from "./../../lib/gherkin";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { migrateCaseParameterScope } from "./../../lib/caseParameterScope";
import { casePrivateParameterNames, caseParameterSaveOptions, caseParameterDraftValues, restoreCaseParameterDraftValues, isPrivateParameterName } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { formatReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { findByRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import { normalizeApiRequest, normalizeStepType, stepHasAutomation } from "@hellotest/automation/frontend/lib/stepAutomation";
import { collectCaseStepParameters, parseStepParameterName, type StepParameterDefinition, type StepParameterScope } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { TestCase, TestDataSet, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";

export interface useCaseParametersInputs {
  queryClient: QueryClient;
  searchParams: URLSearchParams;
  session: SessionPayload | null;
  projectId: string;
  appTypeId: string;
  setAppTypeId: (nextAppTypeId: string) => void;
  canCreateTestCases: boolean;
  canUpdateTestCases: boolean;
  canViewTestData: boolean;
  canUpdateSuites: boolean;
  canViewAutomationCode: boolean;
  canEditAutomationCode: boolean;
  selectedTestCaseId: string;
  setSelectedTestCaseId: React.Dispatch<React.SetStateAction<string>>;
  currentCaseLinkScopeRef: React.MutableRefObject<string>;
  testCasesQuery: UseInfiniteQueryResult<InfiniteData<SafePagedResult<TestCase>, unknown>, Error>;
  isCreating: boolean;
  lastCaseDraftSeedRef: React.MutableRefObject<string>;
  lastTestCaseParameterSeedRef: React.MutableRefObject<string>;
  defaultTestCaseStatus: string;
  defaultTestCaseAutomated: "no";
  emptyCaseDraft: TestCaseDraft;
  caseDraft: TestCaseDraft;
  setCaseDraft: React.Dispatch<React.SetStateAction<TestCaseDraft>>;
  setDraftSteps: React.Dispatch<React.SetStateAction<DraftTestStep[]>>;
  setIsCaseParameterDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasParameterScopeDraft: boolean;
  setHasParameterScopeDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setLinkedDataSetDraftIds: React.Dispatch<React.SetStateAction<string[]>>;
  overrideSharedGroupData: boolean;
  setOverrideSharedGroupData: React.Dispatch<React.SetStateAction<boolean>>;
  testCaseParameterValues: Record<string, string>;
  setTestCaseParameterValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  privateCaseParameterDraft: { scope: string; names: string[]; };
  setPrivateCaseParameterDraft: React.Dispatch<React.SetStateAction<{ scope: string; names: string[]; }>>;
  caseParameterOverrideDraftRef: React.MutableRefObject<{ scope: string; names: Set<string>; }>;
  pendingCaseParameterSaveRef: React.MutableRefObject<{ id: string; promise: ReturnType<typeof api.testCases.update>; } | null>;
  caseParameterAutosaveTimeoutRef: React.MutableRefObject<number | null>;
  isOpeningLinkedAutomation: boolean;
  suiteParameterValues: Record<string, string>;
  setSuiteParameterValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setRunPreviewParameterValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedParameterSuiteId: string;
  setSelectedParameterSuiteId: React.Dispatch<React.SetStateAction<string>>;
  stepDrafts: Record<string, StepDraft>;
  setStepDrafts: React.Dispatch<React.SetStateAction<Record<string, StepDraft>>>;
  suppressCaseSelectionFromUrlRef: React.MutableRefObject<boolean>;
  deepLinkTestCasesQuery: UseQueryResult<TestCase, Error>;
  updateSuite: UseMutationResult<{ updated: boolean; revision: number; }, Error, { id: string; input: Parameters<typeof api.testSuites.update>[1]; }, unknown>;
  updateTestCase: UseMutationResult<{ updated: boolean; revision: number; }, Error, { id: string; input: Parameters<typeof api.testCases.update>[1]; }, unknown>;
  persistCaseParameterValues: UseMutationResult<{ updated: boolean; revision: number; }, Error, { id: string; parameter_values: Record<string, string>; test_data_options?: TestCase["test_data_options"]; test_data_set_ids?: string[]; expected_revision?: number; }, unknown>;
  testCases: TestCase[];
  deepLinkTestCases: TestCase[];
  displaySteps: TestStep[];
  showError: (error: unknown, fallback: string) => void;
  syncTestCaseSearchParams: (nextCaseId?: string | null) => void;
  selectedTestCase: TestCase | null;
  linkedDataSetId: string;
  linkedDataSet: Pick<TestDataSet, "app_type_id" | "id" | "name" | "description" | "mode" | "columns" | "rows"> | null;
  linkedDataSetParameterDefinitions: StepParameterDefinition[];
  caseParameterPrivacyScope: string;
  linkedDataSetSensitiveParameterNames: Set<string>;
  isSelectedTestCaseDetailPending: boolean;
  selectedCaseModuleId: string;
  selectedCaseSuiteIds: string[];
  selectedParameterSuite: TestSuite | null;
  createCaseParameterDraftScopeKey: string;
  selectedCaseParameterDraftScopeKey: string;
  activeTestCaseParameterSeedKey: string;
  mergedScopedParameterValues: Record<string, string>;
}

export function useCaseParameters({ queryClient, searchParams, session, projectId, appTypeId, setAppTypeId, canCreateTestCases, canUpdateTestCases, canViewTestData, canUpdateSuites, canViewAutomationCode, canEditAutomationCode, selectedTestCaseId, setSelectedTestCaseId, currentCaseLinkScopeRef, testCasesQuery, isCreating, lastCaseDraftSeedRef, lastTestCaseParameterSeedRef, defaultTestCaseStatus, defaultTestCaseAutomated, emptyCaseDraft, caseDraft, setCaseDraft, setDraftSteps, setIsCaseParameterDialogOpen, hasParameterScopeDraft, setHasParameterScopeDraft, setLinkedDataSetDraftIds, overrideSharedGroupData, setOverrideSharedGroupData, testCaseParameterValues, setTestCaseParameterValues, privateCaseParameterDraft, setPrivateCaseParameterDraft, caseParameterOverrideDraftRef, pendingCaseParameterSaveRef, caseParameterAutosaveTimeoutRef, isOpeningLinkedAutomation, suiteParameterValues, setSuiteParameterValues, setRunPreviewParameterValues, selectedParameterSuiteId, setSelectedParameterSuiteId, stepDrafts, setStepDrafts, suppressCaseSelectionFromUrlRef, deepLinkTestCasesQuery, updateSuite, updateTestCase, persistCaseParameterValues, testCases, deepLinkTestCases, displaySteps, showError, syncTestCaseSearchParams, selectedTestCase, linkedDataSetId, linkedDataSet, linkedDataSetParameterDefinitions, caseParameterPrivacyScope, linkedDataSetSensitiveParameterNames, isSelectedTestCaseDetailPending, selectedCaseModuleId, selectedCaseSuiteIds, selectedParameterSuite, createCaseParameterDraftScopeKey, selectedCaseParameterDraftScopeKey, activeTestCaseParameterSeedKey, mergedScopedParameterValues }: useCaseParametersInputs) {
const resolveScopedParameterInputState = (scope: StepParameterScope) => {
    if (isCreating ? !canCreateTestCases : !canUpdateTestCases) return { disabled: true, hint: "Test Case update access is required to edit these parameters." };
    if (scope === "s" && !canUpdateSuites) return { disabled: true, hint: "Suite update access is required to edit shared values." };
    if (scope === "s") {
      if (!selectedCaseSuiteIds.length) {
        return {
          disabled: true,
          hint: "Link this case to a suite before saving suite-shared values."
        };
      }

      if (!selectedParameterSuite) {
        return {
          disabled: true,
          hint: "Choose a suite target before editing suite-shared values."
        };
      }

      return {
        disabled: false,
        hint: selectedCaseSuiteIds.length > 1
          ? `Saved on suite "${selectedParameterSuite.name}".`
          : `Saved on linked suite "${selectedParameterSuite.name}".`
      };
    }

    if (scope === "r") {
      return {
        disabled: false,
        hint: "Saved as a Test Case default. Explicit run values can replace it during execution."
      };
    }

    return {
      disabled: false,
      hint: isCreating
        ? "Saved with this draft test case."
        : "Saved on this test case and reused across its steps."
    };
  };

const handleScopedParameterValueChange = (name: string, value: string) => {
    const parsed = parseStepParameterName(name);

    if (!parsed || resolveScopedParameterInputState(parsed.scope).disabled) {
      return;
    }

    if (parsed.scope === "s") {
      setSuiteParameterValues((current) => ({
        ...current,
        [parsed.name]: value
      }));
      return;
    }

    if (linkedDataSetSensitiveParameterNames.has(parsed.name)) setPrivateCaseParameterDraft(current => ({ scope: caseParameterPrivacyScope, names: [...new Set([...(current.scope === caseParameterPrivacyScope ? current.names : []), parsed.name])] }));
    if (caseParameterOverrideDraftRef.current.scope !== caseParameterPrivacyScope) caseParameterOverrideDraftRef.current = { scope: caseParameterPrivacyScope, names: new Set() };
    caseParameterOverrideDraftRef.current.names.add(parsed.name);
    if (parsed.scope === "r") setRunPreviewParameterValues(current => { const next = { ...current }; delete next[parsed.name]; return next; });
    setTestCaseParameterValues((current) => ({
      ...current,
      [parsed.name]: value
    }));
  };

const resolveParameterScopeState = (parameter: StepParameterDefinition, scope: StepParameterScope) => {
    if (persistCaseParameterValues.isPending || updateTestCase.isPending || updateSuite.isPending) return { disabled: true, hint: "Wait for the current save to finish." };
    if (!canEditAutomationCode && displaySteps.some(step => ("automation_source_hidden" in step && step.automation_source_hidden) || stepHasAutomation(step) || stepHasAutomation({ ...step, ...stepDrafts[step.id] }))) return { disabled: true, hint: "Automation build access is required to save scope changes for a case with automation." };
    if (linkedDataSetParameterDefinitions.some(item => item.name === parameter.name)) return { disabled: true, hint: "Change linked parameter scopes in the Data Set." };
    if (displaySteps.some(step => step.reusable_group_id && parameter.stepIds.includes(step.id))) return { disabled: true, hint: "Change shared parameter scopes in the Shared Step Group." };
    if (scope === "s" && parameter.sensitive && !isPrivateParameterName(`s.${parameter.rawName}`)) return { disabled: true, hint: "Keep private defaults on the test case, or configure them in the Suite's test data." };
    if (!Object.prototype.hasOwnProperty.call(normalizeTestCaseParameterValues(testCaseParameterValues), parameter.name)
      && !(parameter.scope === "s" && Object.prototype.hasOwnProperty.call(suiteParameterValues, parameter.name))) return { disabled: true, hint: "Set a parameter value before changing its scope." };
    return resolveScopedParameterInputState(scope);
  };

const handleParameterScopeChange = (name: string, scope: StepParameterScope) => {
    const parameter = detectedStepParameters.find(item => item.name === name);
    if (!parameter || parameter.scope === scope || resolveParameterScopeState(parameter, scope).disabled) return;
    try {
      const target = `${scope}.${parameter.rawName}`;
      if (Object.prototype.hasOwnProperty.call(mergedScopedParameterValues, target)) throw new Error(`@${target} already exists. Rename one parameter before changing its scope.`);
      const ownValues = normalizeTestCaseParameterValues(testCaseParameterValues);
      if (!Object.prototype.hasOwnProperty.call(ownValues, name)) ownValues[name] = suiteParameterValues[name];
      const next = migrateCaseParameterScope({ name, scope, values: ownValues, title: caseDraft.title, description: caseDraft.description,
        gherkin_document: caseDraft.gherkin_document, steps: displaySteps.map(step => ({ ...step, ...stepDrafts[step.id] })) });
      // References and their defaults belong to the same case save. Do not let
      // the value-only autosave commit a half-migrated parameter.
      if (caseParameterAutosaveTimeoutRef.current !== null) window.clearTimeout(caseParameterAutosaveTimeoutRef.current);
      caseParameterAutosaveTimeoutRef.current = null;
      setHasParameterScopeDraft(true);
      if (scope === "s") {
        const value = next.parameter_values[target];
        setSuiteParameterValues(current => ({ ...current, [target]: value }));
        delete next.parameter_values[target];
      }
      setTestCaseParameterValues(next.parameter_values);
      setRunPreviewParameterValues(current => { const nextValues = { ...current }; delete nextValues[name]; delete nextValues[target]; return nextValues; });
      setCaseDraft(current => ({ ...current, title: next.title, description: next.description, gherkin_document: next.gherkin_document }));
      if (isCreating) setDraftSteps(current => current.map(step => {
        const migrated = next.steps.find(item => item.id === step.id);
        return migrated ? { ...step, action: migrated.action, expected_result: migrated.expected_result,
          automation_code: migrated.automation_code, api_request: migrated.api_request } : step;
      }));
      else setStepDrafts(current => ({ ...current, ...Object.fromEntries(next.steps.map(step => [step.id, {
        action: step.action || "", expected_result: step.expected_result || "", step_type: normalizeStepType(step.step_type),
        automation_code: step.automation_code || "", api_request: normalizeApiRequest(step.api_request)
      }])) }));
      if (caseParameterOverrideDraftRef.current.scope !== caseParameterPrivacyScope) caseParameterOverrideDraftRef.current = { scope: caseParameterPrivacyScope, names: new Set() };
      caseParameterOverrideDraftRef.current.names.delete(name);
      if (scope !== "s") caseParameterOverrideDraftRef.current.names.add(target);
      setPrivateCaseParameterDraft(current => ({ scope: caseParameterPrivacyScope, names: [...new Set((current.scope === caseParameterPrivacyScope ? current.names : []).map(key => key === name ? target : key))] }));
    } catch (error) { showError(error, "Unable to change parameter scope"); }
  };

const syncCachedTestCaseParameterValues = (testCaseId: string, parameterValues: Record<string, string>, revision?: number, options?: TestCase["test_data_options"], dataSetIds?: string[]) => {
    const normalizedValues = normalizeTestCaseParameterValues(parameterValues);

    if (revision && selectedTestCaseId === testCaseId) {
      lastCaseDraftSeedRef.current = `case:${testCaseId}:${revision}:${selectedCaseModuleId}`;
      lastTestCaseParameterSeedRef.current = `case:${testCaseId}:${revision}`;
    }

    queryClient.setQueriesData<TestCase>({ queryKey: testCaseDetailQueryKey(projectId, testCaseId) }, (current) =>
      current
        ? {
            ...current,
            parameter_values: normalizedValues,
            ...(dataSetIds ? { test_data_set_ids: dataSetIds } : {}),
            ...(options ? { test_data_options: options } : {}),
            ...(revision ? { revision } : {})
          }
        : current
    );

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  parameter_values: normalizedValues,
                  ...(dataSetIds ? { test_data_set_ids: dataSetIds } : {}),
                  ...(options ? { test_data_options: options } : {})
                }
              : item
          )
        : current
    );
  };

const syncCachedTestCaseSuiteIds = (testCaseId: string, suiteIds: string[], revision?: number) => {
    const normalizedSuiteIds = Array.from(new Set(suiteIds.filter(Boolean)));
    if (revision && currentCaseLinkScopeRef.current === `${projectId}:${testCaseId}`) {
      // A relationship-only revision must not reseed unsaved metadata, Gherkin, or parameter drafts.
      lastCaseDraftSeedRef.current = `case:${testCaseId}:${revision}:${selectedCaseModuleId}`;
      lastTestCaseParameterSeedRef.current = `case:${testCaseId}:${revision}`;
    }
    queryClient.setQueriesData<TestCase>({ queryKey: testCaseDetailQueryKey(projectId, testCaseId) }, current => current ? {
      ...current, suite_id: normalizedSuiteIds[0] || null, suite_ids: normalizedSuiteIds,
      ...(revision ? { revision } : {})
    } : current);

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  suite_id: normalizedSuiteIds[0] || null,
                  suite_ids: normalizedSuiteIds
                }
              : item
          )
        : current
    );
  };

const syncCachedSuiteParameterValues = (suiteId: string, parameterValues: Record<string, string>) => {
    const normalizedValues = normalizeSuiteParameterValues(parameterValues);

    queryClient.setQueryData<TestSuite[]>(["test-case-suites", appTypeId], (current) =>
      current
        ? current.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  parameter_values: normalizedValues
                }
              : suite
          )
        : current
    );
  };

useEffect(() => {
    if (isCreating) {
      lastCaseDraftSeedRef.current = "__draft__";
      return;
    }

    if (!selectedTestCaseId) {
      // The create-link effect above is applying the incoming draft in this
      // same render. Its isCreating update has not reached this closure yet.
      if (searchParams.get("create") === "1") return;
      if (lastCaseDraftSeedRef.current !== "__none__") {
        setCaseDraft(emptyCaseDraft);
        setLinkedDataSetDraftIds([]);
    setOverrideSharedGroupData(false);
        lastCaseDraftSeedRef.current = "__none__";
      }
      return;
    }

    // Keep the requested workspace stable while its detail payload is loading.
    // Clearing the selection in this window made the module child flash closed
    // and then reopen once the route/query caught up.
    if (isSelectedTestCaseDetailPending) {
      return;
    }

    if (selectedTestCase) {
      const nextSeedKey = `case:${selectedTestCase.id}:${selectedTestCase.revision ?? selectedTestCase.updated_at ?? "detail"}:${selectedCaseModuleId}`;

      if (lastCaseDraftSeedRef.current === nextSeedKey) {
        return;
      }

      setCaseDraft({
        title: selectedTestCase.title,
        description: selectedTestCase.description || "",
        externalReferencesText: formatReferenceList(selectedTestCase.external_references),
        labelsText: formatReferenceList(selectedTestCase.labels),
        automated: (selectedTestCase.automated || defaultTestCaseAutomated) as "yes" | "no",
        priority: selectedTestCase.priority ?? 3,
        status: selectedTestCase.status || defaultTestCaseStatus,
        requirement_id: selectedTestCase.requirement_ids?.[0] || selectedTestCase.requirement_id || "",
        module_id: selectedCaseModuleId,
        author_id: selectedTestCase.author_id || selectedTestCase.author?.id || selectedTestCase.created_by || session?.user.id || "",
        reviewer_id: selectedTestCase.reviewer_id || "",
        authoring_mode: selectedTestCase.authoring_mode || "structured",
        test_case_type: selectedTestCase.test_case_type || "functional",
        gherkin_document: selectedTestCase.gherkin_document || ""
      });
      setLinkedDataSetDraftIds((selectedTestCase.test_data_set_ids || []).slice(0, 1));
      setOverrideSharedGroupData(selectedTestCase.test_data_options?.override_shared_steps !== false);
      lastCaseDraftSeedRef.current = nextSeedKey;
      return;
    }

    const requestedCaseId = searchParams.get("case");
    if (requestedCaseId) {
      const requestedCase = findByRoutableId(testCases, requestedCaseId);
      if (requestedCase) {
        setSelectedTestCaseId(requestedCase.id);
        return;
      }

      if (deepLinkTestCasesQuery.isLoading || deepLinkTestCasesQuery.isFetching) {
        return;
      }

      const deepLinkedCase = findByRoutableId(deepLinkTestCases, requestedCaseId);
      if (deepLinkedCase?.app_type_id && deepLinkedCase.app_type_id !== appTypeId) {
        setAppTypeId(deepLinkedCase.app_type_id);
        return;
      }

      if (deepLinkedCase && selectedTestCaseId === deepLinkedCase.id) {
        return;
      }

      if (selectedTestCaseId === requestedCaseId) {
        return;
      }
    }

    syncTestCaseSearchParams(null);
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
    setLinkedDataSetDraftIds([]);
    setOverrideSharedGroupData(false);
  }, [
    defaultTestCaseAutomated,
    defaultTestCaseStatus,
    emptyCaseDraft,
    appTypeId,
    deepLinkTestCases,
    deepLinkTestCasesQuery.isFetching,
    deepLinkTestCasesQuery.isLoading,
    isCreating,
    isSelectedTestCaseDetailPending,
    selectedCaseModuleId,
    selectedTestCase,
    selectedTestCaseId,
    searchParams,
    setAppTypeId,
    testCases
  ]);

useEffect(() => {
    if (isCreating) {
      const nextSeedKey = `draft:${appTypeId || "global"}`;

      if (lastTestCaseParameterSeedRef.current !== nextSeedKey) {
        setTestCaseParameterValues(caseParameterDraftValues(readStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey), linkedDataSetSensitiveParameterNames));
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = nextSeedKey;
      }
      return;
    }

    if (!selectedTestCaseId) {
      if (searchParams.get("create") === "1") return;
      if (lastTestCaseParameterSeedRef.current !== "__none__") {
        setTestCaseParameterValues({});
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = "__none__";
      }
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    const nextSeedKey = activeTestCaseParameterSeedKey;

    if (lastTestCaseParameterSeedRef.current === nextSeedKey) {
      return;
    }

    const storedDraft = readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey)
      ? restoreCaseParameterDraftValues(storedDraft, normalizeTestCaseParameterValues(selectedTestCase.parameter_values), linkedDataSetSensitiveParameterNames)
      : normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    setTestCaseParameterValues(nextValues);
    setIsCaseParameterDialogOpen(false);
    lastTestCaseParameterSeedRef.current = nextSeedKey;
  }, [
    activeTestCaseParameterSeedKey,
    appTypeId,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    linkedDataSetSensitiveParameterNames,
    searchParams,
    selectedTestCase,
    selectedTestCaseId
  ]);

useEffect(() => {
    if (!searchParams.get("case")) {
      suppressCaseSelectionFromUrlRef.current = false;
    }

    if (suppressCaseSelectionFromUrlRef.current) {
      return;
    }

    if (isCreating || selectedTestCaseId) {
      return;
    }

    const requestedCaseId = searchParams.get("case");
    if (!requestedCaseId) {
      return;
    }

    if (testCasesQuery.isLoading || testCasesQuery.isFetching) {
      return;
    }

    const requestedCase = findByRoutableId(testCases, requestedCaseId);
    if (requestedCase) {
      setSelectedTestCaseId(requestedCase.id);
      if (requestedCase.display_id && requestedCaseId !== requestedCase.display_id) {
        syncTestCaseSearchParams(requestedCase.display_id);
      }
      return;
    }

    if (deepLinkTestCasesQuery.isLoading || deepLinkTestCasesQuery.isFetching) {
      return;
    }

    const deepLinkedCase = findByRoutableId(deepLinkTestCases, requestedCaseId);
    if (deepLinkedCase?.app_type_id && deepLinkedCase.app_type_id !== appTypeId) {
      setAppTypeId(deepLinkedCase.app_type_id);
      return;
    }

    if (deepLinkedCase) {
      setSelectedTestCaseId(deepLinkedCase.id);
    }
  }, [
    appTypeId,
    deepLinkTestCases,
    deepLinkTestCasesQuery.isFetching,
    deepLinkTestCasesQuery.isLoading,
    isCreating,
    searchParams,
    selectedTestCaseId,
    setAppTypeId,
    testCases,
    testCasesQuery.isFetching,
    testCasesQuery.isLoading
  ]);

useEffect(() => {
    if (!selectedCaseSuiteIds.length) {
      setSelectedParameterSuiteId("");
      setSuiteParameterValues({});
      return;
    }

    if (!selectedCaseSuiteIds.includes(selectedParameterSuiteId)) {
      setSelectedParameterSuiteId(selectedCaseSuiteIds[0] || "");
    }
  }, [selectedCaseSuiteIds, selectedParameterSuiteId]);

useEffect(() => {
    const scopeKey = isCreating ? createCaseParameterDraftScopeKey : selectedCaseParameterDraftScopeKey;

    if (!scopeKey || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey) {
      return;
    }

    if (!hasParameterScopeDraft) writeStoredTestCaseParameterDraft(scopeKey, caseParameterDraftValues(testCaseParameterValues, linkedDataSetSensitiveParameterNames));
  }, [
    activeTestCaseParameterSeedKey,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    linkedDataSetSensitiveParameterNames,
    hasParameterScopeDraft,
    testCaseParameterValues
  ]);

useEffect(() => {
    if (
      isCreating
      || hasParameterScopeDraft
      || !selectedTestCase
      || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey
      || persistCaseParameterValues.isPending
      || isOpeningLinkedAutomation
      || updateTestCase.isPending
      || linkedDataSetId !== (selectedTestCase.test_data_set_ids?.[0] || "")
      || overrideSharedGroupData !== (selectedTestCase.test_data_options?.override_shared_steps !== false)
    ) {
      return;
    }

    const normalizedCurrentValues = normalizeTestCaseParameterValues(testCaseParameterValues);
    const normalizedSavedValues = normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    const parameterSaveOptions = canViewTestData ? caseParameterSaveOptions(selectedTestCase.test_data_options, normalizedCurrentValues, selectedTestCase.parameter_values, linkedDataSetSensitiveParameterNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : []) : undefined;
    const priorityChanged = parameterSaveOptions && (parameterSaveOptions.parameter_overrides || []).join("\0") !== [...(selectedTestCase.test_data_options?.parameter_overrides || [])].sort().join("\0");
    if (areTestCaseParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues) && !priorityChanged) {
      clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      caseParameterAutosaveTimeoutRef.current = null;
      const promise = persistCaseParameterValues.mutateAsync({
        id: selectedTestCase.id,
        parameter_values: normalizedCurrentValues,
        ...(parameterSaveOptions ? { test_data_options: parameterSaveOptions } : {}),
        expected_revision: selectedTestCase.revision
      });
      const pending = { id: selectedTestCase.id, promise };
      pendingCaseParameterSaveRef.current = pending;
      void promise.then((response) => {
        syncCachedTestCaseParameterValues(selectedTestCase.id, normalizedCurrentValues, response.revision, parameterSaveOptions);
        if (areTestCaseParameterValuesEqual(readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey), caseParameterDraftValues(normalizedCurrentValues, linkedDataSetSensitiveParameterNames))) {
          clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
        }
      }).catch((error) => {
        showError(error, "Unable to store Test Params");
      }).finally(() => {
        if (pendingCaseParameterSaveRef.current === pending) pendingCaseParameterSaveRef.current = null;
      });
    }, 450);
    caseParameterAutosaveTimeoutRef.current = timeoutId;
    return () => {
      window.clearTimeout(timeoutId);
      if (caseParameterAutosaveTimeoutRef.current === timeoutId) caseParameterAutosaveTimeoutRef.current = null;
    };
  }, [
    activeTestCaseParameterSeedKey,
    hasParameterScopeDraft,
    isCreating,
    isOpeningLinkedAutomation,
    linkedDataSetId,
    linkedDataSetSensitiveParameterNames,
    canViewTestData,
    overrideSharedGroupData,
    persistCaseParameterValues.isPending,
    selectedCaseParameterDraftScopeKey,
    selectedTestCase,
    testCaseParameterValues,
    updateTestCase.isPending
  ]);

const detectedStepParameters = useMemo<StepParameterDefinition[]>(
    () => !isCreating && (!selectedTestCase || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey) ? [] : collectCaseStepParameters({
      steps: [
        { id: `${selectedTestCaseId || "draft"}:title`, action: caseDraft.authoring_mode === "gherkin" ? normalizeGherkinParameterReferences(caseDraft.title) : caseDraft.title, expected_result: richTextToPlainText(caseDraft.description), automation_code: "", api_request: null },
        ...displaySteps.map((step) => ({
          id: step.id,
          action: stepDrafts[step.id]?.action ?? step.action,
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
          automation_code: canViewAutomationCode ? stepDrafts[step.id]?.automation_code ?? step.automation_code : "",
          api_request: canViewAutomationCode ? stepDrafts[step.id]?.api_request ?? step.api_request : null
        })),
        ...(caseDraft.authoring_mode === "gherkin" && caseDraft.gherkin_document.trim()
          ? [{
              id: `${selectedTestCaseId || "draft"}:gherkin`,
              action: normalizeGherkinParameterReferences(caseDraft.gherkin_document.split("\n").filter((line) => !/^\s*[@#]/.test(line)).join("\n")),
              expected_result: "",
              automation_code: "",
              api_request: null
            }]
          : [])
      ],
      ownValues: testCaseParameterValues,
      availableValues: mergedScopedParameterValues,
      dataSet: linkedDataSet,
      privateNames: casePrivateParameterNames(selectedTestCase).concat(privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : [])
    }).map(parameter => linkedDataSetSensitiveParameterNames.has(parameter.name) ? {...parameter, sensitive: true} : parameter),
    [isCreating, selectedTestCase, activeTestCaseParameterSeedKey, canViewAutomationCode, caseDraft.title, caseDraft.description, caseDraft.authoring_mode, caseDraft.gherkin_document, displaySteps, linkedDataSet, linkedDataSetSensitiveParameterNames, mergedScopedParameterValues, testCaseParameterValues, selectedTestCaseId, stepDrafts, privateCaseParameterDraft, caseParameterPrivacyScope]
  );

return { resolveScopedParameterInputState, handleScopedParameterValueChange, resolveParameterScopeState, handleParameterScopeChange, syncCachedTestCaseParameterValues, syncCachedTestCaseSuiteIds, syncCachedSuiteParameterValues, detectedStepParameters };
}
