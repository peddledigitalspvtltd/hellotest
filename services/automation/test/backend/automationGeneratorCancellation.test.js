const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const {parse}=require('acorn');
const guards=require('../../../platform/backend/src/db/databaseOperationGuard');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function fixture(status='queued'){
 const file=require.resolve('../../backend/services/automationGenerator.service'),local=createRequire(file),exports={};
 const job={id:'job',transaction_id:'activity',project_id:'project',test_case_id:'case',status,leased_by:status==='leased'?'worker':null,
  payload:{test_case_id:'case',start_url:'https://app.test',automation_case_type:'web'},created_by:'author',runtime_state:{},result:{}};
 const activity={id:'activity',category:'automation_build',project_id:'project',status:status==='queued'?'queued':'running',metadata:{agent_activity:true,step_progress:[{step_id:'saved',instruction_status:'saved'}]}};
 const events=[],statements=[],artifacts=[{id:'saved-evidence',content:'protected retained native evidence'}];let builder;
 const obs={transaction:callback=>async()=>callback(),pool:{query:async input=>{
  statements.push(input.text);assert.match(input.text,/UPDATE automation_generator_jobs SET lease_expires_at/);
  return {rowCount:job.status==='running'&&job.leased_by===input.values[2]?1:0};
 }},prepare:sql=>({get:async(...args)=>{
  statements.push(sql);
  if(/FOR UPDATE/.test(sql))return args[0]===job.transaction_id&&args[1]===job.project_id?structuredClone(job):null;
  if(/WHERE id =/.test(sql))return args[0]===job.id?structuredClone(job):null;
  return ['queued','leased','running'].includes(job.status)&&job.status==='queued'?structuredClone(job):null;
 },run:async(...args)=>{
  statements.push(sql);
  if(/SET status='cancelled'/.test(sql)){
   if(!['queued','leased','running'].includes(job.status))return {changes:0};
   Object.assign(job,{status:'cancelled',leased_by:null,lease_expires_at:null,runtime_state:{...job.runtime_state,...args[0]},result:{...job.result,...args[1]}});
  }else if(/UPDATE workspace_transactions/.test(sql))Object.assign(activity,{status:'completed',description:args[0],metadata:{...activity.metadata,...args[1]}});
  else if(/SET status = 'running'/.test(sql)){
   if(job.status!=='leased'||job.leased_by!==args[3])return {changes:0};job.status='running';
  }else if(/SET status = 'leased'/.test(sql)){
   if(job.status!=='queued')return {changes:0};job.status='leased';job.leased_by=args[0];
  }else if(/SET status = 'completed'/.test(sql)){
   if(job.status!=='running')return {changes:0};job.status='completed';
  }else if(/SET status = 'failed'/.test(sql))job.status='failed';
  return {changes:1};
 }})};
 const db={transaction:callback=>callback,prepare:()=>({get:async()=>({id:'case',app_type_id:'app',project_id:'project',app_type_kind:'web',automated:'yes'}),all:async()=>[{step_type:'web',action:'Open the page'}]})};
 const workspace={appendTransactionEvent:async(id,event)=>{assert.equal(id,'activity');events.push(event);},updateTransaction:async(id,input)=>{
  if(activity.metadata.cancelled)return activity;
  Object.assign(activity,input,{metadata:{...activity.metadata,...input.metadata}});return activity;
 }};
 new Function('require','exports',fs.readFileSync(file,'utf8'))(name=>{
  if(name.endsWith('/obsDb'))return obs;if(name.endsWith('/db'))return db;
  if(name.endsWith('workspaceTransaction.service'))return workspace;
  if(name.endsWith('aiAutomationBuilder.service'))return {buildAutomationForCase:input=>builder(input)};
  if(name.endsWith('/batchProcess.service'))return {cancelAutomationBuild:async()=>{throw Object.assign(new Error('Automation build not found.'),{statusCode:404});}};
  if(name.endsWith('automationQueuedStartUrl.service'))return {assertQueuedStartUrlReview:async()=>{}};
  return local(name);
 },exports);
 return {service:exports,job,activity,events,artifacts,statements,setBuilder:callback=>{builder=callback;},cancel:()=>exports.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'})};
}

test('queued and leased cancellation revoke worker authority idempotently while retaining saved source/evidence',async()=>{
 for(const status of ['queued','leased']){
  const f=fixture(status),saved=structuredClone({steps:f.activity.metadata.step_progress,artifacts:f.artifacts});
  assert.deepEqual(await f.cancel(),{transaction_id:'activity',status:'cancelled',cancelled:true});
  assert.equal(f.job.status,'cancelled');assert.equal(f.job.leased_by,null);assert.equal(f.job.lease_expires_at,null);
  assert.equal(f.activity.status,'completed');assert.equal(f.activity.metadata.cancelled,true);assert.equal(f.activity.metadata.outcome_status,'cancelled');
  assert.deepEqual({steps:f.activity.metadata.step_progress,artifacts:f.artifacts},saved);
  assert.equal(f.events[0].phase,'generator.cancelled');assert.equal(f.events[0].level,undefined);
  assert.equal(await f.service.leaseNextJob({worker_id:'late-worker'}),null);
  await assert.rejects(f.service.runLeasedJob({job_id:'job',worker_id:'worker'}),{statusCode:409});
  await f.cancel();assert.equal(f.events.length,1);assert.ok(f.statements.every(sql=>!/DELETE /.test(sql)));
 }
});

test('cancellation is project-scoped and cannot replace a completed or failed outcome',async()=>{
 const foreign=fixture();await assert.rejects(foreign.service.cancelGeneratorJob({transactionId:'activity',projectId:'other-project',userId:'author'}),{statusCode:404});assert.equal(foreign.job.status,'queued');
 for(const status of ['completed','failed']){
  const f=fixture(status),original=structuredClone(f.activity);
  assert.deepEqual(await f.cancel(),{transaction_id:'activity',status,cancelled:false});
  assert.deepEqual(f.activity,original);assert.equal(f.events.length,0);
 }
});

test('Stop aborts the active local guard and late model/section results cannot save or complete the job',async()=>{
 const f=fixture('leased'),entered=deferred(),release=deferred();let signal,lateWrites=0;
 // Invoke the actual final persistence boundary after the cancelled model
 // returns. Its first ownership check must reject before any case SQL/write.
 const builderSource=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
 const tree=parse(builderSource,{ecmaVersion:'latest'});
 const declaration=tree.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(row=>row.id.name==='applyBuild')).declarations.find(row=>row.id.name==='applyBuild').init;
 const applyBuild=new Function('db',`return (${builderSource.slice(declaration.start,declaration.end)});`)({transaction:callback=>callback,prepare:()=>{lateWrites++;assert.fail('Stopped source must not reach case persistence');}});
 f.setBuilder(async input=>{
  signal=input.execution_guard.signal;entered.resolve();await release.promise;
  await applyBuild({build:{updates:[]},executionGuard:input.execution_guard});
  return {generated_step_count:1};
 });
 const running=f.service.runLeasedJob({job_id:'job',worker_id:'worker'});await entered.promise;
 await f.cancel();assert.equal(signal.aborted,true);
 release.resolve();await assert.rejects(running,{code:'BATCH_JOB_LEASE_LOST'});
 assert.equal(lateWrites,0);assert.equal(f.job.status,'cancelled');assert.equal(f.activity.metadata.cancelled,true);
 assert.ok(!f.events.some(event=>['generator.completed','generator.failed'].includes(event.phase)));
});

test('the existing database operation scope rejects in-flight late work after Stop',async()=>{
 const f=fixture('leased'),entered=deferred(),release=deferred();let writes=0;
 f.setBuilder(async()=>{entered.resolve();await release.promise;guards.assertDatabaseOperationActive();writes++;return {generated_step_count:1};});
 const running=f.service.runLeasedJob({job_id:'job',worker_id:'worker'});await entered.promise;
 await f.cancel();release.resolve();await assert.rejects(running,{code:'BATCH_JOB_LEASE_LOST'});assert.equal(writes,0);
});

test('a result that ignores cancellation still cannot mark the cancelled generator complete',async()=>{
 const f=fixture('leased'),entered=deferred(),release=deferred();
 f.setBuilder(async()=>{entered.resolve();await release.promise;return {generated_step_count:1};});
 const running=f.service.runLeasedJob({job_id:'job',worker_id:'worker'});await entered.promise;
 await f.cancel();release.resolve();await assert.rejects(running,{code:'BATCH_JOB_LEASE_LOST'});
 assert.equal(f.job.status,'cancelled');assert.equal(f.activity.metadata.outcome_status,'cancelled');
 assert.ok(!f.events.some(event=>event.phase==='generator.completed'));
});

test('workspace cancellation survives stale status updates, including a read-before-cancel race',async()=>{
 const file=require.resolve('../../../platform/backend/services/workspaceTransaction.service'),local=createRequire(file),exports={},sql=[];
 let current={id:'activity',category:'automation_build',status:'running',metadata:{}},race=false,updates=0;
 const db={prepare:statement=>({run:async()=>{
  if(/UPDATE workspace_transactions/.test(statement)){
   assert.match(statement,/AND NOT \(category='automation_build'.*cancelled/s);
   if(!current.metadata.cancelled)updates++;
  }
 }})};
 new Function('require','exports',fs.readFileSync(file,'utf8'))(name=>{
  if(name.endsWith('/db')||name.endsWith('/obsDb'))return {prepare:statement=>{sql.push(statement);return db.prepare(statement);}};
  return local(name);
 },exports);
 exports.getTransaction=async()=>{
  const observed=structuredClone(current);
  if(race){race=false;current={...current,status:'completed',metadata:{cancelled:true}};}
  return observed;
 };
 race=true;await exports.updateTransaction('activity',{status:'running',metadata:{current_phase:'late-worker'}});
 assert.equal(updates,0);
 await exports.updateTransaction('activity',{status:'failed'});assert.equal(updates,0);
 assert.equal(current.status,'completed');assert.equal(current.metadata.cancelled,true);
});
