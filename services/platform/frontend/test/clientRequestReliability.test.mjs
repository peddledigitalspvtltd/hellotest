import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from './helpers/loadTsModule.mjs';

function fixture() {
  const storage = new Map(), requests = [];
  const window = {
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    __HELLOTEST_CONFIG__: { API_BASE_URL: 'http://fixture.test' },
    location: { assign() {} }
  };
  const fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    requests.push({ url, options, reject, respond: resolve, reply: value => resolve(Response.json(value)) });
  });
  return { requests, ...loadTsModule(fileURLToPath(new URL('../src/lib/httpClient.ts', import.meta.url)), {
    window, fetch, Error, SyntaxError, Headers, Response, FormData, Blob, AbortSignal, AbortController, URL, URLSearchParams
  }) };
}

test('reads completing before or after a mutation cannot restore stale values or pending requests', async () => {
  const view = fixture();
  const old = view.request('/items');
  const save = view.request('/items', { method: 'POST', body: '{}' });
  const during = view.request('/items');
  assert.equal(view.requests.length, 3);
  view.requests[1].reply({ saved: true }); await save;
  const current = view.request('/items');
  assert.equal(view.requests.length, 4, 'post-write read cannot join a read from before commit');
  view.requests[0].reply(['old']); view.requests[2].reply(['during']);
  await Promise.all([old, during]);
  const shared = view.request('/items');
  assert.equal(view.requests.length, 4, 'old cleanup cannot delete the current pending request');
  view.requests[3].reply(['current']);
  assert.deepEqual(await current, ['current']); assert.deepEqual(await shared, ['current']);
  assert.deepEqual(await view.request('/items'), ['current']);
});

test('uncertain failed writes and completed uploads expire GET reuse', async () => {
  const view = fixture();
  const before = view.request('/items'); view.requests[0].reply(['before']); await before;
  const write = view.request('/items', { method: 'PUT', body: '{}' });
  view.requests[1].reject(new TypeError('socket closed after commit'));
  await assert.rejects(write, /Unable to reach the API/);
  const fresh = view.request('/items'); assert.equal(view.requests.length, 3);
  view.requests[2].reply(['fresh']); await fresh;
  const upload = view.requestForm('/attachments', new FormData()); view.requests[3].reply({ id: 'attachment' }); await upload;
  const after = view.request('/items'); assert.equal(view.requests.length, 5);
  view.requests[4].reply(['uploaded']); await after;
});

test('headers and explicit revalidation options do not reuse an incompatible representation', async () => {
  const view = fixture();
  const json = view.request('/items', { headers: { Accept: 'application/json' } });
  const text = view.request('/items', { headers: { Accept: 'text/plain' } });
  assert.equal(view.requests.length, 2);
  view.requests[0].reply(['json']); view.requests[1].reply(['text']); await Promise.all([json, text]);
  for (const cache of ['no-store', 'no-cache', 'reload']) {
    const fresh = view.request('/items', { headers: { Accept: 'application/json' }, cache });
    view.requests.at(-1).reply([cache]); assert.deepEqual(await fresh, [cache]);
  }
  assert.equal(view.requests.length, 5);
});

test('downloads honor cancellation before fetch and while consuming the body', async () => {
  const view = fixture();
  await assert.rejects(view.requestBlob('/evidence', { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(view.requests.length, 0);
  const controller = new AbortController();
  const download = view.requestBlob('/evidence', { signal: controller.signal });
  let started;
  const bodyStarted = new Promise(resolve => { started = resolve; });
  view.requests[0].respond({ ok: true, blob: () => new Promise((resolve, reject) => {
    view.requests[0].options.signal.addEventListener('abort', () => reject(view.requests[0].options.signal.reason), { once: true });
    started();
  }) });
  await bodyStarted;
  controller.abort();
  await assert.rejects(download, { name: 'AbortError' });
  assert.equal(view.requests[0].options.signal.aborted, true);
});

test('body deadlines and malformed JSON produce safe actionable errors with support references', async () => {
  const view = fixture();
  // Keep the test alive while the production AbortSignal timeout is unreferenced.
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    const slow = view.request('/items?token=do-not-echo', undefined, 20);
    view.requests[0].respond({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => new Promise((resolve, reject) => {
      const signal = view.requests[0].options.signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });
    await assert.rejects(slow, error => /Request timeout/.test(error.message) && !error.message.includes('do-not-echo'));
    const malformed = view.request('/invalid');
    view.requests[1].respond(new Response('{bad-json', { headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-reference' } }));
    await assert.rejects(malformed, /invalid response.*support reference: trace-reference/);
  } finally { clearTimeout(keepAlive); }
});

test('short-lived cache expires and evicts entries without allowing old generations to return', () => {
  const { ClientRequestCache } = loadTsModule(fileURLToPath(new URL('../src/lib/clientRequestCache.ts', import.meta.url)));
  let now = 100;
  const cache = new ClientRequestCache(20, 2, () => now);
  cache.remember('a', 1, cache.revision); cache.remember('b', 2, cache.revision); cache.remember('c', 3, cache.revision);
  assert.equal(cache.read('a'), undefined); assert.equal(cache.read('b'), 2);
  now += 20; assert.equal(cache.read('b'), undefined);
  const oldRevision = cache.revision; cache.invalidate(); cache.remember('c', 4, oldRevision);
  assert.equal(cache.read('c'), undefined);
});

test('already deployed capability Map.clear callers invalidate pending and late reads', async () => {
  const view = fixture();
  const old = view.request('/items');
  view.clientGetResponseCache.clear();
  const current = view.request('/items');
  assert.equal(view.requests.length, 2);
  view.requests[0].reply(['old']); await old;
  const joined = view.request('/items'); assert.equal(view.requests.length, 2);
  view.requests[1].reply(['current']); await Promise.all([current, joined]);
  assert.deepEqual(await view.request('/items'), ['current']);
});

test('unparsed gateway errors cancel their response streams without exposing the body', async () => {
  const view = fixture();
  let cancelled = false;
  const request = view.request('/items');
  view.requests[0].respond(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('private gateway body')); },
    cancel() { cancelled = true; }
  }), { status: 502, headers: { 'content-type': 'text/html', 'x-request-id': 'gateway-reference' } }));
  await assert.rejects(request, error => error.status === 502 && error.requestId === 'gateway-reference' && !error.message.includes('private gateway body'));
  assert.equal(cancelled, true);
});
