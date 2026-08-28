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
  for (const section of ["Background", "Examples"]) assert.match(editor, new RegExp(`label="${section}"`));
  assert.match(editor, /label=\{isOutline \? "Scenario Outline" : "Scenario"\}/);
  assert.match(editor, /gherkin-section-grid/);
  assert.match(editor, /gherkin-scenario-region/);
  assert.match(editor, /sections\.scenarios\.map/);
  assert.match(editor, /updateScenario\(index, "examples", nextExamples\)/);
  assert.match(editor, /Create table/);
  assert.match(editor, /Add row/);
  assert.match(editor, /lastEmittedDocumentRef/);
  assert.match(editor, /Insert starter/);
  assert.match(editor, /role=\{readOnly \? "region" : undefined\}/);
  assert.match(styles, /--gherkin-section:/);
  assert.match(styles, /--gherkin-code-bg:\s*#ffffff/);
  assert.match(styles, /--gherkin-code-text:\s*#101214/);
  assert.match(styles, /--gherkin-step:\s*#8f3f71/);
  assert.match(styles, /:root\[data-theme="dark"\] \.gherkin-editor \{[\s\S]*?--gherkin-code-text:\s*#f0f3f6;[\s\S]*?--gherkin-code-bg:\s*#14171c;/);
  assert.match(styles, /--speckit-code-bg:\s*#ffffff/);
  assert.match(styles, /--speckit-code-text:\s*#101214/);
  assert.match(styles, /:root\[data-theme="dark"\] \.speckit-editor \{[\s\S]*?--speckit-code-bg:\s*#171a20;[\s\S]*?--speckit-code-text:\s*#f0f3f6;/);
  assert.match(styles, /\.test-case-detail-primary \.gherkin-editor \.gherkin-highlight/);
  assert.match(styles, /\.gherkin-editor\.is-readonly/);
  assert.match(styles, /\.gherkin-editor\.is-compact/);
  assert.match(styles, /\.gherkin-section-card\.is-scenarios/);
  assert.match(styles, /\.gherkin-active-line/);
  assert.match(styles, /\.gherkin-scenario-region/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell textarea \{[\s\S]*?background:\s*transparent !important;[\s\S]*?-webkit-text-fill-color:\s*transparent !important;/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell \.gherkin-highlight \{[\s\S]*?z-index:\s*2 !important;[\s\S]*?background:\s*transparent !important;/);
  assert.match(styles, /\.test-case-workspace-shell \.test-case-details-form \.gherkin-code-shell textarea \{[\s\S]*?z-index:\s*4 !important;/);
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

test("scenario blocks preserve their own Examples when reordered or removed", () => {
  const source = [
    "Feature: Billing",
    "",
    "Scenario Outline: Pay with <method>",
    "  When payment uses <method>",
    "  Then it succeeds",
    "",
    "Examples:",
    "  | method |",
    "  | card   |",
    "",
    "Scenario Outline: Refund <channel>",
    "  When a refund uses <channel>",
    "  Then it succeeds",
    "",
    "Examples:",
    "  | channel |",
    "  | web     |"
  ].join("\n");
  const sections = splitGherkinDocument(source);
  const reordered = composeGherkinDocument({ ...sections, scenarios: [sections.scenarios[1], sections.scenarios[0]] });
  const reparsed = splitGherkinDocument(reordered);

  assert.match(reparsed.scenarios[0].scenario, /Refund <channel>/);
  assert.match(reparsed.scenarios[0].examples, /\| web\s+\|/);
  assert.match(reparsed.scenarios[1].scenario, /Pay with <method>/);
  assert.match(reparsed.scenarios[1].examples, /\| card\s+\|/);

  const afterRemoval = composeGherkinDocument({ ...reparsed, scenarios: reparsed.scenarios.slice(1) });
  assert.doesNotMatch(afterRemoval, /Refund/);
  assert.doesNotMatch(afterRemoval, /\| web\s+\|/);
  assert.match(afterRemoval, /Pay with <method>[\s\S]*\| card\s+\|/);
});

test("scenario tags remain attached to the behavior they qualify", () => {
  const sections = splitGherkinDocument([
    "Feature: Authentication",
    "",
    "Scenario: Password sign in",
    "  When valid credentials are submitted",
    "  Then access is granted",
    "",
    "@mobile @smoke",
    "Scenario: Biometric sign in",
    "  When a valid biometric is submitted",
    "  Then access is granted"
  ].join("\n"));

  assert.equal(sections.scenarios.length, 2);
  assert.doesNotMatch(sections.scenarios[0].scenario, /@mobile/);
  assert.match(sections.scenarios[1].scenario, /^@mobile @smoke\nScenario: Biometric/m);
  assert.match(composeGherkinDocument(sections), /@mobile @smoke\nScenario: Biometric/);
});

test("Gherkin draft composition preserves an editable trailing keyword space", () => {
  const sections = splitGherkinDocument("Feature: Login\n\nScenario: Sign in\n  Given an account");
  const next = replaceGherkinBackground(sections, "Background:\n  Given ");
  assert.match(composeGherkinDocument(next), /Background:\n  Given \n\nScenario:/);
});

test("Story and Test Case surfaces share the editor without destructive format switching", async () => {
  const [requirements, testCases, linkedDetails] = await Promise.all([
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/components/LinkedTestCaseModal.tsx")
  ]);

  assert.equal((requirements.match(/<GherkinEditor/g) || []).length >= 2, true);
  assert.match(requirements, /splitGherkinDocument\(normalized\)/);
  assert.match(requirements, /composeGherkinDocument/);
  assert.match(testCases, /role="tablist" aria-label="Step authoring mode"/);
  assert.match(testCases, /onKeyDown=\{handleTestCaseAuthoringTabKeyDown\}/);
  assert.match(testCases, /gherkin_document: caseDraft\.gherkin_document \|\| null/);
  assert.doesNotMatch(testCases, /gherkin_document: caseDraft\.authoring_mode === "gherkin" \? caseDraft\.gherkin_document : null/);
  assert.match(testCases, /buildGherkinQualitySteps\(caseDraft\.gherkin_document\)/);
  assert.match(testCases, /caseDraft\.authoring_mode === "gherkin" \? "Scenario completeness" : "Step completeness"/);
  assert.match(testCases, /authoringMode: caseDraft\.authoring_mode/);
  assert.match(testCases, /selectedTestCaseAssuranceSteps/);
  assert.match(linkedDetails, /hasGherkinDocument/);
  assert.match(linkedDetails, /<GherkinEditor[\s\S]*?readOnly/);
});
