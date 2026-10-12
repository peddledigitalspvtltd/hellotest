const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../src/db");
const permissions = require("../services/permission.service");
const projects = require("../services/project.service");
const authorization = require("../../../knowledge/backend/services/knowledgeAuthorization.service");
const orchestrator = require("../../../ai/backend/services/aiContextOrchestrator.service");
const assistant = require("../../../chatbot/backend/services/knowledgeAssistant.service");
const agent = require("../../../agentic/backend/services/agenticAssistant.service");

const actor = { id: "reviewer" };
const projectId = "project-one";

function fixture(t, { grants, flags = {}, support = false }) {
  const queries = [];
  const access = new Set(["knowledge.view", ...grants]);
  const storedFlags = { ...flags };
  t.mock.method(permissions, "hasPermission", async (user, permission, project) => user === actor && project === projectId && access.has(permission));
  t.mock.method(projects, "getProject", async () => ({ id: projectId }));
  t.mock.method(authorization, "getEvidenceAccess", async ({ evidence }) => {
    assert.deepEqual(evidence, []);
    return { allowed: [], denied_ids: [], partial: false };
  });
  t.mock.method(db, "prepare", sql => ({
    async get() {
      if (/FROM app_settings/.test(sql)) return { value: { flags: storedFlags } };
      queries.push(sql);
      if (/FROM projects/.test(sql)) return { id: projectId, name: "Review project" };
      if (/FROM requirements/.test(sql)) return { total: 3, covered: 2, thin_coverage: 1 };
      if (/FROM test_cases/.test(sql)) return { total: 4, without_steps: 2, without_story_traceability: 1 };
      if (/FROM test_suites|FROM test_case_modules|FROM shared_step_groups/.test(sql)) return { total: 2 };
      if (/FROM executions/.test(sql)) return { total: 1, failed_runs: 1, ...(/execution_results/.test(sql) ? { failed_results: 7, blocked_results: 2 } : {}) };
      if (/FROM test_environments|FROM test_configurations/.test(sql)) return { total: 1 };
      assert.fail("Unexpected context lookup: " + sql);
    },
    async all(...params) {
      queries.push(sql);
      if (/FROM requirement_relations/.test(sql)) { assert.equal(params.at(-1),projectId); return support ? [{ story_id:'story',id:'related-story',title:'Related acceptance',status:'ready',relation:'related' }] : []; }
      if (/FROM entity_comments/.test(sql)) { assert.equal(params[0],projectId); return [{ story_id:'story',id:'comment',excerpt:'Reviewer confirms refund limits',updated_at:'2026-10-12' }]; }
      if (/FROM attachments/.test(sql)) { assert.equal(params[0],projectId); return [{ story_id:'story',id:'attachment',file_name:'wireframe.png',mime_type:'image/png',size_bytes:50000 }]; }
      if (/FROM app_types/.test(sql)) return [{ id: "application", name: "Web" }];
      if (/FROM requirements/.test(sql)) return [{ id: "story", title: "Account approval", ...(/AS linked_test_case_count/.test(sql) ? { linked_test_case_count: 1 } : {}) }];
      if (/FROM test_cases/.test(sql)) return [{ id: "case", title: "Review approval", step_count: 0, linked_story_count: 1 }];
      if (/FROM shared_step_groups/.test(sql)) return [{ id: "shared", name: "Permitted shared steps" }];
      if (/FROM executions/.test(sql)) return [{ id: "run", name: "Current run", status: "failed", ...(/execution_results/.test(sql) ? { result_count: 9, failed_count: 7, blocked_count: 2 } : {}) }];
      if (/FROM test_environments|FROM test_configurations/.test(sql)) return [{ id: "context", name: "Permitted execution context" }];
      assert.fail("Unexpected context list: " + sql);
    }
  }));
  const build = async scope => orchestrator.buildLiveProjectEvidence({ projectId, prompt: "Review quality", user: actor, route: { live_scopes: [scope] } });
  const authorize = async hits => assistant._internals.authorizeFreshEvidence({ projectId, user: actor, hits });
  return { queries, access, flags: storedFlags, build, authorize };
}
test('Story supporting evidence uses project permissions, minimal metadata and revocable provenance',async t=>{
 const state=fixture(t,{grants:['requirement.view','comment.view','attachment.view'],support:true});
 const result=await state.build('stories');
 const support=result.hits.find(hit=>JSON.parse(hit.content).evidence_type==='authoritative_live_story_support');
 assert.ok(support);const snapshot=JSON.parse(support.content);
 assert.equal(snapshot.related_items[0].id,'related-story');assert.equal(snapshot.comments[0].id,'comment');assert.equal(snapshot.attachments[0].id,'attachment');
 assert.deepEqual(snapshot.evidence_permissions,['requirement.view','comment.view','attachment.view']);
 assert.doesNotMatch(support.content,/object_key|author_email|base64/);
 assert.equal((await state.authorize([support])).allowed.length,1);
 state.access.delete('comment.view');
 assert.equal((await state.authorize([support])).allowed.length,0);
 const base=result.hits.find(hit=>JSON.parse(hit.content).evidence_type==='authoritative_live_story_snapshot');
 assert.equal((await state.authorize([base])).allowed.length,1);
});

for (const reason of ["disabled", "denied"]) {
  test(`live Story context remains usable when Test Case evidence is ${reason}`, async t => {
    const state = fixture(t, {
      grants: ["requirement.view", ...(reason === "disabled" ? ["testcase.view"] : [])],
      flags: reason === "disabled" ? { "hellotest.manual.test_cases": false } : {}
    });
    const result = await state.build("stories");
    const storyHit = result.hits.find(hit => hit.source_id.endsWith("-stories"));
    const snapshot = JSON.parse(storyHit.content);
    assert.equal(snapshot.total_records, 3);
    assert.equal(snapshot.coverage_available, false);
    assert.equal(snapshot.uncovered_records, null);
    assert.deepEqual(snapshot.coverage_gaps, []);
    assert.ok(snapshot.records.every(record => !Object.hasOwn(record, "linked_test_case_count")));
    assert.deepEqual(snapshot.evidence_permissions, ["requirement.view"]);
    assert.ok(state.queries.every(sql => !/requirement_test_cases|FROM test_cases/.test(sql)), "No unavailable Test Case records or coverage counts are queried");
    const authorized = await state.authorize(result.hits);
    assert.equal(authorized.denied_ids.length, 0);
    assert.ok(authorized.allowed.includes(storyHit));
    assert.match(assistant._internals.summarizeLiveEvidence(storyHit), /coverage is unavailable/);
    const answer = assistant._internals.createDeterministicLiveAnswer({ question: "Which Stories have missing coverage?", hits: [storyHit] });
    assert.match(answer.content, /coverage gaps cannot be assessed/);
    assert.doesNotMatch(answer.content, /0 have no linked Test Cases/);
  });
}

for (const reason of ["disabled", "denied"]) {
  test(`live Test Cases remain usable when optional Stories and Suites are ${reason}`, async t => {
    const state = fixture(t, {
      grants: ["testcase.view", ...(reason === "disabled" ? ["requirement.view", "suite.view", "shared_step.view"] : [])],
      flags: reason === "disabled" ? { "hellotest.manual.requirements": false, "hellotest.manual.suites": false } : {}
    });
    const result = await state.build("test-cases");
    const caseHit = result.hits.find(hit => hit.source_id.endsWith("-test-cases"));
    const snapshot = JSON.parse(caseHit.content);
    assert.equal(snapshot.total_records, 4);
    assert.equal(snapshot.without_steps, 2);
    assert.equal(snapshot.without_story_traceability, null);
    assert.equal(snapshot.supporting_assets.suites, null);
    assert.equal(snapshot.supporting_assets.shared_step_groups, null);
    assert.deepEqual(snapshot.evidence_permissions, ["testcase.view"]);
    assert.ok(state.queries.every(sql => !/requirement_test_cases|test_suites|shared_step_groups/.test(sql)));
    assert.ok((await state.authorize(result.hits)).allowed.includes(caseHit));
    const answer = assistant._internals.createDeterministicLiveAnswer({ question: "Which test cases are missing steps?", hits: [caseHit] });
    assert.match(answer.content, /Story traceability is unavailable/);
    assert.doesNotMatch(answer.content, /0 linked Stories|0 have no Story traceability/);
  });
}

test("collaborator revocation hides old enriched evidence and permits newly rebuilt core context", async t => {
  const state = fixture(t, { grants: ["requirement.view", "testcase.view"] });
  const before = await state.build("stories");
  const storyHit = before.hits.find(hit => hit.source_id.endsWith("-stories"));
  assert.equal(JSON.parse(storyHit.content).coverage_available, true);
  assert.ok((await state.authorize([storyHit])).allowed.includes(storyHit));
  state.flags["hellotest.manual.test_cases"] = false;
  const revoked = await state.authorize([storyHit]);
  assert.deepEqual(revoked.allowed, []);
  assert.equal(revoked.denied_ids.length, 1);
  const rebuilt = await state.build("stories");
  assert.equal((await state.authorize(rebuilt.hits)).denied_ids.length, 0);
  state.access.delete("requirement.view");
  assert.equal((await state.authorize(rebuilt.hits.filter(hit => hit.source_id.endsWith("-stories")))).allowed.length, 0);
});

test("shared steps require their own permission while available Suites still enrich Test Cases", async t => {
  const state = fixture(t, { grants: ["testcase.view", "suite.view"] });
  const result = await state.build("test-cases");
  const caseHit = result.hits.find(hit => hit.source_id.endsWith("-test-cases"));
  const snapshot = JSON.parse(caseHit.content);
  assert.equal(snapshot.supporting_assets.suites, 2);
  assert.equal(snapshot.supporting_assets.shared_step_groups, null);
  assert.deepEqual(snapshot.evidence_permissions, ["testcase.view", "suite.view"]);
  assert.equal((await state.authorize([caseHit])).allowed.length, 1);
  state.access.delete("suite.view");
  assert.equal((await state.authorize([caseHit])).allowed.length, 0);
});

test("legacy evidence and malformed collaborator provenance retain conservative authorization", async t => {
  const state = fixture(t, { grants: ["requirement.view"] });
  for (const declaration of [undefined, [], ["unknown.permission"]]) {
    const hit = orchestrator._internals.makeLiveHit({ projectId, scope: "stories", title: "Stored Story coverage", content: JSON.stringify({ evidence_type: "authoritative_live_story_snapshot", evidence_permissions: declaration, covered_records: 3 }) });
    assert.equal((await state.authorize([hit])).allowed.length, 0);
  }
});

test("execution environment evidence remains available without configuration permission", async t => {
  const state = fixture(t, { grants: ["run.view", "environment.view"] });
  const result = await state.build("runs");
  const context = result.hits.find(hit => hit.source_id.endsWith("-execution-context"));
  assert.ok(context);
  assert.deepEqual(JSON.parse(context.content).evidence_permissions, ["environment.view"]);
  assert.ok(state.queries.every(sql => !/FROM test_configurations/.test(sql)));
  assert.equal((await state.authorize([context])).allowed.length, 1);
  state.flags["hellotest.manual.environments"] = false;
  assert.equal((await state.authorize([context])).allowed.length, 0);
  const rebuilt = await state.build("runs");
  assert.ok(!rebuilt.hits.some(hit => hit.source_id.endsWith("-execution-context")));
  assert.ok((await state.authorize(rebuilt.hits)).allowed.some(hit => hit.source_id.endsWith("-runs")));
});

test("Run context preserves run status while denied result counts stay unread and unavailable", async t => {
  const state = fixture(t, { grants: ["run.view"] });
  const result = await state.build("runs");
  const runHit = result.hits.find(hit => hit.source_id.endsWith("-runs"));
  const snapshot = JSON.parse(runHit.content);
  assert.equal(snapshot.total_records, 1);
  assert.equal(snapshot.failed_runs, 1);
  assert.equal(snapshot.results_available, false);
  assert.equal(snapshot.failed_results, null);
  assert.equal(snapshot.blocked_results, null);
  assert.equal(snapshot.failed_or_blocked_run_evidence[0].status, "failed");
  for (const key of ["result_count", "passed_count", "failed_count", "blocked_count"]) assert.equal(snapshot.records[0][key], null);
  assert.deepEqual(snapshot.evidence_permissions, ["run.view"]);
  assert.ok(state.queries.every(sql => !/execution_results/.test(sql)), "Result rows and aggregates are never queried without result.view");
  assert.equal((await state.authorize([runHit])).allowed.length, 1);
  assert.match(assistant._internals.summarizeLiveEvidence(runHit), /1 failed runs; result counts are unavailable/);
  for (const question of ["Which runs failed?", "Summarize project health"]) {
    const answer = assistant._internals.createDeterministicLiveAnswer({ question, hits: [runHit] });
    assert.match(answer.content, /result counts (?:are )?unavailable/);
    assert.doesNotMatch(answer.content, /0 (?:failed|blocked)/);
  }
  const context = { live_project: [runHit] };
  const contextRoute = orchestrator.planContext({ prompt: "Which runs failed?", agentId: "failure-analyst", mode: "agent" });
  const fallback = agent._internals.buildFallbackResult({ agent: { name: "Failure Analyst", objective: "Review failures" }, agentId: "failure-analyst", mode: "agent", prompt: "Which runs failed?", context, contextCounts: { live_project: 1 }, citations: agent._internals.buildCitations(context), contextRoute });
  assert.match(fallback.findings[0].detail, /1 failed Runs.*result counts are unavailable/);
  assert.doesNotMatch(JSON.stringify(fallback), /0 (?:failed|blocked) results/);
  assert.ok(agent._internals.buildEvidenceReadiness({ context, contextRoute }).limitations.includes("Run result counts are unavailable with current access."));
});

test("revoking result access hides enriched and legacy Run evidence while fresh core Run context works", async t => {
  const state = fixture(t, { grants: ["run.view", "result.view"] });
  const before = await state.build("runs");
  const runHit = before.hits.find(hit => hit.source_id.endsWith("-runs"));
  const snapshot = JSON.parse(runHit.content);
  assert.equal(snapshot.results_available, true);
  assert.equal(snapshot.failed_results, 7);
  assert.equal(snapshot.blocked_results, 2);
  assert.deepEqual(snapshot.evidence_permissions, ["run.view", "result.view"]);
  assert.equal((await state.authorize([runHit])).allowed.length, 1);
  state.access.delete("result.view");
  assert.equal((await state.authorize([runHit])).allowed.length, 0);
  const legacy = orchestrator._internals.makeLiveHit({ projectId, scope: "runs", title: "Legacy outcomes", content: JSON.stringify({ evidence_type: "authoritative_live_execution_snapshot", failed_results: 7 }) });
  assert.equal((await state.authorize([legacy])).allowed.length, 0);
  state.queries.length = 0;
  const rebuilt = await state.build("runs");
  assert.ok(state.queries.every(sql => !/execution_results/.test(sql)));
  assert.ok((await state.authorize(rebuilt.hits)).allowed.some(hit => hit.source_id.endsWith("-runs")));
  state.access.delete("run.view");
  assert.equal((await state.authorize(rebuilt.hits.filter(hit => hit.source_id.endsWith("-runs")))).allowed.length, 0);
});

test("bounding large snapshots preserves all authorization requirements", () => {
  const required = ["testcase.view", "requirement.view", "suite.view", "shared_step.view"];
  const result = JSON.parse(orchestrator._internals.serializeBoundedEvidence({
    evidence_type: "authoritative_live_test_case_snapshot", evidence_permissions: required,
    records: Array.from({ length: 200 }, (_, index) => ({ title: `Case ${index}`, detail: "Large content ".repeat(500) }))
  }, 1_500));
  assert.deepEqual(result.evidence_permissions, required);
});

test('domain-authorized live Story evidence remains usable without Knowledge Repo access; indexed evidence stays denied', async t => {
  const state = fixture(t, { grants: ['requirement.view'] });
  state.access.delete('knowledge.view');
  const packet = await state.build('stories');
  const story = packet.hits.find(hit => hit.source_id.endsWith('-stories'));
  assert.ok(story);
  const indexed = { source_id: 'indexed-source', source_kind: 'text', chunk_id: 'private-fragment', citation: { id: 'private-evidence' }, content: 'Private knowledge' };
  const authorized = await state.authorize([story, indexed]);
  assert.equal(authorized.allowed.length, 1);
  assert.equal(authorized.allowed[0].source_kind, 'live_project');
  assert.deepEqual(authorized.denied_ids, ['private-evidence']);
});
