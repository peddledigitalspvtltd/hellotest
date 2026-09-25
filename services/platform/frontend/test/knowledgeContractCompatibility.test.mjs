import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { consumeKnowledgeAssistantStream } from "../../../chatbot/frontend/lib/knowledgeAssistantStream.ts";
import { validateKnowledgeAnswer } from "../../../chatbot/frontend/lib/knowledgeAnswer.ts";

const require = createRequire(import.meta.url);
const contracts = require("../../../knowledge/backend/services/knowledgeContracts.service.js");

test("shipped server contracts survive the streaming client and evidence renderer boundary", async () => {
  const request = contracts.buildRetrievalRequest({ projectId: "project-1", query: "What is the onboarding status?" });
  const packet = contracts.buildContextPacket({ retrievalRequest: request, evidence: [{ evidence_id: "e1", source_id: "source-1", source_kind: "text", content: "Onboarding status is Done.", is_current: true }], authorization: { enforced: true } });
  const outcome = { status: "answered", answer_structure: { supported_claims: [{ statement: "Onboarding status is Done.", citation_ids: ["e1"] }] } };
  const contract = contracts.buildAnswerContract({ outcome, contextPacket: packet });
  const rendered = contracts.applyAnswerContract(outcome, contract, packet);
  const result = { assistant_message: { ...rendered, id: "message-1", role: "assistant", context_packet: packet, answer_contract: contract }, context_packet: packet, answer_contract: contract };
  const progress = contracts.buildRetrievalEvent({ requestId: request.request_id, queryId: request.query_id, traceId: request.trace_id, stage: "VALIDATION", sequence: 1 });
  const source = `event: progress\ndata: ${JSON.stringify(progress)}\n\nevent: result\ndata: ${JSON.stringify(result)}\n\n`;
  let stage;
  const response = await consumeKnowledgeAssistantStream(new Response(source), { onProgress: (event) => { stage = event.stage; } });
  assert.equal(stage, "VALIDATION");
  const answer = validateKnowledgeAnswer(response.assistant_message);
  assert.equal(answer.claims[0].text, "Onboarding status is Done.");
  assert.equal(answer.claims[0].classification, "SUPPORTED");
  assert.equal(answer.citations.get("e1").source_id, "source-1");
  assert.equal(answer.citations.get("e1").freshness.current, true);
});
