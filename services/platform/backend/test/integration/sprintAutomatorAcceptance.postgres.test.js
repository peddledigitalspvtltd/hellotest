// This integration fixture owns only an empty, guarded disposable database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('Sprint draft acceptance uses native transactional writes, concurrent replay protection, Story revisions and row locks', {
  skip: process.env.SPRINT_AUTOMATOR_POSTGRES !== '1', timeout: 300000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_sprint_automator_\d+$/);
  const db = require('../../src/db');
  const obs = require('../../src/obsDb');
  const { Client } = require('pg');
  const independent = new Client({ connectionString: process.env.DATABASE_URL });
  const tasks = require('../../../../agentic/backend/workflows/artifactTasks');
  const storyService = require('../../../../manual/backend/services/requirement.service');
  let app;
  const nativeEntered = deferred(), releaseNative = deferred();
  try {
    await require('../../src/migrate').migrate();
    // Reproduce an existing installation whose version-11 schema predates
    // workflow draft receipts. Verification is read-only; only the actual CLI
    // migration may install the additive table and advance its receipt.
    await db.query('DROP TABLE workflow_draft_acceptances');
    await db.prepare("UPDATE runtime_schema_receipts SET version=11 WHERE component='main'").run();
    const schema = require('../../src/db/schemaReadiness');
    await assert.rejects(schema.verifySchema(db,'main'),{code:'SCHEMA_MIGRATION_REQUIRED',statusCode:503});
    assert.equal((await db.prepare("SELECT to_regclass('public.workflow_draft_acceptances') AS name").get()).name,null);
    const migration = await execFile(process.execPath,[require.resolve('../../src/migrate')],{env:process.env,timeout:180000});
    assert.match(migration.stdout,/Database migrations completed/);
    await schema.verifySchema(db,'main');
    assert.equal((await db.prepare("SELECT version FROM runtime_schema_receipts WHERE component='main'").get()).version,12);
    assert.equal((await db.prepare("SELECT to_regclass('public.workflow_draft_acceptances') AS name").get()).name,'workflow_draft_acceptances');
    console.log('Sprint acceptance fixture version-11 to version-12 CLI upgrade verified.');
    await independent.connect();
    // This valid UUID previously matched the prose phone redactor in MCP.
    // Exercise typed project identity preservation on every native pipeline run.
    const projectId = '12345678-1234-4abc-8def-0123456789ab', appId = randomUUID(), userId = randomUUID(), roleId = randomUUID(), sprintId = randomUUID(), storyId = randomUUID();
    await db.prepare('INSERT INTO roles(id,name) VALUES (?,?)').run(roleId,'Sprint acceptance validation');
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,TRUE,'active')").run(userId,'sprint-validation@example.test','not-a-login','Sprint acceptance validation');
    await db.prepare('INSERT INTO projects(id,name,created_by) VALUES (?,?,?)').run(projectId,'Disposable Sprint validation',userId);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,?,?)').run(randomUUID(),projectId,userId,roleId);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES (?,?,?,'web')").run(appId,projectId,'Invoice application');
    await db.prepare("INSERT INTO requirement_iterations(id,project_id,name,state,created_by) VALUES (?,?,?,'active',?)").run(sprintId,projectId,'Validation Sprint',userId);
    await db.prepare('INSERT INTO requirements(id,project_id,title,description,iteration_id,revision) VALUES (?,?,?,?,?,1)').run(storyId,projectId,'Customer reads a saved invoice','Given an existing invoice, when its API is read, then return the saved amount.',sprintId);
    const user = { id: userId, role: 'admin' };
    const headers = { authorization: `Bearer ${require('../../src/utils/token').createToken(user)}` };
    const Fastify = require('fastify');
    app = Fastify({logger:false});
    app.register(require('../../src/plugins/errorHandler'));
    app.register(require('../../src/plugins/validator'));
    app.register(require('../../src/plugins/accessControl'));
    app.register(require('../../../../mcp/backend/plugin'));
    app.addHook('preHandler', async req => {
      if (req.method === 'POST' && req.url === '/test-cases' && req.body?.title === 'Lock protected invoice') {
        nativeEntered.resolve();
        await releaseNative.promise;
      }
    });
    app.register(require('../../src/routes'));
    await app.ready();
    console.log('Sprint acceptance fixture native routes ready.');
    const nativePipeline = await require('./sprintAutomatorPipeline.fixture')({app,db,projectId,appId,user,headers});
    console.log(JSON.stringify(nativePipeline));
    const saveRun = async title => {
      const story = await storyService.getRequirement(storyId);
      const draft = { client_id:'draft-1', title, description:'Read the existing invoice and compare the declared response.', priority:2, test_case_type:'functional', authoring_mode:'structured', requirement_ids:[storyId], parameter_values:{}, steps:[{step_order:1,step_type:'web',action:'GET https://invoices.example/invoices/one',expected_result:'Response status equals 200 and amount equals 10'}] };
      const packet = { story_id:storyId, story_revision:tasks.revision(story), cases:[draft], case_assurance:[{case_fingerprint:tasks.fingerprint(draft),verification:{status:'passed'}}], automation:[{case_fingerprint:tasks.fingerprint(draft),validation:{status:'passed'},verification_status:'unverified',steps:[{...draft.steps[0],step_type:'api',api_request:{method:'GET',url:'https://invoices.example/invoices/one',body_mode:'none',headers:[],validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.amount',operator:'eq',expected:'10'}]}}]}] };
      const id = randomUUID();
      await db.prepare(`INSERT INTO agentic_workflow_runs(id,project_id,app_type_id,workflow_name,status,input_payload,workflow_snapshot,node_results,created_by)
        VALUES (?,?,?,'Sprint Automator','completed',?,?,?,?)`).run(id,projectId,appId,{sprint_id:sprintId},{execution_mode:'review',nodes:[{id:'automation',data:{kind:'artifactTask',artifactTask:'automation-engineer'}}],edges:[]},[{node_id:'automation',node_type:'artifactTask',status:'completed',output:{data:[packet]}}],userId);
      return id;
    };
    const accept = (id, kind='manual') => app.inject({method:'POST',url:`/agentic-workflow-runs/${id}/drafts/accept`,headers,payload:{node_id:'automation',story_index:0,case_index:0,kind}});
    const casesNamed = async title => (await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=? AND title=?').get(appId,title)).count;
    const receiptsFor = async runId => (await db.prepare('SELECT count(*)::INTEGER AS count FROM workflow_draft_acceptances WHERE run_id=?').get(runId)).count;
    console.log(JSON.stringify(await require('./sprintAutomaticPublication.fixture')({db,saveRun,casesNamed,receiptsFor,user,roleId,projectId,userId})));

    const parallelId = await saveRun('Concurrent invoice acceptance');
    const parallel = await Promise.all(Array.from({length:4},()=>accept(parallelId)));
    assert.ok(parallel.every(response=>response.statusCode===200),JSON.stringify(parallel.map(response=>({status:response.statusCode,body:response.body}))));
    const manualIds = new Set(parallel.map(response=>response.json().id));
    assert.equal(manualIds.size,1);
    assert.equal(parallel.filter(response=>response.json().reused).length,3);
    assert.equal(await casesNamed('Concurrent invoice acceptance'),1);
    assert.equal(await receiptsFor(parallelId),1);
    const manualId = parallel[0].json().id;
    const manual = await db.prepare('SELECT status,automated,review_status FROM test_cases WHERE id=?').get(manualId);
    assert.equal(manual.status,'draft');assert.equal(manual.review_status,'pending');
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM requirement_test_cases WHERE requirement_id=? AND test_case_id=?').get(storyId,manualId)).count,1);
    const replay = await accept(parallelId);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,manualId);assert.equal(replay.json().reused,true);
    const automation = await accept(parallelId,'automation');assert.equal(automation.statusCode,200,automation.body);
    assert.notEqual(automation.json().id,manualId);assert.equal(automation.json().verification_status,'unverified');
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id=?').get(automation.json().id,manualId)).count,1,'Accepted automation retains its reviewed manual Test Case link');
    const automated = await db.prepare('SELECT automated,automation_status FROM test_cases WHERE id=?').get(automation.json().id);
    assert.equal(automated.automated,'yes');assert.equal(automated.automation_status,'incomplete');
    const persistedSteps = await db.prepare('SELECT step_type,api_request FROM test_steps WHERE test_case_id=? ORDER BY step_order').all(automation.json().id);
    assert.equal(persistedSteps.length,1);assert.equal(persistedSteps[0].step_type,'api');assert.equal(persistedSteps[0].api_request.url,'https://invoices.example/invoices/one');
    assert.equal(await receiptsFor(parallelId),2);

    const staleId = await saveRun('Stale invoice acceptance');
    await db.prepare('UPDATE requirements SET description=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('The current Story changed after the workflow review.',storyId);
    const stale = await accept(staleId);assert.equal(stale.statusCode,409,stale.body);
    assert.equal(await casesNamed('Stale invoice acceptance'),0);assert.equal(await receiptsFor(staleId),0);

    const rollbackId = await saveRun('Rolled back invoice acceptance');
    await db.query("CREATE FUNCTION sprint_fixture_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture receipt persistence failed'; END $$");
    await db.query('CREATE TRIGGER sprint_fixture_reject_receipt BEFORE INSERT ON workflow_draft_acceptances FOR EACH ROW EXECUTE FUNCTION sprint_fixture_reject_receipt()');
    const failed = await accept(rollbackId);assert.equal(failed.statusCode,500,failed.body);
    assert.equal(await casesNamed('Rolled back invoice acceptance'),0,'A failed receipt must roll back its native case and linked steps');
    assert.equal(await receiptsFor(rollbackId),0);
    await db.query('DROP TRIGGER sprint_fixture_reject_receipt ON workflow_draft_acceptances');
    await db.query('DROP FUNCTION sprint_fixture_reject_receipt()');
    const afterRollback = await accept(rollbackId);assert.equal(afterRollback.statusCode,200,afterRollback.body);assert.equal(await casesNamed('Rolled back invoice acceptance'),1);

    const lockId = await saveRun('Lock protected invoice');
    const accepting = Promise.resolve(accept(lockId));
    let barrierTimer;
    try { await Promise.race([nativeEntered.promise,new Promise((_,reject)=>{ barrierTimer=setTimeout(()=>reject(new Error('The native creation barrier was not reached.')),10000); })]); }
    finally { clearTimeout(barrierTimer); }
    try {
      await independent.query('BEGIN');
      await independent.query("SET LOCAL lock_timeout='150ms'");
      await assert.rejects(independent.query('UPDATE requirements SET description=$1,revision=revision+1 WHERE id=$2',['Concurrent Story writer',storyId]),{code:'55P03'});
    } finally {await independent.query('ROLLBACK');releaseNative.resolve();}
    const locked = await accepting;assert.equal(locked.statusCode,200,locked.body);assert.equal(await casesNamed('Lock protected invoice'),1);assert.equal(await receiptsFor(lockId),1);
    await independent.query('UPDATE requirements SET description=$1,revision=revision+1 WHERE id=$2',['Writer proceeds after acceptance commit',storyId]);
    const runtime=require('../../../../agentic/backend/services/agenticWorkflowExecution.service');
    const terminalId=randomUUID();
    await db.prepare("INSERT INTO agentic_workflow_runs(id,project_id,app_type_id,workflow_name,status,input_payload,workflow_snapshot,node_results,created_by) VALUES(?,?,?,'Terminal recovery','running',?,?,?,?)").run(terminalId,projectId,appId,{},{execution_mode:'review'},[],userId);
    const terminalRun=await runtime._internals.store.get(terminalId),held=[];
    try {
      // Reproduce the production failure rather than mocking a database error:
      // every normal application-pool connection remains checked out while the
      // terminal writer must acquire its independent bounded connection.
      for(let index=0;index<db.pool.options.max;index++)held.push(await db.pool.connect());
      await runtime._internals.persistTerminal(terminalRun,'failed',[],{status:'failed',summary:'The context request stopped; terminal metadata recovered.'});
      assert.equal((await held[0].query('SELECT status FROM agentic_workflow_runs WHERE id=$1',[terminalId])).rows[0].status,'failed');
      assert.equal(db.pool.idleCount,0,'The primary application pool remains exhausted during recovery');
      assert.equal(runtime._internals.active.size,0,'Terminal recovery never starts node or provider work');
    } finally {for(const client of held)client.release();}
    assert.equal((await runtime._internals.store.get(terminalId)).status,'failed','A separate bounded connection records terminal state when primary pool acquisition fails');
    assert.equal(runtime._internals.pendingTerminals.has(terminalId),false);
    assert.equal(await runtime._internals.store.saveTerminal(terminalId,'completed',[],{status:'completed'}),undefined,'Recovery cannot overwrite an already terminal record');
    console.log(JSON.stringify({existing_version_11_upgrade_verified:true,native_case_and_receipt_atomic:true,parallel_accepts:parallel.length,duplicate_cases:0,stale_story_rejected:true,receipt_failure_rolled_back_native_case:true,story_writer_blocked_until_acceptance_commit:true,exhausted_main_pool_terminal_recovery:true,provider_calls:0}));
  } finally {
    releaseNative.resolve();
    await app?.close();
    await independent.end().catch(()=>{});
    await Promise.allSettled([db.close(),obs.close()]);
  }
});
