const test = require('node:test'), assert = require('node:assert/strict');
const { compileRecordedProgram, recordedLocatorSource } = require('../../backend/lib/automationRecordedProgram');
const { normalizeGeneratedProgram, hasExecutableAssertion } = require('../../backend/lib/automationGeneratedProgram');
const { deriveProgramTools } = require('../../backend/lib/automationProgramTools');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const op = (name, args) => ({ name, arguments: args });
const check = (assertion, fields = {}) => op('browser_assert', { assertion, ...fields });
const compile = operations => { const result = compileRecordedProgram(operations); assert.ok(result); assert.equal(normalizeGeneratedProgram(result.source), result.source); return result; };
const derive = source => deriveProgramTools({ payload: { steps: [{ step_id: 'one', automation_code: source }] }, execution: { required: true, step_id: 'one' } });

test('recorded operations produce ordered native source with every intermediate action and original scoped data reference', () => {
  const requests = [
    op('browser_navigate', { url: 'https://selected.example/auth' }),
    op('browser_click', { locator: 'getByRole("button", {name:"Sign up"})' }),
    op('browser_fill', { locator: '#full-name', value: '@t.name' }),
    op('browser_fill', { locator: 'getByLabel("Email", {exact:false})', value: '@t.email' }),
    check('value', { locator: '#full-name', value: '@t.name' }),
    check('visible', { locator: 'getByRole("button", {name:"Create account"})' })
  ];
  const before = JSON.stringify(requests), result = compile(requests);
  assert.equal(JSON.stringify(requests), before);
  assert.equal(result.operation_count, 6); assert.equal(result.assertion_count, 2);
  assert.equal(result.source.split('\n').length, 7);
  assert.match(result.source, /await page\.getByRole\("button", \{"exact":true,"name":"Sign up"\}\)\.click\(\);/);
  assert.match(result.source, /const object1 = page\.locator\("#full-name"\);/);
  assert.match(result.source, /await object1\.fill\("@t.name"\);/);
  assert.match(result.source, /getByLabel\("Email", \{"exact":false\}\)/);
  assert.equal(hasExecutableAssertion(result.source), true);
  assert.deepEqual(derive(result.source).map(value => value.name), requests.map(value => value.name));
  assert.deepEqual(derive(result.source)[1], op('browser_click', { locator: 'getByRole("button", {"name":"Sign up","exact":true})' }));
});

test('locator rendering matches TestEngine exact defaults, native expressions, legacy aliases and explicit indices', () => {
  const cases = [
    ['getByLabel("Email")', 'page.getByLabel("Email", {"exact":true})'],
    ['page.getByRole("button", {name:"Save",exact:false})', 'page.getByRole("button", {"exact":false,"name":"Save"})'],
    ['getByText(`Ready`)', 'page.getByText("Ready", {"exact":true})'],
    ['getByTestId("continue")', 'page.getByTestId("continue")'],
    ['getByTestId("continue",{})', 'page.getByTestId("continue")'],
    ['getByPlaceholder("Your email")', 'page.getByPlaceholder("Your email", {"exact":true})'],
    ['getByTitle("Help")', 'page.getByTitle("Help", {"exact":true})'],
    ['getByAltText("Logo")', 'page.getByAltText("Logo", {"exact":true})'],
    ['locator("#email")', 'page.locator("#email")'],
    ['locator("#email",{})', 'page.locator("#email")'],
    ['role=button[name="Save"]', 'page.getByRole("button", {"name":"Save","exact":true})'],
    ['role=button[name="Save exact:false"]', 'page.getByRole("button", {"name":"Save exact:false","exact":false})'],
    ['role=button', 'page.getByRole("button")'],
    ['label="Email"', 'page.getByLabel("Email", {"exact":true})'],
    ['placeholder="Email"', 'page.getByPlaceholder("Email", {"exact":true})'],
    ['text="Ready"', 'page.getByText("Ready", {"exact":true})'],
    ['title="Help"', 'page.getByTitle("Help", {"exact":true})'],
    ['alt="Logo"', 'page.getByAltText("Logo", {"exact":true})'],
    ['alttext="Logo"', 'page.getByAltText("Logo", {"exact":true})'],
    ['testid=save', 'page.getByTestId("save")'],
    ['data-testid=save', 'page.getByTestId("save")'],
    ['#items > button.nth(2)', 'page.locator("#items > button").nth(2)'],
    ['getByRole("button").first()', 'page.getByRole("button", {"exact":true}).first()'],
    ['getByLabel("Email").last()', 'page.getByLabel("Email", {"exact":true}).last()'],
    ['XPATH=//input', 'page.locator("xpath=//input")']
  ];
  for (const [input, expected] of cases) {
    assert.equal(recordedLocatorSource(input), expected, input);
    assert.equal(normalizeGeneratedProgram(`await ${expected}.click();`), `await ${expected}.click();`);
    assert.equal(derive(`await ${expected}.click();`)[0].name, 'browser_click');
  }
  for (const locator of ['getByLabel(email)', 'getByRole("button",{name:/Save/})', 'getByRole("button",{name:"Save",hidden:true})', 'getByLabel("Email",{...opts})', 'getByLabel("Email").getByText("Value")', 'getByLabel("Email").first().last()', 'getByLabel("Email").nth(-1)', 'getByLabel("Email").nth(2001)', 'locator(\'getByRole("button")\')', 'locator("input.first()")', 'getByUnknown("Email")', 'getByLabel("Email"); globalThis.didRun=true', 'getByLabel?.("Email")', 'page?.getByLabel("Email")', 'page["getByLabel"]("Email")', 'playwrightPage.getByLabel("Email")', 'getByLabel("Email")["nth"](0)', '.first()']) {
    assert.equal(recordedLocatorSource(locator), null, locator);
  }
});

test('action compiler preserves empty strings, quotes, key combinations, selected values and optional check states', () => {
  const requests = [
    op('browser_hover', { locator: '#menu' }), op('browser_check', { locator: '#terms' }), op('browser_uncheck', { locator: '#newsletter' }),
    op('browser_fill', { locator: '#name', value: '' }), op('browser_fill', { locator: '#name', value: '"; globalThis.didRun=true; //\n🙂' }),
    op('browser_press_key', { locator: '#email', key: 'ControlOrMeta+A' }), op('browser_select_option', { locator: '#country', value: 'IN' }),
    op('browser_fill', { locator: '#name', value: 'params["t.name"]' })
  ];
  const result = compile(requests), lowered = derive(result.source);
  assert.equal(lowered.length, requests.length);
  assert.equal(lowered[4].arguments.value, requests[4].arguments.value);
  assert.equal(lowered[7].arguments.value, '@t.name');
  assert.equal(globalThis.didRun, undefined);
});

test('native assertion compilation keeps checked polarity, exact values and native textContent/title normalization semantics', () => {
  const requests = ['visible', 'hidden', 'checked', 'unchecked', 'enabled', 'disabled'].map(assertion => check(assertion, { locator: '#value' }));
  requests.push(check('count', { locator: '.row', value: '2' }), check('value', { locator: '#email', value: '@t.email' }),
    check('text_content', { locator: '#status', value: 'Saved' }), check('text_content_contains', { locator: '#status', value: 'Sav' }), check('title_normalized', { value: '  Account created ' }));
  const result = compile(requests);
  assert.equal(result.assertion_count, requests.length);
  assert.deepEqual(derive(result.source).map(request => request.arguments.assertion), requests.map(request => request.arguments.assertion));
  assert.match(result.source, /\.not\.toBeChecked\(\);/);
  assert.match(result.source, /\.toHaveText\("Saved"\);/);
  assert.match(result.source, /\.toContainText\("Sav"\);/);
  assert.match(result.source, /\.toHaveTitle\("  Account created "\);/);
});

test('native constraint validity compiles the fixed read-only candidate check and round-trips every predicate exactly', () => {
  for (const assertion of ['valid', 'invalid']) {
    const requests = [check(assertion, { locator: 'getByLabel("Contact", {exact:true})' })];
    const result = compile(requests);
    assert.equal(hasExecutableAssertion(result.source), true);
    assert.deepEqual(derive(result.source), [check(assertion, { locator: 'getByLabel("Contact", {"exact":true})' })]);
    assert.match(result.source, /willValidate !== true/);assert.match(result.source, /validity\.valid/);assert.match(result.source, /timeout: 8000/);
    assert.doesNotMatch(result.source, /checkValidity|reportValidity|validationMessage|\.value\b/);
    assert.equal(compileRecordedProgram([check(assertion, { locator: '#contact', value: '' })]), null);
    for (const modified of [
      result.source.replace('element.willValidate !== true', 'element.willValidate === true'),
      result.source.replace('return validity &&', 'element.value = "changed"; return validity &&'),
      result.source.replace('const validity = element.validity;', 'const validity = element.checkValidity();'),
      result.source.replace('timeout: 8000', 'timeout: 1'),
      result.source.replace('.toBe(', '.not.toBe('),
      result.source.replace('function readNativeConstraintValidity', 'function differentReader')
    ]) assert.equal(derive('await page.locator("#contact").fill("must-not-run");\n' + modified), null, 'a modified callback rejects the entire source before any action');
  }
});

test('field validation compiles and lowers only its exact read-only positive predicate', () => {
  const requests = [check('field_valid', { locator: '#full-name' })], result = compile(requests);
  assert.equal(hasExecutableAssertion(result.source), true);
  assert.deepEqual(derive(result.source), requests);
  assert.match(result.source, /aria-errormessage/);assert.match(result.source, /aria-invalid/);
  assert.match(result.source, /getRootNode/);assert.match(result.source, /count > 32/);
  assert.doesNotMatch(result.source, /checkValidity|reportValidity|validationMessage|element\.value/);
  assert.equal(compileRecordedProgram([check('field_valid', { locator: '#full-name', value: '' })]), null);
  for (const modified of [
    result.source.replace('.toBe(true)', '.toBe(false)'),
    result.source.replace('count > 32', 'count > 320'),
    result.source.replace("'aria-errormessage', 'aria-describedby'", "'aria-describedby'"),
    result.source.replace('validity.valid)', '!validity.valid)'),
    result.source.replace('timeout: 8000', 'timeout: 1'),
    result.source.replace('return true;', 'element.value = "changed"; return true;'),
    result.source.replace('function readFieldValidationState', 'function changedReader')
  ]) assert.equal(derive('await page.locator("#full-name").fill("must-not-run");\n' + modified), null);
  const maximum = compile(Array.from({ length: 12 }, () => requests[0]));
  assert.equal(derive(maximum.source)?.length, 12, 'the full supported tool batch remains within syntax bounds');
});

function runtime({ text = '', title = '', url = 'https://selected.example/', visible = true, params = {} } = {}) {
  const target = { async isVisible() { return typeof visible === 'function' ? visible() : visible; }, async innerText() { return typeof text === 'function' ? text() : text; } };
  const page = { locator: () => target, title: async () => title, url: () => url };
  const interpolate = value => typeof value === 'string' && /^@[tsr]\./.test(value) ? params[value.slice(1)] : value;
  const expect = () => { throw new Error('Unexpected native assertion in poll fixture'); };
  expect.poll = read => ({
    async toBe(expected) { expected = interpolate(expected); for (let attempt = 0; attempt < 4; attempt++) { if (Object.is(await read(), expected)) return; } assert.equal(await read(), expected); },
    async toContain(expected) { expected = interpolate(expected); for (let attempt = 0; attempt < 4; attempt++) { if ((await read()).includes(expected)) return; } assert.ok((await read()).includes(expected)); }
  });
  return { page, expect, params };
}
async function execute(operations, values) {
  const result = compile(operations), fixture = runtime(values);
  await new AsyncFunction('page', 'expect', 'params', result.source)(fixture.page, fixture.expect, fixture.params);
  return result;
}

test('visible text checks poll visible innerText with MCP whitespace semantics rather than native textContent semantics', async () => {
  const exact = [check('text', { locator: '#message', value: '  Account\n created  ' })];
  await execute(exact, { text: 'Account\t created' });
  await assert.rejects(execute(exact, { text: 'Account\t created', visible: false }));
  await assert.rejects(execute(exact, { text: 'Account\u200b created' }));
  await assert.rejects(execute(exact, { text: 'Account\u00ad created' }));
  let visibilityReads = 0, textReads = 0;
  await execute(exact, { visible: () => ++visibilityReads > 1, text: () => ++textReads > 1 ? 'Account created' : 'Loading' });
  assert.ok(visibilityReads > 1); assert.ok(textReads > 1);
  await execute([check('text_contains', { locator: '#message', value: 'Account\ncreated' })], { text: 'Success: Account\t created today' });
  await execute([check('text', { locator: '#message', value: '@t.[Display name]' })], { text: 'Jane Smith', params: { 't.display name': '  Jane\tSmith  ' } });
  const source = compile(exact).source;
  assert.equal(hasExecutableAssertion(source), true);
  assert.match(source, /expect\.poll/); assert.doesNotMatch(source, /toHaveText/);
});

test('raw title and URL assertions retain exact whitespace/address strings, while substring checks stay literal', async () => {
  await execute([check('title', { value: '  Sign\nup  ' })], { title: '  Sign\nup  ' });
  await assert.rejects(execute([check('title', { value: 'Sign up' })], { title: '  Sign\nup  ' }));
  await execute([check('url', { value: 'https://selected.example/signup?q=a.b' })], { url: 'https://selected.example/signup?q=a.b' });
  await assert.rejects(execute([check('url', { value: 'https://selected.example' })], { url: 'https://selected.example/' }));
  await execute([check('url_contains', { value: 'a.b[1]?' })], { url: 'https://selected.example/?q=a.b[1]?' });
  await assert.rejects(execute([check('url_contains', { value: 'a.b[1]?' })], { url: 'https://selected.example/?q=axb1' }));
  await execute([check('title', { value: '@t.title' })], { title: '  Exact title  ', params: { 't.title': '  Exact title  ' } });
  assert.equal(hasExecutableAssertion(compile([check('title', { value: 'Exact' })]).source), true);
});

test('parameterized normalized text never embeds private resolved values and count/URL references remain runtime-bound', () => {
  const result = compile([check('text', { locator: '#message', value: '@t.secret' }), check('count', { locator: '.row', value: '@t.count' }), check('url', { value: '@r.url' })]);
  assert.match(result.source, /String\(params\["t.secret"\]\)/);
  assert.match(result.source, /toHaveCount\(Number\(params\["t.count"\]\)\)/);
  assert.match(result.source, /page.url\(\)\)\.toBe\("@r.url"\)/);
  assert.doesNotMatch(result.source, /private resolved value/);
});

test('unsupported operations, malformed arguments and oversize source reject atomically without executing strings', () => {
  const invalid = [null, {}, op('browser_snapshot', {}), op('browser_evaluate', { code: 'globalThis.didRun=true' }),
    op('browser_click', { locator: '#button', force: 'true' }), op('browser_fill', { locator: '#email', value: 123 }),
    op('browser_click', { locator: '' }), op('browser_navigate', { url: '/relative' }), op('browser_navigate', { url: 'file:///secret' }),
    op('browser_navigate', { url: 'https://name:password@selected.example/' }),
    check('value', { locator: '#email' }), check('visible', { locator: '#email', value: 'ignored' }), check('visible', {}),
    check('title', { locator: '#ignored', value: 'Title' }), check('count', { locator: '.row', value: '02' }), check('count', { locator: '.row', value: '-1' }),
    check('count', { locator: '.row', value: '2001' }), check('unknown', { locator: '#email' }), check('url_contains', { value: '' })];
  for (const request of invalid) {
    assert.equal(compileRecordedProgram([request]), null, JSON.stringify(request));
    assert.equal(compileRecordedProgram([op('browser_click', { locator: '#valid' }), request]), null, JSON.stringify(request));
  }
  assert.equal(compileRecordedProgram([]), null);
  assert.equal(compileRecordedProgram(Array.from({ length: 251 }, () => op('browser_click', { locator: '#button' }))), null);
  assert.equal(compileRecordedProgram([op('browser_fill', { locator: '#email', value: 'x'.repeat(2001) })]), null);
  assert.equal(compileRecordedProgram(Array.from({ length: 40 }, () => op('browser_fill', { locator: '#email', value: 'x'.repeat(2000) }))), null);
  assert.equal(globalThis.didRun, undefined);
});
