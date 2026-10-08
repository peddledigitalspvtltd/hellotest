import { instrumentAutomationLines, createAutomationLineTracer, type AutomationLineResult } from "./automationLineTrace.js";
import { resolveRepositoryLocator } from "./repositoryLocator.js";
import { createPlaywrightCodeBindings } from "./playwrightBindings.js";
import { parse } from "acorn";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Builder, By, Key, until, type WebDriver, type WebElement } from "selenium-webdriver";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "playwright";
import type { EngineArtifactRef, EngineRunEnvelope, EngineRunStep, EngineStepOutcomeStatus, EngineWebEngineProvider } from "../contracts/hellotest.js";
import {
  buildInitialContext,
  interpolateText,
  normalizeKey,
  normalizeText,
  registerContextValue,
  stringifyValue,
  toParameterValuesRecord,
  type RuntimeExecutionContext
} from "./runtimeContext.js";

type StepEvidence = {
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
};

type WebConsoleEntry = {
  type: string;
  text: string;
  timestamp: string;
  location?: string | null;
};

type WebNetworkEntry = {
  method: string;
  url: string;
  status?: number | null;
  resource_type?: string | null;
  error?: string | null;
  timestamp: string;
};

type WebDiagnosticsMarker = {
  started_at: string;
  console_index: number;
  network_index: number;
};

type WebStepDetail = {
  provider: EngineWebEngineProvider;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  url: string;
  console: WebConsoleEntry[];
  network: WebNetworkEntry[];
  captures: Record<string, string>;
};

type WebStepExecutionResult = {
  status: "passed" | "failed";
  note: string;
  captures: Record<string, string>;
  web_detail: WebStepDetail;
  line_results?: AutomationLineResult[];
  evidence?: StepEvidence | null;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type StepExecutionOptions = {
  step: EngineRunStep;
  context: RuntimeExecutionContext;
  envelope: EngineRunEnvelope;
  lineResults?: AutomationLineResult[];
  attempt?: number;
};

type PageLocatorFacade = {
  click: (options?: WebElementOptions) => Promise<void>;
  fill: (value: string, options?: WebFillOptions) => Promise<void>;
  press: (key: string, options?: WebElementOptions) => Promise<void>;
  hover: (options?: WebElementOptions) => Promise<void>;
  dblclick: (options?: WebElementOptions) => Promise<void>;
  selectOption: (value: string | string[], options?: WebElementOptions) => Promise<void>;
  setInputFiles: (files: string | string[], options?: WebElementOptions) => Promise<void>;
  check: (options?: WebElementOptions) => Promise<void>;
  uncheck: (options?: WebElementOptions) => Promise<void>;
  textContent: () => Promise<string>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  isVisible: () => Promise<boolean>;
  getAttribute: (name: string) => Promise<string | null>;
  waitFor: (options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<void>;
  first: () => PageLocatorFacade;
  nth: (index: number) => PageLocatorFacade;
  count: () => Promise<number>;
};

type PageFacade = {
  goto: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  click: (target: string) => Promise<void>;
  fill: (target: string, value: string) => Promise<void>;
  press: (target: string, key: string) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForURL: (expected: string) => Promise<void>;
  waitForLoadState: (state?: string) => Promise<void>;
  mouse: {
    wheel: (deltaX: number, deltaY: number) => Promise<void>;
  };
  waitForSelector: (target: string, options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<PageLocatorFacade>;
  url: () => Promise<string>;
  textContent: (target: string) => Promise<string>;
  locator: (target: string) => PageLocatorFacade;
  getByText: (target: string, options?: { exact?: boolean }) => PageLocatorFacade;
  getByLabel: (target: string, options?: { exact?: boolean }) => PageLocatorFacade;
  getByPlaceholder: (target: string, options?: { exact?: boolean }) => PageLocatorFacade;
  getByTestId: (target: string) => PageLocatorFacade;
  getByRole: (role: string, options?: { name?: string | RegExp; exact?: boolean }) => PageLocatorFacade;
  keyboard: {
    press: (key: string) => Promise<void>;
  };
};

type ExpectationApi = ((actual: unknown) => {
  toBe: (expected: unknown) => void;
  toContain: (expected: unknown) => void;
  toBeTruthy: () => void;
  toBeVisible: () => Promise<void>;
  toContainText: (expected: unknown) => Promise<void>;
  toHaveText: (expected: unknown) => Promise<void>;
  toHaveValue: (expected: unknown) => Promise<void>;
  toHaveURL: (expected: unknown) => Promise<void>;
}) & {
  equal: (actual: unknown, expected: unknown, label?: string) => void;
  truthy: (actual: unknown, label?: string) => void;
  contains: (actual: unknown, expected: unknown, label?: string) => void;
};

type WebExecutionBindings = {
  page: PageFacade;
  web: Record<string, unknown>;
  expect: ExpectationApi;
  params: Record<string, string>;
  capture: (parameter: string, value: unknown) => void;
  playwrightPage?: Page;
  driver?: WebDriver;
};

type WebElementOptions = {
  timeoutMs?: number;
  scroll?: "nearest" | "center" | "top" | "bottom" | "none" | boolean;
  waitFor?: "attached" | "visible" | "hidden" | "detached";
  force?: boolean;
  trial?: boolean;
  button?: "left" | "right" | "middle";
};

type WebFillOptions = WebElementOptions & {
  clear?: boolean;
  type?: "fill" | "char-by-char";
  delayMs?: number;
};

type WebGotoOptions = {
  timeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
};

type WebLoadState = "load" | "domcontentloaded" | "networkidle" | "commit";

type WebTabTarget =
  | string
  | number
  | {
      index?: number;
      title?: string;
      url?: string;
      latest?: boolean;
      current?: boolean;
    };

type WebTabInfo = {
  index: number;
  title: string;
  url: string;
  active: boolean;
};

type WebScrollOptions = {
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  deltaX?: number;
  deltaY?: number;
};

type WebSession = {
  readonly provider: EngineWebEngineProvider;
  start: () => Promise<void>;
  stop: (finalStatus?: EngineStepOutcomeStatus) => Promise<WebSessionArtifacts>;
  startRetryTrace?: () => Promise<void>;
  goto: (target: string, options?: WebGotoOptions) => Promise<void>;
  reload: (options?: WebGotoOptions) => Promise<void>;
  goBack: (options?: WebGotoOptions) => Promise<void>;
  goForward: (options?: WebGotoOptions) => Promise<void>;
  waitForLoadState: (state?: WebLoadState, options?: { timeoutMs?: number }) => Promise<void>;
  openTab: (target?: string | null, options?: WebGotoOptions) => Promise<void>;
  closeTab: (target?: WebTabTarget | null) => Promise<void>;
  switchTab: (target?: WebTabTarget | null) => Promise<void>;
  tabs: () => Promise<WebTabInfo[]>;
  click: (target: string, options?: WebElementOptions) => Promise<void>;
  hover: (target: string, options?: WebElementOptions) => Promise<void>;
  dblclick: (target: string, options?: WebElementOptions) => Promise<void>;
  rightClick: (target: string, options?: WebElementOptions) => Promise<void>;
  drag: (source: string, destination: string, options?: WebElementOptions) => Promise<void>;
  fill: (target: string, value: string, options?: WebFillOptions) => Promise<void>;
  select: (target: string, value: string, options?: WebElementOptions) => Promise<void>;
  check: (target: string, options?: WebElementOptions) => Promise<void>;
  uncheck: (target: string, options?: WebElementOptions) => Promise<void>;
  uploadFile: (target: string, files: string | string[], options?: WebElementOptions) => Promise<void>;
  uploadRemoteFile: (target: string, url: string, options?: WebElementOptions) => Promise<void>;
  press: (target: string | null, key: string, options?: WebElementOptions) => Promise<void>;
  scroll: (deltaX?: number, deltaY?: number, options?: WebScrollOptions) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForUrl: (expected: string, options?: { timeoutMs?: number; match?: "contains" | "equals" }) => Promise<void>;
  expectVisible: (target: string, options?: WebElementOptions) => Promise<void>;
  expectHidden: (target: string, options?: WebElementOptions) => Promise<void>;
  expectEnabled: (target: string, options?: WebElementOptions) => Promise<void>;
  expectText: (target: string | null, expected: string, options?: WebElementOptions & { match?: "contains" | "equals" }) => Promise<void>;
  text: (target: string, options?: WebElementOptions & { trim?: boolean }) => Promise<string>;
  value: (target: string, options?: WebElementOptions) => Promise<string>;
  screenshot: (label: string) => Promise<StepEvidence>;
  markDiagnostics: () => WebDiagnosticsMarker;
  collectDiagnostics: (marker: WebDiagnosticsMarker, captures: Record<string, string>, durationMs: number) => Promise<WebStepDetail>;
  bindings: () => Pick<WebExecutionBindings, "page" | "playwrightPage" | "driver">;
};

type WebSessionArtifacts = {
  trace_path?: string | null;
  video_path?: string | null;
  artifact_refs?: EngineArtifactRef[];
};

type ParsedAction =
  | { kind: "goto"; target: string }
  | { kind: "click"; target: string }
  | { kind: "fill"; target: string; value: string }
  | { kind: "press"; target: string | null; key: string }
  | { kind: "wait"; durationMs: number }
  | { kind: "check"; target: string }
  | { kind: "uncheck"; target: string };

type ParsedExpectation =
  | { kind: "url"; expected: string }
  | { kind: "visible"; target: string }
  | { kind: "visible_many"; targets: string[] }
  | { kind: "text"; target: string | null; expected: string };

const DEFAULT_SELENIUM_GRID_URL = String(process.env.SELENIUM_GRID_URL || "http://127.0.0.1:4444/wd/hub").trim();
const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT || "/artifacts";
const SELENIUM_BROWSER_MAP: Record<string, string> = {
  chromium: "chrome",
  firefox: "firefox",
  webkit: "MicrosoftEdge"
};

const AsyncFunction = Object.getPrototypeOf(async function () {
  return undefined;
}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

const PLAYWRIGHT_BROWSER_MAP = {
  chromium,
  firefox,
  webkit
} as const;

const normalizeProvider = (value: string | null | undefined): EngineWebEngineProvider =>
  value === "selenium" ? "selenium" : "playwright";

const normalizePositiveInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, next));
};

const resolveTimeoutPolicy = (envelope: EngineRunEnvelope) => ({
  navigation: normalizePositiveInteger(envelope.timeouts?.navigation_timeout_ms, 30_000, 1_000, 600_000),
  action: normalizePositiveInteger(envelope.timeouts?.action_timeout_ms, 5_000, 250, 120_000),
  assertion: normalizePositiveInteger(envelope.timeouts?.assertion_timeout_ms, 10_000, 250, 120_000),
  recoveryWait: normalizePositiveInteger(envelope.timeouts?.recovery_wait_ms, 750, 100, 30_000)
});

const clampTimeout = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(Math.max(250, numeric), 120_000) : fallback;
};

const normalizeElementOptions = (options?: WebElementOptions | null, fallbackTimeout = 10_000) => ({
  timeoutMs: clampTimeout(options?.timeoutMs, fallbackTimeout),
  scroll: options?.scroll ?? "nearest",
  waitFor: options?.waitFor || "visible",
  force: options?.force === true,
  trial: options?.trial === true,
  button: (options?.button === "right" || options?.button === "middle" ? options.button : "left") as "left" | "right" | "middle"
});

const normalizeLoadState = (value?: string | null): WebLoadState => {
  if (value === "networkidle" || value === "load" || value === "domcontentloaded" || value === "commit") {
    return value;
  }

  return "domcontentloaded";
};

const resolveScrollDelta = (deltaX?: number, deltaY?: number, options?: WebScrollOptions | null) => {
  const amount = Math.max(1, Math.abs(Number(options?.amount || 0)) || Math.max(Math.abs(Number(deltaY || 0)), Math.abs(Number(deltaX || 0)), 600));

  if (options?.direction === "up") {
    return { x: 0, y: -amount };
  }
  if (options?.direction === "down") {
    return { x: 0, y: amount };
  }
  if (options?.direction === "left") {
    return { x: -amount, y: 0 };
  }
  if (options?.direction === "right") {
    return { x: amount, y: 0 };
  }

  return {
    x: Number.isFinite(Number(options?.deltaX)) ? Number(options?.deltaX) : Number(deltaX || 0),
    y: Number.isFinite(Number(options?.deltaY)) ? Number(options?.deltaY) : Number(deltaY ?? 600)
  };
};

const shouldRecordVideo = (envelope: EngineRunEnvelope) => envelope.artifact_policy?.video_mode !== "off";

const shouldLaunchHeadless = (envelope: EngineRunEnvelope) => {
  if (envelope.headless !== false) {
    return true;
  }

  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }

  return false;
};

const shouldAttachVideo = (envelope: EngineRunEnvelope, finalStatus?: EngineStepOutcomeStatus) => {
  const mode = envelope.artifact_policy?.video_mode || "off";

  if (mode === "off") {
    return false;
  }

  if (mode === "retain-on-failure") {
    return finalStatus === "failed" || finalStatus === "blocked";
  }

  return true;
};

const maxVideoAttachmentBytes = (envelope: EngineRunEnvelope) =>
  normalizePositiveInteger(envelope.artifact_policy?.max_video_attachment_mb, 25, 1, 250) * 1024 * 1024;

type LiveViewEntry = {
  id: string;
  provider: EngineWebEngineProvider;
  startedAt: string;
  url: () => Promise<string>;
  screenshot: () => Promise<Buffer | null>;
};

const liveViewSessions = new Map<string, LiveViewEntry>();

export const getLiveSessionStatus = (provider: EngineWebEngineProvider = "playwright") => {
  const sessions = [...liveViewSessions.values()].filter((entry) => entry.provider === provider);
  const latest = sessions[sessions.length - 1] || null;

  return {
    provider,
    available: Boolean(latest),
    session_id: latest?.id || null,
    started_at: latest?.startedAt || null
  };
};

export const captureLiveSessionScreenshot = async (provider: EngineWebEngineProvider = "playwright") => {
  const sessions = [...liveViewSessions.values()].filter((entry) => entry.provider === provider);
  const latest = sessions[sessions.length - 1] || null;

  if (!latest) {
    return null;
  }

  return latest.screenshot();
};

const registerLiveViewSession = (entry: LiveViewEntry) => {
  liveViewSessions.set(entry.id, entry);
};

const unregisterLiveViewSession = (id: string | null) => {
  if (id) {
    liveViewSessions.delete(id);
  }
};

const normalizeBrowser = (value: string | null | undefined) => {
  const normalized = normalizeText(value)?.toLowerCase() || "chromium";

  if (normalized === "firefox") {
    return "firefox" as const;
  }

  if (normalized === "webkit" || normalized === "safari") {
    return "webkit" as const;
  }

  return "chromium" as const;
};

const stripWrappingQuotes = (value: string) => value.replace(/^["'`]+|["'`]+$/g, "").trim();

const escapeXPathLiteral = (value: string) => {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes("\"")) {
    return `"${value}"`;
  }

  return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "\"'\"", `)})`;
};

const extractQuotedText = (value: string) => {
  const match = value.match(/["'`](.+?)["'`]/);
  return match ? match[1].trim() : null;
};

const extractUrlCandidate = (value: string) => {
  const urlMatch = value.match(/https?:\/\/[^\s]+/i);

  if (urlMatch?.[0]) {
    return urlMatch[0];
  }

  const quotedPathMatch = value.match(/["'`](https?:\/\/[^"'`\s]+|\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)["'`]/i);

  if (quotedPathMatch?.[1]) {
    return quotedPathMatch[1];
  }

  const pathMatch = value.match(/(?:open|navigate|goto|go|visit)\s+(?:to\s+)?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/i);
  return pathMatch?.[1] || null;
};

const titleCaseLabel = (value: string) => value.replace(/\s+/g, " ").trim();

const buildExpectApi = (): ExpectationApi => {
  const getLocatorText = async (actual: unknown) => {
    const maybeLocator = actual as Partial<PageLocatorFacade> | null;

    if (maybeLocator && typeof maybeLocator.textContent === "function") {
      return maybeLocator.textContent();
    }

    if (maybeLocator && typeof maybeLocator.innerText === "function") {
      return maybeLocator.innerText();
    }

    return stringifyValue(actual);
  };

  const api = ((actual: unknown) => ({
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${stringifyValue(actual)} to equal ${stringifyValue(expected)}`);
      }
    },
    toContain(expected: unknown) {
      if (!String(actual ?? "").includes(String(expected ?? ""))) {
        throw new Error(`Expected ${stringifyValue(actual)} to contain ${stringifyValue(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${stringifyValue(actual)} to be truthy`);
      }
    },
    async toBeVisible() {
      const maybeLocator = actual as Partial<PageLocatorFacade> | null;

      if (!maybeLocator || typeof maybeLocator.isVisible !== "function") {
        throw new Error("Expected a page locator for toBeVisible().");
      }

      if (!await maybeLocator.isVisible()) {
        throw new Error("Expected locator to be visible.");
      }
    },
    async toContainText(expected: unknown) {
      const actualText = await getLocatorText(actual);
      if (!actualText.includes(String(expected ?? ""))) {
        throw new Error(`Expected ${stringifyValue(actualText)} to contain ${stringifyValue(expected)}`);
      }
    },
    async toHaveText(expected: unknown) {
      const actualText = await getLocatorText(actual);
      if (actualText !== String(expected ?? "")) {
        throw new Error(`Expected ${stringifyValue(actualText)} to equal ${stringifyValue(expected)}`);
      }
    },
    async toHaveValue(expected: unknown) {
      const maybeLocator = actual as Partial<PageLocatorFacade> | null;
      const actualValue =
        maybeLocator && typeof maybeLocator.inputValue === "function"
          ? await maybeLocator.inputValue()
          : stringifyValue(actual);

      if (actualValue !== String(expected ?? "")) {
        throw new Error(`Expected ${stringifyValue(actualValue)} to equal ${stringifyValue(expected)}`);
      }
    },
    async toHaveURL(expected: unknown) {
      const maybePage = actual as Partial<PageFacade> | null;
      const actualUrl =
        maybePage && typeof maybePage.url === "function"
          ? await maybePage.url()
          : stringifyValue(actual);
      const matcher = expected instanceof RegExp ? expected : null;
      const passed = matcher ? matcher.test(actualUrl) : actualUrl.includes(String(expected ?? ""));

      if (!passed) {
        throw new Error(`Expected URL ${stringifyValue(actualUrl)} to match ${stringifyValue(expected)}`);
      }
    }
  })) as ExpectationApi;

  api.equal = (actual, expected, label) => {
    if (actual !== expected) {
      throw new Error(label || `Expected ${stringifyValue(actual)} to equal ${stringifyValue(expected)}`);
    }
  };

  api.truthy = (actual, label) => {
    if (!actual) {
      throw new Error(label || `Expected ${stringifyValue(actual)} to be truthy`);
    }
  };

  api.contains = (actual, expected, label) => {
    if (!String(actual ?? "").includes(String(expected ?? ""))) {
      throw new Error(label || `Expected ${stringifyValue(actual)} to contain ${stringifyValue(expected)}`);
    }
  };

  return api;
};

const resolveNavigationTarget = (target: string, envelope: EngineRunEnvelope) => {
  const trimmed = stripWrappingQuotes(target);
  const baseUrl = normalizeText(envelope.environment?.base_url || null);

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/") && baseUrl) {
    return new URL(trimmed, baseUrl).toString();
  }

  if (["home", "homepage", "application", "site", "landing page"].includes(trimmed.toLowerCase()) && baseUrl) {
    return baseUrl;
  }

  return baseUrl ? new URL(trimmed, `${baseUrl.replace(/\/+$/, "")}/`).toString() : trimmed;
};

const parseActionText = (step: EngineRunStep, context: RuntimeExecutionContext): ParsedAction | null => {
  const action = interpolateText(step.action || "", context).trim();

  if (!action) {
    return null;
  }

  const normalized = action.toLowerCase();
  const urlCandidate = extractUrlCandidate(action);

  if (/^(open|navigate|goto|go|visit)\b/.test(normalized) || urlCandidate) {
    return {
      kind: "goto",
      target: urlCandidate || action.replace(/^(open|navigate|goto|go|visit)\s+(to\s+)?/i, "").trim()
    };
  }

  const fillMatch = action.match(/^(?:enter|type|fill|input|write)\s+(.+?)\s+(?:into|in|to)\s+(.+)$/i);
  if (fillMatch) {
    return {
      kind: "fill",
      value: stripWrappingQuotes(fillMatch[1]),
      target: stripWrappingQuotes(fillMatch[2])
    };
  }

  const clickMatch = action.match(/^(?:click|tap|submit|choose|select)\s+(.+)$/i);
  if (clickMatch) {
    return {
      kind: "click",
      target: stripWrappingQuotes(clickMatch[1].replace(/\s+(button|link|tab|option)$/i, ""))
    };
  }

  const waitMatch = action.match(/^wait(?: for)?\s+(\d+)\s*(ms|milliseconds|s|sec|seconds)?$/i);
  if (waitMatch) {
    const amount = Number.parseInt(waitMatch[1], 10);
    const unit = (waitMatch[2] || "ms").toLowerCase();

    return {
      kind: "wait",
      durationMs: unit.startsWith("s") ? amount * 1000 : amount
    };
  }

  const pressMatch = action.match(/^press\s+([A-Za-z0-9_]+)(?:\s+(?:on|in)\s+(.+))?$/i);
  if (pressMatch) {
    return {
      kind: "press",
      key: pressMatch[1].toUpperCase(),
      target: pressMatch[2] ? stripWrappingQuotes(pressMatch[2]) : null
    };
  }

  const checkMatch = action.match(/^(check|tick)\s+(.+)$/i);
  if (checkMatch) {
    return {
      kind: "check",
      target: stripWrappingQuotes(checkMatch[2])
    };
  }

  const uncheckMatch = action.match(/^(uncheck|untick)\s+(.+)$/i);
  if (uncheckMatch) {
    return {
      kind: "uncheck",
      target: stripWrappingQuotes(uncheckMatch[2])
    };
  }

  return null;
};

const normalizeExpectedVisibleTarget = (value: string) =>
  stripWrappingQuotes(value)
    .replace(/\b(fields?|buttons?|links?|controls?)\b/gi, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const splitExpectedTargetList = (value: string) =>
  value
    .split(/\s*,\s*|\s+and\s+/i)
    .map(normalizeExpectedVisibleTarget)
    .filter((item) => item.length > 0 && !/\b(page|screen|loads?|loaded|with|visible|displayed|shown)\b/i.test(item));

const extractExpectedVisibleTargets = (expected: string) => {
  if (!/\b(visible|displayed|shown|loads?|loaded|available|appears?)\b/i.test(expected)) {
    return [];
  }

  const targets = new Set<string>();

  for (const match of expected.matchAll(/["'`](.+?)["'`]\s*(?:button|link|field|control)?/gi)) {
    const target = normalizeExpectedVisibleTarget(match[1]);
    if (target) {
      targets.add(target);
    }
  }

  const fieldListMatch =
    expected.match(/\b(?:with|showing|contains?|has)\s+(.+?)\s+fields?\b/i)
    || expected.match(/([A-Za-z0-9_,\s'"`-]+?)\s+fields?\b/i);

  if (fieldListMatch?.[1]) {
    splitExpectedTargetList(fieldListMatch[1]).forEach((target) => targets.add(target));
  }

  const buttonListMatch = expected.match(/\b(?:and|with|has|contains?)\s+(.+?)\s+buttons?\b/i);
  if (buttonListMatch?.[1]) {
    splitExpectedTargetList(buttonListMatch[1]).forEach((target) => targets.add(target));
  }

  return [...targets];
};

const parseExpectedResult = (step: EngineRunStep, context: RuntimeExecutionContext): ParsedExpectation | null => {
  const expected = interpolateText(step.expected_result || "", context).trim();

  if (!expected) {
    return null;
  }

  const visibleTargets = extractExpectedVisibleTargets(expected);
  if (visibleTargets.length > 1) {
    return {
      kind: "visible_many",
      targets: visibleTargets
    };
  }

  if (visibleTargets.length === 1) {
    return {
      kind: "visible",
      target: visibleTargets[0]
    };
  }

  const urlCandidate = extractUrlCandidate(expected);
  const explicitUrlExpectation = expected.match(/\burl\s+(?:is|should be|contains|includes|ends with|starts with)\s+(.+)$/i);
  if (urlCandidate || explicitUrlExpectation?.[1]) {
    return {
      kind: "url",
      expected: stripWrappingQuotes(urlCandidate || explicitUrlExpectation?.[1] || expected)
    };
  }

  const visibleMatch = expected.match(/(.+?)\s+(?:is|should be)\s+(?:visible|displayed|shown)$/i);
  if (visibleMatch) {
    return {
      kind: "visible",
      target: normalizeExpectedVisibleTarget(visibleMatch[1])
    };
  }

  const quoted = extractQuotedText(expected);
  if (quoted) {
    return {
      kind: "text",
      target: null,
      expected: quoted
    };
  }

  return null;
};

const candidateTokens = (target: string) => {
  const trimmed = stripWrappingQuotes(target);
  const quoted = extractQuotedText(trimmed);
  const fallback = quoted || trimmed;

  return {
    raw: trimmed,
    text: fallback
  };
};

const normalizeRepositoryKey = (value: unknown) =>
  normalizeText(typeof value === "string" ? value : null)
    ?.toLowerCase()
    .replace(/page\b/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  || "";

type ObjectRepositoryEntry = NonNullable<EngineRunEnvelope["object_repository"]>[number];
type LocatorResolutionState = "attached" | "visible";

const uniqueTextValues = (values: Array<unknown>) => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = normalizeText(typeof value === "string" ? value : null);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result;
};

const normalizeRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const locatorValueFromUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return normalizeText(value);
  }

  const record = normalizeRecord(value);
  return normalizeText(
    typeof record.locator === "string"
      ? record.locator
      : typeof record.selector === "string"
        ? record.selector
        : typeof record.value === "string"
          ? record.value
          : null
  );
};

const repositoryFallbackLocators = (entry: ObjectRepositoryEntry) => {
  const record = entry as unknown as Record<string, unknown>;
  const metadata = normalizeRecord(record.metadata);
  const fallbackSources = [
    record.fallback_locators,
    metadata.fallback_locators,
    metadata.locator_candidates,
    metadata.previous_locators
  ];

  return uniqueTextValues(fallbackSources.flatMap((source) =>
    Array.isArray(source) ? source.map(locatorValueFromUnknown) : [locatorValueFromUnknown(source)]
  ));
};

const repositoryLocatorCandidatesForEntry = (entry: ObjectRepositoryEntry) => {
  const record = entry as unknown as Record<string, unknown>;
  const metadata = normalizeRecord(record.metadata);

  return uniqueTextValues([
    entry.locator,
    metadata.playwright_locator,
    metadata.primary_playwright_locator,
    metadata.locator,
    ...repositoryFallbackLocators(entry),
    ...(Array.isArray(entry.previous_locators) ? entry.previous_locators : [])
  ]);
};

const repositoryMatchKeysForEntry = (entry: ObjectRepositoryEntry) => {
  const record = entry as unknown as Record<string, unknown>;
  const metadata = normalizeRecord(record.metadata);

  return uniqueTextValues([
    entry.locator,
    entry.locator_intent,
    entry.object_name,
    entry.screen_name && entry.object_name ? `${entry.screen_name}.${entry.object_name}` : null,
    entry.page_key && entry.object_name ? `${entry.page_key}.${entry.object_name}` : null,
    entry.screen_name && entry.locator_intent ? `${entry.screen_name}.${entry.locator_intent}` : null,
    entry.page_key && entry.locator_intent ? `${entry.page_key}.${entry.locator_intent}` : null,
    metadata.object_label,
    metadata.object_name,
    metadata.playwright_locator,
    ...repositoryLocatorCandidatesForEntry(entry)
  ]).map(normalizeRepositoryKey).filter(Boolean);
};

const resolveObjectRepositoryLocatorCandidates = (envelope: EngineRunEnvelope, target: string) => {
  const targetKey = normalizeRepositoryKey(stripWrappingQuotes(target));

  if (!targetKey || !Array.isArray(envelope.object_repository)) {
    return [target];
  }

  const match = envelope.object_repository.find((entry) => {
    const candidates = repositoryMatchKeysForEntry(entry);
    return candidates.includes(targetKey);
  });

  if (!match) {
    return [target];
  }

  return uniqueTextValues([...repositoryLocatorCandidatesForEntry(match), target]);
};

const resolveObjectRepositoryLocator = (envelope: EngineRunEnvelope, target: string) =>
  resolveObjectRepositoryLocatorCandidates(envelope, target)[0] || target;

const unescapeLocatorLiteral = (value: string) => value.replace(/\\(["'`\\])/g, "$1");

const extractPlaywrightQuotedArgument = (source: string) => {
  const match = source.match(/\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/);
  return match ? unescapeLocatorLiteral(match[2]) : null;
};

const extractPlaywrightOptionName = (source: string) => {
  const match = source.match(/\bname\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/i);
  return match ? unescapeLocatorLiteral(match[2]) : null;
};

const extractPlaywrightOptionExact = (source: string) => /\bexact\s*:\s*true\b/i.test(source);

const buildPlaywrightLocatorCandidates = (page: Page, raw: string, text: string) => {
  // Explicit selectors keep Playwright strictness. Natural-language keywords may try semantic alternatives.
  if (/^(?:(?:page\.)?(?:getBy\w+|locator)\s*\(|[.#\[]|\/\/|(?:css|xpath|role|text|label|placeholder|testid|data-testid)=)|[ >+~\[]/.test(raw.trim())) {
    return [() => resolveRepositoryLocator(page, raw)];
  }
  const candidates: Array<() => Locator> = [];
  const push = (candidate: (() => Locator) | null | undefined) => {
    if (candidate) {
      candidates.push(candidate);
    }
  };
  const trimmed = raw.trim();
  const getByMatch = trimmed.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId)\s*\(/i);
  const locatorMatch = trimmed.match(/^(?:page\.)?locator\s*\(/i);
  const roleMatch = trimmed.match(/^role=([A-Za-z0-9_-]+)(?:\[name=(["']?)(.+?)\2\])?$/i);

  if (getByMatch) {
    const method = getByMatch[1].toLowerCase();
    const firstArg = extractPlaywrightQuotedArgument(trimmed);
    const name = extractPlaywrightOptionName(trimmed);
    const exact = extractPlaywrightOptionExact(trimmed);

    if (method === "getbyrole" && firstArg) {
      push(() => page.getByRole(firstArg as never, name ? { name, exact } as never : undefined));
    } else if (method === "getbylabel" && firstArg) {
      push(() => page.getByLabel(firstArg, { exact }));
    } else if (method === "getbyplaceholder" && firstArg) {
      push(() => page.getByPlaceholder(firstArg, { exact }));
    } else if (method === "getbytext" && firstArg) {
      push(() => page.getByText(firstArg, { exact }));
    } else if (method === "getbytestid" && firstArg) {
      push(() => page.getByTestId(firstArg));
    }
  } else if (locatorMatch) {
    const selector = extractPlaywrightQuotedArgument(trimmed);
    if (selector) {
      push(() => page.locator(selector));
    }
  }

  if (roleMatch) {
    const role = roleMatch[1];
    const name = roleMatch[3] ? unescapeLocatorLiteral(roleMatch[3]) : undefined;
    push(() => page.getByRole(role as never, name ? { name, exact: false } as never : undefined));
  }

  if (trimmed.startsWith("css=")) {
    push(() => page.locator(trimmed.slice(4)));
  } else if (trimmed.startsWith("xpath=") || trimmed.startsWith("//")) {
    push(() => page.locator(trimmed.startsWith("xpath=") ? trimmed : `xpath=${trimmed}`));
  } else if (trimmed.startsWith("text=")) {
    push(() => page.getByText(trimmed.slice(5), { exact: false }));
  } else if (trimmed.startsWith("label=")) {
    push(() => page.getByLabel(trimmed.slice(6), { exact: false }));
  } else if (trimmed.startsWith("placeholder=")) {
    push(() => page.getByPlaceholder(trimmed.slice(12), { exact: false }));
  } else if (/^(?:testid|data-testid)=/i.test(trimmed)) {
    push(() => page.getByTestId(trimmed.replace(/^(?:testid|data-testid)=/i, "")));
  } else if (trimmed.startsWith("id=")) {
    push(() => page.locator(`#${trimmed.slice(3)}`));
  } else if (trimmed.startsWith("name=")) {
    push(() => page.locator(`[name="${trimmed.slice(5).replace(/"/g, '\\"')}"]`));
  }

  push(() => page.getByLabel(text, { exact: false }));
  push(() => page.getByPlaceholder(text, { exact: false }));
  push(() => page.getByRole("button", { name: text, exact: false }));
  push(() => page.getByRole("link", { name: text, exact: false }));
  push(() => page.getByText(text, { exact: false }));
  push(() => page.locator(trimmed));

  return candidates;
};

const normalizeUploadFiles = (files: string | string[]) => {
  if (Array.isArray(files)) {
    return files.map((file) => String(file || "").trim()).filter(Boolean);
  }

  const raw = String(files || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((file) => String(file || "").trim()).filter(Boolean);
    }
  } catch {
    // Plain file paths are the common case.
  }

  return raw.includes("\n")
    ? raw.split(/\r?\n/).map((file) => file.trim()).filter(Boolean)
    : [raw];
};

const safeUploadFileName = (url: string, contentType?: string | null) => {
  try {
    const parsed = new URL(url);
    const fileName = path.basename(parsed.pathname).replace(/[^A-Za-z0-9._-]+/g, "-");
    if (fileName && fileName !== "." && fileName !== "/") {
      return fileName;
    }
  } catch {
    // Fall through to content-type based naming.
  }

  if (/pdf/i.test(contentType || "")) return "remote-upload.pdf";
  if (/png/i.test(contentType || "")) return "remote-upload.png";
  if (/jpe?g/i.test(contentType || "")) return "remote-upload.jpg";
  if (/json/i.test(contentType || "")) return "remote-upload.json";
  return "remote-upload.bin";
};

const downloadRemoteUploadFile = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to download remote upload file: ${response.status} ${response.statusText}`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hellotest-upload-"));
  const filePath = path.join(tempDir, safeUploadFileName(url, response.headers.get("content-type")));
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));

  return {
    filePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true })
  };
};

const createPlaywrightLocatorFacade = (resolver: (target: string, resolutionState?: LocatorResolutionState) => Promise<Locator>, target: string): PageLocatorFacade => {
  const prepare = async (options?: WebElementOptions | null, fallbackTimeout = 10_000) => {
    const normalized = normalizeElementOptions(options, fallbackTimeout);
    const locator = await resolver(target, normalized.waitFor === "visible" ? "visible" : "attached");

    if (normalized.waitFor !== "hidden" && normalized.waitFor !== "detached") {
      await locator.waitFor({ state: normalized.waitFor, timeout: normalized.timeoutMs });
    }

    if (normalized.scroll && normalized.scroll !== "none") {
      await locator.scrollIntoViewIfNeeded({ timeout: normalized.timeoutMs }).catch(() => undefined);
    }

    return { locator, options: normalized };
  };

  return {
  click: async (options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.click({
      button: prepared.options.button,
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  },
  fill: async (value: string, options?: WebFillOptions) => {
    const prepared = await prepare(options);
    const targetLocator = prepared.locator.locator("input, textarea, select, [contenteditable=true], [role=textbox]").first();
    const targetCount = await targetLocator.count().catch(() => 0);
    const locator = targetCount > 0 ? targetLocator : prepared.locator;
    const fillOptions = {
      clear: options?.clear !== false,
      type: options?.type || "fill",
      delayMs: Math.max(0, Number(options?.delayMs || 0))
    };

    if (fillOptions.type === "char-by-char") {
      if (fillOptions.clear) {
        await locator.fill("", { timeout: prepared.options.timeoutMs });
      }
      await locator.pressSequentially(value, { delay: fillOptions.delayMs, timeout: prepared.options.timeoutMs });
      return;
    }

    await locator.fill(value, { timeout: prepared.options.timeoutMs });
  },
  press: async (key: string, options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.press(key, { timeout: prepared.options.timeoutMs });
  },
  hover: async (options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.hover({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  },
  dblclick: async (options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.dblclick({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  },
  selectOption: async (value: string | string[], options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.selectOption(value, { timeout: prepared.options.timeoutMs });
  },
  setInputFiles: async (files: string | string[], options?: WebElementOptions) => {
    const prepared = await prepare({ ...(options || {}), waitFor: options?.waitFor || "attached", scroll: options?.scroll ?? "none" });
    const fileInput = prepared.locator.locator("input[type=file]").first();
    const fileInputCount = await fileInput.count().catch(() => 0);
    const targetLocator = fileInputCount > 0 ? fileInput : prepared.locator;
    await targetLocator.setInputFiles(normalizeUploadFiles(files), { timeout: prepared.options.timeoutMs });
  },
  check: async (options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.check({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  },
  uncheck: async (options?: WebElementOptions) => {
    const prepared = await prepare(options);
    await prepared.locator.uncheck({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  },
  textContent: async () => {
    const locator = await resolver(target);
    return (await locator.textContent()) || "";
  },
  innerText: async () => {
    const locator = await resolver(target);
    return (await locator.innerText()) || "";
  },
  inputValue: async () => {
    const locator = await resolver(target);
    return await locator.inputValue();
  },
  isVisible: async () => {
    const locator = await resolver(target);
    return locator.isVisible();
  },
  getAttribute: async (name: string) => {
    const locator = await resolver(target);
    return locator.getAttribute(name);
  },
  waitFor: async (options) => {
    const locator = await resolver(target);
    await locator.waitFor({
      state: options?.state || "visible",
      timeout: options?.timeout
    });
  },
  first: () => createPlaywrightLocatorFacade(async (value) => (await resolver(value)).first(), target),
  nth: (index: number) => createPlaywrightLocatorFacade(async (value) => (await resolver(value)).nth(index), target),
  count: async () => {
    const locator = await resolver(target);
    return locator.count();
  }
  };
};

class PlaywrightWebSession implements WebSession {
  readonly provider: EngineWebEngineProvider = "playwright";
  private browser: Browser | null = null;
  private tracing = false;
  private browserContext: BrowserContext | null = null;
  private browserPage: Page | null = null;
  private observedPages = new WeakSet<Page>();
  private ownsBrowser = true;
  private ownsContext = true;
  private consoleEntries: WebConsoleEntry[] = [];
  private networkEntries: WebNetworkEntry[] = [];
  private liveSessionId: string | null = null;
  private readonly timeouts: ReturnType<typeof resolveTimeoutPolicy>;

  constructor(private readonly envelope: EngineRunEnvelope) {
    this.timeouts = resolveTimeoutPolicy(envelope);
  }

  private get pageOrThrow() {
    if (!this.browserPage) {
      throw new Error("Playwright page has not been initialized");
    }

    return this.browserPage;
  }

  private get contextOrThrow() {
    if (!this.browserContext) {
      throw new Error("Playwright browser context has not been initialized");
    }

    return this.browserContext;
  }

  private usePage(page: Page) {
    this.browserPage = page;
    this.registerPageTelemetry(page);
  }

  private registerPageTelemetry(page: Page) {
    if (this.observedPages.has(page)) {
      return;
    }

    this.observedPages.add(page);
    page.on("console", (message) => {
      if (this.envelope.artifact_policy?.capture_console === false || this.consoleEntries.length >= 500) return;
      const location = message.location();
      this.consoleEntries.push({
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
        location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null
      });
    });
    page.on("response", (response) => {
      if (this.envelope.artifact_policy?.capture_network === false || this.networkEntries.length >= 1000) return;
      const request = response.request();
      this.networkEntries.push({
        method: request.method(),
        url: response.url(),
        status: response.status(),
        resource_type: request.resourceType(),
        timestamp: new Date().toISOString()
      });
    });
    page.on("requestfailed", (request) => {
      if (this.envelope.artifact_policy?.capture_network === false || this.networkEntries.length >= 1000) return;
      this.networkEntries.push({
        method: request.method(),
        url: request.url(),
        status: null,
        resource_type: request.resourceType(),
        error: request.failure()?.errorText || "request failed",
        timestamp: new Date().toISOString()
      });
    });
  }

  async start() {
    if (this.browserPage) {
      return;
    }

    const cdpEndpoint = normalizeText(this.envelope.session_policy?.web?.connect_over_cdp_endpoint || null);
    const shouldAttach = normalizeText(this.envelope.session_policy?.web?.mode || null) === "attach" && Boolean(cdpEndpoint);

    if (shouldAttach && cdpEndpoint) {
      this.browser = await chromium.connectOverCDP(cdpEndpoint);
      this.ownsBrowser = this.envelope.session_policy?.web?.close_on_finish === true;
      this.browserContext = this.browser.contexts()[0] || await this.browser.newContext({ ignoreHTTPSErrors: true });
      this.ownsContext = false;
      this.browserPage = this.browserContext.pages()[0] || await this.browserContext.newPage();
    } else {
      const browserType = PLAYWRIGHT_BROWSER_MAP[normalizeBrowser(this.envelope.browser)];
      this.browser = await browserType.launch({
        headless: shouldLaunchHeadless(this.envelope),
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {})
      });
      this.ownsBrowser = true;
      this.ownsContext = true;
      this.browserContext = await this.browser.newContext({
        ignoreHTTPSErrors: true,
        ...(shouldRecordVideo(this.envelope)
          ? {
              recordVideo: {
                dir: path.join(ARTIFACT_ROOT, "playwright-videos", this.envelope.engine_run_id),
                size: {
                  width: 960,
                  height: 540
                }
              }
            }
          : {})
      });
      this.browserPage = await this.browserContext.newPage();
    }
    if (this.ownsContext && ["on", "retain-on-failure"].includes(this.envelope.artifact_policy?.trace_mode)) {
      await this.browserContext?.tracing.start({ screenshots: true, snapshots: true });
      this.tracing = true;
    }
    this.liveSessionId = `${this.envelope.engine_run_id}:playwright`;
    registerLiveViewSession({
      id: this.liveSessionId,
      provider: this.provider,
      startedAt: new Date().toISOString(),
      url: async () => this.browserPage?.url() || "",
      screenshot: async () => {
        if (!this.browserPage || this.browserPage.isClosed()) {
          return null;
        }

        try {
          return await this.browserPage.screenshot({
            type: "jpeg",
            quality: 45,
            fullPage: false
          });
        } catch {
          return null;
        }
      }
    });
    if (this.browserPage) {
      this.usePage(this.browserPage);
    }
  }

  async startRetryTrace() {
    if (this.ownsContext && !this.tracing && this.envelope.artifact_policy?.trace_mode === "on-first-retry") {
      await this.browserContext?.tracing.start({ screenshots: true, snapshots: true });
      this.tracing = true;
    }
  }

  async stop(finalStatus?: EngineStepOutcomeStatus) {
    const video = this.browserPage?.video() || null;
    const shouldAttach = shouldAttachVideo(this.envelope, finalStatus);
    const artifactPath = `artifacts/${this.envelope.engine_run_id}/video.webm`;
    const artifactFullPath = path.join(ARTIFACT_ROOT, artifactPath);
    const artifacts: WebSessionArtifacts = { trace_path: null, video_path: null, artifact_refs: [] };
    if (this.tracing) {
      const retain = this.envelope.artifact_policy?.trace_mode !== "retain-on-failure" || finalStatus === "failed" || finalStatus === "blocked";
      const tracePath = `artifacts/${this.envelope.engine_run_id}/trace.zip`;
      const fullPath = path.join(ARTIFACT_ROOT, tracePath);
      try {
        if (retain) await mkdir(path.dirname(fullPath), { recursive: true });
        await this.browserContext?.tracing.stop(retain ? { path: fullPath } : {});
        if (retain) {
          const metadata = await stat(fullPath);
          artifacts.trace_path = tracePath;
          artifacts.artifact_refs?.push({ kind: "trace", label: "Playwright execution trace", path: tracePath, file_name: "trace.zip", content_type: "application/zip", size_bytes: metadata.size, ...(metadata.size <= 8 * 1024 * 1024 ? { content_base64: (await readFile(fullPath)).toString("base64") } : {}) });
        }
      } catch { /* Evidence collection must not replace the actual case result. */ }
      this.tracing = false;
    }

    unregisterLiveViewSession(this.liveSessionId);

    if (this.ownsContext) {
      await this.browserContext?.close();
    }

    if (video && shouldAttach) {
      try {
        await mkdir(path.dirname(artifactFullPath), { recursive: true });
        await video.saveAs(artifactFullPath);
        const videoStats = await stat(artifactFullPath);
        artifacts.video_path = artifactPath;
        artifacts.artifact_refs = [
          ...(artifacts.artifact_refs || []),
          {
            kind: "video",
            label: "Compressed browser run video",
            path: artifactPath,
            file_name: "video.webm",
            content_type: "video/webm",
            size_bytes: videoStats.size,
            ...(videoStats.size <= maxVideoAttachmentBytes(this.envelope)
              ? { content_base64: (await readFile(artifactFullPath)).toString("base64") }
              : {})
          }
        ];
      } catch {
        artifacts.video_path = null;
      }
    }

    await video?.delete().catch(() => undefined);
    if (this.ownsBrowser) {
      await this.browser?.close();
    }
    this.browserContext = null;
    this.browser = null;
    this.browserPage = null;
    this.liveSessionId = null;

    return artifacts;
  }

  private async resolveLocator(target: string, resolutionState: LocatorResolutionState = "visible", deferWait = false) {
    const page = this.pageOrThrow;
    const candidateTargets = resolveObjectRepositoryLocatorCandidates(this.envelope, target);
    if (deferWait) {
      const locators = candidateTargets.map((candidate) => resolveRepositoryLocator(page, candidate));
      for (const locator of locators) if (await locator.count().catch(() => 0)) return locator;
      return locators[0] || page.locator(target);
    }
    let lastError: unknown = null;

    for (const candidateTarget of candidateTargets) {
      const tokens = candidateTokens(candidateTarget);
      const locatorCandidates = buildPlaywrightLocatorCandidates(page, tokens.raw, tokens.text);

      for (const candidate of locatorCandidates) {
        try {
          const locator = candidate();
          if (!deferWait) await locator.waitFor({ state: resolutionState, timeout: this.timeouts.action });
          return locator;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${target}" in the browser page`);
  }

  private async prepareLocator(target: string, options?: WebElementOptions | null, fallbackTimeout = this.timeouts.action) {
    const normalized = normalizeElementOptions(options, fallbackTimeout);
    const locator = await this.resolveLocator(target, normalized.waitFor === "visible" ? "visible" : "attached");

    if (normalized.waitFor !== "hidden" && normalized.waitFor !== "detached") {
      await locator.waitFor({ state: normalized.waitFor, timeout: normalized.timeoutMs });
    }

    if (normalized.scroll && normalized.scroll !== "none") {
      await locator.scrollIntoViewIfNeeded({ timeout: normalized.timeoutMs }).catch(() => undefined);
    }

    return { locator, options: normalized };
  }

  async goto(target: string, options?: WebGotoOptions) {
    await this.pageOrThrow.goto(target, {
      waitUntil: options?.waitUntil || "domcontentloaded",
      timeout: clampTimeout(options?.timeoutMs, Math.min(Math.max(1_000, this.envelope.run_timeout_seconds * 1000), this.timeouts.navigation))
    });
  }

  async reload(options?: WebGotoOptions) {
    await this.pageOrThrow.reload({
      waitUntil: normalizeLoadState(options?.waitUntil),
      timeout: clampTimeout(options?.timeoutMs, this.timeouts.navigation)
    });
  }

  async goBack(options?: WebGotoOptions) {
    await this.pageOrThrow.goBack({
      waitUntil: normalizeLoadState(options?.waitUntil),
      timeout: clampTimeout(options?.timeoutMs, this.timeouts.navigation)
    });
  }

  async goForward(options?: WebGotoOptions) {
    await this.pageOrThrow.goForward({
      waitUntil: normalizeLoadState(options?.waitUntil),
      timeout: clampTimeout(options?.timeoutMs, this.timeouts.navigation)
    });
  }

  async waitForLoadState(state?: WebLoadState, options?: { timeoutMs?: number }) {
    const loadState = normalizeLoadState(state);
    if (loadState === "commit") {
      await this.pageOrThrow.waitForLoadState("domcontentloaded", { timeout: clampTimeout(options?.timeoutMs, this.timeouts.assertion) });
      return;
    }

    await this.pageOrThrow.waitForLoadState(loadState, { timeout: clampTimeout(options?.timeoutMs, this.timeouts.assertion) });
  }

  private async resolvePageTarget(target?: WebTabTarget | null) {
    const pages = this.contextOrThrow.pages().filter((page) => !page.isClosed());

    if (!pages.length) {
      throw new Error("No browser tabs are available");
    }

    if (target === undefined || target === null) {
      return this.pageOrThrow;
    }

    if (typeof target === "number") {
      const page = pages[target];
      if (!page) {
        throw new Error(`No browser tab exists at index ${target}`);
      }
      return page;
    }

    if (typeof target === "object") {
      if (target.current) {
        return this.pageOrThrow;
      }
      if (target.latest) {
        return pages[pages.length - 1];
      }
      if (typeof target.index === "number") {
        const page = pages[target.index];
        if (!page) {
          throw new Error(`No browser tab exists at index ${target.index}`);
        }
        return page;
      }
      if (target.url) {
        const page = pages.find((candidate) => candidate.url().includes(target.url || ""));
        if (page) {
          return page;
        }
      }
      if (target.title) {
        for (const page of pages) {
          const title = await page.title().catch(() => "");
          if (title.includes(target.title || "")) {
            return page;
          }
        }
      }
    }

    const raw = stripWrappingQuotes(String(target)).trim();
    const normalized = raw.toLowerCase();

    if (!raw || normalized === "current" || normalized === "active") {
      return this.pageOrThrow;
    }
    if (normalized === "latest" || normalized === "last") {
      return pages[pages.length - 1];
    }
    if (normalized === "first") {
      return pages[0];
    }
    if (/^\d+$/.test(raw)) {
      const page = pages[Number.parseInt(raw, 10)];
      if (page) {
        return page;
      }
    }

    for (const page of pages) {
      const title = await page.title().catch(() => "");
      if (page.url().includes(raw) || title.includes(raw)) {
        return page;
      }
    }

    throw new Error(`Unable to find browser tab "${raw}"`);
  }

  async openTab(target?: string | null, options?: WebGotoOptions) {
    const page = await this.contextOrThrow.newPage();
    this.usePage(page);
    await page.bringToFront().catch(() => undefined);

    const normalizedTarget = normalizeText(target || null);
    if (normalizedTarget) {
      await this.goto(normalizedTarget, options);
    }
  }

  async closeTab(target?: WebTabTarget | null) {
    const context = this.contextOrThrow;
    const page = await this.resolvePageTarget(target);
    const wasActive = page === this.browserPage;
    await page.close({ runBeforeUnload: true }).catch(() => undefined);

    if (wasActive) {
      const remainingPages = context.pages().filter((candidate) => !candidate.isClosed());
      const nextPage = remainingPages[remainingPages.length - 1] || await context.newPage();
      this.usePage(nextPage);
      await nextPage.bringToFront().catch(() => undefined);
    }
  }

  async switchTab(target?: WebTabTarget | null) {
    const page = await this.resolvePageTarget(target ?? "latest");
    this.usePage(page);
    await page.bringToFront().catch(() => undefined);
  }

  async tabs() {
    const activePage = this.browserPage;
    const pages = this.contextOrThrow.pages().filter((page) => !page.isClosed());
    const tabInfos: WebTabInfo[] = [];

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      tabInfos.push({
        index,
        title: await page.title().catch(() => ""),
        url: page.url(),
        active: page === activePage
      });
    }

    return tabInfos;
  }

  async click(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.click({
      button: prepared.options.button,
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  }

  async hover(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.hover({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  }

  async dblclick(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.dblclick({
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  }

  async rightClick(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.click({
      button: "right",
      force: prepared.options.force,
      trial: prepared.options.trial,
      timeout: prepared.options.timeoutMs
    });
  }

  async drag(source: string, destination: string, options?: WebElementOptions) {
    const preparedSource = await this.prepareLocator(source, options);
    const preparedDestination = await this.prepareLocator(destination, options);
    await preparedSource.locator.dragTo(preparedDestination.locator, {
      force: preparedSource.options.force,
      timeout: preparedSource.options.timeoutMs
    });
  }

  async fill(target: string, value: string, options?: WebFillOptions) {
    const prepared = await this.prepareLocator(target, options);
    const locator = prepared.locator;
    const fillOptions = {
      ...prepared.options,
      clear: options?.clear !== false,
      type: options?.type || "fill",
      delayMs: Math.max(0, Number(options?.delayMs || 0))
    };
    const editableDescendant = locator.locator("input, textarea, select, [contenteditable=true], [role=textbox]").first();
    const editableDescendantCount = await editableDescendant.count().catch(() => 0);
    const targetLocator = editableDescendantCount > 0 ? editableDescendant : locator;

    if (fillOptions.type === "char-by-char") {
      if (fillOptions.clear) {
        await targetLocator.fill("", { timeout: fillOptions.timeoutMs });
      }
      await targetLocator.pressSequentially(value, { delay: fillOptions.delayMs, timeout: fillOptions.timeoutMs });
      return;
    }

    await targetLocator.fill(value, { timeout: fillOptions.timeoutMs });
  }

  async select(target: string, value: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    const optionValue = (() => {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : value;
      } catch {
        return value;
      }
    })();
    await prepared.locator.selectOption(optionValue, { timeout: prepared.options.timeoutMs });
  }

  async check(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.check({ force: prepared.options.force, trial: prepared.options.trial, timeout: prepared.options.timeoutMs });
  }

  async uncheck(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.uncheck({ force: prepared.options.force, trial: prepared.options.trial, timeout: prepared.options.timeoutMs });
  }

  async uploadFile(target: string, files: string | string[], options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, { ...(options || {}), waitFor: options?.waitFor || "attached", scroll: options?.scroll ?? "none" });
    const fileInput = prepared.locator.locator("input[type=file]").first();
    const fileInputCount = await fileInput.count().catch(() => 0);
    const targetLocator = fileInputCount > 0 ? fileInput : prepared.locator;
    const normalizedFiles = normalizeUploadFiles(files);

    if (!normalizedFiles.length) {
      throw new Error(`No file path was provided for ${target}`);
    }

    await targetLocator.setInputFiles(normalizedFiles, { timeout: prepared.options.timeoutMs });
  }

  async uploadRemoteFile(target: string, url: string, options?: WebElementOptions) {
    const downloaded = await downloadRemoteUploadFile(url);

    try {
      await this.uploadFile(target, downloaded.filePath, options);
    } finally {
      await downloaded.cleanup().catch(() => undefined);
    }
  }

  async press(target: string | null, key: string, options?: WebElementOptions) {
    if (!target) {
      await this.pageOrThrow.keyboard.press(key);
      return;
    }

    const prepared = await this.prepareLocator(target, options);
    await prepared.locator.press(key, { timeout: prepared.options.timeoutMs });
  }

  async scroll(deltaX = 0, deltaY = 600, options?: WebScrollOptions) {
    const delta = resolveScrollDelta(deltaX, deltaY, options);
    await this.pageOrThrow.mouse.wheel(delta.x, delta.y);
  }

  async waitForTimeout(ms: number) {
    await this.pageOrThrow.waitForTimeout(Math.max(0, ms));
  }

  async waitForUrl(expected: string, options?: { timeoutMs?: number }) {
    const resolved = stripWrappingQuotes(expected);
    await this.pageOrThrow.waitForURL((url) => url.toString().includes(resolved), {
      timeout: clampTimeout(options?.timeoutMs, this.timeouts.assertion)
    });
  }

  async expectVisible(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options, this.timeouts.assertion);
    const locator = prepared.locator;
    const isVisible = await locator.isVisible();

    if (!isVisible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectHidden(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, { ...(options || {}), waitFor: "attached", scroll: options?.scroll ?? "none" }, this.timeouts.assertion);
    const isVisible = await prepared.locator.isVisible();

    if (isVisible) {
      throw new Error(`Expected ${target} to be hidden`);
    }
  }

  async expectEnabled(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options, this.timeouts.assertion);
    const isEnabled = await prepared.locator.isEnabled({ timeout: prepared.options.timeoutMs });

    if (!isEnabled) {
      throw new Error(`Expected ${target} to be enabled`);
    }
  }

  async expectText(target: string | null, expected: string, options?: WebElementOptions & { match?: "contains" | "equals" }) {
    const normalized = normalizeElementOptions(options, this.timeouts.assertion);
    if (!target) {
      await this.pageOrThrow.getByText(expected, { exact: options?.match === "equals" }).first().waitFor({ state: "visible", timeout: normalized.timeoutMs });
      return;
    }

    const actual = await this.text(target, options);
    const passed = options?.match === "equals" ? actual === expected : actual.includes(expected);
    if (!passed) {
      throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
    }
  }

  async text(target: string, options?: WebElementOptions & { trim?: boolean }) {
    const prepared = await this.prepareLocator(target, options, this.timeouts.assertion);
    const value = (await prepared.locator.textContent({ timeout: prepared.options.timeoutMs })) || "";
    return options?.trim === false ? value : value.trim();
  }

  async value(target: string, options?: WebElementOptions) {
    const prepared = await this.prepareLocator(target, options, this.timeouts.assertion);
    return await prepared.locator.inputValue({ timeout: prepared.options.timeoutMs });
  }

  async screenshot(label: string) {
    const buffer = await this.pageOrThrow.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 58
    });

    return {
      dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      fileName: `${label}.jpg`,
      mimeType: "image/jpeg"
    };
  }

  markDiagnostics() {
    return {
      started_at: new Date().toISOString(),
      console_index: this.consoleEntries.length,
      network_index: this.networkEntries.length
    };
  }

  async collectDiagnostics(marker: WebDiagnosticsMarker, captures: Record<string, string>, durationMs: number) {
    return {
      provider: this.provider,
      started_at: marker.started_at,
      ended_at: new Date().toISOString(),
      duration_ms: durationMs,
      url: this.browserPage ? this.browserPage.url() : "",
      console: this.consoleEntries.slice(marker.console_index).slice(-80),
      network: this.networkEntries.slice(marker.network_index).slice(-120),
      captures
    };
  }

  bindings() {
    const pageFacade: PageFacade = {
      goto: (url: string) => this.goto(url),
      reload: () => this.reload(),
      goBack: () => this.goBack(),
      goForward: () => this.goForward(),
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      waitForLoadState: async (state?: string) => this.waitForLoadState(normalizeLoadState(state), { timeoutMs: this.timeouts.assertion }),
      mouse: {
        wheel: (deltaX: number, deltaY: number) => this.scroll(deltaX, deltaY)
      },
      waitForSelector: async (target: string, options) => {
        const locator = createPlaywrightLocatorFacade((value) => this.resolveLocator(value, "visible", true), target);
        await locator.waitFor(options);
        return locator;
      },
      url: async () => this.pageOrThrow.url(),
      textContent: (target: string) => this.text(target),
      locator: (target: string) => createPlaywrightLocatorFacade((value) => this.resolveLocator(value, "visible", true), target),
      getByText: (target: string, options) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByText(value, options)), target),
      getByLabel: (target: string, options) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByLabel(value, options)), target),
      getByPlaceholder: (target: string, options) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByPlaceholder(value, options)), target),
      getByTestId: (target: string) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByTestId(value)), target),
      getByRole: (role: string, options?: { name?: string | RegExp; exact?: boolean }) => {
        const target = options?.name === undefined ? role : String(options.name);
        return createPlaywrightLocatorFacade(
          () => Promise.resolve(this.pageOrThrow.getByRole(role as never, options as never)),
          target
        );
      },
      keyboard: {
        press: (key: string) => this.press(null, key)
      }
    };

    return {
      page: pageFacade,
      playwrightPage: this.pageOrThrow
    };
  }
}

const createSeleniumLocatorFacade = (resolveElement: (target: string) => Promise<WebElement>, target: string): PageLocatorFacade => ({
  click: async (_options?: WebElementOptions) => {
    const element = await resolveElement(target);
    await element.click();
  },
  fill: async (value: string, _options?: WebFillOptions) => {
    const element = await resolveElement(target);
    await element.clear();
    await element.sendKeys(value);
  },
  press: async (key: string, _options?: WebElementOptions) => {
    const element = await resolveElement(target);
    await element.sendKeys(key);
  },
  hover: async (_options?: WebElementOptions) => {
    const element = await resolveElement(target);
    await element.getRect();
  },
  dblclick: async (_options?: WebElementOptions) => {
    const element = await resolveElement(target);
    await element.click();
    await element.click();
  },
  selectOption: async (value: string | string[], _options?: WebElementOptions) => {
    const element = await resolveElement(target);
    await element.sendKeys(Array.isArray(value) ? value[0] || "" : value);
  },
  setInputFiles: async (files: string | string[], _options?: WebElementOptions) => {
    const element = await resolveElement(target);
    const descendants = await element.findElements(By.css("input[type='file']")).catch(() => []);
    const targetElement = descendants[0] || element;
    await targetElement.sendKeys(normalizeUploadFiles(files).join("\n"));
  },
  check: async (_options?: WebElementOptions) => {
    const element = await resolveElement(target);
    if (!await element.isSelected().catch(() => false)) {
      await element.click();
    }
  },
  uncheck: async (_options?: WebElementOptions) => {
    const element = await resolveElement(target);
    if (await element.isSelected().catch(() => false)) {
      await element.click();
    }
  },
  textContent: async () => {
    const element = await resolveElement(target);
    return (await element.getText()) || "";
  },
  innerText: async () => {
    const element = await resolveElement(target);
    return (await element.getText()) || "";
  },
  inputValue: async () => {
    const element = await resolveElement(target);
    return (await element.getAttribute("value")) || "";
  },
  isVisible: async () => {
    const element = await resolveElement(target);
    return element.isDisplayed();
  },
  getAttribute: async (name: string) => {
    const element = await resolveElement(target);
    return element.getAttribute(name);
  },
  waitFor: async () => {
    await resolveElement(target);
  },
  first: () => createSeleniumLocatorFacade(resolveElement, target),
  nth: () => createSeleniumLocatorFacade(resolveElement, target),
  count: async () => {
    try {
      await resolveElement(target);
      return 1;
    } catch {
      return 0;
    }
  }
});

class SeleniumWebSession implements WebSession {
  readonly provider: EngineWebEngineProvider = "selenium";
  private driverInstance: WebDriver | null = null;
  private networkEntries: WebNetworkEntry[] = [];
  private readonly timeouts: ReturnType<typeof resolveTimeoutPolicy>;

  constructor(private readonly envelope: EngineRunEnvelope) {
    this.timeouts = resolveTimeoutPolicy(envelope);
  }

  private get driverOrThrow() {
    if (!this.driverInstance) {
      throw new Error("Selenium driver has not been initialized");
    }

    return this.driverInstance;
  }

  async start() {
    if (this.driverInstance) {
      return;
    }

    const seleniumBrowser = SELENIUM_BROWSER_MAP[normalizeBrowser(this.envelope.browser)] || "chrome";
    this.driverInstance = await new Builder()
      .usingServer(DEFAULT_SELENIUM_GRID_URL)
      .forBrowser(seleniumBrowser)
      .build();
    await this.driverInstance.manage().setTimeouts({
      implicit: this.timeouts.action,
      pageLoad: Math.min(Math.max(1_000, this.envelope.run_timeout_seconds * 1000), this.timeouts.navigation),
      script: this.timeouts.action
    });
  }

  async stop(_finalStatus?: EngineStepOutcomeStatus) {
    await this.driverInstance?.quit();
    this.driverInstance = null;
    return {};
  }

  private byStrategies(target: string) {
    const tokens = candidateTokens(target);
    const raw = tokens.raw.trim();
    const getByMatch = raw.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|locator)\s*\(/i);
    const roleMatch = raw.match(/^role=([A-Za-z0-9_-]+)(?:\[name=(["']?)(.+?)\2\])?$/i);

    if (getByMatch) {
      const method = getByMatch[1].toLowerCase();
      const firstArg = extractPlaywrightQuotedArgument(raw);
      const name = extractPlaywrightOptionName(raw);

      if (method === "locator" && firstArg) {
        return [By.css(firstArg)];
      }
      if (method === "getbytestid" && firstArg) {
        const escaped = escapeXPathLiteral(firstArg);
        return [By.xpath(`//*[@data-testid=${escaped} or @data-test=${escaped} or @data-qa=${escaped}]`)];
      }
      if (method === "getbylabel" && firstArg) {
        const escaped = escapeXPathLiteral(firstArg);
        return [By.xpath(`//*[@aria-label=${escaped} or @placeholder=${escaped} or @name=${escaped}] | //label[contains(normalize-space(.), ${escaped})]/following::*[self::input or self::textarea or self::select][1]`)];
      }
      if (method === "getbyplaceholder" && firstArg) {
        return [By.xpath(`//*[@placeholder=${escapeXPathLiteral(firstArg)}]`)];
      }
      if (method === "getbyrole" && firstArg) {
        const role = escapeXPathLiteral(firstArg);
        const roleName = name ? escapeXPathLiteral(name) : null;
        return [By.xpath(roleName
          ? `//*[@role=${role} and (@aria-label=${roleName} or contains(normalize-space(.), ${roleName}))] | //*[self::button or self::a or self::input or self::select or self::textarea][@aria-label=${roleName} or contains(normalize-space(.), ${roleName})]`
          : `//*[@role=${role}]`)];
      }
      if (method === "getbytext" && firstArg) {
        return [By.xpath(`//*[contains(normalize-space(.), ${escapeXPathLiteral(firstArg)})]`)];
      }
    }

    if (roleMatch) {
      const role = escapeXPathLiteral(roleMatch[1].toLowerCase());
      const name = roleMatch[3] ? escapeXPathLiteral(unescapeLocatorLiteral(roleMatch[3])) : null;
      return [By.xpath(name
        ? `//*[@role=${role} and (@aria-label=${name} or contains(normalize-space(.), ${name}))] | //*[self::button or self::a or self::input or self::select or self::textarea][@aria-label=${name} or contains(normalize-space(.), ${name})]`
        : `//*[@role=${role}]`)];
    }

    if (tokens.raw.startsWith("css=")) {
      return [By.css(tokens.raw.slice(4))];
    }

    if (tokens.raw.startsWith("xpath=")) {
      return [By.xpath(tokens.raw.slice(6))];
    }

    if (tokens.raw.startsWith("//")) {
      return [By.xpath(tokens.raw)];
    }

    if (tokens.raw.startsWith("id=")) {
      return [By.id(tokens.raw.slice(3))];
    }

    if (tokens.raw.startsWith("name=")) {
      return [By.name(tokens.raw.slice(5))];
    }

    if (tokens.raw.startsWith("text=")) {
      const escapedText = escapeXPathLiteral(tokens.raw.slice(5));
      return [By.xpath(`//*[contains(normalize-space(.), ${escapedText})]`)];
    }

    if (tokens.raw.startsWith("label=")) {
      const escaped = escapeXPathLiteral(tokens.raw.slice(6));
      return [By.xpath(`//*[@aria-label=${escaped} or @placeholder=${escaped} or @name=${escaped}] | //label[contains(normalize-space(.), ${escaped})]/following::*[self::input or self::textarea or self::select][1]`)];
    }

    if (tokens.raw.startsWith("placeholder=")) {
      return [By.xpath(`//*[@placeholder=${escapeXPathLiteral(tokens.raw.slice(12))}]`)];
    }

    if (/^(?:testid|data-testid)=/i.test(tokens.raw)) {
      const escaped = escapeXPathLiteral(tokens.raw.replace(/^(?:testid|data-testid)=/i, ""));
      return [By.xpath(`//*[@data-testid=${escaped} or @data-test=${escaped} or @data-qa=${escaped}]`)];
    }

    const escaped = escapeXPathLiteral(tokens.text);

    return [
      By.css(tokens.raw),
      By.xpath(`//*[@id=${escaped} or @name=${escaped} or @placeholder=${escaped} or @aria-label=${escaped}]`),
      By.xpath(`//label[contains(normalize-space(.), ${escaped})]/following::*[self::input or self::textarea or self::select][1]`),
      By.xpath(`//*[self::button or self::a or @role='button' or @role='link'][contains(normalize-space(.), ${escaped})]`),
      By.xpath(`//*[contains(normalize-space(.), ${escaped})]`)
    ];
  }

  private async resolveElement(target: string) {
    const driver = this.driverOrThrow;
    const resolvedTargets = resolveObjectRepositoryLocatorCandidates(this.envelope, target);
    let lastError: unknown = null;

    for (const resolvedTarget of resolvedTargets) {
      for (const strategy of this.byStrategies(resolvedTarget)) {
        try {
          const matches = await driver.findElements(strategy);
          const visibleMatch = matches[0];

          if (visibleMatch) {
            return visibleMatch;
          }
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${target}" in Selenium`);
  }

  async goto(target: string, _options?: WebGotoOptions) {
    await this.driverOrThrow.get(target);
    this.networkEntries.push({
      method: "GET",
      url: target,
      status: null,
      resource_type: "document",
      timestamp: new Date().toISOString()
    });
  }

  async reload(_options?: WebGotoOptions) {
    await this.driverOrThrow.navigate().refresh();
    await this.waitForLoadState();
  }

  async goBack(_options?: WebGotoOptions) {
    await this.driverOrThrow.navigate().back();
    await this.waitForLoadState();
  }

  async goForward(_options?: WebGotoOptions) {
    await this.driverOrThrow.navigate().forward();
    await this.waitForLoadState();
  }

  async waitForLoadState(_state?: WebLoadState, options?: { timeoutMs?: number }) {
    await this.driverOrThrow.wait(async () => {
      const readyState = await this.driverOrThrow.executeScript("return document.readyState;");
      return readyState === "interactive" || readyState === "complete";
    }, clampTimeout(options?.timeoutMs, this.timeouts.assertion));
  }

  private async resolveWindowTarget(target?: WebTabTarget | null) {
    const driver = this.driverOrThrow;
    const handles = await driver.getAllWindowHandles();

    if (!handles.length) {
      throw new Error("No browser tabs are available");
    }

    if (target === undefined || target === null) {
      return driver.getWindowHandle();
    }

    if (typeof target === "number") {
      const handle = handles[target];
      if (!handle) {
        throw new Error(`No browser tab exists at index ${target}`);
      }
      return handle;
    }

    if (typeof target === "object") {
      if (target.current) {
        return driver.getWindowHandle();
      }
      if (target.latest) {
        return handles[handles.length - 1];
      }
      if (typeof target.index === "number") {
        const handle = handles[target.index];
        if (!handle) {
          throw new Error(`No browser tab exists at index ${target.index}`);
        }
        return handle;
      }
    }

    const raw = stripWrappingQuotes(String(target)).trim();
    const normalized = raw.toLowerCase();
    if (!raw || normalized === "current" || normalized === "active") {
      return driver.getWindowHandle();
    }
    if (normalized === "latest" || normalized === "last") {
      return handles[handles.length - 1];
    }
    if (normalized === "first") {
      return handles[0];
    }
    if (/^\d+$/.test(raw)) {
      const handle = handles[Number.parseInt(raw, 10)];
      if (handle) {
        return handle;
      }
    }

    const current = await driver.getWindowHandle().catch(() => "");
    for (const handle of handles) {
      await driver.switchTo().window(handle);
      const [title, url] = await Promise.all([
        driver.getTitle().catch(() => ""),
        driver.getCurrentUrl().catch(() => "")
      ]);
      if (url.includes(raw) || title.includes(raw)) {
        return handle;
      }
    }

    if (current) {
      await driver.switchTo().window(current).catch(() => undefined);
    }

    throw new Error(`Unable to find browser tab "${raw}"`);
  }

  async openTab(target?: string | null, options?: WebGotoOptions) {
    await this.driverOrThrow.switchTo().newWindow("tab");
    const normalizedTarget = normalizeText(target || null);

    if (normalizedTarget) {
      await this.goto(normalizedTarget, options);
    }
  }

  async closeTab(target?: WebTabTarget | null) {
    const driver = this.driverOrThrow;
    const handle = await this.resolveWindowTarget(target);
    await driver.switchTo().window(handle);
    await driver.close();

    const remainingHandles = await driver.getAllWindowHandles();
    if (remainingHandles.length) {
      await driver.switchTo().window(remainingHandles[remainingHandles.length - 1]);
    }
  }

  async switchTab(target?: WebTabTarget | null) {
    const handle = await this.resolveWindowTarget(target ?? "latest");
    await this.driverOrThrow.switchTo().window(handle);
  }

  async tabs() {
    const driver = this.driverOrThrow;
    const handles = await driver.getAllWindowHandles();
    const activeHandle = await driver.getWindowHandle().catch(() => "");
    const tabInfos: WebTabInfo[] = [];

    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      await driver.switchTo().window(handle);
      tabInfos.push({
        index,
        title: await driver.getTitle().catch(() => ""),
        url: await driver.getCurrentUrl().catch(() => ""),
        active: handle === activeHandle
      });
    }

    if (activeHandle) {
      await driver.switchTo().window(activeHandle).catch(() => undefined);
    }

    return tabInfos;
  }

  async click(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    await element.click();
  }

  async hover(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.actions().move({ origin: element }).perform();
  }

  async dblclick(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.actions().doubleClick(element).perform();
  }

  async rightClick(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.actions().contextClick(element).perform();
  }

  async drag(source: string, destination: string, _options?: WebElementOptions) {
    const sourceElement = await this.resolveElement(source);
    const destinationElement = await this.resolveElement(destination);
    await this.driverOrThrow.actions().dragAndDrop(sourceElement, destinationElement).perform();
  }

  async fill(target: string, value: string, options?: WebFillOptions) {
    const element = await this.resolveElement(target);
    const descendants = await element.findElements(By.css("input, textarea, select, [contenteditable='true'], [role='textbox']")).catch(() => []);
    const targetElement = descendants[0] || element;

    if (options?.clear !== false) {
      await targetElement.clear();
    }

    if (options?.type === "char-by-char") {
      const delayMs = Math.max(0, Number(options.delayMs || 0));
      for (const char of value) {
        await targetElement.sendKeys(char);
        if (delayMs) {
          await this.driverOrThrow.sleep(delayMs);
        }
      }
      return;
    }

    await targetElement.sendKeys(value);
  }

  async select(target: string, value: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.executeScript(
      "const element = arguments[0]; const raw = arguments[1]; const values = (() => { try { const parsed = JSON.parse(String(raw)); return Array.isArray(parsed) ? parsed.map(String) : [String(raw)]; } catch { return [String(raw)]; } })(); Array.from(element.options || []).forEach((option) => { option.selected = values.includes(String(option.value)); }); if (!element.multiple) element.value = values[0] || ''; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));",
      element,
      value
    );
  }

  async check(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    const checked = await element.isSelected().catch(() => false);
    if (!checked) {
      await element.click();
    }
  }

  async uncheck(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    const checked = await element.isSelected().catch(() => false);
    if (checked) {
      await element.click();
    }
  }

  async uploadFile(target: string, files: string | string[], _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    const descendants = await element.findElements(By.css("input[type='file']")).catch(() => []);
    const targetElement = descendants[0] || element;
    const normalizedFiles = normalizeUploadFiles(files);

    if (!normalizedFiles.length) {
      throw new Error(`No file path was provided for ${target}`);
    }

    await targetElement.sendKeys(normalizedFiles.join("\n"));
  }

  async uploadRemoteFile(target: string, url: string, options?: WebElementOptions) {
    const downloaded = await downloadRemoteUploadFile(url);

    try {
      await this.uploadFile(target, downloaded.filePath, options);
    } finally {
      await downloaded.cleanup().catch(() => undefined);
    }
  }

  async press(target: string | null, key: string, _options?: WebElementOptions) {
    const seleniumKey = (Key as unknown as Record<string, string>)[key.toUpperCase()] || key;

    if (!target) {
      await this.driverOrThrow.actions().sendKeys(seleniumKey).perform();
      return;
    }

    const element = await this.resolveElement(target);
    await element.sendKeys(seleniumKey);
  }

  async scroll(deltaX = 0, deltaY = 600, options?: WebScrollOptions) {
    const delta = resolveScrollDelta(deltaX, deltaY, options);
    await this.driverOrThrow.executeScript("window.scrollBy(arguments[0], arguments[1]);", delta.x, delta.y);
  }

  async waitForTimeout(ms: number) {
    await this.driverOrThrow.sleep(Math.max(0, ms));
  }

  async waitForUrl(expected: string, options?: { timeoutMs?: number }) {
    await this.driverOrThrow.wait(until.urlContains(stripWrappingQuotes(expected)), clampTimeout(options?.timeoutMs, this.timeouts.assertion));
  }

  async expectVisible(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    const visible = await element.isDisplayed();

    if (!visible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectHidden(target: string, _options?: WebElementOptions) {
    try {
      const element = await this.resolveElement(target);
      const visible = await element.isDisplayed();
      if (visible) {
        throw new Error(`Expected ${target} to be hidden`);
      }
    } catch (error) {
      if (error instanceof Error && /^Expected /.test(error.message)) {
        throw error;
      }
    }
  }

  async expectEnabled(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    const enabled = await element.isEnabled();

    if (!enabled) {
      throw new Error(`Expected ${target} to be enabled`);
    }
  }

  async expectText(target: string | null, expected: string, options?: WebElementOptions & { match?: "contains" | "equals" }) {
    if (!target) {
      const source = await this.driverOrThrow.getPageSource();
      if (!source.includes(expected)) {
        throw new Error(`Expected the page to include "${expected}"`);
      }
      return;
    }

    const actual = await this.text(target);
    const passed = options?.match === "equals" ? actual === expected : actual.includes(expected);
    if (!passed) {
      throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
    }
  }

  async text(target: string, options?: WebElementOptions & { trim?: boolean }) {
    const element = await this.resolveElement(target);
    const value = (await element.getText()) || "";
    return options?.trim === false ? value : value.trim();
  }

  async value(target: string, _options?: WebElementOptions) {
    const element = await this.resolveElement(target);
    return (await element.getAttribute("value")) || "";
  }

  async screenshot(label: string) {
    const base64 = await this.driverOrThrow.takeScreenshot();

    return {
      dataUrl: `data:image/png;base64,${base64}`,
      fileName: `${label}.png`,
      mimeType: "image/png"
    };
  }

  markDiagnostics() {
    return {
      started_at: new Date().toISOString(),
      console_index: 0,
      network_index: this.networkEntries.length
    };
  }

  async collectDiagnostics(marker: WebDiagnosticsMarker, captures: Record<string, string>, durationMs: number) {
    let consoleEntries: WebConsoleEntry[] = [];

    try {
      const manager = this.driverOrThrow.manage() as unknown as {
        logs?: () => {
          get: (type: string) => Promise<Array<{ level?: { name?: string } | string; message?: string; timestamp?: number }>>;
        };
      };
      const browserLogs = await manager.logs?.().get("browser");
      consoleEntries = (browserLogs || []).slice(-80).map((entry) => ({
        type: typeof entry.level === "string" ? entry.level : entry.level?.name || "browser",
        text: String(entry.message || ""),
        timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
      }));
    } catch {
      consoleEntries = [];
    }

    return {
      provider: this.provider,
      started_at: marker.started_at,
      ended_at: new Date().toISOString(),
      duration_ms: durationMs,
      url: await this.driverOrThrow.getCurrentUrl(),
      console: consoleEntries,
      network: this.networkEntries.slice(marker.network_index).slice(-120),
      captures
    };
  }

  bindings() {
    const pageFacade: PageFacade = {
      goto: (url: string) => this.goto(url),
      reload: () => this.reload(),
      goBack: () => this.goBack(),
      goForward: () => this.goForward(),
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      waitForLoadState: async (state?: string) => this.waitForLoadState(normalizeLoadState(state)),
      mouse: {
        wheel: (deltaX: number, deltaY: number) => this.scroll(deltaX, deltaY)
      },
      waitForSelector: async (target: string) => {
        const locator = createSeleniumLocatorFacade((value) => this.resolveElement(value), target);
        await locator.waitFor();
        return locator;
      },
      url: () => this.driverOrThrow.getCurrentUrl(),
      textContent: (target: string) => this.text(target),
      locator: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(value), target),
      getByText: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(`text=${value}`), target),
      getByLabel: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(value), target),
      getByPlaceholder: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(value), target),
      getByTestId: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(`testid=${value}`), target),
      getByRole: (_role: string, options?: { name?: string | RegExp; exact?: boolean }) => {
        const target = options?.name instanceof RegExp ? options.name.source : options?.name ? String(options.name) : _role;
        return createSeleniumLocatorFacade((value) => this.resolveElement(value), target);
      },
      keyboard: {
        press: (key: string) => this.press(null, key)
      }
    };

    return {
      page: pageFacade,
      driver: this.driverOrThrow
    };
  }
}

const createWebSession = (envelope: EngineRunEnvelope): WebSession =>
  normalizeProvider(envelope.web_engine?.active) === "selenium"
    ? new SeleniumWebSession(envelope)
    : new PlaywrightWebSession(envelope);

const applyGeneratedAction = async (
  session: WebSession,
  step: EngineRunStep,
  context: RuntimeExecutionContext,
  envelope: EngineRunEnvelope
) => {
  const action = parseActionText(step, context);

  if (!action) {
    throw new Error("No executable web automation code or recognizable step action was found.");
  }

  switch (action.kind) {
    case "goto":
      await session.goto(resolveNavigationTarget(action.target, envelope));
      return;
    case "click":
      await session.click(action.target);
      return;
    case "fill":
      await session.fill(action.target, action.value);
      return;
    case "press":
      await session.press(action.target, action.key);
      return;
    case "wait":
      await session.waitForTimeout(action.durationMs);
      return;
    case "check":
      await session.click(action.target);
      return;
    case "uncheck":
      await session.click(action.target);
      return;
    default:
      return;
  }
};

const applyGeneratedExpectation = async (
  session: WebSession,
  step: EngineRunStep,
  context: RuntimeExecutionContext
) => {
  const expectation = parseExpectedResult(step, context);

  if (!expectation) {
    return;
  }

  if (expectation.kind === "url") {
    await session.waitForUrl(expectation.expected);
    return;
  }

  if (expectation.kind === "visible") {
    await session.expectVisible(expectation.target);
    return;
  }

  if (expectation.kind === "visible_many") {
    for (const target of expectation.targets) {
      await session.expectVisible(target);
    }
    return;
  }

  await session.expectText(expectation.target, expectation.expected);
};

const buildBindings = (
  session: WebSession,
  context: RuntimeExecutionContext,
  captures: Record<string, string>,
  envelope: EngineRunEnvelope
): WebExecutionBindings => {
  const capture = (parameter: string, value: unknown) => {
    const normalizedKey = normalizeKey(parameter);

    if (!normalizedKey) {
      return;
    }

    const stringValue = stringifyValue(value);
    captures[normalizedKey] = stringValue;
    registerContextValue(context, normalizedKey, stringValue);
  };

  const expect = buildExpectApi();
  const providerBindings = session.bindings();
  const resolveTarget = (target: string) => interpolateText(target, context);
  const resolveTabTarget = (target?: WebTabTarget | null, asNavigationTarget = false): WebTabTarget | undefined => {
    if (target === undefined || target === null) {
      return undefined;
    }

    if (typeof target === "string") {
      const interpolated = interpolateText(target, context);
      return asNavigationTarget ? resolveNavigationTarget(interpolated, envelope) : interpolated;
    }

    if (typeof target === "number") {
      return target;
    }

    return {
      ...target,
      title: target.title ? interpolateText(target.title, context) : undefined,
      url: target.url ? interpolateText(target.url, context) : undefined
    };
  };
  const page: PageFacade = {
    goto: async (target: string) => providerBindings.page.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
    reload: () => providerBindings.page.reload(),
    goBack: () => providerBindings.page.goBack(),
    goForward: () => providerBindings.page.goForward(),
    click: async (target: string) => providerBindings.page.click(resolveTarget(target)),
    fill: async (target: string, value: string) => providerBindings.page.fill(resolveTarget(target), interpolateText(value, context)),
    press: async (target: string, key: string) => {
      const resolvedTarget = resolveTarget(target).trim();
      return resolvedTarget ? providerBindings.page.press(resolvedTarget, interpolateText(key, context)) : providerBindings.page.keyboard.press(interpolateText(key, context));
    },
    waitForTimeout: (ms: number) => providerBindings.page.waitForTimeout(ms),
    waitForURL: async (expected: string) => providerBindings.page.waitForURL(interpolateText(expected, context)),
    waitForLoadState: (state?: string) => providerBindings.page.waitForLoadState(state),
    mouse: {
      wheel: (deltaX: number, deltaY: number) => providerBindings.page.mouse.wheel(deltaX, deltaY)
    },
    waitForSelector: async (target: string, options) => providerBindings.page.waitForSelector(resolveTarget(target), options),
    url: () => providerBindings.page.url(),
    textContent: async (target: string) => providerBindings.page.textContent(resolveTarget(target)),
    locator: (target: string) => providerBindings.page.locator(resolveTarget(target)),
    getByText: (target: string, options) => providerBindings.page.getByText(interpolateText(target, context), options),
    getByLabel: (target: string, options) => providerBindings.page.getByLabel(interpolateText(target, context), options),
    getByPlaceholder: (target: string, options) => providerBindings.page.getByPlaceholder(interpolateText(target, context), options),
    getByTestId: (target: string) => providerBindings.page.getByTestId(interpolateText(target, context)),
    getByRole: (role: string, options?: { name?: string | RegExp; exact?: boolean }) =>
      providerBindings.page.getByRole(role, {
        ...options,
        name: typeof options?.name === "string" ? interpolateText(options.name, context) : options?.name
      }),
    keyboard: {
      press: (key: string) => providerBindings.page.keyboard.press(interpolateText(key, context))
    }
  };

  const web = {
    step: async (_title: string, fn: () => Promise<unknown>) => fn(),
    aiStep: async (_instruction: string, _options?: { target?: string | null }) => {
      throw new Error("This instruction has no executable automation. Use Build with automation agent, review the generated steps, then run again.");
    },
    goto: async (target: string, options?: WebGotoOptions) => session.goto(resolveNavigationTarget(interpolateText(target, context), envelope), options),
    reload: async (options?: WebGotoOptions) => session.reload(options),
    goBack: async (options?: WebGotoOptions) => session.goBack(options),
    goForward: async (options?: WebGotoOptions) => session.goForward(options),
    waitForLoadState: async (state?: WebLoadState, options?: { timeoutMs?: number }) => session.waitForLoadState(state, options),
    openTab: async (target?: string | null, options?: WebGotoOptions) => session.openTab(resolveTabTarget(target, true) as string | undefined, options),
    switchTab: async (target?: WebTabTarget | null) => session.switchTab(resolveTabTarget(target)),
    closeTab: async (target?: WebTabTarget | null) => session.closeTab(resolveTabTarget(target)),
    tabs: async () => session.tabs(),
    click: async (target: string, options?: WebElementOptions) => session.click(resolveTarget(target), options),
    hover: async (target: string, options?: WebElementOptions) => session.hover(resolveTarget(target), options),
    dblclick: async (target: string, options?: WebElementOptions) => session.dblclick(resolveTarget(target), options),
    rightClick: async (target: string, options?: WebElementOptions) => session.rightClick(resolveTarget(target), options),
    drag: async (source: string, destination: string, options?: WebElementOptions) => session.drag(resolveTarget(source), resolveTarget(destination), options),
    fill: async (target: string, value: string, options?: WebFillOptions) => session.fill(resolveTarget(target), interpolateText(value, context), options),
    clear: async (target: string, options?: WebElementOptions) => session.fill(resolveTarget(target), "", { ...(options || {}), clear: true }),
    select: async (target: string, value: string, options?: WebElementOptions) => session.select(resolveTarget(target), interpolateText(value, context), options),
    check: async (target: string, options?: WebElementOptions) => session.check(resolveTarget(target), options),
    uncheck: async (target: string, options?: WebElementOptions) => session.uncheck(resolveTarget(target), options),
    uploadFile: async (target: string, files: string | string[], options?: WebElementOptions) => {
      const resolvedFiles = Array.isArray(files)
        ? files.map((file) => interpolateText(file, context))
        : interpolateText(files, context);
      return session.uploadFile(resolveTarget(target), resolvedFiles, options);
    },
    uploadLocalFile: async (target: string, files: string | string[], options?: WebElementOptions) => {
      const resolvedFiles = Array.isArray(files)
        ? files.map((file) => interpolateText(file, context))
        : interpolateText(files, context);
      return session.uploadFile(resolveTarget(target), resolvedFiles, options);
    },
    setInputFiles: async (target: string, files: string | string[], options?: WebElementOptions) => {
      const resolvedFiles = Array.isArray(files)
        ? files.map((file) => interpolateText(file, context))
        : interpolateText(files, context);
      return session.uploadFile(resolveTarget(target), resolvedFiles, options);
    },
    uploadRemoteFile: async (target: string, url: string, options?: WebElementOptions) =>
      session.uploadRemoteFile(resolveTarget(target), interpolateText(url, context), options),
    press: async (target: string | null, key: string, options?: WebElementOptions) => {
      const resolvedTarget = target === null ? "" : resolveTarget(target).trim();
      return session.press(resolvedTarget || null, interpolateText(key, context), options);
    },
    scroll: async (deltaX?: number, deltaY?: number, options?: WebScrollOptions) => session.scroll(deltaX, deltaY, options),
    wait: async (ms: number) => session.waitForTimeout(ms),
    waitForTimeout: async (ms: number) => session.waitForTimeout(ms),
    expectText: async (first: string, second?: string | null, options?: WebElementOptions & { match?: "contains" | "equals" }) => {
      if (second === undefined || second === null) {
        await session.expectText(null, interpolateText(first, context), options);
        return;
      }

      await session.expectText(resolveTarget(first), interpolateText(second, context), options);
    },
    expectVisible: async (target: string, options?: WebElementOptions) => session.expectVisible(resolveTarget(target), options),
    expectHidden: async (target: string, options?: WebElementOptions) => session.expectHidden(resolveTarget(target), options),
    expectEnabled: async (target: string, options?: WebElementOptions) => session.expectEnabled(resolveTarget(target), options),
    expectUrl: async (expected: string, options?: { timeoutMs?: number; match?: "contains" | "equals" }) => session.waitForUrl(interpolateText(expected, context), options),
    text: async (target: string, options?: WebElementOptions & { trim?: boolean }) => session.text(resolveTarget(target), options),
    value: async (target: string, options?: WebElementOptions) => session.value(resolveTarget(target), options),
    expectValue: async (target: string, expected: string, options?: WebElementOptions & { match?: "contains" | "equals" }) => {
      const actual = await session.value(resolveTarget(target), options);
      const resolvedExpected = interpolateText(expected, context);
      const passed = options?.match === "equals" ? actual === resolvedExpected : actual.includes(resolvedExpected);
      if (!passed) {
        throw new Error(`Expected ${target} value to contain "${resolvedExpected}" but found "${actual}"`);
      }
    },
    captureText: async (target: string, parameter: string, options?: WebElementOptions & { trim?: boolean }) => {
      const captured = await session.text(resolveTarget(target), options);
      capture(parameter, captured);
      return captured;
    },
    screenshot: async (label = "screenshot") => session.screenshot(interpolateText(label, context)),
    resolve: (value: string) => interpolateText(value, context),
    capture
  };

  const nativeBindings = providerBindings.playwrightPage ? createPlaywrightCodeBindings(providerBindings.playwrightPage, {
    interpolate: (value) => interpolateText(value, context),
    resolveLocator: (value) => resolveObjectRepositoryLocator(envelope, value),
    resolveUrl: (value) => resolveNavigationTarget(value, envelope),
    assertionTimeout: resolveTimeoutPolicy(envelope).assertion
  }) : null;

  return {
    ...providerBindings,
    page: nativeBindings ? nativeBindings.page as unknown as PageFacade : page,
    web,
    expect: nativeBindings ? Object.assign(nativeBindings.expect, { equal: expect.equal, truthy: expect.truthy, contains: expect.contains }) as unknown as ExpectationApi : expect,
    params: toParameterValuesRecord(context),
    capture
  };
};

const stripTrailingTestWrapper = (source: string) => {
  if (!/\b(?:test|it)\s*\(/.test(source)) return source;
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
  const tests = tree.body.filter((node: any) => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && ["test", "it"].includes(node.expression.callee.name)) as any[];
  if (!tests.length) return source;
  if (tests.length !== 1) throw new Error("Each automation step supports one Playwright test body. Split multiple tests into cases or shared groups.");
  const statement = tests[0];
  const callback = statement.expression.arguments.at(-1);
  if (callback?.body?.type !== "BlockStatement") throw new Error("The Playwright test wrapper must contain a function body.");
  const blank = (value: string) => value.replace(/[^\r\n]/g, " ");
  return source.slice(0, statement.start) + blank(source.slice(statement.start, callback.body.start + 1))
    + source.slice(callback.body.start + 1, callback.body.end - 1)
    + blank(source.slice(callback.body.end - 1, statement.end)) + source.slice(statement.end);
};

const stripMarkdownFence = (source: string) => {
  const trimmed = source.trim();
  const fenceMatch = trimmed.match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : source;
};

const normalizeAutomationSource = (source: string) => {
  let withoutImports = stripMarkdownFence(source);
  if (/^\s*import\s/m.test(withoutImports)) {
    const tree = parse(withoutImports, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    for (const declaration of [...tree.body].reverse()) {
      if (declaration.type !== "ImportDeclaration") continue;
      if (!["@playwright/test", "playwright/test"].includes(String(declaration.source.value)) || declaration.specifiers.some((item: any) => item.type !== "ImportSpecifier" || !["test", "expect"].includes(item.imported.name) || item.local.name !== item.imported.name)) {
        throw new Error("Automation steps provide page, expect and runtime helpers. Use shared groups for reusable actions; external module imports are not supported.");
      }
      withoutImports = withoutImports.slice(0, declaration.start) + withoutImports.slice(declaration.start, declaration.end).replace(/[^\r\n]/g, " ") + withoutImports.slice(declaration.end);
    }
  }
  withoutImports = withoutImports.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (/^test\.(?:describe|use|beforeEach|afterEach|beforeAll|afterAll)\s*\(/.test(trimmed)) throw new Error("Configure suites and before/after hooks in the automation workspace; inline Playwright suite declarations are not supported in a step.");
    return /^const\s+\{?\s*(test|expect)\b.*require\(/.test(trimmed)
      || /^const\s+.*require\(["']@playwright\/test["']\)/.test(trimmed) ? "" : line;
  }).join("\n");
  return stripTrailingTestWrapper(withoutImports);
};

const looksLikeExecutableAutomationSource = (source: string) => {
  const trimmed = normalizeAutomationSource(source).trim();

  if (!trimmed) {
    return false;
  }

  return /^\s*(?:await|async|function|const|let|var|import|export)\b/m.test(trimmed)
    || /^\s*(?:if|for|while|switch|catch)\s*\(/m.test(trimmed)
    || /^\s*(?:try|throw|return)\b.*[;{}]/m.test(trimmed)
    || /\b(?:web|page|expect|capture|playwrightPage|driver|bindings)\s*[.(]/.test(trimmed)
    || /=>/.test(trimmed)
    || /[{};]/.test(trimmed);
};

const toAutomationFunctionExpression = (source: string) => {
  let trimmed = source.trim().replace(/;+\s*$/, "");
  trimmed = trimmed
    .replace(/^export\s+default\s+/, "")
    .replace(/^module\.exports\s*=\s*/, "")
    .replace(/^exports\.default\s*=\s*/, "");

  if (/^async\s+[A-Za-z_$][\w$]*\s*\(/.test(trimmed) && !/^async\s+function\b/.test(trimmed) && !/=>/.test(trimmed)) {
    trimmed = `async function ${trimmed.slice("async ".length)}`;
  }

  const usesAwait = /\bawait\b/.test(trimmed);

  if (usesAwait && /^function\b/.test(trimmed)) {
    trimmed = `async ${trimmed}`;
  } else if (usesAwait && /^\([^)]*\)\s*=>/.test(trimmed)) {
    trimmed = `async ${trimmed}`;
  } else if (usesAwait && /^[A-Za-z_$][\w$]*\s*=>/.test(trimmed)) {
    trimmed = `async ${trimmed}`;
  }

  return trimmed;
};

const looksLikeAutomationFunction = (source: string) => {
  const trimmed = toAutomationFunctionExpression(source);
  return /^(?:async\s+)?function\b/.test(trimmed)
    || /^(?:async\s*)?\([^)]*\)\s*=>/.test(trimmed)
    || /^async\s+[A-Za-z_$][\w$]*\s*=>/.test(trimmed)
    || /^[A-Za-z_$][\w$]*\s*=>/.test(trimmed);
};

const buildAutomationInvocationSource = (source: string) => {
  const expression = toAutomationFunctionExpression(source);
  return [
    `const automation = (${expression});`,
    `if (typeof automation !== "function") { throw new Error("Automation wrapper did not evaluate to a function."); }`,
    `const hellotestBindings = { page, web, expect, params, capture, playwrightPage, driver, bindings };`,
    `return await (automation.length > 1`,
    `  ? automation(page, web, expect, params, capture, playwrightPage, driver, bindings)`,
    `  : automation(hellotestBindings));`
  ].join("\n");
};

const compileAutomationFunction = (source: string, forceInvocation = false) => {
  const shouldInvoke = forceInvocation || looksLikeAutomationFunction(source);
  const body = shouldInvoke ? buildAutomationInvocationSource(source) : `${source}\nreturn undefined;`;
  return new AsyncFunction(
    "page",
    "web",
    "expect",
    "params",
    "capture",
    "playwrightPage",
    "driver",
    "bindings",
    "__hellotestTrace",
    body
  );
};

const executeAutomationCode = async (
  source: string,
  bindings: WebExecutionBindings,
  lineResults: AutomationLineResult[] = [],
  attempt = 1
) => {
  const normalizedSource = normalizeAutomationSource(source);
  const executableSource = looksLikeAutomationFunction(normalizedSource) ? toAutomationFunctionExpression(normalizedSource) : normalizedSource;
  const fn = compileAutomationFunction(instrumentAutomationLines(executableSource));

  try {
    const hellotestBindings = {
      page: bindings.page,
      web: bindings.web,
      expect: bindings.expect,
      params: bindings.params,
      capture: bindings.capture,
      playwrightPage: bindings.playwrightPage,
      driver: bindings.driver
    };

    return await fn(
      bindings.page,
      bindings.web,
      bindings.expect,
      bindings.params,
      bindings.capture,
      bindings.playwrightPage,
      bindings.driver,
      hellotestBindings,
      createAutomationLineTracer(lineResults, attempt)
    );
  } catch (error) {
    const stack = error instanceof Error ? error.stack || "" : "";
    const lineMatch = stack.match(/<anonymous>:(\d+):\d+/);
    if (error instanceof Error && lineMatch) {
      (error as Error & { hellotestLine?: number }).hellotestLine ??= Math.max(1, Number.parseInt(lineMatch[1], 10) - 2);
      if (!lineResults.some((result) => result.attempt === attempt && result.status === "failed")) {
        const failure: AutomationLineResult = { line: (error as Error & { hellotestLine: number }).hellotestLine, status: "failed", duration_ms: 0, attempt, error: error.message.slice(0, 2000) };
        if (lineResults.length >= 1000) lineResults[lineResults.length - 1] = failure; else lineResults.push(failure);
      }
    }
    throw error;
  }
};

const executeStepAttempt = async (
  session: WebSession,
  options: StepExecutionOptions,
  captures: Record<string, string>
) => {
  const bindings = buildBindings(session, options.context, captures, options.envelope);
  const source = normalizeText(options.step.automation_code || null);

  if (source && looksLikeExecutableAutomationSource(source)) {
    await executeAutomationCode(source, bindings, options.lineResults, options.attempt);
  } else {
    const generatedStep = source ? { ...options.step, action: source } : options.step;
    await applyGeneratedAction(session, generatedStep, options.context, options.envelope);
    await applyGeneratedExpectation(session, generatedStep, options.context);
  }
};

const buildStepNote = ({
  step,
  provider,
  captures,
  recoveryAttempted,
  recoverySucceeded,
  error
}: {
  step: EngineRunStep;
  provider: EngineWebEngineProvider;
  captures: Record<string, string>;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  error?: Error | null;
}) => {
  const lines = [
    `${titleCaseLabel(step.action || `Step ${step.order}`)} (${provider})`
  ];

  if (step.expected_result) {
    lines.push(`Expected: ${step.expected_result}`);
  }

  if (recoveryAttempted) {
    lines.push(recoverySucceeded ? "Recovery: fallback retry succeeded." : "Recovery: fallback retry did not recover the step.");
  }

  Object.entries(captures).forEach(([key, value]) => {
    lines.push(`Capture ${key} = ${value}`);
  });

  if (error) {
    const hellotestLine = (error as Error & { hellotestLine?: number }).hellotestLine;
    if (hellotestLine) {
      lines.push(`Code line: ${hellotestLine}`);
    }
    lines.push(`Error: ${error.message}`);
  }

  return lines.join("\n");
};

export type EngineWebRunSession = {
  provider: EngineWebEngineProvider;
  context: RuntimeExecutionContext;
  start: () => Promise<void>;
  stop: (finalStatus?: EngineStepOutcomeStatus) => Promise<WebSessionArtifacts>;
  runStep: (step: EngineRunStep) => Promise<WebStepExecutionResult>;
};

export const createWebRunSession = (envelope: EngineRunEnvelope, capturedValues: Record<string, string> = {}): EngineWebRunSession => {
  const session = createWebSession(envelope);
  const context = buildInitialContext(envelope, capturedValues);

  return {
    provider: session.provider,
    context,
    start: async () => {
      await session.start();
      const baseUrl = normalizeText(envelope.environment?.base_url || null);
      if (baseUrl) {
        await session.goto(baseUrl);
      }
    },
    stop: async (finalStatus?: EngineStepOutcomeStatus) => session.stop(finalStatus),
    runStep: async (step: EngineRunStep) => {
      const stepContext = buildInitialContext(envelope, context.capturedValues, step);
      const captures: Record<string, string> = {};
      const lineResults: AutomationLineResult[] = [];
      let recoveryAttempted = false;
      let recoverySucceeded = false;
      let finalError: Error | null = null;
      const diagnosticsMarker = session.markDiagnostics();
      const startedAtMs = Date.now();
      const collectWebDetail = () => session.collectDiagnostics(diagnosticsMarker, captures, Math.max(Date.now() - startedAtMs, 0));

      try {
        await executeStepAttempt(session, { step, context: stepContext, envelope, lineResults, attempt: 1 }, captures);
        for (const [key, value] of Object.entries(captures)) registerContextValue(context, key, value);

        return {
          status: "passed",
          note: buildStepNote({
            step,
            provider: session.provider,
            captures,
            recoveryAttempted,
            recoverySucceeded
          }),
          captures,
          web_detail: await collectWebDetail(),
          line_results: lineResults,
          evidence: envelope.artifact_policy?.screenshot_on_success ? await session.screenshot(`step-${step.order}-passed`).catch(() => undefined) : undefined,
          recovery_attempted: recoveryAttempted,
          recovery_succeeded: recoverySucceeded
        };
      } catch (error) {
        finalError = error instanceof Error ? error : new Error(String(error || "Web automation step failed"));
      }

      const maxRepairAttempts = Math.max(0, envelope.max_repair_attempts || 0);

      for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
        recoveryAttempted = true;

        try {
          await session.startRetryTrace?.();
          await session.waitForTimeout(resolveTimeoutPolicy(envelope).recoveryWait * attempt);
          await executeStepAttempt(session, { step, context: stepContext, envelope, lineResults, attempt: attempt + 1 }, captures);
          for (const [key, value] of Object.entries(captures)) registerContextValue(context, key, value);
          recoverySucceeded = true;

          return {
            status: "passed",
            note: buildStepNote({
              step,
              provider: session.provider,
              captures,
              recoveryAttempted,
              recoverySucceeded
            }),
            captures,
            web_detail: await collectWebDetail(),
            line_results: lineResults,
            evidence: envelope.artifact_policy?.screenshot_on_failure === false ? undefined : await session.screenshot(`step-${step.order}-recovered`).catch(() => undefined),
            recovery_attempted: recoveryAttempted,
            recovery_succeeded: recoverySucceeded
          };
        } catch (error) {
          finalError = error instanceof Error ? error : new Error(String(error || "Web automation recovery failed"));
        }
      }

      return {
        status: "failed",
        note: buildStepNote({
          step,
          provider: session.provider,
          captures,
          recoveryAttempted,
          recoverySucceeded,
          error: finalError
        }),
        captures,
        web_detail: await collectWebDetail(),
        line_results: lineResults,
        evidence: envelope.artifact_policy?.screenshot_on_failure === false ? undefined : await session.screenshot(`step-${step.order}-failed`).catch(() => undefined),
        recovery_attempted: recoveryAttempted,
        recovery_succeeded: recoverySucceeded
      };
    }
  };
};
