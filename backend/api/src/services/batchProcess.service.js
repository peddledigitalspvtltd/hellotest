const db = require("../db");
const { v4: uuid } = require("uuid");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const QUEUED_BATCH_LIMIT = 1;

const insertJob = db.prepare(`
  INSERT INTO batch_process_jobs (
    id,
    transaction_id,
    operation,
    payload,
    status
  )
  VALUES (?, ?, ?, ?, 'queued')
`);

const selectQueuedJobs = db.prepare(`
  SELECT *
  FROM batch_process_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`);

const markJobRunning = db.prepare(`
  UPDATE batch_process_jobs
  SET status = 'running',
      attempts = attempts + 1,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markJobCompleted = db.prepare(`
  UPDATE batch_process_jobs
  SET status = 'completed',
      result = ?,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markJobFailed = db.prepare(`
  UPDATE batch_process_jobs
  SET status = 'failed',
      result = ?,
      last_error = ?,
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
      failed,
      progress_percent: progressPercent,
      ...metadata
    },
    metadata: {
      processed_items: processed,
      total_items: total,
      imported,
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

  for (const [index, testCase] of cases.entries()) {
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

    const processed = index + 1;
    if (processed === cases.length || processed === 1 || processed % 10 === 0) {
      await appendProgressEvent(job.transaction_id, {
        phase: "export",
        message: `Prepared ${processed} of ${cases.length} test case${cases.length === 1 ? "" : "s"}.`,
        processed,
        total: cases.length
      });
    }
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
    const jobs = await selectQueuedJobs.all(QUEUED_BATCH_LIMIT);

    for (const job of jobs) {
      const operation = normalizeText(job.operation);
      const handler = operation ? JOB_HANDLERS[operation] : null;

      try {
        if (!handler) {
          throw new Error(`Unsupported batch operation: ${operation || "unknown"}`);
        }

        await markJobRunning.run(job.id);
        await workspaceTransactionService.updateTransaction(job.transaction_id, {
          status: "running",
          started_at: new Date().toISOString(),
          metadata: {
            current_phase: "running"
          }
        });
        const result = await handler(job);
        await markJobCompleted.run(result || {}, job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Batch process failed";
        const result = { error: message };

        await markJobFailed.run(result, message, job.id);
        await workspaceTransactionService.updateTransaction(job.transaction_id, {
          status: "failed",
          description: message,
          metadata: {
            current_phase: "failed",
            error: message
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
