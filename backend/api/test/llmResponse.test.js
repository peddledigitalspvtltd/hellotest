const assert = require('node:assert/strict');
const test = require('node:test');
const { getCompletionContent } = require('../src/utils/llmResponse');
const completion = content => ({ choices: [{ message: { content } }] });

test('completion extraction preserves string JSON, multipart text and direct structured objects', () => {
  const json = '{"title":"Login", "steps":[]}';
  assert.equal(getCompletionContent(completion(` ${json} `)), json);
  assert.equal(getCompletionContent(completion([
    { type: 'text', text: '{"title":' }, { type: 'output_text', text: '"Login",' },
    { text: { value: ' "steps":' } }, '[]}'
  ])), json);
  assert.deepEqual(JSON.parse(getCompletionContent(completion({ title: 'Login', steps: [] }))), { title: 'Login', steps: [] });
});

test('reasoning and refusals never become user-visible generated artifacts', () => {
  assert.equal(getCompletionContent(completion([
    { type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible answer' },
    { type: 'tool_call', content: 'internal command' }
  ])), 'Visible answer');
  assert.equal(getCompletionContent({ choices: [{ message: { refusal: 'Refused', content: 'Ignored' } }] }), '');
  for (const content of [undefined, null, [], 123]) assert.equal(getCompletionContent(completion(content)), '');
});
