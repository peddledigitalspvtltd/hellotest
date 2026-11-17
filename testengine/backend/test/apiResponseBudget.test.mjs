import test from 'node:test';
import assert from 'node:assert/strict';
import { executeApiStepInEngine } from '../dist/lib/apiEngine.js';
import { apiResponsePreview, readApiResponseBody } from '../dist/lib/apiResponseBody.js';

const step = { id: 'request', order: 1, step_type: 'api', api_request: { method: 'GET', url: 'https://api.fixture/data', validations: [], captures: [] } };

test('declared and streaming API response limits cancel the original body without a retry', async t => {
  const previous = process.env.TESTENGINE_API_RESPONSE_MAX_BYTES;
  process.env.TESTENGINE_API_RESPONSE_MAX_BYTES = '1024';
  t.after(() => previous === undefined ? delete process.env.TESTENGINE_API_RESPONSE_MAX_BYTES : process.env.TESTENGINE_API_RESPONSE_MAX_BYTES = previous);
  let dispatches = 0, cancellations = 0, declared = true;
  t.mock.method(globalThis, 'fetch', async () => {
    dispatches++;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(600)); controller.enqueue(new Uint8Array(600)); },
      cancel() { cancellations++; }
    }), { status: 201, headers: declared ? { 'content-length': '1200' } : {} });
  });
  for (const hasLength of [true, false]) {
    declared = hasLength;
    const result = await executeApiStepInEngine({}, {...step,api_request:{...step.api_request,method:'POST',captures:[{path:'$.id',parameter:'id'}]}});
    assert.equal(result.status, 'failed');
    assert.equal(result.detail.response.status, 201, 'The HTTP status survives a response-body limit failure.');
    assert.equal(result.detail.response.body_truncated, true);
    assert.equal(result.detail.response.json, null);
    assert.deepEqual(result.captures, {});
    assert.deepEqual(result.detail.assertions.map(row=>row.kind), ['response_body']);
    assert.match(result.note, /no assertions or captures/);
  }
  assert.equal(dispatches, 2, 'Each logical request dispatches once even when its body is too large.');
  assert.equal(cancellations, 2);
});

test('a stalled API body observes the same caller cancellation and releases its reader', async () => {
  const controller = new AbortController();
  let reading, cancelled = false;
  const started = new Promise(resolve => { reading = resolve; });
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); }, pull() { reading(); }, cancel() { cancelled = true; } }));
  const readingBody = readApiResponseBody(response, controller.signal);
  await started;
  controller.abort(new DOMException('Run stopped', 'AbortError'));
  await assert.rejects(readingBody, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('large API response previews are disclosed while assertions and captures use the complete response', async t => {
  const body = { padding: '界'.repeat(30_000), result: 'tail-result' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const result = await executeApiStepInEngine({}, { ...step, api_request: { ...step.api_request,
    validations: [{ kind: 'json_path', target: '$.result', expected: 'tail-result' }], captures: [{ parameter: 'result', path: '$.result' }] } });
  assert.equal(result.status, 'passed');
  assert.equal(result.captures.result, 'tail-result');
  assert.equal(result.detail.response.body_truncated, true);
  assert.equal(result.detail.response.body_original_bytes, Buffer.byteLength(JSON.stringify(body)));
  assert.ok(result.detail.response.body_retained_bytes <= 64 * 1024);
  assert.equal(result.detail.response.json, null, 'An incomplete JSON prefix is never reported as parsed JSON.');
  assert.doesNotMatch(result.detail.response.body, /�/);
  assert.equal(result.detail.assertions[0].passed, true);
  assert.deepEqual(apiResponsePreview('false'), { body: 'false', body_truncated: false, body_original_bytes: 5, body_retained_bytes: 5 });
});

test('API diagnostic SVG does not encode raw private captures while successor runtime values remain usable', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ token: 'CAPTURED_PRIVATE_TOKEN' }));
  const result = await executeApiStepInEngine({ case_parameters: { 't.password': 'PRIVATE_PASSWORD' } }, { ...step,
    api_request: { ...step.api_request, url: 'https://api.fixture/login?password=@t.password', captures: [{ parameter: 'token', path: '$.token' }] } });
  assert.equal(result.captures.token, 'CAPTURED_PRIVATE_TOKEN');
  const svg = Buffer.from(result.evidence.dataUrl.split(',')[1], 'base64').toString('utf8');
  assert.doesNotMatch(svg, /CAPTURED_PRIVATE_TOKEN|PRIVATE_PASSWORD/);
  assert.match(svg, /REDACTED/);
});
