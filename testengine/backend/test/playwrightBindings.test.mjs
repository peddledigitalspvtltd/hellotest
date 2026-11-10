import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { errors } from 'playwright';

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.resolve(process.env.HELLOTEST_RUNTIME_TEST_BUILD, 'lib/playwrightBindings.js'))
  : new URL('../dist/lib/playwrightBindings.js', import.meta.url);
const { createPlaywrightCodeBindings, runPlaywrightClick, usesExpressionParameterBindings, PARAMETER_EXPRESSIONS_MARKER } = await import(runtimeUrl.href);
const { interpolateText } = await import(new URL('./runtimeContext.js', runtimeUrl).href);

test('only an exact leading portable marker enables expression mode', () => {
  for (const source of [PARAMETER_EXPRESSIONS_MARKER, `${PARAMETER_EXPRESSIONS_MARKER}\nawait page.goto(params["r.url"]);`, `\ufeff \n// ordinary comment\n/* options */\n${PARAMETER_EXPRESSIONS_MARKER}\nawait page.goto(params["r.url"]);`, `// @hellotest-options screenshotOnFailure\r\n${PARAMETER_EXPRESSIONS_MARKER}\r\nawait page.goto(params["r.url"]);`]) assert.equal(usesExpressionParameterBindings(source), true);
  for (const source of [undefined, '', `/* ${PARAMETER_EXPRESSIONS_MARKER} */`, `const note=${JSON.stringify(PARAMETER_EXPRESSIONS_MARKER)};`, `const note=\`${PARAMETER_EXPRESSIONS_MARKER}\`;`, `await page.goto("/");\n${PARAMETER_EXPRESSIONS_MARKER}`, PARAMETER_EXPRESSIONS_MARKER.replace('v1', 'v2'), PARAMETER_EXPRESSIONS_MARKER+' extra']) assert.equal(usesExpressionParameterBindings(source), false);
});

test('an unrelated hash change cannot commit an accepted click pending a different document', async () => {
  let currentUrl = 'https://fixture.test/form', readiness = 0, settled = false;
  const frame = { url: () => currentUrl }, page = Object.assign(new EventEmitter(), { mainFrame: () => frame });
  const request = { isNavigationRequest: () => true, frame: () => frame, url: () => 'https://fixture.test/saved' };
  const timeout = new errors.TimeoutError('locator.click: Timeout 500ms exceeded.\nCall log:\n  - click action done\n  - waiting for scheduled navigations to finish\n');
  const running = runPlaywrightClick(page, async () => {
    page.emit('request', request);
    currentUrl += '#unrelated'; page.emit('framenavigated', frame);
    throw timeout;
  }, { navigationTimeout: 2000, afterNavigation: async () => { readiness++; } });
  running.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(readiness, 0);
  currentUrl = 'https://fixture.test/saved#profile'; page.emit('framenavigated', frame);
  await running;
  assert.equal(readiness, 1); assert.equal(page.listenerCount('request'), 0); assert.equal(page.listenerCount('framenavigated'), 0);
});

test('completed-click proof accepts exact production navigation logs and rejects actionability or unrelated tails', async () => {
  const production = [
    "  - waiting for getByRole('button', { name: 'Login' })",
    '    - locator resolved to <button type="submit">…</button>',
    '  - attempting click action',
    '    - waiting for element to be visible, enabled and stable',
    '    - element is visible, enabled and stable',
    '    - scrolling into view if needed',
    '    - done scrolling',
    '    - performing click action',
    '    - click action done',
    '    - waiting for scheduled navigations to finish'
  ].join('\n');
  const navigation = '    - navigated to "https://jayarajum-trials821.orangehrmlive.com/auth/validateCredentials"';
  const variants = [
    ['waiting only', production, true],
    ['actual production committed tail', `${production}\n${navigation}`, true],
    ['multiple observed navigation tails', `${production}\n${navigation}\n    - navigated to "https://fixture.test/dashboard"`, true],
    ['navigation finished', `${production}\n${navigation}\n    - navigations have finished`, true],
    ['known native lifecycle progress', `${production}\n${navigation}\n    - "domcontentloaded" event fired\n    - "load" event fired`, true],
    ['ANSI and CRLF', `${production}\n${navigation}`.split('\n').map(line => `\u001b[2m${line}\u001b[22m`).join('\r\n'), true],
    ['actionability failure', production.split('    - performing click action')[0], false],
    ['no completion marker', production.replace('click action done', 'element is not visible'), false],
    ['trial completion', production.replace('click action done', 'trial click action done'), false],
    ['no navigation wait', production.replace('waiting for scheduled navigations to finish', 'waiting for element to be visible'), false],
    ['new action attempt', `${production}\n${navigation}\n  - attempting click action`, false],
    ['later actionability failure', `${production}\n${navigation}\n  - element is not enabled`, false],
    ['retry after completed navigation', `${production}\n${navigation}\n  - retrying click action`, false],
    ['unrecognized progress', `${production}\n${navigation}\n  - browser command failed`, false],
    ['unrecognized lifecycle', `${production}\n${navigation}\n  - "click" event fired`, false]
  ];
  for (const [label, log, allowed] of variants) {
    let url = 'https://fixture.test/form', calls = 0, ready = 0;
    const frame = { url: () => url }, page = Object.assign(new EventEmitter(), { mainFrame: () => frame });
    const request = { isNavigationRequest: () => true, frame: () => frame, url: () => 'https://fixture.test/saved' };
    const error = new errors.TimeoutError(`locator.click: Timeout 5000ms exceeded.\nCall log:\n${log}\n`);
    const run = () => runPlaywrightClick(page, async () => {
      calls++; page.emit('request', request); url = request.url(); page.emit('framenavigated', frame); throw error;
    }, { navigationTimeout: 30000, afterNavigation: async () => { ready++; } });
    if (allowed) { await run(); assert.equal(ready, 1, label); }
    else { await assert.rejects(run(), actual => actual === error, label); assert.equal(ready, 0, label); }
    assert.equal(calls, 1, `${label}: the click is never repeated`);
    assert.equal(page.listenerCount('request'), 0, label);
  }
});

test('expression mode keeps inserted values literal across native actions, nested options, URLs and expectations', async () => {
  const calls=[],resolved=[];let interpolations=0;
  const context={values:{'r.value':'@r.other','r.other':'UNEXPECTED_EXPANSION'}};
  const locator={count(){return 1;},click(){},fill(value){calls.push(['fill',value]);},selectOption(value){calls.push(['select',value]);}};
  const native={goto(...args){calls.push(['goto',...args]);},locator(){return locator;},setExtraHTTPHeaders(value){calls.push(['headers',value]);}};
  const {page,expect}=createPlaywrightCodeBindings(native,{parameterExpressions:true,
    interpolate:value=>{interpolations++;return interpolateText(value,context);},resolveLocator:value=>{resolved.push(value);return value==='@repo.field'?'#field':value;},resolveUrl:value=>value,assertionTimeout:100});
  page.locator('@repo.field').fill(context.values['r.value']);
  page.locator('#field').selectOption({label:context.values['r.value']});
  page.setExtraHTTPHeaders({'x-literal':context.values['r.value']});
  page.goto('https://fixture.test/path?next=@r.other');
  expect(context.values['r.value']).toBe('@r.other');
  expect({email:'reader+@r.other.test',items:['@r.other']}).toEqual({email:'reader+@r.other.test',items:['@r.other']});
  assert.deepEqual(calls,[['fill','@r.other'],['select',{label:'@r.other'}],['headers',{'x-literal':'@r.other'}],['goto','https://fixture.test/path?next=@r.other',{waitUntil:'commit'}]]);
  assert.deepEqual(resolved,['@repo.field','#field'],'Repository resolution stays explicit and active');
  assert.equal(interpolations,0);
});

function fixture() {
  const values = { 't.email': 'reader@example.test', 't.other': 'another@example.test', 't.label': 'Signed in' };
  const locator = { count() { return 1; }, click() {}, fill(value) { this.value = value; } };
  const page = { goto() {}, locator() { return locator; } };
  const bindings = createPlaywrightCodeBindings(page, {
    interpolate: value => value.replace(/@(?:t\.)[a-z]+/g, reference => values[reference.slice(1)] ?? ''),
    resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 500
  });
  return { ...bindings, values, locator };
}

test('matcher arguments resolve current parameters across synchronous, async, negated and polling expectations', async () => {
  const { expect, values } = fixture();
  assert.equal(expect(values['t.email']).toBe('@t.email'), undefined);
  expect(values['t.email']).not.toBe('@t.other');
  expect({ email: values['t.email'], nested: [values['t.label']] }).toEqual({ email: '@t.email', nested: ['@t.label'] });
  await expect(Promise.resolve(values['t.email'])).resolves.toBe('@t.email');
  await expect(Promise.reject(new Error(values['t.label']))).rejects.toThrow('@t.label');
  expect.soft(values['t.email']).toBe('@t.email');
  let polls = 0;
  await expect.poll(async () => { polls++; return values['t.email']; }).toBe('@t.email');
  assert.ok(polls > 0);
  values['t.email'] = 'updated@example.test';
  expect.configure({ timeout: 100 })(values['t.email']).toBe('@t.email');
  await expect.configure({ timeout: 100 }).poll(() => values['t.email']).not.toBe('@t.other');
});

test('locator expected values use the same resolution as fill while native types and identities survive', () => {
  const { expect, page, locator, values } = fixture();
  const wrapped = page.locator('#email');
  wrapped.fill('@t.email');
  const pattern = /@t\.email/;
  const callback = () => 'unchanged';
  class Marker {}
  const instance = new Marker();
  const custom = expect.extend({
    toHaveResolvedValue(actual, expected, options) {
      assert.equal(actual, locator);
      assert.equal(actual.value, expected);
      assert.equal(expected, values['t.email']);
      assert.equal(options.pattern, pattern);
      assert.equal(options.callback, callback);
      assert.equal(options.klass, Marker);
      assert.equal(options.instance, instance);
      assert.deepEqual(options.flags, [true, 2, null]);
      return { pass: true, message: () => 'Values match' };
    }
  });
  custom(wrapped).toHaveResolvedValue('@t.email', { pattern, callback, klass: Marker, instance, flags: [true, 2, null] });
  custom.configure({ timeout: 100 })(wrapped).toHaveResolvedValue('@t.email', { pattern, callback, klass: Marker, instance, flags: [true, 2, null] });
  const actual = { unchanged: 5 };
  expect(actual).toBe(actual);
  expect(pattern).toBe(pattern);
  expect(callback).toBe(callback);
});

test('asymmetric matchers interpolate expected references without modifying source inputs or native matcher results', () => {
  const { expect, values } = fixture();
  const source = { email: '@t.email' };
  expect({ email: values['t.email'], count: 1 }).toEqual(expect.objectContaining(source));
  expect(values['t.email']).toEqual(expect.stringContaining('@t.email'));
  expect(values['t.email']).toEqual(expect.not.stringContaining('@t.other'));
  expect(3).toEqual(expect.any(Number));
  assert.equal(source.email, '@t.email');
  assert.throws(() => expect('wrong').toBe('@t.email'));
});

test('keyboard, wait URL and upload paths share late binding while file payload bytes remain untouched', async () => {
  const calls = [];
  const values = {'t.key':'Tab','t.url':'https://fixture.test/next','t.file':'/tmp/first.txt'};
  const locator = {count(){return 1;},click(){},setInputFiles(...args){calls.push(['locator.files',...args]);}};
  const native = {goto(){},locator(){return locator;},waitForURL(...args){calls.push(['url',...args]);},setInputFiles(...args){calls.push(['page.files',...args]);},keyboard:{press(...args){calls.push(['key',...args]);},insertText(...args){calls.push(['text',...args]);}}};
  const {page} = createPlaywrightCodeBindings(native, {interpolate:value=>value.replace(/@t\.(key|url|file)/g,token=>values[token.slice(1)]),resolveLocator:value=>value,resolveUrl:value=>value,assertionTimeout:500});
  await page.keyboard.press('@t.key');
  await page.waitForURL('@t.url');
  await page.locator('#file').setInputFiles(['@t.file']);
  await page.setInputFiles('#file','@t.file');
  values['t.key']='Enter';values['t.file']='/tmp/second.txt';
  await page.keyboard.press('@t.key');await page.keyboard.insertText('@t.key');
  await page.locator('#file').setInputFiles('@t.file');
  const payload={name:'@t.file',mimeType:'text/plain',buffer:Buffer.from('@t.file')};
  await page.locator('#file').setInputFiles(payload);
  assert.deepEqual(calls.slice(0,7),[['key','Tab'],['url','https://fixture.test/next'],['locator.files',['/tmp/first.txt']],['page.files','#file','/tmp/first.txt'],['key','Enter'],['text','Enter'],['locator.files','/tmp/second.txt']]);
  assert.equal(calls[7][1],payload);assert.equal(payload.buffer.toString(),'@t.file');
});

test('condition waits use the configured assertion timeout and preserve explicit timeouts', async () => {
  const waits=[];
  const locator={count(){return 1;},click(){},waitFor(options){waits.push(options);}};
  const calls=[];
  const native={goto(){},locator(){return locator;},waitForSelector(...args){calls.push(['selector',...args]);},waitForFunction(...args){calls.push(['function',...args]);}};
  const {page}=createPlaywrightCodeBindings(native,{interpolate:value=>value,resolveLocator:value=>value,resolveUrl:value=>value,assertionTimeout:45_000});
  const predicate=()=>Boolean(document.querySelector('#dashboard'));

  await page.locator('#dashboard').waitFor({state:'visible'});
  await page.locator('#dashboard').waitFor({state:'visible',timeout:3_000});
  await page.waitForSelector('#dashboard',{state:'visible'});
  await page.waitForFunction(predicate);

  assert.deepEqual(waits,[{state:'visible',timeout:45_000},{state:'visible',timeout:3_000}]);
  assert.deepEqual(calls,[
    ['selector','#dashboard',{state:'visible',timeout:45_000}],
    ['function',predicate,undefined,{timeout:45_000}]
  ]);
});
