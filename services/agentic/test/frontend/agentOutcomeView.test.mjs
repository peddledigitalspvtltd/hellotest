import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
function load(path, modules = {}) { const exports = {}; new Function('exports', 'require', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => modules[name] || (() => { throw Error(`Unexpected import ${name}`); })()); return exports; }
const output = load('../../frontend/lib/agentOutputValue.ts');
const { agentOutcomeCitationIds, agentOutcomeSources, agentFindingProposals, agentOutcomeCalls, agentOutcomeReviewState, agentHandoffStatus, agentOutcomeBrief } = load('../../frontend/lib/agentOutcomeView.ts', { './agentOutputValue': output });
const citations = [{ id: 'story-1', scope: 'stories', label: 'Approved retry behavior' }, { id: 'case-1', scope: 'test-cases', label: 'Existing checkout test' }];
const finding = { id: 'retry-gap', title: 'Missing retry assertion', detail: 'The existing case omits the retry boundary.', artifact_kind: 'test_case', citation_ids: ['case-1'], requires_proposal: true };
const draft = { kind: 'test_case', title: 'Retry once', description: 'Verify the approved retry outcome.', priority: 'P2', addressed_finding_ids: ['retry-gap'], citation_ids: ['case-1'] };
const result = patch => ({ response: 'Review checkout.', recommendations: [], assumptions: [], ...patch });

test('source counts include nested findings, proposals and reports without claiming invented references exist', () => {
  const ids = agentOutcomeCitationIds(result({ citation_ids: ['story-1'], findings: [finding], artifacts: [draft], sections: [{ citation_ids: ['retired'] }] }));
  assert.deepEqual(ids, ['story-1', 'case-1', 'retired']);
  const sources = agentOutcomeSources(ids, citations);
  assert.equal(sources.available.length, 2); assert.deepEqual(sources.missing, ['retired']);
  assert.equal(agentOutcomeSources(['story-1', 'story-1'], [...citations, citations[0]]).available.length, 1);
});

test('finding coverage needs its exact identity, artifact kind and supporting source', () => {
  assert.deepEqual(agentFindingProposals(finding, 0, [draft]), [draft]);
  for (const changed of [{ ...draft, addressed_finding_ids: ['other'] }, { ...draft, kind: 'story' }, { ...draft, citation_ids: ['story-1'] }]) assert.deepEqual(agentFindingProposals(finding, 0, [changed]), []);
  assert.deepEqual(agentFindingProposals({ ...finding, id: undefined }, 1, [{ ...draft, addressed_finding_ids: ['finding-2'] }]).length, 1);
});

test('all builtin output contracts choose honest review actions from actual output', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../shared/agentOutcomeContracts.json', import.meta.url), 'utf8'));
  for (const [id, contract] of Object.entries(catalog.agents)) {
    assert.equal(agentOutcomeReviewState(result({ outcome_contract: contract }), citations).label, contract.mode === 'author' ? 'Complete outcome' : 'Review conclusions', id);
    assert.equal(agentOutcomeReviewState(result({ outcome_contract: contract, artifacts: [draft] }), citations).label, 'Review & approve', id);
  }
  assert.equal(agentOutcomeReviewState(result({ automation_repair: { status: 'proposal' } })).label, 'Review repair');
  assert.equal(agentOutcomeReviewState(result({ outcome_contract: { mode: 'author' }, no_changes_required: true, verification: { status: 'passed' } })).label, 'Review conclusions');
});

test('acceptance requires resolved source references and completion checks', () => {
  const valid = result({ artifacts: [draft], verification: { status: 'passed' } });
  assert.equal(agentOutcomeReviewState(valid, citations).blocked, false);
  assert.equal(agentOutcomeReviewState(valid, []).blocked, true);
  assert.equal(agentOutcomeReviewState({ ...valid, findings: [{ ...finding, citation_ids: ['retired'] }] }, citations).blocked, true);
  for (const patch of [{ verification: { status: 'needs_input' } }, { readiness: { status: 'insufficient_evidence' } }, { outcome_issues: [{ message: 'Missing successor draft' }] }]) assert.equal(agentOutcomeReviewState({ ...valid, ...patch }, citations).blocked, true);
});

test('model calls retain failed untraced attempts and merge historical chain captures once', () => {
  const records = [{ name: 'Reviewer', trace_id: 'first', status: 'failed', attempt: 1 }, { name: 'Reviewer correction', trace_id: null, status: 'failed', attempt: 2 }];
  const chain = [{ name: 'Reviewer', trace_id: 'first', status: 'completed' }, { name: 'Author', trace_id: 'next', status: 'needs_input' }];
  assert.deepEqual(agentOutcomeCalls(records, chain).map(call => call.trace_id), ['first', null, 'next']);
  assert.equal(agentOutcomeCalls([], chain).length, 2);
  assert.equal(agentOutcomeCalls([records[0], records[0]], []).length, 1);
});

test('handoff presentation never turns zero drafts or failed checks into ready proposals', () => {
  assert.equal(agentHandoffStatus({ status: 'completed', artifact_count: 0 }), 'Completed · no draft prepared');
  assert.equal(agentHandoffStatus({ status: 'completed', artifact_count: 2 }), '2 drafts prepared for review');
  assert.equal(agentHandoffStatus({ status: 'completed' }), 'Assessment completed');
  assert.equal(agentHandoffStatus({ status: 'completed', artifact_count: 1, verification: { status: 'needs_input' } }), 'Needs follow-up');
});

test('the full brief preserves finding rationale, proposals, scope, agent sequence and unresolved references', () => {
  const brief = agentOutcomeBrief(result({ headline: 'Checkout review', evidence_scope: { sprint_id: 'sprint-2' }, findings: [{ ...finding, impact: 'A duplicate order could be missed.', acceptance_check: 'One order after retry.' }], artifacts: [draft], citation_ids: ['retired'], agent_chain: [{ name: 'Case author', status: 'completed', artifact_count: 1, finding_ids: ['retry-gap'] }], outcome_issues: [{ message: 'Runtime evidence not supplied.' }], recommendations: ['Review the oracle.', 'Run the test.'] }), citations, ['Run the test.']);
  for (const value of ['sprint-2', 'A duplicate order could be missed.', 'One order after retry.', '"addressed_finding_ids"', 'Case author', 'retired · source unavailable', 'Runtime evidence not supplied.', 'Run the test.']) assert.ok(brief.includes(value), value);
  assert.equal(brief.includes('Review the oracle.'), false);
});
