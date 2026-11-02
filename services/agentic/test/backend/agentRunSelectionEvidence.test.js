const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunSelectionLoader } = require('../../backend/services/agentRunSelectionEvidence');
const { storyTargets } = require('../../backend/services/agentArtifacts');
function fixture({ allowed = true, count = 2 } = {}) {
  const calls = [], records = Array.from({ length: count }, (_, i) => ({ id: `case-${i}`, title: `Saved case ${i}`, revision: 3, status: 'draft', automated: 'no' }));
  const load = createRunSelectionLoader({ hasPermission: async (...args) => { calls.push(args); return allowed; }, db: { prepare: sql => ({ all: async (...args) => { calls.push({ sql, args }); return records; } }) } });
  return { load, calls };
}
const input = { agentId: 'run-planner', projectId: 'project', appTypeId: 'app', user: { id: 'actor' }, inputs: { story_id: 'story', release_id: 'release', test_case_id: 'case-0' } };
test('Run selection reads only authorized exact scoped native identities and survives artifact target extraction', async () => {
  const f = fixture(), item = await f.load(input), data = JSON.parse(item.content);
  assert.deepEqual(data.evidence_permissions, ['testcase.view']);
  assert.deepEqual(f.calls[0], [input.user, 'testcase.view', 'project']);
  assert.match(f.calls[1].sql, /a.project_id=\?/); assert.match(f.calls[1].sql, /t.app_type_id=\?/); assert.match(f.calls[1].sql, /t.id = \?/);
  assert.ok(f.calls[1].args.includes('story')); assert.ok(f.calls[1].args.includes('release'));
  assert.equal(storyTargets({ run_selection: [item] }).length, 2);
  assert.equal(storyTargets({ run_selection: [item] })[0].citation_id, item.citation.id);
});
test('denied or unrelated intents do not query native records', async () => {
  const denied = fixture({ allowed: false }); assert.equal(await denied.load(input), null); assert.equal(denied.calls.length, 1);
  const unrelated = fixture(); assert.equal(await unrelated.load({ ...input, agentId: 'story-architect' }), null); assert.equal(unrelated.calls.length, 0);
  const pinned = fixture(); assert.equal(await pinned.load({ ...input, sourceIds: ['selected-indexed-source'] }), null); assert.equal(pinned.calls.length, 0, 'Native candidate reads must not widen explicit selected-source boundaries.');
});
test('candidate budgets preserve exact complete returned records and disclose omissions', async () => {
  const f = fixture({ count: 31 }), data = JSON.parse((await f.load(input)).content);
  assert.equal(data.records.length, 30); assert.equal(data.selection_complete, false); assert.match(data.limitations[0], /narrow the scope/);
});
test('an assessment explicitly permitted to prepare Run proposals receives the same bounded candidate contract', async () => {
  const f=fixture(),item=await f.load({...input,agentId:'quality-evaluator',proposalCandidates:true});
  assert.equal(JSON.parse(item.content).records.length,2);
});
