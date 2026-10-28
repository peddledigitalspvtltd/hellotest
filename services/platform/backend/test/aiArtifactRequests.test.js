const { sourceFile } = require("./helpers/sourceFile");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { storyAiSnapshot, testCaseAiSnapshot } = require("../src/utils/aiArtifactContext");
const { expandManagedInstructions } = require('./helpers/managedInstructions');

function load(name, overrides = {}, directory = "services") {
  const filename = sourceFile(`${name}.js`, directory);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(
    id => {
      const key = Object.keys(overrides).find(candidate => candidate.split('/').pop() === id.split('/').pop());
      if (key === undefined && id.endsWith('/dropdownCatalog.service')) return {getField:async()=>({default_value:'functional',options:[{value:'functional',active:true},{value:'regression',active:true}]})};
      return key === undefined ? localRequire(id) : overrides[key];
    }, module, module.exports
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
test('Story description rephrase selects its own profile while project HTML uses its native bullet contract', async () => {
  for (const entityType of ['requirement','project']) {
    const calls=[],selections=[];
    const service=load('richTextAi.service',{
      './aiLlmSelection.service':{resolveLlmIntegrationForUsage:async input=>{selections.push(input);return integration;}},
      '../utils/llmHttpClient':{fetchLlmWithRetry:async(_url,init,policy)=>{calls.push({body:JSON.parse(init.body),policy});return new Response(JSON.stringify({choices:[{message:{content:'<p>Preserved business behavior.</p>'}}]}));}}
    });
    await service.rephrase({user,projectId:'project',content:'Preserved business behavior.',entityType,fieldLabel:'Description'});
    assert.equal(selections[0].usageKey,entityType==='requirement'?'ai.requirement.description_rephrase':'ai.content.rephrase');
    assert.equal(calls[0].policy.featureKey,selections[0].usageKey);
    if(entityType==='project')assert.match(calls[0].body.messages[0].content,/richTextAi.response.7/);
  }
});
test('Story change-impact selects its own controls and supplies saved and proposed snapshots',async()=>{
 const fixture=providerFixture({summary:'Review the changed acceptance behavior.',dimensions:[{id:'design-maturity',explanation:'The draft changes acceptance.',evidence:['saved:story:story','draft:story:story']}]});
 const service=load('artifactAssurance.service',fixture.overrides);
 await service.reviewArtifact({artifactType:'story',reviewPurpose:'change-impact',savedArtifact:story,proposedChange:{title:'Proposed refund approval'},user,projectId:'project'});
 assert.equal(fixture.selections[0].usageKey,'ai.requirement.change_impact');assert.equal(fixture.calls[0].policy.featureKey,'ai.requirement.change_impact');
 assert.match(fixture.calls[0].body.messages[1].content,/saved:story:story/);assert.match(fixture.calls[0].body.messages[1].content,/Proposed refund approval/);
});
test('automation step rephrase selects its profile and retains user guidance beyond 4 KB in fallback',async()=>{
 const fixture=providerFixture({action:'Submit the refund',expected_result:'The over-limit refund is rejected',step_type:'web'});
 const service=load('aiCaseAuthoring.service',fixture.overrides);
 const guidance='Context '.repeat(650)+'USER_GUIDANCE_AT_END';
 await service.rephraseTestStep({requirement:story,appType,user_id:user.id,ai_feature:'ai.automation.step_rephrase',test_case:{title:'Refund'},step:{action:'Submit refund',expected_result:'Reject excessive amount'},additional_context:guidance});
 assert.equal(fixture.selections[0].usageKey,'ai.automation.step_rephrase');assert.match(fixture.calls[0].body.messages[1].content,/USER_GUIDANCE_AT_END/);assert.match(fixture.calls[0].policy.contextFallbackContent,/USER_GUIDANCE_AT_END/);
 await assert.rejects(service.rephraseTestStep({appType,ai_feature:'ai.admin.prompt_optimization',step:{action:'Submit'}}),{statusCode:400});
});
function providerFixture(result, { contentBlocks = false } = {}) {
  const calls = [];
  const selections = [];
  return {
    calls, selections,
    overrides: {
      "./aiLlmSelection.service": { async resolveLlmIntegrationForUsage(args) { selections.push(args); return integration; } },
      "../utils/llmHttpClient": { async fetchLlmWithRetry(url, options, policy) {
        if (policy.featureKey === 'ai.authoring.request_validation') return response({ decision: 'accept', explanation: 'The instructions are within Test Case authoring.', suggestions: [] });
        const body = JSON.parse(options.body);
        for (const message of body.messages || []) {
          if (typeof message.content === 'string') message.content = expandManagedInstructions(message.content);
          else if (Array.isArray(message.content)) for (const part of message.content) if (part.type === 'text') part.text = expandManagedInstructions(part.text);
        }
        if (typeof policy.contextFallbackContent === 'string') policy = { ...policy, contextFallbackContent: expandManagedInstructions(policy.contextFallbackContent) };
        calls.push({ url, options, body, policy }); if (result instanceof Error) throw result; return contentBlocks ? new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: JSON.stringify(result) }] } }] }), { headers: { "content-type": "application/json" } }) : response(result);
      } }
    }
  };
}

test("authoring parses visible content blocks and preserves the input format when converting output", async () => {
  const fixture = providerFixture(validCase, { contentBlocks: true });
  const service = load("aiCaseAuthoring.service", fixture.overrides);
  const result = await service.previewCaseAuthoring({ requirement: story, appType, authoring_mode: "structured", test_case: {
    title: "Live case", authoring_mode: "gherkin", gherkin_document: "Feature: LIVE_INPUT\nScenario: Preserve me\nWhen I approve\nThen the invoice is approved", steps: [{ action: "STALE_CACHE" }]
  } });
  assert.equal(result.case.authoring_mode, "structured");
  const prompt = fixture.calls[0].body.messages[1].content;
  assert.equal(JSON.parse(prompt).current_case.authoring_mode,"gherkin");
  assert.equal(JSON.parse(prompt).application_contract.authoring_mode,"structured");
  assert.match(prompt, /LIVE_INPUT/);
  assert.doesNotMatch(prompt, /STALE_CACHE/);
  assert.match(fixture.calls[0].policy.contextFallbackContent, /LIVE_INPUT/);
  assert.match(fixture.calls[0].policy.contextFallbackContent, /AC_SENTINEL/);
  assert.equal(fixture.calls[0].options.signal, undefined, "The shared provider deadline owns cancellation");
});

test("authoring includes complete reviewed context within its UI budget and rejects oversized evidence", async () => {
  const fixture = providerFixture(validCase);
  const service = load("aiCaseAuthoring.service", fixture.overrides);
  const reviewed = "x".repeat(12_000) + "REVIEWED_CONTEXT_END";
  await service.previewCaseAuthoring({ requirement: story, appType, test_case: {}, additional_context: reviewed });
  assert.match(fixture.calls[0].body.messages[1].content, /REVIEWED_CONTEXT_END/);
  assert.match(fixture.calls[0].policy.contextFallbackContent, /REVIEWED_CONTEXT_END/);
  await assert.rejects(service.previewCaseAuthoring({ requirement: story, appType, test_case: {}, additional_context: "x".repeat(18_001) }), { code: "AI_INPUT_BUDGET_EXCEEDED", statusCode: 422 });
  assert.equal(fixture.calls.length, 1, "Over-budget authored context is not silently sliced before dispatch");
});

test("Story create and completion accept provider text blocks without falling back", async () => {
  const createDraft = { title: "Approve an invoice", description: "Reviewers approve submitted invoices.", field_evidence: { title: ["user-guidance:story-brief"], description: ["user-guidance:story-brief"] } };
  const creation = providerFixture({ requirements: [createDraft] }, { contentBlocks: true });
  const create = load("requirement.service", { ...creation.overrides, "../db": { prepare: () => ({}) }, "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) } });
  const created = await create.previewRequirementCreation({ project_id: "project", additional_context: "Reviewers approve submitted invoices.", max_requirements: 1 });
  assert.equal(created.fallback_used, false);
  assert.equal(created.requirements[0].title, createDraft.title);
  assert.equal(creation.calls[0].options.signal, undefined, "Story creation must not abort before the shared provider deadline");
  const completion = providerFixture({ title: "Review invoice approval", field_evidence: { title: ["story:story"] } }, { contentBlocks: true });
  const complete = load("requirement.service", { ...completion.overrides,
    "../db": { prepare: () => ({ get: async () => story }) },
    "./optionalEvidenceAccess.service": { getOptionalEvidenceAccess: async () => ({ "testcase.view": false }) },
    "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) }
  });
  const completed = await complete.previewRequirementOptimization({ id: story.id, user });
  assert.equal(completed.fallback_used, false);
  assert.equal(completed.suggestion.title, "Review invoice approval");
});

test("Test Case generation handles text block output and rejects unsavable titles", async () => {
  const fixture = providerFixture({ test_cases: [validCase] }, { contentBlocks: true });
  const service = load("requirementDesign.service", { ...fixture.overrides, "./aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) } });
  assert.equal((await service.previewRequirementsTestCases({ requirements: [story], appType, max_cases: 1 })).cases[0].title, validCase.title);
  const oversized = providerFixture({ ...validCase, title: "a".repeat(256) });
  const improve = load("aiCaseAuthoring.service", oversized.overrides);
  await assert.rejects(improve.previewCaseAuthoring({ requirement: story, appType, test_case: {} }), error => error.statusCode === 502 && /255/.test(error.message));
});

test("Defect drafting uses configured completion endpoints and dedicated Story acceptance evidence", async () => {
  const fixture = providerFixture({ draft: { title: "Invoice approval fails" }, field_evidence: { title: ["reporter:intent"] } }, { contentBlocks: true });
  const queries = [];
  const service = load("aiBugDraft.service", { ...fixture.overrides,
    "../db": { prepare(sql) { queries.push(sql); return { get: async () => /FROM requirements/.test(sql)
      ? { ...story, description: "Finance workflow", acceptance_criteria: undefined, additional_fields: { acceptance_criteria: ["Approved invoices display a confirmation number"] } }
      : { id: "project" } }; } }
  });
  const result = await service.preview({ user, project_id: "project", intent: "Invoice approval fails", linked_requirement_ids: [story.id] });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].url, "https://llm.invalid/v1/chat/completions");
  assert.equal(fixture.calls[0].options.headers.Authorization, undefined);
  assert.equal(result.draft.title, "Invoice approval fails");
  assert.notEqual(result.provenance.generation_mode, "deterministic");
  assert.equal(result.draft.expected_result, "Approved invoices display a confirmation number");
  assert.match(fixture.calls[0].body.messages[1].content, /Approved invoices display a confirmation number/);
  assert.ok(queries.some(sql => /SELECT .*additional_fields.*FROM requirements/.test(sql)));
});

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
  const fixture = providerFixture({ layman: { explanation: "Review the approval requirements.", evidence_refs: ["requirement:story"] } });
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
  const draft = { title: "Review an invoice", description: "A reviewer approves an invoice", acceptance_criteria: ["Approval sets status to approved"], evidence_refs: ["user-guidance:story-brief"], field_evidence: { title: ["user-guidance:story-brief"], description: ["user-guidance:story-brief"], acceptance_criteria: ["user-guidance:story-brief"] } };
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
    dimensions: [{ id: "industry-standards", score: 100, status: "strong", explanation: "Draft is missing the rejection outcome", evidence: ["draft:story:story"], recommendation: "Record rejection criteria" }, { id: "invented", explanation: "Ignore", evidence: ["draft:story:story"] }],
    insights: [] });
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
  assert.equal(fixture.calls[0].policy.maxOutputTokens, 6144);
  assert.ok(fixture.calls[0].policy.timeoutMs > 0 && fixture.calls[0].policy.timeoutMs <= 60000);
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
    await assert.rejects(service.reviewArtifact({ artifactType: "story", savedArtifact: story, user, projectId: "project" }), failure => {
      assert.match(failure.message, expected); assert.doesNotMatch(failure.message, /PRIVATE_PROVIDER_DETAIL/); return true;
    });
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
    "../public/projectAccess": { getProject: async () => ({ id: "project" }) },
    "../services/requirement.service": { getRequirement: async () => story },
    "../services/testCase.service": { getTestCase: async () => ({ id: "case", app_type_id: "app" }) },
    "../public/applicationAccess": { getAppType: async () => appType }
  }, "routes");
  const validations = [];
  await routes({ get: (url, handler) => handlers.set(url, handler), post: (url, options, handler) => handlers.set(url, handler || options), authenticate: async () => {}, validate: (schema, body) => validations.push({ schema, body }), requirePermission: () => async () => {} });
  const body = { project_id: "project", integration_id: "provider", prompt_guidance: "Review guidance", additional_context: "Reviewed context", assurance_baseline: { overall_score: 45 }, proposed_change: { acceptance_criteria: ["LIVE"] } };
  for (const route of ["/requirements/:id/ai-impact-preview", "/test-cases/:id/ai-impact-preview"]) await handlers.get(route)({ user, params: { id: "record" }, body });
  assert.equal(captured.length, 2);
  for (const args of captured) { assert.equal(args.integrationId, "provider"); assert.equal(args.promptGuidance, body.prompt_guidance); assert.equal(args.additionalContext, body.additional_context); assert.deepEqual(args.assuranceBaseline, body.assurance_baseline); assert.deepEqual(args.proposedChange, body.proposed_change); }
  assert.equal(validations[0].schema.prompt_guidance.maxLength, 12000);
  await assert.rejects(handlers.get("/requirements/:id/ai-impact-preview")({ user, params: { id: "record" }, body: { project_id: "foreign" } }), error => error.statusCode === 400);
});

test("Defect improvement rejects missing or foreign Test Case context before calling a model", async () => {
  const fixture = providerFixture({ draft: { title: "Unsupported proposal" } });
  const service = load("aiBugDraft.service", { ...fixture.overrides,
    "../db": { prepare: sql => ({ get: async () => /FROM projects/.test(sql) ? { id: "project" } : null, all: async () => [] }) }
  });
  await assert.rejects(service.preview({ user, project_id: "project", intent: "Improve the current defect", evidence: "Recorded failure", linked_test_case_ids: ["missing-or-foreign-case"], require_case_context: true }), error => error.statusCode === 400 && /context is unavailable/.test(error.message));
  assert.deepEqual(fixture.calls, [], "Unusable context does not spend model requests or produce a proposal");
});

 test("AI authoring and generation support no Story without inventing traceability", async () => {
   const author = providerFixture(validCase);
   const result = await load("aiCaseAuthoring.service", author.overrides).previewCaseAuthoring({ appType, user_id: user.id, test_case: { title: "Invoice approval", steps }, additional_context: "Measure invoice approval latency" });
   assert.equal(result.requirement, null);
   assert.equal(JSON.parse(author.calls[0].body.messages[1].content).story, null);
   const generated = providerFixture({ testCases: [{ ...validCase, requirement_refs: [] }] });
   const service = load("requirementDesign.service", { ...generated.overrides, "./aiKnowledge.service": { buildKnowledgeContextPackage: async (projectId) => { assert.equal(projectId, "project"); return { knowledge: [] }; } } });
   const preview = await service.previewRequirementsTestCases({ requirements: [], appType, user_id: user.id, max_cases: 1, additional_context: "Measure invoice approval latency" });
   assert.deepEqual(preview.cases[0].requirement_ids, []);
   const input = JSON.parse(generated.calls[0].body.messages[1].content);
   assert.deepEqual(input.stories, []);
   assert.equal(input.application_contract.output_schema.properties.testCases.items.properties.requirement_refs.maxItems, 0);
 });

const referenceScreenshot={name:'Sign-in.png',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};
function assertScreenshotRequest(call){
 const content=call.body.messages.find(message=>message.role==='user').content;
 assert.ok(Array.isArray(content));assert.equal(content.filter(part=>part.type==='image_url').length,1);assert.equal(content.find(part=>part.type==='image_url').image_url.url,referenceScreenshot.url);
 assert.equal(content.find(part=>part.type==='image_url').image_url.detail,'low');
 assert.equal(JSON.stringify(content.filter(part=>part.type==='text')).includes(referenceScreenshot.url),false,'Image bytes are not copied into prompt text');
}
test('Story create and complete pass the selected screenshot as actual bounded vision content',async()=>{
 const creation=providerFixture({requirements:[{title:'Approve invoice',description:'Reviewers approve invoices.',acceptance_criteria:['Approval records the reviewer.'],priority:2,field_evidence:{title:['user-guidance:story-brief'],description:['user-guidance:story-brief'],acceptance_criteria:['user-guidance:story-brief']}}]});
 const create=load('requirement.service',{...creation.overrides,'../db':{prepare:()=>({})},'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>({knowledge:[]})}});
 await create.previewRequirementCreation({project_id:'project',additional_context:'Reviewers approve invoices. Approval records the reviewer.',images:[referenceScreenshot]});assertScreenshotRequest(creation.calls[0]);
 const completion=providerFixture({...story,field_evidence:{title:['story:story'],description:['story:story'],acceptance_criteria:['story:story']}});
 const complete=load('requirement.service',{...completion.overrides,'../db':{prepare:()=>({get:async()=>story})},'./optionalEvidenceAccess.service':{getOptionalEvidenceAccess:async()=>({'testcase.view':false})},'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>({knowledge:[]})}});
 await complete.previewRequirementOptimization({id:story.id,user,images:[referenceScreenshot]});assertScreenshotRequest(completion.calls[0]);
});
test('Test Case generation and improvement retain screenshots, configured type and priority through preview and acceptance',async()=>{
 const candidate={...validCase,test_case_type:'regression',parameter_values:{amount:'100'},steps:[{action:'Approve invoice for @t.amount',expected_result:'Approval is recorded'}]};
 const improveFixture=providerFixture(candidate),improve=load('aiCaseAuthoring.service',improveFixture.overrides);
 const improvement=await improve.previewCaseAuthoring({appType,test_case:{title:'Approval',priority:3,test_case_type:'functional'},images:[referenceScreenshot]});
 assertScreenshotRequest(improveFixture.calls[0]);assert.equal(improvement.case.test_case_type,'regression');assert.equal(improvement.case.priority,2);assert.equal(improvement.case.parameter_values.amount,'100');
 const writes=[],designFixture=providerFixture({testCases:[candidate]}),design=load('requirementDesign.service',{...designFixture.overrides,'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>({knowledge:[]})},'./testCase.service':{createTestCase:async input=>{writes.push(input);return{id:'new-case'};}}});
 const generated=await design.previewRequirementsTestCases({appType,requirements:[story],images:[referenceScreenshot],max_cases:1});assertScreenshotRequest(designFixture.calls[0]);assert.equal(generated.cases[0].test_case_type,'regression');
 await design.acceptGeneratedTestCases({appType,requirements:[story],cases:generated.cases,created_by:user.id});assert.equal(writes[0].test_case_type,'regression');assert.equal(writes[0].priority,2);assert.equal(writes[0].parameter_values.amount,'100');
 assert.deepEqual(designFixture.calls[0].policy.nativeArtifactTestCaseTypes,['functional','regression']);
});
test('unsupported screenshot input stops Test Case design without a text-only second model call',async()=>{
 const fixture=providerFixture(Object.assign(new Error('Select a vision-capable integration.'),{code:'AI_VISION_UNSUPPORTED',statusCode:422}));
 const design=load('requirementDesign.service',{...fixture.overrides,'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>({knowledge:[]})}});
 await assert.rejects(design.previewRequirementsTestCases({appType,requirements:[story],images:[referenceScreenshot]}),{code:'AI_VISION_UNSUPPORTED'});assert.equal(fixture.calls.length,1);
});
test('Defect creation and Test Case grounded improvement pass screenshots to the same protected draft path',async()=>{
 for(const require_case_context of [false,true]){
  const fixture=providerFixture({draft:{title:'Invoice approval fails'},field_evidence:{title:['reporter:intent']}});
  const service=load('aiBugDraft.service',{...fixture.overrides,'../db':{prepare(sql){return{get:async()=>/FROM test_cases/.test(sql)?{id:'case',title:'Approve invoice',description:'Approve an invoice',priority:2}:{id:'project'}};}}});
  await service.preview({user,project_id:'project',intent:'Invoice approval fails',linked_test_case_ids:require_case_context?['case']:[],require_case_context,reference_photos:[referenceScreenshot]});assertScreenshotRequest(fixture.calls[0]);
 }
});
test('Defect triage receives vision content while priority and record identity remain host-owned',async()=>{
 const issue={id:'issue',project_id:'project',title:'Approval fails',message:'Save displays an error',severity:'high',priority:'High',steps_to_reproduce:'Select Save',expected_result:'Saved',actual_result:'Error'};
 const fixture=providerFixture({recommendations:[{issue_id:'issue',category:'Functional defect',category_explanation:'The recorded Save operation produces an error.',category_evidence_refs:['issue:issue:message']}]});
 const service=load('aiBugTriage.service',{...fixture.overrides,'./issues.service':{getIssueItem:async()=>issue}});
 const result=await service.preview({project:{id:'project'},user,issueIds:['issue'],images:[referenceScreenshot]});assertScreenshotRequest(fixture.calls[0]);assert.equal(result.triage[0].issue_id,'issue');assert.equal(result.triage[0].recommended_priority,'High');assert.equal(result.generation_mode,'hybrid');
 assert.match(fixture.calls[0].body.messages[1].content[0].text,/Do not assume a screenshot belongs to a particular Defect/);
});
test('Smart Run uses multimodal content through its real request path and keeps whole candidate rows',async()=>{
 const fixture=providerFixture({cases:[{test_case_id:'case',reason:'The saved case covers the recorded change.',evidence_refs:['test-case:case']}]});
 const service=load('executionPlanning.service',fixture.overrides);
 await service.__smartExecutionInternals.requestSmartExecutionPlan({integration,appType,deliveryScope:{},scopeDescription:'Approval change',additionalContext:'Review error handling',promptGuidance:'',selectedRequirementTitles:[],executionContext:[],scopedCases:[{id:'case',title:'Approval',description:'Review a submitted invoice',evidence_refs:['test-case:case']}],images:[referenceScreenshot]});
 assertScreenshotRequest(fixture.calls[0]);assert.equal(fixture.calls[0].policy.contextFallback,false);assert.equal(fixture.calls.length,1);
});
test('AI improvement preserves the full administrator type code through current context, enum contract and output',async()=>{
 const type='regression_'+ 'x'.repeat(100),fixture=providerFixture({...validCase,test_case_type:type,parameter_values:{}});
 const service=load('aiCaseAuthoring.service',{...fixture.overrides,'./dropdownCatalog.service':{getField:async()=>({default_value:type,options:[{value:type,active:true}]})}});
 const result=await service.previewCaseAuthoring({appType,test_case:{title:'Approval',test_case_type:type}});
 assert.equal(result.case.test_case_type,type);const prompt=JSON.parse(fixture.calls[0].body.messages[1].content);assert.equal(prompt.current_case.test_case_type,type);assert.deepEqual(prompt.application_contract.output_schema.properties.test_case_type.enum,[type]);
});

test('custom Test Case objectives are validated before generation and rejected intent cannot produce a draft',async()=>{
 for(const mode of ['generate','improve','step']){
  const calls=[];
  const fixture=providerFixture(validCase);
  const overrides={...fixture.overrides,
   '../utils/llmHttpClient':{fetchLlmWithRetry:async(_url,_init,policy)=>{
    calls.push(policy.featureKey);
    assert.equal(policy.featureKey,'ai.authoring.request_validation');
    return response({decision:'story_mismatch',explanation:'The checkout request does not describe invoice approval.',suggestions:['Choose a checkout Story or remove the Story selection.']});
   }},'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>{assert.fail('Retrieval should follow intent validation');}}
  };
  const service=load(mode==='generate'?'requirementDesign.service':'aiCaseAuthoring.service',overrides);
  const input={requirement:story,requirements:[story],appType,test_case:{title:'Invoice approval'},additional_context:'Generate checkout payment cases.',step:{action:'Approve invoice',expected_result:'Approved'}};
  await assert.rejects(mode==='generate'?service.previewRequirementsTestCases(input):mode==='improve'?service.previewCaseAuthoring(input):service.rephraseTestStep(input),{code:'AI_AUTHORING_STORY_MISMATCH',statusCode:422});
  assert.deepEqual(calls,['ai.authoring.request_validation']);
 }
});

test('generation preserves explicit user guidance beyond the historical 8000-character truncation',async()=>{
 const fixture=providerFixture({test_cases:[validCase]});
 const service=load('requirementDesign.service',{...fixture.overrides,'./aiKnowledge.service':{buildKnowledgeContextPackage:async()=>({knowledge:[]})}});
 const additional_context='Test guidance. '.repeat(650)+'FINAL_USER_OBJECTIVE';
 await service.previewRequirementsTestCases({requirements:[story],appType,max_cases:1,additional_context});
 const data=JSON.parse(fixture.calls[0].body.messages[1].content);
 assert.equal(data.generation_request.user_request,additional_context);
 await assert.rejects(service.previewRequirementsTestCases({requirements:[story],appType,additional_context:'x'.repeat(18001)}),{code:'AI_INPUT_BUDGET_EXCEEDED'});
 assert.equal(fixture.calls.length,1);
});

test('native assurance and Test Case generation forward workflow cancellation to the provider transport', async () => {
  const controller = new AbortController();
  const reviewFixture = providerFixture({ summary: 'Review acceptance behavior.', dimensions: [{ id: 'design-maturity', explanation: 'Criteria provide observable behavior.', evidence: ['draft:story:story'] }] });
  await load('artifactAssurance.service', reviewFixture.overrides).reviewArtifact({ artifactType:'story',savedArtifact:story,user,projectId:'project',signal:controller.signal });
  assert.strictEqual(reviewFixture.calls[0].options.signal, controller.signal);
  const generationFixture = providerFixture({test_cases:[validCase]});
  const retrievals=[];
  const service = load('requirementDesign.service', { ...generationFixture.overrides, './aiKnowledge.service':{buildKnowledgeContextPackage:async(_project,input)=>{retrievals.push(input);return{knowledge:[]};}} });
  const evidence_scope={story_id:story.id,sprint_id:story.iteration_id};
  await service.previewRequirementsTestCases({ requirements:[story],appType,user_id:user.id,evidence_scope,signal:controller.signal });
  assert.strictEqual(generationFixture.calls[0].options.signal, controller.signal);
  assert.strictEqual(retrievals[0].signal,controller.signal);
  assert.deepEqual(retrievals[0].evidence_scope,evidence_scope);
  controller.abort();
  await assert.rejects(service.previewRequirementsTestCases({requirements:[story],appType,user_id:user.id,signal:controller.signal}),{statusCode:499});
});
