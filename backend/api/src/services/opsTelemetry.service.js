const db = require("../db");
const obsDb = require("../obsDb");
const integrationService = require("./integration.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const selectExecution = obsDb.prepare(`
  SELECT id, project_id, app_type_id, name, status, started_at, ended_at
  FROM executions
  WHERE id = ?
`);

const selectExecutionCases = obsDb.prepare(`
  SELECT execution_id, test_case_id, test_case_title, external_references, suite_id, suite_name, sort_order
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const selectExecutionSteps = obsDb.prepare(`
  SELECT execution_id, test_case_id, snapshot_step_id, step_order, step_type, action, expected_result
  FROM execution_step_snapshots
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, step_order ASC
`);

const selectLatestResultsForExecution = obsDb.prepare(`
  SELECT DISTINCT ON (test_case_id)
    id,
    execution_id,
    test_case_id,
    status,
    error,
    logs,
    external_references,
    defects,
    created_at
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, created_at DESC, id DESC
`);

const nowIso = () => new Date().toISOString();

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
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

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const buildEventUrl = (baseUrl, eventsPath) => {
  const base = normalizeText(baseUrl);

  if (!base) {
    throw new Error("OPS base URL is required");
  }

  return new URL(normalizeText(eventsPath) || "/api/v1/events", base).toString();
};

const resolveOpsBaseUrl = async (integration, projectId) => {
  const configuredBaseUrl = normalizeText(integration?.base_url);

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const scopedProjectId = normalizeText(projectId) || normalizeText(integration?.config?.project_id);
  const testEngineIntegration = await integrationService.getActiveIntegrationByTypeForProject("testengine", scopedProjectId);
  const testEngineBaseUrl = normalizeText(testEngineIntegration?.base_url);

  if (!testEngineBaseUrl) {
    throw new Error("OPS telemetry requires an active Test Engine integration with a host URL");
  }

  return testEngineBaseUrl;
};

const buildAuthHeaderValue = (headerPrefix, apiKey) => {
  const normalizedApiKey = normalizeText(apiKey);

  if (!normalizedApiKey) {
    return null;
  }

  const normalizedPrefix = normalizeText(headerPrefix);
  return normalizedPrefix ? `${normalizedPrefix} ${normalizedApiKey}` : normalizedApiKey;
};

const deriveAggregateStatus = (statuses, expectedCount, fallback = "queued") => {
  const normalizedStatuses = (statuses || []).filter(Boolean);

  if (normalizedStatuses.includes("failed")) {
    return "failed";
  }

  if (normalizedStatuses.includes("running")) {
    return "running";
  }

  if (!expectedCount) {
    return fallback;
  }

  if (!normalizedStatuses.length) {
    return fallback;
  }

  if (normalizedStatuses.length < expectedCount) {
    return "running";
  }

  if (normalizedStatuses.includes("blocked")) {
    return "blocked";
  }

  if (normalizedStatuses.every((status) => status === "passed")) {
    return "passed";
  }

  return fallback;
};

const buildHierarchySnapshot = async (executionId) => {
  const execution = await selectExecution.get(executionId);

  if (!execution) {
    throw new Error("Execution not found for OPS telemetry");
  }

  const [cases, steps, latestResults] = await Promise.all([
    selectExecutionCases.all(executionId),
    selectExecutionSteps.all(executionId),
    selectLatestResultsForExecution.all(executionId)
  ]);

  const stepsByCaseId = new Map();
  const caseById = new Map();
  const resultByCaseId = new Map();

  cases.forEach((item) => {
    caseById.set(item.test_case_id, item);
  });

  steps.forEach((item) => {
    const current = stepsByCaseId.get(item.test_case_id) || [];
    current.push(item);
    stepsByCaseId.set(item.test_case_id, current);
  });

  latestResults.forEach((item) => {
    resultByCaseId.set(item.test_case_id, item);
  });

  const caseSnapshots = cases.map((item) => {
    const result = resultByCaseId.get(item.test_case_id) || null;
    const logs = executionStepRuntimeService.parseStructuredLogs(result?.logs || null);
    const stepIds = (stepsByCaseId.get(item.test_case_id) || []).map((step) => step.snapshot_step_id);
    const status =
      normalizeText(result?.status)
      || executionStepRuntimeService.deriveCaseStatusFromStepStatuses(stepIds, logs.stepStatuses);

    return {
      ...item,
      external_references: normalizeStoredReferenceList(item.external_references),
      result,
      logs,
      step_ids: stepIds,
      status: status || "blocked"
    };
  });

  const suitesById = new Map();

  caseSnapshots.forEach((item) => {
    if (!item.suite_id) {
      return;
    }

    const current = suitesById.get(item.suite_id) || {
      id: item.suite_id,
      name: item.suite_name || "Deleted Suite",
      cases: []
    };

    current.cases.push(item);
    suitesById.set(item.suite_id, current);
  });

  const suiteSnapshots = [...suitesById.values()].map((suite) => {
    const statuses = suite.cases.map((item) => item.status);
    const passedCount = statuses.filter((status) => status === "passed").length;
    const failedCount = statuses.filter((status) => status === "failed").length;
    const blockedCount = statuses.filter((status) => status === "blocked").length;
    const runningCount = statuses.filter((status) => status === "running").length;

    return {
      id: suite.id,
      name: suite.name,
      status: deriveAggregateStatus(statuses, suite.cases.length, execution.status || "queued"),
      total_cases: suite.cases.length,
      passed_cases: passedCount,
      failed_cases: failedCount,
      blocked_cases: blockedCount,
      running_cases: runningCount,
      case_ids: suite.cases.map((item) => item.test_case_id)
    };
  });

  const executionCaseStatuses = caseSnapshots.map((item) => item.status);
  const executionStatus = deriveAggregateStatus(
    executionCaseStatuses,
    caseSnapshots.length,
    normalizeText(execution.status) || "queued"
  );

  return {
    execution: {
      ...execution,
      derived_status:
        executionStatus === "passed"
          ? "completed"
          : executionStatus === "blocked"
            ? normalizeText(execution.status) || "running"
            : executionStatus
    },
    caseSnapshots,
    suiteSnapshots,
    stepsByCaseId
  };
};

const postEvent = async (integration, payload) => {
  const config = isPlainObject(integration?.config) ? integration.config : {};
  const resolvedBaseUrl = await resolveOpsBaseUrl(integration, payload?.project_id);
  const timeoutMs = Math.max(500, normalizeInteger(config.timeout_ms, 4000) || 4000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "content-type": "application/json",
    "x-qaira-source": "qaira-ops-telemetry"
  };
  const authHeaderName = normalizeText(config.api_key_header) || "Authorization";
  const authHeaderValue = buildAuthHeaderValue(config.api_key_prefix, integration.api_key);

  if (authHeaderValue) {
    headers[authHeaderName] = authHeaderValue;
  }

  try {
    const response = await fetch(buildEventUrl(resolvedBaseUrl, config.events_path), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `OPS endpoint returned ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
};

exports.clearTelemetryLogs = async ({ project_id } = {}) => {
  const integration =
    await integrationService.getActiveIntegrationByTypeForProject("ops", project_id)
    || {
      type: "ops",
      base_url: null,
      api_key: null,
      config: {
        project_id,
        events_path: "/api/v1/events",
        api_key_header: "Authorization",
        api_key_prefix: "Bearer",
        timeout_ms: 4000
      }
    };
  const config = isPlainObject(integration?.config) ? integration.config : {};
  const resolvedBaseUrl = await resolveOpsBaseUrl(integration, project_id);
  const timeoutMs = Math.max(500, normalizeInteger(config.timeout_ms, 4000) || 4000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    accept: "application/json"
  };
  const authHeaderName = normalizeText(config.api_key_header) || "Authorization";
  const authHeaderValue = buildAuthHeaderValue(config.api_key_prefix, integration.api_key);

  if (authHeaderValue) {
    headers[authHeaderName] = authHeaderValue;
  }

  try {
    const response = await fetch(buildEventUrl(resolvedBaseUrl, config.events_path), {
      method: "DELETE",
      headers,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.message || `OPS telemetry clear failed with status ${response.status}`);
    }

    return {
      cleared: true,
      deleted: Number(payload?.deleted || 0),
      events_path: normalizeText(config.events_path) || "/api/v1/events"
    };
  } finally {
    clearTimeout(timer);
  }
};

const emitSafe = async (integration, payload) => {
  try {
    await postEvent(integration, payload);
    return true;
  } catch (error) {
    console.error("[ops-telemetry] Unable to emit event", {
      error: error instanceof Error ? error.message : error,
      event_type: payload?.event_type,
      execution_id: payload?.execution?.id,
      test_case_id: payload?.test_case?.id,
      step_id: payload?.step?.id
    });
    return false;
  }
};

exports.emitExecutionHierarchyEvents = async ({
  execution_id,
  test_case_id,
  step_id,
  source = "qaira",
  summary,
  execution_result_id,
  step_status,
  step_note,
  step_detail,
  step_evidence,
  captures
} = {}) => {
  try {
    const executionId = normalizeText(execution_id);

    if (!executionId) {
      return { emitted: false, reason: "missing-execution-id" };
    }

    const hierarchy = await buildHierarchySnapshot(executionId);
    const integration = await integrationService.getActiveIntegrationByTypeForProject("ops", hierarchy.execution.project_id);

    if (!integration) {
      return { emitted: false, reason: "no-active-ops-integration" };
    }

    const config = isPlainObject(integration.config) ? integration.config : {};
    const emittedAt = nowIso();
    const testCase = hierarchy.caseSnapshots.find((item) => item.test_case_id === test_case_id) || null;
    const suite = testCase?.suite_id
      ? hierarchy.suiteSnapshots.find((item) => item.id === testCase.suite_id) || null
      : null;
    const step = testCase
      ? (hierarchy.stepsByCaseId.get(testCase.test_case_id) || []).find((item) => item.snapshot_step_id === step_id) || null
      : null;
    const runStatus = hierarchy.execution.derived_status || hierarchy.execution.status || "running";
    const runPayload = {
      id: hierarchy.execution.id,
      name: hierarchy.execution.name,
      status: runStatus,
      started_at: hierarchy.execution.started_at || null,
      ended_at: hierarchy.execution.ended_at || null,
      total_cases: hierarchy.caseSnapshots.length,
      passed_cases: hierarchy.caseSnapshots.filter((item) => item.status === "passed").length,
      failed_cases: hierarchy.caseSnapshots.filter((item) => item.status === "failed").length,
      blocked_cases: hierarchy.caseSnapshots.filter((item) => item.status === "blocked").length,
      running_cases: hierarchy.caseSnapshots.filter((item) => item.status === "running").length
    };
    const basePayload = {
      source,
      service_name: normalizeText(config.service_name) || "qaira-testengine",
      environment: normalizeText(config.environment) || process.env.NODE_ENV || "production",
      emitted_at: emittedAt,
      integration_id: integration.id,
      project_id: hierarchy.execution.project_id,
      app_type_id: hierarchy.execution.app_type_id || null,
      execution: runPayload
    };
    const events = [];

    if (step && config.emit_step_events !== false) {
      const caseReferences = normalizeStoredReferenceList(testCase?.external_references);
      const resultReferences = normalizeStoredReferenceList(testCase?.result?.external_references);
      const resultDefects = normalizeStoredReferenceList(testCase?.result?.defects);

      events.push({
        ...basePayload,
        event_type: "execution.step.updated",
        status: normalizeText(step_status) || testCase?.logs?.stepStatuses?.[step.snapshot_step_id] || null,
        summary: normalizeText(summary) || normalizeText(step_note) || null,
        test_case: testCase
          ? {
              id: testCase.test_case_id,
              title: testCase.test_case_title,
              status: testCase.status,
              execution_result_id: execution_result_id || testCase.result?.id || null,
              external_references: [...new Set([...caseReferences, ...resultReferences])],
              defects: resultDefects
            }
          : null,
        suite: suite,
        step: {
          id: step.snapshot_step_id,
          order: step.step_order,
          type: step.step_type || null,
          action: step.action || null,
          expected_result: step.expected_result || null,
          status: normalizeText(step_status) || testCase?.logs?.stepStatuses?.[step.snapshot_step_id] || null,
          note: normalizeText(step_note) || testCase?.logs?.stepNotes?.[step.snapshot_step_id] || null,
          has_evidence: Boolean(step_evidence?.dataUrl || testCase?.logs?.stepEvidence?.[step.snapshot_step_id]?.dataUrl),
          captures: isPlainObject(captures)
            ? captures
            : testCase?.logs?.stepCaptures?.[step.snapshot_step_id]
              || testCase?.logs?.stepApiDetails?.[step.snapshot_step_id]?.captures
              || {},
          api_detail: isPlainObject(step_detail)
            ? step_detail
            : testCase?.logs?.stepApiDetails?.[step.snapshot_step_id] || null
        }
      });
    }

    if (testCase && config.emit_case_events !== false) {
      const caseReferences = normalizeStoredReferenceList(testCase.external_references);
      const resultReferences = normalizeStoredReferenceList(testCase.result?.external_references);
      const resultDefects = normalizeStoredReferenceList(testCase.result?.defects);

      events.push({
        ...basePayload,
        event_type: "execution.case.updated",
        status: testCase.status,
        summary: normalizeText(summary) || testCase.result?.error || null,
        test_case: {
          id: testCase.test_case_id,
          title: testCase.test_case_title,
          status: testCase.status,
          suite_id: testCase.suite_id || null,
          suite_name: testCase.suite_name || null,
          execution_result_id: execution_result_id || testCase.result?.id || null,
          external_references: [...new Set([...caseReferences, ...resultReferences])],
          defects: resultDefects,
          step_status_count: Object.keys(testCase.logs?.stepStatuses || {}).length,
          evidence_count: Object.keys(testCase.logs?.stepEvidence || {}).length
        },
        suite: suite
      });
    }

    if (suite && config.emit_suite_events !== false) {
      events.push({
        ...basePayload,
        event_type: "execution.suite.updated",
        status: suite.status,
        summary: normalizeText(summary) || null,
        suite
      });
    }

    if (config.emit_run_events !== false) {
      events.push({
        ...basePayload,
        event_type: "execution.run.updated",
        status: runPayload.status,
        summary: normalizeText(summary) || null
      });
    }

    let emittedCount = 0;

    for (const payload of events) {
      const emitted = await emitSafe(integration, payload);
      if (emitted) {
        emittedCount += 1;
      }
    }

    return {
      emitted: emittedCount > 0,
      emitted_count: emittedCount
    };
  } catch (error) {
    console.error("[ops-telemetry] Unable to build execution hierarchy event", {
      error: error instanceof Error ? error.message : error,
      execution_id: execution_id || null,
      test_case_id: test_case_id || null,
      step_id: step_id || null
    });
    return {
      emitted: false,
      reason: "internal-error"
    };
  }
};
