const test = require("node:test");
const assert = require("node:assert/strict");
const verification = require("../../backend/services/assistant/claimVerification");
const contracts = require("@hellotest/knowledge/backend/services/knowledgeContracts.service");

const evidence = [{ evidence_id: "K-1", source_id: "s1", source_kind: "text", title: "Release notes", content: "Release 4.2 shipped with 3 failed runs. Defect BUG-77 blocks checkout." }];

test("a claim that names an identifier the cited evidence does not contain is rejected as invented", () => {
  assert.equal(verification.specificsVerifier({ statement: "BUG-99 blocks checkout [K-1]", evidence }), false);
  assert.equal(verification.specificsVerifier({ statement: "The run STORY-12 failed", evidence }), false);
});

test("a claim that quotes text the evidence does not contain is rejected", () => {
  assert.equal(verification.specificsVerifier({ statement: 'The notes say "all green" for release 4.2', evidence }), false);
  assert.notEqual(verification.specificsVerifier({ statement: 'The notes call BUG-77 a blocker "blocks checkout"', evidence }), false);
});

test("an identifier or quote that IS in the cited evidence passes, and is still not called verified", () => {
  const result = verification.specificsVerifier({ statement: "BUG-77 blocks checkout [K-1]", evidence });
  assert.equal(result.status, "unverified");
  assert.equal(result.method, "specifics_check");
});

test("a figure the evidence does not contain is kept but annotated, never silently accepted", () => {
  const result = verification.specificsVerifier({ statement: "12 runs failed in release 4.2", evidence });
  assert.equal(result.status, "unverified");
  assert.match(result.notes[0], /figure 12 does not appear/);
  assert.equal(verification.specificsVerifier({ statement: "3 failed runs shipped with 4.2", evidence }).notes, undefined);
});

test("bracketed citation ids and short numbers are not mistaken for specifics", () => {
  const result = verification.specificsVerifier({ statement: "See step 2 [K-3f2a9c1e-7b44-4c1d-9a55-0d1e2f3a4b5c]", evidence });
  assert.notEqual(result, false);
  assert.equal(result.notes, undefined);
});

const packet = { evidence };
const answerFor = (claims, extra = {}) => contracts.buildAnswerContract({
  outcome: { status: "answered", answer_structure: { supported_claims: claims } }, contextPacket: packet, ...extra
});

test("without a verifier an answer is labelled 'cited, not verified' and entailment is not claimed", () => {
  const contract = answerFor([{ statement: "Release 4.2 had some failures that blocked checkout", citation_ids: ["K-1"] }]);
  assert.equal(contract.grounding.verification.status, "cited_not_verified");
  assert.equal(contract.grounding.verification.unverified_claim_count, 1);
  assert.match(contract.grounding.verification.label, /^Cited, not verified/);
  assert.equal(contract.claims[0].verification.status, "unverified");
  assert.equal(contract.grounding.validation_method, "extractive_or_labeled_citation_binding");
  assert.ok(contract.evidence_gaps.some((gap) => /cited but not independently verified/.test(gap)));
});

test("a verbatim quote of the cited evidence is labelled extractive, not verified", () => {
  const contract = answerFor([{ statement: "Defect BUG-77 blocks checkout", citation_ids: ["K-1"] }]);
  assert.equal(contract.claims[0].verification.status, "extractive");
  assert.equal(contract.grounding.verification.status, "extractive");
  assert.equal(contract.grounding.verification.extractive_claim_count, 1);
});

test("the specifics verifier removes an invented claim and names itself in the validation method", () => {
  const contract = answerFor([
    { statement: "Release 4.2 had some failures that blocked checkout", citation_ids: ["K-1"] },
    { statement: "BUG-99 blocks the payment page", citation_ids: ["K-1"] }
  ], { claimVerifier: verification.specificsVerifier, verificationMethod: "specifics_check" });
  assert.equal(contract.claims.length, 1, "the claim naming BUG-99 is gone");
  assert.match(contract.evidence_gaps.join(" "), /1 claim was removed during grounding validation/);
  assert.equal(contract.grounding.validation_method, "specifics_check_and_citation_binding");
  assert.doesNotMatch(contract.grounding.validation_method, /entail/);
  assert.equal(contract.grounding.verification.status, "cited_not_verified", "passing a specifics check is not verification");
  assert.equal(contract.grounding.verification.method, "specifics_check");
});

test("a mix of quoted and unchecked claims is reported as partially verified with exact counts", () => {
  const contract = answerFor([
    { statement: "Defect BUG-77 blocks checkout", citation_ids: ["K-1"] },
    { statement: "Release 4.2 had some failures that blocked checkout", citation_ids: ["K-1"] }
  ]);
  assert.equal(contract.grounding.verification.status, "partially_verified");
  assert.equal(contract.grounding.verification.extractive_claim_count, 1);
  assert.equal(contract.grounding.verification.unverified_claim_count, 1);
});

test("a model-audit verdict makes a claim verified, and the audit method is named", () => {
  const kept = new Set(["release 4.2 had some failures that blocked checkout"]);
  const contract = answerFor([{ statement: "Release 4.2 had some failures that blocked checkout", citation_ids: ["K-1"] }],
    { claimVerifier: verification.auditedClaimVerifier(kept), verificationMethod: "model_audit" });
  assert.equal(contract.claims[0].verification.status, "verified");
  assert.equal(contract.claims[0].verification.method, "model_audit");
  assert.equal(contract.grounding.verification.status, "verified");
  assert.equal(contract.grounding.validation_method, "model_audit_and_citation_binding");
});

test("deterministic server answers are labelled as computed, not as model claims", () => {
  const contract = answerFor([{ statement: "3 runs failed", citation_ids: ["K-1"] }], { trustDeterministic: true });
  assert.equal(contract.grounding.verification.status, "deterministic");
  assert.equal(contract.claims[0].verification.method, "server_deterministic");
});

test("an answer with no surviving claims says so instead of implying a check", () => {
  const contract = answerFor([{ statement: "BUG-99 blocks the payment page", citation_ids: ["K-1"] }], { claimVerifier: verification.specificsVerifier, verificationMethod: "specifics_check" });
  assert.equal(contract.status, "insufficient_context");
  assert.equal(contract.grounding.verification.status, "none");
});

test("model verification is opt-in", () => {
  assert.equal(verification.verificationMode({}), "off");
  assert.equal(verification.verificationMode({ KNOWLEDGE_ANSWER_VERIFICATION: "Model" }), "model");
  assert.equal(verification.verificationMode({ KNOWLEDGE_ANSWER_VERIFICATION: "whatever" }), "off");
});
