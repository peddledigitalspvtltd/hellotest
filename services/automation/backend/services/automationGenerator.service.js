const { buildFeature } = require('./aiAutomationFeaturePolicy');
const {createBatchJobLease}=require('@hellotest/testing/backend/services/batchJobLease');
const db = require("@hellotest/platform/backend/src/db");
const { normalizeScheduledAt } = require("@hellotest/platform/backend/src/utils/automationSchedule");
const { normalizeAutomationStartUrl, requiresAutomationStartUrl } = require("@hellotest/platform/backend/src/utils/automationStartUrl");
const { captureStartUrlReview, assertQueuedStartUrlReview } = require('./automationQueuedStartUrl.service');
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid } = require("crypto");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const aiAutomationBuilderService = require("./aiAutomationBuilder.service");

const DEFAULT_LEASE_SECONDS = Math.max(30, Number(process.env.AUTOMATION_GENERATOR_LEASE_SECONDS || 180));

const selectCaseWithScope = db.prepare(`
  SELECT test_cases.*, app_types.project_id, app_types.type AS app_type_kind
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.id = ?
  FOR SHARE OF test_cases
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
  WHERE (status = 'queued'
     OR (status IN ('leased','running') AND lease_expires_at < CURRENT_TIMESTAMP))
    AND (payload->>'scheduled_at' IS NULL OR (payload->>'scheduled_at')::timestamptz <= CURRENT_TIMESTAMP)
    AND NOT EXISTS (
      SELECT 1 FROM project_deletion_jobs
      WHERE project_id = automation_generator_jobs.project_id AND status IN ('queued', 'running', 'cleanup')
    )
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
    AND (status = 'queued' OR (status IN ('leased','running') AND lease_expires_at < CURRENT_TIMESTAMP))
`);

const markRunning = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'running',
      runtime_state = ?,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      lease_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'leased' AND leased_by = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
    AND NOT EXISTS (
      SELECT 1 FROM project_deletion_jobs
      WHERE project_id = automation_generator_jobs.project_id AND status IN ('queued', 'running', 'cleanup')
    )
`);

const markCompleted = obsDb.prepare(`
  UPDATE automation_generator_jobs
  SET status = 'completed',
      result = ?,
      runtime_state = ?,
      lease_expires_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status='running' AND leased_by=?
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
  WHERE id = ? AND status='running' AND leased_by=?
`);
const renewLease=obsDb.prepare(`UPDATE automation_generator_jobs SET lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
 WHERE id=? AND status='running' AND leased_by=? AND lease_expires_at>CURRENT_TIMESTAMP`);

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

exports.queueGeneratorJob = db.transaction(async ({
  test_case_id,
  integration_id,
  start_url,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver = "mcp",
  verification_driver = "native",
  additional_context,
  agent_context,
  ai_feature,
  test_environment_id,
  test_configuration_id,
  test_suite_id,
  test_data_set_id,
  parameter_values,
  parameter_plan_key,
  scheduled_at,
  created_by
} = {}) => {
  const selectedFeature = buildFeature(ai_feature);
  ({ verification_mode, browser_driver, verification_driver } = require('../lib/automationBuildPipelineOptions').normalizeBuildPipelineOptions({ verification_mode, browser_driver, verification_driver, allow_browser_actions }));
  const scheduledAt = normalizeScheduledAt(scheduled_at);
  const testCaseId = normalizeText(test_case_id);

  if (!testCaseId) {
    throw new Error("test_case_id is required");
  }

  const observed=await db.prepare(`SELECT source.app_type_id,target.id AS target_id FROM test_cases source LEFT JOIN test_cases target
    ON target.app_type_id=source.app_type_id AND target.source_idempotency_key='automation-builder:'||source.id AND target.automated='yes'
    WHERE source.id=?`).get(testCaseId);
  if(!observed)throw new Error('Test case not found');
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('hellotest.automation-build'),hashtext(?))").get(observed.app_type_id);
  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }
  if(testCase.app_type_id!==observed.app_type_id)throw Object.assign(new Error('The test case application changed while this build was being queued. Refresh the case before starting a new build.'),{statusCode:409,code:'AUTOMATION_TARGET_CHANGED'});
  await require('../lib/automationBuildPipelineOptions').assertBuildVerificationAccess({mode:verification_mode,createdBy:created_by,projectId:testCase.project_id});
  const buildValues=require('../lib/automationBuildParameterPlan').buildParameterValues(parameter_values||{});
  if(test_suite_id!=null&&(typeof test_suite_id!=='string'||!test_suite_id.trim()))throw Object.assign(new Error('Select a valid Test Suite for this build.'),{statusCode:400,code:'AUTOMATION_BUILD_SUITE_INVALID'});
  const reviewedPlan=test_suite_id!=null||parameter_plan_key!=null||Object.keys(buildValues).length?await require('./automationBuildParameterPlan.service').load({testCase,userId:created_by,test_environment_id,test_configuration_id,test_suite_id,test_data_set_id,parameter_values:buildValues,expectedKey:parameter_plan_key}):null;
  const selectedSuite=reviewedPlan&&Object.hasOwn(reviewedPlan,'test_suite_id')?reviewedPlan.test_suite_id:normalizeText(test_suite_id);
  let currentTarget;
  if(testCase.automated!=='yes'){
    currentTarget=await db.prepare(`SELECT id,automation_start_url FROM test_cases WHERE app_type_id=? AND source_idempotency_key=? AND automated='yes' FOR SHARE`).get(testCase.app_type_id,`automation-builder:${testCaseId}`);
    if(observed.target_id&&observed.target_id!==currentTarget?.id)throw Object.assign(new Error('The linked automation case changed while this build was being queued. Refresh the case before starting a new build.'),{statusCode:409,code:'AUTOMATION_TARGET_CHANGED'});
  }
  const steps = await db.prepare('SELECT step_type FROM test_steps WHERE test_case_id=? ORDER BY step_order,id FOR SHARE').all(testCaseId);
  const resolvedStartUrl = normalizeAutomationStartUrl(start_url !== undefined ? start_url : testCase.automation_start_url || currentTarget?.automation_start_url, {
    required: requiresAutomationStartUrl({ appTypeKind: testCase.app_type_kind, steps })
  });

  const transaction = await workspaceTransactionService.createTransaction({
    project_id: testCase.project_id || null,
    app_type_id: testCase.app_type_id || null,
    category: "automation_build",
    action: "automation_generator_run",
    status: "queued",
    title: `Generator run for ${testCase.title}`,
    description: "Queued for the local LLM automation generator agent.",
    metadata: {
      agent_activity: true,
      input_test_case_ids: [testCaseId],
      verification_status: "unverified",
      verification_mode,
      browser_driver,
      verification_driver,
      current_phase: "generator.queued",
      progress_percent: 0,
      total_items: 1,
      processed_items: 0,
      test_case_id: testCaseId,
      test_environment_id: normalizeText(test_environment_id),
      test_configuration_id: normalizeText(test_configuration_id),
      test_suite_id: selectedSuite,
      test_data_set_id: normalizeText(test_data_set_id),
      agent_kind: "local-llm",
      scheduled_at: scheduledAt
    },
    related_kind: "test_case",
    related_id: testCaseId,
    created_by
  });
  const jobId = uuid();
  const payload = {
    scheduled_at: scheduledAt,
    test_case_id: testCaseId,
    title: testCase.title,
    app_type_id: testCase.app_type_id,
    app_type_kind: testCase.app_type_kind,
    integration_id: normalizeText(integration_id),
    start_url: resolvedStartUrl,
    start_url_review: captureStartUrlReview(testCase, currentTarget),
    allow_browser_actions: allow_browser_actions === true,
    verification_mode,
    browser_driver,
    verification_driver,
    additional_context: normalizeText(additional_context),
    agent_context: require("../lib/automationAgentContext").normalizeAgentContext(agent_context),
    ai_feature: selectedFeature,
    test_environment_id: normalizeText(test_environment_id),
    test_configuration_id: normalizeText(test_configuration_id),
    test_suite_id: selectedSuite,
    test_data_set_id: normalizeText(test_data_set_id),
    parameter_values:buildValues,parameter_plan_key:reviewedPlan?.parameter_plan_key
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
    status: "queued",
    scheduled_at: scheduledAt
  };
});

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

  if (job.status !== "leased") {
    throw Object.assign(new Error("Automation generator job must have an unused lease before it can run"), { statusCode: 409 });
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

  const started = await markRunning.run(serialize(runtimeState), leaseExpiresAt, job.id, runtimeState.worker_id);
  if (!started.changes) {
    throw Object.assign(new Error("Automation generator lease expired, belongs to another worker, or was already started"), { statusCode: 409 });
  }
  const executionGuard=createBatchJobLease({renew:()=>renewLease.run(new Date(Date.now()+DEFAULT_LEASE_SECONDS*1000).toISOString(),job.id,runtimeState.worker_id)});
  try {
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
    const currentCase = await selectCaseWithScope.get(payload.test_case_id || job.test_case_id);
    if (!currentCase) throw new Error('Test case not found');
    const currentSteps = await db.prepare('SELECT step_type FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(currentCase.id);
    // Historical queued jobs must not adopt a later live target. The URL
    // reviewed at queue time is the only permitted generation entry point.
    const jobStartUrl = normalizeAutomationStartUrl(payload.start_url, {
      required: requiresAutomationStartUrl({ appTypeKind: currentCase.app_type_kind, steps: currentSteps })
    });
    await assertQueuedStartUrlReview({ sourceCaseId: currentCase.id, appTypeId: currentCase.app_type_id, review: payload.start_url_review, desiredStartUrl: jobStartUrl,
      required: requiresAutomationStartUrl({ appTypeKind: currentCase.app_type_kind, steps: currentSteps }) });
    const result = await aiAutomationBuilderService.buildAutomationForCase({
      test_case_id: payload.test_case_id || job.test_case_id,
      integration_id: payload.integration_id,
      ai_feature: buildFeature(payload.ai_feature),
      created_by: job.created_by,
      start_url: jobStartUrl,
      start_url_review: payload.start_url_review,
      allow_browser_actions: payload.allow_browser_actions === true,
      verification_mode: payload.verification_mode,
      browser_driver: payload.browser_driver,
      verification_driver: payload.verification_driver,
      test_environment_id: payload.test_environment_id,
      test_configuration_id: payload.test_configuration_id,
      test_suite_id: payload.test_suite_id,
      test_data_set_id: payload.test_data_set_id,
      parameter_values:payload.parameter_values,
      parameter_plan_key:payload.parameter_plan_key,
      agent_context: payload.agent_context,
      additional_context: [
        payload.additional_context,
        runtimeState.agent_plan ? `Local LLM generator plan:\n${runtimeState.agent_plan}` : null
      ].filter(Boolean).join("\n\n"),
      transaction_id: job.transaction_id,
      transaction_action: "automation_generator_run",
      transaction_title: `Generator run for ${payload.title || job.test_case_id}`,
      transaction_description: "Local LLM agent is building automation with TestEngine assistance.",
      execution_guard:executionGuard
    });
    const nextRuntimeState = {
      ...runtimeState,
      current_phase: "generator.completed",
      generated_step_count: result.generated_step_count,
      learned_locator_count: result.learned_locator_count
    };

    await executionGuard.ensureOwnership();
    const completed=await markCompleted.run(serialize(result), serialize(nextRuntimeState), job.id,runtimeState.worker_id);
    if(completed.changes!==1)throw Object.assign(new Error("The generator lease changed before completion."),{code:"BATCH_JOB_LEASE_LOST"});
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
    if(executionGuard.signal.aborted||error.code==='BATCH_JOB_LEASE_LOST')throw executionGuard.signal.reason||error;
    await executionGuard.ensureOwnership();
    const message = error instanceof Error ? error.message : "Automation generator failed";
    const nextRuntimeState = {
      ...runtimeState,
      current_phase: "generator.failed",
      error: message
    };

    const failed=await markFailed.run(serialize({ error: message }), serialize(nextRuntimeState), message, job.id,runtimeState.worker_id);
    if(failed.changes!==1)throw Object.assign(new Error("The generator lease changed before failure recording."),{code:"BATCH_JOB_LEASE_LOST"});
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
  } finally {executionGuard.stop();}
};
