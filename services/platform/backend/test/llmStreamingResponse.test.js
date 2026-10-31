const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeChatStream } = require('../src/utils/llmStreamingResponse');
const frame = (delta, finish_reason = null, extra = {}) => `data: ${JSON.stringify({ id: 'response-1', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }], ...extra })}\r\n\r\n`;
const response = (text, width = 7) => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(text);
  for (let index = 0; index < bytes.length; index += width) controller.enqueue(bytes.slice(index, index + width));
  controller.close();
} }), { headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'x-request-id': 'request-1' } });

test('chat stream preserves fragmented UTF-8, CRLF, comments, exact text and final usage without emitting reasoning', async () => {
  const deltas = [];
  const result = await consumeChatStream(response(': heartbeat\r\n\r\n' + frame({ content: '  Héllo 🌍\n', reasoning_content: 'PRIVATE_REASONING' }) + frame({ content: 'done ' }, 'stop') +
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\r\n\r\ndata: [DONE]\r\n\r\n', 1), { onTextDelta: async text => deltas.push(text) });
  const value = await result.json();
  assert.deepEqual(deltas, ['  Héllo 🌍\n', 'done ']);
  assert.equal(value.choices[0].message.content, deltas.join(''));
  assert.deepEqual(value.usage, { prompt_tokens: 10, completion_tokens: 4 });
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_REASONING/);
  assert.equal(result.headers.get('content-encoding'), null);
  assert.equal(result.headers.get('x-request-id'), 'request-1');
});

test('interleaved tool arguments are assembled completely in index order and never forwarded as text', async () => {
  const deltas = [];
  const chunks = frame({ tool_calls: [{ index: 1, id: 'call-b', type: 'function', function: { name: 'lookup', arguments: '{"id":' } }, { index: 0, id: 'call-a', type: 'function', function: { name: 'lookup', arguments: '{"id":' } }] }) +
    frame({ tool_calls: [{ index: 0, function: { arguments: '1}' } }, { index: 1, function: { arguments: '2}' } }] }, 'tool_calls') + 'data: [DONE]\r\n\r\n';
  const value = await (await consumeChatStream(response(chunks), { onTextDelta: text => deltas.push(text) })).json();
  assert.deepEqual(value.choices[0].message.tool_calls.map(call => [call.id, JSON.parse(call.function.arguments)]), [['call-a', { id: 1 }], ['call-b', { id: 2 }]]);
  assert.deepEqual(deltas, []);
});

test('incomplete, malformed, errored and over-budget streams fail without a successful prefix', async () => {
  for (const text of [frame({ content: 'partial' }), 'data: {"broken":\n\n', 'event: error\ndata: {"error":{"message":"private upstream detail"}}\n\n', 'data: [DONE]\n\n', frame({ content: 'ok' }, 'stop') + 'data: {"tail":1}']) {
    await assert.rejects(consumeChatStream(response(text)), error => error.nonRetryable === true && error.generation_received === true && !error.message.includes('private upstream detail'));
  }
  await assert.rejects(consumeChatStream(response(frame({ content: 'x'.repeat(2000) }, 'stop')), { maxBytes: 1024 }), { code: 'AI_STREAM_LIMIT' });
});

function transportFixture(t, upstream, { assertStreaming = true } = {}) {
  require('../src/utils/llmHttpClient')._internals.streamCapabilities.clear();
  const traces = require('../src/utils/llmTraceCapture');
  t.mock.method(traces, 'begin', async () => ({ id: 'trace', started: Date.now() }));
  t.mock.method(traces, 'dispatch', () => {});
  t.mock.method(traces, 'finish', async () => {});
  t.mock.method(require('../src/utils/aiFeatureRuntime'), 'apply', async (init, options) => ({ init, options }));
  t.mock.method(require('../src/utils/aiFeatureRuntime'), 'validateResponse', async () => {});
  t.mock.method(require('@hellotest/mcp/backend/gateway'), 'enrichChatRequest', async init => init);
  t.mock.method(require('../services/aiAttachmentAccess.service'), 'prepareImages', async init => init);
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => { posts++; if (assertStreaming) assert.equal(JSON.parse(init.body).stream, true); return upstream(init); });
  const request = options => require('../src/utils/llmHttpClient').fetchLlmWithRetry('https://stream-fixture.example.test/v1/chat/completions', {
    method: 'POST', body: JSON.stringify({ model: 'fixture-model', messages: [{ role: 'user', content: 'Review supplied evidence.' }], ...options.payload }), signal: options.signal
  }, { maxAttempts: 1, timeoutMs: 2000, ...options });
  return { request, posts: () => posts };
}

test('shared transport emits text before provider EOF and validates assembled JSON without a second request', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = transportFixture(t, async () => new Response(new ReadableStream({ async start(controller) {
    controller.enqueue(new TextEncoder().encode(frame({ content: '{"ok":' })));
    await gate;
    controller.enqueue(new TextEncoder().encode(frame({ content: 'true}' }, 'stop') + 'data: [DONE]\r\n\r\n')); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  const chunks = [];
  const value = await (await f.request({ payload: { response_format: { type: 'json_object' } }, onTextDelta: async text => { chunks.push(text); release(); } })).json();
  assert.deepEqual(chunks, ['{"ok":', 'true}']); assert.equal(value.choices[0].message.content, '{"ok":true}'); assert.equal(f.posts(), 1);
});

test('shared streaming transport validates stop reasons and tool schemas before tool callbacks', async t => {
  let mode = 'length', callbacks = 0;
  const f = transportFixture(t, async () => response(mode === 'length' ? frame({ content: 'partial' }, 'length') :
    frame({ tool_calls: [{ index: 0, id: 'tool-a', type: 'function', function: { name: 'lookup', arguments: mode === 'invalid' ? '{"id":"wrong"}' : '{"id":1}' } }] }, 'tool_calls')));
  const tool = { type: 'function', function: { name: 'lookup', parameters: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'integer' } } } } };
  const options = { payload: { tools: [tool] }, onToolCall: async call => { callbacks++; assert.deepEqual(JSON.parse(call.function.arguments), { id: 1 }); } };
  await assert.rejects(f.request(options), { code: 'AI_OUTPUT_TRUNCATED' });
  mode = 'invalid'; await assert.rejects(f.request(options), { code: 'AI_INVALID_TOOL_ARGUMENTS' }); assert.equal(callbacks, 0);
  mode = 'valid'; await f.request(options); assert.equal(callbacks, 1); assert.equal(f.posts(), 3);
});

test('mid-stream cancellation closes the provider reader and never replays a paid generation', async t => {
  let cancelled = false;
  const controller = new AbortController();
  const f = transportFixture(t, async () => new Response(new ReadableStream({ start(source) { source.enqueue(new TextEncoder().encode(frame({ content: 'started' }))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(f.request({ signal: controller.signal, onTextDelta: async () => controller.abort() }), error => error.generation_received && error.nonRetryable);
  assert.equal(cancelled, true); assert.equal(f.posts(), 1);
});

test('a provider returning buffered JSON remains usable without fabricated token events', async t => {
  const f = transportFixture(t, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Buffered answer' } }] }));
  const deltas = []; const value = await (await f.request({ onTextDelta: text => deltas.push(text) })).json();
  assert.equal(value.choices[0].message.content, 'Buffered answer'); assert.deepEqual(deltas, []); assert.equal(f.posts(), 1);
});

test('an explicit pre-generation streaming rejection falls back once and caches the capability without fake deltas', async t => {
  const requests = [], deltas = [], admissions = [];
  const f = transportFixture(t, async init => {
    const body = JSON.parse(init.body); requests.push(body.stream);
    return body.stream ? Response.json({ error: { message: 'The stream parameter is unsupported for this model.' } }, { status: 400 })
      : Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Validated buffered completion' } }] });
  }, { assertStreaming: false });
  const options = { onTextDelta: text => deltas.push(text), beforeDispatch: ({ payload }) => admissions.push(payload.stream) };
  await f.request(options); await f.request(options);
  assert.deepEqual(requests, [true, false, false]); assert.deepEqual(admissions, requests); assert.deepEqual(deltas, []); assert.equal(f.posts(), 3);
});
