import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EngineRunEnvelope } from "../contracts/hellotest.js";
import { EngineHttpError, requestEngineService } from "./engineHttpClient.js";
import { constantTimeSecretMatches } from "./testEngineSecurity.js";
import { buildAcceptedRun } from "./pipeline.js";
import { failAcceptedRun, queueRunExecution, saveAcceptedRun } from "./executor.js";
import { getRun } from "./runStore.js";
import { deliverRunCallback, retryRunCallbacks } from "./callbackDelivery.js";
import { registerPairedLocalBrowserBridgeRoutes } from "./pairedLocalBrowserBridge.js";

const PREFIX = "/api/v1/local-executions";
const idPattern = /^[a-zA-Z0-9_.-]{1,128}$/;
const maxRuns = 200;
type Receipt = {
  execution_id: string;
  dispatch_id: string;
  status: "accepted" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  created_at: string;
  updated_at: string;
  grant_hash: string;
  grant_token: string;
  claim_url: string;
  envelopes: EngineRunEnvelope[];
  finished_run_ids: string[];
};
type Claim = { execution_id: string; dispatch_id: string; expires_at: string; envelopes: EngineRunEnvelope[] };
type Options = { directory?: string; origin?: string; apiOrigin?: string; token?: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const originOnly = (value: string) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error("Invalid paired application origin.");
  return value;
};
const publicReceipt = (record: Receipt) => ({
  accepted: true, execution_id: record.execution_id, dispatch_id: record.dispatch_id,
  status: record.status, engine_run_ids: record.envelopes.map(item => item.engine_run_id),
  completed_runs: record.finished_run_ids.length, total_runs: record.envelopes.length,
  updated_at: record.updated_at,
  runs: record.envelopes.map(item => {
    const run = getRun(item.engine_run_id);
    return { engine_run_id: item.engine_run_id, test_case_id: item.hellotest_test_case_id,
      data_set_iteration: item.data_set?.iteration || null, state: run?.state || (record.finished_run_ids.includes(item.engine_run_id) ? "finished" : "pending"),
      callback_delivery: run?.callback_delivery ? { status: run.callback_delivery.status, attempts: run.callback_delivery.attempts } : null };
  })
});

/** Captures are scoped by case, suite and frozen dataset iteration, as in the
 * remote queue. Never feed one row's captures to a sibling row of that case. */
export function priorPairedCaptures(current: EngineRunEnvelope, previous: Array<{ envelope: EngineRunEnvelope; captures: Record<string, string> }>) {
  const result: Record<string, string> = {};
  for (const item of previous.slice().sort((a, b) => Number(a.envelope.execution_policy?.execution_order || 0) - Number(b.envelope.execution_policy?.execution_order || 0))) {
    const candidate = item.envelope;
    if (candidate.hellotest_test_case_id === current.hellotest_test_case_id
      || Number(candidate.execution_policy?.execution_order ?? -1) >= Number(current.execution_policy?.execution_order ?? 0)
      || (candidate.data_set?.id || null) !== (current.data_set?.id || null)
      || (candidate.data_set?.iteration?.index ?? null) !== (current.data_set?.iteration?.index ?? null)) continue;
    for (const [key, value] of Object.entries(item.captures)) {
      if (key.startsWith("r.") || key.startsWith("s.") && current.execution_policy?.suite_id && current.execution_policy.suite_id === candidate.execution_policy?.suite_id) result[key] = value;
    }
  }
  return result;
}

/** Match remote lease eligibility: run limits count every active case; an
 * explicit suite override counts that suite only. Serial cases wait for every
 * earlier case/row in their policy scope. Capacity remains bounded locally. */
export async function schedulePairedRuns(
  envelopes: EngineRunEnvelope[],
  execute: (envelope: EngineRunEnvelope) => Promise<void>,
  options: { signal?: AbortSignal; shouldStop?: () => boolean; maxParallel?: number } = {}
) {
  const pending = envelopes.slice();
  const active = new Map<string, { envelope: EngineRunEnvelope; promise: Promise<void> }>();
  const completed = new Set<string>();
  const capacity = Math.max(1, Math.min(8, options.maxParallel || 8));
  let failure: unknown;
  const eligible = (candidate: EngineRunEnvelope) => {
    if (options.signal?.aborted) return true;
    const policy = candidate.execution_policy || {};
    const suiteScoped = Boolean(policy.suite_parallel_override && policy.suite_id);
    const sameScope = (other: EngineRunEnvelope) => !suiteScoped || other.execution_policy?.suite_id === policy.suite_id;
    const limit = policy.parallel_enabled === true ? Math.max(1, Math.min(capacity, Math.trunc(policy.parallel_count || 1))) : 1;
    if ([...active.values()].filter(item => sameScope(item.envelope)).length >= limit) return false;
    return policy.parallel_enabled === true || envelopes.every(other => other.hellotest_test_case_id === candidate.hellotest_test_case_id
      || Number(other.execution_policy?.execution_order || 0) >= Number(policy.execution_order || 0) || !sameScope(other) || completed.has(other.engine_run_id));
  };
  while (pending.length || active.size) {
    if (failure) { await Promise.all([...active.values()].map(item => item.promise)); throw failure; }
    if (options.shouldStop?.()) { await Promise.all([...active.values()].map(item => item.promise)); return; }
    while (active.size < capacity) {
      const index = pending.findIndex(eligible);
      if (index < 0) break;
      const [envelope] = pending.splice(index, 1);
      const promise = Promise.resolve().then(() => execute(envelope)).catch(error => { failure = error; }).finally(() => {
        completed.add(envelope.engine_run_id); active.delete(envelope.engine_run_id);
      });
      active.set(envelope.engine_run_id, { envelope, promise });
    }
    if (active.size) await Promise.race([...active.values()].map(item => item.promise));
    else if (pending.length) throw new Error("The frozen local execution policy cannot schedule its remaining cases.");
  }
  if (failure) throw failure;
}

/** Browser-to-loopback control plane. Only the paired application may request a
 * claim; executable envelopes and scoped callback credentials come from its API. */
export async function registerPairedLocalExecutionRoutes(app: FastifyInstance, options: Options = {}) {
  const token = options.token || process.env.HELLOTEST_INSPECTOR_TOKEN || "";
  const origin = originOnly(options.origin || process.env.HELLOTEST_PAIRED_ORIGIN || "");
  const apiOrigin = originOnly(options.apiOrigin || process.env.HELLOTEST_PAIRED_API_ORIGIN || origin);
  if (token.length < 32) throw new Error("The local execution agent requires a secure browser pairing token.");
  const directory = path.resolve(options.directory || path.join(process.env.ARTIFACT_ROOT || process.cwd(), ".local-executions"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const writePrivate = async (file: string, payload: unknown) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(payload)); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  };
  const agentFile = path.join(directory, "agent.json");
  let agentId: string;
  try { agentId = JSON.parse(await readFile(agentFile, "utf8")).agent_id; if (!idPattern.test(agentId)) throw new Error(); }
  catch { agentId = randomUUID(); await writePrivate(agentFile, { agent_id: agentId }); }
  app.decorate("pairedLocalExecution", { agent_id: agentId, execution_protocol_version: 1, local_execution: true });
  await registerPairedLocalBrowserBridgeRoutes(app, { origin, apiOrigin, token, agentId });
  const records = new Map<string, Receipt>();
  const active = new Map<string, AbortController>();
  const operations = new Map<string, Promise<void>>();
  let closing = false;
  const accepting = new Map<string, Promise<Receipt>>();
  let persistence = Promise.resolve();
  const fileFor = (id: string) => path.join(directory, `${digest(id)}.json`);
  const persist = (record: Receipt) => {
    record.updated_at = new Date().toISOString();
    const operation = persistence.then(() => writePrivate(fileFor(record.execution_id), record));
    persistence = operation.catch(() => undefined);
    return operation;
  };
  const validEndpoint = (value: string, route: RegExp) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("The HelloTest dispatch endpoint is invalid."); }
    if (url.origin !== apiOrigin || url.username || url.password || url.search || url.hash || !route.test(url.pathname)) throw new Error("The dispatch must belong to the API paired with this local agent.");
    return url;
  };
  const controlUrl = (record: Receipt) => record.claim_url.replace(/\/claim$/, "/control");
  const authorized = (request: FastifyRequest) => request.headers.origin === origin
    && constantTimeSecretMatches(String(request.headers["x-hellotest-agent-token"] || ""), token);
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.split("?")[0].startsWith(PREFIX)) return;
    reply.header("cache-control", "no-store");
    if (!authorized(request)) reply.code(request.headers.origin === origin ? 401 : 403).send({ code: "LOCAL_AGENT_UNPAIRED", message: "Pair this browser with the local HelloTest agent before running a case." });
  });
  const restoreRun = (envelope: EngineRunEnvelope) => { const existing = getRun(envelope.engine_run_id); return existing || saveAcceptedRun(envelope, buildAcceptedRun(envelope)); };
  // A process restart has an unknown browser outcome. Keep receipts and resend
  // retained results, but never replay executable steps or duplicate a purchase.
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const record = JSON.parse(await readFile(path.join(directory, name), "utf8")) as Receipt;
      if (!idPattern.test(record.execution_id) || !Array.isArray(record.envelopes) || record.envelopes.length > maxRuns) continue;
      for (const envelope of record.envelopes) restoreRun(envelope);
      records.set(record.execution_id, record);
      if (["accepted", "running"].includes(record.status)) {
        record.status = "interrupted";
        await persist(record);
        for (const envelope of record.envelopes.filter(item => !record.finished_run_ids.includes(item.engine_run_id))) {
          await failAcceptedRun(envelope, restoreRun(envelope), app.log, "The local agent stopped during execution. Review this attempt and start a new run; it was not replayed.");
          record.finished_run_ids.push(envelope.engine_run_id);
        }
        await persist(record);
      }
    } catch { app.log.warn("A local execution receipt could not be restored; it was not replayed."); }
  }
  const retryCallbacks = async () => {
    for (const record of records.values()) for (const envelope of record.envelopes) {
      if (getRun(envelope.engine_run_id)?.callback_delivery?.status === "failed" || !active.has(record.execution_id) && record.finished_run_ids.includes(envelope.engine_run_id)) {
        await retryRunCallbacks(envelope.engine_run_id).catch(() => undefined);
      }
    }
  };
  let retrying = false;
  const retryTimer = setInterval(() => {
    if (retrying) return;
    retrying = true;
    void retryCallbacks().finally(() => { retrying = false; });
  }, 15_000);
  retryTimer.unref();
  const execute = async (record: Receipt, controller: AbortController) => {
    const previous: Array<{ envelope: EngineRunEnvelope; captures: Record<string, string> }> = [];
    let polling = false;
    const poll = async () => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      try {
        const control = await requestEngineService<{ execution_id: string; cancelled: boolean }>({ url: controlUrl(record), service: "HelloTest local execution control", timeoutMs: 5000, maxResponseBytes: 16384,
          init: { headers: { authorization: `Bearer ${record.grant_token}`, "x-hellotest-local-agent-id": agentId } } });
        if (control.execution_id === record.execution_id && control.cancelled) controller.abort(new Error("This HelloTest execution was cancelled."));
      } catch (error) {
        if (error instanceof EngineHttpError && [401, 403, 404, 410].includes(error.status || 0)) controller.abort(new Error("This local execution's authorization was revoked or expired."));
        // A temporary API outage does not replay or fail the test.
      }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 2000); timer.unref();
    try {
      record.status = "running"; await persist(record); await poll();
      await schedulePairedRuns(record.envelopes, async envelope => {
        const run = restoreRun(envelope);
        if (controller.signal.aborted) {
          await failAcceptedRun(envelope, run, app.log, "This local execution was cancelled before this case finished.");
        } else {
          // Establish the exact result before the first step. Single-step runs
          // can upload traces/screenshots before any step-progress callback.
          await deliverRunCallback(envelope, {
            event: "run.progress", engine_run_id: envelope.engine_run_id,
            hellotest_run_id: envelope.hellotest_run_id,
            hellotest_execution_id: envelope.hellotest_execution_id,
            hellotest_test_case_id: envelope.hellotest_test_case_id,
            data_set_iteration: envelope.data_set?.iteration || null,
            state: "running", summary: "The paired machine is starting this saved case.",
            deterministic_attempted: false, healing_attempted: false, healing_succeeded: false,
            step_outcomes: [], case_result: { status: "running", duration_ms: 0, logs: {} },
            artifact_bundle: run.artifact_bundle, patch_proposals: [], emitted_at: new Date().toISOString()
          });
          const timeout = new AbortController();
          const runTimer = setTimeout(() => timeout.abort(new Error("The local execution exceeded its configured run timeout.")), envelope.run_timeout_seconds * 1000);
          try {
            await queueRunExecution(envelope, run, app.log, { signal: AbortSignal.any([controller.signal, timeout.signal]), capturedValues: priorPairedCaptures(envelope, previous),
              onCapturedValues: captures => previous.push({ envelope, captures }) });
          } finally { clearTimeout(runTimer); }
        }
        record.finished_run_ids.push(envelope.engine_run_id); await persist(record);
      }, { signal: controller.signal, shouldStop: () => closing });
      record.status = closing ? "interrupted" : controller.signal.aborted ? "cancelled" : record.envelopes.some(item => ["failed", "incident"].includes(getRun(item.engine_run_id)?.state || "")) ? "failed" : "completed";
      await persist(record);
    } catch {
      record.status = "interrupted";
      await persist(record).catch(() => undefined);
      for (const envelope of record.envelopes.filter(item => !record.finished_run_ids.includes(item.engine_run_id))) {
        await failAcceptedRun(envelope, restoreRun(envelope), app.log, "The local execution could not continue. Review this attempt before starting a new run.");
      }
    } finally { clearInterval(timer); active.delete(record.execution_id); operations.delete(record.execution_id); }
  };
  const claim = async (input: { execution_id: string; grant_token: string; claim_url: string }): Promise<Receipt> => {
    const existing = records.get(input.execution_id);
    if (existing) {
      if (!constantTimeSecretMatches(digest(input.grant_token), existing.grant_hash) || input.claim_url !== existing.claim_url) throw new Error("This execution was already accepted with another dispatch credential.");
      return existing;
    }
    if (closing || active.size + accepting.size >= 4) throw Object.assign(new Error("Four local executions are already active. Wait for one to finish before starting another."), { statusCode: 429 });
    const response = await requestEngineService<Claim>({ url: input.claim_url, service: "HelloTest local execution claim", timeoutMs: 15000, maxResponseBytes: 16 * 1024 * 1024,
      init: { method: "POST", headers: { authorization: `Bearer ${input.grant_token}`, "x-hellotest-local-agent-id": agentId, "content-type": "application/json" }, body: JSON.stringify({ agent_id: agentId }) } });
    if (response.execution_id !== input.execution_id || !idPattern.test(response.dispatch_id) || !Number.isFinite(Date.parse(response.expires_at)) || Date.parse(response.expires_at) <= Date.now()
      || !Array.isArray(response.envelopes) || !response.envelopes.length || response.envelopes.length > maxRuns) throw new Error("The HelloTest API returned an invalid or expired local execution claim.");
    const seen = new Set<string>(); let stepCount = 0;
    for (const envelope of response.envelopes) {
      if (!idPattern.test(envelope.engine_run_id) || seen.has(envelope.engine_run_id) || getRun(envelope.engine_run_id)
        || envelope.hellotest_execution_id !== input.execution_id || !idPattern.test(envelope.hellotest_test_case_id)
        || !Array.isArray(envelope.steps) || !envelope.steps.length || !Number.isFinite(envelope.run_timeout_seconds) || envelope.run_timeout_seconds < 1 || envelope.run_timeout_seconds > 3600
        || envelope.web_engine?.active && envelope.web_engine.active !== "playwright") throw new Error("The claimed local execution contains an unsupported case or run identity.");
      seen.add(envelope.engine_run_id);
      const allSteps = [...envelope.steps, ...(envelope.hooks || []).flatMap(item => item.steps || [])]; stepCount += allSteps.length;
      if (stepCount > 10000 || allSteps.some(step => !["api", "web"].includes(step.step_type)) || !envelope.callback?.signing_secret || envelope.callback.signing_secret.length < 32) throw new Error("The claimed local execution exceeds this agent's supported limits.");
      validEndpoint(envelope.callback.url, /^\/(?:[a-zA-Z0-9._~-]+\/)*testengine\/callbacks\/runs\/?$/);
    }
    response.envelopes.sort((a, b) => Number(a.execution_policy?.execution_order || 0) - Number(b.execution_policy?.execution_order || 0));
    const record: Receipt = { execution_id: input.execution_id, dispatch_id: response.dispatch_id, status: "accepted", grant_hash: digest(input.grant_token), grant_token: input.grant_token, claim_url: input.claim_url,
      envelopes: response.envelopes, finished_run_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await persist(record); records.set(record.execution_id, record);
    for (const envelope of record.envelopes) restoreRun(envelope);
    const controller = new AbortController(); active.set(record.execution_id, controller);
    const operation = new Promise<void>(resolve => setImmediate(() => void execute(record, controller).catch(() => undefined).finally(resolve)));
    operations.set(record.execution_id, operation);
    return record;
  };
  app.post(PREFIX, { bodyLimit: 8192 }, async (request, reply) => {
    const input = request.body as { execution_id?: string; grant_token?: string; claim_url?: string };
    if (!input || Object.keys(input).some(key => !["execution_id", "grant_token", "claim_url"].includes(key)) || typeof input.execution_id !== "string" || !idPattern.test(input.execution_id)
      || typeof input.grant_token !== "string" || !/^[a-zA-Z0-9._~-]{32,1024}$/.test(input.grant_token) || typeof input.claim_url !== "string") return reply.code(400).send({ code: "LOCAL_DISPATCH_INVALID", message: "HelloTest requires a valid, authorized local execution dispatch." });
    try {
      const endpoint = validEndpoint(input.claim_url, /^\/(?:[a-zA-Z0-9._~-]+\/)*executions\/[^/]+\/local-dispatch\/claim$/);
      if (!endpoint.pathname.endsWith(`/executions/${input.execution_id}/local-dispatch/claim`)) throw new Error("The claim does not match this execution.");
      let operation = accepting.get(input.execution_id);
      if (!operation) { operation = claim(input as Required<typeof input>); accepting.set(input.execution_id, operation); }
      try {
        const record = await operation;
        if (!constantTimeSecretMatches(digest(input.grant_token), record.grant_hash) || input.claim_url !== record.claim_url) throw new Error("The dispatch credential does not match this execution.");
        return reply.code(202).send(publicReceipt(record));
      }
      finally { if (accepting.get(input.execution_id) === operation) accepting.delete(input.execution_id); }
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode) === 429 ? 429 : 400;
      return reply.code(statusCode).send({ code: statusCode === 429 ? "LOCAL_AGENT_BUSY" : "LOCAL_DISPATCH_REJECTED", message: statusCode === 429 ? "The local agent is busy. Wait for an active execution to finish." : "The local agent could not claim this authorized HelloTest execution. Reconnect the paired agent and retry this dispatch." });
    }
  });
  app.get(`${PREFIX}/:id`, async (request, reply) => {
    const record = records.get((request.params as { id: string }).id);
    return record ? publicReceipt(record) : reply.code(404).send({ code: "LOCAL_EXECUTION_NOT_FOUND", message: "This local agent has not accepted that execution." });
  });
  app.post(`${PREFIX}/:id/cancel`, async (request, reply) => {
    const id = (request.params as { id: string }).id, record = records.get(id);
    if (!record) return reply.code(404).send({ code: "LOCAL_EXECUTION_NOT_FOUND", message: "This local agent has not accepted that execution." });
    active.get(id)?.abort(new Error("This local execution was cancelled."));
    return { ...publicReceipt(record), cancellation_requested: true };
  });
  app.addHook("onClose", async () => {
    closing = true; clearInterval(retryTimer);
    for (const controller of active.values()) controller.abort(new Error("The local agent is stopping."));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...operations.values()]), new Promise<void>(resolve => { timeout = setTimeout(resolve, 30000); })]); }
    finally { if (timeout) clearTimeout(timeout); }
  });
  return { agent_id: agentId, capabilities: { repository_inspection: true, local_execution: true }, execution_protocol_version: 1 };
}
