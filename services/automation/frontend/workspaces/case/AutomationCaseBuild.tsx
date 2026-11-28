import { useEffect, useId, useState } from "react";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { IconBraces, IconCircleDot, IconSettings, IconShieldCheck } from "@tabler/icons-react";
import { AddIcon, MousePointerIcon, OpenIcon, PauseIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AutomationBuildContext } from "../../components/AutomationBuildContext";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AutomationBrowserBuildMode } from "../../components/AutomationBrowserBuildMode";
import { AutomationBuildVerificationSettings } from "../../components/AutomationBuildVerificationSettings";
import { AutomationAgentSetup } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { AutomationAgentActivity } from "../../components/AutomationAgentActivity";
import { automationBuildSubmissionPending } from "../../lib/automationBuildTracking";
import { automationProposalEditorStep } from "../../lib/automationSourceProposal";
import { ExecutionContextSelector } from "@hellotest/testing/frontend/components/ExecutionContextSelector";
import { RecorderStartControls } from "../../components/RecorderStartControls";
import { RecorderSessionInsights } from "../../components/RecorderSessionInsights";
import { parseStepParameterName } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { AutomationOverlay } from "../../components/AutomationOverlay";
import { useAutomationBrowserPreflight } from "../../hooks/useAutomationBrowserPreflight";
import { useAutomationAuthoring } from "../../hooks/AutomationAuthoringProvider";
import "./AutomationCaseBuild.css";

import type { useAutomationCaseDetailController } from "./useAutomationCaseDetailController";
type Controller = ReturnType<typeof useAutomationCaseDetailController>;
export type AutomationCaseBuildProps = Pick<Controller, "authoringNotice" | "activeAgentBuildStatus" | "activeCase" | "agentBriefScope" | "agentBuildStatus" | "agentBuildTracking" | "agentMission" | "agentPlanRefreshError" | "agentScheduledAt" | "allowBrowserActions" | "appTypeId" | "automatedSteps" | "automationDraftStore" | "automationLlmIntegrationsQuery" | "automationRuntimeTypes" | "automationStartUrlRequired" | "automationStartUrlValidation" | "bindRecordingParameter" | "buildAgentSelection" | "buildBrowserLocation" | "buildSingleAutomation" | "buildVerificationMode" | "builderContext" | "canBuildCurrentPlan" | "canRecordCurrentPlan" | "canStartRecording" | "canUseAutomationAi" | "canUseAutomationBuilder" | "canUseMobileAppium" | "canVerifyBuild" | "cancelAutomationBuild" | "detectedStepParameters" | "featureFlagsQuery" | "finishRecorder" | "handleAutomationAgentActivity" | "handleParameterValueChange" | "initialEngineerValues" | "inspectAgent" | "latestAgentActivityRef" | "linkedManualCaseIds" | "linkedManualCases" | "linkedManualStepsQuery" | "mergedParameterValues" | "mobileRemoteRecorderEnabled" | "navigate" | "openAutomationBuild" | "projectId" | "recorderParameterBindings" | "recorderParameterDefinitions" | "recorderPlatform" | "recorderSession" | "recorderStartOptions" | "recording" | "recordingTargetStepId" | "repositoryMemberCount" | "resolveParameterInputState" | "scheduleAiAutomation" | "searchParams" | "selectAutomationCase" | "selectAutomationWorkspaceTab" | "selectedExecutionConfigurationId" | "selectedExecutionDataSetId" | "selectedExecutionEnvironmentId" | "selectedParameterSuiteId" | "session" | "setAgentMission" | "setAgentScheduledAt" | "setAllowBrowserActions" | "setAutomationStudioStep" | "setBuildAgentSelection" | "setBuildBrowserLocation" | "setBuildVerificationMode" | "setBuilderContext" | "setIsParameterDialogOpen" | "setRecordingTargetStepId" | "setSearchParams" | "setSelectedExecutionConfigurationId" | "setSelectedExecutionDataSetId" | "setSelectedExecutionEnvironmentId" | "setStartUrl" | "startRecorder" | "startUrl" | "visiblePrivateNames"> & { activeCase: NonNullable<Controller["activeCase"]> };

export function AutomationCaseBuild({ authoringNotice, activeAgentBuildStatus, activeCase, agentBriefScope, agentBuildStatus, agentBuildTracking, agentMission, agentPlanRefreshError, agentScheduledAt, allowBrowserActions, appTypeId, automatedSteps, automationDraftStore, automationLlmIntegrationsQuery, automationRuntimeTypes, automationStartUrlRequired, automationStartUrlValidation, bindRecordingParameter, buildAgentSelection, buildBrowserLocation, buildSingleAutomation, buildVerificationMode, builderContext, canBuildCurrentPlan, canRecordCurrentPlan, canStartRecording, canUseAutomationAi, canUseAutomationBuilder, canUseMobileAppium, canVerifyBuild, cancelAutomationBuild, detectedStepParameters, featureFlagsQuery, finishRecorder, handleAutomationAgentActivity, handleParameterValueChange, initialEngineerValues, inspectAgent, latestAgentActivityRef, linkedManualCaseIds, linkedManualCases, linkedManualStepsQuery, mergedParameterValues, mobileRemoteRecorderEnabled, navigate, openAutomationBuild, projectId, recorderParameterBindings, recorderParameterDefinitions, recorderPlatform, recorderSession, recorderStartOptions, recording, recordingTargetStepId, repositoryMemberCount, resolveParameterInputState, scheduleAiAutomation, searchParams, selectAutomationCase, selectAutomationWorkspaceTab, selectedExecutionConfigurationId, selectedExecutionDataSetId, selectedExecutionEnvironmentId, selectedParameterSuiteId, session, setAgentMission, setAgentScheduledAt, setAllowBrowserActions, setAutomationStudioStep, setBuildAgentSelection, setBuildBrowserLocation, setBuildVerificationMode, setBuilderContext, setIsParameterDialogOpen, setRecordingTargetStepId, setSearchParams, setSelectedExecutionConfigurationId, setSelectedExecutionDataSetId, setSelectedExecutionEnvironmentId, setStartUrl, startRecorder, startUrl, visiblePrivateNames }: AutomationCaseBuildProps) {
const [requestedBuildMethod, setBuildMethodState] = useState<"agent" | "record">(() => recording || searchParams.get("build_method") === "record" ? "record" : "agent");
const showRecorder = canRecordCurrentPlan || Boolean(recorderSession);
const buildMethod = showRecorder && (requestedBuildMethod === "record" || !canUseAutomationAi) ? "record" : "agent";
const [agentBriefOpen, setAgentBriefOpen] = useState(() => !searchParams.get("agent_activity") && !["queued","running"].includes(activeAgentBuildStatus));
const [isExecutionContextOpen, setIsExecutionContextOpen] = useState(false);
const [discardRecordingId, setDiscardRecordingId] = useState("");
const startUrlErrorId = useId();
const authoring = useAutomationAuthoring();
useEffect(() => { if (!recorderSession) setDiscardRecordingId(""); }, [recorderSession?.id]);
const setBuildMethod = (value: "agent" | "record") => { setBuildMethodState(value); setSearchParams(current => { const next = new URLSearchParams(current); next.set("build_method", value); return next; }, { replace: true }); };
useEffect(() => { const requested = searchParams.get("build_method"); if(recording) setBuildMethodState("record"); else if(requested === "agent" || requested === "record") setBuildMethodState(requested); }, [searchParams, recording?.operationId]);
useEffect(() => { if(buildSingleAutomation.isPending || scheduleAiAutomation.isPending) setAgentBriefOpen(false); else if(buildSingleAutomation.isError || scheduleAiAutomation.isError || agentPlanRefreshError || buildSingleAutomation.isSuccess && buildSingleAutomation.data === null) setAgentBriefOpen(true); }, [buildSingleAutomation.isPending, scheduleAiAutomation.isPending, buildSingleAutomation.isError, scheduleAiAutomation.isError, buildSingleAutomation.isSuccess, buildSingleAutomation.data, agentPlanRefreshError]);
const hasNative = automationRuntimeTypes.some(type => type === "android" || type === "ios");
const mixedBrowserNative = automationStartUrlRequired && hasNative;
const scheduledRemoteBuild = Boolean(agentScheduledAt) && buildBrowserLocation === "remote";
const canCheckBrowser = canUseAutomationAi && canUseAutomationBuilder && buildMethod === "agent" && agentBriefOpen
    && !scheduledRemoteBuild && !mixedBrowserNative && automationStartUrlRequired && !automationStartUrlValidation
    && !["queued", "running"].includes(activeAgentBuildStatus);
const browserSetup = useAutomationBrowserPreflight({
    enabled: canCheckBrowser, projectId, caseId: activeCase.id, startUrl,
    environmentId: selectedExecutionEnvironmentId, configurationId: selectedExecutionConfigurationId, dataSetId: selectedExecutionDataSetId,
    suiteId: selectedParameterSuiteId, integrationId: buildAgentSelection.integrationId, location: buildBrowserLocation, localAgent: inspectAgent
});
const buildRunning = buildSingleAutomation.isPending || ["queued", "running"].includes(activeAgentBuildStatus);
const hasBuildInstructions = Boolean(automatedSteps.length || agentMission.trim() || builderContext.trim() || richTextToPlainText(activeCase.description).trim());
const buildDisabled = !canBuildCurrentPlan || !canUseAutomationBuilder || !hasBuildInstructions || Boolean(automationStartUrlValidation)
    || mixedBrowserNative || browserSetup.checking || Boolean(browserSetup.error);
const hasApi = automationRuntimeTypes.includes("api");
const allWeb = automationStartUrlRequired && automationRuntimeTypes.every(type => type === "web");
const recordsBrowser = recorderPlatform === "web" || recorderPlatform === "unified";
const contextLabel = browserSetup.environment?.name || (selectedExecutionEnvironmentId ? "Environment selected" : selectedExecutionConfigurationId || selectedExecutionDataSetId ? "Context selected" : "Choose context");
const buildSuggestions = ["Prioritize assertions", automationStartUrlRequired ? "Reuse repository objects" : hasApi ? "Check the response contract" : "Use supplied device locators", "Cover edge cases"];
const buildStatusLabel = buildSingleAutomation.isPending ? "Submitting" : activeAgentBuildStatus === "running" ? "Building" : activeAgentBuildStatus === "completed" ? "Built" : activeAgentBuildStatus === "cancelled" ? "Stopped" : activeAgentBuildStatus[0].toUpperCase() + activeAgentBuildStatus.slice(1);
return <><section className="automation-agent-workspace automation-case-build" aria-label="Automation build tools">
                    <header className="automation-build-header">
                      <h3>{canUseAutomationAi ? "Build automation" : "Record automation"}</h3>
                      {canUseAutomationAi && showRecorder ? <div className="automation-build-methods" role="group" aria-label="Build method">
                        <button aria-pressed={buildMethod === "agent"} onClick={() => setBuildMethod("agent")} type="button"><SparkIcon size={15}/><span>Automation Build Agent</span></button>
                        <button aria-pressed={buildMethod === "record"} onClick={() => setBuildMethod("record")} type="button"><MousePointerIcon size={15}/><span>Record &amp; playback{recorderSession?.status === "running" ? " · Recording" : ""}</span></button>
                      </div> : null}
                      {canUseAutomationAi && hasPermission(session, "agentic_workflow.run", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) ? <button className="ghost-button compact automation-quality-launch" onClick={() => navigate(`/agentic-workflows?surface=quality&test_case=${activeCase.id}`)} type="button"><IconShieldCheck size={16}/>Open quality agents</button> : null}
                    </header>
                    {authoringNotice ? <p role="status" className="muted">{authoringNotice}</p> : null}
                    {buildMethod === "agent" && canUseAutomationAi ? <div className="automation-ai-layout"><details className="automation-engineer-brief" open={agentBriefOpen} onToggle={event => setAgentBriefOpen(event.currentTarget.open)}>
                      <summary>
                        <IconSettings size={16} aria-hidden="true"/><strong>Build setup</strong>
                        {buildSingleAutomation.isPending || activeAgentBuildStatus !== "idle" ? <span className={`automation-ai-status is-${activeAgentBuildStatus}`} role="status"><IconCircleDot size={13} aria-hidden="true"/>{buildStatusLabel}</span> : null}
                      </summary>
                      <div className="automation-ai-studio">
                      <div className="automation-case-build__target">
                        {automationStartUrlRequired || hasApi ? <label className="form-field"><span>{automationStartUrlRequired ? "Start URL (required)" : "API base URL (optional)"}</span><input aria-label={automationStartUrlRequired ? "Agent start URL" : "API base URL"} aria-describedby={startUrl.trim() && automationStartUrlValidation ? startUrlErrorId : undefined} aria-invalid={Boolean(startUrl.trim() && automationStartUrlValidation)} type="url" required={automationStartUrlRequired} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com" value={startUrl}/>{startUrl.trim() && automationStartUrlValidation ? <small id={startUrlErrorId} role="alert">{automationStartUrlValidation}</small> : null}</label> : null}
                        <div className="form-field automation-case-build__context"><span>Execution context</span><button className="ghost-button" type="button" aria-label="Execution context" onClick={() => setIsExecutionContextOpen(true)}><IconSettings size={15} aria-hidden="true"/><span>{contextLabel}</span></button></div>
                      </div>
                      {automationStartUrlRequired ? <div className="automation-case-build__browser">
                        <AutomationBrowserBuildMode compact location={buildBrowserLocation} onLocationChange={setBuildBrowserLocation} interactive={allowBrowserActions} onChange={setAllowBrowserActions} disabled={buildRunning}/>
                        {allWeb ? <AutomationBuildVerificationSettings compact browserLocation={buildBrowserLocation} mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} hasEnvironment={Boolean(selectedExecutionEnvironmentId)} disabled={buildRunning || scheduleAiAutomation.isPending}/> : null}
                      </div> : null}
                      {hasNative && !mixedBrowserNative ? <p className="automation-case-build__hint" role="note">Build native steps from Appium locators. Use a device configuration to run them.</p> : null}
                      {mixedBrowserNative ? <p className="automation-case-build__feedback" role="alert">Build Web and API steps together. Move native steps to a separate case.</p> : null}
                      {browserSetup.message || browserSetup.error ? <div className="automation-case-build__feedback" role={browserSetup.error ? "alert" : "status"}>
                        <span>{browserSetup.error || browserSetup.message}</span>
                        {browserSetup.error ? <button className="ghost-button compact" type="button" onClick={browserSetup.recheck}>{buildBrowserLocation === "local" ? "Connect local agent" : "Check browser again"}</button> : null}
                      </div> : null}
                      {!hasBuildInstructions ? <p className="automation-case-build__hint">{linkedManualCaseIds.length ? "Linked cases add context. Enter the flow and expected results to create the plan." : "Enter the flow and expected results to create the plan."}</p> : null}
                      <AutomationAgentSetup agentId="automation-engineer" caseBuildRuntimes={automationRuntimeTypes} projectId={projectId} appTypeId={appTypeId} testCaseId={activeCase.id} value={buildAgentSelection} onChange={setBuildAgentSelection} integrations={asArray(automationLlmIntegrationsQuery.data)} prompt={agentMission} onPromptChange={setAgentMission} onSubmit={() => buildSingleAutomation.mutate(false)} running={buildRunning} submitDisabled={buildDisabled} submitLabel={agentScheduledAt ? "Schedule build" : "Build plan"} secondaryAction={<button className="ghost-button compact" type="button" disabled={buildRunning || buildDisabled} onClick={() => buildSingleAutomation.mutate(true)}><IconBraces size={15} aria-hidden="true"/>Review data &amp; build</button>}/>
                      <details className="automation-ai-options"><summary><IconSettings size={15}/>Build settings{agentScheduledAt ? <span>Scheduled</span> : null}</summary><div className="automation-ai-options-body">
                        <div className="automation-case-build__settings-fields">
                          <label className="form-field"><span>Schedule (optional)</span><input aria-label="Schedule agent build" min={new Date().toLocaleString("sv-SE").slice(0, 16).replace(" ", "T")} onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt}/>{scheduledRemoteBuild && automationStartUrlRequired ? <small>Browser checks begin at the scheduled time.</small> : null}</label>
                          <label className="form-field"><span>Additional guidance</span><textarea rows={2} onChange={(event) => setBuilderContext(event.target.value)} value={builderContext} placeholder="Authentication, edge cases and constraints"/></label>
                        </div>
                        <div className="automation-ai-suggestions" aria-label="Agent instruction suggestions">{buildSuggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setAgentMission(current => [current.trim(), suggestion + "."].filter(Boolean).join("\n"))}><AddIcon size={12} aria-hidden="true"/>{suggestion}</button>)}</div>
                        <AutomationBuildContext stepCount={automatedSteps.length} expectedResultCount={automatedSteps.filter((step) => richTextToPlainText(step.expected_result || "").trim()).length} manualCaseCount={linkedManualCases.length} repositoryCount={repositoryMemberCount} runtimes={automationRuntimeTypes}/>
                      </div></details>
                      {buildSingleAutomation.isError ? <p role="alert" className="automation-overlay-error">{buildSingleAutomation.error instanceof Error ? buildSingleAutomation.error.message : "The build could not be queued."}</p> : null}

                    </div></details>
                      {agentPlanRefreshError ? <div role="alert"><p>{agentPlanRefreshError}</p><button type="button" className="ghost-button compact" onClick={() => {
                                    if (latestAgentActivityRef.current)
                                        void handleAutomationAgentActivity(latestAgentActivityRef.current);
                                }}>Reload saved Plan</button></div> : null}
                      {linkedManualStepsQuery.isError ? <p role="alert">Linked manual coverage could not be loaded. <button className="ghost-button compact" type="button" onClick={() => void linkedManualStepsQuery.refetch()}>Retry manual coverage</button></p> : null}
                      <AutomationAgentActivity projectId={projectId} appTypeId={appTypeId} caseId={activeCase.id} caseTitle={activeCase.title} initialSteps={automatedSteps} initialManualSteps={linkedManualStepsQuery.data?.flat() || []} initialManualLoading={Boolean(linkedManualCaseIds.length && linkedManualStepsQuery.isFetching)} initialParameterValues={initialEngineerValues} submitting={automationBuildSubmissionPending(buildSingleAutomation.isPending, buildSingleAutomation.context?.briefScope, agentBriefScope)} transactionId={searchParams.get("agent_activity") || (agentBuildTracking?.projectId === projectId && agentBuildTracking.caseIds.includes(activeCase.id) && ["queued", "running"].includes(agentBuildStatus) ? agentBuildTracking.transactionId : undefined)} onUpdate={activity => { void handleAutomationAgentActivity(activity); }} onReview={id => {
                                if (id === activeCase.id)
                                    selectAutomationWorkspaceTab("steps");
                                else
                                    selectAutomationCase(id);
                            }} onRetry={openAutomationBuild} onStop={canUseAutomationBuilder && canUseAutomationAi ? transactionId => cancelAutomationBuild.mutate(transactionId) : undefined} stoppingActivityId={cancelAutomationBuild.isPending ? cancelAutomationBuild.variables : undefined} sourceIntegrationId={buildAgentSelection.integrationId || undefined} onReviewSource={canUseAutomationBuilder && canUseAutomationAi ? proposal => {
                                if (proposal.test_case_id !== activeCase.id)
                                    throw new Error("Select the proposal’s automation case before reviewing it.");
                                const current = automatedSteps.find(step => step.id === proposal.step_id);
                                setAutomationStudioStep(automationProposalEditorStep(current, proposal, current ? automationDraftStore.read("code")[current.id] : undefined));
                            } : undefined}/>
                    </div> : <div className="automation-agent-brief automation-recording-workspace">
                      <div className="automation-case-build__record-target">
                        {recordsBrowser ? <label className="form-field"><span>Start URL{automationStartUrlRequired ? " (required)" : ""}</span><input type="url" required={automationStartUrlRequired} disabled={Boolean(recorderSession)} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com" value={startUrl}/></label> : null}
                        <label className="form-field"><span>Save recording to</span><select disabled={Boolean(recorderSession)} onChange={(event) => setRecordingTargetStepId(event.target.value)} value={recordingTargetStepId}><option value="">All steps for this runtime</option>{automatedSteps.map((step) => <option key={step.id} value={step.id}>{step.step_order}. {richTextToPlainText(step.action || "Untitled step")}</option>)}</select></label>
                      </div>
                      {automatedSteps.length ? <p className="automation-case-build__hint">{recordingTargetStepId ? "Saving replaces the selected section’s instructions." : "Saving replaces this runtime’s plan steps."}</p> : null}
                      <details><summary>Recording environment & data</summary><ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/></details>
                      <RecorderStartControls platform={recorderPlatform} disabled={!canRecordCurrentPlan || !canStartRecording || !activeCase} hasSession={Boolean(recorderSession)} isStarting={startRecorder.isPending} mobileAppiumEnabled={canUseMobileAppium} mobileRemoteEnabled={mobileRemoteRecorderEnabled} onStart={(options) => startRecorder.mutate(options)} primaryAction={recorderSession ? <button className="primary-button recorder-stop-button" disabled={finishRecorder.isPending} onClick={() => finishRecorder.mutate()} type="button"><PauseIcon />{finishRecorder.isPending && finishRecorder.variables !== "discard" ? "Saving recording…" : "Save recording to plan"}</button> : undefined} moreActions={recorderSession ? <>
                        {recorderSession.live_view_url && <a className="ghost-button compact" href={recorderSession.live_view_url} rel="noreferrer" target="_blank"><OpenIcon size={14}/>Open live view</a>}
                        <button type="button" className="ghost-button compact" disabled={finishRecorder.isPending} onClick={() => setDiscardRecordingId(recorderSession.id)}>Discard recording</button>
                      </> : undefined}/>
                      {recorderSession && discardRecordingId === recorderSession.id && <AutomationOverlay title="Discard recording?" variant="dialog" onClose={() => setDiscardRecordingId("")} closeDisabled={finishRecorder.isPending}>
                        <p>Discard the captured actions and keep the saved automation plan.</p>
                        <div className="action-row">
                          <button type="button" className="ghost-button" disabled={finishRecorder.isPending} onClick={() => setDiscardRecordingId("")}>Keep recording</button>
                          <button type="button" className="primary-button danger" disabled={finishRecorder.isPending} onClick={() => finishRecorder.mutate("discard")}>{finishRecorder.isPending ? "Discarding…" : "Discard recording"}</button>
                        </div>
                      </AutomationOverlay>}
                      {recorderSession?.live_view_url ? <iframe allow="clipboard-read; clipboard-write" className="recorder-live-frame" src={recorderSession.live_view_url} title="HelloTest automation recorder"/> : null}
                      {recorderSession && recorderStartOptions?.recorder_target === "web" ? <div className="automation-case-build__record-data"><p className="automation-case-build__hint">Bind private inputs before saving.</p><button className="ghost-button compact" disabled={finishRecorder.isPending} onClick={() => setIsParameterDialogOpen(true)} type="button">Manage recording parameters</button></div> : null}
                      <RecorderSessionInsights key={recorderSession?.id || "no-recording"} session={recorderSession}
                        excludedActionIndices={recording?.excludedActionIndices}
                        onActionInclusionChange={recording ? (index, included) => authoring.recordingActionInclusionChanged(recording.origin.caseId, recording.operationId, index, included) : undefined}
                        privateValues={[...(recording?.privateValues || []), ...Object.entries(mergedParameterValues).filter(([name]) => visiblePrivateNames.has(name)).map(([, value]) => value)]} parameters={recorderParameterDefinitions} parameterBindings={recorderParameterBindings} disabled={finishRecorder.isPending} onParameterBindingChange={recorderStartOptions?.recorder_target === "web" ? (index, reference) => bindRecordingParameter(index, reference) : undefined} onCreateParameter={recorderStartOptions?.recorder_target === "web" ? (index, reference, value) => {
                                if (!/^@[tsr]\./.test(reference))
                                    return "Use an explicit @t, @r or @s parameter reference.";
                                const parameter = parseStepParameterName(reference);
                                if (!parameter || parameter.token !== reference)
                                    return "Enter a valid scoped parameter reference.";
                                const state = resolveParameterInputState(parameter.scope);
                                if (state.disabled)
                                    return state.hint || "This parameter scope cannot be edited here.";
                                if (detectedStepParameters.some(existing => existing.name === parameter.name))
                                    return "This parameter already exists. Select it above and manage its value in recording parameters.";
                                handleParameterValueChange(parameter.name, value);
                                bindRecordingParameter(index, parameter.token);
                                return null;
                            } : undefined}/>
                      {recordsBrowser ? <details className="automation-case-build__record-help"><summary>Web recording guide</summary><p className="automation-case-build__hint">Record one page at a time and bind uploads to file parameters. Use Automation Build Agent for popups, embedded frames, or drag and drop.</p></details> : null}
                    </div>}
                  </section>{isExecutionContextOpen ? <AutomationOverlay title="Execution context" icon={<IconSettings size={20}/>} onClose={() => setIsExecutionContextOpen(false)}>
        <ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/>
        <div className="automation-overlay-footer"><button className="primary-button" onClick={() => setIsExecutionContextOpen(false)} type="button">Done</button></div>
      </AutomationOverlay> : null}</>;
}
