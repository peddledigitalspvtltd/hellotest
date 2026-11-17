import "./ExecutionCreateDrawer.css";
import type { AiDesignImageInput } from '@hellotest/platform/frontend/src/types';
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { FormEvent, useMemo, useState } from "react";
import { IconCheckbox, IconClock, IconDatabase, IconRocket, IconShieldCheck, IconSparkles, IconX } from "@tabler/icons-react";
import { SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AppTypeDropdown } from "@hellotest/platform/frontend/src/platform/components/AppTypeDropdown";
import { AiEvidenceButton, AiEvidenceFlyout } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { ExecutionContextSelector } from "./ExecutionContextSelector";
import { RunDataSetup } from "./RunDataSetup";
import { TestCasePicker, type TestCaseSelectionResolution } from "./TestCasePicker";
import { runCaseReferences } from "../lib/runPickerCases";
import { expandSelectedSuiteIds } from "../lib/runDataTemplate";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { ProjectDropdown } from "@hellotest/platform/frontend/src/platform/components/ProjectDropdown";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { RunPlanningFields } from "./RunPlanningFields";
import { RunHooksBuilder, type RunHookSelection } from "./RunHooksBuilder";
import { SuiteScopePicker, type SuitePickerMetadataByCaseId } from "./SuiteCasePicker";
import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import type { AppType, Integration, Project, SmartExecutionPreviewResponse, TestCase, TestSuite } from "@hellotest/platform/frontend/src/types";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const AiReferenceImages = capabilityView<import('react').ComponentProps<typeof import('@hellotest/ai/frontend/components/AiReferenceImages')['AiReferenceImages']>>('ai', 'AiReferenceImages', () => import('@hellotest/ai/frontend/components/AiReferenceImages'), 'Reference screenshots');
type ExecutionCreateMode = "manual" | "smart";
type ExecutionStartMode = "manual" | "remote" | "local";
type ExecutionHookDraft = RunHookSelection[];
type ExecutionAssigneeOption = AssigneeOption;
type SmartExecutionRequirementOption = { id: string; title: string; description: string | null; linkedCaseCount: number };

function formatBuilderDuration(ms: number) { return ms > 60000 ? `${Math.round(ms / 60000)} min` : `${Math.max(1, Math.round(ms / 1000))}s`; }
function executionImpactLevelLabel(level: string) { return level === "high" ? "High impact" : level === "medium" ? "Medium impact" : "Low impact"; }

export function ExecutionCreateModal({
  projects,
  projectId,
  onProjectChange,
  appTypes,
  appTypeId,
  onAppTypeChange,
  executionCreateMode,
  onExecutionCreateModeChange,
  executionStartMode,
  onExecutionStartModeChange,
  executionStartDate,
  executionEndDate,
  onExecutionStartDateChange,
  onExecutionEndDateChange,
  executionParallelEnabled,
  executionParallelCount,
  onExecutionParallelEnabledChange,
  onExecutionParallelCountChange,
  selectedProject,
  selectedAppType,
  scopeSuites,
  isLoadingSuites = false,
  selectedSuiteIds,
  selectedDirectCaseIds = [],
  onDirectCaseSelectionChange,
  onDirectCaseItemsResolved,
  onDirectCaseResolutionChange,
  directCaseSelectionMessage,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  dataOptions, onDataOptionsChange,
  selectedExecutionAssigneeIds,
  executionRelease,
  executionSprint,
  executionBuild,
  releaseOptions,
  sprintOptions,
  buildOptions,
  assigneeOptions,
  integrations,
  executionHookDraft,
  libraryCases,
  metadataByCaseId = {},
  smartExecutionIntegrationId,
  smartExecutionReleaseScope,
  smartExecutionAdditionalContext,
  smartExecutionImages = [],
  onSmartExecutionImagesChange,
  onSmartExecutionImagesBusyChange,
  smartExecutionRequirementOptions,
  smartExecutionRequirementSearch,
  smartExecutionPreview,
  selectedSmartRequirementIds,
  selectedSmartExecutionCaseIds,
  smartExecutionPreviewMessage,
  smartExecutionPreviewTone,
  onExecutionNameChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onExecutionHookDraftChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onSuiteSelectionChange,
  onPreviewSmartExecution,
  onSmartExecutionIntegrationChange,
  onSmartExecutionReleaseScopeChange,
  onSmartExecutionAdditionalContextChange,
  onSmartExecutionRequirementSearchChange,
  onToggleSmartExecutionRequirement,
  onToggleSmartExecutionCase,
  onSelectAllSmartExecutionRequirements,
  onClearSmartExecutionRequirements,
  onSelectAllSmartExecutionCases,
  onClearSmartExecutionCases,
  canConfigureParallelAutomation,
  canRunLocalAutomation,
  canRunRemoteAutomation,
  canUseRunAi,
  canCreateExecution,
  isPreviewingSmartExecution,
  isSubmitting,
  isResolvingCases = false,
  isPreparingDeliveryOptions = false,
  caseResolutionError,
  onRetryCaseResolution,
  onClose,
  onSubmit
}: {
  projects: Pick<Project, "id" | "display_id" | "name">[];
  projectId: string;
  onProjectChange: (value: string) => void;
  appTypes: AppType[];
  appTypeId: string;
  onAppTypeChange: (value: string) => void;
  executionCreateMode: ExecutionCreateMode;
  onExecutionCreateModeChange: (value: ExecutionCreateMode) => void;
  executionStartMode: ExecutionStartMode;
  onExecutionStartModeChange: (value: ExecutionStartMode) => void;
  executionStartDate: string;
  executionEndDate: string;
  onExecutionStartDateChange: (value: string) => void;
  onExecutionEndDateChange: (value: string) => void;
  executionParallelEnabled: boolean;
  executionParallelCount: number;
  onExecutionParallelEnabledChange: (value: boolean) => void;
  onExecutionParallelCountChange: (value: number) => void;
  selectedProject: string;
  selectedAppType: string;
  scopeSuites: TestSuite[];
  isLoadingSuites?: boolean;
  selectedSuiteIds: string[];
  selectedDirectCaseIds?: string[];
  onDirectCaseSelectionChange?: (ids: string[], items: TestCase[]) => void;
  onDirectCaseItemsResolved?: (items: TestCase[]) => void;
  onDirectCaseResolutionChange?: (resolution: TestCaseSelectionResolution) => void;
  directCaseSelectionMessage?: string;
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions?: TestDataOptions; onDataOptionsChange?: (value: TestDataOptions) => void;
  selectedExecutionAssigneeIds: string[];
  executionRelease: string;
  executionSprint: string;
  executionBuild: string;
  releaseOptions: Array<{ value: string; label: string }>;
  sprintOptions: Array<{ value: string; label: string }>;
  buildOptions: string[];
  assigneeOptions: ExecutionAssigneeOption[];
  integrations: Integration[];
  executionHookDraft: ExecutionHookDraft;
  libraryCases: TestCase[];
  metadataByCaseId?: SuitePickerMetadataByCaseId;
  smartExecutionIntegrationId: string;
  smartExecutionReleaseScope: string;
  smartExecutionAdditionalContext: string;
  smartExecutionImages?: AiDesignImageInput[];
  onSmartExecutionImagesChange?: (images:AiDesignImageInput[])=>void;
  onSmartExecutionImagesBusyChange?: (busy:boolean)=>void;
  smartExecutionRequirementOptions: SmartExecutionRequirementOption[];
  smartExecutionRequirementSearch: string;
  smartExecutionPreview: SmartExecutionPreviewResponse | null;
  selectedSmartRequirementIds: string[];
  selectedSmartExecutionCaseIds: string[];
  smartExecutionPreviewMessage: string;
  smartExecutionPreviewTone: "success" | "error";
  onExecutionNameChange: (value: string) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onExecutionHookDraftChange: (value: ExecutionHookDraft) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string[]) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onPreviewSmartExecution: () => void;
  onSmartExecutionIntegrationChange: (value: string) => void;
  onSmartExecutionReleaseScopeChange: (value: string) => void;
  onSmartExecutionAdditionalContextChange: (value: string) => void;
  onSmartExecutionRequirementSearchChange: (value: string) => void;
  onToggleSmartExecutionRequirement: (requirementId: string) => void;
  onToggleSmartExecutionCase: (testCaseId: string) => void;
  onSelectAllSmartExecutionRequirements: (requirementIds: string[]) => void;
  onClearSmartExecutionRequirements: () => void;
  onSelectAllSmartExecutionCases: () => void;
  onClearSmartExecutionCases: () => void;
  canConfigureParallelAutomation: boolean;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  canUseRunAi: boolean;
  canCreateExecution: boolean;
  isPreviewingSmartExecution: boolean;
  isSubmitting: boolean;
  isResolvingCases?: boolean;
  isPreparingDeliveryOptions?: boolean;
  caseResolutionError?: unknown;
  onRetryCaseResolution?: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {

  const { can } = useCapabilityAccess(projectId);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    closeDisabled: isSubmitting || isPreviewingSmartExecution,
    onClose
  });
  const [dataSetValid, setDataSetValid] = useState(!selectedDataSetId);
  const [smartSidebarTab, setSmartSidebarTab] = useState<"context" | "settings">("context");
  const [smartEvidenceView, setSmartEvidenceView] = useState<{ kind: "plan" } | { kind: "case"; caseId: string } | null>(null);
  const [areSmartHooksOpen, setAreSmartHooksOpen] = useState(Boolean(executionHookDraft.length));
  const canCreateRunMode = executionStartMode === "local" ? can("automation.run.local")
    : executionStartMode === "remote" ? can("automation.run.remote") : can("run.create");
  const isSmartMode = canUseRunAi && executionCreateMode === "smart";
  const smartExecutionDefaultIntegrationId = useAiLlmDefault({ usageKey: "ai.execution.smart_plan", projectId, integrations, enabled: isSmartMode });
  const smartPreviewCases = smartExecutionPreview?.cases || [];
  const hasSmartPlanningInput = Boolean(
    executionRelease.trim()
    || executionSprint.trim()
    || executionBuild.trim()
    || smartExecutionReleaseScope.trim()
    || smartExecutionAdditionalContext.trim()
    || selectedSmartRequirementIds.length
  );
  const canGenerateSmartPlan = Boolean(
    projectId
    && appTypeId
    && hasSmartPlanningInput
    && !isPreviewingSmartExecution
    && !isSubmitting
  );
  const libraryCaseById = useMemo(() => new Map(libraryCases.map((testCase) => [testCase.id, testCase])), [libraryCases]);
  const isEngineSmartMode = isSmartMode && executionStartMode !== "manual";
  const automatedSmartPreviewCount = smartPreviewCases.filter((testCase) => libraryCaseById.get(testCase.test_case_id)?.automated === "yes").length;
  const normalizedRequirementSearch = smartExecutionRequirementSearch.trim().toLowerCase();
  const filteredSmartRequirementOptions = normalizedRequirementSearch
    ? smartExecutionRequirementOptions.filter((requirement) =>
        [requirement.title, requirement.description || ""].some((value) => value.toLowerCase().includes(normalizedRequirementSearch))
      )
    : smartExecutionRequirementOptions;
  const areAllVisibleSmartRequirementsSelected =
    Boolean(filteredSmartRequirementOptions.length)
    && filteredSmartRequirementOptions.every((requirement) => selectedSmartRequirementIds.includes(requirement.id));
  const selectedSmartCaseCount = selectedSmartExecutionCaseIds.length;
  const selectedSmartExecutableCaseCount = isEngineSmartMode
    ? selectedSmartExecutionCaseIds.filter((testCaseId) => libraryCaseById.get(testCaseId)?.automated === "yes").length
    : selectedSmartCaseCount;
  const areAllSmartCasesSelected = isEngineSmartMode
    ? Boolean(automatedSmartPreviewCount) && selectedSmartExecutableCaseCount === automatedSmartPreviewCount
    : Boolean(smartPreviewCases.length) && selectedSmartCaseCount === smartPreviewCases.length;
  const activeSmartEvidenceCase = smartEvidenceView?.kind === "case"
    ? smartPreviewCases.find((testCase) => testCase.test_case_id === smartEvidenceView.caseId) || null
    : null;
  const activeSmartEvidenceRefs = new Set(activeSmartEvidenceCase?.evidence_refs || []);
  const activeSmartEvidenceRecords = (smartExecutionPreview?.evidence || []).filter((record) =>
    smartEvidenceView?.kind === "plan" || activeSmartEvidenceRefs.has(record.ref)
  );
  const activeSmartEvidenceContext = smartExecutionPreview?.context || null;
  const selectedSuiteIdSet = expandSelectedSuiteIds(scopeSuites, selectedSuiteIds);
  const selectedSuiteCaseIds = new Set(
    scopeSuites
      .filter((suite) => selectedSuiteIdSet.has(suite.id))
      .flatMap((suite) => suite.test_case_ids || [])
  );
  let estimatedDurationMs = 0;
  let estimatedDurationSampleCount = 0;
  selectedSuiteCaseIds.forEach((testCaseId) => {
    const testCase = libraryCaseById.get(testCaseId);
    const durationMs = Number(testCase?.duration_ms || 0);
    const durationMinutes = Number(testCase?.estimated_duration_minutes || testCase?.average_duration_minutes || 0);

    if (Number.isFinite(durationMs) && durationMs > 0) {
      estimatedDurationMs += durationMs;
      estimatedDurationSampleCount += 1;
    } else if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      estimatedDurationMs += durationMinutes * 60_000;
      estimatedDurationSampleCount += 1;
    }
  });
  const estimatedDurationLabel = selectedSuiteCaseIds.size > 0 && estimatedDurationSampleCount === selectedSuiteCaseIds.size
    ? formatBuilderDuration(estimatedDurationMs)
    : "Not estimated";
  return (
    <div className={`modal-backdrop modal-backdrop--scroll execution-create-backdrop${isSmartMode ? " execution-smart-studio-backdrop" : ""}`} onClick={() => !isSubmitting && !isPreviewingSmartExecution && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-title"
        aria-modal="true"
        className={[
          "modal-card execution-create-modal execution-run-builder-modal execution-create-drawer",
          isSmartMode ? "execution-smart-studio-modal ai-feature-dialog" : ""
        ].filter(Boolean).join(" ")}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form className="execution-create-form" onSubmit={event => { if (!dataSetValid) { event.preventDefault(); return; } onSubmit(event); }}>
          <div className="execution-create-header execution-run-builder-header">
            <div className="execution-run-builder-title">
              <span className="execution-run-builder-title-icon" aria-hidden="true">
                {isSmartMode ? <IconSparkles size={18} stroke={1.9} /> : <IconRocket size={17} stroke={1.9} />}
              </span>
              <div className="execution-run-builder-title-copy">
                <h2 className="dialog-title" id="create-execution-title">
                  {isSmartMode ? "AI Smart Run" : "Create new run"}
                </h2>
                {isSmartMode ? <span>Choose context, review coverage, create a run</span> : null}
              </div>
            </div>
            <div className="execution-run-builder-header-actions">
              <button
                aria-label="Close create run dialog"
                className="ghost-button dialog-close-button"
                disabled={isSubmitting || isPreviewingSmartExecution}
                onClick={onClose}
                title="Close create run dialog"
                type="button"
              >
                <IconX aria-hidden="true" size={19} stroke={1.9} />
              </button>
            </div>
          </div>

          <div className="execution-create-body execution-run-builder-body">
            <aside className="execution-run-config-rail" aria-label="Run configuration">
              <div className="execution-run-config-heading">
                <span>{isSmartMode ? "Context & settings" : "Run Configuration"}</span>
                {isSmartMode ? <small>Choose the changes and stories to cover.</small> : null}
              </div>

              {isSmartMode ? (
                <div className="execution-smart-sidebar-tabs" role="tablist" aria-label="Smart run setup">
                  <button aria-selected={smartSidebarTab === "context"} aria-controls="smart-run-context-panel" id="smart-run-context-tab" role="tab" type="button" onClick={() => setSmartSidebarTab("context")}>Context</button>
                  <button aria-selected={smartSidebarTab === "settings"} aria-controls="smart-run-settings-panel" id="smart-run-settings-tab" role="tab" type="button" onClick={() => setSmartSidebarTab("settings")}>Run settings</button>
                </div>
              ) : null}
              <div className="execution-run-config-stack" hidden={isSmartMode && smartSidebarTab !== "context"} id="smart-run-context-panel" role={isSmartMode ? "tabpanel" : undefined} aria-labelledby={isSmartMode ? "smart-run-context-tab" : undefined}>
              <FormField label="Project" required>
                <ProjectDropdown
                  ariaLabel="Select a project"
                  onChange={onProjectChange}
                  projects={!projectId || projects.some(project => project.id === projectId) ? projects : [...projects, { id: projectId, name: projectId }]}
                  value={projectId}
                />
              </FormField>

              <FormField label="App type" required>
                <AppTypeDropdown
                  ariaLabel="Select an app type"
                  disabled={!projectId}
                  emptyLabel={!projectId ? "Select a project first" : "No app types available"}
                  onChange={onAppTypeChange}
                  options={[...appTypes.map((appType) => ({
                    value: appType.id,
                    label: appType.name,
                    type: appType.type,
                    isUnified: appType.is_unified
                  })), ...(!appTypeId || appTypes.some(appType => appType.id === appTypeId) ? [] : [{ value: appTypeId, label: appTypeId }])]}
                  placeholder="Select app type"
                  value={appTypeId}
                />
              </FormField>

              {isSmartMode ? (
                <div className="execution-smart-provider-section">
                  <FormField label="AI model" hint="Optional. Refines explanations using the linked evidence.">
                    <AiLlmSelect
                      autoLabel="Configured prompt model, active default, or deterministic only"
                      defaultIntegrationId={smartExecutionDefaultIntegrationId}
                      integrations={integrations}
                      onChange={onSmartExecutionIntegrationChange}
                      scopeKey={projectId}
                      value={smartExecutionIntegrationId}
                    />
                  </FormField>
                </div>
              ) : null}

              <div className="execution-run-config-pair">
                {can("requirement_iteration.view") ? <FormField label="Release" hint={isSmartMode ? "Finds stories and results in this release." : undefined}>
                  <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                    <option value="">No release filter</option>
                    {executionRelease && !releaseOptions.some((option) => option.value === executionRelease) ? (
                      <option value={executionRelease}>{executionRelease}</option>
                    ) : null}
                    {releaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FormField> : null}
                {can("requirement_iteration.view") ? <FormField label="Sprint" hint={isSmartMode ? "Finds stories and results in this sprint." : undefined}>
                  <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                    <option value="">No Sprint filter</option>
                    {executionSprint && !sprintOptions.some((option) => option.value === executionSprint) ? (
                      <option value={executionSprint}>{executionSprint}</option>
                    ) : null}
                    {sprintOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FormField> : null}
              </div>

              <FormField label="Build" hint={isSmartMode ? "Finds results and defects for this build." : undefined}>
                <input list="smart-run-build-options" placeholder="SHA-88219 or build tag" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
                <datalist id="smart-run-build-options">
                  {buildOptions.map((build) => <option key={build} value={build} />)}
                </datalist>
              </FormField>

                {isSmartMode ? <>
                <div className="ai-studio-sidebar execution-smart-scope-pane" aria-label="Smart Run evidence scope">
                  <div className="execution-smart-pane-header">
                    <div>
                      <div>
                        <h3>Context Setup</h3>
                        <p>Define the delivery change and coverage scope.</p>
                      </div>
                    </div>
                    <IconDatabase aria-hidden="true" size={18} stroke={1.8} />
                  </div>
                  <section className="ai-studio-panel">
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">Evidence scope</p>
                        <p>Select impacted stories or add notes to focus the plan.</p>
                      </div>
                    </div>

                    <FormField label="Change intent" hint="Describe what changed and the coverage outcome this run should prove.">
                      <textarea
                        placeholder="Changed workflows, integrations, rollout risks, customer impact, and desired coverage..."
                        maxLength={4000}
                        rows={4}
                        value={smartExecutionReleaseScope}
                        onChange={(event) => onSmartExecutionReleaseScopeChange(event.target.value)}
                      />
                    </FormField>

                    <FormField label="Additional context" hint="Rollout notes, known gaps, customer risk, or environment details.">
                      <textarea
                        placeholder="Environment notes, known gaps, customer impact, compliance focus..."
                        maxLength={4000}
                        rows={4}
                        value={smartExecutionAdditionalContext}
                        onChange={(event) => onSmartExecutionAdditionalContextChange(event.target.value)}
                      />
                    </FormField>

                    {onSmartExecutionImagesChange?<AiReferenceImages key={`${projectId}:${appTypeId}`} images={smartExecutionImages} onChange={onSmartExecutionImagesChange} onBusyChange={onSmartExecutionImagesBusyChange} disabled={isPreviewingSmartExecution}/>:null}
                    <FormField composite inputId="smart-run-impacted-story-filter" label="Impacted stories">
                      <div aria-label="Impacted stories" className="execution-smart-requirements-panel" role="group">
                        <div className="execution-smart-requirement-toolbar">
                          <input
                            aria-label="Filter impacted Stories"
                            id="smart-run-impacted-story-filter"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                            placeholder="Filter linked stories"
                            value={smartExecutionRequirementSearch}
                            onChange={(event) => onSmartExecutionRequirementSearchChange(event.target.value)}
                          />
                          <button
                            className="ghost-button"
                            disabled={!filteredSmartRequirementOptions.length || areAllVisibleSmartRequirementsSelected}
                            onClick={() => onSelectAllSmartExecutionRequirements(filteredSmartRequirementOptions.map((requirement) => requirement.id))}
                            type="button"
                          >
                            <SelectionToggleIcon checked />
                            Select visible
                          </button>
                          <button
                            className="ghost-button"
                            disabled={!selectedSmartRequirementIds.length}
                            onClick={onClearSmartExecutionRequirements}
                            type="button"
                          >
                            <SelectionToggleIcon checked={false} />
                            Clear
                          </button>
                        </div>

                        {smartExecutionRequirementOptions.length ? (
                          <div className="execution-smart-requirement-list">
                            {filteredSmartRequirementOptions.map((requirement) => {
                              const isSelected = selectedSmartRequirementIds.includes(requirement.id);

                              return (
                                <label
                                  className={isSelected ? "execution-smart-requirement-card is-selected" : "execution-smart-requirement-card"}
                                  key={requirement.id}
                                >
                                  <input
                                    checked={isSelected}
                                    onChange={() => onToggleSmartExecutionRequirement(requirement.id)}
                                    type="checkbox"
                                  />
                                  <div className="execution-smart-requirement-copy">
                                    <strong>{requirement.title}</strong>
                                    <span>{richTextToPlainText(requirement.description) || "Story-linked coverage available in this app type."}</span>
                                  </div>
                                  <span className="execution-smart-requirement-count">
                                    {requirement.linkedCaseCount} case{requirement.linkedCaseCount === 1 ? "" : "s"}
                                  </span>
                                </label>
                              );
                            })}

                            {!filteredSmartRequirementOptions.length ? (
                              <div className="empty-state compact">No linked stories match the current search.</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="empty-state compact">No story-linked test cases are available for this app type yet.</div>
                        )}
                      </div>
                    </FormField>

                    <div className="detail-summary compact-summary">
                      <strong>{selectedSmartRequirementIds.length ? `${selectedSmartRequirementIds.length} impacted ${selectedSmartRequirementIds.length === 1 ? "story" : "stories"} selected` : "Story filter is optional"}</strong>
                      <span>
                        {selectedSmartRequirementIds.length
                          ? "Selected Stories are added as explicit evidence alongside the Release, Sprint, Build, Defect, and prior-result scope."
                          : "Choose impacted Stories to add explicit traceability evidence to the delivery scope."}
                      </span>
                    </div>

                    <div className="detail-summary compact-summary">
                      <strong>{smartExecutionPreview?.default_suite.name || "Direct impacted scope"}</strong>
                      <span>Recommended cases are staged as direct run scope; no existing suite membership is invented or changed.</span>
                    </div>

                    <div className="execution-smart-generate-row">
                      <button
                        className="primary-button"
                        disabled={!canGenerateSmartPlan}
                        onClick={onPreviewSmartExecution}
                        type="button"
                      >
                        <IconSparkles aria-hidden="true" size={17} stroke={1.9} />
                        {isPreviewingSmartExecution
                          ? "Generating plan…"
                          : smartExecutionPreviewTone === "error" && smartExecutionPreviewMessage
                            ? "Retry impact plan"
                            : smartExecutionPreview
                              ? "Regenerate impact plan"
                              : "Generate impact plan"}
                      </button>
                    </div>
                  </section>
                </div>

                </> : null}
              </div>
              <div className="execution-run-config-stack execution-smart-run-settings" hidden={isSmartMode && smartSidebarTab !== "settings"} id="smart-run-settings-panel" role={isSmartMode ? "tabpanel" : undefined} aria-labelledby={isSmartMode ? "smart-run-settings-tab" : undefined}>
              <FormField label="Run Name">
                <input
                  data-autofocus="true"
                  placeholder="e.g. Q4_Regression_v2"
                  value={executionName}
                  onChange={(event) => onExecutionNameChange(event.target.value)}
                />
              </FormField>

              <RunPlanningFields
                canRunLocalAutomation={canRunLocalAutomation}
                canRunRemoteAutomation={canRunRemoteAutomation}
                disabled={isSubmitting}
                endDate={executionEndDate}
                mode={executionStartMode}
                onEndDateChange={onExecutionEndDateChange}
                onModeChange={onExecutionStartModeChange}
                onStartDateChange={onExecutionStartDateChange}
                startDate={executionStartDate}
              />

              <div className="execution-run-config-context">
                <ExecutionContextSelector hideDataSet
                  appTypeId={appTypeId}
                  onConfigurationChange={onConfigurationChange}
                  onDataSetChange={onDataSetChange}
                  onEnvironmentChange={onEnvironmentChange}
                  prefillFirstAvailable={false}
                  projectId={projectId}
                  selectedConfigurationId={selectedConfigurationId}
                  selectedDataSetId={selectedDataSetId}
                  selectedEnvironmentId={selectedEnvironmentId}
                />
                <RunDataSetup dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange}
                  onValidityChange={setDataSetValid}
                  appTypeId={appTypeId}
                  onDataSetChange={onDataSetChange}
                  cases={runCaseReferences(isSmartMode ? selectedSmartExecutionCaseIds : selectedDirectCaseIds, libraryCases)}
                  suites={scopeSuites.filter(suite => selectedSuiteIdSet.has(suite.id))}
                  projectId={projectId}
                  environmentId={selectedEnvironmentId}
                  configurationId={selectedConfigurationId}
                  dataSetId={selectedDataSetId}
                  disabled={isSubmitting}
                />
              </div>

              <FormField label="Primary assignee" hint="Select one or more testers for this run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length}
                  options={assigneeOptions}
                  selectedIds={selectedExecutionAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>

              {executionStartMode !== "manual" && canConfigureParallelAutomation ? (
                <FormField label="Parallel execution">
                  <div className="execution-parallel-control">
                    <label>
                      <input
                        checked={executionParallelEnabled}
                        onChange={(event) => onExecutionParallelEnabledChange(event.target.checked)}
                        type="checkbox"
                      />
                      <span>Run tests in parallel</span>
                    </label>
                    <input
                      aria-label="Parallel test count"
                      disabled={!executionParallelEnabled}
                      min={1}
                      max={50}
                      onChange={(event) => onExecutionParallelCountChange(Math.max(1, Number(event.target.value) || 1))}
                      type="number"
                      value={executionParallelCount}
                    />
                  </div>
                </FormField>
              ) : null}
              </div>
            </aside>

            <main className="execution-run-selection-workspace">
              <div className="execution-run-selection-header">
                <div>
                  <h3>{isSmartMode ? "Review run plan" : "Suites"}</h3>
                  {isSmartMode ? <p>Select the recommended cases to include in your run.</p> : null}
                </div>
                {canUseRunAi ? (
                  <div className="execution-create-mode-segmented" aria-label="Run creation mode" role="group">
                    <button
                      aria-pressed={!isSmartMode}
                      className={!isSmartMode ? "is-active" : ""}
                      onClick={() => onExecutionCreateModeChange("manual")}
                      type="button"
                    >
                      <IconCheckbox aria-hidden="true" size={16} stroke={1.9} />
                      <span>Manual selection</span>
                    </button>
                    <button
                      aria-pressed={isSmartMode}
                      className={isSmartMode ? "is-active" : ""}
                      onClick={() => onExecutionCreateModeChange("smart")}
                      type="button"
                    >
                      <IconSparkles aria-hidden="true" size={16} stroke={1.9} />
                      <span>AI Smart Run</span>
                    </button>
                  </div>
                ) : null}
              </div>

            {isSmartMode ? (
              <div className="execution-smart-agent-workspace">
                <div className="ai-studio-main execution-smart-plan-pane" aria-label="Smart Run ranked coverage">
                  <div className="execution-smart-pane-header">
                    <div>
                      <div>
                        <h3>Smart Run Drafts</h3>
                        <p>Review why each case is included and adjust your selection.</p>
                      </div>
                    </div>
                    <span className="execution-smart-pane-count">
                      {smartExecutionPreview ? `${smartPreviewCases.length} ranked` : "Awaiting plan"}
                    </span>
                  </div>

                  {!smartExecutionPreview ? (
                    <div className="detail-summary execution-smart-plan-overview">
                      <strong>Build a focused run plan</strong>
                      <span>Choose delivery scope, impacted stories, or change notes in Context, then generate a plan to review the recommended cases and their evidence.</span>
                    </div>
                  ) : null}

                  {smartExecutionPreview?.evidence_summary ? (
                    <div aria-label="Smart Run evidence summary" className="metric-strip execution-smart-evidence-strip" role="group">
                      <div className="mini-card">
                        <span>Failed cases</span>
                        <strong>{smartExecutionPreview.evidence_summary.failed_case_count}</strong>
                        <small>from matching runs</small>
                      </div>
                      <div className="mini-card">
                        <span>Blocked cases</span>
                        <strong>{smartExecutionPreview.evidence_summary.blocked_case_count}</strong>
                        <small>from matching runs</small>
                      </div>
                      <div className="mini-card">
                        <span>Scoped Defects</span>
                        <strong>{smartExecutionPreview.evidence_summary.scoped_bug_count}</strong>
                        <small>expanded through links</small>
                      </div>
                      <div className="mini-card">
                        <span>Scoped Stories</span>
                        <strong>{smartExecutionPreview.evidence_summary.scoped_requirement_count}</strong>
                        <small>linked coverage</small>
                      </div>
                      <AiEvidenceButton
                        className="execution-smart-evidence-open"
                        count={smartExecutionPreview.evidence?.length || 0}
                        label="Review sources"
                        onClick={() => setSmartEvidenceView({ kind: "plan" })}
                      />
                    </div>
                  ) : null}

                  {smartExecutionPreview?.evidence_summary?.scan_truncated ? (
                    <p className="inline-message warning-message">
                      This project exceeds the safe synchronous scan limit. The plan keeps failed and Defect-linked cases first; narrow Release, Sprint, or Build before sign-off to verify the remaining scope.
                    </p>
                  ) : null}

                  {smartExecutionPreviewMessage && (smartExecutionPreviewTone === "error" || !smartExecutionPreview) ? (
                    <p className={smartExecutionPreviewTone === "error" ? "inline-message error-message" : "inline-message success-message"}>
                      {smartExecutionPreviewMessage}
                    </p>
                  ) : null}

                  {smartExecutionPreview?.fallback_reason ? <p className="inline-message warning-message">{smartExecutionPreview.fallback_reason}</p> : null}

                  {!integrations.length && !smartExecutionPreview ? (
                    <div className="inline-message warning-message">
                      No direct LLM integration is configured. The evidence retrieval, deterministic risk ranking, and human-review flow remain available; model-refined explanations will be skipped.
                    </div>
                  ) : null}

                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={!smartPreviewCases.length || areAllSmartCasesSelected}
                      onClick={onSelectAllSmartExecutionCases}
                      type="button"
                    >
                      <SelectionToggleIcon checked />
                      Select all
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!selectedSmartCaseCount}
                      onClick={onClearSmartExecutionCases}
                      type="button"
                    >
                      <SelectionToggleIcon checked={false} />
                      Clear
                    </button>
                  </div>

                  {smartExecutionPreview ? (
                    <div className="selection-summary-card execution-smart-summary-card">
                      <div className="selection-summary-header">
                        <div>
                          <strong>{smartExecutionPreview.execution_name}</strong>
                          <span>{smartExecutionPreview.summary}</span>
                        </div>
                        <span className="count-pill">{selectedSmartExecutableCaseCount}/{isEngineSmartMode ? automatedSmartPreviewCount : smartExecutionPreview.matched_case_count} selected</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="execution-smart-impact-list">
                    {smartPreviewCases.map((testCase, index) => {
                      const isSelected = selectedSmartExecutionCaseIds.includes(testCase.test_case_id);
                      const automationState = libraryCaseById.get(testCase.test_case_id)?.automated;
                      const isAutomatedSmartCase = automationState === "yes";
                      const isDisabledForEngine = isEngineSmartMode && !isAutomatedSmartCase;
                      const explanationSignals = Array.from(new Set([
                        ...(testCase.selection_basis || []),
                        ...(testCase.signals || [])
                      ])).slice(0, 6);

                      return (
                        <article
                          className={[
                            "execution-smart-impact-card",
                            isSelected ? "is-selected" : "",
                            isDisabledForEngine ? "is-disabled" : ""
                          ].filter(Boolean).join(" ")}
                          key={testCase.test_case_id}
                        >
                          <label className="execution-smart-impact-selector">
                            <input
                              checked={isSelected}
                              disabled={isDisabledForEngine}
                              onChange={() => onToggleSmartExecutionCase(testCase.test_case_id)}
                              type="checkbox"
                            />
                            <span className="sr-only">Select {testCase.title}</span>
                          </label>
                          <div className="execution-smart-impact-body">
                            <div className="execution-smart-impact-top">
                              <div className="execution-smart-impact-heading">
                                <div>
                                  <span className="execution-smart-rank-badge" aria-label={`Rank ${index + 1}`}>#{index + 1}</span>
                                  <strong title={testCase.title}>{testCase.title}</strong>
                                </div>
                                <span>{richTextToPlainText(testCase.description) || "No description available."}</span>
                              </div>
                              <div className="execution-smart-impact-facts">
                                <span className={`execution-smart-impact-level is-${testCase.impact_level}`}>
                                  {executionImpactLevelLabel(testCase.impact_level)}
                                </span>
                                <span className="count-pill">
                                  {testCase.step_count} step{testCase.step_count === 1 ? "" : "s"}
                                </span>
                                {typeof testCase.risk_score === "number" ? (
                                  <span className="count-pill">Risk {Math.round(testCase.risk_score)}</span>
                                ) : null}
                                {testCase.failure_count ? (
                                  <span className="count-pill danger">
                                    {testCase.failure_count} failure{testCase.failure_count === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                                {testCase.blocked_count ? (
                                  <span className="count-pill warning">
                                    {testCase.blocked_count} blocked
                                  </span>
                                ) : null}
                                {testCase.bug_count ? (
                                  <span className="count-pill warning">
                                    {testCase.bug_count} Defect{testCase.bug_count === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                                <span
                                  className={isAutomatedSmartCase ? "count-pill success" : "count-pill"}
                                >
                                  {isAutomatedSmartCase ? "Automated" : "Not automated"}
                                </span>
                                <AiEvidenceButton
                                  count={testCase.evidence_refs?.length || 0}
                                  label="Evidence"
                                  onClick={() => setSmartEvidenceView({ kind: "case", caseId: testCase.test_case_id })}
                                />
                              </div>
                            </div>

                            <div className="execution-smart-impact-reason">
                              <span>Why this case</span>
                              <p>{testCase.reason}</p>
                            </div>

                            {explanationSignals.length ? (
                              <div className="execution-smart-signal-row" aria-label="Deterministic selection basis">
                                {explanationSignals.map((signal) => (
                                  <span className="execution-smart-signal-chip" key={signal}>{signal}</span>
                                ))}
                              </div>
                            ) : null}

                            <div className="detail-summary compact-summary">
                              <strong>{testCase.suite_names.length ? testCase.suite_names.join(" · ") : "No suite mapping"}</strong>
                              <span>
                                {testCase.requirement_titles.length
                                  ? `Stories: ${testCase.requirement_titles.join(" · ")}`
                                  : "No linked stories"}
                              </span>
                              {testCase.module_names?.length ? <span>Modules: {testCase.module_names.join(" · ")}</span> : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}

                    {smartExecutionPreview && !smartPreviewCases.length ? (
                      <div className="empty-state compact">No impacted cases were identified for the current release scope.</div>
                    ) : null}
                    {!smartExecutionPreview ? (
                      <div className="empty-state compact">Generate a preview to review the cases proposed for direct impacted scope.</div>
                    ) : null}
                  </div>

                </div>
              </div>
            ) : (
              <section className="execution-suite-selection" aria-label="Run test case and suite selection">
                {onDirectCaseSelectionChange ? <TestCasePicker
                  projectId={projectId}
                  appTypeId={appTypeId}
                  selectedIds={selectedDirectCaseIds}
                  onChange={onDirectCaseSelectionChange}
                  onItemsResolved={onDirectCaseItemsResolved}
                  onSelectionResolutionChange={onDirectCaseResolutionChange}
                  initialItems={libraryCases}
                  filters={executionStartMode === "manual" ? undefined : { automated: "yes" }}
                  disabled={isSubmitting}
                  heading="Test Case Selection"
                  emptyMessage="No test cases match the current scope."
                  presentation="inline"
                  selectionContext="run"
                  allowReorder
                /> : null}
                {appTypeId && !can("suite.view") ? <p className="empty-state compact">Suite selection is unavailable for your role. Select permitted test cases directly.</p> : isLoadingSuites ? <p role="status" className="empty-state compact">Loading suites…</p> : <SuiteScopePicker
                  projectId={projectId}
                  appTypeId={appTypeId}
                  emptyMessage={appTypeId ? "No suites are available for this app type. Create a suite first." : "Select an application type to load reusable suites."}
                  metadataByCaseId={metadataByCaseId}
                  onChange={onSuiteSelectionChange}
                  selectedSuiteIds={selectedSuiteIds}
                  suites={scopeSuites}
                  testCases={libraryCases}
                />}
              </section>
            )}

              {isSmartMode ? (
                <details className="execution-smart-hooks-disclosure" onToggle={(event) => setAreSmartHooksOpen(event.currentTarget.open)} open={areSmartHooksOpen}>
                  <summary>
                    <span>
                      <strong>Setup &amp; cleanup automation</strong>
                      <small>Optional run hooks stay available without obscuring the ranked impact plan.</small>
                    </span>
                    <span>{executionHookDraft.length ? `${executionHookDraft.length} configured` : "Optional"}</span>
                  </summary>
                  <div className="execution-run-hooks-workspace">
                    <RunHooksBuilder
                      projectId={projectId}
                      appTypeId={appTypeId}
                      onChange={onExecutionHookDraftChange}
                      suites={scopeSuites}
                      testCases={libraryCases}
                      value={executionHookDraft}
                    />
                  </div>
                </details>
              ) : (
                <div className="execution-run-hooks-workspace">
                  <RunHooksBuilder
                    projectId={projectId}
                    appTypeId={appTypeId}
                    onChange={onExecutionHookDraftChange}
                    suites={scopeSuites}
                    testCases={libraryCases}
                    value={executionHookDraft}
                  />
                </div>
              )}
            </main>
          </div>

          {isPreparingDeliveryOptions ? <p className="inline-message" role="status">Preparing Release and Sprint options… You can continue configuring this run.</p> : null}
          {directCaseSelectionMessage ? <div className="hierarchy-filter-scope-note" role="alert">{directCaseSelectionMessage}</div> : null}
          {isResolvingCases ? <div className="hierarchy-filter-scope-note" role={caseResolutionError ? "alert" : "status"}>{caseResolutionError ? <>{caseResolutionError instanceof Error ? caseResolutionError.message : "Selected case details could not be loaded."} <button type="button" className="ghost-button compact" onClick={onRetryCaseResolution}>Retry case details</button></> : "Checking the selected cases for this run mode…"}</div> : null}
          <div className="execution-run-builder-footer" aria-label="Run summary and creation actions">
            <div
              className="execution-run-builder-status"
              aria-label={`${selectedProject || "No project"} · ${selectedAppType || "No app type"}`}
            >
              <strong>
                {isSmartMode
                  ? `${selectedSmartExecutableCaseCount} ${selectedSmartExecutableCaseCount === 1 ? "case" : "cases"} selected`
                  : `${selectedSuiteIds.length} ${selectedSuiteIds.length === 1 ? "suite" : "suites"}${selectedDirectCaseIds.length ? ` · ${selectedDirectCaseIds.length} direct cases` : ""} selected`}
              </strong>
              <span aria-hidden="true">•</span>
              <span>
                <IconClock aria-hidden="true" size={15} stroke={1.8} />
                {isSmartMode ? "Review required before creation" : `Est. duration: ${estimatedDurationLabel}`}
              </span>
            </div>
            <div className="execution-run-builder-actions">
              <button className="ghost-button" disabled={isSubmitting || isPreviewingSmartExecution} onClick={onClose} type="button">
                Cancel
              </button>
              {canCreateRunMode ? (<button
                className="primary-button"
                disabled={!canCreateExecution || isSubmitting || !dataSetValid || (isSmartMode && (isPreviewingSmartExecution || !smartExecutionPreview || !selectedSmartExecutableCaseCount))}
                type="submit"
              >
                {isSubmitting
                  ? "Creating…"
                  : isSmartMode
                    ? "Create AI Smart Run"
                    : executionStartMode === "remote"
                      ? "Create Remote Run"
                      : executionStartMode === "local"
                        ? "Create Local Run"
                        : "Create Manual Run"}
              </button>) : null}
            </div>
          </div>
        </form>
        <AiEvidenceFlyout
          description={activeSmartEvidenceCase
            ? "Inspect the exact records permitted to support this Test Case recommendation."
            : "Inspect the returned records, retrieval boundary, and provenance for this preview."}
          eyebrow={activeSmartEvidenceCase ? "Smart Run · Case evidence" : "Smart Run · Plan evidence"}
          facts={activeSmartEvidenceCase
            ? [
                { label: "Risk", value: `${Math.round(activeSmartEvidenceCase.risk_score || 0)} · ${executionImpactLevelLabel(activeSmartEvidenceCase.impact_level)}` },
                { label: "Explanation", value: activeSmartEvidenceCase.reason_source === "model" ? "Model-refined with cited records" : "Deterministic from linked records" },
                { label: "Evidence refs", value: activeSmartEvidenceCase.evidence_refs?.length || 0 },
                { label: "Decision", value: "Human selection required" }
              ]
            : [
                { label: "Generation", value: smartExecutionPreview?.generation_mode === "hybrid" ? "Deterministic rank · model-refined explanations" : "Deterministic evidence rank" },
                { label: "Scan", value: `${smartExecutionPreview?.evidence_summary?.scanned_case_count || 0} of ${smartExecutionPreview?.source_case_count || 0} Test Cases` },
                { label: "Returned", value: smartExecutionPreview?.matched_case_count || 0 },
                { label: "Decision", value: "Human review required" }
              ]}
          onClose={() => setSmartEvidenceView(null)}
          open={Boolean(smartEvidenceView && smartExecutionPreview)}
          title={activeSmartEvidenceCase?.title || smartExecutionPreview?.execution_name || "Smart Run evidence"}
        >
          {smartExecutionPreview?.query_strategy?.length && !activeSmartEvidenceCase ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-path">
              <header><span>Retrieval path</span><strong>Queries that contributed to this preview</strong></header>
              <div>
                {smartExecutionPreview.query_strategy.map((strategy) => (
                  <span className="execution-smart-signal-chip" key={strategy}>{strategy}</span>
                ))}
              </div>
            </section>
          ) : null}

          {activeSmartEvidenceCase?.selection_basis?.length ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-basis">
              <header><span>Selection basis</span><strong>Deterministic factors used for ranking</strong></header>
              <ul>
                {activeSmartEvidenceCase.selection_basis.map((basis) => <li key={basis}>{basis}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="ai-evidence-flyout__section execution-smart-evidence-records">
            <header>
              <span>Source records</span>
              <strong>{activeSmartEvidenceRecords.length} returned record{activeSmartEvidenceRecords.length === 1 ? "" : "s"}</strong>
            </header>
            {activeSmartEvidenceRecords.length ? (
              <ul>
                {activeSmartEvidenceRecords.map((record) => (
                  <li key={record.ref}>
                    <div>
                      <span>{record.type.replace(/-/g, " ")}</span>
                      <strong>{record.title}</strong>
                    </div>
                    <p>{record.summary || record.excerpt || "No additional source summary was returned."}</p>
                    <small>
                      {[record.id, record.status, record.observed_at ? new Date(record.observed_at).toLocaleString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <code>{record.ref}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ai-evidence-flyout__boundary">No returned source record is attached to this view.</p>
            )}
          </section>

          {!activeSmartEvidenceCase && activeSmartEvidenceContext ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-boundary">
              <header><span>Retrieval boundary</span><strong>Included and omitted records</strong></header>
              <dl>
                {Object.keys(activeSmartEvidenceContext.totals).map((source) => (
                  <div key={source}>
                    <dt>{source.replace(/_/g, " ")}</dt>
                    <dd>
                      {activeSmartEvidenceContext.included[source] || 0} included
                      {activeSmartEvidenceContext.omitted[source] ? ` · ${activeSmartEvidenceContext.omitted[source]} omitted by limit` : " · none omitted"}
                    </dd>
                  </div>
                ))}
              </dl>
              {smartExecutionPreview?.input_fingerprint ? <code>Fingerprint {smartExecutionPreview.input_fingerprint}</code> : null}
              {smartExecutionPreview?.fallback_reason ? <p>{smartExecutionPreview.fallback_reason}</p> : null}
            </section>
          ) : null}
          <p className="ai-evidence-flyout__boundary">
            <IconShieldCheck aria-hidden="true" size={16} stroke={1.9} />
            This preview does not create a run. Case selection and Create AI Smart Run remain explicit human actions.
          </p>
        </AiEvidenceFlyout>
      </div>
    </div>
  );
}

