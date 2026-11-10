const assert = require("node:assert/strict");
const test = require("node:test");
const { buildReproduction, loadCaseReproduction, parseGherkin, summarizeCase } = require("../../backend/services/defectReproduction.service");

test("structured Test Case actions become ordered defect steps and expected results", () => {
  const result = buildReproduction([summarizeCase({ id: "case-1", title: "Save profile" }, [
    { id: "step-2", step_order: 2, action: "Click Save", expected_result: "The profile is saved." },
    { id: "step-1", step_order: 1, action: "Open the profile form" }
  ])]);
  assert.equal(result.steps_to_reproduce, "1. Open the profile form\n2. Click Save");
  assert.equal(result.expected_result, "The profile is saved.");
});

test("Gherkin Given/When steps become reproduction actions and Then steps become expected behavior", () => {
  const parsed = parseGherkin(`Feature: Profile\nScenario: Save\nGiven I open the profile form\nWhen I enter a display name\nAnd I select Save\nThen the profile is saved\nAnd a confirmation is shown`);
  assert.deepEqual(parsed.actions, ["I open the profile form", "I enter a display name", "I select Save"]);
  assert.deepEqual(parsed.expected, ["the profile is saved", "a confirmation is shown"]);
  assert.deepEqual(buildReproduction([summarizeCase({ id: "case-1", title: "Save profile", authoring_mode: "gherkin", gherkin_document: `Given I open the profile form\nWhen I select Save\nThen the profile is saved` })]), {
    steps_to_reproduce: "1. I open the profile form\n2. I select Save",
    expected_result: "the profile is saved"
  });
});

test("multiple linked cases stay separately labeled and explicitly authored issue text remains caller-owned", () => {
  assert.deepEqual(buildReproduction([
    summarizeCase({ id: "one", title: "Valid login" }, [{ step_order: 1, action: "Submit valid credentials", expected_result: "Dashboard opens" }]),
    summarizeCase({ id: "two", title: "Invalid login" }, [{ step_order: 1, action: "Submit invalid credentials", expected_result: "Error appears" }])
  ]), {
    steps_to_reproduce: "Valid login:\n1. Submit valid credentials\nInvalid login:\n1. Submit invalid credentials",
    expected_result: "Valid login:\nDashboard opens\n\nInvalid login:\nError appears"
  });
});

test("case and step reads are project scoped and return no automation payloads", async () => {
  const calls = [];
  const database = { prepare(sql) { return { all: async (...params) => {
    calls.push({ sql, params });
    if (/FROM test_cases tc/.test(sql)) return [{ id: "case-1", title: "Login", authoring_mode: "structured" }];
    if (/FROM test_steps/.test(sql)) return [{ id: "step-1", test_case_id: "case-1", step_order: 1, action: "Submit login", expected_result: "Dashboard opens", automation_code: "secret" }];
    return [];
  } }; } };
  const cases = await loadCaseReproduction({ projectId: "project-1", testCaseIds: ["case-1", "foreign-case", "case-1"], database });
  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0].reproduction_steps, ["Submit login"]);
  assert.equal("automation_code" in cases[0].steps[0], false);
  assert.deepEqual(calls.map(({ params }) => params), [["case-1", "foreign-case", "project-1"], ["case-1", "project-1", 50]]);
  assert.ok(calls.every(({ sql }) => /app\.project_id = \?/.test(sql)));
});
