import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";


import ts from "typescript";
import * as helpers from "../../frontend/lib/knowledgeAnswer.ts";

const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const componentExports = {};
const source = readFileSync(new URL("../../frontend/components/KnowledgeAnswer.tsx", import.meta.url), "utf8");
new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)((path) => path === "../lib/knowledgeAnswer" ? helpers
  : path === "./KnowledgeFormattedText" ? { KnowledgeFormattedText: ({ text, className = "" }) => createElement("div", { className: `knowledge-formatted-text ${className}`.trim() }, text) }
    : require(path), componentExports);
const message = (overrides = {}) => ({ id: "message", role: "assistant", content: "Legacy content", citations: [{ id: "e1", title: "Permission design", uri: "https://example.test/source" }], context_packet: { contract_version: "1.0", packet_id: "packet", evidence: [{ id: "e1", evidence_id: "e1", title: "Permission design", uri: "https://example.test/source", freshness: { current: true }, visibility: { state: "FULL" } }], retrieval: { status: "COMPLETE" } }, answer_contract: { contract_type: "AnswerContract", contract_version: "1.0", status: "answered", summary: "The design changed.", claims: [{ claim_id: "c1", statement: "The source supports this statement.", classification: "SUPPORTED", evidence_ids: ["e1"] }], citation_ids: ["e1"], evidence_gaps: [], presentation: { recommended_type: "TEXT", structured_payload: {} }, limitations: { retrieval_status: "COMPLETE" }, ...overrides } });
const html = (input) => renderToStaticMarkup(createElement(componentExports.KnowledgeAnswer, { message: input, onEvidenceOpen() {} }));

test("validated claims render once with readable citations instead of the derived raw-ID summary", () => {
  const markup = html(message({ summary: "The source supports this statement. [K-e1]" }));
  assert.equal(markup.split("The source supports this statement.").length - 1, 1);
  assert.match(markup, /aria-label="Source 1/);
  assert.doesNotMatch(markup, /\[K-e1\]|knowledge-answer-summary/);
  const withoutClaims = html(message({ claims: [], summary: "No permitted evidence answers this question." }));
  assert.match(withoutClaims, /knowledge-answer-summary/);
  assert.match(withoutClaims, /No permitted evidence answers this question/);
});

test("saved processing stages render canonical events and legacy traces with status", () => {
  const traceExports = {};
  const traceSource = readFileSync(new URL("../../frontend/components/KnowledgeProcessingTrace.tsx", import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(traceSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(require, traceExports);
  const markup = renderToStaticMarkup(createElement(traceExports.KnowledgeProcessingTrace, { items: [
    { contract_type: "RetrievalEvent", contract_version: "1.0", stage: "VALIDATION", message: "Checked permitted evidence.", status: "COMPLETE" },
    { stage: "RETRIEVAL", message: "One source unavailable.", status: "PARTIAL" },
    { phase: "planning", label: "Planning the search", detail: "Reviewed source scope.", status: "complete" }
  ] }));
  for (const phrase of ["Validation", "Checked permitted evidence. · Complete", "Retrieval", "One source unavailable. · Partial", "Planning the search", "Reviewed source scope. · Complete"]) assert.ok(markup.includes(phrase), phrase);
  assert.match(markup, /class="is-complete"/);
  assert.match(markup, /class="is-partial"/);
});

test("claims cite only authorized evidence; unknown and hidden evidence are excluded", () => {
  const input = message({ claims: [{ statement: "Valid", evidence_ids: ["e1"] }, { statement: "Hidden information", evidence_ids: ["e2"] }] });
  const validated = helpers.validateKnowledgeAnswer(input);
  assert.deepEqual(validated.claims.map((claim) => claim.text), ["Valid"]);
  assert.match(validated.gaps[0], /omitted/);
  input.context_packet.evidence[0].visibility.state = "UNAVAILABLE";
  assert.equal(helpers.validateKnowledgeAnswer(input).claims.length, 0);
  assert.doesNotMatch(html(input), /Hidden information/);
});

test("interpretation is explicit and partial retrieval limits cannot disappear", () => {
  const markup = html(message({ claims: [{ statement: "Possible reason", classification: "INTERPRETATION", evidence_ids: ["e1"] }], limitations: { retrieval_status: "PARTIAL", authorization_partial: true, budget_partial: true, unavailable_sources: 2, stale_sources: ["e1"] } }));
  for (const phrase of ["Response", "Interpretation", "Evidence information", "outside your access", "time or context limit", "2 sources were unavailable", "may be out of date"]) assert.match(markup, new RegExp(phrase));
  assert.doesNotMatch(markup, /Partial evidence|Answer based on the authorized sources available for this turn/);
});

test("model-unavailable fallback retains validated evidence and disclosed partial coverage", () => {
  const input = message();
  input.grounding_status = "provider_unavailable";
  input.answer_contract.status = "provider_unavailable";
  assert.match(html(input), /The source supports this statement/);
  assert.match(html(input), /aria-label="Source 1/);
  input.answer_contract.limitations = { unavailable_sources: 1 };
  assert.equal(helpers.validateKnowledgeAnswer(input).partial, true);
  input.answer_contract.limitations = { retrieval_status: "partial" };
  assert.equal(helpers.validateKnowledgeAnswer(input).partial, true);
});

test("allowed tables render native semantic HTML and escape every model cell", () => {
  const markup = html(message({ presentation: { recommended_type: "TABLE", structured_payload: { columns: [{ key: "change", label: "Change" }], rows: [{ cells: { change: '<img src=x onerror="alert(1)">' }, evidence_ids: ["e1"] }] } } }));
  assert.match(markup, /<table>/);
  assert.match(markup, /scope="col"/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /aria-label="Source 1/);
});

test("malformed presentation payloads and unknown references fall back to text", () => {
  for (const presentation of [{ recommended_type: "HTML", structured_payload: { html: "<script>bad()</script>" } }, { recommended_type: "TABLE", structured_payload: { columns: [{ key: "x", label: "X" }], rows: [{ cells: { x: "bad" }, evidence_ids: ["unknown"] }] } }, { recommended_type: "RELATIONSHIP_GRAPH", structured_payload: { nodes: [], edges: [{ source: "missing", target: "missing", evidence_ids: ["e1"] }] } }]) {
    assert.equal(helpers.validateKnowledgePresentation(presentation, new Set(["e1"])).type, "TEXT");
  }
});

test("malformed canonical answers cannot bypass the contract gate", () => {
  assert.equal(helpers.validateKnowledgeAnswer(message({ claims: "not an array" })), null);
  assert.equal(helpers.validateKnowledgeAnswer(message({ contract_version: "2.0" })), null);
  const mixed = helpers.validateKnowledgeAnswer(message({ claims: [null, { statement: "Malformed reference", evidence_ids: ["e1", 42] }] }));
  assert.equal(mixed.claims.length, 0);
});

test("timeline, comparison, metric and document results have bounded safe renderers", () => {
  const ids = ["e1"];
  const presentations = [
    { recommended_type: "TIMELINE", structured_payload: { items: [{ date: "2026-01-02", title: "Design reviewed", description: "Accepted", evidence_ids: ids }] } },
    { recommended_type: "COMPARISON", structured_payload: { columns: [{ key: "before", label: "Before" }], rows: [{ cells: { before: "Previous design" }, evidence_ids: ids }] } },
    { recommended_type: "METRIC", structured_payload: { items: [{ label: "Reviewed", value: "12", unit: "items", evidence_ids: ids }] } },
    { recommended_type: "DOCUMENT_RESULTS", structured_payload: { items: [{ evidence_id: "e1", title: "Forged title", url: "javascript:bad()" }] } }
  ];
  for (const presentation of presentations) {
    assert.equal(helpers.validateKnowledgePresentation(presentation, new Set(ids)).type, presentation.recommended_type);
    const markup = html(message({ presentation }));
    assert.doesNotMatch(markup, /javascript:|Forged title/);
  }
});

test("deep links allow only safe web/internal destinations and preserve evidence identity", () => {
  for (const uri of ["javascript:alert(1)", "data:text/html,bad", "//evil.test", "/\\evil.test", "file:///private"]) assert.equal(helpers.knowledgeCitationHref({ id: "e", uri }), "");
  assert.equal(helpers.knowledgeCitationHref({ id: "e", uri: "/knowledge-repo?source_id=one" }), "/knowledge-repo?source_id=one");
  assert.equal(helpers.knowledgeCitationLocation({ id: "e", location: { timestamp_start_ms: 802000 } }), "13:22");
  const input = message();
  input.citations[0].uri = "https://forged.test";
  assert.equal(helpers.validateKnowledgeAnswer(input).citations.get("e1").uri, "https://example.test/source");
});
