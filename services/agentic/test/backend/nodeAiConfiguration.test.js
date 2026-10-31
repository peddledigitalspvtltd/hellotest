const test = require('node:test');
const assert = require('node:assert/strict');
const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
const execution = require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');
const db = require('@hellotest/platform/backend/src/db');
const runtime = require('@hellotest/platform/backend/src/utils/aiFeatureRuntime');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const nodes = require('../../backend/workflows/nodeAiConfiguration');
const definitions = require('../../backend/agents/agentDefinition');
const { instructionFor } = require('../../backend/workflows/specialistPolicy');
const profiles = require('../../shared/workflowSpecialists.json');

const node = (id, prompt) => ({ id, data: { kind: 'artifactTask', artifactTask: 'test-case-generation', task: prompt,
  instructions: 'Return complete journeys with explicit expected results.', guardrails: 'Use supplied acceptance evidence.',
  reviewCriteria: 'Check the final business outcome.', aiConfiguration: { temperature: 0.45, max_output_tokens: 4096 } } });

test('a native task uses its pinned node prompt and model settings without consulting saved admin overrides', async t => {
  t.mock.method(db, 'prepare', () => assert.fail('Node execution must not read the admin settings table.'));
  const input = node('functional-node', 'Create functional registration journeys.');
  await nodes.runNode(input, { revision: 'saved-v3' }, async () => {
    const profile = await configuration.resolve('ai.test_case.design');
    assert.equal(profile.configuration_source, 'workflow_node');
    assert.equal(profile.configuration_scope.id, 'functional-node');
    assert.match(profile.config.prompt, /functional registration journeys/);
    assert.match(profile.config.prompt, /Check the final business outcome/);
    assert.equal(profile.config.temperature, 0.45);
    assert.doesNotMatch(profile.config.prompt, /NFR_ONLY/);
    const request = { body: JSON.stringify({ model: 'fixture', messages: [
      {role: 'system', content: aiInstructionBlock('ai.test_case.design', 'format.structured')},
      {role: 'user', content: JSON.stringify({ stories: [{ id: 'story-1', title: 'Registration' }] })}
    ] }) };
    const applied = await runtime.apply(request, { featureKey: 'ai.test_case.design' });
    const body = JSON.parse(applied.init.body);
    assert.match(body.messages[0].content, /functional registration journeys/);
    assert.equal(body.messages[1].content, JSON.parse(request.body).messages[1].content);
    assert.equal(body.max_tokens, 4096);
  });
  assert.equal(execution.current(), null);
});

test('parallel nodes keep independent configuration and delegated phases retain their native output contract', async t => {
  t.mock.method(db, 'prepare', () => assert.fail('No admin inheritance in delegated phases.'));
  const first = node('first', 'First node objective');
  first.data.aiConfiguration.output_schema = {type: 'object', properties: {testCases:{type:'array'}}, required: ['testCases']};
  const second = node('second', 'Second node objective');
  const [a, b] = await Promise.all([first, second].map(item => nodes.runNode(item, {}, async () => {
    await new Promise(resolve => setImmediate(resolve));
    return configuration.resolve('ai.test_case.design');
  })));
  assert.match(a.config.prompt, /First node/); assert.doesNotMatch(a.config.prompt, /Second node/);
  assert.match(b.config.prompt, /Second node/); assert.equal(b.config.output_schema, null);
  await nodes.runNode(first, {}, async () => {
    const supporting = await configuration.resolve('ai.knowledge.intent');
    const defaults = configuration.catalog.find(item => item.id === 'ai.knowledge.intent').defaults;
    assert.equal(supporting.config.prompt, defaults.prompt);
    assert.equal(supporting.config.output_schema, defaults.output_schema);
    assert.equal(supporting.config.context.mode, 'none', 'A planning call cannot recursively retrieve.');
  });
});

test('custom agent model settings and rubric round-trip without duplicating the existing execution limits', async () => {
  const saved = definitions.normalize({name: 'Review checkout', objective: 'Review the supplied checkout evidence.',
    ai_configuration: {temperature: 0.3, context: {mode:'none',token_budget:1500,max_items:5,required:false,focus:''}},
    review_criteria: 'Distinguish missing acceptance from an observed failure.',
    limits: {timeout_ms:70000,max_model_calls:2,max_output_tokens:5000} });
  assert.equal(definitions.toNodeData(saved).aiConfiguration.temperature, 0.3);
  await nodes.runAgent({id:'agent-checkout',registered:{id:'agent-checkout',version:7,definition:saved}}, async () => {
    const resolved = await configuration.resolve('ai.agentic.workflow');
    assert.equal(resolved.configuration_source, 'agent_definition');
    assert.equal(resolved.config.context.mode, 'none');
    assert.equal(resolved.config.max_output_tokens, 5000);
    assert.equal(resolved.config.agent_execution.timeout_ms, 70000);
    assert.match(resolved.config.prompt, /missing acceptance/);
  });
  assert.throws(() => definitions.normalize({...saved,ai_configuration:{max_output_tokens:1000}}), /execution limits/);
});

test('node settings reject invalid budgets, unsafe schemas and hidden prompt aliases', () => {
  for (const value of [{prompt:'Hidden competing prompt'}, {temperature:3}, {agent_execution:{max_model_calls:1,max_revision_rounds:1,max_followups:0,timeout_ms:70000}},
    {context:{mode:'none',required:true,token_budget:1000,max_items:5,focus:''}}, {output_schema:{type:'object',properties:{value:{$ref:'https://external.example/schema'}}}}]) {
    assert.throws(() => nodes.normalize(value));
  }
  assert.throws(() => nodes.scopeForNode({...node('node','Task'),data:{...node('node','Task').data,reviewCriteria:'x'.repeat(4001)}}), /review criteria/);
});

test('stock skills remain the literal reviewed node content', () => {
  const skill = profiles['quality-evaluator'].skills[0];
  assert.equal(instructionFor(skill, 'ai.agentic.quality-evaluator'), skill.instructions);
  assert.doesNotMatch(instructionFor(skill, 'ai.agentic.quality-evaluator'), /HELLOTEST_AI/);
});
