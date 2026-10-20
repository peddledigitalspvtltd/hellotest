const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { inspectDirectRun } = require('../../backend/services/automationDeletionReconciliation');

test('direct-run deletion proof requires a settled scoped attempt and a healthy authenticated matching runner', async t => {
  const previous = process.env.TESTENGINE_SHARED_SECRET;
  const secret = 'disposable-reconciliation-fixture-secret';
  process.env.TESTENGINE_SHARED_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.TESTENGINE_SHARED_SECRET; else process.env.TESTENGINE_SHARED_SECRET = previous; });
  let state = 'missing', healthy = true, protectedRoute = true, matching = true, requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health/live') return res.end(JSON.stringify({ ok: healthy, status: 'live', ui: 'hellotest' }));
    if (protectedRoute && req.headers['x-hellotest-testengine-secret'] !== secret) {
      res.writeHead(401, { 'www-authenticate': 'Bearer realm="hellotest-testengine"' });
      return res.end('{"message":"Unauthorized Test Engine request"}');
    }
    if (state === 'missing') { res.writeHead(404); return res.end('{"message":"Run not found"}'); }
    if (state === 'oversized') return res.end(JSON.stringify({ padding: 'x'.repeat(300000) }));
    return res.end(JSON.stringify({ id: 'engine', hellotest_run_id: matching ? 'execution' : 'foreign', hellotest_test_case_id: 'case', state }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const transaction = { related_id: 'engine', created_at: '2020-01-01T00:00:00.000Z', metadata: {
    source: 'hellotest.local-run', queue_mode: 'direct-local', engine_host: `http://127.0.0.1:${server.address().port}`,
    engine_run_id: 'engine', execution_id: 'execution', test_case_id: 'case'
  } };
  assert.equal((await inspectDirectRun(transaction)).outcome, 'abandoned');
  assert.equal(requests, 3, 'Liveness, an auth challenge and the exact authenticated run are independently verified.');
  for (const active of ['queued', 'building-script', 'running', 'healing']) {
    state = active;
    assert.equal(await inspectDirectRun(transaction), null);
  }
  for (const terminal of ['completed', 'failed', 'incident']) {
    state = terminal;
    const proof = await inspectDirectRun(transaction);
    assert.equal(proof.outcome, 'finished');
    assert.equal(proof.runner_state, terminal);
  }
  matching = false;
  assert.equal(await inspectDirectRun(transaction), null);
  matching = true; state = 'missing'; healthy = false;
  assert.equal(await inspectDirectRun(transaction), null);
  healthy = true; protectedRoute = false;
  assert.equal(await inspectDirectRun(transaction), null, 'An unprotected/proxy 404 cannot authorize deletion.');
  protectedRoute = true; state = 'oversized';
  assert.equal(await inspectDirectRun(transaction), null);
  const beforeInvalid = requests;
  for (const invalid of [
    { ...transaction, started_at: new Date().toISOString() },
    { ...transaction, related_id: 'different' },
    { ...transaction, metadata: { ...transaction.metadata, engine_host: 'https://untrusted.example' } },
    { ...transaction, metadata: { ...transaction.metadata, source: 'different' } },
    { ...transaction, metadata: { ...transaction.metadata, engine_host: transaction.metadata.engine_host + '/proxy' } }
  ]) assert.equal(await inspectDirectRun(invalid), null);
  assert.equal(requests, beforeInvalid, 'Unsettled or unsupported targets must not receive credentials or requests.');
  assert.equal(await inspectDirectRun(transaction, { deadline: Date.now() - 1 }), null);
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  assert.equal(await inspectDirectRun(transaction), null, 'A missing/unreachable runner is not an authoritative missing attempt.');
});
