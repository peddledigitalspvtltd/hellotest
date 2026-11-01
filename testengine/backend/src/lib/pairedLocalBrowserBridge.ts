import Fastify, { type FastifyInstance } from "fastify";
import { constantTimeSecretMatches } from "./testEngineSecurity.js";
import { EngineHttpError, requestEngineService } from "./engineHttpClient.js";
import { registerAutomationMcp } from "./automationMcp.js";
import { createInspectionProxy } from "./inspectionProxy.js";
import { runAutomationVerification, type AutomationVerificationRequest } from "./automationVerification.js";

type Descriptor = { id: string; token: string; poll_url: string; result_url: string; expires_at: string };
type Command = { id: string; method: string; params?: Record<string, unknown>; session_id?: string };
const validId = /^[a-zA-Z0-9_.-]{1,128}$/;
const delay = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
});

/** A job-scoped outbound relay to the native typed browser MCP. It exposes no
 * listening MCP endpoint, global credential, arbitrary HTTP proxy or code tool. */
export async function registerPairedLocalBrowserBridgeRoutes(app: FastifyInstance, configuration: { origin: string; apiOrigin: string; token: string; agentId: string }) {
  const bridges = new Map<string, { descriptor: Descriptor; controller: AbortController; status: string; browser: FastifyInstance; finished: Promise<void> }>();
  const endpoint = (value: string, id: string, operation: "poll" | "result") => {
    const url = new URL(value);
    if (url.origin !== configuration.apiOrigin || url.username || url.password || url.search || url.hash
      || !/^\/(?:[a-zA-Z0-9._~-]+\/)*local-browser-bridges\//.test(url.pathname)
      || !url.pathname.endsWith(`/local-browser-bridges/${id}/${operation}`)) throw new Error("The browser bridge belongs to another API or job.");
  };
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.split("?")[0].startsWith("/api/v1/local-browser-bridges")) return;
    reply.header("cache-control", "no-store");
    if (request.headers.origin !== configuration.origin || !constantTimeSecretMatches(String(request.headers["x-hellotest-agent-token"] || ""), configuration.token)) {
      reply.code(403).send({ code: "LOCAL_AGENT_UNPAIRED", message: "Pair this browser with the HelloTest local agent before starting a local build." });
    }
  });
  const run = async (descriptor: Descriptor, controller: AbortController, browser: FastifyInstance) => {
    const headers = { authorization: `Bearer ${descriptor.token}`, "x-hellotest-local-agent-id": configuration.agentId, "content-type": "application/json" };
    let sessionId: string | undefined;
    let reviewedOrigin: string | undefined;
    const receipts = new Map<string, { status: number; body: unknown; session_id?: string }>();
    try {
      while (!controller.signal.aborted && Date.now() < Date.parse(descriptor.expires_at)) {
        let poll: { state: "open" | "closed"; command: Command | null };
        try { poll = await requestEngineService({ url: descriptor.poll_url, service: "HelloTest local browser command", timeoutMs: 30000, maxResponseBytes: 512 * 1024, init: { headers, signal: controller.signal } }); }
        catch (error) { if (error instanceof EngineHttpError && [401, 403, 404, 410].includes(error.status || 0)) break; await delay(1000, controller.signal); continue; }
        if (poll.state === "closed") break;
        if (poll.state !== "open" || !poll.command) { await delay(250, controller.signal); continue; }
        const command = poll.command;
        if (!validId.test(command.id) || !["initialize", "notifications/initialized", "ping", "tools/list", "tools/call", "session/delete", "verification/run"].includes(command.method)) break;
        let response = receipts.get(command.id);
        if (!response) {
          if (receipts.size >= 1000) break;
          if (command.method === "verification/run") {
            const input = command.params as AutomationVerificationRequest;
            try {
              if (input.execution_driver && input.execution_driver !== "native" || !reviewedOrigin || new URL(input.start_url).origin !== reviewedOrigin) throw new Error();
              const result = await runAutomationVerification(input, { signal: controller.signal,
                validateTarget: async value => { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== reviewedOrigin) throw new Error(); },
                createProxy: () => createInspectionProxy({ pairedPrivateOrigin: reviewedOrigin }) });
              response = { status: 200, body: result };
            } catch { response = { status: 400, body: { code: "LOCAL_VERIFICATION_INVALID", message: "Local verification requires the native recorded program and the reviewed build Start URL." } }; }
          } else {
          const rpcHeaders = { ...(sessionId ? { "mcp-session-id": sessionId } : {}) };
          const result = await browser.inject({ method: command.method === "session/delete" ? "DELETE" : "POST", url: "/api/v1/automation/mcp", headers: rpcHeaders,
            ...(command.method === "session/delete" ? {} : { payload: { jsonrpc: "2.0", id: command.id, method: command.method, ...(command.params ? { params: command.params } : {}) } }) });
          const newSession = result.headers["mcp-session-id"];
          if (typeof newSession === "string") sessionId = newSession;
          let body: unknown = null;
          try { body = result.body ? result.json() : null; } catch { body = { jsonrpc: "2.0", id: command.id, error: { code: -32603, message: "The local browser returned an invalid response." } }; }
          response = { status: result.statusCode, body, ...(sessionId ? { session_id: sessionId } : {}) };
          if (command.method === "initialize" && result.statusCode === 200 && (body as { result?: unknown })?.result) {
            reviewedOrigin = new URL((command.params as { _meta: { hellotest: { start_url: string } } })._meta.hellotest.start_url).origin;
          }
          }
          receipts.set(command.id, response);
        }
        // Retry the saved observation after a lost acknowledgement. Never call
        // a click/fill/navigation a second time to repair transport delivery.
        let delivered = false;
        while (!delivered && !controller.signal.aborted && Date.now() < Date.parse(descriptor.expires_at)) {
          try { await requestEngineService({ url: descriptor.result_url, service: "HelloTest local browser receipt", timeoutMs: 15000, responseType: "none", init: { method: "POST", headers, body: JSON.stringify({ command_id: command.id, response }), signal: controller.signal } }); delivered = true; }
          catch (error) { if (error instanceof EngineHttpError && [400, 401, 403, 404, 409, 410].includes(error.status || 0)) { controller.abort(); break; } await delay(1000, controller.signal); }
        }
      }
    } finally { await browser.close(); const existing = bridges.get(descriptor.id); if (existing) existing.status = "closed"; }
  };
  app.post("/api/v1/local-browser-bridges", { bodyLimit: 8192 }, async (request, reply) => {
    const input = request.body as Descriptor;
    try {
      if (!input || Object.keys(input).some(key => !["id", "token", "poll_url", "result_url", "expires_at"].includes(key)) || !validId.test(input.id)
        || typeof input.token !== "string" || !/^[a-zA-Z0-9._~-]{32,1024}$/.test(input.token) || Date.parse(input.expires_at) <= Date.now() || Date.parse(input.expires_at) > Date.now() + 2 * 60 * 60_000 || !Number.isFinite(Date.parse(input.expires_at))) throw new Error();
      endpoint(input.poll_url, input.id, "poll"); endpoint(input.result_url, input.id, "result");
      const existing = bridges.get(input.id);
      if (existing) {
        if (!constantTimeSecretMatches(input.token, existing.descriptor.token)) throw new Error();
        return reply.code(202).send({ accepted: true, id: input.id, bridge_id: input.id, status: existing.status });
      }
      if ([...bridges.values()].filter(value => value.status === "open").length >= 2) return reply.code(429).send({ code: "LOCAL_BROWSER_BUSY", message: "Two local browser builds are already active." });
      const browser = Fastify({ logger: false });
      await registerAutomationMcp(browser, async () => {}, {
        validateTarget: async value => { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use a valid HTTP(S) Start URL without embedded credentials."); },
        createProxy: async origin => createInspectionProxy({ pairedPrivateOrigin: origin }),
        launchBrowser: async options => { const { chromium } = await import("playwright"); return chromium.launch({ ...options, headless: false }); }
      });
      const controller = new AbortController();
      const entry = { descriptor: input, controller, status: "open", browser, finished: Promise.resolve() };
      bridges.set(input.id, entry);
      entry.finished = run(input, controller, browser).catch(() => { entry.status = "closed"; });
      return reply.code(202).send({ accepted: true, id: input.id, bridge_id: input.id, status: "open" });
    } catch { return reply.code(400).send({ code: "LOCAL_BROWSER_BRIDGE_INVALID", message: "The local browser build must use an unexpired job grant from the paired HelloTest API." }); }
  });
  app.post("/api/v1/local-browser-bridges/:id/cancel", async (request, reply) => {
    const existing = bridges.get((request.params as { id: string }).id);
    if (!existing) return reply.code(404).send({ code: "LOCAL_BROWSER_BRIDGE_NOT_FOUND" });
    existing.controller.abort(); void existing.browser.close();
    return { accepted: true, id: existing.descriptor.id, cancellation_requested: true };
  });
  app.addHook("onClose", async () => { for (const bridge of bridges.values()) { bridge.controller.abort(); void bridge.browser.close(); } await Promise.all([...bridges.values()].map(value => value.finished)); });
}
