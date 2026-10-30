const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { groomingCandidate } = require('../../../platform/backend/test/helpers/groomingCandidate');
process.env.NODE_ENV = 'test';
const integration = { id: 'model', name: 'Configured reviewer', model: 'fixture', is_active: true, base_url: 'https://model.invalid/v1' };
const story = { id: 'story', project_id: 'project', title: 'Update the profile name', description: 'A signed-in customer can save a display name and see it after reload.\n## Risks\nThe existing record may have no name.\n## Open questions\nWhat is the supported character limit?', acceptance_criteria: ['Saving a valid name preserves it after reload.'] };
function fixture(replies, { model = integration } = {}) {
 const calls = [];
 const overrides = {
  db: { prepare: () => { throw new Error('No optional source access'); } },
  'optionalEvidenceAccess.service': { getOptionalEvidenceAccess: async () => ({}) },
  'aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => model },
  llmHttpClient: { fetchLlmWithRetry: async (_url, options, policy) => {
   const call = { body: JSON.parse(options.body), policy }; calls.push(call);
   const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
   if (reply instanceof Error) throw reply;
   return Response.json({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] });
  } }
 };
 const filename = path.resolve(__dirname, '../../backend/services/requirementWorkspace.service.js');
 const local = createRequire(filename), module = { exports: {} };
 new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => overrides[path.basename(id).replace(/\.js$/, '')] || local(id), module, module.exports);
 return { calls, service: module.exports, run: () => module.exports.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'author' } }) };
}
test('Grooming preserves empty unknown sections and empty review arrays without substituting local narratives', async () => {
 const f = fixture([groomingCandidate()]);
 const result = await f.run();
 assert.equal(result.generation_mode, 'llm'); assert.equal(result.fallback_used, false); assert.deepEqual(result.fallback_sections, []);
 assert.equal(result.grooming.walkthrough.implementation.overview, '');
 assert.deepEqual(result.grooming.open_questions, []); assert.deepEqual(result.grooming.risks, []);
 assert.equal(f.calls.length, 1); assert.equal(result.model_execution.contract_repaired, false);
});
test('Grooming keeps model checks beside explicit server measured readiness adjustments', async () => {
 const candidate = groomingCandidate();
 const item = candidate.readiness.checks.find(check => check.id === 'implementation-approach');
 Object.assign(item, { status: 'met', detail: 'The implementation approach is clear.', evidence_refs: ['requirement:story'] });
 const f = fixture([candidate]), result = await f.run(), readiness = result.grooming.readiness;
 assert.equal(result.fallback_used, false);
 assert.equal(readiness.model_checks.find(check => check.id === item.id).detail, item.detail);
 assert.equal(readiness.model_checks.find(check => check.id === item.id).status, 'met');
 assert.equal(readiness.checks.find(check => check.id === item.id).status, 'missing');
 assert.equal(readiness.measurement_adjustments.find(check => check.check_id === item.id).applicability, 'unconfirmed');
 assert.match(readiness.checks.find(check => check.id === item.id).detail, /^Source completeness measurement:/);
});
for (const invalid of [{ layman: {} }, '{PRIVATE_INVALID_MODEL_JSON']) {
 test(`Grooming repairs ${typeof invalid === 'string' ? 'malformed JSON' : 'missing sections'} once with exact diagnostics and unchanged evidence`, async () => {
  const f = fixture([invalid, groomingCandidate()]), result = await f.run();
  assert.equal(f.calls.length, 2); assert.equal(result.model_execution.contract_repaired, true);
  assert.equal(f.calls[0].body.messages[1].content, f.calls[1].body.messages[1].content);
  const correction = f.calls[1].body.messages[2].content;
  assert.match(correction, /validation_errors/); assert.match(correction, /required_|invalid_json_object/);
  assert.ok(f.calls.every(call => call.policy.maxAttempts === 1 && call.policy.compatibility === false && call.policy.contextFallback === false));
  assert.ok(f.calls[1].policy.timeoutMs <= f.calls[0].policy.timeoutMs);
 });
}
test('Grooming rejects forged citations and incomplete repeated output without a fallback or raw response disclosure', async () => {
 const candidate = groomingCandidate(); candidate.walkthrough.purpose.evidence_refs = ['forged:PRIVATE_RESPONSE'];
 const f = fixture([candidate]);
 await assert.rejects(f.run(), error => {
  assert.equal(error.code, 'AI_GROOMING_OUTPUT_INVALID'); assert.equal(error.model_calls, 2);
  assert.ok(error.validation_errors.some(item => item.path === 'walkthrough.purpose.evidence_refs'));
  assert.doesNotMatch(error.message, /PRIVATE_RESPONSE/); return true;
 }); assert.equal(f.calls.length, 2);
});
test('Grooming explains invalid readiness enum paths and never accepts linked coverage from a Story alone', async () => {
 const invalid = groomingCandidate(), valid = groomingCandidate();
 invalid.readiness.checks[0].status = 'unknown';
 Object.assign(invalid.readiness.checks[8], { status: 'met', evidence_refs: ['requirement:story'] });
 const f = fixture([invalid, valid]); await f.run();
 const correction = JSON.parse(f.calls[1].body.messages[2].content.split('\n').at(-1));
 assert.ok(correction.validation_errors.some(item => item.path === 'readiness.checks.intent.status'));
 assert.ok(correction.validation_errors.some(item => item.issue === 'met_coverage_requires_linked_test_record'));
});
test('Grooming does not retry provider failures or return a local review without an active model', async () => {
 const f = fixture([new Error('PRIVATE_PROVIDER_RESPONSE')]);
 await assert.rejects(f.run(), { code: 'AI_ASSESSMENT_FAILED' }); assert.equal(f.calls.length, 1);
 const missing = fixture([], { model: null }); await assert.rejects(missing.run(), { code: 'AI_MODEL_REQUIRED' }); assert.equal(missing.calls.length, 0);
});
