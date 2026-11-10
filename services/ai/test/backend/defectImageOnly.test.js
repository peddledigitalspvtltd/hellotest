const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
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

function fixture(reply = supportedImageDraft, {
  caseAvailable = true,
  selectedIntegration = integration,
  run,
  failures = [],
  steps = [],
  attachments = [],
  attachmentBytes,
  failurePackets
} = {}) {
  const calls = [], reads = [];
  const db = { prepare(sql) {
    return {
      get: async () => /FROM projects/.test(sql) ? { id: 'project' }
        : /FROM executions/.test(sql) && run ? run
          : /COUNT\(\*\) AS count/.test(sql) ? { count: failures.length }
          : null,
      all: async (...params) => { reads.push({ sql, params }); return /FROM test_cases tc/.test(sql) && caseAvailable ? [{ id: 'case', display_id: 'TC-1', title: 'Save profile', description: 'Exercise profile save.', status: 'active', priority: 2, updated_at: '2026-11-01', authoring_mode: 'structured' }]
        : /FROM test_steps/.test(sql) ? steps
          : /FROM execution_results/.test(sql) ? failures
            : /FROM attachments/.test(sql) ? attachments
              : []; },
      run: () => assert.fail('Defect previews must not save changes')
    };
  } };
  const reproduction = load(path.resolve(__dirname, '../../../testing/backend/services/defectReproduction.service.js'), { db });
  const overrides = {
    db,
    'defectReproduction.service': reproduction,
    ...(failurePackets ? { agentFailureEvidence: { collect: async ({ projectId, runIds, testCaseIds, canView, read }) => {
      assert.equal(projectId, 'project');
      assert.deepEqual(runIds, ['run-1']);
      assert.deepEqual(testCaseIds, ['case']);
      assert.equal(typeof canView, 'function');
      assert.equal(typeof read, 'function');
      return failurePackets;
    } } } : {}),
    ...(attachmentBytes ? {
      'permission.service': { hasPermission: async () => true },
      'attachment.service': { download: async ({ id }) => ({
        row: attachments.find(item => item.id === id),
        stream: Readable.from([attachmentBytes])
      }) }
    } : {}),
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
  return { service, calls, reads, overrides };
}

test('AI defect context pins the selected result screenshot and execution steps, includes comments, and excludes raw log payloads', async () => {
  const imageBytes = Buffer.from(screenshot.url.split(',')[1], 'base64');
  const fullRunnerError = `Full runner error ${'expected dashboard heading but the login form remained visible. '.repeat(5)}`;
  const failure = { id: 'result-1', test_case_id: 'case', status: 'failed', error: fullRunnerError, logs: JSON.stringify({ stepStatuses: { 'snapshot-1': 'failed' }, stepNotes: { 'snapshot-1': 'The page remained on the login form.' }, stepCaptures: { 'snapshot-1': { token: 'captured-secret-never-send' } }, stepApiDetails: { 'snapshot-1': { request: { password: 'request-secret-never-send' } } } }), defects: '', created_at: '2026-11-08T10:00:00Z' };
  const attachment = { id: 'shot-1', project_id: 'project', entity_type: 'execution_result', entity_id: 'result-1', file_name: 'login-failure.png', mime_type: 'image/png', size_bytes: imageBytes.length };
  const packet = {
    result_id: 'result-1', test_case_id: 'case', status: 'failed', error: fullRunnerError,
    steps: [{ id: 'snapshot-1', order: 1, action: 'Submit valid login credentials', expected_result: 'The dashboard opens', observed_status: 'failed', note: 'The page remained on the login form.', api_observation: {}, browser_observation: { error: 'Login response rendered an error banner.' } }],
    comments: [{ body: 'Reproduced twice in staging.', updated_at: '2026-11-08T10:02:00Z' }],
    attachments: [attachment], coverage: { total_failed_cases: 1, returned_failed_cases: 1, omitted_failed_cases: 0, total_steps: 1, omitted_steps: 0 }
  };
  let attempt = 0;
  const reply = call => {
    attempt++;
    const prompt = promptText(call);
    assert.match(prompt, /Reproduced twice in staging/);
    assert.match(prompt, /The page remained on the login form/);
    assert.match(prompt, /Full runner error/);
    assert.match(prompt, /expected dashboard heading but the login form remained visible/);
    assert.match(prompt, /Submit valid login credentials/);
    assert.doesNotMatch(prompt, /Open the sign-in page|captured-secret-never-send|request-secret-never-send/);
    assert.match(prompt, /The dashboard opens/);
    assert.match(prompt, /execution_snapshot/);
    assert.match(prompt, /Image part 1 supports execution-image:/);
    const resultRef = prompt.match(/execution-result:result-1/)?.[0];
    assert.ok(resultRef);
    if (attempt === 1) return Object.assign(new Error('The LLM reached the output limit before finishing.'), { code: 'AI_OUTPUT_TRUNCATED', publicMessage: 'The LLM reached the output limit before finishing.' });
    assert.match(prompt, /Compact completion retry: the previous response reached its output limit/);
    assert.match(call.body.messages.find(message => message.role === 'system').content, /shortest complete valid values/);
    const candidate = {
      draft: { title: 'Login fails', message: 'The linked run failed during login.', steps_to_reproduce: 'source:test-case:case', expected_result: 'source:test-case:case', actual_result: 'The page remained on the login form.', severity: 'high', priority: 'High', environment: '', build: '', labels: [], rationale: 'Failure and case evidence support this draft.' },
      field_evidence: { title: ['reporter:intent'], message: ['reporter:intent', 'test-case:case'], steps_to_reproduce: ['test-case:case'], expected_result: ['test-case:case'], actual_result: [resultRef], severity: [resultRef], priority: [resultRef], environment: [], build: [], labels: [resultRef], rationale: [resultRef] }
    };
    require('../../../platform/backend/src/utils/aiGenerationContracts').validateNativeArtifactOutput('ai.bug.draft', candidate);
    assert.match(prompt, /source:test-case:case/);
    return candidate;
  };
  const f = fixture(reply, {
    run: { id: 'run-1', name: 'Login regression', status: 'failed', project_id: 'project', created_at: '2026-11-08T10:00:00Z' },
    failures: [failure],
    steps: [{ id: 'step-1', test_case_id: 'case', step_order: 1, action: 'Open the sign-in page', expected_result: 'Dashboard opens' }],
    attachments: [attachment],
    attachmentBytes: imageBytes,
    failurePackets: [packet]
  });
  const result = await f.service.preview({
    user: { id: 'user-1' }, project_id: 'project', intent: 'Login fails after valid credentials',
    linked_test_run_id: 'run-1', linked_execution_result_id: 'result-1', linked_test_case_ids: ['case']
  });
  assert.equal(f.calls.length, 2, 'A truncated first completion gets one compact retry.');
  for (const call of f.calls) {
    const content = call.body.messages.find(message => message.role === 'user').content;
    assert.deepEqual(content.filter(part => part.type === 'image_url'), [{ type: 'image_url', image_url: { url: screenshot.url, detail: 'low' } }]);
  }
  assert.equal(result.draft.steps_to_reproduce, '1. Submit valid login credentials');
  assert.equal(result.draft.expected_result, 'The dashboard opens');
  assert.ok(result.fallback_fields.includes('steps_to_reproduce'));
  const selectedRead = f.reads.find(item => /FROM execution_results/.test(item.sql));
  assert.match(selectedRead.sql, /execution_results.id = \?/);
  assert.deepEqual(selectedRead.params, ['run-1', 'case', 'result-1']);
  assert.doesNotMatch(f.reads.find(item => /FROM attachments/.test(item.sql)).sql, /entity_type = 'execution' AND/);
  assert.ok(result.citations.some(item => item.type === 'execution-screenshot'));
  assert.equal(result.boundaries.included.execution_images, 1);
  assert.equal(result.boundaries.included.execution_failure_details, 1);
  assert.match(JSON.stringify(f.calls[1].body.messages), /Full runner error/);
});

test('a compact retry that also truncates returns a clear error without presenting a deterministic draft as AI output', async () => {
  let attempts = 0;
  const truncated = () => ++attempts === 1
    ? Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"draft":' } }] })
    : Object.assign(new Error('Output truncated.'), { code: 'AI_OUTPUT_TRUNCATED', publicMessage: 'Output truncated.' });
  const f = fixture(truncated, { steps: [
    { id: 'step-1', test_case_id: 'case', step_order: 1, action: 'Open the sign-in page', expected_result: 'Sign-in form appears' },
    { id: 'step-2', test_case_id: 'case', step_order: 2, action: 'Submit valid credentials', expected_result: 'Dashboard opens' }
  ] });
  await assert.rejects(f.service.preview({ project_id: 'project', intent: 'Valid login is rejected', linked_test_case_ids: ['case'] }), error => {
    assert.equal(error.code, 'AI_OUTPUT_TRUNCATED');
    assert.match(error.message, /including on a compact retry/);
    assert.match(error.message, /No Defect draft was generated/);
    return true;
  });
  assert.equal(f.calls.length, 2);
  assert.match(promptText(f.calls[1]), /Compact completion retry: the previous response reached its output limit/);
  assert.match(promptText(f.calls[1]), /Open the sign-in page/);
  assert.match(promptText(f.calls[1]), /Submit valid credentials/);
});

test('failed-step inline screenshots reach vision when object storage has no attachment receipt', async () => {
  const f = fixture(call => {
    const ref = promptText(call).match(/execution-image:[a-f0-9]{64}/)?.[0];
    assert.ok(ref);
    return { draft: { title: 'Save shows an error', message: 'The recorded image shows Save with an error.', actual_result: 'An error is visible.', rationale: 'Investigate the recorded save failure.' },
      field_evidence: Object.fromEntries(['title', 'message', 'actual_result', 'rationale'].map(field => [field, [ref]])) };
  }, { run: { id: 'run-1', name: 'Save run', project_id: 'project' },
    failures: [{ id: 'result-1', test_case_id: 'case', status: 'failed', error: 'Save failed', logs: JSON.stringify({ stepStatuses: { 'snapshot-1': 'failed' }, stepEvidence: { 'snapshot-1': { dataUrl: screenshot.url } } }) }],
    attachmentBytes: Buffer.alloc(0) });
  const result = await f.service.preview({ user: { id: 'actor' }, project_id: 'project', intent: 'Save fails', linked_test_run_id: 'run-1', linked_execution_result_id: 'result-1', linked_test_case_ids: ['case'] });
  const content = f.calls[0].body.messages.find(message => message.role === 'user').content;
  assert.deepEqual(content.filter(part => part.type === 'image_url'), [{ type: 'image_url', image_url: { url: screenshot.url, detail: 'low' } }]);
  assert.doesNotMatch(promptText(f.calls[0]), /data:image\//);
  assert.equal(result.boundaries.included.execution_images, 1);
  assert.equal(result.provenance.partial_sources, false);
});

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
