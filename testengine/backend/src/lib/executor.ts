import { createHash } from "node:crypto";
import { deliverRunCallback } from "./callbackDelivery.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EngineCallbackPayload,
  EngineCaseResultPayload,
  EngineRunEnvelope,
  EngineRunHook,
  EngineRunRecord,
  EngineRunState,
  EngineStepOutcome,
  EngineStepOutcomeStatus,
  HelloTestExecutionStepAutomationDetail,
  HelloTestExecutionStepWebDetail
} from "../contracts/hellotest.js";
import { saveRun, updateRun } from "./runStore.js";
import { createWebRunSession } from "./webEngine.js";
import { buildInitialContext, interpolateText, registerContextValue } from "./runtimeContext.js";
import { executeApiStepInEngine } from "./apiEngine.js";
import { createMobileRunSession } from "./mobileEngine.js";
import { automationStepOptions, optionalStepFailureNote } from "./automationStepOptions.js";
import { createExecutionOutputRedactor } from "./executionOutputRedaction.js";

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

type ExecutionContext = {
  values: Record<string, string>;
  capturedValues?: Record<string, string>;
};

type ApiStepExecutionResult = {
  outcome: EngineStepOutcome;
  summary: {
    step_id: string;
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string | null;
    };
    response: {
      status: number;
      status_text: string;
      headers: Record<string, string>;
      body: string;
      json: unknown;
    };
    captures: Record<string, string>;
    assertions: Array<{ kind: string; passed: boolean; target?: string | null; expected?: string | null; actual?: string | null }>;
  };
  automation_detail?: HelloTestExecutionStepAutomationDetail;
  captures: Record<string, string>;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type ExecutedEngineStepResult = {
  outcome: EngineStepOutcome;
  summary?: ApiStepExecutionResult["summary"];
  web_detail?: HelloTestExecutionStepWebDetail;
  automation_detail?: HelloTestExecutionStepAutomationDetail;
  captures: Record<string, string>;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type EngineCaseLogsPayload = {
  stepStatuses: Record<string, EngineStepOutcomeStatus>;
  stepNotes: Record<string, string>;
  stepEvidence: Record<string, { dataUrl: string; fileName?: string; mimeType?: string }>;
  stepApiDetails: Record<string, ApiStepExecutionResult["summary"]>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  stepCaptures: Record<string, Record<string, string>>;
};

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT || "/artifacts";

const normalizeText = (value?: string | null) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};

const normalizeOptionalText = (value?: string | null) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const nowIso = () => new Date().toISOString();

const truncateText = (value: string, maxLength = 420) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const stringifyError = (error: unknown, fallback = "Step execution failed.") => {
  if (error instanceof Error) {
    return [error.message || fallback, error.stack ? `Stack:\n${error.stack}` : ""].filter(Boolean).join("\n");
  }

  return String(error || fallback);
};

const writeArtifactFile = async (relativePath: string | null | undefined, content: string) => {
  if (!relativePath) {
    return null;
  }

  const fullPath = path.join(ARTIFACT_ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
  return fullPath;
};

const emitCallback = (envelope: EngineRunEnvelope, payload: EngineCallbackPayload) =>
  deliverRunCallback(envelope, createExecutionOutputRedactor(envelope)(payload));

const writeRunSummary = async (
  run: EngineRunRecord,
  summary: {
    execution: {
      started_at: string;
      ended_at: string;
      status: EngineStepOutcomeStatus;
      summary: string;
    };
    steps: ApiStepExecutionResult["summary"][];
    captured_values: Record<string, string>;
  }
) => {
  await writeArtifactFile(run.artifact_bundle.summary_path, JSON.stringify(summary, null, 2));
};

const buildStepApiDetailMap = (stepSummaries: ApiStepExecutionResult["summary"][] = []) =>
  stepSummaries.reduce<Record<string, ApiStepExecutionResult["summary"]>>((accumulator, summary) => {
    if (!summary?.step_id) {
      return accumulator;
    }

    accumulator[summary.step_id] = summary;
    return accumulator;
  }, {});

const buildLogsPayload = (
  stepOutcomes: EngineStepOutcome[],
  stepSummaries: ApiStepExecutionResult["summary"][] = [],
  stepCaptures: Record<string, Record<string, string>> = {},
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail> = {},
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail> = {}
) =>
  stepOutcomes.reduce<EngineCaseLogsPayload>(
    (accumulator, outcome) => {
      if (outcome.status === "passed" || outcome.status === "failed" || outcome.status === "blocked" || outcome.status === "skipped") {
        accumulator.stepStatuses[outcome.step_id] = outcome.status;
      }

      if (outcome.note) {
        accumulator.stepNotes[outcome.step_id] = outcome.note;
      }

      if (outcome.evidence_image?.data_url) {
        accumulator.stepEvidence[outcome.step_id] = {
          dataUrl: outcome.evidence_image.data_url,
          fileName: outcome.evidence_image.file_name || undefined,
          mimeType: outcome.evidence_image.mime_type || undefined
        };
      }

      return accumulator;
    },
    {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: buildStepApiDetailMap(stepSummaries),
      stepWebDetails: { ...stepWebDetails },
      stepAutomationDetails: { ...stepAutomationDetails },
      stepCaptures: Object.entries(stepCaptures).reduce<Record<string, Record<string, string>>>((accumulator, [stepId, captures]) => {
        accumulator[stepId] = { ...captures };
        return accumulator;
      }, {})
    }
  );

const mergeArtifactBundle = (
  base: EngineRunRecord["artifact_bundle"],
  patch: Partial<EngineRunRecord["artifact_bundle"]> | undefined
) => {
  if (!patch || !Object.keys(patch).length) {
    return base;
  }
  const mergedRefs = [
    ...(base.artifact_refs || []),
    ...(patch.artifact_refs || [])
  ].reduce<NonNullable<EngineRunRecord["artifact_bundle"]["artifact_refs"]>>((items, ref) => {
    const key = `${ref.kind || ""}:${ref.path || ""}:${ref.file_name || ""}`;
    const existingIndex = items.findIndex((item) => `${item.kind || ""}:${item.path || ""}:${item.file_name || ""}` === key);

    if (existingIndex >= 0) {
      items[existingIndex] = ref;
      return items;
    }

    items.push(ref);
    return items;
  }, []);

  return {
    ...base,
    ...patch,
    artifact_refs: mergedRefs
  };
};

const syncCapturedValues = (context: ExecutionContext | { values: Record<string, string> }, captures: Record<string, string>) => {
  Object.entries(captures || {}).forEach(([key, value]) => {
    registerContextValue(context, key, value);
  });
};

const summarizeAssertionProgress = (
  assertions: Array<{ passed: boolean }>
) => `${assertions.filter((assertion) => assertion.passed).length}/${assertions.length} assertions passed`;

const buildStepAutomationDetail = ({
  step,
  status,
  provider,
  startedAt,
  endedAt,
  errorMessage
}: {
  step: EngineRunEnvelope["steps"][number];
  status: HelloTestExecutionStepAutomationDetail["status"];
  provider?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  errorMessage?: string | null;
}): HelloTestExecutionStepAutomationDetail => {
  const code =
    normalizeText(step.automation_code)
    || (step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : "")
    || step.action
    || "";
  const reportedLine = errorMessage?.match(/Code line:\s*(\d+)/i)?.[1];
  const errorLine = reportedLine
    ? Number.parseInt(reportedLine, 10)
    : errorMessage
    ? code.split(/\r?\n/).findIndex((line) => errorMessage.includes(line.trim()) && line.trim().length > 8) + 1 || null
    : null;

  return {
    engine: step.step_type,
    provider: provider || null,
    status,
    code,
    language: step.step_type === "api" ? "json" : "javascript",
    active_line: status === "running" ? 1 : errorLine,
    error_line: errorLine,
    error_message: errorMessage || null,
    started_at: startedAt || null,
    ended_at: endedAt || null
  };
};

const normalizeHooks = (envelope: EngineRunEnvelope, phase: EngineRunHook["phase"]) =>
  (envelope.hooks || [])
    .filter((hook) => hook?.phase === phase && Array.isArray(hook.steps) && hook.steps.length)
    .flatMap((hook) =>
      hook.steps
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((step, index) => ({
          hook,
          step: {
            ...step,
            id: `${hook.scope}:${phase}:${hook.id}:${step.id || index + 1}`,
            order: step.order || index + 1
          }
        }))
    );

const decorateHookOutcome = (
  hook: EngineRunHook,
  step: EngineRunEnvelope["steps"][number],
  outcome: EngineStepOutcome
): EngineStepOutcome => ({
  ...outcome,
  step_id: outcome.step_id,
  note: [
    `[${hook.phase === "pre" ? "Pre" : "Post"} ${hook.scope} hook] ${hook.name}`,
    outcome.note || `${step.action || `Step ${step.order}`} completed.`
  ].filter(Boolean).join("\n")
});

const executeApiStep = async ({ envelope, run, step, context }: {
  envelope: EngineRunEnvelope; run: EngineRunRecord; step: EngineRunEnvelope["steps"][number]; context: ExecutionContext;
}): Promise<ApiStepExecutionResult> => {
  const startedAt = nowIso();
  // Push and pull execution use the same interpolation, request and assertion engine.
  const result = await executeApiStepInEngine(envelope, step, context.capturedValues || {});
  const summary = { step_id: step.id, ...result.detail };
  const stepKey = createHash("sha256").update(step.id).digest("hex").slice(0, 16);
  const artifactPath = path.posix.join(`artifacts/${run.id}`, "steps", `${String(step.order).padStart(2, "0")}-${stepKey}.json`);
  await writeArtifactFile(artifactPath, JSON.stringify(summary, null, 2));
  return {
    outcome: { step_id: step.id, status: result.status, started_at: startedAt, ended_at: nowIso(), duration_ms: result.duration_ms, note: result.note,
      evidence_image: { data_url: result.evidence.dataUrl, file_name: result.evidence.fileName, mime_type: result.evidence.mimeType, artifact_path: artifactPath },
      artifacts: [{ kind: "summary", label: `API step ${step.order} summary`, path: artifactPath, content_type: "application/json" }]
    },
    summary, captures: result.captures,
    automation_detail: buildStepAutomationDetail({ step, status: result.status, provider: "api", startedAt, endedAt: nowIso(), errorMessage: result.status === "failed" ? result.note : null }),
    recovery_attempted: false, recovery_succeeded: false
  };
};

const executeWebStep = async ({
  step,
  webRunSession
}: {
  step: EngineRunEnvelope["steps"][number];
  webRunSession: ReturnType<typeof createWebRunSession>;
}): Promise<ExecutedEngineStepResult> => {
  const result = await webRunSession.runStep(step);

  return {
    outcome: {
      step_id: step.id,
      status: result.status,
      started_at: null,
      ended_at: nowIso(),
      duration_ms: null,
      note: result.note,
      evidence_image: result.evidence
        ? {
            data_url: result.evidence.dataUrl,
            file_name: result.evidence.fileName || undefined,
            mime_type: result.evidence.mimeType || undefined
          }
        : null
    },
    captures: result.captures,
    web_detail: result.web_detail,
    automation_detail: { ...buildStepAutomationDetail({
      step,
      status: result.status,
      provider: result.web_detail?.provider || webRunSession.provider,
      startedAt: result.web_detail?.started_at || null,
      endedAt: result.web_detail?.ended_at || null,
      errorMessage: result.status === "failed" ? result.note : null
    }), line_results: result.line_results },
    recovery_attempted: result.recovery_attempted,
    recovery_succeeded: result.recovery_succeeded
  };
};

const writeRunState = (
  runId: string,
  nextState: EngineRunState,
  summary: string,
  extra?: Partial<EngineRunRecord>
) =>
  updateRun(runId, (current) => ({
    ...current,
    ...extra,
    state: nextState,
    summary,
    updated_at: nowIso()
  }));

const completeStepOutcomes = (envelope: EngineRunEnvelope, outcomes: EngineStepOutcome[], status: EngineStepOutcomeStatus): EngineStepOutcome[] => {
  if (status === "passed") return outcomes;
  const completed = new Set(outcomes.map(item => item.step_id));
  return [...outcomes, ...envelope.steps.filter(step => !completed.has(step.id)).map(step => ({
    step_id: step.id, status: "blocked" as const, started_at: null, ended_at: null, duration_ms: null,
    note: "Not executed because an earlier step or run setup failed."
  }))];
};

const buildFinalCallback = ({
  envelope,
  run,
  stepOutcomes,
  stepSummaries,
  stepCaptures,
  stepWebDetails,
  stepAutomationDetails,
  status,
  durationMs,
  errorMessage,
  healingAttempted,
  healingSucceeded
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  stepOutcomes: EngineStepOutcome[];
  stepSummaries: ApiStepExecutionResult["summary"][];
  stepCaptures: Record<string, Record<string, string>>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  status: "passed" | "failed" | "blocked";
  durationMs: number;
  errorMessage?: string | null;
  healingAttempted?: boolean;
  healingSucceeded?: boolean;
}): EngineCallbackPayload => ({
  event: status === "passed" ? "run.completed" : status === "failed" ? "run.failed" : "run.incident",
  engine_run_id: run.id,
  hellotest_run_id: envelope.hellotest_run_id,
  hellotest_execution_id: envelope.hellotest_execution_id || envelope.hellotest_run_id,
  hellotest_test_case_id: envelope.hellotest_test_case_id,
  data_set_iteration: envelope.data_set?.iteration || null,
  state: status === "passed" ? "completed" : status === "failed" ? "failed" : "incident",
  summary:
    status === "passed"
      ? `${envelope.hellotest_test_case_title} completed successfully.`
      : errorMessage || `${envelope.hellotest_test_case_title} failed during automated execution.`,
  deterministic_attempted: true,
  healing_attempted: Boolean(healingAttempted),
  healing_succeeded: Boolean(healingSucceeded),
  step_outcomes: completeStepOutcomes(envelope, stepOutcomes, status),
  case_result: {
    status,
    duration_ms: durationMs,
    error: errorMessage || null,
    logs: buildLogsPayload(completeStepOutcomes(envelope, stepOutcomes, status), stepSummaries, stepCaptures, stepWebDetails, stepAutomationDetails)
  },
  artifact_bundle: run.artifact_bundle,
  patch_proposals: run.patch_proposals,
  emitted_at: nowIso()
});

const buildProgressCallback = ({
  envelope,
  run,
  stepOutcomes,
  stepSummaries,
  stepCaptures,
  stepWebDetails,
  stepAutomationDetails,
  latestOutcome,
  durationMs,
  totalSteps,
  healingAttempted,
  healingSucceeded
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  stepOutcomes: EngineStepOutcome[];
  stepSummaries: ApiStepExecutionResult["summary"][];
  stepCaptures: Record<string, Record<string, string>>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  latestOutcome: EngineStepOutcome;
  durationMs: number;
  totalSteps: number;
  healingAttempted?: boolean;
  healingSucceeded?: boolean;
}): EngineCallbackPayload => ({
  event: "run.step.completed",
  engine_run_id: run.id,
  hellotest_run_id: envelope.hellotest_run_id,
  hellotest_execution_id: envelope.hellotest_execution_id || envelope.hellotest_run_id,
  hellotest_test_case_id: envelope.hellotest_test_case_id,
  data_set_iteration: envelope.data_set?.iteration || null,
  state: "running",
  summary: `${envelope.hellotest_test_case_title}: completed step ${stepOutcomes.length} of ${totalSteps}.`,
  deterministic_attempted: true,
  healing_attempted: Boolean(healingAttempted),
  healing_succeeded: Boolean(healingSucceeded),
  step_outcomes: [latestOutcome],
  case_result: {
    status: stepOutcomes.length === totalSteps && stepOutcomes.every((outcome) => outcome.status === "passed") ? "passed" : "blocked",
    duration_ms: durationMs,
    error: null,
    logs: buildLogsPayload(stepOutcomes, stepSummaries, stepCaptures, stepWebDetails, stepAutomationDetails)
  },
  artifact_bundle: run.artifact_bundle,
  patch_proposals: run.patch_proposals,
  emitted_at: nowIso()
});

const executeUnsupportedRun = async ({
  envelope,
  run,
  logger,
  reason
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  logger: Logger;
  reason: string;
}) => {
  const next = writeRunState(run.id, "incident", reason);

  if (!next) {
    return;
  }

  const payload = buildFinalCallback({
    envelope,
    run: next,
    stepOutcomes: [],
    stepSummaries: [],
    stepCaptures: {},
    stepWebDetails: {},
    stepAutomationDetails: {},
    status: "failed",
    durationMs: 0,
    errorMessage: reason
  });

  try {
    await emitCallback(envelope, payload);
  } catch (error) {
    logger.error({ error, engineRunId: run.id }, "Unable to emit HelloTest callback for unsupported run");
  }
};

async function executeRun(envelope: EngineRunEnvelope, run: EngineRunRecord, logger: Logger) {
  const allSteps = [...envelope.steps, ...(envelope.hooks || []).flatMap((hook) => hook.steps || [])];
  const hasUnsupportedStep = allSteps.some((step) => !["api", "web", "android", "ios"].includes(step.step_type));

  if (hasUnsupportedStep) {
    await executeUnsupportedRun({
      envelope,
      run,
      logger,
      reason: "Local Test Engine received an unsupported step type."
    });
    return;
  }

  const hasWebSteps = allSteps.some((step) => step.step_type === "web" && !automationStepOptions(step).skip);
  const running = writeRunState(
    run.id,
    "running",
    hasWebSteps
      ? "Executing automated API and web steps in order."
      : "Executing automated API steps in order."
  );

  if (!running) {
    return;
  }

  const startedAt = Date.now();
  const context = buildInitialContext(envelope);
  const mobileRunSession = createMobileRunSession(envelope, (error) => logger.error({ error, engineRunId: run.id }, "Unable to close Mobile Engine session"));
  const stepOutcomes: EngineStepOutcome[] = [];
  const stepSummaries: ApiStepExecutionResult["summary"][] = [];
  const stepCaptures: Record<string, Record<string, string>> = {};
  const stepWebDetails: Record<string, HelloTestExecutionStepWebDetail> = {};
  const stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail> = {};
  const orderedSteps = envelope.steps.slice().sort((left, right) => left.order - right.order);
  const preHookSteps = normalizeHooks(envelope, "pre");
  const postHookSteps = normalizeHooks(envelope, "post");
  const webRunSession = hasWebSteps ? createWebRunSession(envelope, context.values) : null;
  const redactOutput = createExecutionOutputRedactor(envelope, () => [context, webRunSession?.context]);
  const markRunState: typeof writeRunState = (id, state, summary, extra) => writeRunState(id, state, redactOutput(summary), extra);
  const originalLogger = logger;
  logger = {
    info: (message, ...args) => originalLogger.info(redactOutput(message), ...args.map(value => redactOutput(value))),
    error: (message, ...args) => originalLogger.error(redactOutput(message), ...args.map(value => redactOutput(value)))
  };
  const emitCallback = (target: EngineRunEnvelope, payload: EngineCallbackPayload) => deliverRunCallback(target, redactOutput(payload));
  const persistRunSummary = (target: EngineRunRecord, payload: Parameters<typeof writeRunSummary>[1]) => writeRunSummary(target, redactOutput(payload));
  let healingAttempted = false;
  let healingSucceeded = false;
  let webRunSessionStopped = false;
  let postHooksRun = false;
  let currentStep: EngineRunEnvelope["steps"][number] | null = null;
  const stopWebRunSession = async (status?: "passed" | "failed" | "blocked") => {
    if (!webRunSession || webRunSessionStopped) {
      return {};
    }

    webRunSessionStopped = true;
    try {
      return await webRunSession.stop(status);
    } catch (error) {
      logger.error({ error, engineRunId: run.id }, "Unable to finalize web automation artifacts");
      return {};
    }
  };
  const executeEngineStep = async (step: EngineRunEnvelope["steps"][number]) => {
    const options = automationStepOptions(step);
    if (options.skip) return {
      outcome: { step_id: step.id, status: "skipped" as const, note: "Section skipped by its saved execution options.", ended_at: nowIso() },
      captures: {}, automation_detail: buildStepAutomationDetail({ step, status: "skipped" }),
      recovery_attempted: false, recovery_succeeded: false
    };
    let result: ExecutedEngineStepResult;
    try {
    if (step.step_type === "api") result = await executeApiStep({ envelope, run: running, step, context: buildInitialContext(envelope, context.capturedValues, step) });
    else if (step.step_type === "web" && webRunSession) result = await executeWebStep({ step, webRunSession });
    else if (step.step_type === "android" || step.step_type === "ios") {
      const mobile = (await mobileRunSession.run([step], context.capturedValues)).results.find((item) => item.step_id === step.id);
      if (!mobile) throw new Error(`Mobile Engine returned no result for step ${step.order}`);
      result = {
        outcome: { step_id: step.id, status: mobile.status, duration_ms: mobile.duration_ms, note: mobile.note,
          ...(mobile.evidence ? { evidence_image: { data_url: mobile.evidence.dataUrl, file_name: mobile.evidence.fileName, mime_type: mobile.evidence.mimeType } } : {}) },
        captures: mobile.captures || {}, automation_detail: buildStepAutomationDetail({ step, status: mobile.status, provider: "appium", errorMessage: mobile.status === "passed" ? null : mobile.note }),
        recovery_attempted: false, recovery_succeeded: false
      };
    } else throw new Error(`Unable to execute step ${step.order}.`);
    } catch (error) {
      if (!options.optional) throw error;
      const note = stringifyError(error, "Automation section failed.");
      result = { outcome: { step_id: step.id, status: "failed", note, ended_at: nowIso() }, captures: {},
        automation_detail: buildStepAutomationDetail({ step, status: "failed", errorMessage: note }),
        recovery_attempted: false, recovery_succeeded: false };
    }
    if (options.optional && result.outcome.status === "failed") {
      result = { ...result, outcome: { ...result.outcome, status: "skipped", note: optionalStepFailureNote(result.outcome.note) }, captures: {} };
    }

    syncCapturedValues(context, result.captures);

    if (webRunSession && step.step_type !== "web") {
      syncCapturedValues(webRunSession.context, result.captures);
    }

    return result;
  };
  const recordStepResult = (result: ExecutedEngineStepResult) => {
    stepOutcomes.push(result.outcome);
    if (Object.keys(result.captures || {}).length) {
      stepCaptures[result.outcome.step_id] = {
        ...(stepCaptures[result.outcome.step_id] || {}),
        ...result.captures
      };
    }
    if (result.summary) {
      stepSummaries.push(result.summary);
    }
    if (result.web_detail) {
      stepWebDetails[result.outcome.step_id] = result.web_detail;
    }
    if (result.automation_detail) {
      stepAutomationDetails[result.outcome.step_id] = result.automation_detail;
    }
    healingAttempted = healingAttempted || result.recovery_attempted;
    healingSucceeded = healingSucceeded || result.recovery_succeeded;
  };
  const runHookSteps = async (phase: EngineRunHook["phase"], entries: ReturnType<typeof normalizeHooks>) => {
    for (const entry of entries) {
      currentStep = entry.step;
      let result: ExecutedEngineStepResult;
      try { result = await executeEngineStep(entry.step); }
      catch (error) {
        const note = stringifyError(error, "Execution hook failed.");
        result = {
          outcome: { step_id: entry.step.id, status: "failed", note, ended_at: nowIso() },
          captures: {},
          automation_detail: buildStepAutomationDetail({ step: entry.step, status: "failed", provider: entry.step.step_type, errorMessage: note }),
          recovery_attempted: false, recovery_succeeded: false
        };
      }
      result.outcome = decorateHookOutcome(entry.hook, entry.step, result.outcome);
      recordStepResult(result);
      currentStep = null;

      if (result.outcome.status !== "passed" && result.outcome.status !== "skipped" && entry.hook.fail_behavior !== "continue") {
        const behavior = entry.hook.fail_behavior || "fail-run";
        if (behavior === "mark-blocked") {
          result.outcome.status = "blocked";
          return false;
        }
        throw new Error(`${entry.hook.name} ${phase} hook failed: ${result.outcome.note || "hook step failed"}`);
      }
    }
    return true;
  };
  const runPostHooks = async () => {
    if (postHooksRun) return;
    postHooksRun = true;
    await runHookSteps("post", postHookSteps);
  };

  try {
    if (webRunSession) {
      await webRunSession.start();
    }

    const preHooksPassed = await runHookSteps("pre", preHookSteps);

    for (const step of preHooksPassed ? orderedSteps : []) {
      currentStep = step;
      const result = await executeEngineStep(step);
      recordStepResult(result);
      currentStep = null;

      const progressSummary = `${envelope.hellotest_test_case_title}: completed step ${stepOutcomes.length} of ${orderedSteps.length}.`;
      const progressRun = markRunState(run.id, "running", progressSummary);

      if (progressRun) {
        await persistRunSummary(progressRun, {
          execution: {
            started_at: new Date(startedAt).toISOString(),
            ended_at: nowIso(),
            status: result.outcome.status === "failed" ? "failed" : "blocked",
            summary: progressSummary
          },
          steps: stepSummaries,
          captured_values: context.values
        });

        if (result.outcome.status === "passed" && stepOutcomes.length < orderedSteps.length) {
          try {
            await emitCallback(
              envelope,
              buildProgressCallback({
                envelope,
                run: progressRun,
                stepOutcomes,
                stepSummaries,
                stepCaptures,
                stepWebDetails,
                stepAutomationDetails,
                latestOutcome: result.outcome,
                durationMs: Date.now() - startedAt,
                totalSteps: orderedSteps.length,
                healingAttempted,
                healingSucceeded
              })
            );
          } catch (error) {
            logger.error({ error, engineRunId: run.id, stepId: result.outcome.step_id }, "Unable to emit engine step progress callback");
          }
        }
      }

      if (result.outcome.status === "failed") {
        await runPostHooks();
        const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession("failed"));
        const failedRun = markRunState(
          run.id,
          "failed",
          `${envelope.hellotest_test_case_title} failed on step ${step.order}.`,
          { artifact_bundle: artifactBundle }
        );

        if (!failedRun) {
          return;
        }

        await persistRunSummary(failedRun, {
          execution: {
            started_at: new Date(startedAt).toISOString(),
            ended_at: nowIso(),
            status: "failed",
            summary: failedRun.summary
          },
          steps: stepSummaries,
          captured_values: context.values
        });

        await emitCallback(
          envelope,
          buildFinalCallback({
            envelope,
            run: failedRun,
            stepOutcomes,
            stepSummaries,
            stepCaptures,
            stepWebDetails,
            stepAutomationDetails,
            status: "failed",
            durationMs: Date.now() - startedAt,
            errorMessage: result.outcome.note || `${envelope.hellotest_test_case_title} failed on step ${step.order}.`,
            healingAttempted,
            healingSucceeded
          })
        );

        return;
      }
      if (result.outcome.status === "blocked") break;
    }

    await runPostHooks();

    const hasPassedSection = orderedSteps.some((step) => stepOutcomes.some((outcome) => outcome.step_id === step.id && outcome.status === "passed"));
    const finalStatus: "passed" | "blocked" = !hasPassedSection || stepOutcomes.some((outcome) => outcome.status === "blocked") ? "blocked" : "passed";
    const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession(finalStatus));
    const completedRun = markRunState(
      run.id,
      finalStatus === "passed" ? "completed" : "incident",
      finalStatus === "passed"
        ? `${envelope.hellotest_test_case_title} completed successfully.`
        : `${envelope.hellotest_test_case_title} completed with blocked hook or step outcomes.`,
      { artifact_bundle: artifactBundle }
    );

    if (!completedRun) {
      return;
    }

    await persistRunSummary(completedRun, {
      execution: {
        started_at: new Date(startedAt).toISOString(),
        ended_at: nowIso(),
        status: finalStatus,
        summary: completedRun.summary
      },
      steps: stepSummaries,
      captured_values: context.values
    });

    await emitCallback(
      envelope,
      buildFinalCallback({
        envelope,
        run: completedRun,
        stepOutcomes,
        stepSummaries,
        stepCaptures,
        stepWebDetails,
        stepAutomationDetails,
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        healingAttempted,
        healingSucceeded
      })
    );
  } catch (error) {
    const failureMessage = stringifyError(error, `${envelope.hellotest_test_case_title} failed during execution.`);

    if (currentStep && !stepOutcomes.some((outcome) => outcome.step_id === currentStep?.id)) {
      const failedOutcome: EngineStepOutcome = {
        step_id: currentStep.id,
        status: "failed",
        started_at: null,
        ended_at: nowIso(),
        duration_ms: null,
        note: [
          `${envelope.hellotest_test_case_title} failed on step ${currentStep.order}.`,
          failureMessage
        ].join("\n")
      };
      stepOutcomes.push(failedOutcome);
      stepAutomationDetails[currentStep.id] = buildStepAutomationDetail({
        step: currentStep,
        status: "failed",
        provider: currentStep.step_type,
        endedAt: nowIso(),
        errorMessage: failureMessage
      });
    }

    try { await runPostHooks(); } catch (hookError) {
      logger.error({ error: hookError, engineRunId: run.id }, "Unable to complete teardown hooks after execution failure");
    }
    const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession("failed"));
    const failedRun = markRunState(
      run.id,
      "failed",
      failureMessage,
      { artifact_bundle: artifactBundle }
    );

    if (!failedRun) {
      return;
    }

    await persistRunSummary(failedRun, {
      execution: {
        started_at: new Date(startedAt).toISOString(),
        ended_at: nowIso(),
        status: "failed",
        summary: failedRun.summary
      },
      steps: stepSummaries,
      captured_values: context.values
    });

    try {
      await emitCallback(
        envelope,
        buildFinalCallback({
          envelope,
          run: failedRun,
          stepOutcomes,
          stepSummaries,
          stepCaptures,
          stepWebDetails,
          stepAutomationDetails,
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorMessage: failedRun.summary,
          healingAttempted,
          healingSucceeded
        })
      );
    } catch (callbackError) {
      logger.error({ error: callbackError, engineRunId: run.id }, "Unable to emit HelloTest callback after execution failure");
    }
  } finally {
    await mobileRunSession.close();
    if (webRunSession && !webRunSessionStopped) {
      try {
        await stopWebRunSession();
      } catch (stopError) {
        logger.error({ error: stopError, engineRunId: run.id }, "Unable to stop web automation session cleanly");
      }
    }
  }
}

export function queueRunExecution(envelope: EngineRunEnvelope, run: EngineRunRecord, logger: Logger) {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      void executeRun(envelope, run, logger)
        .catch((error) => {
          logger.error({ error, engineRunId: run.id }, "Uncaught Test Engine execution failure");
        })
        .finally(resolve);
    });
  });
}

export function saveAcceptedRun(envelope: EngineRunEnvelope, run: EngineRunRecord) {
  return saveRun(run, envelope);
}
