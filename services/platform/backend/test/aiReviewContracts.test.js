const { sourceFile } = require("./helpers/sourceFile");
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

process.env.NODE_ENV = 'test';
function load(name, overrides) {
  const filename = sourceFile(`${name}.js`, "services");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    id => {
      const key = Object.keys(overrides).find(candidate => candidate.split('/').pop() === id.split('/').pop());
      return key === undefined ? localRequire(id) : overrides[key];
    }, module, module.exports);
  return module.exports;
}
const integration = { id: 'provider', name: 'Review model', type: 'llm', is_active: true, model: 'model', base_url: 'https://provider.invalid/v1' };
function fixture(content, finishReason = 'stop') {
  const calls = [];
  return {
    calls,
    overrides: {
      './aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
      '../utils/llmHttpClient': { fetchLlmWithRetry: async (url, init, policy) => {
        calls.push({ url, body: JSON.parse(init.body), policy });
        if (content instanceof Error) throw content;
        return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }));
      } }
    }
  };
}
const story = { id: 'story', project_id: 'project', title: 'Invoice approval', description: 'An approver verifies an invoice.', acceptance_criteria: ['Approval records the approver.'] };

for (const artifactType of ['story', 'test-case']) {
  test(`${artifactType} assurance reads content blocks and keeps a valid cited dimension`, async () => {
    const id = artifactType === 'story' ? 'industry-standards' : 'scenario-coverage';
    const content = JSON.stringify({ summary: 'Verify the approval outcome.', dimensions: [
      { id, explanation: 'Verify the recorded approver.', evidence: [`draft:${artifactType}:story`] }
    ] });
    const provider = fixture([{ type: 'text', text: content.slice(0, 60) }, { type: 'text', text: content.slice(60) }]);
    const service = load('artifactAssurance.service', provider.overrides);
    const result = await service.reviewArtifact({ artifactType, savedArtifact: story, projectId: 'project', user: { id: 'user' } });
    assert.equal(result.fallback_used, false);
    assert.equal(result.assurance_review.dimensions[0].explanation, 'Verify the recorded approver.');
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].policy.contextFallback, false, 'Serialized evidence must never be cut by generic transport trimming');
  });
}

test('assurance accepts common provider aliases for nested reviews and citations', async () => {
  const provider = fixture(JSON.stringify({ review: {
    executive_summary: 'Review the approval evidence.',
    dimensions: { 'industry-standards': { finding: 'The draft records an approver.', citation_ids: [{ citation_id: 'DRAFT:STORY:STORY' }], action: 'Keep the approver criterion.' } },
    findings: [{ label: 'Confirm rejection handling', detail: 'The draft does not describe rejection.', evidence_refs: ['draft:story:story'] }]
  } }));
  const service = load('artifactAssurance.service', provider.overrides);
  const result = await service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } });
  assert.equal(result.fallback_used, false);
  assert.equal(result.assurance_review.dimensions[0].evidence[0], 'draft:story:story');
  assert.equal(result.assurance_review.insights[0].title, 'Confirm rejection handling');
  assert.equal(provider.calls.length, 1);
});

test('assurance repairs a usable review whose first response omitted citation fields', async () => {
  const calls = [];
  const overrides = {
    './aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
    '../utils/llmHttpClient': { fetchLlmWithRetry: async (url, init, policy) => {
      calls.push({ url, body: JSON.parse(init.body), policy });
      const content = calls.length === 1
        ? { summary: 'Review approval.', dimensions: [{ id: 'industry-standards', explanation: 'Record the approver.' }] }
        : { summary: 'Review approval.', dimensions: [{ id: 'industry-standards', explanation: 'Record the approver.', evidence: ['draft:story:story'] }] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    } }
  };
  const service = load('artifactAssurance.service', overrides);
  const result = await service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } });
  assert.equal(result.fallback_used, false);
  assert.equal(result.response_repaired, true);
  assert.deepEqual(result.assurance_review.dimensions[0].evidence, ['draft:story:story']);
  assert.equal(calls.length, 2);
  assert.match(require('./helpers/managedInstructions').expandManagedInstructions(calls[1].body.messages[1].content), /Allowed evidence refs/);
  assert.ok(calls[1].policy.timeoutMs > 0 && calls[1].policy.timeoutMs <= calls[0].policy.timeoutMs);
  assert.ok(calls.every(call => call.policy.maxAttempts === 1 && call.policy.compatibility === false));
});

function groomingOverrides(provider) {
  return { ...provider.overrides,
    '../db': { prepare() { assert.fail('Optional records must not be fetched without access'); } },
    './optionalEvidenceAccess.service': { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, false])) }
  };
}
test('Grooming accepts content blocks without losing grounded model output', async () => {
  const provider = fixture([{ type: 'text', text: JSON.stringify({ layman: { explanation: 'An approver verifies the invoice before approval.', evidence_refs: ['requirement:story'] } }) }]);
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  const result = await service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } });
  assert.equal(result.grooming.layman.explanation, 'An approver verifies the invoice before approval.');
  assert.equal(provider.calls[0].policy.contextFallback, false);
  assert.equal(provider.calls.length, 1);
});

test('Grooming rejects a failed model without leaking provider internals', async () => {
  const provider = fixture(Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), { statusCode: 504 }));
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  await assert.rejects(service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } }), error => {
    assert.equal(error.code, 'AI_ASSESSMENT_FAILED');
    assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAIL/);
    return true;
  });
  assert.equal(provider.calls.length, 1);
});

test('Smart Run reserves sufficient response space and reads structured content blocks', async () => {
  const cases = Array.from({ length: 30 }, (_, index) => ({ test_case_id: `case-${index}`, reason: 'Review the changed approval behavior against its linked story evidence.', evidence_refs: [`test-case:case-${index}`] }));
  const provider = fixture([{ type: 'text', text: JSON.stringify({ cases }) }]);
  const service = load('executionPlanning.service', provider.overrides);
  const internals = service.__smartExecutionInternals;
  const response = await internals.requestChatCompletion({ integration, content: 'Review these existing cases.' });
  assert.equal(JSON.parse(response).cases.length, 30);
  assert.equal(provider.calls[0].body.max_tokens, 8192);
  assert.equal(provider.calls[0].policy.maxOutputTokens, 8192);
  assert.equal(provider.calls[0].policy.contextFallback, false);
  assert.throws(() => internals.readPlanningResponseContent({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /truncated/);
  assert.throws(() => internals.normalizeModelExplanations({}, new Map()), /cases array/);
  const allowed = new Map([['case-1', { evidence_refs: ['test-case:case-1'] }]]);
  const normalized = internals.normalizeModelExplanations({ cases: [
    { test_case_id: 'case-1', reason: 'x'.repeat(361), evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-1', reason: 'Grounded explanation.', evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-1', reason: 'Duplicate explanation.', evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-2', reason: 'Not supplied to model.', evidence_refs: ['test-case:case-2'] }
  ] }, allowed);
  assert.equal(normalized.size, 1);
  assert.equal(normalized.get('case-1').reason, 'Grounded explanation.');
});

test('Grooming reviews unsaved draft content while preserving persisted scope and identity', async () => {
  const provider = fixture(JSON.stringify({ layman: { explanation: 'Review the current draft.', evidence_refs: ['requirement:story'] } }));
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  const result = await service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' }, proposedChange: {
    id: 'other-story', project_id: 'other-project', title: 'Current draft', description: 'UNSAVED_DRAFT_SENTINEL', acceptance_criteria: ['UNSAVED_ACCEPTANCE_SENTINEL'], specification_content: 'UNSAVED_SPEC_SENTINEL'
  } });
  assert.equal(result.requirement.id, 'story');
  assert.equal(result.requirement.title, 'Current draft');
  assert.equal(result.context.scope.project_id, 'project');
  const prompt = provider.calls[0].body.messages[1].content;
  assert.match(prompt, /UNSAVED_DRAFT_SENTINEL/);
  assert.match(prompt, /UNSAVED_ACCEPTANCE_SENTINEL/);
  assert.match(prompt, /UNSAVED_SPEC_SENTINEL/);
  assert.doesNotMatch(prompt, /An approver verifies an invoice|other-story|other-project/);
});

test('An empty Grooming object fails instead of claiming model refinement', async () => {
  const provider = fixture('{}');
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  await assert.rejects(service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } }), { code: 'AI_ASSESSMENT_FAILED' });
});

test('assurance rejects forged references after exactly one repair', async () => {
  const provider = fixture(JSON.stringify({ dimensions: [{ id: 'industry-standards', explanation: 'Invented finding', evidence: ['invented:source'] }] }));
  const service = load('artifactAssurance.service', provider.overrides);
  await assert.rejects(service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } }), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  assert.equal(provider.calls.length, 2);
  assert.ok(provider.calls.every(call => call.policy.maxAttempts === 1 && call.policy.contextFallback === false && call.policy.compatibility === false));
});

test('assurance requires a configured model before making a request', async () => {
  const provider = fixture('{}');
  provider.overrides['./aiLlmSelection.service'].resolveLlmIntegrationForUsage = async () => null;
  const service = load('artifactAssurance.service', provider.overrides);
  await assert.rejects(service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project' }), { code: 'AI_MODEL_REQUIRED' });
  assert.equal(provider.calls.length, 0);
});
