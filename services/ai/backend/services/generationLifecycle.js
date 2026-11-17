const { stages: STAGES } = require("../../shared/generationStages.json");

// This contract is shared by persisted jobs and immediate authoring previews.
// A stage is advanced by the operation that actually completed it, never by
// matching translated error prose.
function processing({ status = "running", stage = "intake", profile = "authoring", detail, outputCount = 0 } = {}) {
  const active = Math.max(0, STAGES.indexOf(stage));
  return {
    schema_version: 1, profile, status, active_stage_id: STAGES[active],
    completed_stage_count: active, total_stage_count: STAGES.length,
    output_count: outputCount,
    status_label: status === "completed" ? "Awaiting human review" : status === "failed" ? "Generation needs attention" : status === "cancelled" ? "Generation stopped" : status === "queued" ? "Queued for backend processing" : detail || "Generating a reviewable proposal",
    stages: STAGES.map((id, index) => ({ id, status: index < active ? "complete" : index > active ? "queued" : status === "completed" ? "current" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : status === "queued" ? "queued" : "running", detail: index === active ? detail || "" : index < active ? "Completed." : "Waiting for the preceding stage." }))
  };
}

function failureStage(error, observedStage = "intake") {
  // Response validation can fail inside the shared provider boundary before a
  // feature receives a decoded object. Its typed code confirms that output was
  // received; message wording never supplies phase evidence.
  if (observedStage === "specialist" && ["AI_OUTPUT_TRUNCATED", "AI_NATIVE_CONTRACT_INVALID", "AI_INVALID_JSON", "AI_OUTPUT_SCHEMA_VIOLATION", "AI_MANAGED_SCHEMA_INVALID", "AI_DEFECT_RESPONSE_INVALID", "AI_STORY_RESPONSE_INVALID", "AI_TEST_CASE_RESPONSE_INVALID", "AI_GROOMING_OUTPUT_INVALID"].includes(error?.code)) return "outcome";
  if (["AI_INSTRUCTION_MISSING", "AI_FEATURE_UNMAPPED", "AI_INPUT_BUDGET_EXCEEDED"].includes(error?.code) && observedStage === "specialist") return "guardrails";
  return observedStage;
}

function failure(error, stage = "intake") {
  stage = failureStage(error, stage);
  const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || "") ? error.code : "AI_GENERATION_FAILED";
  const seconds = Math.max(0, Math.ceil(Number(error?.retryAfterSeconds ?? (Number(error?.retryAfterMs || 0) / 1000)) || 0));
  const message = String(error?.publicMessage || error?.message || "Generation could not complete.").slice(0, 1000);
  return { code, message, stage_id: stage, retryable: error?.retryable !== false && error?.nonRetryable !== true,
    retry_after_seconds: seconds, retry_at: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null };
}

// Immediate previews cannot stream intermediate phases to their waiting UI.
// Keep the same confirmed-stage contract as durable jobs, including failures
// raised before the provider and validation raised inside its boundary.
function withLifecycle(profile, operation, { snapshotProgress = false } = {}) {
  return (input = {}) => run(profile, report => operation({ ...input, onProgress: report }), {
    onProgress: snapshotProgress ? (stage, detail) => input.onProgress?.(processing({ stage, profile, detail })) : input.onProgress
  });
}

function classifiedFailure(error, stage) {
  const classified = require("@hellotest/platform/backend/src/utils/httpErrorPolicy").classifyError(error);
  return failure({ ...classified, retryAfterSeconds: classified.retryAfterSeconds }, stage);
}

async function run(profile, operation, { onProgress } = {}) {
  const trace = require("@hellotest/platform/backend/src/utils/llmTraceContext");
  const metrics = require("@hellotest/platform/agent-metrics");
  const progressOwner = onProgress && trace.current().generation_job_id;
  return trace.run({ authoring_profile: profile, authoring_schema_version: 1 }, async () => {
    let stage = "intake";
    const report = async (next, detail, extra) => {
      if (!STAGES.includes(next)) throw new TypeError("Unknown authoring stage");
      stage = next;
      trace.update({ authoring_stage: stage });
      if (!progressOwner) metrics.event("authoring", { phase: stage, details: { code: "STAGE_STARTED" } });
      await onProgress?.(stage, detail, extra);
    };
    try {
      await report("intake", "Validating the authoring request and its scope.");
      const result = await operation(report);
      if (stage !== "review") await report("review", "The validated proposal is ready for explicit human review.");
      return result?.processing ? result : { ...result, processing: processing({ status: "completed", stage: "review", profile, outputCount: result?.cases?.length ?? result?.drafts?.length ?? 1 }) };
    } catch (error) {
      // An inner feature retains its more precise confirmed stage when a route
      // also wraps intake validation and permission checks.
      if (!error.authoring_failure) {
        stage = failureStage(error, stage);
        error.authoring_failure = classifiedFailure(error, stage);
        error.authoring_processing = processing({ status: "failed", stage, profile, detail: error.authoring_failure.message });
        metrics.event("authoring", { phase: stage, level: "error", details: { code: error.authoring_failure.code } });
      }
      throw error;
    }
  });
}

function assertStoryBrief(input = {}) {
  const text = String(input.additional_context || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(input.images) && input.images.length) return;
  // A local preflight has no provider cost. Briefs must name more than a topic;
  // images remain legitimate evidence without invented text requirements.
  if (text.length < 40 || text.split(/\s+/).length < 7) {
    const message = "Describe the actor, intended behavior and expected outcome in at least one clear sentence before generating a Story.";
    throw Object.assign(new Error(message), { code: text ? "AI_STORY_BRIEF_TOO_SHORT" : "AI_STORY_EVIDENCE_REQUIRED", statusCode: 422, publicMessage: message, retryable: false });
  }
}

const storyProcessing = ({ profile, sourceCount, outputCount, fallbackUsed = false, limitationCount = 0 }) => ({
  schema_version: 1, status: "completed", output_count: outputCount,
  profile,
  active_stage_id: "review",
  completed_stage_count: 6,
  total_stage_count: STAGES.length,
  status_label: fallbackUsed ? "Fallback result awaiting review" : "Awaiting human review",
  review_status: "awaiting_review",
  stages: [
    { id: "intake", status: "complete", detail: profile === "story-create" ? "The requested Story outcome and output count were bounded." : "The saved Story revision was captured before proposing changes.", evidence: "The request was normalized without changing saved Story data.", item_count: 1 },
    { id: "context", status: "complete", detail: `${sourceCount} bounded evidence source${sourceCount === 1 ? " was" : "s were"} prepared.`, evidence: `${sourceCount} source${sourceCount === 1 ? "" : "s"} remained inside the visible Story AI evidence catalog.`, item_count: sourceCount },
    { id: "guardrails", status: "complete", detail: "Source limits, pointer-only links, and the human approval boundary were checked.", evidence: `${limitationCount} evidence limitation${limitationCount === 1 ? " was" : "s were"} recorded for review.`, item_count: limitationCount },
    { id: "specialist", status: "complete", detail: fallbackUsed ? "The configured provider was unavailable, so only the evidence-preserving fallback was used." : "The Story Architect returned a bounded JSON proposal.", evidence: fallbackUsed ? "No unavailable source content was converted into generated product behavior." : "The configured Story AI usage produced the proposal.", item_count: outputCount },
    { id: "outcome", status: "complete", detail: `${outputCount} editable proposal${outputCount === 1 ? " was" : "s were"} normalized.`, evidence: "Unknown evidence references were removed before the response was returned.", item_count: outputCount },
    { id: "evaluation", status: "complete", detail: "Grounding, completeness, and testability were evaluated from normalized fields.", evidence: "Scores come from deterministic field checks, not model self-assessment.", item_count: outputCount },
    { id: "review", status: "current", detail: "Processing is complete; a person must accept, edit, or discard the proposal.", evidence: "No Story is created or updated by this preview response.", item_count: outputCount }
  ]
});


module.exports = { STAGES, processing, failure, assertStoryBrief, storyProcessing, failureStage, withLifecycle, run, classifiedFailure };
