import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AddIcon, CopyIcon, LayersIcon, MousePointerIcon, OpenIcon, PauseIcon, PlayIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StatusBadge } from "../components/StatusBadge";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { SubnavTabs } from "../components/SubnavTabs";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardRunsIcon,
  TileCardStepsIcon,
  getTileCardTone
} from "../components/TileCardPrimitives";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import {
  collectStepParameters,
  combineStepParameterValues,
  normalizeStepParameterValues,
  parseStepParameterName,
  type StepParameterScope
} from "../lib/stepParameters";
import type { AutomationLearningCacheEntry, ExecutionResult, Integration, RecorderSessionResponse, TestCase, TestStep, TestSuite } from "../types";

type AutomationView = "cases" | "repository" | "local-playwright";
type AutomationCaseSectionKey = "case" | "steps" | "history";
type AutomationStepView = "keyword" | "code";
type RepositoryScreenTab = "fields" | "dom" | "suggestions" | "usage" | "validation";
type RepositoryFieldTab = "locators" | "evidence" | "meaning" | "validation";
const AUTOMATION_MANUAL_LINKS_STORAGE_KEY = "qaira.automationManualLinks.v1";
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
  keyword: string;
  objectRef: string;
  value: string;
  expected_result: string;
};

type AutomationHookTargetDraft = {
  type: "test_case" | "test_step" | "suite";
  id: string;
};

type AutomationStepOptions = {
  screenshotOnFailure: boolean;
  optional: boolean;
  skip: boolean;
};

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
  element: {
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
    }>;
    text: string | null;
  };
};

const createDefaultAutomationDraft = () => ({
  title: "",
  description: "",
  start_url: "",
  keyword_step: "",
  expected_result: ""
});

const formatRunDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function isAutomatedCase(testCase: TestCase) {
  return testCase.automated === "yes";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated !== "yes";
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

function getCapturedLocators(result: RecorderInspectResult): RepositoryLocator[] {
  const captured = result.element.locator_candidates || [];
  if (captured.length) {
    return captured.map((candidate, index) => ({
      locator: candidate.locator,
      strategy: candidate.strategy,
      confidenceScore: candidate.confidenceScore,
      isPrimary: index === 0,
      isFallback: index > 0,
      lastValidatedStatus: "pending"
    }));
  }

  return [{
    locator: result.element.locator,
    strategy: inferLocatorStrategy(result.element.locator, result.element.locator_kind),
    confidenceScore: result.element.locator.includes("data-testid") ? 0.95 : 0.75,
    isPrimary: true,
    lastValidatedStatus: "pending"
  }];
}

function getScreenName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.screen_name) || entry.page_key || "Unassigned screen";
}

function getObjectName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_name) || entry.locator_intent || "Unnamed object";
}

function getObjectRole(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_role) || entry.locator_kind || entry.source || "field";
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
  return entries.find((entry) => entry.page_url)?.page_url || entries[0]?.page_key || "No URL captured";
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
  summary,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  countLabel?: string;
  isExpanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={["editor-accordion-section", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")}>
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
  return blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
}

function getRepositoryMemberName(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
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

function parseAutomationHookLines(value: string, phase: "pre" | "post") {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((command, index) => ({
      id: `${phase}-${index + 1}`,
      phase,
      type: "keyword",
      command
    }));
}

function buildAutomationHookTarget(
  phase: "pre" | "post",
  target: AutomationHookTargetDraft,
  label: string
) {
  if (!target.id) {
    return [];
  }

  return [{
    id: `${phase}-${target.type}-${target.id}`,
    phase,
    type: target.type,
    target_id: target.id,
    label
  }];
}

function parseAutomationStepOptions(step: TestStep): AutomationStepOptions {
  const code = step.automation_code || step.action || "";
  const optionMatch = code.match(/@qaira-options\s+([^\n]+)/i);
  const flags = new Set((optionMatch?.[1] || "").split(/\s+/).filter(Boolean));

  return {
    screenshotOnFailure: flags.has("screenshotOnFailure"),
    optional: flags.has("optional"),
    skip: flags.has("skip")
  };
}

function applyAutomationStepOptions(code: string, options: AutomationStepOptions) {
  const cleaned = code.replace(/^\s*\/\/\s*@qaira-options\s+[^\n]*\n?/i, "").trim();
  const flags = [
    options.screenshotOnFailure ? "screenshotOnFailure" : "",
    options.optional ? "optional" : "",
    options.skip ? "skip" : ""
  ].filter(Boolean);

  return flags.length ? `// @qaira-options ${flags.join(" ")}\n${cleaned}` : cleaned;
}

function getAutomationStepTypeLabel(step: TestStep) {
  const value = step.step_type || "web";
  return value === "android" ? "Android" : value === "ios" ? "iOS" : value.toUpperCase();
}

function getRecorderEngineBaseUrl(session: RecorderSessionResponse | null) {
  const source = session?.status_url || session?.live_view_url || session?.engine_base_url || "";
  const match = source.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1] || "";
}

async function readRecorderJson<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers || {})
    }
  });

  if (response.status === 204) {
    return null as T | null;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  return payload as T;
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
      || (tag === "textarea" || (tag === "input" && !["checkbox", "radio"].includes(inputType)) ? "textbox" : "")
      || (tag === "input" && ["checkbox", "radio"].includes(inputType) ? inputType : "");
    const locatorCandidates = ([
      attrs["data-testid"] ? { locator: `[data-testid="${attrs["data-testid"]}"]`, strategy: "data-testid", confidenceScore: 0.98 } : null,
      attrs["aria-label"] ? { locator: `${tag}[aria-label="${attrs["aria-label"]}"]`, strategy: "aria-label", confidenceScore: 0.94 } : null,
      semanticRole && label ? { locator: `role=${semanticRole}[name="${label}"]`, strategy: "role + name", confidenceScore: 0.92 } : null,
      attrs.id ? { locator: `#${attrs.id}`, strategy: "stable id", confidenceScore: 0.88 } : null,
      attrs.name ? { locator: `${tag}[name="${attrs.name}"]`, strategy: "name attribute", confidenceScore: 0.84 } : null,
      attrs.placeholder ? { locator: `${tag}[placeholder="${attrs.placeholder}"]`, strategy: "placeholder", confidenceScore: 0.78 } : null,
      tag === "button" || tag === "a" ? { locator: `text=${label}`, strategy: "text", confidenceScore: 0.7 } : null,
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

function parseAutomationStepDraft(step: TestStep): AutomationStepDraft {
  const code = step.automation_code || "";
  const match = code.match(/web\.(\w+)\(([\s\S]*)\)/);
  const keyword = match?.[1] ? `web.${match[1]}` : "web.click";
  const args = match?.[2] || "";
  const quoted = Array.from(args.matchAll(/(['"`])([\s\S]*?)\1/g)).map((item) => item[2]);

  return {
    keyword,
    objectRef: quoted[0] || "",
    value: quoted[1] || "",
    expected_result: step.expected_result || ""
  };
}

function buildAutomationCodeFromDraft(draft: AutomationStepDraft) {
  const objectRef = draft.objectRef || "Page.element";
  const value = draft.value.trim();
  if (draft.keyword === "web.goto" || draft.keyword === "web.expectUrl") {
    return `await ${draft.keyword}("${value || objectRef}");`;
  }
  if (draft.keyword === "web.wait" || draft.keyword === "web.waitForTimeout") {
    return `await web.wait(${Math.max(0, Number.parseInt(value || objectRef, 10) || 1000)});`;
  }
  if (draft.keyword === "web.press" && !objectRef) {
    return `await web.press(null, "${value || "Tab"}");`;
  }
  if (["web.fill", "web.select", "web.press", "web.expectText"].includes(draft.keyword)) {
    return `await ${draft.keyword}("${objectRef}", "${value}");`;
  }
  return `await ${draft.keyword}("${objectRef}");`;
}

export function AutomationPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [view, setView] = useState<AutomationView>("cases");
  const [selectedAutomatedCaseId, setSelectedAutomatedCaseId] = useState("");
  const [selectedManualCaseId, setSelectedManualCaseId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [expandedCaseSections, setExpandedCaseSections] = useState<Record<AutomationCaseSectionKey, boolean>>({
    case: true,
    steps: true,
    history: false
  });
  const [automationStepView, setAutomationStepView] = useState<AutomationStepView>("keyword");
  const [expandedAutomationStepIds, setExpandedAutomationStepIds] = useState<string[]>([]);
  const [caseDraft, setCaseDraft] = useState<AutomationCaseDraft>({
    title: "",
    description: "",
    status: "active",
    priority: "3",
    parameterText: ""
  });
  const [stepDrafts, setStepDrafts] = useState<Record<string, AutomationStepDraft>>({});
  const [stepCodeDrafts, setStepCodeDrafts] = useState<Record<string, string>>({});
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
  const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
  const [selectedParameterSuiteId, setSelectedParameterSuiteId] = useState("");
  const [suiteLinkDraftIds, setSuiteLinkDraftIds] = useState<string[]>([]);
  const [preHookText, setPreHookText] = useState("");
  const [postHookText, setPostHookText] = useState("");
  const [preHookTarget, setPreHookTarget] = useState<AutomationHookTargetDraft>({ type: "test_case", id: "" });
  const [postHookTarget, setPostHookTarget] = useState<AutomationHookTargetDraft>({ type: "test_case", id: "" });
  const [stepOptionDrafts, setStepOptionDrafts] = useState<Record<string, AutomationStepOptions>>({});
  const [newStepDraft, setNewStepDraft] = useState<AutomationStepDraft>({
    keyword: "web.click",
    objectRef: "",
    value: "",
    expected_result: ""
  });
  const [manualCaseLinks, setManualCaseLinks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(AUTOMATION_MANUAL_LINKS_STORAGE_KEY) || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [isCreatingAutomationCase, setIsCreatingAutomationCase] = useState(false);
  const [automationDraft, setAutomationDraft] = useState(createDefaultAutomationDraft);
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [message, setMessage] = useState("");
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedScreenName, setSelectedScreenName] = useState("");
  const [screenDetailTab, setScreenDetailTab] = useState<RepositoryScreenTab>("fields");
  const [fieldDetailTab, setFieldDetailTab] = useState<RepositoryFieldTab>("locators");
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [inspectTabs, setInspectTabs] = useState<RecorderTab[]>([]);
  const [selectedInspectTabId, setSelectedInspectTabId] = useState("");
  const [isInspectingLiveField, setIsInspectingLiveField] = useState(false);
  const [inspectMessage, setInspectMessage] = useState("");
  const [lastInspectResult, setLastInspectResult] = useState<RecorderInspectResult | null>(null);
  const [repositoryUsageBlock, setRepositoryUsageBlock] = useState<{
    title: string;
    usage: Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>;
  } | null>(null);
  const [screenDomDraft, setScreenDomDraft] = useState("");
  const [screenScreenshotDraft, setScreenScreenshotDraft] = useState("");
  const [screenUrlDraft, setScreenUrlDraft] = useState("");
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

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    enabled: Boolean(session)
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-workspace", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 200
    }),
    enabled: Boolean((projectId || appTypeId) && session)
  });
  const repositoryContextQuery = useQuery({
    queryKey: ["automation-repository-context", projectId, appTypeId],
    queryFn: () => api.testCases.repositoryContext({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 200
    }),
    enabled: Boolean((projectId || appTypeId) && session && view === "repository")
  });
  const automatedStepsQuery = useQuery({
    queryKey: ["test-steps", "automation-workspace", selectedCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedCaseId }),
    enabled: Boolean(selectedCaseId && session)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["execution-results", "automation-workspace", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "automation-workspace"],
    queryFn: () => api.integrations.list({ is_active: true }),
    enabled: Boolean(session)
  });
  const suitesQuery = useQuery({
    queryKey: ["test-case-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const learningCache = learningCacheQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const suites = suitesQuery.data || [];
  const llmIntegration = useMemo(() => {
    const active = integrations.filter((integration: Integration) => integration.type === "llm" && integration.is_active);
    return active.find((integration) => String(integration.config?.project_id || "") === projectId) || active[0] || null;
  }, [integrations, projectId]);
  const automatedCases = useMemo(() => testCases.filter(isAutomatedCase), [testCases]);
  const automationDisplayIdByCaseId = useMemo(
    () => automatedCases.reduce<Record<string, string>>((accumulator, testCase, index) => {
      accumulator[testCase.id] = formatAutomationCaseId(index);
      return accumulator;
    }, {}),
    [automatedCases]
  );
  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const activeAutomatedCase = automatedCases.find((testCase) => testCase.id === selectedAutomatedCaseId) || automatedCases[0] || null;
  const activeCase = automatedCases.find((testCase) => testCase.id === selectedCaseId) || null;
  const isAutomationCaseWorkspaceOpen = Boolean(activeCase);
  const activeManualCase = manualCases.find((testCase) => testCase.id === selectedManualCaseId) || manualCases[0] || null;
  const automatedSteps = automatedStepsQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
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
  const activeCaseHistory = activeCase ? historyByCaseId[activeCase.id] || [] : [];
  const activeCaseSuiteIds = useMemo(() => activeCase?.suite_ids || (activeCase?.suite_id ? [activeCase.suite_id] : []), [activeCase]);
  const selectedParameterSuite = suites.find((suite) => suite.id === selectedParameterSuiteId) || null;
  const mergedParameterValues = useMemo(
    () => combineStepParameterValues(testCaseParameterValues, suiteParameterValues),
    [suiteParameterValues, testCaseParameterValues]
  );
  const detectedStepParameters = useMemo(
    () => collectStepParameters(automatedSteps.map((step) => ({
      id: step.id,
      action: stepDrafts[step.id] ? buildAutomationCodeFromDraft(stepDrafts[step.id]) : step.action,
      expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
      automation_code: stepCodeDrafts[step.id] ?? step.automation_code,
      api_request: step.api_request
    }))),
    [automatedSteps, stepCodeDrafts, stepDrafts]
  );
  const linkedManualCase = activeCase ? testCases.find((testCase) => testCase.id === manualCaseLinks[activeCase.id]) || null : null;
  const hookTargetLabelByKey = useMemo(() => {
    const map: Record<string, string> = {};
    testCases.forEach((testCase) => {
      map[`test_case:${testCase.id}`] = testCase.display_id ? `${testCase.display_id} · ${testCase.title}` : testCase.title;
    });
    automatedSteps.forEach((step) => {
      map[`test_step:${step.id}`] = `Step ${step.step_order} · ${step.action || step.automation_code || "Automation step"}`;
    });
    suites.forEach((suite) => {
      map[`suite:${suite.id}`] = suite.display_id ? `${suite.display_id} · ${suite.name}` : suite.name;
    });
    return map;
  }, [automatedSteps, suites, testCases]);
  const selectedRepositoryEntry = learningCache.find((entry) => entry.id === selectedRepositoryId) || learningCache[0] || null;
  const selectedRepositoryUsageQuery = useQuery({
    queryKey: ["automation-learning-cache-usage", selectedRepositoryEntry?.id],
    queryFn: () => api.testCases.learningCacheUsage(selectedRepositoryEntry!.id),
    enabled: Boolean(selectedRepositoryEntry?.id && view === "repository")
  });
  const groupedRepository = useMemo(() => {
    const grouped = new Map<string, AutomationLearningCacheEntry[]>();

    learningCache.forEach((entry) => {
      const screenName = getScreenName(entry);
      grouped.set(screenName, [...(grouped.get(screenName) || []), entry]);
    });

    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [learningCache]);
  const activeScreenEntries = useMemo(() => {
    const selected = groupedRepository.find(([screenName]) => screenName === selectedScreenName);
    return selected?.[1] || groupedRepository[0]?.[1] || [];
  }, [groupedRepository, selectedScreenName]);
  const activeScreenName = groupedRepository.find(([screenName]) => screenName === selectedScreenName)?.[0] || groupedRepository[0]?.[0] || "";
  const pageObjectModels = useMemo(() => {
    return groupedRepository.map(([screenName, entries]) => {
      const members = entries.filter((entry) => !isNonElementRepositoryEntry(entry)).map((entry) => ({
        entry,
        pageName: screenName,
        memberName: getRepositoryMemberName(entry),
        htmlTag: getRepositoryHtmlTag(entry),
        role: getObjectRole(entry),
        ref: `${screenName}.${getRepositoryMemberName(entry)}`
      }));

      return {
        screenName,
        pageName: screenName,
        url: getRepositoryScreenUrl(entries),
        members
      };
    });
  }, [groupedRepository]);
  const activePageObject = pageObjectModels.find((page) => page.screenName === selectedScreenName) || pageObjectModels[0] || null;
  const allObjectMembers = useMemo(() => pageObjectModels.flatMap((page) => page.members), [pageObjectModels]);
  const inspectedFields = useMemo(() => extractRepositoryFieldsFromDom(screenDomDraft), [screenDomDraft]);
  const recorderLiveUrl = recorderSession?.live_view_url || "";
  const selectedRepositoryUsage = selectedRepositoryUsageQuery.data || [];
  const activeScreenMetadata = (activeScreenEntries[0]?.metadata || {}) as Record<string, unknown>;
  const selectedLocators = selectedRepositoryEntry ? getRepositoryLocators(selectedRepositoryEntry) : [];
  const selectedValidationHistory = Array.isArray(selectedRepositoryEntry?.metadata?.validation_history)
    ? selectedRepositoryEntry.metadata.validation_history.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];

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
      setRecorderSession(null);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    const requestedCaseId = searchParams.get("case") || "";
    if (!requestedCaseId || selectedCaseId === requestedCaseId || testCasesQuery.isLoading || testCasesQuery.isFetching) {
      return;
    }

    const requestedCase = automatedCases.find((testCase) => testCase.id === requestedCaseId);
    if (requestedCase) {
      setView("cases");
      setSelectedCaseId(requestedCase.id);
      setSelectedAutomatedCaseId(requestedCase.id);
      setExpandedCaseSections((current) => ({ ...current, case: true, steps: true }));
    }
  }, [automatedCases, searchParams, selectedCaseId, testCasesQuery.isFetching, testCasesQuery.isLoading]);

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
    if (selectedRepositoryEntry && selectedRepositoryId !== selectedRepositoryEntry.id) {
      setSelectedRepositoryId(selectedRepositoryEntry.id);
    }
  }, [selectedRepositoryEntry, selectedRepositoryId]);

  useEffect(() => {
    if (activeScreenName && selectedScreenName !== activeScreenName) {
      setSelectedScreenName(activeScreenName);
    }
  }, [activeScreenName, selectedScreenName]);

  useEffect(() => {
    if (!selectedRepositoryEntry) {
      return;
    }

    const metadata = selectedRepositoryEntry.metadata || {};
    setScreenDomDraft(normalizeMetadataValue(metadata.screen_dom_compressed));
    setScreenScreenshotDraft(normalizeMetadataValue(metadata.screen_screenshot_url));
    setScreenUrlDraft(selectedRepositoryEntry.page_url || selectedRepositoryEntry.page_key || "");
    setRepositoryDraft({
      screen_name: normalizeMetadataValue(metadata.screen_name),
      object_name: getRepositoryMemberName(selectedRepositoryEntry),
      object_role: `${getRepositoryHtmlTag(selectedRepositoryEntry)} / ${getObjectRole(selectedRepositoryEntry)}`,
      locator: selectedRepositoryEntry.locator || "",
      locator_kind: selectedRepositoryEntry.locator_kind || "",
      target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.join("\n") : normalizeMetadataValue(metadata.target_criteria),
      dom_structure: normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html),
      screenshot_url: normalizeMetadataValue(metadata.screenshot_url) || normalizeMetadataValue(metadata.screenshot_path),
      fallback_strategy: normalizeMetadataValue(metadata.fallback_strategy),
      url_pattern_type: normalizeMetadataValue(metadata.url_pattern_type) || "contains",
      url_pattern_value: normalizeMetadataValue(metadata.url_pattern_value) || selectedRepositoryEntry.page_url || selectedRepositoryEntry.page_key || "",
      screen_fingerprint: normalizeMetadataValue(metadata.screen_fingerprint),
      accessibility_tree: normalizeMetadataValue(metadata.accessibility_tree),
      fallback_locators: formatLocatorDraft(getRepositoryLocators(selectedRepositoryEntry)),
      description: normalizeMetadataValue(metadata.description),
      business_meaning: normalizeMetadataValue(metadata.business_meaning),
      usage_keywords: metadataStringArray(metadata.usage_keywords).join(", "),
      stability_score: String(Math.round(normalizeMetadataNumber(metadata.stability_score, selectedRepositoryEntry.confidence) * 100)),
      ancestor_dom: normalizeMetadataValue(metadata.ancestor_dom),
      ancestor_screenshot_url: normalizeMetadataValue(metadata.ancestor_screenshot_url),
      element_screenshot_url: normalizeMetadataValue(metadata.element_screenshot_url) || normalizeMetadataValue(metadata.screenshot_url)
    });
  }, [selectedRepositoryEntry?.id]);

  useEffect(() => {
    if (!activeCase) {
      setTestCaseParameterValues({});
      setSuiteLinkDraftIds([]);
      return;
    }

    const nextSuiteIds = activeCase.suite_ids || (activeCase.suite_id ? [activeCase.suite_id] : []);
    setCaseDraft({
      title: activeCase.title || "",
      description: activeCase.description || "",
      status: activeCase.status || "active",
      priority: String(activeCase.priority || 3),
      parameterText: formatParameterText(activeCase.parameter_values)
    });
    setTestCaseParameterValues(normalizeAutomationParameterValues(activeCase.parameter_values, "t"));
    setSuiteLinkDraftIds(nextSuiteIds);
  }, [activeCase?.id]);

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
      return;
    }

    setSuiteParameterValues(normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s"));
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
        if (!next[step.id]) {
          next[step.id] = step.automation_code || buildAutomationCodeFromDraft(parseAutomationStepDraft(step));
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
    const refreshRecorderSession = async () => {
      try {
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Recorder counters are non-critical; the backend finish call is authoritative.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const invalidateAutomationData = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
  };

  const setManualCaseLink = (automationCaseId: string, manualCaseId: string) => {
    setManualCaseLinks((current) => {
      const next = { ...current };
      if (manualCaseId) {
        next[automationCaseId] = manualCaseId;
      } else {
        delete next[automationCaseId];
      }
      window.localStorage.setItem(AUTOMATION_MANUAL_LINKS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const selectAutomationCase = (testCaseId: string) => {
    setSelectedCaseId(testCaseId);
    setSelectedAutomatedCaseId(testCaseId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("case", testCaseId);
      return next;
    }, { replace: true });
  };

  const openLinkedManualCase = (manualCaseId: string) => {
    navigate(`/test-cases?case=${encodeURIComponent(manualCaseId)}`);
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

  const toggleAutomationStep = (stepId: string) => {
    setExpandedAutomationStepIds((current) => current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId]);
  };

  const buildSingleAutomation = useMutation({
    mutationFn: () => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.queueAutomationGenerator(activeManualCase.id, {
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(`Automation build queued as ${response.transaction_id}.`);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to queue automation.")
  });

  const optimizeAutomationCase = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select an automation case first.");
      }

      return api.testCases.queueAutomationGenerator(linkedManualCase?.id || activeCase.id, {
        additional_context: [
          "Review the linked manual case, automation keyword steps, repository bindings, verification points, grouping, and coding standards.",
          "Suggest and regenerate optimized automation without removing business intent. Preserve @t and @s data scope tokens."
        ].join(" ")
      });
    },
    onSuccess: (response) => {
      setMessage(`AI automation review queued as ${response.transaction_id}.`);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to queue AI automation review.")
  });

  const createAutomationCase = useMutation({
    mutationFn: async () => {
      if (!appTypeId) {
        throw new Error("Select an app type before creating an automation case.");
      }

      if (!automationDraft.title.trim()) {
        throw new Error("Add a case title first.");
      }

      const created = await api.testCases.create({
        app_type_id: appTypeId,
        title: automationDraft.title.trim(),
        description: automationDraft.description.trim(),
        automated: "yes",
        status: "active",
        priority: 3,
        steps: automationDraft.keyword_step.trim()
          ? [{
            step_order: 1,
            step_type: "web",
            action: automationDraft.keyword_step.trim(),
            expected_result: automationDraft.expected_result.trim(),
            automation_code: automationDraft.keyword_step.trim()
          }]
          : []
      });

      if (automationDraft.start_url.trim()) {
        await api.testCases.queueAutomationGenerator(created.id, {
          start_url: automationDraft.start_url.trim(),
          additional_context: builderContext || undefined
        }).catch(() => null);
      }

      return created;
    },
    onSuccess: (created) => {
      setMessage("Automation case created. It is ready for keyword steps and repository learning.");
      setSelectedCaseId(created.id);
      setSelectedAutomatedCaseId(created.id);
      setIsCreatingAutomationCase(false);
      setAutomationDraft(createDefaultAutomationDraft());
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create automation case.")
  });

  const updateAutomationCase = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select an automation case first.");
      }

      return api.testCases.update(activeCase.id, {
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
        automated: "yes"
      });
    },
    onSuccess: async () => {
      if (selectedParameterSuite) {
        await api.testSuites.update(selectedParameterSuite.id, {
          parameter_values: normalizeAutomationParameterValues(suiteParameterValues, "s")
        }).catch(() => null);
      }
      setMessage("Automation case updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
      void queryClient.invalidateQueries({ queryKey: ["test-case-suites"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update automation case.")
  });

  const deleteAutomationCase = useMutation({
    mutationFn: async (testCase: TestCase) => {
      await api.testCases.delete(testCase.id);

      setManualCaseLinks((current) => {
        const next = { ...current };
        delete next[testCase.id];
        window.localStorage.setItem(AUTOMATION_MANUAL_LINKS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    onSuccess: () => {
      setMessage("Automation case deleted. Any linked manual case remains available.");
      setSelectedCaseId("");
      setSelectedAutomatedCaseId("");
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("case");
        return next;
      }, { replace: true });
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete automation case.")
  });

  const createAutomationStep = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select an automation case first.");
      }
      const automation_code = buildAutomationCodeFromDraft(newStepDraft);

      return api.testSteps.create({
        test_case_id: activeCase.id,
        step_order: automatedSteps.length + 1,
        action: automation_code,
        expected_result: newStepDraft.expected_result,
        step_type: "web",
        automation_code
      });
    },
    onSuccess: () => {
      setMessage("Automation step added.");
      setNewStepDraft({ keyword: "web.click", objectRef: "", value: "", expected_result: "" });
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to add automation step.")
  });

  const updateAutomationStep = useMutation({
    mutationFn: (step: TestStep) => {
      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
      const automation_code = applyAutomationStepOptions(
        buildAutomationCodeFromDraft(draft),
        stepOptionDrafts[step.id] || parseAutomationStepOptions(step)
      );

      return api.testSteps.update(step.id, {
        action: automation_code,
        expected_result: draft.expected_result,
        step_type: "web",
        automation_code
      });
    },
    onSuccess: () => {
      setMessage("Automation step updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update automation step.")
  });

  const updateAutomationStepCode = useMutation({
    mutationFn: (step: TestStep) => {
      const automation_code = applyAutomationStepOptions(
        (stepCodeDrafts[step.id] || step.automation_code || step.action || "").trim(),
        stepOptionDrafts[step.id] || parseAutomationStepOptions(step)
      );

      return api.testSteps.update(step.id, {
        action: automation_code || step.action || "",
        expected_result: step.expected_result || "",
        step_type: step.step_type || "web",
        automation_code
      });
    },
    onSuccess: () => {
      setMessage("Automation code updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update automation code.")
  });

  const rephraseAutomationStep = useMutation({
    mutationFn: async (step: TestStep) => {
      if (!appTypeId || !activeCase) {
        throw new Error("Select an automation case before using step AI.");
      }

      const response = await api.testCases.rephraseStep({
        app_type_id: appTypeId,
        requirement_id: activeCase.requirement_id || linkedManualCase?.requirement_id || undefined,
        additional_context: "Improve this automation keyword step for clarity, verification strength, and coding standard alignment. Keep locator/object references and @t/@s tokens intact.",
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

      return api.testSteps.update(step.id, {
        action: response.step.action || step.action || "",
        expected_result: response.step.expected_result || step.expected_result || "",
        step_type: step.step_type || "web",
        automation_code: step.automation_code || response.step.action || step.action || ""
      });
    },
    onSuccess: () => {
      setMessage("AI improved the automation step text.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to improve automation step.")
  });

  const reorderAutomationStep = useMutation({
    mutationFn: ({ stepId, direction }: { stepId: string; direction: "up" | "down" }) => {
      const index = automatedSteps.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= automatedSteps.length || !activeCase) {
        throw new Error("Step cannot move further.");
      }
      const ids = automatedSteps.map((step) => step.id);
      [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
      return api.testSteps.reorder(activeCase.id, ids);
    },
    onSuccess: () => {
      setMessage("Automation steps reordered.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to reorder automation step.")
  });

  const deleteAutomationStep = useMutation({
    mutationFn: (stepId: string) => api.testSteps.delete(stepId),
    onSuccess: () => {
      setMessage("Automation step deleted.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete automation step.")
  });

  const runCase = useMutation({
    mutationFn: async ({ testCase }: { testCase: TestCase }) => {
      if (!projectId || !appTypeId || !session?.user.id) {
        throw new Error("Select project and app type before running a case.");
      }

      return api.executions.createLocalRun({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCase.id],
        name: `Automation run - ${testCase.title}`,
        created_by: session.user.id,
        execution_hooks: [
          ...buildAutomationHookTarget(
            "pre",
            preHookTarget,
            hookTargetLabelByKey[`${preHookTarget.type}:${preHookTarget.id}`] || ""
          ),
          ...parseAutomationHookLines(preHookText, "pre"),
          ...buildAutomationHookTarget(
            "post",
            postHookTarget,
            hookTargetLabelByKey[`${postHookTarget.type}:${postHookTarget.id}`] || ""
          ),
          ...parseAutomationHookLines(postHookText, "post")
        ],
        engine_base_url: "http://host.docker.internal:4311"
      });
    },
    onSuccess: (response) => {
      setMessage(`Local Test Engine run started as ${response.id}.`);
      void queryClient.invalidateQueries({ queryKey: ["executions"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to run case.")
  });

  const saveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }
      const duplicate = learningCache.find((entry) =>
        entry.id !== selectedRepositoryEntry.id
        && getScreenName(entry) === (repositoryDraft.screen_name || getScreenName(selectedRepositoryEntry))
        && String(entry.locator || "").trim() === repositoryDraft.locator.trim()
      );

      if (duplicate) {
        throw new Error("This screen already has a field with the same locator. Select the existing field or use a unique locator.");
      }

      return api.testCases.updateLearningCacheEntry(selectedRepositoryEntry.id, {
        page_url: screenUrlDraft || selectedRepositoryEntry.page_url || undefined,
        page_key: repositoryDraft.screen_name || selectedRepositoryEntry.page_key || undefined,
        screen_name: repositoryDraft.screen_name,
        object_name: repositoryDraft.object_name,
        object_role: repositoryDraft.object_role,
        locator: repositoryDraft.locator,
        locator_kind: repositoryDraft.locator_kind,
        target_criteria: repositoryDraft.target_criteria.split(/\n+/).map((line) => line.trim()).filter(Boolean),
        dom_structure: repositoryDraft.dom_structure,
        screenshot_url: repositoryDraft.screenshot_url,
        fallback_strategy: repositoryDraft.fallback_strategy,
        platform: appTypes.find((appType) => appType.id === appTypeId)?.type || "web",
        url_pattern_type: repositoryDraft.url_pattern_type,
        url_pattern_value: repositoryDraft.url_pattern_value,
        screen_fingerprint: repositoryDraft.screen_fingerprint,
        accessibility_tree: repositoryDraft.accessibility_tree,
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
    onSuccess: () => {
      setMessage("Object repository field saved for execution-time locator resolution.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to save repository field.")
  });

  const createRepositoryField = useMutation({
    mutationFn: (field: ReturnType<typeof extractRepositoryFieldsFromDom>[number]) => {
      const screenName = screenUrlDraft || selectedScreenName || repositoryDraft.screen_name || "Screen";
      return api.testCases.createLearningCacheEntry({
        project_id: projectId || undefined,
        app_type_id: appTypeId || undefined,
        page_url: screenUrlDraft || undefined,
        page_key: screenName,
        screen_name: screenName,
        object_name: field.name,
        object_role: `${field.tag} / ${field.role}`,
        locator: field.locator,
        locator_kind: field.locatorKind,
        locator_intent: field.name,
        dom_structure: field.dom,
        screenshot_url: screenScreenshotDraft || undefined,
        screen_dom_compressed: screenDomDraft ? screenDomDraft.slice(0, 50_000) : undefined,
        screen_screenshot_url: screenScreenshotDraft || undefined,
        source: "inspect_ai_extract",
        metadata: {
          url_pattern_type: repositoryDraft.url_pattern_type || "contains",
          url_pattern_value: repositoryDraft.url_pattern_value || screenUrlDraft || screenName,
          screen_fingerprint: repositoryDraft.screen_fingerprint || null,
          accessibility_tree: repositoryDraft.accessibility_tree || null,
          description: `${field.name} detected from captured DOM.`,
          stability_score: field.locator.includes("data-testid") ? 0.95 : 0.75,
          fallback_locators: field.fallbackLocators,
          usage_keywords: []
        }
      });
    },
    onSuccess: (entry) => {
      setMessage("Object repository field extracted from screen DOM.");
      if (entry?.id) setSelectedRepositoryId(entry.id);
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to extract repository field.")
  });

  const deleteRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }
      return api.testCases.deleteLearningCacheEntry(selectedRepositoryEntry.id);
    },
    onSuccess: (response) => {
      if (response.blocked) {
        setRepositoryUsageBlock({ title: "Field is used by tests", usage: response.usage });
        return;
      }
      setMessage("Object repository field deleted.");
      setSelectedRepositoryId("");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete repository field.")
  });

  const deleteRepositoryScreen = useMutation({
    mutationFn: () => {
      if (!activePageObject) {
        throw new Error("Select a screen first.");
      }
      return api.testCases.deleteLearningCacheScreen(activePageObject.screenName, { app_type_id: appTypeId || undefined });
    },
    onSuccess: (response) => {
      if (response.blocked) {
        setRepositoryUsageBlock({ title: "Screen is used by tests", usage: response.usage });
        return;
      }
      setMessage("Object repository screen deleted.");
      setSelectedScreenName("");
      setSelectedRepositoryId("");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete repository screen.")
  });

  const improveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.improveLearningCacheEntry(selectedRepositoryEntry.id, {
        integration_id: llmIntegration?.id,
        guidance: repositoryDraft.target_criteria || builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(response.fallback_used ? `Repository improved with deterministic fallback: ${response.fallback_reason || "AI unavailable"}` : "AI improved the object repository field.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to improve repository field.")
  });

  const validateRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }
      const validatedAt = new Date().toISOString();
      const priorHistory = Array.isArray(selectedRepositoryEntry.metadata?.validation_history)
        ? selectedRepositoryEntry.metadata.validation_history
        : [];
      return api.testCases.updateLearningCacheEntry(selectedRepositoryEntry.id, {
        last_validated_at: validatedAt,
        validation_history: [
          { status: "passed", validatedAt, locator: selectedRepositoryEntry.locator, source: "manual_validation" },
          ...priorHistory
        ].slice(0, 25),
        metadata: {
          ...(selectedRepositoryEntry.metadata || {}),
          last_validated_status: "passed"
        }
      });
    },
    onSuccess: () => {
      setMessage("Locator marked as validated and recorded in field history.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to validate repository field.")
  });

  const startRecorder = useMutation({
    mutationFn: (options: RecorderStartOptions) => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.startRecorderSession(activeManualCase.id, {
        start_url: startUrl || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url
      });
    },
    onSuccess: (response, options) => {
      setRecorderSession(response);
      setRecorderStartOptions(options);
      setMessage(response.live_view_url ? "Local Playwright recorder is active and learning repository objects." : "Recorder started.");
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to start local Playwright recorder.")
  });

  const finishRecorder = useMutation({
    mutationFn: () => {
      if (!activeManualCase || !recorderSession?.id) {
        throw new Error("Start a recorder session before finishing it.");
      }

      return api.testCases.finishRecorderSession(activeManualCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
        additional_context: builderContext || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url
      });
    },
    onSuccess: (response) => {
      setMessage(
        response.generated_step_count
          ? `Captured ${response.learned_locator_count} repository object${response.learned_locator_count === 1 ? "" : "s"} and updated ${response.generated_step_count} automation step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured."
      );
      setRecorderSession(null);
      setRecorderStartOptions(null);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to finish recorder session.")
  });

  const loadInspectTabs = async (sessionOverride?: RecorderSessionResponse | null) => {
    const targetSession = sessionOverride || recorderSession;
    const baseUrl = getRecorderEngineBaseUrl(targetSession);

    if (!targetSession?.id || !baseUrl) {
      throw new Error("Start a local recorder browser before selecting a tab.");
    }

    let response;
    try {
      response = await readRecorderJson<{ active_page_id?: string | null; tabs: RecorderTab[] }>(
        `${baseUrl}/api/v1/recorder/sessions/${encodeURIComponent(targetSession.id)}/tabs`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("404")) {
        throw new Error("This recorder runtime does not support Inspect tabs. Restart the host recorder to load the current Inspect implementation.");
      }
      throw error;
    }
    const tabs = response?.tabs || [];
    setInspectTabs(tabs);
    setSelectedInspectTabId((current) =>
      tabs.some((tab) => tab.id === current)
        ? current
        : response?.active_page_id || tabs.find((tab) => tab.active)?.id || tabs[0]?.id || ""
    );
    return tabs;
  };

  const launchInspectBrowser = async () => {
    setInspectMessage("Opening local Playwright browser for inspection...");
    const activeSession = recorderSession?.status === "running"
      ? recorderSession
      : await startRecorder.mutateAsync({
          recorder_mode: "local",
          recorder_target: "web",
          engine_base_url: "http://host.docker.internal:4311",
          recorder_public_base_url: "http://localhost:4311"
        });

    const tabs = await loadInspectTabs(activeSession);
    setInspectMessage(tabs.length ? "Choose a tab, then start inspect and click a field in the browser." : "Browser is open. Navigate to a page, then refresh tabs.");
  };

  const persistLiveInspectResult = async (result: RecorderInspectResult) => {
    const screenName = inferScreenName(result.page_title, result.page_url) || selectedScreenName || repositoryDraft.screen_name || "Screen";
    const urlPattern = inferUrlPattern(result.page_url);
    const candidates = getCapturedLocators(result);
    const field = {
      name: result.element.friendly_name,
      tag: result.element.html_tag,
      role: result.element.role,
      locator: candidates[0].locator,
      locatorKind: candidates[0].strategy,
      dom: result.element.dom_structure,
      fallbackLocators: candidates.slice(1)
    };

    setLastInspectResult(result);
    setScreenUrlDraft(result.page_url || screenUrlDraft);
    setScreenDomDraft(result.screen_dom || screenDomDraft);
    setScreenScreenshotDraft(result.screen_screenshot_url || screenScreenshotDraft);
    setRepositoryDraft((current) => ({
      ...current,
      screen_name: screenName,
      object_name: field.name,
      object_role: `${field.tag} / ${field.role}`,
      locator: field.locator,
      locator_kind: field.locatorKind,
      target_criteria: result.element.text || current.target_criteria,
      dom_structure: field.dom,
      screenshot_url: result.element_screenshot_url || current.screenshot_url,
      url_pattern_type: urlPattern.type,
      url_pattern_value: urlPattern.value,
      screen_fingerprint: result.screen_fingerprint || current.screen_fingerprint,
      accessibility_tree: result.accessibility_tree || current.accessibility_tree,
      fallback_locators: formatLocatorDraft(candidates),
      ancestor_dom: result.element.ancestor_dom || current.ancestor_dom,
      ancestor_screenshot_url: result.ancestor_screenshot_url || current.ancestor_screenshot_url,
      element_screenshot_url: result.element_screenshot_url || current.element_screenshot_url,
      stability_score: String(Math.round(candidates[0].confidenceScore * 100)),
      description: current.description || `${field.name} captured from ${screenName}.`,
      fallback_strategy: current.fallback_strategy || "Use the captured screen screenshot and nearby DOM only after locator retries fail."
    }));

    try {
      const existingField = learningCache.find((entry) =>
        (getScreenName(entry) === screenName || (result.page_url && entry.page_url === result.page_url))
        && entry.locator === field.locator
      );
      const captureMetadata = {
        ...(existingField?.metadata || {}),
        url_pattern_type: urlPattern.type,
        url_pattern_value: urlPattern.value,
        screen_fingerprint: result.screen_fingerprint || null,
        accessibility_tree: result.accessibility_tree || null,
        ancestor_dom: result.element.ancestor_dom || null,
        ancestor_screenshot_url: result.ancestor_screenshot_url || null,
        element_screenshot_url: result.element_screenshot_url || null,
        description: `${field.name} captured during live inspection.`,
        stability_score: candidates[0].confidenceScore,
        fallback_locators: field.fallbackLocators,
        usage_keywords: Array.isArray(existingField?.metadata?.usage_keywords) ? existingField.metadata.usage_keywords : [],
        screen_dom_compressed: result.screen_dom ? result.screen_dom.slice(0, 50_000) : null,
        screen_screenshot_url: result.screen_screenshot_url || null
      };
      const capturedField = {
        project_id: projectId || undefined,
        app_type_id: appTypeId || undefined,
        page_url: result.page_url || undefined,
        page_key: screenName,
        screen_name: screenName,
        object_name: field.name,
        object_role: `${field.tag} / ${field.role}`,
        locator: field.locator,
        locator_kind: field.locatorKind,
        locator_intent: field.name,
        dom_structure: field.dom,
        screenshot_url: result.element_screenshot_url || undefined,
        fallback_strategy: "Use the captured screen screenshot and nearby DOM only after locator retries fail.",
        screen_dom_compressed: result.screen_dom ? result.screen_dom.slice(0, 50_000) : undefined,
        screen_screenshot_url: result.screen_screenshot_url || undefined,
        source: "live_inspect",
        metadata: captureMetadata
      };
      const entry = existingField
        ? await api.testCases.updateLearningCacheEntry(existingField.id, capturedField)
        : await api.testCases.createLearningCacheEntry(capturedField);

      if (entry?.id) {
        setSelectedRepositoryId(entry.id);
      }
      setSelectedScreenName(screenName);
      setInspectMessage(`Captured ${field.name} and ${existingField ? "refreshed its repository evidence" : "saved it to the object repository"}.`);
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-repository-context"] });
    } catch (error) {
      setInspectMessage(error instanceof Error ? error.message : "Captured the field, but could not save it automatically.");
    }
  };

  const startLiveInspect = async () => {
    const targetSession = recorderSession?.status === "running"
      ? recorderSession
      : await startRecorder.mutateAsync({
          recorder_mode: "local",
          recorder_target: "web",
          engine_base_url: "http://host.docker.internal:4311",
          recorder_public_base_url: "http://localhost:4311"
        });
    const baseUrl = getRecorderEngineBaseUrl(targetSession);

    if (!targetSession?.id || !baseUrl) {
      throw new Error("Local recorder browser is not available.");
    }

    const tabs = inspectTabs.length ? inspectTabs : await loadInspectTabs(targetSession);
    const pageId = selectedInspectTabId || tabs.find((tab) => tab.active)?.id || tabs[0]?.id || "";
    if (!pageId) {
      throw new Error("No inspectable browser tab is available. Navigate in the opened browser, then refresh tabs.");
    }
    await readRecorderJson(`${baseUrl}/api/v1/recorder/sessions/${encodeURIComponent(targetSession.id)}/inspect/start`, {
      method: "POST",
      body: JSON.stringify({ page_id: pageId || undefined })
    });
    setSelectedInspectTabId(pageId || "");
    setLastInspectResult(null);
    setIsInspectingLiveField(true);
    setInspectMessage("Inspect is armed. Click any field in the selected browser tab; QAira will capture DOM and screenshot automatically.");
  };

  useEffect(() => {
    if (!isInspectOpen || recorderSession?.status !== "running" || !recorderSession.id) {
      return undefined;
    }

    let isCancelled = false;
    const refreshTabs = async () => {
      try {
        await loadInspectTabs();
      } catch (error) {
        if (!isCancelled) {
          setInspectMessage(error instanceof Error ? error.message : "Unable to load browser tabs.");
        }
      }
    };

    void refreshTabs();
    const interval = window.setInterval(() => void refreshTabs(), 3000);
    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [isInspectOpen, recorderSession?.id, recorderSession?.status]);

  useEffect(() => {
    if (!isInspectingLiveField || !recorderSession?.id) {
      return undefined;
    }

    const baseUrl = getRecorderEngineBaseUrl(recorderSession);

    if (!baseUrl) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        const query = selectedInspectTabId ? `?page_id=${encodeURIComponent(selectedInspectTabId)}` : "";
        const result = await readRecorderJson<RecorderInspectResult>(
          `${baseUrl}/api/v1/recorder/sessions/${encodeURIComponent(recorderSession.id)}/inspect/result${query}`
        ).catch((error) => {
          setInspectMessage(error instanceof Error ? error.message : "Unable to read inspect result.");
          return null;
        });

        if (result) {
          setIsInspectingLiveField(false);
          await persistLiveInspectResult(result);
        }
      })();
    }, 1200);

    return () => window.clearInterval(interval);
  }, [isInspectingLiveField, recorderSession, selectedInspectTabId]);

  return (
    <div className="page-content page-content--automation">
      <PageHeader
        eyebrow="Automation"
        title="Automation workspace"
        description="Maintain automated cases, keyword steps, object repository learning, and local Playwright capture in one governed workspace."
        meta={[
          { label: "Automation cases", value: automatedCases.length },
          { label: "Manual link candidates", value: manualCases.length },
          { label: "Repository objects", value: learningCache.length }
        ]}
      />

      <SubnavTabs
        ariaLabel="Automation views"
        items={[
          { value: "cases", label: "Automation Cases", meta: `${automatedCases.length}`, icon: <SparkIcon /> },
          { value: "repository", label: "Object Repository", meta: `${groupedRepository.length} screens`, icon: <LayersIcon /> },
          { value: "local-playwright", label: "Local Playwright", meta: recorderSession ? "recording" : "capture", icon: <MousePointerIcon /> }
        ]}
        onChange={setView}
        value={view}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedAutomatedCaseId("");
          setSelectedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setSelectedAutomatedCaseId("");
          setSelectedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        projectId={projectId}
        projects={projects}
      />

      {message ? <div className="empty-state compact">{message}</div> : null}

      {view === "cases" ? (
        <WorkspaceMasterDetail
          className="automation-cases-master-detail"
          isDetailOpen={isAutomationCaseWorkspaceOpen}
          browseView={(
          <Panel
            title="Automation case tiles"
            subtitle="Every case appears as a tile. Open a tile to review description, keyword steps, and run history in the same rhythm as Test Cases."
            actions={(
              <button className="primary-button" onClick={() => setIsCreatingAutomationCase(true)} type="button">
                <AddIcon />
                <span>New automation case</span>
              </button>
            )}
          >
            {isCreatingAutomationCase ? (
              <form
                className="automation-create-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  createAutomationCase.mutate();
                }}
              >
                <label className="form-field">
                  <span>Case title</span>
                  <input autoFocus value={automationDraft.title} onChange={(event) => setAutomationDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea rows={3} value={automationDraft.description} onChange={(event) => setAutomationDraft((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Start URL</span>
                  <input placeholder="https://app.example.com/login" value={automationDraft.start_url} onChange={(event) => setAutomationDraft((current) => ({ ...current, start_url: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>First keyword step</span>
                  <textarea placeholder={'await web.fill("Login.email", "@t.userEmail");'} rows={3} value={automationDraft.keyword_step} onChange={(event) => setAutomationDraft((current) => ({ ...current, keyword_step: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Expected result</span>
                  <input value={automationDraft.expected_result} onChange={(event) => setAutomationDraft((current) => ({ ...current, expected_result: event.target.value }))} />
                </label>
                <div className="testops-action-row">
                  <button className="primary-button" disabled={createAutomationCase.isPending} type="submit">
                    <AddIcon />
                    <span>{createAutomationCase.isPending ? "Creating..." : "Create case"}</span>
                  </button>
                  <button className="ghost-button" onClick={() => setIsCreatingAutomationCase(false)} type="button">Cancel</button>
                </div>
              </form>
            ) : null}

            {testCasesQuery.isLoading || executionResultsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!testCasesQuery.isLoading && !automatedCases.length ? (
              <div className="empty-state compact">No cases yet. Create a new automation case or generate automation from a manual case.</div>
            ) : null}
            {!testCasesQuery.isLoading && automatedCases.length ? (
              <TileBrowserPane className="automation-case-tile-browser">
                <div className="tile-browser-grid">
                  {automatedCases.map((testCase) => {
                    const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                    const latest = history[0];
                    const passedRuns = history.filter((result) => result.status === "passed").length;
                    const passRate = history.length ? Math.round((passedRuns / history.length) * 100) : 0;
                    const isActive = activeCase?.id === testCase.id;
                    const linkedManualTitle = manualCaseLinks[testCase.id] ? testCases.find((item) => item.id === manualCaseLinks[testCase.id])?.title : "";

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
                            <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id} />
                            <div className="catalog-inline-actions test-case-top-actions">
                              <StatusBadge value="automated" />
                              <StatusBadge value={latest?.status || testCase.status || "ready"} />
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
                          <p className="tile-card-description">{linkedManualTitle ? `Linked manual case: ${linkedManualTitle}` : testCase.description || "No description yet for this automation case."}</p>
                          <div className="tile-card-facts">
                            <TileCardFact label="Automated" title="Automation state" tone="success"><SparkIcon /></TileCardFact>
                            <TileCardFact label={`${history.length} runs`} title="Recent run history" tone={history.length ? "info" : "neutral"}><TileCardRunsIcon /></TileCardFact>
                            <TileCardFact label={`P${testCase.priority || 3}`} title="Priority"><TileCardStepsIcon /></TileCardFact>
                          </div>
                          <div className="tile-card-footer">
                            <div className="test-case-card-progress-row" aria-label={history.length ? `${passRate}% recent pass rate` : "No recent run coverage"}>
                              <div className="test-case-card-progress-track"><span style={{ width: `${passRate}%` }} /></div>
                              <small>{history.length ? `${passRate}% passed` : "No runs"}</small>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TileBrowserPane>
            ) : null}
          </Panel>
          )}
          detailView={(
          <Panel
            title="Automation case workspace"
            subtitle={activeCase ? "Switch between case details and keyword step editing without losing the selected context." : "Select an automation case."}
            actions={activeCase ? (
              <div className="testops-action-row">
                <WorkspaceBackButton label="Back to automation case tiles" onClick={closeAutomationCaseWorkspace} />
                <button className="primary-button" disabled={runCase.isPending || activeCase.automated !== "yes"} onClick={() => runCase.mutate({ testCase: activeCase })} type="button">
                  <PlayIcon />
                  <span>{runCase.isPending ? "Starting..." : "Run automated"}</span>
                </button>
                <button className="ghost-button" disabled={optimizeAutomationCase.isPending} onClick={() => optimizeAutomationCase.mutate()} type="button">
                  <SparkIcon />
                  <span>{optimizeAutomationCase.isPending ? "Queueing..." : "AI review"}</span>
                </button>
              </div>
            ) : undefined}
          >
            {!activeCase ? (
              <div className="empty-state compact">Select a case tile to inspect its automation detail.</div>
            ) : automatedStepsQuery.isLoading ? (
              <TileCardSkeletonGrid />
            ) : (
              <div className="automation-case-detail editor-accordion">
                <AutomationAccordionSection
                  countLabel={automationDisplayIdByCaseId[activeCase.id] || activeCase.display_id || "AT"}
                  isExpanded={expandedCaseSections.case}
                  onToggle={() => toggleCaseSection("case")}
                  summary={linkedManualCase ? `Linked to ${linkedManualCase.title}` : "Description, parameters, priority, and manual case linkage."}
                  title="Test case"
                >
                  <div className="automation-description-panel">
                    <div className="automation-case-editor-grid">
                      <label className="form-field">
                        <span>Automation case name</span>
                        <input value={caseDraft.title} onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))} />
                      </label>
                      <label className="form-field">
                        <span>Status</span>
                        <input value={caseDraft.status} onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))} />
                      </label>
                      <label className="form-field">
                        <span>Priority</span>
                        <input min={1} max={5} type="number" value={caseDraft.priority} onChange={(event) => setCaseDraft((current) => ({ ...current, priority: event.target.value }))} />
                      </label>
                    </div>
                    <div className="automation-manual-link-panel">
                      <label className="form-field">
                        <span>Linked manual case</span>
                        <select value={manualCaseLinks[activeCase.id] || ""} onChange={(event) => setManualCaseLink(activeCase.id, event.target.value)}>
                          <option value="">No manual case linked</option>
                          {manualCases.map((testCase) => (
                            <option key={testCase.id} value={testCase.id}>{testCase.display_id || testCase.title} · {testCase.title}</option>
                          ))}
                        </select>
                      </label>
                      {linkedManualCase ? (
                        <button className="automation-linked-manual-card automation-linked-manual-card--button" onClick={() => openLinkedManualCase(linkedManualCase.id)} type="button">
                          <strong>{linkedManualCase.title}</strong>
                          <span>{linkedManualCase.display_id || "Manual case"} · {linkedManualCase.status || "ready"} · Open manual case</span>
                        </button>
                      ) : null}
                    </div>
                    <label className="form-field">
                      <span>Description</span>
                      <textarea rows={4} value={caseDraft.description} onChange={(event) => setCaseDraft((current) => ({ ...current, description: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Parameters</span>
                      <textarea rows={4} value={caseDraft.parameterText} onChange={(event) => setCaseDraft((current) => ({ ...current, parameterText: event.target.value }))} placeholder={"@t.userEmail=qa@example.com\n@s.basePath=/login\n@r.buildNumber=123"} />
                    </label>
                    <div className="automation-hooks-grid">
                      {(["pre", "post"] as const).map((phase) => {
                        const target = phase === "pre" ? preHookTarget : postHookTarget;
                        const setTarget = phase === "pre" ? setPreHookTarget : setPostHookTarget;
                        const textValue = phase === "pre" ? preHookText : postHookText;
                        const setTextValue = phase === "pre" ? setPreHookText : setPostHookText;
                        const targetOptions =
                          target.type === "suite"
                            ? suites.map((suite) => ({ id: suite.id, label: suite.display_id ? `${suite.display_id} · ${suite.name}` : suite.name }))
                            : target.type === "test_step"
                              ? automatedSteps.map((step) => ({ id: step.id, label: `Step ${step.step_order} · ${step.action || step.automation_code || "Automation step"}` }))
                              : testCases.map((testCase) => ({ id: testCase.id, label: testCase.display_id ? `${testCase.display_id} · ${testCase.title}` : testCase.title }));

                        return (
                          <div className="automation-hook-card" key={phase}>
                            <div>
                              <strong>{phase === "pre" ? "Pre-run hook" : "Post-run hook"}</strong>
                              <span>{phase === "pre" ? "Run setup before this automation case." : "Run teardown after this automation case."}</span>
                            </div>
                            <div className="automation-hook-target-grid">
                              <label className="form-field">
                                <span>Hook target</span>
                                <select
                                  value={target.type}
                                  onChange={(event) => setTarget({ type: event.target.value as AutomationHookTargetDraft["type"], id: "" })}
                                >
                                  <option value="test_case">Test case</option>
                                  <option value="test_step">Step</option>
                                  <option value="suite">Suite</option>
                                </select>
                              </label>
                              <label className="form-field">
                                <span>Select target</span>
                                <select value={target.id} onChange={(event) => setTarget({ ...target, id: event.target.value })}>
                                  <option value="">No selected hook</option>
                                  {targetOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <label className="form-field">
                              <span>Additional keyword hooks</span>
                              <textarea
                                rows={3}
                                value={textValue}
                                onChange={(event) => setTextValue(event.target.value)}
                                placeholder={phase === "pre" ? "Example: web.goto(\"@s.baseUrl\")" : "Example: web.close()"}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    <div className="automation-suite-link-panel">
                      <strong>Suite references</strong>
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
                    <div className="testops-action-row">
                      <button className="ghost-button" onClick={() => setIsParameterDialogOpen(true)} type="button">
                        <SparkIcon />
                        <span>{detectedStepParameters.length ? `Test data · ${detectedStepParameters.length}` : "Test data"}</span>
                      </button>
                      <button className="primary-button" disabled={updateAutomationCase.isPending} onClick={() => updateAutomationCase.mutate()} type="button">
                        <span>{updateAutomationCase.isPending ? "Saving..." : "Save automation case"}</span>
                      </button>
                      <button className="ghost-button danger" disabled={deleteAutomationCase.isPending} onClick={() => deleteAutomationCase.mutate(activeCase)} type="button">
                        <TrashIcon size={16} />
                        <span>{deleteAutomationCase.isPending ? "Deleting..." : "Delete automation case"}</span>
                      </button>
                    </div>
                  </div>
                </AutomationAccordionSection>

                <AutomationAccordionSection
                  actions={(
                    <div className="automation-step-view-toggle" role="group" aria-label="Automation step view">
                      <button className={automationStepView === "keyword" ? "is-active" : ""} onClick={() => setAutomationStepView("keyword")} type="button">Keyword</button>
                      <button className={automationStepView === "code" ? "is-active" : ""} onClick={() => setAutomationStepView("code")} type="button">Code</button>
                    </div>
                  )}
                  countLabel={`${automatedSteps.length} step${automatedSteps.length === 1 ? "" : "s"}`}
                  isExpanded={expandedCaseSections.steps}
                  onToggle={() => toggleCaseSection("steps")}
                  summary={automationStepView === "keyword" ? "Keyword-based automation steps with repository parameters." : "Generated executable code for the same step list."}
                  title="Steps"
                >
                  <div className="automation-keyword-step-list">
                    {!automatedSteps.length ? <div className="empty-state compact">No keyword steps yet. Add them from Test Cases, recorder capture, or AI automation generation.</div> : null}
                    {automationStepView === "keyword" ? automatedSteps.map((step) => {
                      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
                      const options = stepOptionDrafts[step.id] || parseAutomationStepOptions(step);
                      const variables = extractVariables(step);
                      const isExpanded = expandedAutomationStepIds.includes(step.id);

                      return (
                        <article className={["automation-keyword-step", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} key={step.id}>
                          <div className="automation-keyword-step-top">
                            <button className="automation-keyword-step-summary" onClick={() => toggleAutomationStep(step.id)} type="button">
                              <span className="count-pill">Step {step.step_order}</span>
                              <span className="automation-step-type-chip">{getAutomationStepTypeLabel(step)}</span>
                              <strong>{step.action || "No manual action recorded"}</strong>
                              {step.group_kind ? (
                                <span className={step.group_kind === "reusable" ? "automation-step-group-chip is-shared" : "automation-step-group-chip"}>
                                  {step.group_kind === "reusable" ? "Shared group" : step.group_name || "Group"}
                                </span>
                              ) : null}
                              <StatusBadge value={step.automation_code ? "keyword-ready" : "manual-only"} />
                            </button>
                            <div className="automation-hover-step-tools" aria-label={`Step ${step.step_order} actions`}>
                              <button className="automation-step-tool-button" disabled={reorderAutomationStep.isPending || step.step_order <= 1} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} title="Move up" type="button">↑</button>
                              <button className="automation-step-tool-button" disabled={reorderAutomationStep.isPending || step.step_order >= automatedSteps.length} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} title="Move down" type="button">↓</button>
                              <button className="automation-step-tool-button" disabled={rephraseAutomationStep.isPending} onClick={() => rephraseAutomationStep.mutate(step)} title="AI improve step" type="button">AI</button>
                              <button className="automation-step-tool-button is-primary" disabled={updateAutomationStep.isPending} onClick={() => updateAutomationStep.mutate(step)} title="Save step" type="button">Save</button>
                              <button className="automation-step-tool-button" onClick={() => navigator.clipboard?.writeText(buildAutomationCodeFromDraft(draft))} title="Copy keyword" type="button"><CopyIcon size={15} /></button>
                              {linkedManualCase ? (
                                <button className="automation-step-tool-button" onClick={() => openLinkedManualCase(linkedManualCase.id)} title="Open linked manual case" type="button"><OpenIcon size={15} /></button>
                              ) : null}
                              <button className="automation-step-tool-button is-danger" disabled={deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step.id)} title="Delete step" type="button"><TrashIcon size={15} /></button>
                            </div>
                          </div>
                          {isExpanded ? (
                            <div className="automation-keyword-step-body">
                              <div className="automation-step-editor-grid">
                                <label className="form-field">
                                  <span>Keyword</span>
                                  <select value={draft.keyword} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, keyword: event.target.value } }))}>
                                    {["web.goto", "web.click", "web.fill", "web.select", "web.check", "web.uncheck", "web.press", "web.wait", "web.expectVisible", "web.expectText", "web.expectUrl"].map((keyword) => (
                                      <option key={keyword} value={keyword}>{keyword}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="form-field">
                                  <span>Repository member</span>
                                  <select value={draft.objectRef} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, objectRef: event.target.value } }))}>
                                    <option value="">Select repository member</option>
                                    {allObjectMembers.map((member) => (
                                      <option key={member.entry.id} value={member.ref}>{member.ref} · {member.htmlTag}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="form-field">
                                  <span>Value / parameter</span>
                                  <input value={draft.value} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, value: event.target.value } }))} placeholder="@t.userEmail" />
                                </label>
                                <label className="form-field automation-step-expected-field">
                                  <span>Expected result</span>
                                  <textarea rows={3} value={draft.expected_result} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, expected_result: event.target.value } }))} />
                                </label>
                              </div>
                              <div className="automation-step-action-row">
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order <= 1} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} type="button">
                                  <span>Move up</span>
                                </button>
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order >= automatedSteps.length} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} type="button">
                                  <span>Move down</span>
                                </button>
                                <button className="primary-button compact" disabled={updateAutomationStep.isPending} onClick={() => updateAutomationStep.mutate(step)} type="button">
                                  <span>{updateAutomationStep.isPending ? "Saving..." : "Save step"}</span>
                                </button>
                                <button className="ghost-button compact" onClick={() => navigator.clipboard?.writeText(step.automation_code || step.action || "")} type="button">
                                  <CopyIcon size={16} />
                                  <span>Copy keyword</span>
                                </button>
                                {linkedManualCase ? (
                                  <button className="ghost-button compact" onClick={() => openLinkedManualCase(linkedManualCase.id)} type="button">
                                    <OpenIcon size={16} />
                                    <span>Open manual case</span>
                                  </button>
                                ) : null}
                                <button className="ghost-button compact" disabled={deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step.id)} type="button">
                                  <TrashIcon size={16} />
                                  <span>{deleteAutomationStep.isPending ? "Deleting..." : "Delete"}</span>
                                </button>
                              </div>
                              <div className="automation-step-options-panel" aria-label={`Step ${step.step_order} execution options`}>
                                <label>
                                  <input
                                    checked={options.screenshotOnFailure}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, screenshotOnFailure: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Screenshot on failure
                                </label>
                                <label>
                                  <input
                                    checked={options.optional}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, optional: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Optional step
                                </label>
                                <label>
                                  <input
                                    checked={options.skip}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, skip: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Skip step
                                </label>
                              </div>
                              <code className="automation-code-block automation-code-block--compact">{buildAutomationCodeFromDraft(draft)}</code>
                              <div className="automation-step-meta-grid">
                                <div>
                                  <span>Object binding</span>
                                  {draft.objectRef ? <code>{draft.objectRef}</code> : <small>Select a repository member.</small>}
                                </div>
                                <div>
                                  <span>Variables</span>
                                  {variables.length ? variables.map((variable) => <code key={variable}>{`@${variable}`}</code>) : <small>No variables used.</small>}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    }) : automatedSteps.map((step) => {
                      const codeDraft = stepCodeDrafts[step.id] ?? step.automation_code ?? buildAutomationCodeFromDraft(parseAutomationStepDraft(step));
                      const options = stepOptionDrafts[step.id] || parseAutomationStepOptions(step);
                      const isExpanded = expandedAutomationStepIds.includes(step.id);

                      return (
                        <article className={["automation-keyword-step automation-code-step", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} key={step.id}>
                          <div className="automation-keyword-step-top">
                            <button className="automation-keyword-step-summary" onClick={() => toggleAutomationStep(step.id)} type="button">
                              <span className="count-pill">Step {step.step_order}</span>
                              <span className="automation-step-type-chip">{getAutomationStepTypeLabel(step)}</span>
                              <strong>{step.action || codeDraft || "Code step"}</strong>
                              {step.group_kind ? (
                                <span className={step.group_kind === "reusable" ? "automation-step-group-chip is-shared" : "automation-step-group-chip"}>
                                  {step.group_kind === "reusable" ? "Shared group" : step.group_name || "Group"}
                                </span>
                              ) : null}
                              <StatusBadge value={codeDraft ? "code-ready" : "empty"} />
                            </button>
                            <div className="automation-hover-step-tools" aria-label={`Step ${step.step_order} code actions`}>
                              <button className="automation-step-tool-button" disabled={reorderAutomationStep.isPending || step.step_order <= 1} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} title="Move up" type="button">↑</button>
                              <button className="automation-step-tool-button" disabled={reorderAutomationStep.isPending || step.step_order >= automatedSteps.length} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} title="Move down" type="button">↓</button>
                              <button className="automation-step-tool-button" disabled={rephraseAutomationStep.isPending} onClick={() => rephraseAutomationStep.mutate(step)} title="AI improve step" type="button">AI</button>
                              <button className="automation-step-tool-button is-primary" disabled={updateAutomationStepCode.isPending} onClick={() => updateAutomationStepCode.mutate(step)} title="Save code" type="button">Save</button>
                              <button className="automation-step-tool-button" onClick={() => navigator.clipboard?.writeText(codeDraft)} title="Copy code" type="button"><CopyIcon size={15} /></button>
                              <button className="automation-step-tool-button is-danger" disabled={deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step.id)} title="Delete step" type="button"><TrashIcon size={15} /></button>
                            </div>
                          </div>
                          {isExpanded ? (
                            <div className="automation-keyword-step-body">
                              <label className="form-field">
                                <span>Executable code</span>
                                <textarea
                                  className="automation-code-textarea"
                                  rows={6}
                                  value={codeDraft}
                                  onChange={(event) => setStepCodeDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                />
                              </label>
                              <div className="automation-step-action-row">
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order <= 1} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} type="button">
                                  <span>Move up</span>
                                </button>
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order >= automatedSteps.length} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} type="button">
                                  <span>Move down</span>
                                </button>
                                <button className="primary-button compact" disabled={updateAutomationStepCode.isPending} onClick={() => updateAutomationStepCode.mutate(step)} type="button">
                                  <span>{updateAutomationStepCode.isPending ? "Saving..." : "Save code"}</span>
                                </button>
                                <button className="ghost-button compact" onClick={() => navigator.clipboard?.writeText(codeDraft)} type="button">
                                  <CopyIcon size={16} />
                                  <span>Copy code</span>
                                </button>
                                <button className="ghost-button compact" disabled={deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step.id)} type="button">
                                  <TrashIcon size={16} />
                                  <span>{deleteAutomationStep.isPending ? "Deleting..." : "Delete"}</span>
                                </button>
                              </div>
                              <div className="automation-step-options-panel" aria-label={`Step ${step.step_order} execution options`}>
                                <label>
                                  <input
                                    checked={options.screenshotOnFailure}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, screenshotOnFailure: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Screenshot on failure
                                </label>
                                <label>
                                  <input
                                    checked={options.optional}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, optional: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Optional step
                                </label>
                                <label>
                                  <input
                                    checked={options.skip}
                                    onChange={(event) =>
                                      setStepOptionDrafts((current) => ({
                                        ...current,
                                        [step.id]: { ...options, skip: event.target.checked }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Skip step
                                </label>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                    {automationStepView === "keyword" ? (
                    <article className="automation-keyword-step is-expanded">
                      <div className="automation-keyword-step-summary">
                        <span className="count-pill">New</span>
                        <strong>Add automation step</strong>
                        <StatusBadge value="draft" />
                      </div>
                      <div className="automation-keyword-step-body">
                        <div className="automation-step-editor-grid">
                          <label className="form-field">
                            <span>Keyword</span>
                            <select value={newStepDraft.keyword} onChange={(event) => setNewStepDraft((current) => ({ ...current, keyword: event.target.value }))}>
                              {["web.goto", "web.click", "web.fill", "web.select", "web.check", "web.uncheck", "web.press", "web.wait", "web.expectVisible", "web.expectText", "web.expectUrl"].map((keyword) => (
                                <option key={keyword} value={keyword}>{keyword}</option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Repository member</span>
                            <select value={newStepDraft.objectRef} onChange={(event) => setNewStepDraft((current) => ({ ...current, objectRef: event.target.value }))}>
                              <option value="">Select repository member</option>
                              {allObjectMembers.map((member) => (
                                <option key={member.entry.id} value={member.ref}>{member.ref} · {member.htmlTag}</option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Value / parameter</span>
                            <input value={newStepDraft.value} onChange={(event) => setNewStepDraft((current) => ({ ...current, value: event.target.value }))} placeholder="@t.userEmail" />
                          </label>
                          <label className="form-field automation-step-expected-field">
                            <span>Expected result</span>
                            <textarea rows={3} value={newStepDraft.expected_result} onChange={(event) => setNewStepDraft((current) => ({ ...current, expected_result: event.target.value }))} />
                          </label>
                        </div>
                        <div className="testops-action-row">
                          <button className="primary-button" disabled={createAutomationStep.isPending || !newStepDraft.objectRef} onClick={() => createAutomationStep.mutate()} type="button">
                            <AddIcon />
                            <span>{createAutomationStep.isPending ? "Adding..." : "Add step"}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                    ) : null}
                  </div>
                </AutomationAccordionSection>

                <AutomationAccordionSection
                  countLabel={`${activeCaseHistory.length} run${activeCaseHistory.length === 1 ? "" : "s"}`}
                  isExpanded={expandedCaseSections.history}
                  onToggle={() => toggleCaseSection("history")}
                  summary={activeCaseHistory.length ? "Recent local and manual execution outcomes for this automation case." : "No run history yet."}
                  title="Run history"
                >
                  <div className="automation-run-history">
                    {!activeCaseHistory.length ? <div className="empty-state compact">No run history yet.</div> : null}
                    {activeCaseHistory.map((result) => (
                      <article className="automation-history-row" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || activeCase.title}</strong>
                          <span>{result.created_at ? formatRunDate.format(new Date(result.created_at)) : "Run timestamp unavailable"} · {result.duration_ms ? `${Math.round(result.duration_ms / 1000)}s` : "duration pending"}</span>
                          {result.error ? <p>{result.error}</p> : null}
                        </div>
                        <StatusBadge value={result.status} />
                      </article>
                    ))}
                  </div>
                </AutomationAccordionSection>
              </div>
            )}
          </Panel>
          )}
        />
      ) : null}

      {view === "repository" ? (
        <div className="automation-workspace-grid automation-workspace-grid--repository">
          <Panel
            title="Object repository"
            subtitle="Screen-level fields grouped by page, with friendly member names, HTML tag details, locator, DOM, image, and fallback intelligence."
            actions={(
              <div className="testops-action-row">
                <button className="ghost-button" onClick={() => {
                  setIsInspectOpen(true);
                  setInspectMessage(recorderSession?.status === "running" ? "Loading open browser tabs..." : "");
                }} type="button">
                  <MousePointerIcon />
                  <span>Inspect / AI extract</span>
                </button>
                <button
                  className="ghost-button"
                  disabled={!repositoryContextQuery.data}
                  onClick={() => {
                    if (repositoryContextQuery.data) {
                      void navigator.clipboard?.writeText(JSON.stringify(repositoryContextQuery.data, null, 2));
                      setMessage("Structured UI repository context copied for automation agents.");
                    }
                  }}
                  type="button"
                >
                  <CopyIcon size={16} />
                  <span>Copy agent context</span>
                </button>
                <button className="ghost-button danger" disabled={!activePageObject || deleteRepositoryScreen.isPending} onClick={() => deleteRepositoryScreen.mutate()} type="button">
                  <TrashIcon size={16} />
                  <span>{deleteRepositoryScreen.isPending ? "Checking..." : "Delete screen"}</span>
                </button>
              </div>
            )}
          >
            {learningCacheQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!learningCacheQuery.isLoading && !groupedRepository.length ? (
              <div className="empty-state compact">No repository objects have been learned for this scope yet.</div>
            ) : null}
            <div className="pom-workspace">
              <aside className="pom-page-list" aria-label="Repository pages">
                {pageObjectModels.map((page) => (
                  <button className={activePageObject?.screenName === page.screenName ? "is-active" : ""} key={page.screenName} onClick={() => setSelectedScreenName(page.screenName)} type="button">
                    <strong>{page.pageName}</strong>
                    <span>{page.members.length} members · {page.url}</span>
                  </button>
                ))}
              </aside>

              {activePageObject ? (
                <section className="pom-class-panel" aria-label={`${activePageObject.pageName} repository page`}>
                  <div className="pom-class-header">
                    <div>
                      <span>Screen · {normalizeMetadataValue(activeScreenMetadata.platform) || appTypes.find((item) => item.id === appTypeId)?.type || "web"}</span>
                      <strong>{activePageObject.pageName}</strong>
                      <small>{normalizeMetadataValue(activeScreenMetadata.url_pattern_type) || "contains"} "{normalizeMetadataValue(activeScreenMetadata.url_pattern_value) || activePageObject.url}"</small>
                    </div>
                    <StatusBadge value={`${activePageObject.members.length} members`} />
                  </div>
                  <SubnavTabs
                    ariaLabel="Screen details"
                    className="object-repository-screen-tabs"
                    value={screenDetailTab}
                    onChange={setScreenDetailTab}
                    items={[
                      { value: "fields", label: "Fields", meta: String(activePageObject.members.length) },
                      { value: "dom", label: "DOM Snapshot", meta: screenDomDraft ? "Captured" : "Pending" },
                      { value: "suggestions", label: "AI Suggestions", meta: "Locator health" },
                      { value: "usage", label: "Usage", meta: `${selectedRepositoryUsage.length} cases` },
                      { value: "validation", label: "Validation", meta: formatRepositoryDate(selectedRepositoryEntry?.metadata?.last_validated_at) }
                    ]}
                  />
                  {screenDetailTab === "fields" ? (
                    <div className="pom-member-table">
                      <div className="pom-member-row is-head">
                        <span>Field</span>
                        <span>Type</span>
                        <span>Primary locator</span>
                      </div>
                      {activePageObject.members.map((member) => (
                        <button className={selectedRepositoryEntry?.id === member.entry.id ? "pom-member-row is-active" : "pom-member-row"} key={member.entry.id} onClick={() => setSelectedRepositoryId(member.entry.id)} type="button">
                          <code>{member.memberName}</code>
                          <span>{member.htmlTag} · {member.role}</span>
                          <small>{member.entry.locator}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {screenDetailTab === "dom" ? (
                    <div className="repository-evidence-block">
                      {screenScreenshotDraft && isLikelyImageUrl(screenScreenshotDraft) ? <img alt={`${activePageObject.pageName} full screen`} src={screenScreenshotDraft} /> : null}
                      <label>Full DOM / accessibility tree</label>
                      <pre>{screenDomDraft || normalizeMetadataValue(activeScreenMetadata.accessibility_tree) || "No full-page DOM or accessibility snapshot captured."}</pre>
                      <small>Fingerprint: {normalizeMetadataValue(activeScreenMetadata.screen_fingerprint) || "Not generated"}</small>
                    </div>
                  ) : null}
                  {screenDetailTab === "suggestions" ? (
                    <div className="repository-callout-list">
                      <div className="object-repository-ai-strip"><SparkIcon /><span>Prefer `data-testid`, `aria-label`, and `role + name`; keep CSS and XPath as fallbacks only.</span></div>
                      {selectedRepositoryEntry ? <p>Selected field stability: {Math.round(normalizeMetadataNumber(selectedRepositoryEntry.metadata?.stability_score, selectedRepositoryEntry.confidence) * 100)}%. Use AI improve to propose a healed locator from captured evidence.</p> : null}
                    </div>
                  ) : null}
                  {screenDetailTab === "usage" ? (
                    <div className="repository-usage-list">
                      {selectedRepositoryUsage.map((testCase) => <article key={testCase.id}><strong>{testCase.display_id || "Test"}</strong><span>{testCase.title}</span></article>)}
                      {!selectedRepositoryUsage.length ? <div className="empty-state compact">The selected field is not referenced by a test step yet.</div> : null}
                    </div>
                  ) : null}
                  {screenDetailTab === "validation" ? (
                    <div className="repository-validation-list">
                      {selectedValidationHistory.map((event, index) => <article key={`${normalizeMetadataValue(event.validatedAt)}-${index}`}><StatusBadge value={normalizeMetadataValue(event.status) || "unknown"} /><span>{formatRepositoryDate(event.validatedAt)}</span><code>{normalizeMetadataValue(event.locator)}</code></article>)}
                      {!selectedValidationHistory.length ? <div className="empty-state compact">No validation history captured for the selected field.</div> : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </Panel>

          <Panel
            className="automation-detail-panel"
            title="Member inspector"
            subtitle="Curate the selected repository member. Keywords should bind to this member name, not raw locators."
            actions={selectedRepositoryEntry ? (
              <div className="testops-action-row">
                <button className="ghost-button" disabled={improveRepositoryEntry.isPending} onClick={() => improveRepositoryEntry.mutate()} type="button">
                  <SparkIcon />
                  <span>{improveRepositoryEntry.isPending ? "Improving..." : "AI improve"}</span>
                </button>
                <button className="primary-button" disabled={saveRepositoryEntry.isPending} onClick={() => saveRepositoryEntry.mutate()} type="button">
                  <PlayIcon />
                  <span>{saveRepositoryEntry.isPending ? "Saving..." : "Save field"}</span>
                </button>
                <button className="ghost-button" disabled={validateRepositoryEntry.isPending} onClick={() => validateRepositoryEntry.mutate()} type="button">
                  <LayersIcon />
                  <span>{validateRepositoryEntry.isPending ? "Validating..." : "Mark validated"}</span>
                </button>
                <button className="ghost-button danger" disabled={deleteRepositoryEntry.isPending} onClick={() => deleteRepositoryEntry.mutate()} type="button">
                  <TrashIcon size={16} />
                  <span>{deleteRepositoryEntry.isPending ? "Checking..." : "Delete field"}</span>
                </button>
              </div>
            ) : undefined}
          >
            {!selectedRepositoryEntry ? (
              <div className="empty-state compact">Select a repository field to curate execution criteria.</div>
            ) : (
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
                    { value: "validation", label: "History", meta: formatRepositoryDate(selectedRepositoryEntry.metadata?.last_validated_at) }
                  ]}
                />
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
                      <input value={repositoryDraft.screen_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_name: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>URL pattern</span>
                      <div className="repository-url-rule"><select value={repositoryDraft.url_pattern_type} onChange={(event) => setRepositoryDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={repositoryDraft.url_pattern_value} onChange={(event) => setRepositoryDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login" /></div>
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
                      <span>Screen fingerprint</span>
                      <input value={repositoryDraft.screen_fingerprint} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_fingerprint: event.target.value }))} placeholder="Generated screen identity hash" />
                    </label>
                    </div>
                  </div>
                ) : null}
                {fieldDetailTab === "evidence" ? (
                  <div className="record-grid testops-builder-form">
                    <label className="form-field"><span>Element screenshot URL</span><input value={repositoryDraft.element_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, element_screenshot_url: event.target.value }))} /></label>
                    <label className="form-field"><span>Ancestor screenshot URL</span><input value={repositoryDraft.ancestor_screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_screenshot_url: event.target.value }))} /></label>
                    <label className="form-field repository-span-two"><span>Parent / ancestor DOM snapshot</span><textarea rows={5} value={repositoryDraft.ancestor_dom || repositoryDraft.dom_structure} onChange={(event) => setRepositoryDraft((current) => ({ ...current, ancestor_dom: event.target.value }))} /></label>
                    <label className="form-field repository-span-two"><span>Accessibility tree</span><textarea rows={5} value={repositoryDraft.accessibility_tree} onChange={(event) => setRepositoryDraft((current) => ({ ...current, accessibility_tree: event.target.value }))} /></label>
                    {repositoryDraft.element_screenshot_url && isLikelyImageUrl(repositoryDraft.element_screenshot_url) ? <div className="object-repository-snapshot"><img alt={`${repositoryDraft.object_name} element`} src={repositoryDraft.element_screenshot_url} /></div> : null}
                  </div>
                ) : null}
                {fieldDetailTab === "meaning" ? (
                  <div className="record-grid testops-builder-form">
                    <label className="form-field repository-span-two"><span>AI-generated description</span><textarea rows={3} value={repositoryDraft.description} onChange={(event) => setRepositoryDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                    <label className="form-field repository-span-two"><span>Business meaning</span><textarea rows={3} value={repositoryDraft.business_meaning} onChange={(event) => setRepositoryDraft((current) => ({ ...current, business_meaning: event.target.value }))} /></label>
                    <label className="form-field"><span>Usage keywords</span><input value={repositoryDraft.usage_keywords} onChange={(event) => setRepositoryDraft((current) => ({ ...current, usage_keywords: event.target.value }))} placeholder="login, submit, authenticate" /></label>
                    <label className="form-field repository-span-two"><span>Healing guidance</span><textarea rows={3} value={repositoryDraft.fallback_strategy} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_strategy: event.target.value }))} /></label>
                  </div>
                ) : null}
                {fieldDetailTab === "validation" ? (
                  <div className="repository-validation-list">
                    <p>Last validated: {formatRepositoryDate(selectedRepositoryEntry.metadata?.last_validated_at)}</p>
                    {selectedValidationHistory.map((event, index) => <article key={`${normalizeMetadataValue(event.validatedAt)}-${index}`}><StatusBadge value={normalizeMetadataValue(event.status) || "unknown"} /><span>{formatRepositoryDate(event.validatedAt)}</span><code>{normalizeMetadataValue(event.locator)}</code></article>)}
                    {!selectedValidationHistory.length ? <div className="empty-state compact">Validate this locator to establish its first history record.</div> : null}
                  </div>
                ) : null}
              </div>
            )}
          </Panel>

          {isInspectOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div className="dialog object-repository-inspector" role="dialog" aria-modal="true" aria-label="Object repository inspector">
                <div className="dialog-header">
                  <div>
                    <h2>Inspect screen into repository</h2>
                    <p>Capture a screen identity and select controls to save ranked locators, visual evidence, DOM context, and agent meaning.</p>
                  </div>
                  <button className="ghost-button compact" onClick={() => setIsInspectOpen(false)} type="button">Close</button>
                </div>
                <div className="object-repository-live-inspect">
                  <div className="object-repository-inspector-steps" aria-label="Inspect capture steps">
                    <span className={recorderSession?.status === "running" ? "is-complete" : "is-active"}><strong>1</strong> Browser</span>
                    <span className={selectedInspectTabId ? "is-complete" : recorderSession?.status === "running" ? "is-active" : ""}><strong>2</strong> Select tab</span>
                    <span className={isInspectingLiveField ? "is-active" : lastInspectResult ? "is-complete" : ""}><strong>3</strong> Pick field</span>
                    <span className={lastInspectResult ? "is-complete" : ""}><strong>4</strong> Repository proof</span>
                  </div>
                  <div className="object-repository-live-inspect-head">
                    <div>
                      <strong>Live browser inspect</strong>
                      <span>{recorderSession?.status === "running" ? `Connected to session ${recorderSession.id.slice(0, 8)}. Tabs refresh automatically.` : activeManualCase ? "Launch the browser to begin capturing UI intelligence." : "Select or create a manual case before launching a capture browser."}</span>
                    </div>
                    <div className="testops-action-row">
                      <button
                        className="ghost-button"
                        disabled={!activeManualCase || startRecorder.isPending}
                        onClick={() => void launchInspectBrowser().catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to launch inspect browser."))}
                        type="button"
                      >
                        <MousePointerIcon />
                        <span>{recorderSession?.status === "running" ? "Use browser" : startRecorder.isPending ? "Launching..." : "Launch browser"}</span>
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!recorderSession?.id}
                        onClick={() => void loadInspectTabs().catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to refresh tabs."))}
                        type="button"
                      >
                        <LayersIcon />
                        <span>Refresh tabs</span>
                      </button>
                      <button
                        className="primary-button"
                        disabled={!recorderSession?.id || isInspectingLiveField}
                        onClick={() => void startLiveInspect().catch((error) => setInspectMessage(error instanceof Error ? error.message : "Unable to start inspect mode."))}
                        type="button"
                      >
                        <SparkIcon />
                        <span>{isInspectingLiveField ? "Waiting for click..." : "Start inspect"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="object-repository-capture-workspace">
                    <section className="object-repository-browser-preview">
                      <strong>Browser view</strong>
                      {recorderLiveUrl ? (
                        <iframe src={recorderLiveUrl} title="Inspect browser live view" />
                      ) : (
                        <div className="empty-state compact">Browser preview appears after the recorder starts.</div>
                      )}
                    </section>
                    <section className="object-repository-tab-area">
                      <strong>Open tabs</strong>
                      <div className="object-repository-tab-picker">
                        {inspectTabs.length ? inspectTabs.map((tab) => (
                          <button
                            className={selectedInspectTabId === tab.id ? "is-active" : ""}
                            key={tab.id || tab.url}
                            onClick={() => setSelectedInspectTabId(tab.id || "")}
                            type="button"
                          >
                            <strong>{tab.title || "Untitled tab"}</strong>
                            <span>{tab.url || "about:blank"}</span>
                          </button>
                        )) : (
                          <div className="empty-state compact">{recorderSession?.status === "running" ? "Waiting for an inspectable browser tab..." : "Launch the browser to load tabs."}</div>
                        )}
                      </div>
                    </section>
                  </div>
                  {inspectMessage ? <div className="object-repository-inspect-message">{inspectMessage}</div> : null}
                  {lastInspectResult ? (
                    <div className="object-repository-inspect-capture">
                      <div>
                        <strong>{lastInspectResult.element.friendly_name}</strong>
                        <span>{lastInspectResult.element.html_tag} · {lastInspectResult.element.locator}</span>
                      </div>
                      <div className="object-repository-capture-facts">
                        <span>{getCapturedLocators(lastInspectResult).length} locator strategies</span>
                        <span>{lastInspectResult.element_screenshot_url ? "Element evidence captured" : "Screen evidence captured"}</span>
                        <span>{lastInspectResult.screen_fingerprint ? "Fingerprint ready" : "Fingerprint pending"}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="object-repository-inspector-grid">
                  <div className="object-repository-inspector-inputs">
                    <div className="object-repository-inspector-section-head">
                      <strong>Screen evidence</strong>
                      <span>Review captured identity before returning to field curation.</span>
                    </div>
                    <label className="form-field">
                      <span>Suggested screen name</span>
                      <input value={repositoryDraft.screen_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_name: event.target.value }))} placeholder="Login Page" />
                    </label>
                    <label className="form-field">
                      <span>Screen URL path</span>
                      <input value={screenUrlDraft} onChange={(event) => setScreenUrlDraft(event.target.value)} placeholder="/login or https://app.example.com/login" />
                    </label>
                    <label className="form-field">
                      <span>URL match rule</span>
                      <div className="repository-url-rule"><select value={repositoryDraft.url_pattern_type} onChange={(event) => setRepositoryDraft((current) => ({ ...current, url_pattern_type: event.target.value }))}><option value="exact">exact</option><option value="startsWith">startsWith</option><option value="endsWith">endsWith</option><option value="contains">contains</option><option value="regex">regex</option></select><input value={repositoryDraft.url_pattern_value} onChange={(event) => setRepositoryDraft((current) => ({ ...current, url_pattern_value: event.target.value }))} placeholder="/auth/login" /></div>
                    </label>
                    <label className="form-field">
                      <span>Screen fingerprint</span>
                      <input value={repositoryDraft.screen_fingerprint} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_fingerprint: event.target.value }))} placeholder="Captured after live field selection" />
                    </label>
                    <label className="form-field">
                      <span>Screen DOM</span>
                      <textarea rows={10} value={screenDomDraft} onChange={(event) => setScreenDomDraft(event.target.value)} placeholder="<input name='username' aria-label='Username' />" />
                    </label>
                  </div>
                  <div className="object-repository-inspector-preview">
                    <div className="object-repository-inspector-section-head">
                      <strong>{inspectedFields.length ? `${inspectedFields.length} detected fields` : "Detected fields"}</strong>
                      <span>Select a DOM suggestion to curate it, or live inspect for screenshots.</span>
                    </div>
                    {inspectedFields.map((field) => (
                      <button key={`${field.name}-${field.locator}`} onClick={() => {
                        setRepositoryDraft((current) => ({
                          ...current,
                          screen_name: screenUrlDraft || selectedScreenName || current.screen_name,
                          object_name: field.name,
                          object_role: `${field.tag} / ${field.role}`,
                          locator: field.locator,
                          locator_kind: field.locatorKind,
                          fallback_locators: formatLocatorDraft([{ locator: field.locator, strategy: field.locatorKind, confidenceScore: 0.8, isPrimary: true }, ...field.fallbackLocators]),
                          dom_structure: field.dom,
                          description: current.description || `${field.name} detected from screen DOM.`,
                          screenshot_url: screenScreenshotDraft || current.screenshot_url
                        }));
                      }} type="button">
                        <span>{field.name}</span>
                        <small>{field.tag} · {field.locator}</small>
                      </button>
                    ))}
                    {!inspectedFields.length ? <div className="empty-state compact">Paste HTML DOM with inputs, buttons, selects, links, or textareas to extract fields.</div> : null}
                  </div>
                </div>
                <div className="testops-action-row">
                  <button className="ghost-button" disabled={!inspectedFields.length || createRepositoryField.isPending} onClick={() => inspectedFields.forEach((field) => createRepositoryField.mutate(field))} type="button">
                    <SparkIcon />
                    <span>{createRepositoryField.isPending ? "Extracting..." : "AI extract fields"}</span>
                  </button>
                  <button className="primary-button" onClick={() => {
                    setRepositoryDraft((current) => ({
                      ...current,
                      screen_name: screenUrlDraft || current.screen_name,
                      dom_structure: screenDomDraft || current.dom_structure,
                      screenshot_url: screenScreenshotDraft || current.screenshot_url
                    }));
                    setIsInspectOpen(false);
                  }} type="button">
                    <MousePointerIcon />
                    <span>Continue field curation</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "local-playwright" ? (
        <div className="automation-workspace-grid automation-workspace-grid--capture">
          <Panel title="Build repository with local Playwright" subtitle="Pick a manual case, open a local browser, and QAira will map captured actions back to keyword steps and repository objects.">
            <div className="record-grid testops-builder-form">
              <label className="form-field">
                <span>Manual case link</span>
                <select value={activeManualCase?.id || ""} onChange={(event) => setSelectedManualCaseId(event.target.value)}>
                  {manualCases.map((testCase) => (
                    <option key={testCase.id} value={testCase.id}>{testCase.title}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Start URL</span>
                <input onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com/login" value={startUrl} />
              </label>
              <label className="form-field">
                <span>Variables and locator guidance</span>
                <textarea onChange={(event) => setBuilderContext(event.target.value)} placeholder="Example: use @t.userEmail, @s.basePath, prefer data-testid locators, keep checkout screen names stable." rows={4} value={builderContext} />
              </label>
            </div>
            <div className="testops-action-row">
              <button className="ghost-button" disabled={!activeManualCase || buildSingleAutomation.isPending} onClick={() => buildSingleAutomation.mutate()} type="button">
                <SparkIcon />
                <span>{buildSingleAutomation.isPending ? "Queueing..." : "Queue AI automation"}</span>
              </button>
            </div>
            <RecorderStartControls
              disabled={!activeManualCase}
              hasSession={Boolean(recorderSession)}
              isStarting={startRecorder.isPending}
              localLabel="Build with Local Playwright"
              onStart={(options) => startRecorder.mutate(options)}
              primaryAction={(
                <button className="primary-button recorder-stop-button" disabled={!recorderSession || finishRecorder.isPending} onClick={() => finishRecorder.mutate()} type="button">
                  <PauseIcon />
                  <span>{finishRecorder.isPending ? "Saving..." : "Stop and save repository"}</span>
                </button>
              )}
            />
          </Panel>

          <Panel className="automation-detail-panel" title="Capture monitor" subtitle={recorderSession ? `Session ${recorderSession.id.slice(0, 8)} · ${formatRecorderDisplayMode(recorderSession.display_mode)}` : "Start local Playwright to see captured actions, network calls, and live view."}>
            {recorderSession ? (
              <div className="stack-list">
                <div className="stack-item">
                  <div>
                    <strong>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</strong>
                    <span>{recorderSession.start_url || startUrl || "No start URL supplied."}</span>
                  </div>
                  <StatusBadge value={recorderSession.status} />
                </div>
              </div>
            ) : null}
            {recorderLiveUrl ? <iframe allow="clipboard-read; clipboard-write" className="recorder-live-frame" src={recorderLiveUrl} title="QAira local Playwright live view" /> : null}
            <RecorderSessionInsights session={recorderSession} />
          </Panel>
        </div>
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
                <h2>{repositoryUsageBlock.title}</h2>
                <p>Delete is blocked because this repository object is referenced by automation or manual test steps.</p>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
