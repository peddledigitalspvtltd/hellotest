const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { storyAiSnapshot, testCaseAiSnapshot } = require("../src/utils/aiArtifactContext");

function load(name, overrides = {}, directory = "services") {
  const filename = path.resolve(__dirname, `../src/${directory}/${name}.js`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(
    id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id), module, module.exports
  );
  return module.exports;
}
const integration = { id: "provider", name: "Fixture", type: "llm", is_active: true, model: "fixture", base_url: "https://llm.invalid/v1/chat/completions/" };
const user = { id: "author" };
const story = {
  id: "story", display_id: "STORY_1", project_id: "project", title: "Approve invoice", description: "STORY_DESCRIPTION_SENTINEL",
  acceptance_criteria: ["AC_SENTINEL: approval requires a valid amount"], specification_format: "gherkin",
  specification_content: "SPEC_SENTINEL: Given a submitted invoice", gherkin_scenarios: ["SCENARIO_SENTINEL"],
  priority: 2, status: "ready", dev_status: "done", qa_status: "in_progress", sprint: "Sprint A", iteration_id: "iteration", release: "2.0", release_id: "release",
  fix_version: "2.0.1", scrum_team: "Payments", labels: ["finance"], external_references: ["https://example.invalid/invoice"],
  dev_completion_target_date: "2026-09-20", qa_completion_target_date: "2026-09-22", additional_fields: { contract: "USD only", _story_import: { secret: "INTERNAL_SENTINEL" } },
  history: [{ body: "HISTORY_SENTINEL" }], linked_test_cases: [{ title: "HYDRATION_SENTINEL" }]
};
const appType = { id: "app", project_id: "project", type: "web", name: "Billing" };
const steps = [{ step_order: 1, step_type: "web", action: "Approve the invoice", expected_result: "The invoice is approved" }];
const validCase = { title: "Approval", description: "Valid invoice approval", priority: 2, steps, requirement_refs: ["R1"] };
const response = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { "content-type": "application/json" } });
function providerFixture(result) {
  const calls = [];
  const selections = [];
  return {
    calls, selections,
    overrides: {
      "./aiLlmSelection.service": { async resolveLlmIntegrationForUsage(args) { selections.push(args); return integration; } },
      "../utils/llmHttpClient": { async fetchLlmWithRetry(url, options, policy) { calls.push({ url, options, body: JSON.parse(options.body), policy }); if (result instanceof Error) throw result; return response(result); } }
    }
  };
}

test("bounded snapshots carry major Story schema fields without hydrated history, and disclose clipping", () => {
  const snapshot = storyAiSnapshot({ ...story, description: "x".repeat(6000), acceptance_criteria: Array.from({ length: 15 }, (_, i) => `criterion${i}`) });
  for (const field of ["specification_content", "gherkin_scenarios", "dev_status", "qa_status", "sprint", "iteration_id", "release_id", "fix_version", "scrum_team", "dev_completion_target_date", "qa_completion_target_date"]) assert.deepEqual(snapshot[field], story[field]);
  assert.equal(snapshot.description.length, 4000);
  assert.equal(snapshot.acceptance_criteria.length, 8);
  assert.deepEqual(snapshot.context_limits.truncated_fields, ["description"]);
  assert.equal(snapshot.context_limits.omitted_items.acceptance_criteria, 7);
  assert.doesNotMatch(JSON.stringify(snapshot), /INTERNAL_SENTINEL|HISTORY_SENTINEL|HYDRATION_SENTINEL/);
  assert.deepEqual(storyAiSnapshot({ additional_fields: '{"acceptance_criteria":["one","one","two"]}' }).acceptance_criteria, ["one", "two"]);
  const current = testCaseAiSnapshot({ authoring_mode: "gherkin", gherkin_document: "Feature: Current", steps: [{ action: "STALE_STEP" }] });
  assert.deepEqual(current.steps, []);
  assert.equal(current.context_limits, undefined);
});

test("full case authoring sends acceptance, specification and live Gherkin once using project selection", async () => {
  const fixture = providerFixture(validCase);
  const service = load("aiCaseAuthoring.service", fixture.overrides);
  const result = await service.previewCaseAuthoring({ requirement: story, appType, user_id: user.id,
    test_case: { title: "Draft", authoring_mode: "gherkin", gherkin_document: "Feature: LIVE_GHERKIN", steps: [{ action: "STALE_STEP" }] }, additional_context: "TEAM_GUIDANCE" });
  assert.equal(result.case.steps.length, 1);
  const request = fixture.calls[0];
  assert.equal(request.url, "https://llm.invalid/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.policy.integration, integration);
  assert.equal(fixture.selections[0].projectId, "project");
  assert.equal(fixture.selections[0].usageKey, "ai.case_authoring.full_case");
  const prompt = JSON.stringify(request.body);
  for (const sentinel of ["AC_SENTINEL", "SPEC_SENTINEL", "SCENARIO_SENTINEL", "LIVE_GHERKIN", "TEAM_GUIDANCE"]) assert.equal(prompt.split(sentinel).length - 1, 1, sentinel);
  assert.doesNotMatch(prompt, /STALE_STEP|INTERNAL_SENTINEL|HISTORY_SENTINEL|HYDRATION_SENTINEL/);
});

test("case authoring rejects unusable structured and Gherkin outputs without a regeneration call", async () => {
  for (const [authoring_mode, output] of [["structured", { title: "Empty", steps: [{ action: "Click" }] }], ["gherkin", { title: "Empty", gherkin_document: "Feature: Empty\nScenario: Empty" }]]) {
    const fixture = providerFixture(output);
    const service = load("aiCaseAuthoring.service", fixture.overrides);
    await assert.rejects(service.previewCaseAuthoring({ requirement: story, appType, authoring_mode, test_case: {} }), /expected result|Then outcome/);
    assert.equal(fixture.calls.length, 1);
  }
});

test("test design uses full bounded Story data, maps cases and removes exact repeated drafts", async () => {
  const fixture = providerFixture({ test_cases: [validCase, validCase] });
  const service = load("requirementDesign.service", { ...fixture.overrides,
    "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) }
  });
  const result = await service.previewRequirementsTestCases({ requirements: [story], appType, max_cases: 2, user_id: user.id });
  assert.equal(result.generated, 1);
  assert.deepEqual(result.cases[0].requirement_ids, [story.id]);
  assert.match(JSON.stringify(fixture.calls[0].body), /AC_SENTINEL/);
  assert.match(JSON.stringify(fixture.calls[0].body), /SPEC_SENTINEL/);
  assert.equal(fixture.calls[0].url, "https://llm.invalid/v1/chat/completions");
  assert.equal(fixture.selections[0].projectId, "project");
  assert.equal(fixture.selections[0].usageKey, "ai.test_case.design");
  await assert.rejects(service.previewRequirementsTestCases({ requirements: [story], appType, max_cases: 50 }), error => error.statusCode === 400 && /ten/.test(error.message));
  assert.equal(fixture.calls.length, 1);
});

test("Story grooming's actual provider request includes explicit acceptance and planning/specification", async () => {
  const fixture = providerFixture({});
  const service = load("requirementWorkspace.service", { ...fixture.overrides,
    "../db": { prepare() { assert.fail("No optional source was granted"); } },
    "./optionalEvidenceAccess.service": { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, false])) }
  });
  const review = await service.previewGrooming({ requirement: story, project: { id: "project" }, user, additionalContext: "REVIEWED_GROOMING_CONTEXT" });
  assert.equal(fixture.calls.length, 1);
  const prompt = fixture.calls[0].body.messages[1].content;
  for (const sentinel of ["AC_SENTINEL", "SPEC_SENTINEL", "SCENARIO_SENTINEL", "STORY_DESCRIPTION_SENTINEL"]) assert.equal(prompt.split(sentinel).length - 1, 1, sentinel);
  for (const field of ["dev_status", "qa_status", "iteration_id", "release_id", "scrum_team"]) assert.match(prompt, new RegExp(field));
  assert.doesNotMatch(prompt, /INTERNAL_SENTINEL|HISTORY_SENTINEL|HYDRATION_SENTINEL/);
  assert.equal(fixture.calls[0].policy.operation, "requirement.grooming");
  assert.equal(prompt.split("REVIEWED_GROOMING_CONTEXT").length - 1, 1);
  assert.ok(review.context.sources.some(source => source.ref === "review:context"));
});

test("Story completion sends selected bounded Story fields once and uses the exact configured endpoint", async () => {
  const fixture = providerFixture({ title: story.title, description: story.description, priority: 2, status: "ready", evidence_refs: ["story:story"], field_evidence: { title: ["story:story"], description: ["story:story"] } });
  const service = load("requirement.service", { ...fixture.overrides,
    "../db": { prepare() { return { get: async () => ({ ...story, labels: JSON.stringify(story.labels), external_references: JSON.stringify(story.external_references), additional_fields: JSON.stringify({ ...story.additional_fields, acceptance_criteria: story.acceptance_criteria }) }) }; } },
    "./optionalEvidenceAccess.service": { getOptionalEvidenceAccess: async () => ({ "testcase.view": false }) },
    "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) }
  });
  const result = await service.previewRequirementOptimization({ id: story.id, user, additional_context: "COMPLETION_GUIDANCE" });
  assert.equal(result.generation_mode, "llm");
  assert.equal(fixture.calls.length, 1);
  const request = fixture.calls[0];
  assert.equal(request.url, "https://llm.invalid/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, undefined);
  const prompt = request.body.messages[1].content;
  for (const sentinel of ["AC_SENTINEL", "SPEC_SENTINEL", "SCENARIO_SENTINEL", "STORY_DESCRIPTION_SENTINEL"]) assert.equal(prompt.split(sentinel).length - 1, 1, sentinel);
  assert.doesNotMatch(prompt, /INTERNAL_SENTINEL|HISTORY_SENTINEL|HYDRATION_SENTINEL/);
  await service.previewRequirementOptimization({ id: story.id, user, prompt_guidance: "COMPLETION_TEMPLATE_SENTINEL", requirement_context: { id: story.id, project_id: "project", description: "UNSAVED_STORY", acceptance_criteria: ["UNSAVED_AC"], specification_content: "UNSAVED_SPEC" } });
  const draftPrompt = fixture.calls[1].body.messages[1].content;
  assert.match(draftPrompt, /UNSAVED_STORY/); assert.match(draftPrompt, /UNSAVED_AC/); assert.match(draftPrompt, /UNSAVED_SPEC/);
  assert.doesNotMatch(draftPrompt, /STORY_DESCRIPTION_SENTINEL|AC_SENTINEL|SPEC_SENTINEL/);
  assert.equal(draftPrompt.split("COMPLETION_TEMPLATE_SENTINEL").length - 1, 1);
  assert.match(draftPrompt, /one complete regenerated proposal/);
  await assert.rejects(service.previewRequirementOptimization({ id: story.id, user, requirement_context: { id: "different-story" } }), error => error.statusCode === 400);
  assert.equal(fixture.calls.length, 2);
});

test("Story creation sends the brief once and suppresses duplicate drafts", async () => {
  const draft = { title: "Review an invoice", description: "A reviewer approves an invoice", acceptance_criteria: ["Approval sets status to approved"], evidence_refs: ["user-guidance:story-create"], field_evidence: { title: ["user-guidance:story-create"], description: ["user-guidance:story-create"], acceptance_criteria: ["user-guidance:story-create"] } };
  const fixture = providerFixture({ requirements: [draft, draft] });
  const service = load("requirement.service", { ...fixture.overrides,
    "../db": { prepare() { return {}; } },
    "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) }
  });
  const result = await service.previewRequirementCreation({ project_id: "project", user_id: user.id, prompt_guidance: "CREATION_TEMPLATE_SENTINEL", additional_context: "BRIEF_SENTINEL: A reviewer approves an invoice. Approval sets status to approved.", max_requirements: 2 });
  assert.equal(result.requirements.length, 1);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].url, "https://llm.invalid/v1/chat/completions");
  assert.equal(fixture.calls[0].options.headers.Authorization, undefined);
  assert.equal(fixture.calls[0].body.messages[1].content.split("BRIEF_SENTINEL").length - 1, 1);
  assert.equal(fixture.calls[0].body.messages[1].content.split("CREATION_TEMPLATE_SENTINEL").length - 1, 1);
  assert.doesNotMatch(JSON.stringify(result.evidence), /CREATION_TEMPLATE_SENTINEL/);
  assert.match(fixture.calls[0].body.messages[1].content, /between 1 and 2 requirements/);
  assert.equal(fixture.calls[0].policy.operation, "requirement.generate");
  await assert.rejects(service.previewRequirementCreation({ project_id: "project", max_requirements: 8 }), error => error.statusCode === 400);
  assert.equal(fixture.calls.length, 1);
});

test("test design rejects untraceable multi-Story drafts and empty executable output", async () => {
  for (const [requirements, output, message] of [[[story, { ...story, id: "other" }], { ...validCase, requirement_refs: [] }, /linked to at least one requirement/], [[story], { ...validCase, steps: [] }, /executable steps/]]) {
    const fixture = providerFixture({ test_cases: [output] });
    const service = load("requirementDesign.service", { ...fixture.overrides, "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) } });
    await assert.rejects(service.previewRequirementsTestCases({ requirements, appType, max_cases: 1 }), message);
    assert.equal(fixture.calls.length, 1);
  }
});

test("assurance sends current draft and criteria but accepts only narratives with known source refs", async () => {
  const fixture = providerFixture({ summary: "Review the approval outcome", overall_score: 100, verdict: "Needs review",
    dimensions: [{ id: "industry-standards", score: 100, status: "strong", explanation: "Draft is missing the rejection outcome", evidence: ["draft:story:story", "invented:secret"], recommendation: "Record rejection criteria" }, { id: "invented", explanation: "Ignore", evidence: ["draft:story:story"] }],
    insights: [{ title: "Ignore unsupported claim", explanation: "No source", evidence: ["invented:secret"] }] });
  const service = load("artifactAssurance.service", fixture.overrides);
  const result = await service.reviewArtifact({ artifactType: "story", savedArtifact: story, proposedChange: { description: "LIVE_DRAFT", acceptance_criteria: ["CURRENT_AC"] }, user, projectId: "project", integrationId: "provider", promptGuidance: "OUR_CRITERIA", additionalContext: "REVIEWED_ASSURANCE_CONTEXT", baseline: { overall_score: 37, dimensions: [{ id: "industry-standards", score: 25 }] } });
  assert.equal(result.generation_mode, "hybrid");
  assert.equal(result.fallback_used, false);
  assert.equal(result.assurance_review.overall_score, undefined);
  assert.equal(result.assurance_review.dimensions.length, 1);
  assert.equal(result.assurance_review.dimensions[0].score, undefined);
  assert.deepEqual(result.assurance_review.dimensions[0].evidence, ["draft:story:story"]);
  assert.deepEqual(result.assurance_review.insights, []);
  const prompt = fixture.calls[0].body.messages[1].content;
  assert.match(prompt, /LIVE_DRAFT/); assert.match(prompt, /CURRENT_AC/); assert.match(prompt, /OUR_CRITERIA/); assert.match(prompt, /"overall_score":37/);
  assert.doesNotMatch(prompt, /STORY_DESCRIPTION_SENTINEL|AC_SENTINEL/);
  assert.equal(prompt.split("REVIEWED_ASSURANCE_CONTEXT").length - 1, 1);
  assert.match(prompt, /"ref":"review:context"/);
  assert.equal(fixture.selections[0].usageKey, "ai.quality.story_assurance");
  assert.equal(fixture.calls[0].policy.maxOutputTokens, 4096);
});

test("Test Case assurance includes linked Story acceptance and respects current Gherkin", async () => {
  const fixture = providerFixture({ summary: "Review", dimensions: [{ id: "scenario-coverage", explanation: "Compare the expected approval", evidence: ["requirement:story"] }] });
  const service = load("artifactAssurance.service", fixture.overrides);
  const result = await service.reviewArtifact({ artifactType: "test-case", savedArtifact: { id: "case", steps }, proposedChange: { authoring_mode: "gherkin", gherkin_document: "Feature: UNSAVED_GHERKIN" }, linkedEvidence: [{ ...story, kind: "requirement" }], user, projectId: "project" });
  assert.equal(result.fallback_used, false);
  const prompt = fixture.calls[0].body.messages[1].content;
  assert.match(prompt, /AC_SENTINEL/); assert.match(prompt, /SPEC_SENTINEL/); assert.match(prompt, /UNSAVED_GHERKIN/);
  assert.doesNotMatch(prompt, /Approve the invoice/);
  assert.equal(fixture.selections[0].usageKey, "ai.quality.test_case_assurance");
});

test("assurance exposes actionable provider failures without fabricated reviews or paid retries", async () => {
  for (const [error, expected] of [[Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code: "AI_OUTPUT_TRUNCATED" }), /stopped before completing/], [Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { upstreamStatusCode: 401 }), /credentials or model access/], [Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code: "AI_INPUT_BUDGET_EXCEEDED" }), /input exceeds/]]) {
    const fixture = providerFixture(error);
    const service = load("artifactAssurance.service", fixture.overrides);
    const result = await service.reviewArtifact({ artifactType: "story", savedArtifact: story, user, projectId: "project" });
    assert.equal(result.fallback_used, true); assert.equal(result.assurance_review, undefined);
    assert.match(result.fallback_reason, expected); assert.doesNotMatch(result.fallback_reason, /PRIVATE_PROVIDER_DETAIL/);
    assert.equal(fixture.calls.length, 1);
  }
});

test("assurance omits forbidden optional evidence before querying it", async () => {
  const queries = [];
  const reviews = [];
  const service = load("qualityAssistance.service", {
    "../db": { prepare(sql) { queries.push(sql); return { get: async () => story, all: async () => { assert.fail("Forbidden evidence queried"); } }; } },
    "./entityScope.service": { requireEntityPermission: async () => ({ projectId: "project" }) },
    "./optionalEvidenceAccess.service": { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, false])) },
    "./artifactAssurance.service": { reviewArtifact: async args => { reviews.push(args); return { fallback_used: true, fallback_reason: "No provider" }; } }
  });
  const result = await service.previewRequirementImpact({ user, requirementId: story.id, proposedChange: { title: "Current", priority: 4 } });
  assert.equal(result.requirement.title, "Current");
  assert.equal(result.requirement.priority, 4);
  assert.equal(result.requirement.risk_score, 15, "Impact uses the current draft priority rather than the saved priority");
  assert.equal(queries.length, 1);
  assert.deepEqual(reviews[0].linkedEvidence, []);
  assert.deepEqual(result.scope.unavailable_sources, ["testcase.view", "suite.view", "run.view", "automation.view"]);
  assert.match(result.explanation, /no coverage conclusion/);
  assert.equal(result.fallback_reason, "No provider");
});

test("permitted assurance relationships are project scoped before reaching the model", async () => {
  const queries = [];
  const reviews = [];
  const service = load("qualityAssistance.service", {
    "../db": { prepare(sql) { return { get: async () => ({ id: "case" }), all: async (...args) => { queries.push({ sql, args }); return /SELECT requirements/.test(sql) ? [story] : []; } }; } },
    "./entityScope.service": { requireEntityPermission: async () => ({ projectId: "project" }) },
    "./optionalEvidenceAccess.service": { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, true])) },
    "./artifactAssurance.service": { reviewArtifact: async args => { reviews.push(args); return {}; } }
  });
  await service.previewTestCaseImpact({ user, testCaseId: "case" });
  for (const query of queries.filter(item => !/FROM test_steps/.test(item.sql))) {
    assert.match(query.sql, /project_id = \?/); assert.deepEqual(query.args, ["case", "project"]);
  }
  assert.deepEqual(reviews[0].linkedEvidence[0].acceptance_criteria, story.acceptance_criteria);
});

test("assurance routes forward the live draft, selected provider, prompt and locked baseline", async () => {
  const handlers = new Map();
  const captured = [];
  const routes = load("qualityAssistance.routes", {
    "../services/qualityAssistance.service": { previewRequirementImpact: async args => captured.push(args), previewTestCaseImpact: async args => captured.push(args) },
    "../services/project.service": { getProject: async () => ({ id: "project" }) },
    "../services/requirement.service": { getRequirement: async () => story },
    "../services/testCase.service": { getTestCase: async () => ({ id: "case", app_type_id: "app" }) },
    "../services/appType.service": { getAppType: async () => appType }
  }, "routes");
  const validations = [];
  await routes({ post: (url, handler) => handlers.set(url, handler), authenticate: async () => {}, validate: (schema, body) => validations.push({ schema, body }), requirePermission: () => async () => {} });
  const body = { project_id: "project", integration_id: "provider", prompt_guidance: "Review guidance", additional_context: "Reviewed context", assurance_baseline: { overall_score: 45 }, proposed_change: { acceptance_criteria: ["LIVE"] } };
  for (const route of ["/requirements/:id/ai-impact-preview", "/test-cases/:id/ai-impact-preview"]) await handlers.get(route)({ user, params: { id: "record" }, body });
  assert.equal(captured.length, 2);
  for (const args of captured) { assert.equal(args.integrationId, "provider"); assert.equal(args.promptGuidance, body.prompt_guidance); assert.equal(args.additionalContext, body.additional_context); assert.deepEqual(args.assuranceBaseline, body.assurance_baseline); assert.deepEqual(args.proposedChange, body.proposed_change); }
  assert.equal(validations[0].schema.prompt_guidance.maxLength, 12000);
  await assert.rejects(handlers.get("/requirements/:id/ai-impact-preview")({ user, params: { id: "record" }, body: { project_id: "foreign" } }), error => error.statusCode === 400);
});
