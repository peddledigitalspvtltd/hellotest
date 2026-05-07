const db = require("../db");
const { v4: uuid } = require("uuid");
const executionResultService = require("./executionResult.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const apiRequestExecutionService = require("./apiRequestExecution.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const opsTelemetryService = require("./opsTelemetry.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("../utils/testStepAutomation");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const SUPPORTED_ENGINE_STEP_TYPES = new Set(["api", "web", "android"]);
const DEFAULT_LEASE_SECONDS = Math.max(30, Number(process.env.TESTENGINE_JOB_LEASE_SECONDS || 90));
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
  SELECT id, title, display_id, automated
  FROM test_cases
  WHERE id = ?
`);

const selectExecutionCaseIds = db.prepare(`
  SELECT test_case_id
  FROM execution_case_snapshots
  WHERE execution_id = ?
`);

const selectLatestResultsForExecution = db.prepare(`
  SELECT DISTINCT ON (test_case_id) test_case_id, status
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, created_at DESC, id DESC
`);

const settleExecutionStatus = db.prepare(`
  UPDATE executions
  SET status = ?, ended_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running'
`);

const insertJob = db.prepare(`
  INSERT INTO test_engine_jobs (
    id,
    engine_run_id,
    integration_id,
    project_id,
    app_type_id,
    app_type_kind,
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
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectJob = db.prepare(`
  SELECT *
  FROM test_engine_jobs
  WHERE id = ?
`);

const selectQueueStats = db.prepare(`
  SELECT status, COUNT(*)::int AS count
  FROM test_engine_jobs
  WHERE completed_at IS NULL
    AND status IN ('queued', 'leased', 'running')
  GROUP BY status
`);

const updateJobLeaseState = db.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      leased_by = ?,
      lease_expires_at = ?,
      started_at = COALESCE(started_at, ?),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobRuntimeState = db.prepare(`
  UPDATE test_engine_jobs
  SET status = ?,
      runtime_state = ?,
      lease_expires_at = ?,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const finalizeJobState = db.prepare(`
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

const normalizeTestEngineWebEngine = (value, fallback = "playwright") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized && TESTENGINE_WEB_ENGINE_VALUES.has(normalized) ? normalized : fallback;
};

const normalizeEngineBrowser = (value, fallback = "chromium") => {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized ? TESTENGINE_BROWSER_ALIASES.get(normalized) || fallback : fallback;
};

const buildProviderLiveViewUrl = (integration, provider) => {
  const configured = normalizeText(integration?.config?.live_view_url || integration?.config?.vnc_url);

  if (
    configured
    && !(
      provider === "playwright"
      && (configured.includes(":7900/") || configured.toLowerCase().includes("vnc"))
    )
    && !(provider === "selenium" && configured.includes("/api/v1/live-session"))
  ) {
    return configured;
  }

  const baseUrl = normalizeText(integration?.base_url);

  if (!baseUrl) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl);

    if (provider === "selenium") {
      parsed.port = "7900";
      parsed.pathname = "/";
      parsed.search = "?autoconnect=1&resize=scale";
      parsed.hash = "";
      return parsed.toString();
    }

    parsed.pathname = "/api/v1/live-session";
    parsed.search = "?provider=playwright";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveDirectCallbackBaseUrl = (integration) =>
  normalizeText(process.env.QAIRA_LOCAL_CALLBACK_BASE_URL)
  || normalizeText(process.env.QAIRA_PUBLIC_API_BASE_URL)
  || normalizeText(integration?.config?.local_callback_base_url)
  || "http://localhost:3000";

const resolveCallbackSecret = (integration) =>
  normalizeText(integration?.config?.callback_secret)
  || normalizeText(process.env.TESTENGINE_CALLBACK_SECRET)
  || normalizeText(process.env.TESTENGINE_SHARED_SECRET)
  || normalizeText(process.env.QAIRA_TESTENGINE_SECRET)
  || "qaira-testengine-dev-secret";

const buildDirectCallback = (integration) => {
  const baseUrl = resolveDirectCallbackBaseUrl(integration).replace(/\/+$/, "");
  return {
    url: `${baseUrl}/api/testengine/callbacks/runs`,
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

const normalizeArtifactBundle = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
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

  const refs = normalizeInlineArtifactRefs(artifactBundle);
  const created = [];

  for (const ref of refs) {
    try {
      created.push(await workspaceTransactionService.createTransactionArtifact(transactionId, ref));
    } catch {
      // Artifact attachment is evidence, not execution truth. Keep completion resilient.
    }
  }

  return created;
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

const resolveEngineStepType = (stepType, appTypeKind) => {
  const normalized = normalizeTestStepType(stepType, null);

  if (normalized && SUPPORTED_ENGINE_STEP_TYPES.has(normalized)) {
    return normalized;
  }

  if (appTypeKind === "api" && !normalized) {
    return "api";
  }

  if (appTypeKind === "android" && !normalized) {
    return "android";
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
    assertions: steps.map((step) => step.expected_result).filter(Boolean),
    test_data: {
      ...normalizeStringRecord(caseSnapshot.suite_parameter_values),
      ...normalizeStringRecord(caseSnapshot.parameter_values)
    },
    environment_notes: normalizeText(execution.test_environment?.snapshot?.notes)
  };
};

const buildEngineEnvelope = ({
  engineRunId,
  execution,
  project,
  appType,
  caseSnapshot,
  steps,
  integration
}) => {
  const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const resolvedBrowser = normalizeEngineBrowser(
    execution.test_configuration?.snapshot?.browser
    || execution.test_environment?.snapshot?.browser
    || integrationConfig.browser
    || "chromium",
    "chromium"
  );

  return {
    engine_run_id: engineRunId,
    qaira_run_id: execution.id,
    qaira_execution_id: execution.id,
    qaira_test_case_id: caseSnapshot.test_case_id,
    qaira_test_case_title: caseSnapshot.test_case_title,
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
    browser: resolvedBrowser,
    headless: integrationConfig.headless === true,
    max_repair_attempts:
      integrationConfig.healing_enabled === false
        ? 0
        : Math.max(0, normalizeInteger(integrationConfig.max_repair_attempts, 1) ?? 1),
    run_timeout_seconds: Math.max(60, normalizeInteger(integrationConfig.run_timeout_seconds, 1800) ?? 1800),
    timeouts: {
      navigation_timeout_ms: Math.max(1000, normalizeInteger(integrationConfig.navigation_timeout_ms, 30000) ?? 30000),
      action_timeout_ms: Math.max(250, normalizeInteger(integrationConfig.action_timeout_ms, 5000) ?? 5000),
      assertion_timeout_ms: Math.max(250, normalizeInteger(integrationConfig.assertion_timeout_ms, 10000) ?? 10000),
      recovery_wait_ms: Math.max(100, normalizeInteger(integrationConfig.recovery_wait_ms, 750) ?? 750)
    },
    web_engine: {
      active: normalizeTestEngineWebEngine(integrationConfig.active_web_engine, "playwright")
    },
    mobile_engine: {
      active: normalizeText(integrationConfig.active_mobile_engine) || "local-appium",
      recorder_mode: normalizeText(integrationConfig.mobile_recorder_mode) || "local",
      appium_server_url: normalizeText(integrationConfig.appium_server_url) || null,
      cloud_provider: normalizeText(integrationConfig.mobile_cloud_provider) || null,
      device_name:
        normalizeText(execution.test_configuration?.snapshot?.device_name)
        || normalizeText(integrationConfig.device_name)
        || null,
      platform_version:
        normalizeText(execution.test_configuration?.snapshot?.platform_version)
        || normalizeText(integrationConfig.platform_version)
        || null,
      app: normalizeText(integrationConfig.android_app) || normalizeText(integrationConfig.app) || null
    },
    manual_spec: buildManualSpec({ caseSnapshot, steps, execution }),
    steps,
    suite_parameters: normalizeStringRecord(caseSnapshot.suite_parameter_values),
    case_parameters: normalizeStringRecord(caseSnapshot.parameter_values),
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
          browser: execution.test_configuration.snapshot?.browser || null,
          mobile_os: execution.test_configuration.snapshot?.mobile_os || null,
          platform_version: execution.test_configuration.snapshot?.platform_version || null,
          variables: toEngineKeyValueEntries(execution.test_configuration.snapshot?.variables)
        }
      : null,
    data_set: execution.test_data_set
      ? {
          name: execution.test_data_set.name,
          mode: execution.test_data_set.snapshot?.mode === "key_value" ? "key_value" : "table",
          columns: Array.isArray(execution.test_data_set.snapshot?.columns)
            ? execution.test_data_set.snapshot.columns.map((entry) => String(entry))
            : [],
          rows: toEngineDataSetRows(execution.test_data_set.snapshot?.rows)
        }
      : null,
    artifact_policy: {
      trace_mode: normalizeText(integrationConfig.trace_mode) || "off",
      video_mode: normalizeText(integrationConfig.video_mode) || "off",
      screenshot_on_failure: true,
      capture_console: integrationConfig.capture_console !== false,
      capture_network: integrationConfig.capture_network !== false,
      artifact_retention_days: Math.max(1, normalizeInteger(integrationConfig.artifact_retention_days, 7) ?? 7),
      max_video_attachment_mb: Math.max(1, normalizeInteger(integrationConfig.max_video_attachment_mb, 25) ?? 25)
    },
    callback: null
  };
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

  return {
    ...row,
    payload: normalizeJsonValue(row.payload, {}),
    runtime_state: parseRuntimeState(row.runtime_state)
  };
};

const buildRuntimeParameterValues = (envelope, capturedValues = {}) => {
  const values = {};

  Object.entries(envelope.suite_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`s.${normalizedKey.replace(/^s\./, "")}`] = String(value ?? "");
  });

  Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
  });

  Object.entries(envelope.manual_spec?.test_data || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();
    if (!normalizedKey) {
      return;
    }
    values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
  });

  (envelope.environment?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    values[`r.${normalizeText(entry.key).replace(/^r\./, "").toLowerCase()}`] = String(entry.value ?? "");
  });

  (envelope.configuration?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    values[`r.${normalizeText(entry.key).replace(/^r\./, "").toLowerCase()}`] = String(entry.value ?? "");
  });

  if (envelope.data_set?.mode === "key_value") {
    (envelope.data_set.rows || []).forEach((row) => {
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeText(key)?.toLowerCase();

        if (!normalizedKey) {
          return;
        }

        values[`t.${normalizedKey}`] = String(value ?? "");
      });
    });
  } else if (Array.isArray(envelope.data_set?.rows) && envelope.data_set.rows.length) {
    Object.entries(envelope.data_set.rows[0] || {}).forEach(([key, value]) => {
      const normalizedKey = normalizeText(key)?.toLowerCase();

      if (!normalizedKey) {
        return;
      }

      values[`t.${normalizedKey}`] = String(value ?? "");
    });
  }

  return {
    ...values,
    ...normalizeCapturedValuesRecord(capturedValues)
  };
};

const resultStatusToJobStatus = (status) => {
  if (status === "passed") {
    return "completed";
  }

  if (status === "aborted") {
    return "aborted";
  }

  return "failed";
};

async function planExecutionDispatch(execution) {
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

  for (const caseSnapshot of execution.case_snapshots || []) {
    const caseRecord = await selectTestCaseDispatchMetadata.get(caseSnapshot.test_case_id);

    if (caseRecord?.automated !== "yes") {
      manualCaseCount += 1;
      continue;
    }

    automatedCaseCount += 1;

    const rawSteps = stepsByCaseId.get(caseSnapshot.test_case_id) || [];

    if (!rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(`${caseSnapshot.test_case_title}: automated case has no snapped steps to queue.`);
      continue;
    }

    const stepWarnings = [];
    const normalizedSteps = rawSteps.map((stepSnapshot) => {
      const stepType = resolveEngineStepType(stepSnapshot.step_type, appType?.type || null);

      if (!stepType) {
        stepWarnings.push(
          `${caseSnapshot.test_case_title}: step ${stepSnapshot.step_order} is not part of the current engine-supported API/web path.`
        );
        return null;
      }

      return {
        id: stepSnapshot.snapshot_step_id,
        order: stepSnapshot.step_order,
        step_type: stepType,
        action: normalizeText(stepSnapshot.action),
        expected_result: normalizeText(stepSnapshot.expected_result),
        automation_code: normalizeRichText(stepSnapshot.automation_code),
        api_request: stepType === "api" ? normalizeApiRequest(stepSnapshot.api_request) : null,
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

    const engineRunId = uuid();
    eligibleCases.push({
      engine_run_id: engineRunId,
      case_snapshot: caseSnapshot,
      case_record: caseRecord,
      envelope: null,
      steps: normalizedSteps
    });
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
    eligibleCases: eligibleCases.sort((left, right) =>
      Number(left.case_snapshot.sort_order || 0) - Number(right.case_snapshot.sort_order || 0)
    )
  };
}

async function settleExecutionIfComplete(executionId) {
  const requiredCaseIds = new Set(
    (await selectExecutionCaseIds.all(executionId))
      .map((row) => normalizeText(row.test_case_id))
      .filter(Boolean)
  );

  if (!requiredCaseIds.size) {
    return;
  }

  const latestResults = await selectLatestResultsForExecution.all(executionId);
  const latestStatusByCaseId = new Map(
    latestResults.map((result) => [normalizeText(result.test_case_id), normalizeText(result.status)])
  );

  if (
    [...requiredCaseIds].some((testCaseId) => !latestStatusByCaseId.has(testCaseId))
    || [...latestStatusByCaseId.values()].some((status) => status === "running")
  ) {
    return;
  }

  const nextExecutionStatus = [...latestStatusByCaseId.values()].every((status) => status === "passed")
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
      const envelope = buildEngineEnvelope({
        engineRunId: item.engine_run_id,
        execution: plan.execution,
        project: plan.project,
        appType: plan.appType,
        caseSnapshot: item.case_snapshot,
        steps: item.steps,
        integration
      });

      const transaction = await workspaceTransactionService.createTransaction({
        project_id: plan.execution.project_id,
        app_type_id: plan.execution.app_type_id || null,
        category: "automation",
        action: "testengine_run",
        status: "queued",
        title: `Automated handoff for ${item.case_snapshot.test_case_title}`,
        description: "Queued for Test Engine execution.",
        metadata: {
          source: "qaira",
          engine_run_id: item.engine_run_id,
          execution_id: plan.execution.id,
          test_case_id: item.case_snapshot.test_case_id,
          engine_host: normalizeEngineHostUrl(integration.base_url),
          queue_mode: "qaira-pull",
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
    throw new Error("Local run requires a local host recorder URL. Start local-run/bin/start-host-recorder.sh first.");
  }

  const activeWebEngine = "playwright";
  const directIntegration = {
    ...(integration || {}),
    base_url: engineHost,
    config: {
      ...(integration?.config || {}),
      active_web_engine: activeWebEngine,
      headless: false,
      live_view_url: `${engineHost}/api/v1/live-session?provider=playwright`
    }
  };
  const callback = buildDirectCallback(directIntegration);

  for (const item of plan.eligibleCases) {
    const envelope = {
      ...buildEngineEnvelope({
        engineRunId: item.engine_run_id,
        execution: plan.execution,
        project: plan.project,
        appType: plan.appType,
        caseSnapshot: item.case_snapshot,
        steps: item.steps,
        integration: directIntegration
      }),
      callback
    };
    const liveViewUrl = buildProviderLiveViewUrl(directIntegration, activeWebEngine);
    const transactionMetadata = {
      source: "qaira.local-run",
      engine_run_id: item.engine_run_id,
      execution_id: plan.execution.id,
      test_case_id: item.case_snapshot.test_case_id,
      engine_host: engineHost,
      queue_mode: "direct-local",
      active_web_engine: activeWebEngine,
      live_view_url: liveViewUrl,
      callback_url: callback.url
    };
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: "automation",
      action: "testengine_run",
      status: "running",
      title: `Local run for ${item.case_snapshot.test_case_title}`,
      description: "Running immediately on the local Playwright host recorder.",
      metadata: transactionMetadata,
      related_kind: "testengine_run",
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null,
      started_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "info",
      phase: "local-run.started",
      message: `Started ${item.case_snapshot.test_case_title} on the local Playwright runner.`,
      details: {
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_run_id: item.engine_run_id,
        engine_host: engineHost,
        live_view_url: liveViewUrl
      }
    });

    let response;
    try {
      response = await fetch(`${engineHost}/api/v1/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(envelope)
      });
    } catch (error) {
      await updateQueueTransaction(transaction.id, {
        status: "failed",
        metadata: {
          ...transactionMetadata,
          failure: error instanceof Error ? error.message : "Unable to reach local runner"
        },
        completed_at: new Date().toISOString()
      });
      throw new Error(`Unable to reach local Playwright runner at ${engineHost}: ${error instanceof Error ? error.message : "request failed"}`);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      await updateQueueTransaction(transaction.id, {
        status: "failed",
        metadata: {
          ...transactionMetadata,
          failure: payload?.message || `Local runner failed with status ${response.status}`
        },
        completed_at: new Date().toISOString()
      });
      throw new Error(payload?.message || `Local runner failed with status ${response.status}`);
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
  existingLogs = null
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
    group_name: normalizeText(stepSnapshot.group_name),
    group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
      ? stepSnapshot.group_kind
      : null
  };
  const engineRunId = uuid();
  const envelope = buildEngineEnvelope({
    engineRunId,
    execution,
    project,
    appType,
    caseSnapshot,
    steps: [step],
    integration
  });
  const activeWebEngine = envelope.web_engine?.active || "playwright";
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
      source: "qaira.execution-console",
      single_step: true,
      engine_run_id: engineRunId,
      execution_id: execution.id,
      test_case_id: caseSnapshot.test_case_id,
      step_id: step.id,
      engine_host: normalizeEngineHostUrl(integration.base_url),
      queue_mode: "qaira-pull",
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
  const runtimeCapturedValues = normalizeCapturedValuesRecord(capturedValues);
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

const leaseNextQueuedJobTransaction = db.transaction(async ({ worker_id, engine_host, lease_seconds } = {}) => {
  const normalizedWorkerId = normalizeText(worker_id) || "testengine-worker";
  const normalizedEngineHost = normalizeEngineHostUrl(engine_host);
  const safeLeaseSeconds = Math.max(30, Number(lease_seconds) || DEFAULT_LEASE_SECONDS);
  const findCandidate = async (scopedEngineHost = null) => {
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

    if (scopedEngineHost) {
      query += ` AND (engine_host IS NULL OR engine_host = ?)`;
      params.push(scopedEngineHost);
    }

    query += ` ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

    const result = await db.query(query, params);
    return result.rows[0] || null;
  };

  let row = await findCandidate(normalizedEngineHost);

  if (!row && normalizedEngineHost) {
    row = await findCandidate(null);
  }

  if (!row) {
    return null;
  }

  const leaseExpiresAt = new Date(Date.now() + safeLeaseSeconds * 1000).toISOString();

  await db.query(
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

  const leased = await getQueuedJob(row.id);

  if (leased.transaction_id) {
    await appendQueueTransactionEvent(leased.transaction_id, {
      level: "info",
      phase: "queue.leased",
      message: `${leased.test_case_title} was leased by the Test Engine worker.`,
      details: {
        job_id: leased.id,
        worker_id: normalizedWorkerId,
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
  const byStatus = rows.reduce((accumulator, row) => {
    accumulator[row.status] = Number(row.count) || 0;
    return accumulator;
  }, {});
  const queued = byStatus.queued || 0;
  const leased = byStatus.leased || 0;
  const running = byStatus.running || 0;
  const pending = queued + leased + running;
  const recommendedWorkers = Math.max(1, Math.min(3, queued > 3 ? 3 : queued > 1 ? 2 : 1));

  return {
    queued,
    leased,
    running,
    pending,
    max_workers: 3,
    recommended_workers: recommendedWorkers
  };
};

exports.startQueuedJob = async ({ job_id, worker_id } = {}) => {
  const job = await getQueuedJob(job_id);
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
    executed_by: job.created_by || null
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
};

exports.executeQueuedApiStep = async ({ job_id, step_id } = {}) => {
  const job = await getQueuedJob(job_id);

  if (!job.payload?.steps?.length) {
    throw new Error("Queued job payload is missing step data");
  }

  const step = job.payload.steps.find((entry) => entry.id === step_id);

  if (!step) {
    throw new Error("Queued job step not found");
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const existingLogs = parseStructuredLogs(runtimeState.logs);
  const parameterValues = buildRuntimeParameterValues(job.payload, runtimeState.captured_values);
  const stepResult = await apiRequestExecutionService.executeApiRequestStep({
    api_request: step.api_request,
    parameter_values: parameterValues
  });
  const normalizedStepCaptures = normalizeCapturedValuesRecord(stepResult.captures);
  const formattedStepNote = executionStepRuntimeService.formatApiStepEvidenceNote(stepResult);
  const mergedLogs = {
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
  };
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
    stepResult.status === "failed" ? stepResult.note : null,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: caseStatus,
    duration_ms: durationMs,
    error: stepResult.status === "failed" ? stepResult.note : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: job.created_by || null
  });

  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: stepResult.status === "failed" ? "error" : "info",
      phase: stepResult.status === "failed" ? "step.failed" : "step.completed",
      message: stepResult.note,
      details: {
        job_id: job.id,
        step_id: step.id,
        step_order: step.order,
        execution_result_id: result.id,
        captures: stepResult.captures
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
      step_detail: stepResult.detail,
      step_evidence: stepResult.evidence,
      captures: stepResult.captures
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
};

exports.reportQueuedStep = async ({
  job_id,
  step_id,
  status,
  note,
  evidence,
  api_detail,
  web_detail,
  captures,
  recovery_attempted,
  recovery_succeeded
} = {}) => {
  const job = await getQueuedJob(job_id);

  if (!job.payload?.steps?.length) {
    throw new Error("Queued job payload is missing step data");
  }

  const step = job.payload.steps.find((entry) => entry.id === step_id);

  if (!step) {
    throw new Error("Queued job step not found");
  }

  const normalizedStatus = normalizeText(status);

  if (!["passed", "failed", "blocked"].includes(normalizedStatus)) {
    throw new Error("Queued step status must be passed, failed, or blocked");
  }

  const runtimeState = parseRuntimeState(job.runtime_state);
  const existingLogs = parseStructuredLogs(runtimeState.logs);
  const normalizedEvidence = normalizeInlineEvidence(evidence);
  const normalizedApiDetail = normalizeApiDetail(api_detail);
  const normalizedWebDetail = normalizeWebDetail(web_detail);
  const normalizedCaptures = normalizeCapturedValuesRecord(captures);
  const recoveryAttempted = Boolean(recovery_attempted);
  const recoverySucceeded = Boolean(recovery_succeeded);
  const mergedLogs = {
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
  };
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
  const errorMessage = normalizedStatus === "failed" ? normalizeText(note) || `${job.test_case_title} failed on step ${step.order}.` : null;

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
    executed_by: job.created_by || null
  });

  if (job.transaction_id) {
    await appendQueueTransactionEvent(job.transaction_id, {
      level: normalizedStatus === "failed" ? "error" : normalizedStatus === "blocked" ? "warning" : "info",
      phase: normalizedStatus === "failed" ? "step.failed" : normalizedStatus === "blocked" ? "step.blocked" : "step.completed",
      message: normalizeText(note) || `${job.test_case_title}: step ${step.order} ${normalizedStatus}.`,
      details: {
        job_id: job.id,
        step_id: step.id,
        step_order: step.order,
        execution_result_id: result.id,
        captures: normalizedCaptures,
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
      summary: normalizeText(note) || `${job.test_case_title}: step ${step.order} ${normalizedStatus}.`,
      execution_result_id: result.id,
      step_status: normalizedStatus,
      step_note: normalizeText(note) || "",
      step_detail: normalizedApiDetail,
      web_detail: normalizedWebDetail,
      step_evidence: normalizedEvidence,
      captures: normalizedCaptures
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
};

exports.completeQueuedJob = async ({
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
  const runtimeState = parseRuntimeState(job.runtime_state);
  const logs = parseStructuredLogs(runtimeState.logs);
  const stepIds = Array.isArray(job.payload?.steps) ? job.payload.steps.map((step) => step.id) : [];
  const resolvedStatuses = stepIds.map((stepId) => logs.stepStatuses[stepId]).filter(Boolean);
  const derivedStatus = resolvedStatuses.includes("failed")
    ? "failed"
    : stepIds.length && resolvedStatuses.length === stepIds.length && resolvedStatuses.every((value) => value === "passed")
      ? "passed"
      : resolvedStatuses.includes("blocked")
        ? "blocked"
        : "blocked";
  let finalStatus = normalizeText(status);

  if (finalStatus !== "passed" && finalStatus !== "failed" && finalStatus !== "blocked") {
    finalStatus = derivedStatus;
  } else if (finalStatus === "passed" && derivedStatus !== "passed") {
    finalStatus = derivedStatus;
  }

  const startedAt = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 0);
  const errorMessage = normalizeText(error) || (finalStatus === "failed" ? "API execution failed." : null);
  const normalizedSummary =
    normalizeText(summary)
    || runtimeState.final_summary
    || (finalStatus === "passed"
      ? `${job.test_case_title} completed successfully.`
      : errorMessage || `${job.test_case_title} finished with ${finalStatus}.`);
  const normalizedArtifactBundle = normalizeArtifactBundle(artifact_bundle);
  const normalizedPatchProposals = normalizePatchProposals(patch_proposals);
  const nextRuntimeState = {
    ...runtimeState,
    logs,
    deterministic_attempted:
      deterministic_attempted === undefined
        ? runtimeState.deterministic_attempted || true
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

  await finalizeJobState.run(
    resultStatusToJobStatus(finalStatus),
    nextRuntimeState,
    completedAt,
    errorMessage,
    job.id
  );

  const result = await executionResultService.upsertExecutionResult({
    execution_id: job.execution_id,
    test_case_id: job.test_case_id,
    app_type_id: job.app_type_id,
    status: finalStatus,
    duration_ms: durationMs,
    error: errorMessage,
    logs: JSON.stringify(logs),
    executed_by: job.created_by || null
  });

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
};

exports.failQueuedJob = async ({ job_id, message } = {}) => {
  return exports.completeQueuedJob({
    job_id,
    status: "failed",
    error: normalizeText(message) || "Test Engine execution failed."
  });
};

exports.getQueuedJob = getQueuedJob;
exports.planExecutionDispatch = planExecutionDispatch;
exports.queueExecutionDispatch = queueExecutionDispatch;
exports.runExecutionDirectLocal = runExecutionDirectLocal;
exports.queueSingleStepDispatch = queueSingleStepDispatch;
exports.settleExecutionIfComplete = settleExecutionIfComplete;
