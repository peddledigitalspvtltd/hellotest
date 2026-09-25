import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import type { RunStartMode } from "./RunTypeSelector";

export function RunPlanningFields({
  mode,
  onModeChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  canRunLocalAutomation,
  canRunRemoteAutomation,
  disabled = false,
  modeDisabled = false,
  currentMode,
  modeHint
}: {
  mode: RunStartMode;
  onModeChange: (value: RunStartMode) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  disabled?: boolean;
  modeDisabled?: boolean;
  currentMode?: RunStartMode;
  modeHint?: string;
}) {
  return (
    <div className="execution-run-planning-fields">
      <FormField
        className="execution-run-mode-control"
        hint={modeHint || (mode === "manual"
          ? "Create a run for your team to execute."
          : `Create and start automation on your ${mode === "local" ? "local" : "remote"} Test Engine.`)}
        hintVisible
        label="Run mode"
      >
        <select
          disabled={disabled || modeDisabled || (!canRunLocalAutomation && !canRunRemoteAutomation && mode === "manual")}
          value={mode}
          onChange={(event) => onModeChange(event.target.value as RunStartMode)}
        >
          <option value="manual">Manual</option>
          {canRunLocalAutomation || currentMode === "local" ? <option disabled={!canRunLocalAutomation} value="local">Local automation</option> : null}
          {canRunRemoteAutomation || currentMode === "remote" ? <option disabled={!canRunRemoteAutomation} value="remote">Remote automation</option> : null}
        </select>
      </FormField>
      <div className="execution-run-planning-dates">
        <FormField label="Start date" hint="Optional planned start date for this run.">
          <input
            disabled={disabled}
            max={endDate || "9999-12-31"}
            min="0001-01-01"
            onChange={(event) => onStartDateChange(event.target.value)}
            type="date"
            value={startDate}
          />
        </FormField>
        <FormField
          error={startDate && endDate && endDate < startDate
            ? "End date must be on or after start date."
            : undefined}
          hint="Optional planned end date for this run."
          label="End date"
        >
          <input
            disabled={disabled}
            max="9999-12-31"
            min={startDate || "0001-01-01"}
            onChange={(event) => onEndDateChange(event.target.value)}
            type="date"
            value={endDate}
          />
        </FormField>
      </div>
    </div>
  );
}
