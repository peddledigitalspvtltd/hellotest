const test = require('node:test');
const assert = require('node:assert/strict');
const { presentationIssues } = require('../../backend/services/agentOutcomePresentation');
const { aggregateUsage, revisionFeedback, normalizeResult } = require('../../backend/services/agenticAssistant.service')._internals;
const citations = [{ id: 'evidence-1' }];
const base = () => ({ response: 'Observed result [evidence-1].', citation_ids: ['evidence-1'] });

test('native presentation rejects object coercions and placeholder text instead of displaying them', () => {
  for (const value of [{ title: 'hidden' }, ['hidden'], null, 'null', 'undefined', '[object Object]']) {
    assert.ok(presentationIssues({ ...base(), response: value }, citations).some(issue => issue.path === 'response'));
  }
  assert.ok(presentationIssues({ ...base(), recommendations: [{ detail: 'not text' }] }, citations).some(issue => issue.path === 'recommendations'));
  const fallback = { marker: 'not-a-result' };
  assert.equal(normalizeResult({ ...base(), response: { detail: 'nested' } }, fallback, citations), fallback);
});
test('cited sections, rectangular text tables and finite signed charts have a native readable contract', () => {
  const candidate = { ...base(), sections: [{ title: 'Observed scope', body: 'Two measured builds.', citation_ids: ['evidence-1'] }],
    tables: [{ title: 'Measurements', columns: ['Build', 'Change'], rows: [['A', '-2 ms']], citation_ids: ['evidence-1'] }],
    charts: [{ title: 'Measured change', type: 'bar', unit: 'ms', series: [{ label: 'A', value: -2 }], citation_ids: ['evidence-1'] }] };
  assert.deepEqual(presentationIssues(candidate, citations), []);
  assert.ok(presentationIssues({ ...candidate, tables: [{ ...candidate.tables[0], rows: [['A', { value: 2 }]] }] }, citations).length);
  assert.ok(presentationIssues({ ...candidate, tables: [{ ...candidate.tables[0], rows: [['A']] }] }, citations).length);
  assert.ok(presentationIssues({ ...candidate, charts: [{ ...candidate.charts[0], series: [{ label: 'A', value: '2' }] }] }, citations).length);
  assert.ok(presentationIssues({ ...candidate, sections: [{ ...candidate.sections[0], citation_ids: ['invented'] }] }, citations).length);
});
test('finding details remain bounded and every named source resolves to the supplied evidence', () => {
  const finding = { id: 'finding-1', title: 'Missing retry assertion', detail: 'The recorded case omits a retry check.', citation_ids: ['evidence-1'], priority: 'high' };
  assert.deepEqual(presentationIssues({ ...base(), findings: [finding] }, citations), []);
  for (const patch of [{ priority: { value: 'high' } }, { type: ['review'] }, { impact: 'x'.repeat(2401) }, { citation_ids: ['invented'] }]) assert.ok(presentationIssues({ ...base(), findings: [{ ...finding, ...patch }] }, citations).length);
  assert.ok(presentationIssues({ ...base(), citation_ids: ['invented'] }, citations).some(issue => issue.path === 'citation_ids'));
});
test('revision retains whole untrusted output or an explicit omission within a bounded packet', () => {
  const small = revisionFeedback({ response: 'Draft', artifacts: [{ title: 'Proposal' }] }, [{ path: 'title', issue: 'required' }], 1);
  assert.equal(small.previous_draft.artifacts[0].title, 'Proposal');
  assert.equal(small.draft_status, 'untrusted_proposal');
  const large = revisionFeedback({ response: 'x'.repeat(13000) }, [], 2);
  assert.equal(large.previous_draft, null);assert.equal(large.previous_draft_omitted, true);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(large)));
});
test('session token totals remain unknown when any provider call lacks usage', () => {
  const a = { usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } };
  const b = { usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } };
  assert.deepEqual(aggregateUsage([a, b]), { usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 }, usage_unknown_calls: 0 });
  assert.deepEqual(aggregateUsage([a, { status: 'failed' }]), { usage: { input_tokens: null, output_tokens: null, total_tokens: null }, usage_unknown_calls: 1 });
});

test('historical malformed proposals cannot crash editors or renumber proposal receipts',()=>{
 const {normalizeSavedReviewResult}=require('../../backend/services/agenticAssistant.service')._internals;
 const story={kind:'story',title:'Checkout',description:'Recorded description',priority:'P2',acceptance_criteria:['Given an order, when retried, then one order exists.'],citation_ids:['evidence-1']};
 const saved={...base(),artifacts:[story,{...story,title:{bad:'object'}}],findings:[{title:{bad:'object'},detail:'Recorded detail',priority:{bad:'object'},citation_ids:['evidence-1']}],evaluation:{}};
 const result=normalizeSavedReviewResult(saved,citations);
 assert.deepEqual(result.artifacts,[]);assert.equal(result.verification.status,'needs_input');assert.equal(result.outcome_issues[0].code,'AGENT_SAVED_PROPOSALS_INVALID');
 assert.equal(result.findings[0].title,'Saved finding');assert.equal(result.findings[0].priority,undefined);
 const valid=normalizeSavedReviewResult({...saved,artifacts:[story]},citations);
 assert.equal(valid.artifacts[0].title,'Checkout');assert.equal(valid.artifacts[0].priority,'P2');
});
