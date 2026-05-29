const crypto = require("crypto");
const db = require("../db");
const executionService = require("./execution.service");
const executionResultService = require("./executionResult.service");
const integrationService = require("./integration.service");
const opsTelemetryService = require("./opsTelemetry.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const selectTestCase = db.prepare(`
  SELECT id, title, app_type_id
  FROM test_cases
  WHERE id = ?
`);

const selectExecutionCaseCount = db.prepare(`
  SELECT COUNT(*)::int AS count
  FROM execution_case_snapshots
  WHERE execution_id = ?
`);

const selectLatestResultsForExecution = db.prepare(`
  SELECT DISTINCT ON (test_case_id) test_case_id, status
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, created_at DESC, id DESC
`);

const FINAL_ENGINE_EVENTS = new Set(["run.completed", "run.failed", "run.incident"]);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  return null;
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeCaptureRecord = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};

const normalizeStepCaptures = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [stepId, captures]) => {
    const normalizedStepId = normalizeText(stepId);

    if (!normalizedStepId) {
      return accumulator;
    }

    const normalizedCaptures = normalizeCaptureRecord(captures);

    if (!Object.keys(normalizedCaptures).length) {
      return accumulator;
    }

    accumulator[normalizedStepId] = normalizedCaptures;
    return accumulator;
  }, {});
};

const normalizeInlineArtifactRefs = (artifactBundle) => {
  const refs = Array.isArray(artifactBundle?.artifact_refs) ? artifactBundle.artifact_refs : [];

  return refs
    .filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    .map((ref) => {
      const fileName = normalizeText(ref.file_name || ref.fileName)
        || normalizeText(ref.path)?.split("/").pop()
        || `${normalizeText(ref.kind) || "artifact"}.bin`;
      const contentType = normalizeText(ref.content_type || ref.mime_type || ref.mimeType) || "application/octet-stream";
      const contentBase64 = normalizeText(ref.content_base64 || ref.contentBase64);
      const dataUrl = normalizeText(ref.data_url || ref.dataUrl);
      const content = dataUrl || (contentBase64 ? `data:${contentType};base64,${contentBase64}` : null);

      return content
        ? {
            file_name: fileName,
            mime_type: contentType,
            content
          }
        : null;
    })
    .filter(Boolean);
};

const attachInlineArtifacts = async (transactionId, artifactBundle) => {
  if (!transactionId) {
    return [];
  }

  const created = [];

  for (const ref of normalizeInlineArtifactRefs(artifactBundle)) {
    try {
      created.push(await workspaceTransactionService.createTransactionArtifact(transactionId, ref));
    } catch {
      // Evidence attachment should never reject an otherwise valid engine callback.
    }
  }

  return created;
};

const parseStructuredLogs = (value) => {
  if (!value) {
    return {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: {},
      stepWebDetails: {},
      stepAutomationDetails: {},
      stepCaptures: {}
    };
  }

  if (typeof value === "string") {
    try {
      return parseStructuredLogs(JSON.parse(value));
    } catch {
      return {
        stepStatuses: {},
        stepNotes: {},
        stepEvidence: {},
        stepApiDetails: {},
        stepWebDetails: {},
        stepAutomationDetails: {},
        stepCaptures: {}
      };
    }
  }

  if (!isPlainObject(value)) {
    return {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: {},
      stepWebDetails: {},
      stepAutomationDetails: {},
      stepCaptures: {}
    };
  }

  return {
    stepStatuses: isPlainObject(value.stepStatuses) ? { ...value.stepStatuses } : {},
    stepNotes: isPlainObject(value.stepNotes) ? { ...value.stepNotes } : {},
    stepEvidence: isPlainObject(value.stepEvidence) ? { ...value.stepEvidence } : {},
    stepApiDetails: isPlainObject(value.stepApiDetails) ? { ...value.stepApiDetails } : {},
    stepWebDetails: isPlainObject(value.stepWebDetails) ? { ...value.stepWebDetails } : {},
    stepAutomationDetails: isPlainObject(value.stepAutomationDetails) ? { ...value.stepAutomationDetails } : {},
    stepCaptures: normalizeStepCaptures(value.stepCaptures)
  };
};

const isInlineMediaDataUrl = (value) =>
  typeof value === "string" && /^data:(image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value.trim());

const mergeLogsPayload = (current, patch) => {
  const base = parseStructuredLogs(current);
  const next = parseStructuredLogs(patch);
  const mergedStepCaptures = { ...base.stepCaptures };

  Object.entries(next.stepCaptures || {}).forEach(([stepId, captures]) => {
    mergedStepCaptures[stepId] = {
      ...(mergedStepCaptures[stepId] || {}),
      ...(isPlainObject(captures) ? captures : {})
    };
  });

  return {
    stepStatuses: {
      ...base.stepStatuses,
      ...next.stepStatuses
    },
    stepNotes: {
      ...base.stepNotes,
      ...next.stepNotes
    },
    stepEvidence: {
      ...base.stepEvidence,
      ...next.stepEvidence
    },
    stepApiDetails: {
      ...base.stepApiDetails,
      ...next.stepApiDetails
    },
    stepWebDetails: {
      ...base.stepWebDetails,
      ...next.stepWebDetails
    },
    stepAutomationDetails: {
      ...base.stepAutomationDetails,
      ...next.stepAutomationDetails
    },
    stepCaptures: mergedStepCaptures
  };
};

const buildLogsPayloadFromStepOutcomes = (stepOutcomes = []) =>
  stepOutcomes.reduce(
    (accumulator, outcome) => {
      if (!isPlainObject(outcome)) {
        return accumulator;
      }

      const stepId = normalizeText(outcome.step_id);

      if (!stepId) {
        return accumulator;
      }

      const status = normalizeText(outcome.status);
      if (status === "passed" || status === "failed" || status === "blocked") {
        accumulator.stepStatuses[stepId] = status;
      }

      const note = normalizeText(outcome.note);
      if (note) {
        accumulator.stepNotes[stepId] = note;
      }

      const evidence = isPlainObject(outcome.evidence_image) ? outcome.evidence_image : null;
      const dataUrl = evidence ? normalizeText(evidence.data_url) : null;

      if (dataUrl && isInlineMediaDataUrl(dataUrl)) {
        accumulator.stepEvidence[stepId] = {
          dataUrl,
          fileName: evidence.file_name ? String(evidence.file_name).trim() || undefined : undefined,
          mimeType: evidence.mime_type ? String(evidence.mime_type).trim() || undefined : undefined
        };
      }

      const captures = normalizeCaptureRecord(outcome.captures);

      if (Object.keys(captures).length) {
        accumulator.stepCaptures[stepId] = captures;
      }

      return accumulator;
    },
    {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: {},
      stepWebDetails: {},
      stepAutomationDetails: {},
      stepCaptures: {}
    }
  );

const countEntries = (value) => (isPlainObject(value) ? Object.keys(value).length : 0);

const deriveCaseStatus = (explicitStatus, stepStatuses, expectedStepIds, fallbackStatus, event) => {
  if (explicitStatus === "passed" || explicitStatus === "failed" || explicitStatus === "blocked") {
    return explicitStatus;
  }

  const normalizedExpectedStepIds = Array.isArray(expectedStepIds) ? expectedStepIds.filter(Boolean) : [];
  const values =
    normalizedExpectedStepIds.length > 0
      ? normalizedExpectedStepIds.map((stepId) => stepStatuses?.[stepId]).filter(Boolean)
      : Object.values(stepStatuses || {}).filter(Boolean);

  if (values.includes("failed")) {
    return "failed";
  }

  if (
    normalizedExpectedStepIds.length > 0
    && values.length === normalizedExpectedStepIds.length
    && values.every((value) => value === "passed")
  ) {
    return "passed";
  }

  if (event === "run.failed" || event === "run.incident") {
    return "failed";
  }

  if (event === "run.completed" && values.length && values.every((value) => value === "passed")) {
    return "passed";
  }

  if (fallbackStatus === "passed" || fallbackStatus === "failed" || fallbackStatus === "blocked") {
    return fallbackStatus;
  }

  return "blocked";
};

const mapEngineEventToTransactionStatus = (event, fallbackState) => {
  if (event === "run.failed" || event === "run.incident" || fallbackState === "failed" || fallbackState === "incident") {
    return "failed";
  }

  if (event === "run.completed" || fallbackState === "completed") {
    return "completed";
  }

  if (event === "run.accepted") {
    return "queued";
  }

  return "running";
};

const buildExpectedSignature = (secret, payload) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const signatureMatches = (provided, expected) => {
  const normalized = String(provided || "").trim().replace(/^sha256=/i, "");

  if (!normalized || normalized.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
  } catch {
    return false;
  }
};

const resolveCallbackSignature = (headers = {}) =>
  headers["x-qaira-engine-signature"]
  || headers["x-testengine-signature"]
  || headers["x-qaira-signature"]
  || "";

const resolveCallbackSecret = (integration) =>
  normalizeText(integration?.config?.callback_secret)
  || normalizeText(process.env.TESTENGINE_CALLBACK_SECRET)
  || normalizeText(process.env.TESTENGINE_SHARED_SECRET)
  || normalizeText(process.env.QAIRA_TESTENGINE_SECRET)
  || "qaira-testengine-dev-secret";

async function ensureTransaction({
  engineRunId,
  execution,
  appTypeId,
  caseSnapshot,
  summary
}) {
  let transaction = await workspaceTransactionService.findTransactionByRelated({
    related_kind: "testengine_run",
    related_id: engineRunId
  });

  if (transaction) {
    return transaction;
  }

  const created = await workspaceTransactionService.createTransaction({
    project_id: execution.project_id,
    app_type_id: appTypeId,
    category: "automation",
    action: "testengine_run",
    status: "queued",
    title: `Automated run handoff for ${caseSnapshot?.test_case_title || caseSnapshot?.test_case_id || "test case"}`,
    description: normalizeText(summary),
    metadata: {
      source: "testengine",
      engine_run_id: engineRunId,
      execution_id: execution.id,
      test_case_id: caseSnapshot?.test_case_id || null
    },
    related_kind: "testengine_run",
    related_id: engineRunId
  });

  return workspaceTransactionService.getTransaction(created.id);
}

async function settleExecutionIfComplete(execution) {
  if (!execution?.id) {
    return;
  }

  const totalCaseCount = Number((await selectExecutionCaseCount.get(execution.id))?.count || 0);

  if (!totalCaseCount) {
    return;
  }

  const latestResults = await selectLatestResultsForExecution.all(execution.id);
  const latestStatusByCaseId = new Map(
    latestResults.map((result) => [normalizeText(result.test_case_id), normalizeText(result.status)])
  );
  const requiredCaseIds = new Set((execution.case_snapshots || []).map((snapshot) => normalizeText(snapshot.test_case_id)).filter(Boolean));

  if (!requiredCaseIds.size || [...requiredCaseIds].some((testCaseId) => !latestStatusByCaseId.has(testCaseId))) {
    return;
  }

  const nextExecutionStatus = [...latestStatusByCaseId.values()].every((status) => status === "passed")
    ? "completed"
    : "failed";

  try {
    await executionService.completeExecution(execution.id, nextExecutionStatus);
  } catch {
    // Another callback may have already settled the execution.
  }
}

exports.handleRunCallback = async ({ headers, payload, rawPayload }) => {
  if (!isPlainObject(payload)) {
    throw new Error("Callback payload must be an object");
  }

  const engineRunId = normalizeText(payload.engine_run_id);
  const executionId = normalizeText(payload.qaira_execution_id) || normalizeText(payload.qaira_run_id);
  const testCaseId = normalizeText(payload.qaira_test_case_id);
  const event = normalizeText(payload.event) || "run.progress";
  const summary = normalizeText(payload.summary);

  if (!engineRunId || !executionId || !testCaseId) {
    throw new Error("engine_run_id, qaira_execution_id or qaira_run_id, and qaira_test_case_id are required");
  }

  const execution = await executionService.getExecution(executionId);
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);

  if (!integration) {
    throw new Error("No active Test Engine integration is configured for this project");
  }

  const callbackSecret = resolveCallbackSecret(integration);

  if (!callbackSecret) {
    throw new Error("Unable to resolve a Test Engine callback signing secret");
  }

  const providedSignature = resolveCallbackSignature(headers);
  const serializedPayload =
    typeof rawPayload === "string" && rawPayload.trim()
      ? rawPayload
      : JSON.stringify(payload);
  const expectedSignature = buildExpectedSignature(callbackSecret, serializedPayload);

  if (!signatureMatches(providedSignature, expectedSignature)) {
    const error = new Error("Invalid Test Engine callback signature");
    error.statusCode = 401;
    throw error;
  }

  const caseSnapshot = (execution.case_snapshots || []).find((snapshot) => snapshot.test_case_id === testCaseId);

  if (!caseSnapshot) {
    throw new Error("Execution test case snapshot not found for this callback");
  }

  if (execution.status === "queued") {
    try {
      await executionService.startExecution(execution.id, {
        skip_testengine_dispatch: true,
        initiated_by: execution.assigned_to || execution.created_by || null
      });
    } catch {
      // Another callback may have already moved the execution into running.
    }
  }

  const testCase = await selectTestCase.get(testCaseId);
  const appTypeId = normalizeText(execution.app_type_id) || normalizeText(testCase?.app_type_id);

  if (!appTypeId) {
    throw new Error("Unable to resolve the execution app type for this callback");
  }

  const existingResult = await executionResultService.findLatestExecutionResult({
    execution_id: execution.id,
    test_case_id: testCaseId
  });

  const resultPayload = isPlainObject(payload.case_result) ? payload.case_result : {};
  const logsFromCaseResult = parseStructuredLogs(resultPayload.logs);
  const logsFromStepOutcomes = buildLogsPayloadFromStepOutcomes(Array.isArray(payload.step_outcomes) ? payload.step_outcomes : []);
  const mergedLogs = mergeLogsPayload(
    mergeLogsPayload(existingResult?.logs || null, logsFromCaseResult),
    logsFromStepOutcomes
  );
  const expectedStepIds = (execution.step_snapshots || [])
    .filter((snapshot) => snapshot.test_case_id === testCaseId)
    .map((snapshot) => normalizeText(snapshot.snapshot_step_id))
    .filter(Boolean);

  const status = deriveCaseStatus(
    normalizeText(resultPayload.status),
    mergedLogs.stepStatuses,
    expectedStepIds,
    existingResult?.status || null,
    event
  );

  const durationMs = normalizeNumber(resultPayload.duration_ms) ?? existingResult?.duration_ms ?? null;
  const errorMessage =
    normalizeText(resultPayload.error)
    || (status === "failed" ? summary : null)
    || existingResult?.error
    || null;

  const result = await executionResultService.upsertExecutionResult({
    execution_id: execution.id,
    test_case_id: testCaseId,
    app_type_id: appTypeId,
    status,
    duration_ms: durationMs,
    error: errorMessage,
    logs: JSON.stringify(mergedLogs),
    executed_by: existingResult?.executed_by || caseSnapshot.assigned_to || execution.assigned_to || null
  });

  const latestStepOutcome = Array.isArray(payload.step_outcomes) && payload.step_outcomes.length
    ? payload.step_outcomes[payload.step_outcomes.length - 1]
    : null;
  const latestStepCaptures = normalizeCaptureRecord(latestStepOutcome?.captures);
  const latestStepEvidence =
    latestStepOutcome?.evidence_image && typeof latestStepOutcome.evidence_image === "object" && !Array.isArray(latestStepOutcome.evidence_image)
      ? {
          dataUrl: normalizeText(latestStepOutcome.evidence_image.data_url) || "",
          fileName: normalizeText(latestStepOutcome.evidence_image.file_name) || undefined,
          mimeType: normalizeText(latestStepOutcome.evidence_image.mime_type) || undefined
        }
      : null;

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: execution.id,
      test_case_id: testCaseId,
      step_id: normalizeText(latestStepOutcome?.step_id),
      source: "testengine.callback",
      summary: summary || `Test Engine reported ${event}`,
      execution_result_id: result.id,
      step_status: normalizeText(latestStepOutcome?.status),
      step_note: normalizeText(latestStepOutcome?.note),
      step_evidence: latestStepEvidence?.dataUrl ? latestStepEvidence : null,
      captures: latestStepCaptures
    });
  } catch {
    // OPS telemetry is best-effort and must not block callback handling.
  }

  const transaction = await ensureTransaction({
    engineRunId,
    execution,
    appTypeId,
    caseSnapshot,
    summary
  });

  const transactionStatus = mapEngineEventToTransactionStatus(event, normalizeText(payload.state));
  const emittedAt = normalizeText(payload.emitted_at);
  const attachedArtifacts = FINAL_ENGINE_EVENTS.has(event)
    ? await attachInlineArtifacts(transaction.id, payload.artifact_bundle)
    : [];
  const metadataPatch = {
    source: "testengine",
    engine_run_id: engineRunId,
    execution_id: execution.id,
    test_case_id: testCaseId,
    execution_result_id: result.id,
    healing_attempted: Boolean(payload.healing_attempted),
    healing_succeeded: Boolean(payload.healing_succeeded),
    deterministic_attempted: Boolean(payload.deterministic_attempted),
    artifact_bundle: isPlainObject(payload.artifact_bundle) ? payload.artifact_bundle : {},
    patch_proposals: Array.isArray(payload.patch_proposals) ? payload.patch_proposals : [],
    attached_artifacts: attachedArtifacts
  };

  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level:
      status === "failed"
        ? "error"
        : FINAL_ENGINE_EVENTS.has(event)
          ? "success"
          : "info",
    phase: event,
    message: summary || `Test Engine reported ${event}`,
    details: {
      state: normalizeText(payload.state),
      status,
      duration_ms: durationMs,
      step_status_count: countEntries(mergedLogs.stepStatuses),
      step_note_count: countEntries(mergedLogs.stepNotes),
      step_evidence_count: countEntries(mergedLogs.stepEvidence),
      step_capture_count: Object.values(mergedLogs.stepCaptures || {}).reduce(
        (count, captures) => count + countEntries(captures),
        0
      ),
      artifact_bundle: isPlainObject(payload.artifact_bundle) ? payload.artifact_bundle : {},
      patch_proposals: Array.isArray(payload.patch_proposals) ? payload.patch_proposals : []
    },
    status: transactionStatus,
    description: summary || undefined,
    metadata: metadataPatch
  });

  if (FINAL_ENGINE_EVENTS.has(event)) {
    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: transactionStatus,
      description: summary || undefined,
      metadata: metadataPatch,
      completed_at: emittedAt || new Date().toISOString()
    });

    await settleExecutionIfComplete(execution);
  }

  return {
    accepted: true,
    execution_id: execution.id,
    execution_result_id: result.id,
    transaction_id: transaction.id
  };
};
