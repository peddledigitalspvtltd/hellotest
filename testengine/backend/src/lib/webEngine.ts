import { mkdir, readFile, stat } from "node:fs/promises";
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
import type { EngineArtifactRef, EngineRunEnvelope, EngineRunStep, EngineStepOutcomeStatus, EngineWebEngineProvider } from "../contracts/qaira.js";
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
  evidence?: StepEvidence | null;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type StepExecutionOptions = {
  step: EngineRunStep;
  context: RuntimeExecutionContext;
  envelope: EngineRunEnvelope;
};

type PageLocatorFacade = {
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  press: (key: string) => Promise<void>;
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
  click: (target: string) => Promise<void>;
  fill: (target: string, value: string) => Promise<void>;
  press: (target: string, key: string) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForURL: (expected: string) => Promise<void>;
  waitForLoadState: (state?: string) => Promise<void>;
  waitForSelector: (target: string, options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<PageLocatorFacade>;
  url: () => Promise<string>;
  textContent: (target: string) => Promise<string>;
  locator: (target: string) => PageLocatorFacade;
  getByText: (target: string) => PageLocatorFacade;
  getByLabel: (target: string) => PageLocatorFacade;
  getByPlaceholder: (target: string) => PageLocatorFacade;
  getByRole: (role: string, options?: { name?: string | RegExp }) => PageLocatorFacade;
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

type WebSession = {
  readonly provider: EngineWebEngineProvider;
  start: () => Promise<void>;
  stop: (finalStatus?: EngineStepOutcomeStatus) => Promise<WebSessionArtifacts>;
  goto: (target: string) => Promise<void>;
  click: (target: string) => Promise<void>;
  dblclick: (target: string) => Promise<void>;
  rightClick: (target: string) => Promise<void>;
  fill: (target: string, value: string) => Promise<void>;
  select: (target: string, value: string) => Promise<void>;
  check: (target: string) => Promise<void>;
  uncheck: (target: string) => Promise<void>;
  press: (target: string | null, key: string) => Promise<void>;
  scroll: (deltaX?: number, deltaY?: number) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForUrl: (expected: string) => Promise<void>;
  expectVisible: (target: string) => Promise<void>;
  expectText: (target: string | null, expected: string) => Promise<void>;
  text: (target: string) => Promise<string>;
  value: (target: string) => Promise<string>;
  screenshot: (label: string) => Promise<StepEvidence>;
  markDiagnostics: () => WebDiagnosticsMarker;
  collectDiagnostics: (marker: WebDiagnosticsMarker, captures: Record<string, string>, durationMs: number) => Promise<WebStepDetail>;
  bindings: () => Pick<WebExecutionBindings, "page" | "playwrightPage" | "driver">;
};

type WebSessionArtifacts = {
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

const shouldRecordVideo = (envelope: EngineRunEnvelope) => envelope.artifact_policy?.video_mode !== "off";

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

  const pathMatch = value.match(/(?:open|navigate|go|visit)\s+(?:to\s+)?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/i);
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

  if (/^(open|navigate|go|visit)\b/.test(normalized) || urlCandidate) {
    return {
      kind: "goto",
      target: urlCandidate || action.replace(/^(open|navigate|go|visit)\s+(to\s+)?/i, "").trim()
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

const parseExpectedResult = (step: EngineRunStep, context: RuntimeExecutionContext): ParsedExpectation | null => {
  const expected = interpolateText(step.expected_result || "", context).trim();

  if (!expected) {
    return null;
  }

  const urlCandidate = extractUrlCandidate(expected);
  if (urlCandidate || /\burl\b|\bpage\b/.test(expected.toLowerCase())) {
    return {
      kind: "url",
      expected: stripWrappingQuotes(urlCandidate || expected)
    };
  }

  const visibleMatch = expected.match(/(.+?)\s+(?:is|should be)\s+(?:visible|displayed|shown)$/i);
  if (visibleMatch) {
    return {
      kind: "visible",
      target: stripWrappingQuotes(visibleMatch[1])
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

const createPlaywrightLocatorFacade = (resolver: (target: string) => Promise<Locator>, target: string): PageLocatorFacade => ({
  click: async () => {
    const locator = await resolver(target);
    await locator.click();
  },
  fill: async (value: string) => {
    const locator = await resolver(target);
    await locator.fill(value);
  },
  press: async (key: string) => {
    const locator = await resolver(target);
    await locator.press(key);
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
  first: () => createPlaywrightLocatorFacade(resolver, target),
  nth: (index: number) => createPlaywrightLocatorFacade(async (value) => (await resolver(value)).nth(index), target),
  count: async () => {
    const locator = await resolver(target);
    return locator.count();
  }
});

class PlaywrightWebSession implements WebSession {
  readonly provider: EngineWebEngineProvider = "playwright";
  private browser: Browser | null = null;
  private browserContext: BrowserContext | null = null;
  private browserPage: Page | null = null;
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

  async start() {
    if (this.browserPage) {
      return;
    }

    const browserType = PLAYWRIGHT_BROWSER_MAP[normalizeBrowser(this.envelope.browser)];
    this.browser = await browserType.launch({
      headless: this.envelope.headless !== false
    });
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
    this.browserPage.on("console", (message) => {
      const location = message.location();
      this.consoleEntries.push({
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
        location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null
      });
    });
    this.browserPage.on("response", (response) => {
      const request = response.request();
      this.networkEntries.push({
        method: request.method(),
        url: response.url(),
        status: response.status(),
        resource_type: request.resourceType(),
        timestamp: new Date().toISOString()
      });
    });
    this.browserPage.on("requestfailed", (request) => {
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

  async stop(finalStatus?: EngineStepOutcomeStatus) {
    const video = this.browserPage?.video() || null;
    const shouldAttach = shouldAttachVideo(this.envelope, finalStatus);
    const artifactPath = `artifacts/${this.envelope.engine_run_id}/video.webm`;
    const artifactFullPath = path.join(ARTIFACT_ROOT, artifactPath);
    const artifacts: WebSessionArtifacts = {};

    unregisterLiveViewSession(this.liveSessionId);

    await this.browserContext?.close();

    if (video && shouldAttach) {
      try {
        await mkdir(path.dirname(artifactFullPath), { recursive: true });
        await video.saveAs(artifactFullPath);
        const videoStats = await stat(artifactFullPath);
        artifacts.video_path = artifactPath;
        artifacts.artifact_refs = [
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

    await this.browser?.close();
    this.browserContext = null;
    this.browser = null;
    this.browserPage = null;
    this.liveSessionId = null;

    return artifacts;
  }

  private async resolveLocator(target: string) {
    const page = this.pageOrThrow;
    const tokens = candidateTokens(target);

    if (tokens.raw.startsWith("css=")) {
      return page.locator(tokens.raw.slice(4)).first();
    }

    if (tokens.raw.startsWith("text=")) {
      return page.getByText(tokens.raw.slice(5), { exact: false }).first();
    }

    if (tokens.raw.startsWith("xpath=") || tokens.raw.startsWith("//")) {
      return page.locator(tokens.raw.startsWith("xpath=") ? tokens.raw : `xpath=${tokens.raw}`).first();
    }

    const fallbackCandidates = [
      () => page.getByLabel(tokens.text, { exact: false }).first(),
      () => page.getByPlaceholder(tokens.text, { exact: false }).first(),
      () => page.getByRole("button", { name: tokens.text, exact: false }).first(),
      () => page.getByRole("link", { name: tokens.text, exact: false }).first(),
      () => page.getByText(tokens.text, { exact: false }).first(),
      () => page.locator(tokens.raw).first()
    ];

    let lastError: unknown = null;

    for (const candidate of fallbackCandidates) {
      try {
        const locator = candidate();
        await locator.waitFor({ state: "visible", timeout: this.timeouts.action });
        return locator;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${tokens.text}" in the browser page`);
  }

  async goto(target: string) {
    await this.pageOrThrow.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(Math.max(1_000, this.envelope.run_timeout_seconds * 1000), this.timeouts.navigation)
    });
  }

  async click(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.click();
  }

  async dblclick(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.dblclick();
  }

  async rightClick(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.click({ button: "right" });
  }

  async fill(target: string, value: string) {
    const locator = await this.resolveLocator(target);
    const editableDescendant = locator.locator("input, textarea, select, [contenteditable=true], [role=textbox]").first();
    const editableDescendantCount = await editableDescendant.count().catch(() => 0);

    if (editableDescendantCount > 0) {
      await editableDescendant.fill(value);
      return;
    }

    await locator.fill(value);
  }

  async select(target: string, value: string) {
    const locator = await this.resolveLocator(target);
    const optionValue = (() => {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : value;
      } catch {
        return value;
      }
    })();
    await locator.selectOption(optionValue);
  }

  async check(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.check();
  }

  async uncheck(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.uncheck();
  }

  async press(target: string | null, key: string) {
    if (!target) {
      await this.pageOrThrow.keyboard.press(key);
      return;
    }

    const locator = await this.resolveLocator(target);
    await locator.press(key);
  }

  async scroll(deltaX = 0, deltaY = 600) {
    await this.pageOrThrow.mouse.wheel(deltaX, deltaY);
  }

  async waitForTimeout(ms: number) {
    await this.pageOrThrow.waitForTimeout(Math.max(0, ms));
  }

  async waitForUrl(expected: string) {
    const resolved = stripWrappingQuotes(expected);
    await this.pageOrThrow.waitForURL((url) => url.toString().includes(resolved), {
      timeout: this.timeouts.assertion
    });
  }

  async expectVisible(target: string) {
    const locator = await this.resolveLocator(target);
    const isVisible = await locator.isVisible();

    if (!isVisible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectText(target: string | null, expected: string) {
    if (!target) {
      await this.pageOrThrow.getByText(expected, { exact: false }).first().waitFor({ state: "visible", timeout: this.timeouts.assertion });
      return;
    }

    const actual = await this.text(target);
    if (!actual.includes(expected)) {
      throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
    }
  }

  async text(target: string) {
    const locator = await this.resolveLocator(target);
    return ((await locator.textContent()) || "").trim();
  }

  async value(target: string) {
    const locator = await this.resolveLocator(target);
    return await locator.inputValue();
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
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      waitForLoadState: async (state?: string) => {
        const supportedState = state === "networkidle" || state === "load" || state === "domcontentloaded" ? state : "load";
        await this.pageOrThrow.waitForLoadState(supportedState, { timeout: this.timeouts.assertion });
      },
      waitForSelector: async (target: string, options) => {
        const locator = createPlaywrightLocatorFacade((value) => this.resolveLocator(value), target);
        await locator.waitFor(options);
        return locator;
      },
      url: async () => this.pageOrThrow.url(),
      textContent: (target: string) => this.text(target),
      locator: (target: string) => createPlaywrightLocatorFacade((value) => this.resolveLocator(value), target),
      getByText: (target: string) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByText(value, { exact: false }).first()), target),
      getByLabel: (target: string) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByLabel(value, { exact: false }).first()), target),
      getByPlaceholder: (target: string) => createPlaywrightLocatorFacade((value) => Promise.resolve(this.pageOrThrow.getByPlaceholder(value, { exact: false }).first()), target),
      getByRole: (role: string, options?: { name?: string | RegExp }) => {
        const target = options?.name === undefined ? role : String(options.name);
        return createPlaywrightLocatorFacade(
          () => Promise.resolve(this.pageOrThrow.getByRole(role as never, options as never).first()),
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
  click: async () => {
    const element = await resolveElement(target);
    await element.click();
  },
  fill: async (value: string) => {
    const element = await resolveElement(target);
    await element.clear();
    await element.sendKeys(value);
  },
  press: async (key: string) => {
    const element = await resolveElement(target);
    await element.sendKeys(key);
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
    let lastError: unknown = null;

    for (const strategy of this.byStrategies(target)) {
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

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${target}" in Selenium`);
  }

  async goto(target: string) {
    await this.driverOrThrow.get(target);
    this.networkEntries.push({
      method: "GET",
      url: target,
      status: null,
      resource_type: "document",
      timestamp: new Date().toISOString()
    });
  }

  async click(target: string) {
    const element = await this.resolveElement(target);
    await element.click();
  }

  async dblclick(target: string) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.actions().doubleClick(element).perform();
  }

  async rightClick(target: string) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.actions().contextClick(element).perform();
  }

  async fill(target: string, value: string) {
    const element = await this.resolveElement(target);
    const descendants = await element.findElements(By.css("input, textarea, select, [contenteditable='true'], [role='textbox']")).catch(() => []);
    const targetElement = descendants[0] || element;

    await targetElement.clear();
    await targetElement.sendKeys(value);
  }

  async select(target: string, value: string) {
    const element = await this.resolveElement(target);
    await this.driverOrThrow.executeScript(
      "const element = arguments[0]; const raw = arguments[1]; const values = (() => { try { const parsed = JSON.parse(String(raw)); return Array.isArray(parsed) ? parsed.map(String) : [String(raw)]; } catch { return [String(raw)]; } })(); Array.from(element.options || []).forEach((option) => { option.selected = values.includes(String(option.value)); }); if (!element.multiple) element.value = values[0] || ''; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));",
      element,
      value
    );
  }

  async check(target: string) {
    const element = await this.resolveElement(target);
    const checked = await element.isSelected().catch(() => false);
    if (!checked) {
      await element.click();
    }
  }

  async uncheck(target: string) {
    const element = await this.resolveElement(target);
    const checked = await element.isSelected().catch(() => false);
    if (checked) {
      await element.click();
    }
  }

  async press(target: string | null, key: string) {
    const seleniumKey = (Key as unknown as Record<string, string>)[key.toUpperCase()] || key;

    if (!target) {
      await this.driverOrThrow.actions().sendKeys(seleniumKey).perform();
      return;
    }

    const element = await this.resolveElement(target);
    await element.sendKeys(seleniumKey);
  }

  async scroll(deltaX = 0, deltaY = 600) {
    await this.driverOrThrow.executeScript("window.scrollBy(arguments[0], arguments[1]);", deltaX, deltaY);
  }

  async waitForTimeout(ms: number) {
    await this.driverOrThrow.sleep(Math.max(0, ms));
  }

  async waitForUrl(expected: string) {
    await this.driverOrThrow.wait(until.urlContains(stripWrappingQuotes(expected)), this.timeouts.assertion);
  }

  async expectVisible(target: string) {
    const element = await this.resolveElement(target);
    const visible = await element.isDisplayed();

    if (!visible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectText(target: string | null, expected: string) {
    if (!target) {
      const source = await this.driverOrThrow.getPageSource();
      if (!source.includes(expected)) {
        throw new Error(`Expected the page to include "${expected}"`);
      }
      return;
    }

    const actual = await this.text(target);
    if (!actual.includes(expected)) {
      throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
    }
  }

  async text(target: string) {
    const element = await this.resolveElement(target);
    return (await element.getText()) || "";
  }

  async value(target: string) {
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
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      waitForLoadState: async () => {
        await this.waitForTimeout(250);
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
      getByRole: (_role: string, options?: { name?: string | RegExp }) => {
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
  const page: PageFacade = {
    goto: async (target: string) => providerBindings.page.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
    click: async (target: string) => providerBindings.page.click(interpolateText(target, context)),
    fill: async (target: string, value: string) => providerBindings.page.fill(interpolateText(target, context), interpolateText(value, context)),
    press: async (target: string, key: string) => providerBindings.page.press(interpolateText(target, context), interpolateText(key, context)),
    waitForTimeout: (ms: number) => providerBindings.page.waitForTimeout(ms),
    waitForURL: async (expected: string) => providerBindings.page.waitForURL(interpolateText(expected, context)),
    waitForLoadState: (state?: string) => providerBindings.page.waitForLoadState(state),
    waitForSelector: async (target: string, options) => providerBindings.page.waitForSelector(interpolateText(target, context), options),
    url: () => providerBindings.page.url(),
    textContent: async (target: string) => providerBindings.page.textContent(interpolateText(target, context)),
    locator: (target: string) => providerBindings.page.locator(interpolateText(target, context)),
    getByText: (target: string) => providerBindings.page.getByText(interpolateText(target, context)),
    getByLabel: (target: string) => providerBindings.page.getByLabel(interpolateText(target, context)),
    getByPlaceholder: (target: string) => providerBindings.page.getByPlaceholder(interpolateText(target, context)),
    getByRole: (role: string, options?: { name?: string | RegExp }) =>
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
    goto: async (target: string) => session.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
    click: async (target: string) => session.click(interpolateText(target, context)),
    dblclick: async (target: string) => session.dblclick(interpolateText(target, context)),
    rightClick: async (target: string) => session.rightClick(interpolateText(target, context)),
    fill: async (target: string, value: string) => session.fill(interpolateText(target, context), interpolateText(value, context)),
    select: async (target: string, value: string) => session.select(interpolateText(target, context), interpolateText(value, context)),
    check: async (target: string) => session.check(interpolateText(target, context)),
    uncheck: async (target: string) => session.uncheck(interpolateText(target, context)),
    press: async (target: string, key: string) => session.press(interpolateText(target, context), interpolateText(key, context)),
    scroll: async (deltaX?: number, deltaY?: number) => session.scroll(deltaX, deltaY),
    wait: async (ms: number) => session.waitForTimeout(ms),
    waitForTimeout: async (ms: number) => session.waitForTimeout(ms),
    expectText: async (first: string, second?: string | null) => {
      if (second === undefined || second === null) {
        await session.expectText(null, interpolateText(first, context));
        return;
      }

      await session.expectText(interpolateText(first, context), interpolateText(second, context));
    },
    expectVisible: async (target: string) => session.expectVisible(interpolateText(target, context)),
    expectUrl: async (expected: string) => session.waitForUrl(interpolateText(expected, context)),
    text: async (target: string) => session.text(interpolateText(target, context)),
    value: async (target: string) => session.value(interpolateText(target, context)),
    resolve: (value: string) => interpolateText(value, context),
    capture
  };

  return {
    ...providerBindings,
    page,
    web,
    expect,
    params: toParameterValuesRecord(context),
    capture
  };
};

const stripTrailingTestWrapper = (source: string) => {
  const trimmed = source.trim();
  const testCall = trimmed.match(/(?:^|\n)\s*(?:test|it)\s*\(\s*["'`][\s\S]*?["'`]\s*,\s*async\s*\(\s*\{?\s*page\s*\}?\s*\)\s*=>\s*\{/);

  if (!testCall || testCall.index === undefined) {
    return source;
  }

  const bodyStart = testCall.index + testCall[0].length;
  let depth = 1;

  for (let index = bodyStart; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return trimmed.slice(bodyStart, index).trim();
      }
    }
  }

  return source;
};

const normalizeAutomationSource = (source: string) => {
  const withoutImports = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !/^import\s+/.test(trimmed)
        && !/^const\s+\{?\s*(test|expect)\b.*require\(/.test(trimmed)
        && !/^test\.describe\s*\(/.test(trimmed)
        && trimmed !== "});";
    })
    .join("\n");

  return stripTrailingTestWrapper(withoutImports);
};

const executeAutomationCode = async (
  source: string,
  bindings: WebExecutionBindings
) => {
  const executableSource = normalizeAutomationSource(source);
  const fn = new AsyncFunction(
    "page",
    "web",
    "expect",
    "params",
    "capture",
    "playwrightPage",
    "driver",
    `${executableSource}\nreturn undefined;`
  );

  return fn(
    bindings.page,
    bindings.web,
    bindings.expect,
    bindings.params,
    bindings.capture,
    bindings.playwrightPage,
    bindings.driver
  );
};

const executeStepAttempt = async (
  session: WebSession,
  options: StepExecutionOptions,
  captures: Record<string, string>
) => {
  const bindings = buildBindings(session, options.context, captures, options.envelope);
  const source = normalizeText(options.step.automation_code || null);

  if (source) {
    await executeAutomationCode(source, bindings);
  } else {
    await applyGeneratedAction(session, options.step, options.context, options.envelope);
    await applyGeneratedExpectation(session, options.step, options.context);
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
      const captures: Record<string, string> = {};
      let recoveryAttempted = false;
      let recoverySucceeded = false;
      let finalError: Error | null = null;
      const diagnosticsMarker = session.markDiagnostics();
      const startedAtMs = Date.now();
      const collectWebDetail = () => session.collectDiagnostics(diagnosticsMarker, captures, Math.max(Date.now() - startedAtMs, 0));

      try {
        await executeStepAttempt(session, { step, context, envelope }, captures);

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
          await session.waitForTimeout(resolveTimeoutPolicy(envelope).recoveryWait * attempt);
          await executeStepAttempt(session, { step, context, envelope }, captures);
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
            evidence: await session.screenshot(`step-${step.order}-recovered`),
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
        evidence: await session.screenshot(`step-${step.order}-failed`),
        recovery_attempted: recoveryAttempted,
        recovery_succeeded: recoverySucceeded
      };
    }
  };
};
