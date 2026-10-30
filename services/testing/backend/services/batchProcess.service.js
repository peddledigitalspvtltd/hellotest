const db = require("@hellotest/platform/backend/src/db");
const { normalizeScheduledAt } = require("@hellotest/platform/backend/src/utils/automationSchedule");
const { normalizeAutomationStartUrl, requiresAutomationStartUrl } = require("@hellotest/platform/backend/src/utils/automationStartUrl");
const { resolveAutomationCaseSteps } = require('@hellotest/platform/backend/src/utils/automationCaseType');
const { captureStartUrlReview, assertQueuedStartUrlReview } = require('@hellotest/automation/backend/services/automationQueuedStartUrl.service');
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid, createHash } = require("crypto");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const { normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const {createBatchJobLease}=require('./batchJobLease');

const QUEUED_BATCH_LIMIT = Math.max(1, Number(process.env.BATCH_PROCESS_CONCURRENCY || 1));
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Number(process.env.BATCH_PROCESS_MAX_ATTEMPTS || 5));
const AI_RECOVERY_DELAY_MS = Math.max(60_000, Number(process.env.AI_RATE_LIMIT_RECOVERY_MS || 60 * 60 * 1000));
const MAX_RETRY_DELAY_MS = Math.max(60_000, Number(process.env.BATCH_PROCESS_MAX_RETRY_DELAY_MS || 60 * 60 * 1000));
const EXPORT_CHUNK_SIZE = Math.max(10, Math.min(500, Number(process.env.BATCH_EXPORT_CHUNK_SIZE || 100)));

const insertJob = obsDb.prepare(`
  INSERT INTO batch_process_jobs (
    id,
    transaction_id,
    operation,
    payload,
    status,
    next_run_at
  )
  VALUES (?, ?, ?, ?, 'queued', ?)
`);

const selectQueuedJobs = obsDb.prepare(`
  SELECT *
  FROM batch_process_jobs
  WHERE status = 'queued'
    AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`);

const requeueExpiredLeases = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'queued',
      next_run_at = CURRENT_TIMESTAMP,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= CURRENT_TIMESTAMP
`);

const markJobRunning = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'running',
      attempts = attempts + 1,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      lease_owner = ?,
      lease_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'queued'
    AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)
`);

const markJobRetryQueued = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'queued',
      next_run_at = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status='running' AND lease_owner=?
`);
const renewJobLease=obsDb.prepare(`UPDATE batch_process_jobs SET lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
 WHERE id=? AND status='running' AND lease_owner=? AND lease_expires_at>CURRENT_TIMESTAMP`);

const markJobCompleted = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'completed',
      result = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status='running' AND lease_owner=?
`);

const markJobFailed = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'failed',
      result = ?,
      last_error = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status='running' AND lease_owner=?
`);

const selectCasesForExport = db.prepare(`
  SELECT *
  FROM test_cases
  WHERE app_type_id = ?
  ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
`);

const selectStepsForExport = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const selectRequirementNamesForExport = db.prepare(`
  SELECT requirements.title
  FROM requirement_test_cases
  JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
  WHERE requirement_test_cases.test_case_id = ?
  ORDER BY requirements.title ASC
`);

const selectSuiteNamesForExport = db.prepare(`
  SELECT test_suites.name
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.test_case_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_suites.name ASC
`);

const selectAppType = db.prepare(`
  SELECT id, project_id, name, type
  FROM app_types
  WHERE id = ?
`);

const parseJsonValue = (value, fallback) => {
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

const normalizeText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const normalizePayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
};

const isRetryableBatchError = (error) => {
  if(error?.nonRetryable||error?.retryable===false||['AI_INSTRUCTION_MISSING','AI_FEATURE_UNMAPPED','AI_CONFIGURATION_INVALID','LLM_QUOTA_EXCEEDED','LLM_RATE_LIMIT_REQUEST_TOO_LARGE'].includes(error?.code))return false;
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const message = String(error?.message || error || "").toLowerCase();
  return [
    "rate limit",
    "too many requests",
    "temporarily",
    "timeout",
    "timed out",
    "econnreset",
    "socket hang up",
    "service unavailable"
  ].some((token) => message.includes(token));
};

const isAiCapacityError = (error) => {
  const statusCode = Number(error?.upstreamStatusCode || error?.upstreamStatus || error?.statusCode || error?.status || 0);
  return error?.nonRetryable !== true && error?.retryable !== false && statusCode === 429;
};

const resolveRetryDelayMs = (error, attempt) => {
  const retryAfterMs = error?.retryAfterMs == null ? null : Number(error.retryAfterMs);

  if (retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    // A provider reset is a lower bound, not a reason to wait an hour or to
    // retry earlier when its explicit delay exceeds our usual backoff cap.
    return Math.max(1_000, retryAfterMs);
  }

  if (isAiCapacityError(error)) {
    return AI_RECOVERY_DELAY_MS;
  }

  const exponentialDelay = 30_000 * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.round(Math.random() * 5_000);
  return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY_MS);
};

const resolveJobMaxAttempts = (job) => {
  const numeric = Number(job?.max_attempts || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_MAX_ATTEMPTS;
};

const safeFileLabel = (value) =>
  (normalizeText(value) || "hellotest")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  || "hellotest";

const toCsvCell = (value) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const serializeCsv = (rows) => rows.map((row) => row.map(toCsvCell).join(",")).join("\n");

const appendProgressEvent = async (transactionId, {
  phase = "progress",
  message,
  processed = 0,
  total = 0,
  imported = 0,
  exported = 0,
  failed = 0,
  metadata = {}
}) => {
  const progressPercent = total ? Math.round((Math.min(processed, total) / total) * 100) : 0;

  await workspaceTransactionService.appendTransactionEvent(transactionId, {
    phase,
    message,
    details: {
      processed_items: processed,
      total_items: total,
      imported,
      exported,
      failed,
      progress_percent: progressPercent,
      ...metadata
    },
    metadata: {
      processed_items: processed,
      total_items: total,
      imported,
      exported,
      failed,
      progress_percent: progressPercent,
      current_phase: phase,
      ...metadata
    }
  });
};

const queueBatchJobRecord = async ({
  project_id,
  app_type_id,
  category,
  action,
  title,
  description,
  metadata = {},
  related_kind,
  related_id,
  created_by,
  operation,
  payload,
  scheduled_at
} = {}) => {
  const scheduledAt = normalizeScheduledAt(scheduled_at);
  const normalizedOperation = normalizeText(operation || action);

  if (!normalizedOperation) {
    throw new Error("Batch operation is required");
  }

  const createdTransaction = await workspaceTransactionService.createTransaction({
    project_id,
    app_type_id,
    category: category || "batch_process",
    action: action || normalizedOperation,
    status: "queued",
    title: title || "Batch process",
    description: description || "Queued for background processing.",
    metadata: {
      total_items: 0,
      processed_items: 0,
      failed: 0,
      imported: 0,
      progress_percent: 0,
      current_phase: "queued",
      ...metadata,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {})
    },
    related_kind,
    related_id,
    created_by
  });
  const transaction = await workspaceTransactionService.getTransaction(createdTransaction.id);
  const id = uuid();

  await insertJob.run(id, transaction.id, normalizedOperation, normalizePayload(payload), scheduledAt);
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "queued",
    message: `${transaction.title} queued for background processing.`,
    details: {
      job_id: id,
      operation: normalizedOperation
    }
  });
  return {
    id: transaction.id,
    transaction_id: transaction.id,
    job_id: id,
    queued: true,
    status: "queued",
    scheduled_at: scheduledAt
  };
};

exports.queueBatchJob = async input => {
  const queued = await obsDb.transaction(() => queueBatchJobRecord(input))();
  await workspaceTransactionService.createTransactionNotification(queued.transaction_id, {
    type: 'batch_process.queued', title: input.title || 'Batch Process',
    message: `${input.title || 'Batch Process'} was queued. Open the batch process to track progress.`
  }).catch(() => null);
  // A worker must only observe a committed process receipt and job together.
  exports.triggerProcessing();
  return queued;
};

exports.queueUserImport = async ({ rows = [], default_role_id, created_by } = {}) =>
  exports.queueBatchJob({
    category: "bulk_import",
    action: "user_import",
    title: "Bulk user import",
    description: `Queued ${rows.length} user${rows.length === 1 ? "" : "s"} for import.`,
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length
    },
    created_by,
    operation: "user_import",
    payload: {
      rows,
      default_role_id,
      created_by
    }
  });

exports.queueRequirementImport = async ({ project_id, rows = [], created_by } = {}) =>
  exports.queueBatchJob({
    project_id,
    category: "bulk_import",
    action: "requirement_import",
    title: "Story Import",
    description: `Queued ${rows.length} Story${rows.length === 1 ? "" : "s"} for import.`,
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length
    },
    created_by,
    operation: "requirement_import",
    payload: {
      project_id,
      rows,
      created_by
    }
  });

exports.queueIssueImport = async ({ project_id, rows, created_by, import_id }) => {
  const relatedId = `${project_id}:${created_by}:${import_id}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const queued = await obsDb.transaction(async () => {
    await obsDb.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(relatedId);
    const existing = await workspaceTransactionService.findTransactionByRelated({ related_kind: "bug_import", related_id: relatedId });
    if (existing) {
      if (existing.metadata?.input_fingerprint !== fingerprint) throw Object.assign(new Error("This import ID was already used for a different file. Reload the CSV to start a new import."), { statusCode: 409 });
      return { id: existing.id, transaction_id: existing.id, queued: true, status: existing.status };
    }
    return queueBatchJobRecord({
      project_id, created_by, category: "bulk_import", action: "bug_import", operation: "bug_import",
      title: "Bug import", description: `Queued ${rows.length} bugs for import.`,
      related_kind: "bug_import", related_id: relatedId,
      metadata: { import_source: "csv", total_rows: rows.length, total_items: rows.length, input_fingerprint: fingerprint },
      payload: { project_id, rows, created_by }
    });
  })();
  exports.triggerProcessing();
  return queued;
};

exports.queueAlmRequirementImport = async ({ project_id, integration_id, alm_project_key, requirement_keys = [], created_by } = {}) =>
  exports.queueBatchJob({
    project_id,
    category: "bulk_import",
    action: "alm_requirement_import",
    title: "ALM requirement import",
    description: `Queued ${Array.isArray(requirement_keys) ? requirement_keys.length : 0} ALM requirement${Array.isArray(requirement_keys) && requirement_keys.length === 1 ? "" : "s"} for import.`,
    metadata: {
      provider: "jira",
      integration_id,
      alm_project_key,
      total_rows: Array.isArray(requirement_keys) ? requirement_keys.length : 0,
      total_items: Array.isArray(requirement_keys) ? requirement_keys.length : 0
    },
    created_by,
    operation: "alm_requirement_import",
    payload: {
      project_id,
      integration_id,
      alm_project_key,
      requirement_keys,
      created_by
    }
  });

exports.queueTestCaseImport = async ({
  app_type_id,
  requirement_id,
  import_source,
  batches,
  rows,
  created_by
} = {}) => {
  const appType = app_type_id ? await selectAppType.get(app_type_id) : null;
  const normalizedBatches = Array.isArray(batches) ? batches : [];
  const rowCount = normalizedBatches.length
    ? normalizedBatches.reduce((total, batch) => total + (Array.isArray(batch?.rows) ? batch.rows.length : 0), 0)
    : Array.isArray(rows)
      ? rows.length
      : 0;

  return exports.queueBatchJob({
    project_id: appType?.project_id || null,
    app_type_id,
    category: "bulk_import",
    action: "test_case_import",
    title: "Test case import",
    description: `Queued ${rowCount} test case row${rowCount === 1 ? "" : "s"} for import.`,
    metadata: {
      import_source: import_source || "mixed",
      total_rows: rowCount,
      total_items: rowCount
    },
    created_by,
    operation: "test_case_import",
    payload: {
      app_type_id,
      requirement_id,
      import_source,
      batches,
      rows,
      created_by
    }
  });
};

exports.queueTestCaseExport = async ({ app_type_id, test_case_ids = [], created_by, include_test_data = false, include_shared_groups = false, include_automation = false } = {}) => {
  const appType = app_type_id ? await selectAppType.get(app_type_id) : null;

  if (!appType) {
    throw new Error("App type not found");
  }

  return exports.queueBatchJob({
    project_id: appType.project_id,
    app_type_id,
    category: "bulk_export",
    action: "test_case_export",
    title: "Test case export",
    description: "Queued test case CSV export.",
    metadata: {
      export_format: "csv",
      selected_case_count: Array.isArray(test_case_ids) ? test_case_ids.length : 0
    },
    created_by,
    operation: "test_case_export",
    payload: {
      app_type_id,
      test_case_ids,
      include_test_data,
      include_shared_groups,
      include_automation,
      created_by
    }
  });
};

exports.queueAutomationBuild = db.transaction(async ({
  app_type_id,
  test_case_ids = [],
  integration_id,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver = "mcp",
  verification_driver = "native",
  start_url,
  test_environment_id,
  test_configuration_id,
  test_suite_id,
  test_suite_ids_by_case = {},
  test_data_set_id,
  parameter_values_by_case = {},
  parameter_plan_keys_by_case = {},
  failure_threshold,
  additional_context,
  agent_context,
  ai_feature,
  scheduled_at,
  created_by
} = {}) => {
  const selectedFeature = require("@hellotest/automation/backend/services/aiAutomationBuilder.service").buildFeature(ai_feature);
  ({ verification_mode, browser_driver, verification_driver } = require('@hellotest/automation/backend/lib/automationBuildPipelineOptions').normalizeBuildPipelineOptions({ verification_mode, browser_driver, verification_driver, allow_browser_actions }));
  const appType = app_type_id ? await selectAppType.get(app_type_id) : null;

  if (!appType) {
    throw new Error("App type not found");
  }

  await require('@hellotest/automation/backend/lib/automationBuildPipelineOptions').assertBuildVerificationAccess({mode:verification_mode,createdBy:created_by,projectId:appType.project_id});
  const caseIdentityAliases=new Map();
  test_case_ids=await Promise.all((Array.isArray(test_case_ids)?test_case_ids:[]).map(async id=>{
    if(!/^(?:AT[_-][0-9]+|TC[_-]?[0-9]+)$/i.test(id))return id;
    const resolved=(await require('@hellotest/platform/backend/services/entityScope.service').resolveEntityScope({entityType:'test_case',entityId:id,projectId:appType.project_id,appTypeId:app_type_id,allowDisplayId:true})).entityId;
    caseIdentityAliases.set(id,resolved);return resolved;
  }));
  const encodedIds=JSON.stringify(test_case_ids);
  const observedTargets=await db.prepare(`SELECT id FROM test_cases WHERE app_type_id=? AND automated='yes' AND
    (id IN(SELECT jsonb_array_elements_text(?::jsonb)) OR source_idempotency_key IN(SELECT 'automation-builder:'||jsonb_array_elements_text(?::jsonb))
      OR (?::boolean AND source_idempotency_key LIKE 'automation-builder:%')) ORDER BY id`).all(app_type_id,encodedIds,encodedIds,test_case_ids.length===0);
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('hellotest.automation-build'),hashtext(?))").get(app_type_id);
  const remainingTargets=observedTargets.length?await db.prepare('SELECT id FROM test_cases WHERE id IN(SELECT jsonb_array_elements_text(?::jsonb)) FOR SHARE').all(JSON.stringify(observedTargets.map(row=>row.id))):[];
  if(remainingTargets.length!==observedTargets.length)throw Object.assign(new Error('An automation target changed while this batch was being queued. Refresh the selection before starting a new build.'),{statusCode:409,code:'AUTOMATION_TARGET_CHANGED'});
  const explicitStartUrl = start_url !== undefined;
  const normalizedStartUrl = normalizeAutomationStartUrl(start_url);
  const selectedCases = await db.prepare(`SELECT source.id, source.automated, source.automation_start_url,
      source.test_data_options,
      target.id AS linked_automation_test_case_id, target.automation_start_url AS linked_automation_start_url
    FROM test_cases source
    LEFT JOIN test_cases target ON target.app_type_id=source.app_type_id
      AND target.source_idempotency_key='automation-builder:'||source.id AND target.automated='yes'
    WHERE source.app_type_id=? AND (
      source.id IN(SELECT jsonb_array_elements_text(?::jsonb)) OR
      (?::boolean AND COALESCE(source.automated,'no') <> 'yes' AND ? IN ('api','web','android','ios','unified'))
    ) ORDER BY COALESCE(source.updated_at,source.created_at) DESC,source.created_at DESC,source.id DESC
    FOR SHARE OF source`).all(app_type_id, encodedIds, test_case_ids.length === 0, appType.type);
  if (!selectedCases.length || test_case_ids.length && selectedCases.length !== new Set(test_case_ids).size) {
    throw Object.assign(new Error('Select existing cases in this application before building automation.'), { statusCode: 400, code: 'AUTOMATION_SELECTION_CHANGED' });
  }
  const selectedIds=new Set(selectedCases.map(row=>row.id));
  const scopedChoices=input=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>2000)throw Object.assign(new Error('Build choices must be keyed by selected test case IDs.'),{statusCode:400,code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
    const mapped={};
    for(const [name,value]of Object.entries(input)){
      const id=caseIdentityAliases.get(name)||name;
      if(!selectedIds.has(id)||Object.hasOwn(mapped,id))throw Object.assign(new Error('Build choices must refer once to a selected case in this application.'),{statusCode:400,code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
      mapped[id]=value;
    }
    return mapped;
  };
  parameter_values_by_case=scopedChoices(parameter_values_by_case);
  parameter_plan_keys_by_case=scopedChoices(parameter_plan_keys_by_case);
  test_suite_ids_by_case=scopedChoices(test_suite_ids_by_case);
  if(test_suite_id!=null&&(typeof test_suite_id!=='string'||!test_suite_id.trim()))throw Object.assign(new Error('Select a valid Test Suite for this build.'),{statusCode:400,code:'AUTOMATION_BUILD_SUITE_INVALID'});
  for(const value of Object.values(test_suite_ids_by_case))if(value!==null&&(typeof value!=='string'||!value.trim()))throw Object.assign(new Error('Suite selections must contain a suite ID or an explicit empty selection per case.'),{statusCode:400,code:'AUTOMATION_BUILD_SUITE_INVALID'});
  const valuesByCase={},planKeysByCase={},suitesByCase={};
  for(const row of selectedCases){
    const values=require('@hellotest/automation/backend/services/automationBuildParameterPlan.service').buildParameterValues(parameter_values_by_case?.[row.id]||{});
    const expectedKey=parameter_plan_keys_by_case?.[row.id];
    const hasSuiteChoice=Object.hasOwn(test_suite_ids_by_case,row.id);
    const suiteId=hasSuiteChoice?test_suite_ids_by_case[row.id]:test_suite_id;
    if(hasSuiteChoice||suiteId!=null||expectedKey!=null||Object.keys(values).length){
      const plan=await require('@hellotest/automation/backend/services/automationBuildParameterPlan.service').load({caseId:row.id,projectId:appType.project_id,userId:created_by,test_environment_id,test_configuration_id,test_suite_id:suiteId,test_data_set_id,parameter_values:values,expectedKey});
      planKeysByCase[row.id]=plan.parameter_plan_key;
      suitesByCase[row.id]=Object.hasOwn(plan,'test_suite_id')?plan.test_suite_id:suiteId??null;
    }
    if(Object.keys(values).length)valuesByCase[row.id]=values;
  }
  const steps = await db.prepare(`SELECT test_case_id,step_type,step_order,action,automation_code,api_request FROM test_steps
    WHERE test_case_id IN(SELECT jsonb_array_elements_text(?::jsonb)) FOR SHARE`).all(JSON.stringify(selectedCases.map(row => row.id)));
  const platformsByCaseId = new Map(selectedCases.map(testCase => [testCase.id, resolveAutomationCaseSteps(testCase, steps.filter(step => step.test_case_id === testCase.id), {appTypeKind:appType.type})]));
  const startUrlsByCaseId = Object.fromEntries(selectedCases.map(testCase => [testCase.id,
    normalizeAutomationStartUrl(explicitStartUrl ? normalizedStartUrl : testCase.automation_start_url || testCase.linked_automation_start_url, {
      required: requiresAutomationStartUrl({ appTypeKind: platformsByCaseId.get(testCase.id).automation_case_type, steps: platformsByCaseId.get(testCase.id).steps })
    })
  ]));
  const startUrlReviewsByCaseId = Object.fromEntries(selectedCases.map(testCase => [testCase.id, captureStartUrlReview(testCase,
    testCase.linked_automation_test_case_id ? { id: testCase.linked_automation_test_case_id, automation_start_url: testCase.linked_automation_start_url } : null
  )]));
  // Freeze the reviewed selection and each target for delayed jobs. A later
  // case edit must not redirect a scheduled build or add cases to its scope.
  if (!test_case_ids.length) test_case_ids = selectedCases.map(row => row.id);
  const selectedCaseCount = Array.isArray(test_case_ids) ? test_case_ids.length : 0;

  return exports.queueBatchJob({
    project_id: appType.project_id,
    app_type_id,
    category: "automation_build",
    action: "batch_case_automation_build",
    title: "Build with automation agent",
    description: selectedCaseCount
      ? `Queued ${selectedCaseCount} selected manual case${selectedCaseCount === 1 ? "" : "s"} to build with the automation agent.`
      : "Queued manual cases to build with the automation agent.",
    metadata: {
      agent_activity: true,
      input_test_case_ids: test_case_ids,
      verification_status: "unverified",
      verification_mode,
      browser_driver,
      verification_driver,
      selected_case_count: selectedCaseCount,
      total_items: selectedCaseCount,
      current_phase: "queued"
    },
    created_by,
    scheduled_at,
    operation: "automation_build",
    payload: {
      app_type_id,
      test_case_ids,
      integration_id,
      allow_browser_actions: allow_browser_actions === true,
      verification_mode,
      browser_driver,
      verification_driver,
      start_url: explicitStartUrl ? normalizedStartUrl : undefined,
      start_urls_by_case_id: startUrlsByCaseId,
      automation_case_types_by_case_id: Object.fromEntries([...platformsByCaseId].map(([id,platform])=>[id,platform.automation_case_type])),
      start_url_reviews_by_case_id: startUrlReviewsByCaseId,
      test_environment_id,
      test_configuration_id,
      test_suite_id,
      test_suite_ids_by_case:suitesByCase,
      test_data_set_id,
      parameter_values_by_case:valuesByCase,
      parameter_plan_keys_by_case:planKeysByCase,
      failure_threshold,
      additional_context,
      agent_context,
      ai_feature: selectedFeature,
      created_by
    }
  });
});

async function runUserImport(job) {
  const userService = require("@hellotest/platform/backend/services/user.service");
  const payload = parseJsonValue(job.payload, {});
  return userService.bulkImportUsers({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runRequirementImport(job) {
  const requirementService = require("@hellotest/manual/backend/services/requirement.service");
  const payload = parseJsonValue(job.payload, {});
  return requirementService.bulkImportRequirements({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runAlmRequirementImport(job) {
  const requirementService = require("@hellotest/manual/backend/services/requirement.service");
  const payload = parseJsonValue(job.payload, {});
  return requirementService.importRequirementsFromAlm({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runTestCaseImport(job) {
  const testCaseService = require("./testCase.service");
  const payload = parseJsonValue(job.payload, {});
  return testCaseService.bulkImportTestCases({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runTestCaseExport(job) {
  const payload = parseJsonValue(job.payload, {});
  const appTypeId = normalizeText(payload.app_type_id);
  const selectedCaseIds = new Set(
    (Array.isArray(payload.test_case_ids) ? payload.test_case_ids : [])
      .map((id) => normalizeText(id))
      .filter(Boolean)
  );
  const appType = appTypeId ? await selectAppType.get(appTypeId) : null;

  if (!appType) {
    throw new Error("App type not found");
  }

  await workspaceTransactionService.updateTransaction(job.transaction_id, {
    status: "running",
    started_at: new Date().toISOString(),
    description: `Exporting test cases for ${appType.name}.`,
    metadata: {
      current_phase: "exporting",
      progress_percent: 10
    }
  });

  const allCases = await selectCasesForExport.all(appTypeId);
  const cases = selectedCaseIds.size
    ? allCases.filter((testCase) => selectedCaseIds.has(testCase.id))
    : allCases;
  const sharedGroups = payload.include_shared_groups === true
    ? await db.prepare("SELECT id, name, description, authoring_mode, gherkin_document, steps, parameter_values, test_data_set_id, test_data_row_index FROM shared_step_groups WHERE app_type_id = ?").all(appTypeId)
    : [];
  const exportStep = step => {
    const { automation_code, api_request, ...metadata } = step;
    return payload.include_automation === true ? step : metadata;
  };
  const sharedGroupsById = new Map(sharedGroups.map(group => [group.id, {
    ...group,
    steps: parseJsonValue(group.steps, []).map(exportStep),
    ...(payload.include_test_data === true ? {} : { test_data_set_id: undefined, test_data_row_index: undefined })
  }]));

  await appendProgressEvent(job.transaction_id, {
    phase: "collect",
    message: `Collected ${cases.length} test case${cases.length === 1 ? "" : "s"} for export.`,
    processed: 0,
    total: cases.length
  });

  const rows = [[
    "title",
    "description",
    "automated",
    "priority",
    "status",
    "external_references",
    "requirements",
    "suites",
    "action",
    "expected_result",
    "test_data_options",
    "test_data_references",
    "steps",
    "shared_groups"
  ]];

  for (let offset = 0; offset < cases.length; offset += EXPORT_CHUNK_SIZE) {
    const chunk = cases.slice(offset, offset + EXPORT_CHUNK_SIZE);
    const dataLinks = payload.include_test_data === true ? await db.prepare(`
      SELECT link.test_case_id, link.test_data_set_id
      FROM test_case_data_sets AS link
      JOIN test_data_sets AS data ON data.id = link.test_data_set_id
        AND data.project_id = ? AND (data.app_type_id IS NULL OR data.app_type_id = ?)
      WHERE link.test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb))
    `).all(appType.project_id, appTypeId, JSON.stringify(chunk.map(item => item.id))) : [];
    const dataLinksByCase = new Map(dataLinks.map(link => [link.test_case_id, link.test_data_set_id]));

    for (const testCase of chunk) {
      const steps = await selectStepsForExport.all(testCase.id);
      const requirementNames = (await selectRequirementNamesForExport.all(testCase.id)).map((row) => row.title).filter(Boolean);
      const suiteNames = (await selectSuiteNamesForExport.all(testCase.id)).map((row) => row.name).filter(Boolean);

      rows.push([
        testCase.title,
        testCase.description || "",
        testCase.automated || "no",
        `P${testCase.priority || 3}`,
        testCase.status || "draft",
        normalizeStoredReferenceList(testCase.external_references).join("\n"),
        requirementNames.join("\n"),
        suiteNames.join("\n"),
        steps.map((step) => step.action || "").join("\n"),
        steps.map((step) => step.expected_result || "").join("\n"),
        JSON.stringify(testCase.test_data_options || {}),
        dataLinksByCase.get(testCase.id) || "",
        JSON.stringify(steps.map(exportStep)),
        JSON.stringify([...new Set(steps.map(step => step.reusable_group_id).filter(Boolean))]
          .map(id => sharedGroupsById.get(id)).filter(Boolean))
      ]);
    }

    const processed = Math.min(offset + chunk.length, cases.length);
    const chunkNumber = Math.floor(offset / EXPORT_CHUNK_SIZE) + 1;
    const chunkCount = Math.max(1, Math.ceil(cases.length / EXPORT_CHUNK_SIZE));
    await appendProgressEvent(job.transaction_id, {
      phase: "export",
      message: `Prepared export chunk ${chunkNumber} of ${chunkCount} (${processed}/${cases.length} test cases).`,
      processed,
      total: cases.length,
      exported: processed,
      metadata: {
        chunk_number: chunkNumber,
        chunk_count: chunkCount,
        chunk_size: chunk.length
      }
    });
  }

  const csv = serializeCsv(rows);
  const fileName = `${safeFileLabel(appType.name)}-test-cases.csv`;
  const artifact = await workspaceTransactionService.createTransactionArtifact(job.transaction_id, {
    file_name: fileName,
    mime_type: "text/csv; charset=utf-8",
    content: csv
  });
  const completedAt = new Date().toISOString();

  await workspaceTransactionService.updateTransaction(job.transaction_id, {
    status: "completed",
    description: `Exported ${cases.length} test case${cases.length === 1 ? "" : "s"} to ${fileName}.`,
    metadata: {
      total_items: cases.length,
      processed_items: cases.length,
      exported: cases.length,
      failed: 0,
      progress_percent: 100,
      current_phase: "completed",
      artifact_id: artifact.id,
      file_name: fileName
    },
    completed_at: completedAt
  });
  await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
    level: "success",
    phase: "complete",
    message: `Exported ${cases.length} test case${cases.length === 1 ? "" : "s"} to CSV.`,
    details: {
      artifact_id: artifact.id,
      file_name: fileName,
      exported: cases.length
    }
  });

  return {
    exported: cases.length,
    artifact_id: artifact.id,
    file_name: fileName
  };
}

async function runAutomationBuild(job,executionGuard) {
  const aiAutomationBuilderService = require("@hellotest/automation/backend/services/aiAutomationBuilder.service");
  const payload = parseJsonValue(job.payload, {});
  const ids = Array.isArray(payload.test_case_ids) ? payload.test_case_ids : [];
  const targets = await db.prepare(`SELECT source.id,app_types.type AS app_type_kind,source.test_data_options
    FROM test_cases source JOIN app_types ON app_types.id=source.app_type_id
    WHERE source.app_type_id=? AND (source.id IN(SELECT jsonb_array_elements_text(?::jsonb))
      OR (?::boolean AND COALESCE(source.automated,'no') <> 'yes' AND app_types.type IN('api','web','android','ios','unified')))
    ORDER BY source.id`).all(payload.app_type_id, JSON.stringify(ids), ids.length === 0);
  for (const target of targets) {
    await executionGuard?.ensureOwnership();
    const steps = await db.prepare('SELECT step_type,step_order,action,automation_code,api_request FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(target.id);
    const platform = resolveAutomationCaseSteps(target, steps, {appTypeKind:target.app_type_kind});
    if (payload.automation_case_types_by_case_id?.[target.id] && payload.automation_case_types_by_case_id[target.id] !== platform.automation_case_type) throw Object.assign(new Error('An automation case type changed after this batch was queued. Review the selected platforms and start a new build.'), {code:'AUTOMATION_CASE_TYPE_CHANGED',statusCode:409,nonRetryable:true});
    const required = requiresAutomationStartUrl({ appTypeKind: platform.automation_case_type, steps: platform.steps });
    const desiredStartUrl = normalizeAutomationStartUrl(payload.start_urls_by_case_id?.[target.id] ?? payload.start_url, { required });
    await assertQueuedStartUrlReview({ sourceCaseId: target.id, appTypeId: payload.app_type_id, review: payload.start_url_reviews_by_case_id?.[target.id], desiredStartUrl, required });
  }

  return aiAutomationBuilderService.buildAutomationBatch({
    ...payload,
    execution_guard: executionGuard,
    transaction_id: job.transaction_id
  });
}

const JOB_HANDLERS = {
  bug_import: job => require("./issueImport.service").run({ ...parseJsonValue(job.payload, {}), transaction_id: job.transaction_id }),
  user_import: runUserImport,
  requirement_import: runRequirementImport,
  alm_requirement_import: runAlmRequirementImport,
  test_case_import: runTestCaseImport,
  test_case_export: runTestCaseExport,
  automation_build: runAutomationBuild
};

let isProcessing = false;

exports.processQueuedJobs = async () => {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    await requeueExpiredLeases.run();
    const jobs = await selectQueuedJobs.all(QUEUED_BATCH_LIMIT);
    const workerId = `api-${process.pid}`;

    for (const job of jobs) {
      const operation = normalizeText(job.operation);
      const handler = operation ? JOB_HANDLERS[operation] : null;
      let executionGuard;

      try {
        const leaseExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const claim = await markJobRunning.run(workerId, leaseExpiresAt, job.id);
        if (claim.changes !== 1) continue;
        executionGuard=createBatchJobLease({renew:()=>renewJobLease.run(new Date(Date.now()+10*60*1000).toISOString(),job.id,workerId)});
        if (!handler) throw new Error(`Unsupported batch operation: ${operation || "unknown"}`);
        await workspaceTransactionService.updateTransaction(job.transaction_id, {
          status: "running",
          started_at: new Date().toISOString(),
          metadata: {
            current_phase: "running"
          }
        });
        const result = await handler(job,executionGuard);
        await executionGuard.ensureOwnership();
        const completed=await markJobCompleted.run(result || {}, job.id,workerId);
        if(completed.changes!==1)throw Object.assign(new Error("The job lease changed before completion."),{code:"BATCH_JOB_LEASE_LOST"});
        const completedTransaction = await workspaceTransactionService.getTransaction(job.transaction_id);
        await workspaceTransactionService.createTransactionNotification(job.transaction_id, {
          type: "batch_process.completed",
          title: completedTransaction.title,
          message: completedTransaction.metadata?.agent_activity ? `${completedTransaction.title}: ${completedTransaction.metadata.phase_message || completedTransaction.description || "Review the agent activity in Automation."}` : `${completedTransaction.title} completed. Open the batch process for details and artifacts.`
        });
      } catch (error) {
        if(executionGuard?.signal.aborted||error.code==='BATCH_JOB_LEASE_LOST')continue;
        if(executionGuard)try{await executionGuard.ensureOwnership();}catch{continue;}
        const message = error instanceof Error ? error.message : "Batch process failed";
        const nextAttempt = Number(job.attempts || 0) + 1;
        const maxAttempts = resolveJobMaxAttempts(job);
        const shouldRetry = nextAttempt < maxAttempts && isRetryableBatchError(error);

        if (shouldRetry) {
          const retryDelayMs = resolveRetryDelayMs(error, nextAttempt);
          const nextRunAt = new Date(Date.now() + retryDelayMs).toISOString();

          const requeued=await markJobRetryQueued.run(nextRunAt, message, job.id,workerId);
          if(requeued.changes!==1)continue;
          await workspaceTransactionService.updateTransaction(job.transaction_id, {
            status: "queued",
            description: isAiCapacityError(error)
              ? "Waiting for AI provider capacity before retrying this background task."
              : "Waiting to retry this background task after a temporary failure.",
            metadata: {
              current_phase: isAiCapacityError(error) ? "waiting_for_ai_capacity" : "waiting_for_retry",
              error: message,
              retry_attempt: nextAttempt,
              max_attempts: maxAttempts,
              next_run_at: nextRunAt,
              retry_after_ms: retryDelayMs
            }
          });
          await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
            level: "warning",
            phase: isAiCapacityError(error) ? "ai-capacity-wait" : "retry-wait",
            message: isAiCapacityError(error)
              ? `AI provider capacity is exhausted. HelloTest will retry around ${nextRunAt}.`
              : `Temporary failure. HelloTest will retry around ${nextRunAt}.`,
            details: {
              job_id: job.id,
              operation: operation || "unknown",
              error: message,
              retry_attempt: nextAttempt,
              max_attempts: maxAttempts,
              next_run_at: nextRunAt,
              retry_after_ms: retryDelayMs
            }
          });
          continue;
        }

        const result = {
          error: message,
          attempts: nextAttempt,
          max_attempts: maxAttempts
        };

        const failed=await markJobFailed.run(result, message, job.id,workerId);
        if(failed.changes!==1)continue;
        await workspaceTransactionService.updateTransaction(job.transaction_id, {
          status: "failed",
          description: message,
          metadata: {
            current_phase: "failed",
            error: message,
            attempts: nextAttempt,
            max_attempts: maxAttempts
          },
          completed_at: new Date().toISOString()
        });
        await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
          level: "error",
          phase: "failed",
          message,
          details: {
            job_id: job.id,
            operation: operation || "unknown",
            error: message
          }
        });
        await workspaceTransactionService.createTransactionNotification(job.transaction_id, {
          type: "batch_process.failed",
          title: "Batch process failed",
          message: message || "Batch process failed. Open the process for details."
        });
      } finally {executionGuard?.stop();}
    }
  } finally {
    isProcessing = false;
  }
};

exports.triggerProcessing = () => {
  setTimeout(() => {
    void exports.processQueuedJobs();
  }, 0);
};
