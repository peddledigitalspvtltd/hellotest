import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(name) {
  const exports = {};
  new Function('exports', ts.transpileModule(readFileSync(sourceFile(name + '.ts', "lib"), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
  return exports;
}
const context = load('smartContext');
const design = load('aiDesignStudio');
const llm = load('aiLlmDefault');
const hit = (id, overrides = {}) => ({ id, chunk_id: id, source_id: 'story-' + id, source_kind: 'requirement', title: 'Checkout ' + id, content: 'Evidence for ' + id, ...overrides });
test('Smart Context retrieves acceptance arrays and executable specifications', () => {
 const query=context.buildSmartContextQuery(JSON.stringify({title:'Refund',acceptance_criteria:['Reject duplicate refunds'],specification_content:'Refund at most the settled amount',gherkin_scenarios:['Given a refunded order When retried Then reject']}));
 assert.match(query,/Reject duplicate refunds/);assert.match(query,/settled amount/);assert.match(query,/refunded order/);
});

test('feature context excludes other domains, empty excerpts and repeated chunks/content', () => {
  const hits = [hit('a'), hit('a'), hit('duplicate', { content: 'Evidence  for a' }), hit('run', { source_kind: 'execution' }), hit('empty', { content: '' }), hit('b')];
  const selected = context.normalizeSmartContextHits(hits, context.SMART_CONTEXT_SOURCE_KINDS.requirement_creation);
  assert.deepEqual(selected.map(item => item.id), ['a', 'b']);
  assert.ok(context.SMART_CONTEXT_SOURCE_KINDS.bug_creation.includes('execution'));
  assert.deepEqual(context.smartContextKindsForScopes(['stories', 'stories']).filter(kind => ['requirement', 'execution', 'bug'].includes(kind)), ['requirement']);
  assert.deepEqual(context.smartContextKindsForScopes(['requirements', 'test-runs', 'object-repository']).filter(kind => ['requirement', 'execution', 'test_case', 'bug'].includes(kind)), ['requirement', 'execution', 'test_case']);
});

test('review profiles use semantic artifact content without record ids or review metadata', () => {
  const query = context.buildSmartContextQuery(JSON.stringify({ id: 'private-id', status: 'draft', title: 'Checkout retry', description: '<p>Prevent duplicate payments</p>', steps: [{ action: 'Retry declined payment', expected_result: 'One confirmed order' }], metadata: { reviewer: 'unrelated reviewer' } }), 'Preserve retry limits', context.AI_REVIEW_CONTEXT_PROFILES['ai.quality.test_case_assurance'].purpose);
  assert.match(query, /Checkout retry.*Prevent duplicate payments.*Retry declined payment.*One confirmed order.*Preserve retry limits/);
  assert.doesNotMatch(query, /private-id|draft|metadata|reviewer|<p>/);
  assert.ok(context.AI_REVIEW_CONTEXT_PROFILES['ai.quality.story_assurance'].sourceKinds.includes('execution'));
  assert.equal(context.AI_REVIEW_CONTEXT_PROFILES['ai.requirement.grooming'].sourceKinds.includes('execution'), false);
});

test('reviewed context stays bounded with complete source blocks and closing markers', () => {
  const hits = Array.from({ length: 16 }, (_, index) => hit(String(index), { title: 'Large '.repeat(100), content: `Unique ${index} ` + 'Evidence '.repeat(200) }));
  const pack = context.buildReviewedSmartContext(hits, 'q'.repeat(4_000), 'Selected story\n' + 'File evidence '.repeat(800));
  assert.ok(pack.contextText.length <= 12_000);
  assert.ok(pack.contextText.endsWith(design.SMART_CONTEXT_END));
  assert.ok(pack.hits.length < hits.length && pack.hits.length > 0);
  for (const entry of pack.hits) assert.ok(pack.contextText.includes('[' + entry.id + ']'));
  assert.equal((pack.contextText.match(/\[\d+\]/g) || []).length, pack.hits.length);
});

test('applying a reviewed pack preserves exact edits and replaces old artifact/file evidence', () => {
  const old = context.buildReviewedSmartContext([hit('a')], 'Checkout', 'Old story and file context').contextText;
  const edited = context.buildReviewedSmartContext([hit('b')], 'Payment', 'New story and file context').contextText.replace('Evidence for b', 'Reviewer edit:\n  preserve   spacing');
  const applied = design.replaceSmartContextPack('Manual instructions\n\n' + old, edited);
  assert.ok(applied.endsWith(edited));
  assert.equal(applied.includes('Old story and file context'), false);
  assert.equal((applied.match(/HELLOTEST_SMART_CONTEXT_START/g) || []).length, 1);
  assert.throws(() => design.replaceSmartContextPack('x'.repeat(18_000), edited), /Shorten/);
});

test('applying a prompt template updates visible Generation Context without discarding manual or Smart Context text', () => {
  const smartPack = `${design.SMART_CONTEXT_START}\nReviewed Story evidence\n${design.SMART_CONTEXT_END}`;
  const first = design.replaceTemplateContextPack(`Manual instructions\n\n${smartPack}`, 'Cover failed checkout recovery');
  const replaced = design.replaceTemplateContextPack(first, 'Cover blocked payment retries');
  assert.match(replaced, /Manual instructions/);
  assert.match(replaced, /Reviewed Story evidence/);
  assert.match(replaced, /Cover blocked payment retries/);
  assert.doesNotMatch(replaced, /Cover failed checkout recovery/);
  assert.equal((replaced.match(/HELLOTEST_TEMPLATE_CONTEXT_START/g) || []).length, 1);
});

test('last successful defaults ignore inactive and other-project providers while honoring overrides', () => {
  const integrations = [{ id: 'worked', name: 'Working' }, { id: 'override', name: 'Configured' }, { id: 'inactive', name: 'Retired', is_active: false }];
  const prefs = { ai_last_successful_llm: [
    { integration_id: 'inactive', project_id: 'project', usage_key: 'feature', succeeded_at: '2026-09-22T14:00:00Z' },
    { integration_id: 'override', project_id: 'other-project', usage_key: 'feature', succeeded_at: '2026-09-22T13:00:00Z' },
    { integration_id: 'worked', project_id: 'project', usage_key: 'feature', succeeded_at: '2026-09-22T12:00:00Z' }
  ] };
  assert.equal(llm.resolveAiLlmDefault({ preferences: prefs, usageKey: 'feature', projectId: 'project', integrations }), 'worked');
  assert.equal(llm.resolveAiLlmDefault({ preferences: { ...prefs, ai_prompt_registry_llm_overrides: { feature: 'override' } }, usageKey: 'feature', projectId: 'project', integrations }), 'override');
});
