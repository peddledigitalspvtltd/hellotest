import {useRepositoryTransferActions} from './useRepositoryTransferActions';
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sameRepositoryLocator } from "../../lib/repositoryLocators";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { applyInspectedFieldValidation, mergeRepositoryEntries, persistRepositoryScreenBundle, retainUnsavedInspectedFields } from "@hellotest/automation/frontend/lib/repositoryWorkspace";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import {RepositoryExtractedField,getScreenName,inferScreenName,isScreenRepositoryRecord,parseLocatorDraft,makeRepositoryScreenKey,getRepositoryScreenKey,getRecorderEngineBaseUrl,RecorderLocatorValidationResponse,readInspectSessionJson,RepositoryLocator,formatLocatorDraft,getRepositoryLocators} from '../../lib/automationWorkspaceSupport';
import type {RepositoryWorkspaceScope} from './repositoryWorkspaceTypes';
import type {RepositoryWorkspaceState} from './useRepositoryWorkspaceState';
import type {RepositoryWorkspaceQueries} from './useRepositoryWorkspaceQueries';
import type {RepositoryWorkspaceModel} from './useRepositoryWorkspaceModel';
import type {RepositoryInspectionActions} from './useRepositoryInspectionActions';
type MutationPorts=RepositoryWorkspaceScope&RepositoryWorkspaceState&RepositoryWorkspaceQueries&RepositoryWorkspaceModel&RepositoryInspectionActions&{
queryClient:ReturnType<typeof useQueryClient>;inspectedFields:RepositoryExtractedField[];showSuccess:(message:string)=>void;showInfo:(message:string)=>void;showError:(error:unknown,fallback:string)=>void;syncRepositorySearchParams:(id?:string|null)=>void;selectRepositoryEntry:(id:string,screenName?:string,withinCase?:boolean)=>void;
};
export function useRepositoryMutationActions(ports:MutationPorts){
const {
    message,
    inspectRecorderSession,
    setSelectedRepositoryId,
    selectedScreenName,
    setSelectedScreenName,
    screenRenameDraft,
    setRenamingScreenName,
    setIsRepositoryImportModalOpen,
    repositoryImportPreview,
    setRepositoryImportPreview,
    locatorImprovementPreview,
    setLocatorImprovementPreview,
    setIsAddingRepositoryScreen,
    newRepositoryScreenDraft,
    setNewRepositoryScreenDraft,
    setIsAddingRepositoryField,
    newRepositoryFieldDraft,
    setNewRepositoryFieldDraft,
    setScreenDetailTab,
    setFieldDetailTab,
    setIsInspectOpen,
    setInspectReviewTab,
    inspectTabs,
    selectedInspectTabId,
    setSelectedInspectTabId,
    isInspectingLiveField,
    setInspectMessage,
    setAiSuggestedInspectFields,
    stagedInspectFields,
    setStagedInspectFields,
    setFocusedInspectLocator,
    stagedInspectFieldsRef,
    setRepositoryUsageBlock,
    screenDomDraft,
    setScreenDomDraft,
    screenScreenshotDraft,
    setScreenScreenshotDraft,
    screenUrlDraft,
    setScreenUrlDraft,
    screenInfoDraft,
    setScreenInfoDraft,
    screenExtractionDraft,
    setScreenExtractionDraft,
    repositoryDraft,
    setRepositoryDraft,
    appTypes,
    learningCache,
    activeScreenName,
    selectedRepositoryEntry,
    activeRepositoryAppTypeId,
    activeRepositoryProjectId,
    activePageObject,
    updateStagedInspectField,
    clearInspectHighlights,
    stopLiveInspect,
    highlightRepositoryLocator,
    appTypeId,
    showSuccess,
    showError,
    queryClient,
    projectId,
    syncRepositorySearchParams,
    inspectedFields,
    showInfo,
    selectRepositoryEntry,
} = ports;
const {exportRepositoryCsv,importRepositoryEntries}=useRepositoryTransferActions(ports);
const persistRepositoryField = (field: RepositoryExtractedField, evidence?: {
    screenDom?: string | null;
    screenScreenshotUrl?: string | null;
    screenFingerprint?: string | null;
    accessibilityTree?: string | null;
    pageUrl?: string | null;
}, savedScreen?: AutomationLearningCacheEntry) => {
    const screenName = savedScreen ? getScreenName(savedScreen) : screenInfoDraft.screen_name.trim() || activeScreenName || inferScreenName(null, screenUrlDraft) || "Screen";
    const repositoryAppTypeId = savedScreen ? savedScreen.app_type_id || "" : activeRepositoryAppTypeId || appTypeId || "";
    const repositoryProjectId = savedScreen ? savedScreen.project_id || "" : activeRepositoryProjectId || projectId || "";
    const effectiveScreenDom = evidence?.screenDom ?? screenDomDraft;
    const effectiveScreenScreenshot = evidence?.screenScreenshotUrl ?? screenScreenshotDraft;
    const effectiveScreenFingerprint = evidence?.screenFingerprint ?? screenInfoDraft.screen_fingerprint;
    const effectiveAccessibilityTree = evidence?.accessibilityTree ?? screenInfoDraft.accessibility_tree;
    const effectivePageUrl = evidence?.pageUrl ?? field.pageUrl ?? screenUrlDraft;
    const existingField = learningCache.find((entry) => !isScreenRepositoryRecord(entry)
        && getScreenName(entry) === screenName
        && entry.locator === field.locator
        && (entry.app_type_id || "") === repositoryAppTypeId
        && (!repositoryProjectId || !entry.project_id || entry.project_id === repositoryProjectId));
    const primaryLocator = field.locatorCandidates?.[0];
    const previousValidationHistory = Array.isArray(existingField?.metadata?.validation_history)
        ? existingField.metadata.validation_history.slice(-19)
        : [];
    const validationEvent = field.validatedAt ? {
        validated_at: field.validatedAt,
        status: field.validationStatus || "unverified",
        match_count: primaryLocator?.matchCount ?? null,
        page_url: effectivePageUrl || null,
        locator: field.locator,
        source: "live_save_validation"
    } : null;
    const input = {
        project_id: repositoryProjectId || undefined,
        app_type_id: repositoryAppTypeId || undefined,
        page_url: effectivePageUrl || undefined,
        page_key: screenName,
        screen_name: screenName,
        object_name: field.name,
        object_role: `${field.tag} / ${field.role}`,
        locator: field.locator,
        locator_kind: field.locatorKind,
        locator_intent: field.name,
        confidence: primaryLocator?.confidenceScore || (field.locator.includes("data-testid") ? 0.95 : 0.75),
        dom_structure: field.dom,
        screenshot_url: field.elementScreenshotUrl || effectiveScreenScreenshot || undefined,
        fallback_strategy: field.source === "live_inspect" ? "Use captured visual and nearby DOM evidence only after stable locator retries fail." : undefined,
        source: field.source || "inspect_ai_extract",
        metadata: {
            ...(existingField?.metadata || {}),
            ...(savedScreen ? { screen_entry_id: savedScreen.id } : {}),
            record_kind: "field",
            url_pattern_type: screenInfoDraft.url_pattern_type || "contains",
            url_pattern_value: screenInfoDraft.url_pattern_value || effectivePageUrl || screenName,
            screen_fingerprint: effectiveScreenFingerprint || null,
            screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50000) : null,
            screen_screenshot_url: effectiveScreenScreenshot || null,
            accessibility_tree: effectiveAccessibilityTree || null,
            element_screenshot_url: field.elementScreenshotUrl || null,
            ancestor_screenshot_url: field.ancestorScreenshotUrl || null,
            ancestor_dom: field.ancestorDom || null,
            target_criteria: field.targetCriteria ? [field.targetCriteria] : [],
            description: field.description || `${field.name} captured from the selected screen.`,
            business_meaning: field.businessMeaning || null,
            stability_score: primaryLocator?.confidenceScore || (field.locator.includes("data-testid") ? 0.95 : 0.75),
            fallback_locators: field.fallbackLocators,
            locator_candidates: field.locatorCandidates || [],
            usage_keywords: field.usageKeywords || [],
            last_validated_at: field.validatedAt || existingField?.metadata?.last_validated_at || null,
            last_validated_status: field.validationStatus || existingField?.metadata?.last_validated_status || "unverified",
            validation_history: validationEvent ? [...previousValidationHistory, validationEvent] : previousValidationHistory
        }
    };
    return existingField
        ? api.testCases.updateLearningCacheEntry(existingField.id, input)
        : api.testCases.createLearningCacheEntry(input);
};
const saveRepositoryEntry = useMutation({
    mutationFn: () => {
        if (!selectedRepositoryEntry) {
            throw new Error("Select an object repository field first.");
        }
        const screenName = screenInfoDraft.screen_name.trim() || activeScreenName || getScreenName(selectedRepositoryEntry);
        const duplicate = learningCache.find((entry) => entry.id !== selectedRepositoryEntry.id
            && getScreenName(entry) === screenName
            && String(entry.locator || "").trim() === repositoryDraft.locator.trim()
            && (!activeRepositoryAppTypeId || entry.app_type_id === activeRepositoryAppTypeId));
        if (duplicate) {
            throw new Error("This screen already has a field with the same locator. Select the existing field or use a unique locator.");
        }
        return api.testCases.updateLearningCacheEntry(selectedRepositoryEntry.id, {
            page_url: screenUrlDraft || selectedRepositoryEntry.page_url || undefined,
            page_key: screenName,
            screen_name: screenName,
            object_name: repositoryDraft.object_name,
            object_role: repositoryDraft.object_role,
            locator: repositoryDraft.locator,
            locator_kind: repositoryDraft.locator_kind,
            target_criteria: repositoryDraft.target_criteria.split(/\n+/).map((line) => line.trim()).filter(Boolean),
            dom_structure: repositoryDraft.dom_structure,
            screenshot_url: repositoryDraft.screenshot_url,
            fallback_strategy: repositoryDraft.fallback_strategy,
            platform: appTypes.find((appType) => appType.id === activeRepositoryAppTypeId)?.type || "web",
            url_pattern_type: screenInfoDraft.url_pattern_type,
            url_pattern_value: screenInfoDraft.url_pattern_value,
            screen_fingerprint: screenInfoDraft.screen_fingerprint,
            accessibility_tree: screenInfoDraft.accessibility_tree,
            fallback_locators: parseLocatorDraft(repositoryDraft.fallback_locators),
            description: repositoryDraft.description,
            business_meaning: repositoryDraft.business_meaning,
            usage_keywords: repositoryDraft.usage_keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
            stability_score: Math.max(0, Math.min(1, (Number(repositoryDraft.stability_score) || 0) / 100)),
            ancestor_dom: repositoryDraft.ancestor_dom,
            ancestor_screenshot_url: repositoryDraft.ancestor_screenshot_url,
            element_screenshot_url: repositoryDraft.element_screenshot_url,
            metadata: {
                ...(selectedRepositoryEntry.metadata || {}),
                screen_dom_compressed: screenDomDraft || selectedRepositoryEntry.metadata?.screen_dom_compressed,
                screen_screenshot_url: screenScreenshotDraft || selectedRepositoryEntry.metadata?.screen_screenshot_url
            }
        });
    },
    onSuccess: (updatedEntry) => {
        queryClient.setQueriesData<AutomationLearningCacheEntry[]>({ queryKey: ["automation-learning-cache"] }, (current) => current ? current.map((entry) => entry.id === updatedEntry.id ? updatedEntry : entry) : current);
        setSelectedRepositoryId(updatedEntry.id);
        const updatedReferences = Number((updatedEntry as AutomationLearningCacheEntry & {
            updated_step_references?: number;
        }).updated_step_references || 0);
        showSuccess(updatedReferences
            ? `Object repository field saved and ${updatedReferences} automation reference${updatedReferences === 1 ? "" : "s"} updated.`
            : "Object repository field saved for execution-time locator resolution.");
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
        if (updatedReferences)
            void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => showError(error, "Unable to save repository field.")
});
const addRepositoryScreen = useMutation({
    mutationFn: (_options?: {
        inspectAfterSave?: boolean;
    }) => {
        const screenName = newRepositoryScreenDraft.screen_name.trim();
        if (!screenName) {
            throw new Error("Add a screen name before saving the screen.");
        }
        return api.testCases.createLearningCacheEntry({
            project_id: projectId || undefined,
            app_type_id: appTypeId || undefined,
            page_url: newRepositoryScreenDraft.page_url.trim() || undefined,
            page_key: screenName,
            screen_name: screenName,
            object_name: "__screen__",
            object_role: "screen",
            locator: "__screen__",
            locator_kind: "screen",
            locator_intent: "__screen__",
            screen_dom_compressed: newRepositoryScreenDraft.dom_structure.trim() || undefined,
            screen_screenshot_url: newRepositoryScreenDraft.screenshot_url.trim() || undefined,
            source: "manual_screen",
            metadata: {
                record_kind: "screen",
                url_pattern_type: newRepositoryScreenDraft.url_pattern_type,
                url_pattern_value: newRepositoryScreenDraft.url_pattern_value.trim() || newRepositoryScreenDraft.page_url.trim() || screenName,
                description: newRepositoryScreenDraft.description.trim() || null,
                business_meaning: newRepositoryScreenDraft.business_meaning.trim() || null
            }
        });
    },
    onSuccess: (entry, options) => {
        const screenName = newRepositoryScreenDraft.screen_name.trim();
        const screenKey = makeRepositoryScreenKey(screenName, entry?.app_type_id || appTypeId || undefined);
        queryClient.setQueryData<AutomationLearningCacheEntry[]>(["automation-learning-cache", "automation-workspace", projectId, appTypeId], (current) => [entry, ...(current || []).filter((currentEntry) => currentEntry.id !== entry.id)]);
        setSelectedScreenName(screenKey);
        setScreenUrlDraft(newRepositoryScreenDraft.page_url.trim());
        setScreenDomDraft(newRepositoryScreenDraft.dom_structure.trim());
        setScreenScreenshotDraft(newRepositoryScreenDraft.screenshot_url.trim());
        setScreenInfoDraft({
            screen_name: screenName,
            url_pattern_type: newRepositoryScreenDraft.url_pattern_type,
            url_pattern_value: newRepositoryScreenDraft.url_pattern_value.trim() || newRepositoryScreenDraft.page_url.trim() || screenName,
            screen_fingerprint: "",
            accessibility_tree: "",
            description: newRepositoryScreenDraft.description.trim(),
            business_meaning: newRepositoryScreenDraft.business_meaning.trim()
        });
        if (entry?.id) {
            setSelectedRepositoryId(entry.id);
        }
        setNewRepositoryScreenDraft({
            screen_name: "",
            page_url: "",
            url_pattern_type: "contains",
            url_pattern_value: "",
            description: "",
            business_meaning: "",
            dom_structure: "",
            screenshot_url: ""
        });
        setIsAddingRepositoryScreen(false);
        setScreenDetailTab("overview");
        if (options?.inspectAfterSave) {
            setIsInspectOpen(true);
            setInspectReviewTab("candidates");
            setInspectMessage("Screen saved. Choose a local or remote browser session to inspect fields, or extract fields from supplied DOM evidence.");
            showSuccess("Screen created. Continue by capturing and reviewing its repository fields.");
        }
        else {
            setIsInspectOpen(false);
            showSuccess("Screen created. You can add details now and inspect it whenever you are ready.");
        }
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to add repository screen.")
});
const persistRepositoryScreenEvidence = (evidence?: {
    screenDom?: string | null;
    screenScreenshotUrl?: string | null;
    screenFingerprint?: string | null;
    accessibilityTree?: string | null;
    pageUrl?: string | null;
}) => {
    const screenName = screenInfoDraft.screen_name.trim() || activeScreenName || inferScreenName(null, screenUrlDraft) || "Screen";
    const repositoryAppTypeId = activeRepositoryAppTypeId || appTypeId || "";
    const repositoryProjectId = activeRepositoryProjectId || projectId || "";
    const existingScreenRecord = learningCache.find((entry) => isScreenRepositoryRecord(entry)
        && getScreenName(entry) === screenName
        && (entry.app_type_id || "") === repositoryAppTypeId
        && (!repositoryProjectId || !entry.project_id || entry.project_id === repositoryProjectId));
    const effectiveScreenDom = evidence?.screenDom ?? screenDomDraft;
    const effectiveScreenScreenshot = evidence?.screenScreenshotUrl ?? screenScreenshotDraft;
    const effectiveScreenFingerprint = evidence?.screenFingerprint ?? screenInfoDraft.screen_fingerprint;
    const effectiveAccessibilityTree = evidence?.accessibilityTree ?? screenInfoDraft.accessibility_tree;
    const effectivePageUrl = evidence?.pageUrl ?? screenUrlDraft;
    const metadata = {
        ...(existingScreenRecord?.metadata || {}),
        record_kind: "screen",
        screen_name: screenName,
        url_pattern_type: screenInfoDraft.url_pattern_type || "contains",
        url_pattern_value: screenInfoDraft.url_pattern_value || effectivePageUrl || screenName,
        screen_fingerprint: effectiveScreenFingerprint || null,
        accessibility_tree: effectiveAccessibilityTree || null,
        screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50000) : null,
        screen_screenshot_url: effectiveScreenScreenshot || null,
        description: screenInfoDraft.description || null,
        business_meaning: screenInfoDraft.business_meaning || null,
        ...(screenExtractionDraft ? {
            intended_flows: screenExtractionDraft.intendedFlows,
            ai_extract_used: screenExtractionDraft.aiUsed,
            ai_extract_fallback_reason: screenExtractionDraft.fallbackReason,
            ai_extracted_at: screenExtractionDraft.extractedAt
        } : {})
    };
    if (existingScreenRecord) {
        return api.testCases.updateLearningCacheEntry(existingScreenRecord.id, {
            page_url: effectivePageUrl || undefined,
            page_key: screenName,
            screen_name: screenName,
            source: "manual_screen",
            metadata
        });
    }
    return api.testCases.createLearningCacheEntry({
        project_id: repositoryProjectId || undefined,
        app_type_id: repositoryAppTypeId || undefined,
        page_url: effectivePageUrl || undefined,
        page_key: screenName,
        screen_name: screenName,
        object_name: "__screen__",
        object_role: "screen",
        locator: "__screen__",
        locator_kind: "screen",
        locator_intent: "__screen__",
        screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50000) : undefined,
        screen_screenshot_url: effectiveScreenScreenshot || undefined,
        source: "manual_screen",
        metadata
    });
};
const saveRepositoryScreenEvidence = useMutation({
    mutationFn: () => persistRepositoryScreenEvidence(),
    onSuccess: (screen) => {
        queryClient.setQueryData<AutomationLearningCacheEntry[]>(["automation-learning-cache", "automation-workspace", projectId, appTypeId], (current) => mergeRepositoryEntries(current, [screen]));
        setSelectedScreenName(getRepositoryScreenKey(screen));
        showSuccess("Screen details saved.");
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to save screen evidence.")
});
const validateInspectFieldsForSave = async (fields: RepositoryExtractedField[], intent: "validate" | "save" = "save") => {
    const targetSession = inspectRecorderSession;
    const baseUrl = getRecorderEngineBaseUrl(targetSession);
    const pageId = selectedInspectTabId || inspectTabs.find((tab) => tab.active)?.id || inspectTabs[0]?.id || "";
    if (!targetSession?.id || targetSession.status !== "running" || !baseUrl || !pageId) {
        throw new Error("Connect the inspection browser and select its current tab before validating fields.");
    }
    setInspectMessage(`Verifying ${fields.length} selected locator${fields.length === 1 ? "" : "s"} and capturing current evidence...`);
    let response: RecorderLocatorValidationResponse | null;
    try {
        response = await readInspectSessionJson<RecorderLocatorValidationResponse>(targetSession, "/inspect/validate", {
            method: "POST",
            body: JSON.stringify({
                page_id: pageId,
                fields: fields.map((field) => ({ locator: field.locator, name: field.name }))
            })
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : "Live validation failed";
        throw new Error(`Unable to verify the selected locators. Restart or update the local recorder, then retry. ${detail}`);
    }
    if (!response) {
        throw new Error("The inspection browser returned no locator validation result.");
    }
    const validationByLocator = new Map(response.fields.map((field) => [field.locator, field]));
    const validatedFields = fields.map((field) => {
        const validation = validationByLocator.get(field.locator);
        if (!validation) {
            return {
                ...field,
                validationStatus: "invalid" as const,
                validationWarning: "The live browser did not return a result for this locator."
            };
        }
        const primaryLocator = field.locatorCandidates?.[0] || {
            locator: field.locator,
            strategy: field.locatorKind,
            confidenceScore: field.locator.includes("data-testid") ? 0.95 : 0.75,
            isPrimary: true
        };
        const locatorCandidates = [{
                ...primaryLocator,
                matchCount: validation.match_count,
                recommended: validation.is_unique && primaryLocator.confidenceScore >= 0.8,
                warning: validation.warning,
                lastValidatedStatus: validation.validation_status
            }, ...(field.locatorCandidates?.slice(1) || field.fallbackLocators || [])];
        return {
            ...field,
            pageUrl: response.page_url || field.pageUrl,
            dom: validation.dom_structure || field.dom,
            ancestorDom: validation.ancestor_dom || field.ancestorDom,
            elementScreenshotUrl: validation.element_screenshot_url || field.elementScreenshotUrl,
            locatorCandidates,
            validatedAt: response.validated_at,
            validationStatus: validation.validation_status,
            validationWarning: validation.warning || validation.error
        };
    });
    setSelectedInspectTabId(response.page_id || pageId);
    setScreenUrlDraft(response.page_url || screenUrlDraft);
    setScreenDomDraft(response.screen_dom || screenDomDraft);
    setScreenScreenshotDraft(response.screen_screenshot_url || screenScreenshotDraft);
    setScreenInfoDraft((current) => ({
        ...current,
        screen_fingerprint: response?.screen_fingerprint || current.screen_fingerprint,
        accessibility_tree: response?.accessibility_tree || current.accessibility_tree
    }));
    const updatedSelection = applyInspectedFieldValidation(stagedInspectFieldsRef.current, fields, validatedFields);
    setStagedInspectFields(updatedSelection);
    stagedInspectFieldsRef.current = updatedSelection;
    const invalidFields = validatedFields.filter((field) => field.validationStatus !== "unique");
    if (invalidFields.length) {
        setInspectReviewTab("selected");
        setFocusedInspectLocator(invalidFields[0]?.locator || "");
        const names = invalidFields.slice(0, 3).map((field) => field.name).join(", ");
        const remaining = invalidFields.length - Math.min(invalidFields.length, 3);
        setInspectMessage(`${invalidFields.length} locator${invalidFields.length === 1 ? " is" : "s are"} not unique: ${names}${remaining ? ` and ${remaining} more` : ""}. Refine or recapture before saving.`);
        throw new Error("Every selected locator must match exactly one element on the current screen.");
    }
    setInspectMessage(intent === "save"
        ? `Verified ${validatedFields.length} unique locator${validatedFields.length === 1 ? "" : "s"}. Saving fresh DOM and screenshot evidence...`
        : `Verified ${validatedFields.length} unique locator${validatedFields.length === 1 ? "" : "s"}; DOM, accessibility, and screenshot evidence are current.`);
    return { response, validatedFields };
};
const validateInspectedFields = useMutation({
    mutationFn: () => {
        if (!stagedInspectFields.length)
            throw new Error("Select at least one field to validate.");
        return validateInspectFieldsForSave([...stagedInspectFields], "validate");
    },
    onSuccess: () => setInspectReviewTab("selected"),
    onError: (error) => showError(error, "Unable to validate selected fields.")
});
const saveInspectedScreenFields = useMutation({
    mutationFn: async () => {
        const pendingCapture = isInspectingLiveField ? await stopLiveInspect() : null;
        const fields = [...stagedInspectFieldsRef.current];
        for (let index = 0; index < fields.length; index++) {
            const duplicate = fields.slice(0, index).find(field => sameRepositoryLocator(field.locator, fields[index].locator));
            if (duplicate)
                throw new Error(`${fields[index].name} and ${duplicate.name} use equivalent selectors. Choose a distinct locator for each field before saving.`);
        }
        const evidence = pendingCapture ? {
            screenDom: pendingCapture.screen_dom,
            screenScreenshotUrl: pendingCapture.screen_screenshot_url,
            screenFingerprint: pendingCapture.screen_fingerprint,
            accessibilityTree: pendingCapture.accessibility_tree,
            pageUrl: pendingCapture.page_url
        } : undefined;
        // Save captured evidence even if the browser has moved or disconnected.
        // Explicit Validate updates quality signals; it does not gate persistence.
        const bundle = await persistRepositoryScreenBundle({
            fields,
            saveScreen: () => persistRepositoryScreenEvidence(evidence),
            saveField: (field, screen) => persistRepositoryField(field, evidence, screen)
        });
        return { ...bundle, count: fields.length, screenName: getScreenName(bundle.screen) };
    },
    onSuccess: ({ count, saved, failed, screen, screenName, attempted }) => {
        const persistedEntries = [screen, ...saved].filter((entry): entry is AutomationLearningCacheEntry => Boolean(entry?.id));
        queryClient.setQueryData<AutomationLearningCacheEntry[]>(["automation-learning-cache", "automation-workspace", projectId, appTypeId], (current) => mergeRepositoryEntries(current, persistedEntries));
        const lastEntry = saved[saved.length - 1];
        if (lastEntry?.id) {
            setSelectedRepositoryId(lastEntry.id);
            syncRepositorySearchParams(lastEntry.id);
        }
        setSelectedScreenName(makeRepositoryScreenKey(screenName, lastEntry?.app_type_id || screen?.app_type_id || activeRepositoryAppTypeId || appTypeId || undefined));
        const fieldsToRetry = retainUnsavedInspectedFields(stagedInspectFieldsRef.current, attempted, failed.map((item) => item.field));
        setStagedInspectFields(fieldsToRetry);
        stagedInspectFieldsRef.current = fieldsToRetry;
        clearInspectHighlights();
        if (failed.length) {
            setInspectMessage(`Saved ${saved.length} of ${count} fields. ${failed.length} remain selected for retry.`);
            setInspectReviewTab("selected");
            setFocusedInspectLocator(failed[0]?.field.locator || "");
            showError(new Error(`Saved ${saved.length} of ${count} fields. ${failed.length} remain selected so you can fix and retry them. ${failed[0]?.message || ""}`), "Some selected fields could not be saved.");
        }
        else {
            setInspectMessage(count ? `Saved ${count} selected field${count === 1 ? "" : "s"} to ${screenName || "the screen"}.` : `Saved ${screenName || "screen"}.`);
            showSuccess(count
                ? `Saved ${count} selected field${count === 1 ? "" : "s"} to ${screenName || "the screen"} with its URL, DOM, screenshot, and locator evidence.`
                : `Saved ${screenName || "screen"} with its current URL, DOM, and screenshot evidence.`);
        }
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to save screen and selected fields.")
});
const extractRepositoryFields = useMutation({
    mutationFn: async () => {
        const screenName = screenInfoDraft.screen_name.trim() || activeScreenName || inferScreenName(null, screenUrlDraft) || "Screen";
        const response = await api.testCases.extractLearningCacheFields({
            app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
            screen_name: screenName,
            page_url: screenUrlDraft || undefined,
            dom_structure: screenDomDraft || undefined,
            screenshot_url: screenScreenshotDraft || undefined,
            business_meaning: screenInfoDraft.business_meaning || undefined,
            candidate_fields: inspectedFields
        });
        return response;
    },
    onSuccess: (response) => {
        const aiFields = response.fields.map((field) => ({ ...field, source: "ai_extract" as const }));
        setAiSuggestedInspectFields(aiFields);
        setInspectReviewTab("candidates");
        const firstSuggestion = aiFields[0];
        if (firstSuggestion && inspectRecorderSession?.status === "running") {
            void highlightRepositoryLocator(firstSuggestion.locator, firstSuggestion.name, "", { silent: true }).catch(() => null);
        }
        setScreenInfoDraft((current) => ({
            ...current,
            description: current.description || response.screen_summary || "",
            business_meaning: current.business_meaning || response.intended_flows.join("; ")
        }));
        setScreenExtractionDraft({
            intendedFlows: response.intended_flows,
            aiUsed: response.ai_used,
            fallbackReason: response.fallback_reason || null,
            extractedAt: new Date().toISOString()
        });
        setInspectMessage(response.fallback_used
            ? `Listed ${response.fields.length} DOM-grounded suggestion${response.fields.length === 1 ? "" : "s"}. Select the fields you want to save.`
            : `AI listed ${response.fields.length} suggested field${response.fields.length === 1 ? "" : "s"}. Select the fields you want to save.`);
        showInfo("AI suggestions are ready for review. Select only the fields you want to save.");
    },
    onError: (error) => showError(error, "Unable to suggest screen fields.")
});
const repairInspectedFieldWithAi = useMutation({
    mutationFn: async (field: RepositoryExtractedField) => {
        const screenName = screenInfoDraft.screen_name.trim() || activeScreenName || inferScreenName(null, screenUrlDraft) || "Screen";
        const response = await api.testCases.extractLearningCacheFields({
            app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
            screen_name: screenName,
            page_url: screenUrlDraft || undefined,
            dom_structure: screenDomDraft || undefined,
            screenshot_url: screenScreenshotDraft || undefined,
            business_meaning: [screenInfoDraft.business_meaning, `Repair the locator for ${field.name} without changing the field intent.`].filter(Boolean).join("\n"),
            candidate_fields: [field, ...inspectedFields]
        });
        const normalizedName = field.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const rankedSuggestions = [...response.fields].sort((left, right) => {
            const leftName = left.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
            const rightName = right.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
            return Number(rightName === normalizedName) - Number(leftName === normalizedName)
                || Number(right.role === field.role) - Number(left.role === field.role);
        });
        const matchedSuggestion = rankedSuggestions[0];
        const alternateFallback = matchedSuggestion?.fallbackLocators.find((candidate) => candidate.locator !== field.locator);
        const semanticAlternative = rankedSuggestions.find((suggestion) => suggestion.locator !== field.locator
            && suggestion.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalizedName);
        const locator = matchedSuggestion?.locator !== field.locator
            ? matchedSuggestion?.locator
            : alternateFallback?.locator || semanticAlternative?.locator;
        const strategy = matchedSuggestion?.locator !== field.locator
            ? matchedSuggestion?.locatorKind
            : alternateFallback?.strategy || semanticAlternative?.locatorKind;
        if (!matchedSuggestion || !locator || !strategy) {
            throw new Error(`AI could not find a safer alternate locator for ${field.name}. Reinspect the control on the current page.`);
        }
        const primaryCandidate: RepositoryLocator = {
            locator,
            strategy,
            confidenceScore: matchedSuggestion?.locator === locator ? 0.88 : alternateFallback?.confidenceScore || 0.75,
            isPrimary: true,
            lastValidatedStatus: "pending"
        };
        const fallbackLocators: RepositoryLocator[] = [
            ...matchedSuggestion.fallbackLocators.filter((candidate) => candidate.locator !== locator),
            { locator: field.locator, strategy: field.locatorKind, confidenceScore: field.locatorCandidates?.[0]?.confidenceScore || 0.7 }
        ].filter((candidate, index, candidates) => candidates.findIndex((item) => item.locator === candidate.locator) === index)
            .map((candidate) => ({ ...candidate, isFallback: true, lastValidatedStatus: "pending" }));
        return {
            currentLocator: field.locator,
            field: {
                ...field,
                tag: matchedSuggestion.tag || field.tag,
                role: matchedSuggestion.role || field.role,
                locator,
                locatorKind: strategy,
                dom: matchedSuggestion.dom || field.dom,
                fallbackLocators,
                locatorCandidates: [primaryCandidate, ...fallbackLocators],
                source: "ai_extract" as const,
                validationStatus: "unverified" as const,
                validationWarning: "AI replacement proposed. Validate it against the current browser tab before saving."
            }
        };
    },
    onSuccess: ({ currentLocator, field }) => {
        updateStagedInspectField(currentLocator, field);
        setFocusedInspectLocator(field.locator);
        setInspectReviewTab("selected");
        setInspectMessage(`AI proposed a replacement locator for ${field.name}. Validate it before saving.`);
    },
    onError: (error) => {
        setInspectMessage(error instanceof Error ? error.message : "AI could not repair this locator.");
        showError(error, "Unable to repair the selected locator with AI.");
    }
});
const addRepositoryField = useMutation({
    mutationFn: () => {
        const screenName = newRepositoryFieldDraft.screen_name.trim() || activeScreenName;
        const objectName = newRepositoryFieldDraft.object_name.trim();
        const locator = newRepositoryFieldDraft.locator.trim();
        if (!screenName || !objectName || !locator) {
            throw new Error("Add a screen name, field name, and primary locator.");
        }
        return api.testCases.createLearningCacheEntry({
            project_id: activeRepositoryProjectId || projectId || undefined,
            app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
            page_url: screenUrlDraft || undefined,
            page_key: screenName,
            screen_name: screenName,
            object_name: objectName,
            object_role: newRepositoryFieldDraft.object_role.trim() || "field",
            locator,
            locator_kind: newRepositoryFieldDraft.locator_kind.trim() || "css",
            locator_intent: objectName,
            source: "manual_repository",
            metadata: {
                url_pattern_type: screenInfoDraft.url_pattern_type || "contains",
                url_pattern_value: screenInfoDraft.url_pattern_value || screenUrlDraft || screenName,
                screen_fingerprint: screenInfoDraft.screen_fingerprint || null,
                accessibility_tree: screenInfoDraft.accessibility_tree || null
            }
        });
    },
    onSuccess: (entry) => {
        setIsAddingRepositoryField(false);
        showSuccess("Object repository field added manually.");
        if (entry?.id) {
            selectRepositoryEntry(entry.id, activePageObject?.screenName || selectedScreenName);
        }
        setNewRepositoryFieldDraft({
            screen_name: activeScreenName,
            object_name: "",
            object_role: "field",
            locator: "",
            locator_kind: "css"
        });
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to add repository field.")
});
const renameRepositoryScreen = useMutation({
    mutationFn: () => {
        if (!activeScreenName || !screenRenameDraft.trim()) {
            throw new Error("Select a screen and provide a new screen name.");
        }
        return api.testCases.renameLearningCacheScreen(activeScreenName, {
            app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
            project_id: projectId || undefined,
            new_name: screenRenameDraft.trim()
        });
    },
    onSuccess: (response) => {
        setSelectedScreenName(makeRepositoryScreenKey(response.screen_name, activeRepositoryAppTypeId || appTypeId || undefined));
        setRenamingScreenName("");
        setScreenInfoDraft((current) => ({ ...current, screen_name: response.screen_name }));
        void queryClient.invalidateQueries({queryKey:["test-steps"]});
        void queryClient.invalidateQueries({queryKey:["test-cases"]});
        showSuccess(`Renamed screen, updated ${response.updated_fields} field reference${response.updated_fields === 1 ? "" : "s"}, and migrated ${response.updated_step_references} step binding${response.updated_step_references === 1 ? "" : "s"}.`);
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to rename repository screen.")
});
const deleteRepositoryEntry = useMutation({
    mutationFn: (confirmed: boolean) => {
        if (!selectedRepositoryEntry) {
            throw new Error("Select an object repository field first.");
        }
        return api.testCases.deleteLearningCacheEntry(selectedRepositoryEntry.id, confirmed);
    },
    onSuccess: (response) => {
        if (response.requires_confirmation) {
            setRepositoryUsageBlock({ title: "Delete field and invalidate automation?", usage: response.usage, kind: "field" });
            return;
        }
        setRepositoryUsageBlock(null);
        showSuccess(response.invalidated_cases.length
            ? `Object repository field deleted. ${response.invalidated_cases.length} automation case${response.invalidated_cases.length === 1 ? " is" : "s are"} now incomplete.`
            : "Object repository field deleted.");
        syncRepositorySearchParams(null);
        setSelectedRepositoryId("");
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
        void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to delete repository field.")
});
const deleteRepositoryScreen = useMutation({
    mutationFn: (confirmed: boolean) => {
        if (!activePageObject) {
            throw new Error("Select a screen first.");
        }
        return api.testCases.deleteLearningCacheScreen(activeScreenName, {
            app_type_id: activeRepositoryAppTypeId || appTypeId || undefined,
            project_id: projectId || undefined,
            ...(confirmed ? { confirm: "true" } : {})
        });
    },
    onSuccess: (response) => {
        if (response.requires_confirmation) {
            setRepositoryUsageBlock({ title: "Delete screen and invalidate automation?", usage: response.usage, kind: "screen" });
            return;
        }
        setRepositoryUsageBlock(null);
        showSuccess(response.invalidated_cases.length
            ? `Object repository screen deleted. ${response.invalidated_cases.length} automation case${response.invalidated_cases.length === 1 ? " is" : "s are"} now incomplete.`
            : "Object repository screen deleted.");
        setSelectedScreenName("");
        setSelectedRepositoryId("");
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
        void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to delete repository screen.")
});
const repositorySelectionRef = useRef(selectedRepositoryEntry?.id);
const improveRepositoryEntry = useMutation({
    mutationFn: () => {
        if (!selectedRepositoryEntry) {
            throw new Error("Select an object repository field first.");
        }
        return api.testCases.improveLearningCacheEntry(selectedRepositoryEntry.id, {
            guidance: repositoryDraft.target_criteria || undefined
        });
    },
    onSuccess: (response) => {
        if (response.entry.id !== repositorySelectionRef.current)
            return;
        setLocatorImprovementPreview(response);
        setFieldDetailTab("healing");
        showSuccess(response.fallback_used
            ? `Locator proposal prepared with deterministic rules: ${response.fallback_reason || "No model output was used."}`
            : "Locator proposal prepared. Review the before-and-after values before applying it.");
    },
    onError: (error) => showError(error, "Unable to prepare a locator improvement.")
});
const applyRepositoryImprovement = useMutation({
    mutationFn: () => {
        if (!selectedRepositoryEntry || !locatorImprovementPreview || locatorImprovementPreview.entry.id !== selectedRepositoryEntry.id) {
            throw new Error("Generate and review a locator proposal first.");
        }
        const locator = String(locatorImprovementPreview.suggestion.locator || "").trim();
        const strategy = String(locatorImprovementPreview.suggestion.strategy || "").trim();
        if (!locator || !strategy) {
            throw new Error("The proposal is missing a locator or strategy and cannot be applied.");
        }
        return api.testCases.applyLearningCacheImprovement(selectedRepositoryEntry.id, {
            confirmed: true,
            locator,
            strategy,
            expected_locator: locatorImprovementPreview.entry.locator,
            ...(typeof locatorImprovementPreview.suggestion.confidence === "number" ? { confidence: locatorImprovementPreview.suggestion.confidence } : {}),
            ...(locatorImprovementPreview.request_id ? { request_id: locatorImprovementPreview.request_id } : {})
        });
    },
    onSuccess: (response) => {
        queryClient.setQueriesData<AutomationLearningCacheEntry[]>({ queryKey: ["automation-learning-cache"] }, (entries) => entries?.map((entry) => entry.id === response.entry.id ? response.entry : entry));
        if (response.entry.id === repositorySelectionRef.current) {
            setLocatorImprovementPreview(null);
            setRepositoryDraft((current) => ({ ...current, locator: response.entry.locator, locator_kind: response.entry.locator_kind || "css", fallback_locators: formatLocatorDraft(getRepositoryLocators(response.entry)) }));
        }
        showSuccess("Reviewed locator improvement applied. Dependent automation remains visible for validation.");
        void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
        void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to apply the reviewed locator improvement.")
});
repositorySelectionRef.current=selectedRepositoryEntry?.id;
return {exportRepositoryCsv,importRepositoryEntries,persistRepositoryField,saveRepositoryEntry,addRepositoryScreen,persistRepositoryScreenEvidence,saveRepositoryScreenEvidence,validateInspectFieldsForSave,validateInspectedFields,saveInspectedScreenFields,extractRepositoryFields,repairInspectedFieldWithAi,addRepositoryField,renameRepositoryScreen,deleteRepositoryEntry,deleteRepositoryScreen,improveRepositoryEntry,applyRepositoryImprovement};
}
export type RepositoryMutationActions=ReturnType<typeof useRepositoryMutationActions>;
