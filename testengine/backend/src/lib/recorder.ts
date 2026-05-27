import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Request } from "playwright";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";

type RecorderAction = {
  index: number;
  type:
    | "click"
    | "dblclick"
    | "rightclick"
    | "fill"
    | "change"
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
  started_at: string;
  stopped_at: string | null;
  start_url: string | null;
  user_data_dir: string;
  live_token: string;
  display_mode: "browser-live-view" | "local-browser-with-live-view";
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
  element: {
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
    }>;
    text: string | null;
    rect?: { x: number; y: number; width: number; height: number } | null;
    ancestor_rect?: { x: number; y: number; width: number; height: number } | null;
  };
};

const sessions = new Map<string, RecorderSession>();
const inspectResults = new Map<string, RecorderInspectResult>();
const RECORDER_ACTION_TYPES = new Set<RecorderAction["type"]>([
  "click",
  "dblclick",
  "rightclick",
  "fill",
  "change",
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
      message: "The Test Engine could not find its managed Chromium browser. Run the Playwright Test Engine container or install the Playwright browsers on the engine host; QAira frontend users do not need Chrome or Playwright locally.",
      detail: message
    };
  }

  if (lowerMessage.includes("headed browser") || lowerMessage.includes("xserver") || lowerMessage.includes("display")) {
    return {
      code: "RECORDER_DISPLAY_UNAVAILABLE",
      message: "The Test Engine cannot open a physical browser window on this host. Keep RECORDER_HEADLESS enabled and use the QAira live recorder view from the frontend.",
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

const pushRecorderAction = (
  session: RecorderSession,
  action: Omit<RecorderAction, "index" | "timestamp"> & Partial<Pick<RecorderAction, "index" | "timestamp">>
) => {
  const actionType = String(action.type || "").toLowerCase();
  const actionLocator = normalizeText(action.locator);
  const actionPageId = normalizeText(action.page_id);
  const actionTimestamp = action.timestamp || new Date().toISOString();

  if ((actionType === "fill" || actionType === "change" || actionType === "select" || actionType === "check" || actionType === "uncheck") && actionLocator) {
    const recentEditableAction = [...session.actions].reverse().find((candidate) => {
      const candidateType = String(candidate.type || "").toLowerCase();
      const candidateTime = Date.parse(candidate.timestamp || "");
      const nextTime = Date.parse(actionTimestamp);

      return (candidateType === "fill" || candidateType === "change" || candidateType === "select" || candidateType === "check" || candidateType === "uncheck")
        && candidate.locator === actionLocator
        && (!actionPageId || !candidate.page_id || candidate.page_id === actionPageId)
        && (!Number.isFinite(candidateTime) || !Number.isFinite(nextTime) || Math.abs(nextTime - candidateTime) <= 12_000);
    });

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
    index: action.index || session.actions.length + 1,
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
  if (window.__qairaRecorderInstalled) return;
  window.__qairaRecorderInstalled = true;

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
    const testId = attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-qa");
    if (testId) return "[data-testid=\\"" + testId.replaceAll('"', "\\\\\\"") + "\\"]";
    const aria = attr(element, "aria-label");
    if (aria) return "[aria-label=\\"" + aria.replaceAll('"', "\\\\\\"") + "\\"]";
    const id = attr(element, "id");
    if (id) return "#" + cssEscape(id);
    const name = attr(element, "name");
    if (name) return element.tagName.toLowerCase() + "[name=\\"" + name.replaceAll('"', "\\\\\\"") + "\\"]";
    const placeholder = attr(element, "placeholder");
    if (placeholder) return "placeholder=" + placeholder;
    const label = element.labels && element.labels[0] ? clean(element.labels[0].innerText || element.labels[0].textContent || "") : "";
    if (label) return "label=" + label;
    const role = attr(element, "role");
    const text = visibleText(element);
    if ((role || ["button", "a"].includes(element.tagName.toLowerCase())) && text) return "text=" + text;
    if (text && text.length <= 80) return "text=" + text;
    return cssPath(element);
  };
  window.__qairaRecorderLocatorFor = locatorFor;
  window.__qairaRecorderVisibleTextFor = visibleText;
  const emit = (event) => {
    if (typeof window.__qairaRecorderEmit === "function") {
      window.__qairaRecorderEmit({
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
  if (document.documentElement?.dataset.qairaRecorderExtension === "loaded") return;
  if (document.documentElement) {
    document.documentElement.dataset.qairaRecorderExtension = "loaded";
  }
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-recorder.js");
  script.async = false;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();
`;

const createRecorderExtension = async (userDataDir: string) => {
  const extensionDir = path.join(userDataDir, "qaira-recorder-extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    path.join(extensionDir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        name: "QAira Recorder",
        version: "1.0.0",
        description: "Captures browser actions and API calls for QAira automation authoring sessions.",
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
    if (!isUsefulNetworkRequest(request)) {
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
    if (!isUsefulNetworkRequest(request)) {
      return;
    }

    void (async () => {
      const requestPage = resolveRequestPage(request);

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
  const page = session.context.pages().filter((candidate) => !candidate.isClosed()).at(-1);
  return page || session.context.newPage();
};

const resolveRecorderPage = async (session: RecorderSession, pageId?: string | null) => {
  const pages = session.context.pages().filter((candidate) => !candidate.isClosed());

  if (pageId) {
    const match = pages.find((page) => getRecorderPageId(page) === pageId);
    if (match) {
      return match;
    }
  }

  return pages.at(-1) || session.context.newPage();
};

const serializeRecorderPage = async (page: Page) => ({
  id: getRecorderPageId(page),
  title: await resolvePageTitle(page),
  url: page.url()
});

const installInspectMode = async (page: Page) => {
  await page.evaluate(() => {
    const inspectWindow = window as typeof window & {
      __qairaInspectCleanup?: () => void;
      __qairaInspectResult?: unknown;
      __qairaRecorderLocatorFor?: (element: Element | null) => string | null;
      __qairaRecorderVisibleTextFor?: (element: Element | null) => string | null;
    };

    inspectWindow.__qairaInspectCleanup?.();
    inspectWindow.__qairaInspectResult = null;

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
        || inspectWindow.__qairaRecorderVisibleTextFor?.(element)
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
      const testId = clean(element.getAttribute("data-testid"));
      const aria = clean(element.getAttribute("aria-label"));
      const explicitRole = clean(element.getAttribute("role"));
      const accessibleName = aria || clean(inspectWindow.__qairaRecorderVisibleTextFor?.(element));
      const id = clean(element.getAttribute("id"));
      const name = clean(element.getAttribute("name"));
      const placeholder = clean(element.getAttribute("placeholder"));
      const text = inspectWindow.__qairaRecorderVisibleTextFor?.(element);
      const tag = element.tagName.toLowerCase();
      const inputType = clean(element.getAttribute("type")).toLowerCase();
      const semanticRole = explicitRole
        || (tag === "button" ? "button" : "")
        || (tag === "a" ? "link" : "")
        || (tag === "select" ? "combobox" : "")
        || (tag === "textarea" || (tag === "input" && !["checkbox", "radio"].includes(inputType)) ? "textbox" : "")
        || (tag === "input" && ["checkbox", "radio"].includes(inputType) ? inputType : "");
      return [
        testId ? { locator: `[data-testid="${testId.replace(/"/g, '\\"')}"]`, strategy: "data-testid", confidenceScore: 0.98 } : null,
        aria ? { locator: `${tag}[aria-label="${aria.replace(/"/g, '\\"')}"]`, strategy: "aria-label", confidenceScore: 0.94 } : null,
        semanticRole && accessibleName ? { locator: `role=${semanticRole}[name="${accessibleName.replace(/"/g, '\\"')}"]`, strategy: "role + name", confidenceScore: 0.92 } : null,
        id ? { locator: `#${cssEscape(id)}`, strategy: "stable id", confidenceScore: 0.88 } : null,
        name ? { locator: `${tag}[name="${name.replace(/"/g, '\\"')}"]`, strategy: "name attribute", confidenceScore: 0.84 } : null,
        placeholder ? { locator: `${tag}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`, strategy: "placeholder", confidenceScore: 0.78 } : null,
        text && ["button", "a"].includes(tag) ? { locator: `text=${text}`, strategy: "text", confidenceScore: 0.7 } : null,
        { locator: inspectWindow.__qairaRecorderLocatorFor?.(element) || tag, strategy: "css", confidenceScore: 0.55 }
      ].filter((candidate): candidate is { locator: string; strategy: string; confidenceScore: number } => Boolean(candidate))
        .filter((candidate, index, candidates) => candidates.findIndex((other) => other.locator === candidate.locator) === index);
    };
    const clearHighlight = () => {
      document.querySelectorAll("[data-qaira-inspect-highlight='true']").forEach((node) => {
        const target = node as HTMLElement;
        const isSelected = target.dataset.qairaRepositoryHighlight === "true";
        target.style.outline = isSelected ? "3px solid #2f6df6" : target.dataset.qairaPreviousOutline || "";
        target.style.boxShadow = isSelected ? "0 0 0 6px rgba(47, 109, 246, 0.2)" : target.dataset.qairaPreviousBoxShadow || "";
        delete target.dataset.qairaPreviousOutline;
        delete target.dataset.qairaPreviousBoxShadow;
        delete target.dataset.qairaInspectHighlight;
      });
    };
    const highlight = (element: Element) => {
      if (!(element instanceof HTMLElement)) return;
      clearHighlight();
      element.dataset.qairaPreviousOutline = element.style.outline || "";
      element.dataset.qairaPreviousBoxShadow = element.style.boxShadow || "";
      element.dataset.qairaInspectHighlight = "true";
      element.style.outline = "3px solid #2f6df6";
      element.style.boxShadow = "0 0 0 6px rgba(47, 109, 246, 0.22)";
      element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    };
    let lockedElement: Element | null = null;
    const candidateElement = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest("input,button,select,textarea,a,[role],label,[data-testid]") || target
        : null;
    const hoverHandler = (event: MouseEvent) => {
      if (lockedElement) return;
      const element = candidateElement(event.target);
      if (element) highlight(element);
    };
    const handler = (event: MouseEvent) => {
      const element = candidateElement(event.target);
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
      lockedElement = element;
      highlight(element);
      inspectWindow.__qairaInspectResult = {
        friendly_name: friendlyName(element),
        html_tag: tag,
        role,
        locator,
        locator_kind: candidates[0].strategy,
        locator_candidates: candidates,
        dom_structure: domStructure,
        ancestor_dom: ancestorDom,
        text: inspectWindow.__qairaRecorderVisibleTextFor?.(element) || clean(element.textContent).slice(0, 200),
        rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
        ancestor_rect: ancestorRect ? { x: ancestorRect.x + window.scrollX, y: ancestorRect.y + window.scrollY, width: ancestorRect.width, height: ancestorRect.height } : null
      };
    };

    document.addEventListener("mousemove", hoverHandler, true);
    document.addEventListener("click", handler, true);
    inspectWindow.__qairaInspectCleanup = () => {
      document.removeEventListener("mousemove", hoverHandler, true);
      document.removeEventListener("click", handler, true);
      clearHighlight();
    };
  });
};

const highlightRepositoryElement = async (page: Page, locator: string, label?: string | null, retainExisting = false) =>
  page.evaluate(({ targetLocator, targetLabel, keepExisting }) => {
    const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
    const clearHighlight = () => {
      document.querySelectorAll("[data-qaira-repository-highlight='true']").forEach((node) => {
        const element = node as HTMLElement;
        element.style.outline = element.dataset.qairaRepositoryPreviousOutline || "";
        element.style.boxShadow = element.dataset.qairaRepositoryPreviousBoxShadow || "";
        delete element.dataset.qairaRepositoryPreviousOutline;
        delete element.dataset.qairaRepositoryPreviousBoxShadow;
        delete element.dataset.qairaRepositoryHighlight;
      });
      document.getElementById("__qairaRepositoryHighlightLabel")?.remove();
    };
    const resolveTarget = () => {
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

    if (element.dataset.qairaRepositoryHighlight !== "true") {
      element.dataset.qairaRepositoryPreviousOutline = element.dataset.qairaPreviousOutline || element.style.outline || "";
      element.dataset.qairaRepositoryPreviousBoxShadow = element.dataset.qairaPreviousBoxShadow || element.style.boxShadow || "";
    }
    element.dataset.qairaRepositoryHighlight = "true";
    element.style.outline = "3px solid #2f6df6";
    element.style.boxShadow = "0 0 0 6px rgba(47, 109, 246, 0.2)";
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });

    if (!keepExisting) {
      const badge = document.createElement("div");
      badge.id = "__qairaRepositoryHighlightLabel";
      badge.textContent = targetLabel || targetLocator;
      badge.style.cssText = "position:fixed;z-index:2147483647;padding:5px 9px;border-radius:6px;background:#2f6df6;color:#fff;font:600 12px system-ui;pointer-events:none;box-shadow:0 6px 15px rgba(15,23,42,.2)";
      const rect = element.getBoundingClientRect();
      badge.style.left = `${Math.max(8, rect.left)}px`;
      badge.style.top = `${Math.max(8, rect.top - 32)}px`;
      document.body.appendChild(badge);
    }

    return { found: true, locator: targetLocator, tag: element.tagName.toLowerCase() };
  }, { targetLocator: locator, targetLabel: label || null, keepExisting: retainExisting });

const clearRepositoryHighlights = async (page: Page) =>
  page.evaluate(() => {
    document.querySelectorAll("[data-qaira-repository-highlight='true']").forEach((node) => {
      const element = node as HTMLElement;
      element.style.outline = element.dataset.qairaRepositoryPreviousOutline || "";
      element.style.boxShadow = element.dataset.qairaRepositoryPreviousBoxShadow || "";
      delete element.dataset.qairaRepositoryPreviousOutline;
      delete element.dataset.qairaRepositoryPreviousBoxShadow;
      delete element.dataset.qairaRepositoryHighlight;
    });
    document.getElementById("__qairaRepositoryHighlightLabel")?.remove();
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
          __qairaRecorderLocatorFor?: (element: Element | null) => string | null;
          __qairaRecorderVisibleTextFor?: (element: Element | null) => string | null;
        };
        const locator =
          typeof recorderWindow.__qairaRecorderLocatorFor === "function"
            ? recorderWindow.__qairaRecorderLocatorFor(element)
            : null;
        const text =
          typeof recorderWindow.__qairaRecorderVisibleTextFor === "function"
            ? recorderWindow.__qairaRecorderVisibleTextFor(element)
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
  const header = request.headers["x-qaira-recorder-token"];
  return normalizeText(query?.token)
    || normalizeText(Array.isArray(header) ? header[0] : header)
    || null;
};

const requireRecorderToken = (request: FastifyRequest, session: RecorderSession) =>
  readRecorderToken(request) === session.live_token;

const renderLiveViewHtml = (session: RecorderSession) => {
  const sessionId = JSON.stringify(session.id);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QAira Recorder</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8f6;
      color: #202421;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr);
      background: #f7f8f6;
    }
    header,
    .toolbar,
    .inputbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #dfe4dc;
      background: #ffffff;
    }
    header {
      justify-content: space-between;
    }
    strong {
      font-size: 14px;
      line-height: 1.2;
    }
    .meta {
      color: #667066;
      font-size: 12px;
    }
    .toolbar,
    .inputbar {
      flex-wrap: wrap;
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
      padding: 9px 13px;
      font: inherit;
      font-weight: 700;
      color: #fff;
      background: #b55233;
      cursor: pointer;
    }
    button.secondary {
      color: #8d3f27;
      background: rgba(181, 82, 51, 0.1);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }
    main {
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      background: #1e221f;
    }
    .viewport {
      min-height: 0;
      overflow: auto;
      display: grid;
      place-items: center;
      padding: 12px;
      position: relative;
    }
    #screen {
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
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
      width: 22px;
      height: 22px;
      margin: -11px 0 0 -11px;
      border: 2px solid #f4ad55;
      border-radius: 999px;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.7);
      transition: opacity 180ms ease, transform 180ms ease;
      z-index: 5;
    }
    .click-marker.is-visible {
      opacity: 1;
      transform: scale(1);
    }
    .inputbar {
      background: #ffffff;
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
      .toolbar,
      .inputbar {
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
    }
    @media (max-width: 720px) {
      body {
        grid-template-rows: auto auto auto minmax(58vh, 1fr);
      }
      header,
      .toolbar,
      .inputbar {
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
      .viewport {
        justify-content: start;
        align-content: start;
      }
      #screen {
        max-width: none;
      }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>QAira live recorder</strong>
      <div class="meta">Session ${session.id.slice(0, 8)} · ${session.display_mode.replace(/-/g, " ")}</div>
    </div>
    <span class="status"><span class="dot"></span><span id="statusText">Connecting</span></span>
  </header>
  <div class="toolbar">
    <input id="address" autocomplete="off" placeholder="Open URL in recorder browser" />
    <button id="goButton" type="button">Go</button>
    <button class="secondary" data-key="Enter" type="button">Enter</button>
    <button class="secondary" data-key="Tab" type="button">Tab</button>
    <button class="secondary" data-key="Escape" type="button">Esc</button>
    <button class="secondary" data-key="Backspace" type="button">Backspace</button>
  </div>
  <div class="inputbar">
    <input id="textInput" autocomplete="off" placeholder="Text to type into the focused field" />
    <button id="typeButton" type="button">Type</button>
    <span class="status" id="dimensionText"></span>
  </div>
  <main>
    <div class="viewport">
      <canvas id="screen" aria-label="Recorder browser viewport" role="img" tabindex="0"></canvas>
      <span class="click-marker" id="clickMarker"></span>
    </div>
  </main>
  <script>
    const sessionId = ${sessionId};
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const screen = document.getElementById("screen");
    const screenContext = screen.getContext("2d", { alpha: false });
    const clickMarker = document.getElementById("clickMarker");
    const statusText = document.getElementById("statusText");
    const dimensionText = document.getElementById("dimensionText");
    const address = document.getElementById("address");
    const textInput = document.getElementById("textInput");
    let pendingInputs = 0;
    let wheelTimer = null;
    let wheelDeltaX = 0;
    let wheelDeltaY = 0;
    let frameSequence = 0;
    let clickMarkerTimer = null;

    const withToken = (path) => path + "?token=" + encodeURIComponent(token);
    const streamUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/stream");
    const inputUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/input");

    const setStatus = (text, isError = false) => {
      statusText.textContent = text;
      statusText.classList.toggle("error", Boolean(isError));
    };

    const markInputStarted = () => {
      pendingInputs += 1;
      setStatus("Sending");
    };

    const markInputFinished = () => {
      pendingInputs = Math.max(0, pendingInputs - 1);
      if (!pendingInputs) {
        setStatus("Live");
      }
    };

    const send = async (payload) => {
      if (!token) return;
      markInputStarted();

      try {
        const response = await fetch(inputUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-QAira-Recorder-Token": token },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || "Recorder input failed");
        }

        markInputFinished();
      } catch (error) {
        pendingInputs = Math.max(0, pendingInputs - 1);
        setStatus(error instanceof Error ? error.message : "Input failed", true);
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
        }

        screenContext.drawImage(image, 0, 0, screen.width || image.width, screen.height || image.height);
        dimensionText.textContent = screen.width && screen.height ? screen.width + " x " + screen.height : "";

        if (!pendingInputs) {
          setStatus("Live");
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
        setStatus("Live");
      });

      source.addEventListener("ready", () => {
        setStatus("Live");
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

    document.getElementById("goButton").addEventListener("click", () => {
      send({ type: "goto", url: address.value });
    });

    address.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        send({ type: "goto", url: address.value });
      }
    });

    document.getElementById("typeButton").addEventListener("click", () => {
      send({ type: "type", text: textInput.value });
      textInput.value = "";
    });

    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send({ type: "type", text: textInput.value });
        textInput.value = "";
      }
    });

    document.querySelectorAll("[data-key]").forEach((button) => {
      button.addEventListener("click", () => send({ type: "press", key: button.getAttribute("data-key") }));
    });

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
  await rm(session.user_data_dir, { recursive: true, force: true }).catch(() => undefined);
};

const stopOrphanedSessions = async (logger: FastifyBaseLogger) => {
  const now = Date.now();

  for (const session of sessions.values()) {
    if (session.status !== "running") {
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
  const cleanupTimer = setInterval(() => {
    void stopOrphanedSessions(app.log);
  }, RECORDER_CLEANUP_INTERVAL_MS);

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
  });

  app.get("/api/v1/recorder/sessions", async () => ({
    items: [...sessions.values()].map((session) => serializeSession(session))
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
      const cached = inspectResults.get(cacheKey);

      if (cached) {
        return cached;
      }

      const element = await page.evaluate(() => {
        const inspectWindow = window as typeof window & {
          __qairaInspectResult?: unknown;
        };
        return inspectWindow.__qairaInspectResult || null;
      }).catch(() => null) as RecorderInspectResult["element"] | null;

      if (!element) {
        reply.code(204);
        return "";
      }

      const [pageTitle, screenDom, accessibilityTree, screenshot] = await Promise.all([
        resolvePageTitle(page),
        page.evaluate(() => {
          const source = document.documentElement;
          if (!source) return "";
          const cloned = source.cloneNode(true) as HTMLElement;
          cloned.querySelectorAll("[data-qaira-inspect-highlight='true']").forEach((node) => {
            const target = node as HTMLElement;
            target.style.outline = target.dataset.qairaPreviousOutline || "";
            target.style.boxShadow = target.dataset.qairaPreviousBoxShadow || "";
            delete target.dataset.qairaPreviousOutline;
            delete target.dataset.qairaPreviousBoxShadow;
            delete target.dataset.qairaInspectHighlight;
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
      const screenshotClip = async (rect: RecorderInspectResult["element"]["rect"]) => {
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
      const [elementScreenshot, ancestorScreenshot] = await Promise.all([
        screenshotClip(element.rect),
        screenshotClip(element.ancestor_rect)
      ]);

      const result: RecorderInspectResult = {
        captured_at: new Date().toISOString(),
        page_id: pageId,
        page_title: pageTitle,
        page_url: page.url(),
        screen_dom: screenDom || null,
        accessibility_tree: accessibilityTree || null,
        screen_fingerprint: createHash("sha256").update(`${page.url()}\n${screenDom}`).digest("hex"),
        screen_screenshot_url: screenshot ? `data:image/jpeg;base64,${screenshot.toString("base64")}` : null,
        element_screenshot_url: elementScreenshot ? `data:image/jpeg;base64,${elementScreenshot.toString("base64")}` : null,
        ancestor_screenshot_url: ancestorScreenshot ? `data:image/jpeg;base64,${ancestorScreenshot.toString("base64")}` : null,
        element
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
      const page = await resolveActivePage(session);
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
      const page = await resolveActivePage(session);
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
      const page = await resolveActivePage(session);
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
        void enrichRemoteClickAction(session, page, action.index, x, y, app.log);
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

        if (!url) {
          reply.code(400);
          return { message: "goto input requires a valid absolute URL" };
        }

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
    const body = request.body as { start_url?: string | null; reuse_existing?: boolean; purpose?: "automation-recording" | "repository-inspect" | null; test_case?: unknown } | null;
    const startUrl = normalizeUrl(body?.start_url);
    const purpose = body?.purpose === "repository-inspect" ? "repository-inspect" : body?.purpose === "automation-recording" ? "automation-recording" : null;
    const reusableSession = body?.reuse_existing === true
      ? [...sessions.values()]
        .filter((session) => session.status === "running" && (!purpose || session.purpose === purpose))
        .sort((left, right) => Date.parse(right.last_activity_at) - Date.parse(left.last_activity_at))[0]
      : null;

    if (reusableSession) {
      reusableSession.actions.length = 0;
      reusableSession.network.length = 0;
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

    const id = randomUUID();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), `qaira-recorder-${id}-`));
    const headless = resolveHeadlessMode();

    let context: BrowserContext | null = null;
    let recorderExtensionDir: string | null = null;

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

      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        ignoreHTTPSErrors: true,
        viewport: headless ? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } : null,
        args: launchArgs
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
        started_at: new Date().toISOString(),
        stopped_at: null,
        start_url: startUrl,
        user_data_dir: userDataDir,
        live_token: randomUUID(),
        display_mode: headless ? "browser-live-view" : "local-browser-with-live-view",
        last_activity_at: new Date().toISOString(),
        context,
        actions: [],
        network: [],
        error: null,
        capture
      };

      await context.exposeBinding("__qairaRecorderEmit", async (source, event: unknown) => {
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
          value: ["fill", "change", "select", "check", "uncheck", "press", "tab", "scroll"].includes(normalizedType) ? normalizeText(payload.value) : null,
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
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
      const failure = buildBrowserUnavailableResponse(error);
      reply.code(failure.code === "RECORDER_START_FAILED" ? 500 : 503);
      return {
        ...failure,
        recoverable: true
      };
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
};
