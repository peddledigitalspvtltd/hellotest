import { buildAcceptedRun } from "./pipeline.js";
import {
  completeQueuedJobWithMetadata,
  isQairaQueueConfigured,
  leaseNextQueuedJob,
  reportQueuedStep,
  startQueuedJob
} from "./qairaClient.js";
import { saveRun, updateRun } from "./runStore.js";
import { createWebRunSession } from "./webEngine.js";
import { executeApiStepInEngine } from "./apiEngine.js";
import { executeAndroidSteps, isMobileEngineConfigured } from "./mobileEngine.js";
import type { EngineQueuedJob, EngineRunStep } from "../contracts/qaira.js";
import { registerContextValue } from "./runtimeContext.js";

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

type OpsTelemetrySink = {
  captureLocalEvent: (payload: Record<string, unknown>) => unknown;
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

function emitTelemetry(telemetry: OpsTelemetrySink | undefined, payload: Record<string, unknown>) {
  if (!telemetry) {
    return;
  }

  try {
    telemetry.captureLocalEvent(payload);
  } catch {
    // Logging must not become another reason queue execution fails.
  }
}

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
      id: envelope.qaira_execution_id || envelope.qaira_run_id,
      name: envelope.manual_spec?.title || job.test_case_title
    },
    test_case: {
      id: job.test_case_id,
      title: job.test_case_title
    },
    ...extra
  };
}

function updateRunState(runId: string, state: "queued" | "running" | "completed" | "failed" | "incident", summary: string) {
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

function buildAutomationDetail(step: EngineRunStep, status: "passed" | "failed" | "blocked", note?: string | null, provider?: string | null) {
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

async function executeQueuedJob(
  job: EngineQueuedJob,
  workerId: string,
  logger: Logger,
  telemetry?: OpsTelemetrySink
) {
  const envelope = job.payload;
  const existingStatuses = job.runtime_state?.logs?.stepStatuses || {};
  const orderedSteps = envelope.steps.slice().sort((left, right) => left.order - right.order);
  const accepted = saveRun(buildAcceptedRun(envelope), envelope);
  const webRunSession = orderedSteps.some((step) => step.step_type === "web")
    ? createWebRunSession(envelope, job.runtime_state?.captured_values || {})
    : null;
  let capturedValues = { ...(job.runtime_state?.captured_values || {}) };
  let healingAttempted = Boolean(job.runtime_state?.healing_attempted);
  let healingSucceeded = Boolean(job.runtime_state?.healing_succeeded);
  const patchProposals: Array<Record<string, unknown>> = [];
  const pendingStepReports: Array<Promise<void>> = [];
  const enqueueStepReport = (stepId: string, payload: Parameters<typeof reportQueuedStep>[2]) => {
    const reportPromise = reportQueuedStep(job.id, stepId, payload)
      .then((report) => {
        syncCapturedValuesToWebContext(report.captures, webRunSession);
      })
      .catch((error) => {
        logger.error({ error, jobId: job.id, stepId }, "Unable to report queued step result back to QAira");
        emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
          event_type: "testengine.queue.step.report.failed",
          status: "failed",
          summary: "Unable to report queued step result back to QAira.",
          error: serializeError(error)
        }));
      });

    pendingStepReports.push(reportPromise);
  };
  const flushStepReports = async () => {
    if (!pendingStepReports.length) {
      return;
    }

    await Promise.allSettled(pendingStepReports);
  };
  let webRunSessionStopped = false;
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

  try {
    await startQueuedJob(job.id, workerId);
    updateRunState(accepted.id, "running", `Leased ${job.test_case_title} from QAira queue.`);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.started",
      status: "running",
      summary: `${job.test_case_title} started in the Test Engine queue worker.`
    }));

    const remainingSteps = orderedSteps.filter((step) => existingStatuses[step.id] !== "passed");

    if (!remainingSteps.length) {
      await completeQueuedJobWithMetadata(job.id, {
        status: "passed",
        summary: `${job.test_case_title} was already complete.`,
        deterministic_attempted: true,
        healing_attempted: healingAttempted,
        healing_succeeded: healingSucceeded
      });
      updateRunState(accepted.id, "completed", `${job.test_case_title} was already complete.`);
      emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
        event_type: "testengine.queue.job.completed",
        status: "passed",
        summary: `${job.test_case_title} was already complete.`
      }));
      return;
    }

    if (webRunSession) {
      await webRunSession.start();
    }

    const remainingAndroidSteps = remainingSteps.filter((step) => step.step_type === "android");
    const androidResultsByStepId = new Map<string, { status: "passed" | "failed" | "blocked"; note?: string }>();

    if (remainingAndroidSteps.length) {
      if (!isMobileEngineConfigured()) {
        const message = `${job.test_case_title} requires Android execution, but MOBILE_ENGINE_URL is not configured.`;
        for (const step of remainingAndroidSteps) {
          androidResultsByStepId.set(step.id, { status: "blocked", note: message });
        }
      } else {
        const mobileResult = await executeAndroidSteps(envelope, remainingAndroidSteps);
        for (const result of mobileResult.results || []) {
          androidResultsByStepId.set(result.step_id, {
            status: result.status,
            note: result.note
          });
        }
      }
    }

    for (const [index, step] of remainingSteps.entries()) {
      updateRunState(
        accepted.id,
        "running",
        `${job.test_case_title}: executing ${step.step_type.toUpperCase()} step ${index + 1} of ${remainingSteps.length}.`
      );

      if (step.step_type === "api") {
        const result = await executeApiStepInEngine(envelope, step, capturedValues);
        enqueueStepReport(step.id, {
          status: result.status,
          note: result.note,
          evidence: result.evidence,
          api_detail: result.detail as unknown as Record<string, unknown>,
          automation_detail: buildAutomationDetail(step, result.status, result.note, "api"),
          captures: result.captures
        });
        capturedValues = {
          ...capturedValues,
          ...(result.captures || {})
        };
        syncCapturedValuesToWebContext(result.captures, webRunSession);

        if (result.status === "failed") {
          const failureSummary = result.note || `${job.test_case_title} failed on step ${step.order}.`;
          const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("failed"));
          updateRunState(accepted.id, "failed", failureSummary);
          await flushStepReports();
          await completeQueuedJobWithMetadata(job.id, {
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

        continue;
      }

      if (step.step_type === "android") {
        const result = androidResultsByStepId.get(step.id) || { status: "blocked" as const, note: "Android Mobile Engine did not return a result for this step." };
        const message = result.note || `${job.test_case_title} Android step ${step.order} finished with ${result.status}.`;
        enqueueStepReport(step.id, {
          status: result.status,
          note: message,
          evidence: null,
          web_detail: null,
          automation_detail: buildAutomationDetail(step, result.status, message, envelope.mobile_engine?.active || "mobile"),
          captures: {}
        });

        if (result.status === "passed") {
          continue;
        }

        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("blocked"));
        updateRunState(accepted.id, "failed", message);
        await flushStepReports();
        await completeQueuedJobWithMetadata(job.id, {
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
        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("failed"));
        updateRunState(accepted.id, "failed", message);
        await flushStepReports();
        await completeQueuedJobWithMetadata(job.id, {
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

      const stepResult = await webRunSession.runStep(step);
      healingAttempted = healingAttempted || stepResult.recovery_attempted;
      healingSucceeded = healingSucceeded || stepResult.recovery_succeeded;
      if (stepResult.recovery_succeeded) {
        patchProposals.push({
          kind: "script",
          status: "review",
          summary: `Step ${step.order} recovered after a headed browser retry. Review this step for locator or wait hardening before promoting the fix.`,
          target_path: `qaira://test-cases/${envelope.qaira_test_case_id}/steps/${step.id}`
        });
      }
      enqueueStepReport(step.id, {
        status: stepResult.status,
        note: stepResult.note,
        evidence: stepResult.evidence || null,
        web_detail: stepResult.web_detail,
        automation_detail: buildAutomationDetail(step, stepResult.status, stepResult.note, stepResult.web_detail?.provider || webRunSession.provider),
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
        const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("failed"));
        updateRunState(accepted.id, "failed", failureSummary);
        await flushStepReports();
        await completeQueuedJobWithMetadata(job.id, {
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
    }

    const completionSummary = `${job.test_case_title} completed successfully.`;
    const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("passed"));
    await flushStepReports();
    await completeQueuedJobWithMetadata(job.id, {
      status: "passed",
      summary: completionSummary,
      deterministic_attempted: true,
      healing_attempted: healingAttempted,
      healing_succeeded: healingSucceeded,
      artifact_bundle: artifactBundle,
      patch_proposals: patchProposals
    });
    updateRunState(accepted.id, "completed", completionSummary);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.completed",
      status: "passed",
      summary: completionSummary
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : `${job.test_case_title} failed in queue worker.`;

    updateRunState(accepted.id, "failed", message);
    emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
      event_type: "testengine.queue.job.crashed",
      status: "failed",
      summary: message,
      error: serializeError(error)
    }));

    try {
      const artifactBundle = mergeArtifactBundle(accepted.artifact_bundle, await stopWebRunSession("failed"));
      await flushStepReports();
      await completeQueuedJobWithMetadata(job.id, {
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
      logger.error({ error: reportError, jobId: job.id }, "Unable to report queued job failure back to QAira");
      emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
        event_type: "testengine.queue.report.failed",
        status: "failed",
        summary: "Unable to report queued job failure back to QAira.",
        error: serializeError(reportError)
      }));
    }
  } finally {
    if (webRunSession && !webRunSessionStopped) {
      try {
        await stopWebRunSession();
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
  }
}

export function startQueueWorker(logger: Logger, telemetry?: OpsTelemetrySink) {
  if (!isQairaQueueConfigured()) {
    logger.info("QAira queue pull mode is disabled because QAIRA_API_BASE_URL is not configured.");
    emitTelemetry(telemetry, {
      event_type: "testengine.queue.worker.disabled",
      status: "disabled",
      summary: "QAira queue pull mode is disabled because QAIRA_API_BASE_URL is not configured.",
      configuration: {
        qaira_api_base_url_configured: Boolean(process.env.QAIRA_API_BASE_URL),
        qaira_testengine_secret_configured: Boolean(process.env.QAIRA_TESTENGINE_SECRET || process.env.TESTENGINE_SHARED_SECRET)
      }
    });
    return;
  }

  const activeJobs = new Set<string>();
  let isPolling = false;
  const workerEngineClass = resolveWorkerEngineClass();

  logger.info({
    poll_interval_ms: POLL_INTERVAL_MS,
    poll_concurrency: POLL_CONCURRENCY,
    engine_class: workerEngineClass || "any"
  }, "QAira queue pull worker started");
  emitTelemetry(telemetry, {
    event_type: "testengine.queue.worker.started",
    status: "running",
    summary: `QAira ${workerEngineClass || "general"} queue pull worker started. Polling every ${POLL_INTERVAL_MS}ms.`,
    configuration: {
      poll_interval_ms: POLL_INTERVAL_MS,
      poll_concurrency: POLL_CONCURRENCY,
      engine_class: workerEngineClass || "any"
    }
  });

  const poll = async () => {
    if (isPolling) {
      return;
    }

    isPolling = true;

    try {
      while (activeJobs.size < POLL_CONCURRENCY) {
        const workerId = `${process.env.ENGINE_NAME || "qaira-testengine"}:${workerEngineClass || "any"}:${process.pid}:${activeJobs.size + 1}`;
        const job = await leaseNextQueuedJob(workerId, workerEngineClass);

        if (!job || activeJobs.has(job.id)) {
          break;
        }

        activeJobs.add(job.id);

        void executeQueuedJob(job, workerId, logger, telemetry)
          .catch((error) => {
            logger.error({ error, jobId: job.id }, "Queued job execution crashed");
            emitTelemetry(telemetry, buildJobTelemetry(job, workerId, {
              event_type: "testengine.queue.job.crashed",
              status: "failed",
              summary: "Queued job execution crashed.",
              error: serializeError(error)
            }));
          })
          .finally(() => {
            activeJobs.delete(job.id);
          });
      }
    } catch (error) {
      logger.error({ error }, "Unable to poll QAira queued jobs");
      emitTelemetry(telemetry, {
        event_type: "testengine.queue.poll.failed",
        status: "failed",
        summary: "Unable to poll QAira queued jobs.",
        error: serializeError(error)
      });
    } finally {
      isPolling = false;
    }
  };

  void poll();
  setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}
