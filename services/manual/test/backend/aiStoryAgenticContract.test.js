const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
const requirementService = require("../../backend/services/requirement.service");
const requirementWorkspaceService = require("../../backend/services/requirementWorkspace.service");
const internals = requirementService.__storyAiInternals;

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("Story AI processing completes backend work while leaving review current", () => {
  const processing = internals.buildStoryProcessingSnapshot({
    profile: "story-create",
    sourceCount: 2,
    outputCount: 1,
    limitationCount: 1
  });

  assert.equal(processing.active_stage_id, "review");
  assert.equal(processing.completed_stage_count, 6);
  assert.equal(processing.total_stage_count, 7);
  assert.equal(processing.status_label, "Awaiting human review");
  assert.deepEqual(processing.stages.map((stage) => stage.id), ["intake", "context", "guardrails", "specialist", "outcome", "evaluation", "review"]);
  assert.ok(processing.stages.slice(0, 6).every((stage) => stage.status === "complete"));
  assert.equal(processing.stages[6].status, "current");
});

test("Story creation fallback is evidence-preserving and creates nothing without written context", () => {
  assert.deepEqual(internals.buildDeterministicRequirementCreation({
    additionalContext: "",
    externalLinks: [],
    priority: 3,
    status: "open",
    evidenceRefs: []
  }), []);

  const [draft] = internals.buildDeterministicRequirementCreation({
    additionalContext: "Review invoices before approval\nOnly finance reviewers may approve.",
    externalLinks: ["https://example.test/spec"],
    priority: 3,
    status: "open",
    evidenceRefs: ["user-guidance:story-brief"]
  });

  assert.equal(draft.title, "Review invoices before approval");
  assert.match(draft.description, /Only finance reviewers may approve/);
  assert.deepEqual(draft.acceptance_criteria, []);
  assert.deepEqual(draft.field_evidence.title, ["user-guidance:story-brief"]);
  assert.doesNotMatch(draft.description, /required access|expected outcome is observable/i);
});

test("Story candidate normalization removes forged refs and exposes field grounding gaps", () => {
  const defaults = {
    externalLinks: ["https://provided.test/spec"],
    priority: 3,
    status: "open",
    allowedEvidenceRefs: new Set(["user-guidance:story-brief"])
  };
  const rejected = internals.normalizeRequirementCreationCandidate({
    client_id: "draft-1",
    title: "Approve invoices",
    description: "A finance reviewer approves a reviewed invoice.",
    evidence_refs: ["user-guidance:story-brief", "forged:source"],
    field_evidence: { title: ["forged:source"], description: ["user-guidance:story-brief"] }
  }, 0, defaults);
  assert.equal(rejected, null, "unsupported core prose must not be returned for rendering");

  const candidate = internals.normalizeRequirementCreationCandidate({
    client_id: "draft-2",
    title: "Approve invoices",
    description: "A finance reviewer approves a reviewed invoice.",
    priority: 1,
    status: "ready",
    acceptance_criteria: ["Approval records the reviewer and timestamp."],
    external_references: ["https://invented.test"],
    evidence_refs: ["user-guidance:story-brief", "forged:source"],
    field_evidence: {
      title: ["user-guidance:story-brief"],
      description: ["user-guidance:story-brief"],
      priority: [],
      status: [],
      acceptance_criteria: []
    }
  }, 1, defaults);

  assert.deepEqual(candidate.evidence_refs, ["user-guidance:story-brief"]);
  assert.deepEqual(candidate.field_evidence.title, ["user-guidance:story-brief"]);
  assert.deepEqual(candidate.external_references, ["https://provided.test/spec"]);
  assert.equal(candidate.priority, 3);
  assert.equal(candidate.status, "open");
  assert.deepEqual(candidate.acceptance_criteria, []);
  assert.deepEqual(candidate.unsupported_fields, ["acceptance criteria"]);
  assert.equal(candidate.evaluation.grounding, "partially-grounded");
  assert.match(candidate.limitations[0], /acceptance criteria/);
});

test("Story evidence uses stable common fields and identifies pointer-only references", () => {
  const evidence = internals.buildStoryCreationEvidence({
    additionalContext: "Create a report export Story.",
    externalLinks: ["https://example.test/spec"],
    images: [{ name: "report.png", url: "data:image/png;base64,AAAA" }],
    knowledge: { knowledge: [{ id: "knowledge-1", title: "Report export rules", content: "Exports contain the currently visible rows." }] }
  });

  assert.ok(evidence.every((item) => item.ref && item.id && item.title && item.trust));
  assert.equal(evidence.find((item) => item.type === "external-reference").citation_allowed, false);
  assert.equal(evidence.find((item) => item.type === "external-reference").trust, "pointer-only");
  assert.equal(evidence.find((item) => item.type === "knowledge").ref, "knowledge:knowledge-1");
  assert.equal(evidence.find((item) => item.type === "knowledge").trust, "workspace");

  const firstFingerprint = internals.storyRequestFingerprint({ context: "same", evidence: ["knowledge:knowledge-1"] });
  const secondFingerprint = internals.storyRequestFingerprint({ context: "same", evidence: ["knowledge:knowledge-1"] });
  const changedFingerprint = internals.storyRequestFingerprint({ context: "changed", evidence: ["knowledge:knowledge-1"] });
  assert.equal(firstFingerprint, secondFingerprint);
  assert.notEqual(firstFingerprint, changedFingerprint);
  assert.equal(firstFingerprint.length, 24);

  const ranked = internals.rankStoryKnowledge([
    { id: "unrelated", title: "Login policy", content: "Password rotation and session timeout." },
    { id: "relevant", title: "Report export rules", content: "CSV exports contain the visible report rows." }
  ], "Create a CSV report export for visible rows");
  assert.deepEqual(ranked.map((item) => item.id), ["relevant"]);
});

test("Gherkin preview skips Stories without explicit criteria and does not invent access", () => {
  const response = requirementWorkspaceService.previewGherkin({
    requirements: [
      { client_id: "no-criteria", title: "Export report", description: "Export a report." },
      { client_id: "with-criteria", title: "Export report", acceptance_criteria: ["A CSV download contains the visible rows."] }
    ]
  });

  assert.deepEqual(response.requirements[0].gherkin_scenarios, []);
  assert.equal(response.validation.skipped_story_count, 1);
  assert.match(response.requirements[1].gherkin_scenarios[0], /Then A CSV download contains the visible rows/);
  assert.doesNotMatch(response.requirements[1].gherkin_scenarios[0], /required access|preconditions/);
});

test("Story completion discards unsupported changed fields and routes enforce bounded AI inputs", async () => {
  const [serviceSource, routeSource] = await Promise.all([
    readSource("../../backend/services/requirement.service.js"),
    readSource("../../backend/routes/requirements.routes.js")
  ]);

  assert.match(serviceSource, /Unsupported model changes were discarded for:/);
  assert.match(serviceSource, /proposedTitle !== requirement\.title && !fieldEvidence\.title\.length \? requirement\.title/);
  assert.match(serviceSource, /proposedAcceptanceCriteria\.length && !fieldEvidence\.acceptance_criteria\.length \? \[\]/);
  assert.match(serviceSource, /item\.type === "reference-image"/);
  assert.match(serviceSource, /item\.trust = "manual-review-only"/);
  assert.match(serviceSource, /review_status: "awaiting_review"/);
  assert.match(serviceSource, /requires_human_review: true/);
  assert.match(serviceSource, /preview_only: true/);
  assert.match(serviceSource, /request_id: requestId/);
  assert.match(serviceSource, /input_fingerprint: inputFingerprint/);
  assert.match(serviceSource, /buildKnowledgeContextPackage\(project_id/);

  const createRouteStart = routeSource.indexOf('fastify.post("/requirements/ai-create-jobs"');
  const createRouteEnd = routeSource.indexOf('fastify.get("/requirements/ai-create-jobs/:jobId"', createRouteStart);
  const createRoute = routeSource.slice(createRouteStart, createRouteEnd);
  assert.match(createRoute, /additional_context: \{ required: false, type: "string", maxLength: 20000 \}/);
  assert.match(createRoute, /external_links: \{ required: false, type: "array", items: "string", maxItems: 20 \}/);
  assert.match(createRoute, /images: \{ required: false, type: "array", maxItems: 4 \}/);
  assert.match(createRoute, /requirePermission\("requirement\.ai"/);
});

test("Story creation jobs execute from persisted input and complete through an owned lease", async () => {
  const db = require("../../../platform/backend/src/db");
  const originalPrepare = db.prepare;
  const originalTransaction = db.transaction;
  const originalPreview = requirementService.previewRequirementCreation;
  const rows = new Map();
  let scheduledTask;
  let resolvePreview;
  let previewInput;
  const previewResult = {
    generated: 1,
    requirements: [{ client_id: "draft-1", title: "Grounded draft" }],
    processing: internals.buildStoryProcessingSnapshot({ profile: "story-create", sourceCount: 1, outputCount: 1 }),
    review_status: "awaiting_review",
    requires_human_review: true,
    preview_only: true
  };

  db.transaction = (callback) => async (...args) => callback(...args);
  db.prepare = (sql) => {
    if (sql.includes("INSERT INTO ai_requirement_generation_jobs")) return {
      get: async (id, projectId, inputPayload, resultPayload, createdBy) => {
        const row = { id, project_id: projectId, status: "queued", input_payload: inputPayload, result_payload: resultPayload, created_by: createdBy, attempts: 0, created_at: new Date().toISOString() };
        rows.set(id, row);
        return { ...row };
      }
    };
    if (sql.includes("FOR UPDATE SKIP LOCKED")) return {
      get: async () => {
        const row = [...rows.values()].find((candidate) => candidate.status === "queued" || (candidate.status === "running" && (!candidate.lease_expires_at || Date.parse(candidate.lease_expires_at) <= Date.now())));
        return row ? { id: row.id } : undefined;
      }
    };
    if (sql.includes("attempts = attempts + 1")) return {
      get: async (resultPayload, leaseOwner, leaseSeconds, id) => {
        const row = rows.get(id);
        const claimable = row && (row.status === "queued" || (row.status === "running" && (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.now())));
        if (!claimable) return undefined;
        Object.assign(row, { status: "running", result_payload: resultPayload, attempts: Number(row.attempts || 0) + 1, lease_owner: leaseOwner, lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(), heartbeat_at: new Date().toISOString(), started_at: row.started_at || new Date().toISOString() });
        return { ...row };
      }
    };
    if (sql.includes("SET lease_expires_at") && !sql.includes("status = 'completed'")) return {
      run: async (leaseSeconds, id, leaseOwner) => {
        const row = rows.get(id);
        if (!row || row.status !== "running" || row.lease_owner !== leaseOwner) return { changes: 0 };
        row.lease_expires_at = new Date(Date.now() + leaseSeconds * 1000).toISOString();
        return { changes: 1 };
      }
    };
    if (sql.includes("SET status = 'completed'")) return {
      get: async (resultPayload, id, leaseOwner) => {
        const row = rows.get(id);
        if (!row || row.status !== "running" || row.lease_owner !== leaseOwner || Date.parse(row.lease_expires_at) <= Date.now()) return undefined;
        Object.assign(row, { status: "completed", result_payload: resultPayload, lease_owner: null, lease_expires_at: null, heartbeat_at: null, completed_at: new Date().toISOString() });
        return { ...row };
      }
    };
    if (sql.includes("SET status = 'failed'")) return {
      get: async (resultPayload, lastError, id, leaseOwner) => {
        const row = rows.get(id);
        if (!row || row.status !== "running" || row.lease_owner !== leaseOwner || Date.parse(row.lease_expires_at) <= Date.now()) return undefined;
        Object.assign(row, { status: "failed", result_payload: resultPayload, last_error: lastError, lease_owner: null, lease_expires_at: null, heartbeat_at: null });
        return { ...row };
      }
    };
    if (sql.includes("SELECT * FROM ai_requirement_generation_jobs WHERE id")) return {
      get: async (id, projectId) => rows.get(id)?.project_id === projectId ? { ...rows.get(id) } : undefined
    };
    throw new Error(`Unexpected job SQL: ${sql}`);
  };
  requirementService.previewRequirementCreation = async (input) => {
    previewInput = input;
    return new Promise((resolve) => { resolvePreview = resolve; });
  };

  try {
    const queued = await requirementWorkspaceService.createGenerationJob({
      input: { project_id: "project-1", additional_context: "Grounded context" },
      userId: "user-1",
      schedule: (task) => { scheduledTask = task; }
    });
    assert.equal(queued.status, "queued");
    assert.equal(queued.processing.status_label, "Queued for backend processing");
    assert.equal(queued.processing.stages[0].status, "queued");

    // Prove the worker reloads durable payload instead of retaining the request
    // closure: a restart-equivalent persisted change is what execution sees.
    rows.get(queued.id).input_payload = { project_id: "forged-project", additional_context: "Persisted grounded context" };

    const runner = scheduledTask();
    await new Promise((resolve) => setImmediate(resolve));
    const running = await requirementWorkspaceService.getGenerationJob(queued.id, "project-1");
    assert.equal(running.status, "running");
    assert.equal(running.processing.status_label, "Story generation request in progress");
    assert.equal(running.processing.stages[0].status, "running");
    assert.equal(previewInput.additional_context, "Persisted grounded context");
    assert.equal(previewInput.project_id, "project-1", "the persisted row scope must override nested input scope");
    assert.equal(previewInput.user_id, "user-1");

    resolvePreview(previewResult);
    await runner;
    const completed = await requirementWorkspaceService.getGenerationJob(queued.id, "project-1");
    assert.equal(completed.status, "completed");
    assert.equal(completed.processing.active_stage_id, "review");
    assert.equal(completed.processing.stages[6].status, "current");
    assert.equal(completed.review_status, "awaiting_review");

    let failedTask;
    requirementService.previewRequirementCreation = async () => { throw new Error("provider selection failed"); };
    const secondQueued = await requirementWorkspaceService.createGenerationJob({
      input: { project_id: "project-1", additional_context: "Another grounded request" },
      userId: "user-1",
      schedule: (task) => { failedTask = task; }
    });
    await failedTask();
    const failed = await requirementWorkspaceService.getGenerationJob(secondQueued.id, "project-1");
    assert.equal(failed.status, "failed");
    assert.equal(failed.processing.stages[0].status, "failed");
    assert.equal(failed.review_status, "not_available");
    assert.equal(failed.last_error, "provider selection failed");
  } finally {
    db.prepare = originalPrepare;
    db.transaction = originalTransaction;
    requirementService.previewRequirementCreation = originalPreview;
  }
});
