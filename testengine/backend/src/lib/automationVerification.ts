import { createHash, randomUUID } from "node:crypto";
import { mkdir, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createInspectionProxy } from "./inspectionProxy.js";
import { assertRemoteInspectionUrl } from "./inspectionSecurity.js";
import { createPlaywrightCodeBindings } from "./playwrightBindings.js";
import { captureAutomationBrowserSnapshot } from "./automationMcp.js";
import { resolveRepositoryLocator } from "./repositoryLocator.js";
import { compileRecordedProgram, parameterKey } from "./automationVerificationProgram.js";
import { normalizeScopedParameterKey } from "./stepParameterReferences.js";

type Operation = { name: string; arguments: Record<string, string>; navigation_intent?: "reload" };
type Section = { step_id: string; automation_code: string; operations: Operation[] };
type Policy = { mode: "read_only" | "authorized_run" | "fixture"; fixture_id?: string; reset_receipt?: string; reset_verified?: boolean; allow_mutations?: boolean };
export type AutomationVerificationRequest = {
  schema_version: 1; verification_id: string; lease_token: string; start_url: string;
  sections: Section[]; parameters: Record<string, string>; timeout_ms?: number; replay_policy: Policy;
  execution_driver?: "native" | "playwright_test_cli";
};
type Failure = { step_id: string; operation_index: number; operation_kind: string; code: string; action_outcome: "unknown" | "not_attempted" | "completed"; summary: string };
export type AutomationVerificationResult = {
  schema_version: 1; verification_id: string; status: "passed" | "failed" | "skipped" | "cancelled" | "timed_out" | "unknown";
  browser: "chromium"; verification_status: "verified" | "unverified"; replay_safe: boolean; completed_operations: number; completed_interactions: number; snapshot?: Awaited<ReturnType<typeof captureAutomationBrowserSnapshot>>;
  assertion_count: number; duration_ms: number; failure?: Failure;
  private_evidence?: { kind: "trace"; artifact_id: string; retained: true };
  execution_driver?: "native" | "playwright_test_cli";
};
type Dependencies = {
  launchBrowser?: (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;
  createProxy?: typeof createInspectionProxy;
  validateTarget?: typeof assertRemoteInspectionUrl;
  artifactRoot?: string;
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const READ_ONLY = new Set(["browser_navigate", "browser_assert"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const string = (value: unknown, max = 2_000): value is string => typeof value === "string" && value.length <= max;
const exactKeys = (value: Record<string, unknown>, allowed: string[], required = allowed) => Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const invalid = () => Object.assign(new Error("The isolated verification contract is invalid or does not match the recorded program."), { code: "AUTOMATION_VERIFICATION_CONTRACT_INVALID", statusCode: 400 });
const syntax = (value: any): any => Array.isArray(value) ? value.map(syntax) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !["start", "end", "loc", "raw"].includes(key)).map(([key, item]) => [key, syntax(item)])) : value;
const parsed = (source: string) => JSON.stringify(syntax(parse(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true })));

/** Reject every unsupported statement atomically before launching a browser.
 * AST equality accepts formatting only; the runner never executes an arbitrary
 * expression, import, shell command or model-authored evaluate callback. */
export function validateAutomationVerificationRequest(input: unknown): AutomationVerificationRequest {
  if (!record(input) || !exactKeys(input, ["schema_version", "verification_id", "lease_token", "start_url", "sections", "parameters", "timeout_ms", "replay_policy", "execution_driver"],
    ["schema_version", "verification_id", "lease_token", "start_url", "sections", "parameters", "replay_policy"])
    || input.schema_version !== 1 || !UUID.test(input.verification_id) || !string(input.lease_token, 256) || input.lease_token.length < 16
    || !string(input.start_url) || !Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 50
    || !record(input.parameters) || Object.keys(input.parameters).length > 500
    || !record(input.replay_policy) || !exactKeys(input.replay_policy, ["mode", "fixture_id", "reset_receipt", "reset_verified", "allow_mutations"], ["mode"])
    || !["read_only", "authorized_run", "fixture"].includes(input.replay_policy.mode)
    || input.execution_driver !== undefined && !["native", "playwright_test_cli"].includes(input.execution_driver)
    || input.timeout_ms !== undefined && (!Number.isSafeInteger(input.timeout_ms) || input.timeout_ms < 100 || input.timeout_ms > 60_000)) throw invalid();
  const policy = input.replay_policy;
  if (["fixture_id", "reset_receipt"].some(key => policy[key] !== undefined && (!string(policy[key], 256) || !policy[key].trim()))
    || ["reset_verified", "allow_mutations"].some(key => policy[key] !== undefined && typeof policy[key] !== "boolean")) throw invalid();
  let origin: string;
  try { const url = new URL(input.start_url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalid(); origin = url.origin; }
  catch { throw invalid(); }
  for (const [key, value] of Object.entries(input.parameters)) {
    if (!/^[tsr]\..+/.test(key) || normalizeScopedParameterKey(key) !== key || !string(value, 16_000)) throw invalid();
  }
  const ids = new Set<string>(); let count = 0, bytes = 0, assertions = 0;
  try {
    for (const section of input.sections) {
      if (!record(section) || !exactKeys(section, ["step_id", "automation_code", "operations"]) || !string(section.step_id, 200) || !section.step_id || ids.has(section.step_id)
        || !string(section.automation_code, 64_000) || !Array.isArray(section.operations) || !section.operations.length) throw invalid();
      const flags = new Set(section.automation_code.match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1].split(/\s+/) || []);
      if (flags.has("skip") || flags.has("optional")) throw invalid();
      ids.add(section.step_id); count += section.operations.length; bytes += section.automation_code.length;
      if (count > 250 || bytes > 256_000) throw invalid();
      for (const operation of section.operations) {
        if (!record(operation) || !exactKeys(operation, ["name", "arguments", "navigation_intent"], ["name", "arguments"])
          || !string(operation.name, 64) || !record(operation.arguments)
          || operation.navigation_intent !== undefined && (operation.name !== "browser_navigate" || operation.navigation_intent !== "reload")) throw invalid();
        if (operation.name === "browser_navigate" && new URL(operation.arguments.url).origin !== origin) throw invalid();
        if (operation.name === "browser_assert" && operation.arguments.assertion === "url" && new URL(input.parameters[parameterKey(operation.arguments.value) || ""] ?? operation.arguments.value).origin !== origin) throw invalid();
      }
      const compiled = compileRecordedProgram(section.operations);
      assertions += compiled?.assertion_count || 0;
      const inline = compileRecordedProgram(section.operations, { layout: 'inline' });
      if (!compiled || parsed(section.automation_code) !== parsed(compiled.source) && (!inline || parsed(section.automation_code) !== parsed(inline.source))) throw invalid();
      // A missing frozen binding is a preparation error, never a generator or
      // literal reference to type into the application. Empty values are valid.
      for (const operation of section.operations) {
        for (const field of ["value", "key"]) {
          const key = parameterKey(operation.arguments[field]);
          if (key && !Object.hasOwn(input.parameters, key)) throw invalid();
        }
      }
    }
    if (assertions < 1) throw invalid();
  } catch { throw invalid(); }
  return structuredClone(input) as AutomationVerificationRequest;
}

/** Fresh browser and context for every verification. A browser reset does not
 * reset a remote application. The authenticated host can authorize one run;
 * repeats require a verified fixture or proof that no interaction completed. */
export async function runAutomationVerification(input: AutomationVerificationRequest, options: Dependencies & { signal?: AbortSignal } = {}): Promise<AutomationVerificationResult> {
  const request = validateAutomationVerificationRequest(input), started = Date.now();
  const result: AutomationVerificationResult = { schema_version: 1, verification_id: request.verification_id, execution_driver: "native", status: "failed", browser: "chromium", verification_status: "unverified", replay_safe: false, completed_operations: 0, completed_interactions: 0, assertion_count: 0, duration_ms: 0 };
  const fixture = request.replay_policy.mode === "fixture" && request.replay_policy.reset_verified === true && request.replay_policy.allow_mutations === true
    && Boolean(request.replay_policy.fixture_id && request.replay_policy.reset_receipt);
  const canInteract = fixture || request.replay_policy.mode === "authorized_run" && request.replay_policy.allow_mutations === true;
  const firstUnsafe = request.sections.flatMap(section => section.operations.map((operation, index) => ({ section, operation, index }))).find(row => !READ_ONLY.has(row.operation.name));
  if (firstUnsafe && !canInteract) {
    result.status = "skipped";
    result.failure = { step_id: firstUnsafe.section.step_id, operation_index: firstUnsafe.index + 1, operation_kind: firstUnsafe.operation.name, code: "AUTOMATION_VERIFICATION_RESET_REQUIRED", action_outcome: "not_attempted", summary: "Isolated replay requires a verified application fixture reset before interacting with this case." };
    return result;
  }
  if (options.signal?.aborted) { result.status = "cancelled"; return result; }
  let browser: Browser | undefined, context: BrowserContext | undefined, page: Page | undefined;
  let proxy: Awaited<ReturnType<typeof createInspectionProxy>> | undefined;
  let active: { section: Section; operation: Operation; index: number } | undefined;
  let actionStarted = false, timedOut = false, cancelled = false, traceStarted = false;
  const deadline = started + (request.timeout_ms ?? 30_000), origin = new URL(request.start_url).origin;
  const remaining = () => Math.max(1, deadline - Date.now());
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ||= (async () => { await browser?.close().catch(() => undefined); await proxy?.close().catch(() => undefined); })();
  const abort = () => { cancelled = true; void close(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; void close(); }, remaining());
  timer.unref?.();
  try {
    await (options.validateTarget || assertRemoteInspectionUrl)(request.start_url);
    if (cancelled || timedOut) throw invalid();
    proxy = await (options.createProxy || createInspectionProxy)();
    if (cancelled || timedOut) throw invalid();
    browser = await (options.launchBrowser || (launchOptions => chromium.launch(launchOptions)))({ headless: true, timeout: remaining(), proxy: { server: proxy.server, bypass: "<-loopback>" }, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    if (cancelled || timedOut) throw invalid();
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", async route => {
      try {
        const target = route.request();
        if (target.isNavigationRequest() && new URL(target.url()).origin !== origin || !canInteract && !["GET", "HEAD", "OPTIONS"].includes(target.method())) return await route.abort();
        await route.continue();
      } catch { await route.abort().catch(() => undefined); }
    });
    await context.tracing.start({ screenshots: false, snapshots: true, sources: false }); traceStarted = true;
    page = await context.newPage();
    context.on("page", candidate => { if (candidate !== page) void candidate.close(); });
    const parameters = Object.freeze(Object.assign(Object.create(null), request.parameters)) as Record<string, string>;
    const bindings = createPlaywrightCodeBindings(page, { assertionTimeout: Math.min(8_000, remaining()), resolveLocator: value => value, resolveUrl: value => value,
      interpolate: value => { const key = parameterKey(value); return key ? parameters[key] : value; } });
    await page.goto(request.start_url, { waitUntil: "domcontentloaded", timeout: remaining() });
    for (const section of request.sections) {
      for (let index = 0; index < section.operations.length; index++) {
        if (cancelled || timedOut || remaining() <= 1) throw invalid();
        const operation = section.operations[index]; active = { section, operation, index }; actionStarted = false;
        page.setDefaultTimeout(Math.min(8_000, remaining())); page.setDefaultNavigationTimeout(Math.min(15_000, remaining()));
        const compiled = compileRecordedProgram([operation]);
        // Each statement is rendered by the same atomically checked grammar.
        // Tracking its boundary distinguishes a failed read from an unknown
        // interaction acknowledgement; interactions are never replayed here.
        if (operation.arguments.locator && !(operation.name === "browser_assert" && ["hidden", "count"].includes(operation.arguments.assertion))) {
          const locator = resolveRepositoryLocator(page, operation.arguments.locator);
          try { await locator.waitFor({ state: "attached", timeout: Math.min(3_000, remaining()) }); } catch { /* count below is authoritative */ }
          if (await locator.count() !== 1) throw Object.assign(new Error(), { code: "AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED" });
        }
        actionStarted = !READ_ONLY.has(operation.name);
        await new AsyncFunction("page", "expect", "params", `"use strict";\n${compiled!.source}`)(bindings.page, bindings.expect, parameters);
        actionStarted = false;
        if (new URL(page.url()).origin !== origin) throw Object.assign(new Error(), { code: "AUTOMATION_VERIFICATION_ORIGIN_CHANGED" });
        result.completed_operations++;
        if (!READ_ONLY.has(operation.name)) result.completed_interactions++;
        if (operation.name === "browser_assert") result.assertion_count++;
      }
    }
    result.status = "passed"; result.verification_status = "verified"; result.replay_safe = fixture || result.completed_interactions === 0;
  } catch (error) {
    const locatorUnresolved = (error as { code?: string })?.code === "AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED";
    result.status = actionStarted ? "unknown" : cancelled ? "cancelled" : timedOut ? "timed_out" : "failed";
    result.replay_safe = !actionStarted && (fixture || result.completed_interactions === 0);
    if (active) result.failure = { step_id: active.section.step_id, operation_index: active.index + 1, operation_kind: active.operation.name,
      code: locatorUnresolved ? "AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED" : actionStarted ? "AUTOMATION_VERIFICATION_OUTCOME_UNKNOWN" : cancelled ? "AUTOMATION_VERIFICATION_CANCELLED" : timedOut ? "AUTOMATION_VERIFICATION_TIMEOUT" : active.operation.name === "browser_assert" ? "AUTOMATION_VERIFICATION_ASSERTION_FAILED" : "AUTOMATION_VERIFICATION_OPERATION_FAILED",
      action_outcome: actionStarted ? "unknown" : "not_attempted", summary: actionStarted ? "An interaction acknowledgement is unknown. Reconcile its application outcome before another execution." : "The isolated recorded program did not establish its expected browser condition." };
    if (!active) result.failure = { step_id: request.sections[0].step_id, operation_index: 0, operation_kind: "browser_navigate", code: cancelled ? "AUTOMATION_VERIFICATION_CANCELLED" : timedOut ? "AUTOMATION_VERIFICATION_TIMEOUT" : "AUTOMATION_VERIFICATION_START_FAILED", action_outcome: "not_attempted", summary: "The fresh browser could not reach the reviewed Start URL." };
    if (locatorUnresolved && page && !timedOut && !cancelled) {
      result.snapshot = await captureAutomationBrowserSnapshot(page, undefined, Math.min(deadline, Date.now() + 2_000)).catch(() => undefined);
    }
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    if (traceStarted && context) {
      if (result.status === "passed") await context.tracing.stop().catch(() => undefined);
      else {
        // Traces can contain application/private data. Retain them on the
        // engine with owner-only permissions; never inline or stream to LLMs.
        const artifactId = randomUUID(), directory = path.join(options.artifactRoot || process.env.ARTIFACT_ROOT || "/artifacts", "automation-verification", request.verification_id);
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
          const file = path.join(directory, `${artifactId}.zip`);
          await context.tracing.stop({ path: file }); await chmod(file, 0o600);
          result.private_evidence = { kind: "trace", artifact_id: artifactId, retained: true };
        } catch { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
      }
    }
    // If cancellation raced startup, the first close had no browser/proxy.
    await browser?.close().catch(() => undefined); await proxy?.close().catch(() => undefined);
    result.duration_ms = Date.now() - started;
  }
  return result;
}

/** The shared-secret guard authenticates the host. The opaque host lease scopes
 * retry/cancellation to this immutable request; cached receipts prevent repeat
 * execution when a response is lost. A conflicting lease/program fails closed. */
export async function registerAutomationVerification(app: FastifyInstance, guard: preHandlerHookHandler, dependencies: Dependencies = {}) {
  const attempts = new Map<string, { digest: string; lease: string; controller: AbortController; expires: number; promise: Promise<AutomationVerificationResult>; complete: boolean }>();
  let closed = false;
  const timer = setInterval(() => { for (const [id, attempt] of attempts) if (attempt.complete && attempt.expires < Date.now()) attempts.delete(id); }, 30_000);
  timer.unref();
  app.addHook("onClose", async () => { closed = true; clearInterval(timer); for (const attempt of attempts.values()) attempt.controller.abort(); await Promise.allSettled([...attempts.values()].map(attempt => attempt.promise)); });
  app.post("/api/v1/automation/verify", { preHandler: guard, bodyLimit: 512 * 1024 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    let input: AutomationVerificationRequest;
    try { input = validateAutomationVerificationRequest(request.body); } catch { return reply.code(400).send({ code: "AUTOMATION_VERIFICATION_CONTRACT_INVALID", message: invalid().message }); }
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex"), existing = attempts.get(input.verification_id);
    if (existing) {
      if (existing.digest !== digest || existing.lease !== input.lease_token) return reply.code(409).send({ code: "AUTOMATION_VERIFICATION_ATTEMPT_CONFLICT", message: "This verification ID is already bound to another immutable attempt." });
      return existing.promise;
    }
    if (closed || [...attempts.values()].filter(attempt => !attempt.complete).length >= 2 || attempts.size >= 500) return reply.code(429).send({ code: "AUTOMATION_VERIFICATION_CAPACITY", message: "The isolated verification worker is at capacity." });
    const controller = new AbortController();
    const attempt = { digest, lease: input.lease_token, controller, expires: Date.now() + 15 * 60_000, promise: Promise.resolve(null as unknown as AutomationVerificationResult), complete: false };
    attempts.set(input.verification_id, attempt);
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
    const execute = input.execution_driver === "playwright_test_cli"
      ? async () => (await import("./automationVerificationCli.js")).runAutomationVerificationCli(input, { signal: controller.signal, artifactRoot: dependencies.artifactRoot })
      : () => runAutomationVerification(input, { ...dependencies, signal: controller.signal });
    attempt.promise = execute().finally(() => { attempt.complete = true; attempt.expires = Date.now() + 15 * 60_000; request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); });
    return attempt.promise;
  });
  app.delete("/api/v1/automation/verify/:verification_id", { preHandler: guard }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const attempt = attempts.get((request.params as { verification_id: string }).verification_id);
    if (!attempt) return reply.code(404).send({ code: "AUTOMATION_VERIFICATION_NOT_FOUND" });
    if (request.headers["x-automation-verification-lease"] !== attempt.lease) return reply.code(409).send({ code: "AUTOMATION_VERIFICATION_LEASE_MISMATCH" });
    attempt.controller.abort(); return { cancelled: true };
  });
}
