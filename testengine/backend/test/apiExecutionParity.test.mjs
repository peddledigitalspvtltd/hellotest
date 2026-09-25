import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const artifactRoot = await mkdtemp(path.join(tmpdir(), 'testengine-api-parity-'));
process.env.ARTIFACT_ROOT = artifactRoot;
const { executeApiStepInEngine } = await import('../dist/lib/apiEngine.js');
const { queueRunExecution, saveAcceptedRun } = await import('../dist/lib/executor.js');
const { buildAcceptedRun } = await import('../dist/lib/pipeline.js');
const { readJsonPathValue } = await import('../dist/lib/apiJsonPath.js');
test.after(() => rm(artifactRoot, { recursive: true, force: true }));

test('JSONPath captures preserve richer prototype selections without evaluating scripts', () => {
  const data = { items: [{ token: 'first' }, { token: 'second' }], 'a.b': { 'spaced key': 0 }, nil: null, empty: [] };
  for (const [query, expected] of [
    ['$.items[*].token', 'first'], ['$..token', 'first'], ['$.items[1:2].token', 'second'],
    ["$['a.b']['spaced key']", 0], ['$.nil', null], ['$.empty', []], ['$.items', data.items]
  ]) assert.deepEqual(readJsonPathValue(data, query), { found: true, value: expected }, query);
  assert.deepEqual(readJsonPathValue(false, '$'), { found: true, value: false });
  assert.equal(readJsonPathValue(data, '$.missing').found, false);
  assert.equal(readJsonPathValue(data, 'items[0]').found, false);
  assert.equal(readJsonPathValue(data, '$.constructor').found, false);
  assert.equal(readJsonPathValue(data, '$.items[?(@.token)]').found, false, 'script filters stay disabled');
});

test('queued and direct API runs share JSONPath assertions, captures, and authored timeouts', async (t) => {
  const responseBody = { users: [{ token: 'kept-token' }], 'release.name': 'R1', list: [1, 2] };
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => { timeouts.push(milliseconds); return new AbortController().signal; });
  let callback;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === 'http://callback.test/result') {
      callback = JSON.parse(options.body);
      return new Response('{}');
    }
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(responseBody);
  });
  const step = { id: 'step-1', order: 1, step_type: 'api', api_request: {
    url: 'http://app.test/data', timeout_ms: 45000,
    validations: [
      { kind: 'json_path', target: '$..token', expected: 'kept-token' },
      { kind: 'json_path', target: "$['release.name']", expected: 'R1' },
      { kind: 'json_path', target: '$.list', expected: '[1,2]' }
    ],
    captures: [{ path: '$.users[*].token', parameter: 'token' }]
  } };
  const envelope = {
    engine_run_id: 'api-parity', hellotest_run_id: 'run-1', hellotest_test_case_id: 'case-1',
    hellotest_test_case_title: 'API parity', steps: [step], artifact_policy: { video_mode: 'off' },
    callback: { url: 'http://callback.test/result', signing_secret: 'fixture-secret' }
  };
  const queued = await executeApiStepInEngine(envelope, step);
  assert.equal(queued.status, 'passed');
  assert.deepEqual(queued.captures, { token: 'kept-token' });
  const run = saveAcceptedRun(envelope, buildAcceptedRun(envelope));
  await queueRunExecution(envelope, run, { info() {}, error() {} });
  assert.equal(callback.case_result.status, 'passed');
  assert.deepEqual(callback.case_result.logs.stepCaptures['step-1'], queued.captures);
  assert.deepEqual(timeouts, [45000, 45000]);
});

test('API timeout remains attached while the response body is being read', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 1000, 'timeout is bounded to at least one second');
    return controller.signal;
  });
  let bodyStarted;
  const readingBody = new Promise(resolve => { bodyStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      bodyStarted();
    })
  }));
  const pending = executeApiStepInEngine({}, { api_request: { url: 'http://app.test/slow', timeout_ms: 1 } });
  const rejected = assert.rejects(pending, error => error.name === 'TimeoutError');
  await readingBody;
  controller.abort(new DOMException('API response deadline reached', 'TimeoutError'));
  await rejected;
});

test('direct runs report a failed case when an API deadline expires', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 30000, 'unconfigured requests have a bounded default');
    return controller.signal;
  });
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  let callback;
  t.mock.method(globalThis, 'fetch', async (url, { signal, body }) => {
    if (url === 'http://callback.test/result') {
      callback = JSON.parse(body);
      return new Response('{}');
    }
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      requestStarted();
    });
  });
  const envelope = {
    engine_run_id: 'api-deadline', hellotest_run_id: 'run-2', hellotest_test_case_id: 'case-2',
    steps: [{ id: 'slow', order: 1, step_type: 'api', api_request: { url: 'http://app.test/slow' } }],
    artifact_policy: { video_mode: 'off' }, callback: { url: 'http://callback.test/result', signing_secret: 'fixture-secret' }
  };
  const pending = queueRunExecution(envelope, saveAcceptedRun(envelope, buildAcceptedRun(envelope)), { info() {}, error() {} });
  await started;
  controller.abort(new DOMException('API request timed out', 'TimeoutError'));
  await pending;
  assert.equal(callback.case_result.status, 'failed');
  assert.match(callback.case_result.error, /timed out/);
});

test('unsupported direct-run steps fail without invoking a runner', async (t) => {
  let callback;
  t.mock.method(globalThis, 'fetch', async (url, { body }) => {
    assert.equal(url, 'http://callback.test/result', 'unsupported steps must not make a target request');
    callback = JSON.parse(body);
    return new Response('{}');
  });
  const envelope = {
    engine_run_id: 'unsupported-run', hellotest_run_id: 'run-3', hellotest_test_case_id: 'case-3',
    steps: [{ id: 'bad', order: 1, step_type: 'unified', api_request: { url: 'http://app.test/never' } }],
    artifact_policy: { video_mode: 'off' }, callback: { url: 'http://callback.test/result', signing_secret: 'fixture-secret' }
  };
  await queueRunExecution(envelope, saveAcceptedRun(envelope, buildAcceptedRun(envelope)), { info() {}, error() {} });
  assert.equal(callback.case_result.status, 'failed');
  assert.match(callback.case_result.error, /unsupported step type/);
});
