import { formatRunDate, normalizeMetadataValue, getScreenName, makeRepositoryScreenKey, getRepositoryScreenKey, getObjectName, getObjectRole, splitRepositoryRole, getRepositoryScreenUrl, toFriendlyElementName, isNoisyRepositoryName, isNonElementRepositoryEntry, isScreenRepositoryRecord, getRepositoryMemberName, getRepositoryHtmlTag, isLikelyImageUrl, formatRepositoryDate } from "./repositoryEntryPresentation";
export { formatRunDate, normalizeMetadataValue, getScreenName, makeRepositoryScreenKey, getRepositoryScreenKey, getObjectName, getObjectRole, splitRepositoryRole, getRepositoryScreenUrl, toFriendlyElementName, isNoisyRepositoryName, isNonElementRepositoryEntry, isScreenRepositoryRecord, getRepositoryMemberName, getRepositoryHtmlTag, isLikelyImageUrl, formatRepositoryDate } from "./repositoryEntryPresentation";
/** Shared automation authoring/repository contracts and stateless UI support.
 * Route controllers own state, queries, mutations and lifecycle effects. */
import { automationQueryKeys } from "../lib/automationQueryKeys";
import { useId, type ReactNode } from "react";
import { type RepositoryLocalAgent } from "@hellotest/automation/frontend/hooks/useRepositoryInspectAgent";
import { inspectSessionRequest } from "@hellotest/automation/frontend/lib/repositoryInspectSession";
import type { ObjectRepositoryImportPreview } from "../lib/objectRepositoryImport";
import { createAutomationOptionalModule } from "../lib/automationOptionalModule";
import { normalizeStepParameterValues, type StepParameterScope } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AutomationCaseType, AutomationLearningCacheEntry, RecorderSessionResponse, TestCase, TestStep } from "@hellotest/platform/frontend/src/types";

export type AutomationView = "cases" | "repository";
export type AutomationCaseSectionKey = "case" | "build" | "steps" | "history";
export type AutomationWorkspaceTab = "details" | "steps" | "data" | "hooks" | "build" | "repository" | "runs" | "history" | "suites" | "defects";
export type AutomationStepView = "keyword" | "code" | "gherkin";
export type AutomationCreationMode = "ai" | "record" | "blank";
export type RepositoryScreenTab = "overview" | "fields" | "dom";
export type RepositoryFieldTab = "locators" | "evidence" | "meaning" | "healing";
export type RepositoryInspectReviewTab = "selected" | "candidates" | "evidence";
export const REPOSITORY_CONFIG_DRAWER_DEFAULT_WIDTH = 440;
export const REPOSITORY_CONFIG_DRAWER_MIN_WIDTH = 360;
export const REPOSITORY_CONFIG_DRAWER_MAX_WIDTH = 720;
export const AUTOMATION_CASE_DETAIL_STALE_TIME_MS = 30_000;
export const REPOSITORY_HIGHLIGHT_DURATION_MS = 3_000;

export const automationCaseDetailQueryKey = automationQueryKeys.caseDetail;

export const clampRepositoryConfigDrawerWidth = (value: number) =>
  Math.min(REPOSITORY_CONFIG_DRAWER_MAX_WIDTH, Math.max(REPOSITORY_CONFIG_DRAWER_MIN_WIDTH, value));

export const normalizeAutomationParameterValues = (values?: Record<string, unknown> | null, scope: StepParameterScope = "t") =>
  normalizeStepParameterValues((values || {}) as Record<string, string>, scope);

export type AutomationCaseDraft = {
  automationCaseType: AutomationCaseType | "";
  title: string;
  description: string;
  status: string;
  priority: string;
};

export const REPOSITORY_PAGE_SIZE = 200;
export const repositoryImporter = /* @__PURE__ */ createAutomationOptionalModule(() => import("../lib/objectRepositoryImport"));

export type RecorderTab = {
  id: string | null;
  title: string | null;
  url: string;
  active?: boolean;
};

export type RecorderInspectResult = {
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

export type RecorderLocatorValidationResponse = {
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

export type RecorderInspectElement = {
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

export type RecorderInspectSelection = {
  element: RecorderInspectElement;
  element_screenshot_url?: string | null;
  ancestor_screenshot_url?: string | null;
};

export function isAutomatedCase(testCase: TestCase) {
  return testCase.automated === "yes";
}

export function isManualCase(testCase: TestCase) {
  return testCase.automated === "no";
}

export function normalizeMetadataNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function metadataStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

export type RepositoryLocator = {
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

export function inferLocatorStrategy(locator: string, kind?: string | null) {
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

export function getRepositoryLocators(entry: AutomationLearningCacheEntry): RepositoryLocator[] {
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

export function formatLocatorDraft(locators: RepositoryLocator[]) {
  return locators.filter((locator) => locator.isFallback).map((locator) =>
    `${locator.strategy} | ${locator.locator} | ${Math.round(locator.confidenceScore * 100)}`
  ).join("\n");
}

export function parseLocatorDraft(value: string): RepositoryLocator[] {
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

export function inferScreenName(title: string | null, url: string | null) {
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

export function inferUrlPattern(url: string | null) {
  try {
    const path = new URL(String(url || "")).pathname;
    return { type: "endsWith", value: path || "/" };
  } catch {
    return { type: "contains", value: url || "" };
  }
}

export function getCapturedLocatorsForElement(element: RecorderInspectElement): RepositoryLocator[] {
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

export function getCapturedLocators(result: RecorderInspectResult): RepositoryLocator[] {
  return getCapturedLocatorsForElement(result.element);
}

export function getRepositoryImportKindLabel(kind: ObjectRepositoryImportPreview["inputKinds"][number]) {
  if (kind === "csv") return "CSV export";
  if (kind === "zip") return "ZIP archive";
  return "Page object source";
}

export function extractQuotedTargets(code?: string | null) {
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

export function extractVariables(step: TestStep) {
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

export function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

export function buildSuggestedFieldName(entry: AutomationLearningCacheEntry) {
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

export function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg aria-hidden="true" className={isExpanded ? "accordion-chevron is-expanded" : "accordion-chevron"} viewBox="0 0 20 20">
      <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

export function AutomationAccordionSection({
  actions,
  children,
  countLabel,
  isExpanded,
  onToggle,
  stage,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  countLabel?: string;
  isExpanded: boolean;
  onToggle: () => void;
  stage?: AutomationCaseSectionKey;
  title: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section aria-label={typeof title === "string" ? title : undefined} className={["editor-accordion-section", title === "Preconditions" || title === "Steps" ? "automation-program-flow" : "", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} data-automation-stage={stage}>
      <div className="editor-accordion-head">
        <button aria-controls={isExpanded ? bodyId : undefined} aria-expanded={isExpanded} className="editor-accordion-toggle" onClick={onToggle} type="button">
          <div className="editor-accordion-toggle-main">
            <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}><svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18"><path d="m9 5 7 7-7 7" /></svg></span>
            <div className="editor-accordion-toggle-copy"><strong>{title}</strong></div>
          </div>
        </button>
        <div className="editor-accordion-toggle-meta">
          {countLabel ? <span className="editor-accordion-toggle-count">{countLabel}</span> : null}
          {actions ? <div className="automation-plan-accordion-actions">{actions}</div> : null}
        </div>
      </div>
      {isExpanded ? <div className="editor-accordion-body" id={bodyId}>{children}</div> : null}
    </section>
  );
}

export function getAutomationStepTypeLabel(step: TestStep) {
  const value = step.step_type || "web";
  return value === "android" ? "Android" : value === "ios" ? "iOS" : value.toUpperCase();
}

export function getRecorderEngineBaseUrl(session: RecorderSessionResponse | null) {
  const source = session?.status_url || session?.live_view_url || session?.engine_base_url || "";
  const match = source.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1] || "";
}

export async function readRecorderJson<T>(url: string, options?: RequestInit) {
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

export async function readInspectSessionJson<T>(session: RecorderSessionResponse, path: string, options?: RequestInit) {
  const request = inspectSessionRequest(session, path, options);
  return readRecorderJson<T>(request.url, request.options);
}

export function connectLocalInspectSession(runtime: RepositoryLocalAgent, session: RecorderSessionResponse) {
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

export function extractRepositoryFieldsFromDom(dom: string) {
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

export type RepositoryExtractedField = ReturnType<typeof extractRepositoryFieldsFromDom>[number] & {
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

export function getInspectSelections(result: RecorderInspectResult): RecorderInspectSelection[] {
  return result.selections?.length
    ? result.selections
    : [{
        element: result.element,
        element_screenshot_url: result.element_screenshot_url,
        ancestor_screenshot_url: result.ancestor_screenshot_url
      }];
}

export function buildRepositoryFieldFromInspectSelection(result: RecorderInspectResult, selection: RecorderInspectSelection): RepositoryExtractedField {
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
