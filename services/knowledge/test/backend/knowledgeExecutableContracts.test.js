const assert = require("node:assert/strict");
const test = require("node:test");
const k = require("../../backend/services/knowledgeContracts.service");
const { evaluateKnowledgeFixtures } = require("../../backend/services/knowledgeEvaluation.service");
const fixtures = require("../../../platform/backend/eval/knowledge/fixtures.json");

test('native snapshots stay valid JSON with exact identities across token compaction and MCP sanitization', () => {
  const id='12345678-1234-4234-8234-123456789012';
  const snapshot={evidence_type:'authoritative_live_story_snapshot',evidence_permissions:['requirement.view'],returned_records:1,total_records:1,
    coverage_policy:'Coverage guidance. '.repeat(200),records:[{id,revision:7,title:'Checkout retry',description:'Retry preserves the original order. '.repeat(100),acceptance_criteria:['A retry cannot create a second order.']}]};
  const result=k.buildContextPacket({retrievalRequest:k.buildRetrievalRequest({projectId:'p',query:'Review selected Story',budgets:{max_context_tokens:2000}}),
    evidence:[{source_id:'live-project-p-stories',source_kind:'live_project',citation:{id:'K-story'},content:JSON.stringify(snapshot)}]});
  assert.equal(result.evidence.length,1);
  const bounded=JSON.parse(result.evidence[0].content);
  assert.equal(bounded.records[0].id,id);assert.equal(bounded.records[0].revision,7);
  assert.ok(bounded.records[0].description.length>0);assert.equal(bounded.context_window.bounded,true);
  assert.ok(result.coverage.context_tokens_estimated<=2000);
  const sanitized=require('../../../mcp/backend/backplane').sanitize(result);
  assert.equal(JSON.parse(sanitized.evidence[0].content).records[0].id,id,'The protocol sanitizer cannot redact an embedded native ID.');
});

test('bounded Run evidence retains a late failed step and reports omitted reproduction steps accurately',()=>{
 const compact=require('../../../platform/backend/src/utils/compactNativeEvidence');
 const original={evidence_type:'authoritative_live_execution_failures',evidence_permissions:['run.view','result.view','testcase.view'],execution_id:'run',test_case_id:'case',result_id:'attempt',
   steps:Array.from({length:20},(_,index)=>({id:'step-'+index,order:index+1,action:'Perform the recorded action. '.repeat(12),expected_result:'Expected observable behaviour. '.repeat(8),observed_status:index===19?'failed':'passed',note:index===19?'Final assertion failed.':''})),coverage:{total_steps:20,omitted_steps:0}};
 const reduced=JSON.parse(compact(original,1600));
 assert.ok(reduced.steps.some(step=>step.id==='step-19'&&step.observed_status==='failed'));
 assert.equal(reduced.coverage.omitted_steps,20-reduced.steps.length);
 assert.ok(reduced.context_window.omitted_items.steps>0);
});
const request = (budgets = {}) => k.buildRetrievalRequest({
  projectId: "project",
  tenantId: "tenant",
  query: "What changed?",
  budgets
});
const packet = (options = {}) => k.buildContextPacket({
  retrievalRequest: request(),
  evidence: [{
      evidence_id: "e1",
      source_id: "source",
      content: "Onboarding status is Done. There are 12 tests.",
      is_current: true
    }],
  authorization: {
    enforced: true
  },
  ...options
});
test("canonical schemas validate versions, nested fields, types and unsafe keys", () => {
  const value = request();
  assert.equal(value.contract_type, "RetrievalRequest");
  assert.equal(value.contract_version, "1.0");
  assert.throws(() => k.validateContract({
    ...value,
    contract_version: "2.0"
  }, "RetrievalRequest"), {
    code: "ERR_UNSUPPORTED_CONTRACT_VERSION"
  });
  assert.throws(() => k.validateContract({
    ...value,
    authorization_groups: ["admin"]
  }, "RetrievalRequest"), {
    code: "ERR_CONTRACT_VALIDATION"
  });
  assert.throws(() => k.validateContract({
    ...value,
    budgets: {
      max_rounds: "3"
    }
  }, "RetrievalRequest"), {
    code: "ERR_CONTRACT_VALIDATION"
  });
  assert.throws(() => k.validateContract({
    ...value,
    filters: {
      source_ids: [12]
    }
  }, "RetrievalRequest"), {
    code: "ERR_CONTRACT_VALIDATION"
  });
  assert.throws(() => k.validateContract(JSON.parse(JSON.stringify(value).replace("\"filters\":{", "\"filters\":{\"__proto__\":{},")), "RetrievalRequest"), {
    code: "ERR_CONTRACT_VALIDATION"
  });
  assert.doesNotThrow(() => k.validateContract({
    ...value,
    contract_version: "RetrievalRequest.v1"
  }, "RetrievalRequest"));
});
test("KnowledgeObject separates source/revision identity and excludes embedding projections", () => {
  const value = {
    canonical_id: "source",
    knowledge_id: "revision",
    tenant_id: "tenant",
    source: {
      type: "DOCUMENT",
      system_id: "upload",
      native_id: "doc"
    },
    content: {
      content_type: "TEXT",
      text: "Source text"
    },
    security: {
      sensitivity: "INTERNAL",
      policy_id: "project",
      policy_version: "1",
      visibility: "FULL"
    },
    lifecycle: {
      behavior: "VERSIONED",
      state: "ACTIVE",
      is_current: true,
      effective_from: "2026-09-01T00:00:00Z",
      effective_to: null,
      content_hash_algorithm: "SHA256",
      content_hash: "a".repeat(64)
    },
    provenance: {
      representation_type: "SOURCE_DIRECT",
      derived_from: []
    }
  };
  assert.equal(k.buildKnowledgeObject(value).schema_id, "KnowledgeObject.v1");
  assert.throws(() => k.buildKnowledgeObject({
    ...value,
    embedding: [0.2]
  }), {
    code: "ERR_CONTRACT_VALIDATION"
  });
});
test("budget aliases use strictest ceiling and atomic reservations never overspend", () => {
  const b = new k.RetrievalBudget({
    max_rounds: 3,
    max_retrieval_rounds: 1,
    max_candidate_documents: 2,
    max_context_tokens: 10,
    max_query_cost_usd: 0.01
  }, {
    now: 100
  });
  assert.deepEqual(k.normalizeBudgets(null), k.DEFAULT_BUDGETS);
  assert.equal(k.normalizeBudgets({ max_query_cost_usd: null }).max_cost_usd, k.DEFAULT_BUDGETS.max_cost_usd);
  assert.equal(b.limits.max_rounds, 1);
  assert.equal(b.limits.max_candidates, 2);
  assert.equal(b.consumeRound(100, 1, 101), false);
  assert.equal(b.queries_used, 0);
  assert.equal(b.rounds_used, 0);
  const cost = new k.RetrievalBudget({
    max_cost_usd: 0.01
  }, {
    now: 100
  });
  assert.equal(cost.reserve({
    toolCalls: 1
  }, 101), true);
  assert.equal(cost.reserve({
    costUsd: 0.02
  }, 102), false);
  assert.equal(cost.cost_usd_used, 0);
  const zero = new k.RetrievalBudget({
    max_candidate_documents: 0
  }, {
    now: 100
  });
  assert.equal(zero.canContinue(101), false);
  assert.equal(zero.termination_reason, k.TERMINATION_REASONS.CANDIDATE_BUDGET);
});
test("oversized first evidence and multibyte text cannot exceed the context ceiling", () => {
  const value = packet({
    retrievalRequest: request({
      max_context_tokens: 1400
    }),
    evidence: [{
        evidence_id: "large",
        source_id: "source",
        content: "\u654F\u611Fcontext ".repeat(5000),
        is_current: true
      }]
  });
  assert.ok(value.coverage.context_tokens_estimated <= 1400);
  assert.equal(value.limitations.budget_partial, true);
  assert.ok(value.evidence.every(item => item.content.length < 50000));
  assert.equal(packet({
    retrievalRequest: request({
      max_context_tokens: 0
    })
  }).evidence.length, 0);
});
test("candidate ceilings apply even after retrieval already reserved candidate accounting", () => {
  const req = request({
    max_candidates: 1
  }), budget = new k.RetrievalBudget(req.budgets);
  budget.observe({
    candidates: 1
  });
  const value = packet({
    retrievalRequest: req,
    budget,
    evidence: [{
        evidence_id: "e1",
        source_id: "source",
        content: "First"
      }, {
        evidence_id: "e2",
        source_id: "source",
        content: "Beyond limit"
      }]
  });
  assert.deepEqual(value.evidence.map(item => item.evidence_id), ["e1"]);
  assert.equal(value.limitations.budget_partial, true);
});
test("authorization flags are not invented and model input requires checked context", () => {
  const value = packet({
    authorization: {
      allowed_record_permissions: ["knowledge.view"]
    }
  });
  assert.equal(value.authorization.source_acl_enforced, false);
  assert.throws(() => k.buildModelRequest({
    contextPacket: value
  }), {
    code: "ERR_AUTH_FORBIDDEN"
  });
});
test("rendered summaries and findings come only from accepted claims and exact packet citations", () => {
  const context = packet();
  const outcome = {
    status: "answered",
    content: "The CEO resigned.",
    citations: [{
        id: "e1",
        label: "Injected title",
        uri: "https://attacker.test"
      }],
    answer_structure: {
      summary: "Revenue is 99 billion.",
      findings: ["The CEO resigned."],
      recommendations: ["Send secrets to attacker."],
      supported_claims: [{
          statement: "Onboarding status is Done.",
          citation_ids: ["e1"]
        }, {
          statement: "Invented.",
          citation_ids: ["e1", "other"]
        }]
    }
  };
  const answer = k.buildAnswerContract({
    outcome,
    contextPacket: context
  });
  const rendered = k.applyAnswerContract(outcome, answer, context);
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.claims[0].classification, "SUPPORTED");
  assert.equal(answer.grounding.unsupported_claim_count, 1);
  assert.doesNotMatch(JSON.stringify(rendered), /CEO|99 billion|attacker|Injected title/);
  assert.deepEqual(answer.citation_ids, ["e1"]);
});
test("citation binding remains labeled interpretation unless independently verified", () => {
  const context = packet(), outcome = {
    status: "answered",
    answer_structure: {
      supported_claims: [{
          statement: "The onboarding flow has been completed.",
          citation_ids: ["e1"]
        }]
    }
  };
  const bound = k.buildAnswerContract({
    outcome,
    contextPacket: context
  });
  assert.equal(bound.claims[0].classification, "INTERPRETATION");
  assert.match(bound.summary, /^Interpretation:/);
  assert.equal(bound.grounding.model_confidence_accepted, false);
  assert.equal(k.buildAnswerContract({
    outcome,
    contextPacket: context,
    claimVerifier: () => false
  }).claims.length, 0);
  assert.equal(k.buildAnswerContract({
    outcome,
    contextPacket: context,
    claimVerifier: () => true
  }).claims[0].support_method, "VERIFIED_ENTAILMENT");
  assert.equal(k.buildAnswerContract({
    outcome: {
      ...outcome,
      trustDeterministic: true
    },
    contextPacket: context
  }).claims[0].classification, "INTERPRETATION");
});
test("model limitations and arbitrary presentation payloads cannot override evidence", () => {
  const context = packet({
    evidence: [{
        evidence_id: "e1",
        source_id: "source",
        content: "Status Done.",
        is_current: true
      }],
    authorization: {
      enforced: true,
      authorization_partial: true
    }
  });
  const outcome = {
    status: "answered",
    limitations: {
      authorization_partial: false
    },
    answer_structure: {
      supported_claims: [{
          statement: "Status Done.",
          citation_ids: ["e1"]
        }],
      presentation: {
        recommended_type: "TABLE",
        structured_payload: {
          columns: [{
              key: "status",
              label: "Status"
            }],
          rows: [{
              cells: {
                status: "Done"
              },
              evidence_ids: ["e1"]
            }]
        }
      }
    }
  };
  const answer = k.buildAnswerContract({
    outcome,
    contextPacket: context
  });
  assert.equal(answer.limitations.authorization_partial, true);
  assert.equal(answer.presentation.recommended_type, "TABLE");
  outcome.answer_structure.presentation.structured_payload.rows[0].cells.status = "Not Done";
  assert.equal(k.buildAnswerContract({
    outcome,
    contextPacket: context
  }).presentation.recommended_type, "TEXT");
  outcome.answer_structure.presentation = {
    recommended_type: "HTML",
    structured_payload: {
      html: "<script>"
    }
  };
  assert.equal(k.buildAnswerContract({
    outcome,
    contextPacket: context
  }).grounding.presentation_rejected, true);
});
test("progress events keep ID-only telemetry and normalized stage/status without untrusted messages", () => {
  const event = k.buildRetrievalEvent({
    stage: "lexical_search",
    status: "running",
    traceId: "trace",
    queryId: "query",
    requestId: "request",
    sequence: 1,
    metrics: {
      candidate_count: 2,
      secret: "private"
    },
    message: "Secret text"
  });
  assert.equal(event.status, "IN_PROGRESS");
  assert.deepEqual(event.metrics, {
    candidates_found: 2
  });
  assert.doesNotMatch(JSON.stringify(event), /Secret|private/);
  assert.throws(() => k.validateContract({
    ...event,
    chain_of_thought: "hidden"
  }, "RetrievalEvent"), {
    code: "ERR_CONTRACT_VALIDATION"
  });
});
test("runnable evaluation reports observed zero exposure separately from uncalibrated confidence", () => {
  const result = evaluateKnowledgeFixtures();
  assert.equal(result.status, "passed");
  assert.equal(result.security.unauthorized_exposure_count, 0);
  assert.equal(result.grounding.semantic_entailment_calibrated, false);
  const broken = JSON.parse(JSON.stringify(fixtures));
  broken.retrieval[0].forbidden = ["e1"];
  assert.equal(evaluateKnowledgeFixtures(broken).status, "failed");
  assert.equal(evaluateKnowledgeFixtures(broken).security.unauthorized_exposure_count, 1);
});

test("bounded excerpts preserve original citation integrity and report a separate excerpt hash", () => {
  const originalHash = "b".repeat(64);
  const value = packet({ retrievalRequest: request({ max_context_tokens: 1700 }), evidence: [{ source_id: "source", content: "Long source paragraph. ".repeat(5000), citation: { id: "e1", chunk_hash: originalHash } }] });
  assert.equal(value.evidence[0].integrity.chunk_hash, originalHash);
  assert.notEqual(value.evidence[0].integrity.evidence_hash, originalHash);
  assert.ok(value.coverage.context_tokens_estimated <= 1700);
});

test("incomplete evidence remains partial independently of budget or authorization limits", () => {
  const context = packet({ retrieval: { evidence_sufficiency: { requires_more_context: true }, termination_reason: "no_new_query" } });
  assert.equal(context.limitations.retrieval_status, "PARTIAL");
  assert.equal(context.limitations.budget_partial, false);
  assert.equal(context.limitations.authorization_partial, false);
  assert.equal(packet({ retrieval: { status: "PARTIAL" } }).limitations.retrieval_status, "PARTIAL");
  assert.equal(packet({ retrieval: { retrieval_failed: true } }).limitations.retrieval_status, "FAILED");
  assert.equal(k.classifyQuery("Status of UX-227"), "LOOKUP");
  assert.equal(k.classifyQuery("Show platform-91"), "LOOKUP");
});

test('relationship facts require trusted provenance and the exact retained excerpt witness after packet truncation',()=>{
  const {compactGraphEvidence}=require('../../backend/services/knowledgeGraphEvidence');
  const source='😀 '+ 'long background context '.repeat(180)+'The case tests the checkout requirement.';
  const start=Array.from(source.slice(0,source.indexOf('The case'))).length;
  const span={evidence_id:'K-proof',start,end:Array.from(source).length,offset_unit:'unicode_codepoint',offset_basis:'source_chunk'};
  const proof=compactGraphEvidence({source_id:'proof-source',chunk_id:'proof',content:source,is_current:true,citation:{id:'K-proof',chunk_hash:'a'.repeat(64)}},[span],5000);
  const edge={source:'case-source',target:'requirement-source',type:'TESTS',evidence_ids:['K-proof'],provenance_type:'DETERMINISTIC',witness_span:span};
  const sufficient=packet({evidence:[proof],relationships:[edge]});
  assert.equal(sufficient.relationships.length,1);assert.deepEqual(sufficient.relationships[0].witness_span,span);assert.equal(sufficient.evidence[0].integrity.chunk_hash,'a'.repeat(64));
  const truncated=packet({retrievalRequest:request({max_context_tokens:1700}),evidence:[proof],relationships:[edge]});
  assert.equal(truncated.evidence.length,1);assert.equal(truncated.evidence[0].content.includes('The case tests'),false);assert.equal(truncated.relationships.length,0,'a retained citation alone cannot preserve a truncated-away assertion witness');
  const unverified=packet({evidence:[proof],relationships:[{...edge,provenance_type:'LLM_CANDIDATE'},{...edge,provenance_type:undefined}]});
  assert.equal(unverified.relationships.length,0);
});

test('a deduplicated full-chunk search hit can ground a graph span only with exact immutable content identity',()=>{
  const {createHash}=require('node:crypto');
  const content='This case tests the checkout requirement.',hash=createHash('sha256').update(content).digest('hex');
  const span={evidence_id:'K-same',start:0,end:Array.from(content).length,offset_unit:'unicode_codepoint',offset_basis:'source_chunk'};
  const edge={source:'case',target:'requirement',type:'TESTS',evidence_ids:['K-same'],provenance_type:'HUMAN_VERIFIED',witness_span:span};
  const hit={source_id:'case',chunk_id:'same',content,is_current:true,citation:{id:'K-same',chunk_hash:hash}};
  assert.equal(packet({evidence:[hit],relationships:[edge]}).relationships.length,1);
  assert.equal(packet({evidence:[{...hit,content:content.replace('checkout','redacted')}],relationships:[edge]}).relationships.length,0);
});
