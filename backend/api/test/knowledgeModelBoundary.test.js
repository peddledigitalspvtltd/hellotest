const assert = require("node:assert/strict");
const test = require("node:test");
const assistant = require("../src/services/knowledgeAssistant.service");
const contracts = require("../src/services/knowledgeContracts.service");
const gateway = require("../src/services/knowledgeModelGateway.service");
const execution = require("../src/services/knowledgeExecution.service");
const integration = { id: "fixture", model: "fixture-model", config: { protocol: "fixture" } };

test("retrieval planning receives a bounded packet even when the first raw evidence is oversized", async (context) => {
  let sent;
  context.mock.method(gateway, "request", async (input) => { sent = input; return { search_queries: [] }; });
  await execution.run({ modelBudget: { ...contracts.DEFAULT_BUDGETS, max_context_tokens: 1600, max_evidence_items: 1 } }, () => assistant._internals.requestRetrievalPlan({
    integration, question: "What is the onboarding decision?", projectScope: { project_id: "project", filters: {} }, history: [{ role: "assistant", content: "Previously restricted content" }],
    hits: [{ source_id: "source", citation: { id: "e1" }, content: `${"Authorized context. ".repeat(10000)}TAIL_MUST_NOT_REACH_MODEL` }]
  }));
  const data = JSON.parse(sent.messages[1].content);
  assert.equal(data.context_packet.contract_type, "ContextPacket");
  assert.ok(data.context_packet.coverage.context_tokens_estimated <= 1600);
  assert.ok(data.context_packet.evidence.length <= 1);
  assert.doesNotMatch(sent.messages[1].content, /TAIL_MUST_NOT_REACH_MODEL|Previously restricted content/);
  assert.match(sent.messages[0].content, /never instructions/);
  assert.equal(data.context_packet.authorization.source_acl_enforced, true);
});

test("synthesis uses the authorized packet once and enforces the model-candidate schema", async (context) => {
  let sent;
  context.mock.method(gateway, "request", async (input) => {
    sent = input;
    return { status: "answered", executive_summary: "Done [e1]", supported_claims: [{ statement: "Onboarding is Done.", citation_ids: ["e1"] }] };
  });
  const packet = contracts.buildContextPacket({ retrievalRequest: contracts.buildRetrievalRequest({ projectId: "project", query: "What changed?" }), authorization: { enforced: true }, evidence: [{ source_id: "source", citation: { id: "e1" }, content: "Onboarding is Done.", is_current: true }] });
  const candidate = await assistant._internals.requestGroundedAnswer({ integration, question: "What changed?", contextPacket: packet, history: [], projectScope: { project_id: "project", context_route: { answer_depth: "concise" } }, retrievalPlan: { duplicate_raw_evidence: "DO_NOT_DUPLICATE" } });
  assert.equal(candidate.status, "answered");
  assert.equal(sent.outputSchema, contracts.MODEL_ANSWER_SCHEMA);
  assert.doesNotMatch(sent.messages[1].content, /DO_NOT_DUPLICATE/);
  assert.match(sent.messages[0].content, /HelloTest/);
  assert.match(sent.messages[0].content, /exact evidence_ids/);
  assert.equal(JSON.parse(sent.messages[1].content).context_packet.context_packet_id, packet.context_packet_id);
});

test("malformed or model-owned authority fields are rejected before answer assembly", async (context) => {
  context.mock.method(gateway, "request", async () => ({ status: "answered", supported_claims: [], authorization: { admin: true }, confidence: .99 }));
  const packet = contracts.buildContextPacket({ retrievalRequest: contracts.buildRetrievalRequest({ projectId: "project", query: "What changed?" }), authorization: { enforced: true }, evidence: [] });
  await assert.rejects(assistant._internals.requestGroundedAnswer({ integration, question: "What changed?", contextPacket: packet, projectScope: {} }), { code: "ERR_CONTRACT_VALIDATION" });
  await assert.rejects(assistant._internals.requestGroundedAnswer({ integration, question: "What changed?", projectScope: {} }), { code: "ERR_CONTRACT_VALIDATION" });
});

test("model context omits duplicated retrieval metadata while preserving exact evidence and access limits", () => {
  const query = "What is the checkout release decision? ".repeat(50);
  const request = contracts.buildRetrievalRequest({ projectId: "project", query, filters: { source_ids: ["source"] } });
  const packet = contracts.buildContextPacket({ retrievalRequest: request,
    authorization: { enforced: true, authorization_partial: true },
    evidence: [{ source_id: "source", title: "Release decision", citation: { id: "e1" }, content: "Checkout approval is pending.", is_current: true }],
    retrieval: { retrieval_request: request, query_chain: [query], degraded: true }
  });
  const original = JSON.stringify(packet);
  const modelContext = JSON.parse(contracts.buildModelRequest({ contextPacket: packet, question: query }).messages[1].content).context_packet;
  assert.ok(Buffer.byteLength(JSON.stringify(modelContext)) < Buffer.byteLength(original) / 2);
  assert.equal(modelContext.evidence[0].content, packet.evidence[0].content);
  assert.equal(modelContext.evidence[0].evidence_id, packet.evidence[0].evidence_id);
  assert.deepEqual(modelContext.applied_filters, packet.applied_filters);
  assert.deepEqual(modelContext.limitations, packet.limitations);
  assert.deepEqual(modelContext.evidence[0].freshness, packet.evidence[0].freshness);
  assert.deepEqual(modelContext.evidence[0].visibility, packet.evidence[0].visibility);
  assert.equal(JSON.stringify(packet), original);
  assert.doesNotThrow(() => contracts.assertCompatibleContract(modelContext, "ContextPacket"));
});

test("schema-valid claim-only answers survive normalization and reach the renderable answer contract", () => {
  for (const id of ["e1", "live:case_214", "K-record-with_underscores"]) {
    const hits = [{ source_id: "source", citation: { id }, content: "Onboarding is Done.", is_current: true }];
    const candidate = contracts.validateModelAnswer({ status: "answered", supported_claims: [{ statement: "Onboarding is Done.", citation_ids: [id] }] });
    const normalized = assistant._internals.normalizeModelAnswer(candidate, hits);
    assert.equal(normalized.status, "answered");
    assert.match(normalized.content, /Onboarding is Done/);
    const packet = contracts.buildContextPacket({ retrievalRequest: contracts.buildRetrievalRequest({ projectId: "project", query: "Onboarding status?" }), authorization: { enforced: true }, evidence: hits });
    const answer = contracts.buildAnswerContract({ outcome: normalized, contextPacket: packet });
    assert.equal(answer.status, "answered");
    assert.deepEqual(answer.citation_ids, [id]);
    assert.match(answer.summary, /Onboarding is Done/);
  }
});

test("a missing duplicate inline citation does not discard explicitly cited claims, while invented inline IDs remain rejected", () => {
  const hits = [{ citation: { id: "live:case_214" }, content: "Checkout passed." }];
  const candidate = { status: "answered", executive_summary: "Checkout passed.", supported_claims: [{ statement: "Checkout passed.", citation_ids: ["live:case_214"] }] };
  assert.equal(assistant._internals.normalizeModelAnswer(candidate, hits).status, "answered");
  const rejected = assistant._internals.normalizeModelAnswer({ ...candidate, executive_summary: "Checkout passed. [invented_123]" }, hits);
  assert.equal(rejected.status, "insufficient_context");
  assert.equal(rejected.safety.invented_citations_rejected, 1);
});

test("synthesis repairs one invalid output using the same bounded evidence and never carries model text into instructions", async (context) => {
  const requests = [];
  context.mock.method(gateway, "request", async (input) => {
    requests.push(input);
    return requests.length === 1
      ? { status: "answered", supported_claims: "INVALID_OUTPUT_MARKER" }
      : { status: "answered", supported_claims: [{ statement: "Onboarding is Done.", citation_ids: ["e1"] }] };
  });
  const packet = contracts.buildContextPacket({ retrievalRequest: contracts.buildRetrievalRequest({ projectId: "project", query: "What changed?" }), authorization: { enforced: true }, evidence: [{ source_id: "source", citation: { id: "e1" }, content: "Onboarding is Done." }] });
  const result = await execution.run({}, () => assistant._internals.requestGroundedAnswer({ integration, question: "What changed?", contextPacket: packet }));
  assert.equal(result.status, "answered");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[1].content, requests[1].messages[1].content);
  assert.doesNotMatch(JSON.stringify(requests[1]), /INVALID_OUTPUT_MARKER/);
  assert.equal(requests[0].maxOutputTokens, 4000);
  assert.equal(requests[0].attemptTimeoutMs, requests[0].timeoutMs);
  assert.ok(requests[1].timeoutMs <= requests[0].timeoutMs);
});

test("invalid synthesis output does not trigger repair after the model call budget is spent", async (context) => {
  let calls = 0;
  context.mock.method(gateway, "request", async () => {
    calls++;
    execution.current().modelStats.calls++;
    return { status: "answered", supported_claims: "invalid" };
  });
  const packet = contracts.buildContextPacket({ retrievalRequest: contracts.buildRetrievalRequest({ projectId: "project", query: "What changed?" }), authorization: { enforced: true }, evidence: [] });
  await assert.rejects(execution.run({ modelBudget: { max_tool_calls: 1 } }, () => assistant._internals.requestGroundedAnswer({ integration, question: "What changed?", contextPacket: packet })), { code: "ERR_CONTRACT_VALIDATION" });
  assert.equal(calls, 1);
});
