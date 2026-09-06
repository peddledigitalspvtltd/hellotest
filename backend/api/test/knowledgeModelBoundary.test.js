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
