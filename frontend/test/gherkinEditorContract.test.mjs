import assert from "node:assert/strict";
import test from "node:test";

import {
  composeGherkinDocument,
  matchGherkinKeyword,
  replaceGherkinBackground,
  replaceGherkinExamples,
  replaceGherkinScenarios,
  resolveGherkinParameterText,
  splitGherkinDocument,
  tokenizeGherkinInlineText
} from "../src/lib/gherkin.ts";
import { readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Gherkin syntax recognizes section, background, scenario, example, and step keywords", () => {
  const expectedKinds = [
    ["Feature: Checkout", "section", "Feature"],
    ["  Background:", "section", "Background"],
    ["  Scenario Outline: Pay with <method>", "section", "Scenario Outline"],
    ["    Given an account", "step", "Given"],
    ["    When payment starts", "step", "When"],
    ["    Then approval is shown", "step", "Then"],
    ["    Examples:", "section", "Examples"]
  ];

  expectedKinds.forEach(([line, kind, keyword]) => {
    const match = matchGherkinKeyword(line);
    assert.equal(match?.kind, kind, line);
    assert.equal(match?.keyword, keyword, line);
  });
});

test("Gherkin display resolves scoped and outline parameters without changing unresolved variables", () => {
  const source = [
    "Feature: Checkout",
    "  Background:",
    "    Given the tenant is @s.tenant",
    "  Scenario Outline: Pay as <role>",
    "    When <role> pays with @t.card",
    "    Then build @r.build is recorded and <missing> stays visible",
    "    Examples:",
    "      | role |",
    "      | buyer |"
  ].join("\n");

  const resolved = resolveGherkinParameterText(source, {
    "s.tenant": "HelloTest Demo",
    "t.role": "buyer",
    "t.card": "Visa 4242",
    "r.build": "2026.08.20"
  });

  assert.match(resolved, /Given the tenant is HelloTest Demo/);
  assert.match(resolved, /Scenario Outline: Pay as buyer/);
  assert.match(resolved, /When buyer pays with Visa 4242/);
  assert.match(resolved, /Then build 2026\.08\.20 is recorded and <missing> stays visible/);
  assert.match(source, /@s\.tenant/);
});

test("Gherkin tags are not mistaken for test-data parameters", () => {
  const source = "@smoke\nScenario: Tagged case\n  Given @t.smoke is enabled";
  const resolved = resolveGherkinParameterText(source, { "t.smoke": "feature flag" });

  assert.equal(resolved, "@smoke\nScenario: Tagged case\n  Given feature flag is enabled");
});

test("Gherkin inline syntax distinguishes parameters and quoted values from descriptions", () => {
  assert.deepEqual(tokenizeGherkinInlineText(' the user <role> enters "approved" using @t.account'), [
    { type: "text", value: " the user " },
    { type: "parameter", value: "<role>" },
    { type: "text", value: " enters " },
    { type: "string", value: '"approved"' },
    { type: "text", value: " using " },
    { type: "parameter", value: "@t.account" }
  ]);
});

test("shared Gherkin editor supports accessible preview and edit presentations", async () => {
  const [editor, styles] = await Promise.all([
    readSource("../src/components/GherkinEditor.tsx"),
    readSource("../src/styles.css")
  ]);

  assert.match(editor, /readOnly\?: boolean/);
  assert.match(editor, /useId\(\)/);
  assert.match(editor, /gherkin-line-numbers/);
  assert.match(editor, /Showing associated data values/);
  assert.match(editor, /Editing \$\{editingSection\} variables/);
  for (const section of ["Background", "Scenarios", "Examples"]) assert.match(editor, new RegExp(`label="${section}"`));
  assert.match(editor, /gherkin-section-grid/);
  assert.match(styles, /--gherkin-section:/);
  assert.match(styles, /--gherkin-code-bg:\s*#171a20/);
  assert.match(styles, /--gherkin-code-text:\s*#f0f3f6/);
  assert.match(styles, /--gherkin-step:\s*#ff7bcd/);
  assert.match(styles, /\.test-case-detail-primary \.gherkin-editor \.gherkin-highlight/);
  assert.match(styles, /\.gherkin-editor\.is-readonly/);
  assert.match(styles, /\.gherkin-editor\.is-compact/);
  assert.match(styles, /\.gherkin-section-card\.is-scenarios/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell textarea \{[\s\S]*?background:\s*transparent !important;[\s\S]*?-webkit-text-fill-color:\s*transparent !important;/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell \.gherkin-highlight \{[\s\S]*?z-index:\s*2 !important;[\s\S]*?background:\s*transparent !important;/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell textarea \{[\s\S]*?z-index:\s*1 !important;/);
});

test("sectioned Gherkin editing preserves Scenario Outline and Examples associations", () => {
  const source = [
    "@regression",
    "Feature: Checkout",
    "",
    "Background:",
    "  Given tenant @s.tenant is active",
    "",
    "Scenario Outline: Pay with <method>",
    "  When the buyer pays with <method>",
    "  Then the payment is approved",
    "",
    "Examples:",
    "  | method |",
    "  | card   |",
    "",
    "Scenario: Reject an expired card",
    "  When an expired card is submitted",
    "  Then the payment is declined"
  ].join("\n");

  const sections = splitGherkinDocument(source);
  assert.match(sections.preamble, /@regression/);
  assert.match(sections.background, /^Background:/);
  assert.equal(sections.scenarios.length, 2);
  assert.match(sections.scenarios[0].examples, /^Examples:/);
  assert.equal(composeGherkinDocument(sections), source);

  const withBackground = replaceGherkinBackground(sections, "Background:\n  Given a governed tenant");
  const withScenarios = replaceGherkinScenarios(withBackground, "Scenario Outline: Pay with <method>\n  When payment starts\n  Then approval is shown\n\nScenario: Refund\n  When a refund starts\n  Then it succeeds");
  const withExamples = replaceGherkinExamples(withScenarios, "Examples:\n  | method |\n  | wallet |");
  const recomposed = composeGherkinDocument(withExamples);
  assert.match(recomposed, /Given a governed tenant/);
  assert.match(recomposed, /Scenario Outline:[\s\S]*Examples:[\s\S]*Scenario: Refund/);
  assert.match(recomposed, /\| wallet \|/);
});
