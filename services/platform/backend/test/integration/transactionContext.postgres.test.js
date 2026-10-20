const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresAdapter } = require('../../src/db/createPostgresAdapter');

test('detached durable work after commit or rollback never reuses an expired PostgreSQL transaction', {
  skip: process.env.ENGINEER_TRANSACTION_POSTGRES !== '1', timeout: 30000
}, async () => {
  const url = new URL(process.env.ENGINEER_TRANSACTION_DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55439');
  assert.equal(url.pathname, '/agent_verify_engineer_transactions');
  const db = createPostgresAdapter({ poolConfig: { connectionString: url.href, max: 2, connectionTimeoutMillis: 5000 } });
  let created = false;
  try {
    await db.query('CREATE TABLE detached_transaction_receipts (id TEXT PRIMARY KEY)');
    created = true;
    for (const outcome of ['commit', 'rollback']) {
      let resume, work;
      const gate = new Promise(resolve => { resume = resolve; });
      const outer = db.transaction(async () => {
        await db.prepare('INSERT INTO detached_transaction_receipts(id) VALUES(?)').run(`outer-${outcome}`);
        work = (async () => {
          await gate;
          // A queued agent first reads state, then persists an atomic update
          // with a nested domain write; all must use live owned connections.
          await db.query('SELECT 1');
          await db.transaction(async () => {
            await db.transaction(async () => db.prepare('INSERT INTO detached_transaction_receipts(id) VALUES(?)').run(`worker-${outcome}`))();
          })();
        })();
        if (outcome === 'rollback') throw new Error('Expected fixture rollback');
      });
      if (outcome === 'rollback') await assert.rejects(outer(), /Expected fixture rollback/);
      else await outer();
      resume(); await work;
    }
    const rows = await db.prepare('SELECT id FROM detached_transaction_receipts ORDER BY id').all();
    assert.deepEqual(rows.map(row => row.id), ['outer-commit', 'worker-commit', 'worker-rollback']);
  } finally {
    if (created) await db.query('DROP TABLE detached_transaction_receipts').catch(() => {});
    await db.close();
  }
});
