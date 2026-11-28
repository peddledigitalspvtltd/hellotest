import { AutomationBuildVerificationSettings } from "../../components/AutomationBuildVerificationSettings";
import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { AutomationOverlay } from "../../components/AutomationOverlay";
import { AutomationBrowserBuildMode } from "../../components/AutomationBrowserBuildMode";
import { AutomationRunReviewDialog } from "../../components/AutomationRunReviewDialog";
import { AutomationCreateSuiteAction } from "../../components/AutomationCreateSuiteAction";
import "../../components/AutomationWorkspace.css";
import { AUTOMATION_CASE_TYPES } from "../../lib/automationRuntime";
import { automationCatalogEvidence } from "../../lib/automationCatalogEvidence";
import { EMPTY_AUTOMATION_CATALOG_FILTERS } from "../../lib/automationSelectionState";
import { IconSettings } from "@tabler/icons-react";
import { AddIcon, OpenIcon, PlayIcon, SparkIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
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
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { TileCardCaseIcon, TileCardFact, TileCardIconFrame, TileCardProgress, TileCardRunsIcon, TileCardStepsIcon, getTileCardTone } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileBrowserPane } from "@hellotest/platform/frontend/src/shared/components/TileBrowserPane";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { buildHistoryStatusBreakdown } from "@hellotest/platform/frontend/src/shared/lib/tileProgressBreakdown";
import { AutomationCreateCaseDialog } from "./AutomationCreateCaseDialog";
import type { AutomationCasesController } from './useAutomationCasesController';
export function AutomationCasesView({controller,engineer=false}:{controller:AutomationCasesController;engineer?:boolean}){
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
    catalogFilters, filterCatalog,
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
    automatedCases,
    navigate,
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
    parameterReviewDialog,
}=controller;
const selectionBusy=automationActionTargetIds.some(id=>authoring.caseState(id).phase!=='idle');
const batchBusy=batchBuildTargetIds.some(id=>authoring.caseState(id).phase!=='idle');
const clearFilters = () => filterCatalog(EMPTY_AUTOMATION_CATALOG_FILTERS);
return (<div className={`page-content page-content--automation${""}`}>
      {confirmationDialog}
          {(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentSetup connection={inspectAgent}/> : null}
      {!engineer && <PageHeader className="automation-cases-page-header" eyebrow={automationPageHeader.eyebrow} title={automationPageHeader.title} description={automationPageHeader.description} actions={(canInspectRepository || canUseRecorder || canRunLocalAutomation || canUseAutomationBuilder) ? <RepositoryAgentStatus connection={inspectAgent}/> : undefined} meta={undefined}/>}

      {!engineer && <>
        {automationMetricsQuery.isError ? <div role="alert">Automation metrics could not be loaded. <button className="link-button" type="button" onClick={() => void automationMetricsQuery.refetch()}>Retry</button></div> : null}
        <QualityMetricStrip ariaLabel="Automation quality metrics" metrics={[
            { label: "Total test cases", criteriaKey: "metric.automation.catalog_cases", value: automationMetrics?.total ?? "—", detail: "All automation cases in the selected application" },
            { label: "Recent pass rate", criteriaKey: "metric.automation.catalog_recent_pass_rate", value: canViewExecutionMetrics && automationMetrics?.recentPassRate != null ? `${automationMetrics.recentPassRate}%` : "—", detail: !canViewExecutionMetrics ? "Run result access required" : automationMetrics?.finalizedResults ? `${automationMetrics.passedResults} of ${automationMetrics.finalizedResults} passed` : "No recent runs", tone: "success" },
            { label: "Failed cases", criteriaKey: "metric.automation.catalog_failed_cases", value: canViewExecutionMetrics ? automationMetrics?.failed ?? "—" : "—", detail: "Latest finalized outcome per case", tone: automationMetrics?.failed ? "danger" : "neutral",
              actionLabel: "Show failed automation cases", onClick: canViewExecutionMetrics && automationMetrics ? () => filterCatalog({ ...EMPTY_AUTOMATION_CATALOG_FILTERS, outcome: "failed" }) : undefined }
        ]}/>
      </>}
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone}/>

      {(<WorkspaceMasterDetail className="automation-cases-master-detail" isDetailOpen={false} browseView={(<Panel title="Automation cases" subtitle={engineer ? "Open a case to build its script, or create a case from a manual test." : "Your executable plans and their latest outcomes."} actions={(<div className="design-list-toolbar catalog-command-toolbar automation-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Automation case views, search, and selection">
                  <CatalogViewToggle onChange={setAutomationCatalogViewMode} value={automationCatalogViewMode}/>
                  <CatalogSearchFilter activeFilterCount={activeAutomationCaseSearchCount} ariaLabel="Search automation cases" onChange={search => filterCatalog({ search })} placeholder="Search automation cases" title="Automation filters" type="search" value={catalogFilters.search}>
                    <div className="catalog-filter-grid">
                      <label className="form-field"><span>Plan</span><select aria-label="Plan" value={catalogFilters.plan} onChange={event => {
                        filterCatalog({ plan: event.target.value as typeof catalogFilters.plan });
                      }}><option value="">Any plan</option><option value="ready">Ready</option><option value="incomplete">Incomplete</option></select></label>
                      <label className="form-field"><span>Saved platform</span><select aria-label="Saved platform" value={catalogFilters.platform} onChange={event => {
                        filterCatalog({ platform: event.target.value as typeof catalogFilters.platform });
                      }}><option value="">Any platform</option>{AUTOMATION_CASE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
                      {canViewExecutionMetrics && <label className="form-field"><span>Latest outcome</span><select aria-label="Latest outcome" value={catalogFilters.outcome} onChange={event => {
                        filterCatalog({ outcome: event.target.value as typeof catalogFilters.outcome });
                      }}><option value="">Any outcome</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="blocked">Blocked</option><option value="not_verified">No finalized result</option></select></label>}
                      <div className="catalog-filter-actions">
                        <button className="ghost-button" disabled={!activeAutomationCaseSearchCount} onClick={clearFilters} type="button">
                          Clear filters
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls allSelected={areAllFilteredAutomationCasesSelected} canSelectAll={Boolean(filteredAutomationCases.length)} onClear={() => setSelectedAutomationCaseIds([])} onSelectAll={() => setSelectedAutomationCaseIds((current) => [...new Set([...current, ...filteredAutomationCases.map((testCase) => testCase.id)])])} selectedCount={selectedAutomationCaseIds.length} selectAllLabel="Select loaded cases"/>
                </div>
                <div className="catalog-toolbar-actions" aria-label="Automation case actions">
                  {automationActionTargetIds.length ? <>
                  {projectId && appTypeId ? <AutomationCreateSuiteAction key={`${projectId}:${appTypeId}`} appTypeId={appTypeId} projectId={projectId} cases={automatedCases} selectedIds={automationActionTargetIds}/> : null}
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
                    <span>{engineer ? "Build from a manual test" : "Create automation case"}</span>
                  </button> : null}
                </div>
              </div>)}>
            {testCasesQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {testCasesQuery.isError && !automatedCases.length ? <div className="workspace-access-state" role="alert"><h2>Automation cases couldn’t be loaded</h2><button className="ghost-button" type="button" onClick={() => void testCasesQuery.refetch()}>Retry</button></div> : null}
            {testCasesQuery.isSuccess && !automatedCases.length && (activeAutomationCaseSearchCount
                ? <div className="empty-state compact"><p>No automation cases match these filters.</p><button className="ghost-button" type="button" onClick={clearFilters}>Clear filters</button></div>
                : <div className="empty-state"><h3>No automation cases yet</h3><p>{canCreateAutomationDraft ? "Start from a manual test, record a flow, or author the steps." : "Automation authoring access is required to create a case."}</p></div>)}
            {!testCasesQuery.isLoading && automatedCases.length ? (<TileBrowserPane className="automation-case-tile-browser" scrollKey={`automation-cases:${projectId}:${appTypeId}`}>
                {automationCatalogViewMode === "tile" && filteredAutomationCases.length ? (<div className="tile-browser-grid">
                    {filteredAutomationCases.map((testCase) => {
                        const evidence = automationCatalogEvidence(testCase);
                        const platform = AUTOMATION_CASE_TYPES.find(type => type.value === testCase.automation_case_type)?.label;
                        return (<div className="record-card tile-card test-case-card test-case-catalog-card automation-case-tile" key={testCase.id} onClick={() => {
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
                              <StatusBadge value={testCase.automation_status === "ready" ? "Plan ready" : "Incomplete plan"}/>
                            </div>
                          </div>
                          <div className="tile-card-header">
                            <TileCardIconFrame tone={getTileCardTone(evidence.outcomeLabel?.toLowerCase())}>
                              <TileCardCaseIcon />
                            </TileCardIconFrame>
                            <div className="tile-card-title-group test-case-card-title-group">
                              {platform && <span className="tile-card-kicker">{platform}</span>}
                              <strong>{testCase.title}</strong>
                            </div>
                          </div>
                          {testCase.description && <CatalogCardDescription fallback="" profile="test-case" value={testCase.description}/>}
                          <div className="tile-card-facts">
                            {canViewExecutionMetrics && <TileCardFact label={evidence.outcomeLabel || "No finalized result"} title="Latest finalized outcome" tone={getTileCardTone(evidence.outcomeLabel?.toLowerCase())}><TileCardRunsIcon /></TileCardFact>}
                            <TileCardFact label={`P${testCase.priority || 3}`} title="Priority"><TileCardStepsIcon /></TileCardFact>
                          </div>
                          {canViewExecutionMetrics && evidence.passRate !== null && <div className="tile-card-footer">
                            <TileCardProgress breakdown={buildHistoryStatusBreakdown(evidence.finalized)} displayValue={`${evidence.passRate}%`} label="Recent pass rate" title={`${evidence.passed} of ${evidence.finalized.length} finalized outcomes passed in the latest 10 results`} value={evidence.passRate}/>
                          </div>}
                        </div>
                      </div>);
                    })}
                  </div>) : null}
                {automationCatalogViewMode === "list" ? (<DataTable columns={automationCaseListColumns} enableColumnResize enableHeaderColumnReorder emptyMessage="No automation cases match these filters." getRowKey={(testCase) => testCase.id} hideToolbarCopy onRowClick={(testCase) => selectAutomationCase(testCase.id)} renderRowActions={(testCase) => (<CatalogActionMenu actions={[
                            {
                                label: "Open automation case",
                                description: "Open this case in the automation workspace.",
                                icon: <OpenIcon size={15}/>,
                                onClick: () => selectAutomationCase(testCase.id)
                            }
                        ]} label={`${testCase.title} actions`}/>)} rows={filteredAutomationCases} storageKey="hellotest:automation-cases:list-columns"/>) : null}
                {testCasesQuery.hasNextPage && <div className="catalog-filter-actions">
                  <button className="ghost-button" type="button" disabled={testCasesQuery.isFetching} onClick={() => void testCasesQuery.fetchNextPage()}>
                    {testCasesQuery.isFetchingNextPage ? "Loading cases…" : testCasesQuery.isFetchNextPageError ? "Retry loading more cases" : "Load more cases"}
                  </button>
                </div>}
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
            <div className="automation-plan-behavior-fields">{batchHasUrlRuntime ? <label className="form-field"><span>{batchStartUrlRequired ? "Start URL (required)" : "API base URL (optional)"}</span><input aria-label={batchStartUrlRequired ? "Build start URL" : "API base URL"} type="url" required={batchStartUrlRequired} onChange={(event) => setBatchStartUrl(event.target.value)} placeholder="https://your-application.example.com" value={batchStartUrl}/><small className="muted">{batchStartUrlRequired ? "Review the application URL for this build, including retries." : "API-only plans may use their configured request URLs."}</small>{batchStartUrl.trim() && batchStartUrlValidation ? <small role="alert">{batchStartUrlValidation}</small> : null}</label> : null}<label className="form-field"><span>Build time</span><input onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt}/><small className="muted">Leave empty to queue now.</small></label></div>
            <details><summary>Additional guidance & execution context</summary><div className="stack-list"><AiLlmSelect integrations={asArray(automationLlmIntegrationsQuery.data)} value={buildAgentSelection.integrationId} onChange={integrationId => setBuildAgentSelection(current => ({ ...current, integrationId }))} disabled={scheduleAiAutomation.isPending} scopeKey={projectId}/><label className="form-field"><span>Guidance</span><textarea onChange={(event) => setBuilderContext(event.target.value)} rows={3} value={builderContext}/></label><ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId}/></div></details>
            {batchStartUrlRequired ? <AutomationBrowserBuildMode location={buildBrowserLocation} onLocationChange={setBuildBrowserLocation} interactive={allowBrowserActions} onChange={setAllowBrowserActions} disabled={scheduleAiAutomation.isPending}/> : null}
            {batchStartUrlRequired && batchBuildReadinessQuery.data?.every(plan => plan.runtimes.every(runtime => runtime === "web")) ? <AutomationBuildVerificationSettings browserLocation={buildBrowserLocation} mode={buildVerificationMode} onModeChange={setBuildVerificationMode} canVerify={canVerifyBuild} interactive={allowBrowserActions} hasEnvironment={Boolean(selectedExecutionEnvironmentId)} disabled={scheduleAiAutomation.isPending || createAutomationCase.isPending}/> : null}
            <p className="muted">Each build includes its saved steps, expected results, accessible stories, reusable objects and selected execution context.</p>
            {batchBusy?<p role="status">Finish or reconcile the selected case’s current authoring operation before starting another build.</p>:null}
            <section className="automation-batch-readiness" aria-label="Selected build plans">
              {batchBuildReadinessQuery.isPending ? <p role="status">Checking saved behavior…</p> : null}
              {batchBuildReadinessQuery.isError ? <div role="alert"><p>{batchBuildReadinessQuery.error instanceof Error ? batchBuildReadinessQuery.error.message : "Saved plans could not be checked."}</p><button className="ghost-button compact" type="button" onClick={() => void batchBuildReadinessQuery.refetch()}>Recheck plans</button></div> : null}
              {batchBuildReadinessQuery.data?.map(result => <div key={result.id}><strong>{result.title}</strong><span>{result.runtimes.map(runtime => runtime === "web" ? "Web" : runtime === "ios" ? "iOS" : runtime.toUpperCase()).join(" + ")} · {result.stepCount} steps · {result.ready ? result.stepCount ? "Ready to build" : "Plan from instructions" : "Needs attention"}</span>{result.issues.filter(issue => issue.severity === "blocker").map((issue, index) => <p className="automation-validation-error" key={index}>{issue.order ? `Step ${issue.order} · ` : ""}{issue.message}</p>)}</div>)}
            </section>
          </div><div className="modal-footer"><button className="ghost-button" disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)} type="button">Cancel</button>{canUseAutomationAi ? (<button className="primary-button" disabled={batchBusy || !batchBuildTargetIds.length || !canUseAutomationAi || scheduleAiAutomation.isPending || Boolean(batchStartUrlValidation) || batchBuildReadinessQuery.isPending || batchBuildReadinessQuery.isError || Boolean(batchBuildReadinessQuery.data?.some(result => !result.ready))} onClick={() => scheduleAiAutomation.mutate()} type="button"><SparkIcon />{scheduleAiAutomation.isPending ? "Queueing…" : agentScheduledAt ? "Schedule builds" : "Build selected cases"}</button>) : null}</div></div>
        </div>
      </div> : null}

      {isCreateAutomationOpen && canCreateAutomationDraft ? <AutomationCreateCaseDialog controller={controller} engineer={engineer} /> : null}
      {parameterReviewDialog}
    </div>);
}
