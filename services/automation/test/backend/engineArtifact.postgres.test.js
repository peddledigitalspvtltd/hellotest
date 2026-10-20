const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes, createHmac, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const platformRequire = require('node:module').createRequire(path.resolve(__dirname, '../../../platform/backend/package.json'));

test('real browser evidence streams into private result attachments with verified replay and policy', {
  skip: process.env.ENGINE_ARTIFACT_POSTGRES !== '1', timeout: 120000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_automation_evidence$/);
  assert.equal(new URL(process.env.DATABASE_URL).hostname,'127.0.0.1');
  assert.equal(new URL(process.env.DATABASE_URL).port,'55439');
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  assert.equal(process.env.POSTGRES_URL||process.env.DATABASE_URL,process.env.DATABASE_URL);
  assert.equal(process.env.OBS_POSTGRES_URL||process.env.OBS_DATABASE_URL,process.env.OBS_DATABASE_URL);
  assert.equal(process.env.MINIO_ENDPOINT, '127.0.0.1');
  assert.equal(process.env.MINIO_PORT, '55440');
  assert.match(process.env.MINIO_BUCKET, /^agent-verify-/);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hellotest-engine-evidence-'));
  process.env.ARTIFACT_ROOT = root;
  const db = require('@hellotest/platform/backend/src/db'), obs = require('@hellotest/platform/backend/src/obsDb');
  const api = platformRequire('fastify')();
  let session;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Only an empty owned database is accepted.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    const actor = randomUUID(), viewer = randomUUID(), role = randomUUID(), project = randomUUID(), app = randomUUID(), caseId = randomUUID(), runId = randomUUID(), stepId = randomUUID(), secondStepId=randomUUID(), engineId = randomUUID();
    for (const id of [actor, viewer]) await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,'no-login','Evidence fixture',?,'active')").run(id, `${id}@example.test`, id === actor);
    await db.prepare("INSERT INTO roles(id,name) VALUES(?,'Evidence fixture without grants')").run(role);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Disposable browser evidence')").run(project);
    for (const id of [actor, viewer]) await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(), project, id, role);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Web fixture','web')").run(app, project);
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,'Captured case','yes')").run(caseId, app);
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status) VALUES(?,?,?,'Captured run','local','running')").run(runId, project, app);
    await db.prepare("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,'Frozen captured case')").run(runId, caseId);
    await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,step_type) VALUES(?,?,?,1,'Read readiness','web')").run(runId, caseId, stepId);
    await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,step_type) VALUES(?,?,?,1,'Read readiness again','web')").run(runId, caseId, secondStepId);
    const results = require('@hellotest/testing/backend/services/executionResult.service');
    const result = await results.createExecutionResult({ execution_id:runId, test_case_id:caseId, app_type_id:app, status:'running', executed_by:actor });
    const policy = { video_mode:'on',trace_mode:'on',screenshot_on_success:true,screenshot_on_failure:false,capture_console:false,capture_network:false,max_video_attachment_mb:25 };
    const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
    const transaction = await workspace.createTransaction({ project_id:project,app_type_id:app,created_by:actor,category:'automation',action:'testengine_run',status:'running',title:'Captured run',related_kind:'testengine_run',related_id:engineId,
      metadata:{source:'hellotest.local-run',queue_mode:'direct-local',engine_run_id:engineId,execution_id:runId,test_case_id:caseId,execution_result_id:result.id,artifact_policy:policy} });
    let user = { id:actor,is_workspace_admin:true };
    const permissions = require('@hellotest/platform/backend/services/permission.service');
    api.decorate('authenticate', async req => { req.user=user; });
    api.decorate('validate', () => {});
    api.decorate('authenticateTestEngine', async req => { if (req.headers.authorization !== `Bearer ${process.env.TESTENGINE_SHARED_SECRET}`) throw Object.assign(new Error('Engine authentication failed'),{statusCode:401}); });
    api.decorate('requirePermission', (permission,{projectId}={}) => async req => {
      if (!await permissions.hasPermission(req.user,permission,projectId)) throw Object.assign(new Error('Permission denied'),{statusCode:403});
    });
    await api.register(platformRequire('@fastify/multipart'));
    await api.register(require('../../backend/routes/testEngineInternal.routes'),{prefix:'/api'});
    await api.register(require('../../../testing/backend/routes/executionResults.routes'));
    api.get('/fixture', async (_req,reply) => reply.type('text/html').send('<!doctype html><h1>Ready</h1>'));
    const base = await api.listen({host:'127.0.0.1',port:0});
    const { createWebRunSession } = await import(pathToFileURL(path.resolve(__dirname,'../../../../testengine/backend/dist/lib/webEngine.js')).href);
    const { deliverEngineArtifacts } = await import(pathToFileURL(path.resolve(__dirname,'../../../../testengine/backend/dist/lib/engineArtifacts.js')).href);
    const envelope = { engine_run_id:engineId,browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:`${base}/fixture`},run_timeout_seconds:20,max_repair_attempts:0,artifact_policy:policy,
      case_parameters:{'t.trace-fixture':randomBytes(2*1024*1024).toString('base64')},
      callback:{url:`${base}/api/testengine/callbacks/runs`,signing_secret:process.env.TESTENGINE_SHARED_SECRET},steps:[] };
    session = createWebRunSession(envelope);
    await session.start();
    const actual = await session.runStep({id:stepId,order:1,step_type:'web',action:'Confirm readiness and a new tab',automation_code:'await expect(page.locator("h1")).toHaveText("Ready");\nawait page.evaluate(content=>{const node=document.createElement("pre");node.hidden=true;node.textContent=content;document.body.append(node);},params["t.trace-fixture"]);\nconst second=await page.context().newPage();\nawait second.goto("'+base+'/fixture");\nawait expect(second.locator("h1")).toHaveText("Ready");'});
    assert.equal(actual.status,'passed',actual.note);
    assert.match(actual.evidence.dataUrl,/^data:image\/jpeg;base64,/);
    const repeatedOrder=await session.runStep({id:secondStepId,order:1,step_type:'web',action:'Another section using order one',automation_code:'await expect(page.locator("h1")).toHaveText("Ready");'});
    assert.equal(repeatedOrder.status,'passed',repeatedOrder.note);
    assert.notEqual(repeatedOrder.evidence.fileName,actual.evidence.fileName,'Section and hook orders cannot overwrite each other\'s screenshot.');
    const bundle = await session.stop(actual.status); session=null;
    assert.equal(bundle.artifact_refs.filter(ref=>ref.kind==='video').length,2,'Every opened browser page retains its video.');
    for (const kind of ['video','trace','screenshot']) assert.ok(bundle.artifact_refs.some(ref=>ref.kind===kind && ref.attachment_status==='uploaded'),`${kind} is an attached stored object.`);
    assert.ok(bundle.artifact_refs.find(ref=>ref.kind==='trace').size_bytes>2*1024*1024,'A real trace above the inline fallback limit travels through file-backed upload.');
    assert.ok(bundle.artifact_refs.every(ref=>ref.attachment_id && !ref.content_base64));
    assert.deepEqual(bundle.capture_warnings,[]);
    const beforeCount = (await db.prepare("SELECT COUNT(*)::int AS count FROM attachments WHERE entity_id=?").get(result.id)).count;
    const replay = await deliverEngineArtifacts(envelope,bundle.artifact_refs,'passed');
    assert.deepEqual(replay.map(ref=>ref.attachment_id),bundle.artifact_refs.map(ref=>ref.attachment_id));
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM attachments WHERE entity_id=?').get(result.id)).count,beforeCount);
    const invalidBody = new FormData();
    const badChecksum='0'.repeat(64), name='checksum-mismatch.webm';
    const invalidContext=Buffer.from(JSON.stringify({purpose:'execution-artifact',engine_run_id:engineId,kind:'video',outcome:'passed',checksum:badChecksum,file_name:name,content_type:'video/webm',issued_at:Date.now()})).toString('base64url');
    invalidBody.set('file',new Blob(['not the claimed bytes'],{type:'video/webm'}),name);
    const invalidUpload=await fetch(`${base}/api/testengine/internal/runs/${engineId}/artifacts`,{method:'POST',body:invalidBody,headers:{'x-testengine-artifact-context':invalidContext,'x-testengine-artifact-signature':createHmac('sha256',process.env.TESTENGINE_SHARED_SECRET).update(invalidContext).digest('hex')}});
    assert.equal(invalidUpload.status,400);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM attachments WHERE entity_id=?').get(result.id)).count,beforeCount);

    const screenshot=bundle.artifact_refs.find(ref=>ref.kind==='screenshot');
    const logs = {stepStatuses:{[stepId]:actual.status,[secondStepId]:repeatedOrder.status},stepNotes:{[stepId]:actual.note},stepEvidence:{[stepId]:{attachmentId:screenshot.attachment_id,fileName:'Untrusted filename'},foreign:{attachmentId:randomUUID()}},stepWebDetails:{[stepId]:actual.web_detail}};
    const payload = {event:'run.completed',engine_run_id:engineId,hellotest_execution_id:runId,hellotest_test_case_id:caseId,state:'completed',summary:'Browser fixture completed',case_result:{status:'passed',logs},artifact_bundle:bundle,emitted_at:new Date().toISOString()};
    const raw = JSON.stringify(payload);
    await require('../../backend/services/testEngineCallback.service').handleRunCallback({payload,rawPayload:raw,headers:{'x-testengine-signature':createHmac('sha256',process.env.TESTENGINE_SHARED_SECRET).update(raw).digest('hex')}});
    assert.equal((await results.getExecutionResult(result.id)).status,'passed');
    const storedEvidence=JSON.parse((await results.getExecutionResult(result.id)).logs).stepEvidence;
    assert.equal(storedEvidence[stepId].attachmentId,screenshot.attachment_id);
    assert.equal(storedEvidence[stepId].fileName,screenshot.file_name,'Stored evidence metadata comes from the verified attachment.');
    assert.equal(storedEvidence.foreign,undefined);
    const response = await api.inject({method:'GET',url:`/execution-results/${result.id}/attachments`});
    assert.equal(response.statusCode,200,response.body);
    const listed = response.json();
    assert.equal(listed.length,beforeCount);
    const attachmentStore = require('@hellotest/platform/backend/services/attachment.service');
    for (const item of listed) {
      const {stream} = await attachmentStore.download({user,id:item.id});
      const chunks=[];for await (const chunk of stream) chunks.push(chunk);
      const stored = Buffer.concat(chunks);
      assert.equal(createHash('sha256').update(stored).digest('hex'),item.checksum);
      assert.equal(stored.length,item.size);
      if (item.mimeType==='video/webm') assert.equal(stored.subarray(0,4).toString('hex'),'1a45dfa3');
    }
    user={id:viewer,is_workspace_admin:false};
    assert.equal((await api.inject({method:'GET',url:`/execution-results/${result.id}/attachments`})).statusCode,403);
    await assert.rejects(attachmentStore.download({user,id:listed[0].id}),error=>error.statusCode===403);
    user={id:actor,is_workspace_admin:true};
    const artifactService = require('../../backend/services/engineArtifact.service');
    const validation = await artifactService.validateBundle({artifact_refs:[{kind:'video',attachment_id:randomUUID()}]},result.id);
    assert.equal(validation.artifact_refs[0].attachment_id,undefined);
    const forbidden={...envelope,artifact_policy:{...policy,video_mode:'off'}};
    await obs.prepare('UPDATE workspace_transactions SET metadata=metadata||?::jsonb WHERE id=?').run({artifact_policy:forbidden.artifact_policy},transaction.id);
    const blocked = await deliverEngineArtifacts(forbidden,[{...bundle.artifact_refs.find(ref=>ref.kind==='video'),attachment_id:undefined}],'passed');
    assert.notEqual(blocked[0].attachment_status,'uploaded');
    const forged=await api.inject({method:'POST',url:`/api/testengine/internal/runs/${engineId}/artifacts`,headers:{'x-testengine-artifact-context':'e30','x-testengine-artifact-signature':'0'.repeat(64)}});
    assert.equal(forged.statusCode,401);
  } finally {
    if (session) await session.stop('failed');
    await api.close();await obs.close();await db.close();await fsp.rm(root,{recursive:true,force:true});
  }
});
