import assert from "node:assert/strict";
import test from "node:test";
import { annotateGherkinStepGroups, collectBehaviorRowGroups, composeBehaviorBlock, parseBehaviorBlock } from "../../frontend/lib/gherkinBehavior.ts";

test("minimal behavior edits retain scenario tags, comments, tables and doc strings", () => {
  const source = '@smoke\nScenario: Checkout\n  # setup\n  Given a request\n    """json\n    Given this is payload, not a behavior step\n    """\n  When the user pays\n    | method | amount |\n    | card | 10 |\n  Then approved';
  const parsed = parseBehaviorBlock(source);
  assert.equal(parsed.steps.length, 3);
  parsed.steps[1].text = "the user confirms payment";
  const result = composeBehaviorBlock(source, "Scenario", "Checkout", parsed.steps);
  assert.match(result, /^@smoke\nScenario: Checkout\n  # setup/);
  assert.match(result, /Given this is payload, not a behavior step/);
  assert.match(result, /When the user confirms payment\n    \| method \| amount \|/);
  assert.equal(parseBehaviorBlock(result).steps.length, 3);
});

test("shared group boundaries survive editing, insertion and movement with step arguments", () => {
  const source = 'Scenario: Sign in\n  When open page\n  Then login appears\n  When sign in\n  Then dashboard appears';
  const grouped = annotateGherkinStepGroups(source, [{ id: "group-1", name: "Login", lines: ["When sign in", "Then dashboard appears"] }]);
  const parsed = parseBehaviorBlock(grouped);
  assert.equal(parsed.steps[2].group?.name, "Login");
  parsed.steps[2].text = "sign in as @t.username";
  parsed.steps.splice(3, 0, { keyword: "And", text: "remember this device", group: parsed.steps[2].group });
  const result = composeBehaviorBlock(grouped, "Scenario", "Sign in", parsed.steps);
  assert.equal((result.match(/# Shared Step Group \[group-1\]/g) || []).length, 1);
  assert.equal(parseBehaviorBlock(result).steps.filter((step) => step.group?.id === "group-1").length, 3);
  assert.match(result, /sign in as @t\.username/);
});

test("identical shared groups keep distinct instance identities in insertion order", () => {
  const source = 'Scenario: Repeated setup\n  When open page\n  Then ready\n  When open page\n  Then ready';
  const result = annotateGherkinStepGroups(source, [
    { id: "first", name: "Setup", lines: ["When open page", "Then ready"] },
    { id: "second", name: "Setup", lines: ["When open page", "Then ready"] }
  ]);
  assert.deepEqual(parseBehaviorBlock(result).steps.map((step) => step.group?.id), ["first", "first", "second", "second"]);
});


test("saved row membership counts expected results within their action and retains inserted group rows", () => {
  const source = 'Scenario: Login\n  When open page\n  Then page appears\n  # Shared Step Group [login]: Login\n  When type username\n  Then username appears\n  And password is requested\n  When type password\n  Then sign in succeeds\n  # End Shared Step Group [login]';
  assert.deepEqual(collectBehaviorRowGroups(source).map((group) => group?.id), [undefined, "login", "login"]);
});
