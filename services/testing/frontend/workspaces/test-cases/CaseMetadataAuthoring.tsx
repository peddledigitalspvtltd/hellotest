import type { SessionPayload, DomainOption, TestCaseReviewStatus } from '@hellotest/platform/frontend/src/types';
import type { AiAssuranceAssessment } from '@hellotest/ai/frontend/lib/aiAssurance';
import { TEST_CASE_REVIEW_STATUS_LABELS, EMPTY_STEP_DRAFT } from "./testCaseWorkspaceUtils";
import { TestCaseSparkIcon } from "./CaseLibraryActions";
import { CaseLabelsField, EditorAccordionSection } from "./CaseWorkspacePrimitives";
import { type TestCaseDraft, type StepDraft, type DraftTestStep, type StepInsertionGroupContext, type TestCaseEditorSectionKey, type TestCaseDetailTab } from "./testCaseWorkspaceTypes";
import { FormEvent } from "react";
import { BugIcon, OpenIcon, PencilIcon, TestCaseIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { ExternalReferencesField } from "@hellotest/manual/frontend/components/ExternalReferencesField";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { ContextSelect } from "@hellotest/platform/frontend/src/shared/components/ContextSelect";
import { AuthoringContextMenu } from "@hellotest/platform/frontend/src/shared/components/AuthoringContextMenu";
import { RichTextEditor } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { formatAuditTimestamp, resolveAuditUserLabel } from "@hellotest/platform/frontend/src/shared/lib/auditDisplay";
import { type BugToTestCaseDraft } from "./../../lib/bugToTestCaseConversion";
import { type DeliveryScopeOption } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import type { Requirement, TestCase, TestCaseModule, TestSuite, User } from "@hellotest/platform/frontend/src/types";

export interface CaseMetadataAuthoringInputs {
  appTypeId: string;
  session: SessionPayload | null;
  canCreateTestCases: boolean;
  canUpdateTestCases: boolean;
  canViewRequirements: boolean;
  canViewDeliveryScopes: boolean;
  canUseAutomationWorkspace: boolean;
  setActiveTestCaseDetailTab: React.Dispatch<React.SetStateAction<TestCaseDetailTab>>;
  testCaseModules: TestCaseModule[];
  isCreating: boolean;
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>;
  reviewComment: string;
  setReviewComment: React.Dispatch<React.SetStateAction<string>>;
  setIsQualitySuggestionModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  caseDeliveryRelease: string;
  setCaseDeliveryRelease: React.Dispatch<React.SetStateAction<string>>;
  caseDeliverySprint: string;
  setCaseDeliverySprint: React.Dispatch<React.SetStateAction<string>>;
  expandedSections: Record<TestCaseEditorSectionKey, boolean>;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<TestCaseEditorSectionKey, boolean>>>;
  defaultTestCaseStatus: string;
  testCaseStatusOptions: DomainOption[];
  caseDraft: TestCaseDraft;
  setCaseDraft: React.Dispatch<React.SetStateAction<TestCaseDraft>>;
  testCaseTypeOptions: DomainOption[];
  setNewStepDraft: React.Dispatch<React.SetStateAction<StepDraft>>;
  setStepInsertIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setStepInsertGroupContext: React.Dispatch<React.SetStateAction<StepInsertionGroupContext | null>>;
  setDraftSteps: React.Dispatch<React.SetStateAction<DraftTestStep[]>>;
  setSelectedStepIds: React.Dispatch<React.SetStateAction<string[]>>;
  caseSectionRef: React.MutableRefObject<HTMLDivElement | null>;
  createSuiteContextId: string;
  setCreateSuiteContextId: React.Dispatch<React.SetStateAction<string>>;
  activeBugConversion: BugToTestCaseDraft | null;
  setActiveBugConversion: React.Dispatch<React.SetStateAction<BugToTestCaseDraft | null>>;
  createTestCase: { isPending: boolean };
  assignCasesToModule: { isPending: boolean };
  removeCasesFromModule: { isPending: boolean };
  reviewTestCase: { isPending: boolean };
  updateSuite: { isPending: boolean };
  updateTestCase: { isPending: boolean };
  updateStep: { isPending: boolean };
  requirements: Requirement[];
  deliveryReleaseOptions: DeliveryScopeOption[];
  deliverySprintOptions: DeliveryScopeOption[];
  creationRequirementOptions: Requirement[];
  visibleCreationRequirementOptions: Requirement[];
  suites: TestSuite[];
  userById: Record<string, User>;
  assigneeOptions: AssigneeOption[];
  updateCaseDeliveryScope: (release: string, sprint: string) => void;
  updateCaseRequirement: (requirementId: string) => void;
  existingCaseLabels: string[];
  selectedTestCase: TestCase | null;
  selectedCaseDisplayId: string;
  linkedAutomationCases: TestCase[];
  isSelectedTestCaseDetailPending: boolean;
  canReviewSelectedTestCase: boolean;
  isSelectedReviewPending: boolean;
  selectedReviewStatus: TestCaseReviewStatus;
  handleSaveCase: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteCase: () => Promise<void>;
  handleSubmitReview: (reviewStatus: "accepted" | "changes_requested") => Promise<void>;
  openReviewSuggestionDialog: (testCaseId: string, comment?: string, snapshot?: TestCase) => void;
  computedCaseAiQualityScore: number;
  caseQualitySuggestions: string[];
  testCaseReviewReadiness: AiAssuranceAssessment;
  isTestCaseWorkspaceMutationPending: boolean;
  readableCaseTitle: string;
  readableCaseDescription: string;
  hasReadableCasePreview: boolean;
  caseSectionSummary: "Enter the reusable case details before saving it." | "Update the reusable test case definition, ownership, traceability, and references.";
  caseSectionTitleContent: "New test case" | "Case details";
}

export function CaseMetadataAuthoring({ appTypeId, session, canCreateTestCases, canUpdateTestCases, canViewRequirements, canViewDeliveryScopes, canUseAutomationWorkspace, setActiveTestCaseDetailTab, testCaseModules, isCreating, setIsCreating, reviewComment, setReviewComment, setIsQualitySuggestionModalOpen, caseDeliveryRelease, setCaseDeliveryRelease, caseDeliverySprint, setCaseDeliverySprint, expandedSections, setExpandedSections, defaultTestCaseStatus, testCaseStatusOptions, caseDraft, setCaseDraft, testCaseTypeOptions, setNewStepDraft, setStepInsertIndex, setStepInsertGroupContext, setDraftSteps, setSelectedStepIds, caseSectionRef, createSuiteContextId, setCreateSuiteContextId, activeBugConversion, setActiveBugConversion, createTestCase, assignCasesToModule, removeCasesFromModule, reviewTestCase, updateSuite, updateTestCase, updateStep, requirements, deliveryReleaseOptions, deliverySprintOptions, creationRequirementOptions, visibleCreationRequirementOptions, suites, userById, assigneeOptions, updateCaseDeliveryScope, updateCaseRequirement, existingCaseLabels, selectedTestCase, selectedCaseDisplayId, linkedAutomationCases, isSelectedTestCaseDetailPending, canReviewSelectedTestCase, isSelectedReviewPending, selectedReviewStatus, handleSaveCase, handleDeleteCase, handleSubmitReview, openReviewSuggestionDialog, computedCaseAiQualityScore, caseQualitySuggestions, testCaseReviewReadiness, isTestCaseWorkspaceMutationPending, readableCaseTitle, readableCaseDescription, hasReadableCasePreview, caseSectionSummary, caseSectionTitleContent }: CaseMetadataAuthoringInputs) {
  return (<aside className="test-case-detail-sidebar" aria-label="Test case details and preconditions">
                  <div className="test-case-detail-case-region" ref={caseSectionRef}>
                    <EditorAccordionSection
                      countLabel={isCreating ? "Draft" : caseDraft.status || defaultTestCaseStatus}
                      isExpanded={expandedSections.case}
                      onToggle={() => setExpandedSections((current) => ({ ...current, case: !current.case }))}
                      summary={caseSectionSummary}
                      title={caseSectionTitleContent}
                    >
                      <form id="test-case-authoring-form" className="form-grid test-case-details-form" onInvalidCapture={event => { let panel = (event.target as HTMLElement).closest("details"); while (panel) { panel.open = true; panel = panel.parentElement?.closest("details") || null; } }} onSubmit={(event) => void handleSaveCase(event)}>
                        {!isCreating && selectedTestCase ? (
                          <div className="test-case-detail-identity-card">
                            <span>Test case ID</span>
                            <span className="test-case-detail-record-id test-case-identity">
                              <TestCaseIcon size={15} strokeWidth={1.8} />
                              <DisplayIdBadge value={selectedCaseDisplayId || "Unavailable"} />
                            </span>
                          </div>
                        ) : null}

                        {isCreating && activeBugConversion ? (
                          <section className="bug-conversion-map" aria-label={`Mapped fields from Defect ${activeBugConversion.bugDisplayId}`}>
                            <div className="bug-conversion-map-head">
                              <span className="bug-conversion-map-icon"><BugIcon /></span>
                              <span>
                                <strong>Mapped from Defect {activeBugConversion.bugDisplayId}</strong>
                                <small>Review the imported regression coverage before creating the Test Case.</small>
                              </span>
                              <button
                                className="ghost-button compact"
                                onClick={() => {
                                  setCaseDraft((current) => ({ ...current, requirement_id: "", module_id: "" }));
                                  setCreateSuiteContextId("");
                                  setActiveBugConversion((current) => current ? ({
                                    ...current,
                                    requirementIds: [],
                                    moduleIds: [],
                                    suiteIds: []
                                  }) : current);
                                }}
                                type="button"
                              >
                                Clear linked scope
                              </button>
                            </div>
                            <p>
                              Title, description, priority, labels, delivery context, preconditions, and reproduction steps were copied. The new Test Case will remain linked to the source Defect.
                            </p>
                            {activeBugConversion.requirementIds.length || activeBugConversion.moduleIds.length || createSuiteContextId || activeBugConversion.suiteIds.length ? (
                              <div className="bug-conversion-scope-chips" aria-label="Additional imported associations">
                                {activeBugConversion.requirementIds.map((requirementId) => {
                                  const requirement = requirements.find((item: Requirement) => item.id === requirementId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`requirement:${requirementId}`}>
                                      Story · {requirement?.display_id || requirement?.title || requirementId}
                                      <button
                                        aria-label={`Remove imported Story ${requirement?.display_id || requirement?.title || requirementId}`}
                                        onClick={() => setActiveBugConversion((current) => current ? ({ ...current, requirementIds: current.requirementIds.filter((id) => id !== requirementId) }) : current)}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                                {activeBugConversion.moduleIds.map((moduleId) => {
                                  const module = testCaseModules.find((item) => item.id === moduleId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`module:${moduleId}`}>
                                      Module · {module?.name || moduleId}
                                      <button
                                        aria-label={`Remove imported Module ${module?.name || moduleId}`}
                                        onClick={() => setActiveBugConversion((current) => current ? ({ ...current, moduleIds: current.moduleIds.filter((id) => id !== moduleId) }) : current)}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                                {[...new Set([createSuiteContextId, ...activeBugConversion.suiteIds].filter(Boolean))].map((suiteId) => {
                                  const suite = suites.find((item) => item.id === suiteId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`suite:${suiteId}`}>
                                      Suite · {suite?.display_id || suite?.name || suiteId}
                                      <button
                                        aria-label={`Remove imported Suite ${suite?.display_id || suite?.name || suiteId}`}
                                        onClick={() => {
                                          const nextSuiteIds = [createSuiteContextId, ...activeBugConversion.suiteIds]
                                            .filter((id) => id && id !== suiteId);
                                          setCreateSuiteContextId(nextSuiteIds[0] || "");
                                          setActiveBugConversion((current) => current ? ({ ...current, suiteIds: nextSuiteIds.slice(1) }) : current);
                                        }}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null}
                          </section>
                        ) : null}

                        <FormField className="test-case-authoring-field" label="Authoring completeness">
                          <div className="ai-quality-inline test-case-authoring-completeness">
                            <span className={computedCaseAiQualityScore < 70 ? "ai-quality-score is-low" : "ai-quality-score"}>
                              {computedCaseAiQualityScore}%
                            </span>
                            <span>{testCaseReviewReadiness.summary}</span>
                            {computedCaseAiQualityScore < 70 && caseQualitySuggestions.length ? (
                              <button className="ghost-button compact" onClick={() => setIsQualitySuggestionModalOpen(true)} type="button">
                                <TestCaseSparkIcon />
                                <span>Review gaps</span>
                              </button>
                            ) : null}
                          </div>
                        </FormField>

                        <div className="record-grid">
                          <div className="test-case-title-field">
                            <FormField label="Title" required>
                              <input
                                data-autofocus={isCreating ? "true" : undefined}
                                placeholder="Name the behavior…"
                                required
                                value={caseDraft.title}
                                onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))}
                              />
                            </FormField>
                          </div>
                          <FormField className="test-case-description-field" label="Description">
                            <RichTextEditor
                              appearance="canonical"
                              aiRephraseContext={{
                                entityType: "test case",
                                entityId: selectedTestCase?.id,
                                entityTitle: caseDraft.title,
                                fieldLabel: "Description",
                                appTypeId,
                                requirementId: caseDraft.requirement_id || undefined,
                                moduleId: caseDraft.module_id || undefined
                              }}
                              aiRephraseTitle="Rephrase test case description with AI"
                              rows={4}
                              value={caseDraft.description}
                              onChange={(description) => setCaseDraft((current) => ({ ...current, description }))}
                            />
                          </FormField>
                          <FormField className="form-field--compact-enum test-case-status-field authoring-property-field" label="Status">
                            <ContextSelect label="Status"
                              value={caseDraft.status}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))}
                            >
                              {testCaseStatusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </ContextSelect>
                          </FormField>
                          <FormField className="form-field--compact-enum test-case-priority-field authoring-property-field" label="Priority">
                            <ContextSelect label="Priority"
                              value={caseDraft.priority}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                            >
                              <option value={1}>1 - Highest</option>
                              <option value={2}>2 - High</option>
                              <option value={3}>3 - Medium</option>
                              <option value={4}>4 - Low</option>
                              <option value={5}>5 - Lowest</option>
                            </ContextSelect>
                          </FormField>
                          <details id="test-case-context-properties" className="test-case-context-properties authoring-disclosure" open={!caseDraft.author_id}>
                            <summary><span>Properties & linked work</span><small>{caseDraft.requirement_id ? "Story linked" : caseDraft.module_id ? "Module linked" : caseDraft.test_case_type || "Functional"}</small></summary>
                            <div className="authoring-disclosure-body record-grid">
                          <FormField className="form-field--compact-enum" label="Test case type">
                            <select
                              aria-describedby="test-case-type-hint"
                              value={caseDraft.test_case_type}
                              onChange={(event) => setCaseDraft((current) => ({
                                ...current,
                                test_case_type: event.target.value as NonNullable<TestCase["test_case_type"]>
                              }))}
                            >
                              {testCaseTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <small id="test-case-type-hint">
                              {testCaseTypeOptions.find((option) => option.value === caseDraft.test_case_type)?.description}
                            </small>
                          </FormField>
                          <FormField className="test-case-author-selector-field" label="Author" required>
                            <select
                              aria-label="Test case author"
                              required
                              value={caseDraft.author_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, author_id: event.target.value }))}
                            >
                              <option disabled value="">Select an author</option>
                              {caseDraft.author_id && !assigneeOptions.some((option) => option.id === caseDraft.author_id) ? (
                                <option value={caseDraft.author_id}>
                                  {caseDraft.author_id === session?.user.id
                                    ? `${session.user.name || session.user.email || "Current user"} (You)`
                                    : `${selectedTestCase?.author?.name || selectedTestCase?.author?.email || "Current author"} (Former project member)`}
                                </option>
                              ) : null}
                              {assigneeOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}{option.id === session?.user.id ? " (You)" : ""}
                                </option>
                              ))}
                            </select>
                          </FormField>
                          <FormField className="test-case-reviewer-field" label="Reviewer">
                            <select
                              value={caseDraft.reviewer_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, reviewer_id: event.target.value }))}
                            >
                              <option value="">No reviewer</option>
                              {assigneeOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </FormField>
                          {isCreating && canViewDeliveryScopes ? (
                            <FormField label="Release" hint="Filters the Story choices without storing duplicate release data on the test case.">
                              <select
                                aria-label="Test case release scope"
                                value={caseDeliveryRelease}
                                onChange={(event) => updateCaseDeliveryScope(event.target.value, caseDeliverySprint)}
                              >
                                <option value="">All releases</option>
                                {deliveryReleaseOptions.map((option) => (
                                  <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          ) : null}
                          {isCreating && canViewDeliveryScopes ? (
                            <FormField label="Sprint" hint="Filters Story choices to the selected sprint.">
                              <select
                                aria-label="Test case sprint scope"
                                value={caseDeliverySprint}
                                onChange={(event) => updateCaseDeliveryScope(caseDeliveryRelease, event.target.value)}
                              >
                                <option value="">All sprints</option>
                                {deliverySprintOptions.map((option) => (
                                  <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          ) : null}
                          {canViewRequirements ? <FormField
                            label="Story"
                            hint={isCreating && (caseDeliveryRelease || caseDeliverySprint)
                              ? `${creationRequirementOptions.length} matching ${creationRequirementOptions.length === 1 ? "story" : "stories"}`
                              : undefined}
                          >
                            <select
                              value={caseDraft.requirement_id}
                              onChange={(event) => updateCaseRequirement(event.target.value)}
                            >
                              <option value="">No story</option>
                              {(isCreating ? visibleCreationRequirementOptions : requirements).map((requirement: Requirement) => (
                                <option key={requirement.id} value={requirement.id}>
                                  {requirement.display_id ? `${requirement.display_id} · ` : ""}{requirement.title}
                                </option>
                              ))}
                            </select>
                          </FormField> : null}
                          <FormField label="Module">
                            <select
                              value={caseDraft.module_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, module_id: event.target.value }))}
                            >
                              <option value="">No module</option>
                              {testCaseModules.map((module) => (
                                <option key={module.id} value={module.id}>{module.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <div className="test-case-labels-field">
                            <CaseLabelsField
                              availableLabels={existingCaseLabels}
                              value={caseDraft.labelsText}
                              onChange={(labelsText) => setCaseDraft((current) => ({ ...current, labelsText }))}
                            />
                          </div>
                            </div>
                          </details>
                        </div>
                        <AuthoringContextMenu sections={[{ id: "test-case-context-properties", label: "Properties & linked work", icon: <TestCaseIcon size={16} />, summary: "Ownership, scope and labels" }, { id: "test-case-advanced-properties", label: "Advanced details", icon: <PencilIcon size={16} />, disabled: !(canUseAutomationWorkspace || hasReadableCasePreview || (!isCreating && selectedTestCase && canReviewSelectedTestCase)) }]} disabled={isTestCaseWorkspaceMutationPending} />
                        <ExternalReferencesField
                          value={caseDraft.externalReferencesText}
                          onChange={(externalReferencesText) => setCaseDraft((current) => ({ ...current, externalReferencesText }))}
                        />

                        {canUseAutomationWorkspace || hasReadableCasePreview || (!isCreating && selectedTestCase && canReviewSelectedTestCase) ? (
                          <details id="test-case-advanced-properties" className="test-case-details-advanced">
                            <summary>
                              <span>
                                <strong>Advanced details</strong>
                                <small>Parameter preview, traceability, and review workflow</small>
                              </span>
                              <span>Manual test design</span>
                            </summary>
                            <div className="test-case-details-advanced-body">
                              {hasReadableCasePreview ? (
                                <div className="step-parameter-preview">
                                  <span className="step-parameter-preview-label">Readable preview on this screen</span>
                                  <strong>{readableCaseTitle || "No title written yet"}</strong>
                                  <span>{readableCaseDescription || "Description, step cards, and section summaries will resolve saved values here without changing the stored authoring text."}</span>
                                </div>
                              ) : null}

                              {!isCreating && selectedTestCase && canUseAutomationWorkspace ? (
                          <div className="detail-summary automation-link-summary">
                            <strong>Automation cases</strong>
                            <span>
                              Executable keywords, recorder evidence, and repository bindings are maintained in dedicated Automation Cases. This manual case remains the traceable source.
                            </span>
                            <StatusBadge value={linkedAutomationCases.length ? "linked" : "not linked"} />
                            <button className="ghost-button compact" onClick={() => setActiveTestCaseDetailTab("automation")} type="button">
                              <OpenIcon size={16} />
                              <span>{linkedAutomationCases.length ? `View automation cases (${linkedAutomationCases.length})` : "Create automation twin"}</span>
                            </button>
                          </div>
                              ) : null}

                              {!isCreating && selectedTestCase && canReviewSelectedTestCase ? (
                          <details
                            className="detail-summary test-case-review-summary"
                            key={`${selectedTestCase.id}:${selectedReviewStatus}`}
                            open={isSelectedReviewPending}
                          >
                            <summary className="test-case-review-summary-head">
                              <div>
                                <strong>Review</strong>
                                <span>{TEST_CASE_REVIEW_STATUS_LABELS[selectedReviewStatus]}</span>
                              </div>
                              <StatusBadge value={isSelectedReviewPending ? "pending" : "completed"} />
                            </summary>
                            <div className="test-case-review-summary-body">
                              {isSelectedReviewPending ? (
                                <>
                                  <textarea
                                    placeholder="Reviewer comments"
                                    rows={2}
                                    value={reviewComment}
                                    onChange={(event) => setReviewComment(event.target.value)}
                                  />
                                  <div className="action-row">
                                    <button
                                      className="ghost-button compact test-case-review-reject"
                                      disabled={reviewTestCase.isPending}
                                      onClick={() => openReviewSuggestionDialog(selectedTestCase.id, reviewComment)}
                                      type="button"
                                    >
                                      Suggest changes
                                    </button>
                                    <button
                                      className="primary-button compact test-case-review-approve"
                                      disabled={reviewTestCase.isPending}
                                      onClick={() => void handleSubmitReview("accepted")}
                                      type="button"
                                    >
                                      Accept
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="review-readonly-note">
                                  Review action is complete. Expand this section to inspect the captured decision history.
                                </div>
                              )}
                              {selectedTestCase.review_history?.length ? (
                                <div className="data-table-multiline">
                                  {selectedTestCase.review_history.slice().reverse().slice(0, 4).map((entry) => (
                                    <span className="data-table-multiline-line" key={entry.id}>
                                      {`${TEST_CASE_REVIEW_STATUS_LABELS[entry.status]} · ${resolveAuditUserLabel(entry.user_id, userById)} · ${formatAuditTimestamp(entry.created_at)}${entry.comment ? ` · ${entry.comment}` : ""}`}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </details>
                              ) : null}
                            </div>
                          </details>
                        ) : null}

                        <div className="action-row test-case-inline-save-actions">
		                          <button className="primary-button" disabled={(isCreating ? !canCreateTestCases : !canUpdateTestCases || isSelectedTestCaseDetailPending || !selectedTestCase) || createTestCase.isPending || updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending} type="submit">
                            {isCreating
                              ? (createTestCase.isPending || updateSuite.isPending || assignCasesToModule.isPending ? "Creating…" : "Create test case")
                              : (updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case")}
                          </button>
                          {isCreating ? (
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setCreateSuiteContextId("");
                                setIsCreating(false);
                                setCaseDeliveryRelease("");
                                setCaseDeliverySprint("");
                                setDraftSteps([]);
                                setNewStepDraft(EMPTY_STEP_DRAFT);
                                setStepInsertIndex(null);
                                setStepInsertGroupContext(null);
                                setSelectedStepIds([]);
                              }}
                              type="button"
                            >
                              Cancel new case
                            </button>
                          ) : null}
                          {!isCreating && selectedTestCase ? (
                            <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                              Delete test case
                            </button>
                          ) : null}
                        </div>
                      </form>
                    </EditorAccordionSection>
                  </div>

                  </aside>);
}
