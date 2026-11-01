const test = require('node:test');
const assert = require('node:assert/strict');
const nodes = require('../../backend/workflows/nodeAiConfiguration');
const tasks = require('../../shared/workflowNativeTasks.json');
const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
const runtime = require('@hellotest/platform/backend/src/utils/aiFeatureRuntime');
const policy = require('@hellotest/platform/backend/src/utils/llmRequestPolicy');
const db = require('@hellotest/platform/backend/src/db');

// Use the native request's initial instruction blocks, rather than repair or
// unrelated template blocks that happen to mention the transport format.
const initialBlocks = {
  'story-assurance': ['artifactAssurance.result.9'],
  'test-case-generation': ['application.artifactContract', 'legacy.reviewed', 'format.structured'],
  'test-case-assurance': ['artifactAssurance.result.9'],
  'automation-engineer': ['agenticAssistant.messages.1', 'agenticAssistant.messages.2',
    'agenticAssistant.messages.11', 'agenticAssistant.messages.12', 'agenticAssistant.messages.14']
};
const outputSchema = { type: 'object', additionalProperties: false,
  properties: { outcome: { type: 'string' }, count: { type: 'integer', minimum: 1 } },
  required: ['outcome', 'count'] };
const response = content => new Response(JSON.stringify({ choices: [
  { finish_reason: 'stop', message: { role: 'assistant', content } }
] }), { headers: { 'content-type': 'application/json' } });

for (const [task, definition] of Object.entries(tasks)) {
  test(`${task} keeps node instructions while satisfying and validating JSON-mode transport`, async t => {
    t.mock.method(db, 'prepare', () => assert.fail('Pinned node profiles must not read saved administrator settings.'));
    t.mock.method(globalThis, 'fetch', () => assert.fail('This regression must not call a model provider.'));
    const input = { id: `fixture-${task}`, data: { kind: 'artifactTask', artifactTask: task,
      task: 'Use the supplied Story and its reviewed acceptance criteria.',
      instructions: 'Return the complete requested outcome with explicit evidence references.',
      guardrails: 'Do not invent product behavior or claim execution success.',
      aiConfiguration: { context: { mode: 'none', required: false, token_budget: 1000, max_items: 4, focus: '' } }
    } };
    const source = { application: { id: 'fixture-app', type: 'api' },
      stories: [{ ref: 'requirement:fixture-story', title: 'Read an invoice',
        description: 'An authenticated viewer reads their saved invoice.' }] };
    const taskContent = JSON.stringify(source), originalNode = structuredClone(input);
    await nodes.runNode(input, { revision: 'saved-fixture-v1' }, async () => {
      const profile = await configuration.resolve(definition.featureKey);
      assert.equal(profile.configuration_source, 'workflow_node');
      assert.equal(profile.configuration_scope.id, input.id);
      assert.match(profile.config.prompt, /complete requested outcome/);
      assert.equal(/json/i.test(profile.config.prompt), false);
      const content = initialBlocks[task].map(key => {
        assert.equal(typeof profile.config.instruction_blocks[key], 'string', `Missing native instruction ${key}`);
        return profile.config.instruction_blocks[key];
      }).join('\n\n');
      const messages = runtime.composeMessages([
        { role: 'system', content }, { role: 'user', content: taskContent }
      ], profile.config);
      const before = { model: 'node-fixture', response_format: { type: 'json_object' }, messages };
      if (task === 'test-case-generation') {
        assert.equal(messages.some(message => /json/i.test(message.content)), false,
          'The generator reproduces the saved-node failure before shared transport preparation.');
      }
      const init = { method: 'POST', body: JSON.stringify(before) }, originalBody = init.body;
      const prepared = policy.prepareChatRequest(init, { outputSchema, structuredOutput: false,
        providerUrl: 'https://provider.example.test/v1/chat/completions' });
      assert.equal(prepared.payload.response_format.type, 'json_object');
      assert.ok(prepared.payload.messages.some(message => ['system', 'developer'].includes(message.role)
        && /\bjson\b/i.test(message.content)), 'Editable node prose cannot remove trusted transport guidance.');
      assert.deepEqual(prepared.payload.messages.filter(message => message.role === 'user'),
        [{ role: 'user', content: taskContent }]);
      assert.deepEqual(JSON.parse(prepared.payload.messages.find(message => message.role === 'user').content), source);
      assert.equal(init.body, originalBody);
      assert.ok(prepared.payload.messages.some(message => message.content === messages[0].content),
        'Native and node instructions remain intact.');
      assert.equal(await policy.validateChatResponse(response('{"outcome":"draft","count":1}'), prepared.payload,
        { outputSchema }), true);
      await assert.rejects(policy.validateChatResponse(response('unfinished prose'), prepared.payload,
        { outputSchema }), { code: 'AI_INVALID_JSON' });
      await assert.rejects(policy.validateChatResponse(response('{"outcome":"draft","count":0}'), prepared.payload,
        { outputSchema }), { code: 'AI_OUTPUT_SCHEMA_VIOLATION' });
    });
    assert.deepEqual(input, originalNode);
  });
}
