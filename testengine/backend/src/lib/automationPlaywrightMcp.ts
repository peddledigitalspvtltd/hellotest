import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createConnection } from "@playwright/mcp";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { createInspectionProxy } from "./inspectionProxy.js";
import { resolveRemoteInspectionEndpoint } from "./inspectionSecurity.js";
import { normalizeAutomationAssertionTimeoutMs, validAutomationAssertionTimeoutMs } from "./automationAssertionPolicy.js";
import { normalizeAutomationNavigationTimeoutMs, validAutomationNavigationTimeoutMs } from "./automationNavigationPolicy.js";
import { installAutomationNavigationGuard, reserveAutomationDebuggingPort } from "./automationNavigationGuard.js";

export const PLAYWRIGHT_MCP_ENDPOINT = "/api/v1/automation/playwright-mcp";
export const AUTOMATION_PLAYWRIGHT_VERSION = "1.65.0-alpha-2026-10-30";
export const PLAYWRIGHT_MCP_RUNTIME = Object.freeze({
  provider: "@playwright/mcp", version: "0.0.84", endpoint: PLAYWRIGHT_MCP_ENDPOINT,
  transport: "streamable-http-json", codegen: "typescript", playwright_version: AUTOMATION_PLAYWRIGHT_VERSION
});

type NativeConfig = NonNullable<Parameters<typeof createConnection>[0]>;
type NativeContext = Awaited<ReturnType<NonNullable<Parameters<typeof createConnection>[1]>>>;
type NativeBrowser = NonNullable<ReturnType<NativeContext["browser"]>>;
type NativeServer = Awaited<ReturnType<typeof createConnection>>;
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown; _meta?: Record<string, unknown> };
type Pending = { resolve: (response: Rpc) => void; reject: (error: Error) => void };

/** Only a transport: validation, tool schemas, refs, snapshots, generated code,
 * assertions and tool results belong entirely to microsoft/playwright-mcp. */
class NativeTransport {
  onmessage?: (message: Rpc) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private pending = new Map<string | number, Pending>();
  private closed = false;
  async start() {}
  async send(message: Rpc) {
    if (message.id !== undefined && message.id !== null && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      pending?.resolve(message);
    } else if (message.method && message.id !== undefined && message.id !== null) {
      // The trusted host does not offer elicitation/sampling or filesystem roots.
      this.onmessage?.({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method is unavailable" } });
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("Playwright MCP session closed"));
    this.pending.clear();
    this.onclose?.();
  }
  receive(message: Rpc): Promise<Rpc | undefined> {
    if (this.closed) return Promise.reject(new Error("Playwright MCP session closed"));
    if (message.id === undefined) {
      this.onmessage?.(message);
      return Promise.resolve(undefined);
    }
    if (message.id === null || this.pending.has(message.id)) return Promise.reject(new Error("Invalid or duplicate request id"));
    return new Promise((resolve, reject) => {
      this.pending.set(message.id as string | number, { resolve, reject });
      try { this.onmessage?.(message); }
      catch (cause) { this.pending.delete(message.id as string | number); reject(cause); }
    });
  }
}

export type PlaywrightMcpDependencies = {
  createConnection?: typeof createConnection;
  launchBrowser?: (options: NonNullable<NativeConfig["browser"]>["launchOptions"]) => Promise<NativeBrowser>;
  createProxy?: typeof createInspectionProxy;
  validateTarget?: typeof resolveRemoteInspectionEndpoint;
  toolTimeoutMs?: number;
  sessionTtlMs?: number;
  maxSessions?: number;
  /** Trusted loopback relay configuration, never a model argument. */
  pairedLocal?: boolean;
  headless?: boolean;
};
type Session = {
  server: NativeServer; transport: NativeTransport; proxy: Awaited<ReturnType<typeof createInspectionProxy>>;
  outputDir: string; browser?: NativeBrowser; starting?: Promise<NativeContext>;
  busy: boolean; closed: boolean; expires: number; toolTimeout: number;
  capturePreview: boolean; captureModelImages: boolean; secrets: string[]; context?: NativeContext;
  selectedPage?: ReturnType<NativeContext["pages"]>[number];
  navigationGuard?: Awaited<ReturnType<typeof installAutomationNavigationGuard>>;
  browserContextReceipt?: { schema: "hellotest.browser-context.v1"; owned: true; context_mode: "fresh_isolated";
    initial_storage_empty: boolean; storage_state_loaded: false; created_before_navigation: true };
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One masked capture for UI previews and explicitly requested model images.
 * Pixel privacy fails closed; raw upstream screenshots are never substituted. */
async function browserPreview(session: Session, message: Rpc, response: Rpc | undefined) {
  const modelImage = session.captureModelImages && message.params?.name === "browser_take_screenshot";
  if (!session.context || session.closed || message.method !== "tools/call"
    || !record(response?.result) || response.result.isError === true) return;
  const pages = session.context.pages().filter(page => !page.isClosed());
  const content = Array.isArray(response.result.content) ? response.result.content : [];
  const nativeText = content.filter(record).filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text).join("\n");
  // The pinned native formatter identifies the actual selected tab. Never
  // guess the most recently opened page when more than one tab is present.
  const tabs = (message.params?.name === "browser_tabs"
    ? nativeText.match(/(?:^|\n)### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/)?.[1]
    : nativeText.match(/(?:^|\n)### Open tabs\r?\n([\s\S]*?)(?=\r?\n### |$)/)?.[1]) || "";
  const current = tabs.match(/(?:^|\n)- (\d+): \(current\) /);
  if (current) session.selectedPage = pages[Number(current[1])];
  const page = session.selectedPage && pages.includes(session.selectedPage) ? session.selectedPage : pages.length === 1 ? pages[0] : undefined;
  if (!(session.capturePreview || modelImage)) return;
  if (!page) return;
  const masks = page.frames().flatMap(frame => [
    frame.locator('input, textarea, [contenteditable], [data-sensitive]'),
    ...session.secrets.map(secret => frame.getByText(secret, { exact: false }))
  ]);
  const bytes = await page.screenshot({ type: "jpeg", quality: 30, fullPage: false, animations: "disabled", caret: "hide",
    mask: masks, maskColor: "#111111", timeout: 1500 });
  if (session.closed || !bytes.length || bytes.length > 128 * 1024 || !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return;
  const url = new URL(page.url());
  if (!["http:", "https:"].includes(url.protocol)) return;
  const pathIsPrivate = session.secrets.some(secret => url.pathname.includes(secret) || url.pathname.includes(encodeURIComponent(secret)));
  return { tool: message.params?.name, url: url.origin + (pathIsPrivate ? "" : url.pathname), observed_at: new Date().toISOString(),
    content: [{ type: "image", mimeType: "image/jpeg", data: bytes.toString("base64") }] };
}

// Resolve from the pinned upstream package and require Run to use the same
// version. Its public contextGetter hook
// lets us own teardown; createConnection alone does not close its browser.
const upstreamRequire = createRequire(createRequire(import.meta.url).resolve("@playwright/mcp/package.json"));
export function assertAutomationPlaywrightVersions(runVersion: string, upstreamVersion: string) {
  if (runVersion !== AUTOMATION_PLAYWRIGHT_VERSION || upstreamVersion !== AUTOMATION_PLAYWRIGHT_VERSION) {
    throw new Error(`Automation Build and Run require Playwright ${AUTOMATION_PLAYWRIGHT_VERSION}. Reinstall the pinned TestEngine dependencies and browsers.`);
  }
}
const upstreamPlaywright = upstreamRequire("playwright") as { chromium: {
  executablePath(): string; launch: NonNullable<PlaywrightMcpDependencies["launchBrowser"]>
} };
const launchUpstreamBrowser: NonNullable<PlaywrightMcpDependencies["launchBrowser"]> = options =>
  upstreamPlaywright.chromium.launch(options);

const navigationOrigins = (entry: string) => {
  const allowed = new Set([new URL(entry).origin]);
  // Administrator configuration only. Tool arguments cannot expand navigation
  // authority or the inspection proxy's independent private-network policy.
  for (const configured of (process.env.AUTOMATION_NAVIGATION_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)) {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== configured || url.username || url.password) throw new Error("Invalid configured automation navigation origin");
    allowed.add(url.origin);
  }
  return allowed;
};

export async function registerAutomationPlaywrightMcp(app: FastifyInstance, guard: preHandlerHookHandler, dependencies: PlaywrightMcpDependencies = {}) {
  if (!app.hasDecorator("playwrightMcpRuntime")) app.decorate("playwrightMcpRuntime", PLAYWRIGHT_MCP_RUNTIME);
  const sessions = new Map<string, Session>();
  const ttl = dependencies.sessionTtlMs ?? 15 * 60_000;
  const maxSessions = dependencies.maxSessions ?? 2;
  let initializing = 0;
  const close = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.closed = true;
    await Promise.allSettled([session.server.close(), session.browser?.close()]);
    await session.navigationGuard?.close();
    // A browser that finishes launching after cancellation closes in its getter.
    await session.proxy.close().catch(() => undefined);
    await rm(session.outputDir, { recursive: true, force: true }).catch(() => undefined);
  };
  const timer = setInterval(() => {
    for (const [id, session] of sessions) if (!session.busy && session.expires <= Date.now()) void close(id);
  }, Math.min(15_000, Math.max(50, ttl)));
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await Promise.all([...sessions.keys()].map(close)); });
  app.get(PLAYWRIGHT_MCP_ENDPOINT, { preHandler: guard }, async (_request, reply) => reply.header("allow", "POST, DELETE").code(405).send({ message: "Use POST for JSON MCP requests" }));
  app.delete(PLAYWRIGHT_MCP_ENDPOINT, { preHandler: guard }, async (request, reply) => {
    await close(String(request.headers["mcp-session-id"] || ""));
    return reply.code(204).send();
  });
  app.post(PLAYWRIGHT_MCP_ENDPOINT, { preHandler: guard, bodyLimit: 256 * 1024 }, async (request, reply) => {
    const body = request.body;
    if (!record(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string"
      || (body.id !== undefined && typeof body.id !== "string" && typeof body.id !== "number")
      || (body.params !== undefined && !record(body.params))) return rpcError(null, -32600, "Invalid MCP request");
    const message = body as Rpc;
    let id = String(request.headers["mcp-session-id"] || "");
    if (message.method === "initialize") {
      if (message.id === undefined || id) return rpcError(message.id, -32600, "Initialize requires a request id and a fresh session");
      if (sessions.size + initializing >= maxSessions) return reply.code(429).send(rpcError(message.id, -32000, "Automation browser capacity reached. Retry shortly."));
      initializing++;
      let proxy: Session["proxy"] | undefined;
      let outputDir: string | undefined;
      try {
        const meta = record(message.params?._meta) ? message.params?._meta : {};
        const context = record(meta.hellotest) ? meta.hellotest : {};
        if (typeof context.start_url !== "string") throw new Error("A valid HTTP(S) start URL is required");
        if (context.assertion_timeout_ms !== undefined && !validAutomationAssertionTimeoutMs(context.assertion_timeout_ms)) throw new Error("Invalid assertion timeout");
        if (context.navigation_timeout_ms !== undefined && !validAutomationNavigationTimeoutMs(context.navigation_timeout_ms)) throw new Error("Invalid navigation timeout");
        if (context.capture_preview !== undefined && typeof context.capture_preview !== "boolean") throw new Error("Invalid browser preview configuration");
        if (context.capture_model_images !== undefined && typeof context.capture_model_images !== "boolean") throw new Error("Invalid browser model image configuration");
        if (context.secrets !== undefined && (!record(context.secrets) || Object.keys(context.secrets).length > 256
          || Object.entries(context.secrets).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.length > 16_384))) throw new Error("Invalid native secret configuration");
        const pairedPrivateOrigin = dependencies.pairedLocal || process.env.HELLOTEST_INSPECTOR_TOKEN ? new URL(context.start_url).origin : undefined;
        await (dependencies.validateTarget ?? resolveRemoteInspectionEndpoint)(context.start_url, undefined, pairedPrivateOrigin);
        proxy = await (dependencies.createProxy ?? createInspectionProxy)({ pairedPrivateOrigin });
        outputDir = await mkdtemp(join(tmpdir(), "hellotest-playwright-mcp-"));
        const navigation = normalizeAutomationNavigationTimeoutMs(context.navigation_timeout_ms);
        const assertion = normalizeAutomationAssertionTimeoutMs(context.assertion_timeout_ms);
        const allowedOrigins = navigationOrigins(context.start_url);
        assertAutomationPlaywrightVersions(createRequire(import.meta.url)("playwright/package.json").version,
          upstreamRequire("playwright/package.json").version);
        // Never drive Run's older/custom executable with the upstream client.
        // Docker and paired setup install this exact package's browser revision.
        const executablePath = upstreamPlaywright.chromium.executablePath();
        if (!existsSync(executablePath)) throw new Error(`The pinned Playwright ${AUTOMATION_PLAYWRIGHT_VERSION} Chromium is not installed. Run the TestEngine browser setup before building automation.`);
        const launchOptions: NonNullable<NativeConfig["browser"]>["launchOptions"] = {
          headless: dependencies.headless ?? process.env.RECORDER_HEADLESS !== "false", timeout: 30_000, proxy: { server: proxy.server, bypass: "<-loopback>" },
          executablePath
        };
        const nativeConfig: NativeConfig = {
          browser: { browserName: "chromium", isolated: false, launchOptions,
            contextOptions: { serviceWorkers: "block", viewport: { width: 1440, height: 1000 } } },
          capabilities: ["core", "testing", "network"], codegen: "typescript", ignoreRoots: true,
          webmcp: false, saveSession: false, outputDir, allowUnrestrictedFileAccess: false,
          secrets: context.secrets as Record<string, string> | undefined,
          redactUrlParams: ["access_token", "refresh_token", "token", "password", "secret", "api_key", "code"],
          timeouts: { action: assertion, expect: assertion, navigation, idle: 0 }
        };
        let session: Session;
        const getContext = async (): Promise<NativeContext> => {
          if (session.closed) throw new Error("Playwright MCP session closed");
          session.starting ??= (async () => {
            const debuggingPort = await reserveAutomationDebuggingPort();
            const browser = await (dependencies.launchBrowser ?? launchUpstreamBrowser)({ ...launchOptions,
              args: [...(launchOptions?.args || []), `--remote-debugging-port=${debuggingPort}`, '--remote-debugging-address=127.0.0.1'] });
            if (session.closed) { await browser.close(); throw new Error("Playwright MCP session closed"); }
            session.browser = browser;
            const browserContext = await browser.newContext(nativeConfig.browser?.contextOptions);
            if (session.closed) { await browser.close(); throw new Error("Playwright MCP session closed"); }
            // This is initial lifecycle evidence, not an assertion about the
            // site's current cookies or signed-in state after navigation.
            const contextOptions = nativeConfig.browser?.contextOptions;
            if (!Object.hasOwn(contextOptions || {}, "storageState") && !Object.hasOwn(contextOptions || {}, "httpCredentials") && browserContext.pages().length === 0) {
              let initialStorageEmpty = false;
              try {
                const state = await browserContext.storageState({ indexedDB: true });
                initialStorageEmpty = Array.isArray(state.cookies) && state.cookies.length === 0
                  && Array.isArray(state.origins) && state.origins.length === 0;
              } catch { /* Unknown initial state must not establish an empty-storage claim. */ }
              if (browserContext.pages().length === 0) session.browserContextReceipt = Object.freeze({ schema: "hellotest.browser-context.v1",
                owned: true, context_mode: "fresh_isolated", initial_storage_empty: initialStorageEmpty,
                storage_state_loaded: false, created_before_navigation: true });
            }
            session.navigationGuard = await installAutomationNavigationGuard(browser, allowedOrigins, debuggingPort);
            if (session.closed) { await session.navigationGuard.close(); await browser.close(); throw new Error("Playwright MCP session closed"); }
            // Playwright route() skips later URLs in a redirect chain. A
            // Chromium Fetch interception sees every document hop, preserving
            // the browser's native redirects/status bodies without preflight,
            // replay or rewriting application responses.
            type Page = ReturnType<NativeContext["pages"]>[number];
            const protectedPages = new WeakMap<Page, Promise<void>>();
            const protect = (page: Page) => {
              let ready = protectedPages.get(page);
              if (!ready) {
                ready = (async () => {
                  const cdp = await browserContext.newCDPSession(page);
                  cdp.on("Fetch.requestPaused", async event => {
                    let allowed = false;
                    try { allowed = allowedOrigins.has(new URL(event.request.url).origin); } catch {}
                    await cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
                      ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
                  });
                  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] });
                })();
                protectedPages.set(page, ready);
              }
              return ready;
            };
            browserContext.on("page", page => { void protect(page).catch(() => page.close().catch(() => undefined)); });
            const newPage = browserContext.newPage.bind(browserContext);
            browserContext.newPage = async () => { const page = await newPage(); await protect(page); return page; };
            await browserContext.newPage();
            // Also reject first-hop navigation in frames/popups before their
            // page event can install the Chromium document interception.
            await browserContext.route("**/*", async route => {
              try {
                const target = route.request();
                if (target.isNavigationRequest()) {
                  if (!allowedOrigins.has(new URL(target.url()).origin)) return await route.abort("blockedbyclient");
                  // New page targets are paused and protected by the owned
                  // browser guard before their first document. Once Playwright
                  // exposes the page, its additional frame guard is awaited too.
                  let owner: Page | undefined;
                  try { owner = target.frame().page(); } catch { /* The paused target already has its browser-level policy. */ }
                  if (!owner && !session.navigationGuard?.isActive()) return await route.abort("blockedbyclient");
                  if (owner) await protect(owner);
                }
                await route.continue();
              } catch { await route.abort("blockedbyclient").catch(() => undefined); }
            });
            session.context = browserContext;
            return browserContext;
          })();
          return session.starting;
        };
        const server = await (dependencies.createConnection ?? createConnection)(nativeConfig, getContext);
        const transport = new NativeTransport();
        await server.connect(transport);
        session = { server, transport, proxy, outputDir, busy: false, closed: false,
          capturePreview: context.capture_preview === true, captureModelImages: context.capture_model_images === true,
          secrets: [...new Set(Object.values(context.secrets as Record<string, string> || {}).filter(Boolean))],
          expires: Date.now() + ttl, toolTimeout: dependencies.toolTimeoutMs ?? Math.max(60_000, navigation + 10_000, assertion + 10_000) };
        id = randomUUID();
        sessions.set(id, session);
        // Native MCP initialization owns protocol negotiation and server metadata.
        const initialized = await transport.receive(message);
        if (initialized?.error) { await close(id); return initialized; }
        if (initialized && record(initialized.result)) initialized.result = {
          ...initialized.result,
          _meta: { hellotest: { provider: "playwright_mcp_upstream", upstream_package: "@playwright/mcp", upstream_version: "0.0.84",
            assertion_timeout_ms: assertion, navigation_timeout_ms: navigation } }
        };
        reply.header("mcp-session-id", id);
        return initialized;
      } catch (cause) {
        if (id) await close(id);
        else {
          await proxy?.close().catch(() => undefined);
          if (outputDir) await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
        }
        return rpcError(message.id, -32602, cause instanceof Error ? cause.message : "Unable to initialize Playwright MCP");
      } finally { initializing--; }
    }
    const session = sessions.get(id);
    if (!session || session.closed || session.expires <= Date.now() && !session.busy) {
      await close(id);
      return reply.code(404).send(rpcError(message.id, -32001, "Playwright MCP session expired"));
    }
    session.expires = Date.now() + ttl;
    if (message.id === undefined) {
      await session.transport.receive(message);
      return reply.code(202).send();
    }
    if (session.busy) return reply.code(409).send(rpcError(message.id, -32000, "A browser tool is already running"));
    session.busy = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const aborted = () => { void close(id); };
    request.raw.once("aborted", aborted);
    const disconnected = () => { if (!reply.raw.writableEnded) void close(id); };
    reply.raw.once("close", disconnected);
    try {
      const response = await Promise.race([
        session.transport.receive(message),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => {
          void close(id);
          reject(new Error("Playwright MCP request deadline reached; session closed without replay"));
        }, session.toolTimeout); })
      ]);
      if (deadline) { clearTimeout(deadline); deadline = undefined; }
      if (Buffer.byteLength(JSON.stringify(response) ?? "", "utf8") > 16 * 1024 * 1024) throw new Error("Playwright MCP response exceeded transport limit");
      // Capturing the already-completed action is optional. It cannot turn a
      // confirmed native result into a tool failure or cause action replay.
      try {
        const preview = await browserPreview(session, message, response);
        if (preview && response) response._meta = { ...response._meta, hellotest: {
          ...(record(response._meta?.hellotest) ? response._meta.hellotest : {}),
          ...(session.capturePreview ? { browser_preview: preview } : {}),
          ...(session.captureModelImages && message.params?.name === "browser_take_screenshot"
            ? { model_image: { schema: "hellotest.masked-browser-image.v1", ...preview } } : {}) } };
      } catch { /* Keep the native result; do not emit unmasked pixels. */ }
      if (response && message.method === "tools/call" && session.context && session.browserContextReceipt && !session.closed) {
        response._meta = { ...response._meta, hellotest: {
          ...(record(response._meta?.hellotest) ? response._meta.hellotest : {}), browser_context: session.browserContextReceipt } };
      }
      // Preserve the official result, including native Playwright code. The
      // trusted host extracts code before creating its own redacted diagnostics.
      return response;
    } catch {
      await close(id);
      return rpcError(message.id, -32000, "Playwright MCP request was interrupted; browser session closed without replay");
    } finally {
      if (deadline) clearTimeout(deadline);
      request.raw.off("aborted", aborted);
      reply.raw.off("close", disconnected);
      session.busy = false;
      session.expires = Date.now() + ttl;
    }
  });
}
