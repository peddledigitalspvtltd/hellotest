// This integration test refuses every non-disposable database. It never reads
// credentials or changes flag/role data in the application's real workspace.
const assert = require('node:assert/strict');
const test = require('node:test');

test('atomic feature edits preserve unrelated concurrent changes and legacy stored flags', { skip: process.env.PRODUCT_ACCESS_POSTGRES !== '1', timeout: 30000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const flags = require('../../services/featureFlag.service');
  const agent = 'hellotest.ai.agentic_workflows';
  const repository = 'hellotest.automation.object_repository';
  const workspace = 'hellotest.automation.workspace';
  try {
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.equal(tables.rows.length, 0, 'This test requires an empty disposable database');
    await db.query("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await flags.updateLocalFlags({ [agent]: false });
    assert.equal((await flags.getSnapshot()).flags[agent], false);
    await Promise.all([
      flags.updateLocalFlags({ [repository]: false }),
      flags.updateLocalFlags({ [workspace]: false })
    ]);
    let snapshot = await flags.getSnapshot();
    assert.equal(snapshot.local_flags[agent], false);
    assert.equal(snapshot.local_flags[repository], false);
    assert.equal(snapshot.local_flags[workspace], false);
    await flags.updateLocalFlags({ [repository]: true });
    snapshot = await flags.getSnapshot();
    assert.equal(snapshot.local_flags[repository], true);
    assert.equal(snapshot.flags[repository], false, 'A parent-disabled child remains unavailable');
    await flags.updateLocalFlags({ [workspace]: true });
    assert.equal((await flags.getSnapshot()).flags[repository], true);
    await db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run({ [agent]: false, [repository]: false }, 'feature_flags');
    await flags.updateLocalFlags({ [workspace]: false });
    snapshot = await flags.getSnapshot();
    assert.equal(snapshot.local_flags[agent], false, 'Legacy flat storage is preserved when first patched');
    assert.equal(snapshot.local_flags[repository], false);
    assert.equal(snapshot.local_flags[workspace], false);
    const before = JSON.stringify(snapshot.local_flags);
    await assert.rejects(flags.updateLocalFlags({ typo: true }), { statusCode: 400 });
    await assert.rejects(flags.updateLocalFlags({ [agent]: 'true' }), { statusCode: 400 });
    assert.equal(JSON.stringify((await flags.getSnapshot()).local_flags), before);
    await assert.rejects(db.transaction(async () => { await flags.updateLocalFlags({ [agent]: true }); throw new Error('Audit write failed'); })(), /Audit write failed/);
    assert.equal((await flags.getSnapshot()).local_flags[agent], false, 'A failed transactional audit can roll back the policy change');
  } finally {
    await db.close();
  }
});
