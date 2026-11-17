import {isNonElementRepositoryEntry,readRecorderJson} from '../../lib/automationWorkspaceSupport';
import {stopRepositoryInspectSession} from '../../lib/repositoryInspectSession';
import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { repositoryLocatorIdentity } from "../../lib/repositoryLocators";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { type InspectSessionMode } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { buildInspectLiveUrl, repositoryInspectLegacyPageUrl } from "@hellotest/automation/frontend/lib/repositoryInspectSession";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { canGenerateAutomationCode as resolveCanGenerateAutomationCode } from "../../lib/automationAccess";
import { assessLocatorReviewReadiness } from "@hellotest/ai/frontend/lib/aiAssurance";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import {REPOSITORY_CONFIG_DRAWER_MIN_WIDTH,REPOSITORY_CONFIG_DRAWER_MAX_WIDTH,clampRepositoryConfigDrawerWidth,extractRepositoryFieldsFromDom,RepositoryExtractedField,RepositoryLocator,getRepositoryLocators,normalizeMetadataValue,getRepositoryMemberName,getRepositoryHtmlTag,getObjectRole,formatLocatorDraft,metadataStringArray,normalizeMetadataNumber,readInspectSessionJson,repositoryImporter,getRecorderEngineBaseUrl,RecorderInspectResult} from '../../lib/automationWorkspaceSupport';
import type {RepositoryWorkspaceScope} from './repositoryWorkspaceTypes';
import {useRepositoryWorkspaceState} from './useRepositoryWorkspaceState';
import {useRepositoryWorkspaceQueries} from './useRepositoryWorkspaceQueries';
import {useRepositoryWorkspaceModel} from './useRepositoryWorkspaceModel';
import {useRepositoryInspectionActions} from './useRepositoryInspectionActions';
import {useRepositoryMutationActions} from './useRepositoryMutationActions';
export function useRepositoryWorkspaceController({projectId,appTypeId,setAppTypeId=()=>{},caseBindings}:RepositoryWorkspaceScope){
const { session } = useAuth();
const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
const featureFlagsQuery = useFeatureFlags(Boolean(session));
const isAutomationWorkspaceEnabled = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);



const canUseAutomationAi = resolveCanGenerateAutomationCode(session, featureFlagsQuery.data, projectId);

const canInspectRepository = hasPermission(session, "automation.repository.manage", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.object_repository"]);


const navigate = useNavigate();
const [searchParams, setSearchParams] = useSearchParams();
const queryClient = useQueryClient();
const lastRepositoryRouteRef=useRef('');
const resizeCleanupRef=useRef<(()=>void)|null>(null);

const canViewObjectRepository=hasPermission(session,'automation.view',projectId)&&areFeatureFlagsEnabled(featureFlagsQuery.data,['hellotest.automation.workspace','hellotest.automation.object_repository']);
const canImportRepository=canViewObjectRepository&&hasPermission(session,'automation.repository.import',projectId);
const canExportRepository=canViewObjectRepository&&hasPermission(session,'automation.repository.export',projectId);
const state=useRepositoryWorkspaceState(JSON.stringify([projectId,appTypeId]));
const {
    message,
    setMessage,
    messageTone,
    setMessageTone,
    inspectRecorderSession,
    setInspectRecorderSession,
    isLaunchingInspectBrowser,
    isClosingInspectBrowser,
    isRefreshingInspectTabs,
    inspectPreviewRevision,
    inspectSessionRef,
    inspectSessionGenerationRef,
    inspectTabRequestRef,
    inspectTabActionCountRef,
    inspectLifecycleBusyRef,
    highlightedRepositoryId,
    setHighlightedRepositoryId,
    selectedRepositoryId,
    setSelectedRepositoryId,
    selectedScreenName,
    setSelectedScreenName,
    screenRenameDraft,
    setScreenRenameDraft,
    renamingScreenName,
    setRenamingScreenName,
    isRepositoryImportModalOpen,
    setIsRepositoryImportModalOpen,
    repositoryImportPreview,
    setRepositoryImportPreview,
    isParsingRepositoryImport,
    setIsParsingRepositoryImport,
    repositoryImportScopeRef,
    repositoryImportRequestRef,
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
    setRepositoryConfigDrawerWidth,
    isInspectOpen,
    setIsInspectOpen,
    isInspectBrowserMaximized,
    setIsInspectBrowserMaximized,
    inspectSessionMode,
    inspectReviewTab,
    setInspectReviewTab,
    inspectTabs,
    setInspectTabs,
    selectedInspectTabId,
    setSelectedInspectTabId,
    selectedInspectTabIdRef,
    isInspectingLiveField,
    setIsInspectingLiveField,
    inspectMessage,
    setInspectMessage,
    browserInspectFields,
    aiSuggestedInspectFields,
    setAiSuggestedInspectFields,
    stagedInspectFields,
    setStagedInspectFields,
    dismissedInspectLocators,
    setDismissedInspectLocators,
    reinspectFieldLocator,
    setReinspectFieldLocator,
    reinspectFieldLocatorRef,
    focusedInspectLocator,
    setFocusedInspectLocator,
    highlightedInspectLocator,
    stagedInspectFieldsRef,
    inspectionScreenKeyRef,
    highlightClearTimerRef,
    inspectPollInFlightRef,
    inspectPollPromiseRef,
    inspectStopInProgressRef,
    tabRefreshInFlightRef,
    repositoryUsageBlock,
    setRepositoryUsageBlock,
    screenDomDraft,
    setScreenDomDraft,
    screenScreenshotDraft,
    setScreenScreenshotDraft,
    screenUrlDraft,
    setScreenUrlDraft,
    screenInfoDraft,
    setScreenInfoDraft,
    setScreenExtractionDraft,
    repositoryDraft,
    setRepositoryDraft,
} = state;
const queries=useRepositoryWorkspaceQueries({projectId,appTypeId,session,canInspectRepository,canViewObjectRepository});
const {
    appTypesQuery,
    learningCacheQuery,
    inspectAgent,
    inspectCapabilities,
    appTypes,
    learningCache,
} = queries;
const model=useRepositoryWorkspaceModel({projectId,appTypeId,caseBindings},state,queries);
const {
    groupedRepository,
    activeScreenKey,
    activeScreenName,
    activeScreenRecord,
    selectedRepositoryEntry,
    pageObjectModels,
    activePageObject,
} = model;
const recommendedInspectMode:InspectSessionMode=inspectAgent.state==='connected'?'local':'remote';
const inspection=useRepositoryInspectionActions({...state,...queries,...model,projectId,appTypeId,session,canInspectRepository,recommendedInspectMode});
const {
    closeRepositoryInspector,
    repositoryInspectorRef,
    focusInspectField,
    stageInspectField,
    updateStagedInspectField,
    loadInspectTabs,
    refreshInspectTabs,
    selectInspectTab,
    launchInspectBrowser,
    closeInspectBrowser,
    persistLiveInspectResult,
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
} = inspection;
inspectSessionRef.current = inspectRecorderSession;
const repositoryImportScope = JSON.stringify([projectId, appTypeId]);
repositoryImportScopeRef.current = repositoryImportScope;
useEffect(() => {
    ++repositoryImportRequestRef.current;
    setRepositoryImportPreview(null);
    setIsParsingRepositoryImport(false);
    setIsRepositoryImportModalOpen(false);
    return () => { ++repositoryImportRequestRef.current; };
}, [repositoryImportScope]);

selectedInspectTabIdRef.current = selectedInspectTabId;
const handleRepositoryConfigResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = repositoryConfigDrawerWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handlePointerMove = (moveEvent: PointerEvent) => {
        const viewportMaxWidth = Math.max(REPOSITORY_CONFIG_DRAWER_MIN_WIDTH, Math.min(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH, window.innerWidth - 420));
        const nextWidth = Math.min(viewportMaxWidth, clampRepositoryConfigDrawerWidth(startWidth + startX - moveEvent.clientX));
        setRepositoryConfigDrawerWidth(nextWidth);
    };
    const handlePointerUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
    };
    resizeCleanupRef.current=handlePointerUp;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
}, [repositoryConfigDrawerWidth]);
const handleRepositoryConfigResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        setRepositoryConfigDrawerWidth((current) => clampRepositoryConfigDrawerWidth(current + 24));
    }
    else if (event.key === "ArrowRight") {
        event.preventDefault();
        setRepositoryConfigDrawerWidth((current) => clampRepositoryConfigDrawerWidth(current - 24));
    }
    else if (event.key === "Home") {
        event.preventDefault();
        setRepositoryConfigDrawerWidth(REPOSITORY_CONFIG_DRAWER_MIN_WIDTH);
    }
    else if (event.key === "End") {
        event.preventDefault();
        setRepositoryConfigDrawerWidth(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH);
    }
}, []);
const deferredScreenDomDraft = useDeferredValue(screenDomDraft);
const inspectedFields = useMemo(() => extractRepositoryFieldsFromDom(deferredScreenDomDraft), [deferredScreenDomDraft]);
const suggestedInspectFields = useMemo(() => {
    const byLocator = new Map<string, RepositoryExtractedField>();
    inspectedFields.forEach((field) => byLocator.set(field.locator, { ...field, source: "dom_candidate" }));
    aiSuggestedInspectFields.forEach((field) => byLocator.set(field.locator, { ...field, source: "ai_extract" }));
    return Array.from(byLocator.values()).filter((field) => !dismissedInspectLocators.includes(field.locator));
}, [aiSuggestedInspectFields, dismissedInspectLocators, inspectedFields]);
const selectedInspectLocatorSet = useMemo(() => new Set(stagedInspectFields.flatMap((field) => [field.locator, field.sourceLocator || field.locator, repositoryLocatorIdentity(field.locator), repositoryLocatorIdentity(field.sourceLocator || field.locator)])), [stagedInspectFields]);
const inspectFieldInventory = useMemo(() => {
    const byLocator = new Map<string, RepositoryExtractedField>();
    suggestedInspectFields.forEach((field) => byLocator.set(field.locator, field));
    browserInspectFields
        .filter((field) => !dismissedInspectLocators.includes(field.locator))
        .forEach((field) => byLocator.set(field.locator, { ...byLocator.get(field.locator), ...field }));
    stagedInspectFields.forEach((field) => byLocator.set(field.sourceLocator || field.locator, { ...byLocator.get(field.sourceLocator || field.locator), ...field }));
    return Array.from(byLocator.values()).sort((left, right) => Number(right.source === "live_inspect") - Number(left.source === "live_inspect")
        || left.name.localeCompare(right.name));
}, [browserInspectFields, dismissedInspectLocators, selectedInspectLocatorSet, stagedInspectFields, suggestedInspectFields]);
const focusedInspectField = useMemo(() => {
    const inspectFields = [...stagedInspectFields, ...browserInspectFields, ...suggestedInspectFields];
    return inspectFields.find((field) => field.locator === focusedInspectLocator)
        || stagedInspectFields[stagedInspectFields.length - 1]
        || browserInspectFields[browserInspectFields.length - 1]
        || null;
}, [browserInspectFields, focusedInspectLocator, stagedInspectFields, suggestedInspectFields]);
const focusedSelectedInspectField = useMemo(() => stagedInspectFields.find((field) => field.locator === focusedInspectLocator) || null, [focusedInspectLocator, stagedInspectFields]);
const focusedInspectPrimaryLocator: RepositoryLocator | null = focusedInspectField?.locatorCandidates?.[0]
    || (focusedInspectField ? {
        locator: focusedInspectField.locator,
        strategy: focusedInspectField.locatorKind,
        confidenceScore: focusedInspectField.locator.includes("data-testid") ? 0.95 : 0.75,
        matchCount: undefined,
        stabilitySignals: []
    } : null);
const inspectRecorderLiveUrl = buildInspectLiveUrl(inspectRecorderSession, selectedInspectTabId, inspectPreviewRevision);
const selectedLocators = selectedRepositoryEntry ? getRepositoryLocators(selectedRepositoryEntry) : [];
const selectedLocatorReviewReadiness = useMemo(() => assessLocatorReviewReadiness({
    stabilityScore: Number.isFinite(Number(repositoryDraft.stability_score))
        ? Number(repositoryDraft.stability_score)
        : Math.round((selectedRepositoryEntry?.confidence || 0) * 100),
    locatorCount: selectedLocators.length,
    hasDomEvidence: Boolean(screenDomDraft.trim() || normalizeMetadataValue(selectedRepositoryEntry?.metadata?.ancestor_dom)),
    hasVisualEvidence: Boolean(screenScreenshotDraft.trim() || repositoryDraft.element_screenshot_url.trim()),
    hasValidationHistory: !["not_validated", "unverified", "pending"].includes(normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_status)) && Boolean(normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_at)
        || ["unique", "ambiguous", "missing", "invalid"].includes(normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_status))
        || (Array.isArray(selectedRepositoryEntry?.metadata?.validation_history) && selectedRepositoryEntry.metadata.validation_history.length))
}), [repositoryDraft.element_screenshot_url, repositoryDraft.stability_score, screenDomDraft, screenScreenshotDraft, selectedLocators.length, selectedRepositoryEntry]);
const syncRepositorySearchParams = useCallback((repositoryId?: string | null) => {
    if(caseBindings)return;
    const targetRepositoryId = repositoryId || "";
    setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (targetRepositoryId) {
            next.delete("case");
            next.set("repository", targetRepositoryId);
        }
        else {
            next.delete("repository");
        }
        return next;
    }, { replace: true });
}, [setSearchParams,caseBindings]);
const selectRepositoryScreen = (screenName: string, withinCase = false) => {
    setSelectedScreenName(screenName);
    setSelectedRepositoryId("");
    setIsRepositoryConfigOpen(false);
    setLocatorImprovementPreview(null);
    if (!withinCase)
        syncRepositorySearchParams(null);
};
const selectRepositoryEntry = useCallback((repositoryId: string, screenName?: string, withinCase = false) => {
    if (screenName && screenName !== selectedScreenName) {
        setSelectedScreenName(screenName);
    }
    setSelectedRepositoryId(repositoryId);
    setFieldDetailTab("locators");
    setIsRepositoryConfigOpen(true);
    if (!withinCase)
        syncRepositorySearchParams(repositoryId);
}, [selectedScreenName, syncRepositorySearchParams]);
const openRepositoryInspect = (page: typeof activePageObject = activePageObject) => {
    if (inspectCapabilities.isError)
        void inspectCapabilities.refetch();
    const targetPage = page || activePageObject;
    if (targetPage?.screenName) {
        if (targetPage.screenName !== selectedScreenName) {
            setAiSuggestedInspectFields([]);
            setDismissedInspectLocators([]);
        }
        setSelectedScreenName(targetPage.screenName);
        setScreenInfoDraft((current) => ({
            ...current,
            screen_name: targetPage.pageName
        }));
    }
    if (targetPage?.url && targetPage.url !== "No URL captured") {
        setScreenUrlDraft(targetPage.url);
    }
    else if (targetPage) {
        setScreenUrlDraft("");
    }
    setIsInspectOpen(true);
    setInspectReviewTab("candidates");
    reinspectFieldLocatorRef.current = "";
    setReinspectFieldLocator("");
    setInspectMessage("");
};
useEffect(() => {
    stagedInspectFieldsRef.current = stagedInspectFields;
}, [stagedInspectFields]);
useEffect(()=>{
  if(caseBindings||appTypesQuery.isPending)return;
  const available=projectId?appTypes.filter(app=>String(app.project_id)===String(projectId)):appTypes;
  if(!available.length){if(appTypeId)setAppTypeId('');return;}
  if(!available.some(app=>app.id===appTypeId))setAppTypeId(available[0].id);
},[caseBindings,projectId,appTypeId,appTypes,appTypesQuery.isPending,setAppTypeId]);
useEffect(()=>{
  if(caseBindings||learningCacheQuery.isLoading||learningCacheQuery.isFetching||learningCacheQuery.isError)return;
  const requested=searchParams.get('repository')||'',key=`${projectId}:${appTypeId}:${requested}`;
  if(lastRepositoryRouteRef.current===key)return;lastRepositoryRouteRef.current=key;
  if(!requested)return;
  const candidates=groupedRepository.flatMap(([screenName,entries])=>entries.map(entry=>({screenName,entry}))).filter(({entry})=>!isNonElementRepositoryEntry(entry));
  const selected=candidates.find(({entry})=>entry.id===requested)||candidates.find(({entry})=>Array.isArray(entry.metadata?.source_owners)&&entry.metadata.source_owners.some((owner:{entry_id?:string})=>owner?.entry_id===requested));
  if(selected)selectRepositoryEntry(selected.entry.id,selected.screenName);else syncRepositorySearchParams(null);
},[caseBindings,projectId,appTypeId,searchParams,learningCacheQuery.isLoading,learningCacheQuery.isFetching,learningCacheQuery.isError,groupedRepository,selectRepositoryEntry,syncRepositorySearchParams]);
useEffect(()=>{
  if(!caseBindings)return;
  setScreenDetailTab('fields');setIsRepositoryConfigOpen(false);setSelectedScreenName('');setSelectedRepositoryId('');
},[caseBindings?.caseId]);

useEffect(() => {
    if (!caseBindings&&searchParams.get("repository")) {
        return;
    }
    if (selectedRepositoryEntry && selectedRepositoryId !== selectedRepositoryEntry.id) {
        setSelectedRepositoryId(selectedRepositoryEntry.id);
    }
}, [searchParams, selectedRepositoryEntry, selectedRepositoryId]);
useEffect(() => {
    if (activeScreenKey && selectedScreenName !== activeScreenKey) {
        setSelectedScreenName(activeScreenKey);
    }
}, [activeScreenKey, selectedScreenName]);
useEffect(() => {
    setScreenRenameDraft(activeScreenName);
    setNewRepositoryFieldDraft((current) => ({ ...current, screen_name: activeScreenName || current.screen_name }));
}, [activeScreenName]);
useEffect(() => {
    if (isInspectOpen) {
        inspectionScreenKeyRef.current = activeScreenKey;
        return;
    }
    if (inspectionScreenKeyRef.current === activeScreenKey)
        return;
    inspectionScreenKeyRef.current = activeScreenKey;
    setStagedInspectFields([]);
    stagedInspectFieldsRef.current = [];
    setDismissedInspectLocators([]);
    reinspectFieldLocatorRef.current = "";
    setReinspectFieldLocator("");
    setHighlightedRepositoryId("");
    setScreenExtractionDraft(null);
}, [activeScreenKey, isInspectOpen]);
useEffect(() => {
    if (!activeScreenRecord && !selectedRepositoryEntry) {
        setLocatorImprovementPreview(null);
        return;
    }
    // Background refreshes must not replace unsaved inspection evidence or
    // the fields retained after a partial save.
    if (isInspectOpen && stagedInspectFieldsRef.current.length)
        return;
    setLocatorImprovementPreview(null);
    const screenMetadata = activeScreenRecord?.metadata || {};
    const fieldMetadata = selectedRepositoryEntry?.metadata || {};
    const metadata = { ...screenMetadata, ...fieldMetadata };
    setScreenDomDraft(normalizeMetadataValue(screenMetadata.screen_dom_compressed) || normalizeMetadataValue(metadata.screen_dom_compressed));
    setScreenScreenshotDraft(normalizeMetadataValue(screenMetadata.screen_screenshot_url) || normalizeMetadataValue(metadata.screen_screenshot_url));
    setScreenUrlDraft(activeScreenRecord?.page_url || selectedRepositoryEntry?.page_url || repositoryInspectLegacyPageUrl(activeScreenRecord?.page_key));
    setScreenInfoDraft({
        screen_name: normalizeMetadataValue(screenMetadata.screen_name) || activeScreenName,
        url_pattern_type: normalizeMetadataValue(screenMetadata.url_pattern_type) || "contains",
        url_pattern_value: normalizeMetadataValue(screenMetadata.url_pattern_value) || activeScreenRecord?.page_url || activeScreenRecord?.page_key || "",
        screen_fingerprint: normalizeMetadataValue(screenMetadata.screen_fingerprint),
        accessibility_tree: normalizeMetadataValue(screenMetadata.accessibility_tree),
        description: normalizeMetadataValue(screenMetadata.description),
        business_meaning: normalizeMetadataValue(screenMetadata.business_meaning)
    });
    setRepositoryDraft({
        screen_name: activeScreenName,
        object_name: selectedRepositoryEntry ? getRepositoryMemberName(selectedRepositoryEntry) : "",
        object_role: selectedRepositoryEntry ? `${getRepositoryHtmlTag(selectedRepositoryEntry)} / ${getObjectRole(selectedRepositoryEntry)}` : "",
        locator: selectedRepositoryEntry?.locator || "",
        locator_kind: selectedRepositoryEntry?.locator_kind || "",
        target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.join("\n") : normalizeMetadataValue(metadata.target_criteria),
        dom_structure: normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html),
        screenshot_url: normalizeMetadataValue(metadata.screenshot_url) || normalizeMetadataValue(metadata.screenshot_path),
        fallback_strategy: normalizeMetadataValue(metadata.fallback_strategy),
        url_pattern_type: normalizeMetadataValue(screenMetadata.url_pattern_type) || "contains",
        url_pattern_value: normalizeMetadataValue(screenMetadata.url_pattern_value) || activeScreenRecord?.page_url || selectedRepositoryEntry?.page_url || activeScreenRecord?.page_key || "",
        screen_fingerprint: normalizeMetadataValue(screenMetadata.screen_fingerprint),
        accessibility_tree: normalizeMetadataValue(screenMetadata.accessibility_tree),
        fallback_locators: selectedRepositoryEntry ? formatLocatorDraft(getRepositoryLocators(selectedRepositoryEntry)) : "",
        description: normalizeMetadataValue(fieldMetadata.description),
        business_meaning: normalizeMetadataValue(fieldMetadata.business_meaning),
        usage_keywords: metadataStringArray(fieldMetadata.usage_keywords).join(", "),
        stability_score: String(Math.round(normalizeMetadataNumber(fieldMetadata.stability_score, selectedRepositoryEntry?.confidence || 0) * 100)),
        ancestor_dom: normalizeMetadataValue(fieldMetadata.ancestor_dom),
        ancestor_screenshot_url: normalizeMetadataValue(fieldMetadata.ancestor_screenshot_url),
        element_screenshot_url: normalizeMetadataValue(fieldMetadata.element_screenshot_url) || normalizeMetadataValue(fieldMetadata.screenshot_url)
    });
}, [activeScreenName, activeScreenRecord?.id, activeScreenRecord?.updated_at, selectedRepositoryEntry?.id, selectedRepositoryEntry?.updated_at, isInspectOpen]);
useEffect(() => {
    if (!inspectRecorderSession?.status_url || inspectRecorderSession.status !== "running") {
        return undefined;
    }
    let cancelled = false;
    let consecutiveFailures = 0;
    let timer: number | undefined;
    const controller = new AbortController();
    const refreshInspectSession = async () => {
        const generation = inspectSessionGenerationRef.current;
        try {
            if (inspectLifecycleBusyRef.current || document.hidden || !navigator.onLine)
                return;
            const next = await readInspectSessionJson<Partial<RecorderSessionResponse>>(inspectRecorderSession, "", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
            consecutiveFailures = 0;
            if (!cancelled && next && generation === inspectSessionGenerationRef.current) {
                setInspectRecorderSession((current) => current?.id === inspectRecorderSession.id ? { ...current, ...next } : current);
                if (next.status && next.status !== "running") {
                    ++inspectTabRequestRef.current;
                    setIsInspectingLiveField(false);
                    setInspectTabs([]);
                    selectedInspectTabIdRef.current = "";
                    setSelectedInspectTabId("");
                }
            }
        }
        catch (error) {
            consecutiveFailures += 1;
            const unavailable = [401, 403, 404, 410].includes(Number((error as {
                status?: number;
            })?.status));
            if (!cancelled && generation === inspectSessionGenerationRef.current && (unavailable || consecutiveFailures >= 2)) {
                ++inspectTabRequestRef.current;
                setInspectRecorderSession((current) => current?.id === inspectRecorderSession.id ? { ...current, status: "stopped" } : current);
                setIsInspectingLiveField(false);
                setInspectTabs([]);
                selectedInspectTabIdRef.current = "";
                setSelectedInspectTabId("");
                setInspectMessage(unavailable ? "This browser session expired or is no longer available. Your selected fields are retained. Open a new session to continue." : "The browser connection was lost. Your selected fields are retained. Reconnect your local agent or open a remote browser session.");
            }
        }
        finally {
            if (!cancelled)
                timer = window.setTimeout(() => void refreshInspectSession(), 3000);
        }
    };
    void refreshInspectSession();
    return () => {
        cancelled = true;
        controller.abort();
        window.clearTimeout(timer);
    };
}, [inspectRecorderSession?.id, inspectRecorderSession?.status, inspectRecorderSession?.status_url]);
const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
};
const showInfo = (text: string) => {
    setMessageTone("info");
    setMessage(text);
};
const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
};
const mutations=useRepositoryMutationActions({...state,...queries,...model,...inspection,projectId,appTypeId,queryClient,inspectedFields,showSuccess,showInfo,showError,syncRepositorySearchParams,selectRepositoryEntry});
const {
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
} = mutations;
const handleRepositoryImportFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) {
        return;
    }
    const request = ++repositoryImportRequestRef.current;
    const scope = repositoryImportScopeRef.current;
    const isCurrent = () => request === repositoryImportRequestRef.current && scope === repositoryImportScopeRef.current;
    setIsParsingRepositoryImport(true);
    try {
        const { parseObjectRepositoryFiles } = await repositoryImporter.load();
        if (!isCurrent())
            return;
        const preview = await parseObjectRepositoryFiles(files);
        if (!isCurrent())
            return;
        setRepositoryImportPreview(preview);
        const fields = preview.entries.filter((entry) => entry.record_type === "field").length;
        const screens = preview.entries.filter((entry) => entry.record_type === "screen").length;
        if (!preview.entries.length) {
            throw new Error("No importable screens or fields were detected in the selected files.");
        }
        setIsRepositoryImportModalOpen(true);
        showInfo(`Prepared ${screens} screen${screens === 1 ? "" : "s"} and ${fields} field${fields === 1 ? "" : "s"} for review before import.`);
    }
    catch (error) {
        if (!isCurrent())
            return;
        setRepositoryImportPreview(null);
        showError(error, "Unable to read object repository import files.");
    }
    finally {
        if (isCurrent())
            setIsParsingRepositoryImport(false);
    }
};

useEffect(() => {
    if (!isInspectOpen || inspectRecorderSession?.status !== "running" || !inspectRecorderSession.id) {
        return undefined;
    }
    let isCancelled = false;
    const refreshTabs = async () => {
        if (tabRefreshInFlightRef.current || inspectLifecycleBusyRef.current || inspectTabActionCountRef.current)
            return;
        tabRefreshInFlightRef.current = true;
        try {
            await loadInspectTabs();
        }
        catch (error) {
            if (!isCancelled) {
                setInspectMessage(error instanceof Error ? error.message : "Unable to load browser tabs.");
            }
        }
        finally {
            tabRefreshInFlightRef.current = false;
        }
    };
    void refreshTabs();
    const interval = window.setInterval(() => void refreshTabs(), 3000);
    return () => {
        isCancelled = true;
        window.clearInterval(interval);
    };
}, [isInspectOpen, inspectRecorderSession?.id, inspectRecorderSession?.status]);
useEffect(() => {
    if (!isInspectingLiveField || !inspectRecorderSession?.id) {
        return undefined;
    }
    const baseUrl = getRecorderEngineBaseUrl(inspectRecorderSession);
    if (!baseUrl) {
        return undefined;
    }
    let cancelled = false;
    const generation = inspectSessionGenerationRef.current;
    const interval = window.setInterval(() => {
        if (inspectPollInFlightRef.current || inspectStopInProgressRef.current)
            return;
        inspectPollInFlightRef.current = true;
        const pendingPoll = (async () => {
            const query = selectedInspectTabId ? `?page_id=${encodeURIComponent(selectedInspectTabId)}` : "";
            const result = await readInspectSessionJson<RecorderInspectResult>(inspectRecorderSession, `/inspect/result${query}`).catch((error) => {
                if (!cancelled && generation === inspectSessionGenerationRef.current)
                    setInspectMessage(error instanceof Error ? error.message : "Unable to read inspect result.");
                return null;
            });
            if (result && !cancelled && generation === inspectSessionGenerationRef.current && inspectSessionRef.current?.id === inspectRecorderSession.id) {
                await persistLiveInspectResult(result);
            }
        })().finally(() => {
            inspectPollInFlightRef.current = false;
            if (inspectPollPromiseRef.current === pendingPoll)
                inspectPollPromiseRef.current = null;
        });
        inspectPollPromiseRef.current = pendingPoll;
    }, 1200);
    return () => {
        cancelled = true;
        window.clearInterval(interval);
        inspectPollInFlightRef.current = false;
    };
}, [isInspectingLiveField, inspectRecorderSession, selectedInspectTabId]);
useEffect(()=>()=>{
  ++inspectSessionGenerationRef.current;++inspectTabRequestRef.current;
  const previous=inspectSessionRef.current;inspectSessionRef.current=null;
  if(previous?.status==='running')void stopRepositoryInspectSession(previous,readRecorderJson).catch(()=>null);
  setInspectRecorderSession(null);setIsInspectOpen(false);setIsInspectingLiveField(false);setInspectTabs([]);setSelectedInspectTabId('');
  if(highlightClearTimerRef.current)window.clearTimeout(highlightClearTimerRef.current);
  resizeCleanupRef.current?.();resizeCleanupRef.current=null;
},[projectId,appTypeId,canInspectRepository,session?.user.id]);
return {
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
    canViewObjectRepository,
};
}
export type RepositoryWorkspaceController=ReturnType<typeof useRepositoryWorkspaceController>;
