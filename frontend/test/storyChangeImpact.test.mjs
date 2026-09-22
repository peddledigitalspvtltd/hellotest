import assert from 'node:assert/strict';
import test from 'node:test';
import { storyImpactGroups } from '../src/lib/storyChangeImpact.ts';

const response = { impact: { test_cases: [{id:'case'}], test_suites:[], test_runs:[{id:'run'}], automation_assets:[{id:'asset'}], totals:{test_cases:1,test_suites:0,test_runs:1,automation_assets:1} } };
test('Story impact separates missing evidence access from confirmed empty coverage', () => {
  const groups = storyImpactGroups({...response,scope:{unavailable_sources:['testcase.view','suite.view']}});
  assert.equal(groups[0].total, null);
  assert.equal(groups[0].available, false);
  assert.deepEqual(groups[0].items, []);
  assert.equal(groups[1].total, null);
  assert.equal(groups[2].total, 1);
  assert.deepEqual(groups[2].items, [{id:'run'}]);
  assert.equal(storyImpactGroups({...response,impact:{...response.impact,test_cases:[],totals:{test_cases:0}}})[0].total, 0);
});
test('Story impact respects disabled automation and retains full linked populations', () => {
  assert.deepEqual(storyImpactGroups(response,false).map(group=>group.key), ['test_cases','test_suites','test_runs']);
  assert.equal(storyImpactGroups(response)[3].total, 1);
  assert.equal(storyImpactGroups({...response,impact:{...response.impact,totals:{}}})[0].total,1);
});
