import { ApiAutomationSourceIntake } from "../../components/ApiAutomationSourceIntake";
import { AutomationBuildVerificationSettings } from "../../components/AutomationBuildVerificationSettings";
import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { AutomationOverlay } from "../../components/AutomationOverlay";
import { AutomationBrowserBuildMode } from "../../components/AutomationBrowserBuildMode";
import { AutomationRunReviewDialog } from "../../components/AutomationRunReviewDialog";
import "../../components/AutomationWorkspace.css";
import { getDefaultAutomationStepType } from "../../lib/automationRuntime";
import { IconSettings } from "@tabler/icons-react";
import { AddIcon, MousePointerIcon, OpenIcon, PencilIcon, PlayIcon, SparkIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogCardDescription } from "@hellotest/platform/frontend/src/shared/components/CatalogCardDescription";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { DataTable } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { ExecutionContextSelector } from "@hellotest/testing/frontend/components/ExecutionContextSelector";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { RepositoryAgentSetup, RepositoryAgentStatus } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { RichTextContent, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { AutomationCaseMetadata, AutomationDraftPlan } from "../../components/AutomationCaseMetadata";
import { isAutomationPrecondition } from "../../lib/automationPlan";
import { TileCardCaseIcon, TileCardFact, TileCardIconFrame, TileCardProgress, TileCardRunsIcon, TileCardStepsIcon, getTileCardTone } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileBrowserPane } from "@hellotest/platform/frontend/src/shared/components/TileBrowserPane";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { buildHistoryStatusBreakdown } from "@hellotest/platform/frontend/src/shared/lib/tileProgressBreakdown";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { AutomationCasesController } from './useAutomationCasesController';
export function AutomationCasesView({controller}:{controller:AutomationCasesController}){
const {
    authoring,
    confirmationDialog,
    canInspectRepository,
    canUseRecorder,
    canRunLocalAutomation,
    canUseAutomationBuilder,
    inspectAgent,
    automationPageHeader,
    automationMetricsQuery,
    automationMetrics,
    canViewExecutionMetrics,
    message,
    setMessage,
    messageTone,
    setAutomationCatalogViewMode,
    automationCatalogViewMode,
    activeAutomationCaseSearchCount,
    setAutomationCaseSearch,
    automationCaseSearch,
    areAllFilteredAutomationCasesSelected,
    filteredAutomationCases,
    setSelectedAutomationCaseIds,
    selectedAutomationCaseIds,
    automationActionTargetIds,
    canDeleteAutomationCases,
    deleteSelectedAutomationCases,
    confirmDelete,
    canUseAutomationAi,
    appTypeId,
    scheduleAiAutomation,
    openAutomationBuild,
    projectId,
    runSelectedAutomationCases,
    requestAutomationRun,
    canRunRemoteAutomation,
    canCreateAutomationDraft,
    setIsCreateAutomationOpen,
    testCasesQuery,
    executionResultsQuery,
    automatedCases,
    session,
    featureFlagsQuery,
    navigate,
    historyByCaseId,
    selectAutomationCase,
    automationDisplayIdByCaseId,
    automationCaseListColumns,
    isExecutionContextOpen,
    setIsExecutionContextOpen,
    setSelectedExecutionConfigurationId,
    setSelectedExecutionDataSetId,
    setSelectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    selectedExecutionDataSetId,
    selectedExecutionEnvironmentId,
    runReviewRequest,
    canViewAutomationCode,
    retryRemoteAutomationStart,
    runReviewError,
    pendingRemoteRun,
    setRunReviewRequest,
    setRunReviewError,
    isBatchAgentOpen,
    setIsBatchAgentOpen,
    batchAgentDialogRef,
    batchBuildTargetIds,
    setAgentMission,
    agentMission,
    batchHasUrlRuntime,
    batchStartUrlRequired,
    setBatchStartUrl,
    batchStartUrl,
    batchStartUrlValidation,
    setAgentScheduledAt,
    agentScheduledAt,
    automationLlmIntegrationsQuery,
    buildAgentSelection,
    setBuildAgentSelection,
    setBuilderContext,
    builderContext,
    buildBrowserLocation,
    setBuildBrowserLocation,
    allowBrowserActions,
    setAllowBrowserActions,
    buildVerificationMode,
    setBuildVerificationMode,
    canVerifyBuild,
    createAutomationCase,
    batchBuildReadinessQuery,
    isCreateAutomationOpen,
    closeCreateAutomation,
    createAutomationDialogRef,
    metadataOptions,
    updateAutomationCreateMetadata,
    automationCreateMetadata,
    automationCreateManualCaseIds,
    automationCreationMode,
    setAutomationCreationMode,
    canRecordCreation,
    automationCreateRuntimeTypes,
    automationCreateStartUrlRequired,
    setAutomationCreateStartUrl,
    automationCreateStartUrl,
    automationCreateStartUrlValidation,
    importedApiPlanReady,
    automationCreateSteps,
    createSourcesQuery,
    creationIncompatibleRuntimes,
    creationAllowedStepTypes,
    applyApiSourceDraft,
    automationCreateParameters,
    setAutomationCreateSteps,
    canCreateAutomationCase,
    parameterReviewDialog,
}=controller;
const selectionBusy=automationActionTargetIds.some(id=>authoring.caseState(id).phase!=='idle');
const batchBusy=batchBuildTargetIds.some(id=>authoring.caseState(id).phase!=='idle');
return (<div className={`page-content page-content--automation${""}`}>
      {confirmationDialog}
          {(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentSetup connection={inspectAgent}/> : null}
      <PageHeader className={"automation-cases-page-header" + ("")} eyebrow={automationPageHeader.eyebrow} title={automationPageHeader.title} description={automationPageHeader.description} actions={(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentStatus connection={inspectAgent}/> : undefined} meta={undefined}/>

      {<>
        {automationMetricsQuery.isError ? <div role="alert">Automation metrics could not be loaded. <button className="link-button" type="button" onClick={() => void automationMetricsQuery.refetch()}>Retry</button></div> : null}
        <QualityMetricStrip ariaLabel="Automation quality metrics" metrics={[
            { label: "Total test cases", value: automationMetrics?.total ?? "—", detail: "All automation cases in the selected application" },
            { label: "Recent pass rate", value: canViewExecutionMetrics && automationMetrics?.recentPassRate != null ? `${automationMetrics.recentPassRate}%` : "—", detail: !canViewExecutionMetrics ? "Run result access required" : automationMetrics?.finalizedResults ? `${automationMetrics.passedResults} of ${automationMetrics.finalizedResults} passed` : "No recent runs", tone: "success" },
            { label: "Failed cases", value: canViewExecutionMetrics ? automationMetrics?.failed ?? "—" : "—", detail: "Latest finalized outcome per case", tone: automationMetrics?.failed ? "danger" : "neutral" }
        ]}/>
      </>}
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone}/>

      {(<WorkspaceMasterDetail className="automation-cases-master-detail" isDetailOpen={false} browseView={(<Panel title="Automation cases" subtitle="Your executable plans and their latest outcomes." actions={(<div className="design-list-toolbar catalog-command-toolbar automation-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Automation case views, search, and selection">
                  <CatalogViewToggle onChange={setAutomationCatalogViewMode} value={automationCatalogViewMode}/>
                  <CatalogSearchFilter activeFilterCount={activeAutomationCaseSearchCount} ariaLabel="Search automation cases" onChange={setAutomationCaseSearch} placeholder="Search automation cases" subtitle="Search automation cases by title, ID, state, priority, or recent run count." title="Automation search" type="search" value={automationCaseSearch}>
                    <div className="catalog-filter-grid">
                      <div className="catalog-filter-actions">
                        <button className="ghost-button" disabled={!automationCaseSearch.trim()} onClick={() => setAutomationCaseSearch("")} type="button">
                          Clear search
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls allSelected={areAllFilteredAutomationCasesSelected} canSelectAll={Boolean(filteredAutomationCases.length)} onClear={() => setSelectedAutomationCaseIds([])} onSelectAll={() => setSelectedAutomationCaseIds((current) => [...new Set([...current, ...filteredAutomationCases.map((testCase) => testCase.id)])])} selectedCount={selectedAutomationCaseIds.length}/>
                </div>
                <div className="catalog-toolbar-actions" aria-label="Automation case actions">
                  {automationActionTargetIds.length ? <>
                  {canDeleteAutomationCases ? <button className="ghost-button danger" type="button" disabled={deleteSelectedAutomationCases.isPending} onClick={async () => {
                            const ids = [...automationActionTargetIds];
                            if (await confirmDelete({ message: `Delete ${ids.length} selected automation case${ids.length === 1 ? "" : "s"}? This removes their manual-case links and automation coverage. Manual cases, reusable assets and historical run evidence are preserved.`, confirmLabel: "Delete automation cases" }))
                                deleteSelectedAutomationCases.mutate(ids);
                        }}><TrashIcon /><span>{deleteSelectedAutomationCases.isPending ? "Deleting…" : "Delete selected"}</span></button> : null}
                  {canUseAutomationAi ? (<button className="ghost-button automation-ai-catalog-action" disabled={selectionBusy || !automationActionTargetIds.length || !appTypeId || !canUseAutomationBuilder || !canUseAutomationAi || scheduleAiAutomation.isPending} onClick={() => openAutomationBuild([...automationActionTargetIds])} title="Review the agent brief, then build now or choose a scheduled time" type="button"><SparkIcon /><span>Build with automation agent</span></button>) : null}
                  {canRunLocalAutomation ? (<button className="ghost-button catalog-run-button" disabled={!automationActionTargetIds.length || !canRunLocalAutomation || !projectId || !appTypeId || runSelectedAutomationCases.isPending} onClick={() => requestAutomationRun("local", automationActionTargetIds)} title={!automationActionTargetIds.length ? "Select an automation case to run" : "Run selected automation locally"} type="button">
                    <PlayIcon />
                    <span>Run local</span>
                  </button>) : null}
                  {canRunRemoteAutomation ? (<button className="ghost-button catalog-run-button" disabled={!automationActionTargetIds.length || !canRunRemoteAutomation || !projectId || !appTypeId || runSelectedAutomationCases.isPending} onClick={() => requestAutomationRun("remote", automationActionTargetIds)} title={!automationActionTargetIds.length ? "Select an automation case to run" : "Run selected automation remotely"} aria-label="Run remote" type="button">
                    <PlayIcon />
                    <span>Run remote</span>
                  </button>) : null}
                  </> : null}
                  {canCreateAutomationDraft ? <button className="primary-button automation-choose-manual-toolbar-button" disabled={!appTypeId} onClick={() => setIsCreateAutomationOpen(true)} type="button">
                    <AddIcon />
                    <span>Create automation case</span>
                  </button> : null}
                </div>
              </div>)}>
            {testCasesQuery.isLoading || executionResultsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {testCasesQuery.isError ? <div className="workspace-access-state" role="alert"><h2>Automation cases couldn’t be loaded</h2><p>Retry to restore your cases and their current state.</p><button className="ghost-button" type="button" onClick={() => void testCasesQuery.refetch()}>Retry</button></div> : null}
            {testCasesQuery.isSuccess && !automatedCases.length ? (<section className="automation-start-guide">
                <div><span className="eyebrow">Build your first automation</span><h2>Start with a behavior worth protecting.</h2><p>Bring a manual case or describe the flow. Review the generated steps and objects before your first run.</p></div>
                <div className="automation-start-options">
                  <article><span className="automation-start-number">01</span><h3>Define the behavior</h3><p>Use an existing case, record a browser flow or author steps in the editor.</p>{canCreateAutomationDraft ? <button className="primary-button" disabled={!appTypeId} type="button" onClick={() => setIsCreateAutomationOpen(true)}>Create automation case <span aria-hidden="true">→</span></button> : null}{!canCreateAutomationDraft ? <small>Automation authoring and Test Case creation permissions are required.</small> : !appTypeId ? <small>Select an application to begin.</small> : null}</article>
                  <article><span className="automation-start-number">02</span><h3>Build reusable objects</h3><p>Generate locator candidates from source and review them in the object repository.</p>{hasPermission(session, "agentic_workflow.view", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) ? <button className="ghost-button" type="button" onClick={() => navigate("/agentic-workflows?view=agents")}>Explore source agents <span aria-hidden="true">→</span></button> : <small>Source agents need agent access and the Agents feature.</small>}</article>
                  <article><span className="automation-start-number">03</span><h3>Run with evidence</h3><p>Choose an environment and configuration, then capture outcomes, logs and attachments.</p><small>Run actions become available after you select an automation case.</small></article>
                </div>
              </section>) : null}
            {!testCasesQuery.isLoading && automatedCases.length ? (<TileBrowserPane className="automation-case-tile-browser" scrollKey={`automation-cases:${projectId}:${appTypeId}`}>
                {automationCatalogViewMode === "tile" && filteredAutomationCases.length ? (<div className="tile-browser-grid">
                    {filteredAutomationCases.map((testCase) => {
                        const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                        const latest = history[0];
                        const passedRuns = history.filter((result) => result.status === "passed").length;
                        const passRate = history.length ? Math.round((passedRuns / history.length) * 100) : 0;
                        const isActive = "" === testCase.id;
                        return (<div aria-pressed={isActive} className={["record-card tile-card test-case-card test-case-catalog-card automation-case-tile", isActive ? "is-active" : ""].filter(Boolean).join(" ")} key={testCase.id} onClick={() => {
                                selectAutomationCase(testCase.id);
                            }} onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) {
                                    return;
                                }
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    selectAutomationCase(testCase.id);
                                }
                            }} role="button" tabIndex={0}>
                        <div className="tile-card-main">
                          <div className="tile-card-select-row test-case-card-header">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input aria-label={`Select ${testCase.title}`} checked={selectedAutomationCaseIds.includes(testCase.id)} onChange={(event) => setSelectedAutomationCaseIds((current) => event.target.checked
                                ? [...new Set([...current, testCase.id])]
                                : current.filter((testCaseId) => testCaseId !== testCase.id))} type="checkbox"/>
                              <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id}/>
                            </label>
                            <div className="catalog-inline-actions test-case-top-actions">
                              <StatusBadge value="automated"/>
                              <StatusBadge value={testCase.automation_status || "ready"}/>
                            </div>
                          </div>
                          <div className="tile-card-header">
                            <TileCardIconFrame tone={getTileCardTone(latest?.status || testCase.status)}>
                              <TileCardCaseIcon />
                            </TileCardIconFrame>
                            <div className="tile-card-title-group test-case-card-title-group">
                              <span className="tile-card-kicker">{automationDisplayIdByCaseId[testCase.id] || "AT"} · Keyword automation</span>
                              <strong>{testCase.title}</strong>
                            </div>
                          </div>
                          <CatalogCardDescription fallback="Automation is mapped to the original manual case definition." profile="test-case" value={testCase.description}/>
                          <div className="tile-card-facts">
                            <TileCardFact label={testCase.automation_status === "incomplete" ? "Incomplete" : "Ready"} title="Automation state" tone={testCase.automation_status === "incomplete" ? "neutral" : "success"}><SparkIcon /></TileCardFact>
                            <TileCardFact label={`${history.length} runs`} title="Recent run history" tone={history.length ? "info" : "neutral"}><TileCardRunsIcon /></TileCardFact>
                            <TileCardFact label={`P${testCase.priority || 3}`} title="Priority"><TileCardStepsIcon /></TileCardFact>
                          </div>
                          <div className="tile-card-footer">
                            <TileCardProgress breakdown={buildHistoryStatusBreakdown(history)} displayValue={history.length ? `${passRate}%` : "No runs"} label="Recent pass rate" title={history.length ? `${passedRuns} of ${history.length} recent run outcomes passed` : "No recent run outcomes"} value={history.length ? passRate : null}/>
                          </div>
                        </div>
                      </div>);
                    })}
                  </div>) : null}
                {automationCatalogViewMode === "list" ? (<DataTable columns={automationCaseListColumns} enableColumnResize enableHeaderColumnReorder emptyMessage="No automation cases match the current search." getRowClassName={(testCase) => ("" === testCase.id ? "is-active-row" : "")} getRowKey={(testCase) => testCase.id} hideToolbarCopy onRowClick={(testCase) => selectAutomationCase(testCase.id)} renderRowActions={(testCase) => (<CatalogActionMenu actions={[
                            {
                                label: "Open automation case",
                                description: "Open this case in the automation workspace.",
                                icon: <OpenIcon size={15}/>,
                                onClick: () => selectAutomationCase(testCase.id)
                            }
                        ]} label={`${testCase.title} actions`}/>)} rows={filteredAutomationCases} storageKey="hellotest:automation-cases:list-columns"/>) : null}
                {automationCatalogViewMode === "tile" && !filteredAutomationCases.length ? (<div className="empty-state compact">No automation cases match the current search.</div>) : null}
              </TileBrowserPane>) : null}
          </Panel>)} detailView={null}/>)}

      {isExecutionContextOpen ? <AutomationOverlay title="Execution context" subtitle="Environment, configuration and data for the next build or run." icon={<IconSettings size={20}/>} onClose={() => setIsExecutionContextOpen(false)}>
        <ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/>
        <div className="automation-overlay-footer"><button className="primary-button" onClick={() => setIsExecutionContextOpen(false)} type="button">Done</button></div>
      </AutomationOverlay> : null}
      {runReviewRequest ? <AutomationRunReviewDialog request={runReviewRequest} unsavedStepIds={[]} verifySource={canViewAutomationCode} busy={runSelectedAutomationCases.isPending || retryRemoteAutomationStart.isPending} error={runReviewError} pendingRunId={pendingRemoteRun?.id} retryAllowed={pendingRemoteRun?.retryAllowed} executionProfile={<ExecutionContextSelector appTypeId={runReviewRequest.appTypeId} projectId={runReviewRequest.projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/>} onClose={() => setRunReviewRequest(null)} onOpenCase={id => { setRunReviewRequest(null); selectAutomationCase(id); }} onRun={reviewed => { setRunReviewError(""); runSelectedAutomationCases.mutate({ request: runReviewRequest, reviewed }); }} onRetryStart={() => { setRunReviewError(""); retryRemoteAutomationStart.mutate(); }} onOpenRun={() => {
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
                      <AutomationBuildVerificationSettings mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} disabled={scheduleAiAutomation.isPending || createAutomationCase.isPending}/>
            <p className="muted">Each build includes its saved steps, expected results, accessible stories, reusable objects and selected execution context.</p>
            {batchBusy?<p role="status">Finish or reconcile the selected case’s current authoring operation before starting another build.</p>:null}
            <section className="automation-batch-readiness" aria-label="Selected build plans">
              {batchBuildReadinessQuery.isPending ? <p role="status">Checking saved behavior…</p> : null}
              {batchBuildReadinessQuery.isError ? <div role="alert"><p>{batchBuildReadinessQuery.error instanceof Error ? batchBuildReadinessQuery.error.message : "Saved plans could not be checked."}</p><button className="ghost-button compact" type="button" onClick={() => void batchBuildReadinessQuery.refetch()}>Recheck plans</button></div> : null}
              {batchBuildReadinessQuery.data?.map(result => <div key={result.id}><strong>{result.title}</strong><span>{result.stepCount} steps · {result.ready ? result.stepCount ? "Ready to build" : "Plan from instructions" : "Needs attention"}</span>{result.issues.filter(issue => issue.severity === "blocker").map((issue, index) => <p className="automation-validation-error" key={index}>{issue.order ? `Step ${issue.order} · ` : ""}{issue.message}</p>)}</div>)}
            </section>
          </div><div className="modal-footer"><button className="ghost-button" disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)} type="button">Cancel</button>{canUseAutomationAi ? (<button className="primary-button" disabled={batchBusy || !batchBuildTargetIds.length || !canUseAutomationAi || scheduleAiAutomation.isPending || Boolean(batchStartUrlValidation) || batchBuildReadinessQuery.isPending || batchBuildReadinessQuery.isError || Boolean(batchBuildReadinessQuery.data?.some(result => !result.ready))} onClick={() => scheduleAiAutomation.mutate()} type="button"><SparkIcon />{scheduleAiAutomation.isPending ? "Queueing…" : agentScheduledAt ? "Schedule builds" : "Build selected cases"}</button>) : null}</div></div>
        </div>
      </div> : null}

      {isCreateAutomationOpen && canCreateAutomationDraft ? (<div className="modal-backdrop modal-backdrop--scroll" onClick={closeCreateAutomation} role="presentation">
          <div aria-modal="true" aria-labelledby="automation-create-dialog-title" className="modal-card resource-modal-card automation-create-dialog automation-authoring-create" onClick={(event) => event.stopPropagation()} ref={createAutomationDialogRef} role="dialog" tabIndex={-1}>
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <h2 className="dialog-title" id="automation-create-dialog-title">Create automation case</h2>
                <p>Name the behavior. Choose how to build it.</p>
              </div>
              <DialogCloseButton label="Close create automation case" disabled={createAutomationCase.isPending} onClick={closeCreateAutomation}/>
            </div>
            <form className="resource-form" onSubmit={(event) => { event.preventDefault(); createAutomationCase.mutate(); }}>
              <div className="resource-form-body">
                <fieldset disabled={createAutomationCase.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <div className="automation-create-columns">
                    <div className="stack-list">
                      <AutomationCaseMetadata {...metadataOptions} compact disabled={createAutomationCase.isPending} onChange={updateAutomationCreateMetadata} value={{ ...automationCreateMetadata, manualCaseIds: automationCreateManualCaseIds }}/>
                      <section className="automation-creation-method stack-list" aria-label="Creation method">
                        <strong>Build method</strong>
                        <div className="automation-build-methods">
                          {canUseAutomationAi ? (<button aria-pressed={automationCreationMode === "ai"} disabled={!canUseAutomationAi} onClick={() => setAutomationCreationMode("ai")} type="button"><SparkIcon />AI agent</button>) : null}
                          {canRecordCreation ? (<button aria-pressed={automationCreationMode === "record"} disabled={!canUseRecorder} onClick={() => setAutomationCreationMode("record")} type="button"><MousePointerIcon />Record flow</button>) : null}
                          <button aria-pressed={automationCreationMode === "blank"} onClick={() => setAutomationCreationMode("blank")} type="button"><PencilIcon />Author steps</button>
                        </div>
                        {automationCreateRuntimeTypes.some(type => type === "web" || type === "api") ? <label className="form-field"><span>Start URL{automationCreateStartUrlRequired ? " (required)" : " (optional)"}</span><input aria-label="Automation case start URL" type="url" required={automationCreateStartUrlRequired} onChange={(event) => setAutomationCreateStartUrl(event.target.value)} placeholder="https://your-application.example.com" value={automationCreateStartUrl}/><small className="muted">{automationCreateStartUrlRequired ? "Saved with this case and used when generating or retrying its automation." : "Optional for API-only cases."}</small>{automationCreateStartUrl.trim() && automationCreateStartUrlValidation ? <small role="alert">{automationCreateStartUrlValidation}</small> : null}</label> : null}
                        {automationCreationMode === "ai" && !importedApiPlanReady ? (<div className="automation-agent-brief automation-create-ai">
                            <label className="form-field"><span>Build instructions (optional)</span><textarea aria-label="Build instructions (optional)" onChange={(event) => setAgentMission(event.target.value)} placeholder="The linked cases and behavior plan are included. Add any priorities or constraints." rows={3} value={agentMission}/></label>
                            {automationCreateRuntimeTypes.includes("web") ? <AutomationBrowserBuildMode location={buildBrowserLocation} onLocationChange={setBuildBrowserLocation} interactive={allowBrowserActions} onChange={setAllowBrowserActions} disabled={createAutomationCase.isPending}/> : null}
                      <AutomationBuildVerificationSettings mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} disabled={scheduleAiAutomation.isPending || createAutomationCase.isPending}/>
                            <details className="automation-ai-options"><summary><IconSettings size={14}/>Build settings</summary><div className="automation-ai-options-body"><AiLlmSelect integrations={asArray(automationLlmIntegrationsQuery.data)} value={buildAgentSelection.integrationId} onChange={integrationId => setBuildAgentSelection(current => ({ ...current, integrationId }))} disabled={createAutomationCase.isPending} scopeKey={projectId}/><label className="form-field"><span>Additional guidance</span><textarea onChange={(event) => setBuilderContext(event.target.value)} placeholder="Authentication, important assertions, edge cases, and repository preferences." rows={2} value={builderContext}/></label>
                            <label className="form-field"><span>Schedule build (optional)</span><input onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt}/><small>Leave blank to queue the build after the case is saved.</small></label>
                            </div></details>
                            {!automationCreateManualCaseIds.length && !automationCreateSteps.some((step) => step.action.trim() || step.expected_result.trim()) ? <p className="muted">Describe the requested flow in Build instructions or the case description. The agent will create its steps before automating them.</p> : null}
                          </div>) : <p className="muted">{automationCreationMode === "record" ? "The saved case opens in Build with Record flow selected." : "The saved case opens with its preconditions and steps ready to edit."}</p>}
                      </section>
                    </div>
                    <div className="automation-create-plan-panel">
                      <div><strong>Behavior plan</strong><p className="muted">Linked manual cases retain origin, Story and module context. API twins start with request steps you author below; other case types include the source behavior plan.</p></div>
                      {automationCreateManualCaseIds.length && createSourcesQuery.isPending ? <LoadingState label="Loading source Test Case plans"/> : null}
                      {automationCreateManualCaseIds.length && createSourcesQuery.isError ? <div className="empty-state compact" role="alert"><span>Source steps could not be loaded.</span><button className="ghost-button compact" onClick={() => void createSourcesQuery.refetch()} type="button">Retry source plans</button></div> : null}
                      {automationCreateManualCaseIds.map((sourceId) => {
            const source = createSourcesQuery.data?.find((item) => item.testCase.id === sourceId);
            if (!source)
                return null;
            const preconditions = source.steps.filter(isAutomationPrecondition).length;
            return <details className="automation-create-source-disclosure" key={sourceId}>
                          <summary><span><strong>{source.testCase.title}</strong><small>{preconditions} precondition{preconditions === 1 ? "" : "s"} · {source.steps.length - preconditions} step{source.steps.length - preconditions === 1 ? "" : "s"}</small></span></summary>
                          {source.steps.length ? <ol className="stack-list">{source.steps.map((step) => <li key={step.id}>
                            {step.group_name ? <small>{step.group_name}</small> : null}
                            <RichTextContent value={step.action || ""}/>
                            {step.expected_result ? <div><small>Expected result</small><RichTextContent value={step.expected_result}/></div> : null}
                          </li>)}</ol> : <p className="muted">This source has no authored steps yet.</p>}
                        </details>;
        })}
                      {creationIncompatibleRuntimes.length ? <p role="alert">The selected case type does not support {creationIncompatibleRuntimes.join(", ")} steps in this plan. Choose Unified or update the source steps.</p> : null}
                      {creationAllowedStepTypes.includes("api") ? <ApiAutomationSourceIntake disabled={createAutomationCase.isPending} hasSteps={automationCreateSteps.length > 0} onApply={applyApiSourceDraft}/> : null}
                      {importedApiPlanReady ? <p className="inline-message" role="status">These API contracts will be saved as ordered request steps for review. Configure their parameters and assertions in the saved case; the source requests will not be regenerated by AI.</p> : null}
                      <AutomationDraftPlan allowedStepTypes={creationAllowedStepTypes} defaultStepType={getDefaultAutomationStepType([], automationCreateMetadata.automationCaseType)} availableParameters={automationCreateParameters.definitions} parameterValues={automationCreateParameters.values} onChange={setAutomationCreateSteps} value={automationCreateSteps}/>
                    </div>
                  </div>
                </fieldset>
              </div>
              <div className="resource-form-footer">
                <button className="ghost-button" disabled={createAutomationCase.isPending} onClick={closeCreateAutomation} type="button">Cancel</button>
                {canCreateAutomationCase ? (<button className="primary-button" disabled={!automationCreateMetadata.title.trim() || !automationCreateMetadata.automationCaseType || Boolean(creationIncompatibleRuntimes.length) || createAutomationCase.isPending || Boolean(automationCreateStartUrlValidation) || (automationCreationMode === "record" && !canUseRecorder) || Boolean(automationCreateManualCaseIds.length && (createSourcesQuery.isPending || createSourcesQuery.isError)) || (automationCreationMode === "ai" && (!canUseAutomationAi || (!automationCreateManualCaseIds.length && !automationCreateSteps.some((step) => step.action.trim() || step.expected_result.trim()) && !agentMission.trim() && !builderContext.trim() && !richTextToPlainText(automationCreateMetadata.description).trim())))} type="submit">
                  <AddIcon /><span>{createAutomationCase.isPending ? "Creating..." : importedApiPlanReady ? "Create API case" : automationCreationMode === "ai" ? agentScheduledAt ? "Create & schedule" : "Create & build" : automationCreationMode === "record" ? "Create & record" : "Create case"}</span>
                </button>) : null}
              </div>
            </form>
          </div>
        </div>) : null}
      {parameterReviewDialog}
    </div>);
}
