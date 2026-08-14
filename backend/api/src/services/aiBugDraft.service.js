const crypto = require("crypto");
const db = require("../db");
const aiLlmSelectionService = require("./aiLlmSelection.service");
const { normalizeReferenceList } = require("../utils/externalReferences");
const { fetchLlmWithRetry } = require("../utils/llmHttpClient");

const normalizeText = (value, max = 18_000) => String(value || "").trim().slice(0, max);
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex").slice(0, 20);
const extractJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text);
};
const allowedSeverity = new Set(["critical", "high", "medium", "low"]);
const allowedPriority = new Set(["p1", "p2", "p3", "p4"]);

const loadEvidence = async ({ projectId, runId, testCaseIds, requirementIds }) => {
  const run = runId ? await db.prepare("SELECT id, display_id, name, status, trigger, release, sprint, build, project_id, test_environment_id FROM executions WHERE id = ? AND project_id = ?").get(runId, projectId) : null;
  const cases = [];
  for (const id of testCaseIds.slice(0, 25)) {
    const item = await db.prepare(`SELECT test_cases.id, test_cases.display_id, test_cases.title, test_cases.description, test_cases.status, test_cases.priority FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id WHERE test_cases.id = ? AND app_types.project_id = ?`).get(id, projectId);
    if (item) cases.push(item);
  }
  const requirements = [];
  for (const id of requirementIds.slice(0, 25)) {
    const item = await db.prepare("SELECT id, display_id, title, description, status, priority FROM requirements WHERE id = ? AND project_id = ?").get(id, projectId);
    if (item) requirements.push(item);
  }
  const failures = run ? await db.prepare(`SELECT execution_results.id, execution_results.test_case_id, execution_results.status, execution_results.logs, execution_results.defects FROM execution_results WHERE execution_results.execution_id = ? AND execution_results.status IN ('failed', 'blocked') ORDER BY execution_results.updated_at DESC NULLS LAST, execution_results.created_at DESC LIMIT 25`).all(run.id) : [];
  return { run, cases, requirements, failures };
};

const deterministicDraft = ({ intent, evidence, additionalContext, context }) => {
  const failed = context.failures.length;
  const runName = context.run?.name || context.run?.display_id || context.run?.id || "";
  const caseTitle = context.cases[0]?.title || "";
  const severity = failed > 3 || /crash|data loss|security|unavailable/i.test(`${intent} ${evidence}`) ? "critical" : failed || /fail|error|block/i.test(`${intent} ${evidence}`) ? "high" : "medium";
  const priority = severity === "critical" ? "p1" : severity === "high" ? "p2" : "p3";
  const titleBase = normalizeText(intent, 140).replace(/[.\s]+$/, "");
  const title = titleBase || (caseTitle ? `${caseTitle} fails during execution` : runName ? `${runName} execution failure` : "Observed product defect");
  const observed = normalizeText(evidence) || (failed ? `${failed} failed or blocked result${failed === 1 ? "" : "s"} were captured in the linked run.` : "Observed behavior requires confirmation from the reporter.");
  return {
    title,
    message: [intent, context.run ? `Linked run: ${runName} (${context.run.status || "unknown status"}).` : "", context.cases.length ? `Impacted cases: ${context.cases.map((item) => item.title).join(", ")}.` : "", additionalContext].filter(Boolean).join("\n\n"),
    steps_to_reproduce: context.cases.length ? `1. Open the affected workflow.\n2. Execute: ${context.cases.map((item) => item.title).join(", ")}.\n3. Observe the failure described in the linked evidence.` : "1. Open the affected workflow.\n2. Repeat the action described by the reporter.\n3. Observe the failure.",
    expected_result: context.requirements.length ? context.requirements.map((item) => item.title).join("; ") : "The workflow completes successfully and matches the documented requirement.",
    actual_result: observed,
    severity,
    priority,
    environment: "",
    build: context.run?.build || "",
    labels: ["ai-assisted", failed ? "execution-failure" : "reported-defect"],
    rationale: `Drafted from ${context.run ? "the linked run" : "reporter context"}, ${context.cases.length} test case${context.cases.length === 1 ? "" : "s"}, ${context.requirements.length} requirement${context.requirements.length === 1 ? "" : "s"}, and ${failed} failed or blocked result${failed === 1 ? "" : "s"}. Human review is required.`
  };
};

const normalizeDraft = (candidate, fallback) => ({
  title: normalizeText(candidate?.title, 180) || fallback.title,
  message: normalizeText(candidate?.message) || fallback.message,
  steps_to_reproduce: normalizeText(candidate?.steps_to_reproduce, 12_000) || fallback.steps_to_reproduce,
  expected_result: normalizeText(candidate?.expected_result, 8_000) || fallback.expected_result,
  actual_result: normalizeText(candidate?.actual_result, 8_000) || fallback.actual_result,
  severity: allowedSeverity.has(String(candidate?.severity || "").toLowerCase()) ? String(candidate.severity).toLowerCase() : fallback.severity,
  priority: allowedPriority.has(String(candidate?.priority || "").toLowerCase()) ? String(candidate.priority).toLowerCase() : fallback.priority,
  environment: normalizeText(candidate?.environment, 500) || fallback.environment,
  build: normalizeText(candidate?.build, 500) || fallback.build,
  labels: normalizeReferenceList(candidate?.labels).slice(0, 20),
  rationale: normalizeText(candidate?.rationale, 2_000) || fallback.rationale
});

const requestLlmDraft = async (integration, input, context) => {
  const response = await fetchLlmWithRetry(`${String(integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${integration.api_key}` },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a senior QA defect triage assistant. Return strict JSON only. Never invent evidence." },
        { role: "user", content: `Draft a concise, Jira-ready bug. Return JSON with title, message, steps_to_reproduce, expected_result, actual_result, severity (critical|high|medium|low), priority (p1|p2|p3|p4), environment, build, labels, rationale.\n\nReporter input:\n${JSON.stringify(input, null, 2)}\n\nBounded HelloTest evidence:\n${JSON.stringify(context, null, 2)}` }
      ]
    })
  }, { operation: "bug-draft.generate" });
  if (!response.ok) throw new Error(`LLM provider returned ${response.status}`);
  const payload = await response.json();
  return extractJson(payload?.choices?.[0]?.message?.content);
};

exports.preview = async ({ user, project_id, intent, evidence, additional_context, linked_test_run_id, linked_test_case_ids, linked_requirement_ids, integration_id } = {}) => {
  const projectId = normalizeText(project_id, 255);
  const normalizedIntent = normalizeText(intent, 4_000);
  if (!projectId || !normalizedIntent) throw new Error("project_id and intent are required");
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("Project not found");
  const input = {
    intent: normalizedIntent,
    evidence: normalizeText(evidence, 12_000),
    additional_context: normalizeText(additional_context),
    linked_test_run_id: normalizeText(linked_test_run_id, 255),
    linked_test_case_ids: normalizeReferenceList(linked_test_case_ids),
    linked_requirement_ids: normalizeReferenceList(linked_requirement_ids)
  };
  const context = await loadEvidence({ projectId, runId: input.linked_test_run_id, testCaseIds: input.linked_test_case_ids, requirementIds: input.linked_requirement_ids });
  const fallback = deterministicDraft({ intent: input.intent, evidence: input.evidence, additionalContext: input.additional_context, context });
  let candidate = fallback;
  let integration = null;
  let fallbackReason = null;
  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({ integrationId: integration_id, userId: user?.id, usageKey: "ai.bug_triage", projectId, fallback: "project-then-global", allowMissing: true });
    if (integration) candidate = normalizeDraft(await requestLlmDraft(integration, input, context), fallback);
    else fallbackReason = "No active LLM integration is configured.";
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : "LLM generation failed.";
    candidate = fallback;
  }
  const now = new Date().toISOString();
  const citations = [context.run ? { type: "run", id: context.run.id, title: context.run.name } : null, ...context.cases.map((item) => ({ type: "test_case", id: item.id, title: item.title })), ...context.requirements.map((item) => ({ type: "requirement", id: item.id, title: item.title }))].filter(Boolean);
  return {
    draft: { ...candidate, linked_test_run_id: context.run?.id || "", linked_test_case_ids: context.cases.map((item) => item.id), linked_requirement_ids: context.requirements.map((item) => item.id) },
    citations,
    provenance: { capability: "ai-bug-triage", generation_mode: integration && !fallbackReason ? "llm" : "deterministic", provider: integration?.name || "HelloTest evidence graph", model: integration?.model || null, request_id: `bug-draft-${Date.now()}`, input_fingerprint: fingerprint(input), generated_at: now, confidence: citations.length ? 0.84 : 0.58, evidence: citations.map((item) => `${item.type}:${item.id}`), fallback_used: Boolean(fallbackReason), fallback_reason: fallbackReason, requires_human_review: true }
  };
};
