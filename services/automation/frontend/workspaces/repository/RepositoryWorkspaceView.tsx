import "../../components/AutomationWorkspace.css";
import "./RepositoryWorkspace.css";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { type CSSProperties } from "react";
import { IconDots, IconShieldCheck, IconTargetArrow } from "@tabler/icons-react";
import { AddIcon, CopyIcon, ExportIcon, ImportIcon, LayersIcon, MousePointerIcon, OpenIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon, SelectionToggleIcon, SparkIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { RepositoryLocatorBuilder } from "../../components/RepositoryLocatorBuilder";
import { RepositoryMembersTable } from "../../components/RepositoryMembersTable";
import { repositoryLocatorIdentity } from "../../lib/repositoryLocators";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { RepositoryInspectBrowser } from "@hellotest/automation/frontend/components/RepositoryInspectBrowser";
import { RepositoryAgentSetup, RepositoryAgentStatus, RepositoryInspectSessionControls } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { RichTextEditor } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { SubnavTabs } from "@hellotest/platform/frontend/src/shared/components/SubnavTabs";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import {getRepositoryMemberName,isLikelyImageUrl,getRepositoryImportKindLabel,inferLocatorStrategy} from '../../lib/automationWorkspaceSupport';
import type {RepositoryWorkspaceController} from './useRepositoryWorkspaceController';
const AiAssurancePanel = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiAssurancePanel")["AiAssurancePanel"]> & {}>("ai", "AiAssurancePanel", () => import("@hellotest/ai/frontend/components/AiAssurancePanel"), "ai");
export function RepositoryWorkspaceView({controller}:{controller:RepositoryWorkspaceController}){
const {
    canImportRepository,
    canExportRepository,
    confirmationDialog,
    canUseAutomationAi,
    canInspectRepository,
    navigate,
    message,
    setMessage,
    messageTone,
    inspectRecorderSession,
    isLaunchingInspectBrowser,
    isClosingInspectBrowser,
    isRefreshingInspectTabs,
    highlightedRepositoryId,
    screenRenameDraft,
    setScreenRenameDraft,
    renamingScreenName,
    setRenamingScreenName,
    isRepositoryImportModalOpen,
    setIsRepositoryImportModalOpen,
    repositoryImportPreview,
    setRepositoryImportPreview,
    isParsingRepositoryImport,
    locatorImprovementPreview,
    setLocatorImprovementPreview,
    isAddingRepositoryScreen,
    setIsAddingRepositoryScreen,
    newRepositoryScreenDraft,
    setNewRepositoryScreenDraft,
    isAddingRepositoryField,
    setIsAddingRepositoryField,
    newRepositoryFieldDraft,
    setNewRepositoryFieldDraft,
    screenDetailTab,
    setScreenDetailTab,
    fieldDetailTab,
    setFieldDetailTab,
    isRepositoryConfigOpen,
    setIsRepositoryConfigOpen,
    repositoryConfigDrawerWidth,
    isInspectOpen,
    setIsInspectOpen,
    isInspectBrowserMaximized,
    setIsInspectBrowserMaximized,
    inspectSessionMode,
    inspectReviewTab,
    setInspectReviewTab,
    inspectTabs,
    selectedInspectTabId,
    isInspectingLiveField,
    inspectMessage,
    setInspectMessage,
    browserInspectFields,
    stagedInspectFields,
    dismissedInspectLocators,
    reinspectFieldLocator,
    setFocusedInspectLocator,
    highlightedInspectLocator,
    repositoryUsageBlock,
    setRepositoryUsageBlock,
    screenDomDraft,
    setScreenDomDraft,
    screenScreenshotDraft,
    screenUrlDraft,
    setScreenUrlDraft,
    screenInfoDraft,
    setScreenInfoDraft,
    repositoryDraft,
    setRepositoryDraft,
    learningCacheQuery,
    inspectAgent,
    inspectCapabilities,
    appTypes,
    learningCache,
    groupedRepository,
    activeScreenName,
    selectedRepositoryEntry,
    pageObjectModels,
    activePageObject,
    recommendedInspectMode,
    closeRepositoryInspector,
    repositoryInspectorRef,
    focusInspectField,
    stageInspectField,
    updateStagedInspectField,
    refreshInspectTabs,
    selectInspectTab,
    launchInspectBrowser,
    closeInspectBrowser,
    startLiveInspect,
    reinspectField,
    stopLiveInspect,
    highlightRepositoryLocator,
    syncInspectHighlights,
    removeStagedInspectField,
    removeAllStagedInspectFields,
    selectAllBrowserInspectFields,
    dismissInspectField,
    restoreDismissedInspectFields,
    handleRepositoryConfigResizeStart,
    handleRepositoryConfigResizeKeyDown,
    selectedInspectLocatorSet,
    inspectFieldInventory,
    focusedInspectField,
    focusedSelectedInspectField,
    focusedInspectPrimaryLocator,
    inspectRecorderLiveUrl,
    selectedLocators,
    selectedLocatorReviewReadiness,
    selectRepositoryScreen,
    selectRepositoryEntry,
    openRepositoryInspect,
    exportRepositoryCsv,
    importRepositoryEntries,
    saveRepositoryEntry,
    addRepositoryScreen,
    saveRepositoryScreenEvidence,
    validateInspectedFields,
    saveInspectedScreenFields,
    extractRepositoryFields,
    repairInspectedFieldWithAi,
    addRepositoryField,
    renameRepositoryScreen,
    deleteRepositoryEntry,
    deleteRepositoryScreen,
    improveRepositoryEntry,
    applyRepositoryImprovement,
    handleRepositoryImportFiles,
    appTypeId,
    caseBindings,
}=controller;
if(!controller.canViewObjectRepository)return <div className="empty-state" role="status">Object Repository access is unavailable for this scope.</div>;
const renderRepositoryConfiguration = () => selectedRepositoryEntry && isRepositoryConfigOpen ? (<aside className="panel card automation-detail-panel object-repository-config-drawer" aria-label="Object configuration">
		              <button aria-label="Resize object configuration panel" className="object-repository-config-resize-handle" onKeyDown={handleRepositoryConfigResizeKeyDown} onPointerDown={handleRepositoryConfigResizeStart} title="Drag left or right to resize object configuration" type="button"/>
		              <div className="object-repository-config-head">
	                <div>
	                  <strong>Object Configuration</strong>
	                  <span>Element Configuration: {repositoryDraft.object_name || getRepositoryMemberName(selectedRepositoryEntry)}</span>
	                </div>
	                <button aria-label="Close object configuration" className="object-repository-config-close" onClick={() => setIsRepositoryConfigOpen(false)} title="Close object configuration" type="button">
	                  <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
	                    <path d="M18 6 6 18"/>
	                    <path d="m6 6 12 12"/>
	                  </svg>
	                </button>
	              </div>
	                              <SubnavTabs ariaLabel="Field details" className="object-repository-screen-tabs" value={fieldDetailTab} onChange={setFieldDetailTab} items={[
        { value: "locators", label: "Locators", meta: `${selectedLocators.length} strategies` },
        { value: "evidence", label: "Evidence", meta: "DOM + visual" },
        { value: "meaning", label: "AI Meaning", meta: "Agent context" },
        { value: "healing", label: "Healing", meta: locatorImprovementPreview ? "Review proposal" : "Readiness" }
    ]}/>
<fieldset className="repository-config-fields" disabled={!canInspectRepository}>
                  <div className="testops-action-row object-repository-config-actions">
	                {<button className="ghost-button" onClick={() => void highlightRepositoryLocator(selectedRepositoryEntry.locator, `${activeScreenName}.${getRepositoryMemberName(selectedRepositoryEntry)}`, selectedRepositoryEntry.id).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight field."))} type="button">
	                  <MousePointerIcon />
	                  <span>Highlight</span>
	                </button>}

	                <button className="primary-button" disabled={saveRepositoryEntry.isPending} onClick={() => saveRepositoryEntry.mutate()} type="button">
	                  <PlayIcon />
	                  <span>{saveRepositoryEntry.isPending ? "Saving..." : "Save field"}</span>
	                </button>
	                <button className="ghost-button danger" disabled={deleteRepositoryEntry.isPending} onClick={() => deleteRepositoryEntry.mutate(false)} type="button">
	                  <TrashIcon size={16}/>
	                  <span>{deleteRepositoryEntry.isPending ? "Checking..." : "Delete field"}</span>
	                </button>
	              </div>
	              <div className="repository-field-detail">
	
                {fieldDetailTab === "healing" ? (<div className="repository-healing-panel">
	                <AiAssurancePanel compact gaps={selectedLocatorReviewReadiness.gaps} provenance="Saved locator strategies, stability metadata, validation history, DOM/accessibility evidence, and captured images" reviewState="review-required" score={selectedLocatorReviewReadiness.score} scoreLabel={selectedLocatorReviewReadiness.scoreLabel} signals={selectedLocatorReviewReadiness.signals} summary={selectedLocatorReviewReadiness.summary} title="Locator healing readiness"/>
	                {locatorImprovementPreview ? (<section className="locator-improvement-review" aria-label="Locator improvement review">
	                    <div className="locator-improvement-review-head">
	                      <div>
	                        <span>Proposed change</span>
	                        <strong>Human approval required</strong>
	                      </div>
	                      <span className="count-pill">{locatorImprovementPreview.generation_mode === "llm" ? "AI proposal" : "Rule-based proposal"}</span>
	                    </div>
	                    <div className="locator-improvement-diff">
	                      <div>
	                        <span>Current</span>
	                        <b>{selectedRepositoryEntry.locator_kind || "css"}</b>
	                        <code>{selectedRepositoryEntry.locator}</code>
	                      </div>
	                      <div>
	                        <span>Proposed</span>
	                        <input aria-label="Edit proposed locator strategy" onChange={(event) => setLocatorImprovementPreview((current) => current ? { ...current, suggestion: { ...current.suggestion, strategy: event.target.value } } : current)} placeholder="Locator strategy" value={locatorImprovementPreview.suggestion.strategy || ""}/>
	                        <textarea aria-label="Edit proposed locator" onChange={(event) => setLocatorImprovementPreview((current) => current ? { ...current, suggestion: { ...current.suggestion, locator: event.target.value } } : current)} placeholder="Proposed locator" rows={3} value={locatorImprovementPreview.suggestion.locator || ""}/>
	                      </div>
	                    </div>
	                    <p>{locatorImprovementPreview.suggestion.reason || locatorImprovementPreview.fallback_reason || "Review the proposed locator against captured evidence before applying it."}</p>
	                    <div className="locator-improvement-provenance">
	                      <span>{locatorImprovementPreview.provenance?.provider || (locatorImprovementPreview.generation_mode === "llm" ? "Configured AI provider" : "HelloTest deterministic rules")}</span>
	                      {locatorImprovementPreview.provenance?.model ? <span>{locatorImprovementPreview.provenance.model}</span> : null}
	                      {locatorImprovementPreview.request_id ? <code>{locatorImprovementPreview.request_id}</code> : null}
	                    </div>
	                    <div className="action-row">
	                      <button className="primary-button" disabled={applyRepositoryImprovement.isPending || !locatorImprovementPreview.suggestion.locator || !locatorImprovementPreview.suggestion.strategy} onClick={() => applyRepositoryImprovement.mutate()} type="button">
	                        {applyRepositoryImprovement.isPending ? "Applying..." : "Apply reviewed change"}
	                      </button>
	                      <button className="ghost-button" disabled={applyRepositoryImprovement.isPending} onClick={() => setLocatorImprovementPreview(null)} type="button">
	                        Discard proposal
	                      </button>
	                    </div>
	                  </section>) : null}
                    <div className="action-row">
	                {canUseAutomationAi ? <button className="ghost-button" disabled={improveRepositoryEntry.isPending || applyRepositoryImprovement.isPending} onClick={() => improveRepositoryEntry.mutate()} type="button">
	                  <SparkIcon />
	                  <span>{improveRepositoryEntry.isPending ? "Preparing..." : locatorImprovementPreview ? "Regenerate proposal" : "Suggest improvement"}</span>
	                </button> : null}
                    </div>
                  </div>) : null}
                {fieldDetailTab === "locators" ? (<div className="repository-locator-detail">
                    <div className="repository-locator-list">
                      {selectedLocators.map((locator) => (<article key={`${locator.strategy}-${locator.locator}`}>
                          <StatusBadge value={locator.isPrimary ? "Primary" : "Fallback"}/>
                          <strong>{locator.strategy}</strong>
                          <code>{locator.locator}</code>
                          <span>{Math.round(locator.confidenceScore * 100)}% · {locator.lastValidatedStatus}</span>
                        </article>))}
                    </div>
                    <div className="record-grid testops-builder-form">
                    <label className="form-field">
                      <span>Screen name</span>
                      <input readOnly value={screenInfoDraft.screen_name || activeScreenName}/>
                    </label>
                    <label className="form-field">
                      <span>Inherited screen URL rule</span>
                      <input readOnly value={`${screenInfoDraft.url_pattern_type} ${screenInfoDraft.url_pattern_value}`}/>
                    </label>
                    <label className="form-field">
                      <span>Field name</span>
                      <input value={repositoryDraft.object_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_name: event.target.value }))}/>
                    </label>
                    <label className="form-field">
                      <span>Element type / role</span>
                      <input value={repositoryDraft.object_role} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_role: event.target.value }))}/>
                    </label>
                    <label className="form-field">
                      <span>Primary locator · {Math.round(selectedRepositoryEntry.confidence * 100)}% confidence</span>
                      <input value={repositoryDraft.locator} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator: event.target.value }))}/>
                    </label>
                    <label className="form-field">
                      <span>Primary strategy</span>
                      <input value={repositoryDraft.locator_kind} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator_kind: event.target.value }))}/>
                    </label>
                    <label className="form-field repository-span-two">
                      <span>Fallback locators · `strategy | locator | confidence %`</span>
                      <textarea rows={4} value={repositoryDraft.fallback_locators} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_locators: event.target.value }))} placeholder={"aria-label | [aria-label='Login'] | 90\ncss | button[type='submit'] | 70"}/>
                    </label>
                    <label className="form-field">
                      <span>Stability score (%)</span>
                      <input max="100" min="0" type="number" value={repositoryDraft.stability_score} onChange={(event) => setRepositoryDraft((current) => ({ ...current, stability_score: event.target.value }))}/>
                    </label>
                    <label className="form-field">
                      <span>Inherited screen fingerprint</span>
                      <input readOnly value={screenInfoDraft.screen_fingerprint} placeholder="Capture screen evidence to generate identity"/>
                    </label>
                    </div>
                  </div>) : null}
                {fieldDetailTab === "evidence" ? (<div className="record-grid testops-builder-form">
                    <label className="form-field"><span>Element screenshot URL</span><input value={repositoryDraft.element_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, element_screenshot_url: event.target.value }))}/></label>
                    <label className="form-field"><span>Ancestor screenshot URL</span><input value={repositoryDraft.ancestor_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_screenshot_url: event.target.value }))}/></label>
                    <label className="form-field repository-span-two"><span>Parent / ancestor DOM snapshot</span><textarea rows={5} value={repositoryDraft.ancestor_dom || repositoryDraft.dom_structure} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_dom: event.target.value }))}/></label>
                    <label className="form-field repository-span-two"><span>Inherited screen accessibility tree</span><textarea readOnly rows={5} value={screenInfoDraft.accessibility_tree}/></label>
                    {repositoryDraft.element_screenshot_url && isLikelyImageUrl(repositoryDraft.element_screenshot_url) ? <div className="object-repository-snapshot"><img alt={`${repositoryDraft.object_name} element`} src={repositoryDraft.element_screenshot_url}/></div> : null}
                  </div>) : null}
                {fieldDetailTab === "meaning" ? (<div className="record-grid testops-builder-form">
                    <label className="form-field repository-span-two"><span>AI-generated description</span><RichTextEditor disabled={!canInspectRepository} appearance="canonical" rows={3} value={repositoryDraft.description} onChange={(description) => setRepositoryDraft((current) => ({ ...current, description }))}/></label>
                    <label className="form-field repository-span-two"><span>Business meaning</span><textarea rows={3} value={repositoryDraft.business_meaning} onChange={(event) => setRepositoryDraft((current) => ({ ...current, business_meaning: event.target.value }))}/></label>
                    <label className="form-field"><span>Usage keywords</span><input value={repositoryDraft.usage_keywords} onChange={(event) => setRepositoryDraft((current) => ({ ...current, usage_keywords: event.target.value }))} placeholder="login, submit, authenticate"/></label>
                    <label className="form-field repository-span-two"><span>Healing guidance</span><textarea rows={3} value={repositoryDraft.fallback_strategy} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_strategy: event.target.value }))}/></label>
	                  </div>) : null}
	              </div>
	            </fieldset>
                </aside>) : null;
const renderRepositoryScreenOverview = () => activePageObject ? (<fieldset className="repository-screen-overview repository-config-fields" disabled={!canInspectRepository}>
	                      <div className="record-grid testops-builder-form repository-screen-overview-grid">
                        <label className="form-field"><span>Screen name</span><input readOnly value={screenInfoDraft.screen_name || activeScreenName}/></label>
                        <label className="form-field"><span>Page URL</span><input onChange={(event) => setScreenUrlDraft(event.target.value)} placeholder="https://app.example.com/login" value={screenUrlDraft}/></label>
                        <label className="form-field repository-span-two">
                          <span>URL match rule</span>
                          <div className="repository-url-rule"><select value={screenInfoDraft.url_pattern_type} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={screenInfoDraft.url_pattern_value} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login"/></div>
                        </label>
                        <label className="form-field repository-span-two"><span>Description</span><RichTextEditor disabled={!canInspectRepository} appearance="canonical" rows={3} value={screenInfoDraft.description} onChange={(description) => setScreenInfoDraft((current) => ({ ...current, description }))} placeholder="What this screen represents."/></label>
                        <label className="form-field repository-span-two"><span>Intended flows</span><textarea rows={3} value={screenInfoDraft.business_meaning} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Sign in, recover password, continue as guest."/></label>
                      </div>
                      <div className="testops-action-row">
                        <button className="primary-button" disabled={saveRepositoryScreenEvidence.isPending} onClick={() => saveRepositoryScreenEvidence.mutate()} type="button"><LayersIcon /><span>{saveRepositoryScreenEvidence.isPending ? "Saving..." : "Save screen"}</span></button>
	                        {canInspectRepository ? (<button className="ghost-button" disabled={!canInspectRepository} onClick={() => openRepositoryInspect(activePageObject)} type="button"><MousePointerIcon /><span>Inspect screen</span></button>) : null}
	                        {canUseAutomationAi && canInspectRepository ? <button className="ghost-button" disabled={(!screenDomDraft && !screenScreenshotDraft) || extractRepositoryFields.isPending} onClick={() => {
            openRepositoryInspect(activePageObject);
            extractRepositoryFields.mutate();
        }} type="button"><SparkIcon /><span>{extractRepositoryFields.isPending ? "Suggesting..." : "AI suggest fields"}</span></button> : null}
                      </div>
                    </fieldset>) : null;
const automationPageHeader = {
    eyebrow: "Automation assets",
    title: "Object Repository",
    description: "Capture, review, and maintain reusable page objects and selectors for stable automated Test Cases."
};
return (<div className={`page-content page-content--automation${""}`}>
      {confirmationDialog}
          {canInspectRepository ? <RepositoryAgentSetup connection={inspectAgent} onUseRemote={inspectCapabilities.data?.remote?.available && inspectRecorderSession?.status !== "running" && !isLaunchingInspectBrowser ? () => {
            setIsInspectOpen(true);
            void launchInspectBrowser("remote").catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start remote inspection browser."));
        } : undefined}/> : null}
      {!caseBindings?<PageHeader className={"object-repository-page-header"} eyebrow={automationPageHeader.eyebrow} title={automationPageHeader.title} description={automationPageHeader.description} actions={canInspectRepository ? <RepositoryAgentStatus connection={inspectAgent}/> : undefined} meta={[{ label: "Repository objects", value: learningCacheQuery.data ? learningCache.length : "—" }]}/>:null}
      {caseBindings?<div className="object-repository-inspector-section-head"><h3>Objects used by this case</h3><span>Only fields referenced by the current plan are shown. Changes update the shared repository.</span></div>:null}
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone}/>

	      {(<div className={[
            "automation-workspace-grid automation-workspace-grid--repository",
            selectedRepositoryEntry && isRepositoryConfigOpen ? "has-config-drawer" : ""
        ].filter(Boolean).join(" ")} style={selectedRepositoryEntry && isRepositoryConfigOpen ? ({ "--object-repository-config-width": `${repositoryConfigDrawerWidth}px` } as CSSProperties) : undefined}>
          <Panel title={caseBindings?"Objects used by this case":"Object repository"} subtitle={caseBindings?"Only bindings referenced by the current plan are shown. Saved source and context hashes govern inferred matches.":"Screen-level fields grouped by page, with friendly member names, HTML tag details, locator, DOM, image, and fallback intelligence."} actions={(<div className="testops-action-row repository-toolbar">
                <button className="primary-button" disabled={!canInspectRepository} onClick={() => {
                setIsAddingRepositoryScreen((current) => !current);
                setIsAddingRepositoryField(false);
            }} type="button">
                  <AddIcon />
                  <span>New screen</span>
                </button>
	                {canInspectRepository ? (<button className="ghost-button" disabled={!activePageObject || !canInspectRepository} onClick={() => openRepositoryInspect(activePageObject)} type="button">
	                  <MousePointerIcon />
	                  <span>Inspect selected</span>
	                </button>) : null}
	                <button className="ghost-button" disabled={!canImportRepository} onClick={() => setIsRepositoryImportModalOpen(true)} type="button">
	                  <ImportIcon />
	                  <span>{isParsingRepositoryImport ? "Reading..." : "Import"}</span>
	                </button>
                <button className="ghost-button" disabled={!canExportRepository || !appTypeId || exportRepositoryCsv.isPending} onClick={() => exportRepositoryCsv.mutate()} type="button">
                  <ExportIcon />
                  <span>{exportRepositoryCsv.isPending ? "Exporting..." : "Export CSV"}</span>
                </button>
                <button className="ghost-button danger" disabled={!canInspectRepository || !activePageObject || deleteRepositoryScreen.isPending} onClick={() => deleteRepositoryScreen.mutate(false)} type="button">
                  <TrashIcon size={16}/>
                  <span>{deleteRepositoryScreen.isPending ? "Checking..." : "Delete screen"}</span>
                </button>
              </div>)}>
            {learningCacheQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {learningCacheQuery.isError ? (<div className="empty-state compact" role="alert">
                <span>Unable to load repository screens. Your saved screens have not been removed.</span>
                <button className="ghost-button compact" disabled={learningCacheQuery.isFetching} onClick={() => void learningCacheQuery.refetch()} type="button">Retry loading</button>
              </div>) : null}
            {isAddingRepositoryScreen ? (<div className="automation-create-card repository-screen-create-card">
                <div className="object-repository-inspector-section-head">
                  <strong>Create Object Repository screen</strong>
                  <span>Name the screen and define how it is recognized. URL, DOM, screenshot, and selected objects remain attached to this screen record.</span>
                </div>
	                      <div className="record-grid testops-builder-form repository-screen-overview-grid">
                  <label className="form-field"><span>Screen name</span><input value={newRepositoryScreenDraft.screen_name} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, screen_name: event.target.value }))} placeholder="Checkout Page"/></label>
                  <label className="form-field"><span>Page URL</span><input value={newRepositoryScreenDraft.page_url} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, page_url: event.target.value }))} placeholder="https://app.example.com/checkout"/></label>
                  <label className="form-field">
                    <span>URL match rule</span>
                    <div className="repository-url-rule">
                      <select value={newRepositoryScreenDraft.url_pattern_type} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select>
                      <input value={newRepositoryScreenDraft.url_pattern_value} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/checkout"/>
                    </div>
                  </label>
                  <label className="form-field repository-span-two"><span>Purpose and intended flow</span><textarea rows={3} value={newRepositoryScreenDraft.business_meaning} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Customer reviews cart, enters payment, and submits an order."/></label>
                  <label className="form-field repository-span-two"><span>Description</span><RichTextEditor appearance="canonical" rows={2} value={newRepositoryScreenDraft.description} onChange={(description) => setNewRepositoryScreenDraft((current) => ({ ...current, description }))} placeholder="Page context used when selecting stable fields."/></label>
                </div>
                <details className="repository-screen-create-evidence">
                  <summary>
                    <span><strong>Initial evidence</strong><small>Paste existing evidence or let the live builder capture the current URL, DOM, and screenshot.</small></span>
                  </summary>
                  <div className="record-grid testops-builder-form repository-screen-overview-grid">
                    <label className="form-field repository-span-two"><span>Screenshot URL / data URL</span><input value={newRepositoryScreenDraft.screenshot_url} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, screenshot_url: event.target.value }))} placeholder="Captured during inspect when blank"/></label>
                    <label className="form-field repository-span-two"><span>DOM / accessibility structure</span><textarea rows={6} value={newRepositoryScreenDraft.dom_structure} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, dom_structure: event.target.value }))} placeholder="<main><input aria-label='Card number' />...</main>"/></label>
                  </div>
                </details>
                <div className="repository-screen-create-readiness" aria-label="New screen capture readiness">
                  <span className={newRepositoryScreenDraft.page_url.trim() ? "is-ready" : ""}>URL</span>
                  <span className={newRepositoryScreenDraft.dom_structure.trim() ? "is-ready" : ""}>DOM</span>
                  <span className={newRepositoryScreenDraft.screenshot_url.trim() ? "is-ready" : ""}>Screenshot</span>
                  <small>Missing evidence can be captured after creation.</small>
                </div>
                <div className="testops-action-row repository-screen-create-actions">
                  <button className="primary-button" disabled={addRepositoryScreen.isPending || !newRepositoryScreenDraft.screen_name.trim()} onClick={() => addRepositoryScreen.mutate({ inspectAfterSave: false })} type="button"><LayersIcon /><span>{addRepositoryScreen.isPending ? "Creating..." : "Create screen"}</span></button>
                  <button className="ghost-button" disabled={addRepositoryScreen.isPending || !newRepositoryScreenDraft.screen_name.trim()} onClick={() => addRepositoryScreen.mutate({ inspectAfterSave: true })} type="button"><MousePointerIcon /><span>Create &amp; inspect</span></button>
                  <button className="ghost-button" disabled={addRepositoryScreen.isPending} onClick={() => setIsAddingRepositoryScreen(false)} type="button">Cancel</button>
                </div>
              </div>) : null}
            {!learningCacheQuery.isLoading && !learningCacheQuery.isError && !groupedRepository.length ? (<div className="empty-state compact">{caseBindings?'This case does not reference any saved repository fields. Add an object binding to a plan step to use the shared editor.':'No repository objects have been learned for this scope yet.'}</div>) : null}
            <div className="pom-workspace">
              <aside className="pom-page-list" aria-label="Repository pages">
                {pageObjectModels.map((page) => (<div className={activePageObject?.screenName === page.screenName ? "pom-page-item is-active" : "pom-page-item"} key={page.screenName}>
                    {renamingScreenName === page.screenName ? (<form className="pom-page-rename-form" onSubmit={(event) => {
                    event.preventDefault();
                    renameRepositoryScreen.mutate();
                }}>
                        <input aria-label={`Rename ${page.pageName}`} autoFocus onChange={(event) => setScreenRenameDraft(event.target.value)} value={screenRenameDraft}/>
                        <button className="primary-button compact" disabled={!screenRenameDraft.trim() || screenRenameDraft.trim() === activeScreenName || renameRepositoryScreen.isPending} type="submit">
                          {renameRepositoryScreen.isPending ? "Saving..." : "Save"}
                        </button>
                        <button className="ghost-button compact" disabled={renameRepositoryScreen.isPending} onClick={() => setRenamingScreenName("")} type="button">Cancel</button>
                      </form>) : (<>
                        <button className="pom-page-select" onClick={() => selectRepositoryScreen(page.screenName)} type="button">
                          <strong>{page.pageName}</strong>
                          <small>{appTypes.find((appType) => appType.id === page.appTypeId)?.name || "Workspace"}</small>
                        </button>
                        <button aria-label={`Rename ${page.pageName}`} className="pom-page-rename" disabled={!canInspectRepository} onClick={() => {
                    selectRepositoryScreen(page.screenName);
                    setScreenRenameDraft(page.pageName);
                    setRenamingScreenName(page.screenName);
                }} type="button">
                          <PencilIcon size={15}/>
                        </button>
                      </>)}
                  </div>))}
              </aside>

              {activePageObject ? (<section className="pom-class-panel" aria-label={`${activePageObject.pageName} repository page`}>
                  <SubnavTabs ariaLabel="Screen details" className="object-repository-screen-tabs" value={screenDetailTab} onChange={setScreenDetailTab} items={[
                { value: "overview", label: "Overview", meta: screenInfoDraft.description ? "Documented" : "Add context" },
                { value: "fields", label: "Fields", meta: String(activePageObject.members.length) },
                { value: "dom", label: "DOM Snapshot", meta: screenDomDraft ? "Captured" : "Pending" }
            ]}/>
                  {screenDetailTab === "overview" ? renderRepositoryScreenOverview() : null}
                  {screenDetailTab === "fields" ? (<div className="repository-fields-panel">
                      <div className="testops-action-row">
                        <button className="ghost-button" disabled={!canInspectRepository} onClick={() => {
                    setIsAddingRepositoryField((current) => !current);
                    setIsAddingRepositoryScreen(false);
                }} type="button">
                          <AddIcon />
                          <span>Add field</span>
                        </button>
                      </div>
                      {isAddingRepositoryField ? (<div className="automation-create-card">
                          <strong>Add repository field manually</strong>
                          <div className="record-grid testops-builder-form">
                            <label className="form-field"><span>Screen name</span><input readOnly value={activeScreenName}/></label>
                            <label className="form-field"><span>Field name</span><input value={newRepositoryFieldDraft.object_name} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, object_name: event.target.value }))} placeholder="Email input"/></label>
                            <label className="form-field"><span>Element type / role</span><input value={newRepositoryFieldDraft.object_role} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, object_role: event.target.value }))} placeholder="textbox"/></label>
                            <label className="form-field"><span>Primary strategy</span><input value={newRepositoryFieldDraft.locator_kind} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, locator_kind: event.target.value }))} placeholder="data-testid"/></label>
                            <label className="form-field repository-span-two"><span>Primary locator</span><input value={newRepositoryFieldDraft.locator} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, locator: event.target.value }))} placeholder="[data-testid='email']"/></label>
                          </div>
                          <div className="testops-action-row">
                            <button className="primary-button" disabled={addRepositoryField.isPending} onClick={() => addRepositoryField.mutate()} type="button"><AddIcon /><span>{addRepositoryField.isPending ? "Adding..." : "Save field"}</span></button>
                            <button className="ghost-button" onClick={() => setIsAddingRepositoryField(false)} type="button">Cancel</button>
                          </div>
                        </div>) : null}
                      <RepositoryMembersTable members={activePageObject.members} selectedId={selectedRepositoryEntry?.id} highlightedId={highlightedRepositoryId} onSelect={id => selectRepositoryEntry(id, activePageObject.screenName)} emptyMessage="No saved fields yet. Add a field, inspect the screen, or select AI suggestions."/>
                    </div>) : null}
                  {screenDetailTab === "dom" ? (<div className="repository-evidence-block">
                      {screenScreenshotDraft && isLikelyImageUrl(screenScreenshotDraft) ? <img alt={`${activePageObject.pageName} full screen`} src={screenScreenshotDraft}/> : null}
                      <label>Full DOM / accessibility tree</label>
                      <pre>{screenDomDraft || screenInfoDraft.accessibility_tree || "No full-page DOM or accessibility snapshot captured."}</pre>
                      <small>Fingerprint: {screenInfoDraft.screen_fingerprint || "Not generated"}</small>
                    </div>) : null}
                </section>) : null}
            </div>
          </Panel>

	          {renderRepositoryConfiguration()}

	          {isRepositoryImportModalOpen ? (<div className="modal-backdrop" onClick={() => !importRepositoryEntries.isPending && setIsRepositoryImportModalOpen(false)} role="presentation">
	              <div aria-labelledby="object-repository-import-title" aria-modal="true" className="modal-card import-modal-card" onClick={(event) => event.stopPropagation()} role="dialog">
	                <div className="import-modal-header">
	                  <div className="import-modal-title">
	                    <p className="dialog-context-label">Object repository import</p>
	                    <div className="modal-title-info-row">
	                      <h2 className="dialog-title" id="object-repository-import-title">Import screens and fields</h2>
	                      <InfoTooltip content="Upload a HelloTest OR CSV, individual page object files, or a ZIP archive. CSV rows import as saved screens and fields; source files are parsed locally for Playwright, Selenium Java, C#, JavaScript, and TypeScript locators." label="Object repository import information"/>
	                    </div>
	                  </div>
	                  <button aria-label="Close object repository import dialog" className="ghost-button" disabled={importRepositoryEntries.isPending} onClick={() => setIsRepositoryImportModalOpen(false)} type="button">
	                    Close
	                  </button>
	                </div>
	                <div className="import-modal-body">
	                  <label className={isParsingRepositoryImport ? "repository-import-dropzone is-disabled" : "repository-import-dropzone"}>
	                    <ImportIcon />
	                    <strong>{isParsingRepositoryImport ? "Reading files..." : "Choose CSV, source files, or ZIP"}</strong>
	                    <span>Supported: .csv, .zip, .js, .jsx, .ts, .tsx, .java, .cs</span>
	                    <input accept=".csv,.zip,.js,.jsx,.ts,.tsx,.java,.cs,text/csv,application/zip" disabled={isParsingRepositoryImport || importRepositoryEntries.isPending} multiple onChange={(event) => void handleRepositoryImportFiles(event)} type="file"/>
	                  </label>
	                  <div className="metric-strip compact">
	                    <div className="mini-card">
	                      <strong>{repositoryImportPreview?.entries.filter((entry) => entry.record_type === "screen").length || 0}</strong>
	                      <span>Screens</span>
	                    </div>
	                    <div className="mini-card">
	                      <strong>{repositoryImportPreview?.entries.filter((entry) => entry.record_type === "field").length || 0}</strong>
	                      <span>Fields</span>
	                    </div>
	                    <div className="mini-card">
	                      <strong>{repositoryImportPreview?.fileNames.length || 0}</strong>
	                      <span>Files read</span>
	                    </div>
	                  </div>
	                  <div className="detail-summary">
	                    <strong>{repositoryImportPreview?.fileNames[0] || "No import loaded yet"}</strong>
	                    <span>{repositoryImportPreview?.fileNames.length ? `${repositoryImportPreview.fileNames.length} source item${repositoryImportPreview.fileNames.length === 1 ? "" : "s"} parsed for the selected application scope.` : "Choose input above to preview normalized repository records before saving."}</span>
	                  </div>
	                  {repositoryImportPreview?.inputKinds.length ? (<div className="repository-import-metrics metric-strip" aria-label="Repository import metrics" role="group">
	                      {repositoryImportPreview.inputKinds.map((kind) => <StatusBadge key={kind} value={getRepositoryImportKindLabel(kind)}/>)}
	                    </div>) : null}
	                  {repositoryImportPreview?.warnings.length ? (<div className="empty-state compact">
	                      {repositoryImportPreview.warnings.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}
	                    </div>) : null}
	                  {repositoryImportPreview?.entries.length ? (<div className="repository-import-preview-list">
	                      {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").slice(0, 8).map((entry) => (<article key={`${entry.screen_name}-${entry.object_name}-${entry.locator}`}>
	                          <strong>{entry.screen_name}.{entry.object_name}</strong>
	                          <code>{entry.locator}</code>
	                        </article>))}
	                      {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").length > 8 ? (<small>And {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").length - 8} more fields.</small>) : null}
	                    </div>) : null}
	                </div>
	                <div className="action-row import-modal-actions">
	                  <button className="primary-button" disabled={!repositoryImportPreview?.entries.length || importRepositoryEntries.isPending} onClick={() => importRepositoryEntries.mutate()} type="button">
	                    <ImportIcon />
	                    <span>{importRepositoryEntries.isPending ? "Importing..." : `Import ${repositoryImportPreview?.entries.length || ""} OR records`}</span>
	                  </button>
	                  <button className="ghost-button" disabled={!repositoryImportPreview || importRepositoryEntries.isPending} onClick={() => setRepositoryImportPreview(null)} type="button">
	                    Clear preview
	                  </button>
	                </div>
	              </div>
	            </div>) : null}


	          {isInspectOpen ? (<div className="modal-backdrop" role="presentation">
              <div className={`dialog object-repository-inspector${isInspectBrowserMaximized ? " is-browser-maximized" : ""}`} ref={repositoryInspectorRef} role="dialog" aria-modal="true" aria-label="Object repository inspector" tabIndex={-1}>
                <div className="dialog-header object-repository-inspector-header">
                  <div className="object-repository-inspector-title">
                    <h2>HelloTest Live builder</h2>
                    <span className={inspectRecorderSession?.status === "running" ? "is-connected" : ""}>{inspectRecorderSession?.status === "running" ? `${inspectSessionMode === "local" ? "Local" : "Remote"} session connected` : "Choose a browser session"}</span>
                  </div>
                  <div className="object-repository-inspector-toolbar" aria-label="Inspector controls">
                    <RepositoryInspectSessionControls mode={inspectSessionMode} recommendedMode={recommendedInspectMode} localConnected={inspectAgent.state === "connected"} remoteAvailable={inspectCapabilities.data?.remote?.available === true} remoteReason={inspectCapabilities.error instanceof Error ? inspectCapabilities.error.message : inspectCapabilities.data?.remote?.reason || (inspectCapabilities.isFetching ? "Checking remote browser availability…" : undefined)} busy={isLaunchingInspectBrowser || isClosingInspectBrowser} disabled={!canInspectRepository} running={inspectRecorderSession?.status === "running"} onStart={mode => void launchInspectBrowser(mode).catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start inspection browser."))} onStartBlank={mode => void launchInspectBrowser(mode, "").catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start a blank inspection browser."))} onClose={() => void closeInspectBrowser().catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to close inspection browser."))} onSetup={inspectAgent.openSetup}/>
                    {canInspectRepository ? (<button aria-label={isInspectingLiveField ? "Stop selecting fields" : "Select fields"} title={isInspectingLiveField ? "Stop selecting fields" : "Select fields"} aria-pressed={isInspectingLiveField} className={isInspectingLiveField ? "primary-button compact is-active" : "primary-button compact"} disabled={!canInspectRepository || saveInspectedScreenFields.isPending || isClosingInspectBrowser || (!inspectRecorderSession?.id && isLaunchingInspectBrowser)} onClick={() => void (isInspectingLiveField ? stopLiveInspect() : startLiveInspect()).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to update inspect mode."))} type="button">
                      {isInspectingLiveField ? <PauseIcon /> : <SelectionToggleIcon checked={false}/>}
                      <span>{isInspectingLiveField ? "Stop selecting" : "Select fields"}</span>
                    </button>) : null}
                    <button aria-label="Save screen & fields" className="primary-button compact" disabled={saveInspectedScreenFields.isPending} onClick={() => saveInspectedScreenFields.mutate()} type="button">
                      <LayersIcon />
                      <span>{saveInspectedScreenFields.isPending ? "Saving..." : `Save${stagedInspectFields.length ? ` (${stagedInspectFields.length})` : " screen"}`}</span>
                    </button>
                    {canUseAutomationAi || dismissedInspectLocators.length ? <details className="object-repository-inspector-more">
                      <summary aria-label="More inspector actions" className="ghost-button compact" title="More actions">
                        <IconDots aria-hidden="true" size={18}/>
                        <span>More</span>
                      </summary>
                      <div className="object-repository-inspector-more-menu">
                        {canUseAutomationAi ? <button className="ghost-button compact" disabled={(!screenDomDraft && !screenScreenshotDraft) || extractRepositoryFields.isPending} onClick={() => extractRepositoryFields.mutate()} type="button"><SparkIcon /><span>{extractRepositoryFields.isPending ? "Suggesting..." : "Suggest fields with AI"}</span></button> : null}
                        {dismissedInspectLocators.length ? <button className="ghost-button compact" onClick={restoreDismissedInspectFields} type="button"><RefreshIcon /><span>Restore hidden ({dismissedInspectLocators.length})</span></button> : null}
                      </div>
                    </details> : null}
                    <DialogCloseButton label="Close object repository inspector" onClick={closeRepositoryInspector}/>
                  </div>
                </div>
                <div className="object-repository-inspector-body">
                <section className="object-repository-live-inspect">
                  <div className="object-repository-live-inspect-body">
                  <div className="object-repository-capture-workspace">
                    <section className="object-repository-browser-preview">
                      {inspectRecorderSession?.status !== "running" ? <label className="repository-inspect-destination">
                        <span>Page URL</span>
                        <input aria-label="Inspection page URL" type="text" inputMode="url" placeholder="https://your-application.com" value={screenUrlDraft} disabled={isLaunchingInspectBrowser} onChange={event => setScreenUrlDraft(event.target.value)}/>
                        <small>Local sessions use this computer’s network. Remote sessions use the Test Engine’s network. Replace demo addresses with your application URL, or open a blank browser.</small>
                      </label> : null}
                      <RepositoryInspectBrowser tabs={inspectTabs} selectedTabId={selectedInspectTabId} onSelectTab={(tabId) => void selectInspectTab(tabId).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to select browser tab."))} onRefreshTabs={() => void refreshInspectTabs().catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to refresh browser tabs."))} isRefreshingTabs={isRefreshingInspectTabs} sessionId={inspectRecorderSession?.status === "running" ? inspectRecorderSession.id : ""} liveUrl={inspectRecorderSession?.status === "running" ? inspectRecorderLiveUrl : ""} emptyMessage={inspectCapabilities.isError ? "Remote browser availability could not be checked. Reopen the inspector to retry, or connect your local agent from the browser session menu." : inspectCapabilities.data?.remote?.available === false && inspectAgent.state !== "connected" ? `${inspectCapabilities.data?.remote?.reason || "Remote browser is unavailable."} Choose Local session to connect an agent on this computer.` : undefined}/>
                      {focusedInspectField && focusedInspectPrimaryLocator ? (<div className="object-repository-browser-locator-dock has-selection" aria-live="polite">
                            <span className="object-repository-locator-dock-icon"><IconTargetArrow aria-hidden="true" size={18}/></span>
                            <div className="object-repository-locator-dock-copy">
                              <span><strong>{focusedInspectField.name}</strong><small>{focusedInspectPrimaryLocator.strategy}</small></span>
                              <code title={focusedInspectPrimaryLocator.locator}>{focusedInspectPrimaryLocator.locator}</code>
                            </div>
                            <div className="object-repository-locator-health" title={focusedInspectPrimaryLocator.warning || "Validate this locator against the live page"}>
                              <IconShieldCheck aria-hidden="true" size={16}/>
                              <span>{focusedInspectPrimaryLocator.matchCount === 1 ? "Unique" : focusedInspectPrimaryLocator.matchCount ? `${focusedInspectPrimaryLocator.matchCount} matches` : "Unchecked"}</span>
                            </div>
                            <div className="object-repository-locator-dock-actions">
                              <button className="ghost-button compact" onClick={() => void navigator.clipboard?.writeText(focusedInspectPrimaryLocator.locator)} type="button"><CopyIcon size={15}/><span>Copy</span></button>
                              <button className={highlightedInspectLocator === focusedInspectPrimaryLocator.locator ? "ghost-button compact is-active" : "ghost-button compact"} disabled={!inspectRecorderSession?.id} onClick={() => void highlightRepositoryLocator(focusedInspectPrimaryLocator.locator, focusedInspectField.name).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight locator."))} type="button"><MousePointerIcon size={15}/><span>{highlightedInspectLocator === focusedInspectPrimaryLocator.locator ? "Highlighted · 3s" : "Highlight · 3s"}</span></button>
                            </div>
                        </div>) : null}
                    </section>
                  </div>
                  {inspectMessage ? <div className="object-repository-inspect-message" role="status">{inspectMessage}</div> : null}
                  </div>
                </section>
                <div className="object-repository-properties-toggle">
                  <button aria-label={isInspectBrowserMaximized ? "Show Page Object properties" : "Hide Page Object properties"} aria-controls="object-repository-properties" aria-expanded={!isInspectBrowserMaximized} onClick={() => setIsInspectBrowserMaximized((current) => !current)} title={isInspectBrowserMaximized ? "Show Page Object properties" : "Hide Page Object properties"} type="button"><span aria-hidden="true">{isInspectBrowserMaximized ? "‹" : "›"}</span></button>
                </div>
                <aside className="object-repository-inspector-review" id="object-repository-properties" aria-label="Page Object properties" hidden={isInspectBrowserMaximized}>
                  <div className="object-repository-properties-heading"><h3>Page Object properties</h3></div>
                  <SubnavTabs ariaLabel="Inspector review" className="object-repository-inspector-review-tabs" value={inspectReviewTab} onChange={setInspectReviewTab} items={[
                { value: "candidates", label: "All fields", meta: String(inspectFieldInventory.length) },
                { value: "selected", label: "Selected", meta: String(stagedInspectFields.length) },
                { value: "evidence", label: "Evidence", meta: screenDomDraft || screenScreenshotDraft ? "1" : "0" }
            ]}/>
                  {inspectReviewTab === "selected" ? (<section className="object-repository-selected-fields object-repository-review-panel">
                    <div className="object-repository-inspector-section-head object-repository-selected-fields-head">
                      <span>
                        <strong>Selected fields <span className="selection-count">{stagedInspectFields.length}</span></strong>
                      </span>
                      <div className="object-repository-selection-actions">
                        <button className="ghost-button compact" disabled={!stagedInspectFields.length || !inspectRecorderSession?.id || validateInspectedFields.isPending || saveInspectedScreenFields.isPending} onClick={() => validateInspectedFields.mutate()} type="button"><IconShieldCheck aria-hidden="true" size={14}/><span>{validateInspectedFields.isPending ? "Checking…" : "Validate"}</span></button>
                        <button className="ghost-button compact" disabled={!stagedInspectFields.length || !inspectRecorderSession?.id} onClick={() => void syncInspectHighlights(stagedInspectFields, []).then(() => setInspectMessage("Highlighted selected fields for 3 seconds.")).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to preview selected fields."))} type="button"><MousePointerIcon size={14}/><span>Highlight all</span></button>
                        <button aria-label="Clear selected fields" className="ghost-button compact danger" disabled={!stagedInspectFields.length} onClick={removeAllStagedInspectFields} title="Clear selected fields" type="button"><TrashIcon size={14}/></button>
                      </div>
                    </div>
                    {focusedSelectedInspectField ? (<div className="object-repository-selected-editor" aria-label={`Edit ${focusedSelectedInspectField.name}`}>
                        <label><span>Name</span><input value={focusedSelectedInspectField.name} onChange={(event) => updateStagedInspectField(focusedSelectedInspectField.locator, { name: event.target.value })}/></label>
                        <label><span>Primary locator</span><select value={focusedSelectedInspectField.locator} onChange={(event) => updateStagedInspectField(focusedSelectedInspectField.locator, { locator: event.target.value })}>{(focusedSelectedInspectField.locatorCandidates?.length ? focusedSelectedInspectField.locatorCandidates : [{ locator: focusedSelectedInspectField.locator, strategy: focusedSelectedInspectField.locatorKind, confidenceScore: 0.75, matchCount: undefined }]).map((candidate) => <option key={candidate.locator} value={candidate.locator}>{candidate.strategy} · {candidate.matchCount === 1 ? "unique" : candidate.matchCount ? `${candidate.matchCount} matches` : "Not validated"} · {candidate.locator}</option>)}</select></label>
                        <RepositoryLocatorBuilder key={focusedSelectedInspectField.locator} dom={focusedSelectedInspectField.dom} ancestorDom={focusedSelectedInspectField.ancestorDom} locator={focusedSelectedInspectField.locator} onUse={(locator) => updateStagedInspectField(focusedSelectedInspectField.locator, { locator, locatorKind: inferLocatorStrategy(locator) })}/>
                      </div>) : null}
                    <div className="object-repository-selected-grid">
                      {stagedInspectFields.map((field) => {
                    const locatorHealth = field.locatorCandidates?.[0];
                    const validationStatus = field.validationStatus || (locatorHealth?.matchCount === 1 ? "unique" : (locatorHealth?.matchCount || 0) > 1 ? "ambiguous" : "unverified");
                    const needsRepair = !["unique", "unverified"].includes(validationStatus);
                    return (<article className={[focusedInspectField?.locator === field.locator ? "is-focused" : "", needsRepair ? "needs-repair" : ""].filter(Boolean).join(" ")} key={field.locator} onClick={() => setFocusedInspectLocator(field.locator)}>
                            <div>
                              <button aria-pressed={focusedInspectField?.locator === field.locator} className="link-button object-repository-selected-field-name" onClick={() => setFocusedInspectLocator(field.locator)} type="button">{field.name}</button>
                              <small>{field.locatorKind} · {locatorHealth?.matchCount === 1 ? "unique" : locatorHealth?.matchCount ? `${locatorHealth.matchCount} matches` : field.tag} · {field.locator}</small>
                            </div>
                            <span className={`object-repository-validation-pill is-${validationStatus}`} title={field.validationWarning || locatorHealth?.warning || "Use Validate to check this locator on the current page"}>
                              {validationStatus === "unique" ? "Unique" : validationStatus === "ambiguous" ? `${locatorHealth?.matchCount || 2}+ matches` : validationStatus === "missing" ? "Not found" : "Not validated"}
                            </span>
                            <div className="object-repository-field-actions">
                              {needsRepair ? (<>
                                  <button className="ghost-button compact" onClick={(event) => { event.stopPropagation(); void reinspectField(field).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to reinspect the field.")); }} type="button"><MousePointerIcon size={14}/><span>{reinspectFieldLocator === field.locator ? "Click in browser" : "Reinspect"}</span></button>
                                  <button className="ghost-button compact" disabled={repairInspectedFieldWithAi.isPending} onClick={(event) => { event.stopPropagation(); repairInspectedFieldWithAi.mutate(field); }} type="button"><SparkIcon size={14}/><span>{repairInspectedFieldWithAi.isPending && repairInspectedFieldWithAi.variables?.locator === field.locator ? "Fixing..." : "Fix with AI"}</span></button>
                                </>) : (<button className="ghost-button compact" onClick={(event) => { event.stopPropagation(); void highlightRepositoryLocator(field.locator, field.name, "", { retainExisting: true }).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight selected field.")); }} type="button"><MousePointerIcon size={14}/><span>Highlight</span></button>)}
                              <button className="ghost-button compact danger" onClick={(event) => { event.stopPropagation(); removeStagedInspectField(field.locator); }} type="button"><TrashIcon size={14}/><span>Remove</span></button>
                            </div>
                          </article>);
                })}
                      {!stagedInspectFields.length ? <div className="empty-state compact">Select captured or suggested fields to save.</div> : null}
                    </div>
                  </section>) : null}
                  {inspectReviewTab === "evidence" ? (<div className="object-repository-inspector-inputs">
                    <details className="object-repository-static-evidence object-repository-review-panel" open>
                      <summary>
                        <span>
                          <strong>Screen evidence</strong>
                          <small>{screenInfoDraft.screen_name || activeScreenName || "Screen identity"}</small>
                        </span>
                      </summary>
                      <label className="form-field">
                        <span>Page URL</span>
                        <input value={screenUrlDraft} onChange={(event) => setScreenUrlDraft(event.target.value)} placeholder="https://app.example.com/login"/>
                      </label>
                      <label className="form-field">
                        <span>URL match rule</span>
                        <div className="repository-url-rule"><select value={screenInfoDraft.url_pattern_type} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={screenInfoDraft.url_pattern_value} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login"/></div>
                      </label>
                      <label className="form-field">
                        <span>Intended flow / business meaning</span>
                        <textarea rows={3} value={screenInfoDraft.business_meaning} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Sign in, recover password, or continue as guest."/>
                      </label>
                      <label className="form-field">
                        <span>Description</span>
                        <RichTextEditor appearance="canonical" rows={3} value={screenInfoDraft.description} onChange={(description) => setScreenInfoDraft((current) => ({ ...current, description }))} placeholder="Purpose and boundaries of this screen."/>
                      </label>
                      <details className="object-repository-advanced-evidence">
                        <summary>Captured evidence</summary>
                      <div className="object-repository-evidence-preview">
                        {screenScreenshotDraft && isLikelyImageUrl(screenScreenshotDraft) ? <img alt="Latest inspected screen capture" src={screenScreenshotDraft}/> : <div className="empty-state compact">No screen capture yet.</div>}
                        <div>
                          <span><strong>{screenDomDraft.length.toLocaleString()}</strong> DOM characters</span>
                          <span><strong>{screenInfoDraft.screen_fingerprint ? "Ready" : "Pending"}</strong> fingerprint</span>
                          <span><strong>{screenInfoDraft.accessibility_tree ? "Ready" : "Pending"}</strong> accessibility tree</span>
                        </div>
                      </div>
                      <label className="form-field">
                        <span>Screen DOM</span>
                        <textarea rows={10} value={screenDomDraft} onChange={(event) => setScreenDomDraft(event.target.value)} placeholder="<input name='username' aria-label='Username' />"/>
                      </label>
                      </details>
                    </details>
                  </div>) : null}
                  {inspectReviewTab === "candidates" ? (<section className="object-repository-inspector-preview object-repository-review-panel">
                      <div className="object-repository-inspector-section-head object-repository-field-inventory-head">
                        <strong>Recognized fields <span className="selection-count">{inspectFieldInventory.length}</span></strong>
                        {browserInspectFields.length ? <button className="ghost-button compact" onClick={selectAllBrowserInspectFields} type="button"><SelectionToggleIcon checked/><span>Select captured</span></button> : null}
                      </div>
                      <div className="object-repository-suggestion-list">
                      {inspectFieldInventory.map((field) => {
                    const isSelected = selectedInspectLocatorSet.has(field.locator) || selectedInspectLocatorSet.has(repositoryLocatorIdentity(field.locator));
                    const locatorHealth = field.locatorCandidates?.[0];
                    const sourceLabel = field.source === "live_inspect" ? "Captured" : field.source === "ai_extract" ? "AI suggested" : "DOM detected";
                    const validationStatus = field.validationStatus || (locatorHealth?.matchCount === 1 ? "unique" : (locatorHealth?.matchCount || 0) > 1 ? "ambiguous" : "unverified");
                    const validationLabel = validationStatus === "unique"
                        ? "Unique"
                        : validationStatus === "ambiguous" ? `${locatorHealth?.matchCount || 2}+ matches`
                            : validationStatus === "missing" ? "Not found" : "Not validated";
                    return (<article className={`object-repository-inspector-candidate${isSelected ? " is-selected" : ""}${highlightedInspectLocator === field.locator ? " is-highlighted" : ""}`} key={`${field.name}-${field.locator}`}>
                            <button className="object-repository-candidate-main" onClick={() => focusInspectField(field)} type="button">
                              <span className="object-repository-candidate-title">
                                <strong>{field.name}</strong>
                                <span className={`object-repository-source-pill is-${field.source || "dom_candidate"}`}>{sourceLabel}</span>
                                <span className={`object-repository-validation-pill is-${validationStatus}`} title={field.validationWarning || locatorHealth?.warning || "Use Validate to check this locator on the current page"}>{validationLabel}</span>
                              </span>
                              <small>{field.tag} · {field.locator}</small>
                            </button>
                            <div className="object-repository-candidate-actions">
                              <button aria-label={`Highlight ${field.name}`} className="ghost-button compact" disabled={!inspectRecorderSession?.id} onClick={() => void highlightRepositoryLocator(field.locator, field.name).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight field."))} title="Highlight in browser" type="button"><MousePointerIcon size={14}/></button>
                              <label className="repository-field-check"><input type="checkbox" aria-label={`Select ${field.name}`} checked={isSelected} onChange={(event) => event.target.checked ? stageInspectField(field) : removeStagedInspectField(field.locator)}/><span>{isSelected ? "Selected" : "Select"}</span></label>
                              {!isSelected ? <button aria-label={`Hide ${sourceLabel.toLowerCase()} field ${field.name}`} className="ghost-button compact danger" onClick={() => dismissInspectField(field)} title="Hide from this inspection" type="button"><TrashIcon size={14}/></button> : null}
                            </div>
                          </article>);
                })}
                      {!inspectFieldInventory.length ? <div className="empty-state compact">Select fields in the browser or run AI suggest.</div> : null}
                      </div>
                    </section>) : null}
                </aside>
                </div>
              </div>
            </div>) : null}
        </div>)}

      {repositoryUsageBlock ? (<div className="modal-backdrop" role="presentation">
          <div className="dialog object-repository-usage-dialog" role="dialog" aria-modal="true" aria-label="Repository usage">
            <div className="dialog-header">
              <div>
                <div className="modal-title-info-row">
                  <h2>{repositoryUsageBlock.title}</h2>
                  <InfoTooltip content="This repository object is referenced by the test cases below. Deleting it will keep the cases, mark automated ones incomplete, and prevent execution until their bindings are repaired." label="Repository usage information"/>
                </div>
              </div>
              <button className="ghost-button compact" onClick={() => setRepositoryUsageBlock(null)} type="button">Close</button>
            </div>
            <div className="stack-list">
              {repositoryUsageBlock.usage.map((testCase) => (<button className="stack-item" key={testCase.id} onClick={() => navigate(testCase.automated === "yes" ? `/automation?case=${encodeURIComponent(testCase.id)}` : `/test-cases?case=${encodeURIComponent(testCase.id)}`)} type="button">
                  <div>
                    <strong>{testCase.title}</strong>
                    <span>{testCase.display_id || testCase.id} · {testCase.automated === "yes" ? "Automation case" : "Manual case"}</span>
                  </div>
                  <OpenIcon size={16}/>
                </button>))}
            </div>
            <div className="testops-action-row">
              <button className="primary-button danger" disabled={deleteRepositoryEntry.isPending || deleteRepositoryScreen.isPending} onClick={() => repositoryUsageBlock.kind === "field" ? deleteRepositoryEntry.mutate(true) : deleteRepositoryScreen.mutate(true)} type="button">
                <TrashIcon size={16}/>
                <span>Delete and mark incomplete</span>
              </button>
              <button className="ghost-button" onClick={() => setRepositoryUsageBlock(null)} type="button">Cancel</button>
            </div>
          </div>
        </div>) : null}
    </div>);
}
