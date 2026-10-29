const assert = require('node:assert/strict');
exports.verify = async ({ db, obsDb }) => {
  const engine = require('../../../../automation/backend/services/testEngineDispatch.service');
  const insert = async (id, execution, status = 'queued', engineClass = 'web', expiry = null) => obsDb.prepare(`INSERT INTO test_engine_jobs
    (id,engine_run_id,project_id,execution_id,test_case_id,test_case_title,status,engine_class,lease_expires_at,created_at,payload)
    VALUES (?,?, 'mcp-p-a', ?, 'mcp-case-a','Queue progress fixture',?,?,?, ?,?)`)
    .run(id,id,execution,status,engineClass,expiry,'2020-01-01T00:00:00Z',{execution_policy:{parallel_enabled:false,parallel_count:1}});
  try {
    for (const id of ['blocked','independent','recovery','single-slot','finished','closed-after-lease']) await db.prepare(`INSERT INTO executions
      (id,project_id,app_type_id,name,status) VALUES (?, 'mcp-p-a','mcp-app-a','Queue progress fixture','running')`).run(`lease-fixture-${id}`);
    await insert('lease-fixture-active','lease-fixture-blocked','running','web',new Date(Date.now()+600000).toISOString());
    for (let index=0;index<55;index++) await insert(`lease-fixture-blocked-${String(index).padStart(3,'0')}`,'lease-fixture-blocked');
    await insert('lease-fixture-z-ready','lease-fixture-independent');
    const leased=await engine.leaseNextQueuedJob({worker_id:'fixture-worker',engine_class:'web'});
    assert.equal(leased.id,'lease-fixture-z-ready','Real locked SQL must scan past 55 blocked jobs.');
    assert.equal(leased.status,'leased');assert.equal(leased.attempts,1);
    await obsDb.prepare("UPDATE test_engine_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(leased.id);
    await insert('lease-fixture-z-expired','lease-fixture-recovery','running','web',new Date(Date.now()-600000).toISOString());
    const recovered=await engine.leaseNextQueuedJob({worker_id:'recovery-worker',engine_class:'web'});
    assert.equal(recovered.id,'lease-fixture-z-expired','An expired job must not block itself with its old lease.');
    assert.equal(recovered.leased_by,'recovery-worker');assert.ok(new Date(recovered.lease_expires_at)>new Date());
    await obsDb.prepare("UPDATE test_engine_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(recovered.id);
    await insert('lease-fixture-parallel-web','lease-fixture-single-slot','queued','web');
    await insert('lease-fixture-parallel-api','lease-fixture-single-slot','queued','api');
    const concurrent=await Promise.all(['web','api'].map(engine_class=>engine.leaseNextQueuedJob({worker_id:`fixture-${engine_class}`,engine_class})));
    assert.equal(concurrent.filter(Boolean).length,1,'Workers in different classes share the same execution concurrency limit.');
    await insert('lease-fixture-finished','lease-fixture-finished');
    await db.query("UPDATE executions SET status='failed',ended_at=CURRENT_TIMESTAMP WHERE id='lease-fixture-finished'");
    await engine.leaseNextQueuedJob({worker_id:'orphan-cleanup',engine_class:'web'});
    assert.equal((await obsDb.prepare('SELECT status FROM test_engine_jobs WHERE id=?').get('lease-fixture-finished')).status,'aborted','A finished parent cannot leave a permanently re-leased job.');
    await insert('lease-fixture-closed-after-lease','lease-fixture-closed-after-lease','leased');
    await db.query("UPDATE executions SET status='aborted',ended_at=CURRENT_TIMESTAMP WHERE id='lease-fixture-closed-after-lease'");
    const refused=await engine.startQueuedJob({job_id:'lease-fixture-closed-after-lease',worker_id:'fixture-worker'});
    assert.equal(refused.status,'aborted');
    assert.equal((await obsDb.prepare('SELECT status FROM test_engine_jobs WHERE id=?').get(refused.job_id)).status,'aborted','A refused start commits its cancellation rather than rolling it back.');
  } finally {
    await obsDb.query("DELETE FROM test_engine_jobs WHERE id LIKE 'lease-fixture-%'");
    await db.query("DELETE FROM executions WHERE id LIKE 'lease-fixture-%'");
  }
};
