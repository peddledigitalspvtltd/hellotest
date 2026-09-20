const assert = require('node:assert/strict');
const test = require('node:test');
const { deriveStoryReadiness, contentHash, preserveReadinessFields } = require('../src/utils/storyReadiness');
const story = { title:'Save address', description:'As a buyer I want to save my address so that future checkout is faster.', gherkin_scenarios:['Given a valid address When I save Then it is available at checkout'] };
const reviewed = (base, checks) => ({ ...base, additional_fields:{ _story_readiness:{ checks:Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, { status:'met', evidence:'Reviewed evidence', verified_by:'reviewer', verified_at:'2026-09-20T10:00:00Z', content_hash:contentHash(base), ...value }])) } } });
test('backlog readiness needs all five checks and rejects incomplete acceptance placeholders', () => {
  assert.equal(deriveStoryReadiness(story).score, 40);
  const partial = { ...story, gherkin_scenarios:[...story.gherkin_scenarios, 'Scenario: TODO'] };
  assert.equal(deriveStoryReadiness(partial).score, 20);
  assert.equal(deriveStoryReadiness({ title:'Unknown' }).score, null);
  assert.equal(deriveStoryReadiness({ ...story, description:'As a [persona] I want [outcome] so that [value]' }).score, 20);
  const verified = reviewed(story, { wireframe:{ attachment_id:'wire' }, dependencies:{}, story_points:{} });
  assert.equal(deriveStoryReadiness(verified, { attachment_ids:['wire'] }).score, 100);
  assert.equal(deriveStoryReadiness(verified).score, 80, 'Deleted wireframe invalidates the attachment check');
  assert.equal(deriveStoryReadiness({ ...verified,title:'Changed Story' }, { attachment_ids:['wire'] }).score, 40, 'Content changes invalidate reviews');
  assert.equal(deriveStoryReadiness(reviewed(story, { acceptance_criteria:{ status:'not_met' } })).score, 20, 'A reviewer can reject superficially valid criteria');
});
test('native, legacy and inherited delivery scopes all select release checks', () => {
  for (const [item, facts] of [[{...story,iteration_id:'s'},{}],[{...story,sprint:'Sprint'},{}],[{...story,release:'Release'},{}],[story,{release_scoped:true}],[story,{assigned:true}]]) {
    const result = deriveStoryReadiness(item, facts);
    assert.equal(result.label, 'Story Release Readiness');
    assert.equal(result.checks.length, 5);
    assert.ok(result.checks.every(check => !['wireframe','story_points'].includes(check.key)));
  }
});
test('release approvals cannot replace incomplete execution or open defect evidence', () => {
  const base = { ...story, iteration_id:'sprint' };
  const release = reviewed(base, { acceptance_tests:{}, code_review:{}, automated_tests:{}, product_owner:{} });
  const facts = { execution_complete:true, linked_cases:2, executed_cases:2, passed_cases:2, open_priority_bugs:0 };
  assert.equal(deriveStoryReadiness(release,facts).score, 100);
  assert.equal(deriveStoryReadiness(release,{...facts, passed_cases:1}).score, 80);
  assert.equal(deriveStoryReadiness(release,{...facts, linked_cases:0, executed_cases:0, passed_cases:0}).score, 80);
  assert.equal(deriveStoryReadiness(release,{...facts, open_priority_bugs:1}).score, 80);
  assert.equal(deriveStoryReadiness(release,{...facts, execution_complete:false}).checks[0].status, 'unverified');
  assert.equal(deriveStoryReadiness(base,facts).score, 20, 'Passing tests alone do not prove acceptance completeness, merged code or sign-off');
});
test('ordinary saves cannot spoof or erase stored review evidence', () => {
  const original = reviewed(story, { dependencies:{} }).additional_fields;
  assert.deepEqual(preserveReadinessFields({ custom:5, _story_readiness:{ checks:{} } }, original), { ...original, custom:5 });
  assert.deepEqual(preserveReadinessFields({ custom:5, _story_readiness:original._story_readiness }), { custom:5 });
});
