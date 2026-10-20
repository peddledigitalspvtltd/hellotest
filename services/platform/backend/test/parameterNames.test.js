const test = require('node:test');
const assert = require('node:assert/strict');
const {collectCaseParameterNames, collectCodeParameterNames} = require('../src/utils/parameterNames');
const {resolveParameterLayers} = require('../src/utils/stepParameterResolution');

test('source parameter inventory uses actual data accesses, preserving scopes while ignoring imports and inert strings', () => {
  const code = String.raw`import { test } from '@playwright/test';
    // params["t.comment"] and @r.comment are not declarations.
    const note = 'params["t.literal"] @r.literal';
    const pattern = /params["t.regex"]/;
    await page.getByLabel('Email').fill(params["r.email"]);
    await page.getByLabel('Name').fill(params['t.full name']);
    await page.fill('#selector', String(params["s.tenant"]));
    await page.fill('#output', \`prefix-\${params["r.output"]}\`);`;
  // Template source is authored separately to avoid evaluating it in the test.
  const source = code.replaceAll('\\`','`').replaceAll('\\${','${');
  assert.deepEqual(collectCodeParameterNames(source), ['r.email','t.full name','s.tenant','r.output']);
  assert.deepEqual(collectCaseParameterNames({parameter_values:{'t.empty':''}}, [{action:'Use @r.email', automation_code:source}]).sort(), ['r.email','r.output','s.tenant','t.empty','t.full name']);
});

test('legacy executable argument references remain discoverable only on runtime binding surfaces', () => {
  const code = `await page.getByLabel("@t.email_label").fill("@r.email");
    await expect(page.locator('#message')).toHaveText("@t.expected");
    await web.goto("@r.start_url");
    console.log("@r.logging"); const description = "@t.description";`;
  assert.deepEqual(collectCodeParameterNames(code).sort(), ['t.email_label','r.email','t.expected','r.start_url'].sort());
});

test('malformed source cannot invent parameters by falling back to text scanning', () => {
  assert.deepEqual(collectCodeParameterNames('const broken = "@r.not_an_input"; await page.fill('), []);
  assert.deepEqual(collectCodeParameterNames('await page.fill("input", params[key]);'), []);
});

test('parameter discovery leaves selected dataset values and explicit empty case overrides untouched', () => {
  const dataSet = {mode:'table', rows:[{'r.email':'selected@example.test','t.name':'Selected'}], parameter_data_layers:{case:{rows:[{'r.email':'selected@example.test','t.name':'Selected'}]}}, data_scope_policy:{version:2,case:{parameter_overrides:['r.email']},suite:{},run:{}}};
  const input = {caseValues:{'r.email':'','t.name':'Saved'}, suiteValues:{'s.tenant':'Suite'}, dataSet};
  const before = structuredClone(input);
  collectCaseParameterNames({parameter_values:input.caseValues}, [{automation_code:'await page.fill("input",params["r.email"]);'}]);
  assert.deepEqual(resolveParameterLayers(input), {'r.email':'','t.name':'Selected','s.tenant':'Suite'});
  assert.deepEqual(input,before);
});
