import { useId, useRef } from "react";
import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { AddIcon, MousePointerIcon, PencilIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { RichTextContent, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { ExecutionContextSelector } from "@hellotest/testing/frontend/components/ExecutionContextSelector";
import { ApiAutomationSourceIntake } from "../../components/ApiAutomationSourceIntake";
import { AutomationBrowserBuildMode } from "../../components/AutomationBrowserBuildMode";
import { AutomationBuildVerificationSettings } from "../../components/AutomationBuildVerificationSettings";
import { AutomationCaseIdentityFields, AutomationCaseManualLinks, AutomationCaseMetadata, AutomationDraftPlan } from "../../components/AutomationCaseMetadata";
import { isAutomationPrecondition } from "../../lib/automationPlan";
import { getDefaultAutomationStepType } from "../../lib/automationRuntime";
import type { AutomationCasesController } from "./useAutomationCasesController";
import "./AutomationCreateCaseDialog.css";

export function AutomationCreateCaseDialog({ controller, engineer }: { controller: AutomationCasesController; engineer: boolean }) {
  const {
    automationCreateMetadata, automationCreateManualCaseIds, automationCreateSteps, automationCreateParameters,
    automationCreationMode, setAutomationCreationMode, canUseAutomationAi, canRecordCreation, canUseRecorder,
    automationCreateRuntimeTypes, automationCreateStartUrlRequired, automationCreateStartUrl, setAutomationCreateStartUrl, automationCreateStartUrlValidation,
    importedApiPlanReady, creationAllowedStepTypes, creationIncompatibleRuntimes, includeLinkedBehavior, createSourcesQuery,
    metadataOptions, updateAutomationCreateMetadata, applyApiSourceDraft, setAutomationCreateSteps,
    agentMission, setAgentMission, builderContext, setBuilderContext, agentScheduledAt, setAgentScheduledAt,
    automationLlmIntegrationsQuery, buildAgentSelection, setBuildAgentSelection, buildBrowserLocation, setBuildBrowserLocation,
    allowBrowserActions, setAllowBrowserActions, buildVerificationMode, setBuildVerificationMode, canVerifyBuild,
    selectedExecutionConfigurationId, setSelectedExecutionConfigurationId, selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId,
    appTypeId, projectId, createAutomationCase, scheduleAiAutomation, canCreateAutomationCase, closeCreateAutomation, createAutomationDialogRef,
  } = controller;
  const importPanelRef = useRef<HTMLDetailsElement>(null);
  const startUrlErrorId = useId();
  const busy = createAutomationCase.isPending;
  const metadata = { ...automationCreateMetadata, manualCaseIds: automationCreateManualCaseIds };
  const buildsWithAi = automationCreationMode === "ai" && !importedApiPlanReady;
  const hasWeb = automationCreateRuntimeTypes.includes("web");
  const hasApi = automationCreateRuntimeTypes.includes("api");
  const startUrlError = automationCreateStartUrl.trim() ? automationCreateStartUrlValidation : null;
  const hasIntent = Boolean(metadata.manualCaseIds.length || agentMission.trim() || builderContext.trim()
    || automationCreateSteps.some(step => step.action.trim() || step.expected_result.trim())
    || richTextToPlainText(metadata.description).trim());
  const waitingForSource = Boolean(metadata.manualCaseIds.length && (createSourcesQuery.isPending || createSourcesQuery.isError));
  const canSubmit = metadata.title.trim() && metadata.automationCaseType && !busy && !creationIncompatibleRuntimes.length
    && !automationCreateStartUrlValidation && !waitingForSource && (automationCreationMode !== "record" || canUseRecorder)
    && (!buildsWithAi || canUseAutomationAi && hasIntent);
  const submitLabel = importedApiPlanReady ? "Create API case" : buildsWithAi ? (agentScheduledAt ? "Create & schedule" : "Create & build")
    : automationCreationMode === "record" ? "Create & record" : "Create case";
  const metadataFields = { value: metadata, onChange: updateAutomationCreateMetadata, disabled: busy };

  return <div className="modal-backdrop automation-create-backdrop" onClick={closeCreateAutomation} role="presentation">
    <div aria-modal="true" aria-labelledby="automation-create-dialog-title" className="modal-card resource-modal-card automation-create-dialog automation-authoring-create"
      onClick={event => event.stopPropagation()} ref={createAutomationDialogRef} role="dialog" tabIndex={-1}>
      <header className="resource-modal-header">
        <h2 className="dialog-title" id="automation-create-dialog-title">{engineer ? "Set up an automation build" : "Create automation case"}</h2>
        <DialogCloseButton label="Close create automation case" disabled={busy} onClick={closeCreateAutomation} />
      </header>
      <form className="resource-form" onSubmit={event => {
        event.preventDefault();
        if (canCreateAutomationCase && canSubmit) createAutomationCase.mutate();
      }}>
        <div className="resource-form-body">
          <fieldset className="automation-create-fields" disabled={busy}>
            <div className="automation-create-identity"><AutomationCaseIdentityFields {...metadataFields} create /></div>
            <div className="automation-create-columns">
              <section className="automation-create-setup" aria-labelledby="automation-create-setup-title">
                <h3 id="automation-create-setup-title">Build method</h3>
                {importedApiPlanReady ? <p className="automation-create-import-status" role="status">The imported requests will be saved as written.</p> : <div className="automation-build-methods">
                  {canUseAutomationAi ? <button aria-pressed={automationCreationMode === "ai"} onClick={() => setAutomationCreationMode("ai")} type="button"><SparkIcon size={16} />AI agent</button> : null}
                  {canRecordCreation ? <button aria-pressed={automationCreationMode === "record"} onClick={() => setAutomationCreationMode("record")} type="button"><MousePointerIcon size={16} />Record flow</button> : null}
                  <button aria-pressed={automationCreationMode === "blank"} onClick={() => setAutomationCreationMode("blank")} type="button"><PencilIcon size={16} />Author steps</button>
                </div>}
                {hasWeb || hasApi ? <label className="form-field">
                  <span>{hasWeb ? "Start URL" : "API base URL (optional)"}</span>
                  <input aria-label={hasWeb ? "Automation case start URL" : "API base URL"} type="url" required={automationCreateStartUrlRequired}
                    aria-invalid={Boolean(startUrlError)} aria-describedby={startUrlError ? startUrlErrorId : undefined}
                    onChange={event => setAutomationCreateStartUrl(event.target.value)} placeholder={hasWeb ? "https://app.example.com" : "https://api.example.com"} value={automationCreateStartUrl} />
                  {startUrlError ? <small id={startUrlErrorId} role="alert">{startUrlError}</small> : null}
                </label> : null}
                {buildsWithAi ? <>
                  <label className="form-field"><span>Build instructions</span>
                    <textarea aria-label="Build instructions (optional)" onChange={event => setAgentMission(event.target.value)} rows={3}
                      placeholder="What should the agent do and verify?" value={agentMission} />
                    {!hasIntent ? <small className="muted">Describe the flow, link a test case, or add a step.</small> : null}
                  </label>
                  {hasWeb ? <div className="automation-create-browser"><AutomationBrowserBuildMode compact location={buildBrowserLocation} onLocationChange={setBuildBrowserLocation} interactive={allowBrowserActions} onChange={setAllowBrowserActions} disabled={busy} /></div> : null}
                  <details className="automation-create-disclosure">
                    <summary>Build settings</summary>
                    <div className="automation-create-disclosure-body">
                      <ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} hideDataSet selectedEnvironmentId={selectedExecutionEnvironmentId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} onConfigurationChange={setSelectedExecutionConfigurationId} selectedDataSetId={metadata.dataSetId} onDataSetChange={dataSetId => updateAutomationCreateMetadata({ dataSetId })} />
                      {hasWeb && automationCreateRuntimeTypes.every(runtime => runtime === "web") ? <AutomationBuildVerificationSettings compact browserLocation={buildBrowserLocation} mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} hasEnvironment={Boolean(selectedExecutionEnvironmentId)} disabled={scheduleAiAutomation.isPending || busy} /> : null}
                      <AiLlmSelect integrations={asArray(automationLlmIntegrationsQuery.data)} value={buildAgentSelection.integrationId} onChange={integrationId => setBuildAgentSelection(current => ({ ...current, integrationId }))} disabled={busy} scopeKey={projectId} />
                      <label className="form-field"><span>Additional guidance</span><textarea onChange={event => setBuilderContext(event.target.value)} rows={2} value={builderContext} /></label>
                      <label className="form-field"><span>Schedule build (optional)</span><input onChange={event => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt} /><small className="muted">Leave empty to build now.</small></label>
                    </div>
                  </details>
                </> : null}
                <details className="automation-create-disclosure">
                  <summary>Details and links</summary>
                  <div className="automation-create-disclosure-body"><AutomationCaseMetadata {...metadataOptions} {...metadataFields} layout="details" /></div>
                </details>
              </section>
              <section className="automation-create-plan-panel" aria-labelledby="automation-create-plan-title">
                <h3 id="automation-create-plan-title">Plan</h3>
                <AutomationCaseManualLinks {...metadataFields} options={metadataOptions.manualCases} create />
                {metadata.manualCaseIds.length && createSourcesQuery.isPending ? <LoadingState label="Loading source Test Case plans" /> : null}
                {metadata.manualCaseIds.length && createSourcesQuery.isError ? <div className="automation-create-source-error" role="alert"><span>Source steps could not be loaded.</span><button className="ghost-button compact" onClick={() => void createSourcesQuery.refetch()} type="button">Retry</button></div> : null}
                {!includeLinkedBehavior && metadata.manualCaseIds.length ? <small className="muted">Linked for coverage. This plan uses its own API steps.</small> : null}
                {metadata.manualCaseIds.map(sourceId => {
                  const source = createSourcesQuery.data?.find(item => item.testCase.id === sourceId);
                  if (!source) return null;
                  const preconditions = source.steps.filter(isAutomationPrecondition).length;
                  const steps = source.steps.length - preconditions;
                  return <details className="automation-create-disclosure automation-create-source-preview" key={sourceId}>
                    <summary><span>{source.testCase.title}</span><small>{steps} {steps === 1 ? "step" : "steps"}{preconditions ? ` · ${preconditions} ${preconditions === 1 ? "precondition" : "preconditions"}` : ""}</small></summary>
                    {source.steps.length ? <ol>{source.steps.map(step => <li key={step.id}>
                      {step.group_name ? <small>{step.group_name}</small> : null}
                      <RichTextContent value={step.action || ""} />
                      {step.expected_result ? <div><small>Expected result</small><RichTextContent value={step.expected_result} /></div> : null}
                    </li>)}</ol> : <p className="muted">This case has no steps yet.</p>}
                  </details>;
                })}
                {creationIncompatibleRuntimes.length ? <p className="automation-create-error" role="alert">This case type does not support {creationIncompatibleRuntimes.join(", ")} steps. Choose Unified or update the plan.</p> : null}
                {creationAllowedStepTypes.includes("api") ? <details className="automation-create-disclosure automation-create-api-import" ref={importPanelRef}>
                  <summary>Import API requests</summary>
                  <div className="automation-create-disclosure-body">
                    <ApiAutomationSourceIntake compact disabled={busy} hasSteps={automationCreateSteps.length > 0} onApply={(result, mode) => {
                      const conflict = applyApiSourceDraft(result, mode);
                      const panel = importPanelRef.current;
                      if (!conflict && panel) {
                        panel.open = false;
                        panel.querySelector("summary")?.focus();
                      }
                      return conflict;
                    }} />
                  </div>
                </details> : null}
                {!metadata.automationCaseType ? <small className="muted">Select a case type to add steps.</small> : null}
                <AutomationDraftPlan allowedStepTypes={creationAllowedStepTypes} defaultStepType={getDefaultAutomationStepType([], metadata.automationCaseType)}
                  availableParameters={automationCreateParameters.definitions} parameterValues={automationCreateParameters.values} onChange={setAutomationCreateSteps} value={automationCreateSteps} />
              </section>
            </div>
          </fieldset>
        </div>
        <footer className="resource-form-footer">
          {createAutomationCase.error ? <p className="automation-create-error" role="alert">{createAutomationCase.error instanceof Error ? createAutomationCase.error.message : "Unable to create automation case."}</p> : null}
          <div className="automation-create-actions">
            <button className="ghost-button" disabled={busy} onClick={closeCreateAutomation} type="button">Cancel</button>
            {canCreateAutomationCase ? <button className="primary-button" disabled={!canSubmit} type="submit"><AddIcon /><span>{busy ? "Creating…" : submitLabel}</span></button> : null}
          </div>
        </footer>
      </form>
    </div>
  </div>;
}
