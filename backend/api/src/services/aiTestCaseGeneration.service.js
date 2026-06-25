const db = require("../db");
const { v4: uuid } = require("uuid");
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
const STALE_RUNNING_JOB_MS = Math.max(30 * 60 * 1000, Number(process.env.AI_GENERATION_STALE_RUNNING_MS || 2 * 60 * 60 * 1000));

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

const selectQueuedJobs = db.prepare(`
  SELECT id
  FROM ai_test_case_generation_jobs
  WHERE status = 'queued'
    AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`);

const requeueStaleRunningJobs = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = 'queued',
      error = 'Recovered after the previous worker stopped before completing this AI generation job.',
      next_run_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE status = 'running'
    AND updated_at <= ?
`);

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
    status,
    total_requirements,
    processed_requirements,
    generated_cases_count,
    error,
    created_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, NULL, ?)
`);

const markJobRunning = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = 'running',
      attempts = attempts + 1,
      error = NULL,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const requeueJobForRetry = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = 'queued',
      error = ?,
      next_run_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateJobProgress = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET processed_requirements = ?,
      generated_cases_count = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const finishJob = db.prepare(`
  UPDATE ai_test_case_generation_jobs
  SET status = ?,
      processed_requirements = ?,
      generated_cases_count = ?,
      error = ?,
      completed_at = CURRENT_TIMESTAMP,
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

const normalizeTextList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean))];

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

  return {
    ...job,
    requirement_ids: parseJsonValue(job.requirement_ids, []),
    external_links: parseJsonValue(job.external_links, []),
    images: parseJsonValue(job.images, []),
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

async function requeueAiJobAfterCapacityError({ job, jobId, linkedTransaction, error }) {
  const message = error instanceof Error ? error.message : "AI provider capacity is temporarily unavailable";
  const nextAttempt = Number(job.attempts || 0) + 1;
  const maxAttempts = Number(job.max_attempts || MAX_JOB_ATTEMPTS);

  if (nextAttempt >= maxAttempts || !isRetryableLlmError(error)) {
    return false;
  }

  const retryDelayMs = resolveRetryDelayMs(error, nextAttempt);
  const nextRunAt = new Date(Date.now() + retryDelayMs).toISOString();

  await requeueJobForRetry.run(message, nextRunAt, jobId);

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
        ? `AI token or rate capacity is exhausted. QAira will retry around ${nextRunAt}.`
        : `Temporary AI generation failure. QAira will retry around ${nextRunAt}.`,
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
  appType
}) {
  const preview = await requirementDesignService.previewRequirementTestCases({
    requirement,
    appType,
    integration_id: job.integration_id || undefined,
    user_id: job.created_by,
    max_cases: job.max_cases_per_requirement,
    additional_context: job.additional_context || undefined,
    external_links: job.external_links || [],
    images: job.images || []
  });

  let createdCount = 0;

  for (const candidate of preview.cases || []) {
    await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      external_references: normalizeStoredReferenceList(requirement.external_references),
      priority: candidate.priority,
      status: "draft",
      requirement_ids: candidate.requirement_ids?.length ? candidate.requirement_ids : [requirement.id],
      steps: candidate.steps || [],
      ai_generation_source: "scheduler",
      ai_generation_review_status: "pending",
      ai_generation_job_id: job.id,
      ai_generated_at: new Date().toISOString()
    });
    createdCount += 1;
  }

  return createdCount;
}

async function generateCasesForRequirementWithRetry({ job, requirement, appType, onRetry }) {
  let attempt = 0;

  while (attempt < MAX_LLM_RETRY_ATTEMPTS) {
    attempt += 1;

    try {
      return await generateCasesForRequirement({ job, requirement, appType });
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

async function runJob(jobId) {
  if (!jobId || processingJobIds.has(jobId)) {
    return null;
  }

  processingJobIds.add(jobId);

  try {
    const queuedJob = await exports.getJob(jobId);
    const linkedTransaction = await workspaceTransactionService.findTransactionByRelated({
      related_kind: "ai_test_case_generation_job",
      related_id: jobId
    });

    if (!queuedJob || queuedJob.status !== "queued") {
      return queuedJob;
    }

    const appType = await selectAppType.get(queuedJob.app_type_id);

    if (!appType) {
      await finishJob.run("failed", 0, 0, "Selected app type no longer exists.", jobId);
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

    await markJobRunning.run(jobId);
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
              await updateJobProgress.run(processedRequirements, generatedCasesCount, jobId);
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
        linkedTransaction,
        error: retryableJobError
      });

      if (didRequeue) {
        return exports.getJob(jobId);
      }
    }

    await finishJob.run(finalStatus, processedRequirements, generatedCasesCount, finalError, jobId);

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
    const failedJob = await exports.getJob(jobId);
    const linkedTransaction = await workspaceTransactionService.findTransactionByRelated({
      related_kind: "ai_test_case_generation_job",
      related_id: jobId
    });

    if (failedJob && isRetryableLlmError(error)) {
      const didRequeue = await requeueAiJobAfterCapacityError({
        job: { ...failedJob, attempts: Math.max(0, Number(failedJob.attempts || 0) - 1) },
        jobId,
        linkedTransaction,
        error
      });

      if (didRequeue) {
        return exports.getJob(jobId);
      }
    }

    await finishJob.run("failed", 0, 0, error instanceof Error ? error.message : "Unable to process AI generation job", jobId);

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

  await insertJob.run(
    id,
    appType.project_id,
    appType.id,
    normalizeText(integration_id),
    requirements.map((requirement) => requirement.id),
    clampInteger(max_cases_per_requirement, {
      fallback: DEFAULT_CASES_PER_REQUIREMENT,
      min: 1,
      max: MAX_CASES_PER_REQUIREMENT
    }),
    clampInteger(parallel_requirement_limit, {
      fallback: DEFAULT_PARALLEL_REQUIREMENTS,
      min: 1,
      max: MAX_PARALLEL_REQUIREMENTS
    }),
    normalizeText(additional_context),
    normalizeTextList(external_links),
    normalizeImageAssets(images),
    requirements.length,
    created_by
  );

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
      max_cases_per_requirement: clampInteger(max_cases_per_requirement, {
        fallback: DEFAULT_CASES_PER_REQUIREMENT,
        min: 1,
        max: MAX_CASES_PER_REQUIREMENT
      }),
      parallel_requirement_limit: clampInteger(parallel_requirement_limit, {
        fallback: DEFAULT_PARALLEL_REQUIREMENTS,
        min: 1,
        max: MAX_PARALLEL_REQUIREMENTS
      }),
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

  return { id };
};

exports.listJobs = async ({ app_type_id, status } = {}) => {
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

  query += ` ORDER BY created_at DESC, id DESC`;

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
    await requeueStaleRunningJobs.run(new Date(Date.now() - STALE_RUNNING_JOB_MS).toISOString());
    const queuedJobs = await selectQueuedJobs.all(QUEUED_AI_JOB_LIMIT);

    for (const row of queuedJobs) {
      await runJob(row.id);
    }
  } finally {
    isQueueProcessing = false;
  }
};

exports.triggerJobProcessing = () => {
  setTimeout(() => {
    void exports.processQueuedJobs();
  }, 0);
};
