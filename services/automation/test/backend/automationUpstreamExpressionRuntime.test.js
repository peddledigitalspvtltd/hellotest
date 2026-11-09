const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parse } = require('acorn');
const { bindUpstreamSourceParameters: bind, validateUpstreamSourceBoundary } = require('../../backend/lib/automationUpstreamSourceBindings');

const runtimeRoot = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? path.resolve(process.env.HELLOTEST_RUNTIME_TEST_BUILD)
  : path.resolve(__dirname, '../../../../testengine/backend/dist');
const runtime = Promise.all([
  import(pathToFileURL(path.join(runtimeRoot, 'lib/playwrightBindings.js')).href),
  import(pathToFileURL(path.join(runtimeRoot, 'lib/runtimeContext.js')).href)
]);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tree = source => parse(source, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true });
const parameterKeys = source => {
  const keys = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression' && node.object?.name === 'params') {
      assert.equal(node.computed, true, 'Generated bindings use ordinary computed JS members');
      assert.equal(node.property.type, 'Literal');
      keys.push(node.property.value);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  };
  visit(tree(source));
  return keys;
};

/** Exercise the actual compiled wrapper and context with no browser or target writes. */
async function fixture(values, { parameterExpressions = true, initialUrl = 'https://run.example/' } = {}) {
  const [{ createPlaywrightCodeBindings }, { buildInitialContext, interpolateText }] = await runtime;
  const context = buildInitialContext({ parameters_frozen: true, run_parameters: values });
  const params = Object.freeze(Object.assign(Object.create(null), context.values));
  const calls = [], locators = new Map();
  let interpolations = 0;
  const locator = (kind, args) => {
    calls.push([kind, ...args]);
    const key = JSON.stringify([kind, args]);
    if (!locators.has(key)) locators.set(key, {
      label: kind === 'role' ? args[1]?.name : '', value: undefined,
      count() { return 1; },
      click() { calls.push(['click', key]); },
      async fill(value) { calls.push(['fill', value]); this.value = value; }
    });
    return locators.get(key);
  };
  const nativePage = {
    currentUrl: initialUrl,
    url() { return this.currentUrl; },
    async goto(url) { calls.push(['goto', url]); this.currentUrl = url; },
    locator(selector) { return locator('locator', [selector]); },
    getByRole(role, options) { return locator('role', [role, options]); }
  };
  const bindings = createPlaywrightCodeBindings(nativePage, {
    parameterExpressions,
    interpolate: value => { interpolations++; return interpolateText(value, context); },
    resolveLocator: value => value,
    resolveUrl: value => value,
    assertionTimeout: 100
  });
  const expect = bindings.expect.extend({
    toHaveURL(actual, expected) {
      assert.equal(actual, nativePage);
      calls.push(['assert.url', expected]);
      return { pass: actual.currentUrl === expected, message: () => 'The composed URL must match the frozen Run value exactly.' };
    },
    toHaveValue(actual, expected) {
      calls.push(['assert.value', expected]);
      return { pass: actual.value === expected, message: () => 'The composed input value must match exactly.' };
    },
    toHaveText(actual, expected) {
      calls.push(['assert.text', expected]);
      return { pass: actual.label === expected, message: () => 'The full record identity must match exactly.' };
    }
  });
  return {
    calls, context, params, nativePage,
    get interpolations() { return interpolations; },
    execute: source => new AsyncFunction('page', 'expect', 'params', '"use strict";\n' + source)(bindings.page, expect, params)
  };
}

function expressions(source, parameterValues, extra = {}) {
  const result = bind({ source, parameterValues, ...extra, parameterExpressions: true });
  validateUpstreamSourceBoundary(result.source);
  assert.ok(parameterKeys(result.source).length, 'Opt-in binding must emit standard JS params members');
  assert.doesNotMatch(result.source, /["'`]@[tsr]\./i, 'Bound values cannot remain interpolation strings');
  return result;
}

test('expression binding closes an authored URL reference before a JS concatenated path', async () => {
  const source = 'await expect(page).toHaveURL("@r.orangehrm_url" + "client/#/dashboard");';
  const bound = expressions(source, { 'r.orangehrm_url': 'https://author.example/' });
  assert.deepEqual(parameterKeys(bound.source), ['r.orangehrm_url']);
  const state = await fixture({ 'r.orangehrm_url': 'https://run.example/' }, { initialUrl: 'https://run.example/client/#/dashboard' });
  assert.deepEqual(state.calls, [], 'Binding does not perform browser operations');
  await state.execute(bound.source);
  assert.deepEqual(state.calls, [['assert.url', 'https://run.example/client/#/dashboard']]);
  assert.equal(state.interpolations, 0, 'Expression programs must not reparse their final JS strings');
});

test('literal URL prefixes bind as JS expressions and keep their path through real Run bindings', async () => {
  const source = 'await page.goto("https://author.example/client/#/dashboard");\nawait expect(page).toHaveURL("https://author.example/client/#/dashboard");';
  const bound = expressions(source, { 'r.orangehrm_url': 'https://author.example/' });
  assert.deepEqual(parameterKeys(bound.source), ['r.orangehrm_url', 'r.orangehrm_url']);
  const state = await fixture({ 'r.orangehrm_url': 'https://different-run.example/' });
  await state.execute(bound.source);
  assert.deepEqual(state.calls, [
    ['goto', 'https://different-run.example/client/#/dashboard'],
    ['assert.url', 'https://different-run.example/client/#/dashboard']
  ]);
  assert.equal(state.interpolations, 0);
});

test('mixed full-record templates preserve existing JS name expressions and bind the template fragment', async () => {
  const source = 'await expect(page.getByRole("link", {name:`Onboarding - India for ${params["r.employee_first_name"]} ${params["r.employee_last_name"]}`,exact:true})).toHaveText(`Onboarding - India for ${params["r.employee_first_name"]} ${params["r.employee_last_name"]}`);';
  const bound = expressions(source, { 'r.onboarding_template': 'Onboarding - India' });
  for (const expression of ['params["r.employee_first_name"]', 'params["r.employee_last_name"]']) assert.equal(bound.source.split(expression).length - 1, 2);
  assert.equal(parameterKeys(bound.source).filter(key => key === 'r.onboarding_template').length, 2);
  const state = await fixture({
    'r.onboarding_template': 'Run template @r.other', 'r.employee_first_name': 'Current', 'r.employee_last_name': 'Record', 'r.other': 'MUST_NOT_EXPAND'
  });
  await state.execute(bound.source);
  const expected = 'Run template @r.other for Current Record';
  assert.deepEqual(state.calls, [['role', 'link', { name: expected, exact: true }], ['assert.text', expected]]);
  assert.equal(state.calls.filter(call => ['goto', 'fill', 'click'].includes(call[0])).length, 0);
  assert.equal(state.interpolations, 0);
});

test('inserted public values and token-looking email domains remain literal rather than recursively resolving', async () => {
  const source = 'await page.locator("#message").fill("Authoring message");\nawait expect(page.locator("#message")).toHaveValue("Authoring message");\nawait page.locator("#email").fill("author@example.test");\nawait expect(page.locator("#email")).toHaveValue("author@example.test");';
  const bound = expressions(source, { 'r.message': 'Authoring message', 'r.email': 'author@example.test' });
  const values = { 'r.message': '@r.other', 'r.email': 'reader+@r.other.test', 'r.other': 'MUST_NOT_EXPAND' };
  const state = await fixture(values);
  await state.execute(bound.source);
  assert.deepEqual(state.calls.filter(call => ['fill', 'assert.value'].includes(call[0])), [
    ['fill', values['r.message']], ['assert.value', values['r.message']],
    ['fill', values['r.email']], ['assert.value', values['r.email']]
  ]);
  assert.equal(state.interpolations, 0);
});

test('escaped parameter names and values stay valid JS and preserve literal data at execution', async () => {
  const name = 'r.quoted "name" ]\\part';
  const sample = 'Build "quoted" \\ path `tick` ${literal}\nline';
  const source = `await page.getByRole("textbox",{name:"Nickname",exact:true}).fill(${JSON.stringify(sample)});\nawait expect(page.getByRole("textbox",{name:"Nickname",exact:true})).toHaveValue(${JSON.stringify(sample)});`;
  const bound = expressions(source, { [name]: sample });
  assert.deepEqual(parameterKeys(bound.source), [name, name]);
  const value = 'Run "quoted" \\ path `tick` ${literal}\n@r.other';
  const state = await fixture({ [name]: value, 'r.other': 'MUST_NOT_EXPAND' });
  await state.execute(bound.source);
  assert.deepEqual(state.calls.filter(call => ['fill', 'assert.value'].includes(call[0])), [['fill', value], ['assert.value', value]]);
  assert.equal(state.interpolations, 0);
});

test('native secret environment references become standard params expressions without secret string rescanning', async () => {
  const env = 'HELLOTEST_R_PASSWORD';
  const source = `await page.locator("#password").fill(process.env[${JSON.stringify(env)}]);\nawait expect(page.locator("#password")).toHaveValue(${JSON.stringify(`<secret>${env}</secret>`)});`;
  const bound = expressions(source, { 'r.password': 'FAKE_AUTHORING_SECRET' }, { privateNames: ['r.password'], secretBindings: { [env]: 'r.password' } });
  assert.deepEqual(parameterKeys(bound.source), ['r.password', 'r.password']);
  assert.doesNotMatch(bound.source, /process\.env|FAKE_AUTHORING_SECRET|<secret>/);
  const state = await fixture({ 'r.password': '@r.other', 'r.other': 'MUST_NOT_EXPAND' });
  await state.execute(bound.source);
  assert.deepEqual(state.calls.filter(call => ['fill', 'assert.value'].includes(call[0])), [['fill', '@r.other'], ['assert.value', '@r.other']]);
  assert.equal(state.interpolations, 0);
});

test('binding changes only authored data positions and adds no navigation, clicks or repeated writes', async () => {
  const source = 'await page.locator("#Authoring message").fill("Authoring message");\nawait expect(page.locator("#Authoring message")).toHaveValue("Authoring message");';
  const bound = expressions(source, { 'r.message': 'Authoring message' });
  assert.equal(bound.source.split('"#Authoring message"').length - 1, 2);
  const state = await fixture({ 'r.message': 'Current value' });
  await state.execute(bound.source);
  assert.deepEqual(state.calls.filter(call => ['goto', 'fill', 'click'].includes(call[0])), [['fill', 'Current value']]);
  assert.deepEqual(state.calls.filter(call => call[0] === 'locator'), [['locator', '#Authoring message'], ['locator', '#Authoring message']]);
});

test('legacy token-string programs retain their single interpolation path when expression mode is off', async () => {
  const state = await fixture({ 'r.message': '@r.other', 'r.other': 'MUST_NOT_EXPAND' }, { parameterExpressions: false });
  await state.execute('await page.locator("#message").fill("@r.message");\nawait expect(page.locator("#message")).toHaveValue("@r.message");');
  assert.deepEqual(state.calls.filter(call => ['fill', 'assert.value'].includes(call[0])), [['fill', '@r.other'], ['assert.value', '@r.other']]);
  assert.ok(state.interpolations > 0);
});
