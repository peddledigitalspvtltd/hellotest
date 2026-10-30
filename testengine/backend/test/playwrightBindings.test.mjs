import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.resolve(process.env.HELLOTEST_RUNTIME_TEST_BUILD, 'lib/playwrightBindings.js'))
  : new URL('../dist/lib/playwrightBindings.js', import.meta.url);
const { createPlaywrightCodeBindings } = await import(runtimeUrl.href);

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
