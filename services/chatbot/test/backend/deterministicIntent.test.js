"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { plannerSkipReason } = require("../../backend/services/assistant/deterministicIntent");

test("the deterministic route skips planning only for evidence-only or clear exact-record lookups", () => {
  assert.equal(plannerSkipReason({ responseMode: "evidence", question: "How did checkout change?" }), "EVIDENCE_MODE");
  assert.equal(plannerSkipReason({ responseMode: "answer", retrievalDisabled: true, question: "Show TC-204" }), "RETRIEVAL_DISABLED");
  assert.equal(plannerSkipReason({ responseMode: "answer", question: "Show the status of STORY-12" }), "DETERMINISTIC_LOOKUP");
  assert.equal(plannerSkipReason({ responseMode: "answer", question: "Trace the failure path from STORY-12" }), null);
  assert.equal(plannerSkipReason({ responseMode: "answer", question: "Compare coverage across STORY-12 and STORY-13" }), null);
  assert.equal(plannerSkipReason({ responseMode: "answer", question: "How do expired cards work?" }), null);
});


test("ordinary project nouns do not masquerade as prefixed record identifiers", () => {
  for (const question of ["What is the release approval requirement?", "Show requirements", "Show bugs", "What is running?", "Request account access", "Runner results"]) {
    assert.equal(plannerSkipReason({ responseMode: "answer", question }), null, question);
  }
  for (const id of ["STORY-12", "TC204", "bug_91", "REQ-1", "RUN-42", "AT-8"]) {
    assert.equal(plannerSkipReason({ responseMode: "answer", question: `Show ${id}` }), "DETERMINISTIC_LOOKUP", id);
  }
});
