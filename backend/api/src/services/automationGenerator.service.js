const db = require("../db");
const obsDb = require("../obsDb");
const { v4: uuid } = require("uuid");
const workspaceTransactionService = require("./workspaceTransaction.service");
const aiAutomationBuilderService = require("./aiAutomationBuilder.service");

const DEFAULT_LEASE_SECONDS = Math.max(30, Number(process.env.AUTOMATION_GENERATOR_LEASE_SECONDS || 180));

const selectCaseWithScope = db.prepare(`
  SELECT test_cases.*, app_types.project_id, app_types.type AS app_type_kind
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.id = ?
`);

const insertJob = obsDb.prepare(`
  INSERT INTO automation_generator_jobs (
    id,
    transaction_id,
    project_id,
    app_type_id,
    test_case_id,
    payload,
    runtime_state,
    result,
    status,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, '{}'::jsonb, '{}'::jsonb, 'queued', ?)
`);

const selectJob = obsDb.prepare(`
  SELECT *
  FROM automation_generator_jobs
  WHERE id = ?
`);

const selectQueuedJob = obsDb.prepare(`
  SELECT *
  FROM automation_generator_jobs
  WHERE status = 'queued'
     OR (status = 'leased' AND lease_expires_at < CURRENT_TIMESTAMP)
  ORDER BY created_at ASC, id ASC
  LIMIT 1
`);

const leaseJob = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'leased',
      attempts = attempts + 1,
      leased_by = ?,
      lease_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND (status = 'queued' OR (status = 'leased' AND lease_expires_at < CURRENT_TIMESTAMP))
`);

const markRunning = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'running',
      runtime_state = ?,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      lease_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markCompleted = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'completed',
      result = ?,
      runtime_state = ?,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markFailed = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'failed',
      result = ?,
      runtime_state = ?,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const normalizeText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const parseJson = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const serialize = (value) => JSON.stringify(value || {});

const normalizeJob = (job) => job
  ? {
      ...job,
      payload: parseJson(job.payload),
      runtime_state: parseJson(job.runtime_state),
      result: parseJson(job.result)
    }
  : null;

exports.queueGeneratorJob = async ({
  test_case_id,
  integration_id,
  start_url,
  additional_context,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  created_by
} = {}) => {
  const testCaseId = normalizeText(test_case_id);

  if (!testCaseId) {
    throw new Error("test_case_id is required");
  }

  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const transaction = await workspaceTransactionService.createTransaction({
    project_id: testCase.project_id || null,
    app_type_id: testCase.app_type_id || null,
    category: "automation_build",
    action: "automation_generator_run",
    status: "queued",
    title: `Generator run for ${testCase.title}`,
    description: "Queued for the local LLM automation generator agent.",
    metadata: {
      current_phase: "generator.queued",
      progress_percent: 0,
      total_items: 1,
      processed_items: 0,
      test_case_id: testCaseId,
      test_environment_id: normalizeText(test_environment_id),
      test_configuration_id: normalizeText(test_configuration_id),
      test_data_set_id: normalizeText(test_data_set_id),
      agent_kind: "local-llm"
    },
    related_kind: "test_case",
    related_id: testCaseId,
    created_by
  });
  const jobId = uuid();
  const payload = {
    test_case_id: testCaseId,
    title: testCase.title,
    app_type_id: testCase.app_type_id,
    app_type_kind: testCase.app_type_kind,
    integration_id: normalizeText(integration_id),
    start_url: normalizeText(start_url),
    additional_context: normalizeText(additional_context),
    test_environment_id: normalizeText(test_environment_id),
    test_configuration_id: normalizeText(test_configuration_id),
    test_data_set_id: normalizeText(test_data_set_id)
  };

  await insertJob.run(
    jobId,
    transaction.id,
    testCase.project_id || null,
    testCase.app_type_id || null,
    testCaseId,
    payload,
    created_by || null
  );
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "generator.queued",
    message: "Automation generator job queued for the local LLM agent.",
    details: {
      job_id: jobId,
      test_case_id: testCaseId,
      agent_kind: "local-llm"
    }
  });

  return {
    job_id: jobId,
    transaction_id: transaction.id,
    queued: true,
    status: "queued"
  };
};

exports.getJob = async (id) => {
  const job = normalizeJob(await selectJob.get(id));

  if (!job) {
    throw new Error("Automation generator job not found");
  }

  return job;
};

exports.leaseNextJob = async ({ worker_id, lease_seconds } = {}) => {
  const workerId = normalizeText(worker_id) || "local-llm-agent";
  const leaseSeconds = Math.max(30, Math.min(900, Number(lease_seconds) || DEFAULT_LEASE_SECONDS));
  const candidate = await selectQueuedJob.get();

  if (!candidate) {
    return null;
  }

  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const result = await leaseJob.run(workerId, leaseExpiresAt, candidate.id);

  if (!result.changes) {
    return null;
  }

  const job = await exports.getJob(candidate.id);
  await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
    phase: "generator.leased",
    message: `Local automation generator leased the job as ${workerId}.`,
    details: {
      job_id: job.id,
      worker_id: workerId,
      lease_expires_at: leaseExpiresAt
    }
  });

  return job;
};

exports.runLeasedJob = async ({ job_id, worker_id, agent_plan, llm_model } = {}) => {
  const job = await exports.getJob(job_id);

  if (!["leased", "running"].includes(job.status)) {
    throw new Error("Automation generator job must be leased before it can run");
  }

  const payload = job.payload || {};
  const runtimeState = {
    ...(job.runtime_state || {}),
    worker_id: normalizeText(worker_id) || job.leased_by || null,
    llm_model: normalizeText(llm_model),
    agent_plan: normalizeText(agent_plan),
    current_phase: "generator.building"
  };
  const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString();

  await markRunning.run(serialize(runtimeState), leaseExpiresAt, job.id);
  await workspaceTransactionService.updateTransaction(job.transaction_id, {
    status: "running",
    description: "Local LLM agent is building automation with TestEngine assistance.",
    metadata: {
      current_phase: "generator.building",
      progress_percent: 30,
      worker_id: runtimeState.worker_id,
      llm_model: runtimeState.llm_model
    },
    started_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
    phase: "generator.plan.ready",
    message: "Local LLM agent produced a build plan and handed it to the automation builder.",
    details: {
      job_id: job.id,
      worker_id: runtimeState.worker_id,
      llm_model: runtimeState.llm_model,
      agent_plan: runtimeState.agent_plan
    }
  });

  try {
    const result = await aiAutomationBuilderService.buildAutomationForCase({
      test_case_id: payload.test_case_id || job.test_case_id,
      integration_id: payload.integration_id,
      created_by: job.created_by,
      start_url: payload.start_url,
      test_environment_id: payload.test_environment_id,
      test_configuration_id: payload.test_configuration_id,
      test_data_set_id: payload.test_data_set_id,
      additional_context: [
        payload.additional_context,
        runtimeState.agent_plan ? `Local LLM generator plan:\n${runtimeState.agent_plan}` : null
      ].filter(Boolean).join("\n\n"),
      transaction_id: job.transaction_id,
      transaction_action: "automation_generator_run",
      transaction_title: `Generator run for ${payload.title || job.test_case_id}`,
      transaction_description: "Local LLM agent is building automation with TestEngine assistance."
    });
    const nextRuntimeState = {
      ...runtimeState,
      current_phase: "generator.completed",
      generated_step_count: result.generated_step_count,
      learned_locator_count: result.learned_locator_count
    };

    await markCompleted.run(serialize(result), serialize(nextRuntimeState), job.id);
    await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
      level: result.generated_step_count ? "success" : "warning",
      phase: "generator.completed",
      message: result.summary || "Automation generator completed.",
      details: {
        job_id: job.id,
        generated_step_count: result.generated_step_count,
        learned_locator_count: result.learned_locator_count
      }
    });

    return {
      job_id: job.id,
      status: "completed",
      result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation generator failed";
    const nextRuntimeState = {
      ...runtimeState,
      current_phase: "generator.failed",
      error: message
    };

    await markFailed.run(serialize({ error: message }), serialize(nextRuntimeState), message, job.id);
    await workspaceTransactionService.updateTransaction(job.transaction_id, {
      status: "failed",
      description: message,
      metadata: {
        current_phase: "generator.failed",
        progress_percent: 100,
        error: message
      },
      completed_at: new Date().toISOString()
    });
    await workspaceTransactionService.appendTransactionEvent(job.transaction_id, {
      level: "error",
      phase: "generator.failed",
      message,
      details: {
        job_id: job.id
      }
    });
    throw error;
  }
};
