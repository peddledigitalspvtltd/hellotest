import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as sources from "../../frontend/lib/knowledgeAnswer.ts";

const exports = {};
const code = ts.transpileModule(readFileSync(new URL("../../frontend/lib/assistantExperience.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function("require", "exports", code)(path => { if (path === "./knowledgeAnswer") return sources; throw new Error(`Unexpected dependency ${path}`); }, exports);
const { assistantConversationMarkdown, assistantMessageMarkdown, findAssistantConversations } = exports;

test("conversation search is accent-insensitive, scoped to supplied sessions and omits archived history", () => {
  const sessions = [{ id: "1", title: "Rélease payment review" }, { id: "2", title: "Archived release", status: "archived" }, { id: "3", title: "Payment risk" }];
  assert.deepEqual(findAssistantConversations(sessions, "release payment").map(item => item.id), ["1"]);
  assert.deepEqual(findAssistantConversations(sessions, "").map(item => item.id), ["1", "3"]);
});

test("conversation export carries real source references and interrupted turn status", () => {
  const content = assistantConversationMarkdown([
    { id: "1", role: "user", content: "Which checkout risks remain?", status: "complete" },
    { id: "2", role: "assistant", content: "Refund retry remains unverified.", status: "cancelled", citations: [{ id: "e1", title: "Checkout evidence", source_id: "source-1", source_kind: "file" }] }
  ]);
  assert.match(content, /## You/);
  assert.match(content, /Refund retry remains unverified/);
  assert.match(content, /Turn status: cancelled/);
  assert.match(content, /Checkout evidence/);
  assert.doesNotMatch(content, /integration_id|api_key|provider_config/);
});

test("copy uses the displayed validated artifact instead of a short raw summary", () => {
  const source = { id: "e1", evidence_id: "e1", title: "Authorized checkout source", uri: "https://example.test/evidence", visibility: { state: "FULL" } };
  const message = { id: "reply", role: "assistant", content: "Short summary.", citations: [source, { id: "hidden", title: "Hidden source", uri: "https://example.test/hidden" }], context_packet: { contract_version: "1.0", packet_id: "packet", evidence: [source], retrieval: { status: "COMPLETE" } }, answer_contract: { contract_type: "AnswerContract", contract_version: "1.0", status: "answered", summary: "Short summary.", claims: [{ statement: "**Observed failure:** the payment was retried.", evidence_ids: ["e1"] }, { statement: "Unsupported hidden claim", evidence_ids: ["hidden"] }], citation_ids: ["e1"], evidence_gaps: [], presentation: { recommended_type: "TEXT", structured_payload: {} } } };
  const copied = assistantMessageMarkdown(message);
  assert.match(copied, /Observed failure/);
  assert.match(copied, /Authorized checkout source/);
  assert.doesNotMatch(copied, /Unsupported hidden claim|Hidden source|Short summary/);
});
