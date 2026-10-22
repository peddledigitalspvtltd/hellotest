const { readBoundedResponseJson } = require("@hellotest/platform/backend/src/utils/boundedResponse");
const { redactSharedStepData, regenerateSharedStepData } = require("./sharedStepDataSnapshot.service");
const { snapshotExecutionHooks, redactExecutionHooks, regenerateExecutionHooks } = require("./executionHookSnapshots.service");
const { normalizeDataOptions, dataOptionsForCase, composeScopedTestData, sharedParameterNames } = require("@hellotest/platform/backend/src/utils/scopedTestData");
const { preserveFrozenRunParameters, normalizeFrozenCapturedValues } = require("@hellotest/platform/backend/src/utils/frozenRunParameterCompatibility");
const { expandSuiteSelection, loadSuiteContexts } = require("./suiteExecutionContext.service");
const db = require("@hellotest/platform/backend/src/db");
const { resilientHttpRequest } = require("@hellotest/platform/backend/src/utils/resilientHttpClient");
const { randomUUID: uuid } = require("crypto");
const { sanitizeVariablesForRead } = require("@hellotest/platform/backend/src/utils/contextVariables");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const testEngineDispatchService = require("@hellotest/automation/backend/services/testEngineDispatch.service");
const executionResultService = require("./executionResult.service");
const apiRequestExecutionService = require("@hellotest/automation/backend/services/apiRequestExecution.service");
const executionStepRuntimeService = require("@hellotest/platform/backend/src/domain/executionStepEvidence");
const opsTelemetryService = require("@hellotest/trace/backend/services/opsTelemetry.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const { normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const { materializeDataSetSnapshot, materializeParameterValues, materializeVariableSnapshot, freezeReferencedParameterGenerators } = require("@hellotest/platform/backend/src/utils/testDataGenerators");
const { resolveParameterLayers, collectPriorParameterCaptures, matchesParameterIteration, normalizeParameterKey } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { configurationTargetsForRead } = require("@hellotest/platform/backend/src/utils/configurationTargets");
const { assertExpectedRevision } = require("@hellotest/platform/backend/src/utils/revision");
const { groupRows, placeholdersFor, uniqueIds } = require("@hellotest/platform/backend/src/utils/batchHydration");
const { normalizeExecutionDates, formatStoredRunDate } = require("@hellotest/platform/backend/src/utils/executionDates");
const { redactTestDataSetRows } = require("./testDataSet.service");
const { getExecutionResultDurationMs } = require("@hellotest/platform/backend/src/utils/executionCaseLifecycle");

const runError = (message, code = "INVALID_RUN_EDIT", statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const validateRunDeliveryRelations = async (projectId, input) => {
  for (const [field, table, label] of [['release_id', 'requirement_releases', 'Release'], ['iteration_id', 'requirement_iterations', 'Sprint']]) {
    const id = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!id) continue;
    const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND project_id = ?`).get(id, projectId);
    if (!row) throw runError(`${label} does not belong to the selected project.`, 'INVALID_RUN_DELIVERY_SCOPE');
  }
};
const assertRunEditable = (execution) => {
  if (!["queued", "running", "retrying"].includes(execution.status) || execution.ended_at) {
    throw runError("Finished runs cannot be edited. Create a rerun to change the run setup.", "RUN_FINISHED", 409);
  }
};
const resolveExecutionStartMode = (execution, requestedMode) => ["local", "remote"].includes(requestedMode)
  ? requestedMode : execution.trigger === "local" ? "local" : execution.trigger === "ci" ? "remote" : "manual";

// Count cases once, reducing the newest result for each data iteration before
// reducing a case. Defect references remain actual links, never failed counts.
const summarizeExecutionMetrics = (caseRows = [], resultRows = [], storyRows = []) => {
  const cases = new Set(caseRows.map((row) => row.test_case_id));
  const iterations = new Map();
  const defects = new Set();
  const covered=new Set(resultRows.filter(row=>row.derived&&row.covers_entire_case).map(row=>`${row.execution_id}:${row.test_case_id}`));
  for (const result of resultRows) {
    if(!result.derived&&result.status==="pending"&&covered.has(`${result.execution_id}:${result.test_case_id}`))continue;
    cases.add(result.test_case_id);
    for (const ref of [...normalizeStoredReferenceList(result.defects), ...normalizeStoredReferenceList(result.case_defects),
      ...Object.values(parseJsonValue(result.step_defects, {})).flatMap(normalizeStoredReferenceList)]) defects.add(ref);
    const key = `${result.test_case_id}:${result.data_set_iteration_index ?? result.data_set_iteration_key ?? "default"}`;
    const previous = iterations.get(key);
    const timestamp = Number(new Date(result.created_at || 0));
    const previousTimestamp = Number(new Date(previous?.created_at || 0));
    if (!previous || timestamp > previousTimestamp
      || timestamp === previousTimestamp && String(result.id) > String(previous.id)) iterations.set(key, result);
  }
  const statuses = new Map();
  const iterationCounts = new Map();
  const priority = { passed: 1, skipped: 2, pending: 3, paused: 4, running: 5, aborted: 6, blocked: 7, failed: 8 };
  for (const result of iterations.values()) {
    iterationCounts.set(result.test_case_id, (iterationCounts.get(result.test_case_id) || 0) + 1);
    if ((priority[result.status] || 0) > (priority[statuses.get(result.test_case_id)] || 0)) statuses.set(result.test_case_id, result.status);
  }
  for (const row of caseRows) {
    const dataSet = parseJsonValue(row.test_data_set_snapshot, {});
    const expected = row.expected_iterations || (dataSet?.mode === "key_value" ? 1 : dataSet?.rows?.length || 1);
    const completed = covered.has(`${row.execution_id}:${row.test_case_id}`) ? expected : iterationCounts.get(row.test_case_id) || 0;
    if (["passed", "skipped"].includes(statuses.get(row.test_case_id)) && completed < expected) statuses.delete(row.test_case_id);
  }
  const summary = { total_cases: cases.size, passed_cases: 0, failed_cases: 0, blocked_cases: 0, running_cases: 0, pending_cases: 0, paused_cases: 0, aborted_cases: 0, skipped_cases: 0,
    duration_ms: resultRows.reduce((total, result) => total + getExecutionResultDurationMs(result), 0),
    defect_count: defects.size, story_count: 0, failed_story_count: 0 };
  for (const caseId of cases) summary[`${statuses.get(caseId) || "pending"}_cases`]++;
  const stories = new Set();
  const failedStories = new Set();
  for (const row of storyRows) if (cases.has(row.test_case_id)) {
    stories.add(row.requirement_id);
    if (statuses.get(row.test_case_id) === "failed") failedStories.add(row.requirement_id);
  }
  summary.story_count = stories.size;
  summary.failed_story_count = failedStories.size;
  return summary;
};

async function loadExecutionMetrics(executionIds) {
  if (!executionIds.length) return new Map();
  const placeholders = placeholdersFor(executionIds);
  const [caseRows, resultRows, storyRows] = await Promise.all([
    db.prepare(`SELECT execution_id, test_case_id,
      CASE WHEN test_data_set_snapshot->>'mode' = 'key_value' OR jsonb_typeof(test_data_set_snapshot->'rows') IS DISTINCT FROM 'array'
        THEN 1 ELSE GREATEST(1, jsonb_array_length(test_data_set_snapshot->'rows')) END AS expected_iterations
      FROM execution_case_snapshots WHERE execution_id IN (${placeholders})`).all(...executionIds),
    db.prepare(`SELECT id, execution_id, test_case_id, status, defects, case_defects, step_defects,derived,covers_entire_case,
      data_set_iteration_index, data_set_iteration_key, created_at, duration_ms, timer_started_at FROM test_case_effective_results result
      WHERE execution_id IN (${placeholders}) AND (NOT derived OR EXISTS(SELECT 1 FROM execution_case_snapshots selected WHERE selected.execution_id=result.execution_id AND selected.test_case_id=result.test_case_id))`).all(...executionIds),
    db.prepare(`WITH run_cases AS (
        SELECT execution_id, test_case_id FROM execution_case_snapshots WHERE execution_id IN (${placeholders})
        UNION SELECT execution_id, test_case_id FROM execution_results WHERE execution_id IN (${placeholders})
      ), scoped_cases AS (SELECT DISTINCT test_case_id FROM run_cases), story_links AS (
        SELECT mapping.test_case_id, mapping.requirement_id FROM requirement_test_cases mapping
        JOIN scoped_cases ON scoped_cases.test_case_id = mapping.test_case_id
        UNION SELECT test_cases.id AS test_case_id, test_cases.requirement_id FROM test_cases
        JOIN scoped_cases ON scoped_cases.test_case_id = test_cases.id WHERE test_cases.requirement_id IS NOT NULL
      ) SELECT DISTINCT run_cases.execution_id, run_cases.test_case_id, story_links.requirement_id
      FROM run_cases JOIN executions ON executions.id = run_cases.execution_id
      JOIN story_links ON story_links.test_case_id = run_cases.test_case_id
      JOIN requirements ON requirements.id = story_links.requirement_id AND requirements.project_id = executions.project_id
    `).all(...executionIds, ...executionIds)
  ]);
  const cases = groupRows(caseRows, "execution_id"), results = groupRows(resultRows, "execution_id"), stories = groupRows(storyRows, "execution_id");
  return new Map(executionIds.map((id) => [id, summarizeExecutionMetrics(cases.get(id), results.get(id), stories.get(id))]));
}

const getCaseSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, test_case_title, test_case_description, external_references, suite_id, suite_name, module_id, module_name, priority, status, parameter_values, parameter_template_values, test_data_options, execution_hooks, suite_parameter_values, suite_parameter_template_values, test_data_set_id, test_data_set_name, test_data_set_snapshot, data_set_source, sort_order, assigned_to, assigned_to_ids, assignment_source
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const getStepSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, snapshot_step_id, step_order, action, expected_result, step_type, automation_code, api_request, group_id, group_name, group_kind, reusable_group_id, shared_parameter_values, shared_parameter_template_values, shared_parameter_sensitive_names
  FROM execution_step_snapshots
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, step_order ASC
`);

const getResultsForExecution = db.prepare(`
  SELECT id, test_case_id, status, created_at, data_set_iteration_index, data_set_iteration_key
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY created_at DESC NULLS LAST, id DESC
`);

const getResultLogsForExecution = db.prepare(`
  SELECT test_case_id, logs, created_at, id, test_data_set_id, data_set_iteration_index
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY created_at ASC, id ASC
`);

const insertExecutionSuite = db.prepare(`
  INSERT INTO execution_suites (execution_id, suite_id, suite_name)
  VALUES (?, ?, ?)
`);

const validateSuite = db.prepare(`
  SELECT id, app_type_id, name
  FROM test_suites
  WHERE id = ?
`);

const selectCasesForSuite = db.prepare(`
  SELECT
    test_cases.id AS test_case_id,
    test_cases.title AS test_case_title,
    test_cases.description AS test_case_description,
    test_cases.external_references,
    test_cases.parameter_values,
    test_cases.test_data_options,
    test_cases.execution_hooks,
    test_cases.automated,
    test_suites.parameter_values AS suite_parameter_values,
    test_case_modules.id AS module_id,
    test_case_modules.name AS module_name,
    test_cases.priority,
    test_cases.status,
    suite_test_cases.sort_order
  FROM suite_test_cases
  JOIN test_cases ON test_cases.id = suite_test_cases.test_case_id
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  LEFT JOIN LATERAL (
    SELECT membership.module_id FROM test_case_effective_module_cases membership
    WHERE membership.test_case_id = test_cases.id
    ORDER BY membership.is_explicit DESC, membership.sort_order, membership.module_id LIMIT 1
  ) case_module ON TRUE
  LEFT JOIN test_case_modules ON test_case_modules.id = case_module.module_id
  WHERE suite_test_cases.suite_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_cases.created_at DESC
`);

const selectCaseForExecution = db.prepare(`
  SELECT
    test_cases.id AS test_case_id,
    test_cases.app_type_id,
    test_cases.title AS test_case_title,
    test_cases.description AS test_case_description,
    test_cases.external_references,
    test_cases.parameter_values,
    test_cases.test_data_options,
    test_cases.execution_hooks,
    test_cases.automated,
    test_cases.priority,
    test_cases.status,
    test_case_modules.id AS module_id,
    test_case_modules.name AS module_name
  FROM test_cases
  LEFT JOIN LATERAL (
    SELECT membership.module_id FROM test_case_effective_module_cases membership
    WHERE membership.test_case_id = test_cases.id
    ORDER BY membership.is_explicit DESC, membership.sort_order, membership.module_id LIMIT 1
  ) case_module ON TRUE
  LEFT JOIN test_case_modules ON test_case_modules.id = case_module.module_id
  WHERE test_cases.id = ?
`);

const selectPrimarySuiteForCaseExecution = db.prepare(`
  SELECT
    test_suites.id AS suite_id,
    test_suites.name AS suite_name,
    test_suites.parameter_values AS suite_parameter_values
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.test_case_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_suites.created_at DESC
  LIMIT 1
`);

const selectTestEnvironment = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, base_url, browser, notes, variables
  FROM test_environments
  WHERE id = ?
`);

const selectTestConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, targets, variables
  FROM test_configurations
  WHERE id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, mode, columns, rows
  FROM test_data_sets
  WHERE id = ?
`);

const selectExecutionAssignee = db.prepare(`
  SELECT id, email, name, avatar_data_url
  FROM users
  WHERE id = ?
`);

const selectExecutionRecord = db.prepare(`
  SELECT *
  FROM executions
  WHERE id = ?
`);

const selectExecutionBySourceIdempotency = db.prepare(`
  SELECT id, status
  FROM executions
  WHERE project_id = ? AND source_idempotency_key = ?
`);

const selectExecutionCaseSnapshot = db.prepare(`
  SELECT execution_id, test_case_id, suite_id, module_id, assigned_to, assigned_to_ids, assignment_source
  FROM execution_case_snapshots
  WHERE execution_id = ? AND test_case_id = ?
`);

const updateExecutionAssignment = db.prepare(`
  UPDATE executions
  SET assigned_to = ?, assigned_to_ids = ?
  WHERE id = ?
`);

const updateExecutionCaseAssignment = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = ?, assigned_to_ids = ?, assignment_source = ?
  WHERE execution_id = ? AND test_case_id = ?
`);

const assignExecutionOwnershipIfMissing = db.prepare(`
  UPDATE executions
  SET assigned_to = COALESCE(assigned_to, ?)
  WHERE id = ?
`);

const assignExecutionCaseOwnershipIfMissing = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = COALESCE(assigned_to, ?)
  WHERE execution_id = ?
`);

const selectProjectMember = db.prepare(`
  SELECT id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

function parseJsonValue(value, fallback) {
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
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeTextList(values = []) {
  const input = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const normalized = [];

  input.forEach((value) => {
    const text = normalizeText(value);
    if (text && !seen.has(text)) {
      seen.add(text);
      normalized.push(text);
    }
  });

  return normalized;
}

function normalizeAssignmentMap(value) {
  const parsed = parseJsonValue(value, {});
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return {};
  }

  return Object.entries(parsed).reduce((result, [scopeId, userIds]) => {
    const normalizedScopeId = normalizeText(scopeId);
    const normalizedUserIds = normalizeTextList(userIds);
    if (normalizedScopeId && normalizedUserIds.length) {
      result[normalizedScopeId] = normalizedUserIds;
    }
    return result;
  }, {});
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeParallelCount(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Math.max(1, Math.min(50, Number.isFinite(parsed) ? parsed : fallback));
}

function normalizeLocalEngineBaseUrl(value) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    return null;
  }

  const parsed = new URL(normalized);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Local execution engine URL must use http or https.");
  }

  if(parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/")throw new Error("Use the configured local runner base URL without credentials, a path, query or fragment.");
  const approved=new Set(["http://localhost:4313","http://127.0.0.1:4313","http://host.docker.internal:4313","http://[::1]:4313","http://localhost:4311","http://127.0.0.1:4311","http://host.docker.internal:4311","http://[::1]:4311"]);
  if(process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL){try{approved.add(new URL(process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL).origin);}catch{}}
  if(!approved.has(parsed.origin))throw Object.assign(new Error("Use the configured host Playwright runner. Additional local endpoints must be configured by an administrator."),{statusCode:400,code:"LOCAL_AGENT_TARGET_INVALID"});

  return parsed.toString().replace(/\/+$/, "");
}

async function inspectLocalEngine(baseUrl) {
  try {
    const response = await resilientHttpRequest(`${baseUrl}/health`, {
      method: "GET", redirect: "error"
    }, {
      dependency: "local-execution-engine",
      operation: "health.probe",
      deadlineMs: 900,
      maxAttempts: 1,
      maxResponseBytes: 256 * 1024,
      maxConcurrent: 8,
      failureThreshold: 10,
      resetTimeoutMs: 5_000
    });
    const health = await readBoundedResponseJson(response, {maxBytes:256 * 1024,label:"Local Playwright health"});
    const supportsExecution = health?.supported_web_engines?.includes("playwright") === true
      && health?.capabilities?.local_execution !== false;
    return {
      ready: response.ok && supportsExecution && health?.ready !== false,
      inspectionOnly: response.ok && (health?.service === "hellotest-inspection-agent" || health?.capabilities?.local_execution === false),
      notReady: response.ok && supportsExecution && health?.ready === false
    };
  } catch {
    return { ready: false };
  }
}

async function resolveLocalEngineBaseUrl(preferredUrl) {
  const localOrigins = new Set(["http://localhost:4313", "http://127.0.0.1:4313", "http://host.docker.internal:4313", "http://[::1]:4313", "http://localhost:4311", "http://127.0.0.1:4311", "http://host.docker.internal:4311", "http://[::1]:4311"]);
  const selected = preferredUrl || process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;
  const selectedUrl = selected ? normalizeLocalEngineBaseUrl(selected) : null;
  // A configured remote runner must never silently fall back to a different host.
  const candidates = (selectedUrl && !localOrigins.has(new URL(selectedUrl).origin) ? [selectedUrl] : [
    preferredUrl,
    process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL,
    "http://host.docker.internal:4313",
    "http://127.0.0.1:4313",
    "http://localhost:4313",
    "http://host.docker.internal:4311",
    "http://127.0.0.1:4311",
    "http://localhost:4311"
  ]).filter(value => { if (!value) return false; try { return !['testengine','testengine-gateway'].includes(new URL(value).hostname) && new URL(value).port !== '4301'; } catch { return false; } });
  const normalizedCandidates = [];

  candidates.forEach((candidate) => {
    const normalized = normalizeLocalEngineBaseUrl(candidate);

    if (normalized && !normalizedCandidates.includes(normalized)) {
      normalizedCandidates.push(normalized);
    }
  });

  if (!normalizedCandidates.length) {
    throw new Error("Local execution engine URL is not configured.");
  }

  const probes = [];
  for (const candidate of normalizedCandidates) {
    const probe = await inspectLocalEngine(candidate);
    probes.push(probe);
    if (probe.ready) {
      return candidate;
    }
  }

  const code = probes.some(probe => probe.notReady) ? "LOCAL_AGENT_NOT_READY"
    : probes.some(probe => probe.inspectionOnly) ? "LOCAL_AGENT_INSPECTION_ONLY" : "LOCAL_AGENT_UNAVAILABLE";
  const message = code === "LOCAL_AGENT_NOT_READY"
    ? "The local Playwright runner is starting or needs attention. Check its terminal or local-run/artifacts/host-recorder/launcher.log, and ensure its shared secret matches the HelloTest API. Check the runner connection before retrying."
    : code === "LOCAL_AGENT_INSPECTION_ONLY"
      ? "The browser inspection agent is connected, but local execution requires the full Playwright runner. Start ./local-run/bin/start-host-recorder.sh (Windows: local-run\\bin\\start-host-recorder.cmd) from your HelloTest folder, then check the local runner connection."
      : "The HelloTest API cannot reach the local Playwright runner. Start ./local-run/bin/start-host-recorder.sh (Windows: local-run\\bin\\start-host-recorder.cmd) from your HelloTest folder, then check the local runner connection. Hosted HelloTest requires an administrator-configured runner address reachable from its API.";
  // Explicitly public setup guidance must survive the global 5xx error policy.
  throw Object.assign(new Error(message), { statusCode: 503, code, publicMessage: message });
}

function normalizeParameterValues(values = {}) {
  const parsed = parseJsonValue(values, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.entries(parsed).reduce((next, [key, value]) => {
    const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
}

function resolveExecutionCaseDataSet(execution, caseSnapshot) {
  const caseSnapshotDataSet = parseJsonValue(caseSnapshot?.test_data_set_snapshot, null);

  if (caseSnapshotDataSet || caseSnapshot?.test_data_set_id) {
    return {
      id: caseSnapshot?.test_data_set_id || caseSnapshotDataSet?.id || null,
      name: caseSnapshot?.test_data_set_name || caseSnapshotDataSet?.name || null,
      snapshot: caseSnapshotDataSet,
      source: ["test_case", "suite"].includes(caseSnapshot?.data_set_source) ? caseSnapshot.data_set_source : "run"
    };
  }

  return execution?.test_data_set
    ? {
        ...execution.test_data_set,
        source: "run"
      }
    : null;
}

function resolveExecutionCaseDataSetIteration(execution, caseSnapshot, requestedIndex = null) {
  const dataSet = resolveExecutionCaseDataSet(execution, caseSnapshot);
  const hasRequestedIndex = requestedIndex !== null && requestedIndex !== undefined;

  if (!dataSet) {
    if (hasRequestedIndex) {
      throw Object.assign(new Error("This Test Case does not have a Data Set iteration"), { statusCode: 400 });
    }

    return {
      data_set: null,
      engine_iteration: null,
      result_metadata: {
        test_data_set_id: null,
        test_data_set_name: null,
        data_set_iteration_index: null,
        data_set_iteration_key: null,
        data_set_row_snapshot: null
      }
    };
  }

  const index = hasRequestedIndex ? requestedIndex : 0;
  if (!Number.isInteger(index) || index < 0) {
    throw Object.assign(new Error("Data Set iteration index must be a non-negative integer"), { statusCode: 400 });
  }

  const snapshot = dataSet.snapshot || {};
  const rows = Array.isArray(snapshot.rows)
    ? snapshot.rows
    : Array.isArray(snapshot.template_rows) ? snapshot.template_rows : [];
  const isKeyValue = snapshot.mode === "key_value";
  const total = isKeyValue ? 1 : Math.max(1, rows.length);

  if (index >= total) {
    throw Object.assign(new Error(`Data Set iteration ${index + 1} is outside the frozen ${total}-row snapshot`), { statusCode: 400 });
  }

  const dataSetId = dataSet.id || snapshot.id || null;
  const dataSetName = dataSet.name || snapshot.name || null;
  const key = `${dataSetId || "data-set"}:${index + 1}`;
  const tableRow = !isKeyValue && rows[index] && typeof rows[index] === "object" && !Array.isArray(rows[index])
    ? { ...rows[index] }
    : null;
  const rowSnapshot = isKeyValue
    ? Object.fromEntries(
        rows
          .map((row) => [String(row?.key || "").trim(), row?.value])
          .filter(([rowKey]) => Boolean(rowKey))
      )
    : tableRow;

  return {
    data_set: dataSet,
    engine_iteration: {
      index,
      key,
      total,
      row: tableRow
    },
    result_metadata: {
      test_data_set_id: dataSetId,
      test_data_set_name: dataSetName,
      data_set_iteration_index: index,
      data_set_iteration_key: key,
      data_set_row_snapshot: rowSnapshot
    }
  };
}

function buildExecutionRuntimeParameterValues(execution, caseSnapshot, capturedValues = {}, dataSetIterationIndex = null, stepSnapshot = null) {
  return resolveParameterLayers({
    sharedValues: stepSnapshot?.shared_parameter_values,
    dataPolicy: caseSnapshot?.test_data_options?.runtime_policy,
    isSharedStep: Boolean(stepSnapshot?.reusable_group_id || stepSnapshot?.group_kind === "reusable"),
    caseValues: normalizeParameterValues(caseSnapshot?.parameter_values),
    suiteValues: normalizeParameterValues(caseSnapshot?.suite_parameter_values),
    environmentVariables: execution?.test_environment?.snapshot?.variables,
    configurationVariables: execution?.test_configuration?.snapshot?.variables,
    runValues: normalizeParameterValues(execution?.parameter_values),
    dataSet: resolveExecutionCaseDataSet(execution, caseSnapshot)?.snapshot,
    rowIndex: Number.isInteger(dataSetIterationIndex) ? dataSetIterationIndex : 0,
    capturedValues: normalizeFrozenCapturedValues(capturedValues, execution?.parameter_scope_default)
  });
}

async function collectSuiteScopedCapturedValues(execution, caseSnapshot, currentTestCaseId, iteration = {}) {
  if (!execution?.id) return {};
  const capturesByCaseId = {};
  for (const row of await getResultLogsForExecution.all(execution.id)) {
    if (!matchesParameterIteration(row, iteration)) continue;
    capturesByCaseId[row.test_case_id] = normalizeFrozenCapturedValues(
      executionStepRuntimeService.extractCapturedValuesFromLogs(row.logs), execution.parameter_scope_default);
  }
  return collectPriorParameterCaptures(execution.case_snapshots || [], currentTestCaseId, capturesByCaseId);
}

function resolveExecutionCaseDurationMs(execution, existingResult) {
  return getExecutionResultDurationMs(existingResult);
}

function shapeAssignedUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    avatar_data_url: user.avatar_data_url || null
  };
}

function redactExecutionDataSetSnapshot(value, privateNames = []) {
  const snapshot = parseJsonValue(value, null);
  if (!snapshot) return null;
  const hidden = new Set([...(snapshot.sensitive_names || []), ...privateNames].map(name => normalizeParameterKey(name)));
  const redact = (rows, mode = snapshot.mode) => redactTestDataSetRows(mode, rows).map(row => mode === "key_value" ? hidden.has(normalizeParameterKey(row.key)) ? { ...row, value: '', is_secret: true, has_stored_value: Boolean(row.has_stored_value || row.value) } : row :
    Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(normalizeParameterKey(key)))));
  return { ...snapshot, ...(snapshot.parameter_data_layers ? { parameter_data_layers: Object.fromEntries(Object.entries(snapshot.parameter_data_layers).map(([name, layer]) => [name, layer ? { ...layer, rows: redact(layer.rows, "table"), template_rows: redact(layer.template_rows, "table") } : null])) } : {}), rows: redact(snapshot.rows),
    ...(snapshot.template_rows ? { template_rows: redact(snapshot.template_rows) } : {}),
    ...(snapshot.shared_rows ? { shared_rows: redact(snapshot.shared_rows, "table") } : {}),
    ...(snapshot.shared_template_rows ? { shared_template_rows: redact(snapshot.shared_template_rows, "table") } : {}) };
}

function attachExecutionContext(execution) {
  if (!execution) {
    return execution;
  }

  const environmentSnapshot = parseJsonValue(execution.test_environment_snapshot, null);
  const configurationSnapshot = parseJsonValue(execution.test_configuration_snapshot, null);
  const dataSetSnapshot = redactExecutionDataSetSnapshot(execution.test_data_set_snapshot);

  return {
    ...execution,
    execution_hooks: redactExecutionHooks(execution.execution_hooks),
    test_environment_snapshot: environmentSnapshot ? { ...environmentSnapshot, variables: sanitizeVariablesForRead(environmentSnapshot.variables), template_variables: sanitizeVariablesForRead(environmentSnapshot.template_variables) } : null,
    test_configuration_snapshot: configurationSnapshot ? { ...configurationSnapshot, variables: sanitizeVariablesForRead(configurationSnapshot.variables), template_variables: sanitizeVariablesForRead(configurationSnapshot.template_variables) } : null,
    test_data_set_snapshot: dataSetSnapshot,
    start_date: formatStoredRunDate(execution.start_date),
    end_date: formatStoredRunDate(execution.end_date),
    test_environment: execution.test_environment_name || environmentSnapshot
      ? {
          id: execution.test_environment_id || environmentSnapshot?.id || null,
          name: execution.test_environment_name || environmentSnapshot?.name || "Deleted environment",
          snapshot: environmentSnapshot
            ? {
                ...environmentSnapshot,
                variables: sanitizeVariablesForRead(environmentSnapshot.variables),
                template_variables: sanitizeVariablesForRead(environmentSnapshot.template_variables)
              }
            : null
        }
      : null,
    test_configuration: execution.test_configuration_name || configurationSnapshot
      ? {
          id: execution.test_configuration_id || configurationSnapshot?.id || null,
          name: execution.test_configuration_name || configurationSnapshot?.name || "Deleted configuration",
          snapshot: configurationSnapshot
            ? {
                ...configurationSnapshot,
                variables: sanitizeVariablesForRead(configurationSnapshot.variables),
                template_variables: sanitizeVariablesForRead(configurationSnapshot.template_variables)
              }
            : null
        }
      : null,
    test_data_set: execution.test_data_set_name || dataSetSnapshot
      ? {
          id: execution.test_data_set_id || dataSetSnapshot?.id || null,
          name: execution.test_data_set_name || dataSetSnapshot?.name || "Deleted data set",
          snapshot: dataSetSnapshot
        }
      : null
  };
}

// Internal execution paths need the stored secrets, while all public hydration
// remains redacted. Values come from this run's snapshot, never live resources.
async function loadExecutionRuntimeContext(execution) {
  const stored = await selectExecutionRecord.get(execution.id);
  if (!stored) return execution;
  const storedCases = (execution.case_snapshots || []).length
    ? await getCaseSnapshotsForExecution.all(execution.id) : [];
  return preserveFrozenRunParameters({
    ...execution,
    execution_hooks: parseJsonValue(stored.execution_hooks, []),
    test_environment: execution.test_environment ? { ...execution.test_environment, snapshot: parseJsonValue(stored.test_environment_snapshot, null) } : null,
    test_configuration: execution.test_configuration ? { ...execution.test_configuration, snapshot: parseJsonValue(stored.test_configuration_snapshot, null) } : null,
    test_data_set: execution.test_data_set ? { ...execution.test_data_set, snapshot: parseJsonValue(stored.test_data_set_snapshot, null) } : null,
    step_snapshots: await getStepSnapshotsForExecution.all(execution.id),
    case_snapshots: (execution.case_snapshots || []).map((snapshot) => {
      const raw = storedCases.find((item) => item.test_case_id === snapshot.test_case_id);
      return raw ? { ...snapshot, parameter_values: normalizeParameterValues(raw.parameter_values),
        parameter_template_values: normalizeParameterValues(raw.parameter_template_values || raw.parameter_values),
        suite_parameter_values: normalizeParameterValues(raw.suite_parameter_values),
        suite_parameter_template_values: normalizeParameterValues(raw.suite_parameter_template_values || raw.suite_parameter_values),
        execution_hooks: parseJsonValue(raw.execution_hooks, []),
        test_data_options: parseJsonValue(raw.test_data_options, {}), test_data_set_snapshot: parseJsonValue(raw.test_data_set_snapshot, null) } : snapshot;
    })
  });
}

async function hydrateExecutionScopes(executions) {
  const executionIds = uniqueIds(executions);
  if (!executionIds.length) {
    return executions;
  }

  const contextualExecutions = executions.map(attachExecutionContext);
  const userIds = [...new Set(contextualExecutions.flatMap((execution) => {
    const assignedToIds = normalizeTextList(parseJsonValue(execution.assigned_to_ids, []));
    const legacyAssignedTo = normalizeText(execution.assigned_to);
    return [...(assignedToIds.length ? assignedToIds : legacyAssignedTo ? [legacyAssignedTo] : []),
      ...Object.values(normalizeAssignmentMap(execution.suite_assignments)).flat(),
      ...Object.values(normalizeAssignmentMap(execution.module_assignments)).flat(),
      ...Object.values(normalizeAssignmentMap(execution.case_assignments)).flat()];
  }))];
  const [suiteRows, userRows, metrics] = await Promise.all([
    db.prepare(`
      SELECT execution_id, suite_id, suite_name
      FROM execution_suites
      WHERE execution_id IN (${placeholdersFor(executionIds)})
      ORDER BY execution_id ASC, suite_id ASC
    `).all(...executionIds),
    userIds.length
      ? db.prepare(`
          SELECT id, email, name, avatar_data_url
          FROM users
          WHERE id IN (${placeholdersFor(userIds)})
        `).all(...userIds)
      : Promise.resolve([]),
    loadExecutionMetrics(executionIds)
  ]);
  const suitesByExecution = groupRows(suiteRows, "execution_id");
  const usersById = new Map(userRows.map((user) => [user.id, shapeAssignedUser(user)]));

  return contextualExecutions.map((execution) => {
    const assignedToIds = normalizeTextList(parseJsonValue(execution.assigned_to_ids, []));
    const legacyAssignedTo = normalizeText(execution.assigned_to);
    const resolvedAssignedToIds = assignedToIds.length ? assignedToIds : legacyAssignedTo ? [legacyAssignedTo] : [];
    const assignedUsers = resolvedAssignedToIds.map((id) => usersById.get(id)).filter(Boolean);
    const executionSuites = suitesByExecution.get(execution.id) || [];

    return {
      ...execution,
      metrics: metrics.get(execution.id),
      duration_ms: metrics.get(execution.id)?.total_cases ? metrics.get(execution.id).duration_ms : Number(execution.duration_ms) || 0,
      run_mode: execution.trigger === "manual" ? "manual" : execution.trigger === "local" || execution.execution_mode === "local" ? "local" : "remote",
      direct_test_case_ids: execution.direct_test_case_ids == null ? undefined : normalizeTextList(parseJsonValue(execution.direct_test_case_ids, [])),
      assigned_to: resolvedAssignedToIds[0] || null,
      assigned_to_ids: resolvedAssignedToIds,
      suite_assignments: normalizeAssignmentMap(execution.suite_assignments),
      module_assignments: normalizeAssignmentMap(execution.module_assignments),
      case_assignments: normalizeAssignmentMap(execution.case_assignments),
      assigned_user: assignedUsers[0] || null,
      assigned_users: assignedUsers,
      suite_ids: executionSuites.map((row) => row.suite_id),
      suite_snapshots: executionSuites.map((row) => {
        const { assignedToIds: ids, source } = resolveScopeAssignment({ suite_id: row.suite_id }, execution);
        const users = ids.map(id => usersById.get(id)).filter(Boolean);
        return { id: row.suite_id, name: row.suite_name || "Deleted Suite", parameter_values: {}, assigned_to: ids[0] || null,
          assigned_to_ids: ids, assigned_user: users[0] || null, assigned_users: users, assignment_source: source };
      })
    };
  });
}

async function attachExecutionCaseAssignees(caseSnapshots) {
  if (!Array.isArray(caseSnapshots) || !caseSnapshots.length) {
    return [];
  }

  const userIds = [...new Set(caseSnapshots.flatMap((snapshot) => {
    const ids = normalizeTextList(parseJsonValue(snapshot.assigned_to_ids, []));
    return ids.length ? ids : snapshot.assigned_to ? [snapshot.assigned_to] : [];
  }))];
  const userRows = userIds.length
    ? await db.prepare(`
        SELECT id, email, name, avatar_data_url
        FROM users
        WHERE id IN (${placeholdersFor(userIds)})
      `).all(...userIds)
    : [];
  const assignedUsersById = Object.fromEntries(
    userRows.map((user) => [user.id, shapeAssignedUser(user)])
  );

  return caseSnapshots.map((snapshot) => {
    const assignedToIds = normalizeTextList(parseJsonValue(snapshot.assigned_to_ids, []));
    const resolvedIds = assignedToIds.length ? assignedToIds : snapshot.assigned_to ? [snapshot.assigned_to] : [];
    const assignedUsers = resolvedIds.map((id) => assignedUsersById[id]).filter(Boolean);
    const privateNames = new Set((parseJsonValue(snapshot.test_data_options, {})?.private_parameter_names || []).map(name => normalizeParameterKey(name, 't')));
    const privateValues = new Set(Object.entries(normalizeParameterValues(snapshot.parameter_values)).filter(([key]) => privateNames.has(normalizeParameterKey(key))).map(([, value]) => value).filter(Boolean));
    const publicParameters = values => Object.fromEntries(Object.entries(normalizeParameterValues(values)).filter(([key, value]) => value === '' || !privateNames.has(normalizeParameterKey(key)) && !privateValues.has(value)));
    return {
      ...snapshot,
      external_references: normalizeStoredReferenceList(snapshot.external_references),
      parameter_values: publicParameters(snapshot.parameter_values),
      parameter_template_values: publicParameters(snapshot.parameter_template_values || snapshot.parameter_values),
      suite_parameter_values: publicParameters(snapshot.suite_parameter_values),
      suite_parameter_template_values: publicParameters(snapshot.suite_parameter_template_values || snapshot.suite_parameter_values),
      test_data_set_id: normalizeText(snapshot.test_data_set_id),
      test_data_set_name: normalizeText(snapshot.test_data_set_name),
      test_data_set_snapshot: redactExecutionDataSetSnapshot(snapshot.test_data_set_snapshot, [...privateNames]),
      data_set_source: snapshot.data_set_source === "run" || snapshot.data_set_source === "suite" || snapshot.data_set_source === "test_case"
        ? snapshot.data_set_source
        : null,
      assigned_to: resolvedIds[0] || null,
      assigned_to_ids: resolvedIds,
      assignment_source: snapshot.assignment_source || (resolvedIds.length ? "run" : null),
      assigned_user: assignedUsers[0] || null,
      assigned_users: assignedUsers
    };
  });
}

async function validateExecutionAssignee(projectId, assignedTo) {
  if (!assignedTo) {
    return null;
  }

  const assignedUser = await selectExecutionAssignee.get(assignedTo);

  if (!assignedUser) {
    throw new Error("Assigned user not found");
  }

  const member = await selectProjectMember.get(projectId, assignedTo);

  if (!member) {
    throw new Error("Assigned user must be a member of the selected project");
  }

  return assignedUser;
}

async function validateExecutionAssignees(projectId, assignedToIds = []) {
  const normalizedIds = normalizeTextList(assignedToIds);

  for (const userId of normalizedIds) {
    await validateExecutionAssignee(projectId, userId);
  }

  return normalizedIds;
}

function resolveScopeAssignment(snapshot, execution) {
  const runAssignees = normalizeTextList(parseJsonValue(execution?.assigned_to_ids, []));
  if (!runAssignees.length && execution?.assigned_to) runAssignees.push(execution.assigned_to);
  const suiteAssignments = normalizeAssignmentMap(execution?.suite_assignments);
  const moduleAssignments = normalizeAssignmentMap(execution?.module_assignments);
  const caseAssignments = normalizeAssignmentMap(execution?.case_assignments);
  let assignedToIds = runAssignees;
  let source = runAssignees.length ? "run" : null;

  if (snapshot?.suite_id && suiteAssignments[snapshot.suite_id]) {
    assignedToIds = suiteAssignments[snapshot.suite_id];
    source = "suite";
  }
  if (snapshot?.module_id && moduleAssignments[snapshot.module_id]) {
    assignedToIds = moduleAssignments[snapshot.module_id];
    source = "module";
  }
  if (snapshot?.test_case_id && caseAssignments[snapshot.test_case_id]) {
    assignedToIds = caseAssignments[snapshot.test_case_id];
    source = "case";
  }

  return { assignedToIds, source };
}

async function recalculateExecutionScopeAssignments(executionId, executionRecord) {
  const execution = executionRecord || await selectExecutionRecord.get(executionId);
  if (!execution) throw new Error("Execution not found");

  const snapshots = await getCaseSnapshotsForExecution.all(executionId);

  for (const snapshot of snapshots) {
    const { assignedToIds, source } = resolveScopeAssignment(snapshot, execution);

    await updateExecutionCaseAssignment.run(
      assignedToIds[0] || null,
      assignedToIds,
      source,
      executionId,
      snapshot.test_case_id
    );
  }
}

async function updateExecutionScopeAssignment(executionId, level, scopeId, input = {}) {
  const transaction = db.transaction(async () => {
  const execution = await db.prepare(`SELECT * FROM executions WHERE id = ? FOR UPDATE`).get(executionId);
  if (!execution) throw new Error("Execution not found");
  assertRunEditable(execution);
  const currentRevision = assertExpectedRevision(execution.revision, input.expected_revision, "Run");

  const definitions = {
    suites: { property: "suite_assignments", snapshotField: "suite_id" },
    modules: { property: "module_assignments", snapshotField: "module_id" },
    cases: { property: "case_assignments", snapshotField: "test_case_id" }
  };
  const definition = definitions[level];
  if (!definition) throw new Error("Unsupported assignment scope");

  const normalizedScopeId = normalizeText(scopeId);
  const snapshots = await getCaseSnapshotsForExecution.all(executionId);
  if (!normalizedScopeId || !snapshots.some((snapshot) => snapshot[definition.snapshotField] === normalizedScopeId)) {
    throw new Error("Selected assignment scope is not part of this run snapshot");
  }

  const assignedToIds = await validateExecutionAssignees(
    execution.project_id,
    input.assigned_to_ids !== undefined ? input.assigned_to_ids : input.assigned_to
  );
  const assignments = normalizeAssignmentMap(execution[definition.property]);
  if (assignedToIds.length) assignments[normalizedScopeId] = assignedToIds;
  else delete assignments[normalizedScopeId];

  await db.prepare(`UPDATE executions SET ${definition.property} = ?, revision = ? WHERE id = ?`).run(assignments, currentRevision + 1, executionId);
  await recalculateExecutionScopeAssignments(executionId, { ...execution, [definition.property]: assignments, revision: currentRevision + 1 });
  executionCache.delete(executionId);
  return { updated: true, scope_id: normalizedScopeId, revision: currentRevision + 1 };
  });

  return transaction();
}

function resolveExecutionAssignee(assignedTo, createdBy) {
  return normalizeText(assignedTo) || normalizeText(createdBy) || null;
}

async function resolveExecutionAssigneesForCreate(projectId, assignedToIds = [], assignedTo, createdBy) {
  const explicitAssignees = normalizeTextList([...normalizeTextList(assignedToIds), assignedTo]);

  if (explicitAssignees.length) {
    return validateExecutionAssignees(projectId, explicitAssignees);
  }

  const creatorId = normalizeText(createdBy);

  if (!creatorId) {
    return [];
  }

  const creatorMembership = await selectProjectMember.get(projectId, creatorId);
  return creatorMembership ? [creatorId] : [];
}

async function resolveExecutionAssigneeForCreate(projectId, assignedTo, createdBy) {
  const assignees = await resolveExecutionAssigneesForCreate(projectId, [], assignedTo, createdBy);
  return assignees[0] || null;
}

async function resolveExecutionOwnershipCandidate(projectId, ...candidateIds) {
  for (const candidateId of candidateIds) {
    const normalizedCandidateId = normalizeText(candidateId);

    if (!normalizedCandidateId) {
      continue;
    }

    const membership = await selectProjectMember.get(projectId, normalizedCandidateId);

    if (membership) {
      return normalizedCandidateId;
    }
  }

  return null;
}

async function resolveExecutionContextResource({ id, label, projectId, appTypeId, lookup, snapshotBuilder }) {
  if (!id) {
    return null;
  }

  const resource = await lookup.get(id);

  if (!resource) {
    throw new Error(`${label} not found`);
  }

  if (resource.project_id !== projectId) {
    throw new Error(`${label} must belong to the selected project`);
  }

  if (resource.app_type_id && resource.app_type_id !== appTypeId) {
    throw new Error(`${label} must belong to the selected app type or be shared at project level`);
  }

  return {
    id: resource.id,
    name: resource.name,
    snapshot: label === "Test data set" ? snapshotBuilder(resource) : materializeVariableSnapshot(snapshotBuilder(resource))
  };
}

function buildExecutionDataSetSnapshot(resource) {
  if (!resource) {
    return null;
  }

  return materializeDataSetSnapshot({
    id: resource.id,
    name: resource.name,
    description: resource.description || null,
    mode: resource.mode,
    columns: parseJsonValue(resource.columns, []),
    rows: parseJsonValue(resource.rows, [])
  });
}

async function attachCaseDataSetSnapshots(caseSnapshots, executionDataSet = null, dataOptions, steps = [], scope = {}) {
  if (!Array.isArray(caseSnapshots) || !caseSnapshots.length) {
    return [];
  }

  const runOptions = normalizeDataOptions(dataOptions);
  const testCaseIds = [...new Set(caseSnapshots.map((snapshot) => normalizeText(snapshot.test_case_id)).filter(Boolean))];
  if (!testCaseIds.length) {
    return caseSnapshots;
  }

  const { loadEffectiveCaseDataSets, frozenCaseDataSet } = require('./effectiveCaseDataSets.service');
  const linkedDataSets = scope.preserveFrozen ? [] : await loadEffectiveCaseDataSets({ testCaseIds, projectId: scope.projectId, appTypeId: scope.appTypeId });
  const suiteContexts = await loadSuiteContexts(caseSnapshots.map(snapshot => snapshot.suite_id));
  const linkByCaseId = new Map();
  const materializedByDataSetId = new Map();

  linkedDataSets.forEach((dataSet) => {
    if (linkByCaseId.has(dataSet.test_case_id)) {
      return;
    }

    if (!materializedByDataSetId.has(dataSet.id)) {
      materializedByDataSetId.set(dataSet.id, buildExecutionDataSetSnapshot(dataSet));
    }

    linkByCaseId.set(dataSet.test_case_id, {
      id: dataSet.id,
      name: dataSet.name,
      snapshot: materializedByDataSetId.get(dataSet.id)
    });
  });

  const stepsByCase = new Map();
  for (const step of steps) {
    if (!stepsByCase.has(step.test_case_id)) stepsByCase.set(step.test_case_id, []);
    stepsByCase.get(step.test_case_id).push(step);
  }
  return caseSnapshots.map((snapshot) => {
    const caseOptions = normalizeDataOptions(snapshot.test_data_options, snapshot.test_data_options?.shared_data_kind
      || ((stepsByCase.get(snapshot.test_case_id) || []).some(step => step.automation_code || step.api_request) ? "sections" : "steps"));
    const suiteContext = suiteContexts.get(snapshot.suite_id);
    const suiteData = suiteContext?.dataSet;
    if (suiteData && !materializedByDataSetId.has(suiteData.id)) materializedByDataSetId.set(suiteData.id, buildExecutionDataSetSnapshot(suiteData));
    const effective = composeScopedTestData({ hierarchical: true, caseData: scope.preserveFrozen ? frozenCaseDataSet(snapshot) : linkByCaseId.get(snapshot.test_case_id)?.snapshot,
      caseOptions,
      suiteData: suiteData ? materializedByDataSetId.get(suiteData.id) : null,
      runData: executionDataSet?.snapshot, suiteOptions: suiteContext?.dataOptions, runOptions,
      sharedNames: sharedParameterNames(stepsByCase.get(snapshot.test_case_id) || []) });
    return { ...snapshot, test_data_options: { ...snapshot.test_data_options, shared_data_kind: caseOptions.shared_data_kind, runtime_policy: {
      version: 2, case: caseOptions, suite: dataOptionsForCase(suiteContext?.dataOptions, caseOptions), run: dataOptionsForCase(runOptions, caseOptions)
    } }, test_data_set_id: effective.snapshot?.id || null,
      test_data_set_name: effective.snapshot?.name || null,
      test_data_set_snapshot: effective.snapshot, data_set_source: effective.source };
  });
}

async function buildSnapshotPayload(executionId, suiteRows, options = {}) {
  const seenCaseIds = new Set();
  const caseSnapshots = [];
  const stepSnapshots = [];
  const materializedSuiteParameters = new Map();
  const suiteContexts = await loadSuiteContexts([...suiteRows.map(row => row.suite_id), ...(options.directCases || []).map(row => row.suite_id)]);
  const resolvedAssignedTo = normalizeText(options.assignedTo) || null;
  const resolvedAssignedToIds = normalizeTextList(options.assignedToIds || (resolvedAssignedTo ? [resolvedAssignedTo] : []));
  const casesBySuite = new Map();
  for (const suiteRow of suiteRows) {
    if (!casesBySuite.has(suiteRow.suite_id)) casesBySuite.set(suiteRow.suite_id, await selectCasesForSuite.all(suiteRow.suite_id));
  }
  const linkedParameters=await require('./linkedManualParameters.service').resolveForCases([...casesBySuite.values()].flat().concat(options.directCases||[]),{lock:options.persisted===true});
  const stepsByCase = await require("./executionSnapshot.repository").loadSteps([
    ...[...casesBySuite.values()].flat().map(row => row.test_case_id),
    ...(options.directCases || []).map(row => row.test_case_id)
  ]);
  let sortOrder = 0;

  for (const suiteRow of suiteRows) {
    const suiteCases = casesBySuite.get(suiteRow.suite_id);

    for (const suiteCase of suiteCases) {
      if (seenCaseIds.has(suiteCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(suiteCase.test_case_id);
      sortOrder += 1;
      const parameterTemplateValues = normalizeParameterValues(linkedParameters.get(suiteCase.test_case_id)?.effective_parameter_values||suiteCase.parameter_values);
      const suiteParameterTemplateValues = normalizeParameterValues(suiteContexts.get(suiteRow.suite_id)?.parameters || suiteCase.suite_parameter_values);
      const suiteParameterValues = materializedSuiteParameters.get(suiteRow.suite_id)
        || materializeParameterValues(suiteParameterTemplateValues);
      materializedSuiteParameters.set(suiteRow.suite_id, suiteParameterValues);

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: suiteCase.test_case_id,
        test_case_title: suiteCase.test_case_title,
        test_case_description: suiteCase.test_case_description,
        external_references: normalizeStoredReferenceList(suiteCase.external_references),
        suite_id: suiteRow.suite_id,
        suite_name: suiteRow.suite_name,
        module_id: suiteCase.module_id || null,
        module_name: suiteCase.module_name || null,
        priority: suiteCase.priority,
        status: suiteCase.status,
        parameter_values: materializeParameterValues(parameterTemplateValues),
        parameter_template_values: parameterTemplateValues,
        execution_hooks: await require("./caseExecutionHooks.service").snapshotCaseExecutionHooks(suiteCase.test_case_id, suiteCase.execution_hooks, {projectId:options.projectId,appTypeId:options.appTypeId,userId:options.userId}),
        test_data_options: require('@hellotest/platform/backend/src/utils/linkedManualParameters').effectiveLinkedDataOptions(suiteCase,linkedParameters.get(suiteCase.test_case_id)),
        suite_parameter_values: suiteParameterValues,
        suite_parameter_template_values: suiteParameterTemplateValues,
        sort_order: sortOrder,
        assigned_to: resolvedAssignedTo,
        assigned_to_ids: resolvedAssignedToIds,
        assignment_source: resolvedAssignedToIds.length ? "run" : null
      });

      const steps = stepsByCase.get(suiteCase.test_case_id) || [];
      Object.assign(caseSnapshots[caseSnapshots.length - 1], freezeReferencedParameterGenerators(caseSnapshots[caseSnapshots.length - 1], steps));

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: suiteCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${suiteCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id,
          shared_parameter_values: step.shared_parameter_values || {},
          shared_parameter_template_values: step.shared_parameter_template_values || {},
          shared_parameter_sensitive_names: step.shared_parameter_sensitive_names || []
        });
      }
    }
  }

  const directCases = Array.isArray(options.directCases) ? options.directCases : [];

  if (directCases.length) {
    for (const directCase of directCases) {
      if (seenCaseIds.has(directCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(directCase.test_case_id);
      sortOrder += 1;
      const parameterTemplateValues = normalizeParameterValues(linkedParameters.get(directCase.test_case_id)?.effective_parameter_values||directCase.parameter_values);
      const suiteParameterTemplateValues = normalizeParameterValues(suiteContexts.get(directCase.suite_id)?.parameters || directCase.suite_parameter_values);

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: directCase.test_case_id,
        test_case_title: directCase.test_case_title,
        test_case_description: directCase.test_case_description,
        external_references: normalizeStoredReferenceList(directCase.external_references),
        suite_id: directCase.suite_id || null,
        suite_name: directCase.suite_name || null,
        module_id: directCase.module_id || null,
        module_name: directCase.module_name || null,
        priority: directCase.priority,
        status: directCase.status,
        parameter_values: materializeParameterValues(parameterTemplateValues),
        parameter_template_values: parameterTemplateValues,
        execution_hooks: await require("./caseExecutionHooks.service").snapshotCaseExecutionHooks(directCase.test_case_id, directCase.execution_hooks, {projectId:options.projectId,appTypeId:options.appTypeId,userId:options.userId}),
        test_data_options: require('@hellotest/platform/backend/src/utils/linkedManualParameters').effectiveLinkedDataOptions(directCase,linkedParameters.get(directCase.test_case_id)),
        suite_parameter_values: materializeParameterValues(suiteParameterTemplateValues),
        suite_parameter_template_values: suiteParameterTemplateValues,
        sort_order: sortOrder,
        assigned_to: resolvedAssignedTo,
        assigned_to_ids: resolvedAssignedToIds,
        assignment_source: resolvedAssignedToIds.length ? "run" : null
      });

      const steps = stepsByCase.get(directCase.test_case_id) || [];
      Object.assign(caseSnapshots[caseSnapshots.length - 1], freezeReferencedParameterGenerators(caseSnapshots[caseSnapshots.length - 1], steps));

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: directCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${directCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id,
          shared_parameter_values: step.shared_parameter_values || {},
          shared_parameter_template_values: step.shared_parameter_template_values || {},
          shared_parameter_sensitive_names: step.shared_parameter_sensitive_names || []
        });
      }
    }
  }

  return {
    caseSnapshots: await attachCaseDataSetSnapshots(caseSnapshots, options.executionDataSet || null, options.testDataOptions, stepSnapshots, { projectId: options.projectId, appTypeId: options.appTypeId }),
    stepSnapshots
  };
}

// Hook sources use the same case, inherited dataset and suite policy snapshot as
// ordinary execution, without inheriting the main case's selected run dataset.
exports.freezeHookSourceData = async (sources, {projectId,appTypeId,userId} = {}) => {
  const directCases=[];
  for(const source of sources){
    const suite=await selectPrimarySuiteForCaseExecution.get(source.id);
    directCases.push({...source,test_case_id:source.id,test_case_title:source.title,execution_hooks:[],
      suite_id:suite?.suite_id || null,suite_name:suite?.suite_name || null,suite_parameter_values:suite?.suite_parameter_values || {}});
  }
  const frozen=await buildSnapshotPayload("hook-source-context",[],{directCases,persisted:true,projectId,appTypeId,userId});
  return new Map(frozen.caseSnapshots.map(snapshot=>{
    const data=snapshot.test_data_set_snapshot;
    if(data?.mode!=="key_value" && (data?.rows || []).length>1)throw Object.assign(new Error("A Before / After source has multiple test data rows. Link a single-row source dataset before running this hook; setup credentials cannot be selected implicitly."),{statusCode:422,code:"AUTOMATION_CASE_HOOK_DATA_ROWS_REVIEW_REQUIRED",nonRetryable:true});
    return [snapshot.test_case_id,{case_parameters:snapshot.parameter_values,case_parameter_templates:snapshot.parameter_template_values,
      suite_parameters:snapshot.suite_parameter_values,suite_parameter_templates:snapshot.suite_parameter_template_values,
      data_policy:snapshot.test_data_options?.runtime_policy,data_set:data || null}];
  }));
};

async function attachScope(execution) {
  if (!execution) {
    return execution;
  }
  return (await hydrateExecutionScopes([execution]))[0];
}

function mergeSuiteSnapshotsWithParameters(suiteSnapshots = [], caseSnapshots = []) {
  const suitesById = new Map(
    suiteSnapshots.map((suite) => [
      suite.id,
      {
        ...suite,
        parameter_values: normalizeParameterValues(suite.parameter_values)
      }
    ])
  );

  caseSnapshots.forEach((snapshot) => {
    if (!snapshot?.suite_id) {
      return;
    }

    const current = suitesById.get(snapshot.suite_id) || {
      id: snapshot.suite_id,
      name: snapshot.suite_name || "Deleted Suite",
      parameter_values: {}
    };

    if (!Object.keys(current.parameter_values || {}).length) {
      current.parameter_values = normalizeParameterValues(snapshot.suite_parameter_values);
    }

    suitesById.set(snapshot.suite_id, current);
  });

  return [...suitesById.values()];
}

async function attachDetailedScope(execution) {
  if (!execution) {
    return execution;
  }

  const hydrated = await attachScope(execution);
  const suiteRows = (hydrated.suite_snapshots || []).map((suite) => ({
    suite_id: suite.id,
    suite_name: suite.name
  }));
  const storedCaseSnapshots = await getCaseSnapshotsForExecution.all(execution.id);
  const storedStepSnapshots = await getStepSnapshotsForExecution.all(execution.id);
  const hydratedCaseSnapshots = await attachExecutionCaseAssignees(storedCaseSnapshots);
  const hydratedSuiteSnapshots = mergeSuiteSnapshotsWithParameters(hydrated.suite_snapshots || [], hydratedCaseSnapshots);
  const moduleScopes = [...new Map(storedCaseSnapshots.filter(snapshot => snapshot.module_id).map(snapshot => {
    const assignment = resolveScopeAssignment({ suite_id: snapshot.suite_id, module_id: snapshot.module_id }, hydrated);
    return [`${snapshot.suite_id || "direct"}:${snapshot.module_id}`, { id: snapshot.module_id, name: snapshot.module_name || "Module", suite_id: snapshot.suite_id || null,
      assigned_to: assignment.assignedToIds[0] || null, assigned_to_ids: assignment.assignedToIds, assignment_source: assignment.source }];
  })).values()];
  const moduleUserIds = [...new Set(moduleScopes.flatMap(scope => scope.assigned_to_ids))];
  const moduleUsers = moduleUserIds.length ? await db.prepare(`SELECT id, email, name, avatar_data_url FROM users WHERE id IN (${placeholdersFor(moduleUserIds)})`).all(...moduleUserIds) : [];
  const moduleUsersById = new Map(moduleUsers.map(user => [user.id, shapeAssignedUser(user)]));
  const hydratedModules = moduleScopes.map(scope => {
    const users = scope.assigned_to_ids.map(id => moduleUsersById.get(id)).filter(Boolean);
    return { ...scope, assigned_users: users, assigned_user: users[0] || null };
  });

  if (storedCaseSnapshots.length || storedStepSnapshots.length || !suiteRows.length) {
    return {
      ...hydrated,
      test_case_ids: hydratedCaseSnapshots.map((snapshot) => snapshot.test_case_id),
      direct_test_case_ids: hydrated.direct_test_case_ids ?? hydratedCaseSnapshots.filter((snapshot) => !suiteRows.some((suite) => suite.suite_id === snapshot.suite_id)).map((snapshot) => snapshot.test_case_id),
      suite_snapshots: hydratedSuiteSnapshots,
      module_snapshots: hydratedModules,
      case_snapshots: hydratedCaseSnapshots.map(snapshot => ({...snapshot,execution_hooks:redactExecutionHooks(snapshot.execution_hooks)})),
      step_snapshots: storedStepSnapshots.map(redactSharedStepData)
    };
  }

  const liveSnapshotPayload = await buildSnapshotPayload(
    execution.id,
    suiteRows.map((row) => ({
      suite_id: row.suite_id,
      suite_name: row.suite_name || "Deleted Suite"
    })),
    {
      assignedTo: hydrated.assigned_to || null,
      projectId: execution.project_id, appTypeId: execution.app_type_id, userId:execution.created_by,
      assignedToIds: hydrated.assigned_to_ids || [],
      executionDataSet: hydrated.test_data_set || null, testDataOptions: hydrated.test_data_options
    }
  );

  return {
    ...hydrated,
    test_case_ids: liveSnapshotPayload.caseSnapshots.map((snapshot) => snapshot.test_case_id),
    direct_test_case_ids: hydrated.direct_test_case_ids ?? [],
    suite_snapshots: mergeSuiteSnapshotsWithParameters(
      hydrated.suite_snapshots || [],
      liveSnapshotPayload.caseSnapshots
    ),
    case_snapshots: (await attachExecutionCaseAssignees(liveSnapshotPayload.caseSnapshots)).map(snapshot => ({...snapshot,execution_hooks:redactExecutionHooks(snapshot.execution_hooks)})),
    step_snapshots: liveSnapshotPayload.stepSnapshots.map(redactSharedStepData)
  };
}

const persistExecutionSnapshots = require("./executionSnapshot.repository").persist;

exports.createExecution = async ({
  project_id,
  app_type_id,
  suite_ids = [],
  test_case_ids = [],
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_data_options,
  execution_hooks = [],
  parallel_enabled = false,
  parallel_count = 1,
  execution_mode = "manual",
  engine_base_url,
  assigned_to,
  assigned_to_ids = [],
  release,
  sprint,
  release_id,
  iteration_id,
  build,
  name,
  start_date,
  end_date,
  created_by,
  trigger = "manual",
  initial_status = "queued",
  source_idempotency_key,
  expected_case_revisions
}) => {
  if (!project_id || !created_by) {
    throw new Error("Missing required fields");
  }

  const plannedDates = normalizeExecutionDates({ start_date, end_date });
  await validateRunDeliveryRelations(project_id, { release_id, iteration_id });

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const user = await db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(created_by);

  if (!user) throw new Error("Invalid user");

  const resolvedSourceIdempotencyKey = normalizeText(source_idempotency_key);
  if (resolvedSourceIdempotencyKey?.length > 255) {
    const error = new Error("Execution idempotency key must be 255 characters or fewer");
    error.statusCode = 400;
    throw error;
  }
  const requestedExecutionMode = normalizeText(execution_mode) === "local"
    ? "local"
    : normalizeText(execution_mode) === "remote"
      ? "remote"
      : "manual";
  const replayExistingExecution = async (existing) => {
    if (existing.status === "queued" && (requestedExecutionMode === "remote" || requestedExecutionMode === "local")) {
      try {
        await exports.startExecution(existing.id, {
          initiated_by: created_by,
          execution_mode: requestedExecutionMode,
          engine_base_url: engine_base_url || undefined
        });
      } catch (error) {
        const refreshed = await selectExecutionBySourceIdempotency.get(project_id, resolvedSourceIdempotencyKey);
        if (!refreshed || refreshed.status === "queued") throw error;
      }
    }
    const refreshed = await selectExecutionBySourceIdempotency.get(project_id, resolvedSourceIdempotencyKey);
    return {
      id: existing.id,
      idempotent_replay: true,
      status: refreshed?.status || existing.status
    };
  };
  if (resolvedSourceIdempotencyKey) {
    const existing = await selectExecutionBySourceIdempotency.get(project_id, resolvedSourceIdempotencyKey);
    if (existing) return replayExistingExecution(existing);
  }

  const resolvedAssignedToIds = await resolveExecutionAssigneesForCreate(project_id, assigned_to_ids, assigned_to, created_by);
  const resolvedAssignedTo = resolvedAssignedToIds[0] || null;

  if (app_type_id) {
    const appType = await db.prepare(`
      SELECT id, project_id FROM app_types WHERE id = ?
    `).get(app_type_id);

    if (!appType) throw new Error("App type not found");
    if (appType.project_id !== project_id) {
      throw new Error("App type must belong to the selected project");
    }
  }

  const selectedEnvironment = await resolveExecutionContextResource({
    id: test_environment_id,
    label: "Test environment",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestEnvironment,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      base_url: resource.base_url,
      browser: resource.browser,
      notes: resource.notes,
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedConfiguration = await resolveExecutionContextResource({
    id: test_configuration_id,
    label: "Test configuration",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestConfiguration,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      browser: resource.browser,
      mobile_os: resource.mobile_os,
      platform_version: resource.platform_version,
      targets: configurationTargetsForRead(resource.targets, resource),
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedDataSet = await resolveExecutionContextResource({
    id: test_data_set_id,
    label: "Test data set",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestDataSet,
    snapshotBuilder: buildExecutionDataSetSnapshot
  });

  const uniqueSuiteIds = await expandSuiteSelection(suite_ids, app_type_id);
  const uniqueTestCaseIds = [...new Set(test_case_ids)];
  if(expected_case_revisions!==undefined&&uniqueSuiteIds.length)throw runError('Reviewed source revisions require explicit Test Cases; suite expansion must be reviewed separately.','EXECUTION_PLAN_INVALID');

  if ((uniqueSuiteIds.length || uniqueTestCaseIds.length) && !app_type_id) {
    throw new Error("app_type_id is required when scope is provided");
  }

  const suiteRows = [];

  for (const suiteId of uniqueSuiteIds) {
    const suite = await validateSuite.get(suiteId);

    if (!suite) {
      throw new Error(`Suite not found: ${suiteId}`);
    }

    if (suite.app_type_id !== app_type_id) {
      throw new Error("All suites must belong to the selected app type");
    }

    suiteRows.push({
      suite_id: suite.id,
      suite_name: suite.name
    });
  }

  const directCaseRows = [];

  for (const testCaseId of uniqueTestCaseIds) {
    const testCase = await selectCaseForExecution.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (testCase.app_type_id !== app_type_id) {
      throw new Error("All test cases must belong to the selected app type");
    }

    let primarySuite = await selectPrimarySuiteForCaseExecution.get(testCaseId);
    if(!primarySuite && (trigger === "local" || execution_mode === "local")) {
      const suite=await require('./localRunSuite.service').ensure({projectId:project_id,appTypeId:app_type_id,testCaseId,createdBy:created_by});
      primarySuite={suite_id:suite.id,suite_name:suite.name,suite_parameter_values:{}};
    }
    directCaseRows.push({
      ...testCase,
      suite_id: primarySuite?.suite_id || null,
      suite_name: primarySuite?.suite_name || null,
      suite_parameter_values: primarySuite?.suite_parameter_values || {}
    });
  }

  await mobileFeatureService.assertExecutionMobileFeatureEnabled({
    project_id,
    app_type_id,
    suite_ids: uniqueSuiteIds,
    test_case_ids: uniqueTestCaseIds,
    test_configuration_id,
    test_configuration: selectedConfiguration
  });

  const id = uuid();
  const normalizedExecutionMode = normalizeText(execution_mode) === "local"
    ? "local"
    : normalizeText(execution_mode) === "remote"
      ? "remote"
      : "manual";
  const normalizedTrigger = normalizedExecutionMode === "local" || trigger === "local" ? "local" : trigger === "ci" ? "ci" : "manual";
  const normalizedInitialStatus = initial_status === "running" ? "running" : "queued";
  const normalizedParallelEnabled = normalizeBoolean(parallel_enabled);
  const normalizedParallelCount = normalizeParallelCount(parallel_count);
  const resolvedEngineBaseUrl = normalizedExecutionMode === "local"
    ? await resolveLocalEngineBaseUrl(engine_base_url)
    : null;

  const dataOptions = normalizeDataOptions(test_data_options);
  if (test_data_set_id && app_type_id) await require('./runParameterPlan.service').assertRunDataSetCompatible({ project_id, app_type_id, suite_ids: uniqueSuiteIds, test_case_ids: uniqueTestCaseIds, test_data_set_id, test_data_options: dataOptions });
  const transaction = db.transaction(async () => {
    if(expected_case_revisions!==undefined){
      await require('./executionPlanPreconditions.service').verify({projectId:project_id,appTypeId:app_type_id,caseIds:uniqueTestCaseIds,expected:expected_case_revisions,lock:true});
      // Initial scope validation happens before this transaction. Reload the
      // source facts under the same locks used for revision verification, so
      // persisted case and step snapshots describe the reviewed source state.
      for(let index=0;index<directCaseRows.length;index++)directCaseRows[index]={...directCaseRows[index],...await selectCaseForExecution.get(directCaseRows[index].test_case_id)};
    }
    const frozenExecutionHooks = await snapshotExecutionHooks(execution_hooks, { projectId: project_id, appTypeId: app_type_id, userId: created_by });
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        release,
        sprint,
        build,
        execution_hooks,
        direct_test_case_ids,
        source_idempotency_key,
        parallel_enabled,
        parallel_count,
        assigned_to,
        assigned_to_ids,
        start_date,
        end_date,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project_id,
      app_type_id || null,
      name || "Execution Run",
      normalizedTrigger,
      normalizedInitialStatus,
      selectedEnvironment?.id || null,
      selectedEnvironment?.name || null,
      selectedEnvironment?.snapshot || null,
      selectedConfiguration?.id || null,
      selectedConfiguration?.name || null,
      selectedConfiguration?.snapshot || null,
      selectedDataSet?.id || null,
      selectedDataSet?.name || null,
      selectedDataSet?.snapshot || null,
      normalizeText(release),
      normalizeText(sprint),
      normalizeText(build),
      frozenExecutionHooks,
      uniqueTestCaseIds,
      resolvedSourceIdempotencyKey,
      normalizedParallelEnabled,
      normalizedParallelCount,
      resolvedAssignedTo,
      resolvedAssignedToIds,
      plannedDates.start_date,
      plannedDates.end_date,
      created_by
    );

    await db.prepare("UPDATE executions SET parameter_scope_default = 'r', test_data_options = ? WHERE id = ?").run(dataOptions, id);
    if (release_id !== undefined || iteration_id !== undefined) {
      const fields = [], values = [];
      if (release_id !== undefined) { fields.push('release_id = ?'); values.push(normalizeText(release_id)); }
      if (iteration_id !== undefined) { fields.push('iteration_id = ?'); values.push(normalizeText(iteration_id)); }
      await db.prepare(`UPDATE executions SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
    }

    for (const suiteRow of suiteRows) {
      await insertExecutionSuite.run(id, suiteRow.suite_id, suiteRow.suite_name);
    }

    const receiptSuiteIds=new Set(suiteRows.map(s=>s.suite_id));
    for(const directCase of directCaseRows) {
      if(directCase.suite_id && !receiptSuiteIds.has(directCase.suite_id)) {
        await insertExecutionSuite.run(id,directCase.suite_id,directCase.suite_name);
        receiptSuiteIds.add(directCase.suite_id);
      }
    }
    const snapshotPayload = await buildSnapshotPayload(id, suiteRows, {
      persisted: true,
      projectId: project_id, appTypeId: app_type_id, userId:created_by,
      directCases: directCaseRows,
      assignedTo: resolvedAssignedTo,
      assignedToIds: resolvedAssignedToIds,
      executionDataSet: selectedDataSet, testDataOptions: dataOptions
    });

    await persistExecutionSnapshots(snapshotPayload);
  });

  try {
    await transaction();
  } catch (error) {
    if (error?.code !== "23505" || !resolvedSourceIdempotencyKey) throw error;
    const existing = await selectExecutionBySourceIdempotency.get(project_id, resolvedSourceIdempotencyKey);
    if (!existing) throw error;
    return replayExistingExecution(existing);
  }

  if (normalizedExecutionMode === "remote" || normalizedExecutionMode === "local") {
    await exports.startExecution(id, {
      initiated_by: created_by,
      execution_mode: normalizedExecutionMode,
      engine_base_url: resolvedEngineBaseUrl || undefined
    });
  }

  return { id, idempotent_replay: false };
};

exports.createLocalRun = async (input = {}) => {
  const localEngineBaseUrl = await resolveLocalEngineBaseUrl(input.engine_base_url);
  const created = await exports.createExecution({
    ...input,
    execution_mode: "manual",
    engine_base_url: localEngineBaseUrl,
    trigger: "local",
    initial_status: "running",
    name: input.name || "Local Run"
  });

  try {
    const result = await exports.startLocalExecution(created.id, {
      initiated_by: input.created_by,
      engine_base_url: localEngineBaseUrl
    });
    return {
      id: created.id,
      ...result
    };
  } catch (error) {
    if(error.code === "LOCAL_DISPATCH_UNCERTAIN")return {id:created.id,started:false,execution_mode:"local",engine_base_url:localEngineBaseUrl,acknowledgement:"unknown",warnings:[error.message]};
    await db.prepare(`
      UPDATE executions
      SET status = 'failed', ended_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(created.id);
    throw error;
  }
};

exports.getExecutions = async ({ project_id, app_type_id, status }) => {
  let query = `SELECT * FROM executions WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  const createdAtOrderedQuery = `${query} ORDER BY created_at DESC NULLS LAST, started_at DESC NULLS LAST, ended_at DESC NULLS LAST, id DESC`;
  const legacyOrderedQuery = `${query} ORDER BY started_at DESC NULLS LAST, ended_at DESC NULLS LAST, id DESC`;

  try {
    const rows = await db.prepare(createdAtOrderedQuery).all(...params);
    return hydrateExecutionScopes(rows);
  } catch (error) {
    if (error?.code !== "42703") {
      throw error;
    }

    const rows = await db.prepare(legacyOrderedQuery).all(...params);
    return hydrateExecutionScopes(rows);
  }
};

const { executionCache } = require("@hellotest/platform/backend/src/utils/executionCache");
exports.invalidateExecutionCache = (id) => executionCache.delete(id);
const CACHE_TTL_MS = Number(process.env.EXECUTION_CACHE_TTL_MS) || 2000;

exports.getExecution = async (id, forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = executionCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  let attempts = 0;
  while (attempts < 3) {
    try {
      const execution = await selectExecutionRecord.get(id);
      if (!execution) throw new Error("Execution not found");
      const detailedExecution = preserveFrozenRunParameters(await attachDetailedScope(execution));
      detailedExecution.live_sessions = await testEngineDispatchService.getExecutionLiveSessions(execution).catch(() => []);
      executionCache.set(id, { timestamp: Date.now(), data: detailedExecution });
      return detailedExecution;
    } catch (err) {
      if (err.message === "Execution not found") throw err;
      if (err.code === 'SQLITE_BUSY' || err.code === '40001' || (err.message && (err.message.includes('deadlock') || err.message.includes('locked')))) {
        attempts++;
        if (attempts >= 3) throw err;
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempts)));
      } else {
        throw err;
      }
    }
  }
};

exports.rerunExecution = async (id, { failed_only = false, created_by, name } = {}) => {
  if (!created_by) {
    throw new Error("created_by is required");
  }

  const sourceExecution = await loadExecutionRuntimeContext(await exports.getExecution(id));
  await mobileFeatureService.assertExecutionMobileFeatureEnabled(sourceExecution);
  const sourceCaseSnapshots = sourceExecution.case_snapshots || [];
  const sourceStepSnapshots = sourceExecution.step_snapshots || [];
  const sourceSuiteSnapshots = sourceExecution.suite_snapshots || [];

  if (!sourceCaseSnapshots.length) {
    throw new Error("This execution does not contain any snapped cases to rerun.");
  }

  let filteredCaseSnapshots = sourceCaseSnapshots;

  if (failed_only) {
    const executionResults = await getResultsForExecution.all(id);
    const latestIterations = new Map();
    for (const result of executionResults) {
      const key = `${result.test_case_id}:${result.data_set_iteration_index ?? result.data_set_iteration_key ?? "default"}`;
      if (!latestIterations.has(key)) latestIterations.set(key, result);
    }
    const failedCaseIds = new Set(
      [...latestIterations.values()]
        .filter((result) => result.status === "failed")
        .map((result) => result.test_case_id)
    );

    filteredCaseSnapshots = sourceCaseSnapshots.filter((snapshot) => failedCaseIds.has(snapshot.test_case_id));

    if (!filteredCaseSnapshots.length) {
      throw new Error("This execution does not have any failed cases to rerun.");
    }
  }

  const nextExecutionId = uuid();
  const allowedCaseIds = new Set(filteredCaseSnapshots.map((snapshot) => snapshot.test_case_id));
  const filteredSuiteSnapshots = sourceSuiteSnapshots.filter((suite) =>
    filteredCaseSnapshots.some((snapshot) => snapshot.suite_id === suite.id)
  );
  const filteredStepSnapshots = sourceStepSnapshots.filter((snapshot) => allowedCaseIds.has(snapshot.test_case_id));
  const rerunName =
    normalizeText(name) ||
    `${sourceExecution.name || "Execution Run"}${failed_only ? " Failed Rerun" : " Rerun"}`;
  const rerunAssignedTo = resolveExecutionAssignee(created_by, sourceExecution.assigned_to);
  const rerunDataSetSnapshot = materializeDataSetSnapshot(sourceExecution.test_data_set?.snapshot || null);
  const rerunLinkedDataSetSnapshots = new Map();
  const rerunSuiteParameters = new Map();

  await validateExecutionAssignee(sourceExecution.project_id, rerunAssignedTo);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        release,
        sprint,
        build,
        assigned_to,
        assigned_to_ids,
        suite_assignments,
        module_assignments,
        case_assignments,
        direct_test_case_ids,
        created_by
      )
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextExecutionId,
      sourceExecution.project_id,
      sourceExecution.app_type_id || null,
      rerunName,
      sourceExecution.test_environment?.id || null,
      sourceExecution.test_environment?.name || null,
      materializeVariableSnapshot(sourceExecution.test_environment?.snapshot || null),
      sourceExecution.test_configuration?.id || null,
      sourceExecution.test_configuration?.name || null,
      materializeVariableSnapshot(sourceExecution.test_configuration?.snapshot || null),
      sourceExecution.test_data_set?.id || null,
      sourceExecution.test_data_set?.name || null,
      rerunDataSetSnapshot,
      sourceExecution.release || null,
      sourceExecution.sprint || null,
      sourceExecution.build || null,
      rerunAssignedTo,
      normalizeTextList(sourceExecution.assigned_to_ids || [rerunAssignedTo]),
      normalizeAssignmentMap(sourceExecution.suite_assignments),
      normalizeAssignmentMap(sourceExecution.module_assignments),
      normalizeAssignmentMap(sourceExecution.case_assignments),
      normalizeTextList(sourceExecution.direct_test_case_ids).filter((caseId) => allowedCaseIds.has(caseId)),
      created_by
    );

    await db.prepare("UPDATE executions SET test_data_options = ? WHERE id = ?").run(normalizeDataOptions(sourceExecution.test_data_options), nextExecutionId);
    await db.prepare("UPDATE executions SET execution_hooks = ? WHERE id = ?").run(regenerateExecutionHooks(sourceExecution.execution_hooks), nextExecutionId);
    if (sourceExecution.release_id || sourceExecution.iteration_id) {
      await db.prepare('UPDATE executions SET release_id = ?, iteration_id = ? WHERE id = ?')
        .run(sourceExecution.release_id || null, sourceExecution.iteration_id || null, nextExecutionId);
    }

    for (const suite of filteredSuiteSnapshots) {
      await insertExecutionSuite.run(nextExecutionId, suite.id, suite.name || "Deleted Suite");
    }

    await db.prepare("UPDATE executions SET parameter_scope_default = ? WHERE id = ?").run(sourceExecution.parameter_scope_default || "r", nextExecutionId);

    const rerunCaseSnapshots = filteredCaseSnapshots.map((snapshot, index) => {
      const parameterTemplateValues = normalizeParameterValues(snapshot.parameter_template_values || snapshot.parameter_values);
      const suiteParameterTemplateValues = normalizeParameterValues(snapshot.suite_parameter_template_values || snapshot.suite_parameter_values);
      const suiteKey = snapshot.suite_id || `case:${snapshot.test_case_id}`;
      const suiteParameterValues = rerunSuiteParameters.get(suiteKey)
        || materializeParameterValues(suiteParameterTemplateValues);
      rerunSuiteParameters.set(suiteKey, suiteParameterValues);
      const sourceCaseDataSetSnapshot = parseJsonValue(snapshot.test_data_set_snapshot, null);
      const rerunDataSetSource = ["test_case", "suite"].includes(snapshot.data_set_source)
        ? snapshot.data_set_source
        : (rerunDataSetSnapshot || sourceCaseDataSetSnapshot) ? "run" : null;
      let rerunCaseDataSetSnapshot = sourceCaseDataSetSnapshot?.data_scope_policy ? materializeDataSetSnapshot(sourceCaseDataSetSnapshot) : rerunDataSetSource === "run"
        ? rerunDataSetSnapshot || materializeDataSetSnapshot(sourceCaseDataSetSnapshot)
        : null;

      if (sourceCaseDataSetSnapshot && (["test_case", "suite"].includes(rerunDataSetSource) || sourceCaseDataSetSnapshot.data_scope_policy?.version === 2)) {
        const dataSetKey = sourceCaseDataSetSnapshot.data_scope_policy ? `case:${snapshot.test_case_id}` : snapshot.test_data_set_id || sourceCaseDataSetSnapshot.id || `case:${snapshot.test_case_id}`;
        rerunCaseDataSetSnapshot = rerunLinkedDataSetSnapshots.get(dataSetKey)
          || materializeDataSetSnapshot(sourceCaseDataSetSnapshot);
        rerunLinkedDataSetSnapshots.set(dataSetKey, rerunCaseDataSetSnapshot);
      }

      return {
        ...snapshot,
        execution_id: nextExecutionId,
        module_id: snapshot.module_id || null,
        module_name: snapshot.module_name || null,
        parameter_values: materializeParameterValues(parameterTemplateValues),
        parameter_template_values: parameterTemplateValues,
        execution_hooks: regenerateExecutionHooks(snapshot.execution_hooks),
        suite_parameter_values: suiteParameterValues,
        suite_parameter_template_values: suiteParameterTemplateValues,
        test_data_set_id: snapshot.test_data_set_id || rerunCaseDataSetSnapshot?.id || sourceExecution.test_data_set?.id || null,
        test_data_set_name: snapshot.test_data_set_name || rerunCaseDataSetSnapshot?.name || sourceExecution.test_data_set?.name || null,
        test_data_set_snapshot: rerunCaseDataSetSnapshot,
        data_set_source: rerunDataSetSource,
        sort_order: index + 1,
        assigned_to: snapshot.assigned_to || rerunAssignedTo,
        assigned_to_ids: normalizeTextList(snapshot.assigned_to_ids || snapshot.assigned_to || sourceExecution.assigned_to_ids || [rerunAssignedTo]),
        assignment_source: snapshot.assignment_source || "run"
      };
    });
    await persistExecutionSnapshots({
      caseSnapshots: rerunCaseSnapshots,
      stepSnapshots: regenerateSharedStepData(filteredStepSnapshots).map(snapshot => ({ ...snapshot, execution_id: nextExecutionId, snapshot_step_id: uuid() }))
    });
  });

  await transaction();

  return { id: nextExecutionId };
};

exports.startExecution = async (id, options = {}) => {
  const execution = await loadExecutionRuntimeContext(await exports.getExecution(id));
  options = { ...options, execution_mode: resolveExecutionStartMode(execution, options.execution_mode) };
  await mobileFeatureService.assertExecutionMobileFeatureEnabled(execution);
  const currentRevision = assertExpectedRevision(execution.revision, options.expected_revision, "Run");
  const skipTestEngineDispatch = Boolean(options.skip_testengine_dispatch)
    || (execution.trigger === "manual" && options.execution_mode !== "local" && options.execution_mode !== "remote");

  if (execution.status !== "queued") {
    throw new Error("Only queued executions can be started");
  }

  const initiatedBy = await resolveExecutionOwnershipCandidate(
    execution.project_id,
    options.initiated_by,
    execution.assigned_to,
    execution.created_by
  );

  if (initiatedBy) {
    await assignExecutionOwnershipIfMissing.run(initiatedBy, id);
    await assignExecutionCaseOwnershipIfMissing.run(initiatedBy, id);
  }

  let dispatchPlan = null;
  let testEngineIntegration = null;
  let localEngineBaseUrl = null;
  let shouldMarkAsCi = false;

  if (!skipTestEngineDispatch) {
    dispatchPlan = await testEngineDispatchService.planExecutionDispatch(execution,options.execution_mode === "local" ? {allowIncompleteAutomation:true,allowApiCasesWithoutAutomation:true} : {});

    if (dispatchPlan.eligible_automated_case_count > 0) {
      testEngineIntegration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);
      localEngineBaseUrl = options.execution_mode === "local"
        ? await resolveLocalEngineBaseUrl(options.engine_base_url)
        : null;

      if (testEngineIntegration && localEngineBaseUrl) {
        testEngineIntegration = {
          ...testEngineIntegration,
          base_url: localEngineBaseUrl,
          config: {
            ...(testEngineIntegration.config || {}),
            execution_mode: "local",
            public_base_url: localEngineBaseUrl,
            live_view_url: `${localEngineBaseUrl}/api/v1/live-session?provider=playwright`
          }
        };
      }

      if (!testEngineIntegration && localEngineBaseUrl) {
        testEngineIntegration = {
          id: null,
          base_url: localEngineBaseUrl,
          config: {
            execution_mode: "local",
            active_web_engine: "playwright",
            headless: false,
            video_mode: "retain-on-failure",
            trace_mode: "retain-on-failure",
            public_base_url: localEngineBaseUrl,
            live_view_url: `${localEngineBaseUrl}/api/v1/live-session?provider=playwright`
          }
        };
      }

      if (!testEngineIntegration) {
        const canContinueManually = dispatchPlan.manual_case_count > 0 || dispatchPlan.unsupported_automated_case_count > 0;

        if (!canContinueManually) {
          throw Object.assign(new Error("Configure an active Test Engine integration for this project before starting automated runs."), { statusCode: 409 });
        }

        dispatchPlan.warnings = [
          ...(dispatchPlan.warnings || []),
          `${dispatchPlan.eligible_automated_case_count} automated case${dispatchPlan.eligible_automated_case_count === 1 ? "" : "s"} could not be handed off because no active Test Engine integration is configured. Manual step execution remains available.`
        ];
        dispatchPlan.unsupported_automated_case_count += dispatchPlan.eligible_automated_case_count;
        dispatchPlan.eligible_automated_case_count = 0;
        dispatchPlan.eligibleCases = [];
      }

      shouldMarkAsCi =
        dispatchPlan.eligible_automated_case_count > 0
        && dispatchPlan.manual_case_count === 0
        && dispatchPlan.unsupported_automated_case_count === 0;
    }
  }

  const startResult = await db.prepare(`
    UPDATE executions
    SET status = 'running', started_at = CURRENT_TIMESTAMP, trigger = ?, revision = ?
    WHERE id = ? AND status = 'queued' AND revision = ?
  `).run(shouldMarkAsCi ? "ci" : execution.trigger || "manual", currentRevision + 1, id, currentRevision);
  if (startResult.changes !== 1) {
    assertExpectedRevision(currentRevision + 1, currentRevision, "Run");
  }

  let dispatchSummary = {
    automated_case_count: 0,
    queued_for_engine_count: 0,
    manual_case_count: Array.isArray(execution.case_snapshots) ? execution.case_snapshots.length : 0,
    unsupported_automated_case_count: 0,
    warnings: []
  };

  if (!skipTestEngineDispatch && dispatchPlan) {
    try {
      dispatchSummary = options.execution_mode === "local"
        ? await testEngineDispatchService.runExecutionDirectLocal({
            plan: dispatchPlan,
            integration: testEngineIntegration,
            initiatedBy: options.initiated_by || null,
            engineBaseUrl: localEngineBaseUrl || options.engine_base_url
          })
        : await testEngineDispatchService.queueExecutionDispatch({
            plan: dispatchPlan,
            integration: testEngineIntegration,
            initiatedBy: options.initiated_by || null
          });
    } catch (error) {
      if(options.execution_mode === "local" && error.code !== "LOCAL_DISPATCH_UNCERTAIN") {
        await db.prepare("UPDATE executions SET status = 'failed', ended_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'").run(id);
        throw error;
      }
      dispatchSummary = {
        automated_case_count: dispatchPlan.automated_case_count,
        queued_for_engine_count: 0,
        manual_case_count: dispatchPlan.manual_case_count,
        unsupported_automated_case_count: dispatchPlan.unsupported_automated_case_count,
        warnings: [
          ...(dispatchPlan.warnings || []),
          error instanceof Error
            ? `HelloTest started the run, but could not queue automated handoff: ${error.message}`
            : "HelloTest started the run, but could not queue automated handoff."
        ]
      };
    }
  }

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "hellotest.execution.start",
      summary: "Execution started."
    });
  } catch {
    // OPS telemetry is best-effort and must not block execution start.
  }

  return {
    started: true,
    revision: currentRevision + 1,
    ...dispatchSummary
  };
};

exports.startLocalExecution = async (id, options = {}) => {
  const execution = await loadExecutionRuntimeContext(await exports.getExecution(id, true));

  if (execution.status !== "running") {
    throw new Error("Local runs must be created in running state");
  }

  const initiatedBy = await resolveExecutionOwnershipCandidate(
    execution.project_id,
    options.initiated_by,
    execution.assigned_to,
    execution.created_by
  );

  if (initiatedBy) {
    await assignExecutionOwnershipIfMissing.run(initiatedBy, id);
    await assignExecutionCaseOwnershipIfMissing.run(initiatedBy, id);
  }

  const dispatchPlan = await testEngineDispatchService.planExecutionDispatch(execution, {
    allowIncompleteAutomation: true,
    allowApiCasesWithoutAutomation: true
  });

  if (!dispatchPlan.eligible_automated_case_count) {
    throw new Error("Local run requires a recorded automated web test case or an API test case with saved API request steps.");
  }

  const localEngineBaseUrl = await resolveLocalEngineBaseUrl(options.engine_base_url);
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id)
    || {
      id: null,
      base_url: localEngineBaseUrl,
      config: {
        active_web_engine: "playwright",
        headless: false,
        video_mode: "retain-on-failure",
        trace_mode: "retain-on-failure"
      }
    };
  const dispatchSummary = await testEngineDispatchService.runExecutionDirectLocal({
    plan: dispatchPlan,
    integration,
    initiatedBy,
    engineBaseUrl: localEngineBaseUrl
  });

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "hellotest.execution.local-start",
      summary: "Local execution started."
    });
  } catch {
    // OPS telemetry is best-effort and must not block local execution start.
  }

  return {
    started: true,
    execution_mode: "local",
    engine_base_url: localEngineBaseUrl,
    ...dispatchSummary
  };
};

exports.completeExecution = async (id, status, options = {}) => {
  if (!["completed", "failed", "blocked", "partially_completed", "aborted"].includes(status)) {
    throw new Error("Invalid completion status");
  }

  const completion = await db.transaction(async () => {
    const execution = await db.prepare(`SELECT * FROM executions WHERE id = ? FOR UPDATE`).get(id);
    if (!execution) throw new Error("Execution not found");
    const currentRevision = assertExpectedRevision(execution.revision, options.expected_revision, "Run");
    if (execution.status !== "running") throw runError("Only running executions can be completed", "RUN_FINISHED", 409);
    const scope = await db.prepare(`SELECT test_case_id, test_data_set_snapshot FROM execution_case_snapshots WHERE execution_id = ?`).all(id);
    const resultRows = await db.prepare(`SELECT * FROM execution_results WHERE execution_id = ?`).all(id);
    const metrics = summarizeExecutionMetrics(scope, resultRows);
    let resolvedStatus = status;
    if (["completed", "partially_completed"].includes(status)) {
      resolvedStatus = metrics.failed_cases ? "failed" : metrics.blocked_cases ? "blocked"
        : !metrics.total_cases || metrics.pending_cases + metrics.paused_cases + metrics.running_cases + metrics.aborted_cases > 0
          ? "partially_completed" : "completed";
    }
    await executionResultService.stopExecutionCaseTimers(id, options.executed_by || options.completed_by || null);
    const completionResult = await db.prepare(`
    UPDATE executions
    SET status = ?, ended_at = CURRENT_TIMESTAMP, revision = ?
    WHERE id = ? AND status = 'running' AND revision = ?
  `).run(resolvedStatus, currentRevision + 1, id, currentRevision);
    if (completionResult.changes !== 1) assertExpectedRevision(currentRevision + 1, currentRevision, "Run");
    return { revision: currentRevision + 1, status: resolvedStatus, counts: { total: metrics.total_cases, passed: metrics.passed_cases, failed: metrics.failed_cases,
      blocked: metrics.blocked_cases, running: metrics.running_cases, paused: metrics.paused_cases, skipped: metrics.skipped_cases, aborted: metrics.aborted_cases, not_run: metrics.pending_cases } };
  })();
  const { revision } = completion;
  status = completion.status;
  executionCache.delete(id);

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "hellotest.execution.complete",
      summary: `Execution ${status}.`
    });
  } catch {
    // OPS telemetry is best-effort and must not block execution completion.
  }

  return { completed: true, status, revision, counts: completion.counts };
};

exports.runExecutionApiStep = async (
  executionId,
  testCaseId,
  stepId,
  { executed_by, data_set_iteration_index = null } = {}
) => {
  const execution = await loadExecutionRuntimeContext(await exports.getExecution(executionId));

  if (execution.status !== "running") {
    throw new Error("Only running executions support API step execution");
  }

  const caseSnapshot = (execution.case_snapshots || []).find((snapshot) => snapshot.test_case_id === testCaseId);

  if (!caseSnapshot) {
    throw new Error("Execution test case not found");
  }

  const dataSetIteration = resolveExecutionCaseDataSetIteration(
    execution,
    caseSnapshot,
    data_set_iteration_index
  );

  const stepSnapshot = (execution.step_snapshots || []).find((snapshot) =>
    snapshot.test_case_id === testCaseId && snapshot.snapshot_step_id === stepId
  );

  if (!stepSnapshot) {
    throw new Error("Execution step not found");
  }

  const apiRequest = parseJsonValue(stepSnapshot.api_request, null);
  const resolvedStepType = stepSnapshot.step_type || (apiRequest ? "api" : "web");

  const existingResult = await executionResultService.findLatestExecutionResult({
    execution_id: executionId,
    test_case_id: testCaseId,
    data_set_iteration_index: dataSetIteration.result_metadata.data_set_iteration_index
  });
  if (execution.trigger === "manual" && (!existingResult?.started_at || existingResult.status !== "running")) {
    throw runError("Start or resume this case before executing a step.", "CASE_NOT_STARTED", 409);
  }
  const existingLogs = executionStepRuntimeService.parseStructuredLogs(existingResult?.logs || null);
  const currentCaseCapturedValues = normalizeFrozenCapturedValues(
    executionStepRuntimeService.extractCapturedValuesFromLogs(existingLogs), execution.parameter_scope_default);
  const capturedValues = {
    ...await collectSuiteScopedCapturedValues(execution, caseSnapshot, testCaseId, dataSetIteration.result_metadata),
    ...currentCaseCapturedValues
  };

  if (resolvedStepType === "web") {
    const testEngineIntegration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);
    const queued = await testEngineDispatchService.queueSingleStepDispatch({
      execution,
      caseSnapshot,
      stepSnapshot,
      integration: testEngineIntegration,
      initiatedBy: executed_by || null,
      capturedValues,
      existingLogs,
      dataSetIteration: dataSetIteration.engine_iteration
    });
    const queuedNote = `Queued web step ${stepSnapshot.step_order} for Test Engine execution with ${queued.active_web_engine || "the configured web engine"}. Open the provider live viewer while the engine reports step progress.`;
    const mergedLogs = {
      ...existingLogs,
      stepNotes: {
        ...existingLogs.stepNotes,
        [stepId]: queuedNote
      }
    };
    const result = await executionResultService.upsertExecutionResult({
      execution_id: executionId,
      test_case_id: testCaseId,
      app_type_id: execution.app_type_id,
      status: "running",
      duration_ms: resolveExecutionCaseDurationMs(execution, existingResult),
      error: null,
      logs: JSON.stringify(mergedLogs),
      executed_by: normalizeText(executed_by) || execution.assigned_to || null,
      ...dataSetIteration.result_metadata
    });

    try {
      await opsTelemetryService.emitExecutionHierarchyEvents({
        execution_id: executionId,
        test_case_id: testCaseId,
        step_id: stepId,
        source: "hellotest.execution-console.web-step-queued",
        summary: queuedNote,
        execution_result_id: result.id,
        step_note: queuedNote,
        captures: capturedValues
      });
    } catch {
      // OPS telemetry is best-effort and must not block web step handoff.
    }

    return {
      execution_id: executionId,
      test_case_id: testCaseId,
      step_id: stepId,
      step_status: null,
      case_status: "running",
      execution_status: execution.status,
      note: queuedNote,
      detail: null,
      captures: capturedValues,
      execution_result_id: result.id,
      queued_for_engine: true,
      job_id: queued.job_id,
      engine_run_id: queued.engine_run_id,
      transaction_id: queued.transaction_id,
      active_web_engine: queued.active_web_engine,
      live_view_url: queued.live_view_url,
      ...dataSetIteration.result_metadata
    };
  }

  if (resolvedStepType !== "api" || !apiRequest) {
    throw new Error("Only API and web execution steps can be run through the execution console");
  }

  const parameterValues = buildExecutionRuntimeParameterValues(
    execution,
    caseSnapshot,
    capturedValues,
    dataSetIteration.result_metadata.data_set_iteration_index,
    stepSnapshot
  );
  const stepResult = await apiRequestExecutionService.executeApiRequestStep({
    api_request: apiRequest,
    parameter_values: parameterValues
  });
  const normalizedStepCaptures = executionStepRuntimeService.extractCapturedValuesFromLogs({
    stepCaptures: {
      [stepId]: stepResult.captures || {}
    }
  });
  const formattedStepNote = executionStepRuntimeService.formatApiStepEvidenceNote(stepResult);
  const mergedLogs = {
    ...existingLogs,
    stepStatuses: {
      ...existingLogs.stepStatuses,
      [stepId]: stepResult.status
    },
    stepNotes: {
      ...existingLogs.stepNotes,
      [stepId]: formattedStepNote
    },
    stepEvidence: {
      ...existingLogs.stepEvidence,
      ...(stepResult.evidence ? { [stepId]: stepResult.evidence } : {})
    },
    stepApiDetails: {
      ...existingLogs.stepApiDetails,
      [stepId]: stepResult.detail
    },
    stepCaptures: Object.keys(normalizedStepCaptures).length
      ? {
          ...existingLogs.stepCaptures,
          [stepId]: {
            ...(existingLogs.stepCaptures?.[stepId] || {}),
            ...normalizedStepCaptures
          }
        }
      : {
          ...existingLogs.stepCaptures
        }
  };
  const caseStepIds = (execution.step_snapshots || [])
    .filter((snapshot) => snapshot.test_case_id === testCaseId)
    .sort((left, right) => left.step_order - right.step_order)
    .map((snapshot) => snapshot.snapshot_step_id);
  const caseStatus = executionStepRuntimeService.deriveCaseStatusFromStepStatuses(
    caseStepIds,
    mergedLogs.stepStatuses
  );
  const result = await executionResultService.upsertExecutionResult({
    execution_id: executionId,
    test_case_id: testCaseId,
    app_type_id: execution.app_type_id,
    status: caseStatus,
    duration_ms: resolveExecutionCaseDurationMs(execution, existingResult),
    error: caseStatus === "failed" ? stepResult.note : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: normalizeText(executed_by) || execution.assigned_to || null,
    ...dataSetIteration.result_metadata
  });

  await testEngineDispatchService.settleExecutionIfComplete(executionId);

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: executionId,
      test_case_id: testCaseId,
      step_id: stepId,
      source: "hellotest.execution-console",
      summary: formattedStepNote,
      execution_result_id: result.id,
      step_status: stepResult.status,
      step_note: formattedStepNote,
      step_detail: stepResult.detail,
      step_evidence: stepResult.evidence,
      captures: stepResult.captures
    });
  } catch {
    // OPS telemetry is best-effort and must not block API step execution.
  }

  const refreshedExecution = await selectExecutionRecord.get(executionId);

  return {
    execution_id: executionId,
    test_case_id: testCaseId,
    step_id: stepId,
    step_status: stepResult.status,
    case_status: caseStatus,
    execution_status: refreshedExecution?.status || execution.status,
    note: formattedStepNote,
    detail: stepResult.detail,
    captures: normalizedStepCaptures,
    execution_result_id: result.id,
    ...dataSetIteration.result_metadata
  };
};

exports.updateExecution = async (id, input = {}) => {
  const transaction = db.transaction(async () => {
  const execution = await db.prepare(`SELECT * FROM executions WHERE id = ? FOR UPDATE`).get(id);

  if (!execution) {
    throw new Error("Execution not found");
  }
  assertRunEditable(execution);
  const currentRevision = assertExpectedRevision(execution.revision, input.expected_revision, "Run");
  await validateRunDeliveryRelations(execution.project_id, input);
  const has = (field) => Object.prototype.hasOwnProperty.call(input, field);
  const metadataFields = [];
  const metadataValues = [];
  const setField = (field, value) => { metadataFields.push(`${field} = ?`); metadataValues.push(value); };

  if (has("name")) {
    const name = normalizeText(input.name);
    if (!name || name.length > 255) throw runError("Run name must contain between 1 and 255 characters.");
    setField("name", name);
  }
  if (has("start_date") || has("end_date")) {
    const dates = normalizeExecutionDates({
      start_date: has("start_date") ? input.start_date : formatStoredRunDate(execution.start_date),
      end_date: has("end_date") ? input.end_date : formatStoredRunDate(execution.end_date)
    });
    setField("start_date", dates.start_date);
    setField("end_date", dates.end_date);
  }

  const contextFields = ["test_environment_id", "test_configuration_id", "test_data_set_id", "parallel_enabled", "parallel_count"];
  const dataOptions = normalizeDataOptions(input.test_data_options ?? execution.test_data_options);
  const dataOptionsChanged = JSON.stringify(dataOptions) !== JSON.stringify(normalizeDataOptions(execution.test_data_options));
  if (execution.app_type_id && (has("test_data_set_id") || dataOptionsChanged || has("suite_ids") || has("test_case_ids")) && (input.test_data_set_id === undefined ? execution.test_data_set_id : input.test_data_set_id)) {
    await require('./runParameterPlan.service').assertRunDataSetCompatible({ ...input, execution_id: id, project_id: execution.project_id, app_type_id: execution.app_type_id, test_data_options: dataOptions });
  }
  const contextChanged = dataOptionsChanged || contextFields.some((field) => has(field) && (input[field] || null) !== (execution[field] || null));
  const currentMode = execution.trigger === "manual" ? "manual" : execution.trigger === "local" || execution.execution_mode === "local" ? "local" : "remote";
  const modeChanged = has("execution_mode") && input.execution_mode !== currentMode;
  if (has("execution_mode") && !["manual", "remote", "local"].includes(input.execution_mode)) throw runError("Select manual, remote or local run mode.");
  if (contextChanged || modeChanged) {
    if (execution.status !== "queued" || execution.started_at || await db.prepare("SELECT id FROM execution_results WHERE execution_id = ? LIMIT 1").get(id)) {
      throw runError("Environment, configuration, data and parallel settings can only change before execution begins.", "RUN_CONTEXT_LOCKED", 409);
    }
  }
  if (modeChanged) {
    setField("trigger", input.execution_mode === "remote" ? "ci" : input.execution_mode);
    setField("execution_mode", input.execution_mode === "local" ? "local" : "remote");
  }
  let selectedDataSet = execution.test_data_set_id ? { id: execution.test_data_set_id, name: execution.test_data_set_name,
    snapshot: parseJsonValue(execution.test_data_set_snapshot, null) } : null;
  const resources = [
    { field: "test_environment_id", prefix: "test_environment", label: "Test environment", lookup: selectTestEnvironment,
      snapshotBuilder: (resource) => ({ id: resource.id, name: resource.name, description: resource.description,
        base_url: resource.base_url, browser: resource.browser, notes: resource.notes, variables: parseJsonValue(resource.variables, []) }) },
    { field: "test_configuration_id", prefix: "test_configuration", label: "Test configuration", lookup: selectTestConfiguration,
      snapshotBuilder: (resource) => ({ id: resource.id, name: resource.name, description: resource.description, browser: resource.browser,
        mobile_os: resource.mobile_os, platform_version: resource.platform_version, targets: configurationTargetsForRead(resource.targets, resource),
        variables: parseJsonValue(resource.variables, []) }) },
    { field: "test_data_set_id", prefix: "test_data_set", label: "Test data set", lookup: selectTestDataSet, snapshotBuilder: buildExecutionDataSetSnapshot }
  ];
  for (const resource of resources) if (has(resource.field) && (input[resource.field] || null) !== (execution[resource.field] || null)) {
    const selected = await resolveExecutionContextResource({ ...resource, id: input[resource.field],
      projectId: execution.project_id, appTypeId: execution.app_type_id });
    setField(resource.field, selected?.id || null);
    setField(`${resource.prefix}_name`, selected?.name || null);
    setField(`${resource.prefix}_snapshot`, selected?.snapshot || null);
    if (resource.field === "test_data_set_id") selectedDataSet = selected;
  }
  if (has("test_data_options")) setField("test_data_options", dataOptions);
  if (has("parallel_enabled")) setField("parallel_enabled", Boolean(input.parallel_enabled));
  if (has("parallel_count")) setField("parallel_count", normalizeParallelCount(input.parallel_count));

  if (has("suite_ids") || has("test_case_ids")) {
    const existingSuites = await db.prepare("SELECT suite_id, suite_name FROM execution_suites WHERE execution_id = ?").all(id);
    const existingCases = await getCaseSnapshotsForExecution.all(id);
    const oldSuiteIds = new Set(existingSuites.map((row) => row.suite_id));
    const existingDirectIds = execution.direct_test_case_ids == null
      ? existingCases.filter((row) => !oldSuiteIds.has(row.suite_id)).map((row) => row.test_case_id)
      : normalizeTextList(parseJsonValue(execution.direct_test_case_ids, []));
    const suiteIds = has("suite_ids") ? await expandSuiteSelection(normalizeTextList(input.suite_ids), execution.app_type_id) : [...oldSuiteIds];
    const directIds = has("test_case_ids") ? normalizeTextList(input.test_case_ids)
      : existingDirectIds;
    setField("direct_test_case_ids", directIds);
    const existingById = new Map(existingCases.map((row) => [row.test_case_id, row]));
    const suites = [];
    for (const suiteId of suiteIds) {
      const saved = existingSuites.find((suite) => suite.suite_id === suiteId);
      if (saved) { suites.push(saved); continue; }
      const suite = await validateSuite.get(suiteId);
      if (!suite || suite.app_type_id !== execution.app_type_id) throw runError("All suites must belong to this run's app type.");
      suites.push({ suite_id: suite.id, suite_name: suite.name });
    }
    const directCases = [];
    for (const caseId of directIds) {
      if (existingById.has(caseId)) continue;
      const testCase = await selectCaseForExecution.get(caseId);
      if (!testCase || testCase.app_type_id !== execution.app_type_id) throw runError("All cases must belong to this run's app type.");
      const suite = await selectPrimarySuiteForCaseExecution.get(caseId);
      directCases.push({ ...testCase, suite_id: suite?.suite_id || null, suite_name: suite?.suite_name || null,
        suite_parameter_values: suite?.suite_parameter_values || {} });
    }
    const retainedSuiteIds = suiteIds.filter((suiteId) => oldSuiteIds.has(suiteId));
    const retainedMembership = retainedSuiteIds.length && existingCases.length ? await db.prepare(`
      SELECT suite_id, test_case_id FROM suite_test_cases
      WHERE suite_id IN (${placeholdersFor(retainedSuiteIds)}) AND test_case_id IN (${placeholdersFor(existingCases)})
    `).all(...retainedSuiteIds, ...existingCases.map((row) => row.test_case_id)) : [];
    const retainedCases = existingCases.filter((row) => retainedSuiteIds.includes(row.suite_id) || directIds.includes(row.test_case_id)
      || retainedMembership.some((mapping) => mapping.test_case_id === row.test_case_id)).map((row) => {
      if (suiteIds.includes(row.suite_id)) return row;
      const mapping = retainedMembership.find((item) => item.test_case_id === row.test_case_id);
      const target = suites.find((suite) => suite.suite_id === mapping?.suite_id);
      return target ? { ...row, suite_id: target.suite_id, suite_name: target.suite_name } : row;
    });
    // Existing selected scope is frozen. Authoring changes or deletions must not
    // silently replace its cases when adding unrelated scope to this run.
    const additions = await buildSnapshotPayload(id, suites.filter((suite) => !oldSuiteIds.has(suite.suite_id)), { persisted: true, directCases, projectId: execution.project_id, appTypeId: execution.app_type_id, userId:input.updated_by || execution.created_by,
      assignedTo: execution.assigned_to, assignedToIds: execution.assigned_to_ids, executionDataSet: selectedDataSet, testDataOptions: dataOptions });
    const desired = { caseSnapshots: [...new Map([...additions.caseSnapshots, ...retainedCases].map((row) => [row.test_case_id, row])).values()],
      stepSnapshots: additions.stepSnapshots };
    if (!desired.caseSnapshots.length) throw runError("Select at least one test case or a suite containing test cases.");
    const desiredIds = new Set(desired.caseSnapshots.map((row) => row.test_case_id));
    const existingIds = new Set(existingCases.map((row) => row.test_case_id));
    const removedIds = [...existingIds].filter((caseId) => !desiredIds.has(caseId));
    const membershipChanged = removedIds.length || [...desiredIds].some((caseId) => !existingIds.has(caseId))
      || suiteIds.length !== oldSuiteIds.size || suiteIds.some((suiteId) => !oldSuiteIds.has(suiteId));
    if (membershipChanged && (execution.status !== "queued" || execution.started_at) && execution.trigger !== "manual") {
      throw runError("Automated run membership can only change before execution begins.", "RUN_SCOPE_LOCKED", 409);
    }
    if (removedIds.length) {
      const recorded = await db.prepare(`SELECT test_case_id FROM execution_results WHERE execution_id = ?
        UNION SELECT test_case_id FROM test_case_runs WHERE run_id = ? AND (status <> 'queued' OR started_at IS NOT NULL)
      `).all(id, id);
      if (recorded.some((row) => removedIds.includes(row.test_case_id))) throw runError(
        "Cases with execution history cannot be removed from a run.", "RUN_CASE_HAS_HISTORY", 409);
      await db.prepare(`DELETE FROM execution_step_snapshots WHERE execution_id = ? AND test_case_id IN (${placeholdersFor(removedIds)})`).run(id, ...removedIds);
      await db.prepare(`DELETE FROM execution_case_snapshots WHERE execution_id = ? AND test_case_id IN (${placeholdersFor(removedIds)})`).run(id, ...removedIds);
    }
    if (membershipChanged) {
      await db.prepare("DELETE FROM execution_suites WHERE execution_id = ?").run(id);
      for (const suite of suites) await insertExecutionSuite.run(id, suite.suite_id, suite.suite_name);
      await persistExecutionSnapshots({
        caseSnapshots: desired.caseSnapshots.filter((row) => !existingIds.has(row.test_case_id)),
        stepSnapshots: desired.stepSnapshots.filter((row) => !existingIds.has(row.test_case_id))
      });
      for (const snapshot of desired.caseSnapshots) {
        const previous = existingById.get(snapshot.test_case_id);
        if (previous && previous.suite_id !== snapshot.suite_id && !suiteIds.includes(previous.suite_id)) {
          await db.prepare("UPDATE execution_case_snapshots SET suite_id = ?, suite_name = ? WHERE execution_id = ? AND test_case_id = ?")
            .run(snapshot.suite_id || null, snapshot.suite_name || null, id, snapshot.test_case_id);
        }
      }
      await recalculateExecutionScopeAssignments(id, execution);
    }
  }

  if (dataOptionsChanged || (has("test_data_set_id") && (input.test_data_set_id || null) !== (execution.test_data_set_id || null))) {
    const snapshots = await attachCaseDataSetSnapshots(await getCaseSnapshotsForExecution.all(id), selectedDataSet, dataOptions, await getStepSnapshotsForExecution.all(id), { projectId: execution.project_id, appTypeId: execution.app_type_id, preserveFrozen: true });
    for (const snapshot of snapshots) await db.prepare(`UPDATE execution_case_snapshots
      SET test_data_set_id = ?, test_data_set_name = ?, test_data_set_snapshot = ?, data_set_source = ?, test_data_options = ?
      WHERE execution_id = ? AND test_case_id = ?`).run(snapshot.test_data_set_id || null, snapshot.test_data_set_name || null,
        snapshot.test_data_set_snapshot || null, snapshot.data_set_source || null, snapshot.test_data_options || {}, id, snapshot.test_case_id);
  }

  if (Object.prototype.hasOwnProperty.call(input, "assigned_to_ids") || Object.prototype.hasOwnProperty.call(input, "assigned_to")) {
    const assignedToIds = Object.prototype.hasOwnProperty.call(input, "assigned_to_ids")
      ? normalizeTextList(input.assigned_to_ids)
      : normalizeTextList(input.assigned_to);
    await validateExecutionAssignees(execution.project_id, assignedToIds);
    await updateExecutionAssignment.run(assignedToIds[0] || null, assignedToIds, id);
    await recalculateExecutionScopeAssignments(id, { ...execution, assigned_to: assignedToIds[0] || null, assigned_to_ids: assignedToIds });
  }

  ["release", "sprint", "release_id", "iteration_id", "build"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      metadataFields.push(`${field} = ?`);
      metadataValues.push(normalizeText(input[field]));
    }
  });

  if (metadataFields.length) {
    await db.prepare(`
      UPDATE executions
      SET ${metadataFields.join(", ")}
      WHERE id = ?
    `).run(...metadataValues, id);
  }

  await db.prepare(`UPDATE executions SET revision = ? WHERE id = ?`).run(currentRevision + 1, id);

  executionCache.delete(id);
  return { updated: true, revision: currentRevision + 1 };
  });

  return transaction();
};

exports.updateExecutionCaseAssignment = async (executionId, testCaseId, input = {}) => {
  return updateExecutionScopeAssignment(executionId, "cases", testCaseId, input);
};

exports.updateExecutionScopeAssignment = updateExecutionScopeAssignment;
exports.resolveScopeAssignment = resolveScopeAssignment;
exports.summarizeExecutionMetrics = summarizeExecutionMetrics;
exports.resolveExecutionStartMode = resolveExecutionStartMode;

exports.resolveExecutionCaseDataSetIteration = resolveExecutionCaseDataSetIteration;

exports.deleteExecution = async (id) => {
  await exports.getExecution(id);

  const used = await db.prepare(`
    SELECT id FROM execution_results WHERE execution_id = ?
  `).get(id);

  if (used) {
    throw new Error("Cannot delete execution with results");
  }

  await db.prepare(`DELETE FROM execution_step_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_case_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_suites WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM executions WHERE id = ?`).run(id);

  return { deleted: true };
};
