const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const { validateNativeArtifactOutput } = require('../../../platform/backend/src/utils/aiGenerationContracts');
const { expandManagedInstructions } = require('../../../platform/backend/test/helpers/managedInstructions');

const image = { name: 'Sign-in.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };
const appType = { id: 'app', project_id: 'project', name: 'Billing', type: 'web' };
const integration = { id: 'vision', name: 'Vision', type: 'llm', is_active: true, model: 'vision-fixture', base_url: 'https://provider.invalid/v1' };
const story = { id: 'story', title: 'Sign in', description: 'A visitor can enter sign-in credentials.', acceptance_criteria: ['The sign-in form displays email and password fields.'] };
const nativeCase = (mode = 'structured') => ({
  title: 'Sign-in form provides credential inputs', description: 'Check the inputs visible in the supplied screen.', priority: 3,
  test_case_type: 'functional', parameter_values: {}, authoring_mode: mode, requirement_refs: [],
  steps: [{ step_type: 'web', action: 'View the sign-in form', expected_result: 'Email and password inputs are displayed' }],
  ...(mode === 'gherkin' ? { gherkin_document: 'Feature: Sign-in form\n  Scenario: Credential inputs\n    Given the sign-in form is available\n    When the visitor views the sign-in form\n    Then email and password inputs are visible' } : {})
});

function fixture(serviceName, reply) {
  const calls = [], knowledgeCalls = [];
  const overrides = {
    'aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
    'aiKnowledge.service': { buildKnowledgeContextPackage: async (...args) => { knowledgeCalls.push(args); return { knowledge: [] }; } },
    'testCase.service': {},
    'aiAttachmentAccess.service': { referenceIds: values => values || [] },
    'dropdownCatalog.service': { getField: async () => ({ default_value: 'functional', options: [{ value: 'functional', active: true }] }) },
    llmHttpClient: { fetchLlmWithRetry: async (url, init, policy) => {
      const body = JSON.parse(init.body), call = { url, body, policy };
      calls.push(call);
      assert.notEqual(policy.featureKey, 'ai.authoring.request_validation', 'Image-only requests need no fabricated written instructions or extra classification call');
      if (reply instanceof Error) throw reply;
      if (reply instanceof Response) return reply.clone();
      const feature = serviceName === 'requirementDesign' ? 'ai.test_case.design' : 'ai.case_authoring.full_case';
      if (typeof reply !== 'string') validateNativeArtifactOutput(feature, reply, { testCaseTypes: ['functional'] });
      policy.onReferenceAttachments?.([{ id: 'stored-image' }]);
      return Response.json({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] });
    } }
  };
  const relative = serviceName === 'requirementDesign' ? '../../backend/services/requirementDesign.service.js' : '../../../ai/backend/services/aiCaseAuthoring.service.js';
  const filename = path.resolve(__dirname, relative), localRequire = createRequire(filename), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => overrides[path.basename(id)] || localRequire(id), module, module.exports);
  return { service: module.exports, calls, knowledgeCalls };
}

function inspectImage(call) {
  const content = call.body.messages.find(message => message.role === 'user').content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content.filter(part => part.type === 'image_url'), [{ type: 'image_url', image_url: { url: image.url, detail: 'low' } }]);
  const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.doesNotMatch(text, /data:image|base64/);
  const task = JSON.parse(text);
  assert.equal(task.generation_request.user_request, '');
  assert.deepEqual(task.reference_images, [{ name: image.name }]);
  assert.equal(call.policy.persistReferenceImages, true);
  assert.deepEqual(call.policy.referenceImageNames, [image.name]);
  const instructions = expandManagedInstructions(call.body.messages.find(message => message.role === 'system').content);
  assert.match(instructions, /No written (?:test brief was|authoring instructions were) supplied/);
  assert.match(instructions, /Do not infer hidden workflows/);
  return task;
}

for (const mode of ['structured', 'gherkin']) {
  test(`image-only ${mode} generation needs neither a Story nor typed instructions and retains source evidence`, async () => {
    const f = fixture('requirementDesign', { testCases: [nativeCase(mode)] });
    const result = await f.service.previewRequirementsTestCases({ appType, requirements: [], images: [image], authoring_mode: mode });
    assert.equal(f.calls.length, 1);
    assert.equal(f.knowledgeCalls.length, 0, 'No unrelated empty-query knowledge search');
    assert.equal(f.calls[0].policy.contextRetrievalQuery, null, 'No semantic text means no graph search');
    const task = inspectImage(f.calls[0]);
    assert.deepEqual(task.stories, []);
    assert.equal(task.application_contract.output_schema.properties.testCases.items.properties.requirement_refs.maxItems, 0);
    assert.deepEqual(result.cases[0].requirement_ids, []);
    assert.deepEqual(result.cases[0].reference_attachment_ids, ['stored-image']);
    assert.equal(result.cases[0].authoring_mode, mode);
  });

  test(`image-only ${mode} improvement preserves the existing case context without custom text`, async () => {
    const f = fixture('aiCaseAuthoring', nativeCase(mode));
    const result = await f.service.previewCaseAuthoring({ appType, test_case: nativeCase(mode), images: [image], authoring_mode: mode });
    const task = inspectImage(f.calls[0]);
    assert.equal(task.current_case.title, nativeCase(mode).title);
    assert.equal(task.story, null);
    assert.deepEqual(result.case.reference_attachment_ids, ['stored-image']);
    assert.equal(result.case.authoring_mode, mode);
    assert.equal(result.context_reduced, false);
  });
}

test('selected Story plus image with no prompt retains explicit Story mapping and a relevant retrieval query', async () => {
  const f = fixture('requirementDesign', { testCases: [{ ...nativeCase(), requirement_refs: ['R1'] }] });
  const result = await f.service.previewRequirementsTestCases({ appType, requirements: [story], images: [image] });
  const task = inspectImage(f.calls[0]);
  assert.equal(task.stories[0].ref, 'R1');
  assert.deepEqual(task.stories[0].acceptance_criteria, story.acceptance_criteria);
  assert.deepEqual(result.cases[0].requirement_ids, [story.id]);
  assert.match(f.knowledgeCalls[0][1].query, /Sign in.*A visitor/s);
  assert.doesNotMatch(f.knowledgeCalls[0][1].query, /Sign-in\.png|HELLOTEST_SMART/);
});

test('single-case authoring also supports a new draft from an image alone', async () => {
  const f = fixture('aiCaseAuthoring', nativeCase());
  const result = await f.service.previewCaseAuthoring({ appType, test_case: {}, images: [image] });
  const task = inspectImage(f.calls[0]);
  assert.equal(task.story, null);
  assert.equal(f.calls[0].policy.contextRetrievalQuery, null);
  assert.equal(result.case.title, nativeCase().title);
});

test('uploaded source metadata never becomes a fabricated written instruction or empty knowledge search', async () => {
  const f = fixture('requirementDesign', { testCases: [nativeCase()] });
  const additional_context = '[HELLOTEST_SMART_CONTEXT_START]' + JSON.stringify({ files: [{ id: 'original', name: 'Sign-in.png', url: 'https://app.example/api/signed' }], text_excerpts: [] }) + '[HELLOTEST_SMART_CONTEXT_END]';
  await f.service.previewRequirementsTestCases({ appType, requirements: [], images: [image], additional_context });
  const task = inspectImage(f.calls[0]);
  assert.equal(task.generation_request.reviewed_context.length, 1);
  assert.equal(f.knowledgeCalls.length, 0);
  assert.equal(f.calls[0].policy.contextRetrievalQuery, null);
});

test('missing text, image, Story and current case fails before provider dispatch', async () => {
  for (const serviceName of ['requirementDesign', 'aiCaseAuthoring']) {
    const f = fixture(serviceName, nativeCase());
    const preview = serviceName === 'requirementDesign' ? f.service.previewRequirementsTestCases : f.service.previewCaseAuthoring;
    await assert.rejects(preview({ appType, requirements: [], test_case: {} }), { statusCode: 422, code: 'AI_AUTHORING_CONTEXT_REQUIRED' });
    assert.equal(f.calls.length, 0);
  }
});

test('empty image-derived generation returns helpful evidence guidance without inventing a fallback case', async () => {
  const f = fixture('requirementDesign', { testCases: [] });
  await assert.rejects(f.service.previewRequirementsTestCases({ appType, images: [image] }), error => {
    assert.equal(error.statusCode, 422); assert.equal(error.code, 'AI_TEST_CASE_EVIDENCE_REQUIRED');
    assert.match(error.message, /clearer screenshot.*behavior and expected outcome/);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('malformed image responses are sanitized and never become a Test Case proposal', async () => {
  for (const serviceName of ['requirementDesign', 'aiCaseAuthoring']) {
    const f = fixture(serviceName, 'invalid-provider-text-SENSITIVE');
    const preview = serviceName === 'requirementDesign' ? f.service.previewRequirementsTestCases : f.service.previewCaseAuthoring;
    await assert.rejects(preview({ appType, images: [image] }), error => {
      assert.equal(error.statusCode, 502); assert.equal(error.code, 'AI_TEST_CASE_RESPONSE_INVALID');
      assert.doesNotMatch(error.message, /SENSITIVE/); return true;
    });
  }
});

test('image-only authoring preserves actionable provider authentication, quota, size and vision errors', async () => {
  for (const serviceName of ['requirementDesign', 'aiCaseAuthoring']) {
    const previewFor = f => serviceName === 'requirementDesign' ? f.service.previewRequirementsTestCases : f.service.previewCaseAuthoring;
    for (const [status, body, code] of [[401, 'invalid key', 'LLM_AUTHENTICATION_FAILED'], [429, 'insufficient_quota', 'LLM_QUOTA_EXCEEDED'], [413, 'request too large', 'LLM_REQUEST_TOO_LARGE']]) {
      const f = fixture(serviceName, new Response(body, { status }));
      await assert.rejects(previewFor(f)({ appType, images: [image] }), { code });
      assert.equal(f.calls.length, 1);
    }
    const f = fixture(serviceName, Object.assign(new Error('Choose a vision-capable model.'), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 }));
    await assert.rejects(previewFor(f)({ appType, images: [image] }), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 });
    assert.equal(f.calls.length, 1);
  }
});
