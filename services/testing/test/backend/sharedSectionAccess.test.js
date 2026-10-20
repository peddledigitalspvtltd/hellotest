const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const groups = require('../../backend/services/sharedStepGroup.service');
const appTypes = require('@hellotest/platform/backend/public/applicationAccess');
const projects = require('@hellotest/platform/backend/public/projectAccess');

async function fixture(context, denied = []) {
  const group = { id: 'group', app_type_id: 'app', name: 'Login', steps: [
    { id: 'open', step_order: 1, action: 'Open', step_type: 'web', automation_code: 'await page.goto("https://example.test");', api_request: null },
    { id: 'request', step_order: 2, action: 'Load', step_type: 'api', automation_code: null, api_request: { method: 'GET', url: 'https://example.test/api' } }
  ] };
  context.mock.method(groups, 'getSharedStepGroup', async () => structuredClone(group));
  context.mock.method(groups, 'listSharedStepGroups', async () => [structuredClone(group)]);
  context.mock.method(appTypes, 'getAppType', async () => ({ id: 'app', project_id: 'project', type: 'web' }));
  context.mock.method(projects, 'getProject', async () => ({ id: 'project' }));
  const writes = [];
  context.mock.method(groups, 'createSharedStepGroup', async input => { writes.push(input); return { id: 'new' }; });
  context.mock.method(groups, 'updateSharedStepGroup', async (id, input) => { writes.push(input); return { updated: true }; });
  const app = Fastify();
  context.after(() => app.close());
  app.decorate('authenticate', async req => { req.user = { id: 'user' }; });
  app.decorate('validate', require('../../../platform/backend/src/plugins/validator').validateInput);
  app.decorate('requirePermission', permission => async () => {
    if (denied.includes(permission)) throw Object.assign(new Error(`Denied: ${permission}`), { statusCode: 403 });
  });
  await app.register(require('../../backend/routes/sharedStepGroups.routes'));
  return { app, writes, group };
}

test('shared source and API definitions require source visibility in catalog and detail', async context => {
  const { app } = await fixture(context, ['automation.code.view']);
  for (const url of ['/shared-step-groups?app_type_id=app', '/shared-step-groups/group']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, response.body);
    assert.doesNotMatch(response.body, /example\.test|page\.goto/);
    const payload = response.json();
    assert.ok((Array.isArray(payload) ? payload[0] : payload).steps.every(step => step.automation_source_hidden === true && step.automation_code === '' && step.api_request === null));
  }
});

test('metadata saves retain hidden section implementations by stable section ID', async context => {
  const { app, writes, group } = await fixture(context, ['automation.code.view', 'automation.build']);
  const steps = group.steps.map(step => ({ ...step, automation_code: '', api_request: null }));
  const response = await app.inject({ method: 'PUT', url: '/shared-step-groups/group', payload: { description: 'Rename metadata', steps } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(writes[0].steps[0].automation_code, group.steps[0].automation_code);
  assert.deepEqual(writes[0].steps[1].api_request, group.steps[1].api_request);
});

test('executable additions, reorder and deletion cannot bypass automation permissions', async context => {
  const { app, writes, group } = await fixture(context, ['automation.build']);
  for (const steps of [
    [{ ...group.steps[0], automation_code: 'await page.reload();' }, group.steps[1]],
    [{ ...group.steps[1], step_order: 1 }, { ...group.steps[0], step_order: 2 }],
    [group.steps[0]]
  ]) {
    const response = await app.inject({ method: 'PUT', url: '/shared-step-groups/group', payload: { steps } });
    assert.equal(response.statusCode, 403, response.body);
  }
  const create = await app.inject({ method: 'POST', url: '/shared-step-groups', payload: { app_type_id: 'app', name: 'New source', steps: [group.steps[0]] } });
  assert.equal(create.statusCode, 403, create.body);
  assert.equal(writes.length, 0);
});

test('manual step group creation retains its existing manage-only authorization', async context => {
  const { app, writes } = await fixture(context, ['automation.code.view', 'automation.build']);
  const response = await app.inject({ method: 'POST', url: '/shared-step-groups', payload: { app_type_id: 'app', name: 'Manual login', steps: [{ action: 'Enter username', expected_result: 'Username is entered' }] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(writes.length, 1);
});
