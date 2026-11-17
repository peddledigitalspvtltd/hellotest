const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fs = require('node:fs');
const { activityCursor, streamAutomationActivity } = require("../../backend/lib/build/automationActivityStream");

test('activity stream resumes durable pages, sends completion once and rechecks its read port', async () => {
  const reads = [], initial = { id: 'build', status: 'running', events: [{ id: 'first' }], events_next_offset: 1, events_has_more: true };
  const chunks = [];
  for await (const chunk of streamAutomationActivity({ initial, read: async cursor => {
    reads.push(cursor);return { id: 'build', status: 'completed', events: [{ id: 'second' }], events_next_offset: 2 };
  } })) chunks.push(chunk);
  assert.deepEqual(reads, [1]);assert.ok(chunks[0].startsWith('id: 1\nevent: activity\n'));
  assert.ok(chunks[1].startsWith('id: 2\nevent: activity\n'));
  assert.equal(chunks.filter(chunk => chunk.includes('event: complete')).length, 1);
});

test('activity disconnect and connection deadline stop observing without cancelling the job', async () => {
  for (const mode of ['disconnect', 'deadline']) {
    const controller = new AbortController();let reads = 0, elapsed = 0;
    const chunks = [];
    for await (const chunk of streamAutomationActivity({ signal: controller.signal,
      initial: { id: 'build', status: 'running', events: [], events_next_offset: 0 },
      read: async () => { reads++;throw new Error('No read after the observer closes.'); }, now: () => elapsed,
      wait: async () => { if (mode === 'disconnect') controller.abort();else elapsed = 180001; }
    })) chunks.push(chunk);
    assert.equal(reads, 0);assert.ok(!chunks.some(chunk => chunk.includes('event: complete')));
  }
});

test('activity cursors reject malformed and over-budget input', () => {
  for (const input of [-1, 1.5, '1e3', ' 1', [], {}, 1000001]) assert.throws(() => activityCursor(input), { statusCode: 400 });
  assert.equal(activityCursor('1000000'), 1000000);
});

async function routeFixture({ revoke = false } = {}) {
  const app = Fastify(), reads = [], permissions = [];
  const transaction = { id: 'build', category: 'automation_build', project_id: 'project' };
  const loaded = { exports: {} }, route = fs.readFileSync(require.resolve('../../backend/routes/automationActivity.routes'), 'utf8');
  new Function('require', 'module', route)(id => {
    if (id.endsWith('/projectAccess')) return { getProject: async () => {} };
    if (id.endsWith('/workspaceTransaction.service')) return { getTransaction: async () => transaction };
    if (id.endsWith('/automationAgentActivity.service')) return { activity: async (_transaction, input) => {
      reads.push(input.events_offset);
      return { ...transaction, status: revoke ? 'running' : 'completed', events: [], events_next_offset: input.events_offset };
    } };
    if (id.endsWith('/automationActivityStream')) return { activityCursor, streamAutomationActivity: input => streamAutomationActivity({ ...input, wait: async () => {} }) };
    return require(id);
  }, loaded);
  app.decorate('authenticate', async req => { if (!req.headers.authorization) throw Object.assign(new Error('Sign in'), { statusCode: 401 });req.user = { id: 'user' }; });
  app.decorate('requirePermission', code => async () => {
    permissions.push(code);
    if (revoke && reads.length) throw Object.assign(new Error('Do not stream this private diagnostic'), { statusCode: 403 });
  });
  await app.register(loaded.exports);
  return { app, reads, permissions };
}

test('SSE route authenticates, validates cursors and requires every code/build permission before streaming', async t => {
  const f = await routeFixture();t.after(() => f.app.close());
  assert.equal((await f.app.inject('/test-cases/automation/jobs/build/events')).statusCode, 401);
  const bad = await f.app.inject({ url: '/test-cases/automation/jobs/build/events?after=1', headers: { authorization: 'Bearer fixture', 'last-event-id': '2' } });
  assert.equal(bad.statusCode, 400);assert.deepEqual(f.reads, []);
  const response = await f.app.inject({ url: '/test-cases/automation/jobs/build/events?after=3', headers: { authorization: 'Bearer fixture', 'last-event-id': '3' } });
  assert.equal(response.statusCode, 200);assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.equal(response.headers['x-accel-buffering'], 'no');assert.deepEqual(f.reads, [3]);
  assert.deepEqual(f.permissions, ['automation.build', 'automation.view', 'automation.code.view', 'automation.ai']);
  assert.match(response.body, /id: 3\nevent: activity/);assert.match(response.body, /event: complete/);
});

test('a revoked code permission closes an active stream with a neutral reconnect event', async t => {
  const f = await routeFixture({ revoke: true });t.after(() => f.app.close());
  const response = await f.app.inject({ url: '/test-cases/automation/jobs/build/events', headers: { authorization: 'Bearer fixture' } });
  assert.equal(response.statusCode, 200);assert.match(response.body, /event: unavailable/);
  assert.doesNotMatch(response.body, /private diagnostic/);assert.equal(f.reads.length, 1);
});
