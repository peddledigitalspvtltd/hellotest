import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/admin/api.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(fetch) {
  const timers = new Map(), module = { exports: {} }; let timerId = 0;
  vm.runInNewContext(source, { exports: module.exports, module, window: { __HELLOTEST_CONFIG__: { API_BASE_URL: '/api' }, location: { origin: 'http://localhost:8081' } }, localStorage: { getItem: () => JSON.stringify({ token: 'fixture-admin' }), removeItem() {} }, fetch, AbortController, DOMException, URL, setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: id => timers.delete(id) });
  return { api: module.exports.adminApi, timers };
}
const ok = value => ({ ok: true, json: async () => value });
test('setup control requests use durable job endpoints, encode IDs, and retain cancellation/auth', async () => {
  const calls = []; const { api, timers } = fixture(async (url, options) => { calls.push({ url, options }); return ok({ running: false, job: null }); });
  await api.seedSamples(['planning']); await api.sampleSetupStatus({ jobId: 'job/one ?' }); await api.retrySampleSetup('job/one ?');
  assert.deepEqual(calls.map(call => [call.url, call.options.method || 'GET']), [['/api/admin-portal/setup/sample-data', 'POST'], ['/api/admin-portal/setup/sample-data/status?job_id=job%2Fone%20%3F', 'GET'], ['/api/admin-portal/setup/sample-data/job%2Fone%20%3F/retry', 'POST']]);
  assert.equal(calls[0].options.body, '{"modules":["planning"]}');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[2].options.body, undefined, 'Retries resume the saved module selection');
  for (const call of calls) { assert.equal(call.options.headers.Authorization, 'Bearer fixture-admin'); assert.ok(call.options.signal instanceof AbortSignal); }
  assert.equal(timers.size, 0, 'Every successful control request clears its deadline');
});
test('a stalled setup request times out once without replaying a potentially accepted POST', async () => {
  let calls = 0, signal;
  const { api, timers } = fixture((_url, options) => { calls++; signal = options.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); });
  const pending = api.seedSamples(['planning']);
  const deadline = [...timers.values()][0]; assert.equal(deadline.delay, 20000); deadline.callback();
  await assert.rejects(pending, /setup connection timed out.*saved setup status/);
  assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(timers.size, 0);
});
test('navigation cancellation stays an abort and clears the setup deadline', async () => {
  const upstream = new AbortController();
  const { api, timers } = fixture((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const pending = api.sampleSetupStatus({ signal: upstream.signal }); upstream.abort();
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(timers.size, 0);
});
test('invalid success bodies are rejected instead of being treated as a completed setup', async () => {
  const { api, timers } = fixture(async () => ok({}));
  await assert.rejects(api.sampleSetupStatus(), /response was incomplete/); assert.equal(timers.size, 0);
});
