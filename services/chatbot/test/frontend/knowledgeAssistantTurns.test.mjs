import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { appendKnowledgeProgressEvent, KnowledgeStreamError, knowledgeTurnNotice, resumePendingKnowledgeTurn } from "../../frontend/lib/knowledgeAssistantStream.ts";

const source = readFileSync(new URL("../../frontend/components/GroundedAssistant.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("GroundedAssistant.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submitNode;
const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "submitPrompt") submitNode = node.initializer; ts.forEachChild(node, visit); };
visit(ast);
const script = ts.transpileModule(`const submitPrompt = ${submitNode.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ failure, cancel = false, changeScope = false } = {}) {
  let messages = [];
  let retries = {};
  const calls = [];
  const requestControllerRef = { current: null };
  const scopeGenerationRef = { current: 1 };
  const context = {
    prompt: "Summarize the evidence", selectedIntegrationId: "__retrieval_only__", isSending: false, isRestoringSession: false, canReviewHistory: false, knowledgeAsOf: "",
    sourceKinds: ["text"], apiSourceKinds: ["text", "knowledge_item", "product_help"], DEFAULT_ASSISTANT_SOURCE_KINDS: ["requirement", "test_case", "execution", "bug", "file", "text", "chat"], RETRIEVAL_ONLY_INTEGRATION: "__retrieval_only__",
    smartContext: { query: "Scope", sourceIds: ["source-1"], sourceKinds: ["text"], contextText: "Reviewed evidence" },
    scopeGenerationRef, requestControllerRef, projectId: "project-1", appTypeId: "app-1", sessionId: "conversation-1", createClientTurnId: () => "turn-1",
    setActiveRequestIntegrationId() {}, setProgressEvents() {}, setPrompt() {}, setSessionId() {}, setRequestStartedAt() {}, setTurnNotices() {},
    setMessages: (updater) => { messages = updater(messages); }, setRetryTurns: (updater) => { retries = updater(retries); },
    createSessionMutation: { mutateAsync: async () => ({ id: "conversation-1" }) }, safeSession: (item) => item,
    sendMessageMutation: { mutateAsync: async (input) => { calls.push(input); if (changeScope) scopeGenerationRef.current += 1; if (cancel) { requestControllerRef.current.abort(); throw new DOMException("Stopped", "AbortError"); } if (failure) throw failure; return { assistant_message: { id: "answer", content: "Evidence answer" } }; } },
    normalizeAnswer: (response) => ({ ...response.assistant_message, role: "assistant", citations: [] }),
    queryClient: { invalidateQueries: async () => {} }, appendKnowledgeProgressEvent, KnowledgeStreamError, knowledgeTurnNotice, resumePendingKnowledgeTurn
  };
  const submit = new Function(...Object.keys(context), `${script}\nreturn submitPrompt;`)(...Object.values(context));
  return { submit, calls, messages: () => messages, retries: () => retries };
}

test("evidence-only turns explicitly bypass models and carry their reviewed source scope", async () => {
  const run = fixture();
  await run.submit();
  assert.equal(run.calls[0].responseMode, "evidence");
  assert.equal(run.calls[0].integrationId, "");
  assert.deepEqual(run.calls[0].filters.source_kinds, ["text", "knowledge_item", "product_help"]);
  assert.deepEqual(run.calls[0].smartContext.source_ids, ["source-1"]);
  assert.equal(run.messages()[1].scope.project_id, "project-1");
});

test("retry preserves the original turn, model, source filters and historical date", async () => {
  const run = fixture();
  const original = { clientTurnId: "original-turn", errorMessageId: "failed-turn", integrationId: "original-model", prompt: "Original question", smartContext: null, filters: { app_type_id: "app-1", source_kinds: ["file"], as_of: "2025-04-01T00:00:00Z" }, responseMode: "answer" };
  await run.submit(undefined, original);
  assert.equal(run.calls[0].clientTurnId, original.clientTurnId);
  assert.equal(run.calls[0].integrationId, original.integrationId);
  assert.equal(run.calls[0].message, original.prompt);
  assert.deepEqual(run.calls[0].filters, original.filters);
  assert.equal(run.calls[0].smartContext, undefined);
  assert.equal(run.messages().filter((message) => message.role === "user").length, 0, "Retry must not duplicate the user message");
});

test("stopping keeps a resumable turn; switching scope discards late results", async () => {
  const stopped = fixture({ cancel: true });
  await stopped.submit();
  assert.equal(stopped.messages()[1].status, "cancelled");
  assert.equal(Object.values(stopped.retries())[0].clientTurnId, "turn-1");
  const changed = fixture({ changeScope: true });
  await changed.submit();
  assert.equal(changed.messages().length, 1, "No answer from the old project may append after a scope switch");
});

test("non-retryable server errors remain visible without a retry action", async () => {
  const run = fixture({ failure: new KnowledgeStreamError("Access revoked", "SCOPE_REVOKED", false) });
  await run.submit();
  assert.equal(run.messages()[1].content, "Access revoked");
  assert.deepEqual(run.retries(), {});
});
