const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
const { __smartExecutionInternals } = require("../src/services/executionPlanning.service");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("Smart Run route accepts and forwards the exact delivery contract", async () => {
  const routeSource = await readSource("../src/routes/executions.routes.js");
  const start = routeSource.indexOf('fastify.post("/executions/smart-plan-preview"');
  const end = routeSource.indexOf('fastify.post("/executions/manual-run-suggestion"', start);
  const smartRoute = routeSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(smartRoute, /await requireFeaturePermission\(fastify, req, "run\.ai"\)/);
  for (const field of ["release", "sprint", "build"]) {
    assert.match(smartRoute, new RegExp(`${field}: \\{ required: false, type: "string", maxLength: 255 \\}`));
    assert.match(smartRoute, new RegExp(`${field}: req\\.body\\.${field}`));
  }
  for (const field of ["scope_description", "additional_context", "prompt_guidance"]) {
    assert.match(smartRoute, new RegExp(`${field}: \\{ required: false, type: "string", maxLength: 4_000 \\}`));
    assert.match(smartRoute, new RegExp(`${field}: req\\.body\\.${field}`));
  }
  assert.match(smartRoute, /impacted_requirement_ids: \{ required: false, type: "array", items: "string", maxItems: 100 \}/);
});

test("Smart Run exact delivery matching uses union semantics and Release matches Fix Version", () => {
  const { deliveryMatchKeys } = __smartExecutionInternals;
  const scope = { release: "Release 8", sprint: "Sprint 24", build: "build-901" };

  assert.deepEqual(deliveryMatchKeys({ fix_version: " release 8 " }, scope), ["release"]);
  assert.deepEqual(deliveryMatchKeys({ sprint: "SPRINT 24" }, scope), ["sprint"]);
  assert.deepEqual(deliveryMatchKeys({ build: "build-901" }, scope), ["build"]);
  assert.deepEqual(deliveryMatchKeys({ release: "Release 9", sprint: "Sprint 25" }, scope), []);
});

test("Smart Run risk, membership, and evidence refs are deterministic project-record decisions", () => {
  const { rankSmartExecutionCases } = __smartExecutionInternals;
  const baseCase = {
    display_id: null,
    description: null,
    priority: 3,
    status: "active",
    automated: "no",
    suite_names: [],
    module_ids: [],
    module_names: [],
    requirement_ids: [],
    requirement_titles: [],
    step_count: 1,
    step_summary: "Submit checkout"
  };
  const ranked = rankSmartExecutionCases({
    cases: [
      { ...baseCase, id: "case-risk", title: "Checkout payment", priority: 1, requirement_ids: ["story-1"], requirement_titles: ["New checkout"] },
      { ...baseCase, id: "case-copy", title: "Checkout copy" }
    ],
    scopedRequirementIds: ["story-1"],
    explicitlySelectedRequirementIds: ["story-1"],
    scopedResults: [{ id: "result-1", execution_id: "run-1", test_case_id: "case-risk", status: "failed", build: "build-901", created_at: "2026-08-14T10:00:00.000Z" }],
    scopedBugs: [{ id: "bug-1", title: "Payment fails", status: "open", severity: "critical", build: "build-901", linked_test_case_ids: ["case-risk"], linked_requirement_ids: [], linked_module_ids: [] }],
    searchTerms: ["checkout"],
    scopeDescriptionTerms: ["checkout"],
    additionalContextTerms: [],
    deliveryScope: { release: null, sprint: null, build: "build-901" }
  });

  assert.equal(ranked[0].id, "case-risk");
  assert.equal(ranked[0].risk_score, 91);
  assert.equal(ranked[0].impact_level, "critical");
  assert.deepEqual(ranked[0].evidence.result_ids, ["result-1"]);
  assert.deepEqual(ranked[0].evidence.bug_ids, ["bug-1"]);
  for (const ref of ["test-case:case-risk", "requirement:story-1", "result:result-1", "bug:bug-1", "scope:build", "scope:description"]) {
    assert.ok(ranked[0].evidence_refs.includes(ref), ref);
  }
  assert.match(ranked[0].reason, /failed prior result/);
});

test("Smart Run only accepts model explanations with case-scoped evidence citations", () => {
  const { normalizeModelExplanations } = __smartExecutionInternals;
  const caseMap = new Map([
    ["case-1", { evidence_refs: ["test-case:case-1", "result:result-1"] }]
  ]);
  const explanations = normalizeModelExplanations({
    cases: [
      { test_case_id: "case-1", reason: "Unsupported claim", evidence_refs: ["bug:not-allowed"] },
      { test_case_id: "case-1", reason: "This case failed in the cited run result.", evidence_refs: ["result:result-1"] },
      { test_case_id: "case-not-returned", reason: "Invented membership", evidence_refs: ["test-case:case-not-returned"] }
    ]
  }, caseMap);

  assert.equal(explanations.size, 1);
  assert.equal(explanations.get("case-1").reason, "This case failed in the cited run result.");
  assert.deepEqual(explanations.get("case-1").evidence_refs, ["result:result-1"]);
});

test("Smart Run acceptance proof binds reviewer, scope, fingerprint, and allowed Test Cases", () => {
  const { createSmartExecutionAcceptanceToken, verifySmartExecutionAcceptance } = __smartExecutionInternals;
  const token = createSmartExecutionAcceptanceToken({
    projectId: "project-1",
    appTypeId: "app-1",
    userId: "user-1",
    requestId: "smart-run-request-1",
    inputFingerprint: "fingerprint-1",
    allowedTestCaseIds: ["case-1", "case-2"],
    preview: { generation_mode: "deterministic", requires_human_review: true }
  });
  const accepted = verifySmartExecutionAcceptance({
    token,
    projectId: "project-1",
    appTypeId: "app-1",
    userId: "user-1",
    requestId: "smart-run-request-1",
    inputFingerprint: "fingerprint-1",
    selectedTestCaseIds: ["case-2"]
  });

  assert.deepEqual(accepted.selected_test_case_ids, ["case-2"]);
  const [encodedPayload, signature] = token.split(".");
  const tamperedToken = `${encodedPayload}.${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
  assert.throws(
    () => verifySmartExecutionAcceptance({
      token,
      projectId: "project-1",
      appTypeId: "app-1",
      userId: "user-1",
      requestId: "smart-run-request-1",
      inputFingerprint: "fingerprint-1",
      selectedTestCaseIds: ["case-not-reviewed"]
    }),
    /not a valid subset/
  );
  assert.throws(
    () => verifySmartExecutionAcceptance({
      token: tamperedToken,
      projectId: "project-1",
      appTypeId: "app-1",
      userId: "user-1",
      requestId: "smart-run-request-1",
      inputFingerprint: "fingerprint-1",
      selectedTestCaseIds: ["case-1"]
    }),
    /token is invalid/
  );
});

test("Smart Run provenance fingerprints content and exposes truthful review/omission boundaries", async () => {
  const { fingerprintSnapshot } = __smartExecutionInternals;
  assert.notEqual(
    fingerprintSnapshot({ id: "case-1", status: "passed" }),
    fingerprintSnapshot({ id: "case-1", status: "failed" })
  );

  const serviceSource = await readSource("../src/services/executionPlanning.service.js");
  for (const marker of [
    "selectExecutionEvidenceForPlanning",
    "selectBugsForPlanning",
    "input_fingerprint: inputFingerprint",
    "partial_sources: partialSources",
    'status_label: "Awaiting human review"',
    'active_stage_id: "review"',
    'requires_human_review: true',
    "No run has been created",
    'capability: "ai-smart-run"'
  ]) {
    assert.ok(serviceSource.includes(marker), marker);
  }
  assert.match(serviceSource, /completed_stage_count: 3,[\s\S]*total_stage_count: 4/);
  assert.match(serviceSource, /DIRECT_CASE_SUITE_NAME = "Direct impacted scope"/);
});

test("Smart Run creation enforces AI permission and persists the signed human acceptance audit", async () => {
  const routeSource = await readSource("../src/routes/executions.routes.js");
  const start = routeSource.indexOf('fastify.post("/executions"');
  const end = routeSource.indexOf('fastify.post("/executions/local-run"', start);
  const createRoute = routeSource.slice(start, end);

  assert.match(createRoute, /scope_source: \{ required: false, type: "string", enum: \["smart-run"\] \}/);
  assert.match(createRoute, /smart_plan: \{ required: false, type: "object" \}/);
  assert.match(createRoute, /await requireFeaturePermission\(fastify, req, "run\.ai"\)/);
  assert.match(createRoute, /verifySmartExecutionAcceptance\(\{/);
  assert.match(createRoute, /selected Test Cases must match the accepted preview selection/i);
  assert.match(createRoute, /action: "smart_run_acceptance"/);
  assert.match(createRoute, /related_kind: "execution"/);
  assert.match(createRoute, /human_decision: "accepted"/);
  assert.match(createRoute, /created_by: req\.user\.id/);
});
