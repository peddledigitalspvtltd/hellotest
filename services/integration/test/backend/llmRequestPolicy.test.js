const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { prepareChatRequest } = require('../../../platform/backend/src/utils/llmRequestPolicy');
const configuration = require('../../../platform/backend/services/aiConfiguration.service');
configuration.resolve = async id => { const item = configuration.catalog.find(item=>item.id===id);return {...item,config:item.defaults,published_version:0,fingerprint:configuration.hash(item.defaults)}; };
const { fetchLlmWithRetry } = require('../../../platform/backend/src/utils/llmHttpClient');

const init = (extra = {}) => ({ method: 'POST', body: JSON.stringify({
  model: 'provider-model', temperature: 0.2, response_format: { type: 'json_object' },
  messages: [{ role: 'system', content: 'Return JSON: {"title":string}.' }, { role: 'user', content: 'Draft the login Story.' }], ...extra
}) });
const completion = (content = '{"title":"Login"}', extra = {}) => ({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] });
const provider = async (t, handler) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    requests.push(JSON.parse(text));
    const result = handler(requests.length, requests.at(-1));
    res.writeHead(result.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, url: `http://127.0.0.1:${server.address().port}/chat/completions` };
};

test('feature output budgets preserve a lower requested cap and the exact prompt/schema', () => {
  const original = init({ max_tokens: 100_000 });
  const prepared = prepareChatRequest(original, { operation: 'bug-draft.generate' }).payload;
  assert.equal(prepared.max_tokens, 4096);
  assert.deepEqual(prepared.messages, JSON.parse(original.body).messages);
  assert.deepEqual(prepared.response_format, { type: 'json_object' });
  assert.equal(prepareChatRequest(init({ max_tokens: 100 }), {}).payload.max_tokens, 100);
  const reasoning = prepareChatRequest(init({ model: 'gpt-5-mini', max_tokens: 2000 }), {}).payload;
  assert.equal(reasoning.max_completion_tokens, 2000);
  assert.equal(reasoning.max_tokens, undefined);
  assert.equal(reasoning.temperature, undefined);
  const embedding = { body: JSON.stringify({ model: 'embedding', input: 'hello' }) };
  assert.deepEqual(prepareChatRequest(embedding).init, embedding);
  const nonChat = { body: 'null' };
  assert.deepEqual(prepareChatRequest(nonChat).init, nonChat);
});

test('oversized UTF-8 text rejects before provider invocation without cutting schema or tool calls', async t => {
  const { url, requests } = await provider(t, () => ({ body: completion() }));
  await assert.rejects(fetchLlmWithRetry(url, init({ messages: [{ role: 'user', content: '界'.repeat(40_000) }] })), {
    code: 'AI_INPUT_BUDGET_EXCEEDED', statusCode: 422
  });
  assert.equal(requests.length, 0);
});

test('explicit parameter rejection is corrected once with bounded output and unchanged evidence', async t => {
  const { url, requests } = await provider(t, count => count === 1
    ? { status: 400, body: { error: 'Unsupported max_tokens: use max_completion_tokens' } }
    : { body: completion(JSON.stringify({ requirements:[{ title:'Login', description:'A visitor signs in to the selected workspace.', acceptance_criteria:['Valid credentials open the workspace.'], priority:3 }] })) });
  const response = await fetchLlmWithRetry(url, init(), { operation: 'requirement.generate' });
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_completion_tokens, 6144);
  assert.equal(requests[1].max_tokens, undefined);
  assert.deepEqual(requests[1].messages, requests[0].messages);
});

test('providers without JSON mode retain schema instructions and response validation', async t => {
  const { url, requests } = await provider(t, count => count === 1
    ? { status: 400, body: { error: 'response_format json_object is not supported' } }
    : { body: completion() });
  assert.equal((await fetchLlmWithRetry(url, init())).status, 200);
  assert.equal(requests[1].response_format, undefined);
  assert.deepEqual(requests[1].messages, requests[0].messages);
  assert.equal(requests[1].max_tokens, 4096);
});

test('truncation, refusal and malformed JSON fail clearly without paid regeneration', async t => {
  for (const [body, code] of [
    [completion('{"title":', { finish_reason: 'length' }), 'AI_OUTPUT_TRUNCATED'],
    [completion('', { message: { refusal: 'declined' } }), 'AI_PROVIDER_REFUSAL'],
    [completion('not json'), 'AI_INVALID_JSON'],
    [completion(''), 'AI_EMPTY_RESPONSE']
  ]) {
    const { url, requests } = await provider(t, () => ({ body }));
    await assert.rejects(fetchLlmWithRetry(url, init()), { code });
    assert.equal(requests.length, 1);
  }
});

test('unsolicited or malformed tool calls cannot count as successful feature output', async t => {
  const toolCall = argumentsText => completion('', { message: { content: null,
    tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: argumentsText } }] } });
  const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }];
  for (const [request, responseBody, code] of [
    [init(), toolCall('{}'), 'AI_UNEXPECTED_TOOL_CALL'],
    [init({ tools }), toolCall('{"query":'), 'AI_INVALID_TOOL_ARGUMENTS'],
    [init({ tools }), toolCall('[]'), 'AI_INVALID_TOOL_ARGUMENTS']
  ]) {
    const { url, requests } = await provider(t, () => ({ body: responseBody }));
    await assert.rejects(fetchLlmWithRetry(url, request), { code });
    assert.equal(requests.length, 1);
  }
  const valid = await provider(t, () => ({ body: toolCall('{"query":"Checkout"}') }));
  assert.equal((await fetchLlmWithRetry(valid.url, init({ tools }))).status, 200);
});

test('failed credentials and rate limits are not replayed by compatibility handling', async t => {
  for (const status of [401, 429]) {
    const { url, requests } = await provider(t, () => ({ status, body: { error: 'max_tokens use max_completion_tokens' } }));
    assert.equal((await fetchLlmWithRetry(url, init())).status, status);
    assert.equal(requests.length, 1);
  }
});

test('mentioning both token fields in an unrelated validation failure does not trigger a replay', async t => {
  const { url, requests } = await provider(t, () => ({ status: 400,
    body: { error: 'Invalid request: max_tokens and max_completion_tokens must be positive integers' } }));
  assert.equal((await fetchLlmWithRetry(url, init())).status, 400);
  assert.equal(requests.length, 1);
});

test('only usable validated completions record provider success and preference failures do not fail generation', async t => {
  const selection = require('../../backend/services/aiLlmSelection.service');
  const remembered = [];
  const selected = { id: 'fixture-provider' };
  t.mock.method(selection, 'recordSuccessfulLlmIntegration', async integration => {
    remembered.push(integration);
    throw new Error('Preference storage unavailable');
  });
  const valid = await provider(t, () => ({ body: completion() }));
  assert.equal((await fetchLlmWithRetry(valid.url, init(), { integration: selected })).status, 200);
  assert.deepEqual(remembered, [selected]);
  const invalid = await provider(t, () => ({ body: completion('malformed') }));
  await assert.rejects(fetchLlmWithRetry(invalid.url, init(), { integration: selected }), { code: 'AI_INVALID_JSON' });
  assert.equal(remembered.length, 1);
  // The Knowledge gateway validates and records its own provider completion.
  assert.equal((await fetchLlmWithRetry(valid.url, init(), { integration: selected, validateResponse: false })).status, 200);
  assert.equal(remembered.length, 1);
});
