const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);

test('MCP effects preserve pre-dispatch safety and per-iteration receipts across migration, local loops and Temporal replay',{
 skip:process.env.WORKFLOW_EFFECTS_POSTGRES_TEST!=='1',timeout:180000
},async t=>{
 const url=new URL(process.env.DATABASE_URL);assert.match(url.pathname,/^\/agent_verify_workflow_effects_[0-9]+$/);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
 const db=require('../../src/db'),obs=require('../../src/obsDb');let server,environment,worker,workerTask,control;
 try{
  await require('../../src/migrate').migrate();
  const schema=require('../../src/db/schemaReadiness');assert.ok(schema.REQUIRED_SCHEMA_VERSION>=15,'The compatibility receipt must require the iteration-safe schema.');
  const project=randomUUID(),actor=randomUUID(),role=randomUUID();
  await db.prepare('INSERT INTO roles(id,name) VALUES(?,?)').run(role,'Workflow effects fixture');
  await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,'not-a-login','Effect fixture',TRUE,'active')").run(actor,actor+'@example.test');
  await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(project,'Disposable workflow effects',actor);
  await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,actor,role);
  const constraints=()=>db.prepare(`SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='workflow_operation_receipts'::regclass`).all();
  assert.equal((await constraints()).filter(row=>row.contype==='u').length,0,'A fresh install uses the canonical operation primary key.');
  await db.query('ALTER TABLE workflow_operation_receipts ADD UNIQUE(project_id,run_id,node_id)');
  await db.query('ALTER TABLE workflow_operation_receipts ADD CONSTRAINT legacy_alternate_scope_name UNIQUE(project_id,run_id,node_id)');
  await db.query('ALTER TABLE workflow_operation_receipts ADD CONSTRAINT fixture_keep_project_operation UNIQUE(project_id,id)');
  await db.prepare("INSERT INTO workflow_operation_receipts(id,project_id,run_id,node_id,actor_id,request_hash,state,response) VALUES('legacy-receipt',?,'legacy-run','body',?,'legacy-hash','response_received',?)").run(project,actor,{data:{id:'retained'}});
  await db.prepare("UPDATE runtime_schema_receipts SET version=14 WHERE component='main'").run();
  await assert.rejects(schema.verifySchema(db,'main'),{code:'SCHEMA_MIGRATION_REQUIRED'});
  const upgraded=await execFile(process.execPath,[require.resolve('../../src/migrate')],{env:process.env,timeout:90000});
  assert.match(upgraded.stdout,/Database migrations completed/);await schema.verifySchema(db,'main');
  const after=await constraints();assert.ok(after.some(row=>row.contype==='p'));
  assert.deepEqual(after.filter(row=>row.contype==='u').map(row=>row.conname),['fixture_keep_project_operation']);
  assert.deepEqual((await db.prepare("SELECT response FROM workflow_operation_receipts WHERE id='legacy-receipt'").get()).response,{data:{id:'retained'}});
  await assert.rejects(db.query("INSERT INTO workflow_operation_receipts SELECT * FROM workflow_operation_receipts WHERE id='legacy-receipt'"),{code:'23505'});

  const tool={name:'create_issue',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
   outputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:false}};
  let mode='ready';const effects=[];
  server=http.createServer(async(req,res)=>{
   if(req.method==='DELETE'){req.resume();res.writeHead(204);return res.end();}
   let bytes='';for await(const chunk of req)bytes+=chunk;const message=JSON.parse(bytes);
   if(mode==='unauthorized'){res.writeHead(401,{'content-type':'application/json'});return res.end('{"message":"PRIVATE_PROVIDER_DETAIL"}');}
   if(message.method==='notifications/initialized'){res.writeHead(202);return res.end();}
   let result;
   if(message.method==='initialize'){res.setHeader('mcp-session-id','effects-fixture');result={protocolVersion:'2025-11-25',capabilities:{tools:{}}};}
   else if(message.method==='tools/list')result={tools:[tool]};
   else {effects.push(message.params.arguments.id);if(mode==='lost'){req.socket.destroy();return;}result={structuredContent:{id:'created:'+message.params.arguments.id},content:[]};}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connection=await require('../../../../agentic/backend/workflows/connectionSettings').save({name:'Scoped effect fixture',kind:'mcp',url:`http://127.0.0.1:${server.address().port}/mcp`,
   project_id:project,authType:'none',tools:[tool.name],toolDefinitions:[tool],protocolVersion:'2025-11-25',allowPrivateNetwork:true,enabled:true},null,actor);
  const user={id:actor,role:'admin',is_workspace_admin:true};
  const journal=require('../../../../agentic/backend/workflows/operationJournal'),mcp=require('../../../../agentic/backend/workflows/mcpClient');
  const input={run:{id:'preflight-run',project_id:project},node:{id:'body',data:{kind:'mcpTool',connectionId:connection.id,mcpTool:tool.name}},user,input:[]};
  const dispatch=()=>mcp.call({projectId:project,connectionId:connection.id,user,timeoutMs:2000},tool.name,{id:'preflight'});
  mode='unauthorized';await assert.rejects(journal.invoke(input,dispatch),error=>error.effect_dispatched===false&&!error.outcome_unknown&&error.upstreamStatusCode===401);
  assert.equal((await db.prepare("SELECT COUNT(*)::int AS n FROM workflow_operation_receipts WHERE run_id='preflight-run'").get()).n,0);assert.equal(effects.length,0);
  mode='ready';await journal.invoke(input,dispatch);await journal.invoke(input,dispatch);assert.deepEqual(effects,['preflight']);
  mode='lost';const lost={...input,run:{id:'lost-run',project_id:project}};
  await assert.rejects(journal.invoke(lost,dispatch),{outcome_unknown:true,retryable:false});
  mode='ready';await assert.rejects(journal.invoke(lost,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});assert.equal(effects.length,2);

  const node=(id,kind,data={})=>({id,type:'agenticStep',data:{label:id,kind,...data}}),edge=(source,target,extra={})=>({id:source+'-'+target,source,target,...extra});
  const definition={project_id:project,name:'Per-item MCP writes',trigger_kind:'manual',nodes:[node('input','trigger'),node('loop','loop',{loopAction:'workflow',loopSourceKey:'input.items',loopBatchSize:1,loopMaxIterations:10}),
   node('body','mcpTool',{connectionId:connection.id,mcpTool:tool.name,mcpArguments:'{"id":"$item"}'}),node('output','output')],
   edges:[edge('input','loop'),edge('loop','body',{sourceHandle:'loop'}),edge('body','loop',{targetHandle:'continue'}),edge('loop','output',{sourceHandle:'done'})],settings:{}};
  const workflow=await require('../../../../agentic/backend/services/agenticWorkflow.service').createWorkflow(definition,actor);
  const runtime=require('../../../../agentic/backend/services/agenticWorkflowExecution.service');
  const localInput={request_id:randomUUID(),input_payload:{items:['local-a','local-b','local-c']}};
  const local=await runtime.start(workflow,localInput,user);await runtime._internals.active.get(local.id)?.promise;
  const localFinal=await runtime._internals.store.get(local.id);assert.equal(localFinal.status,'completed',JSON.stringify(localFinal.output_payload));
  assert.deepEqual(effects.slice(-3),localInput.input_payload.items);
  const localReceipts=await db.prepare('SELECT id,state,node_id FROM workflow_operation_receipts WHERE run_id=?').all(local.id);
  assert.equal(localReceipts.length,3);assert.equal(new Set(localReceipts.map(row=>row.id)).size,3);assert.ok(localReceipts.every(row=>row.node_id==='body'&&row.state==='response_received'));
  const localCount=effects.length;await runtime.start(workflow,localInput,user);assert.equal(effects.length,localCount);

  const {TestWorkflowEnvironment}=require('@temporalio/testing'),{Worker}=require('@temporalio/worker');
  environment=await TestWorkflowEnvironment.createLocal();process.env.TEMPORAL_ADDRESS=environment.address;process.env.TEMPORAL_TASK_QUEUE='effects-'+randomUUID();
  control=require('../../../../agentic/backend/workflows/temporal/control');const activities=require('../../../../agentic/backend/workflows/temporal/activities');
  let lostLoopAcknowledgement=false;
  const workflowsPath=require.resolve('../../../../agentic/backend/workflows/temporal/workflows');
  worker=await Worker.create({connection:environment.nativeConnection,taskQueue:control.queue(),workflowsPath,activities:{...activities,
   executeReviewNode:async args=>{const receipt=await activities.executeReviewNode(args);if(args.nodeId==='loop'&&!lostLoopAcknowledgement){lostLoopAcknowledgement=true;throw Error('Fixture lost whole-loop acknowledgement');}return receipt;}}});
  workerTask=worker.run();
  const temporalInput={request_id:randomUUID(),input_payload:{items:['temporal-a','temporal-b','temporal-c']}};
  const temporal=await runtime.start(workflow,temporalInput,user);await control.deliver();
  const handle=environment.client.workflow.getHandle(control.workflowId(temporal.id));await handle.result();
  const temporalFinal=await runtime._internals.store.get(temporal.id);assert.equal(temporalFinal.status,'completed',JSON.stringify(temporalFinal.output_payload));assert.equal(lostLoopAcknowledgement,true);
  assert.deepEqual(effects.slice(-3),temporalInput.input_payload.items);assert.equal(effects.length,localCount+3,'Temporal acknowledgement recovery cannot repeat external effects.');
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM workflow_operation_receipts WHERE run_id=?').get(temporal.id)).n,3);
  await Worker.runReplayHistory({workflowsPath},await handle.fetchHistory());assert.equal(effects.length,localCount+3);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM llm_request_traces WHERE run_id IN (?,?)').get(local.id,temporal.id)).n,0);
  t.diagnostic(JSON.stringify({fresh_schema:true,version_14_upgrade:true,legacy_receipts_preserved:true,local_iterations:3,temporal_iterations:3,
   pre_dispatch_release:true,lost_response_no_replay:true,lost_temporal_ack_no_replay:true,model_calls:0}));
 }finally{
  if(worker)worker.shutdown();if(workerTask)await workerTask;if(control)await control.close();if(environment)await environment.teardown();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await obs.close();await db.close();
 }
});
