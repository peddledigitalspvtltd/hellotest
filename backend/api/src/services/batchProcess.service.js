const db = require("../db");
const obsDb = require("../obsDb");
const { randomUUID: uuid } = require("crypto");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

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
    status
  )
  VALUES (?, ?, ?, ?, 'queued')
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
  WHERE id = ?
`);

const markJobRetryQueued = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'queued',
      next_run_at = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markJobCompleted = obsDb.prepare(`
  UPDATE batch_process_jobs
  SET status = 'completed',
      result = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
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
  WHERE id = ?
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
  SELECT id, project_id, name
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
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const message = String(error?.message || error || "").toLowerCase();
  return [
    "rate limit",
    "too many requests",
    "token",
    "quota",
    "temporarily",
    "timeout",
    "timed out",
    "econnreset",
    "socket hang up",
    "service unavailable"
  ].some((token) => message.includes(token));
};

const isAiCapacityError = (error) => {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const message = String(error?.message || error || "").toLowerCase();
  return statusCode === 429
    || message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("token")
    || message.includes("quota");
};

const resolveRetryDelayMs = (error, attempt) => {
  const retryAfterMs = Number(error?.retryAfterMs || 0);

  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return isAiCapacityError(error)
      ? Math.min(Math.max(retryAfterMs, AI_RECOVERY_DELAY_MS), MAX_RETRY_DELAY_MS)
      : Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
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
  (normalizeText(value) || "qaira")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  || "qaira";

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

exports.queueBatchJob = async ({
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
  payload
} = {}) => {
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
      ...metadata
    },
    related_kind,
    related_id,
    created_by
  });
  const transaction = await workspaceTransactionService.getTransaction(createdTransaction.id);
  const id = uuid();

  await insertJob.run(id, transaction.id, normalizedOperation, normalizePayload(payload));
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "queued",
    message: `${transaction.title} queued for background processing.`,
    details: {
      job_id: id,
      operation: normalizedOperation
    }
  });
  await workspaceTransactionService.createTransactionNotification(transaction.id, {
    type: "batch_process.queued",
    title: transaction.title,
    message: `${transaction.title} was queued. Open the batch process to track progress.`
  });
  exports.triggerProcessing();

  return {
    id: transaction.id,
    transaction_id: transaction.id,
    job_id: id,
    queued: true,
    status: "queued"
  };
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
    title: "Requirement import",
    description: `Queued ${rows.length} requirement${rows.length === 1 ? "" : "s"} for import.`,
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

exports.queueTestCaseExport = async ({ app_type_id, test_case_ids = [], created_by } = {}) => {
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
      created_by
    }
  });
};

exports.queueAutomationBuild = async ({
  app_type_id,
  test_case_ids = [],
  integration_id,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  failure_threshold,
  additional_context,
  created_by
} = {}) => {
  const appType = app_type_id ? await selectAppType.get(app_type_id) : null;

  if (!appType) {
    throw new Error("App type not found");
  }

  const selectedCaseCount = Array.isArray(test_case_ids) ? test_case_ids.length : 0;

  return exports.queueBatchJob({
    project_id: appType.project_id,
    app_type_id,
    category: "automation_build",
    action: "batch_case_automation_build",
    title: "Batch AI automation",
    description: selectedCaseCount
      ? `Queued ${selectedCaseCount} selected manual web case${selectedCaseCount === 1 ? "" : "s"} to automate with AI.`
      : "Queued manual web cases to automate with AI.",
    metadata: {
      selected_case_count: selectedCaseCount,
      total_items: selectedCaseCount,
      current_phase: "queued"
    },
    created_by,
    operation: "automation_build",
    payload: {
      app_type_id,
      test_case_ids,
      integration_id,
      start_url,
      test_environment_id,
      test_configuration_id,
      test_data_set_id,
      failure_threshold,
      additional_context,
      created_by
    }
  });
};

async function runUserImport(job) {
  const userService = require("./user.service");
  const payload = parseJsonValue(job.payload, {});
  return userService.bulkImportUsers({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runRequirementImport(job) {
  const requirementService = require("./requirement.service");
  const payload = parseJsonValue(job.payload, {});
  return requirementService.bulkImportRequirements({
    ...payload,
    transaction_id: job.transaction_id
  });
}

async function runAlmRequirementImport(job) {
  const requirementService = require("./requirement.service");
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
    "expected_result"
  ]];

  for (let offset = 0; offset < cases.length; offset += EXPORT_CHUNK_SIZE) {
    const chunk = cases.slice(offset, offset + EXPORT_CHUNK_SIZE);

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
        steps.map((step) => step.expected_result || "").join("\n")
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

async function runAutomationBuild(job) {
  const aiAutomationBuilderService = require("./aiAutomationBuilder.service");
  const payload = parseJsonValue(job.payload, {});

  return aiAutomationBuilderService.buildAutomationBatch({
    ...payload,
    transaction_id: job.transaction_id
  });
}

const JOB_HANDLERS = {
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

      try {
        if (!handler) {
          throw new Error(`Unsupported batch operation: ${operation || "unknown"}`);
        }

        const leaseExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await markJobRunning.run(workerId, leaseExpiresAt, job.id);
        await workspaceTransactionService.updateTransaction(job.transaction_id, {
          status: "running",
          started_at: new Date().toISOString(),
          metadata: {
            current_phase: "running"
          }
        });
        const result = await handler(job);
        await markJobCompleted.run(result || {}, job.id);
        const completedTransaction = await workspaceTransactionService.getTransaction(job.transaction_id);
        await workspaceTransactionService.createTransactionNotification(job.transaction_id, {
          type: "batch_process.completed",
          title: completedTransaction.title,
          message: `${completedTransaction.title} completed. Open the batch process for details and artifacts.`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Batch process failed";
        const nextAttempt = Number(job.attempts || 0) + 1;
        const maxAttempts = resolveJobMaxAttempts(job);
        const shouldRetry = nextAttempt < maxAttempts && isRetryableBatchError(error);

        if (shouldRetry) {
          const retryDelayMs = resolveRetryDelayMs(error, nextAttempt);
          const nextRunAt = new Date(Date.now() + retryDelayMs).toISOString();

          await markJobRetryQueued.run(nextRunAt, message, job.id);
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

        await markJobFailed.run(result, message, job.id);
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
      }
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
