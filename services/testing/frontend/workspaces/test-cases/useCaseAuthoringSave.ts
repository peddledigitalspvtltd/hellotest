import type { TestDataSetMode, TestStepType, StepApiRequest } from "@hellotest/platform/frontend/src/types";
import type { QueryClient, UseMutationResult } from '@tanstack/react-query';
import type { SetURLSearchParams } from 'react-router-dom';
import type { SessionPayload } from '@hellotest/platform/frontend/src/types';
import { buildCaseStepsFromGherkin, calculateTestCaseAiQualityScore, normalizeSuiteParameterValues, areSuiteParameterValuesEqual, clearStoredTestCaseParameterDraft, clearStoredSuiteParameterDraft, normalizeDraftSteps, stripAutomationStepFields } from "./testCaseWorkspaceUtils";
import { type TestCaseDraft, type StepDraft, type DraftTestStep, type StepInsertionGroupContext, type TestCaseEditorSectionKey } from "./testCaseWorkspaceTypes";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { FormEvent } from "react";
import { sanitizeGherkinDocumentText, setGherkinFeatureTitle } from "./../../lib/gherkin";
import { caseParameterSaveOptions } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { buildDataSetPayload, type DataSetDraft } from "./../../pages/TestEnvironmentPage";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { type BugToTestCaseDraft } from "./../../lib/bugToTestCaseConversion";
import { parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { normalizeApiRequest, normalizeAutomationCode, normalizeStepType, stepHasAutomation } from "@hellotest/automation/frontend/lib/stepAutomation";
import type { TestCase, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";

export interface useCaseAuthoringSaveInputs {
  queryClient: QueryClient;
  projectId: string;
  appTypeId: string;
  can: (permission: string, overrideProjectId?: string | null | undefined) => boolean;
  canCreateTestCases: boolean;
  canUpdateTestCases: boolean;
  canViewRequirements: boolean;
  canViewTestData: boolean;
  canViewAutomationCode: boolean;
  canEditAutomationCode: boolean;
  reviewUserId: string;
  setSelectedTestCaseId: React.Dispatch<React.SetStateAction<string>>;
  isCreating: boolean;
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCaseDeliveryRelease: React.Dispatch<React.SetStateAction<string>>;
  setCaseDeliverySprint: React.Dispatch<React.SetStateAction<string>>;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<TestCaseEditorSectionKey, boolean>>>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setMessageTone: React.Dispatch<React.SetStateAction<"error" | "success">>;
  lastCaseSaveNoticeRef: React.MutableRefObject<string>;
  emptyDataSetDraft: DataSetDraft;
  caseDraft: TestCaseDraft;
  setCaseDraft: React.Dispatch<React.SetStateAction<TestCaseDraft>>;
  stepInsertIndex: number | null;
  setStepInsertIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setStepInsertGroupContext: React.Dispatch<React.SetStateAction<StepInsertionGroupContext | null>>;
  draftSteps: DraftTestStep[];
  setDraftSteps: React.Dispatch<React.SetStateAction<DraftTestStep[]>>;
  setSelectedStepIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHasParameterScopeDraft: React.Dispatch<React.SetStateAction<boolean>>;
  linkedDataSetDraftIds: string[];
  setLinkedDataSetDraftIds: React.Dispatch<React.SetStateAction<string[]>>;
  overrideSharedGroupData: boolean;
  setIsDataSetCreatorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newDataSetDraft: DataSetDraft;
  setNewDataSetDraft: React.Dispatch<React.SetStateAction<DataSetDraft>>;
  testCaseParameterValues: Record<string, string>;
  caseParameterOverrideDraftRef: React.MutableRefObject<{ scope: string; names: Set<string>; }>;
  suiteParameterValues: Record<string, string>;
  stepDrafts: Record<string, StepDraft>;
  createSuiteContextId: string;
  setCreateSuiteContextId: React.Dispatch<React.SetStateAction<string>>;
  activeBugConversion: BugToTestCaseDraft | null;
  setActiveBugConversion: React.Dispatch<React.SetStateAction<BugToTestCaseDraft | null>>;
  pendingDraftEvidenceRef: React.MutableRefObject<string[]>;
  retainAiEvidence: (caseId: string, ids: string[], scopeProject?: string) => Promise<boolean>;
  createTestCase: UseMutationResult<{ id: string; }, Error, { ai_generation_source?: "interactive"; app_type_id?: string; source_issue_id?: string; suite_id?: string; suite_ids?: string[]; title: string; description?: string; external_references?: string[]; labels?: string[]; parameter_values?: Record<string, string>; automated?: "yes" | "no"; automation_status?: "not_automated" | "ready" | "incomplete"; automation_case_type?: TestCase["automation_case_type"]; automation_start_url?: string | null; manual_test_case_id?: string | null; manual_test_case_ids?: string[]; execution_hooks?: TestCase["execution_hooks"]; authoring_mode?: "structured" | "gherkin"; test_case_type?: TestCase["test_case_type"]; gherkin_document?: string | null; test_data_set_ids?: string[]; test_data_options?: TestDataOptions; priority?: number; status?: string; requirement_id?: string; requirement_ids?: string[]; author_id?: string; reviewer_id?: string | null; review_status?: TestCase["review_status"]; ai_quality_score?: number | null; steps?: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string; }>; }, unknown>;
  createTestDataSet: UseMutationResult<{ id: string; }, Error, { project_id: string; app_type_id?: string; name: string; description?: string; mode: TestDataSetMode; columns?: string[]; rows?: Array<Record<string, string>>; }, unknown>;
  assignCasesToModule: UseMutationResult<{ updated: boolean; assigned: number; }, Error, { id: string; testCaseIds: string[]; append?: boolean; }, unknown>;
  removeCasesFromModule: UseMutationResult<{ updated: boolean; removed: number; retained_test_case_ids?: string[]; message?: string; }, Error, { id: string; testCaseIds: string[]; }, unknown>;
  updateSuite: UseMutationResult<{ updated: boolean; revision: number; }, Error, { id: string; input: Parameters<typeof api.testSuites.update>[1]; }, unknown>;
  updateTestCase: UseMutationResult<{ updated: boolean; revision: number; }, Error, { id: string; input: Parameters<typeof api.testCases.update>[1]; }, unknown>;
  linkedRequirementTitle: string;
  displaySteps: { id: string; test_case_id: string; step_order: number; action: string; expected_result: string; step_type: TestStepType | null | undefined; automation_code: string; api_request: StepApiRequest | null | undefined; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null; }[] | TestStep[];
  showSuccess: (text: string) => void;
  showError: (error: unknown, fallback: string) => void;
  syncTestCaseSearchParams: (nextCaseId?: string | null) => void;
  selectedTestCase: TestCase | null;
  canCreateAndLinkTestData: boolean;
  caseParameterPrivacyScope: string;
  linkedDataSetSensitiveParameterNames: Set<string>;
  isSelectedTestCaseDetailPending: boolean;
  selectedCaseModuleId: string;
  selectedParameterSuite: TestSuite | null;
  createCaseParameterDraftScopeKey: string;
  selectedCaseParameterDraftScopeKey: string;
  selectedSuiteParameterDraftScopeKey: string;
  visibleTestCaseParameterValues: Record<string, string>;
  syncCachedTestCaseParameterValues: (testCaseId: string, parameterValues: Record<string, string>, revision?: number, options?: TestCase["test_data_options"], dataSetIds?: string[]) => void;
  syncCachedSuiteParameterValues: (suiteId: string, parameterValues: Record<string, string>) => void;
  refreshCases: () => Promise<void>;
  refreshSharedGroups: () => Promise<void>;
  clearStepSelectionIfClipboardActive: () => void;
}

export function useCaseAuthoringSave({ queryClient, projectId, appTypeId, can, canCreateTestCases, canUpdateTestCases, canViewRequirements, canViewTestData, canViewAutomationCode, canEditAutomationCode, reviewUserId, setSelectedTestCaseId, isCreating, setIsCreating, setCaseDeliveryRelease, setCaseDeliverySprint, setExpandedSections, setMessage, setMessageTone, lastCaseSaveNoticeRef, emptyDataSetDraft, caseDraft, setCaseDraft, stepInsertIndex, setStepInsertIndex, setStepInsertGroupContext, draftSteps, setDraftSteps, setSelectedStepIds, setHasParameterScopeDraft, linkedDataSetDraftIds, setLinkedDataSetDraftIds, overrideSharedGroupData, setIsDataSetCreatorOpen, newDataSetDraft, setNewDataSetDraft, testCaseParameterValues, caseParameterOverrideDraftRef, suiteParameterValues, stepDrafts, createSuiteContextId, setCreateSuiteContextId, activeBugConversion, setActiveBugConversion, pendingDraftEvidenceRef, retainAiEvidence, createTestCase, createTestDataSet, assignCasesToModule, removeCasesFromModule, updateSuite, updateTestCase, linkedRequirementTitle, displaySteps, showSuccess, showError, syncTestCaseSearchParams, selectedTestCase, canCreateAndLinkTestData, caseParameterPrivacyScope, linkedDataSetSensitiveParameterNames, isSelectedTestCaseDetailPending, selectedCaseModuleId, selectedParameterSuite, createCaseParameterDraftScopeKey, selectedCaseParameterDraftScopeKey, selectedSuiteParameterDraftScopeKey, visibleTestCaseParameterValues, syncCachedTestCaseParameterValues, syncCachedSuiteParameterValues, refreshCases, refreshSharedGroups, clearStepSelectionIfClipboardActive }: useCaseAuthoringSaveInputs) {
const persistSelectedSuiteParameterValues = async () => {
    if (!selectedParameterSuite) {
      return;
    }

    const normalizedCurrentValues = normalizeSuiteParameterValues(suiteParameterValues);
    const normalizedSavedValues = normalizeSuiteParameterValues(selectedParameterSuite.parameter_values);

    if (areSuiteParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
      return;
    }

    await updateSuite.mutateAsync({
      id: selectedParameterSuite.id,
      input: {
        parameter_values: normalizedCurrentValues
      }
    });
    syncCachedSuiteParameterValues(selectedParameterSuite.id, normalizedCurrentValues);
    clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
  };

const handleCreateAndLinkDataSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateAndLinkTestData) {
      showError(new Error("Data Set management and Test Case edit permissions are required."), "Unable to create data set");
      return;
    }
    if (!projectId) return;
    try {
      const { payload, didSanitizeInvalidChars } = buildDataSetPayload(projectId, appTypeId || undefined, newDataSetDraft);
      if (!payload.name) {
        showError(new Error("Provide a data set name."), "Unable to create data set");
        return;
      }
      const created = await createTestDataSet.mutateAsync(payload);
      setLinkedDataSetDraftIds([created.id]);
      setNewDataSetDraft(emptyDataSetDraft);
      setIsDataSetCreatorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["test-data-sets", projectId, appTypeId] });
      showSuccess(didSanitizeInvalidChars
        ? "Data set created and selected. Invalid characters were removed automatically; save the test case to keep the link."
        : "Data set created and selected. Save the test case to keep this relationship.");
    } catch (error) {
      showError(error, "Unable to create data set");
    }
  };

const handleSaveCaseDirect = async (announce = true, stepOverrides: Record<string, StepDraft> = {}) => {
		    if ((isCreating && !canCreateTestCases) || (!isCreating && !canUpdateTestCases)) {
		      showError(new Error(`Permission required: ${isCreating ? "testcase.create" : "testcase.update"}`), isCreating ? "Unable to create test case" : "Unable to update test case");
		      return false;
		    }

		    if (!isCreating && (!selectedTestCase || isSelectedTestCaseDetailPending)) {
		      showError(new Error("Wait for the complete test case details to load before saving."), "Unable to update test case");
		      return false;
		    }

	    try {
	      await persistSelectedSuiteParameterValues();
      const labels = parseReferenceList(caseDraft.labelsText);
      const sanitizedGherkinDocument = sanitizeGherkinDocumentText(caseDraft.gherkin_document);
      const persistedGherkinDocument = linkedRequirementTitle
        ? setGherkinFeatureTitle(sanitizedGherkinDocument, linkedRequirementTitle)
        : sanitizedGherkinDocument;
      const persistedSteps = displaySteps.map((step, index) => {
        const draft = stepOverrides[step.id] || stepDrafts[step.id];
        const persistedStep = {
          id: step.id,
          test_case_id: step.test_case_id,
          step_order: index + 1,
          action: draft?.action ?? step.action ?? "",
          expected_result: draft?.expected_result ?? step.expected_result ?? "",
          step_type: normalizeStepType(draft?.step_type || step.step_type),
          automation_code: normalizeAutomationCode(draft?.automation_code ?? step.automation_code),
          api_request: normalizeApiRequest(draft?.api_request ?? step.api_request),
          group_id: step.group_id || null,
          group_name: step.group_name || null,
          group_kind: step.group_kind || null,
          reusable_group_id: step.reusable_group_id || null
        };
        return persistedStep;
      });
      const authoredSteps = caseDraft.authoring_mode === "gherkin"
        ? buildCaseStepsFromGherkin(persistedGherkinDocument, persistedSteps)
            .map((step, index) => ({ ...step, step_order: index + 1 }))
        : persistedSteps;
      const savedSteps = authoredSteps.map((step) => canEditAutomationCode ? step : stripAutomationStepFields(step));
      const resolvedAiQualityScore = calculateTestCaseAiQualityScore({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: authoredSteps,
        requirementId: caseDraft.requirement_id,
        labels,
        parameterValues: visibleTestCaseParameterValues
      });

      if (isCreating) {
        lastCaseSaveNoticeRef.current = "";
        const requirementIds = canViewRequirements ? [...new Set([
          ...(caseDraft.requirement_id ? [caseDraft.requirement_id] : []),
          ...(activeBugConversion?.requirementIds || [])
        ])] : [];
        const moduleIds = [...new Set([
          ...(caseDraft.module_id ? [caseDraft.module_id] : []),
          ...(activeBugConversion?.moduleIds || [])
        ])];
        const suiteIds = can("suite.view") ? [...new Set([
          ...(createSuiteContextId ? [createSuiteContextId] : []),
          ...(activeBugConversion?.suiteIds || [])
        ])] : [];
        const response = await createTestCase.mutateAsync({
          app_type_id: appTypeId,
          source_issue_id: activeBugConversion?.bugId,
          suite_ids: suiteIds,
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          external_references: parseReferenceList(caseDraft.externalReferencesText),
          labels,
          parameter_values: testCaseParameterValues,
          automated: "no",
          authoring_mode: caseDraft.authoring_mode,
          test_case_type: caseDraft.test_case_type,
          gherkin_document: persistedGherkinDocument || null,
          ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds.slice(0, 1), test_data_options: { ...caseParameterSaveOptions(undefined, testCaseParameterValues, {}, linkedDataSetSensitiveParameterNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : []), override_shared_steps: overrideSharedGroupData } } : {}),
          priority: Number(caseDraft.priority),
          status: caseDraft.status,
          requirement_ids: requirementIds,
          author_id: caseDraft.author_id,
          reviewer_id: caseDraft.reviewer_id || (caseDraft.ai_generation_source ? reviewUserId : null),
          review_status: caseDraft.reviewer_id || caseDraft.ai_generation_source ? "pending" : "not_requested",
          ...(caseDraft.ai_generation_source ? { ai_generation_source: caseDraft.ai_generation_source } : {}),
          ai_quality_score: resolvedAiQualityScore,
          steps: (caseDraft.authoring_mode === "gherkin" ? normalizeDraftSteps(authoredSteps) : normalizeDraftSteps(draftSteps)).map((step) => (
            canEditAutomationCode ? step : stripAutomationStepFields(step)
          ))
        });

        await retainAiEvidence(response.id,pendingDraftEvidenceRef.current);
        pendingDraftEvidenceRef.current=[];
        if (moduleIds.length) {
          const moduleAssignments = await Promise.allSettled(moduleIds.map((moduleId) => assignCasesToModule.mutateAsync({
            id: moduleId,
            testCaseIds: [response.id],
            append: true
          })));
          const failedModuleCount = moduleAssignments.filter((result) => result.status === "rejected").length;
          if (failedModuleCount) {
            lastCaseSaveNoticeRef.current = `Test Case created, but ${failedModuleCount} imported Module link${failedModuleCount === 1 ? "" : "s"} could not be saved.`;
          }
        }

        if (activeBugConversion?.bugId) {
          // Creation records conversion origin even if the editable back-link
          // cannot be saved. Refresh the catalog metric in either outcome.
          await queryClient.invalidateQueries({ queryKey: ["issues"] });
          try {
            const sourceBug = await api.issues.get(activeBugConversion.bugId, { project_id: projectId || undefined });
            await api.issues.update(activeBugConversion.bugId, {
              linked_test_case_ids: [...new Set([
                ...(sourceBug.linked_test_case_ids || activeBugConversion.existingTestCaseIds),
                response.id
              ])],
              expected_revision: sourceBug.revision
            });
            await queryClient.invalidateQueries({ queryKey: ["issues"] });
            lastCaseSaveNoticeRef.current = [
              lastCaseSaveNoticeRef.current,
              `Test Case created and linked back to Defect ${activeBugConversion.bugDisplayId}.`
            ].filter(Boolean).join(" ");
          } catch {
            lastCaseSaveNoticeRef.current = [
              lastCaseSaveNoticeRef.current,
              `The source Defect ${activeBugConversion.bugDisplayId} link could not be updated; you can link it manually from the Defect details screen.`
            ].filter(Boolean).join(" ");
          }
        }

        clearStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey);
        syncTestCaseSearchParams(response.id);
        setCreateSuiteContextId("");
        setActiveBugConversion(null);
        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        setCaseDeliveryRelease("");
        setCaseDeliverySprint("");
        setDraftSteps([]);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        if (announce) {
          showSuccess("Test case created with its draft steps.");
        }
      } else if (selectedTestCase) {
        const existingAutomationStatus = selectedTestCase.automation_status
          || (selectedTestCase.automated === "yes" ? "ready" : "not_automated");
        const hasMappedAutomation = canViewAutomationCode
          && displaySteps.some((step) => stepHasAutomation(stepDrafts[step.id] || step));

        await updateTestCase.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            title: caseDraft.title,
            description: caseDraft.description,
            external_references: parseReferenceList(caseDraft.externalReferencesText),
            labels,
            parameter_values: testCaseParameterValues,
            automated: caseDraft.automated,
            authoring_mode: caseDraft.authoring_mode,
            test_case_type: caseDraft.test_case_type,
            gherkin_document: persistedGherkinDocument || null,
            ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds.slice(0, 1), test_data_options: { ...caseParameterSaveOptions(selectedTestCase.test_data_options, testCaseParameterValues, selectedTestCase.parameter_values, linkedDataSetSensitiveParameterNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : []), override_shared_steps: overrideSharedGroupData } } : {}),
            automation_status: caseDraft.automated === "yes"
              ? selectedTestCase.automated === "yes" ? existingAutomationStatus : hasMappedAutomation ? "ready" : "incomplete"
              : "not_automated",
            priority: Number(caseDraft.priority),
            status: caseDraft.status,
            ...(canViewRequirements ? { requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [] } : {}),
            author_id: caseDraft.author_id,
            reviewer_id: caseDraft.reviewer_id || null,
            ai_quality_score: resolvedAiQualityScore,
            expected_revision: selectedTestCase.revision,
            steps: savedSteps
          }
        });

        if (caseDraft.module_id && caseDraft.module_id !== selectedCaseModuleId) {
          await assignCasesToModule.mutateAsync({
            id: caseDraft.module_id,
            testCaseIds: [selectedTestCase.id],
            append: true
          });
        } else if (!caseDraft.module_id && selectedCaseModuleId) {
          const removal = await removeCasesFromModule.mutateAsync({
            id: selectedCaseModuleId,
            testCaseIds: [selectedTestCase.id]
          });
          if (removal.retained_test_case_ids?.includes(selectedTestCase.id)) {
            lastCaseSaveNoticeRef.current = `Test Case saved. ${removal.message || "Story-linked module membership remains. Change the Story assignment to remove it."}`;
            setCaseDraft((current) => ({ ...current, module_id: selectedCaseModuleId }));
          }
        }

        syncCachedTestCaseParameterValues(selectedTestCase.id, visibleTestCaseParameterValues);
        clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCase.id] });
        if (persistedSteps.some((step) => step.reusable_group_id)) {
          await refreshSharedGroups();
        }
        clearStepSelectionIfClipboardActive();
        if (announce) {
          showSuccess(lastCaseSaveNoticeRef.current || "Test case updated.");
        }
      }

      setHasParameterScopeDraft(false);
      await refreshCases();
      return true;
    } catch (error) {
      showError(error, "Unable to save test case");
      return false;
    }
  };

const handleSaveCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSaveCaseAndSteps();
  };

const handleSaveCaseAndSteps = async (stepOverrides: Record<string, StepDraft> = {}, successMessage?: string) => {
    if (!caseDraft.title.trim()) {
      setExpandedSections((current) => ({ ...current, case: true }));
      setMessageTone("error");
      setMessage("Add a test case title before saving.");
      return false;
    }

    if (stepInsertIndex !== null) {
      setMessageTone("error");
      setMessage("Save or cancel the open step draft before saving the test case.");
      return false;
    }

    lastCaseSaveNoticeRef.current = "";
    const didSaveCase = await handleSaveCaseDirect(false, stepOverrides);

    if (!didSaveCase) {
      return false;
    }

    showSuccess(lastCaseSaveNoticeRef.current || successMessage || (isCreating ? "Test case created with its draft steps." : "Test case details, Test Params, preconditions, and steps saved."));
    lastCaseSaveNoticeRef.current = "";
    return true;
  };

return { handleCreateAndLinkDataSet, handleSaveCase, handleSaveCaseAndSteps };
}
