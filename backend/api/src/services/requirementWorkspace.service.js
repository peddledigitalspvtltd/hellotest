const { createHash, randomUUID: uuid } = require("crypto");
const db = require("../db");
const requirementService = require("./requirement.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const normalizeList = (value) => Array.isArray(value) ? value : [];
const excerpt = (value, length = 500) => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, length);
const hash = (input) => createHash("sha256").update(JSON.stringify(input || {})).digest("hex").slice(0, 20);
const REQUIREMENT_EXPORT_LIMIT = 500;

const assisted = ({ capability, input, evidence, confidence, payload }) => {
  const generatedAt = new Date().toISOString();
  const requestId = `${capability}-${Date.now()}`;
  const provenance = { capability, generation_mode: "deterministic", provider: "HelloTest evidence graph", model: null, request_id: requestId, input_fingerprint: hash(input), generated_at: generatedAt, confidence, evidence, fallback_used: false, fallback_reason: null, requires_human_review: true };
  return { ...payload, integration: { id: "qaira-evidence-graph", name: "HelloTest evidence graph", type: "deterministic", model: null, generation_mode: "deterministic", direct_model_invocation: false }, provenance, generation_mode: "deterministic", generated_at: generatedAt, request_id: requestId, input_fingerprint: provenance.input_fingerprint, confidence, fallback_used: false, fallback_reason: null, requires_human_review: true, preview_only: true };
};

exports.previewGrooming = async ({ requirement, project }) => {
  const [comments, attachments, linkedCases, defects] = await Promise.all([
    db.prepare("SELECT id, body, created_at FROM entity_comments WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY created_at DESC LIMIT 20").all(requirement.id),
    db.prepare("SELECT id, file_name, mime_type, size_bytes, created_at FROM attachments WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY created_at DESC LIMIT 20").all(requirement.id),
    db.prepare("SELECT test_cases.id, test_cases.display_id, test_cases.title, test_cases.status FROM requirement_test_cases JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id WHERE requirement_test_cases.requirement_id = ? ORDER BY test_cases.title LIMIT 50").all(requirement.id),
    db.prepare("SELECT feedback.id, feedback.jira_bug_key, feedback.title, feedback.status FROM requirement_defects JOIN feedback ON feedback.id = requirement_defects.issue_id WHERE requirement_defects.requirement_id = ? ORDER BY feedback.created_at DESC LIMIT 50").all(requirement.id)
  ]);
  const sources = [
    { type: "story", ref: `requirement:${requirement.id}`, id: requirement.id, title: requirement.title, excerpt: excerpt(requirement.description, 1000), status: requirement.status },
    ...comments.map((item) => ({ type: "comment", ref: `comment:${item.id}`, id: item.id, title: "Story comment", excerpt: excerpt(item.body) })),
    ...attachments.map((item) => ({ type: "attachment", ref: `attachment:${item.id}`, id: item.id, title: item.file_name, excerpt: `${item.mime_type}; ${item.size_bytes} bytes` })),
    ...linkedCases.map((item) => ({ type: "related-project-record", ref: `test-case:${item.id}`, id: item.id, title: item.title, status: item.status })),
    ...defects.map((item) => ({ type: "linked-ticket", ref: `issue:${item.id}`, id: item.id, title: item.title, status: item.status }))
  ];
  const description = excerpt(requirement.description, 4000);
  const evidenceRefs = sources.map((item) => item.ref);
  const hasDescription = Boolean(description);
  return assisted({
    capability: "story-grooming-preview",
    input: { requirement_id: requirement.id, project_id: project.id },
    evidence: evidenceRefs,
    confidence: hasDescription ? Math.min(0.9, 0.62 + sources.length * 0.02) : 0.48,
    payload: {
      requirement: { id: requirement.id, display_id: requirement.display_id || requirement.id, title: requirement.title, status: requirement.status, priority: requirement.priority },
      grooming: {
        layman: { explanation: hasDescription ? description : `${requirement.title} is recorded without a detailed description.`, analogy: "Treat this Story as a shared contract: product intent, implementation boundaries, and observable outcomes should agree before testing starts.", evidence_refs: [`requirement:${requirement.id}`] },
        business: { context: hasDescription ? description : "Business context is not yet documented.", roles_and_flow: comments.length ? ["Use recorded stakeholder comments to confirm the primary actor and decision flow."] : ["Identify the primary user, trigger, expected outcome, and failure recovery path."], use_cases: linkedCases.length ? linkedCases.map((item) => `Validate coverage intent in ${item.display_id || item.id}: ${item.title}`).slice(0, 8) : ["Document the primary success path.", "Document validation, permission, and recovery paths."], evidence_refs: evidenceRefs.slice(0, 12) },
        technical: { overview: hasDescription ? description : "Technical behavior is not yet specified.", functional_requirements: ["Define observable inputs, state changes, and outputs.", "Define validation and permission boundaries."], data_and_integrations: normalizeList(requirement.external_references).length ? requirement.external_references.map((item) => `Review external dependency: ${item}`).slice(0, 10) : ["No external integration reference is currently recorded."], non_functional_requirements: ["Confirm security, accessibility, reliability, and performance expectations appropriate to the flow."], testability_notes: linkedCases.length ? [`${linkedCases.length} linked test case${linkedCases.length === 1 ? " is" : "s are"} available for review.`] : ["No linked test case exists; add traceable coverage before readiness approval."], evidence_refs: evidenceRefs.slice(0, 12) },
        assumptions: [!hasDescription ? "The intended behavior cannot be inferred beyond the title." : null, !comments.length ? "No stakeholder comment context is recorded." : null].filter(Boolean),
        open_questions: ["What user or system role initiates this behavior?", "What is the measurable success outcome?", "Which validation, permission, and recovery paths are required?"],
        risks: [!linkedCases.length ? "No linked test coverage is recorded." : null, defects.some((item) => item.status !== "closed") ? "Open linked defects may affect readiness." : null, !attachments.length ? "No attachment evidence is recorded." : null].filter(Boolean),
        review_evidence_refs: evidenceRefs
      },
      context: { scope: { project_id: project.id, project_key: project.display_id || project.id }, bounded: true, limits: { comments: 20, attachments: 20, attachment_text_files: 0, attachment_text_bytes: 0, attachment_text_chars: 0, linked_tickets: 50, related_project_records: 50, comment_chars: 500, description_chars: 4000 }, included: { comments: comments.length, attachments: attachments.length, attachment_text_files: 0, linked_tickets: defects.length, related_project_records: linkedCases.length }, omitted: { comments: 0, attachments: 0, attachment_text: attachments.length, linked_tickets: 0 }, partial_sources: [], unavailable_sources: attachments.length ? ["attachment-text-extraction"] : [], sources }
    }
  });
};

exports.previewGherkin = ({ requirements = [] }) => {
  const drafts = requirements.slice(0, 20).map((item, index) => {
    const clientId = String(item.client_id || `requirement-${index + 1}`);
    const title = excerpt(item.title, 180) || `Requirement ${index + 1}`;
    const criteria = normalizeList(item.acceptance_criteria).map((value) => excerpt(value, 300)).filter(Boolean);
    const outcomes = criteria.length ? criteria : [excerpt(item.description, 300) || `the ${title.toLowerCase()} behavior is requested`];
    return { client_id: clientId, gherkin_scenarios: outcomes.slice(0, 8).map((outcome, outcomeIndex) => `Scenario: ${title}${outcomes.length > 1 ? ` - ${outcomeIndex + 1}` : ""}\n  Given the user has the required access and preconditions\n  When ${outcome.replace(/[.]$/, "")}\n  Then the expected outcome is observable and recorded`) };
  });
  return { requirements: drafts, fallback_used: false, fallback_reason: null, validation: { story_count: drafts.length, scenario_count: drafts.reduce((total, item) => total + item.gherkin_scenarios.length, 0), repaired_story_count: 0, exact_story_draft_used: true } };
};

exports.exportRequirements = async ({ projectId, requirementIds = [], userId, format = "csv" }) => {
  const ids = [...new Set(requirementIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (ids.length > REQUIREMENT_EXPORT_LIMIT) {
    throw Object.assign(new Error(`A single Story export is limited to ${REQUIREMENT_EXPORT_LIMIT} records.`), { statusCode: 413, code: "EXPORT_LIMIT_EXCEEDED" });
  }

  const selected = await requirementService.getRequirements({
    project_id: projectId,
    ids,
    limit: ids.length || REQUIREMENT_EXPORT_LIMIT + 1
  });
  if (!ids.length && selected.length > REQUIREMENT_EXPORT_LIMIT) {
    throw Object.assign(new Error(`This project has more than ${REQUIREMENT_EXPORT_LIMIT} Stories. Select a smaller export set.`), { statusCode: 413, code: "EXPORT_LIMIT_EXCEEDED" });
  }
  const skipped = ids.filter((id) => !selected.some((item) => item.id === id)).map((id) => ({ id, code: "NOT_FOUND", message: "Story is missing or outside the selected project." }));
  const completedAt = new Date().toISOString();
  const transaction = await workspaceTransactionService.createTransaction({ project_id: projectId, category: "bulk_export", action: "requirement_export", status: "completed", title: "Story export", description: `Exported ${selected.length} Story record${selected.length === 1 ? "" : "s"}.`, metadata: { export_format: format, total_items: ids.length || selected.length, processed_items: selected.length, exported: selected.length, failed: skipped.length, progress_percent: 100, current_phase: "completed" }, related_kind: "requirement", created_by: userId, started_at: completedAt, completed_at: completedAt });
  return { id: transaction.id, transaction_id: transaction.id, queued: false, status: "completed", count: selected.length, skipped, requirement_records: selected };
};

const shapeJob = (row) => ({ ...row, ...(row.result_payload && typeof row.result_payload === "object" ? row.result_payload : {}), job_id: row.id, queued: row.status === "queued", input_payload: row.input_payload || {} });

exports.createGenerationJob = async ({ input, userId }) => {
  const id = uuid();
  await db.prepare(`INSERT INTO ai_requirement_generation_jobs (id, project_id, status, input_payload, created_by, started_at) VALUES (?, ?, 'running', ?, ?, CURRENT_TIMESTAMP)`).run(id, input.project_id, input, userId);
  try {
    const result = await requirementService.previewRequirementCreation({ ...input, user_id: userId });
    const row = await db.prepare(`UPDATE ai_requirement_generation_jobs SET status = 'completed', result_payload = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`).get(result, id);
    return shapeJob(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story generation failed";
    const row = await db.prepare(`UPDATE ai_requirement_generation_jobs SET status = 'failed', last_error = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`).get(message, id);
    return shapeJob(row);
  }
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
