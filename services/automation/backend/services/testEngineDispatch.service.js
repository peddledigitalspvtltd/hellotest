const {leaseSeconds:normalizeLeaseSeconds,leaseExpiry} = require('@hellotest/contracts/runtime/lease');
const dispatchDependency = specifier => require(specifier.startsWith('../') ? specifier.slice(3) : specifier);
async function configuredRepairBrief() {
  const {config}=await require('@hellotest/platform/backend/services/aiConfiguration.service').resolve('ai.automation.locator_repair');
  const blocks=config.instruction_blocks;
  return {goal:blocks['engineRepair.goal'],screen_selection:blocks['engineRepair.screen_selection'],correction_policy:blocks['engineRepair.correction_policy'].split('\n').filter(Boolean)};
}
const { createInlineArtifactAttacher, hasFailureScreenshotOverride } = require("../domain/executionArtifacts");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid } = require("crypto");
const executionResultService = require("@hellotest/testing/backend/services/executionResult.service");
const { executionWithCaseEnvironment } = require("../lib/build/automationExecutionEnvironment");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const attachInlineArtifacts = createInlineArtifactAttacher((id, ref) => workspaceTransactionService.createTransactionArtifact(id, ref));
const apiRequestExecutionService = require("./apiRequestExecution.service");
const executionStepRuntimeService = require("@hellotest/platform/backend/src/domain/executionStepEvidence");
const opsTelemetryService = require("@hellotest/trace/backend/services/opsTelemetry.service");
const { AsyncLocalStorage } = require('node:async_hooks');
// Optional hierarchy delivery must never own a job-row lock or delay a worker
// acknowledgement. Coalesce bursts to one active send plus the latest event
// per Run; durable step/case receipts remain in their existing transaction.
const queuedTelemetryScope = new AsyncLocalStorage();
const queuedTelemetryRuns = new Map();
const deliverQueuedTelemetry = payload => {
  const existing = queuedTelemetryRuns.get(payload.execution_id);
  if (existing) { existing.pending = payload; return; }
  const state = { pending: payload };
  queuedTelemetryRuns.set(payload.execution_id, state);
  const deliver = async () => {
    try {
      while (state.pending) {
        const next = state.pending; state.pending = null;
        try { await opsTelemetryService.emitExecutionHierarchyEvents(next); }
        catch { /* Best-effort delivery never changes the committed receipt. */ }
      }
    } finally { queuedTelemetryRuns.delete(payload.execution_id); }
  };
  // Detached work must not inherit either database's transaction connection.
  void Promise.resolve().then(() => db.outsideTransaction(() => obsDb.outsideTransaction(deliver))).catch(() => {});
};
const withCommittedQueuedTelemetry = operation => async (...args) => {
  if (queuedTelemetryScope.getStore()) return operation(...args);
  const pending = [];
  const receipt = await queuedTelemetryScope.run(pending, () => operation(...args));
  // The outer queue transaction has committed and released its connection.
  for (const payload of pending) deliverQueuedTelemetry(payload);
  return receipt;
};
const queueCommittedTelemetry = payload => { queuedTelemetryScope.getStore()?.push(payload); };
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const { resolveParameterLayers, normalizeParameterLayer, collectPriorParameterCaptures, matchesParameterIteration } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { preserveFrozenEngineEnvelope, normalizeFrozenCapturedValues } = require("@hellotest/platform/backend/src/utils/frozenRunParameterCompatibility");
const { configurationTargetsForRead } = require("@hellotest/platform/backend/src/utils/configurationTargets");
const { resolveTestEngineSecret } = require("@hellotest/platform/backend/src/security/runtimeSecrets");
const { readBoundedResponseJson } = require("@hellotest/platform/backend/src/utils/boundedResponse");
const { resilientHttpRequest } = require("@hellotest/platform/backend/src/utils/resilientHttpClient");
const { SERVICE_ERROR_CODES, serviceError } = require("@hellotest/platform/backend/src/utils/serviceErrors");
const { createExecutionDiagnosticRedactor } = require("../lib/build/automationExecutionDiagnostics");
const { resolveAutomationCaseSteps, resolveAutomationCaseType } = require('@hellotest/platform/backend/src/utils/automationCaseType');
const parameterMode = import('../../shared/automationParameterMode.mjs');

const SUPPORTED_ENGINE_STEP_TYPES = new Set(["api", "web", "android", "ios"]);
const TESTENGINE_ENGINE_CLASSES = new Set(["api", "web", "android"]);
const DEFAULT_LEASE_SECONDS = normalizeLeaseSeconds(process.env.TESTENGINE_JOB_LEASE_SECONDS, 90);
const DIRECT_DISPATCH_TIMEOUT_MS = Math.max(1_000, Math.min(60_000, Number(process.env.TESTENGINE_DIRECT_DISPATCH_TIMEOUT_MS || 10_000)));
const TESTENGINE_WEB_ENGINE_VALUES = new Set(["playwright", "selenium"]);
const TESTENGINE_BROWSER_ALIASES = new Map([
  ["chrome", "chromium"],
  ["chromium", "chromium"],
  ["edge", "chromium"],
  ["firefox", "firefox"],
  ["ff", "firefox"],
  ["safari", "webkit"],
  ["webkit", "webkit"]
]);

const selectProject = db.prepare(`
  SELECT id, name, display_id
  FROM projects
  WHERE id = ?
`);

const selectAppType = db.prepare(`
  SELECT id, name, type
  FROM app_types
  WHERE id = ?
`);

const selectTestCaseDispatchMetadata = db.prepare(`
  SELECT id, title, display_id, automated, automation_status
  FROM test_cases
  WHERE id = ?
`);

const selectObjectRepositoryEntries = obsDb.prepare(`
  SELECT id, project_id, app_type_id, test_case_id, page_url, page_key, locator_intent, locator, locator_kind, confidence, source, metadata, created_at, updated_at
  FROM automation_learning_cache
  WHERE (?::text IS NULL OR project_id = ?::text OR (project_id IS NULL AND app_type_id = ?::text
    AND EXISTS(SELECT 1 FROM app_types owner_app WHERE owner_app.id=automation_learning_cache.app_type_id AND owner_app.project_id=?::text)))
    AND (?::text IS NULL OR app_type_id = ?::text)
    AND COALESCE(metadata->>'merged_into_entry_id', '') = ''
  ORDER BY hit_count DESC, updated_at DESC
`);

const selectExecutionCaseIds = db.prepare(`
  SELECT test_case_id, test_data_set_id, test_data_set_name, test_data_set_snapshot, data_set_source
  FROM execution_case_snapshots
  WHERE execution_id = ?
`);

const selectExecutionDataSetContext = db.prepare(`
  SELECT test_data_set_id, test_data_set_snapshot
  FROM executions
  WHERE id = ?
`);

const selectExecutionCaseOrder = db.prepare(`
  SELECT test_case_id, suite_id, sort_order
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const selectSuiteParallelConfig = db.prepare(`
  SELECT id, parallel_enabled, parallel_count
  FROM test_suites
  WHERE id = ?
`);

const selectLatestResultsForExecution = db.prepare(`
  SELECT DISTINCT ON (test_case_id, COALESCE(data_set_iteration_index, -1))
    test_case_id, data_set_iteration_index, status,derived,covers_entire_case
  FROM test_case_effective_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, COALESCE(data_set_iteration_index, -1) ASC, derived DESC, created_at DESC, id DESC
`);

const selectLatestJobStatusesForExecution = obsDb.prepare(`
  SELECT test_case_id, status
  FROM test_engine_jobs
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, created_at ASC, id ASC
`);

const selectLatestLogsForExecution = db.prepare(`
  SELECT DISTINCT ON (test_case_id, COALESCE(data_set_iteration_index, -1)) test_case_id, logs, test_data_set_id, data_set_iteration_index
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, COALESCE(data_set_iteration_index, -1) ASC, created_at DESC, id DESC
`);

const selectCompletedJobCapturesForExecution = obsDb.prepare(`
  SELECT test_case_id, payload #>> '{data_set,id}' AS test_data_set_id,
    payload #> '{data_set,iteration,index}' AS data_set_iteration_index,
    runtime_state->'captured_values' AS captured_values
  FROM test_engine_jobs
  WHERE execution_id = ? AND completed_at IS NOT NULL
  ORDER BY created_at DESC, id DESC
`);


const settleExecutionStatus = db.prepare(`
  UPDATE executions
  SET status = ?, ended_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running'
`);

const insertJob = obsDb.prepare(`
  INSERT INTO test_engine_jobs (
    id,
    engine_run_id,
    integration_id,
    project_id,
    app_type_id,
    app_type_kind,
    engine_class,
    engine_max_workers,
    execution_id,
    test_case_id,
    test_case_title,
    transaction_id,
    engine_host,
    payload,
    runtime_state,
    status,
    attempts,
    leased_by,
    lease_expires_at,
    started_at,
    completed_at,
    last_error,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectJob = obsDb.prepare(`
  SELECT jobs.*, executions.parameter_scope_default AS execution_parameter_scope_default
  FROM test_engine_jobs jobs
  LEFT JOIN executions ON executions.id = jobs.execution_id
  WHERE jobs.id = ?
`);

const selectQueueStats = obsDb.prepare(`
  SELECT status, engine_class, app_type_kind, engine_max_workers, payload
  FROM test_engine_jobs
  WHERE completed_at IS NULL
    AND status IN ('queued', 'leased', 'running')
`);

const updateJobLeaseState = obsDb.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      leased_by = ?,
      lease_expires_at = ?,
      started_at = COALESCE(started_at, ?),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobRuntimeStateForLease = obsDb.prepare(`
  UPDATE test_engine_jobs
  SET runtime_state = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobRuntimeState = obsDb.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      runtime_state = ?,
      lease_expires_at = ?,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const finalizeJobState = obsDb.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      runtime_state = ?,
      lease_expires_at = NULL,
      completed_at = ?,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};
const { normalizeEngineHostUrl, normalizeFallbackLocator, normalizeFallbackLocators, normalizeObjectRepositoryEntry, normalizeInteger, normalizeBoolean, toRowArray, normalizeTestEngineWebEngine, normalizeEngineClass, resolveStepEngineClass, resolveStepEngineClasses, resolveOrchestrationClass, getQueueMaxWorkers, resolveIntegrationEngineMaxWorkers, resolveIntegrationEngineWorkerCaps, recommendWorkersForQueue, normalizeEngineBrowser, normalizeSessionMode, normalizeHookFailBehavior, normalizeEngineHookStep, normalizeEngineHooks, buildHookStepFromSnapshot, normalizeHookArray, resolveExecutionHooks, buildStepAutomationDetail, buildProviderLiveViewUrl, resolveDirectCallbackBaseUrl, resolveCallbackSecret, buildDirectCallback, normalizeInlineEvidence, normalizeApiDetail, normalizeWebDetail, normalizeAutomationDetail, normalizeArtifactBundle, normalizePatchProposals, normalizeJsonValue, normalizeStringRecord, normalizeCapturedValuesRecord, normalizeStepCapturesRecord, toEngineKeyValueEntries, toEngineDataSetRows, resolveCaseDataSetContext, resolveEngineStepType, buildManualSpec } = require('./dispatch/engineTypes').createEngineTypes({exports,require: dispatchDependency,get SUPPORTED_ENGINE_STEP_TYPES(){return SUPPORTED_ENGINE_STEP_TYPES;},get TESTENGINE_BROWSER_ALIASES(){return TESTENGINE_BROWSER_ALIASES;},get TESTENGINE_ENGINE_CLASSES(){return TESTENGINE_ENGINE_CLASSES;},get TESTENGINE_WEB_ENGINE_VALUES(){return TESTENGINE_WEB_ENGINE_VALUES;},get normalizeApiRequest(){return normalizeApiRequest;},get normalizeParameterLayer(){return normalizeParameterLayer;},get normalizeRichText(){return normalizeRichText;},get normalizeTestStepType(){return normalizeTestStepType;},get normalizeText(){return normalizeText;},get nowIso(){return nowIso;},get resolveTestEngineSecret(){return resolveTestEngineSecret;}});


const listObjectRepositoryForEnvelope = async ({ projectId, appTypeId, testCaseId }) => {
  const scopedProjectId = projectId || null;
  const scopedAppTypeId = appTypeId || null;
  const rows = await selectObjectRepositoryEntries.all(scopedProjectId, scopedProjectId, scopedAppTypeId, scopedProjectId, scopedAppTypeId, scopedAppTypeId);
  const identity = require("../lib/build/repositoryScreenIdentity");
  const canonical = identity.canonicalizeRepositoryRows(rows.map(row => ({...row,
    project_id: row.project_id || scopedProjectId, app_type_id: row.app_type_id || scopedAppTypeId
  }))).rows;
  const normalized = canonical
    .filter(entry => !identity.isRepositoryScreen(entry))
    .map(normalizeObjectRepositoryEntry)
    .filter((entry) =>
      entry.locator
      && !entry.metadata?.merged_into_entry_id
      && entry.locator_intent !== "__screen__"
      && entry.metadata?.record_kind !== "screen"
    );

  const direct = normalized.filter((entry) => entry.test_case_id && entry.test_case_id === testCaseId);
  const shared = normalized.filter((entry) => !entry.test_case_id || entry.test_case_id !== testCaseId);

  return [...direct, ...shared];
};

const nowIso = () => new Date().toISOString();

const isMissingWorkspaceTransactionError = (error) =>
  error instanceof Error && /workspace transaction not found/i.test(error.message || "");

const appendQueueTransactionEvent = async (transactionId, event) => {
  if (!transactionId) {
    return null;
  }

  try {
    return await workspaceTransactionService.appendTransactionEvent(transactionId, event);
  } catch (error) {
    if (isMissingWorkspaceTransactionError(error)) {
      return null;
    }

    throw error;
  }
};

const updateQueueTransaction = async (transactionId, patch) => {
  if (!transactionId) {
    return null;
  }

  try {
    return await workspaceTransactionService.updateTransaction(transactionId, patch);
  } catch (error) {
    if (isMissingWorkspaceTransactionError(error)) {
      return null;
    }

    throw error;
  }
};

const resolveExecutionPolicy = async (execution, caseSnapshot) => {
  const runParallelEnabled = normalizeBoolean(execution?.parallel_enabled, false);
  const runParallelCount = Math.max(1, normalizeInteger(execution?.parallel_count, 1) ?? 1);
  const frozenPolicy = caseSnapshot?.test_data_options?.execution_policy;
  if (frozenPolicy && typeof frozenPolicy === 'object' && !Array.isArray(frozenPolicy)) {
    const hasSuiteOverride = Boolean(frozenPolicy.suite_parallel_override && caseSnapshot?.suite_id);
    const parallelEnabled = hasSuiteOverride ? normalizeBoolean(frozenPolicy.parallel_enabled, false) : runParallelEnabled;
    return {
      parallel_enabled: parallelEnabled,
      parallel_count: parallelEnabled ? Math.max(1, normalizeInteger(hasSuiteOverride ? frozenPolicy.parallel_count : runParallelCount, runParallelCount) ?? runParallelCount) : 1,
      suite_parallel_override: hasSuiteOverride,
      suite_id: caseSnapshot?.suite_id || null,
      execution_order: Math.max(1, normalizeInteger(caseSnapshot?.sort_order, 1) ?? 1)
    };
  }
  const suiteConfig = caseSnapshot?.suite_id ? await selectSuiteParallelConfig.get(caseSnapshot.suite_id) : null;
  const hasSuiteOverride = suiteConfig && suiteConfig.parallel_enabled !== null && suiteConfig.parallel_enabled !== undefined;
  const parallelEnabled = hasSuiteOverride ? normalizeBoolean(suiteConfig.parallel_enabled, false) : runParallelEnabled;
  const parallelCount = parallelEnabled
    ? Math.max(1, normalizeInteger(hasSuiteOverride ? suiteConfig.parallel_count : runParallelCount, runParallelCount) ?? runParallelCount)
    : 1;

  return {
    parallel_enabled: parallelEnabled,
    parallel_count: parallelCount,
    suite_parallel_override: Boolean(hasSuiteOverride),
    suite_id: caseSnapshot?.suite_id || null,
    execution_order: Math.max(1, normalizeInteger(caseSnapshot?.sort_order, 1) ?? 1)
  };
};
const { buildEngineEnvelope } = require('./dispatch/engineEnvelope').createEngineEnvelope({exports,require: dispatchDependency,get buildManualSpec(){return buildManualSpec;},get configurationTargetsForRead(){return configurationTargetsForRead;},get configuredRepairBrief(){return configuredRepairBrief;},get executionWithCaseEnvironment(){return executionWithCaseEnvironment;},get normalizeEngineBrowser(){return normalizeEngineBrowser;},get normalizeInteger(){return normalizeInteger;},get normalizeSessionMode(){return normalizeSessionMode;},get normalizeStoredReferenceList(){return normalizeStoredReferenceList;},get normalizeStringRecord(){return normalizeStringRecord;},get normalizeTestEngineWebEngine(){return normalizeTestEngineWebEngine;},get normalizeText(){return normalizeText;},get preserveFrozenEngineEnvelope(){return preserveFrozenEngineEnvelope;},get resolveAutomationCaseType(){return resolveAutomationCaseType;},get resolveCaseDataSetContext(){return resolveCaseDataSetContext;},get resolveExecutionHooks(){return resolveExecutionHooks;},get resolveExecutionPolicy(){return resolveExecutionPolicy;},get toEngineDataSetRows(){return toEngineDataSetRows;},get toEngineKeyValueEntries(){return toEngineKeyValueEntries;}});


const summarizeWarnings = (warnings) => {
  if (!Array.isArray(warnings) || !warnings.length) {
    return [];
  }

  return warnings.map((warning) => String(warning)).filter(Boolean);
};

const parseStructuredLogs = (value) => {
  const parsed = normalizeJsonValue(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
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

  const normalizedStepCaptures = normalizeStepCapturesRecord(parsed.stepCaptures);

  return {
    stepStatuses: parsed.stepStatuses && typeof parsed.stepStatuses === "object" && !Array.isArray(parsed.stepStatuses)
      ? { ...parsed.stepStatuses }
      : {},
    stepNotes: parsed.stepNotes && typeof parsed.stepNotes === "object" && !Array.isArray(parsed.stepNotes)
      ? { ...parsed.stepNotes }
      : {},
    stepEvidence: parsed.stepEvidence && typeof parsed.stepEvidence === "object" && !Array.isArray(parsed.stepEvidence)
      ? { ...parsed.stepEvidence }
      : {},
    stepApiDetails: parsed.stepApiDetails && typeof parsed.stepApiDetails === "object" && !Array.isArray(parsed.stepApiDetails)
      ? { ...parsed.stepApiDetails }
      : {},
    stepWebDetails: parsed.stepWebDetails && typeof parsed.stepWebDetails === "object" && !Array.isArray(parsed.stepWebDetails)
      ? { ...parsed.stepWebDetails }
      : {},
    stepAutomationDetails: parsed.stepAutomationDetails && typeof parsed.stepAutomationDetails === "object" && !Array.isArray(parsed.stepAutomationDetails)
      ? { ...parsed.stepAutomationDetails }
      : {},
    stepCaptures: normalizedStepCaptures
  };
};

const parseRuntimeState = (value) => {
  const parsed = normalizeJsonValue(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      captured_values: {},
      logs: parseStructuredLogs(null)
    };
  }

  return {
    captured_values: normalizeCapturedValuesRecord(parsed.captured_values),
    logs: parseStructuredLogs(parsed.logs),
    deterministic_attempted: parsed.deterministic_attempted === true,
    healing_attempted: parsed.healing_attempted === true,
    healing_succeeded: parsed.healing_succeeded === true,
    final_summary: normalizeText(parsed.final_summary),
    artifact_bundle: normalizeArtifactBundle(parsed.artifact_bundle),
    patch_proposals: normalizePatchProposals(parsed.patch_proposals),
    ...(parsed.interrupted_attempt?.code === 'TESTENGINE_JOB_ATTEMPT_EXPIRED' ? {interrupted_attempt:parsed.interrupted_attempt} : {})
  };
};

const hydrateJob = (row) => {
  if (!row) {
    return null;
  }

  const payload = normalizeJsonValue(row.payload, {});
  const scope = row.execution_parameter_scope_default || payload.parameter_scope_default || "r";
  const runtime = parseRuntimeState(row.runtime_state);
  return {
    ...row,
    payload: preserveFrozenEngineEnvelope(payload, scope),
    runtime_state: { ...runtime, captured_values: normalizeFrozenCapturedValues(runtime.captured_values, scope) }
  };
};

const buildRuntimeParameterValues = (envelope, capturedValues = {}, step = null) => ({
  ...resolveParameterLayers({
    sharedValues: step?.shared_parameter_values,
    dataPolicy: step?.source_case_context?.data_policy || envelope.data_policy,
    isSharedStep: step?.group_kind === "reusable",
    caseValues: step?.source_case_context ? step.source_case_context.case_parameters : { ...envelope.manual_spec?.test_data, ...envelope.case_parameters },
    suiteValues: step?.source_case_context ? step.source_case_context.suite_parameters : envelope.suite_parameters,
    environmentVariables: envelope.environment?.variables,
    configurationVariables: envelope.configuration?.variables,
    runValues: envelope.run_parameters,
    dataSet: step?.source_case_context ? step.source_case_context.data_set : envelope.data_set
  }),
  // A hook executes with its source case's test data, just as in the web/native
  // worker. Captures remain the last layer so setup can hand values to teardown.
  ...normalizeParameterLayer(step?.source_case_context ? {} : step?.source_case_parameters, "t"),
  ...normalizeFrozenCapturedValues(capturedValues, envelope.parameter_scope_default)
});

const resultStatusToJobStatus = (status) => {
  if (status === "passed") {
    return "completed";
  }

  if (status === "aborted") {
    return "aborted";
  }

  return "failed";
};

const resolveExecutionDataSetIterations = (execution, caseSnapshot) => {
  const dataSet = resolveCaseDataSetContext(execution, caseSnapshot);
  const rows = toEngineDataSetRows(dataSet?.snapshot?.rows);
  if (!dataSet || dataSet.snapshot?.mode === "key_value" || !rows.length) {
    return [{ index: 0, key: dataSet ? `${dataSet.id || "data-set"}:1` : "default:1", total: 1, row: null }];
  }
  return rows.map((row, index) => ({
    index,
    key: `${dataSet.id || "data-set"}:${index + 1}`,
    total: rows.length,
    row
  }));
};

const resultIterationFromJob = (job) => {
  const iteration = job?.payload?.data_set?.iteration;
  const dataSetRows = Array.isArray(job?.payload?.data_set?.rows) ? job.payload.data_set.rows : [];
  const rowSnapshot = job?.payload?.data_set?.mode === "key_value"
    ? Object.fromEntries(dataSetRows.map((row) => [normalizeText(row?.key), row?.value]).filter(([key]) => key))
    : dataSetRows[0] || null;
  return {
    test_data_set_id: job?.payload?.data_set ? job.payload.data_set.id || null : null,
    test_data_set_name: job?.payload?.data_set?.name || null,
    data_set_iteration_index: Number.isInteger(iteration?.index) ? iteration.index : null,
    data_set_iteration_key: normalizeText(iteration?.key),
    data_set_row_snapshot: rowSnapshot
  };
};
const { planExecutionDispatch, settleExecutionIfComplete, queueExecutionDispatch, localPlaywrightIntegration, preparePairedLocalDispatch, runExecutionDirectLocal, queueSingleStepDispatch } = require('./dispatch/executionPlanning').createExecutionPlanning({exports,require: dispatchDependency,get DIRECT_DISPATCH_TIMEOUT_MS(){return DIRECT_DISPATCH_TIMEOUT_MS;},get SERVICE_ERROR_CODES(){return SERVICE_ERROR_CODES;},get buildDirectCallback(){return buildDirectCallback;},get buildEngineEnvelope(){return buildEngineEnvelope;},get buildProviderLiveViewUrl(){return buildProviderLiveViewUrl;},get getQueueMaxWorkers(){return getQueueMaxWorkers;},get hasFailureScreenshotOverride(){return hasFailureScreenshotOverride;},get insertJob(){return insertJob;},get isFinalResultStatus(){return isFinalResultStatus;},get listObjectRepositoryForEnvelope(){return listObjectRepositoryForEnvelope;},get normalizeApiRequest(){return normalizeApiRequest;},get normalizeEngineHostUrl(){return normalizeEngineHostUrl;},get normalizeFrozenCapturedValues(){return normalizeFrozenCapturedValues;},get normalizeInteger(){return normalizeInteger;},get normalizeJsonValue(){return normalizeJsonValue;},get normalizeRichText(){return normalizeRichText;},get normalizeStringRecord(){return normalizeStringRecord;},get normalizeText(){return normalizeText;},get obsDb(){return obsDb;},get parameterMode(){return parameterMode;},get parseStructuredLogs(){return parseStructuredLogs;},get readBoundedResponseJson(){return readBoundedResponseJson;},get resilientHttpRequest(){return resilientHttpRequest;},get resolveAutomationCaseSteps(){return resolveAutomationCaseSteps;},get resolveCaseDataSetContext(){return resolveCaseDataSetContext;},get resolveEngineStepType(){return resolveEngineStepType;},get resolveExecutionDataSetIterations(){return resolveExecutionDataSetIterations;},get resolveIntegrationEngineWorkerCaps(){return resolveIntegrationEngineWorkerCaps;},get resolveOrchestrationClass(){return resolveOrchestrationClass;},get resolveStepEngineClass(){return resolveStepEngineClass;},get resolveStepEngineClasses(){return resolveStepEngineClasses;},get resolveTestEngineSecret(){return resolveTestEngineSecret;},get selectAppType(){return selectAppType;},get selectExecutionCaseIds(){return selectExecutionCaseIds;},get selectExecutionDataSetContext(){return selectExecutionDataSetContext;},get selectLatestResultsForExecution(){return selectLatestResultsForExecution;},get selectProject(){return selectProject;},get selectTestCaseDispatchMetadata(){return selectTestCaseDispatchMetadata;},get serviceError(){return serviceError;},get settleExecutionStatus(){return settleExecutionStatus;},get summarizeWarnings(){return summarizeWarnings;},get updateQueueTransaction(){return updateQueueTransaction;},get uuid(){return uuid;},get workspaceTransactionService(){return workspaceTransactionService;}});


async function getQueuedJob(id) {
  const job = hydrateJob(await selectJob.get(id));

  if (!job) {
    throw new Error("Test Engine queue job not found");
  }

  return job;
}

const isFinalResultStatus = (status) => ["passed", "failed", "blocked", "aborted", "skipped"].includes(normalizeText(status));
const isFinalJobStatus = (status) => ["completed", "failed", "aborted"].includes(normalizeText(status));

const collectPriorExecutionCaptures = async (executionId, testCaseId, iteration = {}, defaultScope = "r") => {
  const orderRows = toRowArray(await selectExecutionCaseOrder.all(executionId));
  const current = orderRows.find((row) => row.test_case_id === testCaseId);

  if (!current) {
    return {};
  }

  const priorIds = new Set(
    orderRows
      .filter((row) =>
        Number(row.sort_order || 0) < Number(current.sort_order || 0)
      )
      .map((row) => row.test_case_id)
  );

  if (!priorIds.size) {
    return {};
  }

  const capturesByCaseId = {};
  // Executable outputs live in the private job runtime. Public result logs are
  // redacted diagnostics: transferring their token/password placeholders would
  // corrupt the next case's inputs. Suite scheduling limits do not change the
  // run parameter namespace; the common collector below enforces s./t. scope.
  for (const row of toRowArray(await selectCompletedJobCapturesForExecution.all(executionId))) {
    if (!priorIds.has(row.test_case_id) || Object.hasOwn(capturesByCaseId, row.test_case_id)
      || !matchesParameterIteration(row, iteration)) continue;
    capturesByCaseId[row.test_case_id] = normalizeFrozenCapturedValues(normalizeJsonValue(row.captured_values, {}), defaultScope);
  }
  // Legacy/manual results have no engine runtime receipt. Keep their usable
  // outputs without ever turning a diagnostic masking marker into test data.
  for (const row of toRowArray(await selectLatestLogsForExecution.all(executionId))) {
    if (!matchesParameterIteration(row, iteration) || !priorIds.has(row.test_case_id) || Object.hasOwn(capturesByCaseId, row.test_case_id)) {
      continue;
    }

    capturesByCaseId[row.test_case_id] = Object.fromEntries(Object.entries(normalizeFrozenCapturedValues(
      executionStepRuntimeService.extractCapturedValuesFromLogs(row.logs), defaultScope)).filter(([,value]) => value !== '[REDACTED]'));
  }

  return collectPriorParameterCaptures(orderRows, testCaseId, capturesByCaseId);
};

const arePriorCasesComplete = async (executionId, testCaseId, suiteId, suiteScoped) => {
  const orderRows = toRowArray(await selectExecutionCaseOrder.all(executionId));
  const current = orderRows.find((row) => row.test_case_id === testCaseId);

  if (!current) {
    return true;
  }

  const priorIds = orderRows
    .filter((row) =>
      Number(row.sort_order || 0) < Number(current.sort_order || 0)
      && (!suiteScoped || (row.suite_id || null) === (suiteId || null))
    )
    .map((row) => row.test_case_id);

  if (!priorIds.length) {
    return true;
  }

  const latestStatuses = new Map();
  toRowArray(await selectLatestResultsForExecution.all(executionId)).forEach((row) => {
    const statuses = latestStatuses.get(row.test_case_id) || [];
    statuses.push(row.status);
    latestStatuses.set(row.test_case_id, statuses);
  });
  const latestJobStatuses = new Map();
  toRowArray(await selectLatestJobStatusesForExecution.all(executionId)).forEach((row) => {
    const statuses = latestJobStatuses.get(row.test_case_id) || [];
    statuses.push(row.status);
    latestJobStatuses.set(row.test_case_id, statuses);
  });

  return priorIds.every((priorId) => {
    const jobStatuses = latestJobStatuses.get(priorId) || [];

    if (jobStatuses.length) {
      return jobStatuses.every((status) => isFinalJobStatus(status));
    }

    const resultStatuses = latestStatuses.get(priorId) || [];

    if (resultStatuses.length) {
      return resultStatuses.every((status) => isFinalResultStatus(status));
    }

    return true;
  });
};

const getActiveJobCountForPolicy = async (candidate) => {
  const policy = candidate.payload?.execution_policy || {};
  const suiteScoped = Boolean(policy.suite_parallel_override && policy.suite_id);
  const params = [candidate.execution_id, candidate.id];
  let query = `
    SELECT payload
    FROM test_engine_jobs
    WHERE execution_id = ?
      AND id <> ?
      AND completed_at IS NULL
      AND status IN ('leased', 'running')
      AND (lease_expires_at IS NULL OR lease_expires_at >= CURRENT_TIMESTAMP)
  `;

  const result = await obsDb.query(query, params);
  return result.rows.filter((row) => {
    if (!suiteScoped) {
      return true;
    }

    const payload = normalizeJsonValue(row.payload, {});
    return payload?.execution_policy?.suite_id === policy.suite_id;
  }).length;
};

const queuedJobParentState = async candidate => {
  const parent = await db.prepare('SELECT status, ended_at FROM executions WHERE id = ?').get(candidate.execution_id);
  if (!parent || parent.ended_at || !['queued','running','retrying'].includes(parent.status)) {
    await obsDb.prepare(`UPDATE test_engine_jobs SET status = 'aborted', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
      lease_expires_at = NULL, leased_by = NULL, updated_at = CURRENT_TIMESTAMP,
      last_error = 'The parent Run is finished or unavailable; queued work was cancelled.' WHERE id = ?`).run(candidate.id);
    await updateQueueTransaction(candidate.transaction_id, {status:'failed',completed_at:nowIso(),
      description:'The parent Run is finished or unavailable; queued work was cancelled.',
      metadata:{current_phase:'cancelled',cancellation_reason:'PARENT_RUN_NOT_RUNNING'}});
    return 'finished';
  }
  return parent.status === 'queued' ? 'waiting' : 'active';
};

const isQueuedJobLeaseEligible = async (candidate) => {
  // Serial/parallel limits span all worker classes. Coordinate on the run as
  // well as locking job rows so two workers cannot both observe a free slot.
  const lock = await obsDb.prepare("SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS acquired")
    .get(`testengine-lease:${candidate.execution_id}`);
  if (!lock?.acquired) return false;
  if (await queuedJobParentState(candidate) !== 'active') return false;
  if (candidate.status === 'running' && candidate.lease_expires_at && Date.parse(candidate.lease_expires_at) <= Date.now()) {
    // A replacement process cannot recover the old browser's memory or know
    // whether its last click/request completed before the report was lost.
    // Preserve the receipt and require an explicit reviewed rerun instead of
    // replaying an unknown purchase, submission, or setup/teardown action.
    const message = 'The previous worker attempt expired with an uncertain outcome. Inspect its completed steps and application effects before explicitly retrying this case; no browser or API action was replayed.';
    await exports.completeQueuedJob({job_id:candidate.id,status:'blocked',error:message,summary:message,
      interrupted_attempt:{code:'TESTENGINE_JOB_ATTEMPT_EXPIRED',action_outcome:'unknown',previous_worker_id:candidate.leased_by || null,recorded_at:nowIso()}});
    return false;
  }
  const payload = normalizeJsonValue(candidate.payload, {});
  const policy = payload?.execution_policy || {};
  const parallelEnabled = normalizeBoolean(policy.parallel_enabled, false);
  const parallelCount = parallelEnabled ? Math.max(1, normalizeInteger(policy.parallel_count, 1) ?? 1) : 1;
  const suiteScoped = Boolean(policy.suite_parallel_override && policy.suite_id);
  const activeCount = await getActiveJobCountForPolicy({
    ...candidate,
    payload
  });

  if (activeCount >= parallelCount) {
    return false;
  }

  if (!parallelEnabled && !(await arePriorCasesComplete(candidate.execution_id, candidate.test_case_id, policy.suite_id || null, suiteScoped))) {
    return false;
  }

  return true;
};

const attachPriorCapturesForLease = async (job) => {
  const priorCaptures = await collectPriorExecutionCaptures(job.execution_id, job.test_case_id,
    { test_data_set_id: job.payload?.data_set?.id, data_set_iteration_index: job.payload?.data_set?.iteration?.index }, job.payload?.parameter_scope_default);

  if (!Object.keys(priorCaptures).length) {
    return job;
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const nextRuntimeState = {
    ...runtimeState,
    captured_values: {
      ...priorCaptures,
      ...runtimeState.captured_values
    }
  };

  await updateJobRuntimeStateForLease.run(nextRuntimeState, job.id);

  return {
    ...job,
    runtime_state: nextRuntimeState
  };
};

// A blocked serial case must not hide runnable jobs in other executions behind
// the first page. Cursor order matches the locked SQL order, including ties.
const scanEligibleJobs = async (readPage, isEligible) => {
  let cursor = null;
  while (true) {
    const rows = await readPage(cursor);
    for (const row of rows) if (await isEligible(row)) return row;
    if (rows.length < 50) return null;
    const last = rows[rows.length - 1];
    cursor = { created_at: last.created_at, id: last.id };
  }
};

const leaseNextQueuedJobTransaction = obsDb.transaction(async ({ worker_id, engine_host, lease_seconds, engine_class } = {}) => {
  const normalizedWorkerId = normalizeText(worker_id) || "testengine-worker";
  const normalizedEngineHost = normalizeEngineHostUrl(engine_host);
  const normalizedEngineClass = normalizeEngineClass(engine_class, null);
  const safeLeaseSeconds = normalizeLeaseSeconds(lease_seconds, DEFAULT_LEASE_SECONDS);
  const findCandidate = async (scopedEngineHost = null) => scanEligibleJobs(async cursor => {
    const params = [];
    let query = `
      SELECT *
      FROM test_engine_jobs
      WHERE (
          status = 'queued'
          OR (
            status IN ('leased', 'running')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < CURRENT_TIMESTAMP
            AND completed_at IS NULL
          )
        )
    `;

    if (normalizedEngineClass) {
      query += ` AND engine_class = ?`;
      params.push(normalizedEngineClass);
    }

    if (scopedEngineHost) {
      query += ` AND (engine_host IS NULL OR engine_host = ?)`;
      params.push(scopedEngineHost);
    }

    if (cursor) {
      query += ` AND (created_at, id) > (?, ?)`;
      params.push(cursor.created_at, cursor.id);
    }
    query += ` ORDER BY created_at ASC, id ASC LIMIT 50 FOR UPDATE SKIP LOCKED`;

    const result = await obsDb.query(query, params);
    return result.rows;
  }, isQueuedJobLeaseEligible);

  let row = await findCandidate(normalizedEngineHost);

  if (!row && normalizedEngineHost) {
    row = await findCandidate(null);
  }

  if (!row) {
    return null;
  }

  const leaseExpiresAt = leaseExpiry(safeLeaseSeconds);

  await obsDb.query(
    `
      UPDATE test_engine_jobs
      SET status = 'leased',
          leased_by = ?,
          lease_expires_at = ?,
          attempts = attempts + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalizedWorkerId, leaseExpiresAt, row.id]
  );

  const leased = await attachPriorCapturesForLease(await getQueuedJob(row.id));

  if (leased.transaction_id) {
    await appendQueueTransactionEvent(leased.transaction_id, {
      level: "info",
      phase: "queue.leased",
      message: `${leased.test_case_title} was leased by the Test Engine worker.`,
      details: {
        job_id: leased.id,
        worker_id: normalizedWorkerId,
        orchestration_class: leased.engine_class,
        lease_expires_at: leaseExpiresAt
      }
    });
  }

  return {
    ...leased,
    lease_expires_at: leaseExpiresAt
  };
});

exports.leaseNextQueuedJob = async (params = {}) => {
  let attempts = 0;
  const maxRetries = Number(process.env.TESTENGINE_POLL_RETRIES) || 3;
  while (attempts < maxRetries) {
    try {
      return await withCommittedQueuedTelemetry(leaseNextQueuedJobTransaction)(params);
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' || err.code === '40001' || (err.message && (err.message.includes('deadlock') || err.message.includes('locked')))) {
        attempts++;
        if (attempts >= maxRetries) throw err;
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempts)));
      } else {
        throw err;
      }
    }
  }
};

exports.getQueueStats = async () => {
  const rows = await selectQueueStats.all();
  const byOrchestrationClass = {};
  const byStepEngineClass = {};
  const byStatus = {};

  for (const row of rows) {
    const status = normalizeText(row.status) || "queued";
    const orchestrationClass = normalizeEngineClass(row.engine_class, "web");
    const maxWorkers = Number(row.engine_max_workers || 0);
    byStatus[status] = (byStatus[status] || 0) + 1;
    byOrchestrationClass[orchestrationClass] = byOrchestrationClass[orchestrationClass] || { queued: 0, leased: 0, running: 0 };
    byOrchestrationClass[orchestrationClass][status] = (byOrchestrationClass[orchestrationClass][status] || 0) + 1;
    byOrchestrationClass[orchestrationClass].max_workers = Math.max(
      Number(byOrchestrationClass[orchestrationClass].max_workers || 0),
      maxWorkers
    );

    const payload = normalizeJsonValue(row.payload, {});
    const workerCaps = payload?.engine_worker_caps && typeof payload.engine_worker_caps === "object" && !Array.isArray(payload.engine_worker_caps)
      ? payload.engine_worker_caps
      : {};
    const stepClasses = resolveStepEngineClasses(Array.isArray(payload?.steps) ? payload.steps : [], row.app_type_kind || orchestrationClass);
    const countedStepClasses = stepClasses.length ? stepClasses : [orchestrationClass];

    countedStepClasses.forEach((stepClass) => {
      byStepEngineClass[stepClass] = byStepEngineClass[stepClass] || { queued: 0, leased: 0, running: 0 };
      byStepEngineClass[stepClass][status] = (byStepEngineClass[stepClass][status] || 0) + 1;
      byStepEngineClass[stepClass].max_workers = Math.max(
        Number(byStepEngineClass[stepClass].max_workers || 0),
        normalizeInteger(workerCaps[stepClass], null) || getQueueMaxWorkers(stepClass)
      );
    });
  }

  for (const engineClass of TESTENGINE_ENGINE_CLASSES) {
    byOrchestrationClass[engineClass] = byOrchestrationClass[engineClass] || { queued: 0, leased: 0, running: 0 };
    const stats = byOrchestrationClass[engineClass];
    stats.pending = stats.queued + stats.leased + stats.running;
    stats.max_workers = Math.max(1, Number(stats.max_workers || 0) || getQueueMaxWorkers(engineClass));
    stats.recommended_workers = Math.max(
      stats.running,
      recommendWorkersForQueue(stats.queued, engineClass, stats.max_workers)
    );

    byStepEngineClass[engineClass] = byStepEngineClass[engineClass] || { queued: 0, leased: 0, running: 0 };
    const stepStats = byStepEngineClass[engineClass];
    stepStats.pending = stepStats.queued + stepStats.leased + stepStats.running;
    stepStats.max_workers = Math.max(1, Number(stepStats.max_workers || 0) || getQueueMaxWorkers(engineClass));
    stepStats.recommended_workers = Math.max(
      stepStats.running,
      recommendWorkersForQueue(stepStats.queued, engineClass, stepStats.max_workers)
    );
  }

  const queued = byStatus.queued || 0;
  const leased = byStatus.leased || 0;
  const running = byStatus.running || 0;
  const pending = queued + leased + running;
  const maxWorkers = Object.values(byOrchestrationClass).reduce((total, stats) => total + stats.max_workers, 0);
  const recommendedWorkers = Object.values(byOrchestrationClass).reduce((total, stats) => total + stats.recommended_workers, 0);

  return {
    queued,
    leased,
    running,
    pending,
    max_workers: maxWorkers,
    recommended_workers: recommendedWorkers,
    by_engine_class: byOrchestrationClass,
    by_orchestration_class: byOrchestrationClass,
    by_step_engine_class: byStepEngineClass
  };
};

// Queue callbacks can be retried or arrive after completion. Serialize all
// mutations on the persisted job row, across API processes and worker leases.
const withQueuedJobLock = (operation) => withCommittedQueuedTelemetry(obsDb.transaction(async (params = {}) => {
  const jobId = normalizeText(params.job_id);
  if (!jobId) throw new Error("Queued job ID is required");
  const locked = await obsDb.prepare("SELECT id FROM test_engine_jobs WHERE id = ? FOR UPDATE").get(jobId);
  if (!locked) throw new Error("Queued job not found");
  return operation(params);
}));

const terminalJobReceipt = async (job) => {
  if (!job.completed_at && !isFinalJobStatus(job.status)) return null;
  const result = await executionResultService.findLatestExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    data_set_iteration_index: resultIterationFromJob(job).data_set_iteration_index
  });
  return {
    job_id: job.id,
    execution_result_id: result?.id || null,
    status: result?.status || (job.status === "completed" ? "passed" : job.status === "aborted" ? "aborted" : "failed")
  };
};

exports.startQueuedJob = withQueuedJobLock(async ({ job_id, worker_id } = {}) => {
  const job = await getQueuedJob(job_id);
  const receipt = await terminalJobReceipt(job);
  if (receipt) throw Object.assign(new Error("Finished jobs cannot start another execution."), {
    code: "TESTENGINE_JOB_FINISHED", statusCode: 409, receipt
  });
  const parentState = await queuedJobParentState(job);
  // Commit the cancellation receipt. Throwing here would roll it back, leaving
  // the same stale job to be leased and rejected on every poll indefinitely.
  if (parentState !== 'active') return {job_id:job.id,status:parentState === 'finished'?'aborted':'queued',reason:'PARENT_RUN_NOT_RUNNING'};
  const normalizedWorkerId = normalizeText(worker_id);
  const leaseIssue = queuedJobLeaseIssue(job, normalizedWorkerId);
  if (leaseIssue) throw Object.assign(new Error("This worker no longer owns an active lease for this job."), {
    code: leaseIssue, statusCode: 409
  });
  const leaseExpiresAt = leaseExpiry(DEFAULT_LEASE_SECONDS);
  const runtimeState = parseRuntimeState(job.runtime_state);
  const logs = parseStructuredLogs(runtimeState.logs);
  const startedAt = job.started_at || nowIso();

  await updateJobLeaseState.run("running", normalizedWorkerId, leaseExpiresAt, startedAt, job.id);

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: "running",
    duration_ms: null,
    error: null,
    logs: JSON.stringify(logs),
    executed_by: job.created_by || null,
    ...resultIterationFromJob(job)
  });
  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: "info",
      phase: "run.started",
      message: `${job.test_case_title} started in the Test Engine.`,
      details: {
        job_id: job.id,
        execution_result_id: result.id,
        worker_id: normalizedWorkerId
      },
      status: "running",
      description: "Engine execution running.",
      metadata: {
        execution_result_id: result.id,
        current_phase: "running"
      }
    });
  }

  queueCommittedTelemetry({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      source: "testengine.queue.start",
      summary: `${job.test_case_title} started in the Test Engine.`,
      execution_result_id: result.id
  });

  return {
    job_id: job.id,
    execution_result_id: result.id,
    status: "running"
  };
});

// A control receipt is deliberately smaller than a job or execution result.
// Workers poll it while browser actions are in flight and before the next
// action; a stale worker must never revive its own expired or reassigned lease.
const queuedJobLeaseIssue = (job, workerId) => {
  if (!['leased', 'running'].includes(job.status) || !workerId || job.leased_by !== workerId) return 'TESTENGINE_JOB_LEASE_LOST';
  const leaseEnd = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(leaseEnd) || leaseEnd <= Date.now()) return 'TESTENGINE_JOB_LEASE_EXPIRED';
  return null;
};

exports.heartbeatQueuedJob = withQueuedJobLock(async ({ job_id, worker_id } = {}) => {
  const job = await getQueuedJob(job_id);
  if (job.completed_at || isFinalJobStatus(job.status)) return {job_id:job.id,status:job.status,authorized:false,code:'TESTENGINE_JOB_FINISHED'};
  const leaseIssue = queuedJobLeaseIssue(job, normalizeText(worker_id));
  if (leaseIssue) return {job_id:job.id,status:job.status,authorized:false,code:leaseIssue};
  const parentState = await queuedJobParentState(job);
  if (parentState !== 'active') return {job_id:job.id,status:parentState === 'finished'?'aborted':'queued',authorized:false,code:'PARENT_RUN_NOT_RUNNING'};
  if (job.status !== 'running') return {job_id:job.id,status:job.status,authorized:false,code:'TESTENGINE_JOB_NOT_STARTED'};
  const leaseExpiresAt = leaseExpiry(DEFAULT_LEASE_SECONDS);
  await obsDb.prepare('UPDATE test_engine_jobs SET lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(leaseExpiresAt, job.id);
  return {job_id:job.id,status:'running',authorized:true,lease_expires_at:leaseExpiresAt};
});

exports.executeQueuedApiStep = withQueuedJobLock(async ({ job_id, step_id, worker_id } = {}) => {
  const job = await getQueuedJob(job_id);
  if (job.completed_at || isFinalJobStatus(job.status)) {
    throw Object.assign(new Error("Finished jobs cannot execute additional API requests."), {
      code: "TESTENGINE_JOB_FINISHED", statusCode: 409
    });
  }
  if (job.status !== 'running') throw Object.assign(new Error('The queued API job must be started before dispatching a request.'), {code:'TESTENGINE_JOB_NOT_STARTED',statusCode:409});
  const leaseIssue = queuedJobLeaseIssue(job, worker_id === undefined ? job.leased_by : normalizeText(worker_id));
  if (leaseIssue) throw Object.assign(new Error('This worker no longer owns an active lease for this API request.'), {code:leaseIssue,statusCode:409});
  const parentState = await queuedJobParentState(job);
  if (parentState !== 'active') return {job_id:job.id,step_id,status:'blocked',case_status:parentState === 'finished'?'aborted':'queued',captures:{},code:'PARENT_RUN_NOT_RUNNING'};

  if (!job.payload?.steps?.length) {
    throw new Error("Queued job payload is missing step data");
  }

  const hookSteps = (job.payload.hooks || []).flatMap((hook) => (hook.steps || []).map((entry) => ({
    ...entry, id: `${hook.scope}:${hook.phase}:${hook.id}:${entry.id}`
  })));
  const step = [...job.payload.steps, ...hookSteps].find((entry) => entry.id === step_id);

  if (!step) {
    throw new Error("Queued job step not found");
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const existingLogs = parseStructuredLogs(runtimeState.logs);
  if (['passed','failed','blocked','skipped'].includes(existingLogs.stepStatuses[step.id])) {
    throw Object.assign(new Error('This API step already has a saved result. Review the original receipt before explicitly retrying the case.'), {code:'TESTENGINE_STEP_ALREADY_REPORTED',statusCode:409});
  }
  const parameterValues = buildRuntimeParameterValues(job.payload, runtimeState.captured_values, step);
  const stepResult = await apiRequestExecutionService.executeApiRequestStep({
    api_request: step.api_request,
    parameter_values: parameterValues
  });
  const normalizedStepCaptures = normalizeFrozenCapturedValues(stepResult.captures, job.payload?.parameter_scope_default);
  const redactDiagnostic = createExecutionDiagnosticRedactor(job.payload, parameterValues, normalizedStepCaptures, runtimeState.captured_values);
  const publicCaptures = redactDiagnostic({captures: normalizedStepCaptures}).captures;
  const formattedStepNote = redactDiagnostic(executionStepRuntimeService.formatApiStepEvidenceNote(stepResult));
  const mergedLogs = redactDiagnostic({
    ...existingLogs,
    stepStatuses: {
      ...existingLogs.stepStatuses,
      [step.id]: stepResult.status
    },
    stepNotes: {
      ...existingLogs.stepNotes,
      [step.id]: formattedStepNote
    },
    stepEvidence: {
      ...existingLogs.stepEvidence,
      ...(stepResult.evidence ? { [step.id]: stepResult.evidence } : {})
    },
    stepApiDetails: {
      ...existingLogs.stepApiDetails,
      [step.id]: stepResult.detail
    },
    stepAutomationDetails: {
      ...existingLogs.stepAutomationDetails,
      [step.id]: buildStepAutomationDetail(step, stepResult.status, stepResult.note, "api")
    },
    stepCaptures: Object.keys(normalizedStepCaptures).length
      ? {
          ...existingLogs.stepCaptures,
          [step.id]: {
            ...(existingLogs.stepCaptures?.[step.id] || {}),
            ...normalizedStepCaptures
          }
        }
      : {
          ...existingLogs.stepCaptures
        }
  });
  const nextRuntimeState = {
    ...runtimeState,
    captured_values: {
      ...runtimeState.captured_values,
      ...normalizedStepCaptures
    },
    logs: mergedLogs,
    deterministic_attempted: true
  };
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, stepResult.duration_ms || 0);
  const stepIds = Array.isArray(job.payload?.steps) ? job.payload.steps.map((entry) => entry.id) : [];
  const caseStatus = executionStepRuntimeService.deriveCaseStatusFromStepStatuses(stepIds, mergedLogs.stepStatuses);

  await updateJobRuntimeState.run(
    "running",
    nextRuntimeState,
    leaseExpiry(DEFAULT_LEASE_SECONDS),
    stepResult.status === "failed" ? redactDiagnostic(stepResult.note) : null,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: caseStatus,
    duration_ms: durationMs,
    error: stepResult.status === "failed" ? redactDiagnostic(stepResult.note) : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: job.created_by || null,
    ...resultIterationFromJob(job)
  });

  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: stepResult.status === "failed" ? "error" : "info",
      phase: stepResult.status === "failed" ? "step.failed" : "step.completed",
      message: redactDiagnostic(stepResult.note),
      details: {
        job_id: job.id,
        step_id: step.id,
        step_order: step.order,
        execution_result_id: result.id,
        captures: publicCaptures
      },
      status: "running",
      metadata: {
        execution_result_id: result.id,
        current_phase: stepResult.status === "failed" ? "step-failed" : "step-completed",
        last_step_id: step.id
      }
    });
  }

  queueCommittedTelemetry({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      step_id: step.id,
      source: "testengine.queue.api-step",
      summary: formattedStepNote,
      execution_result_id: result.id,
      step_status: stepResult.status,
      step_note: formattedStepNote,
      step_detail: redactDiagnostic(stepResult.detail),
      step_evidence: stepResult.evidence,
      captures: publicCaptures
  });

  return {
    job_id: job.id,
    step_id: step.id,
    status: stepResult.status,
    note: stepResult.note,
    detail: stepResult.detail,
    captures: stepResult.captures,
    case_status: caseStatus,
    execution_result_id: result.id
  };
});

exports.reportQueuedStep = withQueuedJobLock(async ({
  job_id,
  worker_id,
  step_id,
  status,
  note,
  evidence,
  api_detail,
  web_detail,
  automation_detail,
  captures,
  recovery_attempted,
  recovery_succeeded
} = {}) => {
  const job = await getQueuedJob(job_id);

  if (!job.payload?.steps?.length) {
    throw new Error("Queued job payload is missing step data");
  }

  const hookSteps = (job.payload.hooks || []).flatMap((hook) => (hook.steps || []).map((entry) => ({
    ...entry, id: `${hook.scope}:${hook.phase}:${hook.id}:${entry.id}`
  })));
  const step = [...job.payload.steps, ...hookSteps].find((entry) => entry.id === step_id);

  if (!step) {
    throw new Error("Queued job step not found");
  }

  const normalizedStatus = normalizeText(status);

  if (!["passed", "failed", "blocked", "skipped"].includes(normalizedStatus)) {
    throw new Error("Queued step status must be passed, failed, blocked, or skipped");
  }

  const receipt = await terminalJobReceipt(job);
  if (receipt) {
    const savedLogs = parseStructuredLogs(job.runtime_state?.logs);
    return {
      ...receipt,
      step_id: step.id,
      status: savedLogs.stepStatuses[step.id] || "blocked",
      case_status: receipt.status,
      captures: savedLogs.stepCaptures[step.id] || {}
    };
  }
  if (worker_id !== undefined) {
    const leaseIssue = queuedJobLeaseIssue(job, normalizeText(worker_id));
    if (leaseIssue) throw Object.assign(new Error("This worker no longer owns the job result stream."), {code:leaseIssue,statusCode:409});
    const parentState = await queuedJobParentState(job);
    if (parentState !== 'active') return {job_id:job.id,step_id:step.id,status:'blocked',case_status:parentState === 'finished'?'aborted':'queued',captures:{},code:'PARENT_RUN_NOT_RUNNING'};
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const existingLogs = parseStructuredLogs(runtimeState.logs);
  const normalizedEvidence = normalizeInlineEvidence(evidence);
  const normalizedApiDetail = normalizeApiDetail(api_detail);
  const normalizedWebDetail = normalizeWebDetail(web_detail);
  const normalizedAutomationDetail = normalizeAutomationDetail(automation_detail);
  const normalizedCaptures = normalizeFrozenCapturedValues(captures, job.payload?.parameter_scope_default);
  const redactDiagnostic = createExecutionDiagnosticRedactor(job.payload, runtimeState.captured_values, normalizedCaptures,
    buildRuntimeParameterValues(job.payload, {...runtimeState.captured_values, ...normalizedCaptures}, step));
  const publicNote = note === undefined ? undefined : redactDiagnostic(String(note || ''));
  const publicCaptures = redactDiagnostic({captures: normalizedCaptures}).captures;
  const recoveryAttempted = Boolean(recovery_attempted);
  const recoverySucceeded = Boolean(recovery_succeeded);
  const mergedLogs = redactDiagnostic({
    ...existingLogs,
    stepStatuses: {
      ...existingLogs.stepStatuses,
      [step.id]: normalizedStatus
    },
    stepNotes: note === undefined
      ? { ...existingLogs.stepNotes }
      : {
          ...existingLogs.stepNotes,
          [step.id]: String(note || "")
        },
    stepEvidence: normalizedEvidence
      ? {
          ...existingLogs.stepEvidence,
          [step.id]: normalizedEvidence
        }
      : {
          ...existingLogs.stepEvidence
        },
    stepApiDetails: normalizedApiDetail
      ? {
          ...existingLogs.stepApiDetails,
          [step.id]: normalizedApiDetail
        }
      : {
          ...existingLogs.stepApiDetails
        },
    stepWebDetails: normalizedWebDetail
      ? {
          ...existingLogs.stepWebDetails,
          [step.id]: normalizedWebDetail
        }
      : {
          ...existingLogs.stepWebDetails
        },
    stepAutomationDetails: normalizedAutomationDetail
      ? {
          ...existingLogs.stepAutomationDetails,
          [step.id]: normalizedAutomationDetail
        }
      : {
          ...existingLogs.stepAutomationDetails
        },
    stepCaptures: Object.keys(normalizedCaptures).length
      ? {
          ...existingLogs.stepCaptures,
          [step.id]: {
            ...(existingLogs.stepCaptures?.[step.id] || {}),
            ...normalizedCaptures
          }
        }
      : {
          ...existingLogs.stepCaptures
        }
  });
  const nextRuntimeState = {
    ...runtimeState,
    captured_values: {
      ...runtimeState.captured_values,
      ...normalizedCaptures
    },
    logs: mergedLogs,
    deterministic_attempted: true,
    healing_attempted: runtimeState.healing_attempted || recoveryAttempted,
    healing_succeeded: runtimeState.healing_succeeded || recoverySucceeded
  };
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 0);
  const stepIds = Array.isArray(job.payload?.steps) ? job.payload.steps.map((entry) => entry.id) : [];
  const caseStatus = executionStepRuntimeService.deriveCaseStatusFromStepStatuses(stepIds, mergedLogs.stepStatuses);
  const persistedCaseStatus = caseStatus === "running" || caseStatus === "blocked" ? caseStatus : caseStatus;
  const errorMessage = normalizedStatus === "failed" ? normalizeText(publicNote) || `${job.test_case_title} failed on step ${step.order}.` : null;

  await updateJobRuntimeState.run(
    "running",
    nextRuntimeState,
    leaseExpiry(DEFAULT_LEASE_SECONDS),
    errorMessage,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: persistedCaseStatus,
    duration_ms: durationMs,
    error: caseStatus === "failed" ? errorMessage : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: job.created_by || null,
    ...resultIterationFromJob(job)
  });

  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: normalizedStatus === "failed" ? "error" : normalizedStatus === "blocked" ? "warning" : "info",
      phase: normalizedStatus === "failed" ? "step.failed" : normalizedStatus === "blocked" ? "step.blocked" : "step.completed",
      message: normalizeText(publicNote) || `${job.test_case_title}: step ${step.order} ${normalizedStatus}.`,
      details: {
        job_id: job.id,
        step_id: step.id,
        step_order: step.order,
        execution_result_id: result.id,
        captures: publicCaptures,
        recovery_attempted: recoveryAttempted,
        recovery_succeeded: recoverySucceeded
      },
      status: caseStatus === "failed" ? "failed" : "running",
      metadata: {
        execution_result_id: result.id,
        current_phase: normalizedStatus === "failed" ? "step-failed" : normalizedStatus === "blocked" ? "step-blocked" : "step-completed",
        last_step_id: step.id,
        healing_attempted: runtimeState.healing_attempted || recoveryAttempted,
        healing_succeeded: runtimeState.healing_succeeded || recoverySucceeded
      }
    });
  }

  queueCommittedTelemetry({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      step_id: step.id,
      source: "testengine.queue.web-step",
      summary: normalizeText(publicNote) || `${job.test_case_title}: step ${step.order} ${normalizedStatus}.`,
      execution_result_id: result.id,
      step_status: normalizedStatus,
      step_note: normalizeText(publicNote) || "",
      step_detail: redactDiagnostic(normalizedApiDetail),
      web_detail: redactDiagnostic(normalizedWebDetail),
      step_evidence: normalizedEvidence,
      captures: publicCaptures
  });

  return {
    job_id: job.id,
    step_id: step.id,
    status: normalizedStatus,
    case_status: caseStatus,
    execution_result_id: result.id,
    captures: normalizedCaptures
  };
});

exports.completeQueuedJob = withQueuedJobLock(async ({
  job_id,
  worker_id,
  status,
  error,
  summary,
  deterministic_attempted,
  healing_attempted,
  healing_succeeded,
  artifact_bundle,
  patch_proposals,
  interrupted_attempt
} = {}) => {
  const job = await getQueuedJob(job_id);
  const receipt = await terminalJobReceipt(job);
  if (receipt) return receipt;
  if (worker_id !== undefined) {
    const leaseIssue = queuedJobLeaseIssue(job, normalizeText(worker_id));
    if (leaseIssue) throw Object.assign(new Error("This worker no longer owns the job result stream."), {code:leaseIssue,statusCode:409});
    const parentState = await queuedJobParentState(job);
    if (parentState !== 'active') return {job_id:job.id,status:parentState === 'finished'?'aborted':'queued',code:'PARENT_RUN_NOT_RUNNING'};
  }
  const runtimeState = parseRuntimeState(job.runtime_state);
  const redactDiagnostic = createExecutionDiagnosticRedactor(job.payload, runtimeState.captured_values);
  const logs = redactDiagnostic(parseStructuredLogs(runtimeState.logs));
  const stepIds = Array.isArray(job.payload?.steps) ? job.payload.steps.map((step) => step.id) : [];
  const resolvedStatuses = stepIds.map((stepId) => logs.stepStatuses[stepId]).filter(Boolean);
  const derivedStatus = resolvedStatuses.includes("failed")
    ? "failed"
    : stepIds.length && resolvedStatuses.length === stepIds.length && resolvedStatuses.some((value) => value === "passed") && resolvedStatuses.every((value) => value === "passed" || value === "skipped")
      ? "passed"
      : resolvedStatuses.includes("blocked")
        ? "blocked"
        : "blocked";
  let finalStatus = normalizeText(status);

  if (finalStatus !== "passed" && finalStatus !== "failed" && finalStatus !== "blocked") {
    finalStatus = derivedStatus;
  } else if (finalStatus === "passed" && derivedStatus !== "passed") {
    finalStatus = derivedStatus;
  } else if (derivedStatus === "failed") {
    finalStatus = "failed";
  }

  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 0);
  const failedStepId = stepIds.find((id) => logs.stepStatuses[id] === "failed");
  const errorMessage = redactDiagnostic(finalStatus === "failed"
    ? normalizeText(error) || normalizeText(failedStepId && logs.stepNotes[failedStepId]) || normalizeText(job.last_error) || "Automation execution failed."
    : normalizeText(error));
  const normalizedSummary = redactDiagnostic(
    normalizeText(summary)
    || runtimeState.final_summary
    || (finalStatus === "passed"
      ? `${job.test_case_title} completed successfully.`
      : errorMessage || `${job.test_case_title} finished with ${finalStatus}.`));
  const normalizedArtifactBundle = normalizeArtifactBundle(artifact_bundle);
  const normalizedPatchProposals = redactDiagnostic(normalizePatchProposals(patch_proposals));
  const nextRuntimeState = {
    ...runtimeState,
    logs,
    ...(interrupted_attempt ? {interrupted_attempt} : {}),
    deterministic_attempted:
      deterministic_attempted === undefined
        ? runtimeState.deterministic_attempted || resolvedStatuses.length > 0
        : Boolean(deterministic_attempted),
    healing_attempted: runtimeState.healing_attempted || Boolean(healing_attempted),
    healing_succeeded: runtimeState.healing_succeeded || Boolean(healing_succeeded),
    final_summary: normalizedSummary,
    artifact_bundle:
      Object.keys(normalizedArtifactBundle).length
        ? normalizedArtifactBundle
        : runtimeState.artifact_bundle || {},
    patch_proposals: normalizedPatchProposals.length ? normalizedPatchProposals : runtimeState.patch_proposals || []
  };
  const completedAt = nowIso();
  const attachedArtifacts = await attachInlineArtifacts(job.transaction_id, nextRuntimeState.artifact_bundle);

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: finalStatus,
    duration_ms: durationMs,
    error: errorMessage,
    logs: JSON.stringify(logs),
    executed_by: job.created_by || null,
    ...resultIterationFromJob(job)
  });

  nextRuntimeState.artifact_bundle = await require("./engineArtifact.service").validateBundle(nextRuntimeState.artifact_bundle, result.id);

  await finalizeJobState.run(
    resultStatusToJobStatus(finalStatus),
    nextRuntimeState,
    completedAt,
    errorMessage,
    job.id
  );

  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: finalStatus === "passed" ? "success" : finalStatus === "failed" ? "error" : "warning",
      phase: finalStatus === "passed" ? "run.completed" : finalStatus === "failed" ? "run.failed" : "run.blocked",
      message: normalizedSummary,
      details: {
        job_id: job.id,
        execution_result_id: result.id,
        status: finalStatus,
        deterministic_attempted: nextRuntimeState.deterministic_attempted,
        healing_attempted: nextRuntimeState.healing_attempted,
        healing_succeeded: nextRuntimeState.healing_succeeded,
        artifact_bundle: nextRuntimeState.artifact_bundle,
        patch_proposals: nextRuntimeState.patch_proposals,
        attached_artifacts: attachedArtifacts
      },
      status: finalStatus === "passed" ? "completed" : "failed",
      description: normalizedSummary,
      metadata: {
        execution_result_id: result.id,
        current_phase: finalStatus === "passed" ? "completed" : "failed",
        deterministic_attempted: nextRuntimeState.deterministic_attempted,
        healing_attempted: nextRuntimeState.healing_attempted,
        healing_succeeded: nextRuntimeState.healing_succeeded,
        artifact_bundle: nextRuntimeState.artifact_bundle,
        patch_proposals: nextRuntimeState.patch_proposals,
        final_summary: normalizedSummary
      }
    });

    await updateQueueTransaction(job.transaction_id, {
      status: finalStatus === "passed" ? "completed" : "failed",
      completed_at: completedAt,
      description: normalizedSummary,
      metadata: {
        execution_result_id: result.id,
        deterministic_attempted: nextRuntimeState.deterministic_attempted,
        healing_attempted: nextRuntimeState.healing_attempted,
        healing_succeeded: nextRuntimeState.healing_succeeded,
        artifact_bundle: nextRuntimeState.artifact_bundle,
        patch_proposals: nextRuntimeState.patch_proposals,
        final_summary: normalizedSummary
      }
    });
  }

  await settleExecutionIfComplete(job.execution_id);

  queueCommittedTelemetry({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      source: "testengine.queue.complete",
      summary: normalizedSummary,
      execution_result_id: result.id
  });

  return {
    job_id: job.id,
    execution_result_id: result.id,
    status: finalStatus
  };
});

exports.failQueuedJob = async ({ job_id, message } = {}) => {
  return exports.completeQueuedJob({
    job_id,
    status: "failed",
    error: normalizeText(message) || "Test Engine execution failed."
  });
};

exports.getQueuedJob = getQueuedJob;
exports._internals = { scanEligibleJobs, buildProviderLiveViewUrl, buildEngineEnvelope };
exports.planExecutionDispatch = planExecutionDispatch;
exports.queueExecutionDispatch = queueExecutionDispatch;
exports.runExecutionDirectLocal = runExecutionDirectLocal;
exports.preparePairedLocalDispatch = preparePairedLocalDispatch;
exports.queueSingleStepDispatch = queueSingleStepDispatch;
exports.settleExecutionIfComplete = settleExecutionIfComplete;

// Read only public connection metadata from the dispatched, project-bound run.
exports.getExecutionLiveSessions = async (execution) => {
  if (execution?.status !== "running") return [];
  const rows = await obsDb.prepare(`SELECT related_id AS engine_run_id, metadata->>'live_view_url' AS url, metadata->>'active_web_engine' AS provider,
      metadata->>'test_case_id' AS test_case_id, metadata->>'data_set_iteration_index' AS data_set_iteration_index,
      metadata->>'data_set_iteration_key' AS data_set_iteration_key, created_by,
      metadata->>'source' AS source, metadata->>'queue_mode' AS queue_mode,
      metadata->>'paired_dispatch_id' AS paired_dispatch_id
    FROM workspace_transactions WHERE project_id = ? AND action = 'testengine_run'
      AND metadata->>'execution_id' = ? AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 5000`).all(execution.project_id, execution.id);
  const integration = rows.some(row => row.source !== 'hellotest.local-run')
    ? await require('@hellotest/integration/backend/services/integration.service').getActiveIntegrationByTypeForProject('testengine', execution.project_id).catch(() => null) : null;
  return (await Promise.all(rows.map(async row => {
    try {
      if (!row.test_case_id || !row.engine_run_id) return [];
      const url = new URL(row.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
      if (["host.docker.internal", "testengine", "testengine-gateway"].includes(url.hostname)) url.hostname = "localhost";
      // A shared VNC desktop cannot identify an individual test case. Publish
      // only the engine's run-scoped viewer for case execution.
      if (!url.pathname.endsWith("/api/v1/live-session")) return [];
      url.searchParams.set("provider", row.provider === "selenium" ? "selenium" : "playwright");
      url.searchParams.set("run_id", row.engine_run_id);
      const iterationIndex = row.data_set_iteration_index == null ? null : Number(row.data_set_iteration_index);
      const provider = row.provider === 'selenium' ? 'selenium' : 'playwright';
      const secret = row.queue_mode === 'paired-local'
        ? await require('./pairedLocalExecution.service').callbackSecretFor({ execution,
          payload: { engine_run_id: row.engine_run_id, hellotest_test_case_id: row.test_case_id, data_set_iteration: Number.isInteger(iterationIndex) ? { index: iterationIndex } : null },
          transaction: { project_id: execution.project_id, created_by: row.created_by, metadata: { paired_dispatch_id: row.paired_dispatch_id, data_set_iteration_index: Number.isInteger(iterationIndex) ? iterationIndex : null } } })
        : resolveTestEngineSecret(row.source === 'hellotest.local-run' ? undefined : integration?.config?.shared_secret);
      url.searchParams.set('view_token', require("../lib/build/automationLiveViewGrant").createLiveViewGrant({ engineRunId: row.engine_run_id, provider, secret }));
      return [{ engine_run_id: row.engine_run_id, test_case_id: row.test_case_id,
        data_set_iteration_index: Number.isInteger(iterationIndex) && iterationIndex >= 0 ? iterationIndex : null,
        data_set_iteration_key: row.data_set_iteration_key || null,
        provider, url: url.toString() }];
    } catch { return []; }
  }))).flat();
};
