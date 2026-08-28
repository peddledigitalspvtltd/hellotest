const db = require("../db");
const obsDb = require("../obsDb");
const integrationService = require("./integration.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");
const { readBoundedResponseJson } = require("../utils/boundedResponse");
const { resilientHttpRequest } = require("../utils/resilientHttpClient");
const { SERVICE_ERROR_CODES, serviceError } = require("../utils/serviceErrors");

const OPS_READ_MAX_BYTES = 5 * 1024 * 1024;
const OPS_READ_MAX_EVENTS = 250;

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

  const parsedBase = new URL(base);
  const path = normalizeText(eventsPath) || "/api/v1/events";
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) {
    throw new Error("OPS events path must be a same-origin absolute path");
  }
  const target = new URL(path, parsedBase);
  if (target.origin !== parsedBase.origin) throw new Error("OPS events path must remain on the configured service origin");
  return target.toString();
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

const resolveActiveOpsIntegration = async (projectId) =>
  await integrationService.getActiveIntegrationByTypeForProject("ops", projectId)
  || {
    type: "ops",
    base_url: null,
    api_key: null,
    config: {
      project_id: projectId,
      events_path: "/api/v1/events",
      api_key_header: "Authorization",
      api_key_prefix: "Bearer",
      timeout_ms: 4000
    }
  };

const buildOpsHeaders = (integration) => {
  const integrationConfig = isPlainObject(integration?.config) ? integration.config : {};
  const headers = { accept: "application/json" };
  const authHeaderName = normalizeText(integrationConfig.api_key_header) || "Authorization";
  const authHeaderValue = buildAuthHeaderValue(integrationConfig.api_key_prefix, integration.api_key);
  if (authHeaderValue) headers[authHeaderName] = authHeaderValue;
  return headers;
};

const fetchOpsJson = async ({ url, integration, timeoutMs }) => {
  const response = await resilientHttpRequest(url, {
    headers: buildOpsHeaders(integration)
  }, {
    dependency: "ops-telemetry",
    operation: "telemetry.read",
    deadlineMs: timeoutMs,
    maxAttempts: 3,
    maxResponseBytes: OPS_READ_MAX_BYTES,
    maxConcurrent: 20,
    failureThreshold: 5,
    resetTimeoutMs: 20_000
  });
  const payload = await readBoundedResponseJson(response, {
    maxBytes: OPS_READ_MAX_BYTES,
    label: "OPS response"
  }).catch((error) => {
    if (!response.ok) return null;
    throw serviceError(SERVICE_ERROR_CODES.INVALID_RESPONSE, {
      dependency: "ops-telemetry",
      operation: "telemetry.parse",
      retryable: false,
      statusCode: 502,
      cause: error
    });
  });
  if (!response.ok) {
    throw serviceError(SERVICE_ERROR_CODES.UPSTREAM_REJECTED, {
      dependency: "ops-telemetry",
      operation: "telemetry.read",
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
      upstreamStatus: response.status
    });
  }
  return payload;
};

exports.getTelemetrySnapshot = async ({
  project_id,
  service_name,
  event_type,
  status,
  execution_id,
  search,
  limit
} = {}) => {
  const projectId = normalizeText(project_id);
  if (!projectId) throw new Error("project_id is required for OPS telemetry");

  const integration = await resolveActiveOpsIntegration(projectId);
  const integrationConfig = isPlainObject(integration?.config) ? integration.config : {};
  const resolvedBaseUrl = await resolveOpsBaseUrl(integration, projectId);
  const timeoutMs = Math.max(500, Math.min(30_000, normalizeInteger(integrationConfig.timeout_ms, 4000) || 4000));
  const eventsUrl = new URL(normalizeText(integrationConfig.events_path) || "/api/v1/events", resolvedBaseUrl);
  const servicesUrl = new URL("/api/v1/services", resolvedBaseUrl);
  const filters = { service_name, event_type, status, execution_id, search };
  for (const [key, value] of Object.entries(filters)) {
    const normalized = normalizeText(value);
    if (normalized) eventsUrl.searchParams.set(key, normalized.slice(0, 200));
  }
  eventsUrl.searchParams.set("limit", String(Math.max(1, Math.min(OPS_READ_MAX_EVENTS, normalizeInteger(limit, 100) || 100))));

  const [eventsPayload, servicesPayload] = await Promise.all([
    fetchOpsJson({ url: eventsUrl, integration, timeoutMs }),
    fetchOpsJson({ url: servicesUrl, integration, timeoutMs })
  ]);

  return {
    checked_at: new Date().toISOString(),
    project_id: projectId,
    events: {
      items: Array.isArray(eventsPayload?.items) ? eventsPayload.items.slice(0, OPS_READ_MAX_EVENTS) : [],
      total: Math.max(0, Number(eventsPayload?.total || 0))
    },
    services: {
      items: Array.isArray(servicesPayload?.items) ? servicesPayload.items.slice(0, 100) : []
    }
  };
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
  const headers = {
    "content-type": "application/json",
    "x-hellotest-source": "hellotest-ops-telemetry"
  };
  const authHeaderName = normalizeText(config.api_key_header) || "Authorization";
  const authHeaderValue = buildAuthHeaderValue(config.api_key_prefix, integration.api_key);

  if (authHeaderValue) {
    headers[authHeaderName] = authHeaderValue;
  }

  const response = await resilientHttpRequest(buildEventUrl(resolvedBaseUrl, config.events_path), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  }, {
    dependency: "ops-telemetry",
    operation: "event.publish",
    deadlineMs: timeoutMs,
    maxAttempts: 1,
    maxResponseBytes: 256 * 1024,
    maxConcurrent: 32,
    failureThreshold: 8,
    resetTimeoutMs: 15_000
  });

  if (!response.ok) {
    throw serviceError(SERVICE_ERROR_CODES.UPSTREAM_REJECTED, {
      dependency: "ops-telemetry",
      operation: "event.publish",
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
      upstreamStatus: response.status
    });
  }
};

exports.clearTelemetryLogs = async ({ project_id } = {}) => {
  const integration = await resolveActiveOpsIntegration(project_id);
  const config = isPlainObject(integration?.config) ? integration.config : {};
  const resolvedBaseUrl = await resolveOpsBaseUrl(integration, project_id);
  const timeoutMs = Math.max(500, normalizeInteger(config.timeout_ms, 4000) || 4000);
  const headers = buildOpsHeaders(integration);
  const response = await resilientHttpRequest(buildEventUrl(resolvedBaseUrl, config.events_path), {
    method: "DELETE",
    headers
  }, {
    dependency: "ops-telemetry",
    operation: "events.clear",
    deadlineMs: timeoutMs,
    maxAttempts: 3,
    maxResponseBytes: 256 * 1024,
    maxConcurrent: 4
  });
  const payload = await readBoundedResponseJson(response, {
    maxBytes: 256 * 1024,
    label: "OPS clear response"
  }).catch(() => null);

  if (!response.ok) {
    throw serviceError(SERVICE_ERROR_CODES.UPSTREAM_REJECTED, {
      dependency: "ops-telemetry",
      operation: "events.clear",
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
      upstreamStatus: response.status
    });
  }

  return {
    cleared: true,
    deleted: Number(payload?.deleted || 0),
    events_path: normalizeText(config.events_path) || "/api/v1/events"
  };
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
  source = "hellotest",
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
      service_name: normalizeText(config.service_name) || "hellotest-testengine",
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
