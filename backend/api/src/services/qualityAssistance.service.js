const crypto = require("crypto");
const db = require("../db");
const { requireEntityPermission } = require("./entityScope.service");

const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex").slice(0, 20);
const reference = (row, type = "record") => ({
  id: row.id,
  display_id: row.display_id || row.id,
  title: row.title || undefined,
  name: row.name || undefined,
  status: row.status || null,
  priority: row.priority === undefined ? null : row.priority,
  release: row.release || null,
  build: row.build || null,
  automation_status: row.automation_status || null,
  kind: type
});

const assisted = ({ capability, input, evidence, confidence, payload }) => {
  const requestId = `${capability}-${Date.now()}`;
  const generatedAt = new Date().toISOString();
  const provenance = {
    capability,
    generation_mode: "deterministic",
    provider: "HelloTest evidence graph",
    model: null,
    request_id: requestId,
    input_fingerprint: fingerprint(input),
    generated_at: generatedAt,
    confidence,
    evidence: [...new Set(evidence)],
    fallback_used: false,
    fallback_reason: null,
    requires_human_review: true
  };
  return {
    ...payload,
    integration: { id: "qaira-evidence-graph", name: "HelloTest evidence graph", type: "deterministic", model: null, generation_mode: "deterministic", direct_model_invocation: false },
    provenance,
    generation_mode: "deterministic",
    generated_at: generatedAt,
    request_id: requestId,
    input_fingerprint: provenance.input_fingerprint,
    confidence,
    fallback_used: false,
    fallback_reason: null,
    requires_human_review: true,
    preview_only: true
  };
};

const previewRequirementImpact = async ({ user, requirementId, proposedChange }) => {
  const scope = await requireEntityPermission({ user, permissionCode: "requirement.ai", entityType: "requirement", entityId: requirementId });
  const requirement = await db.prepare("SELECT * FROM requirements WHERE id = ?").get(requirementId);
  const [testCases, suites, runs, automation] = await Promise.all([
    db.prepare(`
      SELECT test_cases.* FROM requirement_test_cases
      JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id
      WHERE requirement_test_cases.requirement_id = ? ORDER BY test_cases.title
    `).all(requirementId),
    db.prepare(`
      SELECT DISTINCT test_suites.* FROM requirement_test_cases
      JOIN suite_test_cases ON suite_test_cases.test_case_id = requirement_test_cases.test_case_id
      JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
      WHERE requirement_test_cases.requirement_id = ? ORDER BY test_suites.name
    `).all(requirementId),
    db.prepare(`
      SELECT DISTINCT executions.* FROM requirement_test_cases
      JOIN execution_case_snapshots ON execution_case_snapshots.test_case_id = requirement_test_cases.test_case_id
      JOIN executions ON executions.id = execution_case_snapshots.execution_id
      WHERE requirement_test_cases.requirement_id = ? ORDER BY executions.created_at DESC
    `).all(requirementId),
    db.prepare(`
      SELECT DISTINCT automation_learning_cache.* FROM requirement_test_cases
      JOIN automation_learning_cache ON automation_learning_cache.test_case_id = requirement_test_cases.test_case_id
      WHERE requirement_test_cases.requirement_id = ? ORDER BY automation_learning_cache.updated_at DESC
    `).all(requirementId)
  ]);
  const riskScore = Math.min(100, (Number(requirement.priority || 3) <= 2 ? 35 : 15) + Math.min(testCases.length * 8, 32) + Math.min(runs.length * 6, 24) + (automation.length ? 9 : 0));
  const riskLevel = riskScore >= 65 ? "high" : riskScore >= 30 ? "medium" : "low";
  const evidence = [requirement, ...testCases, ...suites, ...runs].map((item) => `${item.display_id || item.id}`);
  return assisted({
    capability: "requirement-change-impact-preview",
    input: { requirement_id: requirementId, proposed_change: proposedChange },
    evidence,
    confidence: testCases.length ? 0.82 : 0.58,
    payload: {
      requirement: { id: requirement.id, display_id: requirement.display_id || requirement.id, title: requirement.title, priority: requirement.priority, risk_score: riskScore },
      impact: {
        risk_level: riskLevel,
        test_cases: testCases.map((item) => reference(item, "test-case")),
        test_suites: suites.map((item) => reference(item, "test-suite")),
        test_runs: runs.map((item) => reference(item, "execution")),
        automation_assets: automation.map((item) => ({ ...reference(item, "automation-asset"), title: item.locator_intent, confidence: item.confidence })),
        totals: { test_cases: testCases.length, test_suites: suites.length, test_runs: runs.length, automation_assets: automation.length }
      },
      explanation: testCases.length ? "Impact is derived from current HelloTest links, suite membership, run snapshots, and automation dependencies. No source record was changed." : "No linked test case was found, so the proposed requirement change exposes a coverage gap.",
      recommended_actions: [testCases.length ? "Review linked test intent and expected results against the proposed change." : "Create and review tests for the changed acceptance criteria.", runs.length ? "Reassess queued, active, and release-scoped runs containing affected tests." : null, automation.length ? "Review automation and locator dependencies before the next automated run." : null, "Confirm impact with a human reviewer before applying changes."].filter(Boolean),
      scope: { project_id: scope.projectId }
    }
  });
};

const previewTestCaseImpact = async ({ user, testCaseId, proposedChange }) => {
  const scope = await requireEntityPermission({ user, permissionCode: "testcase.ai", entityType: "test_case", entityId: testCaseId });
  const testCase = await db.prepare("SELECT * FROM test_cases WHERE id = ?").get(testCaseId);
  const [requirements, suites, runs, automation, steps] = await Promise.all([
    db.prepare(`SELECT requirements.* FROM requirement_test_cases JOIN requirements ON requirements.id = requirement_test_cases.requirement_id WHERE requirement_test_cases.test_case_id = ? ORDER BY requirements.title`).all(testCaseId),
    db.prepare(`SELECT test_suites.* FROM suite_test_cases JOIN test_suites ON test_suites.id = suite_test_cases.suite_id WHERE suite_test_cases.test_case_id = ? ORDER BY test_suites.name`).all(testCaseId),
    db.prepare(`SELECT executions.* FROM execution_case_snapshots JOIN executions ON executions.id = execution_case_snapshots.execution_id WHERE execution_case_snapshots.test_case_id = ? ORDER BY executions.created_at DESC`).all(testCaseId),
    db.prepare("SELECT * FROM automation_learning_cache WHERE test_case_id = ? ORDER BY updated_at DESC").all(testCaseId),
    db.prepare("SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order").all(testCaseId)
  ]);
  const lowConfidence = automation.filter((item) => Number(item.confidence || 0) < 0.75);
  const signals = [Number(testCase.priority || 3) <= 2 ? "High-priority test case." : null, runs.some((item) => ["queued", "running"].includes(item.status)) ? "Included in a queued or active run." : null, testCase.automation_status === "incomplete" ? "Automation is incomplete." : null, lowConfidence.length ? `${lowConfidence.length} locator dependency item(s) have confidence below 75%.` : null, requirements.length ? null : "No linked requirement was found."].filter(Boolean);
  const evidence = [testCase, ...requirements, ...suites, ...runs, ...automation].map((item) => item.display_id || item.id);
  return assisted({
    capability: "test-case-change-impact-preview",
    input: { test_case_id: testCaseId, proposed_change: proposedChange },
    evidence,
    confidence: evidence.length > 1 ? 0.82 : 0.58,
    payload: {
      test_case: { id: testCase.id, display_id: testCase.display_id || testCase.id, title: testCase.title, status: testCase.status, priority: testCase.priority, automation_status: testCase.automation_status, step_count: steps.length },
      impact: {
        risk_level: signals.length >= 3 ? "high" : signals.length ? "medium" : "low",
        requirements: requirements.map((item) => reference(item, "requirement")),
        test_suites: suites.map((item) => reference(item, "test-suite")),
        test_runs: runs.map((item) => reference(item, "execution")),
        automation_assets: automation.map((item) => ({ ...reference(item, "automation-asset"), title: item.locator_intent, confidence: item.confidence })),
        object_repository_items: automation.map((item) => ({ id: item.id, display_id: item.id, locator_intent: item.locator_intent, locator_kind: item.locator_kind, confidence: item.confidence })),
        totals: { requirements: requirements.length, test_suites: suites.length, test_runs: runs.length, automation_assets: automation.length, object_repository_items: automation.length }
      },
      risk_signals: signals,
      explanation: "Impact is derived from current HelloTest relationships, run snapshots, steps, and object repository dependencies. This preview does not mutate the test case.",
      recommended_actions: ["Review expected results and steps against the proposed change.", runs.length ? "Decide whether affected queued or active runs need refreshing or rerunning." : null, automation.length ? "Review automation and locator dependencies before applying the change." : null, "Apply changes only after human review."].filter(Boolean),
      scope: { project_id: scope.projectId }
    }
  });
};

const FAILURE_RULES = [
  { id: "environment", label: "Environment or connectivity", pattern: /(timeout|network|connection|dns|socket|unreachable|503|502)/i, action: "Validate environment health and connectivity, then rerun the smallest affected scope." },
  { id: "locator", label: "Locator or UI synchronization", pattern: /(locator|selector|element.*not found|stale element|detached|not visible)/i, action: "Review locator evidence and synchronization behavior before applying a repair." },
  { id: "assertion", label: "Assertion mismatch", pattern: /(assert|expected|actual|mismatch|comparison)/i, action: "Compare expected and actual behavior with the linked requirement and confirm product impact." },
  { id: "test-data", label: "Test data or precondition", pattern: /(test data|fixture|seed|precondition|duplicate|invalid input|unauthorized|forbidden)/i, action: "Validate the test data, credentials, and preconditions without exposing secrets." },
  { id: "blocked", label: "Blocked execution", pattern: /(blocked|not executed|dependency)/i, action: "Resolve the blocking dependency and record evidence before rerunning." }
];

const previewFailureClusters = async ({ user, executionId, requestedScope }) => {
  const scope = await requireEntityPermission({ user, permissionCode: "run.ai", entityType: "execution", entityId: executionId });
  const execution = await db.prepare("SELECT * FROM executions WHERE id = ?").get(executionId);
  const results = await db.prepare("SELECT * FROM execution_results WHERE execution_id = ? ORDER BY created_at DESC").all(executionId);
  const failures = results.filter((item) => ["failed", "blocked"].includes(item.status));
  const attachments = failures.length ? await db.prepare(`
    SELECT attachments.id, attachments.entity_id, attachments.file_name
    FROM attachments
    JOIN execution_results ON execution_results.id = attachments.entity_id
    WHERE attachments.entity_type = 'execution_result' AND execution_results.execution_id = ?
  `).all(executionId) : [];
  const attachmentByResult = attachments.reduce((map, item) => {
    if (!map[item.entity_id]) map[item.entity_id] = [];
    map[item.entity_id].push(item);
    return map;
  }, {});
  const grouped = new Map();
  failures.forEach((result) => {
    const text = `${result.error || ""}\n${result.logs || ""}`;
    const rule = FAILURE_RULES.find((candidate) => candidate.pattern.test(text)) || { id: "unclassified", label: "Unclassified", pattern: null, action: "Review evidence manually and record a confirmed classification." };
    if (!grouped.has(rule.id)) grouped.set(rule.id, { rule, members: [] });
    grouped.get(rule.id).members.push(result);
  });
  const clusters = [...grouped.values()].map(({ rule, members }) => ({
    id: rule.id,
    label: rule.label,
    count: members.length,
    confidence: rule.pattern ? 0.78 : 0.5,
    explanation: rule.pattern ? "Matched transparent error/log keywords; confirm the cause against evidence." : "No deterministic signal matched; manual classification is required.",
    recommended_action: rule.action,
    evidence_refs: [...new Set(members.flatMap((item) => [`execution-result:${item.id}`, ...(attachmentByResult[item.id] || []).map((attachment) => `attachment:${attachment.id}`)]))],
    members: members.map((item) => ({ execution_result_id: item.id, test_case_id: item.test_case_id || null, status: item.status, error_excerpt: String(item.error || item.logs || "").slice(0, 500) || null, created_at: item.created_at || null, updated_at: item.updated_at || null }))
  })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const evidence = clusters.flatMap((cluster) => cluster.evidence_refs);
  return assisted({
    capability: "execution-failure-clustering-preview",
    input: { execution_id: executionId, requested_scope: requestedScope || "failed-and-blocked" },
    evidence,
    confidence: failures.length ? (clusters.some((item) => item.id === "unclassified") ? 0.62 : 0.79) : 0.4,
    payload: {
      execution: { id: execution.id, display_id: execution.display_id || execution.id, name: execution.name, status: execution.status, release: execution.release, build: execution.build },
      total_results: results.length,
      failed_or_blocked_results: failures.length,
      clusters,
      unclassified_count: clusters.find((item) => item.id === "unclassified")?.count || 0,
      explanation: failures.length ? "Clusters are explainable keyword-based triage suggestions over HelloTest result evidence; they are not confirmed root causes." : "No failed or blocked result is available to cluster.",
      recommended_actions: failures.length ? ["Review the largest cluster first.", "Confirm each root cause with linked evidence.", "Create or link a defect only for reproducible product behavior.", "Rerun the smallest affected scope after remediation."] : ["Complete execution and attach evidence before requesting failure clustering."],
      scope: { project_id: scope.projectId }
    }
  });
};

module.exports = { previewFailureClusters, previewRequirementImpact, previewTestCaseImpact };
