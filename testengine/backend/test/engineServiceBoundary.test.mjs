import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HELLOTEST_API_BASE_URL = 'http://control.test';
process.env.HELLOTEST_API_PATH_PREFIX = '';
process.env.TESTENGINE_SHARED_SECRET = 'hellotest-testengine-dev-secret';
process.env.MOBILE_ENGINE_URL = 'http://mobile.test';
process.env.MOBILE_ENGINE_SHARED_SECRET = 'hellotest-mobile-engine-dev-secret';
process.env.NODE_ENV = 'development';
const { leaseNextQueuedJob } = await import('../dist/lib/hellotestClient.js');
const { executeMobileSteps, createMobileRunSession } = await import('../dist/lib/mobileEngine.js');

test('queue prefix compatibility uses typed HTTP status without retrying arbitrary failures', async t => {
  const urls = [];
  let firstStatus = 404;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url);
    assert.ok(options.headers['x-request-id']);
    if (url.includes('/api/testengine/')) return Response.json({ job: null });
    return Response.json({ message: 'The route does not exist' }, { status: firstStatus });
  });
  assert.equal(await leaseNextQueuedJob('worker'), null);
  assert.deepEqual(urls, ['http://control.test/testengine/internal/jobs/lease', 'http://control.test/api/testengine/internal/jobs/lease']);
  firstStatus = 503; urls.length = 0;
  await assert.rejects(leaseNextQueuedJob('worker'), error => error.code === 'HTTP_ERROR' && error.status === 503);
  assert.equal(urls.length, 1);
});

test('invalid native result contracts cannot become passing execution results', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const step = { id: 'expected-step', step_type: 'ios' };
  for (const payload of [{ ok: true }, { status: 'passed', results: [{ step_id: 'other-step', status: 'passed' }] }, { status: 'passed', results: [1, 2].map(() => ({ step_id: step.id, status: 'passed' })) }]) {
    response = payload;
    await assert.rejects(executeMobileSteps({}, [step]), /invalid/);
  }
});

test('failed native cleanup reports a correlated error without replacing the case outcome', async t => {
  const errors = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => options.method === 'DELETE'
    ? Response.json({ message: 'private-provider-detail' }, { status: 503 })
    : Response.json({ status: 'passed', results: [{ step_id: 'native-step', status: 'passed' }] }));
  const session = createMobileRunSession({}, error => errors.push(error));
  assert.equal((await session.run([{ id: 'native-step', step_type: 'android' }])).status, 'passed');
  await session.close(); await session.close();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'HTTP_ERROR');
  assert.ok(errors[0].requestId);
  assert.ok(!errors[0].message.includes('private-provider-detail'));
});
