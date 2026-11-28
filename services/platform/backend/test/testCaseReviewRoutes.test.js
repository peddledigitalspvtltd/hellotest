const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { validateInput } = require('../src/plugins/validator');

async function fixture() {
  const handlers = new Map(), calls = [], permissions = [];
  const state = { authenticated: true, denied: null };
  const timestamp = '2026-09-01T00:00:00.000Z';
  const register = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../../testing/backend/routes/testCases.routes'), 'utf8'), {
    module: register,
    require: name => {
      if (name === '../services/testCase.service') return {
        getTestCase: async id => ({ id, app_type_id: 'app', updated_at: timestamp }),
        createTestCase: async payload => { calls.push({ kind: 'create', payload }); return { id: 'created' }; },
        updateTestCase: async (id, payload) => { calls.push({ kind: 'update', id, payload }); return { updated: true }; },
        reviewTestCase: async (id, payload) => { calls.push({ kind: 'review', id, payload }); return { updated: true }; },
        acceptGeneratedTestCase: async (id, payload) => { calls.push({ kind: 'accept', id, payload }); return { accepted: true }; },
        rejectGeneratedTestCase: async (id, payload) => { calls.push({ kind: 'reject', id, payload }); return { deleted: true }; }
      };
      if (name === '../services/testCaseScope.service') return {
        resolveTestCaseProjectIds: async () => ['project'],
        uniqueIds: ids => [...new Set(ids)], resolveSuiteScopes: async () => []
      };
      if (name === '../services/testCaseAiData.service') return require('../../../testing/backend/services/testCaseAiData.service');
      if (name === '@hellotest/platform/backend/public/applicationAccess') return { getAppType: async id => ({ id, project_id: 'project', type: 'web' }) };
      if (name === '@hellotest/platform/backend/public/projectAccess') return { getProject: async id => ({ id }) };
      if (name === '@hellotest/platform/backend/services/mobileFeature.service') return { testCaseUsesMobile: async () => false };
      if (name === '@hellotest/platform/backend/src/domain/catalog') return require('../src/domain/catalog');
      if (name === '@hellotest/platform/backend/src/utils/mobileFeature') return require('../src/utils/mobileFeature');
      return {};
    }
  });
  await register.exports({
    get() {}, post: (path, handler) => handlers.set(`POST ${path}`, handler), put: (path, handler) => handlers.set(`PUT ${path}`, handler), delete: (path, handler) => handlers.set(`DELETE ${path}`, handler), validate: validateInput,
    authenticate: async () => { if (!state.authenticated) throw Object.assign(new Error('Unauthenticated'), { statusCode: 401 }); },
    requirePermission: (code, scope) => async () => {
      permissions.push({ code, projectId: scope.projectId });
      if (state.denied === code) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }
  });
  const request = body => ({ params: { id: 'case' }, body, user: { id: 'signed-in-user', role: 'member' } });
  return { handlers, calls, permissions, state, request, timestamp };
}

test('public manual creation cannot manufacture a terminal review, and new assignments are pending', async () => {
  const { handlers, calls, request } = await fixture();
  const create = handlers.get('POST /test-cases');
  const payload = { app_type_id: 'app', title: 'Checkout', reviewer_id: 'other-reviewer', review_history: [{ status: 'accepted', user_id: 'other-reviewer' }] };
  for (const review_status of ['accepted', 'changes_requested']) await assert.rejects(create(request({ ...payload, review_status })), { statusCode: 403 });
  assert.equal(calls.length, 0);
  await create(request({ ...payload, review_status: 'not_requested', created_by: 'spoofed' }));
  assert.equal(calls[0].payload.review_status, 'pending');
  assert.equal(calls[0].payload.reviewer_id, 'other-reviewer');
  assert.equal(calls[0].payload.created_by, 'signed-in-user');
  assert.equal(calls[0].payload.review_history.length, 0);
});

test('public AI authoring accepts only interactive provenance and derives pending review from session identity', async () => {
  const { handlers, calls, request } = await fixture();
  const create = handlers.get('POST /test-cases');
  for (const ai_generation_source of ['scheduler', 'repository']) await assert.rejects(create(request({ app_type_id: 'app', title: 'Generated case', ai_generation_source })), { statusCode: 400 });
  await create(request({
    app_type_id: 'app', title: 'Generated case', ai_generation_source: 'interactive', ai_generation_review_status: 'accepted',
    review_status: 'accepted', created_by: 'other-user', updated_by: 'other-user', ai_generation_job_id: 'spoofed-job',
    review_history: [{ status: 'accepted', user_id: 'other-user' }]
  }));
  const saved = calls[0].payload;
  assert.equal(saved.created_by, 'signed-in-user');
  assert.equal(saved.updated_by, 'signed-in-user');
  assert.equal(saved.reviewer_id, 'signed-in-user');
  assert.equal(saved.review_status, 'pending');
  assert.equal(saved.ai_generation_review_status, 'pending');
  assert.equal(saved.ai_generation_job_id, null);
  assert.equal(saved.review_history.length, 0);
});

test('saving a raw AI Test Param generates a scoped model pool and never persists an unresolved token', async t => {
  const { handlers, calls, state, request } = await fixture();
  const pool = `{{oneOf:${Buffer.from(JSON.stringify(['customer@example.test'])).toString('base64url')}}}`;
  const preview = t.mock.method(require('@hellotest/ai/services/aiTestDataGeneration'), 'preview', async () => ({ generation_mode: 'llm', randomized_template: pool }));
  const parameter_values = { 't.email': 'demo-{{aiData : customer email with a demo prefix}}', 't.label': '{{randomString:8}}' };
  const create = handlers.get('POST /test-cases');
  const update = handlers.get('PUT /test-cases/:id');
  await create(request({ app_type_id: 'app', title: 'Customer case', parameter_values }));
  await update(request({ parameter_values }));
  assert.deepEqual(calls.map(({ payload }) => payload.parameter_values), [
    { 't.email': `demo-${pool}`, 't.label': '{{randomString:8}}' },
    { 't.email': `demo-${pool}`, 't.label': '{{randomString:8}}' }
  ]);
  assert.equal(preview.mock.callCount(), 2);
  assert.deepEqual(preview.mock.calls[0].arguments[0], { projectId: 'project', appTypeId: 'app', userId: 'signed-in-user',
    prompt: 'customer email with a demo prefix', fieldContext: 't.email', sampleCount: 8 });

  state.denied = 'data.ai';
  await assert.rejects(update(request({ parameter_values })), { statusCode: 403 });
  state.denied = null;
  await assert.rejects(update(request({ parameter_values: { 't.password': '{{aiData:example credential}}' } })), { statusCode: 422 });
  assert.equal(preview.mock.callCount(), 2);
  assert.equal(calls.length, 2);
});

for (const [method, endpoint, permission, kind] of [
  ['POST', '/test-cases/:id/review', 'testcase.update', 'review'],
  ['POST', '/test-cases/:id/accept-generated', 'testcase.update', 'accept'],
  ['DELETE', '/test-cases/:id/reject-generated', 'testcase.delete', 'reject']
]) {
  test(`${endpoint} requires project permission and always uses the signed-in reviewer`, async () => {
    const { handlers, calls, permissions, state, request, timestamp } = await fixture();
    const handler = handlers.get(`${method} ${endpoint}`);
    const body = { review_status: 'accepted', reviewed_by: 'forged-reviewer' };
    state.authenticated = false;
    await assert.rejects(handler(request(body)), { statusCode: 401 });
    state.authenticated = true;
    state.denied = permission;
    await assert.rejects(handler(request(body)), { statusCode: 403 });
    assert.equal(calls.length, 0);
    state.denied = null;
    await handler(request(body));
    assert.equal(calls[0].kind, kind);
    assert.equal(calls[0].payload.reviewed_by, 'signed-in-user');
    assert.equal(calls[0].payload.expected_updated_at, timestamp, 'Authorization snapshot is guarded even for older clients');
    assert.ok(permissions.every(item => item.code === permission && item.projectId === 'project'));
  });
}
