const { randomUUID: uuid } = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const lifecycle = require("@hellotest/ai/services/generationLifecycle");
const requirementService = require("./requirement.service");
const excerpt = value => String(value || "").slice(0, 1000);
const activeGenerationControllers = new Map();

const STORY_GENERATION_LEASE_SECONDS = Math.max(30, Math.min(15 * 60, Number.parseInt(process.env.STORY_GENERATION_LEASE_SECONDS || "180", 10) || 180));
const STORY_GENERATION_QUEUE_LIMIT = Math.max(1, Math.min(10, Number.parseInt(process.env.STORY_GENERATION_QUEUE_LIMIT || "1", 10) || 1));
const STORY_GENERATION_WORKER_ID = `story-generation-${process.pid}-${uuid()}`;
let storyGenerationQueueRun = null;

const parseGenerationJobPayload = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Deliberately project a public job shape. Lease owner/expiry/heartbeat are
// worker coordination details and must never be disclosed through polling.
const shapeJob = (row) => {
  const resultPayload = parseGenerationJobPayload(row?.result_payload);
  const publicResultPayload = { ...resultPayload };
  delete publicResultPayload.lease_owner;
  delete publicResultPayload.lease_expires_at;
  delete publicResultPayload.heartbeat_at;
  return {
    ...publicResultPayload,
    id: row.id,
    job_id: row.id,
    project_id: row.project_id,
    status: row.status,
    queued: row.status === "queued",
    input_payload: parseGenerationJobPayload(row.input_payload),
    result_payload: publicResultPayload,
    last_error: row.last_error || null,
    error_code: row.error_code || null,
    failure: row.failure_payload || publicResultPayload.failure ? { ...(row.failure_payload ? parseGenerationJobPayload(row.failure_payload) : publicResultPayload.failure), support_reference: row.id } : null,
    job_kind: row.job_kind || "story",
    attempts: Number(row.attempts || 0),
    created_by: row.created_by || null,
    created_at: row.created_at,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at
  };
};

const storyGenerationJobProcessing = (status, error = null, stage = "intake") => lifecycle.processing({
  status, stage, profile: "story", detail: typeof error === "string" ? error : error?.message
});
const storyGenerationJobPayload = (status, error = null, stage = "intake", profile = "story") => ({
  processing: lifecycle.processing({ status, stage, profile, detail: error?.message || (typeof error === "string" ? error : undefined) }),
  ...(error && typeof error === "object" ? { failure: error } : {}),
  review_status: ["failed", "cancelled"].includes(status) ? "not_available" : "processing",
  requires_human_review: true, preview_only: true
});

const claimGenerationJob = ({ workerId, leaseSeconds }) => db.transaction(async () => {
  const candidate = await db.prepare(`
    SELECT id
    FROM ai_requirement_generation_jobs
    WHERE status = 'queued'
       OR (
         status = 'running'
         AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
       )
    ORDER BY
      CASE WHEN status = 'running' THEN 0 ELSE 1 END,
      created_at ASC,
      id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `).get();
  if (!candidate) return null;

  return db.prepare(`
    UPDATE ai_requirement_generation_jobs
    SET status = 'running',
        result_payload = COALESCE(result_payload, ?::jsonb),
        last_error = NULL,
        error_code = NULL,
        failure_payload = NULL,
        attempts = attempts + 1,
        lease_owner = ?,
        lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 second'),
        heartbeat_at = CURRENT_TIMESTAMP,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        status = 'queued'
        OR (
          status = 'running'
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        )
      )
    RETURNING *
  `).get(storyGenerationJobPayload("running"), workerId, leaseSeconds, candidate.id);
})();

const renewGenerationJobLease = (id, workerId, leaseSeconds) => db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 second'),
      heartbeat_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
`).run(leaseSeconds, id, workerId);

const completeGenerationJob = (id, workerId, result) => db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET status = 'completed',
      result_payload = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      heartbeat_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
  RETURNING *
`).get(result, id, workerId);

const failGenerationJob = (id, workerId, error, stage = "intake", profile = "story", checkpoint = {}) => {
  const failure = error.authoring_failure || lifecycle.failure(error, stage);
  return db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET status = 'failed',
      result_payload = ?,
      last_error = ?,
      error_code = ?,
      failure_payload = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      heartbeat_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
  RETURNING *
`).get({ ...checkpoint, ...storyGenerationJobPayload("failed", failure, stage, profile) }, failure.message, failure.code, failure, id, workerId);
};

const runClaimedGenerationJob = async ({ job, workerId, leaseSeconds }) => {
  const controller = new AbortController();
  activeGenerationControllers.set(job.id, controller);
  let stage = "intake";
  const profile = job.job_kind || "story";
  const checkpoint = { ...parseGenerationJobPayload(job.result_payload) };
  const onProgress = async (nextStage, detail, extra = {}) => {
    stage = nextStage;
    require("@hellotest/platform/agent-metrics").event("authoring", { phase: stage, details: { code: "STAGE_STARTED" } });
    require("@hellotest/platform/backend/src/utils/llmTraceContext").update({ generation_job_id: job.id, authoring_profile: profile, authoring_stage: stage, authoring_schema_version: 1 });
    Object.assign(checkpoint, extra, storyGenerationJobPayload("running", null, stage, profile));
    checkpoint.processing = lifecycle.processing({ status: "running", stage, profile, detail, outputCount: checkpoint.cases?.length || 0 });
    const changed = await db.prepare(`UPDATE ai_requirement_generation_jobs SET result_payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > CURRENT_TIMESTAMP`).run(checkpoint, job.id, workerId);
    if (!changed.changes) { controller.abort(); throw Object.assign(new Error("Generation stopped or worker ownership expired."), { code: "AI_JOB_CANCELLED", statusCode: 499 }); }
  };
  const heartbeatIntervalMs = Math.max(5_000, Math.floor(leaseSeconds * 1000 / 3));
  let heartbeatInFlight = false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    void renewGenerationJobLease(job.id, workerId, leaseSeconds)
      .then((renewed) => {
        if (!renewed.changes) { leaseLost = true; controller.abort(); }
      })
      .catch(() => {
        leaseLost = true; controller.abort();
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    if (!job.created_by) throw new Error("The Story generation job creator is no longer available.");
    const storedInput = parseGenerationJobPayload(job.input_payload);
    // A dead worker may have dispatched paid generation. Do not blindly replay
    // that uncertain call; preserve its checkpoints for review and explicit retry.
    if (Number(job.attempts) > 1 && checkpoint.processing?.active_stage_id === "specialist") throw Object.assign(new Error("The previous worker stopped during a provider request. Saved proposals remain available; start a new request after reviewing them."), { code: "AI_JOB_INTERRUPTED", retryable: false });
    await onProgress("intake", "The saved request has been loaded by its worker.");
    const project = await require("@hellotest/platform/backend/public/projectAccess").getProject(job.project_id, job.created_by);
    const access = await require("@hellotest/platform/backend/services/optionalEvidenceAccess.service").getOptionalEvidenceAccess({ id: job.created_by }, job.project_id, ["requirement.ai"]);
    if (!access["requirement.ai"]) throw Object.assign(new Error("Story AI permission is no longer available."), { code: "AI_PERMISSION_REVOKED", statusCode: 403 });
    let result;
    if (profile === "grooming") {
      const requirement = await requirementService.getRequirement(storedInput.requirement_id, { includeLinkedRecords: false, projectId: job.project_id });
      result = await require("./requirementWorkspace.service").previewGrooming({ requirement, project, userId: job.created_by, user: { id: job.created_by },
        integrationId: storedInput.integration_id, promptGuidance: storedInput.prompt_guidance, additionalContext: storedInput.additional_context,
        proposedChange: storedInput.proposed_change, onProgress, signal: controller.signal, durable: true });
    } else if (profile === "case-design") {
      await onProgress("context", "Loading the scoped Story and application for case proposals.");
      const appType = await require("@hellotest/platform/backend/public/applicationAccess").getAppType(storedInput.app_type_id);
      if (appType.project_id !== job.project_id) throw Object.assign(new Error("Application does not belong to this project."), { statusCode: 403 });
      const requirement = await requirementService.getRequirement(storedInput.requirement_id, { includeLinkedRecords: false, projectId: job.project_id });
      await onProgress("guardrails", "Project access and requested case count were checked.");
      const cases = Array.isArray(checkpoint.cases) ? [...checkpoint.cases] : [];
      const count = Math.max(1, Math.min(10, Number(storedInput.max_cases) || 1));
      for (let index = cases.length; index < count; index++) {
        const preview = await require("./requirementDesign.service").previewRequirementsTestCases({ ...storedInput, requirements: [requirement], appType,
          user_id: job.created_by, max_cases: 1, signal: controller.signal, onProgress,
          additional_context: [storedInput.additional_context, cases.length ? `Already proposed: ${cases.map(item => item.title).join("; ")}. Cover a different remaining scenario.` : ""].filter(Boolean).join("\n") });
        const candidate = preview.cases?.[0];
        if (!candidate) throw Object.assign(new Error("The model returned no usable Test Case."), { code: "AI_NATIVE_CONTRACT_INVALID", statusCode: 502 });
        cases.push({ ...candidate, client_id: `draft-${index + 1}`, reference_attachment_ids: [...new Set([...(candidate.reference_attachment_ids || []), ...require("@hellotest/platform/backend/services/aiAttachmentAccess.service").contextReferenceIds(storedInput.additional_context)])] });
        result = { ...preview, cases, generated: cases.length };
        await onProgress("evaluation", `${cases.length} of ${count} case proposals saved for review.`, result);
      }
      result = { ...result, cases, generated: cases.length, processing: lifecycle.processing({ status: "completed", stage: "review", profile, outputCount: cases.length }) };
    } else {
      result = await requirementService.previewRequirementCreation({ ...storedInput, project_id: job.project_id, user_id: job.created_by, onProgress, signal: controller.signal });
    }
    const completed = await completeGenerationJob(job.id, workerId, result);
    return { id: job.id, status: completed ? "completed" : "ownership_lost" };
  } catch (error) {
    stage = lifecycle.STAGES.includes(error.authoring_failure?.stage_id) ? error.authoring_failure.stage_id : lifecycle.failureStage(error, stage);
    const message = excerpt(error instanceof Error ? error.message : "Story generation failed", 1_000) || "Story generation failed";
    const failed = await failGenerationJob(job.id, workerId, error, stage, profile, checkpoint);
    return { id: job.id, status: failed ? "failed" : "ownership_lost" };
  } finally {
    clearInterval(heartbeat);
    activeGenerationControllers.delete(job.id);
  }
};

const drainGenerationQueue = async ({
  limit = STORY_GENERATION_QUEUE_LIMIT,
  workerId = STORY_GENERATION_WORKER_ID,
  leaseSeconds = STORY_GENERATION_LEASE_SECONDS
} = {}) => {
  const normalizedLimit = Math.max(1, Math.min(10, Number.parseInt(String(limit), 10) || STORY_GENERATION_QUEUE_LIMIT));
  const normalizedLeaseSeconds = Math.max(30, Math.min(15 * 60, Number.parseInt(String(leaseSeconds), 10) || STORY_GENERATION_LEASE_SECONDS));
  const outcomes = [];
  for (let index = 0; index < normalizedLimit; index += 1) {
    const job = await claimGenerationJob({ workerId, leaseSeconds: normalizedLeaseSeconds });
    if (!job) break;
    outcomes.push(await require("@hellotest/platform/backend/src/utils/llmTraceContext").run({ project_id: job.project_id, actor_id: job.created_by, request_id: job.id, generation_job_id: job.id, authoring_profile: job.job_kind || "story", authoring_schema_version: 1 }, () => runClaimedGenerationJob({ job, workerId, leaseSeconds: normalizedLeaseSeconds })));
  }
  return outcomes;
};

exports.processQueuedGenerationJobs = (options = {}) => {
  if (storyGenerationQueueRun) return storyGenerationQueueRun;
  storyGenerationQueueRun = drainGenerationQueue(options).finally(() => {
    storyGenerationQueueRun = null;
  });
  return storyGenerationQueueRun;
};

const scheduleGenerationJob = (task) => {
  setImmediate(() => {
    void Promise.resolve().then(task).catch(() => undefined);
  });
};

exports.createGenerationJob = async ({ input, userId, kind = "story", schedule = scheduleGenerationJob }) => {
  if (kind === "story") lifecycle.assertStoryBrief(input);
  const id = uuid();
  const queuedPayload = storyGenerationJobPayload("queued", null, "intake", kind);
  const row = await db.prepare(`INSERT INTO ai_requirement_generation_jobs (id, project_id, status, input_payload, result_payload, created_by, job_kind) VALUES (?, ?, 'queued', ?, ?, ?, ?) RETURNING *`).get(id, input.project_id, input, queuedPayload, userId, kind);
  // This trigger only lowers latency. The recurring worker is the durable path,
  // and always reloads the input and creator from PostgreSQL.
  try {
    schedule(() => exports.processQueuedGenerationJobs({ limit: 1 }));
  } catch {
    // The row is already durable; the recurring background worker will claim it.
  }
  return shapeJob(row);
};

exports.cancelGenerationJob = async (id, projectId) => {
  const current = await exports.getGenerationJob(id, projectId);
  if (!["queued", "running"].includes(current.status)) return current;
  const payload = { ...current.result_payload, ...storyGenerationJobPayload("cancelled", null, current.processing?.active_stage_id || "intake", current.job_kind) };
  const row = await db.prepare(`UPDATE ai_requirement_generation_jobs SET status = 'cancelled', result_payload = ?, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND status IN ('queued', 'running') RETURNING *`).get(payload, id, projectId);
  if (row) activeGenerationControllers.get(id)?.abort();
  return row ? shapeJob(row) : exports.getGenerationJob(id, projectId);
};

exports.getGenerationJob = async (id, projectId) => {
  const row = await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE id = ? AND project_id = ?`).get(id, projectId);
  if (!row) throw Object.assign(new Error("Story generation job not found"), { statusCode: 404 });
  return shapeJob(row);
};

exports.listGenerationJobs = async (projectId, status, limit = 10) => {
  const parsedLimit = Math.max(1, Math.min(50, Number.parseInt(String(limit), 10) || 10));
  const rows = status
    ? await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, status, parsedLimit)
    : await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, parsedLimit);
  return rows.map(shapeJob);
};


if (process.env.NODE_ENV === "test") {
  Object.defineProperty(exports, "__storyGenerationJobInternals", {
    enumerable: false,
    value: {
      claimGenerationJob,
      renewGenerationJobLease,
      completeGenerationJob,
      failGenerationJob,
      runClaimedGenerationJob,
      drainGenerationQueue,
      parseGenerationJobPayload,
      shapeJob,
      storyGenerationJobPayload,
      storyGenerationJobProcessing
    }
  });
}
