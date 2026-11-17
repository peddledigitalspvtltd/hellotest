import { type TestDataOptions, type TestCase, type TestSuite } from "@hellotest/platform/frontend/src/types";
import { FormEvent } from "react";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { ExecutionContextSelector } from "../../components/ExecutionContextSelector";
import { RunDataSetup } from "../../components/RunDataSetup";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { SuiteScopePicker, type SuitePickerMetadataByCaseId } from "../../components/SuiteCasePicker";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { ExecutionAssigneeOption, ExecutionScheduleCadence } from "./executionWorkspaceModel";

export function CreateExecutionScheduleModal({
  mode,
  projectId,
  projectName,
  appTypeId,
  appTypeName,
  scopeSuites,
  testCases,
  metadataByCaseId,
  selectedSuiteIds,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  dataOptions, onDataOptionsChange,
  selectedAssigneeIds,
  executionRelease,
  executionSprint,
  executionBuild,
  releaseOptions,
  sprintOptions,
  assigneeOptions,
  cadence,
  intervalMinutes,
  nextRunAt,
  isSubmitting,
  onExecutionNameChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onSuiteSelectionChange,
  onCadenceChange,
  onIntervalMinutesChange,
  onNextRunAtChange,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  projectId: string;
  projectName: string;
  appTypeId: string;
  appTypeName: string;
  scopeSuites: TestSuite[];
  testCases: TestCase[];
  metadataByCaseId: SuitePickerMetadataByCaseId;
  selectedSuiteIds: string[];
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions?: TestDataOptions; onDataOptionsChange?: (value: TestDataOptions) => void;
  selectedAssigneeIds: string[];
  executionRelease: string;
  executionSprint: string;
  executionBuild: string;
  releaseOptions: Array<{ value: string; label: string }>;
  sprintOptions: Array<{ value: string; label: string }>;
  assigneeOptions: ExecutionAssigneeOption[];
  cadence: ExecutionScheduleCadence;
  intervalMinutes: number;
  nextRunAt: string;
  isSubmitting: boolean;
  onExecutionNameChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string[]) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onCadenceChange: (value: ExecutionScheduleCadence) => void;
  onIntervalMinutesChange: (value: number) => void;
  onNextRunAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { can } = useCapabilityAccess(projectId);
  const isEditing = mode === "edit";

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-schedule-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="dialog-context-label">Scheduled runs</p>
              <h2 className="dialog-title" id="create-execution-schedule-title">{isEditing ? "Edit schedule" : "Add test plan"}</h2>
              <p>{isEditing ? "Adjust the recurring run without losing its run history or current scope." : "Save a recurring run separately from the live run board, then launch it when needed."}</p>
            </div>
            <button aria-label={`Close ${isEditing ? "edit" : "create"} schedule dialog`} className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Close
            </button>
          </div>

          <div className="execution-create-body">
            <div className="detail-summary">
              <strong>{projectName || "Select a project to continue"}</strong>
              <span>{appTypeName ? `${appTypeName} app type selected for this schedule.` : "Choose an app type before scheduling."}</span>
              <span>{scopeSuites.length ? `${scopeSuites.length} suites available for recurring runs.` : "No suites available yet in the selected scope."}</span>
            </div>

            <div className="execution-create-grid">
              <FormField label="Schedule name">
                <input value={executionName} onChange={(event) => onExecutionNameChange(event.target.value)} />
              </FormField>
              <FormField label="Assign to" hint="These users become the default tester group each time the schedule creates a fresh run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length || isSubmitting}
                  options={assigneeOptions}
                  selectedIds={selectedAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>
            </div>

            <div className="execution-create-grid execution-create-grid--metadata">
              {can("requirement_iteration.view") ? <FormField label="Release">
                <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                  <option value="">No release</option>
                  {executionRelease && !releaseOptions.some((option) => option.value === executionRelease) ? (
                    <option value={executionRelease}>{executionRelease}</option>
                  ) : null}
                  {releaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField> : null}
              {can("requirement_iteration.view") ? <FormField label="Sprint">
                <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                  <option value="">No Sprint</option>
                  {executionSprint && !sprintOptions.some((option) => option.value === executionSprint) ? (
                    <option value={executionSprint}>{executionSprint}</option>
                  ) : null}
                  {sprintOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField> : null}
              <FormField label="Build">
                <input placeholder="Build 2026.07.02" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
              </FormField>
            </div>

            <div className="execution-create-grid">
              <FormField label="Cadence" required>
                <select value={cadence} onChange={(event) => onCadenceChange(event.target.value as ExecutionScheduleCadence)}>
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="interval_minutes">Run every N minutes</option>
                </select>
              </FormField>
              <FormField label={cadence === "interval_minutes" ? "Run every" : "First run"} required>
                {cadence === "interval_minutes" ? (
                  <div className="execution-interval-control">
                    <input
                      aria-label="Run every minutes"
                      min={1}
                      max={1440}
                      onChange={(event) => onIntervalMinutesChange(Math.max(1, Number(event.target.value) || 5))}
                      type="number"
                      value={intervalMinutes}
                    />
                    <span>minutes</span>
                    <div className="execution-interval-presets" aria-label="Common schedule intervals">
                      {[5, 10, 15].map((minutes) => (
                        <button
                          className={intervalMinutes === minutes ? "ghost-button is-active" : "ghost-button"}
                          key={minutes}
                          onClick={() => onIntervalMinutesChange(minutes)}
                          type="button"
                        >
                          {minutes} mins
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <input type="datetime-local" value={nextRunAt} onChange={(event) => onNextRunAtChange(event.target.value)} />
              </FormField>
            </div>

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

            <RunDataSetup dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange} projectId={projectId} appTypeId={appTypeId}
              cases={[]} suites={scopeSuites.filter(suite => selectedSuiteIds.includes(suite.id))} dataSetId={selectedDataSetId} onDataSetChange={onDataSetChange}
              environmentId={selectedEnvironmentId} configurationId={selectedConfigurationId} disabled={isSubmitting} />

            <FormField label="Run scope" required>
              <SuiteScopePicker
                projectId={projectId}
                appTypeId={appTypeId}
                description="Pick the reusable suites that should be snapped whenever this schedule runs."
                emptyMessage="No suites available in this app type yet."
                heading="Scheduled suite scope"
                onChange={onSuiteSelectionChange}
                selectedSuiteIds={selectedSuiteIds}
                suites={scopeSuites}
                testCases={testCases}
                metadataByCaseId={metadataByCaseId}
              />
            </FormField>
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!projectId || !appTypeId || !selectedSuiteIds.length || !nextRunAt || isSubmitting} type="submit">
              {isSubmitting ? "Saving…" : isEditing ? "Save schedule" : "Add test plan"}
            </button>
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
