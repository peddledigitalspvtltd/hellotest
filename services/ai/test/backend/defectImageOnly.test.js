const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const Fastify = require('fastify');

const profiles = new Map(require('../../../platform/shared/aiFeatureCatalog.json').map(profile => [profile.id, profile.defaults]));
const integration = { id: 'vision', name: 'Vision fixture', model: 'vision-fixture', is_active: true, base_url: 'https://provider.invalid/v1' };
const screenshot = { name: 'Save-error.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };

function load(filename, overrides) {
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
    const name = path.basename(id).replace(/\.js$/, '');
    return Object.hasOwn(overrides, name) ? overrides[name] : localRequire(id);
  }, module, module.exports);
  return module.exports;
}

function promptText(call) {
  const content = call.body.messages.find(message => message.role === 'user').content;
  const text = Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : content;
  return text.replace(/⟦HELLOTEST_AI:([^:⟧]+):([^⟧]+)⟧/g, (_, feature, key) => {
    const configured = profiles.get(feature)?.instruction_blocks?.[key];
    assert.equal(typeof configured, 'string', `Missing Admin instruction ${feature}:${key}`);
    return configured;
  });
}

function supportedImageDraft(call) {
  const ref = promptText(call).match(/reference-image:[a-f0-9]{64}/)?.[0];
  assert.ok(ref, 'The allowed evidence refs must include the image content hash');
  return {
    draft: {
      title: 'Save shows an error', message: 'The supplied screenshot shows an error beside Save.',
      actual_result: 'An error message is visible.', steps_to_reproduce: '', expected_result: '',
      severity: 'medium', priority: 'Medium', environment: '', build: '', labels: [],
      rationale: 'The visible message needs investigation; hidden actions and impact are unknown.'
    },
    field_evidence: Object.fromEntries(['title', 'message', 'actual_result', 'rationale'].map(field => [field, [ref]])),
    gaps: [
      { field: 'steps_to_reproduce', reason: 'The screenshot does not show the preceding actions.', question: 'What actions led to the error?' },
      { field: 'expected_result', reason: 'The required outcome is not supplied.', question: 'What should happen when Save is selected?' }
    ]
  };
}

function fixture(reply = supportedImageDraft, { caseAvailable = true, selectedIntegration = integration } = {}) {
  const calls = [];
  const db = { prepare(sql) {
    return {
      get: async () => /FROM projects/.test(sql) ? { id: 'project' }
        : /FROM test_cases/.test(sql) && caseAvailable ? { id: 'case', title: 'Save profile', description: 'Exercise profile save.' }
          : null,
      all: async () => [],
      run: () => assert.fail('Defect previews must not save changes')
    };
  } };
  const overrides = {
    db,
    'aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => selectedIntegration },
    llmHttpClient: { fetchLlmWithRetry: async (url, options, policy) => {
      const call = { url, body: JSON.parse(options.body), policy };
      calls.push(call);
      const result = typeof reply === 'function' ? await reply(call) : reply;
      if (result instanceof Error) throw result;
      if (result instanceof Response) return result;
      return Response.json({ choices: [{ message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }] });
    } }
  };
  const service = load(path.resolve(__dirname, '../../backend/services/aiBugDraft.service.js'), overrides);
  return { service, calls, overrides };
}

for (const intent of [undefined, '']) {
  test(`Defect drafting accepts image-only input with ${intent === undefined ? 'omitted' : 'empty'} incident brief and cites the actual image`, async () => {
    const f = fixture();
    const result = await f.service.preview({ project_id: 'project', intent, reference_photos: [screenshot] });
    assert.equal(f.calls.length, 1);
    const call = f.calls[0];
    assert.equal(call.policy.contextRetrievalQuery, null, 'Images alone must not trigger retrieval using default instructions or image names');
    const content = call.body.messages.find(message => message.role === 'user').content;
    assert.deepEqual(content.filter(part => part.type === 'image_url'), [{ type: 'image_url', image_url: { url: screenshot.url, detail: 'low' } }]);
    const prompt = promptText(call);
    assert.ok(prompt.includes(profiles.get('ai.bug.draft').instruction_blocks['aiBugDraft.imageOnlyContext']));
    assert.doesNotMatch(prompt, /data:image\//, 'Image bytes belong in vision content, not a text placeholder');
    assert.match(prompt, /"intent":""/);
    const source = result.evidence_sources.find(item => item.type === 'reference-image');
    assert.equal(result.draft.title, 'Save shows an error');
    assert.deepEqual(result.field_evidence.title, [source.ref]);
    assert.deepEqual(result.field_evidence.actual_result, [source.ref]);
    assert.ok(!result.evidence_sources.some(item => item.ref === 'reporter:intent'));
    for (const field of ['steps_to_reproduce', 'expected_result', 'environment', 'build']) {
      assert.equal(result.draft[field], '');
      assert.ok(result.gaps.some(gap => gap.field === field));
    }
    assert.ok(result.gaps.some(gap => gap.field === 'severity'));
    assert.ok(result.gaps.some(gap => gap.field === 'priority'));
  });
}

test('Defect improvement accepts a screenshot without typed intent while retaining its selected Test Case requirement', async () => {
  const f = fixture();
  const result = await f.service.preview({ project_id: 'project', reference_photos: [screenshot], linked_test_case_ids: ['case'], require_case_context: true });
  assert.equal(result.draft.title, 'Save shows an error');
  assert.deepEqual(result.draft.linked_test_case_ids, ['case']);
  assert.match(f.calls[0].policy.contextRetrievalQuery, /Save profile/);
  assert.doesNotMatch(f.calls[0].policy.contextRetrievalQuery, /Save-error\.png|Draft a concise/);
  const missing = fixture(supportedImageDraft, { caseAvailable: false });
  await assert.rejects(missing.service.preview({ project_id: 'project', reference_photos: [screenshot], linked_test_case_ids: ['foreign'], require_case_context: true }), error => error.statusCode === 400 && /context is unavailable/.test(error.message));
  assert.equal(missing.calls.length, 0);
});

test('Defect screenshot-only guidance remains active when the UI stages its original file as secure evidence metadata', async () => {
  const f = fixture();
  const additional_context = '[HELLOTEST_SMART_CONTEXT_START]\n' + JSON.stringify({ files: [{ id: 'file', name: 'Save-error.png', mime_type: 'image/png', url: 'https://files.example.invalid/temporary-source' }], text_excerpts: '' }) + '\n[HELLOTEST_SMART_CONTEXT_END]';
  const result = await f.service.preview({ project_id: 'project', intent: '', additional_context, reference_photos: [screenshot] });
  assert.equal(result.draft.title, 'Save shows an error');
  assert.ok(promptText(f.calls[0]).includes(profiles.get('ai.bug.draft').instruction_blocks['aiBugDraft.imageOnlyContext']));
  assert.equal(f.calls[0].body.messages[1].content.filter(part => part.type === 'image_url').length, 1);
  assert.equal(f.calls[0].policy.contextRetrievalQuery, null, 'Secure file metadata must not become a retrieval query');
});

test('Defect retrieval uses bounded incident evidence without default guidance, selected templates or secure file metadata', async () => {
  const f = fixture();
  const additional_context = 'Profile save is rejected after changing the display name.\n[HELLOTEST_SMART_CONTEXT_START]\n' + JSON.stringify({ files: [{ name: 'PRIVATE_FILE_METADATA', url: 'https://files.example.invalid/PRIVATE_SIGNED_URL' }], text_excerpts: '' }) + '\n[HELLOTEST_SMART_CONTEXT_END]\n[HELLOTEST_TEMPLATE_CONTEXT_START]PRIVATE_TEMPLATE_DEFAULT[HELLOTEST_TEMPLATE_CONTEXT_END]';
  await f.service.preview({ project_id: 'project', intent: 'Save profile fails', evidence: 'An error appears after Save.', additional_context, reference_photos: [screenshot], prompt_guidance: 'PRIVATE_ADMIN_DEFAULT' });
  const query = f.calls[0].policy.contextRetrievalQuery;
  assert.match(query, /Save profile fails/);
  assert.match(query, /An error appears after Save/);
  assert.match(query, /changing the display name/);
  assert.doesNotMatch(query, /PRIVATE_|Save-error\.png|data:image\//);
  assert.ok(query.length <= 3_500);
});

test('required Admin knowledge context retains its image-only query guidance', async () => {
  const error = Object.assign(new Error('This feature requires knowledge context. Add a written description or select a Story.'), { code: 'AI_MCP_QUERY_REQUIRED', statusCode: 422 });
  const f = fixture(error);
  await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [screenshot] }), { code: 'AI_MCP_QUERY_REQUIRED', statusCode: 422 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].policy.contextRetrievalQuery, null);
});

test('Defect drafting rejects missing evidence, unsupported image data and pointer-only links before invoking a model', async () => {
  for (const input of [{}, { external_links: ['https://example.invalid/problem'] }, { linked_test_case_ids: ['missing'] }]) {
    const f = fixture(supportedImageDraft, { caseAvailable: false });
    await assert.rejects(f.service.preview({ project_id: 'project', ...input }), { code: 'AI_DEFECT_EVIDENCE_REQUIRED', statusCode: 400 });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [{ name: 'invalid.png', url: 'data:image/png;base64,invalid' }] }), { code: 'INVALID_AI_REFERENCE_IMAGE', statusCode: 400 });
  assert.equal(f.calls.length, 0);
});

test('Defect image-only responses cannot fabricate success from empty, forged or untitled image findings', async () => {
  for (const reply of [
    { draft: {}, gaps: [] },
    { draft: { title: 'Forged observation' }, field_evidence: { title: ['reference-image:forged'] } },
    call => ({ ...supportedImageDraft(call), draft: { severity: 'high' }, field_evidence: { severity: [promptText(call).match(/reference-image:[a-f0-9]{64}/)[0]] } }),
    Object.assign(new Error('The model omitted required fields.'), { code: 'AI_NATIVE_CONTRACT_INVALID', statusCode: 502 })
  ]) {
    const f = fixture(reply);
    await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [screenshot] }), error => {
      assert.equal(error.code, 'AI_DEFECT_EVIDENCE_REQUIRED');
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /screenshot|evidence/i);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('Defect image-only invalid JSON has a sanitized actionable error', async () => {
  const f = fixture('{PRIVATE_BAD_OUTPUT');
  await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [screenshot] }), error => {
    assert.equal(error.code, 'AI_DEFECT_RESPONSE_INVALID');
    assert.equal(error.statusCode, 502);
    assert.doesNotMatch(error.message, /PRIVATE_BAD_OUTPUT/);
    return true;
  });
});

for (const [status, detail, code, expectedStatus] of [
  [401, 'PRIVATE_PROVIDER_DETAIL', 'LLM_AUTHENTICATION_FAILED', 502],
  [403, 'PRIVATE_PROVIDER_DETAIL', 'LLM_AUTHENTICATION_FAILED', 502],
  [429, '{"error":{"code":"insufficient_quota","message":"PRIVATE_PROVIDER_DETAIL"}}', 'LLM_QUOTA_EXCEEDED', 429],
  [429, 'PRIVATE_PROVIDER_DETAIL', 'LLM_RATE_LIMITED', 429],
  [413, 'PRIVATE_PROVIDER_DETAIL', 'LLM_REQUEST_TOO_LARGE', 413]
]) {
  test(`Defect draft and triage preserve actionable ${code} provider failures (${status})`, async () => {
    const f = fixture(new Response(detail, { status }));
    await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [screenshot] }), error => {
      assert.equal(error.code, code);
      assert.equal(error.statusCode, expectedStatus);
      assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAIL/);
      return true;
    });
    const triage = load(path.resolve(__dirname, '../../backend/services/aiBugTriage.service.js'), {
      ...f.overrides,
      'issues.service': { getIssueItem: async () => ({ id: 'bug', project_id: 'project', title: 'Save fails', message: 'Error shown', priority: 'Medium' }) },
      llmHttpClient: { fetchLlmWithRetry: async () => new Response(detail, { status }) }
    });
    await assert.rejects(triage.preview({ project: { id: 'project' }, issueIds: ['bug'], images: [screenshot] }), { code, statusCode: expectedStatus });
    assert.equal(f.calls.length, 1);
  });
}

test('Defect drafting preserves vision rejection and sanitized timeout without a text-only fallback request', async () => {
  for (const error of [
    Object.assign(new Error('Select a vision-capable integration.'), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 }),
    Object.assign(new Error('PRIVATE_TIMEOUT'), { code: 'UPSTREAM_TIMEOUT', statusCode: 504, publicMessage: 'The configured model timed out. Please retry.' })
  ]) {
    const f = fixture(error);
    await assert.rejects(f.service.preview({ project_id: 'project', reference_photos: [screenshot] }), caught => {
      assert.equal(caught.code, error.code);
      assert.equal(caught.statusCode, error.statusCode);
      assert.doesNotMatch(caught.message, /PRIVATE_TIMEOUT/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('both Defect route aliases admit image-only drafts and improvement while preserving project and context permissions', async t => {
  const f = fixture();
  const checks = [];
  const routes = load(path.resolve(__dirname, '../../../testing/backend/routes/issues.routes.js'), {
    'aiBugDraft.service': f.service,
    'projectAccess': { getProject: async () => ({ id: 'project' }) },
    'featureFlag.service': { isEnabled: async () => true }
  });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require('../../../platform/backend/src/plugins/validator'));
  app.decorate('authenticate', async req => { req.user = { id: 'reporter' }; });
  app.decorate('requirePermission', (permission, scope) => async () => { checks.push({ permission, scope }); });
  await app.register(routes);
  for (const base of ['/feedback', '/issues']) {
    for (const intent of [undefined, '']) {
      const response = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: { project_id: 'project', intent, reference_photos: [screenshot] } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().draft.title, 'Save shows an error');
    }
    const response = await app.inject({ method: 'POST', url: `${base}/ai-improve-preview`, payload: { project_id: 'project', intent: '', linked_test_case_ids: ['case'], reference_photos: [screenshot] } });
    assert.equal(response.statusCode, 200, response.body);
    const rejected = await app.inject({ method: 'POST', url: `${base}/ai-improve-preview`, payload: { project_id: 'project', reference_photos: [screenshot] } });
    assert.equal(rejected.statusCode, 400);
  }
  assert.equal(f.calls.length, 6);
  assert.ok(checks.some(check => check.permission === 'feedback.create' && check.scope.projectId === 'project'));
  assert.equal(checks.filter(check => check.permission === 'testcase.view').length, 2);
});
