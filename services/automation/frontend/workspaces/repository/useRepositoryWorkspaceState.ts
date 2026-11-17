import { useRef, useState } from "react";
import { type InspectSessionMode } from "@hellotest/automation/frontend/components/RepositoryInspectControls";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import type { ObjectRepositoryImportPreview } from "../../lib/objectRepositoryImport";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import {RepositoryScreenTab,RepositoryFieldTab,REPOSITORY_CONFIG_DRAWER_DEFAULT_WIDTH,RepositoryInspectReviewTab,RecorderTab,RepositoryExtractedField} from '../../lib/automationWorkspaceSupport';

export function useRepositoryWorkspaceState(scopeKey:string){
const [message, setMessage] = useState("");
const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("success");
const [inspectRecorderSession, setInspectRecorderSession] = useState<RecorderSessionResponse | null>(null);
const [isLaunchingInspectBrowser, setIsLaunchingInspectBrowser] = useState(false);
const [isClosingInspectBrowser, setIsClosingInspectBrowser] = useState(false);
const [isRefreshingInspectTabs, setIsRefreshingInspectTabs] = useState(false);
const [inspectPreviewRevision, setInspectPreviewRevision] = useState(0);
const inspectSessionRef = useRef<RecorderSessionResponse | null>(null);
const inspectSessionGenerationRef = useRef(0);
const inspectTabRequestRef = useRef(0);
const inspectTabActionCountRef = useRef(0);
const inspectLifecycleBusyRef = useRef(false);
const [highlightedRepositoryId, setHighlightedRepositoryId] = useState("");
const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
const [selectedScreenName, setSelectedScreenName] = useState("");
const [screenRenameDraft, setScreenRenameDraft] = useState("");
const [renamingScreenName, setRenamingScreenName] = useState("");
const [isRepositoryImportModalOpen, setIsRepositoryImportModalOpen] = useState(false);
const [repositoryImportPreview, setRepositoryImportPreview] = useState<ObjectRepositoryImportPreview | null>(null);
const [isParsingRepositoryImport, setIsParsingRepositoryImport] = useState(false);
const repositoryImportScopeRef = useRef(scopeKey);
const repositoryImportRequestRef = useRef(0);
const [locatorImprovementPreview, setLocatorImprovementPreview] = useState<Awaited<ReturnType<typeof api.testCases.improveLearningCacheEntry>> | null>(null);
const [isAddingRepositoryScreen, setIsAddingRepositoryScreen] = useState(false);
const [newRepositoryScreenDraft, setNewRepositoryScreenDraft] = useState({
    screen_name: "",
    page_url: "",
    url_pattern_type: "contains",
    url_pattern_value: "",
    description: "",
    business_meaning: "",
    dom_structure: "",
    screenshot_url: ""
});
const [isAddingRepositoryField, setIsAddingRepositoryField] = useState(false);
const [newRepositoryFieldDraft, setNewRepositoryFieldDraft] = useState({
    screen_name: "",
    object_name: "",
    object_role: "field",
    locator: "",
    locator_kind: "css"
});
const [screenDetailTab, setScreenDetailTab] = useState<RepositoryScreenTab>("overview");
const [fieldDetailTab, setFieldDetailTab] = useState<RepositoryFieldTab>("locators");
const [isRepositoryConfigOpen, setIsRepositoryConfigOpen] = useState(true);
const [repositoryConfigDrawerWidth, setRepositoryConfigDrawerWidth] = useState(REPOSITORY_CONFIG_DRAWER_DEFAULT_WIDTH);
const [isInspectOpen, setIsInspectOpen] = useState(false);
const [isInspectBrowserMaximized, setIsInspectBrowserMaximized] = useState(false);
const [inspectSessionMode, setInspectSessionMode] = useState<InspectSessionMode>("remote");
const [inspectReviewTab, setInspectReviewTab] = useState<RepositoryInspectReviewTab>("candidates");
const [inspectTabs, setInspectTabs] = useState<RecorderTab[]>([]);
const [selectedInspectTabId, setSelectedInspectTabId] = useState("");
const selectedInspectTabIdRef = useRef("");
const [isInspectingLiveField, setIsInspectingLiveField] = useState(false);
const [inspectMessage, setInspectMessage] = useState("");
const [browserInspectFields, setBrowserInspectFields] = useState<RepositoryExtractedField[]>([]);
const [aiSuggestedInspectFields, setAiSuggestedInspectFields] = useState<RepositoryExtractedField[]>([]);
const [stagedInspectFields, setStagedInspectFields] = useState<RepositoryExtractedField[]>([]);
const [dismissedInspectLocators, setDismissedInspectLocators] = useState<string[]>([]);
const [reinspectFieldLocator, setReinspectFieldLocator] = useState("");
const reinspectFieldLocatorRef = useRef("");
const [focusedInspectLocator, setFocusedInspectLocator] = useState("");
const [highlightedInspectLocator, setHighlightedInspectLocator] = useState("");
const stagedInspectFieldsRef = useRef<RepositoryExtractedField[]>([]);
const inspectionScreenKeyRef = useRef("");
const highlightClearTimerRef = useRef<number | null>(null);
const inspectPollInFlightRef = useRef(false);
const inspectPollPromiseRef = useRef<Promise<void> | null>(null);
const inspectStopInProgressRef = useRef(false);
const tabRefreshInFlightRef = useRef(false);
const [repositoryUsageBlock, setRepositoryUsageBlock] = useState<{
    title: string;
    usage: Array<{
        id: string;
        display_id?: string | null;
        title: string;
        automated?: "yes" | "no" | null;
    }>;
    kind: "field" | "screen";
} | null>(null);
const [screenDomDraft, setScreenDomDraft] = useState("");
const [screenScreenshotDraft, setScreenScreenshotDraft] = useState("");
const [screenUrlDraft, setScreenUrlDraft] = useState("");
const [screenInfoDraft, setScreenInfoDraft] = useState({
    screen_name: "",
    url_pattern_type: "contains",
    url_pattern_value: "",
    screen_fingerprint: "",
    accessibility_tree: "",
    description: "",
    business_meaning: ""
});
const [screenExtractionDraft, setScreenExtractionDraft] = useState<{
    intendedFlows: string[];
    aiUsed: boolean;
    fallbackReason: string | null;
    extractedAt: string;
} | null>(null);
const [repositoryDraft, setRepositoryDraft] = useState({
    screen_name: "",
    object_name: "",
    object_role: "",
    locator: "",
    locator_kind: "",
    target_criteria: "",
    dom_structure: "",
    screenshot_url: "",
    fallback_strategy: "",
    url_pattern_type: "contains",
    url_pattern_value: "",
    screen_fingerprint: "",
    accessibility_tree: "",
    fallback_locators: "",
    description: "",
    business_meaning: "",
    usage_keywords: "",
    stability_score: "80",
    ancestor_dom: "",
    ancestor_screenshot_url: "",
    element_screenshot_url: ""
});
return {message,setMessage,messageTone,setMessageTone,inspectRecorderSession,setInspectRecorderSession,isLaunchingInspectBrowser,setIsLaunchingInspectBrowser,isClosingInspectBrowser,setIsClosingInspectBrowser,isRefreshingInspectTabs,setIsRefreshingInspectTabs,inspectPreviewRevision,setInspectPreviewRevision,inspectSessionRef,inspectSessionGenerationRef,inspectTabRequestRef,inspectTabActionCountRef,inspectLifecycleBusyRef,highlightedRepositoryId,setHighlightedRepositoryId,selectedRepositoryId,setSelectedRepositoryId,selectedScreenName,setSelectedScreenName,screenRenameDraft,setScreenRenameDraft,renamingScreenName,setRenamingScreenName,isRepositoryImportModalOpen,setIsRepositoryImportModalOpen,repositoryImportPreview,setRepositoryImportPreview,isParsingRepositoryImport,setIsParsingRepositoryImport,repositoryImportScopeRef,repositoryImportRequestRef,locatorImprovementPreview,setLocatorImprovementPreview,isAddingRepositoryScreen,setIsAddingRepositoryScreen,newRepositoryScreenDraft,setNewRepositoryScreenDraft,isAddingRepositoryField,setIsAddingRepositoryField,newRepositoryFieldDraft,setNewRepositoryFieldDraft,screenDetailTab,setScreenDetailTab,fieldDetailTab,setFieldDetailTab,isRepositoryConfigOpen,setIsRepositoryConfigOpen,repositoryConfigDrawerWidth,setRepositoryConfigDrawerWidth,isInspectOpen,setIsInspectOpen,isInspectBrowserMaximized,setIsInspectBrowserMaximized,inspectSessionMode,setInspectSessionMode,inspectReviewTab,setInspectReviewTab,inspectTabs,setInspectTabs,selectedInspectTabId,setSelectedInspectTabId,selectedInspectTabIdRef,isInspectingLiveField,setIsInspectingLiveField,inspectMessage,setInspectMessage,browserInspectFields,setBrowserInspectFields,aiSuggestedInspectFields,setAiSuggestedInspectFields,stagedInspectFields,setStagedInspectFields,dismissedInspectLocators,setDismissedInspectLocators,reinspectFieldLocator,setReinspectFieldLocator,reinspectFieldLocatorRef,focusedInspectLocator,setFocusedInspectLocator,highlightedInspectLocator,setHighlightedInspectLocator,stagedInspectFieldsRef,inspectionScreenKeyRef,highlightClearTimerRef,inspectPollInFlightRef,inspectPollPromiseRef,inspectStopInProgressRef,tabRefreshInFlightRef,repositoryUsageBlock,setRepositoryUsageBlock,screenDomDraft,setScreenDomDraft,screenScreenshotDraft,setScreenScreenshotDraft,screenUrlDraft,setScreenUrlDraft,screenInfoDraft,setScreenInfoDraft,screenExtractionDraft,setScreenExtractionDraft,repositoryDraft,setRepositoryDraft};
}
export type RepositoryWorkspaceState=ReturnType<typeof useRepositoryWorkspaceState>;
