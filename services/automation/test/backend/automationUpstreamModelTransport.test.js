const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fetchLlmWithRetry } = require('@hellotest/platform/backend/src/utils/llmHttpClient');
const { resetServiceResilienceState } = require('@hellotest/platform/backend/src/utils/resilientHttpClient');
const traces = require('@hellotest/platform/backend/src/utils/llmTraceContext');
const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
const { retryLlmCapacity } = require('@hellotest/platform/backend/src/utils/llmCapacityRetry');
const { retryActorJsonOutput } = require('../../backend/lib/automationJsonOutputRetry');
const { browserActorRequestPolicy } = require('../../backend/lib/automationActorModelPolicy');
const { createLlmProviderError } = require('@hellotest/platform/backend/src/utils/upstreamLlmError');
const { getCompletionContent } = require('@hellotest/platform/backend/src/utils/llmResponse');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { buildWithUpstreamPlaywright } = require('../../backend/lib/automationUpstreamEngineer');
const { inspectExecutablePlan } = require('../../backend/services/automationReadiness.service');
const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
const fetchDeclaration = source.slice(source.indexOf('const fetchWithTimeout ='), source.indexOf('const resolveLlmIntegration ='));
const requestDeclaration = source.slice(source.indexOf('const requestChatCompletion ='), source.indexOf('const normalizeUrlKey ='));
const integration = {base_url: 'https://model.fixture/v1', model: 'provider-model', api_key: 'fixture-key'};
const featureKey = 'ai.agentic.automation-engineer';
const tools = [
  {name: 'browser_navigate', inputSchema: {type: 'object', required: ['url'], properties: {url: {type: 'string'}}, additionalProperties: false}},
  {name: 'browser_click', inputSchema: {type: 'object', required: ['ref'], properties: {ref: {type: 'string'}}, additionalProperties: false}},
  {name: 'browser_snapshot', inputSchema: {type: 'object', properties: {}, additionalProperties: false}}
];
const accepted = (content = {done: true}, extra = {}) => new Response(JSON.stringify({choices: [{finish_reason: 'stop',
  message: {content: JSON.stringify(content)}, ...extra}]}), {headers: {'content-type': 'application/json'}});
const connectionReset = extra => Object.assign(new Error('Fixture connection reset before receiving response headers'), {code: 'ECONNRESET', ...extra});

function setup(t, fetch) {
  resetServiceResilienceState();
  t.mock.method(globalThis, 'fetch', fetch);
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(configuration, 'resolve', async id => {
    const item = configuration.catalog.find(item => item.id === id);
    return {...item, config: item.defaults, published_version: 0, fingerprint: configuration.hash(item.defaults)};
  });
  t.mock.method(require('@hellotest/platform/backend/services/metricGovernance.service'), 'resolveForFeature', async () => ({instruction: '', metrics: []}));
  t.mock.method(require('@hellotest/integration/backend/services/aiLlmSelection.service'), 'recordSuccessfulLlmIntegration', async () => {});
  // The existing resilience delay is unref'ed; retain the test process only.
  const keepAlive = setInterval(() => {}, 1000); t.after(() => {clearInterval(keepAlive); resetServiceResilienceState();});
  const complete = new Function('fetchLlmWithRetry', 'retryActorJsonOutput', 'retryLlmCapacity', 'createLlmProviderError',
    'getCompletionContent', 'LLM_TIMEOUT_MS', 'aiInstructionBlock', 'browserActorRequestPolicy',
    `${fetchDeclaration}\n${requestDeclaration}\nreturn requestChatCompletion;`)(fetchLlmWithRetry, retryActorJsonOutput, retryLlmCapacity,
    createLlmProviderError, getCompletionContent, 5000, aiInstructionBlock, browserActorRequestPolicy);
  return (options = {}) => traces.run({automation_browser_loop: true, automation_case_generation: true,
    generation_scope: options.upstreamPhase || 'section_attempt', mcp_context_depth: 1, mcp_context: 'retrieved'},
  () => complete({integration, featureKey, prompt: 'Return JSON for this frozen authored section.', timeoutMs: 5000, ...options}));
}

test('real buffered model HTTP pipeline recovers one reset into a native function response and dispatches each browser action once', async t => {
  const startUrl = 'https://app.test/start', goto = `await page.goto(${JSON.stringify(startUrl)});`;
  const click = 'await page.getByRole("button", {name:"Save",exact:true}).click();';
  const assertion = 'await expect(page.getByRole("status")).toHaveText("Saved");';
  const requests = [], browserCalls = []; let actorResponses = 0, accessChecks = 0;
  const complete = setup(t, async (_url, init) => {
    requests.push({body: init.body, signal: init.signal});
    if (requests.length === 1) throw connectionReset();
    const payload = JSON.parse(init.body), prompt = payload.messages.filter(message => message.role === 'user').at(-1).content;
    if (payload.tools) {
      if (++actorResponses === 1) return accepted(null, {finish_reason: 'tool_calls', message: {content: null,
        tool_calls: [{id: 'native-save', type: 'function', function: {name: 'browser_click', arguments: '{"ref":"e16"}'}}]}});
      return accepted({done: true});
    }
    const packet = JSON.parse(prompt.startsWith('{') ? prompt : prompt.slice(prompt.indexOf('{"task":')));
    if (packet.task.startsWith('Save this section')) return accepted({automation_code: [goto, click, assertion].join('\n')});
    return accepted({schema: 'hellotest.playwrightInstructionMapping.v1', steps: packet.steps.map(step => ({step_id: step.step_id,
      source_sha256: step.source_sha256, instructions: step.operations.map(op => ({operation_id: op.operation_id, kind: op.kind,
        depth: op.depth, label: op.kind === 'assertion' ? 'Verify saved status' : 'Perform native action', args: []}))}))});
  });
  const result = await buildWithUpstreamPlaywright({steps: [{id: 'save', step_order: 1, step_type: 'web', action: 'Save the form', expected_result: 'Saved status appears'}],
    startUrl, interactive: true, validate: inspectExecutablePlan,
    browser: {tools, call: async (name, args) => {browserCalls.push({name, args}); return {content: [{type: 'text',
      text: `### Ran Playwright code\n\x60\x60\x60js\n${name === 'browser_navigate' ? goto : click}\n\x60\x60\x60\nCurrent page`} ]};}, close: async () => {}},
    complete: ({phase, prompt, nativeTools}) => complete({upstreamPhase: phase, prompt, browserActor: phase === 'upstream_browser_actor',
      nativeTools, beforeDispatch: async () => {accessChecks++;}})});
  assert.equal(requests.length, 5); assert.equal(requests[0].body, requests[1].body);
  assert.deepEqual(browserCalls.map(call => call.name), ['browser_navigate', 'browser_click']);
  assert.equal(result.updates[0].automation_code, '// @hellotest-parameter-bindings expressions-v1\n' + [goto, click, assertion].join('\n'));
  assert.ok(accessChecks >= requests.length, 'actual shared transport attempts recheck current authorization');
});

test('only trusted upstream buffered phases enable at most two transport attempts', async t => {
  let calls = 0;
  const complete = setup(t, async () => {if (++calls % 2 === 1) throw connectionReset(); return accepted();});
  for (const upstreamPhase of ['upstream_browser_actor', 'upstream_source', 'upstream_instruction_mapping', 'upstream_api_source']) {
    assert.equal(await complete({upstreamPhase, maxAttempts: 4}), '{"done":true}');
  }
  assert.equal(calls, 8);
});

test('legacy/default calls, unsupported phases and verification repair keep their single transport attempt', async t => {
  let calls = 0; const complete = setup(t, async () => {calls++; throw connectionReset();});
  for (const options of [{}, {browserActor: true, nativeTools: tools}, {upstreamPhase: 'section_attempt'},
    {upstreamPhase: 'verification_repair', maxAttempts: 1}, {upstreamPhase: 'upstream_source', maxAttempts: 1}]) {
    await assert.rejects(complete(options), {code: 'DEPENDENCY_NETWORK_ERROR'});
  }
  assert.equal(calls, 5);
});

test('upstream transport retry is bounded at two and never ignores no-replay generation/error markers', async t => {
  let calls = 0, error = connectionReset();
  const complete = setup(t, async () => {calls++; throw error;});
  await assert.rejects(complete({upstreamPhase: 'upstream_source'}), {code: 'DEPENDENCY_NETWORK_ERROR'});
  assert.equal(calls, 2);
  for (const marker of [{nonRetryable: true}, {generation_received: true}, {retryable: false}]) {
    resetServiceResilienceState(); calls = 0; error = connectionReset(marker);
    await assert.rejects(complete({upstreamPhase: 'upstream_source'}), value => value.retryable === false && value.nonRetryable === true);
    assert.equal(calls, 1);
  }
});

test('accepted truncated, refused, malformed and partially received generations are terminal without transport regeneration', async t => {
  let calls = 0, response;
  const complete = setup(t, async () => {calls++; return response();});
  for (const [factory, code] of [
    [() => accepted({}, {finish_reason: 'length'}), 'AI_OUTPUT_TRUNCATED'],
    [() => accepted({}, {message: {refusal: 'Declined'}}), 'AI_PROVIDER_REFUSAL'],
    [() => accepted({}, {message: {content: 'not JSON'}}), 'AI_INVALID_JSON'],
    [() => new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{"choices":['));
      controller.error(connectionReset());}}), {status: 200}), 'DEPENDENCY_NETWORK_ERROR']
  ]) {
    resetServiceResilienceState(); calls = 0; response = factory;
    await assert.rejects(complete({upstreamPhase: 'upstream_source'}), value => value.code === code && value.generation_received === true);
    assert.equal(calls, 1);
  }
});

test('authorization failures and cancellation cannot dispatch a retry, including revocation between transport attempts', async t => {
  let calls = 0, mode = '401', checks = 0;
  const complete = setup(t, async () => {
    calls++;
    if (mode === '401') return new Response('{"error":"invalid credentials"}', {status: 401});
    throw connectionReset();
  });
  await assert.rejects(complete({upstreamPhase: 'upstream_browser_actor'}), {code: 'LLM_AUTHENTICATION_FAILED'});
  assert.equal(calls, 1);
  mode = 'reset'; calls = 0; const denied = Object.assign(new Error('Current permission revoked'), {statusCode: 403});
  await assert.rejects(complete({upstreamPhase: 'upstream_source', beforeDispatch: async () => {if (++checks === 3) throw denied;}}), value => value === denied);
  assert.equal(calls, 1); assert.equal(checks, 3, 'preflight, first actual fetch and blocked second fetch each check permission');
  const controller = new AbortController(), cancelled = new Error('Cancelled by owner'); calls = 0;
  await assert.rejects(complete({upstreamPhase: 'upstream_source', signal: controller.signal,
    beforeDispatch: async () => {controller.abort(cancelled);}}));
  assert.equal(calls, 0);
});

test('transport attempts share the original total deadline instead of starting another model budget', async t => {
  let calls = 0, now = 1000;
  const complete = setup(t, async () => {calls++; now += 6000; throw connectionReset();});
  t.mock.method(Date, 'now', () => now);
  await assert.rejects(complete({upstreamPhase: 'upstream_source', timeoutMs: 5000}));
  assert.equal(calls, 1, 'an expired total deadline prevents another dispatch');
});
