const db = require("../db");
const { createHash, randomUUID: uuid } = require("crypto");
const { hostname } = require("os");
const requirementDesignService = require("./requirementDesign.service");
const testCaseService = require("./testCase.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const DEFAULT_CASES_PER_REQUIREMENT = 3;
const DEFAULT_PARALLEL_REQUIREMENTS = 1;
const MAX_CASES_PER_REQUIREMENT = 3;
const MAX_PARALLEL_REQUIREMENTS = 1;
const REQUIREMENT_BATCH_LIMIT = 1;
const MAX_LLM_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1_500;
const MAX_RETRY_DELAY_MS = 60_000;
const AI_CAPACITY_RECOVERY_MS = Math.max(60_000, Number(process.env.AI_RATE_LIMIT_RECOVERY_MS || 60 * 60 * 1000));
const MAX_JOB_ATTEMPTS = Math.max(1, Number(process.env.AI_GENERATION_MAX_JOB_ATTEMPTS || 5));
const INTER_REQUIREMENT_COOLDOWN_MS = Math.max(0, Number(process.env.AI_GENERATION_INTER_REQUIREMENT_COOLDOWN_MS || process.env.AI_GENERATION_INTER_BATCH_COOLDOWN_MS || 5_000));
const QUEUED_AI_JOB_LIMIT = Math.max(1, Number(process.env.AI_GENERATION_DUE_JOB_LIMIT || 1));
const JOB_LEASE_MS = Math.max(60_000, Number(process.env.AI_GENERATION_JOB_LEASE_MS || 5 * 60 * 1000));
const JOB_HEARTBEAT_MS = Math.max(10_000, Math.min(Math.floor(JOB_LEASE_MS / 3), 60_000));
const WORKER_ID = `${hostname()}:${process.pid}:${uuid()}`;

const processingJobIds = new Set();
let isQueueProcessing = false;

const selectAppType = db.prepare(`
  SELECT id, name, type, project_id
  FROM app_types
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, title, description, priority, status, project_id
  FROM requirements
  WHERE id = ?
`);

const selectUser = db.prepare(`
  SELECT id
  FROM users
  WHERE id = ?
`);

const selectJob = db.prepare(`
  SELECT *
  FROM ai_test_case_generation_jobs
  WHERE id = ?
`);

const claimQueuedJobs = db.transaction(async (workerId, limit, leaseMs) => db.prepare(`
  WITH candidates AS (
    SELECT id
    FROM ai_test_case_generation_jobs
    WHERE attempts < max_attempts
      AND (
        (status = 'queued' AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP))
        OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP))
      )
    ORDER BY COALESCE(next_run_at, created_at) ASC, created_at ASC, id ASC
    LIMIT ?
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ai_test_case_generation_jobs AS jobs
  SET status = 'running',
      attempts = jobs.attempts + 1,
      error = CASE
        WHEN jobs.status = 'running' THEN 'Recovered after the previous worker lease expired.'
        ELSE NULL
      END,
      lease_owner = ?,
      lease_expires_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
      heartbeat_at = CURRENT_TIMESTAMP,
      started_at = COALESCE(jobs.started_at, CURRENT_TIMESTAMP),
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*
`).all(limit, workerId, leaseMs));

const insertJob = db.prepare(`
  INSERT INTO ai_test_case_generation_jobs (
    id,
    project_id,
    app_type_id,
    integration_id,
    requirement_ids,
    max_cases_per_requirement,
    parallel_requirement_limit,
    additional_context,
    external_links,
    images,
    authoring_mode,
    idempotency_key,
    request_fingerprint,
    status,
    total_requirements,
    processed_requirements,
    generated_cases_count,
    error,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, NULL, ?)
`);

const selectJobByIdempotency = db.prepare(`
  SELECT id, request_fingerprint
  FROM ai_test_case_generation_jobs
  WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
`);

const renewJobLease = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET lease_expires_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
      heartbeat_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running' AND lease_owner = ?
`);

const requeueJobForRetry = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = 'queued',
      error = ?,
      next_run_at = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running' AND lease_owner = ?
`);

const updateJobProgress = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET processed_requirements = ?,
      generated_cases_count = ?,
      lease_expires_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
      heartbeat_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running' AND lease_owner = ?
`);

const finishJob = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = ?,
      processed_requirements = ?,
      generated_cases_count = ?,
      error = ?,
      completed_at = CURRENT_TIMESTAMP,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running' AND lease_owner = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeTextList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean))];

const normalizeIdempotencyKey = (value) => {
  const key = normalizeText(value);
  if (!key) return null;
  if (key.length > 255) {
    const error = new Error("Idempotency-Key must be 255 characters or fewer");
    error.statusCode = 400;
    throw error;
  }
  return key;
};

const leaseLostError = (jobId) => {
  const error = new Error(`AI generation job ${jobId} is no longer owned by this worker`);
  error.code = "JOB_LEASE_LOST";
  error.retryable = true;
  return error;
};

const assertLeaseMutation = (result, jobId) => {
  if (result?.changes !== 1) throw leaseLostError(jobId);
  return result;
};

const startJobHeartbeat = (jobId, workerId) => {
  let stopped = false;
  let heartbeatPromise = null;
  let heartbeatError = null;
  let lastSuccessfulHeartbeatAt = Date.now();

  const heartbeat = () => {
    if (stopped || heartbeatPromise) return heartbeatPromise;
    heartbeatPromise = renewJobLease.run(JOB_LEASE_MS, jobId, workerId)
      .then((result) => {
        assertLeaseMutation(result, jobId);
        heartbeatError = null;
        lastSuccessfulHeartbeatAt = Date.now();
      })
      .catch((error) => {
        heartbeatError = error;
      })
      .finally(() => {
        heartbeatPromise = null;
      });
    return heartbeatPromise;
  };

  const timer = setInterval(() => void heartbeat(), JOB_HEARTBEAT_MS);
  timer.unref?.();

  return {
    assertOwned() {
      if (heartbeatError?.code === "JOB_LEASE_LOST" || (heartbeatError && Date.now() - lastSuccessfulHeartbeatAt >= JOB_LEASE_MS)) {
        throw heartbeatError;
      }
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (heartbeatPromise) await heartbeatPromise;
    }
  };
};

const normalizeImageAssets = (images = []) => {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image, index) => ({
      name: normalizeText(image?.name) || `Reference image ${index + 1}`,
      url: normalizeText(image?.url)
    }))
    .filter((image) => image.url);
};

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

const clampInteger = (value, { fallback, min, max }) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.round(numeric), max));
};

const buildJobErrorMessage = (errors = []) => {
  if (!errors.length) {
    return null;
  }

  return errors.slice(0, 3).join(" | ");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkRequirements = (requirements = [], size = REQUIREMENT_BATCH_LIMIT) => {
  const chunks = [];

  for (let index = 0; index < requirements.length; index += size) {
    chunks.push(requirements.slice(index, index + size));
  }

  return chunks;
};

const isRetryableLlmError = (error) => {
  const statusCode = Number(error?.statusCode || 0);

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return message.includes("rate limit") || message.includes("temporarily") || message.includes("timeout");
};

const isAiCapacityError = (error) => {
  const statusCode = Number(error?.statusCode || 0);
  const message = String(error?.message || "").toLowerCase();
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
      ? Math.max(retryAfterMs, AI_CAPACITY_RECOVERY_MS)
      : Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }

  if (isAiCapacityError(error)) {
    return AI_CAPACITY_RECOVERY_MS;
  }

  const exponentialDelay = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.round(Math.random() * 500);
  return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY_MS);
};

async function hydrateJob(job) {
  if (!job) {
    return job;
  }

  const {
    lease_owner: _leaseOwner,
    lease_expires_at: _leaseExpiresAt,
    heartbeat_at: _heartbeatAt,
    idempotency_key: _idempotencyKey,
    request_fingerprint: _requestFingerprint,
    ...publicJob
  } = job;

  return {
    ...publicJob,
    requirement_ids: parseJsonValue(job.requirement_ids, []),
    external_links: parseJsonValue(job.external_links, []),
    images: parseJsonValue(job.images, []),
    authoring_mode: job.authoring_mode === "gherkin" ? "gherkin" : "structured",
    total_requirements: Number(job.total_requirements || 0),
    processed_requirements: Number(job.processed_requirements || 0),
    generated_cases_count: Number(job.generated_cases_count || 0),
    max_cases_per_requirement: Number(job.max_cases_per_requirement || DEFAULT_CASES_PER_REQUIREMENT),
    parallel_requirement_limit: Number(job.parallel_requirement_limit || DEFAULT_PARALLEL_REQUIREMENTS),
    attempts: Number(job.attempts || 0),
    max_attempts: Number(job.max_attempts || MAX_JOB_ATTEMPTS),
    next_run_at: job.next_run_at || null
  };
}

async function requeueAiJobAfterCapacityError({ job, jobId, workerId, linkedTransaction, error }) {
  const message = error instanceof Error ? error.message : "AI provider capacity is temporarily unavailable";
  const nextAttempt = Number(job.attempts || 0);
  const maxAttempts = Number(job.max_attempts || MAX_JOB_ATTEMPTS);

  if (nextAttempt >= maxAttempts || !isRetryableLlmError(error)) {
    return false;
  }

  const retryDelayMs = resolveRetryDelayMs(error, nextAttempt);
  const nextRunAt = new Date(Date.now() + retryDelayMs).toISOString();

  assertLeaseMutation(
    await requeueJobForRetry.run(message, nextRunAt, jobId, workerId),
    jobId
  );

  if (linkedTransaction) {
    await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
      status: "queued",
      description: isAiCapacityError(error)
        ? "Waiting for AI provider capacity before retrying generation."
        : "Waiting to retry AI generation after a temporary failure.",
      metadata: {
        current_phase: isAiCapacityError(error) ? "waiting_for_ai_capacity" : "waiting_for_retry",
        error: message,
        retry_attempt: nextAttempt,
        max_attempts: maxAttempts,
        next_run_at: nextRunAt,
        retry_after_ms: retryDelayMs
      }
    });
    await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
      level: "warning",
      phase: isAiCapacityError(error) ? "ai-capacity-wait" : "retry-wait",
      message: isAiCapacityError(error)
        ? `AI token or rate capacity is exhausted. HelloTest will retry around ${nextRunAt}.`
        : `Temporary AI generation failure. HelloTest will retry around ${nextRunAt}.`,
      details: {
        job_id: jobId,
        error: message,
        retry_attempt: nextAttempt,
        max_attempts: maxAttempts,
        next_run_at: nextRunAt,
        retry_after_ms: retryDelayMs
      }
    });
  }

  return true;
}

async function resolveScopedRequirements(requirementIds = [], projectId) {
  const ids = normalizeTextList(requirementIds);

  if (!ids.length) {
    throw new Error("Select at least one requirement");
  }

  const requirements = [];

  for (const requirementId of ids) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    if (requirement.project_id !== projectId) {
      throw new Error("Requirements must belong to the same project as the selected app type");
    }

    requirements.push(requirement);
  }

  return requirements;
}

async function generateCasesForRequirement({
  job,
  requirement,
  appType,
  assertLease
}) {
  assertLease?.();
  const preview = await requirementDesignService.previewRequirementTestCases({
    requirement,
    appType,
    integration_id: job.integration_id || undefined,
    user_id: job.created_by,
    max_cases: job.max_cases_per_requirement,
    authoring_mode: job.authoring_mode || "structured",
    additional_context: job.additional_context || undefined,
    external_links: job.external_links || [],
    images: job.images || []
  });

  let createdCount = 0;

  for (const [candidateIndex, candidate] of (preview.cases || []).entries()) {
    assertLease?.();
    await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      external_references: normalizeStoredReferenceList(requirement.external_references),
      priority: candidate.priority,
      status: "draft",
      requirement_ids: candidate.requirement_ids?.length ? candidate.requirement_ids : [requirement.id],
      authoring_mode: candidate.authoring_mode || job.authoring_mode || "structured",
      gherkin_document: candidate.gherkin_document || undefined,
      parameter_values: candidate.parameter_values || {},
      steps: candidate.steps || [],
      ai_generation_source: "scheduler",
      ai_generation_review_status: "pending",
      reviewer_id: job.created_by,
      review_status: "pending",
      ai_generation_job_id: job.id,
      source_idempotency_key: `ai-job:${job.id}:requirement:${requirement.id}:case:${candidateIndex}`,
      ai_generated_at: new Date().toISOString(),
      created_by: job.created_by
    });
    createdCount += 1;
  }

  return createdCount;
}

async function generateCasesForRequirementWithRetry({ job, requirement, appType, assertLease, onRetry }) {
  let attempt = 0;

  while (attempt < MAX_LLM_RETRY_ATTEMPTS) {
    attempt += 1;

    try {
      return await generateCasesForRequirement({ job, requirement, appType, assertLease });
    } catch (error) {
      if (attempt >= MAX_LLM_RETRY_ATTEMPTS || !isRetryableLlmError(error)) {
        throw error;
      }

      const delayMs = resolveRetryDelayMs(error, attempt);

      if (typeof onRetry === "function") {
        await onRetry({ attempt, delayMs, error });
      }

      await sleep(delayMs);
    }
  }

  return 0;
}

async function runJob(claimedJob, workerId) {
  const jobId = claimedJob?.id;
  if (!jobId || processingJobIds.has(jobId)) {
    return null;
  }

  processingJobIds.add(jobId);
  const heartbeat = startJobHeartbeat(jobId, workerId);

  try {
    const queuedJob = await hydrateJob(claimedJob);
    const linkedTransaction = await workspaceTransactionService.findTransactionByRelated({
      related_kind: "ai_test_case_generation_job",
      related_id: jobId
    });

    if (!queuedJob || queuedJob.status !== "running" || claimedJob.lease_owner !== workerId) {
      return queuedJob;
    }

    const appType = await selectAppType.get(queuedJob.app_type_id);

    if (!appType) {
      assertLeaseMutation(
        await finishJob.run("failed", 0, 0, "Selected app type no longer exists.", jobId, workerId),
        jobId
      );
      if (linkedTransaction) {
        await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
          status: "failed",
          description: "AI generation failed because the selected app type no longer exists.",
          metadata: {
            processed_requirements: 0,
            generated_cases_count: 0
          },
          completed_at: new Date().toISOString()
        });
        await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
          level: "error",
          phase: "validate",
          message: "AI generation stopped because the selected app type no longer exists.",
          details: {
            processed_requirements: 0,
            generated_cases_count: 0
          }
        });
      }
      return exports.getJob(jobId);
    }

    const requirements = await resolveScopedRequirements(queuedJob.requirement_ids, appType.project_id);
    const workerCount = Math.min(
      requirements.length,
      clampInteger(queuedJob.parallel_requirement_limit, {
        fallback: DEFAULT_PARALLEL_REQUIREMENTS,
        min: 1,
        max: MAX_PARALLEL_REQUIREMENTS
      })
    );

    if (linkedTransaction) {
      await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
        status: "running",
        description: `Generating AI test cases for ${requirements.length} requirement${requirements.length === 1 ? "" : "s"}.`,
        started_at: new Date().toISOString(),
        metadata: {
          requirement_count: requirements.length,
          total_items: requirements.length,
          processed_items: 0,
          generated_cases_count: 0,
          progress_percent: 0,
          current_phase: "ai-generation",
          worker_count: 1,
          batch_size: 1,
          inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
        }
      });
      await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
        phase: "run",
        message: `Processing ${requirements.length} requirement${requirements.length === 1 ? "" : "s"} one at a time with a ${INTER_REQUIREMENT_COOLDOWN_MS}ms cooldown between requirements.`,
        details: {
          requirement_count: requirements.length,
          worker_count: 1,
          batch_size: 1,
          inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
        }
      });
    }

    let processedRequirements = 0;
    let generatedCasesCount = 0;
    const errors = [];
    let retryableJobError = null;
    const requirementBatches = chunkRequirements(requirements, REQUIREMENT_BATCH_LIMIT);

    for (const [batchIndex, requirementBatch] of requirementBatches.entries()) {
      const queue = [...requirementBatch];
      const batchWorkerCount = Math.min(workerCount, queue.length);

      if (linkedTransaction) {
        await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
          phase: "batch",
          message: `Processing AI generation requirement ${batchIndex + 1} of ${requirementBatches.length}.`,
          details: {
            batch_index: batchIndex + 1,
            batch_count: requirementBatches.length,
            requirement_count: requirementBatch.length,
            worker_count: batchWorkerCount
          }
        });
      }

      await Promise.all(
        Array.from({ length: batchWorkerCount }, async () => {
          while (queue.length) {
            const requirement = queue.shift();

            if (!requirement) {
              return;
            }

            try {
              if (linkedTransaction) {
                await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
                  phase: "requirement",
                  message: `Generating cases for requirement "${requirement.title}".`,
                  details: {
                    requirement_id: requirement.id,
                    requirement_title: requirement.title
                  }
                });
              }
              generatedCasesCount += await generateCasesForRequirementWithRetry({
                job: queuedJob,
                requirement,
                appType,
                assertLease: () => heartbeat.assertOwned(),
                onRetry: linkedTransaction
                  ? async ({ attempt, delayMs, error }) => {
                      await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
                        level: "warning",
                        phase: "rate-limit",
                        message: `Retrying AI generation for "${requirement.title}" after a temporary LLM limit.`,
                        details: {
                          requirement_id: requirement.id,
                          requirement_title: requirement.title,
                          attempt,
                          retry_after_ms: delayMs,
                          error: error instanceof Error ? error.message : "Temporary LLM failure"
                        }
                      });
                    }
                  : null
              });
              if (linkedTransaction) {
                await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
                  level: "success",
                  phase: "requirement",
                  message: `Completed AI generation for requirement "${requirement.title}".`,
                  details: {
                    requirement_id: requirement.id,
                    requirement_title: requirement.title,
                    processed_requirements: processedRequirements + 1,
                    generated_cases_count: generatedCasesCount
                  }
                });
              }
            } catch (error) {
              if (!retryableJobError && isRetryableLlmError(error)) {
                retryableJobError = error;
              }
              errors.push(
                `${requirement.title}: ${error instanceof Error ? error.message : "Unable to generate test cases"}`
              );
              if (linkedTransaction) {
                await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
                  level: "error",
                  phase: "requirement",
                  message: `Failed AI generation for requirement "${requirement.title}".`,
                  details: {
                    requirement_id: requirement.id,
                    requirement_title: requirement.title,
                    error: error instanceof Error ? error.message : "Unable to generate test cases"
                  }
                });
              }
            } finally {
              processedRequirements += 1;
              heartbeat.assertOwned();
              assertLeaseMutation(
                await updateJobProgress.run(
                  processedRequirements,
                  generatedCasesCount,
                  JOB_LEASE_MS,
                  jobId,
                  workerId
                ),
                jobId
              );
              if (linkedTransaction) {
                await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
                  description: `Generated ${generatedCasesCount} AI test case${generatedCasesCount === 1 ? "" : "s"} after ${processedRequirements} of ${requirements.length} requirement${requirements.length === 1 ? "" : "s"}.`,
                  metadata: {
                    requirement_count: requirements.length,
                    total_items: requirements.length,
                    processed_items: processedRequirements,
                    processed_requirements: processedRequirements,
                    generated_cases_count: generatedCasesCount,
                    progress_percent: requirements.length ? Math.round((processedRequirements / requirements.length) * 100) : 0,
                    current_phase: "ai-generation",
                    worker_count: 1,
                    batch_size: 1,
                    inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
                  }
                });
              }
            }
          }
        })
      );

      if (batchIndex < requirementBatches.length - 1) {
        if (linkedTransaction && INTER_REQUIREMENT_COOLDOWN_MS > 0) {
          await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
            phase: "cooldown",
            message: `Waiting ${INTER_REQUIREMENT_COOLDOWN_MS}ms before the next requirement to reduce LLM rate-limit pressure.`,
            details: {
              batch_index: batchIndex + 1,
              next_batch_index: batchIndex + 2,
              inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
            }
          });
        }

        await sleep(INTER_REQUIREMENT_COOLDOWN_MS);
      }
    }

    const finalStatus = errors.length && !generatedCasesCount ? "failed" : "completed";
    const finalError = buildJobErrorMessage(errors);

    if (finalStatus === "failed" && retryableJobError) {
      const didRequeue = await requeueAiJobAfterCapacityError({
        job: queuedJob,
        jobId,
        workerId,
        linkedTransaction,
        error: retryableJobError
      });

      if (didRequeue) {
        return exports.getJob(jobId);
      }
    }

    heartbeat.assertOwned();
    assertLeaseMutation(
      await finishJob.run(
        finalStatus,
        processedRequirements,
        generatedCasesCount,
        finalError,
        jobId,
        workerId
      ),
      jobId
    );

    if (linkedTransaction) {
      await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
        status: finalStatus,
        description:
          finalStatus === "completed"
            ? errors.length
              ? `Generated ${generatedCasesCount} AI test case${generatedCasesCount === 1 ? "" : "s"} across ${processedRequirements} requirement${processedRequirements === 1 ? "" : "s"} with ${errors.length} issue${errors.length === 1 ? "" : "s"}.`
              : `Generated ${generatedCasesCount} AI test case${generatedCasesCount === 1 ? "" : "s"} across ${processedRequirements} requirement${processedRequirements === 1 ? "" : "s"}.`
            : `AI generation finished with issues after ${processedRequirements} processed requirement${processedRequirements === 1 ? "" : "s"}.`,
        metadata: {
          total_items: requirements.length,
          processed_items: processedRequirements,
          processed_requirements: processedRequirements,
          generated_cases_count: generatedCasesCount,
          progress_percent: 100,
          current_phase: finalStatus === "completed" ? (errors.length ? "completed-with-issues" : "completed") : "failed",
          worker_count: 1,
          batch_size: 1,
          inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS,
          error: finalError
        },
        completed_at: new Date().toISOString()
      });
      await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
        level: finalStatus === "completed" && !errors.length ? "success" : "warning",
        phase: "complete",
        message:
          finalStatus === "completed"
            ? errors.length
              ? `Generated ${generatedCasesCount} AI test case${generatedCasesCount === 1 ? "" : "s"} with ${errors.length} issue${errors.length === 1 ? "" : "s"}.`
              : `Generated ${generatedCasesCount} AI test case${generatedCasesCount === 1 ? "" : "s"} across ${processedRequirements} requirement${processedRequirements === 1 ? "" : "s"}.`
            : `AI generation finished with ${errors.length} issue${errors.length === 1 ? "" : "s"}.`,
        details: {
          processed_requirements: processedRequirements,
          generated_cases_count: generatedCasesCount,
          errors
        }
      });
    }

    return exports.getJob(jobId);
  } catch (error) {
    if (error?.code === "JOB_LEASE_LOST") {
      return exports.getJob(jobId);
    }
    const failedJob = await exports.getJob(jobId);
    const linkedTransaction = await workspaceTransactionService.findTransactionByRelated({
      related_kind: "ai_test_case_generation_job",
      related_id: jobId
    });

    if (failedJob && isRetryableLlmError(error)) {
      const didRequeue = await requeueAiJobAfterCapacityError({
        job: failedJob,
        jobId,
        workerId,
        linkedTransaction,
        error
      });

      if (didRequeue) {
        return exports.getJob(jobId);
      }
    }

    assertLeaseMutation(
      await finishJob.run(
        "failed",
        Number(failedJob?.processed_requirements || 0),
        Number(failedJob?.generated_cases_count || 0),
        error instanceof Error ? error.message : "Unable to process AI generation job",
        jobId,
        workerId
      ),
      jobId
    );

    if (linkedTransaction) {
      await workspaceTransactionService.updateTransaction(linkedTransaction.id, {
        status: "failed",
        description: error instanceof Error ? error.message : "Unable to process AI generation job",
        metadata: {
          error: error instanceof Error ? error.message : "Unable to process AI generation job"
        },
        completed_at: new Date().toISOString()
      });
      await workspaceTransactionService.appendTransactionEvent(linkedTransaction.id, {
        level: "error",
        phase: "complete",
        message: error instanceof Error ? error.message : "Unable to process AI generation job",
        details: {
          error: error instanceof Error ? error.message : "Unable to process AI generation job"
        }
      });
    }

    return exports.getJob(jobId);
  } finally {
    await heartbeat.stop();
    processingJobIds.delete(jobId);
  }
}

exports.createJob = async ({
  app_type_id,
  requirement_ids = [],
  integration_id,
  max_cases_per_requirement,
  parallel_requirement_limit,
  additional_context,
  external_links = [],
  images = [],
  authoring_mode = "structured",
  idempotency_key,
  created_by
}) => {
  const appType = await selectAppType.get(app_type_id);

  if (!appType) {
    throw new Error("App type not found");
  }

  if (!created_by) {
    throw new Error("created_by is required");
  }

  const user = await selectUser.get(created_by);

  if (!user) {
    throw new Error("Invalid user");
  }

  const requirements = await resolveScopedRequirements(requirement_ids, appType.project_id);
  const id = uuid();
  const normalizedAuthoringMode = authoring_mode === "gherkin" ? "gherkin" : "structured";
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotency_key);
  const normalizedMaxCases = clampInteger(max_cases_per_requirement, {
    fallback: DEFAULT_CASES_PER_REQUIREMENT,
    min: 1,
    max: MAX_CASES_PER_REQUIREMENT
  });
  const normalizedParallelLimit = clampInteger(parallel_requirement_limit, {
    fallback: DEFAULT_PARALLEL_REQUIREMENTS,
    min: 1,
    max: MAX_PARALLEL_REQUIREMENTS
  });
  const normalizedExternalLinks = normalizeTextList(external_links);
  const normalizedImages = normalizeImageAssets(images);
  const normalizedContext = normalizeText(additional_context);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    app_type_id: appType.id,
    requirement_ids: requirements.map((requirement) => requirement.id),
    integration_id: normalizeText(integration_id),
    max_cases_per_requirement: normalizedMaxCases,
    parallel_requirement_limit: normalizedParallelLimit,
    additional_context: normalizedContext,
    external_links: normalizedExternalLinks,
    images: normalizedImages,
    authoring_mode: normalizedAuthoringMode
  })).digest("hex");

  const resolveIdempotentReplay = async () => {
    if (!normalizedIdempotencyKey) return null;
    const existing = await selectJobByIdempotency.get(
      appType.project_id,
      created_by,
      normalizedIdempotencyKey
    );
    if (!existing) return null;
    if (existing.request_fingerprint && existing.request_fingerprint !== requestFingerprint) {
      const error = new Error("Idempotency-Key was already used with a different AI generation request");
      error.statusCode = 409;
      throw error;
    }
    return { id: existing.id, idempotent_replay: true };
  };

  const replay = await resolveIdempotentReplay();
  if (replay) return replay;

  try {
    await insertJob.run(
      id,
      appType.project_id,
      appType.id,
      normalizeText(integration_id),
      requirements.map((requirement) => requirement.id),
      normalizedMaxCases,
      normalizedParallelLimit,
      normalizedContext,
      normalizedExternalLinks,
      normalizedImages,
      normalizedAuthoringMode,
      normalizedIdempotencyKey,
      requestFingerprint,
      requirements.length,
      created_by
    );
  } catch (error) {
    if (error?.code !== "23505" || !normalizedIdempotencyKey) throw error;
    const concurrentReplay = await resolveIdempotentReplay();
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }

  const transaction = await workspaceTransactionService.createTransaction({
    project_id: appType.project_id,
    app_type_id: appType.id,
    category: "ai_generation",
    action: "scheduled_test_case_generation",
    status: "queued",
    title: "Scheduled AI test case generation",
    description: `Queued AI generation for ${requirements.length} requirement${requirements.length === 1 ? "" : "s"} in ${appType.name}.`,
    metadata: {
      requirement_count: requirements.length,
      total_items: requirements.length,
      processed_items: 0,
      generated_cases_count: 0,
      progress_percent: 0,
      current_phase: "queued",
      authoring_mode: normalizedAuthoringMode,
      max_cases_per_requirement: normalizedMaxCases,
      parallel_requirement_limit: normalizedParallelLimit,
      worker_count: 1,
      batch_size: 1,
      inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
    },
    related_kind: "ai_test_case_generation_job",
    related_id: id,
    created_by
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "queue",
    message: `Queued AI test case generation for ${requirements.length} requirement${requirements.length === 1 ? "" : "s"}.`,
    details: {
      requirement_ids: requirements.map((requirement) => requirement.id),
      requirement_titles: requirements.map((requirement) => requirement.title),
      worker_count: 1,
      batch_size: 1,
      inter_requirement_cooldown_ms: INTER_REQUIREMENT_COOLDOWN_MS
    }
  });

  return { id, idempotent_replay: false };
};

exports.listJobs = async ({ app_type_id, status, limit = 100 } = {}) => {
  let query = `SELECT * FROM ai_test_case_generation_jobs WHERE 1=1`;
  const params = [];

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  const boundedLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit), 10) || 100));
  query += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(boundedLimit);

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateJob));
};

exports.getJob = async (id) => {
  const job = await selectJob.get(id);

  if (!job) {
    throw new Error("AI test case generation job not found");
  }

  return hydrateJob(job);
};

exports.processQueuedJobs = async () => {
  if (isQueueProcessing) {
    return;
  }

  isQueueProcessing = true;

  try {
    const queuedJobs = await claimQueuedJobs(WORKER_ID, QUEUED_AI_JOB_LIMIT, JOB_LEASE_MS);

    for (const row of queuedJobs) {
      await runJob(row, WORKER_ID);
    }
    return queuedJobs.length;
  } finally {
    isQueueProcessing = false;
  }
};

exports.triggerJobProcessing = () => {
  setTimeout(() => {
    void exports.processQueuedJobs();
  }, 0);
};
