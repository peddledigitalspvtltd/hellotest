import { AutomationCaseRuns } from "../workspaces/case/AutomationCaseRuns";
import { AutomationCaseData } from "../workspaces/case/AutomationCaseData";
import { AutomationCaseSteps } from "../workspaces/case/AutomationCaseSteps";
import { AutomationCaseBuild } from "../workspaces/case/AutomationCaseBuild";

import { AutomationBuildVerificationSettings } from "../components/AutomationBuildVerificationSettings";

import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";

import { AutomationInputBindingDialog } from "../components/AutomationInputBindingDialog";
import { applyAutomationInputBindings } from "../lib/automationInputBindings";
import { canonicalizeSavedLocatorWrappers } from "../../shared/automationProgramCompatibility.mjs";

import { LinkedDefectsPanel } from "@hellotest/testing/frontend/components/LinkedDefectsPanel";
import { RelatedWorkItemsPanel } from "@hellotest/manual/frontend/components/RelatedWorkItemsPanel";

import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { AutomationSectionGroupDialog } from "../components/AutomationSectionGroupDialog";
import { parseApiRequestSource } from "../lib/apiRequestSource";

import { AutomationBrowserBuildMode } from "../components/AutomationBrowserBuildMode";
import { AutomationRunReviewDialog } from "../components/AutomationRunReviewDialog";
import { isPrivateParameterName } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";

import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";

import { IconTargetArrow } from "@tabler/icons-react";
import { AddIcon, BugIcon, LayersIcon, OpenIcon, PencilIcon, PlayIcon, SelectionToggleIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

import { DetailSectionTabs } from "@hellotest/platform/frontend/src/shared/components/DetailSectionTabs";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { ExecutionContextSelector } from "@hellotest/testing/frontend/components/ExecutionContextSelector";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";

import { RepositoryAgentSetup, RepositoryAgentStatus } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { RunHooksBuilder } from "@hellotest/testing/frontend/components/RunHooksBuilder";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { CodePreviewDialog, StepAutomationDialog } from "../components/StepAutomationEditor";
import { StepParameterDialog } from "@hellotest/testing/frontend/components/StepParameterDialog";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { TestCaseVersionHistory } from "@hellotest/testing/frontend/components/TestCaseVersionHistory";
import { AutomationCaseMetadata } from "../components/AutomationCaseMetadata";

import { TileCardStepsIcon, TileCardSuiteIcon } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";

import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";

import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";

import { buildDataSetParameterDefinitions, combineStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

import { automationCaseDetailQueryKey } from "../lib/automationWorkspaceSupport";
import { lazy, Suspense } from 'react';
import "../components/AutomationWorkspace.css";
import { useAutomationCaseDetailController } from "../workspaces/case/useAutomationCaseDetailController";
const AutomationCaseObjectsWorkspace = lazy(() => import('../workspaces/repository/AutomationCaseObjectsWorkspace').then(module => ({ default: module.AutomationCaseObjectsWorkspace })));
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
export function AutomationCaseDetailPage() {
    const controller = useAutomationCaseDetailController();
    const {authoringNotice,confirmationDialog, canInspectRepository, canUseRecorder, canRunLocalAutomation, canUseAutomationBuilder, inspectAgent, selectedCaseId, automationPageHeader, automationMetricsQuery, automationMetrics, canViewExecutionMetrics, message, setMessage, messageTone, activeCase, selectedCaseSummary, closeAutomationCaseWorkspace, isAutomationCaseDetailReady, runSelectedAutomationCases, recorderSession, requestAutomationRun, canRunRemoteAutomation, isAutomationCaseDetailPending, selectedAutomationCaseDetailQuery, automatedStepsQuery, unsavedAutomationStepIds, selectAutomationWorkspaceTab, automationDisplayIdByCaseId, activeAutomationWorkspaceTab, automatedSteps, automationDataTokens, executionHookDraft, canUseAutomationAi, canRecordCurrentPlan, canViewObjectRepository, canViewAutomationCode, caseObjectBindingCount, suiteLinkDraftIds, selectedCaseHistoryQuery, activeCaseHistory, metadataOptions, canUpdateAutomationCase, updateAutomationCase, caseDraft, automationManualLinkDraftIds, caseRequirementIds, caseModuleIds, caseDataSetId, setCaseDraft, setAutomationManualLinkDraftIds, setCaseRequirementIds, setCaseModuleIds, setSuiteLinkDraftIds, setCaseDataSetId, detailIncompatibleRuntimes, linkedManualCases, openLinkedManualCase, canRemoveAutomationCase, deleteAutomationCase, confirmDelete, appTypeId, canViewTestData, detectedStepParameters, effectiveCaseDataSetId, mergedParameterValues, overrideSharedSteps, projectId, session, setIsParameterDialogOpen, setOverrideSharedSteps, setSelectedExecutionDataSetId, testDataSets, testDataSetsQuery, saveAutomationHooks, setExecutionHookDraft, suites, testCases, activeAgentBuildStatus, agentBriefScope, agentBuildStatus, agentBuildTracking, agentMission, agentPlanRefreshError, agentScheduledAt, allowBrowserActions, automationDraftStore, automationLlmIntegrationsQuery, automationRuntimeTypes, automationStartUrlRequired, automationStartUrlValidation, bindRecordingParameter, buildAgentSelection, buildBrowserLocation, buildSingleAutomation, buildVerificationMode, builderContext, canBuildCurrentPlan, canStartRecording, canUseMobileAppium, canVerifyBuild, cancelAutomationBuild, featureFlagsQuery, finishRecorder, handleAutomationAgentActivity, handleParameterValueChange, initialEngineerValues, latestAgentActivityRef, linkedManualCaseIds, linkedManualStepsQuery, mobileRemoteRecorderEnabled, navigate, openAutomationBuild, recorderParameterBindings, recorderParameterDefinitions, recorderPlatform, recorderStartOptions, recording, recordingTargetStepId, repositoryMemberCount, resolveParameterInputState, scheduleAiAutomation, searchParams, selectAutomationCase, selectedExecutionConfigurationId, selectedExecutionDataSetId, selectedExecutionEnvironmentId, setAgentMission, setAgentScheduledAt, setAllowBrowserActions, setAutomationStudioStep, setBuildAgentSelection, setBuildBrowserLocation, setBuildVerificationMode, setBuilderContext, setRecordingTargetStepId, setSearchParams, setSelectedExecutionConfigurationId, setSelectedExecutionEnvironmentId, setStartUrl, startRecorder, startUrl, visiblePrivateNames, showSuccess, refreshAutomationStepAfterSave, currentAutomationSelectionRef, queryClient, activeAutomationCaseType, allowedStepTypes, automationGherkin, automationStepGroups, automationStepView, canEditAutomationCode, caseSelection, completeAutomationCode, copyAutomationSections, deleteAutomationStep, expandedAutomationStepIds, exportContextError, exportContextLoading, exportSourceInvalid, exportSourceSnapshot, exportSteps, learningCache, openSectionGroupDialog, pasteAutomationSections, removeAutomationPlanStep, reorderAutomationStep, rephraseAutomationStep, resolvedParameterValues, retryExportContext, sectionClipboard, selectedAutomationStepIds, setApiSourceDrafts, setAutomationStepView, selectBuildMethod, setInputBindingStep, setIsAutomationCodePreviewOpen, setIsSharedGroupLibraryOpen, setStepCodeDrafts, setStepDrafts, setStepOptionDrafts, showError, syncAutomationStepDrafts, toggleAutomationStep, ungroupAutomationSteps, updateAutomationStep, updateAutomationStepCode, visibleInstructionIds, canEditAutomationSuiteLinks, saveAutomationSuiteLinks, caseRepositorySteps, runReviewRequest, retryRemoteAutomationStart, runReviewError, pendingRemoteRun, setRunReviewRequest, setRunReviewError, isBatchAgentOpen, setIsBatchAgentOpen, batchAgentDialogRef, batchBuildTargetIds, batchHasUrlRuntime, batchStartUrlRequired, setBatchStartUrl, batchStartUrl, batchStartUrlValidation, batchBuildReadinessQuery, sectionGroupDialog, automationGroupName, saveAutomationGroupAsShared, groupAutomationSteps, setAutomationGroupName, setSaveAutomationGroupAsShared, setSectionGroupDialog, isSharedGroupLibraryOpen, sharedStepGroupsQuery, sharedStepGroups, insertAutomationSharedGroup, automationStudioStep, saveAutomationStudioStep, isAutomationCodePreviewOpen, exportPreviewCode, inputBindingStep, effectiveCaseParameterValues, suiteParameterValues, isParameterDialogOpen, setPrivateCaseParameterDraft, caseParameterPrivacyScope, privateCaseParameterDraft, casePrivateNames, inheritedParameterDefaults, testCaseParameterValues, setParameterPreviewRevision, caseParameterOverrideDraftRef, setTestCaseParameterValues, activeCaseSuiteIds, selectedParameterSuiteId, setSelectedParameterSuiteId, parameterReviewDialog} = controller;
    
    
    
    
    return (<div className={`page-content page-content--automation${" page-content--workspace-focus"}`}>
      {confirmationDialog}
          {(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentSetup connection={inspectAgent}/> : null}
      <PageHeader className={"automation-cases-page-header" + (selectedCaseId ? " automation-detail-page-header" : "")} eyebrow={automationPageHeader.eyebrow} title={automationPageHeader.title} description={selectedCaseId ? undefined : automationPageHeader.description} actions={(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentStatus connection={inspectAgent}/> : undefined} meta={undefined}/>

      {<>
        {automationMetricsQuery.isError ? <div role="alert">Automation metrics could not be loaded. <button className="link-button" type="button" onClick={() => void automationMetricsQuery.refetch()}>Retry</button></div> : null}
        <QualityMetricStrip ariaLabel="Automation quality metrics" metrics={[
                { label: "Total test cases", value: automationMetrics?.total ?? "—", detail: "All automation cases in the selected application" },
                { label: "Recent pass rate", value: canViewExecutionMetrics && automationMetrics?.recentPassRate != null ? `${automationMetrics.recentPassRate}%` : "—", detail: !canViewExecutionMetrics ? "Run result access required" : automationMetrics?.finalizedResults ? `${automationMetrics.passedResults} of ${automationMetrics.finalizedResults} passed` : "No recent runs", tone: "success" },
                { label: "Failed cases", value: canViewExecutionMetrics ? automationMetrics?.failed ?? "—" : "—", detail: "Latest finalized outcome per case", tone: automationMetrics?.failed ? "danger" : "neutral" }
            ]}/>
      </>}
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone}/>

      {(<WorkspaceMasterDetail className="automation-cases-master-detail" isDetailOpen={true} browseView={null} detailView={(<Panel title="Automation case workspace" subtitle={activeCase
                    ? undefined
                    : selectedCaseSummary
                        ? `Loading complete details for ${selectedCaseSummary.title}.`
                        : "Select an automation case."} actions={selectedCaseId ? (<div className="testops-action-row automation-case-commandbar">
                <WorkspaceBackButton label="Back to automation case tiles" onClick={closeAutomationCaseWorkspace}/>
                {activeCase ? (<>
                  {canRunLocalAutomation ? <button className="primary-button" disabled={!isAutomationCaseDetailReady || runSelectedAutomationCases.isPending || activeCase.automated !== "yes" || Boolean(recorderSession)} onClick={() => requestAutomationRun("local", [activeCase.id])} type="button"><PlayIcon /><span>Run local</span></button> : null}
                  {canRunRemoteAutomation ? <button className="ghost-button" disabled={!isAutomationCaseDetailReady || runSelectedAutomationCases.isPending || activeCase.automated !== "yes" || Boolean(recorderSession)} onClick={() => requestAutomationRun("remote", [activeCase.id])} type="button"><PlayIcon /><span>Run remote</span></button> : null}
                  </>) : null}
              </div>) : undefined}>
            {!selectedCaseId ? (<div className="empty-state compact">Select a case tile to inspect its automation detail.</div>) : isAutomationCaseDetailPending ? (<LoadingState description="Retrieving complete metadata before enabling edits, test data, source export, and AI actions." label="Loading automation case details"/>) : !activeCase ? (<div className="empty-state compact">
                <div>Complete automation case details could not be loaded safely.</div>
                <button className="primary-button" onClick={() => void selectedAutomationCaseDetailQuery.refetch()} type="button">Retry details</button>
              </div>) : automatedStepsQuery.isLoading ? (<TileCardSkeletonGrid />) : (<div className="automation-case-detail editor-accordion">
                {unsavedAutomationStepIds.length ? <div className="automation-unsaved-state" role="status"><span>{unsavedAutomationStepIds.length} unsaved section{unsavedAutomationStepIds.length === 1 ? "" : "s"}</span><button className="ghost-button compact" onClick={() => selectAutomationWorkspaceTab("steps")} type="button">Review changes</button></div> : null}
                <div className="automation-workspace-navigation">
                  <div className="automation-workspace-identity">
                    <div>
                      <DisplayIdBadge value={automationDisplayIdByCaseId[activeCase.id] || activeCase.display_id || activeCase.id}/>
                      <strong className="automation-case-title">{activeCase.title}</strong>
                    </div>
                  </div>
                  <DetailSectionTabs activeTab={activeAutomationWorkspaceTab} ariaLabel="Automation case sections" className="automation-detail-navigation" presentation="inline" items={[
                        { value: "details", label: "Details", description: "Metadata & links", icon: <PencilIcon /> },
                        { value: "steps", label: "Plan", description: "Actions & results", icon: <SelectionToggleIcon checked={false}/>, count: automatedSteps.length },
                        { value: "data", label: "Test Data", description: "Params & profiles", icon: <TileCardStepsIcon />, count: automationDataTokens.length },
                        { value: "hooks", label: "Before / After", description: "Setup & teardown", icon: <LayersIcon />, count: executionHookDraft.length },
                        ...(canUseAutomationAi || canRecordCurrentPlan ? [{ value: "build" as const, label: "Build tools", description: "Agent & recorder", icon: <SparkIcon /> }] : []),
                        ...(canViewObjectRepository ? [{ value: "repository" as const, label: "Objects", description: "Repository bindings", icon: <IconTargetArrow />, count: canViewAutomationCode ? caseObjectBindingCount : undefined }] : []),
                        { value: "suites", label: "Suites", description: "Collection links", icon: <TileCardSuiteIcon />, count: suiteLinkDraftIds.length },
                        { value: "defects", label: "Defects", description: "Failure traceability", icon: <BugIcon />, count: activeCase.defect_ids?.length || 0 },
                        { value: "runs", label: "Runs", description: "Execution outcomes", icon: <PlayIcon />, count: selectedCaseHistoryQuery.data ? activeCaseHistory.length : undefined },
                        { value: "history", label: "History", description: "Version history", icon: <TileCardStepsIcon /> }
                    ]} onChange={selectAutomationWorkspaceTab}/>
                </div>
                {activeAutomationWorkspaceTab === "details" ? (<section className="automation-plan-workspace" aria-label="Automation case details">
                    <AutomationCaseMetadata {...metadataOptions} disabled={!canUpdateAutomationCase || updateAutomationCase.isPending} value={{ automationCaseType: caseDraft.automationCaseType, title: caseDraft.title, description: caseDraft.description, status: caseDraft.status, priority: caseDraft.priority, manualCaseIds: automationManualLinkDraftIds, requirementIds: caseRequirementIds, moduleIds: caseModuleIds, suiteIds: suiteLinkDraftIds, dataSetId: caseDataSetId }} onChange={(change) => {
                            setCaseDraft((current) => ({ ...current, ...Object.fromEntries(Object.entries(change).filter(([key]) => ["title", "description", "status", "priority", "automationCaseType"].includes(key))) }));
                            if (change.manualCaseIds)
                                setAutomationManualLinkDraftIds(change.manualCaseIds);
                            if (change.requirementIds)
                                setCaseRequirementIds(change.requirementIds);
                            if (change.moduleIds)
                                setCaseModuleIds(change.moduleIds);
                            if (change.suiteIds)
                                setSuiteLinkDraftIds(change.suiteIds);
                            if (change.dataSetId !== undefined)
                                setCaseDataSetId(change.dataSetId);
                        }}/>
                    {detailIncompatibleRuntimes.length ? <p role="alert">This plan contains {detailIncompatibleRuntimes.join(", ")} steps. Choose a compatible case type or update the plan before saving.</p> : null}
                    <div className="automation-plan-actions">
                      {canUpdateAutomationCase ? (<button className="primary-button" disabled={!caseDraft.title.trim() || !caseDraft.automationCaseType || Boolean(detailIncompatibleRuntimes.length) || updateAutomationCase.isPending} onClick={() => updateAutomationCase.mutate()} type="button">{updateAutomationCase.isPending ? "Saving…" : "Save details"}</button>) : null}
                      {linkedManualCases.map((source) => <button className="ghost-button compact" key={source.id} onClick={() => openLinkedManualCase(activeCase, source.id)} type="button"><OpenIcon size={14}/>{source.display_id || source.title}</button>)}
                      {canRemoveAutomationCase ? (<button className="ghost-button compact danger" disabled={deleteAutomationCase.isPending} onClick={async () => {
                                if (await confirmDelete({ message: `Delete automation case "${activeCase.title}"? Linked manual cases and historical run evidence remain available.`, confirmLabel: "Delete automation case" }))
                                    deleteAutomationCase.mutate(activeCase);
                            }} type="button">Remove automation case</button>) : null}
                    </div>
                  </section>) : null}
                {activeAutomationWorkspaceTab === "data" ? <div className="detail-section-panel" role="tabpanel"><AutomationCaseData {...{activeCase, appTypeId, canUpdateAutomationCase, canViewTestData, caseDataSetId, detectedStepParameters, effectiveCaseDataSetId, mergedParameterValues, overrideSharedSteps, projectId, session, setCaseDataSetId, setIsParameterDialogOpen, setOverrideSharedSteps, setSelectedExecutionDataSetId, testDataSets, testDataSetsQuery}} expanded valuesOnly /></div> : null}
                {activeAutomationWorkspaceTab === "hooks" ? <div className="detail-section-panel" role="tabpanel">
                  <section className="automation-run-hooks-panel">
                    <p className="muted">Save setup and teardown cases for this automation case. Direct, suite and scheduled runs use these saved selections. A manual source uses its linked automation case.</p>
                    <button type="button" className="ghost-button compact" disabled={!canUpdateAutomationCase || saveAutomationHooks.isPending || !isAutomationCaseDetailReady} onClick={() => saveAutomationHooks.mutate()}>{saveAutomationHooks.isPending ? "Saving…" : "Save Before / After"}</button>
                    <RunHooksBuilder onChange={setExecutionHookDraft} suites={suites} testCases={testCases.filter(item => item.id !== activeCase.id)} value={executionHookDraft}/>
                  </section>
                </div> : null}

                {activeAutomationWorkspaceTab === "build" && (canUseAutomationAi || canRecordCurrentPlan) ? <AutomationCaseBuild {...{authoringNotice,activeAgentBuildStatus, activeCase, agentBriefScope, agentBuildStatus, agentBuildTracking, agentMission, agentPlanRefreshError, agentScheduledAt, allowBrowserActions, appTypeId, automatedSteps, automationDraftStore, automationLlmIntegrationsQuery, automationRuntimeTypes, automationStartUrlRequired, automationStartUrlValidation, bindRecordingParameter, buildAgentSelection, buildBrowserLocation, buildSingleAutomation, buildVerificationMode, builderContext, canBuildCurrentPlan, canRecordCurrentPlan, canStartRecording, canUseAutomationAi, canUseAutomationBuilder, canUseMobileAppium, canVerifyBuild, cancelAutomationBuild, detectedStepParameters, featureFlagsQuery, finishRecorder, handleAutomationAgentActivity, handleParameterValueChange, initialEngineerValues, latestAgentActivityRef, linkedManualCaseIds, linkedManualCases, linkedManualStepsQuery, mergedParameterValues, mobileRemoteRecorderEnabled, navigate, openAutomationBuild, projectId, recorderParameterBindings, recorderParameterDefinitions, recorderPlatform, recorderSession, recorderStartOptions, recording, recordingTargetStepId, repositoryMemberCount, resolveParameterInputState, scheduleAiAutomation, searchParams, selectAutomationCase, selectAutomationWorkspaceTab, selectedExecutionConfigurationId, selectedExecutionDataSetId, selectedExecutionEnvironmentId, session, setAgentMission, setAgentScheduledAt, setAllowBrowserActions, setAutomationStudioStep, setBuildAgentSelection, setBuildBrowserLocation, setBuildVerificationMode, setBuilderContext, setIsParameterDialogOpen, setRecordingTargetStepId, setSearchParams, setSelectedExecutionConfigurationId, setSelectedExecutionDataSetId, setSelectedExecutionEnvironmentId, setStartUrl, startRecorder, startUrl, visiblePrivateNames}} /> : null}
                {activeAutomationWorkspaceTab === "steps" ? <AutomationCaseSteps {...{showSuccess, refreshAutomationStepAfterSave, currentAutomationSelectionRef, queryClient, activeAutomationCaseType, activeCase, allowedStepTypes, appTypeId, automatedSteps, automatedStepsQuery, automationDraftStore, automationGherkin, automationStepGroups, automationStepView, canEditAutomationCode, canUpdateAutomationCase, canUseAutomationAi, canUseMobileAppium, canUseRecorder, canViewAutomationCode, canViewTestData, caseDataSetId, caseDraft, caseSelection, completeAutomationCode, copyAutomationSections, deleteAutomationStep, detectedStepParameters, effectiveCaseDataSetId, expandedAutomationStepIds, exportContextError, exportContextLoading, exportSourceInvalid, exportSourceSnapshot, exportSteps, learningCache, linkedManualCases, mergedParameterValues, openSectionGroupDialog, overrideSharedSteps, pasteAutomationSections, projectId, recorderSession, removeAutomationPlanStep, reorderAutomationStep, rephraseAutomationStep, resolvedParameterValues, retryExportContext, sectionClipboard, selectAutomationWorkspaceTab, selectedAutomationStepIds, session, setApiSourceDrafts, setAutomationStepView, setAutomationStudioStep, selectBuildMethod, setCaseDataSetId, setInputBindingStep, setIsAutomationCodePreviewOpen, setIsParameterDialogOpen, setIsSharedGroupLibraryOpen, setOverrideSharedSteps, setRecordingTargetStepId, setSelectedExecutionDataSetId, setStepCodeDrafts, setStepDrafts, setStepOptionDrafts, showError, startRecorder, syncAutomationStepDrafts, testDataSets, testDataSetsQuery, toggleAutomationStep, ungroupAutomationSteps, updateAutomationCase, updateAutomationStep, updateAutomationStepCode, visibleInstructionIds}} /> : null}
                {activeAutomationWorkspaceTab === "suites" ? <div className="detail-section-panel requirement-detail-wide-panel" role="tabpanel">
                  <RelatedWorkItemsPanel key={activeCase.id} ariaLabel="Linked Suites" title="Linked Suites" eyebrow="Traceability" description="Organize this automation case in reusable Suites." items={suiteLinkDraftIds.map(id => { const suite = suites.find(item => item.id === id); return { id, displayId: suite?.display_id, title: suite?.name || id, description: richTextToPlainText(suite?.description || ""), relation: "included in", icon: <TileCardSuiteIcon />, canUnlink: canEditAutomationSuiteLinks, onOpen: () => navigate(`/design?suite=${encodeURIComponent(id)}`) }; })} linking={canEditAutomationSuiteLinks ? { scopeKey: `automation-suites:${projectId}:${activeCase.id}`, loadCandidates: async () => ({ items: asArray(await api.testSuites.list({ app_type_id: appTypeId })).map(suite => ({ id: suite.id, displayId: suite.display_id, title: suite.name, relation: "included in", icon: <TileCardSuiteIcon /> })) }), onLink: async (suite) => { await saveAutomationSuiteLinks([...new Set([...suiteLinkDraftIds, suite.id])]); } } : undefined} onUnlink={canEditAutomationSuiteLinks ? async (suite) => { await saveAutomationSuiteLinks(suiteLinkDraftIds.filter(id => id !== suite.id)); } : undefined}/>
                </div> : null}
                {activeAutomationWorkspaceTab === "defects" ? <div className="detail-section-panel" role="tabpanel"><LinkedDefectsPanel canUpdate={canUpdateAutomationCase} itemId={activeCase.id} projectId={projectId} subject="test-case" onSaved={() => void queryClient.invalidateQueries({ queryKey: automationCaseDetailQueryKey(projectId, activeCase.id), exact: true })}/></div> : null}
                {activeAutomationWorkspaceTab === "repository" && canViewObjectRepository ? <Suspense fallback={<LoadingState label="Loading object repository"/>}><AutomationCaseObjectsWorkspace projectId={projectId} appTypeId={appTypeId} caseId={activeCase.id} steps={caseRepositorySteps} parameterValues={resolvedParameterValues} sourceAccess={canViewAutomationCode}/></Suspense> : null}

                {activeAutomationWorkspaceTab === "runs" ? <AutomationCaseRuns {...{activeCase, appTypeId, automationLlmIntegrationsQuery, canUseAutomationAi, featureFlagsQuery, projectId, session}} /> : null}
                {activeAutomationWorkspaceTab === "history" ? <div className="detail-section-panel" role="tabpanel">
                  <TestCaseVersionHistory canRestore={canUseAutomationBuilder} currentCase={activeCase} currentSteps={automatedSteps} key={activeCase.id}/>
                </div> : null}
              </div>)}
          </Panel>)}/>)}

	      {null}

      {runReviewRequest ? <AutomationRunReviewDialog request={runReviewRequest} unsavedStepIds={unsavedAutomationStepIds} verifySource={canViewAutomationCode} busy={runSelectedAutomationCases.isPending || retryRemoteAutomationStart.isPending} error={runReviewError} pendingRunId={pendingRemoteRun?.id} retryAllowed={pendingRemoteRun?.retryAllowed} executionProfile={<ExecutionContextSelector appTypeId={runReviewRequest.appTypeId} projectId={runReviewRequest.projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/>} onClose={() => setRunReviewRequest(null)} onOpenCase={id => { setRunReviewRequest(null); selectAutomationCase(id); }} onRun={reviewed => { setRunReviewError(""); runSelectedAutomationCases.mutate({ request: runReviewRequest, reviewed }); }} onRetryStart={() => { setRunReviewError(""); retryRemoteAutomationStart.mutate(); }} onOpenRun={() => {
                if (pendingRemoteRun)
                    navigate(`/executions?view=${pendingRemoteRun.mode === "local" ? "local-runs" : "suite-runs"}&execution=${pendingRemoteRun.id}`);
                setRunReviewRequest(null);
            }}/> : null}
      {isBatchAgentOpen ? <div className="modal-backdrop" onClick={() => {
                if (!scheduleAiAutomation.isPending)
                    setIsBatchAgentOpen(false);
            }}>
        <div aria-label="Build with automation agent" aria-modal="true" className="modal-card resource-modal-card automation-batch-agent-dialog" onClick={(event) => event.stopPropagation()} ref={batchAgentDialogRef} role="dialog" tabIndex={-1}>
          <div className="modal-header"><div><h2>Build with automation agent</h2><p>{batchBuildTargetIds.length} selected cases · Saved plans are checked before building.</p></div><DialogCloseButton disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)}/></div>
          <div className="resource-form"><div className="resource-form-body automation-agent-brief">
            <label className="form-field"><span>Build instructions (optional)</span><textarea aria-label="Build instructions (optional)" onChange={(event) => setAgentMission(event.target.value)} rows={4} value={agentMission} placeholder="Each agent uses its case’s saved plan. Add instructions that apply to all selected cases."/></label>
            <div className="automation-plan-behavior-fields">{batchHasUrlRuntime ? <label className="form-field"><span>Start URL{batchStartUrlRequired ? " (required)" : " (optional)"}</span><input aria-label="Build start URL" type="url" required={batchStartUrlRequired} onChange={(event) => setBatchStartUrl(event.target.value)} placeholder="https://your-application.example.com" value={batchStartUrl}/><small className="muted">{batchStartUrlRequired ? "Review the application URL for this build, including retries." : "API-only plans may use their configured request URLs."}</small>{batchStartUrl.trim() && batchStartUrlValidation ? <small role="alert">{batchStartUrlValidation}</small> : null}</label> : null}<label className="form-field"><span>Build time</span><input onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt}/><small className="muted">Leave empty to queue now.</small></label></div>
            <details><summary>Additional guidance & execution context</summary><div className="stack-list"><AiLlmSelect integrations={asArray(automationLlmIntegrationsQuery.data)} value={buildAgentSelection.integrationId} onChange={integrationId => setBuildAgentSelection(current => ({ ...current, integrationId }))} disabled={scheduleAiAutomation.isPending} scopeKey={projectId}/><label className="form-field"><span>Guidance</span><textarea onChange={(event) => setBuilderContext(event.target.value)} rows={3} value={builderContext}/></label><ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/></div></details>
            {batchStartUrlRequired ? <AutomationBrowserBuildMode location={buildBrowserLocation} onLocationChange={setBuildBrowserLocation} interactive={allowBrowserActions} onChange={setAllowBrowserActions} disabled={scheduleAiAutomation.isPending}/> : null}
                      <AutomationBuildVerificationSettings mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} disabled={buildSingleAutomation.isPending || scheduleAiAutomation.isPending || false || activeAgentBuildStatus === "queued" || activeAgentBuildStatus === "running"}/>
            <p className="muted">Each build includes its saved steps, expected results, accessible stories, reusable objects and selected execution context.</p>
            <section className="automation-batch-readiness" aria-label="Selected build plans">
              {batchBuildReadinessQuery.isPending ? <p role="status">Checking saved behavior…</p> : null}
              {batchBuildReadinessQuery.isError ? <div role="alert"><p>{batchBuildReadinessQuery.error instanceof Error ? batchBuildReadinessQuery.error.message : "Saved plans could not be checked."}</p><button className="ghost-button compact" type="button" onClick={() => void batchBuildReadinessQuery.refetch()}>Recheck plans</button></div> : null}
              {batchBuildReadinessQuery.data?.map(result => <div key={result.id}><strong>{result.title}</strong><span>{result.stepCount} steps · {result.ready ? result.stepCount ? "Ready to build" : "Plan from instructions" : "Needs attention"}</span>{result.issues.filter(issue => issue.severity === "blocker").map((issue, index) => <p className="automation-validation-error" key={index}>{issue.order ? `Step ${issue.order} · ` : ""}{issue.message}</p>)}</div>)}
            </section>
          </div><div className="modal-footer"><button className="ghost-button" disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)} type="button">Cancel</button>{canUseAutomationAi ? (<button className="primary-button" disabled={!batchBuildTargetIds.length || !canUseAutomationAi || scheduleAiAutomation.isPending || Boolean(batchStartUrlValidation) || batchBuildReadinessQuery.isPending || batchBuildReadinessQuery.isError || Boolean(batchBuildReadinessQuery.data?.some(result => !result.ready))} onClick={() => scheduleAiAutomation.mutate()} type="button"><SparkIcon />{scheduleAiAutomation.isPending ? "Queueing…" : agentScheduledAt ? "Schedule builds" : "Build selected cases"}</button>) : null}</div></div>
        </div>
      </div> : null}

      {null}

      {sectionGroupDialog ? <AutomationSectionGroupDialog review={sectionGroupDialog} sections={automatedSteps.filter(step => sectionGroupDialog.stepIds.includes(step.id))} name={automationGroupName} shared={saveAutomationGroupAsShared} busy={groupAutomationSteps.isPending || ungroupAutomationSteps.isPending} canCreateShared={hasPermission(session, "shared_step.manage", projectId)} error={(groupAutomationSteps.error || ungroupAutomationSteps.error) instanceof Error ? (groupAutomationSteps.error || ungroupAutomationSteps.error as Error)?.message : undefined} parameterValues={mergedParameterValues} onNameChange={setAutomationGroupName} onSharedChange={setSaveAutomationGroupAsShared} onClose={() => setSectionGroupDialog(null)} onSave={() => sectionGroupDialog.mode === "ungroup" ? ungroupAutomationSteps.mutate(sectionGroupDialog.groupId as string) : groupAutomationSteps.mutate()}/> : null}
      {isSharedGroupLibraryOpen ? (<div className="modal-backdrop modal-backdrop--scroll" onClick={() => setIsSharedGroupLibraryOpen(false)} role="presentation">
          <div aria-modal="true" className="modal-card resource-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Shared Section Groups">
            <div className="resource-modal-header"><div className="resource-modal-title"><h2 className="dialog-title">Insert Shared Section Group</h2><p>Shared Section Groups retain their keyword code and stay traceable to the Shared Section Group library.</p></div><button className="ghost-button compact" onClick={() => setIsSharedGroupLibraryOpen(false)} type="button">Close</button></div>
            <div className="resource-form"><div className="resource-form-body stack-list">
              {sharedStepGroupsQuery.isLoading ? <LoadingState label="Loading Shared Section Groups"/> : null}
              {!sharedStepGroupsQuery.isLoading && !sharedStepGroups.length ? <div className="empty-state compact">No Shared Section Groups exist for this application yet. Select steps and save the selection as a Shared Section Group to create one.</div> : null}
              {sharedStepGroups.map((group) => (<button className="stack-item" disabled={insertAutomationSharedGroup.isPending} key={group.id} onClick={() => insertAutomationSharedGroup.mutate(group.id)} type="button">
                  <div><strong>{group.name}</strong><span>{group.steps?.length || 0} reusable step{group.steps?.length === 1 ? "" : "s"}</span></div><AddIcon />
                </button>))}
            </div></div>
          </div>
        </div>) : null}

      {automationStudioStep ? (<StepAutomationDialog availableParameters={detectedStepParameters} getParameterScopeState={resolveParameterInputState} objectRepository={learningCache} onClose={() => setAutomationStudioStep(null)} onSave={(input) => saveAutomationStudioStep.mutate({ step: automationStudioStep, input })} onSaveResponseValue={handleParameterValueChange} parameterValues={mergedParameterValues} step={automationStudioStep} subtitle="Configure this step’s keywords, repository fields, and data. Expand request settings for API details." title={`Step ${automationStudioStep.step_order || 1} automation studio`}/>) : null}

      {isAutomationCodePreviewOpen && activeCase ? (<CodePreviewDialog code={exportPreviewCode} copyDisabled={exportContextLoading || exportContextError || exportSourceInvalid} onRetry={exportContextError ? retryExportContext : undefined} objectRepository={learningCache} onClose={() => setIsAutomationCodePreviewOpen(false)} showMappings={false} subtitle="Save as automation.spec.ts and run with Playwright. Data rows and repository locators are included; supply private or missing run values through QAIRA_DATA_JSON." title={`${activeCase.display_id || activeCase.id} automation code`}/>) : null}

      {inputBindingStep && inputBindingStep.test_case_id === activeCase?.id && canEditAutomationCode && canViewTestData ? <AutomationInputBindingDialog key={inputBindingStep.id} step={inputBindingStep} parameters={recorderParameterDefinitions} values={combineStepParameterValues(effectiveCaseParameterValues, suiteParameterValues)} privateNames={visiblePrivateNames} onClose={() => setInputBindingStep(null)} onApply={selections => {
                try {
                    const current = automatedSteps.find(step => step.id === inputBindingStep.id);
                    if (!current || current.step_type !== inputBindingStep.step_type || canonicalizeSavedLocatorWrappers(automationDraftStore.read("code")[current.id] ?? current.automation_code ?? "").source !== inputBindingStep.automation_code
                        || JSON.stringify(current.step_type === "api" && automationDraftStore.read("api")[current.id] !== undefined ? parseApiRequestSource(automationDraftStore.read("api")[current.id]) : current.api_request) !== JSON.stringify(inputBindingStep.api_request))
                        throw new Error("This section changed. Reopen parameter bindings and review its current inputs.");
                    const next = applyAutomationInputBindings(inputBindingStep, selections);
                    if (next.step_type === "api")
                        setApiSourceDrafts(drafts => ({ ...drafts, [next.id]: JSON.stringify(next.api_request, null, 2) }));
                    else
                        setStepCodeDrafts(drafts => ({ ...drafts, [next.id]: next.automation_code || "" }));
                    caseSelection.showInstruction(next.id);
                    caseSelection.expandSteps([next.id]);
                    setInputBindingStep(null);
                    showSuccess("Parameter bindings are ready. Save the section to apply them.");
                }
                catch (error) {
                    showError(error, "Unable to bind these inputs.");
                }
            }}/> : null}

      {isParameterDialogOpen ? (<StepParameterDialog key={activeCase?.id || selectedCaseId} allowSensitiveValueOverrides onSecretChange={(name, secret) => setPrivateCaseParameterDraft(current => ({ scope: caseParameterPrivacyScope,
                names: [...new Set([...(current.scope === caseParameterPrivacyScope ? current.names.filter(item => item !== name) : []), ...(secret ? [name] : [])])].sort()
            }))} getSecretState={parameter => {
                const derived = visiblePrivateNames.has(parameter.name) && !(privateCaseParameterDraft.scope === caseParameterPrivacyScope && privateCaseParameterDraft.names.includes(parameter.name));
                return { disabled: !canUpdateAutomationCase || !canViewTestData || isPrivateParameterName(parameter.name) || casePrivateNames.includes(parameter.name) || derived,
                    hint: casePrivateNames.includes(parameter.name) || isPrivateParameterName(parameter.name) ? "This saved private value remains protected." : derived ? "This value is protected by its source or another secret parameter with the same value." : "Hide this value in this automation case and its previews." };
            }} defaultValues={inheritedParameterDefaults} inheritedParameterNames={[...Object.keys(inheritedParameterDefaults), ...buildDataSetParameterDefinitions(testDataSets.find(item => item.id === effectiveCaseDataSetId)).map(parameter => parameter.name)]} overrideValues={testCaseParameterValues} previewValues={resolvedParameterValues} onRefreshPreviews={() => setParameterPreviewRevision(value => value + 1)} onReset={name => {
                if (caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope)
                    caseParameterOverrideDraftRef.current.names.delete(name);
                setTestCaseParameterValues(current => { const next = { ...current }; delete next[name]; return next; });
            }} getInputState={(parameter) => resolveParameterInputState(parameter.scope)} headerContent={(<div className="step-parameter-dialog-context">
              <div className="step-parameter-dialog-context-card">
                <strong>Automation test data</strong>
                <span>Linked manual test values supply the defaults. `@t` and `@r` changes save on this automation case; resetting an override restores its inherited value. `@s` saves on the selected suite. Explicit run values can replace case defaults.</span>
              </div>
              {activeCaseSuiteIds.length ? (<div className="step-parameter-dialog-context-card">
                  <strong>Suite target</strong>
                  {!selectedParameterSuiteId && activeCaseSuiteIds.length > 1 ? <span>Select the suite whose values this build should use. Different suite defaults require an explicit choice.</span> : null}
                  <div className="selection-chip-row">
                    {activeCaseSuiteIds.map((suiteId) => {
                        const suite = suites.find((item) => item.id === suiteId);
                        return (<button className={suiteId === selectedParameterSuiteId ? "selection-chip is-selected" : "selection-chip is-unselected"} disabled={Boolean(recorderSession)} key={suiteId} onClick={() => setSelectedParameterSuiteId(suiteId)} type="button">
                          {suite?.name || suiteId}
                        </button>);
                    })}
                  </div>
                </div>) : null}
            </div>)} onChange={handleParameterValueChange} onClose={() => setIsParameterDialogOpen(false)} parameters={detectedStepParameters} subtitle="Use the same @t, @s, and @r data scopes as manual test cases." title="Automation case parameter values" values={mergedParameterValues}/>) : null}
      {parameterReviewDialog}

      {null}
    </div>);
}
