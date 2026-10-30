const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {Client}=require('../../../platform/backend/node_modules/pg');
const connectionString=process.env.TRACE_MODEL_SCOPE_TEST_DATABASE_URL;
test('PostgreSQL isolates exact and legacy model-call generation scopes, bodies and cursor pages',{skip:!connectionString,timeout:30000},async()=>{
 const url=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/agent_verify_trace[A-Za-z0-9_]*$/);
 const client=new Client({connectionString,connectionTimeoutMillis:5000,query_timeout:5000});await client.connect();
 const schema='agent_verify_trace_'+randomUUID().replaceAll('-','');
 try{
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE llm_request_traces(id text PRIMARY KEY,project_id text,actor_id text,request_id text,trace_id text,run_id text,node_id text,session_id text,operation text,feature text,integration_id text,integration_name text,provider_origin text,requested_model text,effective_model text,status text,attempt integer,correction_of text,started_at timestamptz DEFAULT now(),completed_at timestamptz,duration_ms integer,http_status integer,provider_request_id text,usage jsonb,capture jsonb DEFAULT '{}'::jsonb,error_code text,expires_at timestamptz DEFAULT now()+interval '14 days',request_payload jsonb,response_payload jsonb,request_hash text)`);
  await client.query('CREATE TABLE workspace_transactions(id text PRIMARY KEY,project_id text,category text)');await client.query('CREATE TABLE workspace_transaction_events(id text PRIMARY KEY,transaction_id text,phase text,details jsonb)');
  await client.query("INSERT INTO workspace_transactions VALUES('activity','project','automation_build'),('foreign-activity','foreign','automation_build')");
  const trace=async(id,{project='project',session='activity',capture={}}={})=>client.query("INSERT INTO llm_request_traces(id,project_id,session_id,operation,status,capture,request_payload,response_payload) VALUES($1,$2,$3,'automation.build','succeeded',$4,$5,$6)",[id,project,session,capture,{messages:[{content:'Retained redacted request'}]},{choices:[{message:{content:'Retained response'}}]}]);
  const event=async(id,caseId,attempt,session='activity')=>client.query("INSERT INTO workspace_transaction_events VALUES($1,$2,'model.call',$3)",['event-'+id,session,{call_id:id,test_case_id:caseId,completion_attempt:attempt}]);
  await trace('new-a',{capture:{test_case_id:'case-a',completion_attempt:1}});await trace('new-b',{capture:{test_case_id:'case-b',completion_attempt:1}});await trace('attempt-two',{capture:{test_case_id:'case-a',completion_attempt:2}});
  await trace('legacy-a');await event('legacy-a','case-a',1);await trace('legacy-b');await event('legacy-b','case-b',1);await trace('unscoped');
  await trace('capture-wins',{capture:{test_case_id:'case-b',completion_attempt:1}});await event('capture-wins','case-a',1);
  await trace('foreign',{project:'foreign',capture:{test_case_id:'case-a',completion_attempt:1}});
  await trace('foreign-event',{session:'foreign-activity'});await event('foreign-event','case-a',1,'foreign-activity');
  const module={exports:{}};new Function('require','module',fs.readFileSync(require.resolve('../../backend/services/llmTraceQuery.service'),'utf8'))(()=>({pool:{query:query=>client.query(query)}}),module);
  const service=module.exports,input={session_id:'activity',test_case_id:'case-a',completion_attempt:1,since:new Date(Date.now()-3600000).toISOString()};
  assert.deepEqual((await service.list('project',input)).items.map(row=>row.id).sort(),['legacy-a','new-a']);
  assert.deepEqual((await service.list('project',{...input,trace_ids:JSON.stringify(['new-a','new-b'])})).items.map(row=>row.id),['new-a']);
  assert.deepEqual((await service.list('project',{...input,completion_attempt:2})).items.map(row=>row.id),['attempt-two']);
  assert.equal((await service.list('project',{...input,session_id:'foreign-activity'})).items.length,0,'legacy correlation cannot cross the transaction project');
  assert.equal((await service.detail('project','new-a')).request_payload,undefined);assert.ok((await service.detail('project','new-a',{includeContent:true})).request_payload.messages);await assert.rejects(service.detail('project','foreign',{includeContent:true}),error=>error.statusCode===404);
  for(let index=0;index<55;index++)await trace('page-'+String(index).padStart(2,'0'),{capture:{test_case_id:'case-a',completion_attempt:3}});
  const first=await service.list('project',{...input,completion_attempt:3});assert.equal(first.items.length,50);assert.equal(first.summary.calls,55);assert.ok(first.next_cursor);
  const second=await service.list('project',{...input,completion_attempt:3,cursor:first.next_cursor});assert.equal(second.items.length,5);assert.equal(second.next_cursor,null);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,55);
  const workflowStart=Date.now()-120000;
  for(let index=0;index<56;index++){
   const id='workflow-'+String(index).padStart(2,'0');await trace(id);
   await client.query("UPDATE llm_request_traces SET run_id='workflow-run',node_id='generation-node',started_at=$2 WHERE id=$1",[id,new Date(workflowStart+index*1000)]);
  }
  for(const [id,run,node,project] of [['wrong-node','workflow-run','different-node','project'],['wrong-run','different-run','generation-node','project'],['wrong-project','workflow-run','generation-node','foreign']]){
   await trace(id,{project});await client.query('UPDATE llm_request_traces SET run_id=$2,node_id=$3 WHERE id=$1',[id,run,node]);
  }
  const workflowFilter={run_id:'workflow-run',node_id:'generation-node',since:new Date(workflowStart-1000).toISOString()};
  const chronological=await service.list('project',workflowFilter,{chronological:true});
  assert.deepEqual(chronological.items.map(row=>row.id),Array.from({length:50},(_,index)=>'workflow-'+String(index).padStart(2,'0')));
  assert.equal(chronological.summary.calls,56);
  const remaining=await service.list('project',{...workflowFilter,cursor:chronological.next_cursor},{chronological:true});
  assert.deepEqual(remaining.items.map(row=>row.id),Array.from({length:6},(_,index)=>'workflow-'+String(index+50).padStart(2,'0')));
  const scopedDetail={includeContent:true,runId:'workflow-run',nodeId:'generation-node'};
  assert.ok((await service.detail('project','workflow-00',scopedDetail)).response_payload.choices);
  for(const id of ['wrong-node','wrong-run','wrong-project'])await assert.rejects(service.detail('project',id,scopedDetail),error=>error.statusCode===404);
  await client.query("UPDATE llm_request_traces SET expires_at=now()-interval '1 second' WHERE id='workflow-00'");
  await assert.rejects(service.detail('project','workflow-00',scopedDetail),error=>error.statusCode===404);
  assert.equal((await service.list('project',workflowFilter,{chronological:true})).summary.calls,55);
 }finally{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
