import assert from 'node:assert/strict';
import test from 'node:test';
import { compactAiRequestBody, requestAiWithShorterContext } from '../src/lib/aiRequestContext.ts';

test('AI body reduction preserves Story/project/model/output scope and discards oversized optional context', () => {
  const compact = JSON.parse(compactAiRequestBody(JSON.stringify({ project_id: 'project', requirement_ids: ['story'], requirement_id: 'story', integration_id: 'provider', authoring_mode: 'gherkin', max_cases: 3, images: [{ url: 'large image' }], additional_context: 'x'.repeat(9000), requirement_context: { description: 'large' } })));
  assert.deepEqual(compact.requirement_ids, ['story']);
  assert.equal(compact.requirement_id, 'story');
  assert.equal(compact.project_id, 'project');
  assert.equal(compact.integration_id, 'provider');
  assert.equal(compact.authoring_mode, 'gherkin');
  assert.equal(compact.max_cases, 3);
  assert.equal(compact.additional_context.length, 2000);
  assert.equal(compact.images, undefined);
  assert.equal(compact.requirement_context, undefined);
});

test('only rejected 413 requests retry once and the preview discloses the reduced evidence', async () => {
  const bodies = [];
  const response = await requestAiWithShorterContext(async init => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) throw Object.assign(new Error('too large'), { status: 413 });
    return { cases: [{ title: 'Draft' }] };
  }, { method: 'POST', body: JSON.stringify({ requirement_ids: ['story'], images: ['large'] }) });
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].requirement_ids, ['story']);
  assert.equal(response.context_reduced, true);
  assert.match(response.context_reduction_reason, /Review against the original Story/);
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(requestAiWithShorterContext(async () => { calls++; throw Object.assign(new Error('failure'), { status }); }, { body: JSON.stringify({ images: ['large'] }) }));
    assert.equal(calls, 1);
  }
  let upstreamCalls = 0;
  await assert.rejects(requestAiWithShorterContext(async () => {
    upstreamCalls++;
    throw Object.assign(new Error('LLM request failed with status 413'), { status: 413 });
  }, { body: JSON.stringify({ images: ['large'] }) }));
  assert.equal(upstreamCalls, 1);
});
