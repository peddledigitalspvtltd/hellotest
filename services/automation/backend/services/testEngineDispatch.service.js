async function configuredRepairBrief() {
  const {config}=await require('@hellotest/platform/backend/services/aiConfiguration.service').resolve('ai.automation.locator_repair');
  const blocks=config.instruction_blocks;
  return {goal:blocks['engineRepair.goal'],screen_selection:blocks['engineRepair.screen_selection'],correction_policy:blocks['engineRepair.correction_policy'].split('\n').filter(Boolean)};
}
const { createInlineArtifactAttacher } = require("../domain/executionArtifacts");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid } = require("crypto");
const executionResultService = require("@hellotest/testing/backend/services/executionResult.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const attachInlineArtifacts = createInlineArtifactAttacher((id, ref) => workspaceTransactionService.createTransactionArtifact(id, ref));
const apiRequestExecutionService = require("./apiRequestExecution.service");
const executionStepRuntimeService = require("@hellotest/platform/backend/src/domain/executionStepEvidence");
const opsTelemetryService = require("@hellotest/trace/backend/services/opsTelemetry.service");
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
const { createExecutionDiagnosticRedactor } = require('../lib/automationExecutionDiagnostics');
const { resolveAutomationCaseSteps, resolveAutomationCaseType } = require('@hellotest/platform/backend/src/utils/automationCaseType');

const SUPPORTED_ENGINE_STEP_TYPES = new Set(["api", "web", "android", "ios"]);
const TESTENGINE_ENGINE_CLASSES = new Set(["api", "web", "android"]);
const DEFAULT_LEASE_SECONDS = Math.max(30, Number(process.env.TESTENGINE_JOB_LEASE_SECONDS || 90));
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

const normalizeEngineHostUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return normalized.replace(/\/+$/, "");
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
};

const normalizeFallbackLocator = (value) => {
  if (typeof value === "string") {
    const locator = normalizeText(value);
    return locator ? { locator, strategy: null, confidenceScore: null } : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const locator = normalizeText(value.locator || value.selector || value.value);
  if (!locator) {
    return null;
  }

  const score = Number(value.confidenceScore ?? value.confidence_score ?? value.confidence);
  return {
    locator,
    strategy: normalizeText(value.strategy || value.locator_kind || value.kind),
    confidenceScore: Number.isFinite(score) ? score : null
  };
};

const normalizeFallbackLocators = (...sources) => {
  const seen = new Set();
  const result = [];

  sources.flatMap((source) => Array.isArray(source) ? source : [source]).forEach((item) => {
    const locator = normalizeFallbackLocator(item);
    if (locator && !seen.has(locator.locator)) {
      seen.add(locator.locator);
      result.push(locator);
    }
  });

  return result;
};

const normalizeObjectRepositoryEntry = (row) => {
  const metadata = normalizeJsonValue(row.metadata, {});
  const fallbackLocators = normalizeFallbackLocators(
    metadata.fallback_locators,
    metadata.locator_candidates
  );
  const previousLocators = [
    ...(Array.isArray(metadata.previous_locators) ? metadata.previous_locators.map(String) : []),
    normalizeText(metadata.playwright_locator),
    normalizeText(metadata.primary_playwright_locator),
    ...fallbackLocators.map((item) => item.locator)
  ].filter(Boolean);
  // Execution needs locator bindings, not every field's captured DOM/images.
  // Keeping captures in the repository avoids multiplying them across runs
  // while allowing the complete scoped binding set to reach the engine.
  const executionMetadata = Object.fromEntries(['object_label', 'object_name', 'playwright_locator', 'primary_playwright_locator', 'locator']
    .filter(key => typeof metadata[key] === 'string').map(key => [key, metadata[key]]));

  return {
    id: row.id,
    test_case_id: normalizeText(row.test_case_id),
    page_url: normalizeText(row.page_url),
    page_key: normalizeText(row.page_key) || "screen",
    locator_intent: normalizeText(row.locator_intent) || "object",
    locator: normalizeText(row.locator),
    locator_kind: normalizeText(row.locator_kind),
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
    source: normalizeText(row.source) || "repository",
    screen_name: normalizeText(metadata.screen_name) || normalizeText(row.page_key) || "Screen",
    object_name: normalizeText(metadata.object_name) || normalizeText(row.locator_intent) || "Object",
    object_role: normalizeText(metadata.object_role) || normalizeText(row.locator_kind) || null,
    target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.map(String) : [],
    fallback_strategy: normalizeText(metadata.fallback_strategy),
    previous_locators: [...new Set(previousLocators)],
    reference_aliases: [...new Set((Array.isArray(metadata.reference_aliases) ? metadata.reference_aliases : []).filter(alias => typeof alias === "string").map(alias => alias.trim()).filter(Boolean))],
    fallback_locators: fallbackLocators,
    metadata: executionMetadata,
    updated_at: row.updated_at || null
  };
};

const listObjectRepositoryForEnvelope = async ({ projectId, appTypeId, testCaseId }) => {
  const scopedProjectId = projectId || null;
  const scopedAppTypeId = appTypeId || null;
  const rows = await selectObjectRepositoryEntries.all(scopedProjectId, scopedProjectId, scopedAppTypeId, scopedProjectId, scopedAppTypeId, scopedAppTypeId);
  const identity = require('../lib/repositoryScreenIdentity');
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

const normalizeInteger = (value, fallback = null) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const toRowArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.rows)) {
    return value.rows;
  }

  return [];
};

const resolveExecutionPolicy = async (execution, caseSnapshot) => {
  const runParallelEnabled = normalizeBoolean(execution?.parallel_enabled, false);
  const runParallelCount = Math.max(1, normalizeInteger(execution?.parallel_count, 1) ?? 1);
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

const normalizeTestEngineWebEngine = (value, fallback = "playwright") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized && TESTENGINE_WEB_ENGINE_VALUES.has(normalized) ? normalized : fallback;
};

const normalizeEngineClass = (value, fallback = null) => {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized && TESTENGINE_ENGINE_CLASSES.has(normalized) ? normalized : fallback;
};

const resolveStepEngineClass = (step = {}, appTypeKind = null) => {
  const stepType = normalizeTestStepType(step?.step_type || step?.type, null);

  if (stepType === "api" || stepType === "web" || stepType === "android") {
    return stepType;
  }

  if (stepType === "ios") {
    return "android";
  }

  const normalizedAppType = normalizeText(appTypeKind)?.toLowerCase();
  return normalizedAppType === "api" ? "api" : ["android", "ios"].includes(normalizedAppType) ? "android" : "web";
};

const resolveStepEngineClasses = (steps = [], appTypeKind = null) =>
  Array.from(new Set((steps || []).map((step) => resolveStepEngineClass(step, appTypeKind))));

const resolveOrchestrationClass = (steps = [], appTypeKind = null) => {
  const stepTypes = new Set((steps || []).map((step) => normalizeTestStepType(step?.step_type || step?.type)).filter(Boolean));

  if (stepTypes.has("android") || stepTypes.has("ios")) {
    return "android";
  }

  if (stepTypes.has("web")) {
    return "web";
  }

  if (stepTypes.has("api")) {
    return "api";
  }

  const normalizedAppType = normalizeText(appTypeKind)?.toLowerCase();
  return normalizedAppType === "api" ? "api" : ["android", "ios"].includes(normalizedAppType) ? "android" : "web";
};

const getQueueMaxWorkers = (engineClass) => {
  const normalized = normalizeEngineClass(engineClass, "web");
  const specificKey = `TESTENGINE_${normalized.toUpperCase()}_MAX_WORKERS`;
  const configured = normalizeInteger(process.env[specificKey], null)
    ?? normalizeInteger(process.env.TESTENGINE_MAX_WORKERS, null)
    ?? 3;

  return Math.max(1, configured);
};

const resolveIntegrationEngineMaxWorkers = (engineClass, integrationConfig = {}) => {
  const normalized = normalizeEngineClass(engineClass, "web");
  const specificKey = `max_${normalized}_workers`;
  const legacySpecificKey = `${normalized}_max_workers`;
  const configured = normalizeInteger(integrationConfig[specificKey], null)
    ?? normalizeInteger(integrationConfig[legacySpecificKey], null)
    ?? normalizeInteger(integrationConfig.max_worker_replicas, null)
    ?? normalizeInteger(integrationConfig.max_workers, null)
    ?? getQueueMaxWorkers(normalized);

  return Math.max(1, configured);
};

const resolveIntegrationEngineWorkerCaps = (integrationConfig = {}) => ({
  api: resolveIntegrationEngineMaxWorkers("api", integrationConfig),
  web: resolveIntegrationEngineMaxWorkers("web", integrationConfig),
  android: resolveIntegrationEngineMaxWorkers("android", integrationConfig)
});

const recommendWorkersForQueue = (queued, engineClass, maxWorkerOverride = null) => {
  const maxWorkers = Math.max(1, normalizeInteger(maxWorkerOverride, null) ?? getQueueMaxWorkers(engineClass));
  const queuedCount = Number(queued || 0);

  if (queuedCount <= 0) {
    return 0;
  }

  const targetBacklogPerWorker = Math.max(
    1,
    normalizeInteger(process.env.TESTENGINE_TARGET_QUEUED_PER_WORKER, engineClass === "api" ? 4 : 1) ?? 1
  );

  return Math.max(0, Math.min(maxWorkers, Math.ceil(queuedCount / targetBacklogPerWorker) || 0));
};

const normalizeEngineBrowser = (value, fallback = "chromium") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized ? TESTENGINE_BROWSER_ALIASES.get(normalized) || fallback : fallback;
};

const normalizeSessionMode = (value, fallback = "new") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return ["new", "reuse", "attach"].includes(normalized) ? normalized : fallback;
};

const normalizeHookFailBehavior = (value, fallback = "fail-run") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return ["fail-run", "mark-blocked", "continue"].includes(normalized) ? normalized : fallback;
};

const normalizeEngineHookStep = (step, index, fallbackType = "api") => {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    return null;
  }

  const stepType = resolveEngineStepType(step.step_type, fallbackType);
  return {
    id: normalizeText(step.id) || `hook-step-${index + 1}`,
    order: Math.max(1, normalizeInteger(step.order ?? step.step_order, index + 1) ?? index + 1),
    step_type: stepType,
    engine_class: resolveStepEngineClass(step, fallbackType),
    source_case_parameters: normalizeStringRecord(step.source_case_parameters),
    ...(step.source_case_context ? {source_case_context:{case_parameters:step.source_case_context.case_parameters || {},suite_parameters:step.source_case_context.suite_parameters || {},data_policy:step.source_case_context.data_policy,data_set:step.source_case_context.data_set || null}} : {}),
    shared_parameter_values: normalizeStringRecord(step.shared_parameter_values),
    action: normalizeText(step.action) || null,
    expected_result: normalizeText(step.expected_result) || normalizeText(step.expectedResult) || null,
    automation_code: normalizeText(step.automation_code) || normalizeText(step.automationCode) || null,
    api_request: normalizeApiRequest(step.api_request || step.apiRequest || null),
    group_name: normalizeText(step.group_name) || null,
    group_kind: normalizeText(step.group_kind) || null
  };
};

const normalizeEngineHooks = (value, appTypeKind = "web") => {
  const entries = Array.isArray(value) ? value : [];

  return entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => {
      const phase = normalizeText(entry.phase)?.toLowerCase();
      const scope = normalizeText(entry.scope)?.toLowerCase();
      const steps = Array.isArray(entry.steps)
        ? entry.steps.map((step, stepIndex) => normalizeEngineHookStep(step, stepIndex, appTypeKind)).filter(Boolean)
        : [];

      if (!["pre", "post"].includes(phase) || !["run", "suite", "test"].includes(scope) || !steps.length) {
        return null;
      }

      return {
        id: normalizeText(entry.id) || `hook-${scope}-${phase}-${index + 1}`,
        name: normalizeText(entry.name) || `${scope} ${phase} hook`,
        scope,
        phase,
        fail_behavior: normalizeHookFailBehavior(entry.fail_behavior || entry.failBehavior, "fail-run"),
        target_kind: normalizeText(entry.target_kind || entry.targetKind) || "inline",
        target_id: normalizeText(entry.target_id || entry.targetId) || null,
        steps
      };
    })
    .filter(Boolean);
};

const buildHookStepFromSnapshot = (stepSnapshot, index, appTypeKind = "web") => {
  const stepType = resolveEngineStepType(stepSnapshot.step_type, appTypeKind);

  if (!stepType) {
    return null;
  }

  return {
    id: stepSnapshot.snapshot_step_id || stepSnapshot.id || `hook-step-${index + 1}`,
    order: index + 1,
    step_type: stepType,
    engine_class: resolveStepEngineClass({ step_type: stepType }, appTypeKind),
    action: normalizeText(stepSnapshot.action),
    expected_result: normalizeText(stepSnapshot.expected_result),
    automation_code: normalizeRichText(stepSnapshot.automation_code),
    api_request: stepType === "api" ? normalizeApiRequest(stepSnapshot.api_request) : null,
    shared_parameter_values: normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: normalizeText(stepSnapshot.group_name),
    group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
      ? stepSnapshot.group_kind
      : null
  };
};

const normalizeHookArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
};

const resolveExecutionHooks = ({ execution, integrationHooks, caseSnapshot, stepsByCaseId, appTypeKind = "web" }) => {
  const executionHooks = normalizeHookArray(execution.execution_hooks);
  const runHooks = executionHooks.length ? executionHooks : normalizeHookArray(integrationHooks);
  const caseHooks = normalizeHookArray(caseSnapshot.execution_hooks);
  // Outer run setup, case setup, main case, case cleanup, outer run cleanup.
  // Do not apply the selected workspace case hooks to other selected cases.
  const rawHooks = [
    ...runHooks.filter(hook => hook?.phase !== "post"),
    ...caseHooks.filter(hook => hook?.phase !== "post"),
    ...caseHooks.filter(hook => hook?.phase === "post"),
    ...runHooks.filter(hook => hook?.phase === "post")
  ];
  const caseSnapshots = Array.isArray(execution.case_snapshots) ? execution.case_snapshots : [];

  const resolvedHooks = (Array.isArray(rawHooks) ? rawHooks : []).map((hook) => {
    if (!hook || typeof hook !== "object" || Array.isArray(hook) || Array.isArray(hook.steps) && hook.steps.length) {
      return hook;
    }

    const targetKind = normalizeText(hook.target_kind || hook.targetKind) || "inline";
    const targetId = normalizeText(hook.target_id || hook.targetId);
    let targetCaseIds = [];

    if (targetKind === "test" && targetId) {
      targetCaseIds = [targetId];
    } else if (targetKind === "suite" && targetId) {
      targetCaseIds = caseSnapshots
        .filter((snapshot) =>
          snapshot.suite_id === targetId
          || (Array.isArray(snapshot.suite_ids) && snapshot.suite_ids.includes(targetId))
        )
        .map((snapshot) => snapshot.test_case_id);
    }

    const steps = targetCaseIds
      .filter((testCaseId) => testCaseId !== caseSnapshot.test_case_id)
      .flatMap((testCaseId) => stepsByCaseId.get(testCaseId) || [])
      .map((stepSnapshot, index) => buildHookStepFromSnapshot(stepSnapshot, index, appTypeKind))
      .filter(Boolean);

    return {
      ...hook,
      target_kind: targetKind,
      target_id: targetId,
      steps
    };
  });

  return normalizeEngineHooks(resolvedHooks, appTypeKind);
};

const buildStepAutomationDetail = (step, status, note = null, provider = null) => {
  const code = normalizeRichText(step?.automation_code)
    || (step?.api_request ? JSON.stringify(step.api_request, null, 2) : "")
    || normalizeText(step?.action)
    || "";

  return {
    engine: normalizeTestStepType(step?.step_type || step?.type, "web"),
    provider,
    status,
    code,
    language: step?.api_request ? "json" : "javascript",
    active_line: null,
    error_line: status === "failed" || status === "blocked" ? 1 : null,
    error_message: status === "failed" || status === "blocked" ? normalizeText(note) : null,
    ended_at: nowIso()
  };
};

const buildProviderLiveViewUrl = (integration, provider) => {
  const configured = normalizeText(integration?.config?.live_view_url);
  try {
    const parsed = new URL(configured);
    if (parsed.pathname === "/api/v1/live-session") {
      parsed.searchParams.set("provider", provider === "selenium" ? "selenium" : "playwright");
      return parsed.toString();
    }
  } catch {}

  const baseUrl = normalizeText(integration?.config?.public_base_url || integration?.base_url);

  if (!baseUrl) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl);

    parsed.pathname = "/api/v1/live-session";
    parsed.search = `?provider=${provider === "selenium" ? "selenium" : "playwright"}`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveDirectCallbackBaseUrl = (integration) =>
  normalizeText(process.env.HELLOTEST_LOCAL_CALLBACK_BASE_URL)
  || normalizeText(process.env.HELLOTEST_PUBLIC_API_BASE_URL)
  || normalizeText(integration?.config?.local_callback_base_url)
  || "http://localhost:8080";

const resolveCallbackSecret = (integration) =>
  resolveTestEngineSecret(
    normalizeText(integration?.config?.callback_secret),
    normalizeText(process.env.TESTENGINE_CALLBACK_SECRET)
  );

const buildDirectCallback = (integration) => {
  const baseUrl = new URL(resolveDirectCallbackBaseUrl(integration));
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("Configure a runner-reachable callback base URL without credentials, query or fragment.");
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath.endsWith("/api") ? basePath : `${basePath}/api`}/testengine/callbacks/runs`;
  return {
    url: baseUrl.toString(),
    signing_secret: resolveCallbackSecret(integration)
  };
};

const normalizeInlineEvidence = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const dataUrl = normalizeText(value.dataUrl || value.data_url);

  if (!dataUrl || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    return null;
  }

  return {
    dataUrl,
    fileName: normalizeText(value.fileName || value.file_name) || undefined,
    mimeType: normalizeText(value.mimeType || value.mime_type) || undefined
  };
};

const normalizeApiDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};

const normalizeWebDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};

const normalizeAutomationDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};

const normalizeArtifactBundle = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
};



const normalizePatchProposals = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
};

const normalizeJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeStringRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

const normalizeCapturedValuesRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

const normalizeStepCapturesRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [stepId, captures]) => {
    const normalizedStepId = normalizeText(stepId);

    if (!normalizedStepId) {
      return accumulator;
    }

    const normalizedCaptures = normalizeCapturedValuesRecord(captures);

    if (!Object.keys(normalizedCaptures).length) {
      return accumulator;
    }

    accumulator[normalizedStepId] = normalizedCaptures;
    return accumulator;
  }, {});
};

const toEngineKeyValueEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      key: normalizeText(entry?.key),
      value: entry?.value === undefined || entry?.value === null ? "" : String(entry.value),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);
};

const toEngineDataSetRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = normalizeText(String(key || ""));

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = value === undefined || value === null ? "" : String(value);
        return accumulator;
      }, {})
    );
};

const resolveCaseDataSetContext = (execution, caseSnapshot) => {
  const caseSnapshotData = normalizeJsonValue(caseSnapshot?.test_data_set_snapshot, null);

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

const resolveEngineStepType = (stepType, appTypeKind) => {
  const normalized = normalizeTestStepType(stepType, null);

  if (normalized && SUPPORTED_ENGINE_STEP_TYPES.has(normalized)) {
    return normalized;
  }

  if (appTypeKind === "api" && !normalized) {
    return "api";
  }

  if ((appTypeKind === "android" || appTypeKind === "ios") && !normalized) {
    return appTypeKind;
  }

  if ((appTypeKind === "web" || appTypeKind === "unified") && !normalized) {
    return "web";
  }

  return null;
};

const buildManualSpec = ({ caseSnapshot, steps, execution }) => {
  const preconditions = [];
  const environmentName = execution.test_environment?.name;
  const environmentBaseUrl = execution.test_environment?.snapshot?.base_url;
  const suiteName = normalizeText(caseSnapshot.suite_name);

  if (suiteName && suiteName !== "Default") {
    preconditions.push(`Scope suite: ${suiteName}`);
  }

  if (environmentName) {
    preconditions.push(
      environmentBaseUrl
        ? `Environment: ${environmentName} (${environmentBaseUrl})`
        : `Environment: ${environmentName}`
    );
  }

  return {
    title: caseSnapshot.test_case_title,
    intent: normalizeText(caseSnapshot.test_case_description) || `Execute and validate ${caseSnapshot.test_case_title}`,
    preconditions,
    steps: steps.map((step) => step.action || `Step ${step.order}`),
    detailed_steps: steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action || `Step ${step.order}`,
      expected_result: step.expected_result || null,
      automation_code: step.automation_code || null,
      api_request: step.api_request || null
    })),
    assertions: steps.map((step) => step.expected_result).filter(Boolean),
    test_data: {
      ...normalizeParameterLayer(normalizeStringRecord(caseSnapshot.parameter_values), "r"),
      ...normalizeParameterLayer(normalizeStringRecord(caseSnapshot.suite_parameter_values), "s")
    },
    environment_notes: normalizeText(execution.test_environment?.snapshot?.notes)
  };
};

const buildEngineEnvelope = async ({
  engineRunId,
  execution,
  project,
  appType,
  caseSnapshot,
  steps,
  stepsByCaseId,
  integration,
  objectRepository = [],
  dataSetIteration = null
}) => {
  const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const configurationSnapshot = execution.test_configuration?.snapshot || {};
  const configurationTargets = configurationTargetsForRead(configurationSnapshot.targets, configurationSnapshot);
  const appTypeKind = resolveAutomationCaseType(caseSnapshot, { steps, appTypeKind: appType?.type || execution.app_type_type });
  const isMobileTarget = appTypeKind === "android" || appTypeKind === "ios";
  const selectedConfigurationTarget = isMobileTarget
    ? configurationTargets.find((target) => normalizeText(target.mobile_os)?.toLowerCase() === appTypeKind)
    : configurationTargets.find((target) => normalizeText(target.browser) && !normalizeText(target.mobile_os))
      || configurationTargets.find((target) => normalizeText(target.browser))
      || configurationTargets[0];
  const resolvedBrowser = normalizeEngineBrowser(
    selectedConfigurationTarget?.browser
    || configurationSnapshot.browser
    || execution.test_environment?.snapshot?.browser
    || integrationConfig.browser
    || "chromium",
    "chromium"
  );
  const executionPolicy = await resolveExecutionPolicy(execution, caseSnapshot);
  const caseDataSet = resolveCaseDataSetContext(execution, caseSnapshot);
  const hooks = resolveExecutionHooks({execution,integrationHooks:integrationConfig.execution_hooks,caseSnapshot,stepsByCaseId,appTypeKind:appType?.type||'web'});
  const mobileEngine = require('../lib/automationMobileConfiguration').buildMobileEngineConfiguration({automationCaseType:appTypeKind,steps,hooks,configurationSnapshot,integrationConfig});

  return preserveFrozenEngineEnvelope({
    engine_run_id: engineRunId,
    parameter_scope_default: execution.parameter_scope_default || "r",
    hellotest_run_id: execution.id,
    hellotest_execution_id: execution.id,
    hellotest_test_case_id: caseSnapshot.test_case_id,
    hellotest_test_case_title: caseSnapshot.test_case_title,
    external_references: normalizeStoredReferenceList(caseSnapshot.external_references),
    project: {
      id: project.id,
      name: project.name
    },
    app_type: {
      id: appType?.id || execution.app_type_id || "unknown",
      name: appType?.name || "Unknown App Type",
      kind: appType?.type || "web"
    },
    trigger: "execution",
    source_mode: "manual-handover",
    automated: true,
    automation_case_type: appTypeKind,
    execution_policy: executionPolicy,
    browser: resolvedBrowser,
    headless: integrationConfig.headless === true,
    max_repair_attempts:
      execution.repair_validation || integrationConfig.healing_enabled === false
        ? 0
        : Math.max(0, normalizeInteger(integrationConfig.max_repair_attempts, 1) ?? 1),
    run_timeout_seconds: Math.max(60, normalizeInteger(integrationConfig.run_timeout_seconds, 1800) ?? 1800),
    timeouts: {
      navigation_timeout_ms: Math.max(1000, normalizeInteger(integrationConfig.navigation_timeout_ms, 30000) ?? 30000),
      action_timeout_ms: Math.max(250, normalizeInteger(integrationConfig.action_timeout_ms, 5000) ?? 5000),
      assertion_timeout_ms: Math.max(250, normalizeInteger(integrationConfig.assertion_timeout_ms, 10000) ?? 10000),
      recovery_wait_ms: Math.max(100, normalizeInteger(integrationConfig.recovery_wait_ms, 750) ?? 750)
    },
    session_policy: {
      web: {
        mode: execution.repair_validation ? "new" : normalizeSessionMode(integrationConfig.web_session_mode, "new"),
        reuse_key: execution.repair_validation ? null : normalizeText(integrationConfig.web_session_reuse_key) || null,
        connect_over_cdp_endpoint: execution.repair_validation ? null : normalizeText(integrationConfig.connect_over_cdp_endpoint || integrationConfig.playwright_cdp_endpoint) || null,
        close_on_finish: Boolean(execution.repair_validation) || integrationConfig.close_attached_web_session === true
      },
      mobile: {
        mode: normalizeSessionMode(integrationConfig.mobile_session_mode, "new"),
        reuse_key: normalizeText(integrationConfig.mobile_session_reuse_key) || null,
        existing_session_id: normalizeText(integrationConfig.mobile_existing_session_id || integrationConfig.appium_session_id) || null,
        close_on_finish: integrationConfig.close_attached_mobile_session === true
      }
    },
    web_engine: {
      active: normalizeTestEngineWebEngine(integrationConfig.active_web_engine, "playwright")
    },
    mobile_engine: mobileEngine,
    manual_spec: buildManualSpec({ caseSnapshot, steps, execution }),
    auto_repair_brief: await configuredRepairBrief(),
    hooks,
    object_repository: objectRepository,
    steps,
    suite_parameters: normalizeStringRecord(caseSnapshot.suite_parameter_values),
    case_parameters: normalizeStringRecord(caseSnapshot.parameter_values),
    run_parameters: normalizeStringRecord(execution.parameter_values),
    parameters_frozen: true,
    data_policy: caseSnapshot.test_data_options?.runtime_policy,
    environment: execution.test_environment
      ? {
          name: execution.test_environment.name,
          base_url: execution.test_environment.snapshot?.base_url || null,
          browser: execution.test_environment.snapshot?.browser || null,
          variables: toEngineKeyValueEntries(execution.test_environment.snapshot?.variables)
        }
      : null,
    configuration: execution.test_configuration
      ? {
          name: execution.test_configuration.name,
          os: selectedConfigurationTarget?.os || null,
          browser: selectedConfigurationTarget?.browser || configurationSnapshot.browser || null,
          mobile_os: isMobileTarget ? appTypeKind : selectedConfigurationTarget?.mobile_os || configurationSnapshot.mobile_os || null,
          platform_version: isMobileTarget ? mobileEngine.platform_version : selectedConfigurationTarget?.version || configurationSnapshot.platform_version || null,
          targets: configurationTargets,
          variables: toEngineKeyValueEntries(execution.test_configuration.snapshot?.variables)
        }
      : null,
    data_set: caseDataSet
      ? {
          id: caseDataSet.id || null,
          name: caseDataSet.name,
          source: caseDataSet.source,
          mode: caseDataSet.snapshot?.mode === "key_value" ? "key_value" : "table",
          columns: Array.isArray(caseDataSet.snapshot?.columns)
            ? caseDataSet.snapshot.columns.map((entry) => String(entry))
            : [],
          rows: dataSetIteration?.row
            ? [dataSetIteration.row]
            : toEngineDataSetRows(caseDataSet.snapshot?.rows),
          data_scope_policy: caseDataSet.snapshot?.data_scope_policy,
          parameter_data_layers: caseDataSet.snapshot?.parameter_data_layers ? Object.fromEntries(Object.entries(caseDataSet.snapshot.parameter_data_layers).map(([name, layer]) => [name, layer ? { ...layer,
            rows: [layer.rows[layer.rows.length === 1 ? 0 : dataSetIteration?.index || 0] || {}],
            template_rows: undefined } : null])) : undefined,
          shared_rows: Array.isArray(caseDataSet.snapshot?.shared_rows)
            ? [caseDataSet.snapshot.shared_rows[dataSetIteration?.index || 0] || {}] : undefined,
          iteration: dataSetIteration ? {
            index: dataSetIteration.index,
            number: dataSetIteration.index + 1,
            key: dataSetIteration.key,
            total: dataSetIteration.total
          } : null
        }
      : null,
    artifact_policy: {
      trace_mode: normalizeText(integrationConfig.trace_mode) || "off",
      video_mode: normalizeText(integrationConfig.video_mode) || "off",
      screenshot_on_failure: integrationConfig.screenshot_on_failure !== false,
      screenshot_on_success: integration?.config?.screenshot_on_success !== false,
      capture_console: integrationConfig.capture_console !== false,
      capture_network: integrationConfig.capture_network !== false,
      artifact_retention_days: Math.max(1, normalizeInteger(integrationConfig.artifact_retention_days, 7) ?? 7),
      max_video_attachment_mb: Math.max(1, normalizeInteger(integrationConfig.max_video_attachment_mb, 25) ?? 25)
    },
    callback: null
  }, execution.parameter_scope_default);
};

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
    patch_proposals: normalizePatchProposals(parsed.patch_proposals)
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

async function planExecutionDispatch(execution, options = {}) {
  const [project, appType] = await Promise.all([
    selectProject.get(execution.project_id),
    execution.app_type_id ? selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  const stepsByCaseId = new Map();

  for (const stepSnapshot of execution.step_snapshots || []) {
    const current = stepsByCaseId.get(stepSnapshot.test_case_id) || [];
    current.push(stepSnapshot);
    stepsByCaseId.set(stepSnapshot.test_case_id, current);
  }

  const warnings = [];
  const eligibleCases = [];
  let automatedCaseCount = 0;
  let manualCaseCount = 0;
  let unsupportedAutomatedCaseCount = 0;
  const allowIncompleteAutomation = options.allowIncompleteAutomation === true;
  const allowApiCasesWithoutAutomation = options.allowApiCasesWithoutAutomation === true;

  for (const caseSnapshot of execution.case_snapshots || []) {
    const dataSetIterations = resolveExecutionDataSetIterations(execution, caseSnapshot);
    const caseRecord = await selectTestCaseDispatchMetadata.get(caseSnapshot.test_case_id);
    const savedSteps = stepsByCaseId.get(caseSnapshot.test_case_id) || [];
    const isAutomated = (caseSnapshot.automated ?? caseRecord?.automated) === 'yes';
    if (!isAutomated && (!allowApiCasesWithoutAutomation || !savedSteps.length
      || savedSteps.some(step => !normalizeApiRequest(step.api_request)?.url))) {
      manualCaseCount += 1;
      continue;
    }
    // A run keeps its frozen case type and steps even when the authoring case
    // changes later. Application kind is only a legacy inference input.
    let resolved;
    try { resolved = resolveAutomationCaseSteps(caseSnapshot, savedSteps, { appTypeKind: appType?.type }); }
    catch (error) {
      // A manual draft is never blocked by automation-only platform metadata.
      if (isAutomated) throw error;
      manualCaseCount += 1;
      continue;
    }
    const { automation_case_type: appTypeKind, steps: rawSteps } = resolved;
    const isApiOnlyRunnableCase = allowApiCasesWithoutAutomation
      && normalizeText(appTypeKind)?.toLowerCase() === "api"
      && rawSteps.length > 0
      && rawSteps.every((stepSnapshot) =>
        resolveEngineStepType(stepSnapshot.step_type, appTypeKind) === "api"
        && Boolean(normalizeApiRequest(stepSnapshot.api_request)?.url)
      );

    if (!isAutomated && !isApiOnlyRunnableCase) {
      manualCaseCount += 1;
      continue;
    }

    automatedCaseCount += 1;

    if (!isApiOnlyRunnableCase && caseRecord?.automation_status && caseRecord.automation_status !== "ready") {
      warnings.push(`${caseSnapshot.test_case_title}: automation is incomplete because a required repository object is missing or still needs review.`);
      if (!allowIncompleteAutomation) {
        unsupportedAutomatedCaseCount += 1;
        continue;
      }
    }

    if (!rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(`${caseSnapshot.test_case_title}: automated case has no snapped steps to queue.`);
      continue;
    }

    const stepWarnings = [];
    const normalizedSteps = rawSteps.map((stepSnapshot) => {
      const stepType = resolveEngineStepType(stepSnapshot.step_type, appTypeKind);

      if (!stepType) {
        stepWarnings.push(
          `${caseSnapshot.test_case_title}: step ${stepSnapshot.step_order} is not part of the current engine-supported API, web, or mobile path.`
        );
        return null;
      }

      return {
        id: stepSnapshot.snapshot_step_id,
        order: stepSnapshot.step_order,
        step_type: stepType,
        engine_class: resolveStepEngineClass({ step_type: stepType }, appTypeKind),
        action: normalizeText(stepSnapshot.action),
        expected_result: normalizeText(stepSnapshot.expected_result),
        automation_code: normalizeRichText(stepSnapshot.automation_code),
        // Inspect authored fields before permissive legacy normalization can
        // replace an unsupported method or discard an invalid assertion.
        api_request: stepType === "api" ? stepSnapshot.api_request : null,
        shared_parameter_values: normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: normalizeText(stepSnapshot.group_name),
        group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
          ? stepSnapshot.group_kind
          : null
      };
    }).filter(Boolean);

    if (stepWarnings.length || normalizedSteps.length !== rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...stepWarnings);
      continue;
    }

    const executableIssues = require("./automationReadiness.service").inspectExecutablePlan(normalizedSteps);
    if (executableIssues.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...executableIssues.map(issue => `${caseSnapshot.test_case_title}: ${issue}`));
      continue;
    }
    const runnableSteps = normalizedSteps.map(step => step.step_type === 'api'
      ? { ...step, api_request: normalizeApiRequest(step.api_request) } : step);

    for (const dataSetIteration of dataSetIterations) {
      eligibleCases.push({
        engine_run_id: uuid(),
        case_snapshot: caseSnapshot,
        case_record: caseRecord,
        data_set_iteration: dataSetIteration,
        envelope: null,
        steps: runnableSteps
      });
    }
  }

  return {
    execution,
    project,
    appType,
    automated_case_count: automatedCaseCount,
    eligible_automated_case_count: eligibleCases.length,
    manual_case_count: manualCaseCount,
    unsupported_automated_case_count: unsupportedAutomatedCaseCount,
    warnings: summarizeWarnings(warnings),
    stepsByCaseId,
    eligibleCases: eligibleCases.sort((left, right) =>
      Number(left.case_snapshot.sort_order || 0) - Number(right.case_snapshot.sort_order || 0)
    )
  };
}

async function settleExecutionIfComplete(executionId) {
  const requiredCases = (await selectExecutionCaseIds.all(executionId))
    .filter((row) => normalizeText(row.test_case_id));

  if (!requiredCases.length) {
    return;
  }

  const latestResults = await selectLatestResultsForExecution.all(executionId);
  const executionContext = await selectExecutionDataSetContext.get(executionId);
  const legacyDataSetSnapshot = normalizeJsonValue(executionContext?.test_data_set_snapshot, null);
  const legacyExecution = executionContext?.test_data_set_id || legacyDataSetSnapshot
    ? {
        test_data_set: {
          id: executionContext?.test_data_set_id || legacyDataSetSnapshot?.id || null,
          name: legacyDataSetSnapshot?.name || "Deleted data set",
          snapshot: legacyDataSetSnapshot
        }
      }
    : null;
  const latestStatusByIteration = new Map(latestResults.map((result) => [
    `${normalizeText(result.test_case_id)}:${Number.isInteger(result.data_set_iteration_index) ? result.data_set_iteration_index : -1}`,
    normalizeText(result.status)
  ]));
  const coveredCases=new Map(latestResults.filter(row=>row.derived&&row.covers_entire_case).map(row=>[row.test_case_id,row.status]));
  const requiredIterationKeys = requiredCases.flatMap((caseSnapshot) => {
    const testCaseId = normalizeText(caseSnapshot.test_case_id);
    const dataSet = resolveCaseDataSetContext(legacyExecution, caseSnapshot);
    const rows = dataSet?.snapshot?.mode === "table" && Array.isArray(dataSet.snapshot.rows)
      ? dataSet.snapshot.rows
      : [];
    const iterationIndexes = dataSet
      ? rows.length ? rows.map((_row, index) => index) : [0]
      : [-1];
    return iterationIndexes.map((iterationIndex) => {
      const key=`${testCaseId}:${iterationIndex}`;
      if(coveredCases.has(testCaseId)&&(!latestStatusByIteration.has(key)||latestStatusByIteration.get(key)==="pending")) latestStatusByIteration.set(key,coveredCases.get(testCaseId));
      return key;
    });
  });

  if (
    requiredIterationKeys.some((key) => !latestStatusByIteration.has(key))
    || requiredIterationKeys.some((key) => !isFinalResultStatus(latestStatusByIteration.get(key)))
  ) {
    return;
  }

  const nextExecutionStatus = requiredIterationKeys.every((key) => latestStatusByIteration.get(key) === "passed")
    ? "completed"
    : "failed";

  await settleExecutionStatus.run(nextExecutionStatus, executionId);
}

async function queueExecutionDispatch({ plan, integration, initiatedBy }) {
  if (!plan.eligibleCases.length) {
    return {
      automated_case_count: plan.automated_case_count,
      queued_for_engine_count: 0,
      manual_case_count: plan.manual_case_count,
      unsupported_automated_case_count: plan.unsupported_automated_case_count,
      warnings: plan.warnings
    };
  }

  const concurrencyLimit = Number(process.env.TESTENGINE_DISPATCH_CONCURRENCY) || 5;
  for (let i = 0; i < plan.eligibleCases.length; i += concurrencyLimit) {
    const chunk = plan.eligibleCases.slice(i, i + concurrencyLimit);
    await Promise.all(chunk.map(async (item) => {
      const objectRepository = await listObjectRepositoryForEnvelope({
        projectId: plan.execution.project_id,
        appTypeId: plan.execution.app_type_id,
        testCaseId: item.case_snapshot.test_case_id
      });
      const envelope = await buildEngineEnvelope({
        engineRunId: item.engine_run_id,
        execution: plan.execution,
        project: plan.project,
        appType: plan.appType,
        caseSnapshot: item.case_snapshot,
        steps: item.steps,
        stepsByCaseId: plan.stepsByCaseId,
        integration,
        objectRepository,
        dataSetIteration: item.data_set_iteration
      });
      const orchestrationSteps = [...item.steps, ...(envelope.hooks || []).flatMap(hook => hook.steps)];
      const orchestrationClass = resolveOrchestrationClass(orchestrationSteps, plan.appType?.type || "web");
      const stepEngineClasses = resolveStepEngineClasses(orchestrationSteps, plan.appType?.type || "web");
      const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
        ? integration.config
        : {};
      const engineWorkerCaps = resolveIntegrationEngineWorkerCaps(integrationConfig);
      const engineMaxWorkers = engineWorkerCaps[orchestrationClass] || getQueueMaxWorkers(orchestrationClass);
      envelope.engine_worker_caps = engineWorkerCaps;
      envelope.step_engine_classes = stepEngineClasses;
      envelope.orchestration_class = orchestrationClass;

      const transaction = await workspaceTransactionService.createTransaction({
        project_id: plan.execution.project_id,
        app_type_id: plan.execution.app_type_id || null,
        category: "automation",
        action: "testengine_run",
        status: "queued",
        title: `Automated handoff for ${item.case_snapshot.test_case_title}`,
        description: "Queued for Test Engine execution.",
        metadata: {
          source: "hellotest",
          engine_run_id: item.engine_run_id,
          execution_id: plan.execution.id,
          test_case_id: item.case_snapshot.test_case_id,
          data_set_iteration_index: item.data_set_iteration?.index ?? null,
          data_set_iteration_key: item.data_set_iteration?.key || null,
          engine_host: normalizeEngineHostUrl(integration.base_url),
          queue_mode: "hellotest-pull",
          orchestration_class: orchestrationClass,
          step_engine_classes: stepEngineClasses,
          engine_max_workers: engineMaxWorkers,
          active_web_engine: envelope.web_engine?.active || "playwright",
          live_view_url: buildProviderLiveViewUrl(integration, envelope.web_engine?.active || "playwright")
        },
        related_kind: "testengine_run",
        related_id: item.engine_run_id,
        created_by: initiatedBy || plan.execution.created_by || null,
        started_at: new Date().toISOString()
      });

      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: "info",
        phase: "dispatch.queued",
        message: `Queued ${item.case_snapshot.test_case_title} for Test Engine execution.`,
        details: {
          execution_id: plan.execution.id,
          test_case_id: item.case_snapshot.test_case_id,
          engine_run_id: item.engine_run_id
        }
      });

      await insertJob.run(
        uuid(),
        item.engine_run_id,
        integration.id || null,
        plan.execution.project_id,
        plan.execution.app_type_id || null,
        plan.appType?.type || "web",
        orchestrationClass,
        engineMaxWorkers,
        plan.execution.id,
        item.case_snapshot.test_case_id,
        item.case_snapshot.test_case_title,
        transaction.id,
        normalizeEngineHostUrl(integration.base_url),
        envelope,
        {
          captured_values: {},
          logs: parseStructuredLogs(null)
        },
        "queued",
        0,
        null,
        null,
        null,
        null,
        null,
        initiatedBy || plan.execution.created_by || null
      );
    }));
  }

  return {
    automated_case_count: plan.automated_case_count,
    queued_for_engine_count: plan.eligibleCases.length,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}

async function runExecutionDirectLocal({ plan, integration, initiatedBy, engineBaseUrl } = {}) {
  if (!plan?.eligibleCases?.length) {
    return {
      automated_case_count: plan?.automated_case_count || 0,
      local_run_count: 0,
      manual_case_count: plan?.manual_case_count || 0,
      unsupported_automated_case_count: plan?.unsupported_automated_case_count || 0,
      warnings: plan?.warnings || []
    };
  }

  const engineHost = normalizeEngineHostUrl(engineBaseUrl || integration?.base_url);
  if (!engineHost) {
    throw new Error("Local run requires a local Test Engine URL. Start HelloTest local-run or the local runner service first.");
  }

  const activeWebEngine = "playwright";
  const directIntegration = {
    ...(integration || {}),
    base_url: engineHost,
    config: {
      ...(integration?.config || {}),
      active_web_engine: activeWebEngine,
      headless: integration?.config?.headless === true,
      video_mode: normalizeText(integration?.config?.video_mode) || "on",
      trace_mode: normalizeText(integration?.config?.trace_mode) || "on",
      max_video_attachment_mb: integration?.config?.max_video_attachment_mb ?? 16,
      web_session_mode: "new",
      web_session_reuse_key: null,
      connect_over_cdp_endpoint: null,
      playwright_cdp_endpoint: null,
      live_view_url: `${engineHost}/api/v1/live-session?provider=playwright`
    }
  };
  const callback = buildDirectCallback({...directIntegration,config:{...directIntegration.config,callback_secret:null}});
  const dispatchSecret = resolveTestEngineSecret();

  for (const item of plan.eligibleCases) {
    const objectRepository = await listObjectRepositoryForEnvelope({
      projectId: plan.execution.project_id,
      appTypeId: plan.execution.app_type_id,
      testCaseId: item.case_snapshot.test_case_id
    });
    const baseEnvelope = await buildEngineEnvelope({
      engineRunId: item.engine_run_id,
      execution: plan.execution,
      project: plan.project,
      appType: plan.appType,
      caseSnapshot: item.case_snapshot,
      steps: item.steps,
      integration: directIntegration,
      objectRepository,
      dataSetIteration: item.data_set_iteration
    });
    const envelope = {
      ...baseEnvelope,
      callback
    };
    const orchestrationClass = resolveOrchestrationClass([...item.steps, ...(envelope.hooks || []).flatMap(hook => hook.steps)], plan.appType?.type || "web");
    const isApiOnlyRun = orchestrationClass === "api";
    const liveViewUrl = buildProviderLiveViewUrl(directIntegration, activeWebEngine);
    const transactionMetadata = {
      source: "hellotest.local-run",
      engine_run_id: item.engine_run_id,
      execution_id: plan.execution.id,
      test_case_id: item.case_snapshot.test_case_id,
      data_set_iteration_index: item.data_set_iteration?.index ?? null,
      data_set_iteration_key: item.data_set_iteration?.key || null,
      engine_host: engineHost,
      queue_mode: "direct-local",
      orchestration_class: orchestrationClass,
      active_web_engine: activeWebEngine,
      live_view_url: isApiOnlyRun ? null : liveViewUrl,
      callback_url: callback.url,
      artifact_policy: envelope.artifact_policy,
      capture_failure_override: item.steps.some(step => /^\s*\/\/\s*@hellotest-options\s+[^\r\n]*\bscreenshotOnFailure\b/i.test(step.automation_code || ''))
    };
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: "automation",
      action: "testengine_run",
      status: "running",
      title: `Local run for ${item.case_snapshot.test_case_title}`,
      description: isApiOnlyRun
        ? "Running immediately on the local Test Engine API runner."
        : "Running immediately on the local Playwright host recorder.",
      metadata: transactionMetadata,
      related_kind: "testengine_run",
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null,
      started_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "info",
      phase: "local-run.started",
      message: `Started ${item.case_snapshot.test_case_title} on the ${isApiOnlyRun ? "local API runner" : "local Playwright runner"}.`,
      details: {
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_run_id: item.engine_run_id,
        engine_host: engineHost,
        live_view_url: isApiOnlyRun ? null : liveViewUrl
      }
    });

    let response;
    try {
      response = await resilientHttpRequest(`${engineHost}/api/v1/runs`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-hellotest-testengine-secret": dispatchSecret
        },
        body: JSON.stringify(envelope)
      }, {
        dependency: "test-engine",
        operation: "run.dispatch",
        deadlineMs: DIRECT_DISPATCH_TIMEOUT_MS,
        maxAttempts: 1,
        maxResponseBytes: 1024 * 1024,
        maxConcurrent: 32,
        failureThreshold: 6,
        resetTimeoutMs: 15_000
      });
    } catch (error) {
      await updateQueueTransaction(transaction.id, {
        status: "running",
        metadata: {...transactionMetadata,acknowledgement:"unknown",failure_code:"LOCAL_DISPATCH_UNCERTAIN"}
      });
      const message = "The local runner acknowledgement was lost. Keep this run receipt and inspect incoming results before starting another run.";
      throw Object.assign(new Error(message), {code:"LOCAL_DISPATCH_UNCERTAIN",statusCode:502,publicMessage:message});
    }

    const payload = await readBoundedResponseJson(response, {
      maxBytes: 1024 * 1024,
      label: "Test Engine response"
    }).catch(() => null);
    if (!response.ok) {
      const failure = serviceError(SERVICE_ERROR_CODES.UPSTREAM_REJECTED, {
        dependency: "test-engine",
        operation: "run.dispatch",
        retryable: response.status === 429 || response.status >= 500,
        statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
        upstreamStatus: response.status
      });
      failure.publicMessage = [401, 403].includes(response.status)
        ? "The local runner rejected the HelloTest credentials. Restart the host recorder using the same HELLOTEST_TESTENGINE_SECRET as the HelloTest API, then check the runner connection."
        : response.status === 429
          ? "The local runner is at capacity. Wait for its current cases to finish before retrying this case."
          : "The local runner could not start this case. Check its terminal or local-run/artifacts/host-recorder/launcher.log for startup errors, and ensure the runner matches this HelloTest version.";
      await updateQueueTransaction(transaction.id, {
        status: "failed",
        metadata: {
          ...transactionMetadata,
          failure: failure.code,
          upstream_status: response.status
        },
        completed_at: new Date().toISOString()
      });
      throw failure;
    }
  }

  return {
    automated_case_count: plan.automated_case_count,
    local_run_count: plan.eligibleCases.length,
    queued_for_engine_count: 0,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}

async function queueSingleStepDispatch({
  execution,
  caseSnapshot,
  stepSnapshot,
  integration,
  initiatedBy,
  capturedValues = {},
  existingLogs = null,
  dataSetIteration = null
} = {}) {
  if (!execution || !caseSnapshot || !stepSnapshot) {
    throw new Error("Execution, test case, and step snapshots are required for step handoff");
  }

  const [project, appType] = await Promise.all([
    selectProject.get(execution.project_id),
    execution.app_type_id ? selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  if (!integration) {
    throw new Error("Configure an active Test Engine integration for this project before running web automation steps.");
  }

  const stepType = resolveEngineStepType(stepSnapshot.step_type, appType?.type || null);

  if (stepType !== "web") {
    throw new Error("Only web execution steps can be handed off to Test Engine from the execution console");
  }

  const step = {
    id: stepSnapshot.snapshot_step_id,
    order: stepSnapshot.step_order,
    step_type: stepType,
    action: normalizeText(stepSnapshot.action),
    expected_result: normalizeText(stepSnapshot.expected_result),
    automation_code: normalizeRichText(stepSnapshot.automation_code),
    api_request: null,
    shared_parameter_values: normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: normalizeText(stepSnapshot.group_name),
    group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
      ? stepSnapshot.group_kind
      : null
  };
  const engineRunId = uuid();
  const objectRepository = await listObjectRepositoryForEnvelope({
    projectId: execution.project_id,
    appTypeId: execution.app_type_id,
    testCaseId: caseSnapshot.test_case_id
  });
  const envelope = await buildEngineEnvelope({
    engineRunId,
    execution,
    project,
    appType,
    caseSnapshot,
    steps: [step],
    integration,
    objectRepository,
    dataSetIteration
  });
  const activeWebEngine = envelope.web_engine?.active || "playwright";
  const orchestrationClass = resolveOrchestrationClass([step, ...(envelope.hooks || []).flatMap(hook => hook.steps)], appType?.type || "web");
  const stepEngineClasses = resolveStepEngineClasses([step], appType?.type || "web");
  const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const engineWorkerCaps = resolveIntegrationEngineWorkerCaps(integrationConfig);
  const engineMaxWorkers = engineWorkerCaps[orchestrationClass] || getQueueMaxWorkers(orchestrationClass);
  envelope.engine_worker_caps = engineWorkerCaps;
  envelope.step_engine_classes = stepEngineClasses;
  envelope.orchestration_class = orchestrationClass;
  const liveViewUrl = buildProviderLiveViewUrl(integration, activeWebEngine);
  const transaction = await workspaceTransactionService.createTransaction({
    project_id: execution.project_id,
    app_type_id: execution.app_type_id || null,
    category: "automation",
    action: "testengine_run",
    status: "queued",
    title: `Live step handoff for ${caseSnapshot.test_case_title}`,
    description: `Queued step ${step.order} for Test Engine execution.`,
    metadata: {
      source: "hellotest.execution-console",
      single_step: true,
      engine_run_id: engineRunId,
      execution_id: execution.id,
      test_case_id: caseSnapshot.test_case_id,
      data_set_iteration_index: dataSetIteration?.index ?? null,
      data_set_iteration_key: dataSetIteration?.key || null,
      step_id: step.id,
      engine_host: normalizeEngineHostUrl(integration.base_url),
      queue_mode: "hellotest-pull",
      orchestration_class: orchestrationClass,
      step_engine_classes: stepEngineClasses,
      engine_max_workers: engineMaxWorkers,
      active_web_engine: activeWebEngine,
      live_view_url: liveViewUrl
    },
    related_kind: "testengine_run",
    related_id: engineRunId,
    created_by: initiatedBy || execution.created_by || null,
    started_at: new Date().toISOString()
  });
  const jobId = uuid();
  const runtimeLogs = parseStructuredLogs(existingLogs);
  const runtimeCapturedValues = normalizeFrozenCapturedValues(capturedValues, execution.parameter_scope_default);
  delete runtimeLogs.stepStatuses[step.id];

  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: "info",
    phase: "dispatch.step-queued",
    message: `Queued ${caseSnapshot.test_case_title} step ${step.order} for Test Engine execution.`,
    details: {
      execution_id: execution.id,
      test_case_id: caseSnapshot.test_case_id,
      step_id: step.id,
      engine_run_id: engineRunId
    }
  });

  await insertJob.run(
    jobId,
    engineRunId,
    integration.id || null,
    execution.project_id,
    execution.app_type_id || null,
    appType?.type || "web",
    orchestrationClass,
    engineMaxWorkers,
    execution.id,
    caseSnapshot.test_case_id,
    caseSnapshot.test_case_title,
    transaction.id,
    normalizeEngineHostUrl(integration.base_url),
    envelope,
    {
      captured_values: runtimeCapturedValues,
      logs: runtimeLogs
    },
    "queued",
    0,
    null,
    null,
    null,
    null,
    null,
    initiatedBy || execution.created_by || null
  );

  return {
    job_id: jobId,
    engine_run_id: engineRunId,
    transaction_id: transaction.id,
    active_web_engine: activeWebEngine,
    live_view_url: liveViewUrl
  };
}

async function getQueuedJob(id) {
  const job = hydrateJob(await selectJob.get(id));

  if (!job) {
    throw new Error("Test Engine queue job not found");
  }

  return job;
}

const isFinalResultStatus = (status) => ["passed", "failed", "blocked", "aborted", "skipped"].includes(normalizeText(status));
const isFinalJobStatus = (status) => ["completed", "failed", "aborted"].includes(normalizeText(status));

const collectPriorExecutionCaptures = async (executionId, testCaseId, suiteId, suiteScoped, iteration = {}, defaultScope = "r") => {
  const orderRows = toRowArray(await selectExecutionCaseOrder.all(executionId));
  const current = orderRows.find((row) => row.test_case_id === testCaseId);

  if (!current) {
    return {};
  }

  const priorIds = new Set(
    orderRows
      .filter((row) =>
        Number(row.sort_order || 0) < Number(current.sort_order || 0)
        && (!suiteScoped || (row.suite_id || null) === (suiteId || null))
      )
      .map((row) => row.test_case_id)
  );

  if (!priorIds.size) {
    return {};
  }

  const capturesByCaseId = {};
  for (const row of toRowArray(await selectLatestLogsForExecution.all(executionId))) {
    if (!matchesParameterIteration(row, iteration) || !priorIds.has(row.test_case_id) || Object.hasOwn(capturesByCaseId, row.test_case_id)) {
      continue;
    }

    capturesByCaseId[row.test_case_id] = normalizeFrozenCapturedValues(
      executionStepRuntimeService.extractCapturedValuesFromLogs(row.logs), defaultScope);
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
  const policy = job.payload?.execution_policy || {};
  const suiteScoped = Boolean(policy.suite_parallel_override && policy.suite_id);
  const priorCaptures = await collectPriorExecutionCaptures(job.execution_id, job.test_case_id, policy.suite_id || null, suiteScoped,
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
  const safeLeaseSeconds = Math.max(30, Number(lease_seconds) || DEFAULT_LEASE_SECONDS);
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

  const leaseExpiresAt = new Date(Date.now() + safeLeaseSeconds * 1000).toISOString();

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
      return await leaseNextQueuedJobTransaction(params);
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
const withQueuedJobLock = (operation) => obsDb.transaction(async (params = {}) => {
  const jobId = normalizeText(params.job_id);
  if (!jobId) throw new Error("Queued job ID is required");
  const locked = await obsDb.prepare("SELECT id FROM test_engine_jobs WHERE id = ? FOR UPDATE").get(jobId);
  if (!locked) throw new Error("Queued job not found");
  return operation(params);
});

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
  const normalizedWorkerId = normalizeText(worker_id) || job.leased_by || "testengine-worker";
  const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString();
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

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      source: "testengine.queue.start",
      summary: `${job.test_case_title} started in the Test Engine.`,
      execution_result_id: result.id
    });
  } catch {
    // OPS telemetry is best-effort and must not block queue processing.
  }

  return {
    job_id: job.id,
    execution_result_id: result.id,
    status: "running"
  };
});

exports.executeQueuedApiStep = withQueuedJobLock(async ({ job_id, step_id } = {}) => {
  const job = await getQueuedJob(job_id);
  if (job.completed_at || isFinalJobStatus(job.status)) {
    throw Object.assign(new Error("Finished jobs cannot execute additional API requests."), {
      code: "TESTENGINE_JOB_FINISHED", statusCode: 409
    });
  }

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
    new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
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

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
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
  } catch {
    // OPS telemetry is best-effort and must not block queue processing.
  }

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
    new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
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

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
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
  } catch {
    // OPS telemetry is best-effort and must not block queue processing.
  }

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
  status,
  error,
  summary,
  deterministic_attempted,
  healing_attempted,
  healing_succeeded,
  artifact_bundle,
  patch_proposals
} = {}) => {
  const job = await getQueuedJob(job_id);
  const receipt = await terminalJobReceipt(job);
  if (receipt) return receipt;
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

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: job.execution_id,
      test_case_id: job.test_case_id,
      source: "testengine.queue.complete",
      summary: normalizedSummary,
      execution_result_id: result.id
    });
  } catch {
    // OPS telemetry is best-effort and must not block queue processing.
  }

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
exports._internals = { scanEligibleJobs };
exports.planExecutionDispatch = planExecutionDispatch;
exports.queueExecutionDispatch = queueExecutionDispatch;
exports.runExecutionDirectLocal = runExecutionDirectLocal;
exports.queueSingleStepDispatch = queueSingleStepDispatch;
exports.settleExecutionIfComplete = settleExecutionIfComplete;

// Read only public connection metadata from the dispatched, project-bound run.
exports.getExecutionLiveSessions = async (execution) => {
  if (execution?.status !== "running") return [];
  const rows = await obsDb.prepare(`SELECT related_id AS engine_run_id, metadata->>'live_view_url' AS url, metadata->>'active_web_engine' AS provider,
      metadata->>'test_case_id' AS test_case_id, metadata->>'data_set_iteration_index' AS data_set_iteration_index,
      metadata->>'data_set_iteration_key' AS data_set_iteration_key
    FROM workspace_transactions WHERE project_id = ? AND action = 'testengine_run'
      AND metadata->>'execution_id' = ? AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 5000`).all(execution.project_id, execution.id);
  return rows.flatMap(row => {
    try {
      if (!row.test_case_id || !row.engine_run_id) return [];
      const url = new URL(row.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
      if (["host.docker.internal", "testengine", "testengine-gateway"].includes(url.hostname)) url.hostname = "localhost";
      // A shared VNC desktop cannot identify an individual test case. Publish
      // only the engine's run-scoped viewer for case execution.
      if (url.pathname !== "/api/v1/live-session") return [];
      url.searchParams.set("provider", row.provider === "selenium" ? "selenium" : "playwright");
      url.searchParams.set("run_id", row.engine_run_id);
      const iterationIndex = row.data_set_iteration_index == null ? null : Number(row.data_set_iteration_index);
      return [{ engine_run_id: row.engine_run_id, test_case_id: row.test_case_id,
        data_set_iteration_index: Number.isInteger(iterationIndex) && iterationIndex >= 0 ? iterationIndex : null,
        data_set_iteration_key: row.data_set_iteration_key || null,
        provider: row.provider || "playwright", url: url.toString() }];
    } catch { return []; }
  });
};
