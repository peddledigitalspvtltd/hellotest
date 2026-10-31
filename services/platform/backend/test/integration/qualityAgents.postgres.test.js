const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

test('real PostgreSQL quality events serialize concurrent writers, replay cursors, atomically finalize and prevent stale dispatch output', { skip: process.env.QUALITY_AGENT_POSTGRES_TEST !== '1', timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); assert.match(url.pathname, /^\/quality_agent_verify_\d+$/);
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('../../src/db'), obsDb = require('../../src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.workspace_transactions') AS records").get()).records, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    const actorId = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,TRUE,'active')").run(actorId, 'quality-stream-fixture@example.test', 'not-a-login', 'Disposable quality fixture');
    const { createQualityAgentStore } = require('../../../../agentic/backend/services/qualityAgentStore');
    const store = createQualityAgentStore({ db, workspace: {} });
    const make = async () => {
      const id = randomUUID(), runId = randomUUID(), project = randomUUID(), lease = randomUUID();
      await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(project, 'Disposable quality stream project', actorId);
      return db.prepare(`INSERT INTO workspace_transactions(id,project_id,category,action,status,title,related_kind,related_id,created_by,metadata)
        VALUES(?,?,'agentic','quality_agent_run','running','Durable stream fixture','quality_agent_run',?,?,?) RETURNING *`).get(id, project, runId, actorId, { id: runId, run_status: 'running', lease_token: lease, lease_until: new Date(Date.now() + 60000).toISOString() });
    };
    const row = await make();
    await Promise.all(Array.from({ length: 24 }, (_, index) => store.appendStreamEvent(row, { type: 'text', data: { call_id: 'call', text: `part-${index}\n` } })));
    const page = await store.listStreamEvents(row, 0, 7);
    assert.deepEqual(page.items.map(item => item.seq), [1, 2, 3, 4, 5, 6, 7]); assert.equal(page.has_more, true); assert.equal(page.last_sequence, 24);
    const second = await store.listStreamEvents(row, 7, 200); assert.equal(second.items.length, 17); assert.equal(second.items.at(-1).seq, 24);
    assert.equal(new Set([...page.items, ...second.items].map(item => item.seq)).size, 24);
    assert.ok(second.items.every(item => item.run_id === row.metadata.id && item.project_id === row.project_id));
    await assert.rejects(store.listStreamEvents({ ...row, project_id: randomUUID() }, 0), error => error.statusCode === 404);
    await assert.rejects(store.listStreamEvents(row, 25), error => error.statusCode === 409);

    let injected = false;
    const failingDb = { ...db, prepare(sql) {
      if (sql.startsWith('INSERT INTO workspace_transaction_events')) return { run: async () => { injected = true; throw new Error('Injected terminal event storage failure'); } };
      return db.prepare(sql);
    } };
    const failingStore = createQualityAgentStore({ db: failingDb, workspace: {} });
    await assert.rejects(failingStore.updateClaim(row, { run_status: 'completed', outcome: 'passed', completed_at: new Date().toISOString() }, 'completed'), /Injected/);
    assert.equal(injected, true);
    const rolledBack = await db.prepare('SELECT status,metadata FROM workspace_transactions WHERE id=?').get(row.id);
    assert.equal(rolledBack.status, 'running'); assert.equal(rolledBack.metadata.quality_event_seq, 24, 'Status and stream cursor must roll back together.');
    await store.updateClaim(row, { run_status: 'completed', outcome: 'passed', completed_at: new Date().toISOString() }, 'completed');
    const final = await store.listStreamEvents(row, 24);
    assert.equal(final.items.length, 1); assert.equal(final.items[0].type, 'done'); assert.equal(final.items[0].data.status, 'completed');
    assert.deepEqual((await db.prepare("SELECT level FROM workspace_transaction_events WHERE transaction_id=? AND phase='done'").all(row.id)).map(item => item.level), ['success']);
    assert.equal(await store.appendStreamEvent(row, { type: 'text', data: { text: 'late response' } }), null);

    const cancellation = await make();
    await store.appendStreamEvent(cancellation, { type: 'model_start', data: { call_id: 'cancelled-call' } });
    await store.cancel(cancellation);
    assert.equal(await store.appendStreamEvent(cancellation, { type: 'text', data: { text: 'late after cancel' } }), null);
    const cancelled = await store.listStreamEvents(cancellation, 0);
    assert.deepEqual(cancelled.items.map(item => [item.type, item.data.status]), [['model_start', undefined], ['done', 'cancelled']]);
    assert.equal((await db.prepare('SELECT status FROM workspace_transactions WHERE id=?').get(cancellation.id)).status, 'failed');
    assert.deepEqual((await db.prepare("SELECT level FROM workspace_transaction_events WHERE transaction_id=? AND phase='done'").all(cancellation.id)).map(item => item.level), ['warning']);
    const failed = await make();
    await store.updateClaim(failed, { run_status: 'failed', outcome: 'error', error: { code: 'FIXTURE_FAILURE', message: 'Observed fixture failure.' }, completed_at: new Date().toISOString() }, 'failed');
    assert.deepEqual((await db.prepare('SELECT level FROM workspace_transaction_events WHERE transaction_id=?').all(failed.id)).map(item => item.level), ['error', 'error'], 'A terminal stream event must not count a failed run as successful.');
  } finally { await obsDb.close(); await db.close(); }
});
