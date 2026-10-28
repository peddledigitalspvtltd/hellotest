const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const contracts = require("../../backend/services/knowledgeContracts.service");
const engine = require("../../backend/services/knowledgeContextEngine.service");
const execution = require("../../backend/services/knowledgeExecution.service");
const { streamKnowledge } = require("../../../platform/backend/src/utils/knowledgeStream");

const hit = (id, content = "The release requires a passing checkout test.") => ({ chunk_id: id, source_id: `source-${id}`, project_id: "project-1", source_kind: "text", title: "Release checklist", content, score: 0.9, citation: { id: `K-${id}`, chunk_id: id, source_id: `source-${id}` } });
const fixtures = (overrides = {}) => ({
  search: async () => ({ results: [{ query: "release", result: { results: [hit("1")], retrieval: { vector_mode: "disabled" } } }], errors: [] }),
  liveEvidence: async () => ({ hits: [], counts: {} }),
  planContext: () => ({ indexed_source_kinds: ["text"], live_scopes: [] }),
  merge: (results, limit) => [...new Map(results.flatMap((entry) => entry.result.results).map((item) => [item.chunk_id, item])).values()].slice(0, limit),
  assess: (hits) => ({ requires_more_context: !hits.length }),
  authorize: async (hits) => ({ allowed: hits, denied_ids: [], partial: false }),
  ...overrides
});
const retrieve = (dependencies, budgets = {}, options = {}) => execution.run(options, () => engine.retrieve({
  request: contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist", budgets }),
  user: { id: "user-1" }, dependencies, ...options
}));
const advanceClock = async (context, milliseconds) => {
  // Flush promise continuations before advancing the deadline. Date and timers
  // move together, independently of CPU contention in the full test suite.
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(milliseconds);
};

test('app-scoped graph expansion retains the edge exact proof instead of substituting an endpoint search hit',async()=>{
  let expansionArgs;const proof=hit('proof','This case tests the requirement.');
  const edge={source_canonical_id:'case-node',target_canonical_id:'requirement-node',relationship_type:'TESTS',evidence_ids:['K-proof'],provenance_type:'HUMAN_VERIFIED',endpoints_authorized:true};
  const dependencies=fixtures({assess:()=>({requires_more_context:true}),expandRelationships:async args=>{expansionArgs=args;return{results:[proof],relationships:[edge]};}});
  const result=await execution.run({},()=>engine.retrieve({request:contracts.buildRetrievalRequest({projectId:'project-1',query:'Investigate release coverage',queryClass:'INVESTIGATIVE',filters:{app_type_id:'app-selected',requested_scopes:['knowledge']},budgets:{max_rounds:1}}),user:{id:'user-1'},dependencies}));
  assert.equal(expansionArgs.app_type_id,'app-selected');assert.deepEqual(expansionArgs.sourceKinds,['knowledge_item','file','text','chat','url']);
  assert.equal(result.packet.relationships.length,1);assert.deepEqual(result.packet.relationships[0].evidence_ids,['K-proof']);
  assert.equal(result.packet.relationships[0].source,'case-node');assert.equal(result.packet.relationships[0].target,'requirement-node');
});

test('graph edges disappear when their exact proof is revoked even if an endpoint search passage is retained',async()=>{
  const proof=hit('proof','The relation witness.');
  const result=await retrieve(fixtures({assess:()=>({requires_more_context:true}),
    expandRelationships:async()=>({results:[proof],relationships:[{source_canonical_id:'source-1',target_canonical_id:'source-proof',relationship_type:'RELATED_TO',evidence_ids:['K-proof'],provenance_type:'HUMAN_VERIFIED',endpoints_authorized:true}]}),
    authorize:async hits=>({allowed:hits.filter(item=>item.chunk_id!=='proof'),partial:hits.some(item=>item.chunk_id==='proof')})
  }),{max_rounds:1});
  assert.ok(result.packet.evidence.some(item=>item.evidence_id==='K-1'));assert.equal(result.packet.relationships.length,0);
});

test('the real fusion contract retains native zero-similarity graph witnesses without admitting weak or unreviewed matches',async()=>{
  const {mergeRetrievalResults}=require('../../backend/services/knowledgeRetrieval.service');
  const proof={...hit('graph-proof','The release depends on checkout.'),score:0};
  const edge={source_canonical_id:'release-node',target_canonical_id:'checkout-node',relationship_type:'DEPENDS_ON',evidence_ids:['K-graph-proof'],provenance_type:'HUMAN_VERIFIED',endpoints_authorized:true};
  const dependencies=fixtures({merge:mergeRetrievalResults,assess:()=>({requires_more_context:true}),
    expandRelationships:async()=>({results:[proof],relationships:[edge],retrieval:{vector_mode:'graph_witnesses'}})
  });
  const result=await execution.run({},()=>engine.retrieve({request:contracts.buildRetrievalRequest({projectId:'project-1',query:'Investigate release coverage',queryClass:'INVESTIGATIVE',budgets:{max_rounds:1}}),user:{id:'user-1'},dependencies}));
  assert.ok(result.packet.evidence.some(item=>item.evidence_id==='K-graph-proof'));
  assert.equal(result.packet.relationships.length,1);
  assert.equal(result.hits.find(item=>item.chunk_id==='graph-proof').score,0,'Factual witnesses must not receive invented similarity scores');
  const entry={results:[proof],relationships:[{...edge,provenance_type:'LLM_CANDIDATE'}],retrieval:{vector_mode:'graph_witnesses'}};
  assert.deepEqual(mergeRetrievalResults([{result:entry}]),[]);
  assert.deepEqual(mergeRetrievalResults([{result:{results:[proof]}}]),[]);
});

test("context engine returns the same bounded evidence used by consumers and actual safe events", async () => {
  const events = [];
  const result = await retrieve(fixtures(), { max_context_tokens: 1500 }, { onProgress: (event) => events.push(event) });
  assert.equal(result.packet.contract_type, "ContextPacket");
  assert.equal(result.packet.authorization.source_acl_enforced, true);
  assert.deepEqual(result.hits.map((item) => item.citation.id), result.packet.evidence.map((item) => item.evidence_id));
  assert.ok(events.some((event) => event.stage === "HYBRID_SEARCH" && event.status === "COMPLETE"));
  assert.ok(!events.some((event) => event.stage === "GENERATION" || event.stage === "RERANKING"));
  assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
  assert.ok(!JSON.stringify(events).includes("checkout"));
});

test("zero-hit search expands before concluding insufficient evidence", async () => {
  let searches = 0;
  let plans = 0;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: ++searches === 1 ? [] : [hit("2")] } }], errors: [] }),
    planQueries: async () => { plans++; return { search_queries: ["release approval"] }; }
  }), {}, { integration: { id: "model" } });
  assert.equal(searches, 2);
  assert.equal(plans, 1);
  assert.equal(result.hits.length, 1);
});

test("sufficient evidence skips model planning and revoked fragments never enter packets", async () => {
  let planned = false;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: [hit("allowed"), hit("denied", "restricted material")] } }], errors: [] }),
    authorize: async (hits) => ({ allowed: hits.filter((item) => item.chunk_id === "allowed"), denied_ids: ["K-denied"], partial: true }),
    planQueries: async () => { planned = true; return {}; }
  }), {}, { integration: { id: "model" } });
  assert.equal(planned, false);
  assert.equal(result.packet.limitations.authorization_partial, true);
  assert.ok(!JSON.stringify(result.packet).includes("restricted material"));
});

test("deadline returns partial context without waiting for an unresponsive search", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  let aborted = false;
  const started = Date.now();
  const pending = retrieve(fixtures({ search: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })) }), { deadline_ms: 25 });
  await advanceClock(context, 20);
  const result = await pending;
  assert.ok(Date.now() - started < 1000);
  assert.equal(aborted, true);
  assert.equal(result.packet.limitations.budget_partial, true);
  assert.equal(result.retrieval.termination_reason, "deadline_exceeded");
});

test("cancellation interrupts retrieval instead of producing a fallback answer", async () => {
  const controller = new AbortController();
  const job = retrieve(fixtures({ search: async () => { controller.abort(); return { results: [], errors: [] }; } }), {}, { signal: controller.signal });
  await assert.rejects(job, { name: "AbortError" });
});

test("candidate and tool budgets bound retrieval work before execution", async () => {
  let planned = 0;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: Array.from({ length: 50 }, (_, i) => hit(String(i))) } }], errors: [] }),
    planQueries: async () => { planned++; return { search_queries: ["release signoff"] }; }
  }), { max_candidates: 2, max_tool_calls: 1 }, { integration: { id: "model" } });
  assert.ok(result.hits.length <= 2);
  assert.equal(result.retrieval.candidate_count, 2);
  assert.equal(planned, 0);
});

test("query expansion rejects unrelated invented concepts and repeated queries", () => {
  assert.deepEqual(engine.anchoredQueries(["release approval", "external cryptocurrency forecast", "RELEASE CHECKLIST"], {
    question: "release checklist", hits: [], seen: new Set(["release checklist"])
  }), ["release approval"]);
});

test("context-only retrieval rechecks access after model planning", async () => {
  let revoked = false;
  const result = await retrieve(fixtures({
    assess: () => ({ requires_more_context: true }),
    authorize: async (hits) => ({ allowed: revoked ? [] : hits, denied_ids: revoked ? ["K-1"] : [], partial: revoked }),
    planQueries: async () => { revoked = true; return { search_queries: [] }; }
  }), {}, { integration: { id: "model" } });
  assert.equal(result.packet.evidence.length, 0);
  assert.equal(result.packet.relationships.length, 0);
  assert.equal(result.packet.limitations.authorization_partial, true);
});

test("SSE returns structured events and aborts work when the reader disconnects", async () => {
  const raw = new EventEmitter();
  const chunks = [];
  Object.assign(raw, { writableLength: 0, writeHead() {}, write(value) { chunks.push(value); }, end() { this.writableEnded = true; }, destroy() { this.destroyed = true; } });
  const reply = { raw, hijack() {}, getHeaders: () => ({}) };
  await streamKnowledge({}, reply, async ({ signal, onProgress }) => {
    onProgress({ stage: "QUERY_RECEIVED" });
    raw.emit("close");
    assert.equal(signal.aborted, true);
    return { must_not_send: true };
  });
  assert.match(chunks.join(""), /event: progress/);
  assert.doesNotMatch(chunks.join(""), /must_not_send/);
});

test("slow indexed retrieval preserves fast live evidence and reserves a final ACL check", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  let cancelled = false;
  let authorizationChecks = 0;
  const started = Date.now();
  const pending = retrieve(fixtures({
    search: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { cancelled = true; })),
    liveEvidence: async () => ({ hits: [hit("live")], counts: {} }),
    authorize: async (hits, { signal }) => {
      assert.equal(signal.aborted, false);
      authorizationChecks++;
      return { allowed: hits, denied_ids: [] };
    }
  }), { deadline_ms: 120 });
  await advanceClock(context, 80);
  const result = await pending;
  assert.ok(Date.now() - started < 400);
  assert.equal(cancelled, true);
  assert.equal(authorizationChecks, 2);
  assert.deepEqual(result.hits.map((item) => item.chunk_id), ["live"]);
  assert.ok(result.retrieval.error_codes.includes("INDEXED_SEARCH_TIMEOUT"));
  assert.equal(result.retrieval.retrieval_failed, false);
});

test("slow optional live context cannot erase fast indexed evidence", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  let cancelled = false;
  const pending = retrieve(fixtures({
    liveEvidence: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { cancelled = true; }))
  }), { deadline_ms: 120 });
  await advanceClock(context, 80);
  const result = await pending;
  assert.equal(cancelled, true);
  assert.equal(result.hits.length, 1);
  assert.ok(result.retrieval.error_codes.includes("LIVE_CONTEXT_TIMEOUT"));
});

test("sufficient evidence skips optional expansions as well as model planning", async () => {
  let expansions = 0;
  const result = await retrieve(fixtures({ expandParents: async () => { expansions++; return { results: [] }; } }));
  assert.equal(result.hits.length, 1);
  assert.equal(expansions, 0);
});

test("partial expansion failures retain available additions and report their stage errors", async () => {
  const result = await retrieve(fixtures({
    assess: (hits) => ({ requires_more_context: hits.length < 2 }),
    expandParents: async () => ({ results: [hit("adjacent")],
      retrieval: { degraded: true, error_codes: ["PARENT_EXPANSION_TIMEOUT"] } })
  }));
  assert.equal(result.hits.length, 2);
  assert.equal(result.retrieval.degraded, true);
  assert.ok(result.retrieval.error_codes.includes("PARENT_EXPANSION_TIMEOUT"));
  assert.equal(result.packet.limitations.unavailable_sources, 0);
});

test("embedding degradation reports partial retrieval without inventing unavailable sources", async () => {
  const result = await retrieve(fixtures({ search: async () => ({ results: [{ query: "release", result: {
    results: [hit("1")], retrieval: { degraded: true, error_codes: ["EMBEDDING_PROVIDER_COOLDOWN"] }
  } }], errors: [] }) }));
  assert.equal(result.packet.limitations.retrieval_status, "PARTIAL");
  assert.equal(result.packet.limitations.unavailable_sources, 0);
  assert.deepEqual(result.retrieval.error_codes, ["EMBEDDING_PROVIDER_COOLDOWN"]);
  assert.equal(result.hits.length, 1);
});

test("planner timeout returns existing evidence after fresh authorization", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  let planned = false;
  const pending = retrieve(fixtures({
    assess: () => ({ requires_more_context: true }),
    planQueries: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { planned = true; }))
  }), { deadline_ms: 120 }, { integration: { id: "model" } });
  await advanceClock(context, 100);
  const result = await pending;
  assert.equal(planned, true);
  assert.equal(result.hits.length, 1);
  assert.ok(result.retrieval.error_codes.includes("RETRIEVAL_PLANNING_TIMEOUT"));
});

test("revocation during enrichment removes both live evidence and its aggregate metadata", async () => {
  let checks = 0;
  const liveHit = { ...hit("live-run"), source_id: "live-project-project-1-runs" };
  const result = await retrieve(fixtures({
    liveEvidence: async () => ({ hits: [liveHit], counts: { runs: 999, bugs: 888 } }),
    authorize: async (hits) => {
      checks++;
      return { allowed: checks === 1 ? hits : [], denied_ids: checks === 1 ? [] : hits.map(identity => identity.chunk_id), partial: checks > 1 };
    }
  }));
  assert.deepEqual(result.hits, []);
  assert.equal(result.retrieval.live_context_count, 0);
  assert.deepEqual(result.retrieval.live_context_counts, {});
  assert.equal(result.packet.limitations.authorization_partial, true);
});

test("explicit file scope stays knowledge-only even when the LLM suggests live Story evidence", async () => {
  const orchestrator = require("@hellotest/ai/backend/services/aiContextOrchestrator.service");
  let selectedScopes;
  const request = contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist", filters: { source_kinds: ["file"] } });
  const result = await execution.run({}, () => engine.retrieve({ request, user: { id: "user-1" },
    intentPlan: { source_kinds: ["requirement", "test_case"], queries: ["release tests"] },
    dependencies: fixtures({
      planContext: input => { selectedScopes = input.requestedScopes; return orchestrator.planContext(input); },
      search: async input => { assert.deepEqual(input.filters.source_kinds, ["file"]); return { results: [], errors: [] }; },
      liveEvidence: async input => { assert.deepEqual(input.contextRoute.live_scopes, []); return { hits: [], counts: {} }; }
    })
  }));
  assert.deepEqual(selectedScopes, ["knowledge"]); assert.deepEqual(result.route.live_scopes, []);
});

test('pinned Smart Context sources remain exact while an explicitly scoped Story supplies its native metadata', async () => {
  let liveInput, searchedFilters;
  const request = contracts.buildRetrievalRequest({ projectId: 'project-1', query: 'Review checkout acceptance', filters: {
    requested_scopes: ['stories','knowledge'], agent_id: 'story-assurance', evidence_scope: {story_id:'story-1'}, source_ids:['chosen-source'], source_kinds:['text']
  } });
  await execution.run({}, () => engine.retrieve({ request,user:{id:'user-1'},dependencies:fixtures({
    search:async input=>{searchedFilters=input.filters;return {results:[],errors:[]};},
    liveEvidence:async input=>{liveInput=input;return {hits:[],counts:{}};}
  }) }));
  assert.deepEqual(searchedFilters.source_ids,['chosen-source']);assert.deepEqual(searchedFilters.source_kinds,['text']);
  assert.deepEqual(liveInput.evidenceScope,{story_id:'story-1'});assert.deepEqual(liveInput.sourceKinds,['requirement']);
  assert.deepEqual(liveInput.route.live_scopes,['stories']);
});

test('an explicitly empty agent context selection performs no indexed or live retrieval', async () => {
  const request=contracts.buildRetrievalRequest({projectId:'project-1',query:'Review supplied input',filters:{requested_scopes:[]}});
  const result=await execution.run({},()=>engine.retrieve({request,user:{id:'user-1'},dependencies:fixtures({search:async()=>assert.fail('No indexed retrieval'),liveEvidence:async()=>assert.fail('No live retrieval')})}));
  assert.deepEqual(result.packet.evidence,[]);
});

test('Smart Context source kinds cannot widen an agent’s explicit domain scopes',async()=>{
 const request=contracts.buildRetrievalRequest({projectId:'project-1',query:'Review supplied Story evidence',filters:{requested_scopes:['stories'],source_ids:['defect-source'],source_kinds:['bug']}});
 const result=await execution.run({},()=>engine.retrieve({request,user:{id:'user-1'},dependencies:fixtures({search:async()=>assert.fail('Conflicting source kinds must not be searched'),liveEvidence:async()=>assert.fail('Pinned sources without native entity scope must not be widened')})}));
 assert.deepEqual(result.packet.evidence,[]);
});

test('tight candidate budgets retain selected live evidence alongside indexed Knowledge passages', async () => {
  let indexedBudget;
  const request = contracts.buildRetrievalRequest({ projectId: 'project-1', query: 'Why did the checkout run fail?',
    filters: { requested_scopes: ['runs', 'knowledge'], evidence_scope: { execution_id: 'run-selected' } },
    budgets: { max_candidates: 2 } });
  const live = { ...hit('selected-run'), source_kind: 'live_project', source_id: 'live-project-project-1-runs', content: 'The selected checkout run failed on the payment assertion.' };
  const result = await execution.run({}, () => engine.retrieve({ request, user: { id: 'user-1' }, dependencies: fixtures({
    planContext: () => ({ indexed_source_kinds: ['text'], live_scopes: ['runs'] }),
    search: async input => {
      indexedBudget = input.maxCandidates;
      // Even an over-producing search adapter cannot evict pinned live facts.
      return { results: [{ query: input.queries[0], result: { results: [hit('kb-1'), hit('kb-2')], retrieval: { candidate_count: 2 } } }], errors: [] };
    },
    liveEvidence: async () => ({ hits: [live], counts: { runs: 1 } })
  }) }));
  assert.equal(indexedBudget, 1);
  assert.deepEqual(result.hits.map(item => item.chunk_id), ['kb-1', 'selected-run']);
  assert.equal(result.retrieval.candidate_count, 2);
  assert.equal(result.retrieval.live_context_count, 1);
});

test('a single candidate slot prioritizes explicitly selected native evidence without an unbounded zero-budget KB search', async () => {
  const request = contracts.buildRetrievalRequest({ projectId: 'project-1', query: 'Inspect the selected Story',
    filters: { requested_scopes: ['stories', 'knowledge'], evidence_scope: { story_id: 'story-selected' } }, budgets: { max_candidates: 1 } });
  const result = await execution.run({}, () => engine.retrieve({ request, user: { id: 'user-1' }, dependencies: fixtures({
    search: async () => assert.fail('A zero-candidate search must never run'),
    liveEvidence: async () => ({ hits: [hit('story-selected')], counts: {} })
  }) }));
  assert.deepEqual(result.hits.map(item => item.chunk_id), ['story-selected']);
  assert.equal(result.retrieval.candidate_count, 1);
});

test('a missing selected live fact releases its single candidate slot for permitted Knowledge fallback', async () => {
  const request = contracts.buildRetrievalRequest({ projectId: 'project-1', query: 'Inspect the selected Story',
    filters: { requested_scopes: ['stories', 'knowledge'], evidence_scope: { story_id: 'story-selected' } }, budgets: { max_candidates: 1 } });
  let searches = 0;
  const result = await execution.run({}, () => engine.retrieve({ request, user: { id: 'user-1' }, dependencies: fixtures({
    search: async input => { searches++; assert.equal(input.maxCandidates, 1); return { results: [{ query: input.queries[0], result: { results: [hit('supporting-passage')] } }], errors: [] }; },
    liveEvidence: async () => ({ hits: [], counts: {} })
  }) }));
  assert.equal(searches, 1);
  assert.deepEqual(result.hits.map(item => item.chunk_id), ['supporting-passage']);
  assert.equal(result.retrieval.candidate_count, 1);
});

test('selected evidence scope survives every search round and prevents relationship expansion outside it', async () => {
  const calls = [];
  let expansions = 0;
  const evidenceScope = { story_id: 'story-selected', sprint_id: 'sprint-selected' };
  const dependencies = fixtures({
    search: async args => { calls.push(args.filters); return { results: [{ query: 'release', result: { results: [hit('scope-proof')] } }], errors: [] }; },
    assess: () => ({ requires_more_context: true }),
    expandRelationships: async () => { expansions++; return { results: [hit('outside-scope')] }; }
  });
  await execution.run({}, () => engine.retrieve({ request: contracts.buildRetrievalRequest({ projectId: 'project-1', query: 'Investigate release risk', queryClass: 'INVESTIGATIVE', filters: { requested_scopes: ['knowledge'], evidence_scope: evidenceScope }, budgets: { max_rounds: 1 } }), user: { id: 'user-1' }, dependencies }));
  assert.equal(expansions, 0); assert.equal(calls.length, 1); assert.deepEqual(calls[0].evidence_scope, evidenceScope);
});
