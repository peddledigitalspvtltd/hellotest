const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const requirement = { id: "story", title: "Checkout", external_references: ["STORY-1"] };
const appType = { id: "app", project_id: "project", name: "Web" };
const candidate = {
  title: "Checkout succeeds", description: "Complete a purchase and confirm its successful outcome.", priority: 3, test_case_type: "functional", requirement_ids: ["story"], reviewer_id: "model-suggested-reviewer", review_status: "accepted",
  authoring_mode: "gherkin", gherkin_document: "Feature: Checkout\nScenario: Purchase\nWhen checking out\nThen purchase succeeds",
  parameter_values: { email: "buyer@example.test" }, steps: [{ action: "Check out", expected_result: "Purchase succeeds" }]
};

function load(relativeFile, overrides, expose = "") {
  const file = path.join(__dirname, relativeFile);
  const localRequire = createRequire(file);
  const exported = {};
  const sandbox = { module: { exports: exported }, exports: exported, process, console, URL, Buffer, setTimeout, clearTimeout,
    require: id => {
      const key = Object.keys(overrides).find(candidate => candidate.split('/').pop() === id.split('/').pop());
      return key === undefined ? localRequire(id) : overrides[key];
    } };
  vm.runInNewContext(fs.readFileSync(file, "utf8") + expose, sandbox, { filename: file });
  return sandbox.module.exports;
}

test("interactive and Story draft acceptance persists creator-owned pending reviews with provenance", async () => {
  const calls = [];
  const service = load("../../../manual/backend/services/requirementDesign.service.js", {
    "@hellotest/testing/backend/services/testCase.service": { createTestCase: async input => { calls.push(input); return { id: `created-${calls.length}` }; } },
    "@hellotest/knowledge/backend/services/aiKnowledge.service": {}, "@hellotest/integration/backend/services/aiLlmSelection.service": {}
  });
  await service.acceptGeneratedTestCases({ requirements: [requirement], appType, created_by: "library-author", cases: [candidate] });
  await service.acceptRequirementTestCases({ requirement, appType, created_by: "story-author", cases: [candidate] });
  service.previewRequirementTestCases = async () => ({ cases: [candidate], integration: { id: "provider" } });
  await service.generateRequirementTestCases({ requirement, appType, user_id: "direct-generator" });
  assert.equal(calls.length, 3);
  for (const [index, creator] of ["library-author", "story-author", "direct-generator"].entries()) {
    const saved = calls[index];
    assert.equal(saved.created_by, creator);
    assert.equal(saved.reviewer_id, creator, "AI suggested reviewer cannot replace the persisted creator");
    assert.equal(saved.review_status, "pending", "importing a preview is not a final review decision");
    assert.equal(saved.ai_generation_source, "interactive");
    assert.equal(saved.ai_generation_review_status, "pending");
    assert.equal(saved.gherkin_document, candidate.gherkin_document);
    assert.equal(saved.parameter_values.email, "buyer@example.test");
  }
});

test("scheduled generation preserves creator review ownership across idempotent retry payloads", async () => {
  const calls = [];
  const database = { prepare: () => ({}), transaction: callback => callback };
  const service = load("../../../ai/backend/services/aiTestCaseGeneration.service.js", {
    "@hellotest/platform/backend/src/db": database,
    "@hellotest/testing/backend/services/testCase.service": { createTestCase: async input => { calls.push(input); return { id: "scheduled-case" }; } },
    "@hellotest/manual/backend/services/requirementDesign.service": { previewRequirementTestCases: async () => ({ cases: [candidate] }) },
    "@hellotest/platform/backend/services/workspaceTransaction.service": {}
  }, "\nmodule.exports.generateCasesForRequirement = generateCasesForRequirement;");
  const job = { id: "job", created_by: "scheduler-owner", authoring_mode: "gherkin" };
  for (let retry = 0; retry < 2; retry += 1) {
    assert.equal(await service.generateCasesForRequirement({ job, requirement, appType }), 1);
  }
  for (const saved of calls) {
    assert.equal(saved.created_by, "scheduler-owner");
    assert.equal(saved.reviewer_id, "scheduler-owner");
    assert.equal(saved.review_status, "pending");
    assert.equal(saved.ai_generation_source, "scheduler");
    assert.equal(saved.ai_generation_review_status, "pending");
    assert.equal(saved.ai_generation_job_id, "job");
    assert.equal(saved.source_idempotency_key, "ai-job:job:requirement:story:case:0");
  }
});
