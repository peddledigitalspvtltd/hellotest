import assert from "node:assert/strict";
import test from "node:test";
import {
  composeSharedStepGherkin,
  gherkinToStructuredCase,
  mergeGherkinStepMetadata,
  normalizeGherkinParameterReferences,
  parseSharedStepGherkin,
  resolveGherkinParameterText,
  sanitizeGherkinDocumentText,
  setGherkinFeatureTitle,
  sharedStepGherkinToStructuredSteps,
  splitGherkinDocument,
  structuredCaseToGherkin,
  structuredStepsToSharedGherkin,
  syncSharedStepGherkin,
  tokenizeGherkinInlineText
} from "../../frontend/lib/gherkin.ts";
import { collectStepParameters } from "../../../platform/frontend/src/shared/lib/stepParameters.ts";

test("shared Gherkin switching preserves every template parameter and its saved value key", () => {
  const document = 'When sign in with <t.user> and <password>\nThen <s.home> appears\nAnd <r.build> is recorded';
  const structured = sharedStepGherkinToStructuredSteps(document, { normalizeParameters: true });
  const detected = collectStepParameters(structured.map((step, index) => ({ ...step, id: String(index) })));
  assert.deepEqual(detected.map(({ name }) => name).sort(), ["r.build", "r.password", "s.home", "t.user"]);
  assert.deepEqual(structured, [{ action: "sign in with @t.user and @r.password", expected_result: "@s.home appears\n@r.build is recorded" }]);
  const roundTrip = structuredStepsToSharedGherkin(structured);
  assert.deepEqual(sharedStepGherkinToStructuredSteps(roundTrip, { normalizeParameters: true }), structured);
  assert.equal(normalizeGherkinParameterReferences(document).includes("<password>"), false);
});

test("reusable group fragments preserve actions, outcomes and parameter references without a scenario", () => {
  const steps = [
    { action: "enter @t.username for @s.tenant", expected_result: "the account <role> appears\nbuild @r.build is recorded" },
    { action: "open the profile", expected_result: "the profile is displayed" }
  ];
  const fragment = structuredStepsToSharedGherkin(steps);
  assert.doesNotMatch(fragment, /Feature:|Scenario:|Background:|Examples:/);
  assert.deepEqual(sharedStepGherkinToStructuredSteps(fragment), steps);
  assert.equal(composeSharedStepGherkin(parseSharedStepGherkin(fragment)), fragment);
});

test("legacy shared documents become reusable fragments while retaining all behavior", () => {
  const legacy = "Feature: Login\n\nBackground:\n  Given tenant @s.tenant exists\n\nScenario: Login\n  When enter @t.username\n  Then access is granted\n  And @r.build is logged";
  const fragment = composeSharedStepGherkin(parseSharedStepGherkin(legacy));
  assert.doesNotMatch(fragment, /Feature:|Scenario:|Background:/);
  assert.deepEqual(sharedStepGherkinToStructuredSteps(fragment), [
    { action: "tenant @s.tenant exists", expected_result: "" },
    { action: "enter @t.username", expected_result: "access is granted\n@r.build is logged" }
  ]);
});

test("standalone outcomes and blank editing rows do not become invented actions", () => {
  assert.deepEqual(sharedStepGherkinToStructuredSteps("Then access is denied\nAnd a reason is shown\nWhen \nThen "), [
    { action: "", expected_result: "access is denied\na reason is shown" }
  ]);
  assert.deepEqual(parseSharedStepGherkin("Givenaway\nThenable\nWhenever\nButler"), []);
  assert.equal(composeSharedStepGherkin([{ keyword: "Given", text: "" }]), "Given ");
});

test("shared step arguments move with their step and do not parse keywords inside doc strings", () => {
  const source = 'When submit the message\n  """\n  Given this is content\n  Scenario: also content\n  """\nThen the rows appear\n  | name |\n  | @t.name |';
  const steps = parseSharedStepGherkin(source);
  assert.equal(steps.length, 2);
  assert.equal(composeSharedStepGherkin(steps), source);
  assert.match(composeSharedStepGherkin([steps[1], steps[0]]), /^Then the rows appear\n  \| name \|\n  \| @t.name \|\nWhen submit/);
});

test("switching group formats preserves step IDs and capabilities across insertion, editing and reorder", () => {
  const previous = [
    { id: "api", action: "create user", expected_result: "created", step_type: "api", group_id: "shared" },
    { id: "web", action: "open profile", expected_result: "visible", step_type: "web", group_id: "shared" }
  ];
  const converted = [
    { action: "open profile", expected_result: "name visible" },
    { action: "new action", expected_result: "new outcome" },
    { action: "create user", expected_result: "created" }
  ];
  const merged = mergeGherkinStepMetadata(converted, previous, () => ({ id: "new", action: "", expected_result: "", step_type: "web", group_id: "shared" }));
  assert.deepEqual(merged.map(({ id, step_type, group_id }) => ({ id, step_type, group_id })), [
    { id: "web", step_type: "web", group_id: "shared" },
    { id: "new", step_type: "web", group_id: "shared" },
    { id: "api", step_type: "api", group_id: "shared" }
  ]);
  assert.equal(merged[0].expected_result, "name visible");
});

test("a linked requirement supplies Feature while the test case retains its Scenario title", () => {
  const result = structuredCaseToGherkin({ title: "Reject invalid password", featureTitle: "Customer sign in", steps: [{ action: "submit an invalid password", expected_result: "access denied" }] });
  assert.match(result, /^Feature: Customer sign in\n/);
  assert.match(result, /Scenario: Reject invalid password/);
  const updated = setGherkinFeatureTitle(result, "<p>Account\n access &amp; identity</p>");
  assert.match(updated, /^Feature: Account access & identity\n/);
  assert.equal(updated.slice(updated.indexOf("\n")), result.slice(result.indexOf("\n")));
});

test("case format switching retains multiline actions and outcomes from inserted shared groups", () => {
  const steps = [
    { action: "enter credentials\nusing @t.username", expected_result: "access is granted\n@r.build is recorded" },
    { action: 'submit a payload\n  """\n  Given this is payload content\n  """', expected_result: "the payload is accepted" }
  ];
  const document = structuredCaseToGherkin({ title: "Account access", steps });
  assert.deepEqual(gherkinToStructuredCase(document).steps, steps);
});

test("headings and rich text inside step arguments stay literal through case parsing", () => {
  const argument = 'submit a feature file\n  """\n  Feature: payload\n  Background:\n  Scenario: payload\n  Given <p>literal content</p>\n  Examples:\n  """';
  const source = structuredCaseToGherkin({ title: "Import file", steps: [{ action: argument, expected_result: "file accepted" }] });
  assert.equal(splitGherkinDocument(source).scenarios.length, 1);
  assert.equal(sanitizeGherkinDocumentText(source), source);
  assert.deepEqual(gherkinToStructuredCase(source).steps, [{ action: argument, expected_result: "file accepted" }]);
});

test("group boundary metadata does not leak into structured actions and outcomes", () => {
  const source = "Feature: Account\nScenario: Access\n  # Shared Step Group [instance]: Sign in\n  When enter @t.username\n  Then access is granted\n  # End Shared Step Group [instance]\n  When open profile\n  Then the profile is displayed";
  assert.deepEqual(gherkinToStructuredCase(source).steps, [
    { action: "enter @t.username", expected_result: "access is granted" },
    { action: "open profile", expected_result: "the profile is displayed" }
  ]);
});

test("Feature renaming retains tags and examples and inserts a missing heading safely", () => {
  const source = "# language: en\n@regression\nFeature: Old story\n\n@smoke\nScenario Outline: Sign in as <role>\n  Given a <role>\nExamples:\n  | role |\n  | owner |";
  assert.equal(setGherkinFeatureTitle(source, "New story"), source.replace("Feature: Old story", "Feature: New story"));
  const withoutFeature = "# language: en\n@smoke\nScenario: Case\n  Given an account";
  assert.equal(setGherkinFeatureTitle(withoutFeature, "Story"), "# language: en\n@smoke\nFeature: Story\n\nScenario: Case\n  Given an account");
  assert.equal(setGherkinFeatureTitle(source, ""), source);
});

test("Gherkin resolves and highlights quoted data columns without changing authored tokens", () => {
  const source = String.raw`When @t.[First Name] uses @s.[API Host] at @r.[123] with @t.[price.total], @t.[closing\]], and @t.[folder\\file]`;
  const values = {
    "t.first name": "Jay", "s.api host": "example.test", "r.123": "run-1",
    "t.price.total": "19.95", "t.closing]": "bracket", "@t.[folder\\\\file]": "slash"
  };
  assert.equal(resolveGherkinParameterText(source, values), "When Jay uses example.test at run-1 with 19.95, bracket, and slash");
  assert.deepEqual(tokenizeGherkinInlineText(source).filter((segment) => segment.type === "parameter").map((segment) => segment.value), [
    "@t.[First Name]", "@s.[API Host]", "@r.[123]", "@t.[price.total]", String.raw`@t.[closing\]]`, String.raw`@t.[folder\\file]`
  ]);
  assert.equal(resolveGherkinParameterText("When @t. is being edited", { "t.t": "incorrect" }), "When @t. is being edited");
  assert.equal(resolveGherkinParameterText("When <name> enters @t.[First Name]", { "r.name": "@s.tenant", "t.first name": "<name>", "s.tenant": "incorrect" }), "When @s.tenant enters <name>");
});


test("structured saves generate the first shared fragment and refresh stale behavior", () => {
  const steps = [{ action: "<p>Sign in with @t.user</p>", expected_result: "<p>Home is visible</p>" }];
  const expected = "When Sign in with @t.user\nThen Home is visible";
  assert.equal(syncSharedStepGherkin("", steps), expected);
  assert.equal(syncSharedStepGherkin("When Old action\nThen Old result", steps), expected);
  assert.equal(syncSharedStepGherkin(expected, []), "");
});

test("structured saves retain original Gherkin keywords and arguments for unchanged behavior", () => {
  const document = 'Given an account exists\nWhen submit the message\n  """\n  payload\n  """\nThen accepted\nAnd a receipt appears';
  const steps = sharedStepGherkinToStructuredSteps(document, { normalizeParameters: true });
  assert.equal(syncSharedStepGherkin(document, steps), document);
});
