const test = require('node:test');
const assert = require('node:assert/strict');
const gateway = require('../../backend/services/knowledgeModelGateway.service');
const adapter = require('../../backend/services/knowledgeJsonCompletion.service');
const execution = require('../../backend/services/knowledgeExecution.service');
const { resetServiceResilienceState } = require('@hellotest/platform/backend/src/utils/resilientHttpClient');

function setup(t) {
  adapter.resetCompatibilityCache();
  resetServiceResilienceState();
  const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
  t.mock.method(configuration, 'resolve', async id => {
    const item = configuration.catalog.find(item => item.id === id);
    return { ...item, config: { ...item.defaults, max_output_tokens: 4096 }, published_version: 0, fingerprint: configuration.hash(item.defaults) };
  });
  t.mock.method(require('@hellotest/platform/backend/services/metricGovernance.service'), 'resolveForFeature', async () => ({ instruction: '', metrics: [] }));
  t.after(() => adapter.resetCompatibilityCache());
}
const input = (model = 'model-a') => ({ integration: { id: 'efficiency-fixture', base_url: 'https://knowledge-efficiency.invalid/v1', model }, messages: [{ role: 'user', content: 'Return the authorised evidence count as JSON.' }], operation: 'knowledge.assistant.verify', maxOutputTokens: 512 });
const complete = () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

test('every compatibility POST consumes the shared call budget and later calls reuse only explicit provider capabilities', async t => {
  setup(t);
  const requests = [];
  t.mock.method(global, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1 ? Response.json({ error: 'response_format json_object is unsupported' }, { status: 400 }) : complete();
  });
  await execution.run({ modelBudget: { max_tool_calls: 1 } }, async () => {
    await assert.rejects(gateway.request(input()), { code: 'MODEL_BUDGET_EXCEEDED' });
    assert.equal(execution.current().modelStats.calls, 1);
  });
  assert.equal(requests.length, 1, 'A compatibility correction cannot evade a one-call ceiling.');
  await execution.run({ modelBudget: { max_tool_calls: 1 } }, async () => {
    assert.deepEqual(await gateway.request(input()), { ok: true });
    assert.equal(execution.current().modelStats.calls, 1);
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(requests[1].response_format, undefined);
  assert.ok(requests.every(request => request.max_tokens === 512), 'Compatibility never removes or increases the output bound.');
});

test('explicit negotiation is not repeated on transient retry, and every actual request remains accounted', async t => {
  setup(t);
  const requests = [];
  t.mock.method(global, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return Response.json({ error: 'response_format json_object is unsupported' }, { status: 400 });
    if (requests.length === 2) return Response.json({ error: 'temporarily unavailable' }, { status: 503, headers: { 'retry-after': '0' } });
    return complete();
  });
  await execution.run({ modelBudget: { max_tool_calls: 3 } }, async () => {
    assert.deepEqual(await gateway.request(input()), { ok: true });
    assert.equal(execution.current().modelStats.calls, 3);
    assert.equal(execution.current().modelStats.provider_requests, 3);
    assert.equal(execution.current().modelStats.retries, 1);
    assert.equal(execution.current().modelStats.compatibility_retries, 1);
  });
  assert.deepEqual(requests.map(request => Boolean(request.response_format)), [true, false, false]);
  assert.equal(requests.length, 3, 'The transient attempt reuses negotiated parameters rather than repeating a rejected fourth POST.');
  assert.equal(JSON.stringify(requests[1].messages), JSON.stringify(requests[2].messages));
});

test('learned capabilities are isolated by model and eliminate repeated rejection payloads without caching answers', async t => {
  setup(t);
  const requests = [];
  t.mock.method(global, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return body.model === 'model-a' && body.response_format ? Response.json({ error: 'response_format json_object is unsupported' }, { status: 400 }) : complete();
  });
  await execution.run({ modelBudget: { max_tool_calls: 5 } }, async () => {
    await gateway.request(input());
    await gateway.request(input());
    await gateway.request(input('model-b'));
  });
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(request => [request.model, Boolean(request.response_format)]), [['model-a', true], ['model-a', false], ['model-a', false], ['model-b', true]]);
  const negotiatedBytes = requests.slice(0, 2).reduce((sum, request) => sum + Buffer.byteLength(JSON.stringify(request)), 0);
  const cachedCallBytes = Buffer.byteLength(JSON.stringify(requests[2]));
  assert.ok(cachedCallBytes < negotiatedBytes * 0.6, 'Reusing explicit capabilities avoids at least 40% of the repeated-stage request bytes by eliminating its rejected POST.');
  assert.equal(requests.filter(request => request.model === 'model-a').length, 3, 'Each logical request still generates its own answer; no model output is cached.');
});

test('final managed prompt bytes are admitted against the cost ceiling before any provider dispatch', async t => {
  setup(t);
  let dispatched = 0;
  t.mock.method(global, 'fetch', async () => { dispatched++; return complete(); });
  const request = input();
  request.integration.config = { pricing: { input_per_million_usd: 1000, output_per_million_usd: 0 } };
  const rawReservation = (Buffer.byteLength(JSON.stringify(request.messages)) + 256) / 1000;
  assert.ok(rawReservation < 0.5, 'The unexpanded marker request alone would have been admitted by the old estimate.');
  await execution.run({ modelBudget: { max_tool_calls: 3, max_query_cost_usd: 0.5 } }, async () => {
    await assert.rejects(gateway.request(request), { code: 'MODEL_COST_BUDGET_EXCEEDED' });
    assert.equal(execution.current().modelStats.calls, 1, 'Admission reservations remain conservative and backward compatible.');
    assert.equal(execution.current().modelStats.provider_requests || 0, 0, 'A denied pre-dispatch reservation is not an observed provider request.');
  });
  assert.equal(dispatched, 0, 'Managed policy/schema expansion cannot exceed a caller cost ceiling after initial reservation.');
});

test('query embedding cache identity includes the endpoint even when integration and model IDs are unchanged', async t => {
  setup(t);
  const rag = require('../../backend/services/knowledgeRag.service');
  const cache = require('@hellotest/platform/backend/src/utils/cache');
  const stored = new Map(), requests = [];
  t.mock.method(cache, 'getCache', async key => stored.get(key));
  t.mock.method(cache, 'setCache', async (key, value) => { stored.set(key, value); });
  t.mock.method(global, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url: String(url), input: body.input });
    const component = String(url).includes('embedding-one') ? 1 : 2;
    return Response.json({ data: body.input.map((_text, index) => ({ index, embedding: Array(8).fill(component) })) });
  });
  const runtime = { configured: true, baseUrl: 'https://embedding-one.invalid/v1', model: 'shared-model-name', integration: { id: 'same-integration', api_key: 'fixture' } };
  const text = 'Authorised release evidence';
  const first = await rag._internals.embedTexts(runtime, [text], { cacheResults: true });
  const repeated = await rag._internals.embedTexts(runtime, [text], { cacheResults: true });
  const changed = await rag._internals.embedTexts({ ...runtime, baseUrl: 'https://embedding-two.invalid/v1' }, [text], { cacheResults: true });
  assert.equal(requests.length, 2, 'The same configuration reuses its vector; a changed provider endpoint requires a new vector.');
  assert.equal(first.vectors[0][0], 1);
  assert.deepEqual(repeated.vectors, first.vectors);
  assert.equal(changed.vectors[0][0], 2, 'A vector from the old endpoint cannot be reused for the new provider/model deployment.');
  assert.deepEqual(requests.map(request => request.url), ['https://embedding-one.invalid/v1/embeddings', 'https://embedding-two.invalid/v1/embeddings']);
  assert.ok([...stored.keys()].every(key => !key.includes(text)), 'Shared cache keys contain fingerprints rather than raw evidence text.');
});

const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
test('a supplied Knowledge output schema is locally enforced for compatible providers', async t => {
  setup(t);
  const requests = [];
  t.mock.method(global, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: '{"ok":"incorrect type"}' }, finish_reason: 'stop' }] });
  });
  await assert.rejects(gateway.request({ ...input(), outputSchema }), error => {
    assert.equal(error.code, 'MODEL_INVALID_RESPONSE');
    assert.ok(error.validation_errors.some(issue => issue.path === '/ok'));
    assert.equal(error.cause.code, 'AI_OUTPUT_SCHEMA_VIOLATION');
    return true;
  });
  assert.equal(requests.length, 1, 'A schema mismatch is not retried as a transient transport failure.');
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.ok(requests[0].messages.some(message => typeof message.content === 'string' && message.content.includes(JSON.stringify(outputSchema))));
});

test('an explicit strict-schema rejection downgrades once and retains local validation and schema guidance', async t => {
  setup(t);
  const requests = [];
  t.mock.method(global, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    return request.response_format?.type === 'json_schema' ? Response.json({ error: 'json_schema structured outputs are unsupported' }, { status: 400 }) : complete();
  });
  const request = { ...input('gpt-4o-mini'), outputSchema, integration: { id: 'official-schema-fixture', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } };
  await execution.run({ modelBudget: { max_tool_calls: 3 } }, async () => {
    assert.deepEqual(await gateway.request(request), { ok: true });
    assert.deepEqual(await gateway.request(request), { ok: true });
    assert.equal(execution.current().modelStats.calls, 3);
    assert.equal(execution.current().modelStats.compatibility_retries, 1);
  });
  assert.deepEqual(requests.map(request => request.response_format?.type), ['json_schema', 'json_object', 'json_object']);
  assert.ok(requests[1].messages.some(message => typeof message.content === 'string' && message.content.includes(JSON.stringify(outputSchema))));
  assert.ok(requests.every(request => request.max_tokens === 512));
});
