import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildBugToTestCaseDraft,
  buildConvertedBugSteps,
  countConvertedBugs,
  mapBugPriorityToTestCase,
  parseBugStepLines,
  parseStoredBugToTestCaseDraft
} from "../src/lib/bugToTestCaseConversion.ts";

test("conversion metrics count distinct filtered bugs with recorded origins, not ordinary case links", () => {
  const bugs = [
    { id: "converted", has_converted_test_cases: true, linked_test_case_ids: ["case-1", "case-2"] },
    { id: "converted", has_converted_test_cases: true },
    { id: "converted-unlinked", has_converted_test_cases: true, linked_test_case_ids: [] },
    { id: "manual-link", has_converted_test_cases: false, linked_test_case_ids: ["existing-case"] },
    { id: "legacy-link", linked_test_case_ids: ["unknown-origin"] }
  ];
  assert.equal(countConvertedBugs(bugs), 2);
  assert.equal(countConvertedBugs(bugs.filter((bug) => bug.id === "manual-link")), 0);
  assert.equal(countConvertedBugs(bugs.filter((bug) => bug.id === "converted-unlinked")), 1);
  assert.equal(countConvertedBugs([]), 0);
});

test("Bug conversion maps descriptive fields, delivery evidence, and every linked association", () => {
  const draft = buildBugToTestCaseDraft({
    id: "bug-1",
    display_id: "BUG-42",
    jira_url: "https://jira.example/browse/BUG-42",
    user_id: "user-1",
    title: "Checkout rejects a valid card",
    message: "Valid cards fail after confirmation.",
    actual_result: "A generic error is shown.",
    steps_to_reproduce: "1. Open checkout\n2. Enter a valid card\n3. Confirm payment",
    expected_result: "1. Checkout opens\n2. Card is accepted\n3. Order is confirmed",
    environment: "iOS staging",
    fix_version: "2026.9.1",
    release: "September GA",
    sprint: "Payments Sprint 18",
    build: "4815",
    priority: "Highest",
    severity: "critical",
    labels: ["payments", "regression", "payments"],
    linked_requirement_ids: ["story-1", "story-2"],
    linked_module_ids: ["module-1", "module-2"],
    linked_test_suite_ids: ["suite-1", "suite-2"],
    linked_test_case_ids: ["case-existing"],
    status: "Open",
    revision: 7
  });

  assert.equal(draft.title, "Checkout rejects a valid card");
  assert.equal(draft.description, "Valid cards fail after confirmation.");
  assert.equal(draft.priority, 1);
  assert.deepEqual(draft.preconditions, [
    "Environment: iOS staging",
    "Version: 2026.9.1",
    "Release: September GA",
    "Sprint: Payments Sprint 18",
    "Build: 4815"
  ]);
  assert.deepEqual(draft.requirementIds, ["story-1", "story-2"]);
  assert.deepEqual(draft.moduleIds, ["module-1", "module-2"]);
  assert.deepEqual(draft.suiteIds, ["suite-1", "suite-2"]);
  assert.deepEqual(draft.labels, ["payments", "regression"]);
  assert.deepEqual(draft.externalReferences, ["https://jira.example/browse/BUG-42"]);

  const steps = buildConvertedBugSteps(draft);
  assert.equal(steps.filter((step) => step.isPrecondition).length, 5);
  assert.deepEqual(
    steps.filter((step) => !step.isPrecondition).map(({ action, expectedResult }) => ({ action, expectedResult })),
    [
      { action: "Open checkout", expectedResult: "Checkout opens" },
      { action: "Enter a valid card", expectedResult: "Card is accepted" },
      { action: "Confirm payment", expectedResult: "Order is confirmed" }
    ]
  );
});

test("Bug reproduction parsing handles rich text, bullets, inline numbering, and a single overall outcome", () => {
  assert.deepEqual(
    parseBugStepLines("<ol><li>Open the app</li><li>Tap Pay</li></ol>"),
    ["Open the app", "Tap Pay"]
  );
  assert.deepEqual(parseBugStepLines("1. Open app 2. Tap Pay 3. Confirm"), ["Open app", "Tap Pay", "Confirm"]);

  const converted = buildConvertedBugSteps({
    bugId: "bug-2",
    bugDisplayId: "BUG-2",
    existingTestCaseIds: [],
    title: "Payment issue",
    description: "",
    preconditions: [],
    reproductionSteps: ["Open app", "Tap Pay"],
    expectedResults: ["Payment succeeds"],
    externalReferences: [],
    labels: [],
    priority: 3,
    requirementIds: [],
    moduleIds: [],
    suiteIds: [],
    release: "",
    sprint: ""
  });
  assert.equal(converted[0].expectedResult, "");
  assert.equal(converted[1].expectedResult, "Payment succeeds");
  assert.equal(parseStoredBugToTestCaseDraft("not-json"), null);
  assert.equal(mapBugPriorityToTestCase("Lowest", ""), 5);
});

test("Bug conversion creation persists all links and links the created Test Case back to its source Bug", async () => {
  const [issues, testCases] = await Promise.all([
    readFile(new URL("../src/pages/IssuesPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TestCasesPage.tsx", import.meta.url), "utf8")
  ]);

  assert.match(issues, /buildBugToTestCaseDraft\(selectedItem\)/);
  assert.match(issues, /actions=\{!isCreating && selectedItem[\s\S]*issue-detail-convert-button[\s\S]*Convert to Test Case/);
  assert.ok(
    issues.indexOf("issue-detail-convert-button") < issues.indexOf('className="issue-detail-footer"'),
    "Bug conversion must be available in the top detail header before the sticky footer"
  );
  assert.match(testCases, /test_case_type: "regression"/);
  assert.match(testCases, /source_issue_id: activeBugConversion\?\.bugId/);
  assert.match(issues, /countConvertedBugs\(filteredItems\)/);
  assert.match(issues, /label: "Converted to Test Cases"/);
  assert.match(testCases, /requirement_ids: requirementIds/);
  assert.match(testCases, /suite_ids: suiteIds/);
  assert.match(testCases, /Promise\.allSettled\(moduleIds\.map/);
  assert.match(testCases, /linked_test_case_ids:[\s\S]*response\.id/);
  assert.match(testCases, /Mapped from Bug/);
});
