const crypto = require("crypto");
const db = require("../db");
const issueService = require("./issues.service");

const priorityLabel = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (["highest", "critical", "p1", "1"].includes(text)) return "Highest";
  if (["high", "p2", "2"].includes(text)) return "High";
  if (["low", "p4", "4"].includes(text)) return "Low";
  if (["lowest", "p5", "5"].includes(text)) return "Lowest";
  return "Medium";
};

const suggestedPriority = (issue) => {
  const evidence = `${issue.title || ""} ${issue.message || ""} ${issue.severity || ""}`.toLowerCase();
  if (/security|data loss|outage|critical|payment|production down/.test(evidence)) return "Highest";
  if (/block|crash|cannot|failure|high/.test(evidence)) return "High";
  return priorityLabel(issue.priority);
};

exports.previewTriage = async ({ project, issueIds = [] }) => {
  const ids = [...new Set(issueIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one defect to triage");
  if (ids.length > 50) throw new Error("Triage at most 50 defects at a time");
  const issues = [];
  for (const id of ids) {
    const issue = await issueService.getIssueItem(id);
    if (issue.project_id !== project.id) {
      const error = new Error("Every selected defect must belong to the current project");
      error.statusCode = 403;
      throw error;
    }
    issues.push(issue);
  }

  const generatedAt = new Date().toISOString();
  const triage = issues.map((issue) => {
    const recommended = suggestedPriority(issue);
    const signals = [issue.severity ? `Severity is ${issue.severity}.` : null, issue.environment ? `Environment evidence is available (${issue.environment}).` : null, issue.linked_test_run_id ? "A test run is linked." : null, Array.isArray(issue.linked_requirement_ids) && issue.linked_requirement_ids.length ? `${issue.linked_requirement_ids.length} requirement link(s).` : null].filter(Boolean);
    return {
      issue_id: issue.id,
      display_id: issue.jira_bug_key || issue.id,
      title: issue.title,
      category: /security|permission|auth/i.test(`${issue.title} ${issue.message}`) ? "Security / access" : /performance|slow|timeout/i.test(`${issue.title} ${issue.message}`) ? "Performance / reliability" : "Functional defect",
      current_priority: priorityLabel(issue.priority),
      recommended_priority: recommended,
      explanation: signals.length ? "Recommendation is derived from the recorded severity, environment, and traceability evidence." : "Limited evidence is available; keep the current priority until a reviewer adds reproduction and impact evidence.",
      signals,
      review_actions: ["Verify the reproduction steps and expected-versus-actual behavior.", "Confirm impact and priority with a human reviewer.", issue.linked_test_run_id ? "Review the linked run evidence before changing status." : "Link a failing run or test case when available."]
    };
  });

  const evidence = issues.map((issue) => `issue:${issue.id}`);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ project_id: project.id, issue_ids: ids })).digest("hex").slice(0, 20);
  const provenance = { capability: "bug-triage-preview", generation_mode: "deterministic", provider: "HelloTest evidence graph", model: null, request_id: `bug-triage-${Date.now()}`, input_fingerprint: fingerprint, generated_at: generatedAt, confidence: triage.some((item) => item.signals.length) ? 0.78 : 0.52, evidence, fallback_used: false, fallback_reason: null, requires_human_review: true };
  return {
    scope: { project_id: project.id, project_key: project.display_id || project.id, issue_count: issues.length, maximum_issue_count: 50 },
    summary: `${issues.length} defect${issues.length === 1 ? "" : "s"} assessed from current HelloTest evidence. No defect was modified.`,
    triage,
    review_sequence: ["Review highest-impact recommendations first.", "Validate reproduction and linked evidence.", "Apply priority or status changes only after human approval."],
    limitations: ["Recommendations use the current HelloTest record and traceability fields; unrecorded production impact is not inferred."],
    integration: { id: "hellotest-evidence-graph", name: "HelloTest evidence graph", type: "deterministic", model: null, generation_mode: "deterministic", direct_model_invocation: false },
    provenance,
    generation_mode: "deterministic",
    generated_at: generatedAt,
    request_id: provenance.request_id,
    input_fingerprint: fingerprint,
    confidence: provenance.confidence,
    fallback_used: false,
    fallback_reason: null,
    requires_human_review: true,
    preview_only: true,
    decision_requires_human_approval: true
  };
};

exports.bulkDelete = async ({ projectId, issueIds = [] }) => {
  const ids = [...new Set(issueIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return { requested: 0, deleted: 0, deleted_ids: [], failed: 0, failures: [] };
  if (ids.length > 200) throw new Error("Delete at most 200 defects at a time");
  const placeholders = ids.map(() => "?").join(",");
  const scoped = await db.prepare(`SELECT id, COALESCE(jira_bug_key, id) AS display_id FROM feedback WHERE project_id = ? AND id IN (${placeholders})`).all(projectId, ...ids);
  if (scoped.length !== ids.length) {
    const error = new Error("One or more selected defects are missing or outside the current project");
    error.statusCode = 409;
    throw error;
  }
  const transaction = db.transaction(async () => {
    await db.prepare(`DELETE FROM feedback WHERE project_id = ? AND id IN (${placeholders})`).run(projectId, ...ids);
  });
  await transaction();
  return { requested: ids.length, deleted: ids.length, deleted_ids: ids, failed: 0, failures: [] };
};
