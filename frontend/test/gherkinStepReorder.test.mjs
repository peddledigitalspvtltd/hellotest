import assert from "node:assert/strict";
import test from "node:test";
import { canMoveGherkinStep, gherkinDropPosition, moveGherkinStep } from "../src/lib/gherkinStepReorder.ts";
import { composeBehaviorBlock, parseBehaviorBlock } from "../src/lib/gherkinBehavior.ts";
import { composeSharedStepGherkin, parseSharedStepGherkin } from "../src/lib/gherkin.ts";

test("any step can move directly to every final position without mutating the source", () => {
  const original = Array.from({ length: 6 }, (_, index) => ({ text: `Step ${index + 1}` }));
  const snapshot = [...original];
  for (let from = 0; from < original.length; from++) {
    for (let to = 0; to < original.length; to++) {
      const result = moveGherkinStep(original, from, to);
      assert.equal(result[to], original[from]);
      assert.deepEqual(result.filter((_, index) => index !== to), original.filter((_, index) => index !== from));
      assert.equal(new Set(result).size, original.length);
    }
  }
  assert.deepEqual(original, snapshot);
});

test("drops account for the removed source when moving before and after distant rows", () => {
  assert.equal(gherkinDropPosition(0, 5, true), 5);
  assert.equal(gherkinDropPosition(0, 5, false), 4);
  assert.equal(gherkinDropPosition(5, 0, false), 0);
  assert.equal(gherkinDropPosition(5, 0, true), 1);
  assert.equal(gherkinDropPosition(2, 2, false), 2);
  assert.equal(gherkinDropPosition(2, 2, true), 2);
});

test("case reordering carries doc strings, tables, comments and source parameter references", () => {
  const source = '@smoke\nScenario: Signup\n  Given a message\n    """\n    Given @t.message is payload\n    """\n  When send @t.message\n  And record the rows\n    | id |\n    | @t.id |\n  Then delivery succeeds\n  # verify delivery';
  const parsed = parseBehaviorBlock(source);
  const moved = moveGherkinStep(parsed.steps, 0, 3);
  const result = composeBehaviorBlock(source, "Scenario", "Signup", moved);
  assert.match(result, /^@smoke\nScenario: Signup\n  When send @t.message/);
  assert.match(result, /Then delivery succeeds\n  # verify delivery\n  Given a message\n    """\n    Given @t.message is payload\n    """$/);
  assert.deepEqual(parseBehaviorBlock(result).steps, moved);
});

test("shared group reordering carries the entire argument across multiple positions", () => {
  const source = 'Given the account\nWhen submit the message\n  """\n  Then this is message content\n  """\nAnd log the event\nThen accepted\nAnd record the rows\n  | name |\n  | @t.name |';
  const steps = parseSharedStepGherkin(source);
  const moved = moveGherkinStep(steps, 4, 0);
  const result = composeSharedStepGherkin(moved);
  assert.match(result, /^And record the rows\n  \| name \|\n  \| @t.name \|\nGiven the account/);
  assert.deepEqual(parseSharedStepGherkin(result), moved);
});

test("linked instance members stay grouped while standalone steps can cross whole groups", () => {
  const source = 'Scenario: Sign in\n  Given before\n  # Shared Step Group [login]: Login\n  When first\n  And second\n  And third\n  Then fourth\n  # End Shared Step Group [login]\n  Then after';
  const steps = parseBehaviorBlock(source).steps;
  const grouped = moveGherkinStep(steps, 1, 4);
  assert.equal(grouped[4].text, "first");
  assert.equal(grouped.slice(1, 5).every((step) => step.group?.id === "login"), true);
  assert.equal(canMoveGherkinStep(steps, 1, 5), false);
  assert.equal(canMoveGherkinStep(steps, 0, 2), false);
  assert.equal(canMoveGherkinStep(steps, 5, 3), false);
  assert.equal(moveGherkinStep(steps, 0, 5)[5].text, "before");
  assert.equal(moveGherkinStep(steps, 5, 0)[0].text, "after");
  const document = composeBehaviorBlock(source, "Scenario", "Sign in", grouped);
  assert.equal((document.match(/# Shared Step Group/g) || []).length, 1);
  assert.deepEqual(parseBehaviorBlock(document).steps, grouped);
});

test("invalid and cancelled moves retain the original list", () => {
  const steps = [{ text: "First" }, { text: "Last" }];
  for (const [from, to] of [[-1, 1], [0, 2], [2, 0], [0, NaN], [0, 0.5], [1, 1]]) {
    assert.equal(moveGherkinStep(steps, from, to), steps);
  }
});
