const { createInlineArtifactAttacher } = require("../domain/executionArtifacts");
const crypto = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const executionService = require("@hellotest/testing/backend/services/execution.service");
const executionResultService = require("@hellotest/testing/backend/services/executionResult.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const opsTelemetryService = require("@hellotest/trace/backend/services/opsTelemetry.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const attachInlineArtifacts = createInlineArtifactAttacher((id, ref) => workspaceTransactionService.createTransactionArtifact(id, ref));
const { resolveTestEngineSecret } = require("@hellotest/platform/backend/src/security/runtimeSecrets");
const { createExecutionDiagnosticRedactor } = require('../lib/automationExecutionDiagnostics');

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
  SELECT DISTINCT ON (test_case_id, COALESCE(data_set_iteration_index, -1))
    test_case_id, data_set_iteration_index, status,derived,covers_entire_case
  FROM test_case_effective_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, COALESCE(data_set_iteration_index, -1) ASC, derived DESC, created_at DESC, id DESC
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

const resolveCaseDataSetContext = (execution, caseSnapshot) => {
  const caseSnapshotData = isPlainObject(caseSnapshot?.test_data_set_snapshot)
    ? caseSnapshot.test_data_set_snapshot
    : null;

  if (caseSnapshotData || caseSnapshot?.test_data_set_id) {
    return {
      id: caseSnapshot?.test_data_set_id || caseSnapshotData?.id || null,
      name: caseSnapshot?.test_data_set_name || caseSnapshotData?.name || "Deleted data set",
      snapshot: caseSnapshotData,
      source: ["test_case", "suite"].includes(caseSnapshot?.data_set_source) ? caseSnapshot.data_set_source : "run"
    };
  }

  return execution?.test_data_set
    ? {
        ...execution.test_data_set,
        source: "run"
      }
    : null;
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
      if (status === "passed" || status === "failed" || status === "blocked" || status === "skipped") {
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
  const expectedIds = Array.isArray(expectedStepIds) ? expectedStepIds.filter(Boolean) : [];
  const values = expectedIds.length ? expectedIds.map((id) => stepStatuses?.[id]) : Object.values(stepStatuses || {});
  if (explicitStatus === "failed" || values.includes("failed")) return "failed";
  if (explicitStatus === "blocked") return "blocked";
  const complete = values.length > 0 && values.some((status) => status === "passed")
    && values.every((status) => status === "passed" || status === "skipped");
  if (explicitStatus === "passed") return complete ? "passed" : "blocked";
  if (event === "run.failed" || event === "run.incident") return "failed";
  if (complete) return "passed";
  if (event === "run.progress" && explicitStatus === "running" && !values.some(Boolean)) return "running";
  // A final callback with missing/blocked sections cannot inherit a previous
  // progress pass. Keep incomplete evidence visible as blocked.
  if (event === "run.completed") return "blocked";
  if (fallbackStatus === "failed" || fallbackStatus === "blocked") return fallbackStatus;
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
  headers["x-hellotest-engine-signature"]
  || headers["x-testengine-signature"]
  || headers["x-hellotest-signature"]
  || "";

const resolveCallbackSecret = (integration) =>
  resolveTestEngineSecret(
    normalizeText(integration?.config?.callback_secret),
    normalizeText(process.env.TESTENGINE_CALLBACK_SECRET)
  );

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
  const latestStatusByIteration = new Map(
    latestResults.map((result) => [
      `${normalizeText(result.test_case_id)}:${Number.isInteger(result.data_set_iteration_index) ? result.data_set_iteration_index : -1}`,
      normalizeText(result.status)
    ])
  );
  const coveredCases=new Map(latestResults.filter(row=>row.derived&&row.covers_entire_case).map(row=>[row.test_case_id,row.status]));
  const requiredCases = (execution.case_snapshots || [])
    .filter((snapshot) => normalizeText(snapshot.test_case_id));
  const requiredIterationKeys = requiredCases.flatMap((caseSnapshot) => {
    const testCaseId = normalizeText(caseSnapshot.test_case_id);
    const dataSet = resolveCaseDataSetContext(execution, caseSnapshot);
    const dataSetRows = dataSet?.snapshot?.mode === "table" && Array.isArray(dataSet.snapshot.rows)
      ? dataSet.snapshot.rows
      : [];
    const iterationIndexes = dataSet
      ? dataSetRows.length ? dataSetRows.map((_row, index) => index) : [0]
      : [-1];

    return iterationIndexes.map((iterationIndex) => {
      const key=`${testCaseId}:${iterationIndex}`;
      if(coveredCases.has(testCaseId)&&(!latestStatusByIteration.has(key)||latestStatusByIteration.get(key)==="pending"))latestStatusByIteration.set(key,coveredCases.get(testCaseId));
      return key;
    });
  });

  if (!requiredCases.length || requiredIterationKeys.some((key) => !["passed", "failed", "blocked", "aborted", "skipped"].includes(latestStatusByIteration.get(key)))) {
    return;
  }

  const nextExecutionStatus = requiredIterationKeys.every((key) => latestStatusByIteration.get(key) === "passed")
    ? "completed"
    : "failed";

  try {
    await executionService.completeExecution(execution.id, nextExecutionStatus);
  } catch {
    // Another callback may have already settled the execution.
  }
}

// A delivery retry may have a different payload hash or race another final
// delivery. Serialize by dispatched engine attempt, including legacy attempts
// whose workspace receipt is created by the first callback.
const withEngineCallbackLock = obsDb.transaction(async (engineRunId, receive) => {
  await obsDb.query("SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", ["hellotest.engine-callback", engineRunId]);
  return receive();
});

exports.handleRunCallback = async ({ headers, payload, rawPayload }) => {
  if (!isPlainObject(payload)) {
    throw new Error("Callback payload must be an object");
  }

  const engineRunId = normalizeText(payload.engine_run_id);
  const executionId = normalizeText(payload.hellotest_execution_id) || normalizeText(payload.hellotest_run_id);
  const testCaseId = normalizeText(payload.hellotest_test_case_id);
  const event = normalizeText(payload.event) || "run.progress";
  let summary = normalizeText(payload.summary);

  if (!engineRunId || !executionId || !testCaseId) {
    throw new Error("engine_run_id, hellotest_execution_id or hellotest_run_id, and hellotest_test_case_id are required");
  }

  const execution = await executionService.getExecution(executionId);
  let integration, boundTransaction;
  if(execution.trigger === "local") {
    const dispatch=boundTransaction=await workspaceTransactionService.findTransactionByRelated({related_kind:"testengine_run",related_id:engineRunId});
    if(!dispatch || dispatch.project_id!==execution.project_id || dispatch.metadata?.source!=="hellotest.local-run" || !['direct-local','paired-local'].includes(dispatch.metadata?.queue_mode) || dispatch.metadata?.execution_id!==execution.id || dispatch.metadata?.test_case_id!==testCaseId)throw new Error("This local callback does not match a dispatched run.");
    integration={config:{}};
  } else integration=await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);

  if (!integration) {
    throw new Error("No active Test Engine integration is configured for this project");
  }

  const callbackSecret = boundTransaction?.metadata?.queue_mode==='paired-local'
    ? await require('./pairedLocalExecution.service').callbackSecretFor({execution,payload,transaction:boundTransaction})
    : resolveCallbackSecret(integration);

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

  return withEngineCallbackLock(engineRunId, async () => {
    // Re-read after acquiring the lock: a concurrent final callback may have
    // committed its authoritative receipt while this delivery was waiting.
    boundTransaction = await workspaceTransactionService.findTransactionByRelated({related_kind:"testengine_run",related_id:engineRunId});
    if (boundTransaction && (
      boundTransaction.project_id !== execution.project_id
      || (boundTransaction.metadata?.execution_id && boundTransaction.metadata.execution_id !== execution.id)
      || (boundTransaction.metadata?.test_case_id && boundTransaction.metadata.test_case_id !== testCaseId)
    )) throw new Error("This callback does not match its dispatched run.");
    const callbackId = crypto.createHash("sha256").update(serializedPayload).digest("hex");
    const receipt = boundTransaction?.metadata?.callback_receipts?.find(item => item.id === callbackId);
    if (receipt) return { accepted: true, duplicate: true, execution_id: execution.id, execution_result_id: receipt.result_id, transaction_id: boundTransaction.id };
    if (boundTransaction?.metadata?.callback_final_received) return {
      accepted: true, stale: true, execution_id: execution.id,
      execution_result_id: boundTransaction.metadata.execution_result_id || null,
      transaction_id: boundTransaction.id
    };

    const caseSnapshot = (execution.case_snapshots || []).find((snapshot) => snapshot.test_case_id === testCaseId);

    if (!caseSnapshot) {
      throw new Error("Execution test case snapshot not found for this callback");
    }
    // Verify the original signature first; redact diagnostic copies using the
    // frozen dispatch context before any result, activity or telemetry write.
    const incomingCaptures = (Array.isArray(payload.step_outcomes) ? payload.step_outcomes : []).map(row => row?.captures || {});
    const incomingLogCaptures = parseStructuredLogs(payload.case_result?.logs).stepCaptures;
    const redactDiagnostic = createExecutionDiagnosticRedactor(execution, incomingCaptures, incomingLogCaptures);
    payload = redactDiagnostic(payload);
    summary = normalizeText(payload.summary);

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
    const dataSetIteration = isPlainObject(payload.data_set_iteration) ? payload.data_set_iteration : null;
    const dataSetIterationIndex = Number.isInteger(dataSetIteration?.index) ? dataSetIteration.index : null;
    const caseDataSet = resolveCaseDataSetContext(execution, caseSnapshot);
    const caseDataSetRows = Array.isArray(caseDataSet?.snapshot?.rows) ? caseDataSet.snapshot.rows : [];
    const dataSetRowSnapshot = caseDataSet?.snapshot?.mode === "key_value"
      ? Object.fromEntries(caseDataSetRows.map((row) => [normalizeText(row?.key), row?.value]).filter(([key]) => key))
      : dataSetIterationIndex !== null ? caseDataSetRows[dataSetIterationIndex] || null : null;

    if (!appTypeId) {
      throw new Error("Unable to resolve the execution app type for this callback");
    }

    const existingResult = await executionResultService.findLatestExecutionResult({
      execution_id: execution.id,
      test_case_id: testCaseId,
      data_set_iteration_index: dataSetIterationIndex
    });

    const resultPayload = isPlainObject(payload.case_result) ? payload.case_result : {};
    const logsFromCaseResult = parseStructuredLogs(resultPayload.logs);
    const logsFromStepOutcomes = buildLogsPayloadFromStepOutcomes(Array.isArray(payload.step_outcomes) ? payload.step_outcomes : []);
    const mergedLogs = redactDiagnostic(mergeLogsPayload(
      mergeLogsPayload(existingResult?.logs || null, logsFromCaseResult),
      logsFromStepOutcomes
    ));
    mergedLogs.stepEvidence = await require('./engineArtifact.service').validateEvidence(mergedLogs.stepEvidence,existingResult?.id);
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
    const errorMessage = redactDiagnostic(
      normalizeText(resultPayload.error)
      || (status === "failed" ? summary : null)
      || existingResult?.error
      || null);

    const result = await executionResultService.upsertExecutionResult({
      execution_id: execution.id,
      test_case_id: testCaseId,
      app_type_id: appTypeId,
      status,
      duration_ms: durationMs,
      error: errorMessage,
      logs: JSON.stringify(mergedLogs),
      executed_by: existingResult?.executed_by || caseSnapshot.assigned_to || execution.assigned_to || null,
      test_data_set_id: caseDataSet?.id || null,
      test_data_set_name: caseDataSet?.name || null,
      data_set_iteration_index: dataSetIterationIndex,
      data_set_iteration_key: normalizeText(dataSetIteration?.key),
      data_set_row_snapshot: dataSetRowSnapshot
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
        : mergedLogs.stepEvidence[normalizeText(latestStepOutcome?.step_id) || ""] || null;

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
    const validatedArtifactBundle = await require("./engineArtifact.service").validateBundle(payload.artifact_bundle, result.id);
    const metadataPatch = {
      source: execution.trigger === "local" ? "hellotest.local-run" : "testengine",
      engine_run_id: engineRunId,
      execution_id: execution.id,
      test_case_id: testCaseId,
      execution_result_id: result.id,
      healing_attempted: Boolean(payload.healing_attempted),
      healing_succeeded: Boolean(payload.healing_succeeded),
      deterministic_attempted: Boolean(payload.deterministic_attempted),
      artifact_bundle: validatedArtifactBundle,
      patch_proposals: Array.isArray(payload.patch_proposals) ? payload.patch_proposals : [],
      attached_artifacts: attachedArtifacts.length ? attachedArtifacts : transaction.metadata?.attached_artifacts || [],
      callback_receipts: [...(transaction.metadata?.callback_receipts || []), { id: callbackId, result_id: result.id }].slice(-128),
      callback_final_received: FINAL_ENGINE_EVENTS.has(event) || Boolean(transaction.metadata?.callback_final_received)
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
        artifact_bundle: validatedArtifactBundle,
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
  });
};
