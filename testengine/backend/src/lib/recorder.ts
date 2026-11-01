import { resolveRepositoryLocator } from "./repositoryLocator.js";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Locator, type Page, type Request } from "playwright";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { constantTimeSecretMatches, extractTestEngineSecrets, resolveTestEngineSharedSecret } from "./testEngineSecurity.js";
import { assertRemoteInspectionUrl, InspectionTargetError } from "./inspectionSecurity.js";
import { createInspectionProxy } from "./inspectionProxy.js";

type RecorderAction = {
  index: number;
  type:
    | "click"
    | "dblclick"
    | "rightclick"
    | "fill"
    | "change"
    | "upload"
    | "select"
    | "check"
    | "uncheck"
    | "submit"
    | "navigation"
    | "press"
    | "tab"
    | "scroll"
    | "drag"
    | "drop";
  locator?: string | null;
  text?: string | null;
  value?: string | null;
  url?: string | null;
  page_id?: string | null;
  page_title?: string | null;
  x?: number | null;
  y?: number | null;
  source?: "page-recorder" | "remote-control" | "browser";
  timestamp: string;
};

type RecorderNetworkEntry = {
  index: number;
  method: string;
  url: string;
  status: number | null;
  resource_type: string;
  request_body: string | null;
  response_body_sample: string | null;
  content_type: string | null;
  page_id?: string | null;
  page_title?: string | null;
  timestamp: string;
};

type RecorderSession = {
  id: string;
  purpose: "automation-recording" | "repository-inspect" | null;
  status: "running" | "stopped" | "failed";
  paused: boolean;
  started_at: string;
  stopped_at: string | null;
  start_url: string | null;
  user_data_dir: string;
  live_token: string;
  remote_inspection?: boolean;
  inspection_proxy?: Awaited<ReturnType<typeof createInspectionProxy>> | null;
  display_mode: "browser-live-view" | "local-browser-with-live-view";
  active_page_id?: string | null;
  last_activity_at: string;
  context: BrowserContext;
  actions: RecorderAction[];
  network: RecorderNetworkEntry[];
  error: string | null;
  capture: {
    actions: boolean;
    network: boolean;
    duplicate_typing_suppression: boolean;
    injection: string;
    extension_ready: boolean;
    remote_control: boolean;
    screenshot_stream: boolean;
    screencast_stream: boolean;
  };
};

type RecorderElementRect = { x: number; y: number; width: number; height: number };

type RecorderInspectElement = {
  friendly_name: string;
  html_tag: string;
  role: string;
  locator: string;
  locator_kind: string;
  dom_structure: string;
  ancestor_dom: string | null;
  locator_candidates: Array<{
    locator: string;
    strategy: string;
    confidenceScore: number;
    matchCount: number;
    stabilitySignals: string[];
    warning: string | null;
    recommended: boolean;
  }>;
  text: string | null;
  rect?: RecorderElementRect | null;
  ancestor_rect?: RecorderElementRect | null;
};

type RecorderInspectSelectionResult = {
  element: RecorderInspectElement;
  element_screenshot_url: string | null;
  ancestor_screenshot_url: string | null;
};

type RecorderInspectResult = {
  captured_at: string;
  page_id: string | null;
  page_title: string | null;
  page_url: string | null;
  screen_dom: string | null;
  accessibility_tree: string | null;
  screen_fingerprint: string | null;
  screen_screenshot_url: string | null;
  element_screenshot_url: string | null;
  ancestor_screenshot_url: string | null;
  element: RecorderInspectElement;
  selections?: RecorderInspectSelectionResult[];
};

type RecorderLocatorValidation = {
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
};

const sessions = new Map<string, RecorderSession>();
let inspectionSessionsStarting = 0;
const inspectResults = new Map<string, RecorderInspectResult>();
const REPOSITORY_HIGHLIGHT_DURATION_MS = 1_000;
const REPOSITORY_VALIDATION_FIELD_LIMIT = 80;
const RECORDER_ACTION_TYPES = new Set<RecorderAction["type"]>([
  "click",
  "dblclick",
  "rightclick",
  "fill",
  "change",
  "upload",
  "select",
  "check",
  "uncheck",
  "submit",
  "navigation",
  "press",
  "tab",
  "scroll",
  "drag",
  "drop"
]);
const MAX_ACTIONS = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_ACTIONS || "1000", 10));
const MAX_NETWORK = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_NETWORK || "1000", 10));
const BODY_SAMPLE_LIMIT = Math.max(2000, Number.parseInt(process.env.RECORDER_BODY_SAMPLE_LIMIT || "12000", 10));
const REMOTE_TEXT_LIMIT = Math.max(1, Number.parseInt(process.env.RECORDER_REMOTE_TEXT_LIMIT || "500", 10));
const VIEWPORT_WIDTH = Math.max(640, Number.parseInt(process.env.RECORDER_VIEWPORT_WIDTH || "1365", 10));
const VIEWPORT_HEIGHT = Math.max(480, Number.parseInt(process.env.RECORDER_VIEWPORT_HEIGHT || "768", 10));
const SCREENCAST_QUALITY = Math.max(20, Math.min(85, Number.parseInt(process.env.RECORDER_SCREENCAST_QUALITY || "45", 10)));
const SCREENCAST_EVERY_NTH_FRAME = Math.max(1, Math.min(6, Number.parseInt(process.env.RECORDER_SCREENCAST_EVERY_NTH_FRAME || "1", 10)));
const RECORDER_ORPHAN_TTL_MS = Math.max(60_000, Number.parseInt(process.env.RECORDER_ORPHAN_TTL_MS || String(3 * 60_000), 10));
const RECORDER_CLEANUP_INTERVAL_MS = Math.max(15_000, Number.parseInt(process.env.RECORDER_CLEANUP_INTERVAL_MS || "30000", 10));
const recorderPageIds = new WeakMap<Page, string>();
const recorderAttachedPages = new WeakSet<Page>();

const LIVE_VIEW_HTML_CACHE_SECONDS = 0;

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeUrl = (value: unknown): string | null => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
};

const normalizePositiveNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const resolveHeadlessMode = () => process.env.RECORDER_HEADLESS !== "false";

const buildLiveViewPath = (session: Pick<RecorderSession, "id" | "live_token">) =>
  `/api/v1/recorder/sessions/${encodeURIComponent(session.id)}/live?token=${encodeURIComponent(session.live_token)}`;

const buildBrowserUnavailableResponse = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "Unable to start recorder session");
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("executable doesn't exist") || lowerMessage.includes("please run the following command")) {
    return {
      code: "RECORDER_BROWSER_UNAVAILABLE",
      message: "The Test Engine could not find its managed Chromium browser. Run the Playwright Test Engine container or install the Playwright browsers on the engine host; HelloTest frontend users do not need Chrome or Playwright locally.",
      detail: message
    };
  }

  if (lowerMessage.includes("headed browser") || lowerMessage.includes("xserver") || lowerMessage.includes("display")) {
    return {
      code: "RECORDER_DISPLAY_UNAVAILABLE",
      message: "The Test Engine cannot open a physical browser window on this host. Keep RECORDER_HEADLESS enabled and use the HelloTest live recorder view from the frontend.",
      detail: message
    };
  }

  return {
    code: "RECORDER_START_FAILED",
    message,
    detail: message
  };
};

const clip = (value: unknown, limit = BODY_SAMPLE_LIMIT): string | null => {
  const normalized = normalizeText(typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

  if (!normalized) {
    return null;
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};

const clipRawText = (value: unknown, limit: number): string => {
  if (value === undefined || value === null) {
    return "";
  }

  const text = typeof value === "string" ? value : String(value);
  return text.length > limit ? text.slice(0, limit) : text;
};

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const sanitized: Record<string, string> = {};

  Object.entries(headers || {}).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    sanitized[key] = ["authorization", "cookie", "set-cookie", "x-api-key"].includes(normalizedKey) ? "[redacted]" : value;
  });

  return sanitized;
};

const isUsefulNetworkRequest = (request: Request) => {
  const resourceType = request.resourceType();

  if (resourceType === "fetch" || resourceType === "xhr") {
    return true;
  }

  try {
    const parsed = new URL(request.url());
    return /\/api(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const pushBounded = <T>(items: T[], item: T, max: number) => {
  items.push(item);

  if (items.length > max) {
    items.splice(0, items.length - max);
  }
};

const touchSession = (session: RecorderSession) => {
  session.last_activity_at = new Date().toISOString();
};

export const pushRecorderAction = (
  session: RecorderSession,
  action: Omit<RecorderAction, "index" | "timestamp"> & Partial<Pick<RecorderAction, "index" | "timestamp">>
): RecorderAction | null => {
  if (session.paused) {
    return null;
  }

  const actionType = String(action.type || "").toLowerCase();
  const actionLocator = normalizeText(action.locator);
  const actionPageId = normalizeText(action.page_id);
  const actionTimestamp = action.timestamp || new Date().toISOString();

  if ((actionType === "fill" || actionType === "change" || actionType === "upload" || actionType === "select" || actionType === "check" || actionType === "uncheck") && actionLocator) {
    // Collapse a typing burst only while it remains the latest action. Crossing a
    // click/navigation boundary changes the recorded workflow and loses evidence.
    const candidate = session.actions.at(-1);
    const recentEditableAction = candidate && (() => {
      const candidateType = String(candidate.type || "").toLowerCase();
      const candidateTime = Date.parse(candidate.timestamp || "");
      const nextTime = Date.parse(actionTimestamp);

      return (candidateType === "fill" || candidateType === "change" || candidateType === "upload" || candidateType === "select" || candidateType === "check" || candidateType === "uncheck")
        && candidate.locator === actionLocator
        && candidate.page_id === actionPageId
        && Number.isFinite(candidateTime) && Number.isFinite(nextTime) && nextTime >= candidateTime && nextTime - candidateTime <= 12_000;
    })() ? candidate : null;

    if (recentEditableAction) {
      recentEditableAction.type = action.type;
      recentEditableAction.text = action.text ?? recentEditableAction.text;
      recentEditableAction.value = action.value ?? recentEditableAction.value;
      recentEditableAction.url = action.url ?? recentEditableAction.url;
      recentEditableAction.page_id = action.page_id ?? recentEditableAction.page_id;
      recentEditableAction.page_title = action.page_title ?? recentEditableAction.page_title;
      recentEditableAction.timestamp = actionTimestamp;
      return recentEditableAction;
    }
  }

  const entry: RecorderAction = {
    index: (session.actions.at(-1)?.index || 0) + 1,
    type: action.type,
    locator: action.locator ?? null,
    text: action.text ?? null,
    value: action.value ?? null,
    url: action.url ?? null,
    page_id: action.page_id ?? null,
    page_title: action.page_title ?? null,
    x: action.x ?? null,
    y: action.y ?? null,
    source: action.source,
    timestamp: actionTimestamp
  };

  pushBounded(session.actions, entry, MAX_ACTIONS);
  return entry;
};

const getRecorderPageId = (page: Page | null | undefined) => {
  if (!page) {
    return null;
  }

  let pageId = recorderPageIds.get(page);

  if (!pageId) {
    pageId = `tab-${randomUUID().slice(0, 8)}`;
    recorderPageIds.set(page, pageId);
  }

  return pageId;
};

const resolvePageTitle = async (page: Page | null | undefined) => {
  if (!page || page.isClosed()) {
    return null;
  }

  return normalizeText(await page.title().catch(() => ""));
};

const resolveRequestPage = (request: Request) => {
  try {
    return request.frame().page();
  } catch {
    return null;
  }
};

const serializeSession = (session: RecorderSession, options: { includeLiveViewPath?: boolean } = {}) => ({
  id: session.id,
  purpose: session.purpose,
  status: session.status,
  paused: session.paused,
  started_at: session.started_at,
  stopped_at: session.stopped_at,
  last_activity_at: session.last_activity_at,
  start_url: session.start_url,
  display_mode: session.display_mode,
  live_view_path: options.includeLiveViewPath ? buildLiveViewPath(session) : null,
  action_count: session.actions.length,
  network_count: session.network.length,
  actions: session.actions,
  network: session.network,
  capture: session.capture,
  error: session.error
});

const recorderInitScript = `
(() => {
  if (window.__hellotestRecorderInstalled) return;
  window.__hellotestRecorderInstalled = true;

  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/[^A-Za-z0-9_-]/g, "\\\\$&");
  };
  const visibleText = (element) => clean(element.innerText || element.textContent || "").slice(0, 120);
  const attr = (element, name) => clean(element.getAttribute(name) || "");
  const cssPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const id = attr(current, "id");
      if (id) {
        parts.unshift("#" + cssEscape(id));
        break;
      }
      const name = attr(current, "name");
      const testId = attr(current, "data-testid") || attr(current, "data-test") || attr(current, "data-qa");
      if (testId) {
        parts.unshift(tag + "[data-testid=\\"" + testId.replaceAll('"', "\\\\\\"") + "\\"]");
        break;
      }
      if (name) {
        parts.unshift(tag + "[name=\\"" + name.replaceAll('"', "\\\\\\"") + "\\"]");
        break;
      }
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
      const index = siblings.indexOf(current);
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (index + 1) + ")" : tag);
      current = parent;
    }
    return parts.join(" > ");
  };
  const locatorFor = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "body";
    const editableChild = !["input", "textarea", "select"].includes(element.tagName.toLowerCase()) && !element.isContentEditable
      ? element.querySelector("input,textarea,select,[contenteditable=true],[role=textbox]")
      : null;
    if (editableChild) return locatorFor(editableChild);
    const quoted = (value) => JSON.stringify(String(value || ""));
    const testId = attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-qa");
    if (testId) return "getByTestId(" + quoted(testId) + ")";
    const aria = attr(element, "aria-label");
    const placeholder = attr(element, "placeholder");
    const label = element.labels && element.labels[0] ? clean(element.labels[0].innerText || element.labels[0].textContent || "") : "";
    const role = attr(element, "role")
      || (element.tagName.toLowerCase() === "button" ? "button" : "")
      || (element.tagName.toLowerCase() === "a" ? "link" : "")
      || (element.tagName.toLowerCase() === "select" ? "combobox" : "")
      || (["input", "textarea"].includes(element.tagName.toLowerCase()) && !["checkbox", "radio", "file"].includes(String(element.type || "").toLowerCase()) ? "textbox" : "")
      || (element.tagName.toLowerCase() === "input" && ["checkbox", "radio"].includes(String(element.type || "").toLowerCase()) ? String(element.type || "").toLowerCase() : "");
    const accessibleName = aria || label || visibleText(element);
    if (role && accessibleName) return "getByRole(" + quoted(role) + ", { name: " + quoted(accessibleName) + " })";
    if (label) return "getByLabel(" + quoted(label) + ")";
    if (placeholder) return "getByPlaceholder(" + quoted(placeholder) + ")";
    if (aria) return "[aria-label=\\"" + aria.replaceAll('"', "\\\\\\"") + "\\"]";
    const id = attr(element, "id");
    if (id) return "#" + cssEscape(id);
    const name = attr(element, "name");
    if (name) return element.tagName.toLowerCase() + "[name=\\"" + name.replaceAll('"', "\\\\\\"") + "\\"]";
    const text = visibleText(element);
    if ((role || ["button", "a"].includes(element.tagName.toLowerCase())) && text) return "getByText(" + quoted(text) + ")";
    if (text && text.length <= 80) return "getByText(" + quoted(text) + ")";
    return cssPath(element);
  };
  window.__hellotestRecorderLocatorFor = locatorFor;
  window.__hellotestRecorderVisibleTextFor = visibleText;
  const emit = (event) => {
    if (typeof window.__hellotestRecorderEmit === "function") {
      window.__hellotestRecorderEmit({
        ...event,
        source: "page-recorder",
        url: window.location.href,
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
  };
  const inputTimers = new WeakMap();
  const lastInputValues = new WeakMap();
  const controlLabel = (target) => attr(target, "name") || attr(target, "placeholder") || attr(target, "aria-label") || visibleText(target);
  const selectedOptions = (target) => Array.from(target.selectedOptions || []).map((option) => ({
    value: String(option.value || ""),
    label: clean(option.label || option.textContent || option.value || "")
  }));
  const describeSelectValue = (target) => {
    const selected = selectedOptions(target);
    if (target.multiple) {
      return {
        value: JSON.stringify(selected.map((option) => option.value)),
        text: selected.map((option) => option.label || option.value).filter(Boolean).join(", ") || controlLabel(target)
      };
    }
    const first = selected[0];
    return {
      value: first ? first.value : String(target.value || ""),
      text: first ? first.label || first.value : controlLabel(target)
    };
  };
  const recordInput = (target, type) => {
    if (!target || !("value" in target)) return;
    const tag = String(target.tagName || "").toLowerCase();
    const inputType = String(target.type || "").toLowerCase();
    if (inputType === "file") {
      const fileNames = Array.from(target.files || []).map((file) => file && file.name ? file.name : "").filter(Boolean).join(", ");
      const previous = lastInputValues.get(target);
      if (previous === fileNames) return;
      lastInputValues.set(target, fileNames);
      emit({
        type: "upload",
        locator: locatorFor(target),
        text: controlLabel(target) || fileNames || "File upload",
        value: fileNames
      });
      return;
    }
    if (tag === "select") {
      const selected = describeSelectValue(target);
      const previous = lastInputValues.get(target);
      if (previous === selected.value) return;
      lastInputValues.set(target, selected.value);
      emit({
        type: "select",
        locator: locatorFor(target),
        text: selected.text || controlLabel(target),
        value: selected.value
      });
      return;
    }
    if (inputType === "checkbox" || inputType === "radio") {
      const checked = Boolean(target.checked);
      const value = checked ? "true" : "false";
      const previous = lastInputValues.get(target);
      if (previous === value) return;
      lastInputValues.set(target, value);
      emit({
        type: checked ? "check" : "uncheck",
        locator: locatorFor(target),
        text: controlLabel(target),
        value
      });
      return;
    }
    const value = String(target.value || "");
    const previous = lastInputValues.get(target);
    if (previous === value) return;
    lastInputValues.set(target, value);
    emit({
      type,
      locator: locatorFor(target),
      text: controlLabel(target),
      value
    });
  };

  document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("button,a,input,select,textarea,[role=button],[role=link],[role=option],[role=menuitem],[role=combobox],[aria-haspopup],[data-testid],[data-test],[data-qa]") : event.target;
    emit({
      type: "click",
      locator: locatorFor(target),
      text: visibleText(target)
    });
  }, true);

  document.addEventListener("dblclick", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("button,a,input,select,textarea,[role=button],[role=link],[data-testid],[data-test],[data-qa]") : event.target;
    emit({ type: "dblclick", locator: locatorFor(target), text: visibleText(target) });
  }, true);

  document.addEventListener("contextmenu", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("button,a,input,select,textarea,[role=button],[role=link],[data-testid],[data-test],[data-qa]") : event.target;
    emit({ type: "rightclick", locator: locatorFor(target), text: visibleText(target) });
  }, true);

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || !("value" in target)) return;
    const existing = inputTimers.get(target);
    if (existing) clearTimeout(existing);
    inputTimers.set(target, setTimeout(() => recordInput(target, "fill"), 800));
  }, true);

  document.addEventListener("change", (event) => {
    recordInput(event.target, "change");
  }, true);

  document.addEventListener("blur", (event) => {
    const target = event.target;
    if (!target || !("value" in target)) return;
    const existing = inputTimers.get(target);
    if (existing) clearTimeout(existing);
    recordInput(target, "change");
  }, true);

  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    if (!["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
    emit({
      type: key === "Tab" ? "tab" : "press",
      locator: locatorFor(event.target),
      text: key,
      value: key
    });
  }, true);

  document.addEventListener("dragstart", (event) => {
    emit({ type: "drag", locator: locatorFor(event.target), text: visibleText(event.target) });
  }, true);

  document.addEventListener("drop", (event) => {
    emit({ type: "drop", locator: locatorFor(event.target), text: visibleText(event.target) });
  }, true);

  let lastScrollAt = 0;
  document.addEventListener("scroll", () => {
    const now = Date.now();
    if (now - lastScrollAt < 750) return;
    lastScrollAt = now;
    emit({
      type: "scroll",
      locator: "viewport",
      text: "Scroll",
      value: JSON.stringify({ x: window.scrollX || 0, y: window.scrollY || 0 })
    });
  }, true);

  document.addEventListener("submit", (event) => {
    emit({
      type: "submit",
      locator: locatorFor(event.target),
      text: visibleText(event.target)
    });
  }, true);

  window.addEventListener("popstate", () => emit({ type: "navigation", locator: "location", text: document.title }));
})();
`;

const recorderExtensionContentScript = `
(() => {
  if (document.documentElement?.dataset.hellotestRecorderExtension === "loaded") return;
  if (document.documentElement) {
    document.documentElement.dataset.hellotestRecorderExtension = "loaded";
  }
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-recorder.js");
  script.async = false;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();
`;

const createRecorderExtension = async (userDataDir: string) => {
  const extensionDir = path.join(userDataDir, "hellotest-recorder-extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    path.join(extensionDir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        name: "HelloTest Recorder",
        version: "1.0.0",
        description: "Captures browser actions and API calls for HelloTest automation authoring sessions.",
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["content.js"],
            run_at: "document_start",
            all_frames: true
          }
        ],
        web_accessible_resources: [
          {
            resources: ["page-recorder.js"],
            matches: ["<all_urls>"]
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(path.join(extensionDir, "content.js"), recorderExtensionContentScript);
  await writeFile(path.join(extensionDir, "page-recorder.js"), recorderInitScript);
  return extensionDir;
};

const attachPageCapture = (session: RecorderSession, page: Page, logger: FastifyBaseLogger) => {
  if (recorderAttachedPages.has(page)) {
    return;
  }

  recorderAttachedPages.add(page);
  const pageId = getRecorderPageId(page);

  void (async () => {
    pushRecorderAction(session, {
      type: "tab",
      locator: "browser.tab",
      text: "Tab opened",
      value: null,
      url: page.url(),
      page_id: pageId,
      page_title: await resolvePageTitle(page),
      source: "browser"
    });
  })();

  page.on("close", () => {
    pushRecorderAction(session, {
      type: "tab",
      locator: "browser.tab",
      text: "Tab closed",
      value: null,
      url: page.url(),
      page_id: pageId,
      page_title: null,
      source: "browser"
    });
  });

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    void (async () => {
      pushRecorderAction(session, {
        type: "navigation",
        locator: "location",
        text: page.url(),
        value: null,
        url: page.url(),
        page_id: pageId,
        page_title: await resolvePageTitle(page),
        source: "browser"
      });
    })();
  });

  page.on("requestfinished", (request) => {
    if (session.paused || !isUsefulNetworkRequest(request)) {
      return;
    }

    void (async () => {
      try {
        const response = await request.response();
        const requestPage = resolveRequestPage(request);
        const headers = sanitizeHeaders(await response?.allHeaders().catch(() => ({})) || {});
        const contentType = headers["content-type"] || headers["Content-Type"] || null;
        const canReadBody = typeof contentType === "string" && /(json|text|xml|html|x-www-form-urlencoded)/i.test(contentType);
        const responseText = canReadBody ? await response?.text().catch(() => null) : null;

        if (session.paused) {
          return;
        }

        pushBounded(session.network, {
          index: session.network.length + 1,
          method: request.method(),
          url: request.url(),
          status: response?.status() ?? null,
          resource_type: request.resourceType(),
          request_body: clip(request.postData()),
          response_body_sample: clip(responseText),
          content_type: contentType,
          page_id: getRecorderPageId(requestPage),
          page_title: await resolvePageTitle(requestPage),
          timestamp: new Date().toISOString()
        }, MAX_NETWORK);
      } catch (error) {
        logger.warn({ error, sessionId: session.id }, "Unable to record network request");
      }
    })();
  });

  page.on("requestfailed", (request) => {
    if (session.paused || !isUsefulNetworkRequest(request)) {
      return;
    }

    void (async () => {
      const requestPage = resolveRequestPage(request);

      if (session.paused) {
        return;
      }

      pushBounded(session.network, {
        index: session.network.length + 1,
        method: request.method(),
        url: request.url(),
        status: null,
        resource_type: request.resourceType(),
        request_body: clip(request.postData()),
        response_body_sample: request.failure()?.errorText || "request failed",
        content_type: null,
        page_id: getRecorderPageId(requestPage),
        page_title: await resolvePageTitle(requestPage),
        timestamp: new Date().toISOString()
      }, MAX_NETWORK);
    })();
  });
};

const resolveActivePage = async (session: RecorderSession) => {
  const pages = session.context.pages().filter((candidate) => !candidate.isClosed());
  const page = pages.find((candidate) => getRecorderPageId(candidate) === session.active_page_id) || pages.at(-1);
  return page || session.context.newPage();
};

const resolveRecorderPage = async (session: RecorderSession, pageId?: string | null) => {
  const pages = session.context.pages().filter((candidate) => !candidate.isClosed());

  if (pageId) {
    const match = pages.find((page) => getRecorderPageId(page) === pageId);
    if (match) {
      return match;
    }
    throw new Error("The selected browser tab is no longer open. Refresh the tab list.");
  }

  return resolveActivePage(session);
};

const serializeRecorderPage = async (page: Page) => ({
  id: getRecorderPageId(page),
  title: await resolvePageTitle(page),
  url: page.url()
});

const installInspectMode = async (page: Page) => {
  await page.evaluate(() => {
    const inspectWindow = window as typeof window & {
      __hellotestInspectCleanup?: () => void;
      __hellotestInspectResult?: unknown;
      __hellotestInspectSelections?: unknown[];
      __hellotestRecorderLocatorFor?: (element: Element | null) => string | null;
      __hellotestRecorderVisibleTextFor?: (element: Element | null) => string | null;
    };

    inspectWindow.__hellotestInspectCleanup?.();
    inspectWindow.__hellotestInspectResult = null;
    inspectWindow.__hellotestInspectSelections = [];

    const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
    const cssEscape = (value: string) => {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
      return String(value || "").replace(/[^A-Za-z0-9_-]/g, "\\$&");
    };
    const friendlyName = (element: Element) => {
      const text = clean(
        element.getAttribute("aria-label")
        || element.getAttribute("placeholder")
        || element.getAttribute("name")
        || element.getAttribute("id")
        || element.getAttribute("data-testid")
        || inspectWindow.__hellotestRecorderVisibleTextFor?.(element)
        || element.tagName.toLowerCase()
      );
      return text
        .replace(/^text=/i, "")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .map((part, index) => index ? part.charAt(0).toUpperCase() + part.slice(1) : part.charAt(0).toLowerCase() + part.slice(1))
        .join("") || "element";
    };
    const locatorCandidates = (element: Element) => {
      const testAttribute = ["data-testid", "data-test", "data-qa", "data-cy"]
        .map((attribute) => ({ attribute, value: clean(element.getAttribute(attribute)) }))
        .find((candidate) => candidate.value);
      const aria = clean(element.getAttribute("aria-label"));
      const explicitRole = clean(element.getAttribute("role"));
      const label = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? clean(element.labels?.[0]?.innerText || element.labels?.[0]?.textContent || "")
        : "";
      const accessibleName = aria || label || clean(inspectWindow.__hellotestRecorderVisibleTextFor?.(element));
      const id = clean(element.getAttribute("id"));
      const name = clean(element.getAttribute("name"));
      const placeholder = clean(element.getAttribute("placeholder"));
      const text = inspectWindow.__hellotestRecorderVisibleTextFor?.(element);
      const tag = element.tagName.toLowerCase();
      const inputType = clean(element.getAttribute("type")).toLowerCase();
      const quoted = (value: string) => JSON.stringify(value);
      const dynamicValue = (value: string) => /(?:^|[-_])(?:\d{4,}|[a-f0-9]{8,}|[a-z0-9]{12,})(?:$|[-_])/i.test(value);
      const safeCount = (selector: string) => {
        try {
          return document.querySelectorAll(selector).length;
        } catch {
          return 0;
        }
      };
      const accessibleText = (candidate: Element) => clean(
        candidate.getAttribute("aria-label")
        || (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLSelectElement
          ? candidate.labels?.[0]?.innerText || candidate.labels?.[0]?.textContent
          : "")
        || inspectWindow.__hellotestRecorderVisibleTextFor?.(candidate)
      );
      const roleFor = (candidate: Element) => {
        const candidateTag = candidate.tagName.toLowerCase();
        const candidateType = clean(candidate.getAttribute("type")).toLowerCase();
        return clean(candidate.getAttribute("role"))
          || (candidateTag === "button" || (candidateTag === "input" && ["button", "submit", "reset", "image"].includes(candidateType)) ? "button" : "")
          || (candidateTag === "a" ? "link" : "")
          || (candidateTag === "select" ? "combobox" : "")
          || (candidateTag === "textarea" || (candidateTag === "input" && !["button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(candidateType)) ? "textbox" : "")
          || (candidateTag === "input" && ["checkbox", "radio"].includes(candidateType) ? candidateType : "");
      };
      const semanticRole = explicitRole || roleFor(element);
      return [
        testAttribute ? {
          locator: testAttribute.attribute === "data-testid"
            ? `getByTestId(${quoted(testAttribute.value)})`
            : `[${testAttribute.attribute}="${testAttribute.value.replace(/"/g, '\\"')}"]`,
          strategy: testAttribute.attribute, confidenceScore: 0.99,
          matchCount: safeCount(`[${testAttribute.attribute}="${cssEscape(testAttribute.value)}"]`), stabilitySignals: ["explicit test contract", testAttribute.attribute], warning: null
        } : null,
        semanticRole && accessibleName ? {
          locator: `getByRole(${quoted(semanticRole)}, { name: ${quoted(accessibleName)} })`, strategy: "playwright role + name", confidenceScore: 0.97,
          matchCount: [...document.querySelectorAll("button,a,input,select,textarea,[role]")].filter((candidate) => {
            return roleFor(candidate) === semanticRole && accessibleText(candidate) === accessibleName;
          }).length,
          stabilitySignals: ["user-facing role", "accessible name"], warning: null
        } : null,
        label ? { locator: `getByLabel(${quoted(label)})`, strategy: "playwright label", confidenceScore: 0.95, matchCount: [...document.querySelectorAll("input,select,textarea")].filter((candidate) => accessibleText(candidate) === label).length, stabilitySignals: ["form label", "user-facing"], warning: null } : null,
        placeholder ? { locator: `getByPlaceholder(${quoted(placeholder)})`, strategy: "playwright placeholder", confidenceScore: 0.91, matchCount: safeCount(`[placeholder="${cssEscape(placeholder)}"]`), stabilitySignals: ["user-facing placeholder"], warning: null } : null,
        aria ? { locator: `${tag}[aria-label="${aria.replace(/"/g, '\\"')}"]`, strategy: "aria-label", confidenceScore: 0.9, matchCount: safeCount(`${tag}[aria-label="${cssEscape(aria)}"]`), stabilitySignals: ["accessible name"], warning: null } : null,
        id && !dynamicValue(id) ? { locator: `#${cssEscape(id)}`, strategy: "stable id", confidenceScore: 0.88, matchCount: safeCount(`#${cssEscape(id)}`), stabilitySignals: ["stable id"], warning: null } : null,
        id && dynamicValue(id) ? { locator: `#${cssEscape(id)}`, strategy: "dynamic id", confidenceScore: 0.42, matchCount: safeCount(`#${cssEscape(id)}`), stabilitySignals: ["unique in current DOM"], warning: "ID appears generated and may change between builds." } : null,
        name ? { locator: `${tag}[name="${name.replace(/"/g, '\\"')}"]`, strategy: "name attribute", confidenceScore: 0.84, matchCount: safeCount(`${tag}[name="${cssEscape(name)}"]`), stabilitySignals: ["semantic form attribute"], warning: null } : null,
        text && ["button", "a"].includes(tag) ? { locator: `getByText(${quoted(text)})`, strategy: "playwright text", confidenceScore: 0.72, matchCount: [...document.querySelectorAll(tag)].filter((candidate) => clean(candidate.textContent) === clean(text)).length, stabilitySignals: ["user-facing text"], warning: "Visible copy can change with content or localization." } : null,
        { locator: inspectWindow.__hellotestRecorderLocatorFor?.(element) || tag, strategy: "css", confidenceScore: 0.55, matchCount: 1, stabilitySignals: ["DOM fallback"], warning: "Structural selectors are a last-resort fallback." }
      ].filter((candidate): candidate is { locator: string; strategy: string; confidenceScore: number; matchCount: number; stabilitySignals: string[]; warning: string | null } => Boolean(candidate))
        .filter((candidate, index, candidates) => candidates.findIndex((other) => other.locator === candidate.locator) === index)
        .map((candidate) => ({
          ...candidate,
          confidenceScore: candidate.matchCount === 1 ? candidate.confidenceScore : Math.max(0.25, candidate.confidenceScore - 0.24),
          warning: candidate.matchCount > 1 ? `Matches ${candidate.matchCount} elements on this screen.` : candidate.warning,
          recommended: candidate.matchCount === 1 && candidate.confidenceScore >= 0.9 && !candidate.warning
        }))
        .sort((left, right) => Number(right.matchCount === 1) - Number(left.matchCount === 1) || right.confidenceScore - left.confidenceScore);
    };
    const restoreInspectStyle = (target: HTMLElement) => {
      const isRepositoryHighlighted = target.dataset.hellotestRepositoryHighlight === "true";
      const isInspectSelected = target.dataset.hellotestInspectSelection === "true";
      if (isRepositoryHighlighted || isInspectSelected) {
        target.style.outline = "1px solid #2f6df6";
        target.style.outlineOffset = "1px";
        target.style.borderRadius = "1px";
        target.style.boxShadow = "none";
      } else {
        target.style.outline = target.dataset.hellotestInspectPreviousOutline || target.dataset.hellotestPreviousOutline || "";
        target.style.outlineOffset = target.dataset.hellotestInspectPreviousOutlineOffset || "";
        target.style.borderRadius = target.dataset.hellotestInspectPreviousBorderRadius || "";
        target.style.boxShadow = target.dataset.hellotestInspectPreviousBoxShadow || target.dataset.hellotestPreviousBoxShadow || "";
      }
      delete target.dataset.hellotestInspectPreviousOutline;
      delete target.dataset.hellotestInspectPreviousOutlineOffset;
      delete target.dataset.hellotestInspectPreviousBorderRadius;
      delete target.dataset.hellotestInspectPreviousBoxShadow;
      delete target.dataset.hellotestPreviousOutline;
      delete target.dataset.hellotestPreviousBoxShadow;
    };
    const clearHoverHighlight = () => {
      document.querySelectorAll("[data-hellotest-inspect-highlight='true']").forEach((node) => {
        const target = node as HTMLElement;
        delete target.dataset.hellotestInspectHighlight;
        restoreInspectStyle(target);
      });
    };
    const clearSelectionHighlight = () => {
      document.querySelectorAll("[data-hellotest-inspect-selection='true']").forEach((node) => {
        const target = node as HTMLElement;
        delete target.dataset.hellotestInspectSelection;
        restoreInspectStyle(target);
      });
    };
    clearSelectionHighlight();
    let hoverFrame = 0;
    let lastHoveredElement: Element | null = null;
    const highlight = (element: Element, selection = false) => {
      if (!(element instanceof HTMLElement)) return;
      clearHoverHighlight();
      if (element.dataset.hellotestRepositoryHighlight !== "true" && element.dataset.hellotestInspectSelection !== "true") {
        element.dataset.hellotestInspectPreviousOutline = element.style.outline || "";
        element.dataset.hellotestInspectPreviousOutlineOffset = element.style.outlineOffset || "";
        element.dataset.hellotestInspectPreviousBorderRadius = element.style.borderRadius || "";
        element.dataset.hellotestInspectPreviousBoxShadow = element.style.boxShadow || "";
      }
      if (selection) {
        clearSelectionHighlight();
        element.dataset.hellotestInspectSelection = "true";
      } else {
        element.dataset.hellotestInspectHighlight = "true";
      }
      const highlightToken = `${Date.now()}-${Math.random()}`;
      element.dataset.hellotestInspectHighlightToken = highlightToken;
      element.style.outline = "1px solid #2f6df6";
      element.style.outlineOffset = "1px";
      element.style.borderRadius = "1px";
      element.style.boxShadow = "none";
      if (selection) {
        const bounds = element.getBoundingClientRect();
        if (bounds.top < 0 || bounds.left < 0 || bounds.bottom > window.innerHeight || bounds.right > window.innerWidth) {
          element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
        }
        window.setTimeout(() => {
          if (element.dataset.hellotestInspectHighlightToken !== highlightToken) return;
          delete element.dataset.hellotestInspectSelection;
          delete element.dataset.hellotestInspectHighlightToken;
          restoreInspectStyle(element);
        }, 1_000);
      }
    };
    const queueSelection = (selection: unknown, locator: string) => {
      const current = Array.isArray(inspectWindow.__hellotestInspectSelections)
        ? inspectWindow.__hellotestInspectSelections
        : [];
      inspectWindow.__hellotestInspectSelections = [
        ...current.filter((item) => !item || typeof item !== "object" || (item as { locator?: unknown }).locator !== locator),
        selection
      ].slice(-80);
      inspectWindow.__hellotestInspectResult = selection;
    };
    const candidateElement = (target: EventTarget | null, path?: EventTarget[]) => {
      const composedTarget = path?.find((item) => item instanceof Element) || target;
      return composedTarget instanceof Element
        ? composedTarget.closest("input,button,select,textarea,a,[role],label,[data-testid],[data-test],[data-qa],[data-cy]") || composedTarget
        : null;
    };
    const hoverHandler = (event: MouseEvent) => {
      if (hoverFrame) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        const element = candidateElement(event.target, event.composedPath());
        if (element && element !== lastHoveredElement) {
          lastHoveredElement = element;
          highlight(element);
        }
      });
    };
    const handler = (event: MouseEvent) => {
      const element = candidateElement(event.target, event.composedPath());
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const tag = element.tagName.toLowerCase();
      const role = clean(element.getAttribute("role") || element.getAttribute("type") || tag);
      const candidates = locatorCandidates(element);
      const locator = candidates[0].locator;
      const ancestor = element.closest("form,[role=dialog],section,fieldset,main,article") || element.parentElement;
      const rect = element.getBoundingClientRect();
      const ancestorRect = ancestor?.getBoundingClientRect();
      const domStructure = element.outerHTML.slice(0, 12_000);
      const ancestorDom = ancestor?.outerHTML.slice(0, 30_000) || null;
      const selection = {
        friendly_name: friendlyName(element),
        html_tag: tag,
        role,
        locator,
        locator_kind: candidates[0].strategy,
        locator_candidates: candidates,
        dom_structure: domStructure,
        ancestor_dom: ancestorDom,
        text: inspectWindow.__hellotestRecorderVisibleTextFor?.(element) || clean(element.textContent).slice(0, 200),
        rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
        ancestor_rect: ancestorRect ? { x: ancestorRect.x + window.scrollX, y: ancestorRect.y + window.scrollY, width: ancestorRect.width, height: ancestorRect.height } : null
      };
      queueSelection(selection, locator);
      lastHoveredElement = null;
      highlight(element, true);
    };

    document.addEventListener("mousemove", hoverHandler, true);
    document.addEventListener("click", handler, true);
    inspectWindow.__hellotestInspectCleanup = () => {
      document.removeEventListener("mousemove", hoverHandler, true);
      document.removeEventListener("click", handler, true);
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
      lastHoveredElement = null;
      clearHoverHighlight();
    };
  });
};

const captureValidatedRepositoryLocator = async (
  page: Page,
  field: { locator: string; name?: string | null }
): Promise<RecorderLocatorValidation> => {
  const locatorText = normalizeText(field.locator) || "";
  const base = {
    locator: locatorText,
    name: normalizeText(field.name),
    match_count: 0,
    is_unique: false,
    dom_structure: null,
    ancestor_dom: null,
    element_screenshot_url: null,
    error: null
  };

  try {
    const locator = resolveRepositoryLocator(page, locatorText);
    const matchCount = await locator.count();
    if (matchCount !== 1) {
      return {
        ...base,
        match_count: matchCount,
        validation_status: matchCount === 0 ? "missing" : "ambiguous",
        warning: matchCount === 0
          ? "Locator no longer matches this screen."
          : `Locator matches ${matchCount} elements; choose a more specific locator.`
      };
    }

    const target = locator.first();
    const evidence = await target.evaluate((element) => {
      const ancestor = element.closest("form,[role=dialog],section,fieldset,main,article") || element.parentElement;
      const cleanClone = (source: Element | null, limit: number) => {
        if (!source) return null;
        const clone = source.cloneNode(true) as HTMLElement;
        const controls = [clone, ...clone.querySelectorAll("input,textarea,select,option")];
        controls.forEach((node) => {
          node.removeAttribute("value");
          node.removeAttribute("selected");
          if (node instanceof HTMLTextAreaElement) node.textContent = "";
        });
        clone.querySelectorAll("[data-hellotest-inspect-highlight='true'],[data-hellotest-inspect-selection='true'],[data-hellotest-repository-highlight='true']").forEach((node) => {
          const highlighted = node as HTMLElement;
          highlighted.style.outline = "";
          highlighted.style.outlineOffset = "";
          highlighted.style.borderRadius = "";
          highlighted.style.boxShadow = "";
          Object.keys(highlighted.dataset).filter((key) => key.startsWith("hellotest")).forEach((key) => delete highlighted.dataset[key]);
        });
        return clone.outerHTML.slice(0, limit);
      };
      return {
        dom_structure: cleanClone(element, 12_000),
        ancestor_dom: cleanClone(ancestor, 30_000)
      };
    });
    const screenshot = await target.screenshot({
      type: "jpeg",
      quality: SCREENCAST_QUALITY,
      timeout: 5_000
    }).catch(() => null);

    return {
      ...base,
      ...evidence,
      match_count: 1,
      is_unique: true,
      validation_status: "unique",
      warning: null,
      element_screenshot_url: screenshot ? `data:image/jpeg;base64,${screenshot.toString("base64")}` : null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to evaluate locator";
    return {
      ...base,
      validation_status: "invalid",
      warning: "Locator syntax could not be evaluated on the selected screen.",
      error: message.slice(0, 500)
    };
  }
};

const highlightRepositoryElement = async (page: Page, locator: string, label?: string | null, retainExisting = false) =>
  page.evaluate(({ targetLocator, targetLabel, keepExisting, durationMs }) => {
    const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
    const clearHighlight = () => {
      document.querySelectorAll("[data-hellotest-repository-highlight='true']").forEach((node) => {
        const element = node as HTMLElement;
        element.style.outline = element.dataset.hellotestRepositoryPreviousOutline || "";
        element.style.outlineOffset = element.dataset.hellotestRepositoryPreviousOutlineOffset || "";
        element.style.borderRadius = element.dataset.hellotestRepositoryPreviousBorderRadius || "";
        element.style.boxShadow = element.dataset.hellotestRepositoryPreviousBoxShadow || "";
        delete element.dataset.hellotestRepositoryPreviousOutline;
        delete element.dataset.hellotestRepositoryPreviousOutlineOffset;
        delete element.dataset.hellotestRepositoryPreviousBorderRadius;
        delete element.dataset.hellotestRepositoryPreviousBoxShadow;
        delete element.dataset.hellotestRepositoryHighlight;
        delete element.dataset.hellotestRepositoryHighlightToken;
      });
      document.getElementById("__hellotestRepositoryHighlightLabel")?.remove();
    };
    const resolveTarget = () => {
      const unescapeLiteral = (value: string) => value.replace(/\\(["'`\\])/g, "$1");
      const firstQuotedArgument = (value: string) => {
        const match = value.match(/\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/);
        return match ? unescapeLiteral(match[2]) : "";
      };
      const optionName = (value: string) => {
        const match = value.match(/\bname\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/i);
        return match ? unescapeLiteral(match[2]) : "";
      };
      const accessibleText = (element: Element) => clean(
        element.getAttribute("aria-label")
        || element.getAttribute("placeholder")
        || element.getAttribute("name")
        || element.textContent
      ).toLowerCase();
      const byAccessibleText = (text: string) => {
        const normalized = clean(text).toLowerCase();
        return [...document.querySelectorAll("button,a,[role],input,select,textarea,label,[data-testid],[data-test],[data-qa]")]
          .find((element) => accessibleText(element).includes(normalized)) || null;
      };
      const getByMatch = targetLocator.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId)\s*\(/i);
      if (getByMatch) {
        const method = getByMatch[1].toLowerCase();
        const firstArg = firstQuotedArgument(targetLocator);
        if (method === "getbytestid") {
          try {
            return document.querySelector(`[data-testid="${CSS.escape(firstArg)}"],[data-test="${CSS.escape(firstArg)}"],[data-qa="${CSS.escape(firstArg)}"]`);
          } catch {
            return null;
          }
        }
        if (method === "getbyplaceholder") {
          try {
            return document.querySelector(`[placeholder="${CSS.escape(firstArg)}"]`);
          } catch {
            return byAccessibleText(firstArg);
          }
        }
        if (method === "getbylabel") {
          return [...document.querySelectorAll("input,select,textarea")]
            .find((element) => clean((element as HTMLInputElement).labels?.[0]?.textContent || element.getAttribute("aria-label") || "").toLowerCase().includes(firstArg.toLowerCase()))
            || byAccessibleText(firstArg);
        }
        if (method === "getbyrole") {
          const role = firstArg.toLowerCase();
          const name = clean(optionName(targetLocator)).toLowerCase();
          return [...document.querySelectorAll(`[role="${role}"],${role === "button" ? "button," : ""}${role === "link" ? "a," : ""}input,select,textarea`)]
            .find((element) => !name || accessibleText(element).includes(name)) || null;
        }
        if (method === "getbytext") {
          return byAccessibleText(firstArg);
        }
      }
      const roleMatch = targetLocator.match(/^role=([^\[]+)\[name=["']?(.+?)["']?\]$/i);
      if (roleMatch) {
        const role = roleMatch[1].toLowerCase();
        const name = clean(roleMatch[2]).toLowerCase();
        return [...document.querySelectorAll(`[role="${role}"],${role === "button" ? "button," : ""}${role === "link" ? "a," : ""}input,select,textarea`)]
          .find((element) => clean(element.getAttribute("aria-label") || element.textContent).toLowerCase() === name) || null;
      }
      const textMatch = targetLocator.match(/^text=(.+)$/i);
      if (textMatch) {
        const text = clean(textMatch[1]).toLowerCase();
        return [...document.querySelectorAll("button,a,[role],input,select,textarea")]
          .find((element) => clean(element.getAttribute("aria-label") || element.textContent).toLowerCase().includes(text)) || null;
      }
      const labelMatch = targetLocator.match(/^label=(.+)$/i);
      if (labelMatch) {
        return byAccessibleText(labelMatch[1]);
      }
      const placeholderMatch = targetLocator.match(/^placeholder=(.+)$/i);
      if (placeholderMatch) {
        try {
          return document.querySelector(`[placeholder="${CSS.escape(clean(placeholderMatch[1]))}"]`);
        } catch {
          return byAccessibleText(placeholderMatch[1]);
        }
      }
      const testIdMatch = targetLocator.match(/^(?:testid|data-testid)=(.+)$/i);
      if (testIdMatch) {
        try {
          const testId = clean(testIdMatch[1]);
          return document.querySelector(`[data-testid="${CSS.escape(testId)}"],[data-test="${CSS.escape(testId)}"],[data-qa="${CSS.escape(testId)}"]`);
        } catch {
          return null;
        }
      }
      if (/^xpath=/i.test(targetLocator)) {
        return document.evaluate(targetLocator.replace(/^xpath=/i, ""), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
      }
      try {
        return document.querySelector(targetLocator);
      } catch {
        return null;
      }
    };

    if (!keepExisting) {
      clearHighlight();
    }
    const element = resolveTarget();
    if (!(element instanceof HTMLElement)) {
      return { found: false, locator: targetLocator };
    }

    if (element.dataset.hellotestRepositoryHighlight !== "true") {
      element.dataset.hellotestRepositoryPreviousOutline = element.dataset.hellotestPreviousOutline || element.style.outline || "";
      element.dataset.hellotestRepositoryPreviousOutlineOffset = element.style.outlineOffset || "";
      element.dataset.hellotestRepositoryPreviousBorderRadius = element.style.borderRadius || "";
      element.dataset.hellotestRepositoryPreviousBoxShadow = element.dataset.hellotestPreviousBoxShadow || element.style.boxShadow || "";
    }
    element.dataset.hellotestRepositoryHighlight = "true";
    const highlightToken = `${Date.now()}-${Math.random()}`;
    element.dataset.hellotestRepositoryHighlightToken = highlightToken;
    element.style.outline = "1px solid #2f6df6";
    element.style.outlineOffset = "1px";
    element.style.borderRadius = "1px";
    element.style.boxShadow = "none";
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 0 || bounds.left < 0 || bounds.bottom > window.innerHeight || bounds.right > window.innerWidth) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }

    if (!keepExisting) {
      const badge = document.createElement("div");
      badge.id = "__hellotestRepositoryHighlightLabel";
      badge.textContent = targetLabel || targetLocator;
      badge.style.cssText = "position:fixed;z-index:2147483647;padding:3px 6px;border-radius:2px;background:#2f6df6;color:#fff;font:600 11px system-ui;pointer-events:none;box-shadow:none";
      const rect = element.getBoundingClientRect();
      badge.style.left = `${Math.max(8, rect.left)}px`;
      badge.style.top = `${Math.max(8, rect.top - 32)}px`;
      document.body.appendChild(badge);
    }

    window.setTimeout(() => {
      if (element.dataset.hellotestRepositoryHighlightToken !== highlightToken) return;
      element.style.outline = element.dataset.hellotestRepositoryPreviousOutline || "";
      element.style.outlineOffset = element.dataset.hellotestRepositoryPreviousOutlineOffset || "";
      element.style.borderRadius = element.dataset.hellotestRepositoryPreviousBorderRadius || "";
      element.style.boxShadow = element.dataset.hellotestRepositoryPreviousBoxShadow || "";
      delete element.dataset.hellotestRepositoryPreviousOutline;
      delete element.dataset.hellotestRepositoryPreviousOutlineOffset;
      delete element.dataset.hellotestRepositoryPreviousBorderRadius;
      delete element.dataset.hellotestRepositoryPreviousBoxShadow;
      delete element.dataset.hellotestRepositoryHighlight;
      delete element.dataset.hellotestRepositoryHighlightToken;
      document.getElementById("__hellotestRepositoryHighlightLabel")?.remove();
    }, durationMs);

    return { found: true, locator: targetLocator, tag: element.tagName.toLowerCase(), duration_ms: durationMs };
  }, { targetLocator: locator, targetLabel: label || null, keepExisting: retainExisting, durationMs: REPOSITORY_HIGHLIGHT_DURATION_MS });

const clearRepositoryHighlights = async (page: Page) =>
  page.evaluate(() => {
    document.querySelectorAll("[data-hellotest-repository-highlight='true'],[data-hellotest-inspect-selection='true'],[data-hellotest-inspect-highlight='true']").forEach((node) => {
      const element = node as HTMLElement;
      element.style.outline = element.dataset.hellotestRepositoryPreviousOutline || element.dataset.hellotestInspectPreviousOutline || element.dataset.hellotestPreviousOutline || "";
      element.style.outlineOffset = element.dataset.hellotestRepositoryPreviousOutlineOffset || element.dataset.hellotestInspectPreviousOutlineOffset || "";
      element.style.borderRadius = element.dataset.hellotestRepositoryPreviousBorderRadius || element.dataset.hellotestInspectPreviousBorderRadius || "";
      element.style.boxShadow = element.dataset.hellotestRepositoryPreviousBoxShadow || element.dataset.hellotestInspectPreviousBoxShadow || element.dataset.hellotestPreviousBoxShadow || "";
      delete element.dataset.hellotestRepositoryPreviousOutline;
      delete element.dataset.hellotestRepositoryPreviousOutlineOffset;
      delete element.dataset.hellotestRepositoryPreviousBorderRadius;
      delete element.dataset.hellotestRepositoryPreviousBoxShadow;
      delete element.dataset.hellotestRepositoryHighlight;
      delete element.dataset.hellotestRepositoryHighlightToken;
      delete element.dataset.hellotestInspectPreviousOutline;
      delete element.dataset.hellotestInspectPreviousOutlineOffset;
      delete element.dataset.hellotestInspectPreviousBorderRadius;
      delete element.dataset.hellotestInspectPreviousBoxShadow;
      delete element.dataset.hellotestPreviousOutline;
      delete element.dataset.hellotestPreviousBoxShadow;
      delete element.dataset.hellotestInspectSelection;
      delete element.dataset.hellotestInspectHighlight;
      delete element.dataset.hellotestInspectHighlightToken;
    });
    document.getElementById("__hellotestRepositoryHighlightLabel")?.remove();
  });

const stopInspectMode = async (page: Page) =>
  page.evaluate(() => {
    const inspectWindow = window as typeof window & {
      __hellotestInspectCleanup?: () => void;
    };
    inspectWindow.__hellotestInspectCleanup?.();
  });

const enrichRemoteClickAction = async (
  session: RecorderSession,
  page: Page,
  actionIndex: number,
  x: number,
  y: number,
  logger: FastifyBaseLogger
) => {
  try {
    const target = await page.evaluate(
      ({ x: clientX, y: clientY }) => {
        const element = document.elementFromPoint(clientX, clientY);
        const recorderWindow = window as typeof window & {
          __hellotestRecorderLocatorFor?: (element: Element | null) => string | null;
          __hellotestRecorderVisibleTextFor?: (element: Element | null) => string | null;
        };
        const locator =
          typeof recorderWindow.__hellotestRecorderLocatorFor === "function"
            ? recorderWindow.__hellotestRecorderLocatorFor(element)
            : null;
        const text =
          typeof recorderWindow.__hellotestRecorderVisibleTextFor === "function"
            ? recorderWindow.__hellotestRecorderVisibleTextFor(element)
            : String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);

        return {
          locator: locator || null,
          text: text || null,
          url: window.location.href,
          title: document.title || null
        };
      },
      { x, y }
    ).catch(() => null);

    if (!target?.locator && !target?.text) {
      return;
    }

    const action = session.actions.find((item) => item.index === actionIndex);

    if (!action) {
      return;
    }

    action.locator = normalizeText(target.locator) || action.locator || null;
    action.text = normalizeText(target.text) || action.text || null;
    action.url = normalizeText(target.url) || action.url || page.url();
    action.page_title = normalizeText(target.title) || action.page_title || null;
  } catch (error) {
    logger.debug({ error, sessionId: session.id, actionIndex }, "Unable to enrich remote recorder click action");
  }
};

const readRecorderToken = (request: FastifyRequest) => {
  const query = request.query as { token?: unknown } | null;
  const header = request.headers["x-hellotest-recorder-token"];
  return normalizeText(query?.token)
    || normalizeText(Array.isArray(header) ? header[0] : header)
    || null;
};

const requireRecorderToken = (request: FastifyRequest, session: RecorderSession) =>
  readRecorderToken(request) === session.live_token;

const renderLiveViewHtml = (session: RecorderSession) => {
  const sessionId = JSON.stringify(session.id);
  const inspectMode = session.purpose === "repository-inspect";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HelloTest Recorder</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8f6;
      color: #202421;
    }
    * { box-sizing: border-box; }
    body {
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      margin: 0;
      display: flex;
      flex-direction: column;
      background: #f7f8f6;
    }
    header,
    .action-panel {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-bottom: 1px solid #dfe4dc;
      background: #ffffff;
    }
    header {
      flex: 0 0 auto;
      flex-wrap: wrap;
      min-height: 44px;
      gap: 8px 16px;
      padding: 6px 10px;
      position: relative;
      z-index: 10;
    }
    .brand {
      flex: 0 0 auto;
      white-space: nowrap;
    }
    header > .status {
      min-width: 0;
      margin-left: auto;
      max-width: 230px;
    }
    .inspect-view header {
      min-height: 38px;
      padding: 3px 8px;
      gap: 6px 10px;
    }
    .inspect-view .commandbar {
      margin-left: auto;
      justify-content: flex-end;
      gap: 4px;
    }
    .inspect-view header > .status {
      order: -1;
      margin-left: 0;
      margin-right: auto;
      max-width: min(220px, 30vw);
    }
    .inspect-view #dimensionText { display: none; }
    .inspect-view button,
    .inspect-view .more-controls > summary {
      min-height: 30px;
      padding: 5px 9px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 500;
    }
    .inspect-view .action-panel {
      padding: 5px 8px;
    }
    .inspect-view .action-form input {
      min-width: 0;
      padding: 6px 8px;
      border-radius: 5px;
      font-size: 12px;
    }
    .embedded-inspect header,
    .embedded-inspect .action-panel { display: none !important; }
    #statusText {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    strong {
      font-size: 14px;
      line-height: 1.2;
    }
    .meta {
      color: #667066;
      font-size: 12px;
    }
    .commandbar,
    .action-panel {
      flex-wrap: wrap;
    }
    .commandbar {
      display: flex;
      align-items: center;
      position: relative;
      gap: 5px;
      min-width: 0;
    }
    #dimensionText {
      margin-left: 2px;
      font-variant-numeric: tabular-nums;
    }
    .action-panel[hidden],
    .action-form[hidden] {
      display: none;
    }
    .action-panel {
      flex: 0 0 auto;
      padding-block: 7px;
      background: #fbfcfa;
    }
    .action-form {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 8px;
    }
    input {
      min-width: 180px;
      border: 1px solid #c9d0c6;
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    #address {
      flex: 1 1 320px;
    }
    #textInput {
      flex: 1 1 220px;
    }
    button {
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-weight: 700;
      color: #fff;
      background: #b55233;
      cursor: pointer;
      min-height: 34px;
      font-size: 12px;
      white-space: nowrap;
      padding: 7px 11px;
    }
    button:focus-visible,
    summary:focus-visible,
    input:focus-visible {
      outline: 2px solid #b55233;
      outline-offset: 2px;
    }
    button.secondary {
      color: #8d3f27;
      background: rgba(181, 82, 51, 0.1);
    }
    button[aria-expanded="true"] {
      box-shadow: 0 0 0 2px rgba(181, 82, 51, 0.18);
    }
    .more-controls {
      position: relative;
    }
    .more-controls > summary {
      display: inline-flex;
      min-height: 36px;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      list-style: none;
      color: #8d3f27;
      background: rgba(181, 82, 51, 0.1);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .more-controls > summary::-webkit-details-marker {
      display: none;
    }
    .more-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 10;
      display: grid;
      width: 190px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 8px;
      border: 1px solid #dfe4dc;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 12px 28px rgba(20, 28, 21, 0.18);
    }
    .more-menu button {
      min-width: 0;
      padding-inline: 9px;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }
    main {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      background: #1e221f;
    }
    .viewport {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      display: grid;
      place-items: safe center;
      padding: 4px;
      position: relative;
    }
    #screen {
      display: block;
      max-width: none;
      border: 0;
      border-radius: 2px;
      background: #fff;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.32);
      cursor: pointer;
      user-select: none;
      touch-action: none;
      outline: none;
    }
    #screen:focus {
      border-color: #f4ad55;
      box-shadow: 0 0 0 3px rgba(244, 173, 85, 0.25), 0 14px 40px rgba(0, 0, 0, 0.32);
    }
    .click-marker {
      position: fixed;
      width: 8px;
      height: 8px;
      margin: -4px 0 0 -4px;
      border: 0;
      border-radius: 999px;
      background: #f4ad55;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.75);
      transition: opacity 90ms ease, transform 90ms ease;
      z-index: 5;
    }
    .click-marker.is-visible {
      opacity: 1;
      transform: scale(1);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: #556056;
      font-size: 12px;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #3a9b68;
    }
    .error {
      color: #9a3a2f;
    }
    @media (prefers-color-scheme: dark) {
      :root,
      body {
        background: #171a18;
        color: #f1f3ef;
      }
      header,
      .commandbar,
      .action-panel {
        background: #222622;
        border-color: #343a34;
      }
      input {
        background: #171a18;
        border-color: #414840;
      }
      .meta,
      .status {
        color: #b8c1b6;
      }
      button.secondary {
        color: #f3b39f;
        background: rgba(243, 179, 159, 0.12);
      }
      .action-panel,
      .more-menu {
        background: #222622;
        border-color: #414840;
      }
      .more-controls > summary {
        color: #f3b39f;
        background: rgba(243, 179, 159, 0.12);
      }
    }
    @media (max-width: 720px) {
      .action-panel {
        align-items: stretch;
      }
      input,
      button {
        min-height: 40px;
      }
      #address,
      #textInput {
        flex-basis: 100%;
      }
      .action-form {
        flex-wrap: wrap;
      }
      header {
        gap: 6px 10px;
      }
      .brand strong {
        font-size: 12px;
      }
      header > .status {
        max-width: 125px;
      }
      #dimensionText {
        display: none;
      }
    }
  </style>
</head>
<body class="${inspectMode ? "inspect-view" : "recorder-view"}">
  <header>
    ${inspectMode ? "" : `<div class="brand" title="Session ${session.id.slice(0, 8)} · ${session.display_mode.replace(/-/g, " ")}">
      <strong>HelloTest Live builder</strong>
    </div>`}
    <nav class="commandbar" aria-label="Browser controls">
    <button id="addressToggle" aria-controls="actionPanel" aria-expanded="false" type="button">Go</button>
    <button id="typeToggle" aria-controls="actionPanel" aria-expanded="false" class="secondary" type="button">Type</button>
    <button class="secondary" data-key="Tab" type="button">Tab</button>
    <button class="secondary" data-key="Enter" type="button">Enter</button>
    <details class="more-controls" id="moreControls">
      <summary>More</summary>
      <div class="more-menu">
        <button class="secondary" data-key="Escape" type="button">Escape</button>
        <button class="secondary" data-key="Backspace" type="button">Backspace</button>
        <button class="secondary" data-key="ArrowUp" type="button">Arrow up</button>
        <button class="secondary" data-key="ArrowDown" type="button">Arrow down</button>
        <button class="secondary" data-key="ArrowLeft" type="button">Arrow left</button>
        <button class="secondary" data-key="ArrowRight" type="button">Arrow right</button>
      </div>
    </details>
    <button id="scaleToggle" class="secondary" aria-label="Show browser at actual size" aria-pressed="false" title="Show at 100% for small text and controls" type="button">100%</button>
    <span class="status" id="dimensionText"></span>
    </nav>
    <span class="status" role="status"><span class="dot" aria-hidden="true"></span><span id="statusText">Connecting</span></span>
  </header>
  <div class="action-panel" id="actionPanel" hidden>
    <form class="action-form" id="addressForm" hidden>
      <input id="address" aria-label="Page URL" autocomplete="off" inputmode="url" placeholder="https://app.example.com" required />
      <button id="goButton" type="submit">Go</button>
      <button class="secondary" data-close-action type="button">Cancel</button>
    </form>
    <form class="action-form" id="textForm" hidden>
      <input id="textInput" aria-label="Text to type" autocomplete="off" placeholder="Text for the focused field" required />
      <button id="typeButton" type="submit">Type</button>
      <button class="secondary" data-close-action type="button">Cancel</button>
    </form>
  </div>
  <main>
    <div class="viewport">
      <canvas id="screen" aria-label="Recorder browser viewport" role="img" tabindex="0"></canvas>
      <span class="click-marker" id="clickMarker"></span>
    </div>
  </main>
  <script>
    const sessionId = ${sessionId};
    const inspectMode = ${JSON.stringify(inspectMode)};
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const selectedPageId = new URLSearchParams(window.location.search).get("page_id") || "";
    const parentFrameId = new URLSearchParams(window.location.search).get("parent_frame") || "";
    const parentOrigin = (() => {
      const value = new URLSearchParams(window.location.search).get("parent_origin") || "";
      try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) && url.origin === value ? value : "";
      } catch { return ""; }
    })();
    const embeddedInspect = inspectMode && new URLSearchParams(window.location.search).get("embedded") === "repository-inspect"
      && Boolean(parentOrigin) && Boolean(parentFrameId) && window.parent !== window;
    if (embeddedInspect) document.body.classList.add("embedded-inspect");
    const readyStatus = inspectMode ? "Ready" : "Live";
    const screen = document.getElementById("screen");
    const screenContext = screen.getContext("2d", { alpha: false });
    const viewport = screen.parentElement;
    const scaleToggle = document.getElementById("scaleToggle");
    const clickMarker = document.getElementById("clickMarker");
    const statusText = document.getElementById("statusText");
    const dimensionText = document.getElementById("dimensionText");
    const actionPanel = document.getElementById("actionPanel");
    const addressForm = document.getElementById("addressForm");
    const textForm = document.getElementById("textForm");
    const addressToggle = document.getElementById("addressToggle");
    const typeToggle = document.getElementById("typeToggle");
    const moreControls = document.getElementById("moreControls");
    const address = document.getElementById("address");
    const textInput = document.getElementById("textInput");
    let pendingInputs = 0;
    let wheelTimer = null;
    let wheelDeltaX = 0;
    let wheelDeltaY = 0;
    let frameSequence = 0;
    let clickMarkerTimer = null;
    let actualSize = false;
    let lastInputError = "";
    let statusError = "";
    let lastReportedState = "";
    const reportState = () => {
      if (!embeddedInspect) return;
      const state = { type: "hellotest:recorder:state", session_id: sessionId, frame_id: parentFrameId,
        width: screen.width || 0, height: screen.height || 0, actual_size: actualSize,
        pending: pendingInputs, error: lastInputError || statusError || "" };
      const serialized = JSON.stringify(state);
      if (serialized === lastReportedState) return;
      lastReportedState = serialized;
      window.parent.postMessage(state, parentOrigin);
    };

    const resizeScreen = () => {
      if (!screen.width || !screen.height) return;
      const availableWidth = Math.max(1, viewport.clientWidth - 8);
      const availableHeight = Math.max(1, viewport.clientHeight - 8);
      const scale = actualSize ? 1 : Math.min(1, availableWidth / screen.width, availableHeight / screen.height);
      screen.style.width = Math.max(1, Math.floor(screen.width * scale)) + "px";
      screen.style.height = Math.max(1, Math.floor(screen.height * scale)) + "px";
      reportState();
    };

    new ResizeObserver(resizeScreen).observe(viewport);
    const setActualSize = (value) => {
      actualSize = value;
      scaleToggle.textContent = actualSize ? "Fit" : "100%";
      scaleToggle.setAttribute("aria-pressed", String(actualSize));
      scaleToggle.setAttribute("aria-label", actualSize ? "Fit browser to available space" : "Show browser at actual size");
      scaleToggle.title = actualSize ? "Fit the whole browser in the available space" : "Show at 100% for small text and controls";
      resizeScreen();
      reportState();
    };
    scaleToggle.addEventListener("click", () => setActualSize(!actualSize));

    const withToken = (path) => path + "?token=" + encodeURIComponent(token)
      + (selectedPageId ? "&page_id=" + encodeURIComponent(selectedPageId) : "");
    const streamUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/stream");
    const inputUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/input");

    const setStatus = (text, isError = false) => {
      statusText.textContent = text;
      statusText.title = text;
      statusText.classList.toggle("error", Boolean(isError));
      statusError = isError ? text : "";
      reportState();
    };

    const markInputStarted = () => {
      lastInputError = "";
      pendingInputs += 1;
      setStatus("Sending");
    };

    const markInputFinished = () => {
      pendingInputs = Math.max(0, pendingInputs - 1);
      if (!pendingInputs) {
        setStatus(lastInputError || readyStatus, Boolean(lastInputError));
      }
    };

    const send = async (payload) => {
      if (!token) {
        lastInputError = "Live session unavailable";
        setStatus(lastInputError, true);
        return false;
      }
      markInputStarted();

      try {
        const response = await fetch(inputUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-HelloTest-Recorder-Token": token },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || "Recorder input failed");
        }

        markInputFinished();
        return true;
      } catch (error) {
        pendingInputs = Math.max(0, pendingInputs - 1);
        lastInputError = error instanceof Error ? error.message : "Input failed";
        setStatus(lastInputError, true);
        return false;
      }
    };

    const renderFrame = (frame) => {
      if (!frame?.data || !screenContext) return;
      const sequence = ++frameSequence;
      const image = new Image();

      image.addEventListener("load", () => {
        if (sequence !== frameSequence) return;
        const width = Math.round(frame.metadata?.deviceWidth || image.naturalWidth || image.width || 0);
        const height = Math.round(frame.metadata?.deviceHeight || image.naturalHeight || image.height || 0);

        if (width && height && (screen.width !== width || screen.height !== height)) {
          screen.width = width;
          screen.height = height;
          resizeScreen();
        }

        screenContext.drawImage(image, 0, 0, screen.width || image.width, screen.height || image.height);
        dimensionText.textContent = screen.width && screen.height ? screen.width + " x " + screen.height : "";
        reportState();

        if (!pendingInputs) {
          setStatus(lastInputError || readyStatus, Boolean(lastInputError));
        }
      }, { once: true });

      image.addEventListener("error", () => {
        setStatus("Stream frame failed", true);
      }, { once: true });

      image.src = "data:image/jpeg;base64," + frame.data;
    };

    const showClickMarker = (clientX, clientY) => {
      if (!clickMarker) return;
      if (clickMarkerTimer) {
        window.clearTimeout(clickMarkerTimer);
      }
      clickMarker.style.left = clientX + "px";
      clickMarker.style.top = clientY + "px";
      clickMarker.classList.add("is-visible");
      clickMarkerTimer = window.setTimeout(() => clickMarker.classList.remove("is-visible"), 180);
    };

    const connectStream = () => {
      if (!window.EventSource || !token) {
        setStatus("Live stream unavailable", true);
        return;
      }

      const source = new EventSource(streamUrl());

      source.addEventListener("open", () => {
        setStatus(lastInputError || readyStatus, Boolean(lastInputError));
      });

      source.addEventListener("ready", () => {
        setStatus(lastInputError || readyStatus, Boolean(lastInputError));
      });

      source.addEventListener("frame", (event) => {
        try {
          const frame = JSON.parse(event.data);
          renderFrame(frame);
        } catch {
          setStatus("Stream frame failed", true);
        }
      });

      source.addEventListener("error", () => {
        setStatus("Reconnecting live stream", true);
      });
    };

    screen.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!screen.width || !screen.height) return;
      event.preventDefault();
      const rect = screen.getBoundingClientRect();
      const x = Math.round((event.clientX - rect.left) * (screen.width / rect.width));
      const y = Math.round((event.clientY - rect.top) * (screen.height / rect.height));
      showClickMarker(event.clientX, event.clientY);
      screen.focus({ preventScroll: true });
      send({ type: "click", x, y });
    });

    screen.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Shift+Tab leaves the remote canvas so local controls remain reachable.
      if (event.key === "Tab" && event.shiftKey) return;
      if (event.key.length === 1) {
        event.preventDefault();
        send({ type: "type", text: event.key });
        return;
      }
      if (["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        send({ type: "press", key: event.key });
      }
    });

    screen.addEventListener("wheel", (event) => {
      event.preventDefault();
      wheelDeltaX += event.deltaX;
      wheelDeltaY += event.deltaY;
      if (wheelTimer) return;
      wheelTimer = window.setTimeout(() => {
        const deltaX = wheelDeltaX;
        const deltaY = wheelDeltaY;
        wheelDeltaX = 0;
        wheelDeltaY = 0;
        wheelTimer = null;
        send({ type: "scroll", delta_x: deltaX, delta_y: deltaY });
      }, 80);
    }, { passive: false });

    const closeActionPanel = (restoreFocus = false) => {
      const activeToggle = addressToggle.getAttribute("aria-expanded") === "true" ? addressToggle : typeToggle;
      actionPanel.hidden = true;
      addressForm.hidden = true;
      textForm.hidden = true;
      addressToggle.setAttribute("aria-expanded", "false");
      typeToggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) activeToggle.focus();
    };

    const openActionPanel = (action) => {
      const showAddress = action === "address";
      const activeToggle = showAddress ? addressToggle : typeToggle;
      const wasOpen = !actionPanel.hidden && activeToggle.getAttribute("aria-expanded") === "true";
      closeActionPanel();
      moreControls.open = false;
      if (wasOpen) return;
      actionPanel.hidden = false;
      addressForm.hidden = !showAddress;
      textForm.hidden = showAddress;
      activeToggle.setAttribute("aria-expanded", "true");
      window.requestAnimationFrame(() => (showAddress ? address : textInput).focus());
    };

    addressToggle.addEventListener("click", () => openActionPanel("address"));
    typeToggle.addEventListener("click", () => openActionPanel("type"));
    document.querySelectorAll("[data-close-action]").forEach((button) => {
      button.addEventListener("click", () => closeActionPanel(true));
    });

    addressForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const goButton = document.getElementById("goButton");
      if (goButton.disabled || !address.value.trim()) return;
      goButton.disabled = true;
      const succeeded = await send({ type: "goto", url: address.value.trim() });
      goButton.disabled = false;
      if (succeeded) {
        closeActionPanel();
        screen.focus({ preventScroll: true });
      }
    });

    textForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const typeButton = document.getElementById("typeButton");
      if (typeButton.disabled || !textInput.value) return;
      typeButton.disabled = true;
      const succeeded = await send({ type: "type", text: textInput.value });
      typeButton.disabled = false;
      if (succeeded) {
        textInput.value = "";
        closeActionPanel();
        screen.focus({ preventScroll: true });
      }
    });

    [address, textInput].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeActionPanel(true);
        }
      });
    });

    document.querySelectorAll("[data-key]").forEach((button) => {
      button.addEventListener("click", () => {
        send({ type: "press", key: button.getAttribute("data-key") });
        moreControls.open = false;
        screen.focus({ preventScroll: true });
      });
    });

    document.addEventListener("pointerdown", (event) => {
      if (moreControls.open && !moreControls.contains(event.target)) {
        moreControls.open = false;
      }
    });

    moreControls.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        moreControls.open = false;
        moreControls.querySelector("summary").focus();
      }
    });

    window.addEventListener("message", async (event) => {
      if (!embeddedInspect || event.source !== window.parent || event.origin !== parentOrigin) return;
      const message = event.data;
      if (!message || message.type !== "hellotest:recorder:command" || message.session_id !== sessionId
        || message.frame_id !== parentFrameId || typeof message.value !== "string") return;
      if (message.command === "scale") {
        if (!["fit", "actual", "toggle"].includes(message.value)) return;
        setActualSize(message.value === "fit" ? false : message.value === "actual" ? true : !actualSize);
        return;
      }
      let payload;
      if (message.command === "navigate" && message.value.trim()) payload = { type: "goto", url: message.value.trim() };
      else if (message.command === "type" && message.value) payload = { type: "type", text: message.value };
      else if (message.command === "key" && ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(message.value)) payload = { type: "press", key: message.value };
      if (payload && await send(payload)) screen.focus({ preventScroll: true });
    });

    reportState();
    connectStream();
  </script>
</body>
</html>`;
};

const stopSession = async (session: RecorderSession) => {
  if (session.status === "running") {
    session.status = "stopped";
  }

  session.stopped_at = session.stopped_at || new Date().toISOString();
  await session.context.close().catch(() => undefined);
  await session.inspection_proxy?.close().catch(() => undefined);
  await rm(session.user_data_dir, { recursive: true, force: true }).catch(() => undefined);
};

const stopOrphanedSessions = async (logger: FastifyBaseLogger) => {
  const now = Date.now();

  for (const session of sessions.values()) {
    if (session.status !== "running" || (session.paused && session.purpose !== "repository-inspect")) {
      continue;
    }

    const lastActivity = Date.parse(session.last_activity_at || session.started_at);

    if (Number.isFinite(lastActivity) && now - lastActivity <= RECORDER_ORPHAN_TTL_MS) {
      continue;
    }

    session.error = "Recorder session auto-stopped after more than 3 minutes without live-view or input activity.";
    logger.warn(
      {
        sessionId: session.id,
        started_at: session.started_at,
        last_activity_at: session.last_activity_at,
        orphan_ttl_ms: RECORDER_ORPHAN_TTL_MS
      },
      "Recorder orphan session auto-stopped"
    );
    await stopSession(session);
  }
};

export const registerRecorderRoutes = async (app: FastifyInstance) => {
  const agentToken = normalizeText(process.env.HELLOTEST_INSPECTOR_TOKEN);
  const secret = resolveTestEngineSharedSecret();
  const isPrivileged = (request: FastifyRequest) => Boolean(secret.secret && extractTestEngineSecrets(request).some(value => constantTimeSecretMatches(value, secret.secret!)));
  app.addHook("preHandler", async (request, reply) => {
    const pathname = request.url.split("?")[0];
    if (!pathname.startsWith("/api/v1/recorder/")) return;
    const id = (request.params as { id?: string })?.id;
    const session = id ? sessions.get(id) : undefined;
    const paired = Boolean(agentToken && constantTimeSecretMatches(String(request.headers["x-hellotest-agent-token"] || ""), agentToken));
    const scoped = Boolean(session && requireRecorderToken(request, session));
    const repositoryCreate = pathname === "/api/v1/recorder/sessions" && request.method === "POST"
      && (request.body as { purpose?: string })?.purpose === "repository-inspect";
    if ((agentToken && !paired && !scoped)
      || (!agentToken && (repositoryCreate || session?.purpose === "repository-inspect") && !scoped && !isPrivileged(request))) {
      reply.code(401).send({ code: agentToken ? "INSPECTION_AGENT_UNPAIRED" : "INSPECTION_AUTH_REQUIRED", message: agentToken ? "Pair this local inspection agent from HelloTest before connecting." : "Protected inspection session requires authorization." });
    }
  });
  app.get("/api/v1/recorder/agent/status", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    if (!agentToken) { reply.code(409); return { ready: false, code: "INSPECTION_AGENT_NOT_CONFIGURED", message: "Restart the local agent using the pairing command from Object Repository." }; }
    const ready = await access(chromium.executablePath()).then(() => true, () => false);
    const execution = (app as FastifyInstance & { pairedLocalExecution?: { agent_id: string; execution_protocol_version: number; local_execution: boolean } }).pairedLocalExecution;
    return { ready, service: "hellotest-inspection-agent", protocol_version: 1,
      agent_id: execution?.agent_id || null,
      execution_protocol_version: execution?.execution_protocol_version || null,
      supported_web_engines: execution ? ["playwright"] : [],
      capabilities: { repository_inspection: true, local_execution: Boolean(execution?.local_execution), local_browser_build: Boolean(execution?.local_execution) },
      ...(ready ? {} : { message: "Chromium is not installed. Run the setup command again to install Playwright browsers." }) };
  });
  const cleanupTimer = setInterval(() => {
    void stopOrphanedSessions(app.log);
  }, RECORDER_CLEANUP_INTERVAL_MS);

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    await Promise.all([...sessions.values()].map(stopSession));
  });

  app.get("/api/v1/recorder/sessions", async () => ({
    items: [...sessions.values()].filter(session => session.purpose !== "repository-inspect").map((session) => serializeSession(session))
  }));

  app.get("/api/v1/recorder/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    return serializeSession(session);
  });

  app.get("/api/v1/recorder/sessions/:id/tabs", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    const pages = session.context.pages().filter((page) => !page.isClosed());
    const activePage = await resolveActivePage(session);
    const activePageId = getRecorderPageId(activePage);

    return {
      session_id: session.id,
      active_page_id: activePageId,
      tabs: await Promise.all(pages.map(async (page) => ({
        ...await serializeRecorderPage(page),
        active: getRecorderPageId(page) === activePageId
      })))
    };
  });

  app.post("/api/v1/recorder/sessions/:id/tabs/activate", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { page_id?: string | null } | null;
    const session = sessions.get(params.id);
    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }
    if (!requireRecorderToken(request, session)) {
      reply.code(403);
      return { message: "Recorder live view token is invalid or expired" };
    }
    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }
    const pageId = normalizeText(body?.page_id);
    if (!pageId) {
      reply.code(400);
      return { message: "page_id is required" };
    }
    try {
      const page = await resolveRecorderPage(session, pageId);
      await page.bringToFront();
      session.active_page_id = getRecorderPageId(page);
      touchSession(session);
      return { session_id: session.id, active_page_id: session.active_page_id, page: await serializeRecorderPage(page) };
    } catch (error) {
      reply.code(409);
      return { message: error instanceof Error ? error.message : "Unable to activate the selected browser tab" };
    }
  });

  app.post("/api/v1/recorder/sessions/:id/inspect/start", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { page_id?: string | null } | null;
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }

    try {
      const page = await resolveRecorderPage(session, body?.page_id);
      await page.bringToFront().catch(() => undefined);
      await installInspectMode(page);
      inspectResults.delete(`${session.id}:${getRecorderPageId(page) || ""}`);
      touchSession(session);

      return {
        ok: true,
        page: await serializeRecorderPage(page)
      };
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to start inspect mode"
      };
    }
  });

  app.post("/api/v1/recorder/sessions/:id/inspect/stop", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { page_id?: string | null } | null;
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }

    try {
      const page = await resolveRecorderPage(session, body?.page_id);
      await stopInspectMode(page);
      touchSession(session);
      return { ok: true, page: await serializeRecorderPage(page) };
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to stop inspect mode"
      };
    }
  });

  app.post("/api/v1/recorder/sessions/:id/highlight", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { page_id?: string | null; locator?: string | null; label?: string | null; retain_existing?: boolean; clear_existing?: boolean } | null;
    const session = sessions.get(params.id);
    const locator = normalizeText(body?.locator);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }
    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }
    if (!locator && body?.clear_existing !== true) {
      reply.code(400);
      return { message: "Locator is required for browser highlighting" };
    }

    try {
      const page = await resolveRecorderPage(session, body?.page_id);
      await page.bringToFront().catch(() => undefined);
      if (body?.clear_existing === true) {
        await clearRepositoryHighlights(page);
        touchSession(session);
        return { cleared: true };
      }
      const result = await highlightRepositoryElement(page, locator as string, normalizeText(body?.label), body?.retain_existing === true);
      touchSession(session);
      if (!result.found) {
        reply.code(404);
      }
      return result.found ? result : { message: "Field locator was not found on the selected browser tab", ...result };
    } catch (error) {
      reply.code(409);
      return { message: error instanceof Error ? error.message : "Unable to highlight repository field" };
    }
  });

  app.post("/api/v1/recorder/sessions/:id/inspect/validate", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      page_id?: string | null;
      fields?: Array<{ locator?: string | null; name?: string | null }>;
    } | null;
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }
    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }

    const requestedFields = Array.isArray(body?.fields)
      ? body.fields
          .map((field) => ({ locator: normalizeText(field?.locator), name: normalizeText(field?.name) }))
          .filter((field): field is { locator: string; name: string | null } => Boolean(field.locator))
      : [];
    if (!requestedFields.length) {
      reply.code(400);
      return { message: "Select at least one locator to validate" };
    }
    if (requestedFields.length > REPOSITORY_VALIDATION_FIELD_LIMIT) {
      reply.code(400);
      return { message: `Locator validation is limited to ${REPOSITORY_VALIDATION_FIELD_LIMIT} fields per save` };
    }

    try {
      const page = await resolveRecorderPage(session, body?.page_id);
      await page.bringToFront().catch(() => undefined);
      await clearRepositoryHighlights(page).catch(() => undefined);

      const fields = await Promise.all(requestedFields.map((field) => captureValidatedRepositoryLocator(page, field)));
      const [pageTitle, screenDom, accessibilityTree, screenshot] = await Promise.all([
        resolvePageTitle(page),
        page.evaluate(() => {
          const source = document.documentElement;
          if (!source) return "";
          const cloned = source.cloneNode(true) as HTMLElement;
          cloned.querySelectorAll("input,textarea,select,option").forEach((node) => {
            node.removeAttribute("value");
            node.removeAttribute("selected");
            if (node instanceof HTMLTextAreaElement) node.textContent = "";
          });
          cloned.querySelectorAll("[data-hellotest-inspect-highlight='true'],[data-hellotest-inspect-selection='true'],[data-hellotest-repository-highlight='true']").forEach((node) => {
            const target = node as HTMLElement;
            target.style.outline = "";
            target.style.outlineOffset = "";
            target.style.borderRadius = "";
            target.style.boxShadow = "";
            Object.keys(target.dataset).filter((key) => key.startsWith("hellotest")).forEach((key) => delete target.dataset[key]);
          });
          return cloned.outerHTML.slice(0, 100_000);
        }).catch(() => ""),
        page.locator("body").ariaSnapshot({ timeout: 2_000 }).catch(() => ""),
        page.screenshot({
          type: "jpeg",
          quality: SCREENCAST_QUALITY,
          fullPage: false,
          timeout: 5_000
        }).catch(() => null)
      ]);
      const capturedAt = new Date().toISOString();
      const pageUrl = page.url();
      const allUnique = fields.every((field) => field.is_unique);
      touchSession(session);

      return {
        validated_at: capturedAt,
        page_id: getRecorderPageId(page),
        page_title: pageTitle,
        page_url: pageUrl,
        all_unique: allUnique,
        unique_count: fields.filter((field) => field.is_unique).length,
        screen_dom: screenDom || null,
        accessibility_tree: accessibilityTree || null,
        screen_fingerprint: createHash("sha256").update(`${pageUrl}\n${screenDom}`).digest("hex"),
        screen_screenshot_url: screenshot ? `data:image/jpeg;base64,${screenshot.toString("base64")}` : null,
        fields
      };
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to validate selected repository locators"
      };
    }
  });

  app.get("/api/v1/recorder/sessions/:id/inspect/result", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { page_id?: string | null };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    try {
      const page = await resolveRecorderPage(session, query.page_id);
      const pageId = getRecorderPageId(page);
      const cacheKey = `${session.id}:${pageId || ""}`;

      const elements = await page.evaluate(() => {
        const inspectWindow = window as typeof window & {
          __hellotestInspectResult?: unknown;
          __hellotestInspectSelections?: unknown[];
        };
        const queued = Array.isArray(inspectWindow.__hellotestInspectSelections)
          ? inspectWindow.__hellotestInspectSelections
          : [];
        const latest = inspectWindow.__hellotestInspectResult;
        const selections = queued.length ? queued : latest ? [latest] : [];
        inspectWindow.__hellotestInspectSelections = [];
        inspectWindow.__hellotestInspectResult = null;
        return selections;
      }).catch(() => []) as RecorderInspectElement[];

      const validElements = elements.filter((element) =>
        element
        && typeof element === "object"
        && typeof element.locator === "string"
        && Boolean(element.locator)
      );

      if (!validElements.length) {
        reply.code(204);
        return "";
      }

      const [pageTitle, screenDom, accessibilityTree, screenshot] = await Promise.all([
        resolvePageTitle(page),
        page.evaluate(() => {
          const source = document.documentElement;
          if (!source) return "";
          const cloned = source.cloneNode(true) as HTMLElement;
          cloned.querySelectorAll("input,textarea,select,option").forEach((node) => {
            node.removeAttribute("value");
            node.removeAttribute("selected");
            if (node instanceof HTMLTextAreaElement) node.textContent = "";
          });
          cloned.querySelectorAll("[data-hellotest-inspect-highlight='true'],[data-hellotest-inspect-selection='true'],[data-hellotest-repository-highlight='true']").forEach((node) => {
            const target = node as HTMLElement;
            target.style.outline = target.dataset.hellotestRepositoryPreviousOutline || target.dataset.hellotestInspectPreviousOutline || target.dataset.hellotestPreviousOutline || "";
            target.style.outlineOffset = target.dataset.hellotestRepositoryPreviousOutlineOffset || target.dataset.hellotestInspectPreviousOutlineOffset || "";
            target.style.borderRadius = target.dataset.hellotestRepositoryPreviousBorderRadius || target.dataset.hellotestInspectPreviousBorderRadius || "";
            target.style.boxShadow = target.dataset.hellotestRepositoryPreviousBoxShadow || target.dataset.hellotestInspectPreviousBoxShadow || target.dataset.hellotestPreviousBoxShadow || "";
            delete target.dataset.hellotestRepositoryPreviousOutline;
            delete target.dataset.hellotestRepositoryPreviousOutlineOffset;
            delete target.dataset.hellotestRepositoryPreviousBorderRadius;
            delete target.dataset.hellotestRepositoryPreviousBoxShadow;
            delete target.dataset.hellotestRepositoryHighlight;
            delete target.dataset.hellotestInspectPreviousOutline;
            delete target.dataset.hellotestInspectPreviousOutlineOffset;
            delete target.dataset.hellotestInspectPreviousBorderRadius;
            delete target.dataset.hellotestInspectPreviousBoxShadow;
            delete target.dataset.hellotestPreviousOutline;
            delete target.dataset.hellotestPreviousBoxShadow;
            delete target.dataset.hellotestInspectHighlight;
            delete target.dataset.hellotestInspectSelection;
          });
          return cloned.outerHTML.slice(0, 100_000);
        }).catch(() => ""),
        page.locator("body").ariaSnapshot({ timeout: 2_000 }).catch(() => ""),
        page.screenshot({
          type: "jpeg",
          quality: SCREENCAST_QUALITY,
          fullPage: true,
          timeout: 5_000
        }).catch(() => null)
      ]);
      const screenshotClip = async (rect: RecorderInspectElement["rect"]) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return page.screenshot({
          type: "jpeg",
          quality: SCREENCAST_QUALITY,
          clip: {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height)
          },
          timeout: 5_000
        }).catch(() => null);
      };
      const selections = await Promise.all(validElements.map(async (element) => {
        const [elementScreenshot, ancestorScreenshot] = await Promise.all([
          screenshotClip(element.rect),
          screenshotClip(element.ancestor_rect)
        ]);
        return {
          element,
          element_screenshot_url: elementScreenshot ? `data:image/jpeg;base64,${elementScreenshot.toString("base64")}` : null,
          ancestor_screenshot_url: ancestorScreenshot ? `data:image/jpeg;base64,${ancestorScreenshot.toString("base64")}` : null
        };
      }));
      const primarySelection = selections.at(-1) as RecorderInspectSelectionResult;

      const result: RecorderInspectResult = {
        captured_at: new Date().toISOString(),
        page_id: pageId,
        page_title: pageTitle,
        page_url: page.url(),
        screen_dom: screenDom || null,
        accessibility_tree: accessibilityTree || null,
        screen_fingerprint: createHash("sha256").update(`${page.url()}\n${screenDom}`).digest("hex"),
        screen_screenshot_url: screenshot ? `data:image/jpeg;base64,${screenshot.toString("base64")}` : null,
        element_screenshot_url: primarySelection.element_screenshot_url,
        ancestor_screenshot_url: primarySelection.ancestor_screenshot_url,
        element: primarySelection.element,
        selections
      };

      inspectResults.set(cacheKey, result);
      touchSession(session);
      return result;
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to read inspect result"
      };
    }
  });

  app.get("/api/v1/recorder/sessions/:id/live", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (!requireRecorderToken(request, session)) {
      reply.code(403);
      return { message: "Recorder live view token is invalid or expired" };
    }

    touchSession(session);
    reply
      .header("Cache-Control", `private, max-age=${LIVE_VIEW_HTML_CACHE_SECONDS}`)
      .type("text/html; charset=utf-8");
    return renderLiveViewHtml(session);
  });

  app.get("/api/v1/recorder/sessions/:id/stream", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { page_id?: string | null };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (!requireRecorderToken(request, session)) {
      reply.code(403);
      return { message: "Recorder live view token is invalid or expired" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }

    let client: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
    let closed = false;
    let keepAlive: NodeJS.Timeout | null = null;

    const writeEvent = (event: string, payload: unknown) => {
      if (closed || reply.raw.destroyed || reply.raw.writableEnded) {
        return;
      }

      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const cleanup = async () => {
      if (closed) {
        return;
      }

      closed = true;

      if (keepAlive) {
        clearInterval(keepAlive);
      }

      await client?.send("Page.stopScreencast").catch(() => undefined);
      await client?.detach().catch(() => undefined);
    };

    try {
      const page = await resolveRecorderPage(session, normalizeText(query?.page_id));
      touchSession(session);
      client = await session.context.newCDPSession(page);

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      reply.raw.write(": connected\n\n");

      request.raw.on("close", () => {
        void cleanup();
      });

      keepAlive = setInterval(() => {
        if (!closed && !reply.raw.destroyed && !reply.raw.writableEnded) {
          touchSession(session);
          reply.raw.write(": keep-alive\n\n");
        }
      }, 15_000);

      client.on("Page.screencastFrame", (event) => {
        const frame = event as {
          data?: string;
          sessionId?: number;
          metadata?: {
            deviceWidth?: number;
            deviceHeight?: number;
            pageScaleFactor?: number;
            offsetTop?: number;
            scrollOffsetX?: number;
            scrollOffsetY?: number;
            timestamp?: number;
          };
        };

        if (!frame.data || frame.sessionId === undefined) {
          return;
        }

        writeEvent("frame", {
          data: frame.data,
          metadata: frame.metadata || {}
        });
        touchSession(session);
        void client?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      });

      await client.send("Page.startScreencast", {
        format: "jpeg",
        quality: SCREENCAST_QUALITY,
        everyNthFrame: SCREENCAST_EVERY_NTH_FRAME
      });
      writeEvent("ready", {
        format: "jpeg",
        quality: SCREENCAST_QUALITY,
        everyNthFrame: SCREENCAST_EVERY_NTH_FRAME
      });
    } catch (error) {
      if (reply.sent) {
        const message = error instanceof Error ? error.message : "Unable to start recorder stream";
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          reply.raw.write(`event: error\n`);
          reply.raw.write(`data: ${JSON.stringify({ message })}\n\n`);
        }
        await cleanup();
        reply.raw.end();
        return;
      }

      await cleanup();
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to start recorder stream"
      };
    }
  });

  app.get("/api/v1/recorder/sessions/:id/screenshot", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { page_id?: string | null };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (!requireRecorderToken(request, session)) {
      reply.code(403);
      return { message: "Recorder live view token is invalid or expired" };
    }

    try {
      const page = await resolveRecorderPage(session, normalizeText(query?.page_id));
      touchSession(session);
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: SCREENCAST_QUALITY,
        fullPage: false,
        timeout: 5_000
      });

      reply
        .header("Cache-Control", "no-store")
        .type("image/jpeg");
      return screenshot;
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Unable to capture recorder screenshot"
      };
    }
  });

  app.post("/api/v1/recorder/sessions/:id/input", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { page_id?: string | null };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (!requireRecorderToken(request, session)) {
      reply.code(403);
      return { message: "Recorder live view token is invalid or expired" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Recorder session is not running" };
    }

    const body = request.body as {
      type?: string;
      x?: unknown;
      y?: unknown;
      text?: unknown;
      key?: unknown;
      url?: unknown;
      delta_x?: unknown;
      delta_y?: unknown;
    } | null;
    const type = normalizeText(body?.type);

    try {
      const page = await resolveRecorderPage(session, normalizeText(query?.page_id));
      touchSession(session);

      if (type === "click") {
        const x = normalizePositiveNumber(body?.x);
        const y = normalizePositiveNumber(body?.y);

        if (x === null || y === null) {
          reply.code(400);
          return { message: "click input requires non-negative x and y coordinates" };
        }

        const action = pushRecorderAction(session, {
          type: "click",
          locator: null,
          text: `Click at ${x}, ${y}`,
          value: null,
          url: page.url(),
          page_id: getRecorderPageId(page),
          page_title: null,
          x,
          y,
          source: "remote-control"
        });
        if (action) {
          void enrichRemoteClickAction(session, page, action.index, x, y, app.log);
        }
        await page.mouse.click(x, y);
      } else if (type === "type") {
        const text = clipRawText(body?.text, REMOTE_TEXT_LIMIT);

        if (text) {
          await page.keyboard.type(text, { delay: 2 });
        }
      } else if (type === "press") {
        const key = normalizeText(body?.key);

        if (!key) {
          reply.code(400);
          return { message: "press input requires a key" };
        }

        await page.keyboard.press(key);
        pushRecorderAction(session, {
          type: "press",
          locator: "keyboard",
          text: key,
          value: null,
          url: page.url(),
          page_id: getRecorderPageId(page),
          page_title: await resolvePageTitle(page),
          source: "remote-control"
        });
      } else if (type === "scroll") {
        const deltaX = Number(body?.delta_x) || 0;
        const deltaY = Number(body?.delta_y) || 0;
        pushRecorderAction(session, {
          type: "scroll",
          locator: "viewport",
          text: "Scroll",
          value: JSON.stringify({ delta_x: deltaX, delta_y: deltaY }),
          url: page.url(),
          page_id: getRecorderPageId(page),
          page_title: await resolvePageTitle(page),
          source: "remote-control"
        });
        await page.mouse.wheel(deltaX, deltaY);
      } else if (type === "goto") {
        const url = normalizeUrl(body?.url);

        if (!url || !["http:", "https:"].includes(new URL(url).protocol)) {
          reply.code(400);
          return { message: "goto input requires a valid absolute HTTP(S) URL" };
        }
        if (session.remote_inspection) await assertRemoteInspectionUrl(url);

        pushRecorderAction(session, {
          type: "navigation",
          locator: "location",
          text: url,
          value: null,
          url,
          page_id: getRecorderPageId(page),
          page_title: await resolvePageTitle(page),
          source: "remote-control"
        });
        void page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        }).catch((error) => {
          app.log.warn({ error, sessionId: session.id, url }, "Recorder URL navigation failed");
        });
      } else {
        reply.code(400);
        return { message: "Unsupported recorder input type" };
      }

      return {
        ok: true,
        action_count: session.actions.length,
        network_count: session.network.length
      };
    } catch (error) {
      reply.code(409);
      return {
        message: error instanceof Error ? error.message : "Recorder input failed"
      };
    }
  });

  app.post("/api/v1/recorder/sessions", async (request, reply) => {
    const body = request.body as { start_url?: string | null; reuse_existing?: boolean; purpose?: "automation-recording" | "repository-inspect" | null; recorder_mode?: "local" | "remote"; test_case?: unknown } | null;
    const startUrl = normalizeUrl(body?.start_url);
    const purpose = body?.purpose === "repository-inspect" ? "repository-inspect" : body?.purpose === "automation-recording" ? "automation-recording" : null;
    const remoteInspection = purpose === "repository-inspect" && !agentToken;
    if (body?.start_url && !startUrl) { reply.code(400); return { code: "INSPECTION_URL_INVALID", message: "Enter a valid HTTP(S) URL." }; }
    if (startUrl) {
      try {
        const parsed = new URL(startUrl);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new InspectionTargetError("INSPECTION_URL_INVALID", "Enter an HTTP(S) URL without credentials.");
        if (remoteInspection) await assertRemoteInspectionUrl(startUrl);
      } catch (error) {
        const targetError = error instanceof InspectionTargetError ? error : null;
        app.log.warn({ code: targetError?.code || "INSPECTION_URL_INVALID", target_host: new URL(startUrl).hostname, mode: remoteInspection ? "remote" : "local" }, "Inspection destination could not be opened");
        reply.code(targetError?.statusCode || 400);
        return { code: targetError?.code || "INSPECTION_URL_INVALID", message: error instanceof Error ? error.message : "Invalid inspection URL", retryable: targetError?.retryable || false };
      }
    }
    const reusableSession = purpose !== "repository-inspect" && body?.reuse_existing === true
      ? [...sessions.values()]
        .filter((session) => session.status === "running" && (!purpose || session.purpose === purpose))
        .sort((left, right) => Date.parse(right.last_activity_at) - Date.parse(left.last_activity_at))[0]
      : null;

    if (reusableSession) {
      reusableSession.actions.length = 0;
      reusableSession.network.length = 0;
      reusableSession.paused = false;
      reusableSession.error = null;
      reusableSession.start_url = startUrl || reusableSession.start_url;
      for (const key of inspectResults.keys()) {
        if (key.startsWith(`${reusableSession.id}:`)) {
          inspectResults.delete(key);
        }
      }
      touchSession(reusableSession);

      if (startUrl) {
        const page = await resolveActivePage(reusableSession).catch(() => null);
        const currentUrl = page?.url() || "";
        const hasOpenDestination = Boolean(currentUrl && currentUrl !== "about:blank" && !currentUrl.startsWith("chrome://newtab"));
        if (page && !hasOpenDestination) {
          void page.goto(startUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
          }).catch((error) => {
            app.log.warn({ error, sessionId: reusableSession.id, startUrl }, "Reused recorder start URL navigation failed");
          });
        }
      }

      return {
        ...serializeSession(reusableSession, { includeLiveViewPath: true }),
        reused: true
      };
    }

    if (purpose === "repository-inspect") {
      const limit = Math.max(1, Number.parseInt(process.env.RECORDER_MAX_INSPECTION_SESSIONS || "6", 10) || 6);
      if ([...sessions.values()].filter(session => session.status === "running" && session.purpose === purpose).length + inspectionSessionsStarting >= limit) {
        reply.code(429); return { message: "This Test Engine is at its inspection browser limit. Close an existing browser or try again shortly." };
      }
      inspectionSessionsStarting += 1;
      for (const [id, previous] of sessions) {
        if (previous.purpose === purpose && previous.status !== "running") {
          sessions.delete(id);
          for (const key of inspectResults.keys()) if (key.startsWith(`${id}:`)) inspectResults.delete(key);
        }
      }
    }
    const id = randomUUID();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), `hellotest-recorder-${id}-`)).catch(error => {
      if (purpose === "repository-inspect") inspectionSessionsStarting -= 1;
      throw error;
    });
    const headless = resolveHeadlessMode();

    let context: BrowserContext | null = null;
    let recorderExtensionDir: string | null = null;
    let inspectionProxy: Awaited<ReturnType<typeof createInspectionProxy>> | null = null;

    try {
      if (!headless && process.env.RECORDER_DISABLE_EXTENSION !== "true") {
        recorderExtensionDir = await createRecorderExtension(userDataDir).catch((error) => {
          app.log.warn({ error, sessionId: id }, "Unable to prepare recorder extension; falling back to init script");
          return null;
        });
      }

      const launchArgs = [
        "--start-maximized",
        "--disable-background-networking",
        "--disable-default-apps"
      ];

      if (recorderExtensionDir) {
        launchArgs.push(`--disable-extensions-except=${recorderExtensionDir}`);
        launchArgs.push(`--load-extension=${recorderExtensionDir}`);
      }

      if (remoteInspection) inspectionProxy = await createInspectionProxy();
      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        ignoreHTTPSErrors: true,
        viewport: headless ? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } : null,
        args: remoteInspection ? [...launchArgs, "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] : launchArgs,
        ...(inspectionProxy ? { proxy: { server: inspectionProxy.server, bypass: "<-loopback>" }, serviceWorkers: "block" as const } : {})
      });

      const capture = {
        actions: true,
        network: true,
        duplicate_typing_suppression: true,
        injection: recorderExtensionDir ? "chrome-extension + playwright-init-script" : "playwright-init-script",
        extension_ready: Boolean(recorderExtensionDir),
        remote_control: true,
        screenshot_stream: false,
        screencast_stream: true
      };

      const session: RecorderSession = {
        id,
        purpose,
        status: "running",
        paused: false,
        started_at: new Date().toISOString(),
        stopped_at: null,
        start_url: startUrl,
        user_data_dir: userDataDir,
        live_token: randomUUID(),
        remote_inspection: remoteInspection,
        inspection_proxy: inspectionProxy,
        display_mode: headless ? "browser-live-view" : "local-browser-with-live-view",
        last_activity_at: new Date().toISOString(),
        context,
        actions: [],
        network: [],
        error: null,
        capture
      };

      await context.exposeBinding("__hellotestRecorderEmit", async (source, event: unknown) => {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          return;
        }

        const payload = event as Record<string, unknown>;
        const type = normalizeText(payload.type) || "click";
        const normalizedType = RECORDER_ACTION_TYPES.has(type as RecorderAction["type"]) ? type as RecorderAction["type"] : "click";
        const sourcePage = source.page || null;

        pushRecorderAction(session, {
          type: normalizedType,
          locator: normalizeText(payload.locator),
          text: normalizeText(payload.text),
          value: ["fill", "change", "upload", "select", "check", "uncheck", "press", "tab", "scroll"].includes(normalizedType) ? normalizeText(payload.value) : null,
          url: normalizeText(payload.url) || sourcePage?.url() || null,
          page_id: getRecorderPageId(sourcePage),
          page_title: await resolvePageTitle(sourcePage),
          x: normalizePositiveNumber(payload.x),
          y: normalizePositiveNumber(payload.y),
          source: normalizeText(payload.source) === "page-recorder" ? "page-recorder" : "browser",
          timestamp: normalizeText(payload.timestamp) || new Date().toISOString()
        });
      });
      await context.addInitScript(recorderInitScript);
      context.on("page", (page) => attachPageCapture(session, page, app.log));

      const page = context.pages()[0] || await context.newPage();
      attachPageCapture(session, page, app.log);
      sessions.set(id, session);

      if (startUrl) {
        void page.goto(startUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000
        }).catch((error) => {
          app.log.warn({ error, sessionId: id, startUrl }, "Recorder start URL navigation failed");
        });
      }

      reply.code(202);
      return {
        id,
        purpose,
        status: session.status,
        paused: session.paused,
        started_at: session.started_at,
        last_activity_at: session.last_activity_at,
        start_url: startUrl,
        display_mode: session.display_mode,
        live_view_path: buildLiveViewPath(session),
        action_count: session.actions.length,
        network_count: session.network.length,
        capture
      };
    } catch (error) {
      await context?.close().catch(() => undefined);
      await inspectionProxy?.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
      const failure = buildBrowserUnavailableResponse(error);
      reply.code(failure.code === "RECORDER_START_FAILED" ? 500 : 503);
      return {
        ...failure,
        recoverable: true
      };
    } finally {
      if (purpose === "repository-inspect") inspectionSessionsStarting -= 1;
    }
  });

  app.post("/api/v1/recorder/sessions/:id/stop", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    await stopSession(session);
    return serializeSession(session);
  });

  app.post("/api/v1/recorder/sessions/:id/pause", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Only a running recorder session can be paused" };
    }

    session.paused = true;
    touchSession(session);
    app.log.info({ sessionId: session.id }, "Recorder capture paused");
    return serializeSession(session);
  });

  app.post("/api/v1/recorder/sessions/:id/resume", async (request, reply) => {
    const params = request.params as { id: string };
    const session = sessions.get(params.id);

    if (!session) {
      reply.code(404);
      return { message: "Recorder session not found" };
    }

    if (session.status !== "running") {
      reply.code(409);
      return { message: "Only a running recorder session can be resumed" };
    }

    session.paused = false;
    touchSession(session);
    app.log.info({ sessionId: session.id }, "Recorder capture resumed");
    return serializeSession(session);
  });
};
