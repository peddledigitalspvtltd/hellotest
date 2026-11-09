const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

test('PostgreSQL suite publication, serial leases, cancellation and generated suite inputs share one durable contract', {
  skip:process.env.AUTOMATION_SUITE_POSTGRES_TEST !== '1',timeout:120000
},async t=>{
  assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_automation_suite_[a-z0-9_]+$/);
  assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
  const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
  try{
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null,'Requires a new disposable database.');
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const project=randomUUID(),app=randomUUID(),actor=randomUUID(),suite=randomUUID(),child=randomUUID(),data=randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Suite fixture','active')").run(actor,`${actor}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Suite fixture')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture web','web')").run(app,project);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,actor,'role-admin');
    await db.prepare("INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,columns,rows) VALUES(?,?,?,'Customers','table',?,?)").run(data,project,app,['r.customer'],[{'r.customer':'one'},{'r.customer':'two'}]);
    await db.prepare("INSERT INTO test_suites(id,app_type_id,name,parameter_values,test_data_set_id) VALUES(?,?,'Parent',?,?)").run(suite,app,{'s.tenant':'{{randomString:20}}'},data);
    await db.prepare("INSERT INTO test_suites(id,app_type_id,name,parent_id) VALUES(?,?,'Child',?)").run(child,app,suite);
    const cases=require('@hellotest/testing/backend/services/testCase.service'),runs=require('@hellotest/testing/backend/services/execution.service');
    const dispatch=require('../../backend/services/testEngineDispatch.service'),workspace=require('@hellotest/platform/backend/services/workspaceTransaction.service');
    t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'),'resolve',async()=>({config:{instruction_blocks:{
      'engineRepair.goal':'Retain behavior','engineRepair.screen_selection':'Observed screen','engineRepair.correction_policy':'Retain assertions'
    }}}));
    const saved=[];
    for(const [title,suiteId] of [['First',suite],['Second',suite],['Nested',child]])saved.push(await cases.createTestCase({
      app_type_id:app,created_by:actor,title,automated:'yes',suite_ids:[suiteId],automation_start_url:'https://fixture.example.test/',
      steps:[{action:'Confirm fixture',expected_result:'Fixture heading is visible',step_type:'web',automation_code:'await expect(page.getByRole("heading", {name:"Fixture"})).toBeVisible();'}]
    }));
    const createPlan=async input=>{
      const run=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,...input});
      await db.prepare("UPDATE executions SET status='running' WHERE id=?").run(run.id);
      const execution=await runs.getExecution(run.id);
      const plan=await dispatch.planExecutionDispatch(execution);
      assert.equal(plan.unsupported_automated_case_count,0,JSON.stringify(plan.warnings));
      return{run,execution,plan};
    };
    await t.test('individual cases reuse generated suite inputs and a nested suite expands exactly once',async()=>{
      const direct=await createPlan({test_case_ids:[saved[0].id,saved[1].id]});
      const values=await db.prepare('SELECT suite_parameter_values FROM execution_case_snapshots WHERE execution_id=? ORDER BY sort_order').all(direct.run.id);
      assert.equal(values.length,2);assert.equal(values[0].suite_parameter_values['s.tenant'],values[1].suite_parameter_values['s.tenant']);
      assert.match(values[0].suite_parameter_values['s.tenant'],/^[a-zA-Z0-9]{20}$/);
      const nested=await createPlan({suite_ids:[suite,child]});
      assert.equal(nested.execution.case_snapshots.length,3);
      assert.equal(new Set(nested.execution.case_snapshots.map(item=>item.test_case_id)).size,3);
      assert.equal(nested.plan.eligibleCases.length,6,'Two inherited suite data rows are frozen for each case.');
    });
    await t.test('workers cannot observe any partial suite while receipts are still being written',async()=>{
      const f=await createPlan({test_case_ids:[saved[0].id,saved[1].id]});
      let pause,release;const paused=new Promise(resolve=>{pause=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      const original=workspace.createTransaction;let receipts=0;
      const mock=t.mock.method(workspace,'createTransaction',async input=>{
        if(++receipts===2){pause();await gate;}
        return original(input);
      });
      const queued=dispatch.queueExecutionDispatch({plan:f.plan,integration:{base_url:'https://engine.example.test',config:{}}});
      try{
        await paused;
        assert.equal((await obs.pool.query('SELECT count(*)::int AS count FROM test_engine_jobs WHERE execution_id=$1',[f.run.id])).rows[0].count,0);
        assert.equal(await dispatch.leaseNextQueuedJob({worker_id:'concurrent-worker',engine_class:'web'}),null);
      }finally{release();}
      const summary=await queued;mock.mock.restore();
      assert.equal(summary.queued_for_engine_count,4);
      const jobs=await obs.prepare('SELECT * FROM test_engine_jobs WHERE execution_id=? ORDER BY created_at,id').all(f.run.id);
      assert.equal(jobs.length,4);
      const first=await dispatch.leaseNextQueuedJob({worker_id:'worker',engine_class:'web'});
      assert.equal(first.test_case_id,f.execution.case_snapshots[0].test_case_id);
      assert.equal(await dispatch.leaseNextQueuedJob({worker_id:'other-worker',engine_class:'web'}),null,'Serial run permits only one case row at a time.');
      await dispatch.startQueuedJob({job_id:first.id,worker_id:'worker'});
      assert.equal((await dispatch.heartbeatQueuedJob({job_id:first.id,worker_id:'worker'})).authorized,true);
      assert.equal((await dispatch.heartbeatQueuedJob({job_id:first.id,worker_id:'other-worker'})).code,'TESTENGINE_JOB_LEASE_LOST');
      await obs.prepare('UPDATE test_engine_jobs SET leased_by=? WHERE id=?').run('replacement-worker',first.id);
      await assert.rejects(dispatch.completeQueuedJob({job_id:first.id,worker_id:'worker',status:'passed'}),{code:'TESTENGINE_JOB_LEASE_LOST'});
      await db.prepare("UPDATE executions SET status='aborted',ended_at=CURRENT_TIMESTAMP WHERE id=?").run(f.run.id);
      assert.equal((await dispatch.heartbeatQueuedJob({job_id:first.id,worker_id:'replacement-worker'})).code,'PARENT_RUN_NOT_RUNNING');
      assert.equal((await obs.prepare('SELECT status FROM test_engine_jobs WHERE id=?').get(first.id)).status,'aborted','Cancellation survives the transaction commit.');
      assert.equal((await workspace.getTransaction(first.transaction_id)).status,'failed','The workspace receipt no longer appears queued/running after cancellation.');
      assert.equal((await db.prepare('SELECT count(*)::int AS count FROM execution_results WHERE execution_id=?').get(f.run.id)).count,1,'Heartbeats do not add result history.');
      assert.equal(await dispatch.leaseNextQueuedJob({worker_id:'worker',engine_class:'web'}),null,'Unstarted rows cannot run after cancellation.');
    });
    await t.test('a receipt failure rolls back every job and workspace receipt in that dispatch',async()=>{
      const f=await createPlan({test_case_ids:[saved[0].id,saved[1].id]});
      const original=workspace.appendTransactionEvent;let events=0;
      const mock=t.mock.method(workspace,'appendTransactionEvent',async(...args)=>{
        if(++events===2)throw new Error('Injected receipt persistence failure');return original(...args);
      });
      await assert.rejects(dispatch.queueExecutionDispatch({plan:f.plan,integration:{base_url:'https://engine.example.test',config:{}}}),/Injected receipt persistence failure/);
      mock.mock.restore();
      assert.equal((await obs.prepare('SELECT count(*)::int AS count FROM test_engine_jobs WHERE execution_id=?').get(f.run.id)).count,0);
      assert.equal((await obs.prepare("SELECT count(*)::int AS count FROM workspace_transactions WHERE metadata->>'execution_id'=?").get(f.run.id)).count,0);
    });
    await t.test('successor cases receive real private run/suite captures for their exact frozen data row while public results stay masked',async()=>{
      const f=await createPlan({test_case_ids:[saved[0].id,saved[1].id]});
      await dispatch.queueExecutionDispatch({plan:f.plan,integration:{base_url:'https://engine.example.test',config:{}}});
      const priorCase=f.execution.case_snapshots[0].test_case_id;
      for(let index=0;index<4;index++){
        const job=await dispatch.leaseNextQueuedJob({worker_id:'capture-worker',engine_class:'web'});
        assert.ok(job);const row=job.payload.data_set.iteration.index;
        if(index<2)assert.equal(job.test_case_id,priorCase);
        else{
          assert.notEqual(job.test_case_id,priorCase);
          assert.equal(job.runtime_state.captured_values['r.token'],`private-token-row-${row}`);
          assert.equal(job.runtime_state.captured_values['s.token'],`private-suite-row-${row}`);
          assert.equal(job.runtime_state.captured_values['t.local'],undefined,'Test outputs stay with their source case.');
        }
        await dispatch.startQueuedJob({job_id:job.id,worker_id:'capture-worker'});
        await dispatch.reportQueuedStep({job_id:job.id,worker_id:'capture-worker',step_id:job.payload.steps[0].id,status:'passed',captures:index<2?{
          'r.token':`private-token-row-${row}`,'s.token':`private-suite-row-${row}`,'t.local':`only-source-row-${row}`
        }:{}});
        await dispatch.completeQueuedJob({job_id:job.id,worker_id:'capture-worker',status:'passed'});
      }
      const logs=await db.prepare('SELECT logs FROM execution_results WHERE execution_id=?').all(f.run.id);
      assert.equal(logs.length,4);assert.doesNotMatch(JSON.stringify(logs),/private-token-row|private-suite-row/);
      assert.match(JSON.stringify(logs),/REDACTED/);
    });
    await t.test('expired running attempts retain evidence and block uncertain replay; never-started leases remain reclaimable',async()=>{
      const f=await createPlan({test_case_ids:[saved[0].id,saved[1].id]});
      await dispatch.queueExecutionDispatch({plan:f.plan,integration:{base_url:'https://engine.example.test',config:{}}});
      const first=await dispatch.leaseNextQueuedJob({worker_id:'original-worker',engine_class:'web'});
      await dispatch.startQueuedJob({job_id:first.id,worker_id:'original-worker'});
      const stepId=first.payload.steps[0].id;
      await dispatch.reportQueuedStep({job_id:first.id,worker_id:'original-worker',step_id:stepId,status:'passed',note:'Original verified browser check',captures:{'r.receipt':'retained-receipt'}});
      await obs.prepare("UPDATE test_engine_jobs SET lease_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?").run(first.id);
      const replacement=await dispatch.leaseNextQueuedJob({worker_id:'replacement-worker',engine_class:'web'});
      assert.ok(replacement);assert.notEqual(replacement.id,first.id,'The expired browser attempt is never automatically restarted.');
      const retired=await obs.prepare('SELECT * FROM test_engine_jobs WHERE id=?').get(first.id);
      assert.equal(retired.status,'failed');assert.ok(retired.completed_at);assert.equal(retired.attempts,1);
      assert.equal(retired.runtime_state.interrupted_attempt.code,'TESTENGINE_JOB_ATTEMPT_EXPIRED');
      assert.equal(retired.runtime_state.interrupted_attempt.action_outcome,'unknown');
      assert.equal(retired.runtime_state.logs.stepStatuses[stepId],'passed');
      assert.equal(retired.runtime_state.captured_values['r.receipt'],'retained-receipt');
      assert.match(retired.last_error,/uncertain outcome.*explicitly retrying/);
      const result=await db.prepare('SELECT * FROM execution_results WHERE execution_id=? AND test_case_id=? AND data_set_iteration_index=?').get(f.run.id,first.test_case_id,first.payload.data_set.iteration.index);
      assert.equal(result.status,'blocked');assert.equal(JSON.parse(result.logs).stepStatuses[stepId],'passed');
      assert.equal((await dispatch.heartbeatQueuedJob({job_id:first.id,worker_id:'original-worker'})).code,'TESTENGINE_JOB_FINISHED');
      await obs.prepare("UPDATE test_engine_jobs SET lease_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=?").run(replacement.id);
      const reclaimed=await dispatch.leaseNextQueuedJob({worker_id:'new-worker',engine_class:'web'});
      assert.equal(reclaimed.id,replacement.id,'A lease that never reached /start has no browser effects and can be reassigned.');
      assert.equal(reclaimed.attempts,2);assert.equal(reclaimed.leased_by,'new-worker');
      await assert.rejects(dispatch.startQueuedJob({job_id:replacement.id,worker_id:'replacement-worker'}),{code:'TESTENGINE_JOB_LEASE_LOST'});
    });
  }finally{await Promise.all([db.close(),obs.close()]);}
});
