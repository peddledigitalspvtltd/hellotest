import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestEngineService, EngineHttpError } from '../dist/lib/engineHttpClient.js';

const request = (options = {}) => requestEngineService({ url: 'http://engine.test/results', service: 'Fixture engine', timeoutMs: 1000, ...options });

test('the service deadline covers a stalled response body and cancels its reader', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; }
  })));
  await assert.rejects(request({ timeoutMs: 20 }), error => error instanceof EngineHttpError && error.code === 'REQUEST_TIMEOUT');
  assert.equal(cancelled, true);
});

test('service transport bounds declared and streaming responses, and rejects invalid JSON', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const sample of [new Response('{}', { headers: { 'content-length': '100' } }), new Response('this exceeds the limit')]) {
    response = sample;
    await assert.rejects(request({ maxResponseBytes: 4 }), error => error.code === 'RESPONSE_TOO_LARGE');
  }
  response = new Response('not JSON');
  await assert.rejects(request(), error => error.code === 'INVALID_JSON' && !error.message.includes('not JSON'));
});

test('HTTP errors preserve status and correlation without exposing upstream secrets', async t => {
  let requestId;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    requestId = options.headers['x-request-id'];
    return Response.json({ message: 'password=never-log-me' }, { status: 404 });
  });
  await assert.rejects(request(), error => error.code === 'HTTP_ERROR' && error.status === 404 && error.requestId === requestId && !error.message.includes('never-log-me'));
  await assert.rejects(request({ url: 'http://admin:secret@engine.test' }), error => error.code === 'INVALID_ENDPOINT' && !error.message.includes('secret'));
});

test('a valid response request ID is authoritative and invalid IDs preserve the outbound correlation', async t => {
  let upstreamId = 'api-generated-correlation-42';
  let outboundId;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    outboundId = options.headers['x-request-id'];
    return Response.json({}, { status: 503, headers: { 'x-request-id': upstreamId } });
  });
  await assert.rejects(request(), error => error.requestId === upstreamId && error.requestId !== outboundId);
  for (const invalid of ['invalid request id', 'a'.repeat(129)]) {
    upstreamId = invalid;
    await assert.rejects(request(), error => error.requestId === outboundId && !error.message.includes(invalid));
  }
});

test('redirects cannot forward a Mobile Engine credential to another destination', async t => {
  let targetRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/target') targetRequests++;
    res.writeHead(req.url === '/redirect' ? 307 : 200, req.url === '/redirect' ? { location: '/target' } : { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(request({ url: `http://127.0.0.1:${server.address().port}/redirect`, init: { method: 'POST', headers: { 'x-hellotest-mobile-engine-secret': 'sensitive-service-credential' }, body: '{}' } }), error => error.code === 'HTTP_ERROR' && error.status === 307);
  assert.equal(targetRequests, 0);
});

test('a caller cancellation interrupts body reading without becoming a timeout', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); } })));
  const pending = request({ init: { signal: controller.signal } });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
});
