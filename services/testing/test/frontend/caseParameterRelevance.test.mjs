import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaseParameterValues, collectAutomationCodeParameterNames, collectCaseStepParameters,
  extractStepParameterMatches, resolveStepParameterText
} from "../../../platform/frontend/src/shared/lib/stepParameters.ts";
import { caseParameterSaveOptions } from "../../../platform/frontend/src/shared/lib/parameterPrivacy.ts";

test("case inventory includes authored defaults and referenced suite/run inputs, never unrelated shared defaults", () => {
  const ownValues = { "t.account": "Alice", "r.blank": "", "t.saved_unused": "Keep authored data" };
  const availableValues = { ...ownValues, "s.tenant": "Acme", "s.unrelated": "Other case", "r.other_case": "Other run" };
  const parameters = collectCaseStepParameters({ ownValues, availableValues, steps: [{ id: "one", action: "Enter @t.account for @s.tenant", expected_result: "@r.receipt is recorded" }] });
  assert.deepEqual(parameters.map(parameter => parameter.name).sort(), ["r.blank", "r.receipt", "s.tenant", "t.account", "t.saved_unused"]);
  assert.deepEqual(ownValues, { "t.account": "Alice", "r.blank": "", "t.saved_unused": "Keep authored data" });
});

test("authoring discovers explicit scoped references and known legacy names without treating mentions, CSS or addresses as new inputs", () => {
  const text = "Use @email and @reviewer; copy customer@example.test, @playwright/test and @media; inspect @r.email, @t.[Full Name], @@s.bad and @t.";
  const matches = extractStepParameterMatches(text, { knownLegacyNames: ["r.email"] });
  assert.deepEqual(matches.map(match => match.name), ["r.email", "r.email", "t.full name"]);
  assert.equal(resolveStepParameterText("Use @email and @r.email", { "r.email": "person@example.test" }), "Use person@example.test and person@example.test", "legacy runtime references are preserved");
});

test("generated source inventories real params accesses without importing literal text, packages or comments", () => {
  const code = String.raw`import { test } from '@playwright/test';
    // Ignore params["t.comment"] and @r.comment
    const note = 'params["t.literal"]';
    const text = "@r.literal user@example.test @media";
    await page.getByLabel('Email').fill(params["r.email"]);
    await page.getByLabel('Name').fill(params['t.full name']);
    await page.getByLabel('Path').fill(params["t.folder\\file"]);
    expect(params['s.region']).toBe('IN');`;
  assert.deepEqual(collectAutomationCodeParameterNames(code), ["r.email", "t.full name", "t.folder\\file", "s.region"]);
  const definitions = collectCaseStepParameters({ steps: [{ id: "step", action: "Complete form", automation_code: code }] });
  assert.deepEqual(definitions.map(parameter => parameter.name).sort(), ["r.email", "s.region", "t.folder\\file", "t.full name"].sort());
});

test("source inventory parses regexes and template expressions and keeps executable argument references", () => {
  const code = 'const pattern = /params["t.regex"]/; const output = `${params["r.build"]}`; await page.fill("input", "@r.email"); await expect(page).toHaveTitle("@t.expected"); console.log("@r.log");';
  assert.deepEqual(collectAutomationCodeParameterNames(code).sort(), ['r.build', 'r.email', 't.expected']);
});

test("manual-to-automation inventories retain inherited empty/private bindings, scopes and linked columns without copying their values", () => {
  const input = {
    steps: [{ id: "one", action: "Use @r.email and @s.tenant", expected_result: "@t.receipt is visible" }],
    ownValues: { "r.empty": "", "r.email": "modified@example.test" },
    inheritedValues: { "r.email": "manual@example.test", "t.private_input": "private-manual-value", "t.private_empty": "" },
    availableValues: { "s.tenant": "Selected suite", "s.not_used": "Other case" },
    privateNames: ["t.private_input", "t.private_empty"],
    dataSet: { mode: "key_value", rows: [{ key: "r.email", value: "selected@example.test" }, { key: "r.secret_input", value: "dataset-secret-value", is_secret: true }] }
  };
  const before = structuredClone(input);
  const parameters = collectCaseStepParameters(input);
  for (const name of ["r.email", "r.empty", "s.tenant", "t.receipt", "t.private_input", "t.private_empty", "r.secret_input"]) assert.ok(parameters.some(parameter => parameter.name === name), name);
  assert.ok(!parameters.some(parameter => parameter.name === "s.not_used"));
  for (const name of ["t.private_input", "t.private_empty", "r.secret_input"]) assert.equal(parameters.find(parameter => parameter.name === name).sensitive, true);
  assert.doesNotMatch(JSON.stringify(parameters), /private-manual-value|dataset-secret-value|modified@example/);
  assert.deepEqual(input, before);
});

test("selected row defaults and deliberate overrides match build resolution without replacing empty values or changing source rows", () => {
  const source = { mode: "table", columns: ["r.email", "t.name"], rows: [{ "r.email": "first@example.test", "t.name": "First" }, { "r.email": "selected@example.test", "t.name": "Selected" }] };
  const selected = { ...source, rows: source.rows.slice(1, 2) };
  const inheritedValues = { "r.email": "manual@example.test", "t.name": "Manual", "t.untouched": "Keep" };
  const saved = { "r.email": "old-own@example.test" };
  assert.deepEqual(buildCaseParameterValues({ ownValues: saved, inheritedValues, dataSet: selected }), { "r.email": "selected@example.test", "t.name": "Selected", "t.untouched": "Keep" });
  const edits = { "r.email": "", "t.name": "Edited" };
  const options = caseParameterSaveOptions({}, edits, saved);
  assert.deepEqual(buildCaseParameterValues({ ownValues: edits, inheritedValues, dataSet: selected, overrideNames: options.parameter_overrides }), { "r.email": "", "t.name": "Edited", "t.untouched": "Keep" });
  assert.equal(source.rows[0]["r.email"], "first@example.test");
  assert.equal(source.rows[1]["r.email"], "selected@example.test");
});

test("an explicit choice of the already saved blank creates override intent, and chosen inherited overrides retain it", () => {
  const saved = { 'r.email': '' };
  const options = caseParameterSaveOptions({}, saved, saved, [], ['r.email']);
  assert.deepEqual(options.parameter_overrides, ['r.email']);
  const dataSet = {mode:'table',rows:[{'r.email':'dataset@example.test'}]};
  assert.equal(buildCaseParameterValues({ownValues:saved,dataSet,overrideNames:options.parameter_overrides})['r.email'], '');
  assert.equal(buildCaseParameterValues({inheritedValues:saved,dataSet,inheritedOverrideNames:['r.email']})['r.email'], '');
  assert.equal(buildCaseParameterValues({ownValues:{'r.email':'own-unreviewed'},inheritedValues:saved,dataSet,inheritedOverrideNames:['r.email']})['r.email'], 'dataset@example.test', 'inherited intent never promotes an unrelated own value');
});
