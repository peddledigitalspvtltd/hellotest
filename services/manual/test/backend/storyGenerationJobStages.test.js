const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { storyGenerationJobProcessing: processing } = require('../../backend/services/requirementWorkspace.service').__storyGenerationJobInternals;

const stageStates = job => Object.fromEntries(job.stages.map(stage => [stage.id, stage.status]));

test('a queued or running job is reported on its first stage, as before', () => {
  assert.equal(processing('queued').active_stage_id, 'intake');
  assert.equal(stageStates(processing('queued')).intake, 'queued');
  const running = processing('running');
  assert.deepEqual([running.active_stage_id, running.completed_stage_count, stageStates(running).intake], ['intake', 0, 'running']);
});

test('a failure of the model call is attributed to the specialist stage, with the earlier stages complete', () => {
  // Real platform wording remains visible, but only the saved stage determines attribution.
  for (const message of [
    'The selected model provider has exhausted its available quota or billing allowance. Review the integration usage and billing settings.',
    'The selected AI provider is limiting requests or has exhausted its available quota. Review the connection\'s rate limits, usage and billing before retrying.',
    'The selected model provider temporarily rejected this request because its rate limit was reached.',
    'The selected model provider did not respond within its timeout.',
    'The selected model or provider endpoint was not found. Check the integration model and base URL.',
    'The model provider rejected the request parameters. Check the selected model, output format and AI configuration.',
    'LLM integration rejected the request with status 401. Check the selected provider credentials, model access, and base URL.',
    'This model request exceeds the provider token rate limit even when idle. Reduce the request size or select an integration with sufficient capacity.',
    'A connected service could not be reached.',
    'A connected service did not respond in time.',
    'A connected service is temporarily unavailable.',
    'A required service is recovering. Please retry shortly.'
  ]) {
    const job = processing('failed', { code: 'LLM_QUOTA_EXCEEDED', message }, 'specialist');
    assert.equal(job.active_stage_id, 'specialist', message);
    assert.equal(job.completed_stage_count, 3, message);
    assert.deepEqual(stageStates(job), { intake: 'complete', context: 'complete', guardrails: 'complete', specialist: 'failed', outcome: 'queued', evaluation: 'queued', review: 'queued' }, message);
    assert.equal(job.stages.find(stage => stage.id === 'specialist').detail, message, 'the person still sees the real message');
    assert.equal(job.status_label, 'Generation needs attention');
  }
});

test('an answer that came back unusable is attributed to the outcome check, even when it names the provider', () => {
  for (const message of [
    'The model did not return a complete Story with a title, description and observable acceptance criteria supported by the supplied product context.',
    'The configured model did not return a complete Story with a title, description and evidence-backed acceptance criteria.',
    // Names "AI provider", but the call succeeded: it must not read as a model-call failure.
    'The AI provider did not return a complete JSON draft. Please generate the preview again.'
  ]) {
    const job = processing('failed', { code: 'AI_STORY_RESPONSE_INVALID', message }, 'outcome');
    assert.equal(job.active_stage_id, 'outcome', message);
    assert.equal(job.completed_stage_count, 4, message);
    assert.equal(stageStates(job).specialist, 'complete', message);
    assert.equal(stageStates(job).outcome, 'failed', message);
  }
});

test('wording never overrides the recorded stage and unknown failures remain at intake', () => {
  // "provider" alone is not evidence of a model-call failure: this one is about choosing a provider, before any call.
  for (const message of [
    'provider selection failed',
    'The Story generation job creator is no longer available.',
    'Add a product description or upload a PNG, JPEG, or WebP image before creating Stories.',
    'Something unexpected happened.'
  ]) {
    const job = processing('failed', message);
    assert.equal(job.active_stage_id, 'intake', message);
    assert.equal(job.completed_stage_count, 0, message);
    assert.equal(stageStates(job).intake, 'failed', message);
    assert.equal(job.stages[0].detail, message);
  }
  assert.equal(processing('failed').stages[0].detail, '');
  assert.equal(processing('failed').stages.length, 7);
});
