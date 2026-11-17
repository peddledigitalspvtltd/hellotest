import { type ExecutionStartMode, type TestCaseExecutionAssigneeOption } from "./testCaseWorkspaceTypes";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { RunDataSetup } from "./../../components/RunDataSetup";
import { FormEvent, useDeferredValue, useState } from "react";
import { TestCaseIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { ExecutionContextSelector } from "./../../components/ExecutionContextSelector";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { RunPlanningFields } from "./../../components/RunPlanningFields";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { type DeliveryScopeOption } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import type { TestCase } from "@hellotest/platform/frontend/src/types";

export function TestCaseExecutionModal({
  isPreparingOptions,
  testCases,
  selectedProject,
  selectedAppType,
  projectId,
  appTypeId,
  executionName,
  selectedAssigneeIds,
  assigneeOptions,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId, dataOptions, onDataOptionsChange,
  executionStartMode,
  executionStartDate,
  executionEndDate,
  onExecutionStartDateChange,
  onExecutionEndDateChange,
  executionParallelEnabled,
  executionParallelCount,
  executionRelease,
  releaseOptions,
  executionSprint,
  sprintOptions,
  executionBuild,
  canConfigureParallelAutomation,
  canRunLocalAutomation,
  canRunRemoteAutomation,
  canCreateExecution,
  isSubmitting,
  onAssigneeChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onExecutionNameChange,
  onExecutionStartModeChange,
  onExecutionParallelEnabledChange,
  onExecutionParallelCountChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onRemoveTestCase,
  onClose,
  onSubmit
}: {
  isPreparingOptions: boolean;
  testCases: TestCase[];
  selectedProject: string;
  selectedAppType: string;
  projectId: string;
  appTypeId: string;
  executionName: string;
  selectedAssigneeIds: string[];
  assigneeOptions: TestCaseExecutionAssigneeOption[];
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions: TestDataOptions; onDataOptionsChange: (value: TestDataOptions) => void;
  executionStartMode: ExecutionStartMode;
  executionStartDate: string;
  executionEndDate: string;
  onExecutionStartDateChange: (value: string) => void;
  onExecutionEndDateChange: (value: string) => void;
  executionParallelEnabled: boolean;
  executionParallelCount: number;
  executionRelease: string;
  releaseOptions: DeliveryScopeOption[];
  executionSprint: string;
  sprintOptions: DeliveryScopeOption[];
  executionBuild: string;
  canConfigureParallelAutomation: boolean;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onAssigneeChange: (value: string[]) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onExecutionNameChange: (value: string) => void;
  onExecutionStartModeChange: (value: ExecutionStartMode) => void;
  onExecutionParallelEnabledChange: (value: boolean) => void;
  onExecutionParallelCountChange: (value: number) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onRemoveTestCase: (testCaseId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [dataSetValid, setDataSetValid] = useState(!selectedDataSetId);
  const [selectedCaseSearch, setSelectedCaseSearch] = useState("");
  const deferredSelectedCaseSearch = useDeferredValue(selectedCaseSearch);
  const visibleSelectedCases = testCases.filter(item => `${item.title} ${item.display_id || item.id}`.toLowerCase().includes(deferredSelectedCaseSearch.trim().toLowerCase()));
  const { can } = useCapabilityAccess(projectId);
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSubmitting, onClose });
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-test-case-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal scoped-run-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form className="execution-create-form" onSubmit={(event) => {
          if (!dataSetValid) { event.preventDefault(); return; }
          onSubmit(event);
        }}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <h2 className="dialog-title" id="create-test-case-execution-title">Create run</h2>
              <p>Run the selected test cases.</p>
            </div>
            <DialogCloseButton disabled={isSubmitting} label="Close create run dialog" onClick={onClose} />
          </div>

          <div className="execution-create-body scoped-run-create-body">
            <fieldset disabled={isSubmitting} className="scoped-run-authoring-fields">
            <aside className="scoped-run-config-pane" aria-label="Run configuration">
              <div className="scoped-run-pane-heading"><strong>Run Configuration</strong><span>Settings and reusable test data</span></div>
            {isPreparingOptions ? <p className="inline-message" role="status">Preparing Release and Sprint options… You can continue configuring this run.</p> : null}

            <div className="execution-create-grid">
              <FormField label="Run name">
                <input
                  autoFocus
                  placeholder="Optional run name"
                  value={executionName}
                  onChange={(event) => onExecutionNameChange(event.target.value)}
                />
              </FormField>
              <FormField label="Assign to" hint="Select one or more testers for this run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length || isSubmitting}
                  options={assigneeOptions}
                  selectedIds={selectedAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>
            </div>

            <RunDataSetup onValidityChange={setDataSetValid} dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange} projectId={projectId} appTypeId={appTypeId}
              cases={testCases} dataSetId={selectedDataSetId} onDataSetChange={onDataSetChange} environmentId={selectedEnvironmentId} configurationId={selectedConfigurationId} disabled={isSubmitting} />

            <details className="authoring-disclosure" open={Boolean(executionRelease || executionSprint || executionBuild)}>
              <summary><span>Delivery context</span><small>Release, Sprint and build</small></summary>
              <div className="authoring-disclosure-body execution-create-grid execution-create-grid--metadata">
              {can("requirement_iteration.view") ? <FormField label="Release">
                <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                  <option value="">No release</option>
                  {releaseOptions.map((option) => (
                    <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField> : null}
              {can("requirement_iteration.view") ? <FormField label="Sprint">
                <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                  <option value="">No sprint</option>
                  {sprintOptions.map((option) => (
                    <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField> : null}
              <FormField label="Build">
                <input placeholder="Build 2026.07.02" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
              </FormField>
            </div>

            </details>
            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType || "Choose an app type"}</span>
            </div>

            <ExecutionContextSelector hideDataSet
              appTypeId={appTypeId}
              onConfigurationChange={onConfigurationChange}
              onDataSetChange={onDataSetChange}
              onEnvironmentChange={onEnvironmentChange}
              prefillFirstAvailable={true}
              projectId={projectId}
              selectedConfigurationId={selectedConfigurationId}
              selectedDataSetId={selectedDataSetId}
              selectedEnvironmentId={selectedEnvironmentId}
            />



            <div className="execution-create-grid">
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
            <section className="scoped-run-selection-pane" aria-label="Selected test cases">
              <div className="scoped-run-pane-heading"><strong>Selected Test Cases</strong><span>{testCases.length} selected for this run</span></div>
            <FormField label="Run scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{testCases.length ? `${testCases.length} test cases selected` : "No test cases selected yet"}</strong>
                    <span>Review the scope before creating your run.</span>
                  </div>
                </div>

                {testCases.length > 8 || selectedCaseSearch ? <input aria-label="Search selected test cases" className="scoped-run-selected-search" placeholder="Find a selected test case…" value={selectedCaseSearch} onChange={event => setSelectedCaseSearch(event.target.value)} type="search" /> : null}
                {testCases.length ? (
                  <div className="scoped-run-selected-list">
                    {visibleSelectedCases.map((testCase) => (
                      <div key={testCase.id} className="scoped-run-selected-item">
                        <TestCaseIcon size={16} />
                        <span><strong>{testCase.title}</strong>{testCase.display_id ? <small>{testCase.display_id}</small> : null}</span>
                        <button aria-label={`Remove ${testCase.title} from this run`} className="ghost-button" disabled={isSubmitting} onClick={() => onRemoveTestCase(testCase.id)} title="Remove from run" type="button"><span aria-hidden="true">×</span></button>
                      </div>
                    ))}
                    {!visibleSelectedCases.length ? <div className="empty-state compact">No selected cases match. <button className="text-button" onClick={() => setSelectedCaseSearch("")} type="button">Clear search</button></div> : null}
                  </div>
                ) : <p className="inline-message" role="status">Choose at least one test case to create a run.</p>}
              </div>
            </FormField>
            </section>
            </fieldset>
          </div>

          <div className="action-row execution-create-actions">
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={!testCases.length || !canCreateExecution || isSubmitting || isPreparingOptions || !dataSetValid} type="submit">
              {isSubmitting
                ? "Creating…"
                : executionStartMode === "local"
                  ? "Create Local Run"
                  : executionStartMode === "remote"
                    ? "Create Remote Run"
                    : "Create Manual Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
