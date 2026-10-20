import { automationStepOptions, optionalStepFailureNote } from "./automationStepOptions.js";
import { buildAcceptedRun } from "./pipeline.js";
import {
  completeQueuedJobWithMetadata,
  isHelloTestQueueConfigured,
  leaseNextQueuedJob,
  reportQueuedStep,
  startQueuedJob
} from "./hellotestClient.js";
import { saveRun, updateRun } from "./runStore.js";
import { createWebRunSession } from "./webEngine.js";
import { executeApiStepInEngine } from "./apiEngine.js";
import {
  createMobileRunSession,
  type MobileExecutionResult,
  getMobileEngineConfigurationError,
  isMobileEngineConfigured
} from "./mobileEngine.js";
import type { EngineQueuedJob, EngineRunStep, EngineRunHook } from "../contracts/hellotest.js";
import { registerContextValue } from "./runtimeContext.js";
import { createExecutionOutputRedactor } from "./executionOutputRedaction.js";

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

type OpsTelemetrySink = {
  captureLocalEvent: (payload: Record<string, unknown>) => unknown;
};

export type QueueWorkerHealthSnapshot = {
  configured: boolean;
  required: boolean;
  ready: boolean;
  status: "disabled" | "misconfigured" | "starting" | "ready" | "degraded" | "stopping" | "stopped";
  accepting_work: boolean;
  polling: boolean;
  active_jobs: number;
  poll_interval_ms: number;
  poll_concurrency: number;
  engine_class: string | null;
  started_at: string;
  last_poll_started_at: string | null;
  last_poll_completed_at: string | null;
  last_successful_poll_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

export type QueueWorkerController = {
  getHealthSnapshot: () => QueueWorkerHealthSnapshot;
  pollNow: () => Promise<void>;
  stop: (options?: { timeoutMs?: number }) => Promise<void>;
};

type QueueWorkerDependencies = {
  isConfigured?: () => boolean;
  leaseNextJob?: typeof leaseNextQueuedJob;
  executeJob?: typeof executeQueuedJob;
  pollIntervalMs?: number;
  pollConcurrency?: number;
  engineClass?: string | null;
  queueRequired?: boolean;
  now?: () => Date;
};

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

const normalizeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const clampPollInterval = (value: number) =>
  Math.round(Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, value)));

const resolvePollIntervalMs = () => {
  const configuredMs = normalizeNumber(process.env.TESTENGINE_POLL_INTERVAL_MS);

  if (configuredMs !== null) {
    return clampPollInterval(configuredMs);
  }

  const configuredMinutes = normalizeNumber(process.env.TESTENGINE_POLL_INTERVAL_MINUTES);

  if (configuredMinutes !== null) {
    return clampPollInterval(configuredMinutes * 60 * 1000);
  }

  return DEFAULT_POLL_INTERVAL_MS;
};

const POLL_INTERVAL_MS = resolvePollIntervalMs();
const POLL_CONCURRENCY = Math.max(
  1,
  Math.min(8, Math.trunc(normalizeNumber(process.env.TESTENGINE_POLL_CONCURRENCY) ?? 4))
);
const ENGINE_CLASS_VALUES = new Set(["api", "web", "android"]);

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const resolveWorkerEngineClass = () => {
  const normalized = String(process.env.TESTENGINE_WORKER_CLASS || process.env.TESTENGINE_ENGINE_CLASS || "")
    .trim()
    .toLowerCase();

  return ENGINE_CLASS_VALUES.has(normalized) ? normalized : null;
};

const nowIso = () => new Date().toISOString();

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error || "Unknown error")
  };
};

const formatWorkerErrorMessage = (error: unknown, fallback: string) => {
  const serialized = serializeError(error);
  const stack = "stack" in serialized ? serialized.stack : "";

  return stack
    ? `${serialized.message}\nStack:\n${stack}`
    : String(serialized.message || fallback);
};

function captureTelemetry(telemetry: OpsTelemetrySink | undefined, payload: Record<string, unknown>) {
  if (!telemetry) {
    return;
  }

  try {
    telemetry.captureLocalEvent(payload);
  } catch {
    // Logging must not become another reason queue execution fails.
  }
}
const emitTelemetry = captureTelemetry;

function buildJobTelemetry(job: EngineQueuedJob, workerId: string, extra: Record<string, unknown> = {}) {
  const envelope = job.payload;

  return {
    worker: {
      id: workerId
    },
    job: {
      id: job.id,
      engine_run_id: job.engine_run_id,
      status: job.status,
      lease_expires_at: job.lease_expires_at || null
    },
    project_id: envelope.project?.id || null,
    execution: {
      id: envelope.hellotest_execution_id || envelope.hellotest_run_id,
      name: envelope.manual_spec?.title || job.test_case_title
    },
    test_case: {
      id: job.test_case_id,
      title: job.test_case_title
    },
    ...extra
  };
}

function writeRunState(runId: string, state: "queued" | "running" | "completed" | "failed" | "incident", summary: string) {
  updateRun(runId, (current) => ({
    ...current,
    state,
    summary,
    updated_at: nowIso()
  }));
}

function syncCapturedValuesToWebContext(
  captures: Record<string, string> | undefined,
  webRunSession: ReturnType<typeof createWebRunSession> | null
) {
  if (!webRunSession || !captures) {
    return;
  }

  Object.entries(captures).forEach(([key, value]) => {
    registerContextValue(webRunSession.context, key, value);
  });
}

function mergeArtifactBundle(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined
) {
  if (!patch || !Object.keys(patch).length) {
    return base;
  }

  const baseRefs = Array.isArray(base?.artifact_refs) ? base.artifact_refs : [];
  const patchRefs = Array.isArray(patch.artifact_refs) ? patch.artifact_refs : [];
  const mergedRefs = [...baseRefs, ...patchRefs].reduce<unknown[]>((items, ref) => {
    if (!ref || typeof ref !== "object") {
      return items;
    }

    const key = `${(ref as { kind?: unknown }).kind || ""}:${(ref as { path?: unknown }).path || ""}:${(ref as { file_name?: unknown }).file_name || ""}`;
    const existingIndex = items.findIndex((item) => {
      const existing = item as { kind?: unknown; path?: unknown; file_name?: unknown };
      return `${existing.kind || ""}:${existing.path || ""}:${existing.file_name || ""}` === key;
    });

    if (existingIndex >= 0) {
      items[existingIndex] = ref;
      return items;
    }

    items.push(ref);
    return items;
  }, []);

  return {
    ...(base || {}),
    ...patch,
    artifact_refs: mergedRefs
  };
}

function buildAutomationDetail(step: EngineRunStep, status: "passed" | "failed" | "blocked" | "skipped", note?: string | null, provider?: string | null) {
  const code =
    String(step.automation_code || "").trim()
    || (step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : "")
    || String(step.action || "");

  return {
    engine: step.step_type,
    provider: provider || null,
    status,
    code,
    language: step.step_type === "api" ? "json" : "javascript",
    active_line: null,
    error_line: status === "failed" || status === "blocked" ? 1 : null,
    error_message: status === "failed" || status === "blocked" ? note || null : null,
    ended_at: nowIso()
  };
}

export async function executeQueuedJob(
  job: EngineQueuedJob,
  workerId: string,
  logger: Logger,
  telemetry?: OpsTelemetrySink
) {
  const envelope = {
    ...job.payload,
    steps: Array.isArray(job.payload?.steps) ? job.payload.steps : []
  };
  const existingStatuses = job.runtime_state?.logs?.stepStatuses || {};
  const orderedSteps = envelope.steps
    .slice()
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  const caseStepIds = new Set(orderedSteps.map((step) => step.id));
  const passedStepIds = new Set(orderedSteps.filter((step) => existingStatuses[step.id] === "passed").map((step) => step.id));
  const accepted = saveRun(buildAcceptedRun(envelope), envelope);
  const webRunSession = [...orderedSteps, ...(envelope.hooks || []).flatMap((hook) => hook.steps || [])].some((step) => step.step_type === "web" && !automationStepOptions(step).skip)
    ? createWebRunSession(envelope, job.runtime_state?.captured_values || {})
    : null;
  const mobileRunSession = createMobileRunSession(envelope, (error) => logger.error({ error, jobId: job.id }, "Unable to close Mobile Engine session"));
  let capturedValues = { ...(job.runtime_state?.captured_values || {}) };
  const redactOutput = createExecutionOutputRedactor(envelope, () => [webRunSession?.context, {values: capturedValues}]);
  const updateRunState: typeof writeRunState = (id, state, summary) => writeRunState(id, state, redactOutput(summary));
  const emitTelemetry = (sink: OpsTelemetrySink | undefined, payload: Record<string, unknown>) => captureTelemetry(sink, redactOutput(payload));
  const originalLogger = logger;
  logger = {
    info: (message, ...args) => originalLogger.info(redactOutput(message), ...args.map(value => redactOutput(value))),
    error: (message, ...args) => originalLogger.error(redactOutput(message), ...args.map(value => redactOutput(value)))
  };
  const executeApiStep = async (step: EngineRunStep) => {
    try {
      const result = await executeApiStepInEngine(envelope, step, capturedValues);
      return automationStepOptions(step).optional && result.status === "failed"
        ? { ...result, status: "skipped" as const, note: optionalStepFailureNote(result.note), captures: {} }
        : result;
    } catch (error) {
      if (!automationStepOptions(step).optional) throw error;
      return { status: "skipped" as const, note: optionalStepFailureNote(error instanceof Error ? error.message : "API execution failed."), captures: {}, evidence: null, detail: null };
    }
  };
  const executeWebStep = async (step: EngineRunStep) => {
    if (!webRunSession) throw new Error("Web session is unavailable.");
    try {
      const result = await webRunSession.runStep(step);
      return automationStepOptions(step).optional && result.status === "failed"
        ? { ...result, status: "skipped" as const, note: optionalStepFailureNote(result.note), captures: {} }
        : result;
    } catch (error) {
      if (!automationStepOptions(step).optional) throw error;
      return { status: "skipped" as const, note: optionalStepFailureNote(error instanceof Error ? error.message : "Web execution failed."), captures: {}, evidence: null, web_detail: undefined, line_results: [], recovery_attempted: false, recovery_succeeded: false };
    }
  };
  let healingAttempted = Boolean(job.runtime_state?.healing_attempted);
  let healingSucceeded = Boolean(job.runtime_state?.healing_succeeded);
  const patchProposals: Array<Record<string, unknown>> = [];
  const pendingStepReports: Array<Promise<void>> = [];
  let reportChain = Promise.resolve();
  let reportFailure: unknown = null;
  const reportedStepIds = new Set<string>();
  const enqueueStepReport = (stepId: string, payload: Parameters<typeof reportQueuedStep>[2]) => {
    reportedStepIds.add(stepId);
    if (caseStepIds.has(stepId)) {
      if (payload.status === "passed") passedStepIds.add(stepId);
      else passedStepIds.delete(stepId);
    }
    // Captures are also the authenticated resume protocol. Keep that transport
    // raw; the API persists its redacted public projection separately.
    const publicPayload = {...redactOutput(payload), captures: payload.captures};
    const reportPromise = reportChain.then(() => reportQueuedStep(job.id, stepId, publicPayload))
      .then((report) => {
        syncCapturedValuesToWebContext(report.captures, webRunSession);
      })
      .catch((error) => {
        reportFailure = error;
        logger.error({ error, jobId: job.id, stepId }, "Unable to report queued step result back to HelloTest");
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.step.report.failed",
          status: "failed",
          summary: "Unable to report queued step result back to HelloTest.",
          error: serializeError(error)
        }));
      });

    reportChain = reportPromise;
    pendingStepReports.push(reportPromise);
  };
  const flushStepReports = async () => {
    if (!pendingStepReports.length) {
      return;
    }

    await Promise.allSettled(pendingStepReports);
    if (reportFailure) throw new Error("Unable to persist all step results to HelloTest. This run cannot be marked passed.");
  };
  let webRunSessionStopped = false;
  let currentStep: EngineRunStep | null = null;
  const stopWebRunSession = async (finalStatus?: "passed" | "failed" | "blocked") => {
    if (!webRunSession || webRunSessionStopped) {
      return {};
    }

    webRunSessionStopped = true;
    try {
      return await webRunSession.stop(finalStatus);
    } catch (error) {
      logger.error({ error, jobId: job.id }, "Unable to finalize web automation artifacts");
      return {};
    }
  };

  let hookFailure: "failed" | "blocked" | null = null;
  let postHooksRun = false;
  const runHooks = async (phase: EngineRunHook["phase"]) => {
    for (const hook of (envelope.hooks || []).filter((entry) => entry.phase === phase)) {
      if (hook.scope !== "test") throw new Error(`Hook "${hook.name}" uses ${hook.scope} scope, which requires coordinated scheduling. Use Before Test or After Test for this case.`);
      if (!hook.steps?.length) throw new Error(`Hook "${hook.name}" has no executable snapshot. Select a hook case included in this run.`);
      for (const source of [...hook.steps].sort((a, b) => a.order - b.order)) {
        const step = { ...source, id: `${hook.scope}:${hook.phase}:${hook.id}:${source.id}` };
        let payload: Parameters<typeof reportQueuedStep>[2];
        try {
          if (automationStepOptions(step).skip) {
            payload = { status: "skipped", note: "Section skipped by its saved execution options.", captures: {} };
          } else if (step.step_type === "api") {
            const result = await executeApiStep(step);
            payload = { status: result.status, note: result.note, evidence: result.evidence, api_detail: result.detail as unknown as Record<string, unknown>, captures: result.captures };
          } else if (step.step_type === "web" && webRunSession) {
            const result = await executeWebStep(step);
            payload = { status: result.status, note: result.note, evidence: result.evidence, web_detail: result.web_detail, captures: result.captures, automation_detail: { ...buildAutomationDetail(step, result.status === "skipped" ? "failed" : result.status, result.note, webRunSession.provider), line_results: result.line_results } };
          } else if (step.step_type === "android" || step.step_type === "ios") {
            const result = (await mobileRunSession.run([step], capturedValues)).results[0];
            payload = result ? { status: result.status, note: result.note, evidence: result.evidence, captures: result.captures } : { status: "blocked", note: "Mobile hook returned no result." };
          } else throw new Error(`Unsupported hook runtime ${step.step_type}`);
        } catch (error) { payload = { status: "failed", note: error instanceof Error ? error.message : "Hook failed" }; }
        if (automationStepOptions(step).optional && payload.status === "failed") {
          payload = { ...payload, status: "skipped", note: optionalStepFailureNote(payload.note), captures: {} };
        }
        payload.note = `[${phase === "pre" ? "Before" : "After"} ${hook.scope}] ${hook.name} · ${step.action}
${payload.note || ""}`;
        payload.automation_detail ||= buildAutomationDetail(step, payload.status, payload.note, step.step_type);
        enqueueStepReport(step.id, payload);
        await flushStepReports();
        capturedValues = { ...capturedValues, ...payload.captures };
        syncCapturedValuesToWebContext(payload.captures, webRunSession);
        if (payload.status !== "passed" && payload.status !== "skipped") {
          if (hook.fail_behavior !== "continue") {
            hookFailure = hook.fail_behavior === "mark-blocked" ? "blocked" : "failed";
            if (phase === "pre") throw new Error(payload.note);
          }
          break;
        }
      }
    }
  };
  const finalizeArtifacts = async (status?: "passed" | "failed" | "blocked") => {
    if (!postHooksRun) {
      postHooksRun = true;
      try { await runHooks("post"); } catch (error) {
        hookFailure = "failed";
        logger.error({ error, jobId: job.id }, "Unable to complete teardown hooks");
      }
    }
    return stopWebRunSession(status === "failed" ? status : hookFailure || status);
  };
  const completeJob = (id: string, payload: Parameters<typeof completeQueuedJobWithMetadata>[1]) => completeQueuedJobWithMetadata(id, redactOutput({
    ...payload,
    ...(hookFailure && payload.status !== "failed" ? { status: hookFailure, error: "A configured execution hook failed. Inspect hook results.", summary: "A configured execution hook failed. Inspect hook results." } : {})
  }));

  let executionStarted = false;
  try {
    await startQueuedJob(job.id, workerId);
    executionStarted = true;
    updateRunState(accepted.id, "running", `Leased ${job.test_case_title} from HelloTest queue.`);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.started",
      status: "running",
      summary: `${job.test_case_title} started in the Test Engine queue worker.`
    }));

    if (!orderedSteps.length) {
      const emptyJobSummary = `${job.test_case_title} has no executable API, web, Android, or iOS steps in its queued snapshot.`;
      updateRunState(accepted.id, "failed", emptyJobSummary);
      await completeJob(job.id, {
        status: "failed",
        error: emptyJobSummary,
        summary: emptyJobSummary,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded
      });
      emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
        event_type: "testengine.queue.job.failed",
        status: "failed",
        summary: emptyJobSummary
      }));
      return;
    }

    const remainingSteps = orderedSteps.filter((step) => !["passed", "skipped"].includes(existingStatuses[step.id]));

    if (!remainingSteps.length) {
      const finalStatus = passedStepIds.size ? "passed" : "blocked";
      await completeJob(job.id, {
        status: finalStatus,
        summary: `${job.test_case_title} was already complete.`,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded
      });
      updateRunState(accepted.id, finalStatus === "passed" ? "completed" : "incident", `${job.test_case_title} was already complete.`);
      emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
        event_type: "testengine.queue.job.completed",
        status: finalStatus,
        summary: `${job.test_case_title} was already complete.`
      }));
      return;
    }

    if (webRunSession) {
      try {
        await webRunSession.start();
      } catch (error) {
        const message = formatWorkerErrorMessage(error, `${job.test_case_title} could not start the web automation session.`);
        const startupStep = remainingSteps.find((step) => step.step_type === "web");
        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("failed"));

        updateRunState(accepted.id, "failed", message);

        if (startupStep && !reportedStepIds.has(startupStep.id)) {
          enqueueStepReport(startupStep.id, {
            status: "failed",
            note: [
              `${job.test_case_title} could not start the web automation session before step ${startupStep.order}.`,
              message
            ].join("\n"),
            evidence: null,
            web_detail: null,
            automation_detail: buildAutomationDetail(startupStep, "failed", message, webRunSession.provider),
            captures: {}
          });
        }

        await flushStepReports();
        await completeJob(job.id, {
          status: "failed",
          error: message,
          summary: message,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded,
          artifact_bundle: artifactBundle,
          patch_proposals: patchProposals
        });
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.job.failed",
          status: "failed",
          summary: message,
          error: serializeError(error),
          step: startupStep
            ? {
                id: startupStep.id,
                order: startupStep.order,
                type: startupStep.step_type
              }
            : undefined
        }));
        return;
      }
    }

    await runHooks("pre");

    const mobileResultsByStepId = new Map<string, MobileExecutionResult["results"][number]>();
    for (const [index, step] of remainingSteps.entries()) {
      currentStep = step;
      updateRunState(
        accepted.id,
        "running",
        `${job.test_case_title}: executing ${step.step_type.toUpperCase()} step ${index + 1} of ${remainingSteps.length}.`
      );

      if (automationStepOptions(step).skip) {
        enqueueStepReport(step.id, { status: "skipped", note: "Section skipped by its saved execution options.", captures: {}, automation_detail: buildAutomationDetail(step, "skipped") });
        currentStep = null;
        continue;
      }

      if (step.step_type === "api") {
        const result = await executeApiStep(step);
        enqueueStepReport(step.id, {
          status: result.status,
          note: result.note,
          evidence: result.evidence,
          api_detail: result.detail as unknown as Record<string, unknown>,
          automation_detail: buildAutomationDetail(step, result.status === "skipped" ? "failed" : result.status, result.note, "api"),
          captures: result.captures
        });
        capturedValues = {
          ...capturedValues,
          ...(result.captures || {})
        };
        syncCapturedValuesToWebContext(result.captures, webRunSession);

        if (result.status === "failed") {
          const failureSummary = result.note || `${job.test_case_title} failed on step ${step.order}.`;
          const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("failed"));
          updateRunState(accepted.id, "failed", failureSummary);
          await flushStepReports();
          await completeJob(job.id, {
            status: "failed",
            error: failureSummary,
            summary: failureSummary,
            deterministic_attempted: true,
            healing_attempted: healingAttempted,
            healing_succeeded: healingSucceeded,
            artifact_bundle: artifactBundle
          });
          emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
            event_type: "testengine.queue.job.failed",
            status: "failed",
            summary: failureSummary,
            step: {
              id: step.id,
              order: step.order,
              type: step.step_type
            }
          }));
          return;
        }

        currentStep = null;
        continue;
      }

      if (step.step_type === "android" || step.step_type === "ios") {
        if (!mobileResultsByStepId.has(step.id)) {
          // A contiguous mobile block shares a driver while respecting API/web
          // preconditions and captures produced earlier in the authored plan.
          const mobileBlock: EngineRunStep[] = [];
          for (const next of remainingSteps.slice(index)) {
            const options = automationStepOptions(next);
            if (next.step_type !== step.step_type || options.skip || (mobileBlock.length && options.optional)) break;
            mobileBlock.push(next);
            if (options.optional) break;
          }
          if (!isMobileEngineConfigured()) {
            const message = `${job.test_case_title} requires ${step.step_type} execution, but the Mobile Engine client is not ready: ${getMobileEngineConfigurationError() || "unknown configuration error"}.`;
            for (const mobileStep of mobileBlock) {
              mobileResultsByStepId.set(mobileStep.id, { step_id: mobileStep.id, status: "blocked", note: message });
            }
          } else {
            const mobileResult = await mobileRunSession.run(mobileBlock, capturedValues);
            for (const mobileStep of mobileBlock) {
              mobileResultsByStepId.set(mobileStep.id, {
                step_id: mobileStep.id,
                status: "blocked",
                note: "Mobile Engine did not return a result for this step."
              });
            }
            for (const mobileStep of mobileResult.results || []) {
              mobileResultsByStepId.set(mobileStep.step_id, mobileStep);
            }
          }
        }
        const mobileResult = mobileResultsByStepId.get(step.id) || { step_id: step.id, status: "blocked" as const, note: "Mobile Engine did not return a result for this step." };
        const result = automationStepOptions(step).optional && mobileResult.status === "failed"
          ? { ...mobileResult, status: "skipped" as const, note: optionalStepFailureNote(mobileResult.note), captures: {} }
          : mobileResult;
        const message = result.note || `${job.test_case_title} ${step.step_type} step ${step.order} finished with ${result.status}.`;
        enqueueStepReport(step.id, {
          status: result.status,
          note: message,
          evidence: result.evidence || null,
          web_detail: null,
          automation_detail: buildAutomationDetail(step, result.status === "skipped" ? "failed" : result.status, message, envelope.mobile_engine?.active || "mobile"),
          captures: result.captures || {}
        });
        capturedValues = { ...capturedValues, ...(result.captures || {}) };
        syncCapturedValuesToWebContext(result.captures, webRunSession);

        if (result.status === "passed" || result.status === "skipped") {
          currentStep = null;
          continue;
        }

        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("blocked"));
        updateRunState(accepted.id, "failed", message);
        await flushStepReports();
        await completeJob(job.id, {
          status: result.status,
          error: message,
          summary: message,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded,
          artifact_bundle: artifactBundle
        });
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.job.blocked",
          status: "blocked",
          summary: message,
          step: {
            id: step.id,
            order: step.order,
            type: step.step_type
          }
        }));
        return;
      }

      if (step.step_type !== "web" || !webRunSession) {
        const message = `${job.test_case_title} includes unsupported step type ${step.step_type}.`;
        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("failed"));
        updateRunState(accepted.id, "failed", message);
        await flushStepReports();
        await completeJob(job.id, {
          status: "failed",
          error: message,
          summary: message,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded,
          artifact_bundle: artifactBundle
        });
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.job.failed",
          status: "failed",
          summary: message,
          step: {
            id: step.id,
            order: step.order,
            type: step.step_type
          }
        }));
        return;
      }

      const stepResult = await executeWebStep(step);
      healingAttempted = healingAttempted || stepResult.recovery_attempted;
      healingSucceeded = healingSucceeded || stepResult.recovery_succeeded;
      if (stepResult.recovery_succeeded) {
        patchProposals.push({
          kind: "script",
          status: "review",
          summary: `Step ${step.order} passed after a configured retry. The automation code was unchanged; review the step for unstable locators or timing.`,
          target_path: `hellotest://test-cases/${envelope.hellotest_test_case_id}/steps/${step.id}`
        });
      }
      enqueueStepReport(step.id, {
        status: stepResult.status,
        note: stepResult.note,
        evidence: stepResult.evidence || null,
        web_detail: stepResult.web_detail,
        automation_detail: { ...buildAutomationDetail(step, stepResult.status === "skipped" ? "failed" : stepResult.status, stepResult.note, stepResult.web_detail?.provider || webRunSession.provider), line_results: stepResult.line_results },
        captures: stepResult.captures,
        recovery_attempted: stepResult.recovery_attempted,
        recovery_succeeded: stepResult.recovery_succeeded
      });
      capturedValues = {
        ...capturedValues,
        ...(stepResult.captures || {})
      };
      syncCapturedValuesToWebContext(stepResult.captures, webRunSession);

      if (stepResult.status === "failed") {
        const failureSummary = stepResult.note || `${job.test_case_title} failed on step ${step.order}.`;
        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("failed"));
        updateRunState(accepted.id, "failed", failureSummary);
        await flushStepReports();
        await completeJob(job.id, {
          status: "failed",
          error: failureSummary,
          summary: failureSummary,
          deterministic_attempted: true,
          healing_attempted: healingAttempted,
          healing_succeeded: healingSucceeded,
          artifact_bundle: artifactBundle,
          patch_proposals: patchProposals
        });
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.job.failed",
          status: "failed",
          summary: failureSummary,
          step: {
            id: step.id,
            order: step.order,
            type: step.step_type
          }
        }));
        return;
      }

      currentStep = null;
    }

    const finalStatus = passedStepIds.size ? "passed" : "blocked";
    const completionSummary = finalStatus === "passed" ? `${job.test_case_title} completed successfully.` : `${job.test_case_title} has no passing executed sections; skipped sections do not establish a pass.`;
    const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts(finalStatus));
    await flushStepReports();
    await completeJob(job.id, {
      status: finalStatus,
      summary: completionSummary,
      deterministic_attempted: true,
      healing_attempted: healingAttempted,
      healing_succeeded: healingSucceeded,
      artifact_bundle: artifactBundle,
      patch_proposals: patchProposals
    });
    updateRunState(accepted.id, finalStatus === "passed" ? "completed" : "incident", completionSummary);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.completed",
      status: finalStatus,
      summary: completionSummary
    }));
  } catch (error) {
    if (!executionStarted) {
      updateRunState(accepted.id, "incident", "The queued execution start was not authorized. No sections or hooks executed.");
      logger.error({ error, jobId: job.id }, "Queued job start was not authorized; no sections or hooks executed");
      return;
    }
    const message = formatWorkerErrorMessage(error, `${job.test_case_title} failed in queue worker.`);
    updateRunState(accepted.id, "failed", message);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.crashed",
      status: "failed",
      summary: message,
      error: serializeError(error)
    }));

    try {
      const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await finalizeArtifacts("failed"));
      if (currentStep && !reportedStepIds.has(currentStep.id)) {
        enqueueStepReport(currentStep.id, {
          status: "failed",
          note: [
            `${job.test_case_title} failed on step ${currentStep.order}.`,
            message
          ].join("\n"),
          evidence: null,
          web_detail: null,
          automation_detail: buildAutomationDetail(currentStep, "failed", message, currentStep.step_type),
          captures: {}
        });
      }
      await flushStepReports();
      await completeJob(job.id, {
        status: "failed",
        error: message,
        summary: message,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded,
        artifact_bundle: artifactBundle,
        patch_proposals: patchProposals
      });
    } catch (reportError) {
      logger.error({ error: reportError, jobId: job.id }, "Unable to report queued job failure back to HelloTest");
      emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
        event_type: "testengine.queue.report.failed",
        status: "failed",
        summary: "Unable to report queued job failure back to HelloTest.",
        error: serializeError(reportError)
      }));
    }
  } finally {
    if (executionStarted && webRunSession && !webRunSessionStopped) {
      try {
        await finalizeArtifacts();
      } catch (stopError) {
        logger.error({ error: stopError, jobId: job.id }, "Unable to stop web automation session cleanly");
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.web-session.stop.failed",
          status: "failed",
          summary: "Unable to stop web automation session cleanly.",
          error: serializeError(stopError)
        }));
      }
    }
    await mobileRunSession.close();
  }
}

export function startQueueWorker(
  logger: Logger,
  telemetry?: OpsTelemetrySink,
  dependencies: QueueWorkerDependencies = {}
): QueueWorkerController {
  const workerStartedAt = (dependencies.now || (() => new Date()))().toISOString();
  const pollIntervalMs = Math.max(1, dependencies.pollIntervalMs ?? POLL_INTERVAL_MS);
  const pollConcurrency = Math.max(1, dependencies.pollConcurrency ?? POLL_CONCURRENCY);
  const workerEngineClass = dependencies.engineClass === undefined
    ? resolveWorkerEngineClass()
    : dependencies.engineClass;
  const queueConfigured = (dependencies.isConfigured || isHelloTestQueueConfigured)();
  const queueRequired = dependencies.queueRequired ?? normalizeBoolean(
    process.env.TESTENGINE_QUEUE_REQUIRED,
    Boolean(process.env.TESTENGINE_WORKER_CLASS || process.env.TESTENGINE_ENGINE_CLASS)
  );
  const now = dependencies.now || (() => new Date());
  const leaseJob = dependencies.leaseNextJob || leaseNextQueuedJob;
  const executeJob = dependencies.executeJob || executeQueuedJob;

  if (!queueConfigured) {
    let stopped = false;
    logger.info("HelloTest queue pull mode is disabled because HELLOTEST_API_BASE_URL is not configured.");
    emitTelemetry(telemetry, {
      event_type: "testengine.queue.worker.disabled",
      status: queueRequired ? "failed" : "disabled",
      summary: queueRequired
        ? "HelloTest queue pull mode is required but is not configured."
        : "HelloTest queue pull mode is disabled because HELLOTEST_API_BASE_URL is not configured.",
      configuration: {
        queue_required: queueRequired,
        hellotest_api_base_url_configured: Boolean(process.env.HELLOTEST_API_BASE_URL),
        hellotest_testengine_secret_configured: Boolean(process.env.HELLOTEST_TESTENGINE_SECRET || process.env.TESTENGINE_SHARED_SECRET)
      }
    });

    return {
      getHealthSnapshot: () => ({
        configured: false,
        required: queueRequired,
        ready: !queueRequired && !stopped,
        status: stopped ? "stopped" : queueRequired ? "misconfigured" : "disabled",
        accepting_work: false,
        polling: false,
        active_jobs: 0,
        poll_interval_ms: pollIntervalMs,
        poll_concurrency: pollConcurrency,
        engine_class: workerEngineClass,
        started_at: workerStartedAt,
        last_poll_started_at: null,
        last_poll_completed_at: null,
        last_successful_poll_at: null,
        last_error_at: null,
        last_error: queueRequired ? "Queue pull mode is required but is not configured" : null,
        consecutive_failures: 0
      }),
      pollNow: async () => undefined,
      stop: async () => {
        stopped = true;
      }
    };
  }

  const activeJobs = new Set<string>();
  const activeExecutions = new Set<Promise<void>>();
  let isPolling = false;
  let stopping = false;
  let stopped = false;
  let currentPoll: Promise<void> | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let stopPromise: Promise<void> | null = null;
  let lastPollStartedAt: string | null = null;
  let lastPollCompletedAt: string | null = null;
  let lastSuccessfulPollAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastError: string | null = null;
  let consecutiveFailures = 0;
  let lastPollSummaryAt: number | null = null;
  let successfulPollsSinceSummary = 0;
  let leasedJobsSinceSummary = 0;

  const boundedErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || "");
    const statusMatch = /HelloTest internal API returned (\d{3})\b/.exec(message);

    if (statusMatch) {
      return `HelloTest queue API returned HTTP ${statusMatch[1]}`;
    }

    if (error instanceof Error && (error.name === "AbortError" || /timed?\s*out/i.test(message))) {
      return "HelloTest queue API request timed out";
    }

    return "Queue poll failed; inspect protected service logs for details";
  };

  logger.info({
    poll_interval_ms: pollIntervalMs,
    poll_concurrency: pollConcurrency,
    engine_class: workerEngineClass || "any"
  }, "HelloTest queue pull worker started");
  emitTelemetry(telemetry, {
    event_type: "testengine.queue.worker.started",
    status: "running",
    summary: `HelloTest ${workerEngineClass || "general"} queue pull worker started. Polling every ${pollIntervalMs}ms.`,
    configuration: {
      poll_interval_ms: pollIntervalMs,
      poll_concurrency: pollConcurrency,
      engine_class: workerEngineClass || "any"
    }
  });

  const trackExecution = (job: EngineQueuedJob, workerId: string) => {
    activeJobs.add(job.id);
    const execution = Promise.resolve()
      .then(() => executeJob(job, workerId, logger, telemetry))
      .catch((error) => {
        logger.error({ error, jobId: job.id }, "Queued job execution crashed");
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.job.crashed",
          status: "failed",
          summary: "Queued job execution crashed.",
          error: serializeError(error)
        }));
      });

    activeExecutions.add(execution);
    void execution.finally(() => {
      activeJobs.delete(job.id);
      activeExecutions.delete(execution);
    });
  };

  const poll = async (): Promise<void> => {
    if (currentPoll) {
      return currentPoll;
    }

    if (stopping || stopped) {
      return;
    }

    currentPoll = (async () => {
      isPolling = true;
      lastPollStartedAt = now().toISOString();

      try {
        let checkedQueue = false;
        while (!stopping && activeJobs.size < pollConcurrency) {
          const workerId = `${process.env.ENGINE_NAME || "hellotest-testengine"}:${workerEngineClass || "any"}:${process.pid}:${activeJobs.size + 1}`;
          const job = await leaseJob(workerId, workerEngineClass);
          checkedQueue = true;

          if (!job || activeJobs.has(job.id)) {
            break;
          }

          trackExecution(job, workerId);
          leasedJobsSinceSummary += 1;
        }

        const recovered = consecutiveFailures > 0;
        consecutiveFailures = 0;
        lastError = null;
        lastSuccessfulPollAt = now().toISOString();
        if (checkedQueue) {
          successfulPollsSinceSummary += 1;
          const timestamp = now().getTime();
          // A bounded heartbeat makes idle workers visible without storing every
          // one-second lease attempt. Recovery is reported immediately.
          if (lastPollSummaryAt === null || recovered || timestamp - lastPollSummaryAt >= 300_000) {
            emitTelemetry(telemetry, {
              event_type: recovered ? "testengine.queue.poll.recovered" : "testengine.queue.poll.summary",
              status: "ready",
              summary: `${workerEngineClass || "General"} worker ${recovered ? "polling recovered" : "polling successfully"}: ${successfulPollsSinceSummary} successful queue checks, ${leasedJobsSinceSummary} jobs leased, ${activeJobs.size} active jobs.`,
              metadata: { successful_polls: successfulPollsSinceSummary, jobs_leased: leasedJobsSinceSummary, active_jobs: activeJobs.size, poll_interval_ms: pollIntervalMs, last_successful_poll_at: lastSuccessfulPollAt }
            });
            lastPollSummaryAt = timestamp;
            successfulPollsSinceSummary = 0;
            leasedJobsSinceSummary = 0;
          }
        }
      } catch (error) {
        consecutiveFailures += 1;
        lastErrorAt = now().toISOString();
        lastError = boundedErrorMessage(error);
        logger.error({ error }, "Unable to poll HelloTest queued jobs");
        emitTelemetry(telemetry, {
          event_type: "testengine.queue.poll.failed",
          status: "failed",
          summary: "Unable to poll HelloTest queued jobs.",
          error: serializeError(error)
        });
      } finally {
        lastPollCompletedAt = now().toISOString();
        isPolling = false;
      }
    })();

    try {
      await currentPoll;
    } finally {
      currentPoll = null;
    }
  };

  const getHealthSnapshot = (): QueueWorkerHealthSnapshot => {
    const lastSuccessfulPollMs = lastSuccessfulPollAt ? Date.parse(lastSuccessfulPollAt) : Number.NaN;
    const staleAfterMs = Math.max(30_000, pollIntervalMs * 3);
    const pollIsStale = Number.isFinite(lastSuccessfulPollMs)
      && now().getTime() - lastSuccessfulPollMs > staleAfterMs;
    const ready = !stopping
      && !stopped
      && consecutiveFailures === 0
      && Boolean(lastSuccessfulPollAt)
      && !pollIsStale;
    const status = stopped
      ? "stopped"
      : stopping
        ? "stopping"
        : consecutiveFailures > 0 || pollIsStale
          ? "degraded"
          : ready
            ? "ready"
            : "starting";

    return {
      configured: true,
      required: queueRequired,
      ready,
      status,
      accepting_work: !stopping && !stopped,
      polling: isPolling,
      active_jobs: activeJobs.size,
      poll_interval_ms: pollIntervalMs,
      poll_concurrency: pollConcurrency,
      engine_class: workerEngineClass,
      started_at: workerStartedAt,
      last_poll_started_at: lastPollStartedAt,
      last_poll_completed_at: lastPollCompletedAt,
      last_successful_poll_at: lastSuccessfulPollAt,
      last_error_at: lastErrorAt,
      last_error: lastError,
      consecutive_failures: consecutiveFailures
    };
  };

  const stop = (options: { timeoutMs?: number } = {}) => {
    if (stopPromise) {
      return stopPromise;
    }

    stopping = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }

    stopPromise = (async () => {
      const configuredTimeout = normalizeNumber(options.timeoutMs ?? process.env.TESTENGINE_SHUTDOWN_TIMEOUT_MS);
      const timeoutMs = Math.max(1, Math.min(120_000, configuredTimeout ?? 30_000));
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      const drain = async () => {
        if (currentPoll) {
          await currentPoll;
        }
        await Promise.allSettled(Array.from(activeExecutions));
      };

      await Promise.race([
        drain(),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
          timeoutHandle.unref?.();
        })
      ]);

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      stopped = true;
      stopping = false;

      if (timedOut && activeJobs.size > 0) {
        logger.error({ active_jobs: activeJobs.size, timeout_ms: timeoutMs }, "Queue worker shutdown timed out while jobs were still active");
      } else {
        logger.info({ active_jobs: activeJobs.size }, "HelloTest queue pull worker stopped");
      }
    })();

    return stopPromise;
  };

  void poll();
  intervalHandle = setInterval(() => {
    void poll();
  }, pollIntervalMs);
  intervalHandle.unref?.();

  return {
    getHealthSnapshot,
    pollNow: poll,
    stop
  };
}
