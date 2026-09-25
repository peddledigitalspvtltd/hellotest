const assert = require("node:assert/strict");
const test = require("node:test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const aiBugDraft = require("../../../ai/backend/services/aiBugDraft.service");
const aiBugTriage = require("../../../ai/backend/services/aiBugTriage.service");

const emptyContext = {
  run: null,
  cases: [],
  requirements: [],
  failures: [],
  boundaries: { partial_sources: false }
};

test("deterministic Defect drafting leaves unsupported steps and expected behavior empty", () => {
  const input = {
    intent: "Checkout fails after payment",
    evidence: "Observed result: A payment error is shown.",
    additional_context: "",
    external_links: []
  };
  const evidenceSources = [
    { ref: "reporter:intent", type: "reporter-input", id: "intent", title: "Incident brief" },
    { ref: "reporter:evidence", type: "reporter-input", id: "evidence", title: "Observed evidence" }
  ];
  const result = aiBugDraft._private.deterministicDraft({ input, context: emptyContext, evidenceSources });

  assert.equal(result.draft.steps_to_reproduce, "");
  assert.equal(result.draft.expected_result, "");
  assert.equal(result.draft.actual_result, "A payment error is shown.");
  assert.ok(result.gaps.some((gap) => gap.field === "steps_to_reproduce"));
  assert.ok(result.gaps.some((gap) => gap.field === "expected_result"));
  assert.doesNotMatch(result.draft.steps_to_reproduce, /open the affected workflow/i);
});

test("structured reporter evidence is never recycled into a different Defect field", () => {
  const input = {
    intent: "Profile save does not complete",
    evidence: "Steps to reproduce:\n1. Open Profile\n2. Select Save",
    additional_context: "",
    external_links: []
  };
  const evidenceSources = [
    { ref: "reporter:intent", type: "reporter-input", id: "intent", title: "Incident brief" },
    { ref: "reporter:evidence", type: "reporter-input", id: "evidence", title: "Observed evidence" }
  ];
  const result = aiBugDraft._private.deterministicDraft({ input, context: emptyContext, evidenceSources });

  assert.match(result.draft.steps_to_reproduce, /Open Profile/);
  assert.equal(result.draft.actual_result, "");
  assert.ok(result.gaps.some((gap) => gap.field === "actual_result"));
});

test("linked Story context contributes expected behavior only from an explicit headed section", () => {
  const input = { intent: "Checkout confirmation is absent", evidence: "", additional_context: "", external_links: [] };
  const story = {
    id: "story-1",
    title: "Checkout confirmation",
    description: "<h2>Business context</h2><p>Reduce support contacts.</p><h2>Acceptance Criteria</h2><ul><li>A confirmation number is displayed.</li></ul><h2>Technical notes</h2><p>Use the order API.</p>"
  };
  const context = { ...emptyContext, requirements: [story] };
  const evidenceSources = [
    { ref: "reporter:intent", type: "reporter-input", id: "intent", title: "Incident brief" },
    { ref: "requirement:story-1", type: "requirement", id: "story-1", title: story.title }
  ];
  const result = aiBugDraft._private.deterministicDraft({ input, context, evidenceSources });

  assert.match(result.draft.expected_result, /confirmation number is displayed/i);
  assert.doesNotMatch(result.draft.expected_result, /support contacts|order API/i);
  assert.deepEqual(result.field_evidence.expected_result, ["requirement:story-1"]);

  const unheaded = aiBugDraft._private.deterministicDraft({
    input,
    context: { ...emptyContext, requirements: [{ ...story, description: "This Story reduces support contacts." }] },
    evidenceSources
  });
  assert.equal(unheaded.draft.expected_result, "");
});

test("Defect drafting uses a compact prompt context and discloses source text truncation", () => {
  const limits = aiBugDraft._private.BUG_DRAFT_CONTEXT_LIMITS;
  const snapshot = aiBugDraft._private.buildPromptContextSnapshot({
    run: { id: "run-1", name: "Run", status: "failed" },
    cases: [{ id: "case-1", title: "Case", description: "C".repeat(limits.case_description + 9) }],
    requirements: [{ id: "story-1", title: "Story", description: `<h2>Acceptance Criteria</h2><p>${"E".repeat(limits.requirement_expected_section + 5)}</p>` }],
    failures: [{ id: "result-1", test_case_id: "case-1", status: "failed", logs: "L".repeat(limits.failure_observation + 17), defects: "" }]
  });

  assert.equal(snapshot.cases[0].description.length, limits.case_description);
  assert.equal(snapshot.requirements[0].expected_section.length, limits.requirement_expected_section);
  assert.equal(snapshot.failures[0].logs.length, limits.failure_observation);
  assert.equal(snapshot.partial_sources, true);
  assert.ok(snapshot.content_omissions.some((item) => item.source_ref === "execution-result:result-1" && item.field === "observation" && item.omitted === 17));
});

test("Defect draft normalization reports hybrid fallback fields when model fields are ungrounded", () => {
  const input = { intent: "Save action fails", evidence: "", additional_context: "", external_links: [] };
  const evidenceSources = [{ ref: "reporter:intent", type: "reporter-input", id: "intent", title: "Incident brief" }];
  const fallback = aiBugDraft._private.deterministicDraft({ input, context: emptyContext, evidenceSources });
  const normalized = aiBugDraft._private.normalizeCandidate({
    draft: { title: "Grounded save failure", steps_to_reproduce: "1. Invent a step" },
    field_evidence: { title: ["reporter:intent"], steps_to_reproduce: ["not-allowed"] }
  }, fallback, evidenceSources);

  assert.equal(normalized.draft.title, "Grounded save failure");
  assert.equal(normalized.draft.steps_to_reproduce, "");
  assert.ok(normalized.fallback_fields.includes("steps_to_reproduce"));
  assert.ok(!normalized.fallback_fields.includes("title"));
  assert.ok(normalized.gaps.some((gap) => gap.field === "severity"));
  assert.ok(normalized.gaps.some((gap) => gap.field === "priority"));
});

test("Defect triage category and priority signals exactly identify their supporting fields", () => {
  const issue = {
    id: "bug-1",
    title: "Payment failure after submit",
    message: "The confirmation page never appears.",
    priority: "Low",
    severity: ""
  };
  const category = aiBugTriage._private.classifyCategory(issue);
  const priority = aiBugTriage._private.recommendPriority(issue);

  assert.equal(category.category, "Functional defect");
  assert.deepEqual(category.signal.supports, ["category"]);
  assert.equal(priority.recommended, "Highest");
  assert.match(priority.signal.value, /payment failure/i);
  assert.deepEqual(priority.signal.supports, ["priority"]);
  assert.deepEqual(priority.signal.evidence_refs, ["issue:bug-1:title"]);
});

test("Defect triage accepts only cited category refinements and never changes deterministic priority or readiness", () => {
  const deterministic = [{
    issue_id: "bug-1",
    display_id: "BUG-1",
    title: "Profile API returns an error",
    category: "Functional defect",
    current_priority: "Medium",
    recommended_priority: "High",
    explanation: "Deterministic explanation",
    signals: [
      { code: "category.functional-default", label: "Default", value: "Default category.", supports: ["category"], evidence_refs: ["issue:bug-1:title"] },
      { code: "priority.high-impact-language", label: "Failure", value: "Matched failure.", supports: ["priority"], evidence_refs: ["issue:bug-1:title"] }
    ],
    evidence_refs: ["issue:bug-1:title"],
    readiness: { status: "needs-evidence", completed_field_count: 0, total_field_count: 5, missing_fields: ["environment"], linked_evidence: false, review_actions: ["Identify the affected environment."] },
    review_actions: ["Identify the affected environment."]
  }];
  const evidenceSources = [{ ref: "issue:bug-1:title", id: "bug-1", field: "title", title: "BUG-1 · Title", type: "bug-field" }];
  const valid = aiBugTriage._private.normalizeCategoryRefinements({
    recommendations: [{ issue_id: "bug-1", category: "Integration / API", category_explanation: "The title explicitly identifies the Profile API.", category_evidence_refs: ["issue:bug-1:title"] }]
  }, deterministic, evidenceSources);

  assert.equal(valid.triage[0].category, "Integration / API");
  assert.equal(valid.triage[0].recommended_priority, "High");
  assert.strictEqual(valid.triage[0].readiness, deterministic[0].readiness);
  assert.deepEqual(valid.fallback_sections, []);

  const forged = aiBugTriage._private.normalizeCategoryRefinements({
    recommendations: [{ issue_id: "bug-1", category: "Security / access", category_explanation: "Unsupported claim.", category_evidence_refs: ["issue:another-bug:title"] }]
  }, deterministic, evidenceSources);
  assert.equal(forged.triage[0].category, "Functional defect");
  assert.deepEqual(forged.fallback_sections, ["category:bug-1"]);
});

test("Defect triage fingerprints and prompts a field-bounded Defect snapshot", () => {
  const limits = aiBugTriage._private.TRIAGE_PROMPT_FIELD_LIMITS;
  const bounded = aiBugTriage._private.buildBoundedIssueSnapshots([{
    id: "bug-1",
    title: "T".repeat(limits.title + 7),
    message: "M".repeat(limits.message + 11),
    steps_to_reproduce: "S".repeat(limits.steps_to_reproduce + 13),
    linked_test_case_ids: Array.from({ length: limits.traceability_ids_per_field + 2 }, (_, index) => `case-${index}`)
  }]);

  assert.equal(bounded.snapshots[0].title.length, limits.title);
  assert.equal(bounded.snapshots[0].message.length, limits.message);
  assert.equal(bounded.snapshots[0].steps_to_reproduce.length, limits.steps_to_reproduce);
  assert.equal(bounded.snapshots[0].linked_test_case_ids.length, limits.traceability_ids_per_field);
  assert.equal(bounded.boundaries.partial_sources, true);
  assert.ok(bounded.boundaries.omissions.some((item) => item.field === "message" && item.omitted === 11));
});

test("Defect AI routes enforce the feature gate and the shared ten-item triage boundary", async () => {
  const routeSource = await readFile(path.join(__dirname, "../../../testing/backend/routes/issues.routes.js"), "utf8");
  assert.match(routeSource, /aiBugTriageService\.MAX_TRIAGE_ITEMS/);
  assert.match(routeSource, /AI-assisted Defect drafting and triage are disabled/);
  assert.match(routeSource, /prompt_guidance: \{ required: false, type: "string", maxLength: 4_000 \}/);
  const draftSource = await readFile(path.join(__dirname, "../../../ai/backend/services/aiBugDraft.service.js"), "utf8");
  assert.match(draftSource, /boundaries\.omitted\.external_links/);
  assert.match(draftSource, /boundaries\.omitted\.reference_images/);
  assert.equal(aiBugTriage.MAX_TRIAGE_ITEMS, 10);
  assert.equal(aiBugDraft._private.BUG_DRAFT_USAGE_KEY, "ai.bug.draft");
  assert.equal(aiBugTriage._private.BUG_TRIAGE_USAGE_KEY, "ai.bug.triage");
});
