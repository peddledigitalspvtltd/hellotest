const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db'),obsDb=require('@hellotest/platform/backend/src/obsDb');
const batches=require('../../backend/services/batchProcess.service');
const builder=require('@hellotest/automation/backend/services/aiAutomationBuilder.service');
const workspace=require('@hellotest/platform/backend/services/workspaceTransaction.service');
const generator=require('@hellotest/automation/backend/services/automationGenerator.service');
const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

function fixture(t,{expired=true,queued=false,onRenew}={}){
 let state={jobs:[{id:'build',transaction_id:'activity',operation:'automation_build',status:queued?'queued':'running',lease_owner:'old-worker',expired,attempts:1,payload:{app_type_id:'app',test_case_ids:['case']}},
  {id:'export',transaction_id:'export-activity',operation:'test_case_export',status:'running',expired:true}],
  activity:{id:'activity',category:'automation_build',project_id:'project',app_type_id:'app',status:'running',title:'Build',metadata:{sections:[{step_id:'saved',instruction_status:'saved'}]}},events:[]};
 const sql=[],controls={failEvent:false,openTransactions:0};let dequeued=false;
 const execute=async(input,params,client)=>{
  const text=(typeof input==='string'?input:input.text).replace(/\s+/g,' ').trim(),values=typeof input==='string'?params||[]:input.values||[];sql.push({text,values,client:Boolean(client)});
  const result=(rows=[],rowCount=rows.length)=>({rows:clone(rows),rowCount});
  if(text==='BEGIN'){client.draft=clone(state);controls.openTransactions++;return result();}
  if(text==='COMMIT'){state=client.draft;client.draft=null;controls.openTransactions--;return result();}
  if(text==='ROLLBACK'){client.draft=null;controls.openTransactions--;return result();}
  const current=client?.draft||state;
  if(text.startsWith('SELECT * FROM automation_generator_jobs'))return result();
  if(text.startsWith('SELECT job.* FROM batch_process_jobs job')){
   assert.match(text,/activity.project_id=\$2/);assert.match(text,/job.operation='automation_build'/);assert.match(text,/FOR UPDATE OF job/);
   return result(current.activity.id===values[0]&&current.activity.project_id===values[1]?current.jobs.filter(row=>row.transaction_id===values[0]&&row.operation==='automation_build'):[]);
  }
  if(text.startsWith("UPDATE batch_process_jobs SET status='completed'")){
   assert.match(text,/operation='automation_build' AND status IN \('queued','running'\)/);
   const row=current.jobs.find(row=>row.id===values[1]&&row.operation==='automation_build'&&['queued','running'].includes(row.status));
   if(!row)return result();Object.assign(row,{status:'completed',result:{...row.result,...JSON.parse(values[0])},lease_owner:null,lease_expires_at:null,next_run_at:null});return result([],1);
  }
  if(text.startsWith("UPDATE workspace_transactions SET status='completed',description=")){
   assert.equal(values[2],current.activity.id);assert.equal(values[3],current.activity.project_id);
   Object.assign(current.activity,{status:'completed',description:values[0],metadata:{...current.activity.metadata,...JSON.parse(values[1])}});return result([],1);
  }
  if(text.startsWith('SELECT id FROM batch_process_jobs'))return result(current.jobs.filter(row=>row.operation==='automation_build'&&row.status==='running'&&row.expired).map(({id})=>({id})));
  if(text.startsWith('UPDATE batch_process_jobs SET status = \'queued\'')){
   assert.match(text,/operation IS DISTINCT FROM 'automation_build'/);
   for(const row of current.jobs)if(row.status==='running'&&row.expired&&row.operation!=='automation_build')row.status='queued';return result();
  }
  if(text.startsWith('UPDATE batch_process_jobs SET status=\'failed\'')){
   assert.match(text,/operation='automation_build' AND status='running'/);assert.match(text,/lease_owner=\$5/);assert.match(text,/lease_expires_at<=CURRENT_TIMESTAMP/);
   const row=current.jobs.find(row=>row.id===values[2]&&row.operation==='automation_build'&&row.status==='running'&&(values[3]===null||row.lease_owner===values[4])&&(!values[5]||row.expired));
   if(!row)return result();Object.assign(row,{status:'failed',result:JSON.parse(values[0]),last_error:values[1],lease_owner:null});return result([{id:row.id,transaction_id:row.transaction_id}]);
  }
  if(text.startsWith('SELECT * FROM batch_process_jobs')){
   if(!queued||dequeued)return result();dequeued=true;return result(current.jobs.filter(row=>row.id==='build'&&row.status==='queued'));
  }
  if(text.startsWith('UPDATE batch_process_jobs SET status = \'running\'')){
   const row=current.jobs.find(row=>row.id===values[2]&&row.status==='queued');if(!row)return result();Object.assign(row,{status:'running',lease_owner:values[0],expired:false});return result([],1);
  }
  if(text.startsWith('UPDATE batch_process_jobs SET lease_expires_at=')){
   assert.equal(Boolean(client),false,'Lease renewal must use its own pool request, never the business transaction client');assert.equal(input.query_timeout,10_000);
   return onRenew?onRenew({state,values,controls,input}):result([],1);
  }
  if(text.includes('FROM workspace_transactions')&&text.includes('WHERE workspace_transactions.id'))return result(current.activity.id===values[0]?[current.activity]:[]);
  if(text.startsWith('UPDATE workspace_transactions SET')){
   Object.assign(current.activity,{project_id:values[0],app_type_id:values[1],category:values[2],action:values[3],status:values[4],title:values[5],description:values[6],metadata:JSON.parse(values[7]),completed_at:values[12]});return result([],1);
  }
  if(text.startsWith('INSERT INTO workspace_transaction_events')){
   if(controls.failEvent)throw new Error('Event store unavailable');current.events.push({transaction_id:values[1],level:values[2],phase:values[3],message:values[4],details:JSON.parse(values[5])});return result([],1);
  }
  throw new Error('Unexpected fixture query: '+text);
 };
 t.mock.method(obsDb.pool,'query',(input,values)=>execute(input,values));
 t.mock.method(obsDb.pool,'connect',async()=>{const client={query:(input,values)=>execute(input,values,client),release(){},on(){},removeListener(){}};return client;});
 t.mock.method(db.pool,'query',async()=>({rows:[],rowCount:0}));
 return {read:()=>state,sql,controls};
}

test('expired running automation builds fail atomically without replay while read-only exports retain requeue compatibility',async t=>{
 const f=fixture(t);let builds=0;t.mock.method(builder,'buildAutomationBatch',async()=>{builds++;});
 await batches.processQueuedJobs();const state=f.read();
 assert.equal(state.jobs[0].status,'failed');assert.equal(state.jobs[1].status,'queued');assert.equal(builds,0);
 assert.equal(state.activity.status,'failed');assert.equal(state.activity.metadata.error_code,'AUTOMATION_BUILD_LEASE_EXPIRED');assert.equal(state.activity.metadata.saved_instructions_retained,true);assert.equal(state.activity.metadata.automatic_retry,false);
 assert.deepEqual(state.activity.metadata.sections,[{step_id:'saved',instruction_status:'saved'}]);assert.equal(state.events.length,1);assert.equal(state.events[0].phase,'automation.agent.lease.failed');assert.equal(state.events[0].details.replay_safe,false);
 assert.ok(f.sql.find(row=>row.text.startsWith('UPDATE batch_process_jobs SET status=\'failed\'')).client);assert.ok(f.sql.find(row=>row.text.startsWith('INSERT INTO workspace_transaction_events')).client);
 await batches.processQueuedJobs();assert.equal(f.read().events.length,1,'Repeating recovery cannot create another failure event or execute the stopped Build');assert.equal(builds,0);
});

test('a missing recovery event rolls back job and activity changes; a later sweep settles them together',async t=>{
 const f=fixture(t);f.controls.failEvent=true;await batches.processQueuedJobs();
 assert.equal(f.read().jobs[0].status,'running');assert.equal(f.read().activity.status,'running');assert.equal(f.read().events.length,0);assert.ok(f.sql.some(row=>row.text==='ROLLBACK'));
 f.controls.failEvent=false;await batches.processQueuedJobs();assert.equal(f.read().jobs[0].status,'failed');assert.equal(f.read().activity.status,'failed');assert.equal(f.read().events.length,1);
});

test('a renewal watchdog terminalizes the same running owner promptly outside its business transaction',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:Date.now()});
 const reached=deferred();const f=fixture(t,{expired:false,queued:true,onRenew:({controls})=>{assert.equal(controls.openTransactions,1);reached.resolve();return new Promise(()=>{});}});
 let builds=0;t.mock.method(builder,'buildAutomationBatch',async({execution_guard})=>{builds++;return obsDb.transaction(async()=>{await execution_guard.ensureOwnership();assert.fail('A late lease acknowledgement cannot resume the Build');})();});
 const work=batches.processQueuedJobs();await reached.promise;t.mock.timers.tick(10_000);await work;
 assert.equal(builds,1);assert.equal(f.read().jobs[0].status,'failed');assert.equal(f.read().activity.status,'failed');assert.equal(f.read().activity.metadata.error_code,'AUTOMATION_BUILD_LEASE_RENEWAL_TIMEOUT');assert.equal(f.read().events.length,1);assert.equal(f.controls.openTransactions,0);
 const failed=f.sql.findIndex(row=>row.text.startsWith('UPDATE batch_process_jobs SET status=\'failed\''));assert.ok(f.sql.slice(0,failed).some(row=>row.text==='ROLLBACK'),'The business transaction releases before independent terminal recovery');
});

test('watchdog recovery cannot overwrite a replacement owner or its activity',async t=>{
 const f=fixture(t,{expired:false,queued:true});
 t.mock.method(builder,'buildAutomationBatch',async()=>{f.read().jobs[0].lease_owner='replacement-worker';throw Object.assign(new Error('Lease renewal unavailable'),{code:'BATCH_JOB_LEASE_LOST',lease_code:'BATCH_JOB_LEASE_RENEWAL_TIMEOUT'});});
 await batches.processQueuedJobs();assert.equal(f.read().jobs[0].status,'running');assert.equal(f.read().jobs[0].lease_owner,'replacement-worker');assert.equal(f.read().activity.status,'running');assert.equal(f.read().events.length,0);
});

test('unavailable recovery storage is bounded and a late checkout cannot change a stopped attempt',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:Date.now()});
 const f=fixture(t),waiting=deferred(),reached=deferred(),connect=obsDb.pool.connect;
 t.mock.method(obsDb.pool,'connect',()=>{reached.resolve();return waiting.promise;});
 const work=batches.processQueuedJobs();await reached.promise;t.mock.timers.tick(3_000);await work;
 assert.equal(f.read().jobs[0].status,'running');assert.equal(f.read().activity.status,'running');assert.equal(f.read().events.length,0);
 waiting.resolve(await connect());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.read().jobs[0].status,'running');assert.equal(f.read().events.length,0);assert.equal(f.sql.filter(row=>row.text==='BEGIN').length,0,'The aborted recovery cannot start a late transaction');
});

test('the actual scheduled Build producer stops through the shared cancellation entry point and retains history without any browser work',async t=>{
 const f=fixture(t,{expired:false,queued:true});
 Object.assign(f.read().activity,{action:'batch_case_automation_build',status:'queued'});f.read().activity.metadata.agent_activity=true;
 const saved=clone(f.read().activity.metadata.sections);let builds=0;t.mock.method(builder,'buildAutomationBatch',async()=>{builds++;});
 const result=await generator.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'});
 assert.deepEqual(result,{transaction_id:'activity',status:'cancelled',cancelled:true});
 assert.equal(f.read().jobs[0].status,'completed');assert.equal(f.read().jobs[0].result.cancelled,true);
 assert.equal(f.read().jobs[0].lease_owner,null);assert.equal(f.read().jobs[0].lease_expires_at,null);assert.equal(f.read().jobs[0].next_run_at,null);
 assert.equal(f.read().activity.metadata.cancelled,true);assert.equal(f.read().activity.metadata.outcome_status,'cancelled');
 assert.deepEqual(f.read().activity.metadata.sections,saved);assert.equal(f.read().events[0].phase,'generator.cancelled');assert.equal(f.read().events[0].details.in_flight_action_outcome,'not_started');
 await batches.processQueuedJobs();assert.equal(builds,0);
 await generator.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'});
 assert.equal(f.read().events.length,1);assert.ok(f.sql.every(row=>!/DELETE FROM/.test(row.text)));
});

test('running batch cancellation aborts its active guard and rejects late saves/results without a retry or failure overwrite',async t=>{
 const f=fixture(t,{expired:false,queued:true}),entered=deferred(),release=deferred();let guard,saves=0;
 t.mock.method(builder,'buildAutomationBatch',async({execution_guard})=>{
  guard=execution_guard;entered.resolve();await release.promise;
  await execution_guard.ensureOwnership();saves++;return {generated:1};
 });
 const work=batches.processQueuedJobs();await entered.promise;
 await generator.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'});
 assert.equal(guard.signal.aborted,true);release.resolve();await work;
 assert.equal(saves,0);assert.equal(f.read().jobs[0].result.cancelled,true);assert.equal(f.read().jobs[0].status,'completed');
 assert.equal(f.read().activity.metadata.cancelled,true);assert.equal(f.read().events.length,1);
 assert.equal(f.read().events[0].phase,'generator.cancelled');
 assert.ok(!f.sql.some(row=>row.text.startsWith("UPDATE batch_process_jobs SET status = 'queued'")&&!row.text.includes("operation IS DISTINCT FROM 'automation_build'")));
});

test('batch cancellation remains project-scoped, rejects other operations and leaves terminal outcomes unchanged',async t=>{
 const f=fixture(t,{expired:false,queued:true});
 await assert.rejects(generator.cancelGeneratorJob({transactionId:'activity',projectId:'foreign',userId:'author'}),{statusCode:404});assert.equal(f.read().jobs[0].status,'queued');
 f.read().jobs[0].operation='test_case_export';
 await assert.rejects(generator.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'}),{statusCode:404});assert.equal(f.read().jobs[0].status,'queued');
 f.read().jobs[0].operation='automation_build';f.read().jobs[0].status='failed';
 assert.deepEqual(await generator.cancelGeneratorJob({transactionId:'activity',projectId:'project',userId:'author'}),{transaction_id:'activity',status:'failed',cancelled:false});
 assert.equal(f.read().activity.metadata.cancelled,undefined);assert.equal(f.read().events.length,0);
});
