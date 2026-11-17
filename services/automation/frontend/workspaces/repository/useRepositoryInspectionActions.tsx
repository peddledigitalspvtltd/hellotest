import { changeRepositoryFieldLocator, sameRepositoryLocator } from "../../lib/repositoryLocators";
import { type InspectSessionMode } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { loadRepositoryInspectTabs, normalizeRepositoryInspectStartUrl, stopRepositoryInspectSession } from "@hellotest/automation/frontend/lib/repositoryInspectSession";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { mergeInspectedFields } from "@hellotest/automation/frontend/lib/repositoryWorkspace";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import {RepositoryExtractedField,formatLocatorDraft,getRecorderEngineBaseUrl,readInspectSessionJson,readRecorderJson,connectLocalInspectSession,RecorderInspectResult,inferScreenName,inferUrlPattern,getInspectSelections,buildRepositoryFieldFromInspectSelection,getCapturedLocatorsForElement,getCapturedLocators,makeRepositoryScreenKey,REPOSITORY_HIGHLIGHT_DURATION_MS} from '../../lib/automationWorkspaceSupport';
import type {SessionPayload} from '@hellotest/platform/frontend/src/types';
import type {RepositoryWorkspaceScope} from './repositoryWorkspaceTypes';
import type {RepositoryWorkspaceState} from './useRepositoryWorkspaceState';
import type {RepositoryWorkspaceQueries} from './useRepositoryWorkspaceQueries';
import type {RepositoryWorkspaceModel} from './useRepositoryWorkspaceModel';
type InspectionPorts=RepositoryWorkspaceScope&RepositoryWorkspaceState&RepositoryWorkspaceQueries&RepositoryWorkspaceModel&{session:SessionPayload|null;canInspectRepository:boolean;recommendedInspectMode:InspectSessionMode};
export function useRepositoryInspectionActions(ports:InspectionPorts){
const {
    message,
    inspectRecorderSession,
    setInspectRecorderSession,
    setIsLaunchingInspectBrowser,
    setIsClosingInspectBrowser,
    setIsRefreshingInspectTabs,
    setInspectPreviewRevision,
    inspectSessionRef,
    inspectSessionGenerationRef,
    inspectTabRequestRef,
    inspectTabActionCountRef,
    inspectLifecycleBusyRef,
    setHighlightedRepositoryId,
    setSelectedScreenName,
    isInspectOpen,
    setIsInspectOpen,
    setIsInspectBrowserMaximized,
    setInspectSessionMode,
    setInspectReviewTab,
    inspectTabs,
    setInspectTabs,
    selectedInspectTabId,
    setSelectedInspectTabId,
    selectedInspectTabIdRef,
    isInspectingLiveField,
    setIsInspectingLiveField,
    setInspectMessage,
    browserInspectFields,
    setBrowserInspectFields,
    setAiSuggestedInspectFields,
    stagedInspectFields,
    setStagedInspectFields,
    dismissedInspectLocators,
    setDismissedInspectLocators,
    setReinspectFieldLocator,
    reinspectFieldLocatorRef,
    focusedInspectLocator,
    setFocusedInspectLocator,
    setHighlightedInspectLocator,
    stagedInspectFieldsRef,
    highlightClearTimerRef,
    inspectPollPromiseRef,
    inspectStopInProgressRef,
    screenDomDraft,
    setScreenDomDraft,
    screenScreenshotDraft,
    setScreenScreenshotDraft,
    screenUrlDraft,
    setScreenUrlDraft,
    screenInfoDraft,
    setScreenInfoDraft,
    setRepositoryDraft,
    inspectAgent,
    activeScreenName,
    activeRepositoryAppTypeId,
    activeRepositoryProjectId,
    recommendedInspectMode,
    canInspectRepository,
    session,
    projectId,
    appTypeId,
} = ports;
const closeRepositoryInspector = () => {
    if (inspectLifecycleBusyRef.current) {
        // A browser that finishes starting after dismissal is closed by the
        // generation check in launchInspectBrowser.
        ++inspectSessionGenerationRef.current;
    }
    else {
        void closeInspectBrowser().catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to close inspection browser."));
    }
    clearInspectHighlights();
    setIsInspectBrowserMaximized(false);
    setIsInspectOpen(false);
};
const repositoryInspectorRef = useDialogFocus<HTMLDivElement>({
    active: isInspectOpen,
    onClose: closeRepositoryInspector
});
const focusInspectField = (field: RepositoryExtractedField) => {
    setFocusedInspectLocator(field.locator);
    setRepositoryDraft((current) => ({
        ...current,
        object_name: field.name,
        object_role: `${field.tag} / ${field.role}`,
        locator: field.locator,
        locator_kind: field.locatorKind,
        fallback_locators: formatLocatorDraft([
            { locator: field.locator, strategy: field.locatorKind, confidenceScore: field.locatorCandidates?.[0]?.confidenceScore || 0.8, isPrimary: true },
            ...field.fallbackLocators
        ]),
        dom_structure: field.dom,
        description: current.description || `${field.name} ${field.source === "live_inspect" ? "captured from live inspect" : "detected from screen evidence"}.`,
        screenshot_url: field.elementScreenshotUrl || screenScreenshotDraft || current.screenshot_url
    }));
    if (inspectRecorderSession?.status === "running") {
        void highlightRepositoryLocator(field.locator, field.name, "", { silent: true })
            .catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight field."));
    }
};
const stageInspectField = (field: RepositoryExtractedField) => {
    const selected = stagedInspectFieldsRef.current;
    let nextField = field;
    const collision = selected.find(item => sameRepositoryLocator(item.locator, field.locator)
        && (item.sourceLocator || item.locator) !== field.locator);
    if (collision) {
        const alternative = (field.locatorCandidates || []).find(candidate => !selected.some(item => sameRepositoryLocator(item.locator, candidate.locator)));
        if (!alternative) {
            setInspectMessage(`${field.name} shares its locator with ${collision.name}. Choose a distinct validated locator before selecting both fields.`);
            return;
        }
        nextField = { ...field, sourceLocator: field.sourceLocator || field.locator,
            ...changeRepositoryFieldLocator(field, alternative.locator, alternative.strategy) };
    }
    const isExistingSelection = selected.some((item) => (item.sourceLocator || item.locator) === (nextField.sourceLocator || nextField.locator));
    setStagedInspectFields((current) => {
        const existingIndex = current.findIndex((item) => (item.sourceLocator || item.locator) === (nextField.sourceLocator || nextField.locator));
        if (existingIndex < 0) {
            const next = [...current, nextField];
            stagedInspectFieldsRef.current = next;
            return next;
        }
        const next = current.map((item, index) => index === existingIndex ? { ...item, ...nextField } : item);
        stagedInspectFieldsRef.current = next;
        return next;
    });
    setFocusedInspectLocator(nextField.locator);
    setInspectMessage(`${isExistingSelection ? "Updated" : "Selected"} ${field.name}${nextField.locator !== field.locator ? " with a distinct alternate locator" : ""}. Remove unwanted fields or save the selected set.`);
};
const updateStagedInspectField = (currentLocator: string, patch: Partial<RepositoryExtractedField>) => {
    const nextLocator = patch.locator || currentLocator;
    setStagedInspectFields((current) => {
        const next = current.map((field) => {
            if (field.locator !== currentLocator)
                return field;
            const merged = { ...field, sourceLocator: field.sourceLocator || currentLocator, ...patch };
            if (patch.locator && patch.locator !== currentLocator) {
                Object.assign(merged, changeRepositoryFieldLocator({ ...merged, locator: field.locator, locatorKind: field.locatorKind }, patch.locator, merged.locatorKind));
            }
            return merged;
        });
        stagedInspectFieldsRef.current = next;
        return next;
    });
    setFocusedInspectLocator(nextLocator);
};
const clearInspectHighlights = () => {
    const baseUrl = getRecorderEngineBaseUrl(inspectRecorderSession);
    const pageId = selectedInspectTabId || inspectTabs.find((tab) => tab.active)?.id || inspectTabs[0]?.id || "";
    if (!inspectRecorderSession?.id || !baseUrl || !pageId) {
        return;
    }
    void readInspectSessionJson(inspectRecorderSession, "/highlight", {
        method: "POST",
        body: JSON.stringify({ page_id: pageId, clear_existing: true })
    }).catch(() => null);
};
const loadInspectTabs = async (sessionOverride?: RecorderSessionResponse | null, options: {
    activate?: boolean;
    selectedPageId?: string;
    refreshPreview?: boolean;
} = {}) => {
    const targetSession = sessionOverride || inspectSessionRef.current;
    if (!targetSession?.id)
        throw new Error("Connect an inspection browser before selecting a tab.");
    const generation = inspectSessionGenerationRef.current;
    const requestId = ++inspectTabRequestRef.current;
    const { tabs, pageId } = await loadRepositoryInspectTabs(targetSession, options.selectedPageId ?? selectedInspectTabIdRef.current, readRecorderJson, options.activate);
    if (generation !== inspectSessionGenerationRef.current || requestId !== inspectTabRequestRef.current || inspectSessionRef.current?.id !== targetSession.id)
        return tabs;
    setInspectTabs(tabs);
    selectedInspectTabIdRef.current = pageId;
    setSelectedInspectTabId(pageId);
    if (options.refreshPreview)
        setInspectPreviewRevision((current) => current + 1);
    return tabs;
};
const refreshInspectTabs = async () => {
    if (inspectLifecycleBusyRef.current)
        return;
    const generation = inspectSessionGenerationRef.current;
    inspectTabActionCountRef.current += 1;
    setIsRefreshingInspectTabs(true);
    try {
        const previousPageId = selectedInspectTabIdRef.current;
        const tabs = await loadInspectTabs(undefined, { activate: true, refreshPreview: true });
        if (previousPageId !== selectedInspectTabIdRef.current)
            setIsInspectingLiveField(false);
        if (generation === inspectSessionGenerationRef.current)
            setInspectMessage(tabs.length ? "" : "No browser tabs are available. Reopen the browser to continue.");
    }
    finally {
        inspectTabActionCountRef.current -= 1;
        setIsRefreshingInspectTabs(inspectTabActionCountRef.current > 0);
    }
};
const selectInspectTab = async (pageId: string) => {
    if (inspectLifecycleBusyRef.current)
        return;
    const generation = inspectSessionGenerationRef.current;
    inspectTabActionCountRef.current += 1;
    setIsRefreshingInspectTabs(true);
    try {
        if (isInspectingLiveField)
            await stopLiveInspect();
        await loadInspectTabs(undefined, { activate: true, selectedPageId: pageId, refreshPreview: true });
        if (generation === inspectSessionGenerationRef.current)
            setInspectMessage("");
    }
    finally {
        inspectTabActionCountRef.current -= 1;
        setIsRefreshingInspectTabs(inspectTabActionCountRef.current > 0);
    }
};
const launchInspectBrowser = async (requestedMode: InspectSessionMode = recommendedInspectMode, destination?: string) => {
    if (!canInspectRepository)
        throw new Error("Object repository management permission is required to inspect a browser.");
    if (inspectLifecycleBusyRef.current)
        return inspectSessionRef.current;
    const inspectionStartUrl = normalizeRepositoryInspectStartUrl(destination === undefined ? screenUrlDraft : destination);
    inspectLifecycleBusyRef.current = true;
    setIsLaunchingInspectBrowser(true);
    setInspectMessage(requestedMode === "local" ? "Connecting to your local inspection agent…" : "Starting a remote inspection browser in the Test Engine…");
    let generation = inspectSessionGenerationRef.current;
    let createdSession: RecorderSessionResponse | null = null;
    try {
        const currentSession = inspectSessionRef.current;
        if (currentSession?.status === "running") {
            try {
                const tabs = await loadInspectTabs(currentSession, { activate: true, refreshPreview: true });
                if (tabs.length) {
                    setInspectMessage("");
                    return currentSession;
                }
            }
            catch (error) {
                // A stopped, expired, or disconnected session must not prevent reopening.
                if (generation !== inspectSessionGenerationRef.current)
                    throw error;
            }
            await stopRepositoryInspectSession(currentSession, readRecorderJson).catch(() => null);
        }
        generation = ++inspectSessionGenerationRef.current;
        setIsInspectingLiveField(false);
        inspectSessionRef.current = null;
        setInspectRecorderSession(null);
        setInspectTabs([]);
        let connectedSession: RecorderSessionResponse;
        if (requestedMode === "local") {
            const runtime = await inspectAgent.check();
            if (!runtime) {
                inspectAgent.openSetup();
                throw new Error("Connect your local inspection agent, or choose a remote browser session.");
            }
            const session = await readRecorderJson<RecorderSessionResponse>(`${runtime.publicBaseUrl}/api/v1/recorder/sessions`, {
                method: "POST",
                headers: { "X-HelloTest-Agent-Token": runtime.token },
                body: JSON.stringify({ start_url: inspectionStartUrl, reuse_existing: false, purpose: "repository-inspect" }),
                signal: AbortSignal.timeout(90000)
            });
            if (!session)
                throw new Error("The local agent did not return an inspection browser session.");
            connectedSession = connectLocalInspectSession(runtime, session);
        }
        else {
            connectedSession = await api.repositoryInspection.start({
                project_id: activeRepositoryProjectId || projectId,
                app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
                start_url: inspectionStartUrl
            });
        }
        createdSession = connectedSession;
        if (generation !== inspectSessionGenerationRef.current) {
            await stopRepositoryInspectSession(connectedSession, readRecorderJson).catch(() => null);
            return null;
        }
        setInspectSessionMode(requestedMode);
        inspectSessionRef.current = connectedSession;
        setInspectRecorderSession(connectedSession);
        selectedInspectTabIdRef.current = "";
        setSelectedInspectTabId("");
        const tabs = await loadInspectTabs(connectedSession, { activate: true, refreshPreview: true });
        setInspectMessage(tabs.length ? "" : "Browser ready. Navigate to a page, then refresh tabs.");
        return connectedSession;
    }
    catch (error) {
        if (createdSession)
            await stopRepositoryInspectSession(createdSession, readRecorderJson).catch(() => null);
        if (generation === inspectSessionGenerationRef.current) {
            inspectSessionRef.current = null;
            setInspectRecorderSession(null);
            setInspectTabs([]);
            selectedInspectTabIdRef.current = "";
            setSelectedInspectTabId("");
            setIsInspectingLiveField(false);
        }
        throw error;
    }
    finally {
        inspectLifecycleBusyRef.current = false;
        setIsLaunchingInspectBrowser(false);
    }
};
const closeInspectBrowser = async () => {
    if (inspectLifecycleBusyRef.current)
        return;
    const targetSession = inspectSessionRef.current;
    if (!targetSession)
        return;
    inspectLifecycleBusyRef.current = true;
    setIsClosingInspectBrowser(true);
    ++inspectSessionGenerationRef.current;
    ++inspectTabRequestRef.current;
    try {
        // Flush a captured selection before closing, without requiring a live page.
        await stopLiveInspect();
        await stopRepositoryInspectSession(targetSession, readRecorderJson);
        inspectSessionRef.current = null;
        setInspectRecorderSession(null);
        selectedInspectTabIdRef.current = "";
        setSelectedInspectTabId("");
        setInspectTabs([]);
        setIsInspectingLiveField(false);
        setHighlightedInspectLocator("");
        reinspectFieldLocatorRef.current = "";
        setReinspectFieldLocator("");
        setInspectMessage("Browser closed. Selected fields are retained; reopen the browser to continue inspecting.");
    }
    finally {
        inspectLifecycleBusyRef.current = false;
        setIsClosingInspectBrowser(false);
    }
};
const persistLiveInspectResult = async (result: RecorderInspectResult) => {
    const screenName = activeScreenName || screenInfoDraft.screen_name.trim() || inferScreenName(result.page_title, result.page_url) || "Screen";
    const urlPattern = inferUrlPattern(result.page_url);
    const selections = getInspectSelections(result);
    const fields = selections.map((selection) => buildRepositoryFieldFromInspectSelection(result, selection));
    const latestSelection = selections[selections.length - 1] || selections[0];
    const latestField = fields[fields.length - 1] || fields[0];
    const latestCandidates = latestSelection ? getCapturedLocatorsForElement(latestSelection.element) : getCapturedLocators(result);
    if (!latestSelection || !latestField) {
        return;
    }
    setScreenUrlDraft(result.page_url || screenUrlDraft);
    setScreenDomDraft(result.screen_dom || screenDomDraft);
    setScreenScreenshotDraft(result.screen_screenshot_url || screenScreenshotDraft);
    setScreenInfoDraft((current) => ({
        ...current,
        screen_name: screenName,
        url_pattern_type: urlPattern.type,
        url_pattern_value: urlPattern.value,
        screen_fingerprint: result.screen_fingerprint || current.screen_fingerprint,
        accessibility_tree: result.accessibility_tree || current.accessibility_tree
    }));
    setRepositoryDraft((current) => ({
        ...current,
        object_name: latestField.name,
        object_role: `${latestField.tag} / ${latestField.role}`,
        locator: latestField.locator,
        locator_kind: latestField.locatorKind,
        target_criteria: latestSelection.element.text || current.target_criteria,
        dom_structure: latestField.dom,
        screenshot_url: latestField.elementScreenshotUrl || current.screenshot_url,
        fallback_locators: formatLocatorDraft(latestCandidates),
        ancestor_dom: latestSelection.element.ancestor_dom || current.ancestor_dom,
        ancestor_screenshot_url: latestField.ancestorScreenshotUrl || current.ancestor_screenshot_url,
        element_screenshot_url: latestField.elementScreenshotUrl || current.element_screenshot_url,
        stability_score: String(Math.round((latestCandidates[0]?.confidenceScore || 0.75) * 100)),
        description: current.description || `${latestField.name} captured from ${screenName}.`,
        fallback_strategy: current.fallback_strategy || "Use the captured screen screenshot and nearby DOM only after locator retries fail."
    }));
    setSelectedScreenName(makeRepositoryScreenKey(screenName, activeRepositoryAppTypeId || appTypeId || undefined));
    setFocusedInspectLocator(latestField.locator);
    const locatorBeingReinspected = reinspectFieldLocatorRef.current;
    const currentFields = locatorBeingReinspected
        ? stagedInspectFieldsRef.current.filter((field) => field.locator !== locatorBeingReinspected)
        : stagedInspectFieldsRef.current;
    const mergedFields = mergeInspectedFields(currentFields, fields);
    stagedInspectFieldsRef.current = mergedFields;
    setStagedInspectFields(mergedFields);
    setDismissedInspectLocators((current) => current.filter((locator) => !fields.some((field) => field.locator === locator)));
    const completedReinspect = Boolean(reinspectFieldLocatorRef.current);
    reinspectFieldLocatorRef.current = "";
    setReinspectFieldLocator("");
    setBrowserInspectFields((current) => current.filter((field) => !fields.some((selected) => selected.locator === field.locator)));
    setInspectReviewTab(completedReinspect ? "selected" : "candidates");
    setHighlightedInspectLocator(latestField.locator);
    if (highlightClearTimerRef.current)
        window.clearTimeout(highlightClearTimerRef.current);
    highlightClearTimerRef.current = window.setTimeout(() => setHighlightedInspectLocator(""), REPOSITORY_HIGHLIGHT_DURATION_MS);
    setInspectMessage(completedReinspect
        ? `${latestField.name} was reinspected with a fresh locator and evidence. Validate it before saving.`
        : `${fields.length} field${fields.length === 1 ? "" : "s"} selected with current evidence. Review or remove fields before save.`);
};
const startLiveInspect = async () => {
    const targetSession = inspectRecorderSession?.status === "running"
        ? inspectRecorderSession
        : await launchInspectBrowser();
    const baseUrl = getRecorderEngineBaseUrl(targetSession);
    if (!targetSession?.id || !baseUrl) {
        throw new Error("Inspection browser is not available. Connect a local or remote session first.");
    }
    const tabs = await loadInspectTabs(targetSession);
    const pageId = selectedInspectTabIdRef.current || tabs.find((tab) => tab.active)?.id || tabs[0]?.id || "";
    if (!pageId) {
        throw new Error("No inspectable browser tab is available. Navigate in the opened browser, then refresh tabs.");
    }
    await readInspectSessionJson(targetSession, "/inspect/start", {
        method: "POST",
        body: JSON.stringify({ page_id: pageId || undefined })
    });
    setSelectedInspectTabId(pageId || "");
    setIsInspectingLiveField(true);
    setInspectMessage("Inspect is armed. Click any field in the selected browser tab; HelloTest will capture DOM and screenshot automatically.");
};
const reinspectField = async (field: RepositoryExtractedField) => {
    reinspectFieldLocatorRef.current = field.locator;
    setReinspectFieldLocator(field.locator);
    setFocusedInspectLocator(field.locator);
    setInspectReviewTab("selected");
    try {
        await startLiveInspect();
        setInspectMessage(`Reinspect ${field.name}: click the same control in the browser to replace its failed locator.`);
    }
    catch (error) {
        reinspectFieldLocatorRef.current = "";
        setReinspectFieldLocator("");
        throw error;
    }
};
const stopLiveInspect = async () => {
    const targetSession = inspectSessionRef.current;
    const baseUrl = getRecorderEngineBaseUrl(targetSession);
    const pageId = selectedInspectTabIdRef.current || inspectTabs.find((tab) => tab.active)?.id || inspectTabs[0]?.id || "";
    if (!targetSession?.id || !baseUrl || !pageId) {
        setIsInspectingLiveField(false);
        setInspectMessage("Inspect selection paused.");
        return null;
    }
    inspectStopInProgressRef.current = true;
    let pendingResult: RecorderInspectResult | null = null;
    try {
        // Stop new selections first, then finish the polling request which may
        // already have drained the browser's queue. Cancelling it loses clicks.
        await readInspectSessionJson(targetSession, "/inspect/stop", {
            method: "POST", body: JSON.stringify({ page_id: pageId })
        }).catch(() => null);
        await inspectPollPromiseRef.current;
        pendingResult = await readInspectSessionJson<RecorderInspectResult>(targetSession, `/inspect/result?page_id=${encodeURIComponent(pageId)}`).catch(() => null);
        if (pendingResult)
            await persistLiveInspectResult(pendingResult);
    }
    finally {
        setIsInspectingLiveField(false);
        inspectStopInProgressRef.current = false;
    }
    setInspectMessage(browserInspectFields.length
        ? "Inspect paused. Review captured fields under Candidates."
        : "Inspect paused. Start again when you want to capture more fields.");
    return pendingResult;
};
const highlightRepositoryLocator = async (locator: string, label: string, entryId = "", options: {
    retainExisting?: boolean;
    silent?: boolean;
} = {}) => {
    setIsInspectOpen(true);
    const targetSession = inspectRecorderSession?.status === "running"
        ? inspectRecorderSession
        : await launchInspectBrowser();
    const baseUrl = getRecorderEngineBaseUrl(targetSession);
    const tabs = await loadInspectTabs(targetSession);
    const pageId = selectedInspectTabIdRef.current || tabs.find((tab) => tab.active)?.id || tabs[0]?.id || "";
    if (!targetSession?.id || !baseUrl || !pageId) {
        throw new Error("Select an open browser tab before highlighting a repository field.");
    }
    await readInspectSessionJson(targetSession, "/highlight", {
        method: "POST",
        body: JSON.stringify({ page_id: pageId, locator, label, retain_existing: options.retainExisting === true })
    });
    setSelectedInspectTabId(pageId);
    setHighlightedRepositoryId(entryId);
    setFocusedInspectLocator(locator);
    setHighlightedInspectLocator(locator);
    if (highlightClearTimerRef.current)
        window.clearTimeout(highlightClearTimerRef.current);
    highlightClearTimerRef.current = window.setTimeout(() => setHighlightedInspectLocator(""), REPOSITORY_HIGHLIGHT_DURATION_MS);
    if (!options.silent) {
        setInspectMessage(`Highlighted ${label} in the selected browser tab for 3 seconds.`);
    }
};
const syncInspectHighlights = async (selectedFields: RepositoryExtractedField[], candidateFields: RepositoryExtractedField[] = browserInspectFields) => {
    if (!inspectRecorderSession?.id) {
        return;
    }
    const baseUrl = getRecorderEngineBaseUrl(inspectRecorderSession);
    const pageId = selectedInspectTabId || inspectTabs.find((tab) => tab.active)?.id || inspectTabs[0]?.id || "";
    if (!baseUrl || !pageId) {
        return;
    }
    await readInspectSessionJson(inspectRecorderSession, "/highlight", {
        method: "POST",
        body: JSON.stringify({ page_id: pageId, clear_existing: true })
    }).catch(() => null);
    const highlights = [...candidateFields, ...selectedFields].filter((field, index, allFields) => allFields.findIndex((item) => item.locator === field.locator) === index).slice(-12);
    await Promise.all(highlights.map((field) => readInspectSessionJson(inspectRecorderSession, "/highlight", { method: "POST", body: JSON.stringify({ page_id: pageId, locator: field.locator, label: field.name, retain_existing: true }) }).catch(() => null)));
    const latestHighlight = highlights[highlights.length - 1];
    if (latestHighlight) {
        setHighlightedInspectLocator(latestHighlight.locator);
        if (highlightClearTimerRef.current)
            window.clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = window.setTimeout(() => setHighlightedInspectLocator(""), REPOSITORY_HIGHLIGHT_DURATION_MS);
    }
};
const removeStagedInspectField = (locator: string) => {
    const next = stagedInspectFields.filter((field) => field.locator !== locator);
    setStagedInspectFields(next);
    stagedInspectFieldsRef.current = next;
    if (focusedInspectLocator === locator)
        setFocusedInspectLocator(next[next.length - 1]?.locator || browserInspectFields[browserInspectFields.length - 1]?.locator || "");
    setInspectMessage(next.length
        ? `${next.length} selected field${next.length === 1 ? "" : "s"} remain. Save when the selection is correct.`
        : "No fields selected. Inspect or choose suggested fields before saving.");
    void syncInspectHighlights(next);
};
const removeAllStagedInspectFields = () => {
    setStagedInspectFields([]);
    stagedInspectFieldsRef.current = [];
    setFocusedInspectLocator(browserInspectFields[browserInspectFields.length - 1]?.locator || "");
    setInspectMessage("Selected fields cleared. Captured candidates remain available for review.");
    void syncInspectHighlights([], browserInspectFields);
};
const selectAllBrowserInspectFields = () => {
    if (!browserInspectFields.length) {
        return;
    }
    const nextSelected = [...stagedInspectFieldsRef.current];
    let duplicateCount = 0;
    for (const field of browserInspectFields) {
        if (nextSelected.some(item => (item.sourceLocator || item.locator) === (field.sourceLocator || field.locator)))
            continue;
        let candidate = field;
        const collision = nextSelected.some(item => sameRepositoryLocator(item.locator, field.locator));
        if (collision) {
            const alternative = (field.locatorCandidates || []).find(value => !nextSelected.some(item => sameRepositoryLocator(item.locator, value.locator)));
            if (!alternative) {
                duplicateCount++;
                continue;
            }
            candidate = { ...field, sourceLocator: field.sourceLocator || field.locator,
                ...changeRepositoryFieldLocator(field, alternative.locator, alternative.strategy) };
        }
        nextSelected.push(candidate);
    }
    const added = nextSelected.length - stagedInspectFieldsRef.current.length;
    setStagedInspectFields(nextSelected);
    stagedInspectFieldsRef.current = nextSelected;
    setFocusedInspectLocator(nextSelected[nextSelected.length - 1]?.locator || "");
    setBrowserInspectFields([]);
    setInspectMessage(`${added} captured field${added === 1 ? "" : "s"} moved to Selected fields.${duplicateCount ? ` ${duplicateCount} duplicate selector${duplicateCount === 1 ? " was" : "s were"} left unselected because no distinct fallback was available.` : ""}`);
    void syncInspectHighlights(nextSelected, []);
};
const dismissInspectField = (field: RepositoryExtractedField) => {
    const locator = field.locator;
    const nextCandidates = browserInspectFields.filter((candidate) => candidate.locator !== locator);
    setBrowserInspectFields(nextCandidates);
    setAiSuggestedInspectFields((current) => current.filter((candidate) => candidate.locator !== locator));
    setDismissedInspectLocators((current) => current.includes(locator) ? current : [...current, locator]);
    if (focusedInspectLocator === locator)
        setFocusedInspectLocator(stagedInspectFields[stagedInspectFields.length - 1]?.locator || nextCandidates[nextCandidates.length - 1]?.locator || "");
    setInspectMessage(`${field.name} hidden from this inspection. You can restore hidden suggestions from More actions.`);
    void syncInspectHighlights(stagedInspectFields, nextCandidates);
};
const restoreDismissedInspectFields = () => {
    const restoredCount = dismissedInspectLocators.length;
    setDismissedInspectLocators([]);
    setInspectMessage(`Restored ${restoredCount} hidden field suggestion${restoredCount === 1 ? "" : "s"}.`);
};
return {closeRepositoryInspector,repositoryInspectorRef,focusInspectField,stageInspectField,updateStagedInspectField,clearInspectHighlights,loadInspectTabs,refreshInspectTabs,selectInspectTab,launchInspectBrowser,closeInspectBrowser,persistLiveInspectResult,startLiveInspect,reinspectField,stopLiveInspect,highlightRepositoryLocator,syncInspectHighlights,removeStagedInspectField,removeAllStagedInspectFields,selectAllBrowserInspectFields,dismissInspectField,restoreDismissedInspectFields};
}
export type RepositoryInspectionActions=ReturnType<typeof useRepositoryInspectionActions>;
