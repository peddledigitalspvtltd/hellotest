import { StepInsertIcon, ExecutionStepsIcon } from "./CaseStepToolbar";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import type { AutomationBuildResponse } from "@hellotest/platform/frontend/src/types";
import type { QueryClient } from '@tanstack/react-query';
import type { SessionPayload, DomainOption, TestCaseReviewStatus } from '@hellotest/platform/frontend/src/types';
import type { AiAssuranceAssessment } from '@hellotest/ai/frontend/lib/aiAssurance';
import { CaseMetadataAuthoring } from "./CaseMetadataAuthoring";
import { StepIconButton } from "./CaseStepInsert";
import { isLegacyInlineAutomationBuilderEnabled, createDraftStepId, buildGroupedCaseGherkin, formatRecorderDisplayMode } from "./testCaseWorkspaceUtils";
import { TestCaseSparkIcon, TestCaseRunIcon } from "./CaseLibraryActions";
import { AutomationLearningMemory, EditorAccordionSection } from "./CaseWorkspacePrimitives";
import { StepSharedGroupIcon, StepGroupHeader } from "./CaseStepGroups";
import { normalizeSharedGroupComparableText, StepActionMenu } from "./CaseStepCards";
import { type TestCaseDraft, type ExecutionStartMode, type StepDraft, type DraftTestStep, type CopiedTestStep, type StepInsertionGroupContext, type StepActionMenuAction, type TestCaseEditorSectionKey, type TestCaseDetailTab } from "./testCaseWorkspaceTypes";
import { CaseAuthoringHealth } from "./../../components/CaseAuthoringHealth";
import { AuthoringDataSetPanel } from "@hellotest/platform/frontend/src/platform/components/AuthoringDataSetPanel";
import { downloadParameterCsvTemplate } from "./../../lib/executionParameterContext";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { FormEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AddIcon, OpenIcon, PauseIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { ExecutionContextSelector } from "./../../components/ExecutionContextSelector";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { GherkinEditor } from "./../../components/GherkinEditor";
import { gherkinToStructuredCase, setGherkinFeatureTitle } from "./../../lib/gherkin";
import { InlineLoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingSkeleton";
import { RecorderSessionInsights } from "@hellotest/automation/frontend/components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "@hellotest/automation/frontend/components/RecorderStartControls";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { VisualTestBuilder } from "@hellotest/automation/frontend/components/VisualTestBuilder";
import { type DataSetDraft } from "./../../pages/TestEnvironmentPage";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { type BugToTestCaseDraft } from "./../../lib/bugToTestCaseConversion";
import { type DeliveryScopeOption } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { normalizeApiRequest, normalizeAutomationCode, normalizeStepType } from "@hellotest/automation/frontend/lib/stepAutomation";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AutomationLearningCacheEntry, Integration, RecorderSessionResponse, Requirement, TestCase, TestDataSet, TestCaseModule, TestStep, TestSuite, User } from "@hellotest/platform/frontend/src/types";

export interface CaseAuthoringWorkspaceInputs {
  queryClient: QueryClient;
  session: SessionPayload | null;
  projectId: string;
  appTypeId: string;
  canCreateTestCases: boolean;
  canUpdateTestCases: boolean;
  canViewRequirements: boolean;
  canViewDeliveryScopes: boolean;
  canViewTestData: boolean;
  canManageTestData: boolean;
  canDeleteTestCases: boolean;
  canUseTestCaseAi: boolean;
  canUseAutomationWorkspace: boolean;
  canPreviewAutomationCode: boolean;
  canBuildAutomation: boolean;
  canUseAutomationAi: boolean;
  canUseRecorder: boolean;
  canUseMobileAppium: boolean;
  selectedTestCaseId: string;
  setActiveTestCaseDetailTab: React.Dispatch<React.SetStateAction<TestCaseDetailTab>>;
  testCaseModules: TestCaseModule[];
  isCreating: boolean;
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>;
  reviewComment: string;
  setReviewComment: React.Dispatch<React.SetStateAction<string>>;
  setIsQualitySuggestionModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedExecutionEnvironmentId: string;
  setSelectedExecutionEnvironmentId: React.Dispatch<React.SetStateAction<string>>;
  selectedExecutionConfigurationId: string;
  setSelectedExecutionConfigurationId: React.Dispatch<React.SetStateAction<string>>;
  selectedExecutionDataSetId: string;
  setSelectedExecutionDataSetId: React.Dispatch<React.SetStateAction<string>>;
  caseDeliveryRelease: string;
  setCaseDeliveryRelease: React.Dispatch<React.SetStateAction<string>>;
  caseDeliverySprint: string;
  setCaseDeliverySprint: React.Dispatch<React.SetStateAction<string>>;
  automationStartUrl: string;
  setAutomationStartUrl: React.Dispatch<React.SetStateAction<string>>;
  automationContext: string;
  setAutomationContext: React.Dispatch<React.SetStateAction<string>>;
  automationFailureThreshold: number;
  setAutomationFailureThreshold: React.Dispatch<React.SetStateAction<number>>;
  recorderSession: RecorderSessionResponse | null;
  recentRecorderCompletedCaseId: string;
  expandedSections: Record<TestCaseEditorSectionKey, boolean>;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<TestCaseEditorSectionKey, boolean>>>;
  defaultTestCaseStatus: string;
  testCaseStatusOptions: DomainOption[];
  emptyDataSetDraft: DataSetDraft;
  caseDraft: TestCaseDraft;
  setCaseDraft: React.Dispatch<React.SetStateAction<TestCaseDraft>>;
  testCaseTypeOptions: DomainOption[];
  setNewStepDraft: React.Dispatch<React.SetStateAction<StepDraft>>;
  stepInsertIndex: number | null;
  setStepInsertIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setStepInsertGroupContext: React.Dispatch<React.SetStateAction<StepInsertionGroupContext | null>>;
  setDraftSteps: React.Dispatch<React.SetStateAction<DraftTestStep[]>>;
  selectedStepIds: string[];
  setSelectedStepIds: React.Dispatch<React.SetStateAction<string[]>>;
  setIsCaseParameterDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  linkedDataSetDraftIds: string[];
  setLinkedDataSetDraftIds: React.Dispatch<React.SetStateAction<string[]>>;
  overrideSharedGroupData: boolean;
  setOverrideSharedGroupData: React.Dispatch<React.SetStateAction<boolean>>;
  setDataSetSearch: React.Dispatch<React.SetStateAction<string>>;
  setDataSetLinkDraftId: React.Dispatch<React.SetStateAction<string>>;
  setIsDataSetLinkerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDataSetCreatorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewDataSetDraft: React.Dispatch<React.SetStateAction<DataSetDraft>>;
  copiedSteps: CopiedTestStep[];
  expandedStepGroupIds: string[];
  setExpandedStepGroupIds: React.Dispatch<React.SetStateAction<string[]>>;
  stepDrafts: Record<string, StepDraft>;
  setStepDrafts: React.Dispatch<React.SetStateAction<Record<string, StepDraft>>>;
  setIsSharedGroupPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isInsertingSharedGroups: boolean;
  setSelectedSharedGroupIds: React.Dispatch<React.SetStateAction<string[]>>;
  caseSectionRef: React.MutableRefObject<HTMLDivElement | null>;
  createSuiteContextId: string;
  setCreateSuiteContextId: React.Dispatch<React.SetStateAction<string>>;
  activeBugConversion: BugToTestCaseDraft | null;
  setActiveBugConversion: React.Dispatch<React.SetStateAction<BugToTestCaseDraft | null>>;
  testDataSetsQuery: UseQueryResult<TestDataSet[], Error>;
  stepsQuery: UseQueryResult<TestStep[], Error>;
  createTestCase: { isPending: boolean };
  assignCasesToModule: { isPending: boolean };
  removeCasesFromModule: { isPending: boolean };
  reviewTestCase: { isPending: boolean };
  updateSuite: { isPending: boolean };
  createLocalRun: { isPending: boolean };
  updateTestCase: { isPending: boolean };
  deleteTestCase: { isPending: boolean };
  buildSingleAutomation: { isPending: boolean };
  buildBatchAutomation: { isPending: boolean };
  startRecorder: { isPending: boolean };
  finishRecorder: { isPending: boolean };
  updateStep: { isPending: boolean };
  requirements: Requirement[];
  deliveryReleaseOptions: DeliveryScopeOption[];
  deliverySprintOptions: DeliveryScopeOption[];
  creationRequirementOptions: Requirement[];
  visibleCreationRequirementOptions: Requirement[];
  linkedRequirementTitle: string;
  caseGherkinFeatureTitle: string;
  suites: TestSuite[];
  testDataSets: TestDataSet[];
  supportsLocalDesktopExecution: boolean;
  userById: Record<string, User>;
  assigneeOptions: AssigneeOption[];
  isVisualBuilderActive: boolean;
  displaySteps: TestStep[];
  preconditionSteps: TestStep[];
  mainSteps: TestStep[];
  showError: (error: unknown, fallback: string) => void;
  updateCaseDeliveryScope: (release: string, sprint: string) => void;
  updateCaseRequirement: (requirementId: string) => void;
  existingCaseLabels: string[];
  testEngineIntegration: Integration;
  mobileRemoteRecorderEnabled: boolean;
  automationLearningCache: AutomationLearningCacheEntry[];
  recorderLiveUrl: string;
  openRunBuilder: (testCaseIds: string[], mode?: ExecutionStartMode) => void;
  selectedTestCase: TestCase | null;
  selectedCaseDisplayId: string;
  canLinkTestDataToCurrentCase: boolean;
  canCreateAndLinkTestData: boolean;
  linkedDataSetId: string;
  linkedDataSet: Pick<TestDataSet, "app_type_id" | "id" | "name" | "description" | "mode" | "columns" | "rows"> | null;
  linkedDataSetIterationCount: number;
  linkedAutomationCases: TestCase[];
  isSelectedTestCaseDetailPending: boolean;
  canReviewSelectedTestCase: boolean;
  isSelectedReviewPending: boolean;
  selectedReviewStatus: TestCaseReviewStatus;
  automationTargetCaseIds: string[];
  resolvedScopedParameterValues: Record<string, string>;
  handleConvertStepGroup: (groupId: string, groupName: string, groupItems: TestStep[], targetKind: "local" | "reusable") => Promise<void>;
  activateStepInsert: (index: number, groupContext?: StepInsertionGroupContext | null) => void;
  handleSaveCase: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSaveCaseAndSteps: (stepOverrides?: Record<string, StepDraft>, successMessage?: string) => Promise<boolean>;
  handleDeleteCase: () => Promise<void>;
  handleSubmitReview: (reviewStatus: "accepted" | "changes_requested") => Promise<void>;
  openReviewSuggestionDialog: (testCaseId: string, comment?: string, snapshot?: TestCase) => void;
  handleBuildSelectedAutomation: () => Promise<void>;
  handleStartRecorder: (options: RecorderStartOptions, targetStepId?: string) => Promise<void>;
  handleFinishRecorder: () => Promise<void>;
  handleMoveStepGroup: (groupId: string, direction: "up" | "down") => Promise<void>;
  handleUngroupStepGroup: (groupId: string, kind?: TestStep["group_kind"]) => Promise<void>;
  handleRemoveStepGroup: (groupId: string, groupSteps: TestStep[], kind?: TestStep["group_kind"]) => Promise<void>;
  computedCaseAiQualityScore: number;
  caseQualitySuggestions: string[];
  testCaseReviewReadiness: AiAssuranceAssessment;
  selectedCaseHealthMetrics: { authoring: number; finalizedRuns: number; passedRuns: number; stepCompleteness: number; passRate: number | null; };
  authoredBehaviorUnitCount: number;
  stepBlocks: { key: string; group_id: string | null; group_name: string | null; group_kind: TestStep["group_kind"]; reusable_group_id: string | null; steps: TestStep[]; }[];
  detectedStepParameters: StepParameterDefinition[];
  stepCountLabel: string;
  allStepsSelected: boolean;
  testCaseSaveBlockedReason: "" | "Add a test case title before saving." | "Save or cancel the open step draft before saving the test case.";
  isTestCaseWorkspaceMutationPending: boolean;
  isTestCaseSaveDisabled: boolean;
  editorStepActions: StepActionMenuAction[];
  readableCaseTitle: string;
  readableCaseDescription: string;
  hasReadableCasePreview: boolean;
  caseSectionSummary: "Enter the reusable case details before saving it." | "Update the reusable test case definition, ownership, traceability, and references.";
  stepSectionSummary: string;
  preconditionGroupContext: StepInsertionGroupContext;
  automationSectionSummary: string;
  caseSectionTitleContent: "New test case" | "Case details";
  closeCaseWorkspace: () => void;
  handleWorkspaceBack: () => void;
  isSelectedCaseLocalRunning: boolean;
  canSelectedCaseRunLocally: boolean;
  selectedCaseLocalRunLabel: "Run API locally" | "Run local Playwright";
  renderStepInsertSlot: (index: number, groupContext?: StepInsertionGroupContext | null) => JSX.Element;
  renderStepCard: (step: TestStep, index: number, groupContext?: StepInsertionGroupContext | null, sectionSteps?: TestStep[], usePlainCardAppearance?: boolean) => JSX.Element;
  openGroupAutomationPreview: (groupName: string, groupSteps: TestStep[]) => void;
}

export function CaseAuthoringWorkspace({ queryClient, session, projectId, appTypeId, canCreateTestCases, canUpdateTestCases, canViewRequirements, canViewDeliveryScopes, canViewTestData, canManageTestData, canDeleteTestCases, canUseTestCaseAi, canUseAutomationWorkspace, canPreviewAutomationCode, canBuildAutomation, canUseAutomationAi, canUseRecorder, canUseMobileAppium, selectedTestCaseId, setActiveTestCaseDetailTab, testCaseModules, isCreating, setIsCreating, reviewComment, setReviewComment, setIsQualitySuggestionModalOpen, selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId, selectedExecutionConfigurationId, setSelectedExecutionConfigurationId, selectedExecutionDataSetId, setSelectedExecutionDataSetId, caseDeliveryRelease, setCaseDeliveryRelease, caseDeliverySprint, setCaseDeliverySprint, automationStartUrl, setAutomationStartUrl, automationContext, setAutomationContext, automationFailureThreshold, setAutomationFailureThreshold, recorderSession, recentRecorderCompletedCaseId, expandedSections, setExpandedSections, defaultTestCaseStatus, testCaseStatusOptions, emptyDataSetDraft, caseDraft, setCaseDraft, testCaseTypeOptions, setNewStepDraft, stepInsertIndex, setStepInsertIndex, setStepInsertGroupContext, setDraftSteps, selectedStepIds, setSelectedStepIds, setIsCaseParameterDialogOpen, linkedDataSetDraftIds, setLinkedDataSetDraftIds, overrideSharedGroupData, setOverrideSharedGroupData, setDataSetSearch, setDataSetLinkDraftId, setIsDataSetLinkerOpen, setIsDataSetCreatorOpen, setNewDataSetDraft, copiedSteps, expandedStepGroupIds, setExpandedStepGroupIds, stepDrafts, setStepDrafts, setIsSharedGroupPickerOpen, isInsertingSharedGroups, setSelectedSharedGroupIds, caseSectionRef, createSuiteContextId, setCreateSuiteContextId, activeBugConversion, setActiveBugConversion, testDataSetsQuery, stepsQuery, createTestCase, assignCasesToModule, removeCasesFromModule, reviewTestCase, updateSuite, createLocalRun, updateTestCase, deleteTestCase, buildSingleAutomation, buildBatchAutomation, startRecorder, finishRecorder, updateStep, requirements, deliveryReleaseOptions, deliverySprintOptions, creationRequirementOptions, visibleCreationRequirementOptions, linkedRequirementTitle, caseGherkinFeatureTitle, suites, testDataSets, supportsLocalDesktopExecution, userById, assigneeOptions, isVisualBuilderActive, displaySteps, preconditionSteps, mainSteps, showError, updateCaseDeliveryScope, updateCaseRequirement, existingCaseLabels, testEngineIntegration, mobileRemoteRecorderEnabled, automationLearningCache, recorderLiveUrl, openRunBuilder, selectedTestCase, selectedCaseDisplayId, canLinkTestDataToCurrentCase, canCreateAndLinkTestData, linkedDataSetId, linkedDataSet, linkedDataSetIterationCount, linkedAutomationCases, isSelectedTestCaseDetailPending, canReviewSelectedTestCase, isSelectedReviewPending, selectedReviewStatus, automationTargetCaseIds, resolvedScopedParameterValues, handleConvertStepGroup, activateStepInsert, handleSaveCase, handleSaveCaseAndSteps, handleDeleteCase, handleSubmitReview, openReviewSuggestionDialog, handleBuildSelectedAutomation, handleStartRecorder, handleFinishRecorder, handleMoveStepGroup, handleUngroupStepGroup, handleRemoveStepGroup, computedCaseAiQualityScore, caseQualitySuggestions, testCaseReviewReadiness, selectedCaseHealthMetrics, authoredBehaviorUnitCount, stepBlocks, detectedStepParameters, stepCountLabel, allStepsSelected, testCaseSaveBlockedReason, isTestCaseWorkspaceMutationPending, isTestCaseSaveDisabled, editorStepActions, readableCaseTitle, readableCaseDescription, hasReadableCasePreview, caseSectionSummary, stepSectionSummary, preconditionGroupContext, automationSectionSummary, caseSectionTitleContent, closeCaseWorkspace, handleWorkspaceBack, isSelectedCaseLocalRunning, canSelectedCaseRunLocally, selectedCaseLocalRunLabel, renderStepInsertSlot, renderStepCard, openGroupAutomationPreview }: CaseAuthoringWorkspaceInputs) {
  return (<div className="detail-section-panel test-case-detail-layout" role="tabpanel">
                <div
                  {...(isTestCaseWorkspaceMutationPending ? ({ inert: "" } as Record<string, string>) : {})}
                  aria-busy={isTestCaseWorkspaceMutationPending}
                  className="editor-accordion test-case-detail-grid"
                >
                  {(() => {
                    const activeLinkedDataSet = testDataSets.find((item) => item.id === linkedDataSetDraftIds[0]);
                    const selectTestCaseAuthoringMode = (authoringMode: "structured" | "gherkin") => {
                      if (authoringMode === caseDraft.authoring_mode) return;
                      if (authoringMode === "structured" && caseDraft.gherkin_document.trim()) {
                        const converted = gherkinToStructuredCase(caseDraft.gherkin_document);
                        if (converted.exampleColumns.length && converted.exampleRows.length && canManageTestData && projectId) {
                          const persistExamples = activeLinkedDataSet
                            ? api.testDataSets.update(activeLinkedDataSet.id, { mode: "table", columns: converted.exampleColumns, rows: converted.exampleRows })
                                .then(() => activeLinkedDataSet.id)
                            : api.testDataSets.create({ project_id: projectId, app_type_id: appTypeId || undefined, name: `${caseDraft.title || "Test case"} examples`, mode: "table", columns: converted.exampleColumns, rows: converted.exampleRows })
                                .then((response) => response.id);
                          void persistExamples.then((dataSetId) => {
                            setLinkedDataSetDraftIds([dataSetId]);
                            return queryClient.invalidateQueries({ queryKey: ["test-data-sets"] });
                          }).catch((error) => showError(error, "Structured steps were restored, but Gherkin Examples could not be saved as Test Data"));
                        }
                        const existingSteps = displaySteps.map((step) => ({ ...step, ...(stepDrafts[step.id] || {}) }));
                        const usedIds = new Set<string>();
                        const toDraft = (step: { action: string; expected_result: string }, index: number, isPrecondition = false): DraftTestStep => {
                          const candidates = existingSteps.filter((item) => !usedIds.has(item.id)
                            && ((item.group_name || "").toLowerCase() === "preconditions") === isPrecondition);
                          const matchingStep = candidates.find((item) =>
                            normalizeSharedGroupComparableText(item.action) === normalizeSharedGroupComparableText(step.action)
                            && normalizeSharedGroupComparableText(item.expected_result) === normalizeSharedGroupComparableText(step.expected_result));
                          const existing = matchingStep || (existingSteps.length === converted.preconditions.length + converted.steps.length
                            ? candidates.find((item) => item.id === existingSteps[index]?.id) : undefined);
                          if (existing) usedIds.add(existing.id);
                          return {
                            id: existing?.id || createDraftStepId(), action: step.action, expected_result: step.expected_result,
                            step_type: normalizeStepType(existing?.step_type), automation_code: normalizeAutomationCode(existing?.automation_code),
                            api_request: normalizeApiRequest(existing?.api_request), group_id: existing?.group_id || null,
                            group_name: existing?.group_name || (isPrecondition ? "Preconditions" : null),
                            group_kind: existing?.group_kind || (isPrecondition ? "local" : null), reusable_group_id: existing?.reusable_group_id || null
                          };
                        };
                        const convertedDrafts = [
                          ...converted.preconditions.map((step, index) => toDraft(step, index, true)),
                          ...converted.steps.map((step, index) => toDraft(step, converted.preconditions.length + index))
                        ];
                        if (isCreating) {
                          setDraftSteps(convertedDrafts);
                        } else {
                          setStepDrafts((current) => ({ ...current, ...Object.fromEntries(convertedDrafts
                            .filter((step) => usedIds.has(step.id))
                            .map((step) => [step.id, {
                              action: step.action, expected_result: step.expected_result, step_type: step.step_type,
                              automation_code: step.automation_code, api_request: step.api_request
                            }])) }));
                          const missingSteps = convertedDrafts.filter((step) => !usedIds.has(step.id));
                          if (selectedTestCaseId && missingSteps.length) {
                            void api.testSteps.createMany({
                              test_case_id: selectedTestCaseId,
                              insertion_index: displaySteps.length,
                              steps: missingSteps.map((step) => ({
                                action: step.action || undefined, expected_result: step.expected_result || undefined,
                                step_type: normalizeStepType(step.step_type), group_id: step.group_id || undefined,
                                group_name: step.group_name || undefined, group_kind: step.group_kind || undefined,
                                reusable_group_id: step.reusable_group_id || undefined
                              }))
                            }).then(async (response) => {
                              const createdIdByDraftId = new Map(missingSteps.map((step, index) => [step.id, response.ids[index]]));
                              const orderedIds = convertedDrafts.map((step) => createdIdByDraftId.get(step.id) || step.id);
                              // Retain any unmatched saved rows and their automation until
                              // the author explicitly removes them in the structured editor.
                              orderedIds.push(...displaySteps.filter((step) => !usedIds.has(step.id)).map((step) => step.id));
                              await api.testSteps.reorder(selectedTestCaseId, orderedIds);
                              await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
                            }).catch((error) => showError(error, "Gherkin was retained, but some structured rows could not be created"));
                          }
                        }
                      }
                      setCaseDraft((current) => ({
                        ...current,
                        authoring_mode: authoringMode,
                        gherkin_document: authoringMode === "gherkin"
                          ? buildGroupedCaseGherkin({
                              title: current.title,
                              featureTitle: caseGherkinFeatureTitle,
                              preconditions: preconditionSteps.map((step) => stepDrafts[step.id] || step),
                              steps: mainSteps.map((step) => ({ ...step, ...(stepDrafts[step.id] || {}) })),
                              columns: activeLinkedDataSet?.mode === "table" ? activeLinkedDataSet.columns : [],
                              rows: activeLinkedDataSet?.mode === "table" ? activeLinkedDataSet.rows : []
                            })
                          : current.gherkin_document
                      }));
                    };
                    const handleTestCaseAuthoringTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
                      const nextMode = event.key === "ArrowLeft" || event.key === "Home"
                        ? "structured"
                        : event.key === "ArrowRight" || event.key === "End"
                          ? "gherkin"
                          : null;
                      if (!nextMode) return;
                      event.preventDefault();
                      selectTestCaseAuthoringMode(nextMode);
                      requestAnimationFrame(() => document.getElementById(`test-case-${nextMode}-authoring-tab`)?.focus());
                    };
                    const caseDetailsSidebar = (

<CaseMetadataAuthoring appTypeId={appTypeId} session={session} canCreateTestCases={canCreateTestCases} canUpdateTestCases={canUpdateTestCases} canViewRequirements={canViewRequirements} canViewDeliveryScopes={canViewDeliveryScopes} canUseAutomationWorkspace={canUseAutomationWorkspace} setActiveTestCaseDetailTab={setActiveTestCaseDetailTab} testCaseModules={testCaseModules} isCreating={isCreating} setIsCreating={setIsCreating} reviewComment={reviewComment} setReviewComment={setReviewComment} setIsQualitySuggestionModalOpen={setIsQualitySuggestionModalOpen} caseDeliveryRelease={caseDeliveryRelease} setCaseDeliveryRelease={setCaseDeliveryRelease} caseDeliverySprint={caseDeliverySprint} setCaseDeliverySprint={setCaseDeliverySprint} expandedSections={expandedSections} setExpandedSections={setExpandedSections} defaultTestCaseStatus={defaultTestCaseStatus} testCaseStatusOptions={testCaseStatusOptions} caseDraft={caseDraft} setCaseDraft={setCaseDraft} testCaseTypeOptions={testCaseTypeOptions} setNewStepDraft={setNewStepDraft} setStepInsertIndex={setStepInsertIndex} setStepInsertGroupContext={setStepInsertGroupContext} setDraftSteps={setDraftSteps} setSelectedStepIds={setSelectedStepIds} caseSectionRef={caseSectionRef} createSuiteContextId={createSuiteContextId} setCreateSuiteContextId={setCreateSuiteContextId} activeBugConversion={activeBugConversion} setActiveBugConversion={setActiveBugConversion} createTestCase={createTestCase} assignCasesToModule={assignCasesToModule} removeCasesFromModule={removeCasesFromModule} reviewTestCase={reviewTestCase} updateSuite={updateSuite} updateTestCase={updateTestCase} updateStep={updateStep} requirements={requirements} deliveryReleaseOptions={deliveryReleaseOptions} deliverySprintOptions={deliverySprintOptions} creationRequirementOptions={creationRequirementOptions} visibleCreationRequirementOptions={visibleCreationRequirementOptions} suites={suites} userById={userById} assigneeOptions={assigneeOptions} updateCaseDeliveryScope={updateCaseDeliveryScope} updateCaseRequirement={updateCaseRequirement} existingCaseLabels={existingCaseLabels} selectedTestCase={selectedTestCase} selectedCaseDisplayId={selectedCaseDisplayId} linkedAutomationCases={linkedAutomationCases} isSelectedTestCaseDetailPending={isSelectedTestCaseDetailPending} canReviewSelectedTestCase={canReviewSelectedTestCase} isSelectedReviewPending={isSelectedReviewPending} selectedReviewStatus={selectedReviewStatus} handleSaveCase={handleSaveCase} handleDeleteCase={handleDeleteCase} handleSubmitReview={handleSubmitReview} openReviewSuggestionDialog={openReviewSuggestionDialog} computedCaseAiQualityScore={computedCaseAiQualityScore} caseQualitySuggestions={caseQualitySuggestions} testCaseReviewReadiness={testCaseReviewReadiness} isTestCaseWorkspaceMutationPending={isTestCaseWorkspaceMutationPending} readableCaseTitle={readableCaseTitle} readableCaseDescription={readableCaseDescription} hasReadableCasePreview={hasReadableCasePreview} caseSectionSummary={caseSectionSummary} caseSectionTitleContent={caseSectionTitleContent} />

                    );

                    return (
                    <>
                  <div className="test-case-detail-primary">
                  {!isCreating ? <CaseAuthoringHealth metrics={selectedCaseHealthMetrics} suggestions={caseQualitySuggestions} behaviorUnits={authoredBehaviorUnitCount} gherkin={caseDraft.authoring_mode === "gherkin"} defects={selectedTestCase?.defect_ids?.length || 0} onReview={() => { if (computedCaseAiQualityScore < 70 && caseQualitySuggestions.length) setIsQualitySuggestionModalOpen(true); else if (canUseTestCaseAi) setActiveTestCaseDetailTab("assurance"); }} /> : null}

                  <div aria-label="Step authoring format" className="test-authoring-mode-card">
                    <div className="test-authoring-mode-toggle" role="tablist" aria-label="Step authoring mode">
                      <button
                        aria-controls="test-case-authoring-mode-panel"
                        aria-selected={caseDraft.authoring_mode === "structured"}
                        className={caseDraft.authoring_mode === "structured" ? "is-active" : ""}
                        id="test-case-structured-authoring-tab"
                        onClick={() => selectTestCaseAuthoringMode("structured")}
                        onKeyDown={handleTestCaseAuthoringTabKeyDown}
                        role="tab"
                        tabIndex={caseDraft.authoring_mode === "structured" ? 0 : -1}
                        type="button"
                      >
                        Structured
                      </button>
                      <button
                        aria-controls="test-case-authoring-mode-panel"
                        aria-selected={caseDraft.authoring_mode === "gherkin"}
                        className={caseDraft.authoring_mode === "gherkin" ? "is-active" : ""}
                        id="test-case-gherkin-authoring-tab"
                        onClick={() => selectTestCaseAuthoringMode("gherkin")}
                        onKeyDown={handleTestCaseAuthoringTabKeyDown}
                        role="tab"
                        tabIndex={caseDraft.authoring_mode === "gherkin" ? 0 : -1}
                        type="button"
                      >
                        Gherkin
                      </button>
                    </div>
                    <button
                      className="ghost-button compact"
                      disabled={!appTypeId || (isCreating ? !canCreateTestCases : !canUpdateTestCases) || isInsertingSharedGroups || stepInsertIndex !== null}
                      onClick={() => { setSelectedSharedGroupIds([]); setIsSharedGroupPickerOpen(true); }}
                      type="button"
                    >
                      <StepSharedGroupIcon /> Insert Shared Step Group
                    </button>
                  </div>

                  <div
                    aria-labelledby={`test-case-${caseDraft.authoring_mode}-authoring-tab`}
                    className="test-authoring-mode-panel"
                    id="test-case-authoring-mode-panel"
                    role="tabpanel"
                  >
                  {caseDraft.authoring_mode === "structured" ? (
                    <EditorAccordionSection
                      countLabel={`${preconditionSteps.length}`}
                      isExpanded={expandedSections.preconditions}
                      onToggle={() => setExpandedSections((current) => ({ ...current, preconditions: !current.preconditions }))}
                      summary={preconditionSteps.length ? "Setup assumptions and pre-run steps captured before the main flow." : "Add setup assumptions before the draft steps."}
                      title="Preconditions"
                    >
                      <div className="step-editor step-editor--embedded">
                        <div className="step-list">
                          {!preconditionSteps.length ? renderStepInsertSlot(0, preconditionGroupContext) : null}
                          {preconditionSteps.map((step, index) => (
                            <Fragment key={step.id}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1), preconditionGroupContext)}
                              {renderStepCard(step, index, preconditionGroupContext, preconditionSteps, true)}
                              {index === preconditionSteps.length - 1 ? renderStepInsertSlot(step.step_order, preconditionGroupContext) : null}
                            </Fragment>
                          ))}
                        </div>
                        {!preconditionSteps.length ? (
                          <div className="empty-state compact">
                            <div>No preconditions yet. Add the setup required before the first draft step.</div>
                            {stepInsertIndex === null ? <button className="ghost-button" onClick={() => activateStepInsert(0, preconditionGroupContext)} type="button">Add first precondition</button> : null}
                          </div>
                        ) : null}
                        {preconditionSteps.length && stepInsertIndex === null ? (
                          <button className="test-case-add-row" onClick={() => activateStepInsert(preconditionSteps[preconditionSteps.length - 1].step_order, preconditionGroupContext)} type="button">
                            <AddIcon /><span>Add precondition</span>
                          </button>
                        ) : null}
                      </div>
                    </EditorAccordionSection>
                  ) : (
                    <GherkinEditor
                      exampleColumns={linkedDataSet?.mode === "table" ? linkedDataSet.columns : []}
                      exampleRows={linkedDataSet?.mode === "table" ? linkedDataSet.rows : []}
                      featureTitle={caseGherkinFeatureTitle}
                      featureTitleLocked={Boolean(linkedRequirementTitle)}
                      onChange={(gherkin_document) => setCaseDraft((current) => ({ ...current, gherkin_document: linkedRequirementTitle ? setGherkinFeatureTitle(gherkin_document, linkedRequirementTitle) : gherkin_document }))}
                      availableParameters={detectedStepParameters}
                      minimalBehaviorEditor
                      parameterValues={resolvedScopedParameterValues}
                      value={caseDraft.gherkin_document}
                    />
                  )}

                  {caseDraft.authoring_mode === "structured" ? <EditorAccordionSection
                    countLabel={stepCountLabel}
                    isExpanded={expandedSections.steps}
                    onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
                    summary={stepSectionSummary}
                    title={isCreating ? "Draft steps" : "Test steps"}
                  >
                    {isVisualBuilderActive ? (
                      <VisualTestBuilder testSteps={mainSteps} />
                    ) : (
                    <div className="step-editor step-editor--embedded">
                      <div className="step-editor-toolbar">
                        <label className="checkbox-field step-select-all">
                          <input
                            checked={allStepsSelected}
                            disabled={!mainSteps.length}
                            onChange={(event) =>
                              setSelectedStepIds(event.target.checked ? mainSteps.map((step) => step.id) : [])
                            }
                            type="checkbox"
                          />
                          Select all
                        </label>
                        <StepActionMenu
                          className="step-card-menu--inline step-card-menu--inline-right"
                          label="Test step actions"
                          openOnHover
                          previewActions={editorStepActions}
                          actions={editorStepActions}
                        />
                      </div>

      {copiedSteps.length ? null : null}

      {!isCreating && stepsQuery.isLoading ? <InlineLoadingState label="Loading steps" /> : null}

      <div className="step-list">
                        {!mainSteps.length ? (
                          <>
                            <div className="step-empty-insert">
                              <StepIconButton ariaLabel="Insert step" onClick={() => activateStepInsert(preconditionSteps.length, null)} title="Insert step" type="button">
                                <StepInsertIcon />
                              </StepIconButton>
                            </div>
                            {renderStepInsertSlot(preconditionSteps.length, null)}
                          </>
                        ) : null}

                        {stepBlocks.map((block) => {
                          if (block.group_id) {
                            const firstStep = block.steps[0];
                            const lastStep = block.steps[block.steps.length - 1];
                            const isGroupExpanded = expandedStepGroupIds.includes(block.group_id);
                            const blockIndex = stepBlocks.findIndex((item) => item.key === block.key);
                            const canMoveGroupUp = blockIndex > 0;
                            const canMoveGroupDown = blockIndex < stepBlocks.length - 1;
                            const blockGroupContext: StepInsertionGroupContext = {
                              group_id: block.group_id,
                              group_name: block.group_name,
                              group_kind: block.group_kind || null,
                              reusable_group_id: block.reusable_group_id
                            };

                            return (
                              <Fragment key={block.key}>
                                {renderStepInsertSlot(Math.max(0, firstStep.step_order - 1))}
                                <div
                                  className={[
                                    isGroupExpanded ? "step-group-block is-expanded" : "step-group-block is-collapsed",
                                    block.group_kind === "reusable" ? "is-shared-group" : "is-local-group"
                                  ].join(" ")}
                                >
                                  <StepGroupHeader
                                    isExpanded={isGroupExpanded}
                                    kind={block.group_kind}
                                    name={block.group_name || "Step group"}
                                    canMoveUp={canMoveGroupUp}
                                    canMoveDown={canMoveGroupDown}
                                    showAutomationTools={canPreviewAutomationCode}
                                    onConvertToLocal={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "local"
                                      )
                                    }
                                    onConvertToShared={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "reusable"
                                      )
                                    }
                                    onToggle={() =>
                                      setExpandedStepGroupIds((current) =>
                                        current.includes(block.group_id as string)
                                          ? current.filter((id) => id !== block.group_id)
                                          : [...current, block.group_id as string]
                                      )
                                    }
                                    onMoveUp={() => void handleMoveStepGroup(block.group_id as string, "up")}
                                    onMoveDown={() => void handleMoveStepGroup(block.group_id as string, "down")}
                                    onPreviewCode={() => openGroupAutomationPreview(block.group_name || "Step group", block.steps)}
                                    onRemoveGroup={() => void handleRemoveStepGroup(block.group_id as string, block.steps, block.group_kind)}
                                    onUngroup={() => void handleUngroupStepGroup(block.group_id as string, block.group_kind)}
                                    onToggleSelect={(checked) => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      if (checked) {
                                        setSelectedStepIds((current) => Array.from(new Set([...current, ...groupStepIds])));
                                      } else {
                                        setSelectedStepIds((current) => current.filter((id) => !groupStepIds.includes(id)));
                                      }
                                    }}
                                    selectionState={(() => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      const selectedCount = groupStepIds.filter((id) => selectedStepIds.includes(id)).length;
                                      if (!selectedCount) {
                                        return "none";
                                      }
                                      if (selectedCount === groupStepIds.length) {
                                        return "all";
                                      }
                                      return "some";
                                    })()}
                                    stepCount={block.steps.length}
                                  />
                                  {isGroupExpanded ? (
                                    <div className="step-group-block-body">
                                      {block.steps.map((step) => {
                                        const stepIndex = mainSteps.findIndex((item) => item.id === step.id);

                                        return (
                                          <Fragment key={step.id}>
                                            {renderStepInsertSlot(Math.max(0, step.step_order - 1), blockGroupContext)}
                                            {renderStepCard(step, stepIndex, blockGroupContext, mainSteps)}
                                          </Fragment>
                                        );
                                      })}
                                      {renderStepInsertSlot(lastStep.step_order, blockGroupContext)}
                                    </div>
                                  ) : null}
                                </div>
                                {lastStep.id === mainSteps[mainSteps.length - 1]?.id ? renderStepInsertSlot(lastStep.step_order) : null}
                              </Fragment>
                            );
                          }

                          const step = block.steps[0];
                          const stepIndex = mainSteps.findIndex((item) => item.id === step.id);

                          return (
                            <Fragment key={block.key}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1))}
                              {renderStepCard(step, stepIndex, null, mainSteps)}
                              {step.id === mainSteps[mainSteps.length - 1]?.id ? renderStepInsertSlot(step.step_order) : null}
                            </Fragment>
                          );
                        })}
                      </div>

                      {mainSteps.length && stepInsertIndex === null ? (
                        <button
                          className="test-case-add-row"
                          onClick={() => activateStepInsert(mainSteps[mainSteps.length - 1].step_order, null)}
                          type="button"
                        >
                          <AddIcon />
                          <span>Add step</span>
                        </button>
                      ) : null}

                      {!mainSteps.length ? (
                        <div className="empty-state compact">
                          <div>
                            {isCreating
                              ? "No draft steps yet. Use the inline + action to add the first step or insert a Shared Step Group."
                              : "No steps yet for this test case. Use the inline + action to add one or insert a Shared Step Group."}
                          </div>
                          {stepInsertIndex === null ? (
                            <button className="ghost-button" onClick={() => activateStepInsert(preconditionSteps.length, null)} type="button">Add first step</button>
                          ) : null}
                        </div>
                      ) : null}

                      {!isCreating ? (
                        <div className="action-row step-editor-save-row">
	                          <button className="primary-button" disabled={isSelectedTestCaseDetailPending || !selectedTestCase || updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending} onClick={() => void handleSaveCaseAndSteps()} type="button">
                            {updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    )}
                  </EditorAccordionSection> : null}
                  </div>

                  <EditorAccordionSection
                    countLabel={linkedDataSet ? `${linkedDataSetIterationCount} ${linkedDataSetIterationCount === 1 ? "iteration" : "iterations"}` : "None"}
                    isExpanded={expandedSections.dataSets}
                    onToggle={() => setExpandedSections((current) => ({ ...current, dataSets: !current.dataSets }))}
                    summary={caseDraft.authoring_mode === "gherkin" ? "Create, link, change, or unlink reusable Test Data. Linked table rows are rendered under Gherkin Examples." : "Create or link one reusable data set. A table can carry one or many row-level execution iterations."}
                    title={caseDraft.authoring_mode === "gherkin" ? "Examples · Linked Test Data" : "Data Sets"}
                  >
                    <AuthoringDataSetPanel
                      dataSet={linkedDataSet}
                      linkedDataSetId={linkedDataSetId}
                      isLoading={testDataSetsQuery.isLoading}
                      error={testDataSetsQuery.isError ? "Data sets could not be loaded." : undefined}
                      onRetry={() => { void testDataSetsQuery.refetch(); }}
                      gherkin={caseDraft.authoring_mode === "gherkin"}
                      canView={canViewTestData}
                      canLink={canLinkTestDataToCurrentCase}
                      canCreate={canCreateAndLinkTestData}
                      overrideSharedSteps={overrideSharedGroupData}
                      onOverrideSharedStepsChange={setOverrideSharedGroupData}
                      hasParameters={detectedStepParameters.length > 0}
                      onDownloadTemplate={() => downloadParameterCsvTemplate(detectedStepParameters, "test-case-parameter-template.csv")}
                      onManageParameters={() => setIsCaseParameterDialogOpen(true)}
                      onCreate={() => {
                        setNewDataSetDraft(emptyDataSetDraft);
                        setIsDataSetCreatorOpen(true);
                      }}
                      onLink={() => {
                        setDataSetLinkDraftId(linkedDataSet?.id || "");
                        setDataSetSearch("");
                        setIsDataSetLinkerOpen(true);
                      }}
                      onUnlink={() => setLinkedDataSetDraftIds([])}
                    />
                  </EditorAccordionSection>

                  {/* Retained temporarily for backward-compatible state handling; authoring has moved to Automation. */}
                  {!isCreating && canUseAutomationWorkspace && isLegacyInlineAutomationBuilderEnabled() ? (
                    <EditorAccordionSection
                      countLabel={automationTargetCaseIds.length ? `${automationTargetCaseIds.length} target${automationTargetCaseIds.length === 1 ? "" : "s"}` : "Ready"}
                      isExpanded={expandedSections.automation}
                      onToggle={() => setExpandedSections((current) => ({ ...current, automation: !current.automation }))}
                      summary={automationSectionSummary}
                      title="Automation builder"
                    >
                      <div className="automation-builder-panel">
                        <details className="automation-run-context-section">
                          <summary>
                            <ExecutionStepsIcon />
                            <span>Run context</span>
                          </summary>
                          <ExecutionContextSelector
                            appTypeId={appTypeId}
                            onConfigurationChange={setSelectedExecutionConfigurationId}
                            onDataSetChange={setSelectedExecutionDataSetId}
                            onEnvironmentChange={setSelectedExecutionEnvironmentId}
                            prefillFirstAvailable
                            projectId={projectId}
                            selectedConfigurationId={selectedExecutionConfigurationId}
                            selectedDataSetId={selectedExecutionDataSetId}
                            selectedEnvironmentId={selectedExecutionEnvironmentId}
                          />
                        </details>

                        <div className="record-grid automation-builder-form">
                          <FormField label="Start URL">
                            <input
                              onChange={(event) => setAutomationStartUrl(event.target.value)}
                              placeholder="Uses selected environment base URL when blank"
                              value={automationStartUrl}
                            />
                          </FormField>
                          <FormField label="Failure threshold">
                            <input
                              min={1}
                              max={50}
                              onChange={(event) => setAutomationFailureThreshold(Math.max(1, Number(event.target.value) || 1))}
                              type="number"
                              value={automationFailureThreshold}
                            />
                          </FormField>
                        </div>

                        <FormField label="Builder guidance">
                          <textarea
                            onChange={(event) => setAutomationContext(event.target.value)}
                            placeholder="Auth assumptions, preferred data tokens, flows to ignore, or edge cases to preserve."
                            rows={4}
                            value={automationContext}
                          />
                        </FormField>

                        <div className="testops-action-row">
                          {canUseAutomationAi ? (<button
                            className="primary-button"
                            disabled={!canBuildAutomation || !canUseAutomationAi || !automationTargetCaseIds.length || buildSingleAutomation.isPending || buildBatchAutomation.isPending}
                            onClick={() => void handleBuildSelectedAutomation()}
                            type="button"
                          >
                            <TestCaseSparkIcon />
                            <span>
                              {buildSingleAutomation.isPending || buildBatchAutomation.isPending
                                ? "Automating..."
                                : automationTargetCaseIds.length > 1
                                  ? "Queue AI automation"
                                  : "Automate case with AI"}
                            </span>
                          </button>) : null}
                        </div>

                        <div className="stack-list automation-recorder-stack">
                          <div className="stack-item recorder-command-card">
                            <div>
                              <strong>Recorder</strong>
                              <span>{recorderSession ? `Session ${recorderSession.id.slice(0, 8)} is ${recorderSession.status}.` : "Capture clicks, fills, tab navigation, and business API traffic for this case."}</span>
                            </div>
                            <div className="recorder-workspace-pane">
	                              <RecorderStartControls
	                                disabled={!canUseRecorder || !selectedTestCase || !testEngineIntegration}
                                hasSession={Boolean(recorderSession)}
                                isStarting={startRecorder.isPending}
                                mobileAppiumEnabled={canUseMobileAppium}
                                mobileRemoteEnabled={mobileRemoteRecorderEnabled}
                                onStart={(options) => void handleStartRecorder(options)}
                                primaryAction={(
                                  <button
                                    className="primary-button recorder-stop-button"
                                    disabled={!recorderSession || finishRecorder.isPending}
                                    onClick={() => void handleFinishRecorder()}
                                    type="button"
                                  >
                                    <PauseIcon />
                                    <span>{finishRecorder.isPending ? "Stopping..." : "Stop and capture steps"}</span>
                                  </button>
                                )}
                                moreActions={recorderLiveUrl ? (
                                  <a className="ghost-button compact" href={recorderLiveUrl} rel="noreferrer" target="_blank">
                                    <OpenIcon size={16} />
                                    <span>Open live view</span>
                                  </a>
                                ) : null}
                              />
                            </div>
                          </div>
                          {recorderSession ? (
                            <div className="stack-item">
                              <div>
                                <strong>{formatRecorderDisplayMode(recorderSession.display_mode)}</strong>
                                <span>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</span>
                              </div>
                              <StatusBadge value={recorderSession.status} />
                            </div>
                          ) : null}
                          {!recorderSession && selectedTestCase && recentRecorderCompletedCaseId === selectedTestCase.id && supportsLocalDesktopExecution ? (
                            <div className="stack-item">
                              <div>
                                <strong>Recorded automation ready</strong>
                                <span>Start a local Playwright run from this machine and review it under Local Runs.</span>
                              </div>
                              <button
                                className="primary-button"
                                disabled={isSelectedCaseLocalRunning || createLocalRun.isPending || !canSelectedCaseRunLocally || !projectId || !appTypeId || !session?.user.id}
                                onClick={() => openRunBuilder([selectedTestCase.id], "local")}
                                type="button"
                              >
                                <TestCaseRunIcon />
                                <span>{isSelectedCaseLocalRunning ? "Starting..." : selectedCaseLocalRunLabel}</span>
                              </button>
                            </div>
                          ) : null}
                          {recorderLiveUrl ? (
                            <iframe
                              allow="clipboard-read; clipboard-write"
                              className="recorder-live-frame"
                              src={recorderLiveUrl}
                              title="HelloTest recorder live view"
                            />
                          ) : null}
                          <RecorderSessionInsights session={recorderSession} />
                        </div>

                        <AutomationLearningMemory entries={automationLearningCache} />
                      </div>
                    </EditorAccordionSection>
                  ) : null}

                </div>
                    {caseDetailsSidebar}
                    </>
                    );
                  })()}
                </div>
                <footer className="test-case-detail-footer" aria-label="Test case actions">
                  <div className="test-case-detail-footer-danger">
                    {!isCreating && selectedTestCase ? (
                      (canDeleteTestCases ? (<button
                        className="test-case-detail-delete-button"
                        disabled={!canDeleteTestCases || isTestCaseWorkspaceMutationPending}
                        onClick={() => void handleDeleteCase()}
                        type="button"
                      >
                        <TrashIcon />
                        <span>{deleteTestCase.isPending ? "Deleting…" : "Delete test case"}</span>
                      </button>) : null)
                    ) : null}
                  </div>
                  <div className="test-case-detail-footer-primary">
                    {testCaseSaveBlockedReason ? (
                      <span className="test-case-detail-save-hint" id="test-case-save-blocked-reason" role="status">
                        {testCaseSaveBlockedReason}
                      </span>
                    ) : null}
                    <button
                      className="ghost-button test-case-detail-cancel-button"
                      disabled={isTestCaseWorkspaceMutationPending}
                      onClick={isCreating ? closeCaseWorkspace : handleWorkspaceBack}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      aria-describedby={testCaseSaveBlockedReason ? "test-case-save-blocked-reason" : undefined}
                      className="primary-button test-case-detail-save-button"
                      disabled={isTestCaseSaveDisabled}
                      onClick={() => void handleSaveCaseAndSteps()}
                      title={testCaseSaveBlockedReason || undefined}
                      type="button"
                    >
                      {isCreating
                        ? (createTestCase.isPending || updateSuite.isPending || assignCasesToModule.isPending ? "Creating…" : "Create test case")
                        : (updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case")}
                    </button>
                  </div>
                </footer>
                </div>);
}
