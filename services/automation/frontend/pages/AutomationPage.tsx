import { parseApiRequestSource } from "../lib/apiRequestSource";
import { ExecutionHookResults } from "@hellotest/testing/frontend/components/ExecutionHookResults";
import { AutomationRuntimeGuide } from "../components/AutomationRuntimeGuide";
import { AutomationBuildContext } from "../components/AutomationBuildContext";
import { AUTOMATION_RUNTIMES, getAutomationRuntimeTypes, getDefaultAutomationStepType, getRecorderPlatform } from "../lib/automationRuntime";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
const AiAssurancePanel = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiAssurancePanel")["AiAssurancePanel"]> & {}>("ai", "AiAssurancePanel", () => import("@hellotest/ai/frontend/components/AiAssurancePanel"), "ai");
import { mapRunHooksToExecutionHooks } from "@hellotest/testing/frontend/lib/runHooks";
import { type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDots, IconShieldCheck, IconTargetArrow } from "@tabler/icons-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AddIcon, CopyIcon, ExportIcon, ImportIcon, LayersIcon, MousePointerIcon, OpenIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon, SelectionToggleIcon, SparkIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

import { RepositoryLocatorBuilder } from "../components/RepositoryLocatorBuilder";
import { isRepositoryMemberUsed } from "../lib/repositoryLocators";
import { AiFeatureComposer } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogCardDescription } from "@hellotest/platform/frontend/src/shared/components/CatalogCardDescription";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DetailSectionTabs } from "@hellotest/platform/frontend/src/shared/components/DetailSectionTabs";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { ExecutionContextSelector } from "@hellotest/testing/frontend/components/ExecutionContextSelector";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { RepositoryInspectBrowser } from "@hellotest/agentic/frontend/components/RepositoryInspectBrowser";
import { RepositoryAgentSetup, RepositoryAgentStatus, RepositoryInspectSessionControls, type InspectSessionMode } from "@hellotest/agentic/frontend/components/RepositoryInspectControls";
import { useRepositoryInspectAgent, type RepositoryLocalAgent } from "@hellotest/agentic/frontend/hooks/useRepositoryInspectAgent";
import { RunHooksBuilder, type RunHookSelection } from "@hellotest/testing/frontend/components/RunHooksBuilder";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { CodePreviewDialog, StepAutomationDialog } from "../components/StepAutomationEditor";
import { StepParameterDialog } from "@hellotest/testing/frontend/components/StepParameterDialog";
import { SubnavTabs } from "@hellotest/platform/frontend/src/shared/components/SubnavTabs";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { TestCaseVersionHistory } from "@hellotest/testing/frontend/components/TestCaseVersionHistory";
import { AutomationCaseMetadata, AutomationDraftPlan, emptyAutomationMetadata, type AutomationDraftBehavior, type AutomationMetadata } from "../components/AutomationCaseMetadata";
import { AutomationInstructionPreview } from "../components/AutomationInstructionPreview";
import { AutomationParameterInput, AutomationReferencedParameters, AutomationRepositoryFieldPicker } from "../components/AutomationAuthoringInputs";
import { GherkinStepTextField } from "@hellotest/testing/frontend/components/GherkinStepTextField";
import { StepParameterizedText } from "@hellotest/testing/frontend/components/StepParameterizedText";
import { automationNumericArgument, automationParameterArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall } from "../lib/automationKeywordInputs";
import { automationMappingIsComplete, getAutomationSchedule, isAutomationPrecondition, seedAutomationPlan } from "../lib/automationPlan";
import { buildInspectLiveUrl, inspectSessionRequest, loadRepositoryInspectTabs, normalizeRepositoryInspectStartUrl, repositoryInspectLegacyPageUrl, stopRepositoryInspectSession } from "@hellotest/agentic/frontend/lib/repositoryInspectSession";
import { automationCaseMappingStatus, automationMappingFieldsEqual, buildAutomationEditorStep, cacheCreatedAutomationStep, getAutomationStepInsertion, isAutomationStepMapped, refreshCreatedAutomationStep, resolveAutomationMappingSave, getAutomationStepReorder } from "../lib/automationStepPersistence";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardProgress,
  TileCardRunsIcon,
  TileCardStepsIcon,
  getTileCardTone
} from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileBrowserPane } from "@hellotest/platform/frontend/src/shared/components/TileBrowserPane";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { mergeRefreshedAutomationDrafts } from "../lib/automationBuildTracking";
import { mergeAutomationMetadataFields, mergeAutomationMetadataValue } from "../lib/automationMetadataDraft";
import { buildAutomationCreateParameters } from "../lib/automationCreateParameters";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { buildHistoryStatusBreakdown } from "@hellotest/platform/frontend/src/shared/lib/tileProgressBreakdown";
import {
  canEditAutomationCode as resolveCanEditAutomationCode,
  canGenerateAutomationCode as resolveCanGenerateAutomationCode,
  canRecordAutomationCode as resolveCanRecordAutomationCode,
  canViewAutomationCode as resolveCanViewAutomationCode
} from "../lib/automationAccess";
import { assessLocatorReviewReadiness } from "@hellotest/ai/frontend/lib/aiAssurance";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { parseObjectRepositoryFiles, type ObjectRepositoryImportPreview } from "../lib/objectRepositoryImport";
import { mergeInspectedFields, mergeRepositoryEntries, persistRepositoryScreenBundle, retainUnsavedInspectedFields } from "@hellotest/agentic/frontend/lib/repositoryWorkspace";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { findByRoutableId, getRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { resolveStepAutomationCode } from "../lib/stepAutomation";
import {
  collectStepParameters,
  buildDataSetParameterDefinitions,
  buildDataSetParameterValues,
  buildStepParameterDefinitionsFromValues,
  collectSensitiveDataSetParameterNames,
  excludeSensitiveStepParameterValues,
  mergeStepParameterDefinitions,
  combineStepParameterValues,
  normalizeStepParameterValues,
  parseStepParameterName,
  type StepParameterScope
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AutomationLearningCacheEntry, ExecutionResult, RecorderSessionResponse, SharedStepGroup, StepApiRequest, TestCase, TestDataSet, TestStep, TestStepType, TestSuite } from "@hellotest/platform/frontend/src/types";

type AutomationView = "cases" | "repository";
type AutomationCaseSectionKey = "case" | "build" | "steps" | "history";
type AutomationWorkspaceTab = "details" | "steps" | "data" | "hooks" | "build" | "repository" | "runs";
type AutomationStepView = "keyword" | "code";
type AutomationCreationMode = "ai" | "record" | "blank";
type AutomationBehaviorKeyword = "Given" | "When" | "Then" | "And";
type RepositoryScreenTab = "overview" | "fields" | "dom";
type RepositoryFieldTab = "locators" | "evidence" | "meaning" | "healing";
type RepositoryInspectReviewTab = "selected" | "candidates" | "evidence";
const REPOSITORY_CONFIG_DRAWER_DEFAULT_WIDTH = 440;
const REPOSITORY_CONFIG_DRAWER_MIN_WIDTH = 360;
const REPOSITORY_CONFIG_DRAWER_MAX_WIDTH = 720;
const AUTOMATION_CASE_DETAIL_STALE_TIME_MS = 30_000;
const REPOSITORY_HIGHLIGHT_DURATION_MS = 1_000;

const automationCaseDetailQueryKey = (projectId: string, testCaseId: string) =>
  ["test-case-detail", projectId || "unselected", testCaseId] as const;

const clampRepositoryConfigDrawerWidth = (value: number) =>
  Math.min(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH, Math.max(REPOSITORY_CONFIG_DRAWER_MIN_WIDTH, value));

const normalizeAutomationParameterValues = (values?: Record<string, unknown> | null, scope: StepParameterScope = "t") =>
  normalizeStepParameterValues((values || {}) as Record<string, string>, scope);

type AutomationCaseDraft = {
  title: string;
  description: string;
  status: string;
  priority: string;
  parameterText: string;
};

type AutomationStepDraft = {
  step_type: TestStepType;
  behaviorKeyword: AutomationBehaviorKeyword;
  name: string;
  keyword: string;
  objectRef: string;
  value: string;
  expected_result: string;
  apiMethod: NonNullable<StepApiRequest["method"]>;
  apiHeaders: string;
  apiBodyMode: NonNullable<StepApiRequest["body_mode"]>;
  apiExpectedStatus: string;
};

type AutomationStepOptions = {
  screenshotOnFailure: boolean;
  optional: boolean;
  skip: boolean;
};

const REPOSITORY_PAGE_SIZE = 200;

type RecorderTab = {
  id: string | null;
  title: string | null;
  url: string;
  active?: boolean;
};

type RecorderInspectResult = {
  captured_at: string;
  page_id: string | null;
  page_title: string | null;
  page_url: string | null;
  screen_dom: string | null;
  accessibility_tree?: string | null;
  screen_fingerprint?: string | null;
  screen_screenshot_url: string | null;
  element_screenshot_url?: string | null;
  ancestor_screenshot_url?: string | null;
  element: RecorderInspectElement;
  selections?: RecorderInspectSelection[];
};

type RecorderLocatorValidationResponse = {
  validated_at: string;
  page_id: string | null;
  page_title: string | null;
  page_url: string | null;
  all_unique: boolean;
  unique_count: number;
  screen_dom: string | null;
  accessibility_tree: string | null;
  screen_fingerprint: string | null;
  screen_screenshot_url: string | null;
  fields: Array<{
    locator: string;
    name: string | null;
    match_count: number;
    is_unique: boolean;
    validation_status: "unique" | "missing" | "ambiguous" | "invalid";
    warning: string | null;
    dom_structure: string | null;
    ancestor_dom: string | null;
    element_screenshot_url: string | null;
    error: string | null;
  }>;
};

type RecorderInspectElement = {
  friendly_name: string;
  html_tag: string;
  role: string;
  locator: string;
  locator_kind: string;
  dom_structure: string;
  ancestor_dom?: string | null;
  locator_candidates?: Array<{
    locator: string;
    strategy: string;
    confidenceScore: number;
    matchCount?: number;
    stabilitySignals?: string[];
    warning?: string | null;
    recommended?: boolean;
  }>;
  text: string | null;
};

type RecorderInspectSelection = {
  element: RecorderInspectElement;
  element_screenshot_url?: string | null;
  ancestor_screenshot_url?: string | null;
};

const formatRunDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const AUTOMATION_KEYWORDS_BY_TYPE: Record<TestStepType, string[]> = {
  web: [
    "web.goto", "web.openTab", "web.switchTab", "web.closeTab", "web.reload", "web.goBack", "web.goForward",
    "web.click", "web.hover", "web.dblclick", "web.rightClick", "web.fill", "web.clear", "web.select",
    "web.check", "web.uncheck", "web.uploadFile", "web.uploadLocalFile", "web.uploadRemoteFile", "web.press",
    "web.drag", "web.scroll", "web.wait", "web.waitForLoadState", "web.expectVisible", "web.expectHidden", "web.expectText",
    "web.expectValue", "web.expectEnabled", "web.expectUrl", "web.text", "web.value", "web.captureText", "web.screenshot"
  ],
  api: ["api.request", "api.expectStatus", "api.expectJson", "api.capture"],
  android: [
    "android.tap", "android.tapByText", "android.tapPoint", "android.doubleTap", "android.longPress", "android.type",
    "android.clear", "android.hideKeyboard", "android.swipe", "android.scrollIntoView", "android.waitForDisplayed",
    "android.waitForExist", "android.waitForEnabled", "android.expectText", "android.expectDisplayed",
    "android.expectNotDisplayed", "android.expectEnabled", "android.expectValue", "android.captureText", "android.screenshot", "android.pushFile",
    "android.pushRemoteFile", "android.pullFile", "android.installApp", "android.removeApp", "android.startActivity",
    "android.openDeepLink", "android.pressBack", "android.pressKeyCode", "android.backgroundApp", "android.activateApp",
    "android.terminateApp", "android.setOrientation", "android.pause"
  ],
  ios: [
    "ios.tap", "ios.tapByText", "ios.tapPoint", "ios.doubleTap", "ios.longPress", "ios.type", "ios.clear",
    "ios.swipe", "ios.scrollIntoView", "ios.hideKeyboard", "ios.waitForDisplayed", "ios.waitForExist", "ios.waitForEnabled",
    "ios.expectDisplayed", "ios.expectNotDisplayed", "ios.expectText", "ios.expectEnabled", "ios.expectValue",
    "ios.captureText", "ios.screenshot", "ios.activateApp", "ios.terminateApp", "ios.setOrientation", "ios.pause"
  ]
};

const emptyAutomationStepDraft = (stepType: TestStepType = "web"): AutomationStepDraft => ({
  step_type: stepType,
  behaviorKeyword: stepType === "api" ? "When" : "When",
  name: "",
  keyword: AUTOMATION_KEYWORDS_BY_TYPE[stepType][0],
  objectRef: "",
  value: "",
  expected_result: "",
  apiMethod: "GET",
  apiHeaders: "",
  apiBodyMode: "none",
  apiExpectedStatus: "200"
});



function isAutomatedCase(testCase: TestCase) {
  return testCase.automated === "yes";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated === "no";
}

function normalizeMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeMetadataNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function metadataStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

type RepositoryLocator = {
  locator: string;
  strategy: string;
  confidenceScore: number;
  isPrimary?: boolean;
  isFallback?: boolean;
  lastValidatedStatus?: string;
  matchCount?: number;
  stabilitySignals?: string[];
  warning?: string | null;
  recommended?: boolean;
};

function inferLocatorStrategy(locator: string, kind?: string | null) {
  if (/data-testid/i.test(locator)) return "data-testid";
  if (/aria-label/i.test(locator)) return "aria-label";
  if (/getbyrole|role=/i.test(locator)) return "role + name";
  if (/^#|\bid=/i.test(locator)) return "stable id";
  if (/\bname=/i.test(locator)) return "name attribute";
  if (/placeholder/i.test(locator)) return "placeholder";
  if (/^text=|getbytext/i.test(locator)) return "text";
  if (/xpath|^\/\//i.test(locator)) return "xpath";
  return kind || "css";
}

function getRepositoryLocators(entry: AutomationLearningCacheEntry): RepositoryLocator[] {
  const fallback = Array.isArray(entry.metadata?.fallback_locators)
    ? entry.metadata.fallback_locators
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          locator: normalizeMetadataValue(item.locator),
          strategy: normalizeMetadataValue(item.strategy) || inferLocatorStrategy(normalizeMetadataValue(item.locator)),
          confidenceScore: normalizeMetadataNumber(item.confidenceScore ?? item.confidence, 0.6),
          isFallback: true,
          lastValidatedStatus: normalizeMetadataValue(item.lastValidatedStatus) || "pending"
        }))
        .filter((item) => item.locator)
    : [];

  return [{
    locator: entry.locator,
    strategy: inferLocatorStrategy(entry.locator, entry.locator_kind),
    confidenceScore: entry.confidence,
    isPrimary: true,
    lastValidatedStatus: normalizeMetadataValue(entry.metadata?.last_validated_status) || "pending"
  }, ...fallback];
}

function formatLocatorDraft(locators: RepositoryLocator[]) {
  return locators.filter((locator) => locator.isFallback).map((locator) =>
    `${locator.strategy} | ${locator.locator} | ${Math.round(locator.confidenceScore * 100)}`
  ).join("\n");
}

function parseLocatorDraft(value: string): RepositoryLocator[] {
  return value.split(/\n+/).map((line) => {
    const [strategy, locator, confidence] = line.split("|").map((part) => part.trim());
    return {
      strategy: strategy || inferLocatorStrategy(locator || ""),
      locator: locator || strategy,
      confidenceScore: Math.max(0, Math.min(1, (Number(confidence) || 70) / 100)),
      isFallback: true,
      lastValidatedStatus: "pending"
    };
  }).filter((item) => item.locator);
}

function formatRepositoryDate(value: unknown) {
  const text = normalizeMetadataValue(value);
  if (!text) return "Never validated";
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? text : formatRunDate.format(date);
}

function inferScreenName(title: string | null, url: string | null) {
  const trimmedTitle = String(title || "").replace(/\s+[|·-]\s+.*$/, "").trim();
  if (trimmedTitle && !/^new tab$/i.test(trimmedTitle)) {
    return trimmedTitle;
  }

  try {
    const segment = new URL(String(url || "")).pathname.split("/").filter(Boolean).pop() || "screen";
    return toFriendlyElementName(segment, "Screen");
  } catch {
    return "Captured Screen";
  }
}

function inferUrlPattern(url: string | null) {
  try {
    const path = new URL(String(url || "")).pathname;
    return { type: "endsWith", value: path || "/" };
  } catch {
    return { type: "contains", value: url || "" };
  }
}

function getCapturedLocatorsForElement(element: RecorderInspectElement): RepositoryLocator[] {
  const captured = element.locator_candidates || [];
  if (captured.length) {
    return captured.map((candidate, index) => ({
      locator: candidate.locator,
      strategy: candidate.strategy,
      confidenceScore: candidate.confidenceScore,
      matchCount: candidate.matchCount,
      stabilitySignals: candidate.stabilitySignals,
      warning: candidate.warning,
      recommended: candidate.recommended,
      isPrimary: index === 0,
      isFallback: index > 0,
      lastValidatedStatus: "pending"
    }));
  }

  return [{
    locator: element.locator,
    strategy: inferLocatorStrategy(element.locator, element.locator_kind),
    confidenceScore: element.locator.includes("data-testid") ? 0.95 : 0.75,
    isPrimary: true,
    lastValidatedStatus: "pending"
  }];
}

function getCapturedLocators(result: RecorderInspectResult): RepositoryLocator[] {
  return getCapturedLocatorsForElement(result.element);
}

function getScreenName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.screen_name) || entry.page_key || "Unassigned screen";
}

function makeRepositoryScreenKey(screenName: string, appTypeId?: string | null) {
  return `${appTypeId || "workspace"}::${screenName}`;
}

function getRepositoryScreenKey(entry: AutomationLearningCacheEntry) {
  return makeRepositoryScreenKey(getScreenName(entry), entry.app_type_id);
}

function getObjectName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_name) || entry.locator_intent || "Unnamed object";
}

function getObjectRole(entry: AutomationLearningCacheEntry) {
  const value = normalizeMetadataValue(entry.metadata?.object_role) || entry.locator_kind || entry.source || "field";
  const parts = value.split(/\s*\/\s*/).filter(Boolean);
  return parts[parts.length - 1] || value;
}

function splitRepositoryRole(value: string, fallbackTag = "element", fallbackRole = "field") {
  const parts = value.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  return {
    tag: parts[0] || fallbackTag,
    role: parts[parts.length - 1] || fallbackRole
  };
}

function getRepositoryImportKindLabel(kind: ObjectRepositoryImportPreview["inputKinds"][number]) {
  if (kind === "csv") return "CSV export";
  if (kind === "zip") return "ZIP archive";
  return "Page object source";
}

function extractQuotedTargets(code?: string | null) {
  if (!code) {
    return [];
  }

  const targets = new Set<string>();
  const callPattern = /web\.(?:click|fill|select|check|uncheck|hover|press|expect(?:Text|Visible|Hidden)?)\(\s*(['"`])([\s\S]*?)\1/g;
  let match = callPattern.exec(code);

  while (match) {
    if (match[2]?.trim()) {
      targets.add(match[2].trim());
    }
    match = callPattern.exec(code);
  }

  return Array.from(targets);
}

function extractVariables(step: TestStep) {
  const values = `${step.action || ""} ${step.expected_result || ""} ${step.automation_code || ""}`;
  const variables = new Set<string>();
  const pattern = /(?<![A-Za-z0-9_])@((?:t|s|r)\.[A-Za-z][A-Za-z0-9_-]*)|\{\{\s*([^}]+?)\s*\}\}/g;
  let match = pattern.exec(values);

  while (match) {
    const variable = match[1] || match[2];
    if (variable?.trim()) {
      variables.add(variable.trim());
    }
    match = pattern.exec(values);
  }

  return Array.from(variables);
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

function getRepositoryScreenUrl(entries: AutomationLearningCacheEntry[]) {
  return entries.find((entry) => entry.page_url)?.page_url || repositoryInspectLegacyPageUrl(entries[0]?.page_key) || "No URL captured";
}

function isLikelyImageUrl(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:image/");
}

function buildSuggestedFieldName(entry: AutomationLearningCacheEntry) {
  const role = getObjectRole(entry).toLowerCase();
  const name = getObjectName(entry).toLowerCase();

  if (name.includes("password") || role.includes("password")) {
    return "password";
  }

  if (name.includes("user") || name.includes("email") || role.includes("textbox")) {
    return name.includes("email") ? "email" : "username";
  }

  if (name.includes("forgot")) {
    return "forgot_password";
  }

  if (name.includes("remember")) {
    return "remember_me";
  }

  if (name.includes("sign") || name.includes("login") || role.includes("button")) {
    return "sign_in";
  }

  return getObjectName(entry).replace(/\s+/g, "_").toLowerCase();
}

function formatAutomationCaseId(sequence: number) {
  return `AT-${String(sequence + 1).padStart(3, "0")}`;
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg aria-hidden="true" className={isExpanded ? "accordion-chevron is-expanded" : "accordion-chevron"} viewBox="0 0 20 20">
      <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function AutomationAccordionSection({
  actions,
  children,
  countLabel,
  isExpanded,
  onToggle,
  stage,
  summary,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  countLabel?: string;
  isExpanded: boolean;
  onToggle: () => void;
  stage?: AutomationCaseSectionKey;
  summary: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={["editor-accordion-section", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} data-automation-stage={stage}>
      <div className="editor-accordion-head">
        <button className="editor-accordion-toggle" onClick={onToggle} type="button">
          <span className="editor-accordion-icon"><ChevronIcon isExpanded={isExpanded} /></span>
          <span className="editor-accordion-toggle-main">
            <span className="editor-accordion-toggle-copy">
              <strong>{title}</strong>
              <span>{summary}</span>
            </span>
            <span className="editor-accordion-toggle-meta">
              {countLabel ? <span className="editor-accordion-toggle-count">{countLabel}</span> : null}
              <span className="editor-accordion-toggle-state">{isExpanded ? "Hide" : "Show"}</span>
            </span>
          </span>
        </button>
        {actions ? <div className="automation-accordion-actions">{actions}</div> : null}
      </div>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function toFriendlyElementName(value: string, fallback = "Element") {
  const normalized = value
    .replace(/^text=/i, "")
    .replace(/^[#.]+/, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(click|input|element|field|button|link|label|aria|text|at)\b/gi, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  const tokens = normalized ? normalized.split(/\s+/).slice(0, 4) : [fallback];
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

function isNoisyRepositoryName(value?: string | null) {
  const normalized = normalizeMetadataValue(value).trim();
  if (!normalized) return true;
  return /\b(click\s*at|scroll|viewport|location|browser|document|window)\b/i.test(normalized) || /\d{3,}/.test(normalized);
}

function isNonElementRepositoryEntry(entry: AutomationLearningCacheEntry) {
  const locator = String(entry.locator || "").trim().toLowerCase();
  const intent = String(entry.locator_intent || "").trim().toLowerCase();
  const role = getObjectRole(entry).toLowerCase();
  const blockedLocators = new Set(["viewport", "location", "browser.tab", "keyboard", "window", "document", "page"]);
  const blockedIntents = new Set(["scroll", "navigation", "navigate", "goto", "tab", "press"]);
  return isScreenRepositoryRecord(entry) || blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
}

function isScreenRepositoryRecord(entry: AutomationLearningCacheEntry) {
  return entry.locator_intent === "__screen__" || entry.metadata?.record_kind === "screen" || entry.source === "manual_screen";
}

function getRepositoryMemberName(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  // Saved names are execution bindings. A locator repair must not rename the
  // member (or change its casing) merely because its CSS selector changed.
  const storedName = normalizeMetadataValue(metadata.object_name) || normalizeMetadataValue(metadata.member_name) || normalizeMetadataValue(metadata.field_name);
  if (storedName) {
    const prefix = `${getScreenName(entry)}.`;
    return storedName.startsWith(prefix) ? storedName.slice(prefix.length) : storedName;
  }
  const locator = String(entry.locator || "");
  const locatorLabel =
    locator.match(/\[(?:aria-label|placeholder|name|data-testid|id)=["']?([^"'\]]+)["']?\]/i)?.[1] ||
    locator.match(/^#([\w-]+)/)?.[1] ||
    locator.match(/^text=(.+)$/i)?.[1] ||
    "";
  const explicit =
    normalizeMetadataValue(metadata.field_name) ||
    normalizeMetadataValue(metadata.member_name) ||
    normalizeMetadataValue(metadata.object_label);
  const objectName = normalizeMetadataValue(metadata.object_name);
  const objectNameValue = isNoisyRepositoryName(objectName) ? "" : objectName;
  const intent = /^(click|fill|change|input|element|field|object|scroll|viewport)$/i.test(entry.locator_intent || "") ? "" : entry.locator_intent;
  const tail = explicit.includes(".") ? explicit.split(".").filter(Boolean).pop() || explicit : explicit;
  const candidates = [locatorLabel, isNoisyRepositoryName(tail) ? "" : tail, objectNameValue, isNoisyRepositoryName(intent) ? "" : intent, locator];
  return toFriendlyElementName(candidates.find((candidate) => candidate && !isNoisyRepositoryName(toFriendlyElementName(candidate))) || "Element");
}

function getRepositoryHtmlTag(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  const explicit =
    normalizeMetadataValue(metadata.html_tag) ||
    normalizeMetadataValue(metadata.tag_name) ||
    normalizeMetadataValue(metadata.tag) ||
    normalizeMetadataValue(metadata.element_tag);
  const dom = normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html);
  const domTag = dom.match(/<\s*([a-z][a-z0-9-]*)/i)?.[1] || "";
  const locatorTag = String(entry.locator || "").match(/^([a-z][a-z0-9-]*)[#.[\s]/i)?.[1] || "";
  const role = getObjectRole(entry).toLowerCase();

  if (explicit) return explicit.toLowerCase();
  if (domTag) return domTag.toLowerCase();
  if (locatorTag) return locatorTag.toLowerCase();
  if (role.includes("button")) return "button";
  if (role.includes("link")) return "a";
  if (role.includes("select") || role.includes("dropdown")) return "select";
  if (role.includes("textarea")) return "textarea";
  if (role.includes("checkbox") || role.includes("toggle")) return "input";
  if (role.includes("field") || role.includes("textbox") || role.includes("input")) return "input";
  return "element";
}

function formatParameterText(values?: Record<string, string> | null) {
  return Object.entries(values || {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseParameterText(value: string) {
  return value.split(/\n+/).reduce<Record<string, string>>((accumulator, line) => {
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey?.trim();
    if (key) {
      accumulator[key] = rest.join("=").trim();
    }
    return accumulator;
  }, {});
}

function parseAutomationStepOptions(step: TestStep): AutomationStepOptions {
  const code = step.automation_code || step.action || "";
  const optionMatch = code.match(/@hellotest-options\s+([^\n]+)/i);
  const flags = new Set((optionMatch?.[1] || "").split(/\s+/).filter(Boolean));

  return {
    screenshotOnFailure: flags.has("screenshotOnFailure"),
    optional: flags.has("optional"),
    skip: flags.has("skip")
  };
}

function applyAutomationStepOptions(code: string, options: AutomationStepOptions) {
  const cleaned = code.replace(/^\s*\/\/\s*@hellotest-options\s+[^\n]*\n?/i, "").trim();
  const flags = [
    options.screenshotOnFailure ? "screenshotOnFailure" : "",
    options.optional ? "optional" : "",
    options.skip ? "skip" : ""
  ].filter(Boolean);

  return flags.length ? `// @hellotest-options ${flags.join(" ")}\n${cleaned}` : cleaned;
}

function getAutomationStepTypeLabel(step: TestStep) {
  const value = step.step_type || "web";
  return value === "android" ? "Android" : value === "ios" ? "iOS" : value.toUpperCase();
}

function inferAutomationStepType(keyword?: string | null, fallback?: TestStepType | null): TestStepType {
  const normalized = String(keyword || "").toLowerCase();
  if (normalized.startsWith("api.")) return "api";
  if (normalized.startsWith("android.")) return "android";
  if (normalized.startsWith("ios.")) return "ios";
  if (normalized.startsWith("mobile.")) return fallback === "ios" ? "ios" : "android";
  return fallback || "web";
}

function formatKeywordDisplay(keyword: string) {
  const [namespace, action] = keyword.split(".");
  if (!namespace || !action) {
    return keyword;
  }
  return `${namespace.charAt(0).toUpperCase()}${namespace.slice(1)}.${action}`;
}

function formatObjectReferenceLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "No locator selected";
  }
  const parts = trimmed.split(".");
  return parts.length > 1 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : trimmed;
}

function formatAutomationKeywordReadable(draft: AutomationStepDraft, variables: string[] = []) {
  const keyword = formatKeywordDisplay(draft.keyword);
  const target = formatObjectReferenceLabel(draft.objectRef);
  const dataReference = draft.value.trim() || variables.find((variable) => variable.startsWith("t.") || variable.startsWith("s.") || variable.startsWith("r."));
  return `${keyword} ${target}${dataReference ? ` using @${dataReference.replace(/^@/, "")}` : ""}`;
}

function getRecorderEngineBaseUrl(session: RecorderSessionResponse | null) {
  const source = session?.status_url || session?.live_view_url || session?.engine_base_url || "";
  const match = source.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1] || "";
}

async function readRecorderJson<T>(url: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: options?.signal || AbortSignal.timeout(30_000),
    headers
  });

  if (response.status === 204) {
    return null as T | null;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || `Request failed with status ${response.status}`), { status: response.status });
  }

  return payload as T;
}

async function readInspectSessionJson<T>(session: RecorderSessionResponse, path: string, options?: RequestInit) {
  const request = inspectSessionRequest(session, path, options);
  return readRecorderJson<T>(request.url, request.options);
}

function connectLocalInspectSession(runtime: RepositoryLocalAgent, session: RecorderSessionResponse) {
  return {
    ...session,
    purpose: "repository-inspect" as const,
    recorder_mode: "local" as const,
    inspector_agent_token: runtime.token,
    engine_base_url: runtime.publicBaseUrl,
    status_url: `${runtime.publicBaseUrl}/api/v1/recorder/sessions/${encodeURIComponent(session.id)}`,
    live_view_url: session.live_view_path
      ? `${runtime.publicBaseUrl}${session.live_view_path}`
      : session.live_view_url
  };
}

function extractRepositoryFieldsFromDom(dom: string) {
  const source = String(dom || "");
  const fieldPattern = /<\s*(input|button|select|textarea|a)\b([^>]*)>/gi;
  const attrPattern = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const fields: Array<{ name: string; tag: string; role: string; locator: string; locatorKind: string; dom: string; fallbackLocators: RepositoryLocator[] }> = [];
  let match = fieldPattern.exec(source);

  while (match) {
    const tag = match[1].toLowerCase();
    const rawAttributes = match[2] || "";
    const attrs: Record<string, string> = {};
    let attrMatch = attrPattern.exec(rawAttributes);
    while (attrMatch) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
      attrMatch = attrPattern.exec(rawAttributes);
    }

    const label = attrs["aria-label"] || attrs.placeholder || attrs.name || attrs.id || attrs["data-testid"] || attrs.role || tag;
    const name = toFriendlyElementName(label, tag).replace(/\s+/g, "_").toLowerCase();
    const inputType = (attrs.type || "").toLowerCase();
    const semanticRole = attrs.role
      || (tag === "button" ? "button" : "")
      || (tag === "a" ? "link" : "")
      || (tag === "select" ? "combobox" : "")
      || (tag === "textarea" || (tag === "input" && !["checkbox", "radio", "file"].includes(inputType)) ? "textbox" : "")
      || (tag === "input" && ["checkbox", "radio"].includes(inputType) ? inputType : "");
    const quoted = (value: string) => JSON.stringify(value);
    const locatorCandidates = ([
      attrs["data-testid"] ? { locator: `getByTestId(${quoted(attrs["data-testid"])})`, strategy: "playwright test id", confidenceScore: 0.99 } : null,
      semanticRole && label ? { locator: `getByRole(${quoted(semanticRole)}, { name: ${quoted(label)} })`, strategy: "playwright role + name", confidenceScore: 0.97 } : null,
      attrs["aria-label"] ? { locator: `${tag}[aria-label="${attrs["aria-label"]}"]`, strategy: "aria-label", confidenceScore: 0.9 } : null,
      attrs.placeholder ? { locator: `getByPlaceholder(${quoted(attrs.placeholder)})`, strategy: "playwright placeholder", confidenceScore: 0.88 } : null,
      attrs.id ? { locator: `#${attrs.id}`, strategy: "stable id", confidenceScore: 0.88 } : null,
      attrs.name ? { locator: `${tag}[name="${attrs.name}"]`, strategy: "name attribute", confidenceScore: 0.84 } : null,
      tag === "button" || tag === "a" ? { locator: `getByText(${quoted(label)})`, strategy: "playwright text", confidenceScore: 0.7 } : null,
      { locator: tag, strategy: "css", confidenceScore: 0.4 }
    ] as Array<RepositoryLocator | null>).filter((candidate): candidate is RepositoryLocator => Boolean(candidate));
    const locator = locatorCandidates[0].locator;

    if (!fields.some((field) => field.locator === locator)) {
      fields.push({
        name,
        tag,
        role: attrs.role || attrs.type || tag,
        locator,
        locatorKind: locatorCandidates[0].strategy,
        dom: match[0],
        fallbackLocators: locatorCandidates.slice(1).map((candidate) => ({ ...candidate, isFallback: true, lastValidatedStatus: "pending" }))
      });
    }
    match = fieldPattern.exec(source);
  }

  return fields.slice(0, 40);
}

type RepositoryExtractedField = ReturnType<typeof extractRepositoryFieldsFromDom>[number] & {
  description?: string | null;
  businessMeaning?: string | null;
  usageKeywords?: string[];
  source?: "live_inspect" | "dom_candidate" | "ai_extract";
  sourceLocator?: string;
  pageUrl?: string | null;
  targetCriteria?: string | null;
  elementScreenshotUrl?: string | null;
  ancestorScreenshotUrl?: string | null;
  ancestorDom?: string | null;
  locatorCandidates?: RepositoryLocator[];
  validatedAt?: string | null;
  validationStatus?: "unique" | "missing" | "ambiguous" | "invalid" | "unverified";
  validationWarning?: string | null;
};

function getInspectSelections(result: RecorderInspectResult): RecorderInspectSelection[] {
  return result.selections?.length
    ? result.selections
    : [{
        element: result.element,
        element_screenshot_url: result.element_screenshot_url,
        ancestor_screenshot_url: result.ancestor_screenshot_url
      }];
}

function buildRepositoryFieldFromInspectSelection(result: RecorderInspectResult, selection: RecorderInspectSelection): RepositoryExtractedField {
  const candidates = getCapturedLocatorsForElement(selection.element);
  const primaryLocator = candidates[0] || {
    locator: selection.element.locator,
    strategy: inferLocatorStrategy(selection.element.locator, selection.element.locator_kind),
    confidenceScore: 0.75,
    isPrimary: true,
    lastValidatedStatus: "pending"
  };

  return {
    name: selection.element.friendly_name,
    tag: selection.element.html_tag,
    role: selection.element.role,
    locator: primaryLocator.locator,
    locatorKind: primaryLocator.strategy,
    locatorCandidates: candidates,
    dom: selection.element.dom_structure,
    fallbackLocators: candidates.slice(1),
    source: "live_inspect",
    pageUrl: result.page_url,
    targetCriteria: selection.element.text,
    elementScreenshotUrl: selection.element_screenshot_url || result.element_screenshot_url,
    ancestorScreenshotUrl: selection.ancestor_screenshot_url || result.ancestor_screenshot_url,
    ancestorDom: selection.element.ancestor_dom,
    description: `${selection.element.friendly_name} captured during live inspection.`
  };
}

function parseAutomationStepDraft(step: TestStep): AutomationStepDraft {
  const code = step.automation_code || "";
  const call = parseAutomationKeywordCall(code);
  const stepType = inferAutomationStepType(call?.keyword, step.step_type || "web");
  const parsedKeyword = stepType === "ios" ? call?.keyword.replace(/^(?:mobile|android)\./, "ios.") : call?.keyword;
  const keyword = parsedKeyword && AUTOMATION_KEYWORDS_BY_TYPE[stepType].includes(parsedKeyword)
    ? parsedKeyword
    : AUTOMATION_KEYWORDS_BY_TYPE[stepType][0];
  const args = call?.args || [];
  const actionText = (step.action || "").trim();
  const behaviorMatch = actionText.match(/^(Given|When|Then|And)\s+(.+)$/i);
  const inferredBehavior: AutomationBehaviorKeyword = /(?:expect|assert|verify|capture|screenshot)/i.test(keyword)
    ? "Then"
    : /(?:goto|open|wait|background|activate)/i.test(keyword) ? "Given" : "When";
  const apiRequest = step.api_request || null;
  const parsedApiTarget = args[0]?.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  let objectRef = apiRequest?.url || parsedApiTarget?.[2] || args[0] || "";
  let value = apiRequest?.body || args[1] || "";
  if (["web.wait", "web.waitForLoadState", "web.expectUrl"].includes(keyword) || (keyword === "web.expectText" && args.length === 1)) {
    objectRef = "";
    value = args[0] || "";
  } else if (keyword === "web.scroll") {
    const x = Number(args[0] || 0);
    const y = Number(args[1] || 0);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      objectRef = x ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down";
      value = String(Math.abs(x || y));
    } else if (/^-?@/.test(args[0] || "") || /^-?@/.test(args[1] || "")) {
      const horizontal = /^-?@/.test(args[0] || "");
      const distance = args[horizontal ? 0 : 1];
      objectRef = horizontal ? distance.startsWith("-") ? "left" : "right" : distance.startsWith("-") ? "up" : "down";
      value = distance.replace(/^-/, "");
    }
  } else if (/^(?:android|ios|mobile)\.swipe$/.test(keyword)) {
    objectRef = args.slice(0, 2).join(",");
    value = args.slice(2, 5).join(",");
  }

  return {
    step_type: stepType,
    behaviorKeyword: behaviorMatch ? `${behaviorMatch[1][0].toUpperCase()}${behaviorMatch[1].slice(1).toLowerCase()}` as AutomationBehaviorKeyword : inferredBehavior,
    name: behaviorMatch?.[2] || actionText,
    keyword,
    objectRef,
    value,
    expected_result: step.expected_result || "",
    apiMethod: apiRequest?.method || (parsedApiTarget?.[1]?.toUpperCase() as NonNullable<StepApiRequest["method"]> | undefined) || "GET",
    apiHeaders: (apiRequest?.headers || []).map((header) => `${header.key}: ${header.value}`).join("\n"),
    apiBodyMode: apiRequest?.body_mode || (apiRequest?.body ? "json" : "none"),
    apiExpectedStatus: String(apiRequest?.validations?.find((validation) => validation.kind === "status")?.expected || "200")
  };
}

function buildAutomationStepAction(draft: AutomationStepDraft) {
  const description = (draft.name.trim() || formatAutomationKeywordReadable(draft)).replace(/^(Given|When|Then|And)\s+/i, "");
  return description;
}

function parseApiHeaderDraft(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 1) return null;
      const key = line.slice(0, separatorIndex).trim();
      const headerValue = line.slice(separatorIndex + 1).trim();
      return key ? { key, value: headerValue } : null;
    })
    .filter((header): header is { key: string; value: string } => Boolean(header));
}

function buildAutomationApiRequest(draft: AutomationStepDraft, existing?: StepApiRequest | null): StepApiRequest | null {
  if (draft.step_type !== "api" || draft.keyword !== "api.request") return null;
  const expectedStatus = Number.parseInt(draft.apiExpectedStatus, 10);
  const existingStatus = existing?.validations?.find((item) => item.kind === "status");
  const statusUnchanged = Boolean(existing) && String(existingStatus?.expected ?? "200") === draft.apiExpectedStatus.trim();
  return {
    ...existing,
    method: draft.apiMethod,
    url: draft.objectRef.trim(),
    headers: parseApiHeaderDraft(draft.apiHeaders),
    body_mode: draft.apiBodyMode,
    body: draft.apiBodyMode === "none" ? null : draft.value,
    timeout_ms: existing?.timeout_ms ?? 30_000,
    follow_redirects: existing?.follow_redirects ?? true,
    validations: statusUnchanged ? existing?.validations || [] : [...(existing?.validations || []).filter((item) => item.kind !== "status"), ...(Number.isFinite(expectedStatus)
      ? [{ ...existingStatus, kind: "status" as const, operator: existingStatus?.operator || "eq" as const, expected: String(expectedStatus) }]
      : [])]
  };
}

function buildAutomationCodeFromDraft(draft: AutomationStepDraft) {
  const q = (value: string) => JSON.stringify(value);
  const objectRef = draft.objectRef.trim();
  const targetRef = objectRef;
  const value = draft.value.trim();
  if (draft.keyword.startsWith("api.")) {
    if (draft.keyword === "api.expectStatus") {
      return `await api.expectStatus(${automationNumericArgument(objectRef, 200)});`;
    }
    if (draft.keyword === "api.expectJson") {
      return `await api.expectJson(${q(targetRef)}, ${q(value)});`;
    }
    if (draft.keyword === "api.capture") {
      return `await api.capture(${q(targetRef)}, ${q(value)});`;
    }
    return `await api.request(${q(`${draft.apiMethod} ${objectRef || "/"}`)}${value ? `, ${q(value)}` : ""});`;
  }
  if (/^(?:android|ios|mobile)\./.test(draft.keyword)) {
    const nativePrefix = draft.step_type === "ios" ? "ios" : "android";
    const keyword = draft.keyword.replace(/^(?:mobile|ios)\./, "android.");
    if (["android.hideKeyboard", "android.pressBack", "android.screenshot"].includes(keyword)) return `await ${keyword.replace(/^android/, nativePrefix)}();`;
    if (keyword === "android.aiStep") return `await ${nativePrefix}.aiStep(${q(value)}, ${objectRef ? `{ selector: ${q(objectRef)} }` : "{}"});`;
    if (["android.type", "android.select", "android.press", "android.expectText", "android.expectValue", "android.captureText", "android.captureValue", "android.pushFile", "android.pushRemoteFile", "android.startActivity", "android.openDeepLink", "android.deepLink"].includes(keyword)) {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef)}, ${q(value)});`;
    }
    if (keyword === "android.drag") {
      return `await ${nativePrefix}.drag(${q(targetRef)}, ${q(value)});`;
    }
    if (["android.longPress", "android.waitForDisplayed", "android.waitForExist", "android.waitForEnabled", "android.expectNotDisplayed"].includes(keyword)) {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef)}, ${automationNumericArgument(value, keyword === "android.longPress" ? 800 : 10000)});`;
    }
    if (keyword === "android.swipe") {
      const points = `${objectRef},${value}`.split(",");
      return `await ${nativePrefix}.swipe(${[0, 1, 2, 3, 4].map((index) => automationNumericArgument(points[index] || "", index === 4 ? 300 : 0)).join(", ")});`;
    }
    if (keyword === "android.scrollIntoView") return `await ${nativePrefix}.scrollIntoView(${q(targetRef)}, { direction: ${q(value || "down")} });`;
    if (keyword === "android.pause" || keyword === "android.pressKeyCode" || keyword === "android.backgroundApp") {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${automationNumericArgument(objectRef, keyword === "android.pressKeyCode" ? 66 : keyword === "android.backgroundApp" ? 3 : 1000)});`;
    }
    return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef)});`;
  }
  if (draft.keyword === "web.aiStep") return `await web.aiStep(${q(value)}, ${objectRef ? `{ target: ${q(objectRef)} }` : "{}"});`;
  if (draft.keyword === "web.goto") return `await web.goto(${q(objectRef)});`;
  if (draft.keyword === "web.expectUrl") return `await web.expectUrl(${q(value)});`;
  if (draft.keyword === "web.openTab") return objectRef ? `await web.openTab(${q(objectRef)});` : "await web.openTab();";
  if (draft.keyword === "web.wait" || draft.keyword === "web.waitForTimeout") {
    return `await web.wait(${automationNumericArgument(value, 1000)});`;
  }
  if (draft.keyword === "web.waitForLoadState") {
    return `await web.waitForLoadState(${automationParameterArgument(value) || q(value || "domcontentloaded")});`;
  }
  if (draft.keyword === "web.scroll") {
    const parameterDirection = automationParameterArgument(objectRef);
    if (parameterDirection) return `{ const direction = String(${parameterDirection}).toLowerCase(); const amount = ${automationNumericArgument(value, 600)}; await web.scroll(direction === "left" ? -amount : direction === "right" ? amount : 0, direction === "up" ? -amount : direction === "down" ? amount : 0); }`;
    const direction = /^(up|down|left|right)$/i.test(objectRef) ? objectRef.toLowerCase() : "down";
    const amount = automationNumericArgument(value, 600);
    const signedAmount = direction === "up" || direction === "left" ? `-(${amount})` : amount;
    return `await web.scroll(${direction === "left" || direction === "right" ? `${signedAmount}, 0` : `0, ${signedAmount}`});`;
  }
  if (draft.keyword === "web.drag") {
    return `await web.drag(${q(targetRef)}, ${q(value)});`;
  }
  if (draft.keyword === "web.press") {
    return objectRef
      ? `await web.press(${q(objectRef)}, ${q(value)});`
      : `await web.press(null, ${q(value)});`;
  }
  if (["web.uploadFile", "web.uploadLocalFile"].includes(draft.keyword)) {
    return `await ${draft.keyword}(${q(targetRef)}, ${q(value)}, { waitFor: "attached" });`;
  }
  if (draft.keyword === "web.uploadRemoteFile") {
    return `await web.uploadRemoteFile(${q(targetRef)}, ${q(value)}, { waitFor: "attached" });`;
  }
  if (draft.keyword === "web.expectText" && !objectRef) return `await web.expectText(${q(value)});`;
  if (["web.fill", "web.select", "web.expectText", "web.expectValue", "web.captureText"].includes(draft.keyword)) {
    return `await ${draft.keyword}(${q(targetRef)}, ${q(value)});`;
  }
  if (draft.keyword === "web.screenshot") {
    return 'await web.screenshot("automation-step");';
  }
  if (["web.switchTab", "web.closeTab"].includes(draft.keyword)) {
    return objectRef ? `await ${draft.keyword}(${q(objectRef)});` : `await ${draft.keyword}();`;
  }
  if (getAutomationKeywordInputSpec(draft.keyword).target === "none" && !getAutomationKeywordInputSpec(draft.keyword).showValue) return `await ${draft.keyword}();`;
  return `await ${draft.keyword}(${q(targetRef)});`;
}

function escapeAutomationPdfHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function AutomationPage({ initialView = "cases" }: { initialView?: AutomationView } = {}) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const { getPrompt } = useAiPromptRegistry(Boolean(session));
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const isAutomationWorkspaceEnabled = areFeatureFlagsEnabled(
    featureFlagsQuery.data,
    ["hellotest.automation.workspace"]
  );
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
  const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
  const canUseAutomationBuilder = canEditAutomationCode;
  const canUpdateAutomationCase = canUseAutomationBuilder && hasPermission(session, "testcase.update", projectId);
  const canCreateAutomationDraft = canUseAutomationBuilder && hasPermission(session, "testcase.create", projectId);
  const canUseAutomationAi = resolveCanGenerateAutomationCode(session, featureFlagsQuery.data, projectId);
  const canUseRecorder = resolveCanRecordAutomationCode(session, featureFlagsQuery.data, projectId);
  const canInspectRepository = hasPermission(session, "automation.repository.manage", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.object_repository"]);
  const canUseMobileAppium = hasPermission(session, "mobile.manage", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.mobile.appium"]);
  const canRunLocalAutomation = hasPermission(session, "automation.run.local", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.local_execution"]);
  const canRunRemoteAutomation = hasPermission(session, "automation.run.remote", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.remote_execution"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<AutomationView>(initialView);
  const [selectedAutomatedCaseId, setSelectedAutomatedCaseId] = useState("");
  const [selectedManualCaseId, setSelectedManualCaseId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [automationCatalogViewMode, setAutomationCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [automationCaseSearch, setAutomationCaseSearch] = useState("");
  const [selectedAutomationCaseIds, setSelectedAutomationCaseIds] = useState<string[]>([]);
  const [activeAutomationWorkspaceTab, setActiveAutomationWorkspaceTab] = useState<AutomationWorkspaceTab>("details");
  const [expandedCaseSections, setExpandedCaseSections] = useState<Record<AutomationCaseSectionKey, boolean>>({
    case: true,
    build: true,
    steps: true,
    history: false
  });
  const [isCreateAutomationOpen, setIsCreateAutomationOpen] = useState(false);
  const [requestedCreationMode, setAutomationCreationMode] = useState<AutomationCreationMode>("ai");
  // A revoked or unavailable optional method must never strand the authoring form.
  const automationCreationMode = requestedCreationMode === "ai" && !canUseAutomationAi
    || requestedCreationMode === "record" && !canUseRecorder ? "blank" : requestedCreationMode;
  const canCreateAutomationCase = canCreateAutomationDraft
    && (automationCreationMode !== "ai" || canUseAutomationAi)
    && (automationCreationMode !== "record" || canUseRecorder);
  const [automationCreateManualCaseIds, setAutomationCreateManualCaseIds] = useState<string[]>([]);
  const [automationManualLinkDraftIds, setAutomationManualLinkDraftIds] = useState<string[]>([]);
  const [activeRelationshipPanel, setActiveRelationshipPanel] = useState<"manual" | "runs" | "bugs" | null>("manual");
  const [agentMission, setAgentMission] = useState("");
  const [automationCreateMetadata, setAutomationCreateMetadata] = useState<AutomationMetadata>(emptyAutomationMetadata);
  const [automationCreateSteps, setAutomationCreateSteps] = useState<AutomationDraftBehavior[]>([]);
  const automationCreateTouchedMetadataRef = useRef(new Set<keyof AutomationMetadata>());
  const [caseRequirementIds, setCaseRequirementIds] = useState<string[]>([]);
  const [caseModuleIds, setCaseModuleIds] = useState<string[]>([]);
  const [caseDataSetId, setCaseDataSetId] = useState("");
  const [newStepIsPrecondition, setNewStepIsPrecondition] = useState(false);
  const [buildMethod, setBuildMethod] = useState<"agent" | "record">("agent");
  useEffect(() => {
    if (!canUseAutomationAi && canUseRecorder) setBuildMethod("record");
    else if (!canUseRecorder && canUseAutomationAi) setBuildMethod("agent");
  }, [canUseAutomationAi, canUseRecorder]);
  const [agentScheduledAt, setAgentScheduledAt] = useState("");
  const [agentBuildReceipt, setAgentBuildReceipt] = useState("");
  const [agentBuildStatus, setAgentBuildStatus] = useState<"idle" | "queued" | "running" | "completed" | "failed" | "paused">("idle");
  const [agentBuildTracking, setAgentBuildTracking] = useState<{ transactionId: string; projectId: string; caseIds: string[]; scheduledAt: string | null; startedAt: number } | null>(null);
  const automationBuildDraftBaselineRef = useRef<{ steps: Record<string, AutomationStepDraft>; options: Record<string, AutomationStepOptions>; code: Record<string, string> }>({ steps: {}, options: {}, code: {} });
  const recorderOriginRef = useRef<{ caseId: string; projectId: string; targetStepId: string } | null>(null);
  const currentAutomationSelectionRef = useRef({ projectId, selectedCaseId, workspaceTab: activeAutomationWorkspaceTab });
  currentAutomationSelectionRef.current = { projectId, selectedCaseId, workspaceTab: activeAutomationWorkspaceTab };
  const [isBatchAgentOpen, setIsBatchAgentOpen] = useState(false);
  const [isAutomationCodePreviewOpen, setIsAutomationCodePreviewOpen] = useState(false);
  const [selectedAutomationStepIds, setSelectedAutomationStepIds] = useState<string[]>([]);
  const [automationGroupName, setAutomationGroupName] = useState("");
  const [saveAutomationGroupAsShared, setSaveAutomationGroupAsShared] = useState(false);
  const [isSharedGroupLibraryOpen, setIsSharedGroupLibraryOpen] = useState(false);
  const [automationStepView, setAutomationStepView] = useState<AutomationStepView>("keyword");
  const [expandedAutomationStepIds, setExpandedAutomationStepIds] = useState<string[]>([]);
  const [automationStudioStep, setAutomationStudioStep] = useState<TestStep | null>(null);
  const [caseDraft, setCaseDraft] = useState<AutomationCaseDraft>({
    title: "",
    description: "",
    status: "active",
    priority: "3",
    parameterText: ""
  });
  const lastAutomationCaseDraftSeedRef = useRef<{ caseKey: string; detail: TestCase } | null>(null);
  const [stepDrafts, setStepDrafts] = useState<Record<string, AutomationStepDraft>>({});
  const [apiSourceDrafts, setApiSourceDrafts] = useState<Record<string, string>>({});
  const [stepCodeDrafts, setStepCodeDrafts] = useState<Record<string, string>>({});
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
  const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
  const lastAutomationSuiteParameterSeedRef = useRef<{ suiteId: string; values: Record<string, string> } | null>(null);
  const [selectedParameterSuiteId, setSelectedParameterSuiteId] = useState("");
  const [suiteLinkDraftIds, setSuiteLinkDraftIds] = useState<string[]>([]);
  const [executionHookDraft, setExecutionHookDraft] = useState<RunHookSelection[]>([]);
  const [stepOptionDrafts, setStepOptionDrafts] = useState<Record<string, AutomationStepOptions>>({});
  const newStepScopeRef = useRef("");
  const [newStepDraft, setNewStepDraft] = useState<AutomationStepDraft>(() => emptyAutomationStepDraft("web"));
  const [newStepPlacement, setNewStepPlacement] = useState<{ mode: "end" | "before" | "after"; stepId: string }>({ mode: "end", stepId: "" });
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [allowBrowserActions, setAllowBrowserActions] = useState(false);
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [recordingTargetStepId, setRecordingTargetStepId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("success");
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [inspectRecorderSession, setInspectRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [isLaunchingInspectBrowser, setIsLaunchingInspectBrowser] = useState(false);
  const [isClosingInspectBrowser, setIsClosingInspectBrowser] = useState(false);
  const [isRefreshingInspectTabs, setIsRefreshingInspectTabs] = useState(false);
  const [inspectPreviewRevision, setInspectPreviewRevision] = useState(0);
  const inspectSessionRef = useRef<RecorderSessionResponse | null>(null);
  inspectSessionRef.current = inspectRecorderSession;
  const inspectSessionGenerationRef = useRef(0);
  const inspectTabRequestRef = useRef(0);
  const inspectTabActionCountRef = useRef(0);
  const inspectLifecycleBusyRef = useRef(false);
  const [highlightedRepositoryId, setHighlightedRepositoryId] = useState("");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const lastRepositoryRouteRef = useRef<string | null>(null);
  const [selectedScreenName, setSelectedScreenName] = useState("");
  const [screenRenameDraft, setScreenRenameDraft] = useState("");
  const [renamingScreenName, setRenamingScreenName] = useState("");
  const [isRepositoryImportModalOpen, setIsRepositoryImportModalOpen] = useState(false);
  const [repositoryImportPreview, setRepositoryImportPreview] = useState<ObjectRepositoryImportPreview | null>(null);
  const [isParsingRepositoryImport, setIsParsingRepositoryImport] = useState(false);
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
  const inspectAgent = useRepositoryInspectAgent(view === "repository" && Boolean(session) && canInspectRepository, projectId);
  const inspectCapabilities = useQuery({
    queryKey: ["repository-inspection-capabilities", projectId],
    queryFn: ({ signal }) => api.repositoryInspection.capabilities(projectId, { signal }),
    enabled: view === "repository" && Boolean(session && projectId) && canInspectRepository,
    staleTime: 30_000,
    retry: false
  });
  const recommendedInspectMode: InspectSessionMode = inspectAgent.state === "connected" ? "local" : "remote";
  const [inspectSessionMode, setInspectSessionMode] = useState<InspectSessionMode>("remote");
  const [inspectReviewTab, setInspectReviewTab] = useState<RepositoryInspectReviewTab>("candidates");
  const [inspectTabs, setInspectTabs] = useState<RecorderTab[]>([]);
  const [selectedInspectTabId, setSelectedInspectTabId] = useState("");
  const selectedInspectTabIdRef = useRef("");
  selectedInspectTabIdRef.current = selectedInspectTabId;
  const [isInspectingLiveField, setIsInspectingLiveField] = useState(false);
  const [inspectMessage, setInspectMessage] = useState("");
  const closeRepositoryInspector = () => {
    if (inspectLifecycleBusyRef.current) {
      // A browser that finishes starting after dismissal is closed by the
      // generation check in launchInspectBrowser.
      ++inspectSessionGenerationRef.current;
    } else {
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
  const tabRefreshInFlightRef = useRef(false);
  const [repositoryUsageBlock, setRepositoryUsageBlock] = useState<{
    title: string;
    usage: Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>;
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

  const handleRepositoryConfigResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = repositoryConfigDrawerWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const viewportMaxWidth = Math.max(
        REPOSITORY_CONFIG_DRAWER_MIN_WIDTH,
        Math.min(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH, window.innerWidth - 420)
      );
      const nextWidth = Math.min(viewportMaxWidth, clampRepositoryConfigDrawerWidth(startWidth + startX - moveEvent.clientX));
      setRepositoryConfigDrawerWidth(nextWidth);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [repositoryConfigDrawerWidth]);

  const handleRepositoryConfigResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setRepositoryConfigDrawerWidth((current) => clampRepositoryConfigDrawerWidth(current + 24));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setRepositoryConfigDrawerWidth((current) => clampRepositoryConfigDrawerWidth(current - 24));
    } else if (event.key === "Home") {
      event.preventDefault();
      setRepositoryConfigDrawerWidth(REPOSITORY_CONFIG_DRAWER_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setRepositoryConfigDrawerWidth(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH);
    }
  }, []);

  const needsAutomationEditorData = view === "cases" && Boolean(selectedCaseId || isCreateAutomationOpen);
  const needsAutomationRepository = view === "repository" || needsAutomationEditorData || isBatchAgentOpen;
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: ({ signal }) => api.appTypes.list({ project_id: projectId }, { signal }),
    enabled: Boolean(projectId && session)
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-workspace", appTypeId],
    queryFn: ({ signal }) => api.testCases.list({ app_type_id: appTypeId, projection: "summary" }, { signal }),
    enabled: Boolean(appTypeId && session && view === "cases")
  });
  const selectedAutomationCaseDetailQuery = useQuery({
    queryKey: automationCaseDetailQueryKey(projectId, selectedCaseId),
    queryFn: ({ signal }) => api.testCases.get(selectedCaseId, { project_id: projectId }, { signal }),
    enabled: Boolean(projectId && selectedCaseId && session && view === "cases"),
    staleTime: AUTOMATION_CASE_DETAIL_STALE_TIME_MS
  });
  const selectedAutomationCaseDetail = selectedAutomationCaseDetailQuery.data?.id === selectedCaseId
    && selectedAutomationCaseDetailQuery.data.detail_complete !== false
    ? selectedAutomationCaseDetailQuery.data
    : null;
  const isAutomationCaseDetailPending = Boolean(
    selectedCaseId
    && !selectedAutomationCaseDetail
    && (selectedAutomationCaseDetailQuery.isPending || selectedAutomationCaseDetailQuery.isFetching)
  );
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
    queryFn: async ({ signal }) => {
      const queryScope = appTypeId
        ? { app_type_id: appTypeId }
        : { project_id: projectId || undefined };
      const rows: AutomationLearningCacheEntry[] = [];

      for (let offset = 0; ; offset += REPOSITORY_PAGE_SIZE) {
        signal.throwIfAborted();
        const page = await api.testCases.learningCache({
          ...queryScope,
          limit: REPOSITORY_PAGE_SIZE,
          offset
        }, { signal });
        rows.push(...page);

        if (page.length < REPOSITORY_PAGE_SIZE) {
          break;
        }
      }

      return rows;
    },
    enabled: Boolean((projectId || appTypeId) && session && needsAutomationRepository)
  });
  const automatedStepsQuery = useQuery({
    queryKey: ["test-steps", "automation-workspace", selectedCaseId],
    queryFn: ({ signal }) => api.testSteps.list({ test_case_id: selectedCaseId }, { signal }),
    enabled: Boolean(selectedAutomationCaseDetail && session && canViewAutomationCode && view === "cases")
  });
  const executionResultsQuery = useQuery({
    queryKey: ["execution-results", "automation-workspace", "summary", projectId, appTypeId],
    queryFn: ({ signal }) => api.executionResults.list({ project_id: projectId, app_type_id: appTypeId, projection: "summary", limit: 5000 }, { signal }),
    enabled: Boolean(appTypeId && session && view === "cases")
  });
  const selectedCaseHistoryQuery = useQuery({
    queryKey: ["execution-results", "automation-case-history", projectId, selectedCaseId],
    queryFn: ({ signal }) => api.executionResults.list({ project_id: projectId, test_case_id: selectedCaseId, limit: 5000 }, { signal }),
    enabled: Boolean(selectedAutomationCaseDetail && session && view === "cases")
  });
  const suitesQuery = useQuery({
    queryKey: ["test-case-suites", appTypeId],
    queryFn: ({ signal }) => api.testSuites.list({ app_type_id: appTypeId }, { signal }),
    enabled: Boolean(appTypeId && session && needsAutomationEditorData)
  });
  const requirementsQuery = useQuery({ queryKey: ["requirements", "automation-workspace", projectId], queryFn: ({ signal }) => api.requirements.list({ project_id: projectId }, { signal }), enabled: Boolean(projectId && session && needsAutomationEditorData) });
  const modulesQuery = useQuery({ queryKey: ["test-case-modules", "automation-workspace", appTypeId], queryFn: ({ signal }) => api.testCaseModules.list({ app_type_id: appTypeId }, { signal }), enabled: Boolean(appTypeId && session && needsAutomationEditorData) });
  const createSourcesQuery = useQuery({
    queryKey: ["automation-create-sources", projectId, automationCreateManualCaseIds],
    queryFn: ({ signal }) => Promise.all(automationCreateManualCaseIds.map(async (id) => {
      const [testCase, steps] = await Promise.all([
        api.testCases.get(id, { project_id: projectId }, { signal }),
        api.testSteps.list({ test_case_id: id }, { signal })
      ]);
      return { testCase, steps };
    })),
    enabled: Boolean(isCreateAutomationOpen && automationCreateManualCaseIds.length)
  });
  useEffect(() => {
    if (!isCreateAutomationOpen) return;
    const sources = automationCreateManualCaseIds.map((id) => createSourcesQuery.data?.find((source) => source.testCase.id === id));
    if (sources.some((source) => !source)) return;
    const cases = sources.flatMap((source) => source ? [source.testCase] : []);
    const first = cases[0];
    const defaults: AutomationMetadata = {
      ...emptyAutomationMetadata,
      title: first ? `${first.title} · Automation` : "",
      description: first?.description || "",
      priority: String(first?.priority || 3),
      manualCaseIds: automationCreateManualCaseIds,
      requirementIds: [...new Set(cases.flatMap((item) => item.requirement_ids || (item.requirement_id ? [item.requirement_id] : [])))],
      moduleIds: [...new Set(cases.flatMap((item) => item.module_ids || []))],
      suiteIds: [...new Set(cases.flatMap((item) => item.suite_ids || (item.suite_id ? [item.suite_id] : [])))],
      dataSetId: first?.test_data_set_ids?.[0] || ""
    };
    setAutomationCreateMetadata((current) => {
      const next = { ...current };
      (Object.keys(defaults) as Array<keyof AutomationMetadata>).forEach((key) => {
        if (!automationCreateTouchedMetadataRef.current.has(key)) Object.assign(next, { [key]: defaults[key] });
      });
      return next;
    });
  }, [automationCreateManualCaseIds, createSourcesQuery.data, isCreateAutomationOpen]);
  const testDataSetsQuery = useQuery({
    queryKey: ["test-data-sets", "automation-workspace", projectId, appTypeId],
    queryFn: ({ signal }) => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }, { signal }),
    enabled: Boolean(projectId && session && needsAutomationEditorData)
  });
  const testEngineIntegrationsQuery = useQuery({
    queryKey: ["integrations", "testengine", projectId],
    queryFn: ({ signal }) => api.integrations.list({ type: "testengine", is_active: true }, { signal }),
    enabled: Boolean(projectId && session && (needsAutomationEditorData || isInspectOpen))
  });
  const sharedStepGroupsQuery = useQuery({
    queryKey: ["shared-step-groups", "automation-workspace", appTypeId],
    queryFn: ({ signal }) => api.sharedStepGroups.list({ app_type_id: appTypeId }, { signal }),
    enabled: Boolean(appTypeId && session && isSharedGroupLibraryOpen)
  });

  const appTypes = asArray(appTypesQuery.data);
  const testCases = asArray(testCasesQuery.data);
  const testDataSets = asArray<TestDataSet>(testDataSetsQuery.data);
  const automationRequirements = asArray(requirementsQuery.data);
  const automationModules = asArray(modulesQuery.data);
  const selectedExecutionDataSet = testDataSets.find((item) => item.id === selectedExecutionDataSetId) || null;
  const selectedExecutionIterationCount = selectedExecutionDataSet
    ? selectedExecutionDataSet.mode === "key_value" ? 1 : Math.max(1, selectedExecutionDataSet.rows.length)
    : 1;
  const learningCache = asArray(learningCacheQuery.data);
  const atRiskRepositoryEntries = useMemo(() => learningCache.filter((entry) => {
    const stability = Number(entry.metadata?.stability_score ?? entry.confidence ?? 0);
    return !entry.locator?.trim() || stability < 0.72;
  }), [learningCache]);
  const suites = asArray(suitesQuery.data);
  const testEngineIntegration = asArray(testEngineIntegrationsQuery.data).find((integration) =>
    String(integration.config?.project_id || "") === projectId
  ) || asArray(testEngineIntegrationsQuery.data).find((integration) => !String(integration.config?.project_id || "").trim()) || asArray(testEngineIntegrationsQuery.data)[0] || null;
  const mobileRemoteRecorderEnabled = Boolean(
    testEngineIntegration?.config?.mobile_cloud_provider
    && testEngineIntegration.config.mobile_cloud_provider !== "none"
    && testEngineIntegration.config.mobile_remote_url
  );
  const sharedStepGroups = asArray<SharedStepGroup>(sharedStepGroupsQuery.data);
  const automatedCases = useMemo(() => testCases.filter(isAutomatedCase), [testCases]);
  const automationDisplayIdByCaseId = useMemo(
    () => automatedCases.reduce<Record<string, string>>((accumulator, testCase, index) => {
      accumulator[testCase.id] = formatAutomationCaseId(index);
      return accumulator;
    }, {}),
    [automatedCases]
  );
  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const metadataOptions = {
    manualCases: manualCases.map((item) => ({ id: item.id, title: item.title, detail: item.display_id || undefined })),
    requirements: automationRequirements.map((item) => ({ id: item.id, title: item.title, detail: item.display_id || undefined })),
    modules: automationModules.map((item) => ({ id: item.id, title: item.name })),
    suites: suites.map((item) => ({ id: item.id, title: item.name })),
    dataSets: testDataSets.map((item) => ({ id: item.id, title: item.name }))
  };
  const availableManualCases = manualCases;
  const unknownAutomationCases = useMemo(
    () => testCases.filter((testCase) => testCase.automated !== "yes" && testCase.automated !== "no"),
    [testCases]
  );
  const activeAutomatedCase = automatedCases.find((testCase) => testCase.id === selectedAutomatedCaseId) || automatedCases[0] || null;
  const selectedAutomationActionTargetIds = selectedAutomationCaseIds.filter((testCaseId) =>
    automatedCases.some((testCase) => testCase.id === testCaseId)
  );
  const automationActionTargetIds = selectedAutomationActionTargetIds.length
    ? selectedAutomationActionTargetIds
    : activeAutomatedCase ? [activeAutomatedCase.id] : [];
  const selectedCaseSummary = automatedCases.find((testCase) => testCase.id === selectedCaseId) || null;
  const activeCase = selectedAutomationCaseDetail;
  const canRemoveAutomationCase = canUseAutomationBuilder && Boolean(activeCase)
    && (activeCase?.manual_test_case_id || activeCase?.manual_test_case_ids?.length
      ? hasPermission(session, "testcase.delete", projectId)
      : canUpdateAutomationCase && hasPermission(session, "step.manage", projectId));
  const isAutomationCaseDetailReady = Boolean(activeCase);
  const isAutomationCaseWorkspaceOpen = Boolean(selectedCaseId);
  const linkedManualCases = useMemo(() => {
    const linkedIds = activeCase?.manual_test_case_ids?.length
      ? activeCase.manual_test_case_ids
      : activeCase?.manual_test_case_id ? [activeCase.manual_test_case_id] : [];
    return linkedIds.map((id) => manualCases.find((testCase) => testCase.id === id)).filter(Boolean) as TestCase[];
  }, [activeCase?.manual_test_case_id, activeCase?.manual_test_case_ids, manualCases]);
  const linkedManualCase = linkedManualCases[0] || null;
  const activeManualCase = linkedManualCase
    || testCases.find((testCase) => testCase.id === selectedManualCaseId)
    || manualCases[0]
    || null;
  const automatedSteps = canViewAutomationCode ? asArray(automatedStepsQuery.data) : asArray<TestStep>(null);
  const executionResults = asArray(executionResultsQuery.data);
  const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    executionResults.forEach((result) => {
      map[result.test_case_id] = map[result.test_case_id] || [];
      map[result.test_case_id].push(result);
    });

    Object.values(map).forEach((items) => {
      items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });

    return map;
  }, [executionResults]);
  const filteredAutomationCases = useMemo(() => {
    const normalizedSearch = automationCaseSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return automatedCases;
    }

    return automatedCases.filter((testCase) => {
      const history = historyByCaseId[testCase.id] || [];
      const searchContent = [
        testCase.id,
        testCase.display_id,
        automationDisplayIdByCaseId[testCase.id],
        testCase.title,
        testCase.description,
        testCase.status,
        testCase.automation_status,
        `p${testCase.priority || 3}`,
        `${history.length} runs`
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchContent.includes(normalizedSearch);
    });
  }, [automatedCases, automationCaseSearch, automationDisplayIdByCaseId, historyByCaseId]);
  const activeAutomationCaseSearchCount = automationCaseSearch.trim() ? 1 : 0;
  const areAllFilteredAutomationCasesSelected =
    Boolean(filteredAutomationCases.length) && filteredAutomationCases.every((testCase) => selectedAutomationCaseIds.includes(testCase.id));
  const activeCaseHistory = activeCase ? asArray(selectedCaseHistoryQuery.data) : [];
  const activeCaseSuiteIds = useMemo(() => activeCase?.suite_ids || (activeCase?.suite_id ? [activeCase.suite_id] : []), [activeCase]);
  const selectedParameterSuite = suites.find((suite) => suite.id === selectedParameterSuiteId) || null;
  const automationCreateParameters = useMemo(() => buildAutomationCreateParameters({
    dataSet: testDataSets.find((item) => item.id === automationCreateMetadata.dataSetId),
    sources: automationCreateManualCaseIds.flatMap((id) => {
      const source = createSourcesQuery.data?.find((item) => item.testCase.id === id);
      return source ? [source] : [];
    }),
    draftSteps: automationCreateSteps,
    suites,
    suiteIds: automationCreateMetadata.suiteIds
  }), [testDataSets, automationCreateMetadata.dataSetId, automationCreateMetadata.suiteIds, automationCreateManualCaseIds, createSourcesQuery.data, automationCreateSteps, suites]);
  const mergedParameterValues = useMemo(
    () => excludeSensitiveStepParameterValues(combineStepParameterValues(buildDataSetParameterValues(testDataSets.find((item) => item.id === caseDataSetId)), testCaseParameterValues, suiteParameterValues), collectSensitiveDataSetParameterNames(testDataSets.find((item) => item.id === caseDataSetId))),
    [suiteParameterValues, testCaseParameterValues, caseDataSetId, testDataSets]
  );
  const detectedStepParameters = useMemo(
    () => mergeStepParameterDefinitions(collectStepParameters(automatedSteps.map((step) => ({
      id: step.id,
      action: [stepDrafts[step.id]?.name ?? step.action, stepDrafts[step.id]?.objectRef, stepDrafts[step.id]?.value].filter(Boolean).join(" "),
      expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
      automation_code: stepCodeDrafts[step.id] ?? step.automation_code,
      api_request: step.api_request
    }))), buildStepParameterDefinitionsFromValues(mergedParameterValues), buildDataSetParameterDefinitions(testDataSets.find((item) => item.id === caseDataSetId))),
    [automatedSteps, stepCodeDrafts, stepDrafts, mergedParameterValues, testDataSets, caseDataSetId]
  );
  const automationStepGroups = useMemo(() => {
    const groups: { id: string; title: string; subtitle: string; steps: TestStep[]; isStandalone: boolean }[] = [];
    for (const step of [...automatedSteps].sort((left, right) => left.step_order - right.step_order)) {
      const previous = groups[groups.length - 1];
      if (step.group_id && previous?.steps[0]?.group_id === step.group_id && isAutomationPrecondition(previous.steps[0]) === isAutomationPrecondition(step)) previous.steps.push(step);
      else groups.push({ id: `plan-${step.id}`, title: step.group_name || "Step group", subtitle: "", steps: [step], isStandalone: !step.group_id });
    }
    return groups;
  }, [automatedSteps]);
  const newStepPlacementTarget = useMemo(
    () => newStepPlacement.mode !== "end" && newStepPlacement.stepId
      ? automatedSteps.find((step) => step.id === newStepPlacement.stepId) || null
      : null,
    [automatedSteps, newStepPlacement]
  );
  const newStepPlacementLabel = newStepPlacementTarget
    ? `${newStepPlacement.mode === "before" ? "Insert before" : "Add after"} ${newStepPlacementTarget.group_name || newStepPlacementTarget.action || `step ${newStepPlacementTarget.step_order}`}`
    : "";
  const inlineTestDataGroups = useMemo(() => {
    const buildRows = (scope: StepParameterScope, values: Record<string, string>) => {
      const names = new Set<string>(Object.keys(values));
      detectedStepParameters
        .filter((parameter) => parameter.scope === scope)
        .forEach((parameter) => names.add(parameter.name));

      return Array.from(names)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => {
          const parsed = parseStepParameterName(name, scope);
          return {
            name: parsed?.name || name,
            token: parsed?.token || `@${name.replace(/^@/, "")}`,
            value: values[parsed?.name || name] || "",
            locked: scope === "r"
          };
        });
    };

    return [
      { scope: "t" as const, title: "Test case data", rows: buildRows("t", testCaseParameterValues) },
      { scope: "s" as const, title: selectedParameterSuite ? `Suite data · ${selectedParameterSuite.name}` : "Suite-shared data", rows: buildRows("s", suiteParameterValues) },
      { scope: "r" as const, title: "Run data", rows: buildRows("r", {}) }
    ].filter((group) => group.rows.length);
  }, [detectedStepParameters, selectedParameterSuite, suiteParameterValues, testCaseParameterValues]);
  const automationDataTokens = useMemo(() => Array.from(new Set([
    ...inlineTestDataGroups.flatMap((group) => group.rows.map((row) => row.token)),
    ...detectedStepParameters.map((parameter) => parameter.token)
  ])).sort((left, right) => left.localeCompare(right)), [inlineTestDataGroups, detectedStepParameters]);
  const completeAutomationCode = useMemo(() => {
    const parameterLines = Object.entries(mergedParameterValues)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `// ${key.replace(/[\r\n]+/g, " ")} = ${JSON.stringify(value || "<empty>")}`);
    const stepLines = automationStepGroups.flatMap((group) => [
      `// ${group.isStandalone ? "Step" : group.title.replace(/[\r\n]+/g, " ")}`,
      ...group.steps.map((step) => {
        const code = stepCodeDrafts[step.id] ?? step.automation_code ?? "";
        const body = step.step_type === "api" ? step.api_request?.url?.trim() ? resolveStepAutomationCode({ ...step, automation_code: "" }) : "// Automation mapping needed" : code.trim() || "// Automation mapping needed";
        return [`// ${step.step_order}. ${step.step_type || "web"}`, "{", ...body.split("\n").map((line) => `  ${line}`), "}"].join("\n");
      })
    ]);

    return [
      `// Automation case: ${activeCase?.display_id || activeCase?.id || "selected-case"} ${(activeCase?.title || "").replace(/[\r\n]+/g, " ")}`.trim(),
      parameterLines.length ? "// Data references" : "",
      ...parameterLines,
      parameterLines.length ? "" : "",
      "// Source reference. Test Engine executes each section with its runtime, data, hooks and evidence policy.",
      "export async function runAutomation({ page, expect, driver, web, api, mobile, android, ios, params, capture }) {",
      ...stepLines.flatMap((section) => section.split("\n").map((line) => `  ${line}`)),
      "}"
    ].filter((line) => line !== "").join("\n");
  }, [activeCase?.display_id, activeCase?.id, activeCase?.title, automationStepGroups, mergedParameterValues, stepCodeDrafts, stepDrafts]);

  const exportAutomationCasePdf = () => {
    if (!canViewAutomationCode) {
      showError(new Error("Permission required: automation.code.view"), "Unable to export automation code.");
      return;
    }
    if (!isAutomationCaseDetailReady || !activeCase) {
      showError(new Error("Wait for the complete automation case details before exporting."), "Unable to export automation case.");
      return;
    }

    const metadataRows = [
      ["Case", `${activeCase.display_id || activeCase.id} · ${activeCase.title}`],
      ["Status", activeCase.status || "active"],
      ["Priority", `P${activeCase.priority || 3}`],
      ["Automation", activeCase.automation_status || "ready"],
      ["Suites", activeCaseSuiteIds.length ? activeCaseSuiteIds.join(", ") : "None"],
      ["Story", activeCase.requirement_id || "Not linked"]
    ];
    const testDataRows = inlineTestDataGroups.flatMap((group) =>
      group.rows.map((row) => [group.title, row.token, row.locked ? "Supplied at run time" : row.value || "(empty)"])
    );
    const stepSections = automationStepGroups.map((group) => {
      const rows = group.steps.map((step) => {
        const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
        const variables = extractVariables(step);
        return `
          <tr>
            <td>${escapeAutomationPdfHtml(step.step_order)}</td>
            <td>${escapeAutomationPdfHtml(formatAutomationKeywordReadable(draft, variables))}</td>
            <td><code>${escapeAutomationPdfHtml(draft.objectRef || "No locator")}</code></td>
            <td><code>${escapeAutomationPdfHtml(draft.value || "No data reference")}</code></td>
            <td><pre>${escapeAutomationPdfHtml(stepCodeDrafts[step.id] ?? step.automation_code ?? "Automation mapping needed")}</pre></td>
          </tr>
        `;
      }).join("");

      return `
        <section>
          <h2>${escapeAutomationPdfHtml(group.isStandalone ? group.title : `Manual step: ${group.title}`)}</h2>
          <p>${escapeAutomationPdfHtml(group.subtitle)}</p>
          <table>
            <thead><tr><th>Step</th><th>Keyword</th><th>Locator</th><th>Data reference</th><th>Code</th></tr></thead>
            <tbody>${rows || "<tr><td colspan=\"5\">No automation keywords.</td></tr>"}</tbody>
          </table>
        </section>
      `;
    }).join("");
    const printable = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");

    if (!printable) {
      showError(new Error("Allow pop-ups to export the automation case PDF."), "Unable to open PDF export.");
      return;
    }

    printable.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeAutomationPdfHtml(activeCase.title)} automation export</title>
          <style>
            body { color: #111827; font: 13px/1.45 Inter, Arial, sans-serif; margin: 32px; }
            h1 { font-size: 24px; margin: 0 0 6px; }
            h2 { border-bottom: 1px solid #d8dee8; font-size: 17px; margin: 28px 0 8px; padding-bottom: 6px; }
            p { color: #526071; margin: 0 0 14px; }
            table { border-collapse: collapse; margin: 10px 0 18px; width: 100%; }
            th, td { border: 1px solid #d8dee8; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #f3f6fb; font-size: 11px; text-transform: uppercase; }
            code, pre { background: #f8fafc; border-radius: 6px; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
            code { padding: 2px 4px; }
            pre { margin: 0; max-width: 100%; overflow-wrap: anywhere; padding: 8px; white-space: pre-wrap; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }
            .meta div { border: 1px solid #d8dee8; border-radius: 8px; padding: 9px; }
            .meta span { color: #64748b; display: block; font-size: 11px; text-transform: uppercase; }
            .meta strong { display: block; margin-top: 3px; }
            @media print { body { margin: 18mm; } button { display: none; } }
          </style>
        </head>
        <body>
          <h1>${escapeAutomationPdfHtml(activeCase.title)}</h1>
          <p>${escapeAutomationPdfHtml(richTextToPlainText(activeCase.description) || "No description recorded.")}</p>
          <section class="meta">
            ${metadataRows.map(([label, value]) => `<div><span>${escapeAutomationPdfHtml(label)}</span><strong>${escapeAutomationPdfHtml(value)}</strong></div>`).join("")}
          </section>
          <section>
            <h2>Test data</h2>
            <table>
              <thead><tr><th>Scope</th><th>Token</th><th>Value</th></tr></thead>
              <tbody>
                ${testDataRows.length ? testDataRows.map(([scope, token, value]) => `<tr><td>${escapeAutomationPdfHtml(scope)}</td><td><code>${escapeAutomationPdfHtml(token)}</code></td><td>${escapeAutomationPdfHtml(value)}</td></tr>`).join("") : "<tr><td colspan=\"3\">No test data references detected.</td></tr>"}
              </tbody>
            </table>
          </section>
          ${stepSections}
          <section>
            <h2>Complete automation code</h2>
            <pre>${escapeAutomationPdfHtml(completeAutomationCode)}</pre>
          </section>
          <script>window.addEventListener("load", () => { window.focus(); window.print(); });</script>
        </body>
      </html>
    `);
    printable.document.close();
    showSuccess("Automation case PDF export opened.");
  };
  const groupedRepository = useMemo(() => {
    const grouped = new Map<string, AutomationLearningCacheEntry[]>();

    learningCache.forEach((entry) => {
      const screenKey = getRepositoryScreenKey(entry);
      grouped.set(screenKey, [...(grouped.get(screenKey) || []), entry]);
    });

    return Array.from(grouped.entries()).sort(([, leftEntries], [, rightEntries]) =>
      getScreenName(leftEntries[0]).localeCompare(getScreenName(rightEntries[0]))
    );
  }, [learningCache]);
  const activeScreenEntries = useMemo(() => {
    const selected = groupedRepository.find(([screenKey]) => screenKey === selectedScreenName);
    return selected?.[1] || groupedRepository[0]?.[1] || [];
  }, [groupedRepository, selectedScreenName]);
  const activeScreenKey = groupedRepository.find(([screenKey]) => screenKey === selectedScreenName)?.[0] || groupedRepository[0]?.[0] || "";
  const activeScreenName = activeScreenEntries.length ? getScreenName(activeScreenEntries[0]) : "";
  const activeScreenRecord = activeScreenEntries.find(isScreenRepositoryRecord) || activeScreenEntries[0] || null;
  const selectedRepositoryEntry = activeScreenEntries.find((entry) => entry.id === selectedRepositoryId && !isNonElementRepositoryEntry(entry))
    || activeScreenEntries.find((entry) => !isNonElementRepositoryEntry(entry))
    || null;
  const activeRepositoryAppTypeId = activeScreenRecord?.app_type_id
    || selectedRepositoryEntry?.app_type_id
    || activeScreenEntries.find((entry) => entry.app_type_id)?.app_type_id
    || appTypeId
    || "";
  const activeRepositoryProjectId = activeScreenRecord?.project_id
    || selectedRepositoryEntry?.project_id
    || activeScreenEntries.find((entry) => entry.project_id)?.project_id
    || projectId
    || "";
  const pageObjectModels = useMemo(() => {
    return groupedRepository.map(([screenKey, entries]) => {
      const screenName = getScreenName(entries[0]);
      const screenAppTypeId = entries.find((entry) => entry.app_type_id)?.app_type_id || "";
      const members = entries.filter((entry) => !isNonElementRepositoryEntry(entry)).map((entry) => ({
        entry,
        pageName: screenName,
        memberName: entry.id === selectedRepositoryId && repositoryDraft.object_name.trim() ? repositoryDraft.object_name.trim() : getRepositoryMemberName(entry),
        htmlTag: entry.id === selectedRepositoryId && repositoryDraft.object_role.trim() ? splitRepositoryRole(repositoryDraft.object_role, getRepositoryHtmlTag(entry), getObjectRole(entry)).tag : getRepositoryHtmlTag(entry),
        role: entry.id === selectedRepositoryId && repositoryDraft.object_role.trim() ? splitRepositoryRole(repositoryDraft.object_role, getRepositoryHtmlTag(entry), getObjectRole(entry)).role : getObjectRole(entry),
        ref: `${screenName}.${entry.id === selectedRepositoryId && repositoryDraft.object_name.trim() ? repositoryDraft.object_name.trim() : getRepositoryMemberName(entry)}`
      }));

      return {
        screenName: screenKey,
        pageName: screenName,
        appTypeId: screenAppTypeId,
        url: getRepositoryScreenUrl(entries),
        members
      };
    });
  }, [groupedRepository, repositoryDraft.object_name, repositoryDraft.object_role, selectedRepositoryId]);
  const activePageObject = pageObjectModels.find((page) => page.screenName === selectedScreenName) || pageObjectModels[0] || null;
  const allObjectMembers = useMemo(() => pageObjectModels.flatMap((page) => page.members), [pageObjectModels]);
  const caseRepositorySteps = useMemo(() => automatedSteps.map((step) => {
    const draft = stepDrafts[step.id];
    const spec = draft ? getAutomationKeywordInputSpec(draft.keyword, draft.step_type) : null;
    return {
      automation_code: stepCodeDrafts[step.id] ?? step.automation_code,
      objectRefs: [spec?.target === "repository" ? draft?.objectRef || "" : "", spec?.valueTarget === "repository" ? draft?.value || "" : ""]
    };
  }), [automatedSteps, stepCodeDrafts, stepDrafts]);
  const caseObjectMembers = useMemo(() => allObjectMembers.filter((member) => isRepositoryMemberUsed(member, activeCase?.id, caseRepositorySteps)), [allObjectMembers, activeCase?.id, caseRepositorySteps]);
  const selectedRuntimeType = appTypes.find((item) => item.id === appTypeId)?.type || "web";
  const automationRuntimeTypes = getAutomationRuntimeTypes(automatedSteps, selectedRuntimeType);
  const automationCreateRuntimeTypes = getAutomationRuntimeTypes([
    ...automationCreateManualCaseIds.flatMap((id) => createSourcesQuery.data?.find((source) => source.testCase.id === id)?.steps || []),
    ...automationCreateSteps.filter((step) => step.action.trim() || step.expected_result.trim())
  ], selectedRuntimeType);
  const canRecordCreation = canUseRecorder && automationCreateRuntimeTypes.some((type) => type === "web" || type !== "api" && canUseMobileAppium);
  useEffect(() => {
    if (isCreateAutomationOpen && requestedCreationMode === "record" && !canRecordCreation) setAutomationCreationMode("blank");
  }, [isCreateAutomationOpen, requestedCreationMode, canRecordCreation]);
  const recorderPlatform = getRecorderPlatform(automatedSteps, recordingTargetStepId, selectedRuntimeType);
  const canRecordCurrentPlan = canUseRecorder && recorderPlatform !== "api" && (!["android", "ios"].includes(recorderPlatform) || canUseMobileAppium);
  const allowedStepTypes = canUseMobileAppium ? ["web", "api", "android", "ios"] as TestStepType[] : ["web", "api"] as TestStepType[];
  useEffect(() => {
    if (!activeCase || automatedStepsQuery.isPending || appTypesQuery.isPending) return;
    const scope = `${projectId}:${activeCase.id}`;
    if (newStepScopeRef.current === scope) return;
    newStepScopeRef.current = scope;
    setNewStepDraft(emptyAutomationStepDraft(getDefaultAutomationStepType(automatedSteps, selectedRuntimeType)));
    setNewStepPlacement({ mode: "end", stepId: "" });
    setNewStepIsPrecondition(false);
    setExecutionHookDraft([]);
  }, [activeCase?.id, projectId, appTypesQuery.isPending, automatedStepsQuery.isPending, automatedSteps, selectedRuntimeType]);
  const canViewObjectRepository = hasPermission(session, "automation.repository.view", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.object_repository"]);
  useEffect(() => {
    if (activeAutomationWorkspaceTab === "build" && !canUseAutomationAi && !canRecordCurrentPlan
      || activeAutomationWorkspaceTab === "repository" && !canViewObjectRepository) setActiveAutomationWorkspaceTab("steps");
    if (buildMethod === "record" && !canRecordCurrentPlan && canUseAutomationAi) setBuildMethod("agent");
  }, [activeAutomationWorkspaceTab, canUseAutomationAi, canRecordCurrentPlan, canViewObjectRepository, buildMethod]);

  const deferredScreenDomDraft = useDeferredValue(screenDomDraft);
  const inspectedFields = useMemo(() => extractRepositoryFieldsFromDom(deferredScreenDomDraft), [deferredScreenDomDraft]);
  const suggestedInspectFields = useMemo(() => {
    const byLocator = new Map<string, RepositoryExtractedField>();
    inspectedFields.forEach((field) => byLocator.set(field.locator, { ...field, source: "dom_candidate" }));
    aiSuggestedInspectFields.forEach((field) => byLocator.set(field.locator, { ...field, source: "ai_extract" }));
    return Array.from(byLocator.values()).filter((field) => !dismissedInspectLocators.includes(field.locator));
  }, [aiSuggestedInspectFields, dismissedInspectLocators, inspectedFields]);
  const selectedInspectLocatorSet = useMemo(
    () => new Set(stagedInspectFields.flatMap((field) => [field.locator, field.sourceLocator || field.locator])),
    [stagedInspectFields]
  );
  const inspectFieldInventory = useMemo(() => {
    const byLocator = new Map<string, RepositoryExtractedField>();
    suggestedInspectFields.forEach((field) => byLocator.set(field.locator, field));
    browserInspectFields
      .filter((field) => !dismissedInspectLocators.includes(field.locator))
      .forEach((field) => byLocator.set(field.locator, { ...byLocator.get(field.locator), ...field }));
    stagedInspectFields.forEach((field) => byLocator.set(field.sourceLocator || field.locator, { ...byLocator.get(field.sourceLocator || field.locator), ...field }));
    return Array.from(byLocator.values()).sort((left, right) =>
      Number(right.source === "live_inspect") - Number(left.source === "live_inspect")
      || left.name.localeCompare(right.name)
    );
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
  const recorderLiveUrl = recorderSession?.live_view_url || "";
  const inspectRecorderLiveUrl = buildInspectLiveUrl(inspectRecorderSession, selectedInspectTabId, inspectPreviewRevision);
  const selectedLocators = selectedRepositoryEntry ? getRepositoryLocators(selectedRepositoryEntry) : [];
  const selectedLocatorReviewReadiness = useMemo(() => assessLocatorReviewReadiness({
    stabilityScore: Number.isFinite(Number(repositoryDraft.stability_score))
      ? Number(repositoryDraft.stability_score)
      : Math.round((selectedRepositoryEntry?.confidence || 0) * 100),
    locatorCount: selectedLocators.length,
    hasDomEvidence: Boolean(screenDomDraft.trim() || normalizeMetadataValue(selectedRepositoryEntry?.metadata?.ancestor_dom)),
    hasVisualEvidence: Boolean(screenScreenshotDraft.trim() || repositoryDraft.element_screenshot_url.trim()),
    hasValidationHistory: !["not_validated", "unverified", "pending"].includes(normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_status)) && Boolean(
      normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_at)
      || ["unique", "ambiguous", "missing", "invalid"].includes(normalizeMetadataValue(selectedRepositoryEntry?.metadata?.last_validated_status))
      || (Array.isArray(selectedRepositoryEntry?.metadata?.validation_history) && selectedRepositoryEntry.metadata.validation_history.length)
    )
  }), [repositoryDraft.element_screenshot_url, repositoryDraft.stability_score, screenDomDraft, screenScreenshotDraft, selectedLocators.length, selectedRepositoryEntry]);

  const syncRepositorySearchParams = useCallback((repositoryId?: string | null) => {
    const targetRepositoryId = repositoryId || "";

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetRepositoryId) {
        next.delete("case");
        next.set("repository", targetRepositoryId);
      } else {
        next.delete("repository");
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const selectRepositoryScreen = (screenName: string) => {
    setSelectedScreenName(screenName);
    setSelectedRepositoryId("");
    setIsRepositoryConfigOpen(false);
    setLocatorImprovementPreview(null);
    syncRepositorySearchParams(null);
  };

  const selectRepositoryEntry = useCallback((repositoryId: string, screenName?: string) => {
    if (screenName && screenName !== selectedScreenName) {
      setSelectedScreenName(screenName);
    }

    setSelectedRepositoryId(repositoryId);
    setFieldDetailTab("locators");
    setIsRepositoryConfigOpen(true);
    syncRepositorySearchParams(repositoryId);
  }, [selectedScreenName, syncRepositorySearchParams]);

  const openRepositoryInspect = (page: typeof activePageObject = activePageObject) => {
    if (inspectCapabilities.isError) void inspectCapabilities.refetch();
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
    } else if (targetPage) {
      setScreenUrlDraft("");
    }
    setIsInspectOpen(true);
    setInspectReviewTab("candidates");
    reinspectFieldLocatorRef.current = "";
    setReinspectFieldLocator("");
    setInspectMessage("");
  };

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    setSelectedAutomationCaseIds((current) =>
      current.filter((testCaseId) => automatedCases.some((testCase) => testCase.id === testCaseId))
    );
  }, [automatedCases]);

  useEffect(() => {
    stagedInspectFieldsRef.current = stagedInspectFields;
  }, [stagedInspectFields]);

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId ? appTypes.filter((appType) => String(appType.project_id) === String(projectId)) : appTypes;

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
      setSelectedAutomatedCaseId("");
      setSelectedCaseId("");
      setSelectedManualCaseId("");
      setIsParameterDialogOpen(false);
      setRecorderSession(null);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    const requestedCaseId = searchParams.get("case") || "";
    const requestedCase = findByRoutableId(automatedCases, requestedCaseId);

    if (
      initialView !== "cases"
      || !requestedCaseId
      || selectedCaseId === requestedCase?.id
      || testCasesQuery.isLoading
      || testCasesQuery.isFetching
    ) {
      return;
    }

    if (requestedCase) {
      setView("cases");
      setSelectedCaseId(requestedCase.id);
      setSelectedAutomatedCaseId(requestedCase.id);
      setExpandedCaseSections((current) => ({ ...current, case: true, steps: true }));
    }
  }, [automatedCases, initialView, searchParams, selectedCaseId, testCasesQuery.isFetching, testCasesQuery.isLoading]);

  useEffect(() => {
    const requestedManualId = searchParams.get("manual") || "";
    if (isCreateAutomationOpen || initialView !== "cases" || searchParams.get("create") !== "1" || testCasesQuery.isLoading) {
      return;
    }
    const manualCase = findByRoutableId(availableManualCases, requestedManualId);
    automationCreateTouchedMetadataRef.current.clear();
    setView("cases");
    setAutomationCreateManualCaseIds(manualCase ? [manualCase.id] : []);
    setAutomationCreateMetadata({ ...emptyAutomationMetadata, title: manualCase ? `${manualCase.title} · Automation` : "", manualCaseIds: manualCase ? [manualCase.id] : [] });
    setIsCreateAutomationOpen(true);
  }, [availableManualCases, initialView, searchParams, testCasesQuery.isLoading, isCreateAutomationOpen]);

  useEffect(() => {
    if (activeAutomatedCase && selectedAutomatedCaseId !== activeAutomatedCase.id) {
      setSelectedAutomatedCaseId(activeAutomatedCase.id);
    }
  }, [activeAutomatedCase, selectedAutomatedCaseId]);

  useEffect(() => {
    if (activeManualCase && selectedManualCaseId !== activeManualCase.id) {
      setSelectedManualCaseId(activeManualCase.id);
    }
  }, [activeManualCase, selectedManualCaseId]);

  useEffect(() => {
    const requestedRepositoryId = searchParams.get("repository") || "";

    if (
      initialView !== "repository"
      || learningCacheQuery.isLoading
      || learningCacheQuery.isFetching
    ) {
      return;
    }

    // Consume a URL selection once. Local selection can render before the
    // router commits its new URL; replaying the old URL would undo that click.
    const routeKey = `${projectId}:${appTypeId}:${requestedRepositoryId}`;
    if (lastRepositoryRouteRef.current === routeKey) return;
    lastRepositoryRouteRef.current = routeKey;
    if (!requestedRepositoryId) return;

    const requestedEntry = groupedRepository
      .flatMap(([screenName, entries]) => entries.map((entry) => ({ screenName, entry })))
      .find(({ entry }) => entry.id === requestedRepositoryId && !isNonElementRepositoryEntry(entry));

    if (requestedEntry) {
      if (selectedRepositoryId === requestedEntry.entry.id && selectedScreenName === requestedEntry.screenName) return;
      setView("repository");
      selectRepositoryEntry(requestedEntry.entry.id, requestedEntry.screenName);
      return;
    }

    if (selectedRepositoryId === requestedRepositoryId) {
      return;
    }

    syncRepositorySearchParams(null);
  }, [
    groupedRepository,
    initialView,
    projectId,
    appTypeId,
    learningCacheQuery.isFetching,
    learningCacheQuery.isLoading,
    searchParams,
    selectRepositoryEntry,
    selectedRepositoryId,
    selectedScreenName,
    syncRepositorySearchParams
  ]);

  useEffect(() => {
    if (searchParams.get("repository")) {
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
    if (inspectionScreenKeyRef.current === activeScreenKey) return;
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
    if (isInspectOpen && stagedInspectFieldsRef.current.length) return;

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
    if (!selectedCaseId) {
      if (lastAutomationCaseDraftSeedRef.current) {
        setTestCaseParameterValues({});
        setSuiteLinkDraftIds([]);
        setCaseRequirementIds([]);
        setCaseModuleIds([]);
        setCaseDataSetId("");
        setAutomationManualLinkDraftIds([]);
        setSelectedExecutionDataSetId("");
        lastAutomationCaseDraftSeedRef.current = null;
      }
      return;
    }
    if (!activeCase || activeCase.id !== selectedCaseId) return;

    const caseKey = `case:${projectId}:${activeCase.id}`;
    const previous = lastAutomationCaseDraftSeedRef.current?.caseKey === caseKey
      ? lastAutomationCaseDraftSeedRef.current.detail
      : null;
    const draftFromCase = (testCase: TestCase): AutomationCaseDraft => ({
      title: testCase.title || "",
      description: testCase.description || "",
      status: testCase.status || "active",
      priority: String(testCase.priority || 3),
      parameterText: formatParameterText(testCase.parameter_values)
    });
    const suitesFromCase = (testCase: TestCase) => testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []);
    const requirementsFromCase = (testCase: TestCase) => testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []);
    const manualCasesFromCase = (testCase: TestCase) => testCase.manual_test_case_ids?.length
      ? testCase.manual_test_case_ids
      : testCase.manual_test_case_id ? [testCase.manual_test_case_id] : [];
    const nextDraft = draftFromCase(activeCase);
    const nextParameters = normalizeAutomationParameterValues(activeCase.parameter_values, "t");
    const nextDataSetId = activeCase.test_data_set_ids?.[0] || "";
    setCaseDraft((current) => previous ? mergeAutomationMetadataFields(current, draftFromCase(previous), nextDraft) : nextDraft);
    setTestCaseParameterValues((current) => previous ? mergeAutomationMetadataFields(current, normalizeAutomationParameterValues(previous.parameter_values, "t"), nextParameters) : nextParameters);
    setSuiteLinkDraftIds((current) => previous ? mergeAutomationMetadataValue(current, suitesFromCase(previous), suitesFromCase(activeCase)) : suitesFromCase(activeCase));
    setCaseRequirementIds((current) => previous ? mergeAutomationMetadataValue(current, requirementsFromCase(previous), requirementsFromCase(activeCase)) : requirementsFromCase(activeCase));
    setCaseModuleIds((current) => previous ? mergeAutomationMetadataValue(current, previous.module_ids || [], activeCase.module_ids || []) : activeCase.module_ids || []);
    setCaseDataSetId((current) => previous ? mergeAutomationMetadataValue(current, previous.test_data_set_ids?.[0] || "", nextDataSetId) : nextDataSetId);
    setAutomationManualLinkDraftIds((current) => previous ? mergeAutomationMetadataValue(current, manualCasesFromCase(previous), manualCasesFromCase(activeCase)) : manualCasesFromCase(activeCase));
    setSelectedExecutionDataSetId((current) => previous ? mergeAutomationMetadataValue(current, previous.test_data_set_ids?.[0] || "", nextDataSetId) : nextDataSetId);
    lastAutomationCaseDraftSeedRef.current = { caseKey, detail: activeCase };
  }, [activeCase, projectId, selectedCaseId]);

  useEffect(() => {
    if (!activeCaseSuiteIds.length) {
      setSelectedParameterSuiteId("");
      setSuiteParameterValues({});
      return;
    }

    if (!activeCaseSuiteIds.includes(selectedParameterSuiteId)) {
      setSelectedParameterSuiteId(activeCaseSuiteIds[0] || "");
    }
  }, [activeCaseSuiteIds, selectedParameterSuiteId]);

  useEffect(() => {
    if (!selectedParameterSuite) {
      setSuiteParameterValues({});
      lastAutomationSuiteParameterSeedRef.current = null;
      return;
    }
    const next = normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s");
    const previous = lastAutomationSuiteParameterSeedRef.current?.suiteId === selectedParameterSuite.id
      ? lastAutomationSuiteParameterSeedRef.current.values : null;
    setSuiteParameterValues((current) => previous ? mergeAutomationMetadataFields(current, previous, next) : next);
    lastAutomationSuiteParameterSeedRef.current = { suiteId: selectedParameterSuite.id, values: next };
  }, [selectedParameterSuite?.id, selectedParameterSuite?.parameter_values]);

  useEffect(() => {
    setStepDrafts((current) => {
      const next = { ...current };
      automatedSteps.forEach((step) => {
        if (!next[step.id]) {
          next[step.id] = parseAutomationStepDraft(step);
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!automatedSteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [automatedSteps]);

  useEffect(() => {
    setStepOptionDrafts((current) => {
      const next = { ...current };
      automatedSteps.forEach((step) => {
        if (!next[step.id]) {
          next[step.id] = parseAutomationStepOptions(step);
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!automatedSteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [automatedSteps]);

  useEffect(() => {
    setStepCodeDrafts((current) => {
      const next = { ...current };
      automatedSteps.forEach((step) => {
        if (!Object.prototype.hasOwnProperty.call(next, step.id)) {
          next[step.id] = step.automation_code || "";
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!automatedSteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [automatedSteps]);

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const refreshRecorderSession = async () => {
      try {
        if (document.hidden) return;
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store", signal: controller.signal });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Recorder counters are non-critical; the backend finish call is authoritative.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void refreshRecorderSession(), 1000);
      }
    };

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
	  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  useEffect(() => {
    if (!canViewAutomationCode && automationStepView === "code") {
      setAutomationStepView("keyword");
    }
    if (!canViewAutomationCode) setStepCodeDrafts({});
  }, [automationStepView, canViewAutomationCode]);

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
        if (inspectLifecycleBusyRef.current || document.hidden || !navigator.onLine) return;
        const next = await readInspectSessionJson<Partial<RecorderSessionResponse>>(inspectRecorderSession, "", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
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
      } catch (error) {
        consecutiveFailures += 1;
        const unavailable = [401, 403, 404, 410].includes(Number((error as { status?: number })?.status));
        if (!cancelled && generation === inspectSessionGenerationRef.current && (unavailable || consecutiveFailures >= 2)) {
          ++inspectTabRequestRef.current;
          setInspectRecorderSession((current) => current?.id === inspectRecorderSession.id ? { ...current, status: "stopped" } : current);
          setIsInspectingLiveField(false);
          setInspectTabs([]);
          selectedInspectTabIdRef.current = "";
          setSelectedInspectTabId("");
          setInspectMessage(unavailable ? "This browser session expired or is no longer available. Your selected fields are retained. Open a new session to continue." : "The browser connection was lost. Your selected fields are retained. Reconnect your local agent or open a remote browser session.");
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void refreshInspectSession(), 3000);
      }
    };

    void refreshInspectSession();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [inspectRecorderSession?.id, inspectRecorderSession?.status, inspectRecorderSession?.status_url]);

  const invalidateAutomationData = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
  };

  const selectAutomationCase = useCallback((testCaseId: string) => {
    const targetCase = automatedCases.find((testCase) => testCase.id === testCaseId) || null;

    setIsParameterDialogOpen(false);
    setActiveAutomationWorkspaceTab("details");
    setSelectedCaseId(testCaseId);
    setSelectedAutomatedCaseId(testCaseId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("repository");
      next.set("case", getRoutableId(targetCase) || testCaseId);
      return next;
    }, { replace: true });
  }, [automatedCases, setSearchParams]);

  const rememberAutomationBuildDrafts = () => {
    automationBuildDraftBaselineRef.current = { steps: stepDrafts, options: stepOptionDrafts, code: stepCodeDrafts };
  };
  const openGeneratedAutomationPlan = async (outputCaseId: string, outputProjectId = projectId, sourceCaseIds = [selectedCaseId]) => {
    const [detail, freshSteps] = await Promise.all([
      api.testCases.get(outputCaseId, { project_id: outputProjectId }),
      api.testSteps.list({ test_case_id: outputCaseId })
    ]);
    queryClient.setQueryData(automationCaseDetailQueryKey(outputProjectId, outputCaseId), detail);
    queryClient.setQueryData(["test-steps", "automation-workspace", outputCaseId], freshSteps);
    if (currentAutomationSelectionRef.current.projectId !== outputProjectId
      || ![outputCaseId, ...sourceCaseIds].includes(currentAutomationSelectionRef.current.selectedCaseId)) return;
    const outputChanged = currentAutomationSelectionRef.current.selectedCaseId !== outputCaseId;
    const baseline = automationBuildDraftBaselineRef.current;
    const refreshedSteps = Object.fromEntries(freshSteps.map((step) => [step.id, parseAutomationStepDraft(step)]));
    const refreshedOptions = Object.fromEntries(freshSteps.map((step) => [step.id, parseAutomationStepOptions(step)]));
    const refreshedCode = Object.fromEntries(freshSteps.map((step) => [step.id, step.automation_code || ""]));
    setStepDrafts((current) => outputChanged ? refreshedSteps : mergeRefreshedAutomationDrafts(current, baseline.steps, refreshedSteps));
    setStepOptionDrafts((current) => outputChanged ? refreshedOptions : mergeRefreshedAutomationDrafts(current, baseline.options, refreshedOptions));
    setStepCodeDrafts((current) => outputChanged ? refreshedCode : mergeRefreshedAutomationDrafts(current, baseline.code, refreshedCode));
    if (!outputChanged && !["build", "steps"].includes(currentAutomationSelectionRef.current.workspaceTab)) return;
    selectAutomationCase(outputCaseId);
    setActiveAutomationWorkspaceTab("steps");
  };

  useEffect(() => {
    if (!agentBuildTracking) return;
    let cancelled = false;
    let timer: number | undefined;
    let failureCount = 0;
    const poll = async () => {
      try {
        const transaction = await api.testCases.automationBuildStatus(agentBuildTracking.transactionId);
        if (cancelled) return;
        failureCount = 0;
        const progress = Math.min(100, Math.max(0, Number(transaction.metadata.progress_percent) || 0));
        const completed = transaction.status === "completed";
        const failed = ["failed", "cancelled", "canceled"].includes(transaction.status);
        const failedCaseCount = Number(transaction.metadata.failed) || 0;
        setAgentBuildStatus(completed ? "completed" : failed ? "failed" : transaction.status === "running" ? "running" : "queued");
        setAgentBuildReceipt(`${completed ? `Build completed${failedCaseCount ? ` · ${failedCaseCount} cases need a retry` : ""}` : failed ? "Build failed" : transaction.status === "running" ? (typeof transaction.metadata.phase_message === "string" ? transaction.metadata.phase_message : `Building · ${progress}%`) : agentBuildTracking.scheduledAt ? `Scheduled for ${new Date(agentBuildTracking.scheduledAt).toLocaleString()}` : "Waiting for the automation agent"} · ${transaction.id.slice(0, 8)}${failed && transaction.description ? ` · ${transaction.description}` : ""}`);
        if (completed || failed) {
          invalidateAutomationData();
          const outputIds = Array.isArray(transaction.metadata.output_test_case_ids)
            ? transaction.metadata.output_test_case_ids.filter((id): id is string => typeof id === "string")
            : [];
          const outputId = outputIds.includes(currentAutomationSelectionRef.current.selectedCaseId)
            ? currentAutomationSelectionRef.current.selectedCaseId
            : outputIds[0] || (typeof transaction.metadata.test_case_id === "string" ? transaction.metadata.test_case_id : transaction.related_kind === "test_case" ? transaction.related_id : null);
          if (completed && outputId) {
            try { await openGeneratedAutomationPlan(outputId, agentBuildTracking.projectId, agentBuildTracking.caseIds); }
            catch { if (!cancelled) setAgentBuildReceipt(`Build completed · ${transaction.id.slice(0, 8)}. Reopen the case to load its updated plan.`); }
          }
          if (!cancelled) setAgentBuildTracking(null);
          return;
        }
        const untilScheduled = agentBuildTracking.scheduledAt ? Date.parse(agentBuildTracking.scheduledAt) - Date.now() : 0;
        if (untilScheduled > 15 * 60_000 || Date.now() - agentBuildTracking.startedAt > 15 * 60_000) {
          setAgentBuildStatus("paused");
          setAgentBuildReceipt((current) => `${current}. Automatic progress checks paused; follow this build in TestOps.`);
          setAgentBuildTracking(null);
          return;
        }
        timer = window.setTimeout(() => void poll(), untilScheduled > 0 ? Math.min(60_000, Math.max(3000, untilScheduled)) : 3000);
      } catch (error) {
        if (cancelled) return;
        failureCount += 1;
        if (failureCount >= 3) {
          setAgentBuildStatus("paused");
          setAgentBuildReceipt(`Progress checks paused · ${agentBuildTracking.transactionId.slice(0, 8)}. ${error instanceof Error ? error.message : "Open TestOps to check the build."}`);
          setAgentBuildTracking(null);
        } else timer = window.setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [agentBuildTracking]);

  const automationCaseListColumns = useMemo<Array<DataTableColumn<TestCase>>>(() => [
    {
      key: "select",
      label: "",
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 56,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Select all filtered automation cases"
            checked={areAllFilteredAutomationCasesSelected}
            onChange={(event) =>
              setSelectedAutomationCaseIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...filteredAutomationCases.map((testCase) => testCase.id)])]
                  : current.filter((testCaseId) => !filteredAutomationCases.some((testCase) => testCase.id === testCaseId))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (testCase) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select ${testCase.title}`}
            checked={selectedAutomationCaseIds.includes(testCase.id)}
            onChange={(event) =>
              setSelectedAutomationCaseIds((current) =>
                event.target.checked
                  ? [...new Set([...current, testCase.id])]
                  : current.filter((testCaseId) => testCaseId !== testCase.id)
              )
            }
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "id",
      label: "ID",
      width: 120,
      minWidth: 96,
      sortValue: (testCase) => automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id,
      render: (testCase) => <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id} />
    },
    {
      key: "title",
      label: "Automation case",
      canToggle: false,
      width: 300,
      minWidth: 180,
      sortValue: (testCase) => testCase.title,
      render: (testCase) => (
        <div className="automation-list-primary-cell">
          <strong>{testCase.title}</strong>
          <span>{richTextToPlainText(testCase.description) || "Automation is mapped to the original manual case definition."}</span>
        </div>
      )
    },
    {
      key: "state",
      label: "State",
      width: 160,
      minWidth: 128,
      sortValue: (testCase) => testCase.automation_status || "ready",
      render: (testCase) => (
        <div className="automation-list-status-cell">
          <StatusBadge value="automated" />
          <StatusBadge value={testCase.automation_status || "ready"} />
        </div>
      )
    },
    {
      key: "runs",
      label: "Runs",
      width: 92,
      minWidth: 78,
      sortValue: (testCase) => (historyByCaseId[testCase.id] || []).length,
      render: (testCase) => (historyByCaseId[testCase.id] || []).length
    },
    {
      key: "passRate",
      label: "Pass rate",
      width: 124,
      minWidth: 100,
      sortValue: (testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const passedRuns = history.filter((result) => result.status === "passed").length;
        return history.length ? Math.round((passedRuns / history.length) * 100) : 0;
      },
      render: (testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const passedRuns = history.filter((result) => result.status === "passed").length;
        return history.length ? `${Math.round((passedRuns / history.length) * 100)}%` : "No runs";
      }
    },
    {
      key: "priority",
      label: "Priority",
      width: 104,
      minWidth: 88,
      sortValue: (testCase) => testCase.priority || 3,
      render: (testCase) => `P${testCase.priority || 3}`
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 320,
      minWidth: 180,
      render: (testCase) => richTextToPlainText(testCase.description) || "No automation description yet."
    }
  ], [
    areAllFilteredAutomationCasesSelected,
    automationDisplayIdByCaseId,
    filteredAutomationCases,
    historyByCaseId,
    selectedAutomationCaseIds
  ]);

  const openLinkedManualCase = (automationCase: TestCase, manualCaseIdOverride?: string) => {
    const manualCaseId = manualCaseIdOverride || automationCase.manual_test_case_ids?.[0] || automationCase.manual_test_case_id || automationCase.id;
    navigate(`/test-cases?case=${encodeURIComponent(manualCaseId)}`);
  };

  const closeCreateAutomation = () => {
    if (createAutomationCase.isPending) return;
    setIsCreateAutomationOpen(false);
    setAutomationCreateMetadata(emptyAutomationMetadata);
    setAutomationCreateSteps([]);
    automationCreateTouchedMetadataRef.current.clear();
    setAutomationCreateManualCaseIds([]);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("create");
      next.delete("manual");
      return next;
    }, { replace: true });
  };

  const updateAutomationCreateMetadata = (change: Partial<AutomationMetadata>) => {
    (Object.keys(change) as Array<keyof AutomationMetadata>).forEach((key) => {
      if (key !== "manualCaseIds") automationCreateTouchedMetadataRef.current.add(key);
    });
    setAutomationCreateMetadata((current) => ({ ...current, ...change }));
    if (change.manualCaseIds !== undefined) setAutomationCreateManualCaseIds(change.manualCaseIds);
  };

  const resolveParameterInputState = (scope: StepParameterScope) => {
    if (scope === "s" && !selectedParameterSuite) {
      return {
        disabled: true,
        hint: activeCaseSuiteIds.length ? "Choose a linked suite before editing @s values." : "Link this automation case to a suite before editing @s values."
      };
    }
    if (scope === "r") {
      return {
        disabled: true,
        hint: "@r values are supplied from the execution run context."
      };
    }
    return {};
  };

  const handleParameterValueChange = (name: string, value: string) => {
    const parsed = parseStepParameterName(name);
    if (!parsed || resolveParameterInputState(parsed.scope).disabled) {
      return;
    }

    if (parsed.scope === "s") {
      setSuiteParameterValues((current) => ({ ...current, [parsed.name]: value }));
      return;
    }

    setTestCaseParameterValues((current) => ({ ...current, [parsed.name]: value }));
  };

  const closeAutomationCaseWorkspace = () => {
    setIsParameterDialogOpen(false);
    setAutomationStudioStep(null);
    setActiveAutomationWorkspaceTab("details");
    setSelectedCaseId("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("case");
      return next;
    }, { replace: true });
  };

  const toggleCaseSection = (section: AutomationCaseSectionKey) => {
    setExpandedCaseSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const focusAutomationStage = (section: AutomationCaseSectionKey) => {
    setActiveAutomationWorkspaceTab(section === "case" ? "details" : section === "history" ? "runs" : section);
    setExpandedCaseSections({ case: false, build: false, steps: false, history: false, [section]: true });
    globalThis.requestAnimationFrame(() => {
      document.querySelector(`[data-automation-stage="${section}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const selectAutomationWorkspaceTab = (tab: AutomationWorkspaceTab) => {
    setActiveAutomationWorkspaceTab(tab);
    const section: AutomationCaseSectionKey | null = tab === "details" || tab === "data" || tab === "hooks"
      ? "case"
      : tab === "runs" ? "history" : tab === "repository" ? null : tab;
    if (section) {
      setExpandedCaseSections((current) => ({ ...current, [section]: true }));
    }
  };

  const toggleAutomationStep = (stepId: string) => {
    setExpandedAutomationStepIds((current) => current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId]);
  };

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

  const handleRepositoryImportFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (!files.length) {
      return;
    }

    setIsParsingRepositoryImport(true);
    try {
      const preview = await parseObjectRepositoryFiles(files);
      setRepositoryImportPreview(preview);
      const fields = preview.entries.filter((entry) => entry.record_type === "field").length;
      const screens = preview.entries.filter((entry) => entry.record_type === "screen").length;
      if (!preview.entries.length) {
        throw new Error("No importable screens or fields were detected in the selected files.");
      }
      setIsRepositoryImportModalOpen(true);
      showInfo(`Prepared ${screens} screen${screens === 1 ? "" : "s"} and ${fields} field${fields === 1 ? "" : "s"} for review before import.`);
    } catch (error) {
      setRepositoryImportPreview(null);
      showError(error, "Unable to read object repository import files.");
    } finally {
      setIsParsingRepositoryImport(false);
    }
  };

  const exportRepositoryCsv = useMutation({
    mutationFn: () => {
      if (!appTypeId) {
        throw new Error("Select an application scope before exporting the repository.");
      }
      return api.testCases.exportLearningCacheCsv({ app_type_id: appTypeId });
    },
    onSuccess: (blob) => {
      const selectedApp = appTypes.find((item) => item.id === appTypeId)?.name || "object-repository";
      const fileName = `${selectedApp.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "object-repository"}-or.csv`;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(downloadUrl);
      showSuccess("Exported all object repository screens and fields as CSV. A TestOps batch process was recorded.");
    },
    onError: (error) => showError(error, "Unable to export object repository CSV.")
  });

  const importRepositoryEntries = useMutation({
    mutationFn: () => {
      if (!appTypeId) {
        throw new Error("Select an application scope before importing repository objects.");
      }
      if (!repositoryImportPreview?.entries.length) {
        throw new Error("Choose CSV, source, or ZIP files before importing.");
      }
      return api.testCases.importLearningCacheEntries({
        app_type_id: appTypeId,
        import_source: "or_file_import",
        entries: repositoryImportPreview.entries
      });
    },
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
      if (response.failed) {
        setRepositoryImportPreview((current) => current ? {
          ...current,
          warnings: [
            ...current.warnings,
            ...response.errors.slice(0, 8).map((error) => `${error.screen_name || "Entry"}: ${error.message}`)
          ]
        } : current);
        showError(new Error(`Imported ${response.created + response.updated} entries, but ${response.failed} could not be saved. Review the import warnings.`), "Some repository entries failed to import.");
        return;
      }
      setRepositoryImportPreview(null);
      setIsRepositoryImportModalOpen(false);
      showSuccess(`Object repository import completed in TestOps${response.transaction_id ? ` (${response.transaction_id.slice(0, 8)})` : ""}: ${response.created} new, ${response.updated} updated.`);
    },
    onError: (error) => showError(error, "Unable to import object repository entries.")
  });

	  const buildSingleAutomation = useMutation({
	    mutationFn: () => {
	      if (!canUseAutomationBuilder || !canUseAutomationAi) {
	        throw new Error("Permission required: automation.build and automation.ai");
	      }

	      if (!activeCase) {
	        throw new Error("Select an automation case first.");
	      }

      rememberAutomationBuildDrafts();
      return api.testCases.queueAutomationGenerator(activeCase.id, {
        allow_browser_actions: allowBrowserActions,
        scheduled_at: getAutomationSchedule(agentScheduledAt),
        start_url: startUrl || undefined,
        additional_context: [
          builderContext,
          agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : "Automate the saved behavior plan and verify its expected results.",
        ].filter(Boolean).join("\n\n"),
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        ai_requested: true
      });
    },
    onSuccess: (response) => {
      setAgentBuildStatus("queued");
      setAgentBuildTracking({ transactionId: response.transaction_id, projectId, caseIds: activeCase ? [activeCase.id] : [], scheduledAt: response.scheduled_at || null, startedAt: Date.now() });
      setAgentBuildReceipt(`${agentScheduledAt ? "Build scheduled" : "Build queued"} · ${response.transaction_id}`);
      showSuccess(`Automation build ${agentScheduledAt ? "scheduled" : "queued"}. Its output will appear in this case's step plan.`);
      invalidateAutomationData();
    },
    onError: (error) => showError(error, "Unable to queue automation.")
  });

  const mapExistingAutomation = useMutation({
    mutationFn: async () => {
      if (!canUseAutomationBuilder || !canUseAutomationAi) {
        throw new Error("Permission required: automation.build and automation.ai");
      }
      if (!automationActionTargetIds.length) {
        throw new Error("Select at least one Automation Case to map.");
      }

      const results = await Promise.allSettled(automationActionTargetIds.map((testCaseId) =>
        api.testCases.buildAutomation(testCaseId, {
          start_url: startUrl || undefined,
          additional_context: [builderContext, getPrompt("ai.automation.gap_analysis")].filter(Boolean).join("\n\n") || undefined,
          test_environment_id: selectedExecutionEnvironmentId || undefined,
          test_configuration_id: selectedExecutionConfigurationId || undefined,
          test_data_set_id: selectedExecutionDataSetId || undefined
        })
      ));
      const successfulResponses = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failedCount = results.length - successfulResponses.length;

      if (!successfulResponses.length) {
        const firstFailure = results.find((result) => result.status === "rejected");
        throw firstFailure && firstFailure.status === "rejected" ? firstFailure.reason : new Error("No Automation Cases were mapped.");
      }

      return {
        count: successfulResponses.length,
        failedCount,
        mappedSteps: successfulResponses.reduce((total, response) => total + Number(response.generated_step_count || 0), 0)
      };
    },
    onSuccess: ({ count, failedCount, mappedSteps }) => {
      invalidateAutomationData();
      showSuccess(`AI mapped ${mappedSteps} step${mappedSteps === 1 ? "" : "s"} across ${count} Automation Case${count === 1 ? "" : "s"}${failedCount ? `; ${failedCount} case${failedCount === 1 ? "" : "s"} need a retry` : ""}.`);
    },
    onError: (error) => showError(error, "Unable to map existing automation.")
  });

  const scheduleAiAutomation = useMutation({
    mutationFn: () => {
      if (!canUseAutomationBuilder || !canUseAutomationAi) {
        throw new Error("Permission required: automation.build and automation.ai");
      }
      if (!appTypeId || !automationActionTargetIds.length) {
        throw new Error("Select at least one Automation Case to schedule.");
      }

      rememberAutomationBuildDrafts();
      return api.testCases.buildAutomationBatch({
        allow_browser_actions: allowBrowserActions,
        scheduled_at: getAutomationSchedule(agentScheduledAt),
        app_type_id: appTypeId,
        test_case_ids: automationActionTargetIds,
        start_url: startUrl || undefined,
        additional_context: [builderContext, agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : "Automate the saved behavior plan and verify its expected results."].filter(Boolean).join("\n\n"),
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        ai_requested: true
      });
    },
    onSuccess: (response) => {
      setAgentBuildStatus("queued");
      setAgentBuildTracking({ transactionId: response.transaction_id, projectId, caseIds: [...automationActionTargetIds], scheduledAt: response.scheduled_at || null, startedAt: Date.now() });
      setAgentBuildReceipt(`${response.scheduled_at ? "Build scheduled" : "Build queued"} · ${response.transaction_id.slice(0, 8)}`);
      invalidateAutomationData();
      setIsBatchAgentOpen(false);
      showSuccess(`AI automation scheduled as ${response.transaction_id.slice(0, 8)} for ${automationActionTargetIds.length} Automation Case${automationActionTargetIds.length === 1 ? "" : "s"}.`);
    },
    onError: (error) => showError(error, "Unable to schedule AI automation.")
  });

  const createAutomationCase = useMutation({
    mutationFn: async () => {
      if (!canCreateAutomationCase) throw new Error("Automation authoring access is required.");
      if (!appTypeId) throw new Error("Select an application before creating automation.");
      const metadata = { ...automationCreateMetadata, manualCaseIds: [...automationCreateManualCaseIds] };
      const title = metadata.title.trim();
      if (!title) throw new Error("Enter an automation case name.");
      if (automationCreationMode === "ai" && !canUseAutomationAi) throw new Error("Permission required: automation.ai");
      if (automationCreationMode === "record" && !canUseRecorder) throw new Error("Permission required: automation.record");
      const authoredSteps = automationCreateSteps.filter((step) => step.action.trim() || step.expected_result.trim());
      if (automationCreationMode === "ai" && !metadata.manualCaseIds.length && !authoredSteps.length) {
        throw new Error("Link a source Test Case or add a step before starting an AI build.");
      }
      const scheduledAt = automationCreationMode === "ai" ? getAutomationSchedule(agentScheduledAt) : undefined;
      const sources = await Promise.all(metadata.manualCaseIds.map(async (id) => {
        const preview = createSourcesQuery.data?.find((source) => source.testCase.id === id);
        if (preview) return preview;
        const [testCase, steps] = await Promise.all([
          api.testCases.get(id, { project_id: projectId }),
          api.testSteps.list({ test_case_id: id })
        ]);
        return { testCase, steps };
      }));
      const sourceCases = sources.map((source) => source.testCase);
      const source = sourceCases[0];
      const preconditionGroupId = `automation-preconditions-${crypto.randomUUID()}`;
      const steps = [
        ...seedAutomationPlan(sources, () => `automation-${crypto.randomUUID()}`),
        ...authoredSteps.map((step) => ({
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: undefined,
          api_request: undefined,
          group_id: step.precondition ? preconditionGroupId : undefined,
          group_name: step.precondition ? "Preconditions" : undefined,
          group_kind: step.precondition ? "local" as const : undefined,
          reusable_group_id: undefined
        }))
      ].sort((left, right) => Number(isAutomationPrecondition(right)) - Number(isAutomationPrecondition(left)))
        .map((step, index) => ({ ...step, step_order: index + 1 }));
      const result = await api.testCases.create({
        app_type_id: appTypeId,
        title,
        description: metadata.description,
        external_references: [...new Set(sourceCases.flatMap((item) => item.external_references || []))],
        labels: [...new Set(sourceCases.flatMap((item) => item.labels || []))],
        parameter_values: Object.assign({}, ...[...sourceCases].reverse().map((item) => item.parameter_values || {})),
        automated: "yes",
        automation_status: automationCaseMappingStatus(steps),
        manual_test_case_id: metadata.manualCaseIds[0] || null,
        manual_test_case_ids: metadata.manualCaseIds,
        test_case_type: source?.test_case_type || "functional",
        test_data_set_ids: metadata.dataSetId ? [metadata.dataSetId] : [],
        priority: Number(metadata.priority) || 3,
        status: metadata.status,
        requirement_id: metadata.requirementIds[0],
        requirement_ids: metadata.requirementIds,
        suite_id: metadata.suiteIds[0],
        suite_ids: metadata.suiteIds,
        steps
      });

      // The case is durable now. Follow-up failures must return this ID so a
      // retry opens the saved case instead of creating a duplicate.
      const followUpFailures: string[] = [];
      const moduleResults = await Promise.allSettled(metadata.moduleIds.map((moduleId) => api.testCaseModules.assignCases(moduleId, [result.id], true)));
      moduleResults.forEach((assignment, index) => {
        if (assignment.status === "rejected") {
          const name = automationModules.find((module) => module.id === metadata.moduleIds[index])?.name || metadata.moduleIds[index];
          followUpFailures.push(`Module ${name} could not be linked.`);
        }
      });
      let transactionId = "";
      if (automationCreationMode === "ai") {
        try {
          const queued = await api.testCases.queueAutomationGenerator(result.id, {
            allow_browser_actions: allowBrowserActions,
            scheduled_at: scheduledAt,
            start_url: startUrl.trim() || undefined,
            additional_context: [
              agentMission.trim() ? `Agent mission: ${agentMission.trim()}` : "Automate the saved behavior plan and verify its expected results.",
              builderContext.trim(),
            ].filter(Boolean).join("\n\n"),
            test_environment_id: selectedExecutionEnvironmentId || undefined,
            test_configuration_id: selectedExecutionConfigurationId || undefined,
            test_data_set_id: metadata.dataSetId || undefined,
            ai_requested: true
          });
          transactionId = queued.transaction_id;
        } catch (error) {
          followUpFailures.push(`AI build was not queued. ${error instanceof Error ? error.message : "Retry from this case's Build tab."}`);
        }
      }
      return { id: result.id, title, transactionId, mode: automationCreationMode, scheduledAt, followUpFailures };
    },
    onSuccess: async ({ id, title, transactionId, mode, scheduledAt, followUpFailures }) => {
      setIsCreateAutomationOpen(false);
      setAutomationCreateManualCaseIds([]);
      setAutomationCreateMetadata(emptyAutomationMetadata);
      setAutomationCreateSteps([]);
      automationCreateTouchedMetadataRef.current.clear();
      setSelectedCaseId(id);
      setSelectedAutomatedCaseId(id);
      setBuildMethod(mode === "record" ? "record" : "agent");
      setActiveAutomationWorkspaceTab(mode === "blank" ? "steps" : "build");
      setAgentBuildReceipt(transactionId ? `${scheduledAt ? "Build scheduled" : "Build queued"} · ${transactionId}` : "");
      if (transactionId) {
        rememberAutomationBuildDrafts();
        setAgentBuildStatus("queued");
        setAgentBuildTracking({ transactionId, projectId, caseIds: [id], scheduledAt: scheduledAt || null, startedAt: Date.now() });
      }
      setExpandedCaseSections((current) => ({ ...current, build: true, steps: true }));
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete("create");
        next.delete("manual");
        next.set("case", id);
        return next;
      }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
      void queryClient.invalidateQueries({ queryKey: ["test-case-modules"] });
      if (followUpFailures.length) {
        showError(new Error(`${title} was created and its plan was saved. ${followUpFailures.join(" ")} Continue in the saved case to retry.`), "Automation case created; follow-up needs attention.");
      } else {
        showSuccess(mode === "ai"
          ? `${title} created and AI build ${scheduledAt ? "scheduled" : "queued"}${transactionId ? ` as ${transactionId}` : ""}.`
          : mode === "record"
            ? `${title} created. The recorder is ready in Build.`
            : `${title} created with its step plan.`);
      }
    },
    onError: (error) => showError(error, "Unable to create automation case.")
  });

  const createAutomationDialogRef = useDialogFocus<HTMLDivElement>({
    active: isCreateAutomationOpen,
    closeDisabled: createAutomationCase.isPending,
    onClose: closeCreateAutomation
  });

  const groupAutomationSteps = useMutation({
    mutationFn: async () => {
      if (!activeCase || selectedAutomationStepIds.length < 2) {
        throw new Error("Select at least two automation steps to group.");
      }
      const name = automationGroupName.trim() || "Automation flow";
      const selectedSteps = automatedSteps.filter((step) => selectedAutomationStepIds.includes(step.id));
      let reusableGroupId: string | undefined;
      if (saveAutomationGroupAsShared) {
        if (!appTypeId) throw new Error("Select an application before creating a Shared Step Group.");
        const created = await api.sharedStepGroups.create({
          app_type_id: appTypeId,
          name,
          steps: selectedSteps.map((step, index) => ({
            step_order: index + 1,
            action: step.action || undefined,
            expected_result: step.expected_result || undefined,
            step_type: step.step_type || "web",
            automation_code: step.automation_code || undefined,
            api_request: step.api_request || undefined
          }))
        });
        reusableGroupId = created.id;
      }
      return api.testSteps.group({
        test_case_id: activeCase.id,
        step_ids: selectedAutomationStepIds,
        name,
        kind: reusableGroupId ? "reusable" : "local",
        reusable_group_id: reusableGroupId
      });
    },
    onSuccess: () => {
      setSelectedAutomationStepIds([]);
      setAutomationGroupName("");
      setSaveAutomationGroupAsShared(false);
      showSuccess("Automation steps grouped successfully.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
      void queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] });
    },
    onError: (error) => showError(error, "Unable to group automation steps.")
  });

  const ungroupAutomationSteps = useMutation({
    mutationFn: (groupId: string) => {
      if (!activeCase) throw new Error("Select an automation case first.");
      return api.testSteps.ungroup({ test_case_id: activeCase.id, group_id: groupId });
    },
    onSuccess: () => {
      showSuccess("Group removed; its automation steps remain in place.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => showError(error, "Unable to ungroup automation steps.")
  });

  const insertAutomationSharedGroup = useMutation({
    mutationFn: (sharedGroupId: string) => {
      if (!activeCase) throw new Error("Select an automation case first.");
      return api.testSteps.insertSharedGroup({
        test_case_id: activeCase.id,
        shared_step_group_id: sharedGroupId,
        insert_after_step_id: automatedSteps[automatedSteps.length - 1]?.id
      });
    },
    onSuccess: () => {
      setIsSharedGroupLibraryOpen(false);
      showSuccess("Shared Step Group inserted.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => showError(error, "Unable to insert the Shared Step Group.")
  });

	  const optimizeAutomationCase = useMutation({
	    mutationFn: () => {
	      if (!canUseAutomationAi) {
	        throw new Error("Permission required: automation.ai");
	      }

	      if (!isAutomationCaseDetailReady || !activeCase) {
	        throw new Error("Wait for the complete automation case details before using AI review.");
	      }

      return api.testCases.queueAutomationGenerator(activeCase.id, {
        allow_browser_actions: allowBrowserActions,
        additional_context: getPrompt("ai.automation.review"),
        ai_requested: true
      });
    },
    onSuccess: (response) => {
      showSuccess(`AI automation review queued as ${response.transaction_id}.`);
      invalidateAutomationData();
    },
    onError: (error) => showError(error, "Unable to queue AI automation review.")
  });

  const updateAutomationCase = useMutation({
    mutationFn: async () => {
      if (!canUpdateAutomationCase) {
        throw new Error("Automation authoring and Test Case update permissions are required.");
      }
      if (!isAutomationCaseDetailReady || !activeCase) {
        throw new Error("Wait for the complete automation case details before saving.");
      }

      const caseId = activeCase.id;
      const selectedSuiteParameterTarget = selectedParameterSuite
        ? {
            id: selectedParameterSuite.id,
            parameterValues: normalizeAutomationParameterValues(suiteParameterValues, "s")
          }
        : null;
      const response = await api.testCases.update(caseId, {
        title: caseDraft.title.trim(),
        description: caseDraft.description.trim(),
        status: caseDraft.status.trim() || "active",
        priority: Number(caseDraft.priority) || 3,
        parameter_values: {
          ...normalizeAutomationParameterValues(parseParameterText(caseDraft.parameterText), "t"),
          ...normalizeAutomationParameterValues(testCaseParameterValues, "t")
        },
        suite_id: suiteLinkDraftIds[0] || "",
        suite_ids: suiteLinkDraftIds,
        requirement_id: caseRequirementIds[0] || "",
        requirement_ids: caseRequirementIds,
        test_data_set_ids: caseDataSetId ? [caseDataSetId] : [],
        automated: "yes",
        manual_test_case_ids: automationManualLinkDraftIds,
        expected_revision: activeCase.revision
      });

      const followUps = [
        ...(activeCase.module_ids || []).filter((id) => !caseModuleIds.includes(id)).map((moduleId) => ({
          label: `Module ${automationModules.find((item) => item.id === moduleId)?.name || moduleId} could not be unlinked.`,
          save: () => api.testCaseModules.removeCases(moduleId, [caseId])
        })),
        ...caseModuleIds.filter((id) => !activeCase.module_ids?.includes(id)).map((moduleId) => ({
          label: `Module ${automationModules.find((item) => item.id === moduleId)?.name || moduleId} could not be linked.`,
          save: () => api.testCaseModules.assignCases(moduleId, [caseId], true)
        })),
        ...(selectedSuiteParameterTarget ? [{
          label: "Suite parameter values could not be saved.",
          save: () => api.testSuites.update(selectedSuiteParameterTarget.id, { parameter_values: selectedSuiteParameterTarget.parameterValues })
        }] : [])
      ];
      const results = await Promise.allSettled(followUps.map((item) => item.save()));
      const followUpFailures = results.flatMap((result, index) => result.status === "rejected" ? [followUps[index].label] : []);
      return { caseId, response, followUpFailures };
    },
    onSuccess: async ({ caseId, followUpFailures }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationCaseDetailQueryKey(projectId, caseId), exact: true }),
        queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
        queryClient.invalidateQueries({ queryKey: ["test-case-modules"] }),
        queryClient.invalidateQueries({ queryKey: ["test-case-suites"] })
      ]);
      if (followUpFailures.length) {
        showError(new Error(`Case details were saved. ${followUpFailures.join(" ")} Your remaining changes are retained; save again to retry.`), "Case saved; linked records need attention.");
      } else showSuccess("Automation case updated.");
    },
    onError: (error) => showError(error, "Unable to update automation case.")
  });

  const deleteAutomationCase = useMutation({
    mutationFn: async (testCase: TestCase) => {
      if (!canRemoveAutomationCase) throw new Error("Permission to remove this automation case is required.");
      if (testCase.manual_test_case_id || testCase.manual_test_case_ids?.length) {
        await api.testCases.delete(testCase.id);
        return { preservedManual: true };
      }

      await Promise.all(automatedSteps.map((step) => api.testSteps.update(step.id, {
        automation_code: "",
        api_request: null
      })));
      await api.testCases.update(testCase.id, {
        automated: "no",
        automation_status: "not_automated"
      });
      return { preservedManual: true };
    },
    onSuccess: ({ preservedManual }) => {
      showSuccess(preservedManual ? "Automation case removed. Its manual test case was preserved." : "Automation case deleted.");
      setSelectedCaseId("");
      setSelectedAutomatedCaseId("");
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("case");
        return next;
      }, { replace: true });
      invalidateAutomationData();
    },
    onError: (error) => showError(error, "Unable to delete automation case.")
  });

  const syncAutomationStepDrafts = (step: TestStep) => {
    setStepDrafts((current) => ({ ...current, [step.id]: parseAutomationStepDraft(step) }));
    setStepCodeDrafts((current) => ({ ...current, [step.id]: step.automation_code || "" }));
    setApiSourceDrafts((current) => { const next = { ...current }; delete next[step.id]; return next; });
    setStepOptionDrafts((current) => ({ ...current, [step.id]: parseAutomationStepOptions(step) }));
  };

  const refreshAutomationStepAfterSave = async (caseId: string, stepId: string) => {
    const steps = await api.testSteps.list({ test_case_id: caseId });
    queryClient.setQueryData(["test-steps", "automation-workspace", caseId], steps);
    const saved = steps.find((candidate) => candidate.id === stepId);
    if (!saved) throw new Error("The step was saved but could not be reloaded. Refresh the case to continue.");
    await api.testCases.update(caseId, { automated: "yes", automation_status: automationCaseMappingStatus(steps) });
    return saved;
  };

  const createAutomationStep = useMutation({
    mutationFn: async () => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      if (!activeCase) throw new Error("Select an automation case first.");
      if (!newStepDraft.name.trim() && !automationMappingIsComplete(newStepDraft)) throw new Error("Describe the step before adding it.");
      const hasMapping = automationMappingIsComplete(newStepDraft);
      const automation_code = hasMapping ? buildAutomationCodeFromDraft(newStepDraft) : "";
      const { insertionIndex, groupSource } = getAutomationStepInsertion(automatedSteps, newStepPlacement, newStepIsPrecondition);
      const groupId = newStepIsPrecondition ? groupSource?.group_id || `preconditions-${crypto.randomUUID()}` : groupSource?.group_id || undefined;
      const input = {
        test_case_id: activeCase.id,
        step_order: insertionIndex + 1,
        action: buildAutomationStepAction(newStepDraft),
        expected_result: newStepDraft.expected_result,
        step_type: newStepDraft.step_type,
        automation_code,
        api_request: hasMapping ? buildAutomationApiRequest(newStepDraft) || undefined : undefined,
        group_id: groupId,
        group_name: newStepIsPrecondition ? "Preconditions" : groupSource?.group_name || undefined,
        group_kind: groupId ? groupSource?.group_kind || "local" as const : undefined,
        reusable_group_id: groupId ? groupSource?.reusable_group_id || undefined : undefined
      };
      const created = await api.testSteps.create(input);
      return { created: { ...input, id: created.id }, previousSteps: automatedSteps };
    },
    onSuccess: async ({ created, previousSteps }) => {
      // Creation has committed. Keep its ID and clear this submission before
      // any reload or readiness update can fail and suggest another insertion.
      queryClient.setQueryData<TestStep[]>(["test-steps", "automation-workspace", created.test_case_id],
        (cached) => cacheCreatedAutomationStep(cached || previousSteps, created));
      if (currentAutomationSelectionRef.current.selectedCaseId === created.test_case_id) {
        syncAutomationStepDrafts(created);
        setExpandedAutomationStepIds((current) => current.includes(created.id) ? current : [...current, created.id]);
        setNewStepDraft(emptyAutomationStepDraft(created.step_type));
        setNewStepIsPrecondition(false);
        setNewStepPlacement({ mode: "end", stepId: "" });
      }
      const result = await refreshCreatedAutomationStep(created,
        (saved) => refreshAutomationStepAfterSave(saved.test_case_id, saved.id));
      if (result.refreshError) {
        queryClient.setQueryData<TestStep[]>(["test-steps", "automation-workspace", created.test_case_id],
          (cached) => cacheCreatedAutomationStep(cached || previousSteps, created));
        const detail = result.refreshError instanceof Error ? result.refreshError.message : "The saved plan could not be refreshed.";
        showError(new Error(`The section was added. Its plan refresh or readiness update failed: ${detail} Reopen this case to refresh the saved section.`), "Section saved; refresh needs attention.");
      } else {
        showSuccess(isAutomationStepMapped(result.step) ? "Automation section added." : "Section added. Select its keyword and inputs to map automation.");
      }
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to add automation step.")
  });

  const updateAutomationStep = useMutation({
    mutationFn: async (step: TestStep) => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
      const existingDraft = parseAutomationStepDraft(step);
      const mappingUnchanged = automationMappingFieldsEqual(draft, existingDraft);
      const savedOptions = parseAutomationStepOptions(step);
      const options = stepOptionDrafts[step.id] || savedOptions;
      const optionsUnchanged = JSON.stringify(options) === JSON.stringify(savedOptions);
      const currentCode = stepCodeDrafts[step.id] ?? step.automation_code ?? "";
      const mappingSave = resolveAutomationMappingSave({ currentCode, previousMappingCode: buildAutomationCodeFromDraft(existingDraft), nextMappingCode: automationMappingIsComplete(draft) ? buildAutomationCodeFromDraft(draft) : "", mappingUnchanged });
      if (mappingSave.requiresProgramEditor) throw new Error("Use Edit instructions or Source to change this recorded or custom program. Its existing instructions have been preserved.");
      const authoredCode = mappingSave.code;
      const automation_code = !authoredCode.trim() ? "" : mappingUnchanged && optionsUnchanged ? authoredCode : applyAutomationStepOptions(authoredCode, options);
      await api.testSteps.update(step.id, {
        action: buildAutomationStepAction({ ...draft, name: draft.name.trim() || step.action || "" }),
        expected_result: draft.expected_result,
        step_type: draft.step_type,
        automation_code,
        api_request: mappingUnchanged ? step.api_request : automationMappingIsComplete(draft) ? buildAutomationApiRequest(draft, step.api_request) : null
      });
      return refreshAutomationStepAfterSave(step.test_case_id, step.id);
    },
    onSuccess: (updated) => {
      syncAutomationStepDrafts(updated);
      showSuccess("Automation step updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to update automation step.")
  });

  const updateAutomationStepCode = useMutation({
    mutationFn: async (step: TestStep) => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      if (step.step_type === "api") {
        const request = parseApiRequestSource(apiSourceDrafts[step.id] ?? JSON.stringify(step.api_request || {}, null, 2));
        const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
        await api.testSteps.update(step.id, { action: buildAutomationStepAction(draft), expected_result: draft.expected_result, api_request: request, automation_code: applyAutomationStepOptions("", stepOptionDrafts[step.id] || parseAutomationStepOptions(step)) });
        setApiSourceDrafts((current) => { const next = { ...current }; delete next[step.id]; return next; });
        return refreshAutomationStepAfterSave(step.test_case_id, step.id);
      }
      const code = (stepCodeDrafts[step.id] ?? step.automation_code ?? "").trim();
      const codeChanged = code !== (step.automation_code || "").trim();
      const automation_code = code ? applyAutomationStepOptions(code, stepOptionDrafts[step.id] || parseAutomationStepOptions(step)) : "";
      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
      await api.testSteps.update(step.id, {
        action: buildAutomationStepAction(draft),
        expected_result: draft.expected_result,
        automation_code,
        ...(codeChanged ? { api_request: null } : {})
      });
      return refreshAutomationStepAfterSave(step.test_case_id, step.id);
    },
    onSuccess: (updated) => {
      syncAutomationStepDrafts(updated);
      showSuccess("Automation code updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to update automation code.")
  });

  const saveAutomationStudioStep = useMutation({
    mutationFn: async ({ step, input }: {
      step: TestStep;
      input: { step_type: TestStepType; automation_code: string; api_request: StepApiRequest | null };
    }) => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
      await api.testSteps.update(step.id, {
        ...input,
        action: buildAutomationStepAction(draft),
        expected_result: draft.expected_result
      });
      return refreshAutomationStepAfterSave(step.test_case_id, step.id);
    },
    onSuccess: (updated) => {
      syncAutomationStepDrafts(updated);
      setAutomationStudioStep(null);
      showSuccess(isAutomationStepMapped(updated) ? "Step automation saved." : "Step saved without an executable mapping.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to save automation step.")
  });

	  const rephraseAutomationStep = useMutation({
	    mutationFn: async (step: TestStep) => {
	      if (!canEditAutomationCode) {
	        throw new Error("Permission required: automation.build and automation.code.view");
	      }
	      if (!canUseAutomationAi) {
	        throw new Error("Permission required: automation.ai");
	      }

	      if (!appTypeId || !activeCase) {
	        throw new Error("Select an automation case before using step AI.");
	      }

      const response = await api.testCases.rephraseStep({
        app_type_id: appTypeId,
        requirement_id: activeCase.requirement_id || undefined,
        additional_context: [getPrompt("ai.automation.step_rephrase"), agentMission].filter(Boolean).join("\n\n"),
        test_case: {
          title: activeCase.title,
          description: activeCase.description || "",
          parameter_values: testCaseParameterValues
        },
        step: {
          step_order: step.step_order,
          step_type: step.step_type,
          action: step.action,
          expected_result: step.expected_result
        }
      });

      await api.testSteps.update(step.id, {
        action: response.step.action || step.action || "",
        expected_result: response.step.expected_result || step.expected_result || ""
      });
      return refreshAutomationStepAfterSave(step.test_case_id, step.id);
    },
    onSuccess: (updated) => {
      syncAutomationStepDrafts(updated);
      showSuccess("AI improved the automation step text.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to improve automation step.")
  });

  const reorderAutomationStep = useMutation({
    mutationFn: ({ stepId, direction }: { stepId: string; direction: "up" | "down" }) => {
      if (!activeCase) throw new Error("Select an automation case first.");
      const order = getAutomationStepReorder(automatedSteps, stepId, direction);
      if (!order) throw new Error("This section cannot move further within its flow.");
      return api.testSteps.reorder(activeCase.id, order.stepIds);
    },
    onSuccess: () => {
      showSuccess("Automation steps reordered.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => showError(error, "Unable to reorder automation step.")
  });

  const deleteAutomationStep = useMutation({
    mutationFn: async (step: TestStep) => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      await api.testSteps.update(step.id, { automation_code: "", api_request: null });
      return refreshAutomationStepAfterSave(step.test_case_id, step.id);
    },
    onSuccess: (updated) => {
      syncAutomationStepDrafts(updated);
      showSuccess("Automation removed from the step; its description and group are preserved.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to remove automation from step.")
  });

  const removeAutomationPlanStep = useMutation({
    mutationFn: async (step: TestStep) => {
      if (!canEditAutomationCode) throw new Error("Permission required: automation.build and automation.code.view");
      if (step.group_id && step.reusable_group_id) {
        const siblings = await api.testSteps.list({ test_case_id: step.test_case_id });
        // Removing one member makes this instance a local variation. Keep the
        // reusable definition and the linked manual plan intact.
        await api.testSteps.group({
          test_case_id: step.test_case_id,
          step_ids: siblings.filter((candidate) => candidate.group_id === step.group_id).map((candidate) => candidate.id),
          group_id: step.group_id,
          name: step.group_name || "Step group",
          kind: "local"
        });
      }
      await api.testSteps.delete(step.id);
      const steps = await api.testSteps.list({ test_case_id: step.test_case_id });
      queryClient.setQueryData(["test-steps", "automation-workspace", step.test_case_id], steps);
      await api.testCases.update(step.test_case_id, { automated: "yes", automation_status: automationCaseMappingStatus(steps) });
      return step.id;
    },
    onSuccess: (stepId) => {
      setStepDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
      setStepCodeDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
      setStepOptionDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
      setExpandedAutomationStepIds((current) => current.filter((id) => id !== stepId));
      setSelectedAutomationStepIds((current) => current.filter((id) => id !== stepId));
      setAutomationStudioStep((current) => current?.id === stepId ? null : current);
      showSuccess("Step removed from the automation plan.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => showError(error, "Unable to remove the plan step.")
  });

	  const runCase = useMutation({
	    mutationFn: async ({ testCase }: { testCase: TestCase }) => {
	      if (!canRunLocalAutomation) {
	        throw new Error("Permission required: automation.run.local");
	      }

	      if (!projectId || !appTypeId || !session?.user.id) {
	        throw new Error("Select project and app type before running a case.");
	      }

      return api.executions.createLocalRun({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCase.id],
        name: `Automation run - ${testCase.title}`,
        created_by: session.user.id,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        execution_hooks: executionHookDraft.length ? mapRunHooksToExecutionHooks(executionHookDraft) : undefined,
        engine_base_url: "http://localhost:4311"
      });
    },
    onSuccess: (response) => {
      showSuccess(`Local Test Engine run started as ${response.id}.`);
      void queryClient.invalidateQueries({ queryKey: ["executions"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
      navigate(`/executions?view=local-runs&execution=${response.id}`);
    },
    onError: (error) => showError(error, "Unable to run case.")
  });

	  const runSelectedAutomationCases = useMutation({
	    mutationFn: async (mode: "local" | "remote") => {
	      if (mode === "local" && !canRunLocalAutomation) {
	        throw new Error("Permission required: automation.run.local");
	      }

	      if (mode === "remote" && !canRunRemoteAutomation) {
	        throw new Error("Permission required: automation.run.remote");
	      }

	      if (!projectId || !appTypeId || !session?.user.id) {
	        throw new Error("Select project and app type before running automation.");
	      }

      const fallbackCaseId = activeCase?.id || activeAutomatedCase?.id || "";
      const testCaseIds = selectedAutomationCaseIds.length ? selectedAutomationCaseIds : fallbackCaseId ? [fallbackCaseId] : [];

      if (!testCaseIds.length) {
        throw new Error("Select at least one automation case before running.");
      }

      const selectedTitles = automatedCases
        .filter((testCase) => testCaseIds.includes(testCase.id))
        .map((testCase) => testCase.title);
      const runName = selectedTitles.length === 1
        ? `${selectedTitles[0]} ${mode === "local" ? "Local Run" : "Remote Run"}`
        : `Automation ${mode === "local" ? "Local" : "Remote"} Run - ${selectedTitles.length} cases`;

      if (mode === "local") {
        const response = await api.executions.createLocalRun({
          project_id: projectId,
          app_type_id: appTypeId,
          test_case_ids: testCaseIds,
          name: runName,
          created_by: session.user.id,
          test_environment_id: selectedExecutionEnvironmentId || undefined,
          test_configuration_id: selectedExecutionConfigurationId || undefined,
          test_data_set_id: selectedExecutionDataSetId || undefined,
          execution_hooks: executionHookDraft.length ? mapRunHooksToExecutionHooks(executionHookDraft) : undefined,
          engine_base_url: "http://localhost:4311"
        });

        return { id: response.id, mode, count: testCaseIds.length };
      }

      const response = await api.executions.create({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: testCaseIds,
        name: runName,
        created_by: session.user.id,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        execution_hooks: executionHookDraft.length ? mapRunHooksToExecutionHooks(executionHookDraft) : undefined,
        execution_mode: "remote"
      });

      await api.executions.start(response.id, { execution_mode: "remote" });
      return { id: response.id, mode, count: testCaseIds.length };
    },
    onSuccess: async ({ id, mode, count }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
      ]);
      setSelectedAutomationCaseIds([]);
      navigate(`/executions?view=${mode === "local" ? "local-runs" : "suite-runs"}&execution=${id}`);
      showSuccess(`${mode === "local" ? "Local" : "Remote"} automation run started with ${count} case${count === 1 ? "" : "s"}.`);
    },
    onError: (error) => showError(error, "Unable to run selected automation cases.")
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
    const isExistingSelection = stagedInspectFieldsRef.current.some((item) => item.locator === field.locator);
    setStagedInspectFields((current) => {
      const existingIndex = current.findIndex((item) => item.locator === field.locator);
      if (existingIndex < 0) {
        const next = [...current, field];
        stagedInspectFieldsRef.current = next;
        return next;
      }
      const next = current.map((item, index) => index === existingIndex ? { ...item, ...field } : item);
      stagedInspectFieldsRef.current = next;
      return next;
    });
    setFocusedInspectLocator(field.locator);
    setInspectMessage(`${isExistingSelection ? "Updated" : "Selected"} ${field.name}. Remove unwanted fields or save the selected set.`);
  };

  const updateStagedInspectField = (currentLocator: string, patch: Partial<RepositoryExtractedField>) => {
    const nextLocator = patch.locator || currentLocator;
    setStagedInspectFields((current) => {
      const next = current.map((field) => {
        if (field.locator !== currentLocator) return field;
        const merged = { ...field, sourceLocator: field.sourceLocator || currentLocator, ...patch };
        if (patch.locator && patch.locator !== currentLocator) {
          const selectedCandidate = field.locatorCandidates?.find((candidate) => candidate.locator === patch.locator);
          merged.locatorKind = selectedCandidate?.strategy || merged.locatorKind;
          merged.locatorCandidates = selectedCandidate
            ? [selectedCandidate, ...(field.locatorCandidates || []).filter((candidate) => candidate.locator !== selectedCandidate.locator)]
            : [{ locator: patch.locator, strategy: merged.locatorKind, confidenceScore: 0, isPrimary: true }];
          merged.validationStatus = "unverified";
          merged.validatedAt = undefined;
          merged.validationWarning = "Locator changed. Validate it on the current page.";
          merged.locatorCandidates = merged.locatorCandidates?.map((candidate) => ({ ...candidate, matchCount: undefined }));
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

  const persistRepositoryField = (
    field: RepositoryExtractedField,
    evidence?: { screenDom?: string | null; screenScreenshotUrl?: string | null; screenFingerprint?: string | null; accessibilityTree?: string | null; pageUrl?: string | null },
    savedScreen?: AutomationLearningCacheEntry
  ) => {
    const screenName = savedScreen ? getScreenName(savedScreen) : screenInfoDraft.screen_name.trim() || activeScreenName || inferScreenName(null, screenUrlDraft) || "Screen";
    const repositoryAppTypeId = savedScreen ? savedScreen.app_type_id || "" : activeRepositoryAppTypeId || appTypeId || "";
    const repositoryProjectId = savedScreen ? savedScreen.project_id || "" : activeRepositoryProjectId || projectId || "";
    const effectiveScreenDom = evidence?.screenDom ?? screenDomDraft;
    const effectiveScreenScreenshot = evidence?.screenScreenshotUrl ?? screenScreenshotDraft;
    const effectiveScreenFingerprint = evidence?.screenFingerprint ?? screenInfoDraft.screen_fingerprint;
    const effectiveAccessibilityTree = evidence?.accessibilityTree ?? screenInfoDraft.accessibility_tree;
    const effectivePageUrl = evidence?.pageUrl ?? field.pageUrl ?? screenUrlDraft;
    const existingField = learningCache.find((entry) =>
      !isScreenRepositoryRecord(entry)
      && getScreenName(entry) === screenName
      && entry.locator === field.locator
      && (entry.app_type_id || "") === repositoryAppTypeId
      && (!repositoryProjectId || !entry.project_id || entry.project_id === repositoryProjectId)
    );
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
        screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50_000) : null,
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
      const duplicate = learningCache.find((entry) =>
        entry.id !== selectedRepositoryEntry.id
        && getScreenName(entry) === screenName
        && String(entry.locator || "").trim() === repositoryDraft.locator.trim()
        && (!activeRepositoryAppTypeId || entry.app_type_id === activeRepositoryAppTypeId)
      );

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
      queryClient.setQueriesData<AutomationLearningCacheEntry[]>({ queryKey: ["automation-learning-cache"] }, (current) =>
        current ? current.map((entry) => entry.id === updatedEntry.id ? updatedEntry : entry) : current
      );
      setSelectedRepositoryId(updatedEntry.id);
      const updatedReferences = Number((updatedEntry as AutomationLearningCacheEntry & { updated_step_references?: number }).updated_step_references || 0);
      showSuccess(updatedReferences
        ? `Object repository field saved and ${updatedReferences} automation reference${updatedReferences === 1 ? "" : "s"} updated.`
        : "Object repository field saved for execution-time locator resolution.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => showError(error, "Unable to save repository field.")
  });

  const addRepositoryScreen = useMutation({
    mutationFn: (_options?: { inspectAfterSave?: boolean }) => {
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
      queryClient.setQueryData<AutomationLearningCacheEntry[]>(
        ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
        (current) => [entry, ...(current || []).filter((currentEntry) => currentEntry.id !== entry.id)]
      );
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
      } else {
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
      screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50_000) : null,
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
      screen_dom_compressed: effectiveScreenDom ? effectiveScreenDom.slice(0, 50_000) : undefined,
      screen_screenshot_url: effectiveScreenScreenshot || undefined,
      source: "manual_screen",
      metadata
    });
  };

  const saveRepositoryScreenEvidence = useMutation({
    mutationFn: () => persistRepositoryScreenEvidence(),
    onSuccess: (screen) => {
      queryClient.setQueryData<AutomationLearningCacheEntry[]>(
        ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
        (current) => mergeRepositoryEntries(current, [screen])
      );
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
      response = await readInspectSessionJson<RecorderLocatorValidationResponse>(
        targetSession, "/inspect/validate",
        {
          method: "POST",
          body: JSON.stringify({
            page_id: pageId,
            fields: fields.map((field) => ({ locator: field.locator, name: field.name }))
          })
        }
      );
    } catch (error) {
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
    const updatedSelection = mergeInspectedFields(stagedInspectFieldsRef.current, validatedFields);
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
      if (!stagedInspectFields.length) throw new Error("Select at least one field to validate.");
      return validateInspectFieldsForSave([...stagedInspectFields], "validate");
    },
    onSuccess: () => setInspectReviewTab("selected"),
    onError: (error) => showError(error, "Unable to validate selected fields.")
  });

  const saveInspectedScreenFields = useMutation({
    mutationFn: async () => {
      const pendingCapture = isInspectingLiveField ? await stopLiveInspect() : null;
      const fields = [...stagedInspectFieldsRef.current];
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
      queryClient.setQueryData<AutomationLearningCacheEntry[]>(
        ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
        (current) => mergeRepositoryEntries(current, persistedEntries)
      );
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
      } else {
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
      const semanticAlternative = rankedSuggestions.find((suggestion) =>
        suggestion.locator !== field.locator
        && suggestion.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalizedName
      );
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
        new_name: screenRenameDraft.trim()
      });
    },
    onSuccess: (response) => {
      setSelectedScreenName(makeRepositoryScreenKey(response.screen_name, activeRepositoryAppTypeId || appTypeId || undefined));
      setRenamingScreenName("");
      setScreenInfoDraft((current) => ({ ...current, screen_name: response.screen_name }));
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
  repositorySelectionRef.current = selectedRepositoryEntry?.id;
  const improveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.improveLearningCacheEntry(selectedRepositoryEntry.id, {
        guidance: repositoryDraft.target_criteria || builderContext || undefined
      });
    },
    onSuccess: (response) => {
      if (response.entry.id !== repositorySelectionRef.current) return;
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

	  const startRecorder = useMutation({
	    mutationFn: (options: RecorderStartOptions) => {
	      if (!canUseRecorder) {
	        throw new Error("Permission required: automation.recorder");
	      }

	      if (!activeCase) {
	        throw new Error("Select an automation case first.");
	      }

      rememberAutomationBuildDrafts();
      recorderOriginRef.current = { caseId: activeCase.id, projectId, targetStepId: recordingTargetStepId };
      return api.testCases.startRecorderSession(activeCase.id, {
        start_url: startUrl || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url,
        reuse_existing: options.recorder_mode === "local" && options.recorder_target === "web",
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        target_step_id: recorderOriginRef.current.targetStepId || undefined
      });
    },
    onSuccess: (response, options) => {
      setRecorderSession(response);
      setRecorderStartOptions(options);
      showSuccess(response.reused
        ? "Reused the open local Playwright browser and started a fresh repository capture."
        : `${options.recorder_mode === "remote" ? "Remote" : "Local"} ${options.recorder_target === "mobile" ? "device" : "browser"} recorder started. Actions will appear in playback order.`);
      invalidateAutomationData();
    },
    onError: (error) => showError(error, "Unable to start the recorder.")
  });

	  const finishRecorder = useMutation({
	    mutationFn: () => {
	      if (!canUseRecorder) {
	        throw new Error("Permission required: automation.recorder");
	      }

	      if (!activeCase || !recorderSession?.id) {
	        throw new Error("Start a recorder session before finishing it.");
	      }

      return api.testCases.finishRecorderSession(recorderOriginRef.current?.caseId || activeCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
        additional_context: builderContext || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        target_step_id: recorderOriginRef.current?.targetStepId || undefined
      });
    },
    onSuccess: async (response) => {
      showSuccess(
        response.generated_step_count
          ? `Captured ${response.learned_locator_count} repository object${response.learned_locator_count === 1 ? "" : "s"} and updated ${response.generated_step_count} automation step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured."
      );
      setRecorderSession(null);
      setRecorderStartOptions(null);
      setRecordingTargetStepId("");
      invalidateAutomationData();
      const recorderOrigin = recorderOriginRef.current;
      recorderOriginRef.current = null;
      if (response.generated_step_count && response.test_case_id) {
        try { await openGeneratedAutomationPlan(response.test_case_id, recorderOrigin?.projectId || projectId, [recorderOrigin?.caseId || selectedCaseId]); }
        catch (error) { showError(error, "Recorder output was saved, but the updated plan could not be loaded. Reopen the case."); }
      } else setActiveAutomationWorkspaceTab("steps");
    },
    onError: (error) => showError(error, "Unable to finish recorder session.")
  });

  const loadInspectTabs = async (sessionOverride?: RecorderSessionResponse | null, options: { activate?: boolean; selectedPageId?: string; refreshPreview?: boolean } = {}) => {
    const targetSession = sessionOverride || inspectSessionRef.current;
    if (!targetSession?.id) throw new Error("Connect an inspection browser before selecting a tab.");
    const generation = inspectSessionGenerationRef.current;
    const requestId = ++inspectTabRequestRef.current;
    const { tabs, pageId } = await loadRepositoryInspectTabs(targetSession, options.selectedPageId ?? selectedInspectTabIdRef.current, readRecorderJson, options.activate);
    if (generation !== inspectSessionGenerationRef.current || requestId !== inspectTabRequestRef.current || inspectSessionRef.current?.id !== targetSession.id) return tabs;
    setInspectTabs(tabs);
    selectedInspectTabIdRef.current = pageId;
    setSelectedInspectTabId(pageId);
    if (options.refreshPreview) setInspectPreviewRevision((current) => current + 1);
    return tabs;
  };

  const refreshInspectTabs = async () => {
    if (inspectLifecycleBusyRef.current) return;
    const generation = inspectSessionGenerationRef.current;
    inspectTabActionCountRef.current += 1;
    setIsRefreshingInspectTabs(true);
    try {
      const previousPageId = selectedInspectTabIdRef.current;
      const tabs = await loadInspectTabs(undefined, { activate: true, refreshPreview: true });
      if (previousPageId !== selectedInspectTabIdRef.current) setIsInspectingLiveField(false);
      if (generation === inspectSessionGenerationRef.current) setInspectMessage(tabs.length ? "" : "No browser tabs are available. Reopen the browser to continue.");
    } finally {
      inspectTabActionCountRef.current -= 1;
      setIsRefreshingInspectTabs(inspectTabActionCountRef.current > 0);
    }
  };

  const selectInspectTab = async (pageId: string) => {
    if (inspectLifecycleBusyRef.current) return;
    const generation = inspectSessionGenerationRef.current;
    inspectTabActionCountRef.current += 1;
    setIsRefreshingInspectTabs(true);
    try {
      if (isInspectingLiveField) await stopLiveInspect();
      await loadInspectTabs(undefined, { activate: true, selectedPageId: pageId, refreshPreview: true });
      if (generation === inspectSessionGenerationRef.current) setInspectMessage("");
    } finally {
      inspectTabActionCountRef.current -= 1;
      setIsRefreshingInspectTabs(inspectTabActionCountRef.current > 0);
    }
  };

  const launchInspectBrowser = async (requestedMode: InspectSessionMode = recommendedInspectMode, destination?: string) => {
    if (!canInspectRepository) throw new Error("Object repository management permission is required to inspect a browser.");
    if (inspectLifecycleBusyRef.current) return inspectSessionRef.current;
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
          if (tabs.length) { setInspectMessage(""); return currentSession; }
        } catch (error) {
          // A stopped, expired, or disconnected session must not prevent reopening.
          if (generation !== inspectSessionGenerationRef.current) throw error;
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
          signal: AbortSignal.timeout(90_000)
        });
        if (!session) throw new Error("The local agent did not return an inspection browser session.");
        connectedSession = connectLocalInspectSession(runtime, session);
      } else {
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
    } catch (error) {
      if (createdSession) await stopRepositoryInspectSession(createdSession, readRecorderJson).catch(() => null);
      if (generation === inspectSessionGenerationRef.current) {
        inspectSessionRef.current = null;
        setInspectRecorderSession(null);
        setInspectTabs([]);
        selectedInspectTabIdRef.current = "";
        setSelectedInspectTabId("");
        setIsInspectingLiveField(false);
      }
      throw error;
    } finally {
      inspectLifecycleBusyRef.current = false;
      setIsLaunchingInspectBrowser(false);
    }
  };

  const closeInspectBrowser = async () => {
    if (inspectLifecycleBusyRef.current) return;
    const targetSession = inspectSessionRef.current;
    if (!targetSession) return;
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
    } finally {
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
    if (highlightClearTimerRef.current) window.clearTimeout(highlightClearTimerRef.current);
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
    } catch (error) {
      reinspectFieldLocatorRef.current = "";
      setReinspectFieldLocator("");
      throw error;
    }
  };

  const stopLiveInspect = async () => {
    const targetSession = inspectSessionRef.current;
    const baseUrl = getRecorderEngineBaseUrl(targetSession);
    const pageId = selectedInspectTabIdRef.current || inspectTabs.find((tab) => tab.active)?.id || inspectTabs[0]?.id || "";
    setIsInspectingLiveField(false);
    if (!targetSession?.id || !baseUrl || !pageId) {
      setInspectMessage("Inspect selection paused.");
      return null;
    }
    const pendingResult = await readInspectSessionJson<RecorderInspectResult>(
      targetSession, `/inspect/result?page_id=${encodeURIComponent(pageId)}`
    ).catch(() => null);
    if (pendingResult) {
      await persistLiveInspectResult(pendingResult);
    }
    await readInspectSessionJson(targetSession, "/inspect/stop", {
      method: "POST",
      body: JSON.stringify({ page_id: pageId })
    }).catch(() => null);
    setInspectMessage(browserInspectFields.length
      ? "Inspect paused. Review captured fields under Candidates."
      : "Inspect paused. Start again when you want to capture more fields.");
    return pendingResult;
  };

  const highlightRepositoryLocator = async (
    locator: string,
    label: string,
    entryId = "",
    options: { retainExisting?: boolean; silent?: boolean } = {}
  ) => {
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
    if (highlightClearTimerRef.current) window.clearTimeout(highlightClearTimerRef.current);
    highlightClearTimerRef.current = window.setTimeout(() => setHighlightedInspectLocator(""), REPOSITORY_HIGHLIGHT_DURATION_MS);
    if (!options.silent) {
      setInspectMessage(`Highlighted ${label} in the selected browser tab for 1 second.`);
    }
  };

  const syncInspectHighlights = async (
    selectedFields: RepositoryExtractedField[],
    candidateFields: RepositoryExtractedField[] = browserInspectFields
  ) => {
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
    const highlights = [...candidateFields, ...selectedFields].filter((field, index, allFields) =>
      allFields.findIndex((item) => item.locator === field.locator) === index
    ).slice(-12);
    await Promise.all(highlights.map((field) => readInspectSessionJson(
      inspectRecorderSession, "/highlight",
      { method: "POST", body: JSON.stringify({ page_id: pageId, locator: field.locator, label: field.name, retain_existing: true }) }
    ).catch(() => null)));
    const latestHighlight = highlights[highlights.length - 1];
    if (latestHighlight) {
      setHighlightedInspectLocator(latestHighlight.locator);
      if (highlightClearTimerRef.current) window.clearTimeout(highlightClearTimerRef.current);
      highlightClearTimerRef.current = window.setTimeout(() => setHighlightedInspectLocator(""), REPOSITORY_HIGHLIGHT_DURATION_MS);
    }
  };

  const removeStagedInspectField = (locator: string) => {
    const next = stagedInspectFields.filter((field) => field.locator !== locator);
    setStagedInspectFields(next);
    stagedInspectFieldsRef.current = next;
    if (focusedInspectLocator === locator) setFocusedInspectLocator(next[next.length - 1]?.locator || browserInspectFields[browserInspectFields.length - 1]?.locator || "");
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
    const selectedLocatorSet = new Set(stagedInspectFields.map((field) => field.locator));
    const fieldsToSelect = browserInspectFields.filter((field) => !selectedLocatorSet.has(field.locator));
    const nextSelected = [
      ...stagedInspectFields,
      ...fieldsToSelect
    ].filter((field, index, fields) => fields.findIndex((item) => item.locator === field.locator) === index);
    setStagedInspectFields(nextSelected);
    stagedInspectFieldsRef.current = nextSelected;
    setFocusedInspectLocator(nextSelected[nextSelected.length - 1]?.locator || "");
    setBrowserInspectFields([]);
    setInspectMessage(`${fieldsToSelect.length} captured field${fieldsToSelect.length === 1 ? "" : "s"} moved to Selected fields.`);
    void syncInspectHighlights(nextSelected, []);
  };

  const dismissInspectField = (field: RepositoryExtractedField) => {
    const locator = field.locator;
    const nextCandidates = browserInspectFields.filter((candidate) => candidate.locator !== locator);
    setBrowserInspectFields(nextCandidates);
    setAiSuggestedInspectFields((current) => current.filter((candidate) => candidate.locator !== locator));
    setDismissedInspectLocators((current) => current.includes(locator) ? current : [...current, locator]);
    if (focusedInspectLocator === locator) setFocusedInspectLocator(stagedInspectFields[stagedInspectFields.length - 1]?.locator || nextCandidates[nextCandidates.length - 1]?.locator || "");
    setInspectMessage(`${field.name} hidden from this inspection. You can restore hidden suggestions from More actions.`);
    void syncInspectHighlights(stagedInspectFields, nextCandidates);
  };

  const restoreDismissedInspectFields = () => {
    const restoredCount = dismissedInspectLocators.length;
    setDismissedInspectLocators([]);
    setInspectMessage(`Restored ${restoredCount} hidden field suggestion${restoredCount === 1 ? "" : "s"}.`);
  };

  useEffect(() => {
    if (!isInspectOpen || inspectRecorderSession?.status !== "running" || !inspectRecorderSession.id) {
      return undefined;
    }

    let isCancelled = false;
    const refreshTabs = async () => {
      if (tabRefreshInFlightRef.current || inspectLifecycleBusyRef.current || inspectTabActionCountRef.current) return;
      tabRefreshInFlightRef.current = true;
      try {
        await loadInspectTabs();
      } catch (error) {
        if (!isCancelled) {
          setInspectMessage(error instanceof Error ? error.message : "Unable to load browser tabs.");
        }
      } finally {
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
      if (inspectPollInFlightRef.current) return;
      inspectPollInFlightRef.current = true;
      void (async () => {
        const query = selectedInspectTabId ? `?page_id=${encodeURIComponent(selectedInspectTabId)}` : "";
        const result = await readInspectSessionJson<RecorderInspectResult>(
          inspectRecorderSession, `/inspect/result${query}`
        ).catch((error) => {
          if (!cancelled && generation === inspectSessionGenerationRef.current) setInspectMessage(error instanceof Error ? error.message : "Unable to read inspect result.");
          return null;
          });

          if (result && !cancelled && generation === inspectSessionGenerationRef.current && inspectSessionRef.current?.id === inspectRecorderSession.id) {
            await persistLiveInspectResult(result);
          }
      })().finally(() => {
        inspectPollInFlightRef.current = false;
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      inspectPollInFlightRef.current = false;
    };
  }, [isInspectingLiveField, inspectRecorderSession, selectedInspectTabId]);

  useEffect(() => () => {
    ++inspectSessionGenerationRef.current;
    ++inspectTabRequestRef.current;
    const previous = inspectSessionRef.current;
    inspectSessionRef.current = null;
    if (previous?.status === "running") void stopRepositoryInspectSession(previous, readRecorderJson).catch(() => null);
    setInspectRecorderSession(null);
    setIsInspectOpen(false);
    setIsInspectingLiveField(false);
    setInspectTabs([]);
    setSelectedInspectTabId("");
    if (highlightClearTimerRef.current) window.clearTimeout(highlightClearTimerRef.current);
  }, [projectId, view, canInspectRepository, session?.user.id]);

  const batchAgentDialogRef = useDialogFocus<HTMLDivElement>({ active: isBatchAgentOpen, closeDisabled: scheduleAiAutomation.isPending, onClose: () => setIsBatchAgentOpen(false) });
  const automationPageHeader = view === "repository"
    ? {
        eyebrow: "Automation assets",
        title: "Object Repository",
        description: "Capture, review, and maintain reusable page objects and selectors for stable automated Test Cases."
      }
    : {
        eyebrow: "Automation",
        title: "Automation",
        description: "Build, record and run Web, API, Android and iOS tests with shared steps, test data and execution evidence."
      };

  return (
    <div className="page-content page-content--automation">
      <PageHeader
        className={view === "repository" ? "object-repository-page-header" : undefined}
        eyebrow={automationPageHeader.eyebrow}
        title={automationPageHeader.title}
        description={automationPageHeader.description}
        actions={view === "repository" && canInspectRepository ? <RepositoryAgentStatus connection={inspectAgent} /> : undefined}
        meta={[
          { label: "Automation cases", value: testCasesQuery.data ? automatedCases.length : "—" },
          { label: "Manual link candidates", value: testCasesQuery.data ? manualCases.length : "—" },
          { label: "Type unknown", value: testCasesQuery.data ? unknownAutomationCases.length : "—" },
          { label: "Repository objects", value: learningCacheQuery.data ? learningCache.length : "—" }
        ]}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      {view === "cases" ? (
        <WorkspaceMasterDetail
          className="automation-cases-master-detail"
          isDetailOpen={isAutomationCaseWorkspaceOpen}
          browseView={(
          <Panel
            title="Automation cases"
            subtitle="Create independent, executable automation cases and optionally link each one to its source manual case."
            actions={(
              <div className="design-list-toolbar catalog-command-toolbar automation-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Automation case views, search, and selection">
                  <CatalogViewToggle onChange={setAutomationCatalogViewMode} value={automationCatalogViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={activeAutomationCaseSearchCount}
                    ariaLabel="Search automation cases"
                    onChange={setAutomationCaseSearch}
                    placeholder="Search automation cases"
                    subtitle="Search automation cases by title, ID, state, priority, or recent run count."
                    title="Automation search"
                    type="search"
                    value={automationCaseSearch}
                  >
                    <div className="catalog-filter-grid">
                      <div className="catalog-filter-actions">
                        <button
                          className="ghost-button"
                          disabled={!automationCaseSearch.trim()}
                          onClick={() => setAutomationCaseSearch("")}
                          type="button"
                        >
                          Clear search
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={areAllFilteredAutomationCasesSelected}
                    canSelectAll={Boolean(filteredAutomationCases.length)}
                    onClear={() => setSelectedAutomationCaseIds([])}
                    onSelectAll={() =>
                      setSelectedAutomationCaseIds((current) => [...new Set([...current, ...filteredAutomationCases.map((testCase) => testCase.id)])])
                    }
                    selectedCount={selectedAutomationCaseIds.length}
                  />
                </div>
                <div className="catalog-toolbar-actions" aria-label="Automation case actions">
                  {canUseAutomationAi ? (<button className="ghost-button automation-ai-catalog-action" disabled={!automationActionTargetIds.length || !appTypeId || !canUseAutomationBuilder || !canUseAutomationAi || scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(true)} title="Review the agent brief, then build now or choose a scheduled time" type="button"><SparkIcon /><span>Build with automation agent</span></button>) : null}
                  {canRunLocalAutomation ? (<button
                    className="ghost-button catalog-run-button"
                    disabled={(!selectedAutomationCaseIds.length && !activeAutomatedCase) || !canRunLocalAutomation || !projectId || !appTypeId || runSelectedAutomationCases.isPending}
                    onClick={() => runSelectedAutomationCases.mutate("local")}
                    title={!selectedAutomationCaseIds.length && !activeAutomatedCase ? "Select an automation case to run" : "Run selected automation locally"}
                    type="button"
                  >
                    <PlayIcon />
                    <span>Run local</span>
                  </button>) : null}
                  {canRunRemoteAutomation ? (<button
                    className="ghost-button catalog-run-button"
                    disabled={(!selectedAutomationCaseIds.length && !activeAutomatedCase) || !canRunRemoteAutomation || !projectId || !appTypeId || runSelectedAutomationCases.isPending}
                    onClick={() => runSelectedAutomationCases.mutate("remote")}
                    title={!selectedAutomationCaseIds.length && !activeAutomatedCase ? "Select an automation case to run" : "Run selected automation remotely"}
                    type="button"
                  >
                    <OpenIcon />
                    <span>Run remote</span>
                  </button>) : null}
                  {canCreateAutomationDraft ? <button className="primary-button automation-choose-manual-toolbar-button" disabled={!appTypeId} onClick={() => setIsCreateAutomationOpen(true)} type="button">
                    <AddIcon />
                    <span>Create automation case</span>
                  </button> : null}
                </div>
              </div>
            )}
          >
            {testCasesQuery.isLoading || executionResultsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {testCasesQuery.isError ? <div className="workspace-access-state" role="alert"><h2>Automation cases couldn’t be loaded</h2><p>Retry to restore your cases and their current state.</p><button className="ghost-button" type="button" onClick={() => void testCasesQuery.refetch()}>Retry</button></div> : null}
            {testCasesQuery.isSuccess && !automatedCases.length ? (
              <section className="automation-start-guide">
                <div><span className="eyebrow">Build your first automation</span><h2>Start with a behavior worth protecting.</h2><p>Bring a manual case or describe the flow. Review the generated steps and objects before your first run.</p></div>
                <div className="automation-start-options">
                  <article><span className="automation-start-number">01</span><h3>Define the behavior</h3><p>Use an existing case, record a browser flow or author steps in the editor.</p>{canCreateAutomationDraft ? <button className="primary-button" disabled={!appTypeId} type="button" onClick={() => setIsCreateAutomationOpen(true)}>Create automation case <span aria-hidden="true">→</span></button> : null}{!canCreateAutomationDraft ? <small>Automation authoring and Test Case creation permissions are required.</small> : !appTypeId ? <small>Select an application to begin.</small> : null}</article>
                  <article><span className="automation-start-number">02</span><h3>Build reusable objects</h3><p>Generate locator candidates from source and review them in the object repository.</p>{hasPermission(session, "agentic_workflow.view", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) ? <button className="ghost-button" type="button" onClick={() => navigate("/agentic-workflows?view=agents")}>Explore source agents <span aria-hidden="true">→</span></button> : <small>Source agents need agent access and the Agents feature.</small>}</article>
                  <article><span className="automation-start-number">03</span><h3>Run with evidence</h3><p>Choose an environment and configuration, then capture outcomes, logs and attachments.</p><small>Run actions become available after you select an automation case.</small></article>
                </div>
              </section>
            ) : null}
            {!testCasesQuery.isLoading && automatedCases.length ? (
              <TileBrowserPane className="automation-case-tile-browser" scrollKey={`automation-cases:${projectId}:${appTypeId}`}>
                {automationCatalogViewMode === "tile" && filteredAutomationCases.length ? (
                  <div className="tile-browser-grid">
                    {filteredAutomationCases.map((testCase) => {
                    const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                    const latest = history[0];
                    const passedRuns = history.filter((result) => result.status === "passed").length;
                    const passRate = history.length ? Math.round((passedRuns / history.length) * 100) : 0;
                    const isActive = selectedCaseId === testCase.id;
                    return (
                      <div
                        aria-pressed={isActive}
                        className={["record-card tile-card test-case-card test-case-catalog-card automation-case-tile", isActive ? "is-active" : ""].filter(Boolean).join(" ")}
                        key={testCase.id}
                        onClick={() => {
                          selectAutomationCase(testCase.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectAutomationCase(testCase.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row test-case-card-header">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select ${testCase.title}`}
                                checked={selectedAutomationCaseIds.includes(testCase.id)}
                                onChange={(event) =>
                                  setSelectedAutomationCaseIds((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, testCase.id])]
                                      : current.filter((testCaseId) => testCaseId !== testCase.id)
                                  )
                                }
                                type="checkbox"
                              />
                              <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id} />
                            </label>
                            <div className="catalog-inline-actions test-case-top-actions">
                              <StatusBadge value="automated" />
                              <StatusBadge value={testCase.automation_status || "ready"} />
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
                          <CatalogCardDescription
                            fallback="Automation is mapped to the original manual case definition."
                            profile="test-case"
                            value={testCase.description}
                          />
                          <div className="tile-card-facts">
                            <TileCardFact label={testCase.automation_status === "incomplete" ? "Incomplete" : "Ready"} title="Automation state" tone={testCase.automation_status === "incomplete" ? "neutral" : "success"}><SparkIcon /></TileCardFact>
                            <TileCardFact label={`${history.length} runs`} title="Recent run history" tone={history.length ? "info" : "neutral"}><TileCardRunsIcon /></TileCardFact>
                            <TileCardFact label={`P${testCase.priority || 3}`} title="Priority"><TileCardStepsIcon /></TileCardFact>
                          </div>
                          <div className="tile-card-footer">
                            <TileCardProgress
                              breakdown={buildHistoryStatusBreakdown(history)}
                              displayValue={history.length ? `${passRate}%` : "No runs"}
                              label="Recent pass rate"
                              title={history.length ? `${passedRuns} of ${history.length} recent run outcomes passed` : "No recent run outcomes"}
                              value={history.length ? passRate : null}
                            />
                          </div>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                ) : null}
                {automationCatalogViewMode === "list" ? (
                  <DataTable
                    columns={automationCaseListColumns}
                    enableColumnResize
                    enableHeaderColumnReorder
                    emptyMessage="No automation cases match the current search."
                    getRowClassName={(testCase) => (selectedCaseId === testCase.id ? "is-active-row" : "")}
                    getRowKey={(testCase) => testCase.id}
                    hideToolbarCopy
                    onRowClick={(testCase) => selectAutomationCase(testCase.id)}
                    renderRowActions={(testCase) => (
                      <CatalogActionMenu
                        actions={[
                          {
                            label: "Open automation case",
                            description: "Open this case in the automation workspace.",
                            icon: <OpenIcon size={15} />,
                            onClick: () => selectAutomationCase(testCase.id)
                          }
                        ]}
                        label={`${testCase.title} actions`}
                      />
                    )}
                    rows={filteredAutomationCases}
                    storageKey="hellotest:automation-cases:list-columns"
                  />
                ) : null}
                {automationCatalogViewMode === "tile" && !filteredAutomationCases.length ? (
                  <div className="empty-state compact">No automation cases match the current search.</div>
                ) : null}
              </TileBrowserPane>
            ) : null}
          </Panel>
          )}
          detailView={(
          <Panel
            title="Automation case workspace"
            subtitle={activeCase
              ? "Switch between case details and keyword step editing without losing the selected context."
              : selectedCaseSummary
                ? `Loading complete details for ${selectedCaseSummary.title}.`
                : "Select an automation case."}
            actions={selectedCaseId ? (
              <div className="testops-action-row">
                <WorkspaceBackButton label="Back to automation case tiles" onClick={closeAutomationCaseWorkspace} />
                {activeCase ? (
                  <>
	                  {canRunLocalAutomation ? (<button className="primary-button" disabled={!isAutomationCaseDetailReady || !canRunLocalAutomation || runCase.isPending || activeCase.automated !== "yes" || automationCaseMappingStatus(automatedSteps) !== "ready"} onClick={() => runCase.mutate({ testCase: activeCase })} type="button">
	                    <PlayIcon />
	                    <span>{runCase.isPending ? "Starting..." : "Run automated"}</span>
	                  </button>) : null}
	                  {canUseAutomationAi ? (<button className="ghost-button" disabled={!isAutomationCaseDetailReady || !canUseAutomationAi || optimizeAutomationCase.isPending} onClick={() => { setBuildMethod("agent"); setActiveAutomationWorkspaceTab("build"); }} type="button">
                      <SparkIcon />
                      <span>Build with automation agent</span>
                    </button>) : null}
                  </>
                ) : null}
              </div>
            ) : undefined}
          >
            {!selectedCaseId ? (
              <div className="empty-state compact">Select a case tile to inspect its automation detail.</div>
            ) : isAutomationCaseDetailPending ? (
              <LoadingState
                description="Retrieving complete metadata before enabling edits, test data, PDF export, and AI actions."
                label="Loading automation case details"
              />
            ) : !activeCase ? (
              <div className="empty-state compact">
                <div>Complete automation case details could not be loaded safely.</div>
                <button className="primary-button" onClick={() => void selectedAutomationCaseDetailQuery.refetch()} type="button">Retry details</button>
              </div>
            ) : automatedStepsQuery.isLoading ? (
              <TileCardSkeletonGrid />
            ) : (
              <div className="automation-case-detail editor-accordion">
                <AutomationRuntimeGuide steps={automatedSteps} fallback={selectedRuntimeType} />
                <div className="automation-workspace-navigation">
                  <div className="automation-workspace-identity">
                    <div>
                      <DisplayIdBadge value={automationDisplayIdByCaseId[activeCase.id] || activeCase.display_id || activeCase.id} />
                      <span className="automation-step-type-chip">Automation Case</span>
                    </div>
                    <strong>{activeCase.title}</strong>
                    <span>{automatedSteps.filter(isAutomationStepMapped).length}/{automatedSteps.length} steps mapped · {selectedExecutionIterationCount} data iteration{selectedExecutionIterationCount === 1 ? "" : "s"}</span>
                  </div>
                  <DetailSectionTabs
                    activeTab={activeAutomationWorkspaceTab}
                    ariaLabel="Automation case sections"
                    className="automation-detail-navigation"
                    items={[
                      { value: "details", label: "Details", description: "Metadata & links", icon: <PencilIcon /> },
                      { value: "steps", label: "Plan", description: "Actions & results", icon: <SelectionToggleIcon checked={false} />, count: automatedSteps.length },
                      { value: "data", label: "Test Data", description: "Params & profiles", icon: <TileCardStepsIcon />, count: automationDataTokens.length },
                      { value: "hooks", label: "Before / After", description: "Setup & teardown", icon: <LayersIcon />, count: executionHookDraft.length },
                      ...(canUseAutomationAi || canRecordCurrentPlan ? [{ value: "build" as const, label: "Build tools", description: "Agent & recorder", icon: <SparkIcon /> }] : []),
                      ...(canViewObjectRepository ? [{ value: "repository" as const, label: "Objects", description: "Repository bindings", icon: <IconTargetArrow />, count: caseObjectMembers.length }] : []),
                      { value: "runs", label: "Runs", description: "History & debug", icon: <PlayIcon />, count: activeCaseHistory.length }
                    ]}
                    onChange={selectAutomationWorkspaceTab}
                  />
                </div>
                {activeAutomationWorkspaceTab === "details" ? (
                  <section className="automation-plan-workspace" aria-label="Automation case details">
                    <AutomationCaseMetadata
                      {...metadataOptions}
                      disabled={!canUpdateAutomationCase || updateAutomationCase.isPending}
                      value={{ title: caseDraft.title, description: caseDraft.description, status: caseDraft.status, priority: caseDraft.priority, manualCaseIds: automationManualLinkDraftIds, requirementIds: caseRequirementIds, moduleIds: caseModuleIds, suiteIds: suiteLinkDraftIds, dataSetId: caseDataSetId }}
                      onChange={(change) => {
                        setCaseDraft((current) => ({ ...current, ...Object.fromEntries(Object.entries(change).filter(([key]) => ["title", "description", "status", "priority"].includes(key))) }));
                        if (change.manualCaseIds) setAutomationManualLinkDraftIds(change.manualCaseIds);
                        if (change.requirementIds) setCaseRequirementIds(change.requirementIds);
                        if (change.moduleIds) setCaseModuleIds(change.moduleIds);
                        if (change.suiteIds) setSuiteLinkDraftIds(change.suiteIds);
                        if (change.dataSetId !== undefined) setCaseDataSetId(change.dataSetId);
                      }}
                    />
                    <div className="automation-plan-actions">
                      {canUpdateAutomationCase ? (<button className="primary-button" disabled={!caseDraft.title.trim() || updateAutomationCase.isPending} onClick={() => updateAutomationCase.mutate()} type="button">{updateAutomationCase.isPending ? "Saving…" : "Save details"}</button>) : null}
                      {linkedManualCases.map((source) => <button className="ghost-button compact" key={source.id} onClick={() => openLinkedManualCase(activeCase, source.id)} type="button"><OpenIcon size={14} />{source.display_id || source.title}</button>)}
                      <button className="ghost-button compact" onClick={exportAutomationCasePdf} type="button">Export PDF</button>
                      {canRemoveAutomationCase ? (<button className="ghost-button compact danger" disabled={deleteAutomationCase.isPending} onClick={() => deleteAutomationCase.mutate(activeCase)} type="button">Remove automation case</button>) : null}
                    </div>
                  </section>
                ) : null}
                {(["data", "hooks"] as AutomationWorkspaceTab[]).includes(activeAutomationWorkspaceTab) ? (
                <AutomationAccordionSection
                  countLabel={activeAutomationWorkspaceTab === "data" ? `${automationDataTokens.length} token${automationDataTokens.length === 1 ? "" : "s"}` : activeAutomationWorkspaceTab === "hooks" ? `${executionHookDraft.length} hook${executionHookDraft.length === 1 ? "" : "s"}` : automationDisplayIdByCaseId[activeCase.id] || activeCase.display_id || "AT"}
                  isExpanded={expandedCaseSections.case}
                  onToggle={() => toggleCaseSection("case")}
	                  stage="case"
	                  summary={activeAutomationWorkspaceTab === "data" ? "Case, suite, run, and linked data-set values used by executable actions." : activeAutomationWorkspaceTab === "hooks" ? "Setup and teardown for the next run. These selections are saved with the run and retained when it is rerun." : "Identity, ownership, status, and manual coverage for this independent automation case."}
	                  title={activeAutomationWorkspaceTab === "data" ? "Test Data & run profile" : activeAutomationWorkspaceTab === "hooks" ? "Before / After hooks" : "Automation case details"}
	                >
	                  <div className="automation-description-panel">
	                    {activeAutomationWorkspaceTab === "details" ? (
	                    <>
	                    <div className="automation-manual-summary-grid">
	                      <button className="automation-linked-manual-card automation-linked-manual-card--button" disabled={!linkedManualCases.length} onClick={() => openLinkedManualCase(activeCase)} type="button">
	                        <strong>{linkedManualCases.length ? `Linked manual test cases · ${linkedManualCases.length}` : "Standalone automation"}</strong>
	                        <span>{linkedManualCase?.display_id || activeCase.display_id || activeCase.id} · {linkedManualCase?.title || "Use the relationship hub to add coverage links"}</span>
	                      </button>
	                      <div className="automation-manual-meta-grid" aria-label="Manual test case metadata carried into automation">
	                        <div><span>Status</span><strong>{activeCase.status || "active"}</strong></div>
	                        <div><span>Priority</span><strong>P{activeCase.priority || 3}</strong></div>
	                        <div><span>Automation</span><strong>{activeCase.automation_status || "ready"}</strong></div>
	                        <div><span>Suites</span><strong>{activeCaseSuiteIds.length || "None"}</strong></div>
	                        <div><span>Story</span><strong>{activeCase.requirement_id || "Not linked"}</strong></div>
	                        <div><span>Updated</span><strong>{activeCase.updated_at ? formatRunDate.format(new Date(activeCase.updated_at)) : "Not recorded"}</strong></div>
	                      </div>
	                    </div>
	                    <div className="automation-case-editor-grid automation-case-editor-grid--metadata">
	                      <label className="form-field">
	                        <span>Automation case name</span>
	                        <input value={caseDraft.title} onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))} />
	                      </label>
	                      <label className="form-field form-field--compact-enum">
	                        <span>Status</span>
	                        <input value={caseDraft.status} onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))} />
	                      </label>
	                      <label className="form-field form-field--compact-enum form-field--compact-number">
	                        <span>Priority</span>
	                        <input min={1} max={5} type="number" value={caseDraft.priority} onChange={(event) => setCaseDraft((current) => ({ ...current, priority: event.target.value }))} />
	                      </label>
	                    </div>
	                    <label className="form-field">
	                      <span>Description</span>
	                      <RichTextEditor appearance="canonical" rows={3} value={caseDraft.description} onChange={(description) => setCaseDraft((current) => ({ ...current, description }))} />
	                    </label>
	                    </>
	                    ) : null}
	                    {activeAutomationWorkspaceTab === "data" ? (
	                    <>
	                    <section className="automation-run-profile-panel" aria-label="Automation execution profile">
	                      <div className="automation-section-heading">
	                        <div><strong>Execution profile</strong><span>Choose the environment, configuration, and data-set iteration used when this case runs.</span></div>
	                      </div>
	                      <ExecutionContextSelector
	                        appTypeId={appTypeId}
	                        onConfigurationChange={setSelectedExecutionConfigurationId}
	                        onDataSetChange={setSelectedExecutionDataSetId}
	                        onEnvironmentChange={setSelectedExecutionEnvironmentId}
	                        projectId={projectId}
	                        selectedConfigurationId={selectedExecutionConfigurationId}
	                        selectedDataSetId={selectedExecutionDataSetId}
	                        selectedEnvironmentId={selectedExecutionEnvironmentId}
	                      />
	                    </section>
	                    <section className="automation-test-data-panel step-parameter-list" aria-label="Automation test data inherited from manual case">
	                      <div className="automation-section-heading">
	                        <div>
	                          <strong>Test data</strong>
	                        <span>Scoped automation data. @t belongs to this case, @s comes from suites, and @r is supplied by the run.</span>
	                        </div>
	                        <button className="ghost-button compact" disabled={!isAutomationCaseDetailReady} onClick={() => setIsParameterDialogOpen(true)} type="button">
	                          <SparkIcon />
	                          <span>{detectedStepParameters.length ? `Edit ${detectedStepParameters.length}` : "Edit test data"}</span>
	                        </button>
	                      </div>
	                      {inlineTestDataGroups.length ? inlineTestDataGroups.map((group) => (
	                        <section className="step-parameter-group automation-inline-parameter-group" key={group.scope}>
	                          <div className="step-parameter-group-head">
	                            <strong>{group.title}</strong>
	                            <span>{group.rows.length} item{group.rows.length === 1 ? "" : "s"}</span>
	                          </div>
	                          {group.rows.map((row) => (
	                            <div className="step-parameter-row" key={row.name}>
	                              <label className="form-field">
	                                <span>{row.token}</span>
	                                <div className="step-parameter-input-row">
	                                  <input
	                                    disabled={row.locked}
	                                    placeholder={row.locked ? "Supplied when the run starts" : `Value for ${row.token}`}
	                                    value={row.locked ? "" : row.value}
	                                    onChange={(event) => handleParameterValueChange(row.name, event.target.value)}
	                                  />
	                                </div>
	                              </label>
	                            </div>
	                          ))}
	                        </section>
	                      )) : (
	                        <div className="empty-state compact">No test data references detected yet. Add @t, @s, or @r tokens in manual steps or automation keywords.</div>
	                      )}
	                    </section>
	                    </>
	                    ) : null}
	                    {activeAutomationWorkspaceTab === "hooks" ? (
	                    <section className="automation-run-hooks-panel">
                          <p className="muted">For the next run: choose setup and teardown cases below. These selections apply when you start a run from this workspace.</p>
	                      <RunHooksBuilder
	                        onChange={setExecutionHookDraft}
	                        suites={suites}
	                        testCases={testCases}
	                        value={executionHookDraft}
	                      />
	                    </section>
	                    ) : null}
	                    {activeAutomationWorkspaceTab === "data" ? (
	                    <div className="automation-suite-link-panel">
                      <strong>Linked Suites</strong>
                      <span>@s values are saved against the selected linked suite, matching the manual test case workspace.</span>
                      {suites.length ? (
                        <div className="selection-chip-row">
                          {suites.map((suite: TestSuite) => {
                            const isLinked = suiteLinkDraftIds.includes(suite.id);
                            return (
                              <button
                                className={isLinked ? "selection-chip is-selected" : "selection-chip is-unselected"}
                                key={suite.id}
                                onClick={() => {
                                  setSuiteLinkDraftIds((current) =>
                                    current.includes(suite.id) ? current.filter((id) => id !== suite.id) : [...current, suite.id]
                                  );
                                  if (!selectedParameterSuiteId) {
                                    setSelectedParameterSuiteId(suite.id);
                                  }
                                }}
                                type="button"
                              >
                                {suite.name}
                              </button>
                            );
                          })}
                        </div>
	                      ) : <div className="empty-state compact">No suites exist for this app type yet.</div>}
	                    </div>
	                    ) : null}
		                    <div className="testops-action-row">
		                      {activeAutomationWorkspaceTab === "data" && canUpdateAutomationCase ? (<button className="primary-button" disabled={!isAutomationCaseDetailReady || updateAutomationCase.isPending} onClick={() => updateAutomationCase.mutate()} type="button">
		                        <span>{updateAutomationCase.isPending ? "Saving..." : "Save automation case"}</span>
		                      </button>) : null}
                      {canViewAutomationCode ? (
                        <button className="ghost-button" disabled={!isAutomationCaseDetailReady} onClick={exportAutomationCasePdf} type="button">
                          <ExportIcon size={16} />
                          <span>Export PDF</span>
                        </button>
                      ) : null}
	                      {activeAutomationWorkspaceTab === "details" && canRemoveAutomationCase ? <button className="ghost-button danger" disabled={deleteAutomationCase.isPending} onClick={() => deleteAutomationCase.mutate(activeCase)} type="button">
	                        <TrashIcon size={16} />
	                        <span>{deleteAutomationCase.isPending ? "Deleting..." : "Delete automation case"}</span>
                      </button> : null}
                    </div>
                  </div>
                </AutomationAccordionSection>
                ) : null}

                {activeAutomationWorkspaceTab === "build" && (canUseAutomationAi || canRecordCurrentPlan) ? (
                  <section className="automation-agent-workspace" aria-label="Automation build tools">
                    <header><h3>Build your automation</h3><p>Start from your test cases, record a flow, or author instructions and code in the plan.</p></header>
                    {canUseAutomationAi && hasPermission(session, "agentic_workflow.run", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) && <AiLifecycleReview projectId={projectId} appTypeId={appTypeId} inputs={{ test_case_id: activeCase.id }} features={["automation-repair"]} title="AI Automation Repair" />}
                    <div className="automation-build-methods" aria-label="Build method">
                      {canUseAutomationAi ? <button aria-pressed={buildMethod === "agent"} onClick={() => setBuildMethod("agent")} type="button"><SparkIcon size={15} />Build with automation agent</button> : null}
                      {canRecordCurrentPlan ? <button aria-pressed={buildMethod === "record"} onClick={() => setBuildMethod("record")} type="button"><MousePointerIcon size={15} />Record & playback{recorderSession?.status === "running" ? " · Recording" : ""}</button> : null}
                    </div>
                    {buildMethod === "agent" && canUseAutomationAi ? <div className="automation-agent-brief">
                      <AutomationBuildContext stepCount={automatedSteps.length} expectedResultCount={automatedSteps.filter((step) => richTextToPlainText(step.expected_result || "").trim()).length} manualCaseCount={linkedManualCases.length} repositoryCount={allObjectMembers.length} runtimes={automationRuntimeTypes} />
                      <label className="form-field"><span>Build instructions (optional)</span><textarea onChange={(event) => setAgentMission(event.target.value)} placeholder="The agent uses the saved actions and expected results. Add priorities or constraints here." rows={4} value={agentMission} /></label>
                      <div className="automation-plan-behavior-fields">
                        {automationRuntimeTypes.some((type) => type === "web" || type === "api") ? <label className="form-field"><span>Start URL</span><input aria-label="Agent start URL" type="url" onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com" value={startUrl} /><small>Enter a literal URL, or leave blank to use the selected environment.</small></label> : <p className="muted">Select the device, app and Appium connection in execution context below.</p>}
                        <label className="form-field"><span>Build time</span><input aria-label="Schedule agent build" min={new Date().toLocaleString("sv-SE").slice(0,16).replace(" ", "T")} onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt} /><small className="muted">Leave empty to queue now.</small></label>
                      </div>
                      <details><summary>Additional guidance & execution context</summary><div className="stack-list">
                        <label className="form-field"><span>Additional guidance</span><textarea rows={3} onChange={(event) => setBuilderContext(event.target.value)} value={builderContext} placeholder="Authentication, edge cases, and constraints" /></label>{automationRuntimeTypes.includes("web") ? <label className="repository-field-check"><input type="checkbox" checked={allowBrowserActions} onChange={(event) => setAllowBrowserActions(event.target.checked)} /><span>Allow the automation agent to interact with this application while building (may submit forms)</span></label> : null}
                        <ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId} />
                      </div></details>
                      <p className="muted">{automationRuntimeTypes.map((type) => AUTOMATION_RUNTIMES[type].agent).join(" ")}</p>
                      {!automatedSteps.length ? <p className="muted">Add the actions and expected results to the plan before starting the agent.</p> : null}
                      <div className="automation-plan-actions">{canUseAutomationAi ? (<button className="primary-button" disabled={!canUseAutomationAi || !automatedSteps.length || buildSingleAutomation.isPending} onClick={() => buildSingleAutomation.mutate()} type="button"><SparkIcon size={15} />{buildSingleAutomation.isPending ? "Queueing…" : agentScheduledAt ? "Schedule build" : "Build step plan"}</button>) : null}<button className="ghost-button" onClick={() => selectAutomationWorkspaceTab("steps")} type="button">Open plan</button></div>
                      {agentBuildReceipt ? <div className="automation-agent-result" role="status"><span>{agentBuildReceipt}</span><button className="ghost-button compact" onClick={() => navigate("/testops")} type="button">View build jobs</button><button className="ghost-button compact" onClick={() => { invalidateAutomationData(); selectAutomationWorkspaceTab("steps"); }} type="button">View step plan</button></div> : null}
                    </div> : <div className="automation-agent-brief">
                      <div><strong>Record a flow</strong><p className="muted">Capture browser or mobile actions, then inspect their keywords, repository fields, and data in the plan.</p></div>
                      <div className="automation-plan-behavior-fields">
                        {recorderPlatform === "web" || recorderPlatform === "unified" ? <label className="form-field"><span>Start URL</span><input disabled={Boolean(recorderSession)} onChange={(event) => setStartUrl(event.target.value)} placeholder="Uses the selected environment when blank" value={startUrl} /></label> : <p className="muted">The selected configuration supplies the device and app for this recording.</p>}
                        <label className="form-field"><span>Save recording to</span><select disabled={Boolean(recorderSession)} onChange={(event) => setRecordingTargetStepId(event.target.value)} value={recordingTargetStepId}><option value="">Complete step plan</option>{automatedSteps.map((step) => <option key={step.id} value={step.id}>{step.step_order}. {richTextToPlainText(step.action || "Untitled step")}</option>)}</select></label>
                      </div>
                      <details><summary>Recording environment & data</summary><ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId} /></details>
                      <RecorderStartControls platform={recorderPlatform} disabled={!canRecordCurrentPlan || !activeCase} hasSession={Boolean(recorderSession)} isStarting={startRecorder.isPending} mobileAppiumEnabled={canUseMobileAppium} mobileRemoteEnabled={mobileRemoteRecorderEnabled} onStart={(options) => startRecorder.mutate(options)} primaryAction={recorderSession ? <button className="primary-button recorder-stop-button" disabled={finishRecorder.isPending} onClick={() => finishRecorder.mutate()} type="button"><PauseIcon />{finishRecorder.isPending ? "Saving recording…" : "Save recording to plan"}</button> : undefined} moreActions={recorderSession?.live_view_url ? <a className="ghost-button compact" href={recorderSession.live_view_url} rel="noreferrer" target="_blank"><OpenIcon size={14} />Open live view</a> : undefined} />
                      {recorderSession?.live_view_url ? <iframe allow="clipboard-read; clipboard-write" className="recorder-live-frame" src={recorderSession.live_view_url} title="HelloTest automation recorder" /> : null}
                      <RecorderSessionInsights session={recorderSession} />
                      <div className="automation-plan-actions"><button className="ghost-button" onClick={() => selectAutomationWorkspaceTab("steps")} type="button">Review step plan</button>{canRunLocalAutomation ? (<button className="primary-button" disabled={!canRunLocalAutomation || Boolean(recorderSession) || !automatedSteps.length || automationCaseMappingStatus(automatedSteps) !== "ready" || runCase.isPending} onClick={() => runCase.mutate({ testCase: activeCase })} type="button"><PlayIcon />{runCase.isPending ? "Starting playback…" : "Play saved plan"}</button>) : null}</div>
                    </div>}
                  </section>
                ) : null}
                {activeAutomationWorkspaceTab === "steps" ? (
                  <section className="automation-plan-workspace automation-program-workspace" aria-label="Automation step plan">
                    <div className="automation-plan-heading"><div><h3>Implementation</h3><span>{automatedSteps.length} {automatedSteps.length === 1 ? "section" : "sections"} · {automatedSteps.filter(isAutomationStepMapped).length} ready</span></div><div className="automation-plan-actions">
                      <div className="automation-build-methods"><button aria-pressed={automationStepView === "keyword"} onClick={() => setAutomationStepView("keyword")} type="button">Instructions</button>{canViewAutomationCode ? (<button aria-pressed={automationStepView === "code"} disabled={!canViewAutomationCode} onClick={() => setAutomationStepView("code")} type="button">Source</button>) : null}</div>
                      {canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={() => setIsSharedGroupLibraryOpen(true)} type="button"><LayersIcon size={14} />Shared Step Group</button>) : null}
                      <button className="ghost-button compact" onClick={() => setIsParameterDialogOpen(true)} type="button">Parameters</button>{canViewAutomationCode ? (<button className="ghost-button compact" disabled={!canViewAutomationCode || !automatedSteps.length} onClick={() => setIsAutomationCodePreviewOpen(true)} type="button">Full source</button>) : null}
                    </div></div>
                    {linkedManualCases.length ? <div className="automation-program-origin"><span>Linked test cases</span>{linkedManualCases.map((item) => <span key={item.id}>{item.display_id || item.id} · {item.title}</span>)}</div> : null}
                    {selectedAutomationStepIds.length ? <div className="automation-program-selection">
                      <div className="automation-plan-heading"><strong>{selectedAutomationStepIds.length} selected</strong><button className="ghost-button compact" onClick={() => setSelectedAutomationStepIds([])} type="button">Clear selection</button></div>
                      <label className="form-field"><span>Group name</span><input onChange={(event) => setAutomationGroupName(event.target.value)} value={automationGroupName} placeholder="e.g. Sign in" /></label>
                      <label className="checkbox-field"><input checked={saveAutomationGroupAsShared} onChange={(event) => setSaveAutomationGroupAsShared(event.target.checked)} type="checkbox" />Save as reusable Shared Step Group</label>
                      {canEditAutomationCode ? (<button className="primary-button compact" disabled={!canEditAutomationCode || selectedAutomationStepIds.length < 2 || groupAutomationSteps.isPending} onClick={() => groupAutomationSteps.mutate()} type="button">Group selected steps</button>) : null}
                    </div> : null}
                    {automatedStepsQuery.isError ? <div className="empty-state compact" role="alert">Unable to load the plan.<button className="ghost-button" onClick={() => void automatedStepsQuery.refetch()} type="button">Retry</button></div> : null}
                    {automationStepView === "code" && canViewAutomationCode ? <details className="automation-agent-brief"><summary>Complete automation code</summary><pre className="automation-code-block automation-code-block--complete">{completeAutomationCode}</pre><button className="ghost-button compact" onClick={() => navigator.clipboard?.writeText(completeAutomationCode)} type="button">Copy code</button></details> : null}
                    {[true, false].map((precondition) => <section className="automation-program-flow" key={String(precondition)} aria-label={precondition ? "Preconditions" : "Test steps"}>
                      <div className="automation-plan-heading"><h3>{precondition ? "Preconditions" : "Steps"}</h3>{canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={() => { setNewStepIsPrecondition(precondition); setNewStepPlacement({ mode: "end", stepId: "" }); document.getElementById("automation-new-step-composer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} type="button"><AddIcon size={14} />{precondition ? "Add precondition" : "Add section"}</button>) : null}</div>
                      {!automatedSteps.some((step) => isAutomationPrecondition(step) === precondition) ? <p className="muted">{precondition ? "No preconditions." : "Add a named section, insert a Shared Step Group, or record a flow."}</p> : null}
                      {automationStepGroups.filter((group) => isAutomationPrecondition(group.steps[0]) === precondition).map((group) => {
                        const rows = group.steps.map((step) => {
                          const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
                          const options = stepOptionDrafts[step.id] || parseAutomationStepOptions(step);
                          const expanded = expandedAutomationStepIds.includes(step.id);
                          const spec = getAutomationKeywordInputSpec(draft.keyword, draft.step_type);
                          const sourceCode = stepCodeDrafts[step.id] ?? step.automation_code ?? "";
                          const savedDraft = parseAutomationStepDraft(step);
                          const programNeedsEditor = resolveAutomationMappingSave({ currentCode: sourceCode, previousMappingCode: buildAutomationCodeFromDraft(savedDraft), nextMappingCode: sourceCode, mappingUnchanged: false }).requiresProgramEditor;
                          const hasChanges = JSON.stringify(draft) !== JSON.stringify(savedDraft) || sourceCode !== (step.automation_code || "") || JSON.stringify(options) !== JSON.stringify(parseAutomationStepOptions(step));
                          const sectionName = richTextToPlainText(draft.name || step.action || "Untitled section");
                          const openInstructionEditor = () => {
                            const mappingUnchanged = automationMappingFieldsEqual(draft, savedDraft);
                            const editorStep = buildAutomationEditorStep({
                              step, draft, currentCode: sourceCode,
                              previousMappingCode: buildAutomationCodeFromDraft(savedDraft),
                              nextMappingCode: automationMappingIsComplete(draft) ? buildAutomationCodeFromDraft(draft) : "",
                              mappingUnchanged,
                              apiRequest: mappingUnchanged ? step.api_request : buildAutomationApiRequest(draft, step.api_request)
                            });
                            const optionsChanged = JSON.stringify(options) !== JSON.stringify(parseAutomationStepOptions(step));
                            if (editorStep.automation_code?.trim() && (editorStep.automation_code !== sourceCode || optionsChanged)) {
                              editorStep.automation_code = applyAutomationStepOptions(editorStep.automation_code, options);
                            }
                            setAutomationStudioStep(editorStep);
                          };
                          const updateDraft = (change: Partial<AutomationStepDraft>) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, ...change } }));
                          return <article className={`automation-plan-row automation-program-section${expanded ? " is-editing" : ""}`} key={step.id}>
                            <div className="automation-plan-summary">
                              <input aria-label={`Select step ${step.step_order}`} checked={selectedAutomationStepIds.includes(step.id)} disabled={!canEditAutomationCode || precondition} onChange={(event) => setSelectedAutomationStepIds((current) => event.target.checked ? [...current, step.id] : current.filter((id) => id !== step.id))} type="checkbox" />
                              <button aria-controls={`automation-plan-step-${step.id}`} aria-expanded={expanded} onClick={() => toggleAutomationStep(step.id)} type="button">
                                <span className="automation-section-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span><span className="automation-plan-number">{String(step.step_order).padStart(2, "0")}</span>
                                <span className="automation-plan-copy"><strong><StepParameterizedText text={sectionName} values={mergedParameterValues} /></strong>{draft.expected_result ? <small><span className="automation-section-expect">Expect</span><StepParameterizedText text={richTextToPlainText(draft.expected_result)} values={mergedParameterValues} /></small> : null}</span><span className="automation-section-platform">{draft.step_type === "ios" ? "iOS" : draft.step_type.toUpperCase()}</span>{hasChanges ? <span className="automation-section-unsaved">Unsaved</span> : null}
                                <span className={`automation-plan-state${isAutomationStepMapped(step) ? " is-ready" : ""}`}>{isAutomationStepMapped(step) ? "Ready" : "Not implemented"}</span>
                              </button>
                            </div>
                            {canViewAutomationCode ? <AutomationInstructionPreview code={step.step_type === "api" ? "" : sourceCode} apiRequest={step.step_type === "api" ? step.api_request : null} sectionName={sectionName} emptyAction={canEditAutomationCode ? <button className="ghost-button compact" onClick={() => toggleAutomationStep(step.id)} type="button"><AddIcon size={13} />Add instruction</button> : undefined} /> : null}
                            {!expanded && isAutomationStepMapped(step) && canEditAutomationCode ? <div className="automation-section-tools"><button className="ghost-button compact" onClick={() => toggleAutomationStep(step.id)} type="button"><PencilIcon size={13} />Edit</button><button className="ghost-button compact" onClick={openInstructionEditor} type="button"><AddIcon size={13} />Add instruction</button></div> : null}
                            {step.step_type === "api" && !programNeedsEditor && step.api_request?.query_params?.length ? <div className="automation-plan-api-parameters" aria-label={`Step ${step.step_order} query parameters`}>{step.api_request.query_params.filter((parameter) => parameter.key).map((parameter, index) => <span key={`${parameter.key}:${index}`}><code>{parameter.key}</code><span>=</span>{/password|secret|token|api.?key/i.test(parameter.key) ? <span>Hidden value</span> : <StepParameterizedText text={parameter.value} values={mergedParameterValues} fallback="Empty value" />}</span>)}</div> : null}
                            {step.step_type === "api" && !programNeedsEditor ? <AutomationReferencedParameters parameters={collectStepParameters([step]).map((parameter) => detectedStepParameters.find((available) => available.name === parameter.name) || parameter)} values={mergedParameterValues} /> : null}
                            {expanded ? <fieldset disabled={!canEditAutomationCode} className="automation-plan-editor" id={`automation-plan-step-${step.id}`} style={{ border: 0, margin: 0, minWidth: 0 }}>
                              <details className="automation-section-details"><summary>Section details</summary><div className="automation-plan-behavior-fields">
                                <label className="form-field"><span>Section name</span><GherkinStepTextField ariaLabel={`Step ${step.step_order} action`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(name) => updateDraft({ name })} value={draft.name} /></label>
                                <label className="form-field"><span>Expected result</span><GherkinStepTextField ariaLabel={`Step ${step.step_order} expected result`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(expected_result) => updateDraft({ expected_result })} value={draft.expected_result} /></label>
                              </div></details>
                              {automationStepView === "code" && step.step_type === "api" ? <label className="form-field"><span>API request JSON</span><textarea className="automation-code-input" disabled={!canEditAutomationCode} rows={12} spellCheck={false} value={apiSourceDrafts[step.id] ?? JSON.stringify(step.api_request || { method: "GET", url: "", validations: [{ kind: "status", expected: "200" }] }, null, 2)} onChange={(event) => setApiSourceDrafts((current) => ({ ...current, [step.id]: event.target.value }))} /><small>Requests, assertions and captures execute through the API runner.</small></label> : automationStepView === "code" ? <label className="form-field"><span>Executable code</span><textarea className="automation-code-input" disabled={!canEditAutomationCode} rows={8} spellCheck={false} onChange={(event) => setStepCodeDrafts((current) => ({ ...current, [step.id]: event.target.value }))} value={stepCodeDrafts[step.id] ?? step.automation_code ?? ""} /></label> : programNeedsEditor ? <div className="automation-program-preserved"><span>Recorded or custom instructions</span><button className="ghost-button compact" onClick={openInstructionEditor} type="button">Edit instructions</button></div> : <div className="automation-plan-mapping automation-instruction-composer">
                                <label className="form-field"><span>Platform</span><select disabled={!canEditAutomationCode} onChange={(event) => { const nextType = event.target.value as TestStepType; updateDraft({ step_type: nextType, keyword: AUTOMATION_KEYWORDS_BY_TYPE[nextType][0], objectRef: "", value: "" }); }} value={draft.step_type}>{[...new Set([...allowedStepTypes, draft.step_type])].map((type) => <option key={type} value={type}>{type === "ios" ? "iOS" : type.toUpperCase()}</option>)}</select></label>
                                <label className="form-field"><span>Keyword</span><select disabled={!canEditAutomationCode} onChange={(event) => updateDraft({ keyword: event.target.value, objectRef: "", value: "" })} value={draft.keyword}>{AUTOMATION_KEYWORDS_BY_TYPE[draft.step_type].map((keyword) => <option key={keyword} value={keyword}>{formatKeywordDisplay(keyword)}</option>)}</select></label>
                                {draft.step_type === "api" ? <div className="automation-plan-target automation-plan-behavior-fields">
                                  <label className="form-field"><span>{draft.keyword === "api.request" ? "HTTP method" : "API operation"}</span>{draft.keyword === "api.request" ? <select disabled={!canEditAutomationCode} onChange={(event) => updateDraft({ apiMethod: event.target.value as AutomationStepDraft["apiMethod"] })} value={draft.apiMethod}>{["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => <option key={method}>{method}</option>)}</select> : <span>{formatKeywordDisplay(draft.keyword)}</span>}</label>
                                  <label className="form-field"><span>{draft.keyword === "api.request" ? "API URL" : draft.keyword === "api.expectStatus" ? "Status code" : "Response path"}</span><AutomationParameterInput ariaLabel={`Step ${step.step_order} API target`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} disabled={!canEditAutomationCode} onChange={(objectRef) => updateDraft({ objectRef })} value={draft.objectRef} /></label>
                                  {draft.keyword === "api.expectJson" || draft.keyword === "api.capture" ? <label className="form-field"><span>{draft.keyword === "api.capture" ? "Save to parameter" : "Expected value"}</span><AutomationParameterInput ariaLabel={`Step ${step.step_order} API value`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} disabled={!canEditAutomationCode} onChange={(value) => updateDraft({ value })} value={draft.value} /></label> : null}
                                  {draft.keyword === "api.request" ? <div className="automation-plan-target">{canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={openInstructionEditor} type="button">Request settings, parameters & validation</button>) : null}</div> : null}
                                </div> : <>
                                  {spec.target !== "none" ? <label className="form-field automation-plan-target"><span>{spec.targetLabel}</span>{spec.target === "repository" ? <AutomationRepositoryFieldPicker ariaLabel={`Step ${step.step_order} repository field`} disabled={!canEditAutomationCode} objectRepository={learningCache} onChange={(objectRef) => updateDraft({ objectRef })} value={draft.objectRef} /> : <AutomationParameterInput ariaLabel={`Step ${step.step_order} ${spec.targetLabel}`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} disabled={!canEditAutomationCode} onChange={(objectRef) => updateDraft({ objectRef })} value={draft.objectRef} />}</label> : null}
                                  {spec.showValue ? <label className="form-field automation-plan-target"><span>{spec.valueLabel}</span>{spec.valueTarget === "repository" ? <AutomationRepositoryFieldPicker ariaLabel={`Step ${step.step_order} destination field`} disabled={!canEditAutomationCode} objectRepository={learningCache} onChange={(value) => updateDraft({ value })} value={draft.value} /> : <AutomationParameterInput ariaLabel={`Step ${step.step_order} ${spec.valueLabel}`} availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} disabled={!canEditAutomationCode} onChange={(value) => updateDraft({ value })} value={draft.value} />}</label> : null}
                                </>}
                              </div>}
                              <details><summary>Execution options</summary><div className="automation-plan-actions">{([['optional', 'Optional step'], ['skip', 'Skip step'], ['screenshotOnFailure', 'Screenshot on failure']] as const).map(([key, label]) => <label className="checkbox-field" key={key}><input disabled={!canEditAutomationCode} checked={options[key]} onChange={(event) => setStepOptionDrafts((current) => ({ ...current, [step.id]: { ...options, [key]: event.target.checked } }))} type="checkbox" />{label}</label>)}</div></details>
                              <div className="automation-plan-actions">
                                {canEditAutomationCode ? (<button className="primary-button compact" disabled={!canEditAutomationCode || updateAutomationStep.isPending || updateAutomationStepCode.isPending} onClick={() => automationStepView === "code" ? updateAutomationStepCode.mutate(step) : updateAutomationStep.mutate(step)} type="button">{updateAutomationStep.isPending || updateAutomationStepCode.isPending ? "Saving…" : "Save section"}</button>) : null}
                                {draft.step_type !== "api" ? (canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={openInstructionEditor} type="button">Add / edit instructions</button>) : null) : null}
                                {canUseRecorder && step.step_type !== "api" && (!["android", "ios"].includes(step.step_type || "") || canUseMobileAppium) ? (<button className="ghost-button compact" disabled={!canUseRecorder || Boolean(recorderSession) || startRecorder.isPending} onClick={() => { setRecordingTargetStepId(step.id); setBuildMethod("record"); selectAutomationWorkspaceTab("build"); }} type="button">Replace with recording</button>) : null}
                                <details className="automation-plan-more"><summary>More actions</summary><div className="automation-plan-actions">
                                  {canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode || reorderAutomationStep.isPending || step.step_order <= 1 || isAutomationPrecondition(automatedSteps[automatedSteps.findIndex((item) => item.id === step.id) - 1] || step) !== precondition} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} type="button">Move up</button>) : null}
                                  {canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode || reorderAutomationStep.isPending || step.step_order >= automatedSteps.length || isAutomationPrecondition(automatedSteps[automatedSteps.findIndex((item) => item.id === step.id) + 1] || step) !== precondition} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} type="button">Move down</button>) : null}
                                  {canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={() => { setNewStepIsPrecondition(precondition); setNewStepPlacement({ mode: "after", stepId: step.id }); document.getElementById("automation-new-step-composer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} type="button">Insert after</button>) : null}
                                  {canUseAutomationAi ? ((canEditAutomationCode && canUseAutomationAi ? (<button className="ghost-button compact" disabled={!canEditAutomationCode || !canUseAutomationAi || rephraseAutomationStep.isPending} onClick={() => rephraseAutomationStep.mutate(step)} type="button">Improve wording</button>) : null)) : null}
                                  {canEditAutomationCode ? (<button className="ghost-button compact danger" disabled={!canEditAutomationCode || deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step)} type="button">Clear implementation</button>) : null}
                                  {canEditAutomationCode ? (<button className="ghost-button compact danger" disabled={!canEditAutomationCode || removeAutomationPlanStep.isPending} onClick={() => removeAutomationPlanStep.mutate(step)} type="button">Remove section</button>) : null}
                                </div></details>
                              </div>
                            </fieldset> : null}
                          </article>;
                        });
                        return group.isStandalone || precondition ? <div className="automation-program-sections" key={group.id}>{rows}</div> : <details className="automation-plan-group automation-program-group" open key={group.id}><summary><strong>{group.title}</strong><span>{group.steps.length} sections{group.steps[0]?.group_kind === "reusable" ? " · Shared Step Group" : ""}</span></summary><div className="automation-plan-actions">{group.steps[0]?.reusable_group_id ? <span className="muted">Edits also update the Shared Step Group.</span> : null}{canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode || ungroupAutomationSteps.isPending} onClick={() => ungroupAutomationSteps.mutate(group.steps[0].group_id as string)} type="button">Ungroup</button>) : null}{canEditAutomationCode ? (<button className="ghost-button compact" disabled={!canEditAutomationCode} onClick={() => { setNewStepIsPrecondition(false); setNewStepPlacement({ mode: "after", stepId: group.steps[group.steps.length - 1].id }); document.getElementById("automation-new-step-composer")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} type="button">Add section to group</button>) : null}</div>{rows}</details>;
                      })}
                    </section>)}
                    {canEditAutomationCode ? <section className="automation-new-section" id="automation-new-step-composer" aria-label="Add plan section">
                      <div className="automation-plan-heading"><strong>{newStepIsPrecondition ? "New precondition" : "New section"}</strong><select aria-label="New step section" onChange={(event) => { setNewStepIsPrecondition(event.target.value === "precondition"); setNewStepPlacement({ mode: "end", stepId: "" }); }} value={newStepIsPrecondition ? "precondition" : "step"}><option value="step">Test section</option><option value="precondition">Precondition</option></select></div>
                      {newStepPlacementLabel ? <span className="muted">{richTextToPlainText(newStepPlacementLabel)} <button className="ghost-button compact" onClick={() => setNewStepPlacement({ mode: "end", stepId: "" })} type="button">Reset placement</button></span> : null}
                      <div className="automation-plan-behavior-fields"><label className="form-field"><span>Section name</span><GherkinStepTextField ariaLabel="New step action" availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(name) => setNewStepDraft((current) => ({ ...current, name }))} placeholder="For example, sign in with valid credentials" value={newStepDraft.name} /></label><label className="form-field"><span>Expected result</span><GherkinStepTextField ariaLabel="New step expected result" availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(expected_result) => setNewStepDraft((current) => ({ ...current, expected_result }))} placeholder="Describe the outcome" value={newStepDraft.expected_result} /></label></div>
                      <div className="automation-plan-actions"><select aria-label="New step type" onChange={(event) => setNewStepDraft((current) => ({ ...emptyAutomationStepDraft(event.target.value as TestStepType), name: current.name, expected_result: current.expected_result }))} value={newStepDraft.step_type}>{allowedStepTypes.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select><button className="primary-button compact" disabled={!newStepDraft.name.trim() || createAutomationStep.isPending} onClick={() => createAutomationStep.mutate()} type="button"><AddIcon size={14} />{createAutomationStep.isPending ? "Adding…" : newStepIsPrecondition ? "Add precondition" : "Add section"}</button></div>
                    </section> : null}
                  </section>
                ) : null}
                {activeAutomationWorkspaceTab === "repository" && canViewObjectRepository ? (
                  <section className="automation-repository-tab" role="tabpanel" aria-label="Automation object bindings">
                    <div className="automation-repository-tab-head">
                      <div>
                        <span className="automation-command-eyebrow">Reusable selectors</span>
                        <h3>Object Repository bindings</h3>
                        <p>Bind Web and mobile actions to reviewed objects. Semantic, unique locators remain preferred over structural CSS or XPath fallbacks.</p>
                      </div>
                      <button className="primary-button" onClick={() => setView("repository")} type="button"><IconTargetArrow size={16} /><span>Open Object Repository</span></button>
                    </div>
                    <div className="automation-repository-health-grid">
                      <article><strong>{new Set(caseObjectMembers.map((member) => member.pageName)).size}</strong><span>Linked screens</span></article>
                      <article><strong>{caseObjectMembers.length}</strong><span>Associated fields</span></article>
                      <article className={caseObjectMembers.filter((member) => atRiskRepositoryEntries.some((entry) => entry.id === member.entry.id)).length ? "is-attention" : "is-healthy"}><strong>{caseObjectMembers.filter((member) => atRiskRepositoryEntries.some((entry) => entry.id === member.entry.id)).length}</strong><span>Need locator review</span></article>
                    </div>
                    <div className="automation-object-binding-list">
                      {caseObjectMembers.map((member) => (
                        <button key={member.entry.id} onClick={() => {
                          setView("repository");
                          selectRepositoryEntry(member.entry.id, getRepositoryScreenKey(member.entry));
                        }} type="button">
                          <span><strong>{member.ref}</strong><small>{member.htmlTag} · {member.entry.locator_kind || "locator"}</small></span>
                          <OpenIcon size={14} />
                        </button>
                      ))}
                      {!caseObjectMembers.length ? <div className="empty-state compact">No repository fields are associated with this case. Reference a saved Screen.Field in your automation to link it here.</div> : null}
                    </div>
                  </section>
                ) : null}

                {activeAutomationWorkspaceTab === "runs" ? (
                <AutomationAccordionSection
                  countLabel={`${activeCaseHistory.length} run${activeCaseHistory.length === 1 ? "" : "s"}`}
                  isExpanded={expandedCaseSections.history}
                  onToggle={() => toggleCaseSection("history")}
                  stage="history"
                  summary={activeCaseHistory.length ? "Recent local and manual execution outcomes for this automation case." : "No run history yet."}
                  title="Run history"
                >
                  <TestCaseVersionHistory
                    canRestore={canUseAutomationBuilder}
                    currentCase={activeCase}
                    currentSteps={automatedSteps}
                  />
                  <div className="automation-run-history">
                    {selectedCaseHistoryQuery.isLoading ? <LoadingState label="Loading run history" /> : null}
                    {selectedCaseHistoryQuery.isError ? <div className="empty-state compact" role="alert">Run history couldn’t be loaded. <button className="ghost-button compact" onClick={() => void selectedCaseHistoryQuery.refetch()} type="button">Retry</button></div> : null}
                    {selectedCaseHistoryQuery.isSuccess && !activeCaseHistory.length ? <div className="empty-state compact">No run history yet.</div> : null}
                    {activeCaseHistory.map((result) => (
                      <article className="automation-history-row" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || activeCase.title}</strong>
                          <span>
                            {result.created_at ? formatRunDate.format(new Date(result.created_at)) : "Run timestamp unavailable"}
                            {` · ${result.duration_ms ? `${Math.round(result.duration_ms / 1000)}s` : "duration pending"}`}
                            {result.data_set_iteration_index !== null && result.data_set_iteration_index !== undefined
                              ? ` · ${result.test_data_set_name || "Data set"} iteration ${result.data_set_iteration_index + 1}`
                              : ""}
                          </span>
                          {result.data_set_row_snapshot ? (
                            <div className="automation-history-data-row" aria-label="Execution data row">
                              {Object.entries(result.data_set_row_snapshot).slice(0, 5).map(([key, value]) => <span key={key}><strong>{key}</strong>{value}</span>)}
                            </div>
                          ) : null}
                          {result.error ? <p>{result.error}</p> : null}
                          <ExecutionHookResults logs={result.logs || null} canViewAutomationCode={canViewAutomationCode} canViewEvidence={hasPermission(session, "result.view", projectId) && hasPermission(session, "attachment.view", projectId)} />
                        </div>
                        <StatusBadge value={result.status} />
                      </article>
                    ))}
                  </div>
                </AutomationAccordionSection>
                ) : null}
              </div>
            )}
          </Panel>
          )}
        />
      ) : null}

	      {view === "repository" ? (
	        <div className={[
	          "automation-workspace-grid automation-workspace-grid--repository",
	          selectedRepositoryEntry && isRepositoryConfigOpen ? "has-config-drawer" : ""
	        ].filter(Boolean).join(" ")}
	          style={selectedRepositoryEntry && isRepositoryConfigOpen ? ({ "--object-repository-config-width": `${repositoryConfigDrawerWidth}px` } as CSSProperties) : undefined}
	        >
          <Panel
            title="Object repository"
            subtitle="Screen-level fields grouped by page, with friendly member names, HTML tag details, locator, DOM, image, and fallback intelligence."
            actions={(
              <div className="testops-action-row repository-toolbar">
                <button className="primary-button" onClick={() => {
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
	                <button className="ghost-button" onClick={() => setIsRepositoryImportModalOpen(true)} type="button">
	                  <ImportIcon />
	                  <span>{isParsingRepositoryImport ? "Reading..." : "Import"}</span>
	                </button>
                <button className="ghost-button" disabled={!appTypeId || exportRepositoryCsv.isPending} onClick={() => exportRepositoryCsv.mutate()} type="button">
                  <ExportIcon />
                  <span>{exportRepositoryCsv.isPending ? "Exporting..." : "Export CSV"}</span>
                </button>
                <button className="ghost-button danger" disabled={!activePageObject || deleteRepositoryScreen.isPending} onClick={() => deleteRepositoryScreen.mutate(false)} type="button">
                  <TrashIcon size={16} />
                  <span>{deleteRepositoryScreen.isPending ? "Checking..." : "Delete screen"}</span>
                </button>
              </div>
            )}
          >
            {learningCacheQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {learningCacheQuery.isError ? (
              <div className="empty-state compact" role="alert">
                <span>Unable to load repository screens. Your saved screens have not been removed.</span>
                <button className="ghost-button compact" disabled={learningCacheQuery.isFetching} onClick={() => void learningCacheQuery.refetch()} type="button">Retry loading</button>
              </div>
            ) : null}
            {isAddingRepositoryScreen ? (
              <div className="automation-create-card repository-screen-create-card">
                <div className="object-repository-inspector-section-head">
                  <strong>Create Object Repository screen</strong>
                  <span>Name the screen and define how it is recognized. URL, DOM, screenshot, and selected objects remain attached to this screen record.</span>
                </div>
	                      <div className="record-grid testops-builder-form repository-screen-overview-grid">
                  <label className="form-field"><span>Screen name</span><input value={newRepositoryScreenDraft.screen_name} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, screen_name: event.target.value }))} placeholder="Checkout Page" /></label>
                  <label className="form-field"><span>Page URL</span><input value={newRepositoryScreenDraft.page_url} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, page_url: event.target.value }))} placeholder="https://app.example.com/checkout" /></label>
                  <label className="form-field">
                    <span>URL match rule</span>
                    <div className="repository-url-rule">
                      <select value={newRepositoryScreenDraft.url_pattern_type} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select>
                      <input value={newRepositoryScreenDraft.url_pattern_value} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/checkout" />
                    </div>
                  </label>
                  <label className="form-field repository-span-two"><span>Purpose and intended flow</span><textarea rows={3} value={newRepositoryScreenDraft.business_meaning} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Customer reviews cart, enters payment, and submits an order." /></label>
                  <label className="form-field repository-span-two"><span>Description</span><RichTextEditor appearance="canonical" rows={2} value={newRepositoryScreenDraft.description} onChange={(description) => setNewRepositoryScreenDraft((current) => ({ ...current, description }))} placeholder="Page context used when selecting stable fields." /></label>
                </div>
                <details className="repository-screen-create-evidence">
                  <summary>
                    <span><strong>Initial evidence</strong><small>Paste existing evidence or let the live builder capture the current URL, DOM, and screenshot.</small></span>
                  </summary>
                  <div className="record-grid testops-builder-form repository-screen-overview-grid">
                    <label className="form-field repository-span-two"><span>Screenshot URL / data URL</span><input value={newRepositoryScreenDraft.screenshot_url} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, screenshot_url: event.target.value }))} placeholder="Captured during inspect when blank" /></label>
                    <label className="form-field repository-span-two"><span>DOM / accessibility structure</span><textarea rows={6} value={newRepositoryScreenDraft.dom_structure} onChange={(event) => setNewRepositoryScreenDraft((current) => ({ ...current, dom_structure: event.target.value }))} placeholder="<main><input aria-label='Card number' />...</main>" /></label>
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
              </div>
            ) : null}
            {!learningCacheQuery.isLoading && !learningCacheQuery.isError && !groupedRepository.length ? (
              <div className="empty-state compact">No repository objects have been learned for this scope yet.</div>
            ) : null}
            <div className="pom-workspace">
              <aside className="pom-page-list" aria-label="Repository pages">
                {pageObjectModels.map((page) => (
                  <div className={activePageObject?.screenName === page.screenName ? "pom-page-item is-active" : "pom-page-item"} key={page.screenName}>
                    {renamingScreenName === page.screenName ? (
                      <form className="pom-page-rename-form" onSubmit={(event) => {
                        event.preventDefault();
                        renameRepositoryScreen.mutate();
                      }}>
                        <input aria-label={`Rename ${page.pageName}`} autoFocus onChange={(event) => setScreenRenameDraft(event.target.value)} value={screenRenameDraft} />
                        <button className="primary-button compact" disabled={!screenRenameDraft.trim() || screenRenameDraft.trim() === activeScreenName || renameRepositoryScreen.isPending} type="submit">
                          {renameRepositoryScreen.isPending ? "Saving..." : "Save"}
                        </button>
                        <button className="ghost-button compact" disabled={renameRepositoryScreen.isPending} onClick={() => setRenamingScreenName("")} type="button">Cancel</button>
                      </form>
                    ) : (
                      <>
                        <button className="pom-page-select" onClick={() => selectRepositoryScreen(page.screenName)} type="button">
                          <strong>{page.pageName}</strong>
                          <small>{appTypes.find((appType) => appType.id === page.appTypeId)?.name || "Workspace"}</small>
                        </button>
                        <button aria-label={`Rename ${page.pageName}`} className="pom-page-rename" onClick={() => {
                          selectRepositoryScreen(page.screenName);
                          setScreenRenameDraft(page.pageName);
                          setRenamingScreenName(page.screenName);
                        }} type="button">
                          <PencilIcon size={15} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </aside>

              {activePageObject ? (
                <section className="pom-class-panel" aria-label={`${activePageObject.pageName} repository page`}>
                  <SubnavTabs
                    ariaLabel="Screen details"
                    className="object-repository-screen-tabs"
                    value={screenDetailTab}
                    onChange={setScreenDetailTab}
	                    items={[
	                      { value: "overview", label: "Overview", meta: screenInfoDraft.description ? "Documented" : "Add context" },
	                      { value: "fields", label: "Fields", meta: String(activePageObject.members.length) },
	                      { value: "dom", label: "DOM Snapshot", meta: screenDomDraft ? "Captured" : "Pending" }
	                    ]}
                  />
                  {screenDetailTab === "overview" ? (
                    <div className="repository-screen-overview">
	                      <div className="record-grid testops-builder-form repository-screen-overview-grid">
                        <label className="form-field"><span>Screen name</span><input readOnly value={screenInfoDraft.screen_name || activeScreenName} /></label>
                        <label className="form-field"><span>Page URL</span><input onChange={(event) => setScreenUrlDraft(event.target.value)} placeholder="https://app.example.com/login" value={screenUrlDraft} /></label>
                        <label className="form-field repository-span-two">
                          <span>URL match rule</span>
                          <div className="repository-url-rule"><select value={screenInfoDraft.url_pattern_type} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={screenInfoDraft.url_pattern_value} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login" /></div>
                        </label>
                        <label className="form-field repository-span-two"><span>Description</span><RichTextEditor appearance="canonical" rows={3} value={screenInfoDraft.description} onChange={(description) => setScreenInfoDraft((current) => ({ ...current, description }))} placeholder="What this screen represents." /></label>
                        <label className="form-field repository-span-two"><span>Intended flows</span><textarea rows={3} value={screenInfoDraft.business_meaning} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Sign in, recover password, continue as guest." /></label>
                      </div>
                      <div className="testops-action-row">
                        <button className="primary-button" disabled={saveRepositoryScreenEvidence.isPending} onClick={() => saveRepositoryScreenEvidence.mutate()} type="button"><LayersIcon /><span>{saveRepositoryScreenEvidence.isPending ? "Saving..." : "Save screen"}</span></button>
	                        {canInspectRepository ? (<button className="ghost-button" disabled={!canInspectRepository} onClick={() => openRepositoryInspect(activePageObject)} type="button"><MousePointerIcon /><span>Inspect screen</span></button>) : null}
	                        {canUseAutomationAi && canInspectRepository ? <button className="ghost-button" disabled={(!screenDomDraft && !screenScreenshotDraft) || extractRepositoryFields.isPending} onClick={() => {
	                          openRepositoryInspect(activePageObject);
	                          extractRepositoryFields.mutate();
	                        }} type="button"><SparkIcon /><span>{extractRepositoryFields.isPending ? "Suggesting..." : "AI suggest fields"}</span></button> : null}
                      </div>
                    </div>
                  ) : null}
                  {screenDetailTab === "fields" ? (
                    <div className="repository-fields-panel">
                      <div className="testops-action-row">
                        <button className="ghost-button" onClick={() => {
                          setIsAddingRepositoryField((current) => !current);
                          setIsAddingRepositoryScreen(false);
                        }} type="button">
                          <AddIcon />
                          <span>Add field</span>
                        </button>
                      </div>
                      {isAddingRepositoryField ? (
                        <div className="automation-create-card">
                          <strong>Add repository field manually</strong>
                          <div className="record-grid testops-builder-form">
                            <label className="form-field"><span>Screen name</span><input readOnly value={activeScreenName} /></label>
                            <label className="form-field"><span>Field name</span><input value={newRepositoryFieldDraft.object_name} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, object_name: event.target.value }))} placeholder="Email input" /></label>
                            <label className="form-field"><span>Element type / role</span><input value={newRepositoryFieldDraft.object_role} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, object_role: event.target.value }))} placeholder="textbox" /></label>
                            <label className="form-field"><span>Primary strategy</span><input value={newRepositoryFieldDraft.locator_kind} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, locator_kind: event.target.value }))} placeholder="data-testid" /></label>
                            <label className="form-field repository-span-two"><span>Primary locator</span><input value={newRepositoryFieldDraft.locator} onChange={(event) => setNewRepositoryFieldDraft((current) => ({ ...current, locator: event.target.value }))} placeholder="[data-testid='email']" /></label>
                          </div>
                          <div className="testops-action-row">
                            <button className="primary-button" disabled={addRepositoryField.isPending} onClick={() => addRepositoryField.mutate()} type="button"><AddIcon /><span>{addRepositoryField.isPending ? "Adding..." : "Save field"}</span></button>
                            <button className="ghost-button" onClick={() => setIsAddingRepositoryField(false)} type="button">Cancel</button>
                          </div>
                        </div>
                      ) : null}
                      <div className="pom-member-table">
                        <div className="pom-member-row is-head">
                          <span>Field</span>
                          <span>Type</span>
                          <span>Primary locator</span>
                        </div>
                        {activePageObject.members.map((member) => (
	                          <button className={`pom-member-row${selectedRepositoryEntry?.id === member.entry.id ? " is-active" : ""}${highlightedRepositoryId === member.entry.id ? " is-highlighted" : ""}`} key={member.entry.id} onClick={() => selectRepositoryEntry(member.entry.id, activePageObject.screenName)} type="button">
                            <code>{member.memberName}</code>
                            <span>{member.htmlTag} · {member.role}</span>
                            <small>{member.entry.locator}</small>
                          </button>
                        ))}
                        {!activePageObject.members.length ? <div className="empty-state compact">No saved fields yet. Add a field, inspect the screen, or select AI suggestions.</div> : null}
                      </div>
                    </div>
                  ) : null}
                  {screenDetailTab === "dom" ? (
                    <div className="repository-evidence-block">
                      {screenScreenshotDraft && isLikelyImageUrl(screenScreenshotDraft) ? <img alt={`${activePageObject.pageName} full screen`} src={screenScreenshotDraft} /> : null}
                      <label>Full DOM / accessibility tree</label>
                      <pre>{screenDomDraft || screenInfoDraft.accessibility_tree || "No full-page DOM or accessibility snapshot captured."}</pre>
                      <small>Fingerprint: {screenInfoDraft.screen_fingerprint || "Not generated"}</small>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </Panel>

	          {selectedRepositoryEntry && isRepositoryConfigOpen ? (
		            <aside className="panel card automation-detail-panel object-repository-config-drawer" aria-label="Object configuration">
		              <button
		                aria-label="Resize object configuration panel"
		                className="object-repository-config-resize-handle"
		                onKeyDown={handleRepositoryConfigResizeKeyDown}
		                onPointerDown={handleRepositoryConfigResizeStart}
		                title="Drag left or right to resize object configuration"
		                type="button"
		              />
		              <div className="object-repository-config-head">
	                <div>
	                  <strong>Object Configuration</strong>
	                  <span>Element Configuration: {repositoryDraft.object_name || getRepositoryMemberName(selectedRepositoryEntry)}</span>
	                </div>
	                <button
	                  aria-label="Close object configuration"
	                  className="object-repository-config-close"
	                  onClick={() => setIsRepositoryConfigOpen(false)}
	                  title="Close object configuration"
	                  type="button"
	                >
	                  <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
	                    <path d="M18 6 6 18" />
	                    <path d="m6 6 12 12" />
	                  </svg>
	                </button>
	              </div>
	              <div className="testops-action-row object-repository-config-actions">
	                <button className="ghost-button" onClick={() => void highlightRepositoryLocator(selectedRepositoryEntry.locator, `${activeScreenName}.${getRepositoryMemberName(selectedRepositoryEntry)}`, selectedRepositoryEntry.id).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight field."))} type="button">
	                  <MousePointerIcon />
	                  <span>Highlight</span>
	                </button>

	                <button className="primary-button" disabled={saveRepositoryEntry.isPending} onClick={() => saveRepositoryEntry.mutate()} type="button">
	                  <PlayIcon />
	                  <span>{saveRepositoryEntry.isPending ? "Saving..." : "Save field"}</span>
	                </button>
	                <button className="ghost-button danger" disabled={deleteRepositoryEntry.isPending} onClick={() => deleteRepositoryEntry.mutate(false)} type="button">
	                  <TrashIcon size={16} />
	                  <span>{deleteRepositoryEntry.isPending ? "Checking..." : "Delete field"}</span>
	                </button>
	              </div>
	              <div className="repository-field-detail">
	                <SubnavTabs
	                  ariaLabel="Field details"
	                  className="object-repository-screen-tabs"
                  value={fieldDetailTab}
                  onChange={setFieldDetailTab}
                  items={[
	                    { value: "locators", label: "Locators", meta: `${selectedLocators.length} strategies` },
	                    { value: "evidence", label: "Evidence", meta: "DOM + visual" },
	                    { value: "meaning", label: "AI Meaning", meta: "Agent context" },
                      { value: "healing", label: "Healing", meta: locatorImprovementPreview ? "Review proposal" : "Readiness" }
	                  ]}
                />
                {fieldDetailTab === "healing" ? (
                  <div className="repository-healing-panel">
	                <AiAssurancePanel
	                  compact
	                  gaps={selectedLocatorReviewReadiness.gaps}
	                  provenance="Saved locator strategies, stability metadata, validation history, DOM/accessibility evidence, and captured images"
	                  reviewState="review-required"
	                  score={selectedLocatorReviewReadiness.score}
	                  scoreLabel={selectedLocatorReviewReadiness.scoreLabel}
	                  signals={selectedLocatorReviewReadiness.signals}
	                  summary={selectedLocatorReviewReadiness.summary}
	                  title="Locator healing readiness"
	                />
	                {locatorImprovementPreview ? (
	                  <section className="locator-improvement-review" aria-label="Locator improvement review">
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
	                        <input aria-label="Edit proposed locator strategy" onChange={(event) => setLocatorImprovementPreview((current) => current ? { ...current, suggestion: { ...current.suggestion, strategy: event.target.value } } : current)} placeholder="Locator strategy" value={locatorImprovementPreview.suggestion.strategy || ""} />
	                        <textarea aria-label="Edit proposed locator" onChange={(event) => setLocatorImprovementPreview((current) => current ? { ...current, suggestion: { ...current.suggestion, locator: event.target.value } } : current)} placeholder="Proposed locator" rows={3} value={locatorImprovementPreview.suggestion.locator || ""} />
	                      </div>
	                    </div>
	                    <p>{locatorImprovementPreview.suggestion.reason || locatorImprovementPreview.fallback_reason || "Review the proposed locator against captured evidence before applying it."}</p>
	                    <div className="locator-improvement-provenance">
	                      <span>{locatorImprovementPreview.provenance?.provider || (locatorImprovementPreview.generation_mode === "llm" ? "Configured AI provider" : "HelloTest deterministic rules")}</span>
	                      {locatorImprovementPreview.provenance?.model ? <span>{locatorImprovementPreview.provenance.model}</span> : null}
	                      {locatorImprovementPreview.request_id ? <code>{locatorImprovementPreview.request_id}</code> : null}
	                    </div>
	                    <div className="action-row">
	                      <button
	                        className="primary-button"
	                        disabled={applyRepositoryImprovement.isPending || !locatorImprovementPreview.suggestion.locator || !locatorImprovementPreview.suggestion.strategy}
	                        onClick={() => applyRepositoryImprovement.mutate()}
	                        type="button"
	                      >
	                        {applyRepositoryImprovement.isPending ? "Applying..." : "Apply reviewed change"}
	                      </button>
	                      <button className="ghost-button" disabled={applyRepositoryImprovement.isPending} onClick={() => setLocatorImprovementPreview(null)} type="button">
	                        Discard proposal
	                      </button>
	                    </div>
	                  </section>
	                ) : null}
                    <div className="action-row">
	                {canUseAutomationAi ? <button className="ghost-button" disabled={improveRepositoryEntry.isPending || applyRepositoryImprovement.isPending} onClick={() => improveRepositoryEntry.mutate()} type="button">
	                  <SparkIcon />
	                  <span>{improveRepositoryEntry.isPending ? "Preparing..." : locatorImprovementPreview ? "Regenerate proposal" : "Suggest improvement"}</span>
	                </button> : null}
                    </div>
                  </div>
                ) : null}
                {fieldDetailTab === "locators" ? (
                  <div className="repository-locator-detail">
                    <div className="repository-locator-list">
                      {selectedLocators.map((locator) => (
                        <article key={`${locator.strategy}-${locator.locator}`}>
                          <StatusBadge value={locator.isPrimary ? "Primary" : "Fallback"} />
                          <strong>{locator.strategy}</strong>
                          <code>{locator.locator}</code>
                          <span>{Math.round(locator.confidenceScore * 100)}% · {locator.lastValidatedStatus}</span>
                        </article>
                      ))}
                    </div>
                    <div className="record-grid testops-builder-form">
                    <label className="form-field">
                      <span>Screen name</span>
                      <input readOnly value={screenInfoDraft.screen_name || activeScreenName} />
                    </label>
                    <label className="form-field">
                      <span>Inherited screen URL rule</span>
                      <input readOnly value={`${screenInfoDraft.url_pattern_type} ${screenInfoDraft.url_pattern_value}`} />
                    </label>
                    <label className="form-field">
                      <span>Field name</span>
                      <input value={repositoryDraft.object_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_name: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Element type / role</span>
                      <input value={repositoryDraft.object_role} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_role: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Primary locator · {Math.round(selectedRepositoryEntry.confidence * 100)}% confidence</span>
                      <input value={repositoryDraft.locator} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Primary strategy</span>
                      <input value={repositoryDraft.locator_kind} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator_kind: event.target.value }))} />
                    </label>
                    <label className="form-field repository-span-two">
                      <span>Fallback locators · `strategy | locator | confidence %`</span>
                      <textarea rows={4} value={repositoryDraft.fallback_locators} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_locators: event.target.value }))} placeholder={"aria-label | [aria-label='Login'] | 90\ncss | button[type='submit'] | 70"} />
                    </label>
                    <label className="form-field">
                      <span>Stability score (%)</span>
                      <input max="100" min="0" type="number" value={repositoryDraft.stability_score} onChange={(event) => setRepositoryDraft((current) => ({ ...current, stability_score: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Inherited screen fingerprint</span>
                      <input readOnly value={screenInfoDraft.screen_fingerprint} placeholder="Capture screen evidence to generate identity" />
                    </label>
                    </div>
                  </div>
                ) : null}
                {fieldDetailTab === "evidence" ? (
                  <div className="record-grid testops-builder-form">
                    <label className="form-field"><span>Element screenshot URL</span><input value={repositoryDraft.element_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, element_screenshot_url: event.target.value }))} /></label>
                    <label className="form-field"><span>Ancestor screenshot URL</span><input value={repositoryDraft.ancestor_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_screenshot_url: event.target.value }))} /></label>
                    <label className="form-field repository-span-two"><span>Parent / ancestor DOM snapshot</span><textarea rows={5} value={repositoryDraft.ancestor_dom || repositoryDraft.dom_structure} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_dom: event.target.value }))} /></label>
                    <label className="form-field repository-span-two"><span>Inherited screen accessibility tree</span><textarea readOnly rows={5} value={screenInfoDraft.accessibility_tree} /></label>
                    {repositoryDraft.element_screenshot_url && isLikelyImageUrl(repositoryDraft.element_screenshot_url) ? <div className="object-repository-snapshot"><img alt={`${repositoryDraft.object_name} element`} src={repositoryDraft.element_screenshot_url} /></div> : null}
                  </div>
                ) : null}
                {fieldDetailTab === "meaning" ? (
                  <div className="record-grid testops-builder-form">
                    <label className="form-field repository-span-two"><span>AI-generated description</span><RichTextEditor appearance="canonical" rows={3} value={repositoryDraft.description} onChange={(description) => setRepositoryDraft((current) => ({ ...current, description }))} /></label>
                    <label className="form-field repository-span-two"><span>Business meaning</span><textarea rows={3} value={repositoryDraft.business_meaning} onChange={(event) => setRepositoryDraft((current) => ({ ...current, business_meaning: event.target.value }))} /></label>
                    <label className="form-field"><span>Usage keywords</span><input value={repositoryDraft.usage_keywords} onChange={(event) => setRepositoryDraft((current) => ({ ...current, usage_keywords: event.target.value }))} placeholder="login, submit, authenticate" /></label>
                    <label className="form-field repository-span-two"><span>Healing guidance</span><textarea rows={3} value={repositoryDraft.fallback_strategy} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_strategy: event.target.value }))} /></label>
	                  </div>
	                ) : null}
	              </div>
	            </aside>
	          ) : null}

	          {isRepositoryImportModalOpen ? (
	            <div className="modal-backdrop" onClick={() => !importRepositoryEntries.isPending && setIsRepositoryImportModalOpen(false)} role="presentation">
	              <div
	                aria-labelledby="object-repository-import-title"
	                aria-modal="true"
	                className="modal-card import-modal-card"
	                onClick={(event) => event.stopPropagation()}
	                role="dialog"
	              >
	                <div className="import-modal-header">
	                  <div className="import-modal-title">
	                    <p className="dialog-context-label">Object repository import</p>
	                    <div className="modal-title-info-row">
	                      <h2 className="dialog-title" id="object-repository-import-title">Import screens and fields</h2>
	                      <InfoTooltip
	                        content="Upload a HelloTest OR CSV, individual page object files, or a ZIP archive. CSV rows import as saved screens and fields; source files are parsed locally for Playwright, Selenium Java, C#, JavaScript, and TypeScript locators."
	                        label="Object repository import information"
	                      />
	                    </div>
	                  </div>
	                  <button
	                    aria-label="Close object repository import dialog"
	                    className="ghost-button"
	                    disabled={importRepositoryEntries.isPending}
	                    onClick={() => setIsRepositoryImportModalOpen(false)}
	                    type="button"
	                  >
	                    Close
	                  </button>
	                </div>
	                <div className="import-modal-body">
	                  <label className={isParsingRepositoryImport ? "repository-import-dropzone is-disabled" : "repository-import-dropzone"}>
	                    <ImportIcon />
	                    <strong>{isParsingRepositoryImport ? "Reading files..." : "Choose CSV, source files, or ZIP"}</strong>
	                    <span>Supported: .csv, .zip, .js, .jsx, .ts, .tsx, .java, .cs</span>
	                    <input
	                      accept=".csv,.zip,.js,.jsx,.ts,.tsx,.java,.cs,text/csv,application/zip"
	                      disabled={isParsingRepositoryImport || importRepositoryEntries.isPending}
	                      multiple
	                      onChange={(event) => void handleRepositoryImportFiles(event)}
	                      type="file"
	                    />
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
	                  {repositoryImportPreview?.inputKinds.length ? (
	                    <div className="repository-import-metrics metric-strip" aria-label="Repository import metrics" role="group">
	                      {repositoryImportPreview.inputKinds.map((kind) => <StatusBadge key={kind} value={getRepositoryImportKindLabel(kind)} />)}
	                    </div>
	                  ) : null}
	                  {repositoryImportPreview?.warnings.length ? (
	                    <div className="empty-state compact">
	                      {repositoryImportPreview.warnings.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}
	                    </div>
	                  ) : null}
	                  {repositoryImportPreview?.entries.length ? (
	                    <div className="repository-import-preview-list">
	                      {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").slice(0, 8).map((entry) => (
	                        <article key={`${entry.screen_name}-${entry.object_name}-${entry.locator}`}>
	                          <strong>{entry.screen_name}.{entry.object_name}</strong>
	                          <code>{entry.locator}</code>
	                        </article>
	                      ))}
	                      {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").length > 8 ? (
	                        <small>And {repositoryImportPreview.entries.filter((entry) => entry.record_type === "field").length - 8} more fields.</small>
	                      ) : null}
	                    </div>
	                  ) : null}
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
	            </div>
	          ) : null}

          {canInspectRepository ? <RepositoryAgentSetup connection={inspectAgent} onUseRemote={inspectCapabilities.data?.remote.available && inspectRecorderSession?.status !== "running" && !isLaunchingInspectBrowser ? () => {
            setIsInspectOpen(true);
            void launchInspectBrowser("remote").catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start remote inspection browser."));
          } : undefined} /> : null}
	          {isInspectOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div className={`dialog object-repository-inspector${isInspectBrowserMaximized ? " is-browser-maximized" : ""}`} ref={repositoryInspectorRef} role="dialog" aria-modal="true" aria-label="Object repository inspector" tabIndex={-1}>
                <div className="dialog-header object-repository-inspector-header">
                  <div className="object-repository-inspector-title">
                    <h2>HelloTest Live builder</h2>
                    <span className={inspectRecorderSession?.status === "running" ? "is-connected" : ""}>{inspectRecorderSession?.status === "running" ? `${inspectSessionMode === "local" ? "Local" : "Remote"} session connected` : "Choose a browser session"}</span>
                  </div>
                  <div className="object-repository-inspector-toolbar" aria-label="Inspector controls">
                    <RepositoryInspectSessionControls
                      mode={inspectSessionMode}
                      recommendedMode={recommendedInspectMode}
                      localConnected={inspectAgent.state === "connected"}
                      remoteAvailable={inspectCapabilities.data?.remote.available === true}
                      remoteReason={inspectCapabilities.error instanceof Error ? inspectCapabilities.error.message : inspectCapabilities.data?.remote.reason || (inspectCapabilities.isFetching ? "Checking remote browser availability…" : undefined)}
                      busy={isLaunchingInspectBrowser || isClosingInspectBrowser}
                      disabled={!canInspectRepository}
                      running={inspectRecorderSession?.status === "running"}
                      onStart={mode => void launchInspectBrowser(mode).catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start inspection browser."))}
                      onStartBlank={mode => void launchInspectBrowser(mode, "").catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to start a blank inspection browser."))}
                      onClose={() => void closeInspectBrowser().catch(error => setInspectMessage(error instanceof Error ? error.message : "Unable to close inspection browser."))}
                      onSetup={inspectAgent.openSetup}
                    />
                    {canInspectRepository ? (<button
                      aria-label={isInspectingLiveField ? "Stop selecting fields" : "Select fields"}
                      title={isInspectingLiveField ? "Stop selecting fields" : "Select fields"}
                      aria-pressed={isInspectingLiveField}
                      className={isInspectingLiveField ? "primary-button compact is-active" : "primary-button compact"}
                      disabled={!canInspectRepository || saveInspectedScreenFields.isPending || isClosingInspectBrowser || (!inspectRecorderSession?.id && isLaunchingInspectBrowser)}
                      onClick={() => void (isInspectingLiveField ? stopLiveInspect() : startLiveInspect()).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to update inspect mode."))}
                      type="button"
                    >
                      {isInspectingLiveField ? <PauseIcon /> : <SelectionToggleIcon checked={false} />}
                      <span>{isInspectingLiveField ? "Stop selecting" : "Select fields"}</span>
                    </button>) : null}
                    <button aria-label="Save screen & fields" className="primary-button compact" disabled={saveInspectedScreenFields.isPending} onClick={() => saveInspectedScreenFields.mutate()} type="button">
                      <LayersIcon />
                      <span>{saveInspectedScreenFields.isPending ? "Saving..." : `Save${stagedInspectFields.length ? ` (${stagedInspectFields.length})` : " screen"}`}</span>
                    </button>
                    {canUseAutomationAi || dismissedInspectLocators.length ? <details className="object-repository-inspector-more">
                      <summary aria-label="More inspector actions" className="ghost-button compact" title="More actions">
                        <IconDots aria-hidden="true" size={18} />
                        <span>More</span>
                      </summary>
                      <div className="object-repository-inspector-more-menu">
                        {canUseAutomationAi ? <button className="ghost-button compact" disabled={(!screenDomDraft && !screenScreenshotDraft) || extractRepositoryFields.isPending} onClick={() => extractRepositoryFields.mutate()} type="button"><SparkIcon /><span>{extractRepositoryFields.isPending ? "Suggesting..." : "Suggest fields with AI"}</span></button> : null}
                        {dismissedInspectLocators.length ? <button className="ghost-button compact" onClick={restoreDismissedInspectFields} type="button"><RefreshIcon /><span>Restore hidden ({dismissedInspectLocators.length})</span></button> : null}
                      </div>
                    </details> : null}
                    <DialogCloseButton label="Close object repository inspector" onClick={closeRepositoryInspector} />
                  </div>
                </div>
                <div className="object-repository-inspector-body">
                <section className="object-repository-live-inspect">
                  <div className="object-repository-live-inspect-body">
                  <div className="object-repository-capture-workspace">
                    <section className="object-repository-browser-preview">
                      {inspectRecorderSession?.status !== "running" ? <label className="repository-inspect-destination">
                        <span>Page URL</span>
                        <input aria-label="Inspection page URL" type="text" inputMode="url" placeholder="https://your-application.com" value={screenUrlDraft} disabled={isLaunchingInspectBrowser} onChange={event => setScreenUrlDraft(event.target.value)} />
                        <small>Local sessions use this computer’s network. Remote sessions use the Test Engine’s network. Replace demo addresses with your application URL, or open a blank browser.</small>
                      </label> : null}
                      <RepositoryInspectBrowser
                        tabs={inspectTabs}
                        selectedTabId={selectedInspectTabId}
                        onSelectTab={(tabId) => void selectInspectTab(tabId).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to select browser tab."))}
                        onRefreshTabs={() => void refreshInspectTabs().catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to refresh browser tabs."))}
                        isRefreshingTabs={isRefreshingInspectTabs}
                        sessionId={inspectRecorderSession?.status === "running" ? inspectRecorderSession.id : ""}
                        liveUrl={inspectRecorderSession?.status === "running" ? inspectRecorderLiveUrl : ""}
                        emptyMessage={inspectCapabilities.isError ? "Remote browser availability could not be checked. Reopen the inspector to retry, or connect your local agent from the browser session menu." : inspectCapabilities.data?.remote.available === false && inspectAgent.state !== "connected" ? `${inspectCapabilities.data.remote.reason || "Remote browser is unavailable."} Choose Local session to connect an agent on this computer.` : undefined}
                      />
                      {focusedInspectField && focusedInspectPrimaryLocator ? (
                        <div className="object-repository-browser-locator-dock has-selection" aria-live="polite">
                            <span className="object-repository-locator-dock-icon"><IconTargetArrow aria-hidden="true" size={18} /></span>
                            <div className="object-repository-locator-dock-copy">
                              <span><strong>{focusedInspectField.name}</strong><small>{focusedInspectPrimaryLocator.strategy}</small></span>
                              <code title={focusedInspectPrimaryLocator.locator}>{focusedInspectPrimaryLocator.locator}</code>
                            </div>
                            <div className="object-repository-locator-health" title={focusedInspectPrimaryLocator.warning || "Validate this locator against the live page"}>
                              <IconShieldCheck aria-hidden="true" size={16} />
                              <span>{focusedInspectPrimaryLocator.matchCount === 1 ? "Unique" : focusedInspectPrimaryLocator.matchCount ? `${focusedInspectPrimaryLocator.matchCount} matches` : "Unchecked"}</span>
                            </div>
                            <div className="object-repository-locator-dock-actions">
                              <button className="ghost-button compact" onClick={() => void navigator.clipboard?.writeText(focusedInspectPrimaryLocator.locator)} type="button"><CopyIcon size={15} /><span>Copy</span></button>
                              <button className={highlightedInspectLocator === focusedInspectPrimaryLocator.locator ? "ghost-button compact is-active" : "ghost-button compact"} disabled={!inspectRecorderSession?.id} onClick={() => void highlightRepositoryLocator(focusedInspectPrimaryLocator.locator, focusedInspectField.name).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight locator."))} type="button"><MousePointerIcon size={15} /><span>{highlightedInspectLocator === focusedInspectPrimaryLocator.locator ? "Highlighted · 1s" : "Highlight · 1s"}</span></button>
                            </div>
                        </div>
                      ) : null}
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
                  <SubnavTabs
                    ariaLabel="Inspector review"
                    className="object-repository-inspector-review-tabs"
                    value={inspectReviewTab}
                    onChange={setInspectReviewTab}
                    items={[
                      { value: "candidates", label: "All fields", meta: String(inspectFieldInventory.length) },
                      { value: "selected", label: "Selected", meta: String(stagedInspectFields.length) },
                      { value: "evidence", label: "Evidence", meta: screenDomDraft || screenScreenshotDraft ? "1" : "0" }
                    ]}
                  />
                  {inspectReviewTab === "selected" ? (
                  <section className="object-repository-selected-fields object-repository-review-panel">
                    <div className="object-repository-inspector-section-head object-repository-selected-fields-head">
                      <span>
                        <strong>Selected fields <span className="selection-count">{stagedInspectFields.length}</span></strong>
                      </span>
                      <div className="object-repository-selection-actions">
                        <button className="ghost-button compact" disabled={!stagedInspectFields.length || !inspectRecorderSession?.id || validateInspectedFields.isPending || saveInspectedScreenFields.isPending} onClick={() => validateInspectedFields.mutate()} type="button"><IconShieldCheck aria-hidden="true" size={14} /><span>{validateInspectedFields.isPending ? "Checking…" : "Validate"}</span></button>
                        <button className="ghost-button compact" disabled={!stagedInspectFields.length || !inspectRecorderSession?.id} onClick={() => void syncInspectHighlights(stagedInspectFields, []).then(() => setInspectMessage("Highlighted selected fields for 1 second.")).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to preview selected fields."))} type="button"><MousePointerIcon size={14} /><span>Highlight all</span></button>
                        <button aria-label="Clear selected fields" className="ghost-button compact danger" disabled={!stagedInspectFields.length} onClick={removeAllStagedInspectFields} title="Clear selected fields" type="button"><TrashIcon size={14} /></button>
                      </div>
                    </div>
                    {focusedSelectedInspectField ? (
                      <div className="object-repository-selected-editor" aria-label={`Edit ${focusedSelectedInspectField.name}`}>
                        <label><span>Name</span><input value={focusedSelectedInspectField.name} onChange={(event) => updateStagedInspectField(focusedSelectedInspectField.locator, { name: event.target.value })} /></label>
                        <label><span>Primary locator</span><select value={focusedSelectedInspectField.locator} onChange={(event) => updateStagedInspectField(focusedSelectedInspectField.locator, { locator: event.target.value })}>{(focusedSelectedInspectField.locatorCandidates?.length ? focusedSelectedInspectField.locatorCandidates : [{ locator: focusedSelectedInspectField.locator, strategy: focusedSelectedInspectField.locatorKind, confidenceScore: 0.75, matchCount: undefined }]).map((candidate) => <option key={candidate.locator} value={candidate.locator}>{candidate.strategy} · {candidate.matchCount === 1 ? "unique" : candidate.matchCount ? `${candidate.matchCount} matches` : "Not validated"} · {candidate.locator}</option>)}</select></label>
                        <RepositoryLocatorBuilder key={focusedSelectedInspectField.locator} dom={focusedSelectedInspectField.dom} ancestorDom={focusedSelectedInspectField.ancestorDom} locator={focusedSelectedInspectField.locator} onUse={(locator) => updateStagedInspectField(focusedSelectedInspectField.locator, { locator, locatorKind: "css" })} />
                      </div>
                    ) : null}
                    <div className="object-repository-selected-grid">
                      {stagedInspectFields.map((field) => {
                        const locatorHealth = field.locatorCandidates?.[0];
                        const validationStatus = field.validationStatus || (locatorHealth?.matchCount === 1 ? "unique" : (locatorHealth?.matchCount || 0) > 1 ? "ambiguous" : "unverified");
                        const needsRepair = !["unique", "unverified"].includes(validationStatus);
                        return (
                        <article className={[focusedInspectField?.locator === field.locator ? "is-focused" : "", needsRepair ? "needs-repair" : ""].filter(Boolean).join(" ")} key={field.locator} onClick={() => setFocusedInspectLocator(field.locator)}>
                            <div>
                              <button aria-pressed={focusedInspectField?.locator === field.locator} className="link-button object-repository-selected-field-name" onClick={() => setFocusedInspectLocator(field.locator)} type="button">{field.name}</button>
                              <small>{field.locatorKind} · {locatorHealth?.matchCount === 1 ? "unique" : locatorHealth?.matchCount ? `${locatorHealth.matchCount} matches` : field.tag} · {field.locator}</small>
                            </div>
                            <span className={`object-repository-validation-pill is-${validationStatus}`} title={field.validationWarning || locatorHealth?.warning || "Use Validate to check this locator on the current page"}>
                              {validationStatus === "unique" ? "Unique" : validationStatus === "ambiguous" ? `${locatorHealth?.matchCount || 2}+ matches` : validationStatus === "missing" ? "Not found" : "Not validated"}
                            </span>
                            <div className="object-repository-field-actions">
                              {needsRepair ? (
                                <>
                                  <button className="ghost-button compact" onClick={(event) => { event.stopPropagation(); void reinspectField(field).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to reinspect the field.")); }} type="button"><MousePointerIcon size={14} /><span>{reinspectFieldLocator === field.locator ? "Click in browser" : "Reinspect"}</span></button>
                                  <button className="ghost-button compact" disabled={repairInspectedFieldWithAi.isPending} onClick={(event) => { event.stopPropagation(); repairInspectedFieldWithAi.mutate(field); }} type="button"><SparkIcon size={14} /><span>{repairInspectedFieldWithAi.isPending && repairInspectedFieldWithAi.variables?.locator === field.locator ? "Fixing..." : "Fix with AI"}</span></button>
                                </>
                              ) : (
                                <button className="ghost-button compact" onClick={(event) => { event.stopPropagation(); void highlightRepositoryLocator(field.locator, field.name, "", { retainExisting: true }).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight selected field.")); }} type="button"><MousePointerIcon size={14} /><span>Highlight</span></button>
                              )}
                              <button className="ghost-button compact danger" onClick={(event) => { event.stopPropagation(); removeStagedInspectField(field.locator); }} type="button"><TrashIcon size={14} /><span>Remove</span></button>
                            </div>
                          </article>
                        );
                      })}
                      {!stagedInspectFields.length ? <div className="empty-state compact">Select captured or suggested fields to save.</div> : null}
                    </div>
                  </section>
                  ) : null}
                  {inspectReviewTab === "evidence" ? (
                  <div className="object-repository-inspector-inputs">
                    <details className="object-repository-static-evidence object-repository-review-panel" open>
                      <summary>
                        <span>
                          <strong>Screen evidence</strong>
                          <small>{screenInfoDraft.screen_name || activeScreenName || "Screen identity"}</small>
                        </span>
                      </summary>
                      <label className="form-field">
                        <span>Page URL</span>
                        <input value={screenUrlDraft} onChange={(event) => setScreenUrlDraft(event.target.value)} placeholder="https://app.example.com/login" />
                      </label>
                      <label className="form-field">
                        <span>URL match rule</span>
                        <div className="repository-url-rule"><select value={screenInfoDraft.url_pattern_type} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={screenInfoDraft.url_pattern_value} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login" /></div>
                      </label>
                      <label className="form-field">
                        <span>Intended flow / business meaning</span>
                        <textarea rows={3} value={screenInfoDraft.business_meaning} onChange={(event) => setScreenInfoDraft((current) => ({ ...current, business_meaning: event.target.value }))} placeholder="Sign in, recover password, or continue as guest." />
                      </label>
                      <label className="form-field">
                        <span>Description</span>
                        <RichTextEditor appearance="canonical" rows={3} value={screenInfoDraft.description} onChange={(description) => setScreenInfoDraft((current) => ({ ...current, description }))} placeholder="Purpose and boundaries of this screen." />
                      </label>
                      <details className="object-repository-advanced-evidence">
                        <summary>Captured evidence</summary>
                      <div className="object-repository-evidence-preview">
                        {screenScreenshotDraft && isLikelyImageUrl(screenScreenshotDraft) ? <img alt="Latest inspected screen capture" src={screenScreenshotDraft} /> : <div className="empty-state compact">No screen capture yet.</div>}
                        <div>
                          <span><strong>{screenDomDraft.length.toLocaleString()}</strong> DOM characters</span>
                          <span><strong>{screenInfoDraft.screen_fingerprint ? "Ready" : "Pending"}</strong> fingerprint</span>
                          <span><strong>{screenInfoDraft.accessibility_tree ? "Ready" : "Pending"}</strong> accessibility tree</span>
                        </div>
                      </div>
                      <label className="form-field">
                        <span>Screen DOM</span>
                        <textarea rows={10} value={screenDomDraft} onChange={(event) => setScreenDomDraft(event.target.value)} placeholder="<input name='username' aria-label='Username' />" />
                      </label>
                      </details>
                    </details>
                  </div>
                  ) : null}
                  {inspectReviewTab === "candidates" ? (
                    <section className="object-repository-inspector-preview object-repository-review-panel">
                      <div className="object-repository-inspector-section-head object-repository-field-inventory-head">
                        <strong>Recognized fields <span className="selection-count">{inspectFieldInventory.length}</span></strong>
                        {browserInspectFields.length ? <button className="ghost-button compact" onClick={selectAllBrowserInspectFields} type="button"><SelectionToggleIcon checked /><span>Select captured</span></button> : null}
                      </div>
                      <div className="object-repository-suggestion-list">
                      {inspectFieldInventory.map((field) => {
                        const isSelected = selectedInspectLocatorSet.has(field.locator);
                        const locatorHealth = field.locatorCandidates?.[0];
                        const sourceLabel = field.source === "live_inspect" ? "Captured" : field.source === "ai_extract" ? "AI suggested" : "DOM detected";
                        const validationStatus = field.validationStatus || (locatorHealth?.matchCount === 1 ? "unique" : (locatorHealth?.matchCount || 0) > 1 ? "ambiguous" : "unverified");
                        const validationLabel = validationStatus === "unique"
                          ? "Unique"
                          : validationStatus === "ambiguous" ? `${locatorHealth?.matchCount || 2}+ matches`
                            : validationStatus === "missing" ? "Not found" : "Not validated";
                        return (
                          <article className={`object-repository-inspector-candidate${isSelected ? " is-selected" : ""}${highlightedInspectLocator === field.locator ? " is-highlighted" : ""}`} key={`${field.name}-${field.locator}`}>
                            <button className="object-repository-candidate-main" onClick={() => focusInspectField(field)} type="button">
                              <span className="object-repository-candidate-title">
                                <strong>{field.name}</strong>
                                <span className={`object-repository-source-pill is-${field.source || "dom_candidate"}`}>{sourceLabel}</span>
                                <span className={`object-repository-validation-pill is-${validationStatus}`} title={field.validationWarning || locatorHealth?.warning || "Use Validate to check this locator on the current page"}>{validationLabel}</span>
                              </span>
                              <small>{field.tag} · {field.locator}</small>
                            </button>
                            <div className="object-repository-candidate-actions">
                              <button aria-label={`Highlight ${field.name}`} className="ghost-button compact" disabled={!inspectRecorderSession?.id} onClick={() => void highlightRepositoryLocator(field.locator, field.name).catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to highlight field."))} title="Highlight in browser" type="button"><MousePointerIcon size={14} /></button>
                              <label className="repository-field-check"><input type="checkbox" aria-label={`Select ${field.name}`} checked={isSelected} onChange={(event) => event.target.checked ? stageInspectField(field) : removeStagedInspectField(field.locator)} /><span>{isSelected ? "Selected" : "Select"}</span></label>
                              {!isSelected ? <button aria-label={`Hide ${sourceLabel.toLowerCase()} field ${field.name}`} className="ghost-button compact danger" onClick={() => dismissInspectField(field)} title="Hide from this inspection" type="button"><TrashIcon size={14} /></button> : null}
                            </div>
                          </article>
                        );
                      })}
                      {!inspectFieldInventory.length ? <div className="empty-state compact">Select fields in the browser or run AI suggest.</div> : null}
                      </div>
                    </section>
                  ) : null}
                </aside>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isBatchAgentOpen ? <div className="modal-backdrop" onClick={() => { if (!scheduleAiAutomation.isPending) setIsBatchAgentOpen(false); }}>
        <div aria-label="Build with automation agent" aria-modal="true" className="modal-card resource-modal-card automation-batch-agent-dialog" onClick={(event) => event.stopPropagation()} ref={batchAgentDialogRef} role="dialog" tabIndex={-1}>
          <div className="modal-header"><div><h2>Build with automation agent</h2><p>{automationActionTargetIds.length} selected cases · Each result returns to its step plan.</p></div><DialogCloseButton disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)} /></div>
          <div className="resource-form"><div className="resource-form-body automation-agent-brief">
            <label className="form-field"><span>Build instructions (optional)</span><textarea onChange={(event) => setAgentMission(event.target.value)} rows={4} value={agentMission} placeholder="Each agent uses its case’s saved plan. Add instructions that apply to all selected cases." /></label>
            <div className="automation-plan-behavior-fields"><label className="form-field"><span>Start URL</span><input onChange={(event) => setStartUrl(event.target.value)} placeholder="Use selected environment" value={startUrl} /></label><label className="form-field"><span>Build time</span><input onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt} /><small className="muted">Leave empty to queue now.</small></label></div>
            <details><summary>Additional guidance & execution context</summary><div className="stack-list"><label className="form-field"><span>Guidance</span><textarea onChange={(event) => setBuilderContext(event.target.value)} rows={3} value={builderContext} /></label><ExecutionContextSelector appTypeId={appTypeId} projectId={projectId} onConfigurationChange={setSelectedExecutionConfigurationId} onDataSetChange={setSelectedExecutionDataSetId} onEnvironmentChange={setSelectedExecutionEnvironmentId} selectedConfigurationId={selectedExecutionConfigurationId} selectedDataSetId={selectedExecutionDataSetId} selectedEnvironmentId={selectedExecutionEnvironmentId} /></div></details>
            <label className="repository-field-check"><input type="checkbox" checked={allowBrowserActions} onChange={(event) => setAllowBrowserActions(event.target.checked)} /><span>Allow browser interactions while building Web steps (may submit forms)</span></label>
            <p className="muted">Each build includes its saved steps, expected results, accessible stories, reusable objects and selected execution context.</p>
          </div><div className="modal-footer"><button className="ghost-button" disabled={scheduleAiAutomation.isPending} onClick={() => setIsBatchAgentOpen(false)} type="button">Cancel</button>{canUseAutomationAi ? (<button className="primary-button" disabled={!automationActionTargetIds.length || !canUseAutomationAi || scheduleAiAutomation.isPending} onClick={() => scheduleAiAutomation.mutate()} type="button"><SparkIcon />{scheduleAiAutomation.isPending ? "Queueing…" : agentScheduledAt ? "Schedule builds" : "Build selected cases"}</button>) : null}</div></div>
        </div>
      </div> : null}

      {isCreateAutomationOpen && canCreateAutomationDraft ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={closeCreateAutomation} role="presentation">
          <div aria-modal="true" aria-labelledby="automation-create-dialog-title" className="modal-card resource-modal-card automation-create-dialog automation-authoring-create" onClick={(event) => event.stopPropagation()} ref={createAutomationDialogRef} role="dialog" tabIndex={-1}>
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <h2 className="dialog-title" id="automation-create-dialog-title">Create automation case</h2>
                <p>Define the case, link its coverage, and prepare the behavior to automate.</p>
              </div>
              <button aria-label="Close create automation case" className="ghost-button compact" disabled={createAutomationCase.isPending} onClick={closeCreateAutomation} type="button">Close</button>
            </div>
            <form className="resource-form" onSubmit={(event) => { event.preventDefault(); createAutomationCase.mutate(); }}>
              <div className="resource-form-body">
                <fieldset disabled={createAutomationCase.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <div className="automation-create-columns">
                    <div className="stack-list">
                      <AutomationCaseMetadata
                        {...metadataOptions}
                        disabled={createAutomationCase.isPending}
                        onChange={updateAutomationCreateMetadata}
                        value={{ ...automationCreateMetadata, manualCaseIds: automationCreateManualCaseIds }}
                      />
                      <section className="stack-list" aria-label="Creation method">
                        <strong>How would you like to build it?</strong>
                        <div className="automation-build-methods">
                          {canUseAutomationAi ? (<button aria-pressed={automationCreationMode === "ai"} disabled={!canUseAutomationAi} onClick={() => setAutomationCreationMode("ai")} type="button"><SparkIcon />Build with automation agent</button>) : null}
                          {canRecordCreation ? (<button aria-pressed={automationCreationMode === "record"} disabled={!canUseRecorder} onClick={() => setAutomationCreationMode("record")} type="button"><MousePointerIcon />Record flow</button>) : null}
                          <button aria-pressed={automationCreationMode === "blank"} onClick={() => setAutomationCreationMode("blank")} type="button"><PencilIcon />Author steps</button>
                        </div>
                        {automationCreationMode !== "blank" ? <label className="form-field"><span>Start URL</span><input onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com" value={startUrl} /></label> : null}
                        {automationCreationMode === "ai" ? (
                          <div className="automation-agent-brief">
                            <label className="form-field"><span>Build instructions (optional)</span><textarea onChange={(event) => setAgentMission(event.target.value)} placeholder="The linked cases and behavior plan are included. Add any priorities or constraints." rows={3} value={agentMission} /></label>
                            <label className="form-field"><span>Additional guidance</span><textarea onChange={(event) => setBuilderContext(event.target.value)} placeholder="Authentication, important assertions, edge cases, and repository preferences." rows={2} value={builderContext} /></label>{automationCreateRuntimeTypes.includes("web") ? <label className="repository-field-check"><input type="checkbox" checked={allowBrowserActions} onChange={(event) => setAllowBrowserActions(event.target.checked)} /><span>Allow the automation agent to interact with this application while building (may submit forms)</span></label> : null}
                            <label className="form-field"><span>Schedule build (optional)</span><input onChange={(event) => setAgentScheduledAt(event.target.value)} type="datetime-local" value={agentScheduledAt} /><small>Leave blank to queue the build after the case is saved.</small></label>
                            {!automationCreateManualCaseIds.length && !automationCreateSteps.some((step) => step.action.trim() || step.expected_result.trim()) ? <p className="muted">Link a source Test Case or add a step so the AI has behavior to build.</p> : null}
                          </div>
                        ) : <p className="muted">{automationCreationMode === "record" ? "The saved case opens in Build with Record flow selected." : "The saved case opens with its preconditions and steps ready to edit."}</p>}
                      </section>
                    </div>
                    <div className="automation-create-plan-panel">
                      <div><strong>Behavior plan</strong><p className="muted">All linked Test Cases contribute their preconditions, steps, and Shared Step Groups. Add any extra behavior below.</p></div>
                      {automationCreateManualCaseIds.length && createSourcesQuery.isPending ? <LoadingState label="Loading source Test Case plans" /> : null}
                      {automationCreateManualCaseIds.length && createSourcesQuery.isError ? <div className="empty-state compact" role="alert"><span>Source steps could not be loaded.</span><button className="ghost-button compact" onClick={() => void createSourcesQuery.refetch()} type="button">Retry source plans</button></div> : null}
                      {automationCreateManualCaseIds.map((sourceId) => {
                        const source = createSourcesQuery.data?.find((item) => item.testCase.id === sourceId);
                        if (!source) return null;
                        const preconditions = source.steps.filter(isAutomationPrecondition).length;
                        return <details className="automation-create-source-disclosure" key={sourceId}>
                          <summary><span><strong>{source.testCase.title}</strong><small>{preconditions} precondition{preconditions === 1 ? "" : "s"} · {source.steps.length - preconditions} step{source.steps.length - preconditions === 1 ? "" : "s"}</small></span></summary>
                          {source.steps.length ? <ol className="stack-list">{source.steps.map((step) => <li key={step.id}>
                            {step.group_name ? <small>{step.group_name}</small> : null}
                            <RichTextContent value={step.action || ""} />
                            {step.expected_result ? <div><small>Expected result</small><RichTextContent value={step.expected_result} /></div> : null}
                          </li>)}</ol> : <p className="muted">This source has no authored steps yet.</p>}
                        </details>;
                      })}
                      <AutomationDraftPlan allowedStepTypes={allowedStepTypes} defaultStepType={getDefaultAutomationStepType([], selectedRuntimeType)} availableParameters={automationCreateParameters.definitions} parameterValues={automationCreateParameters.values} onChange={setAutomationCreateSteps} value={automationCreateSteps} />
                    </div>
                  </div>
                </fieldset>
              </div>
              <div className="resource-form-footer">
                <button className="ghost-button" disabled={createAutomationCase.isPending} onClick={closeCreateAutomation} type="button">Cancel</button>
                {canCreateAutomationCase ? (<button className="primary-button" disabled={!automationCreateMetadata.title.trim() || createAutomationCase.isPending || (automationCreationMode === "record" && !canUseRecorder) || Boolean(automationCreateManualCaseIds.length && (createSourcesQuery.isPending || createSourcesQuery.isError)) || (automationCreationMode === "ai" && (!canUseAutomationAi || (!automationCreateManualCaseIds.length && !automationCreateSteps.some((step) => step.action.trim() || step.expected_result.trim()))))} type="submit">
                  <AddIcon /><span>{createAutomationCase.isPending ? "Creating..." : automationCreationMode === "ai" ? agentScheduledAt ? "Create and schedule build" : "Create and build with automation agent" : automationCreationMode === "record" ? "Create and open recorder" : "Create automation case"}</span>
                </button>) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isSharedGroupLibraryOpen ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={() => setIsSharedGroupLibraryOpen(false)} role="presentation">
          <div aria-modal="true" className="modal-card resource-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Shared Step Groups">
            <div className="resource-modal-header"><div className="resource-modal-title"><h2 className="dialog-title">Insert Shared Step Group</h2><p>Shared Step Groups retain their keyword code and stay traceable to the Shared Step Group library.</p></div><button className="ghost-button compact" onClick={() => setIsSharedGroupLibraryOpen(false)} type="button">Close</button></div>
            <div className="resource-form"><div className="resource-form-body stack-list">
              {sharedStepGroupsQuery.isLoading ? <LoadingState label="Loading Shared Step Groups" /> : null}
              {!sharedStepGroupsQuery.isLoading && !sharedStepGroups.length ? <div className="empty-state compact">No Shared Step Groups exist for this application yet. Select steps and save the selection as a Shared Step Group to create one.</div> : null}
              {sharedStepGroups.map((group) => (
                <button className="stack-item" disabled={insertAutomationSharedGroup.isPending} key={group.id} onClick={() => insertAutomationSharedGroup.mutate(group.id)} type="button">
                  <div><strong>{group.name}</strong><span>{group.steps?.length || 0} reusable step{group.steps?.length === 1 ? "" : "s"}</span></div><AddIcon />
                </button>
              ))}
            </div></div>
          </div>
        </div>
      ) : null}

      {automationStudioStep ? (
        <StepAutomationDialog
          availableParameters={detectedStepParameters}
          getParameterScopeState={resolveParameterInputState}
          objectRepository={learningCache}
          onClose={() => setAutomationStudioStep(null)}
          onSave={(input) => saveAutomationStudioStep.mutate({ step: automationStudioStep, input })}
          onSaveResponseValue={handleParameterValueChange}
          parameterValues={mergedParameterValues}
          step={automationStudioStep}
          subtitle="Configure this step’s keywords, repository fields, and data. Expand request settings for API details."
          title={`Step ${automationStudioStep.step_order || 1} automation studio`}
        />
      ) : null}

      {isAutomationCodePreviewOpen && activeCase ? (
        <CodePreviewDialog
          code={completeAutomationCode}
          objectRepository={learningCache}
          onClose={() => setIsAutomationCodePreviewOpen(false)}
          subtitle="Code for the current step plan, including structured API requests. Save edited steps before playback."
          title={`${activeCase.display_id || activeCase.id} automation code`}
        />
      ) : null}

      {isParameterDialogOpen ? (
        <StepParameterDialog
          getInputState={(parameter) => resolveParameterInputState(parameter.scope)}
          headerContent={(
            <div className="step-parameter-dialog-context">
              <div className="step-parameter-dialog-context-card">
                <strong>Automation test data</strong>
                <span>`@t` saves on this automation case, `@s` saves on the selected linked suite, and `@r` is supplied by the run context.</span>
              </div>
              {activeCaseSuiteIds.length ? (
                <div className="step-parameter-dialog-context-card">
                  <strong>Suite target</strong>
                  <div className="selection-chip-row">
                    {activeCaseSuiteIds.map((suiteId) => {
                      const suite = suites.find((item) => item.id === suiteId);
                      return (
                        <button
                          className={suiteId === selectedParameterSuiteId ? "selection-chip is-selected" : "selection-chip is-unselected"}
                          key={suiteId}
                          onClick={() => setSelectedParameterSuiteId(suiteId)}
                          type="button"
                        >
                          {suite?.name || suiteId}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          onChange={handleParameterValueChange}
          onClose={() => setIsParameterDialogOpen(false)}
          parameters={detectedStepParameters}
          subtitle="Use the same @t, @s, and @r data scopes as manual test cases."
          title="Automation case parameter values"
          values={mergedParameterValues}
        />
      ) : null}

      {repositoryUsageBlock ? (
        <div className="modal-backdrop" role="presentation">
          <div className="dialog object-repository-usage-dialog" role="dialog" aria-modal="true" aria-label="Repository usage">
            <div className="dialog-header">
              <div>
                <div className="modal-title-info-row">
                  <h2>{repositoryUsageBlock.title}</h2>
                  <InfoTooltip
                    content="This repository object is referenced by the test cases below. Deleting it will keep the cases, mark automated ones incomplete, and prevent execution until their bindings are repaired."
                    label="Repository usage information"
                  />
                </div>
              </div>
              <button className="ghost-button compact" onClick={() => setRepositoryUsageBlock(null)} type="button">Close</button>
            </div>
            <div className="stack-list">
              {repositoryUsageBlock.usage.map((testCase) => (
                <button className="stack-item" key={testCase.id} onClick={() => navigate(testCase.automated === "yes" ? `/automation?case=${encodeURIComponent(testCase.id)}` : `/test-cases?case=${encodeURIComponent(testCase.id)}`)} type="button">
                  <div>
                    <strong>{testCase.title}</strong>
                    <span>{testCase.display_id || testCase.id} · {testCase.automated === "yes" ? "Automation case" : "Manual case"}</span>
                  </div>
                  <OpenIcon size={16} />
                </button>
              ))}
            </div>
            <div className="testops-action-row">
              <button
                className="primary-button danger"
                disabled={deleteRepositoryEntry.isPending || deleteRepositoryScreen.isPending}
                onClick={() => repositoryUsageBlock.kind === "field" ? deleteRepositoryEntry.mutate(true) : deleteRepositoryScreen.mutate(true)}
                type="button"
              >
                <TrashIcon size={16} />
                <span>Delete and mark incomplete</span>
              </button>
              <button className="ghost-button" onClick={() => setRepositoryUsageBlock(null)} type="button">Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
