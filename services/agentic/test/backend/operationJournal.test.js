const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
function fixture() {
  const rows = new Map(); let failSave = false;
  const db = { prepare(sql) { return { get:async(...args)=>{
    if(sql.startsWith('INSERT')) { if(rows.has(args[0])) return; rows.set(args[0],{id:args[0],request_hash:args[5],state:'in_flight'});return{id:args[0]}; }
    if(sql.startsWith('SELECT')) return rows.get(args[0]);
    if(sql.startsWith('DELETE')){if(failSave)throw Error('Delete acknowledgement unavailable');const row=rows.get(args[0]);if(row?.state==='in_flight'&&row.request_hash===args[1]){rows.delete(args[0]);return{id:args[0]};}return;}
    if(failSave) throw new Error('Database acknowledgement unavailable');
    const row = rows.get(args[1]); row.state='response_received';row.response=args[0];return{id:row.id};
  },run:async(code,id)=>{const row=rows.get(id);if(row.state==='in_flight'){row.state='outcome_unknown';row.error_code=code;}} }; } };
  const file=require.resolve('../../backend/workflows/operationJournal'),local=createRequire(file),module={exports:{}};
  new Function('require','module',fs.readFileSync(file,'utf8'))(id=>id==='@hellotest/platform/backend/src/db'?db:local(id),module);
  return { journal:module.exports,rows,failSave:()=>{failSave=true;},input:{run:{id:'run',project_id:'project'},node:{id:'write',data:{kind:'mcpTool',connectionId:'server',mcpTool:'create_issue'}},input:[{title:'Defect'}],user:{id:'actor'}} };
}
test('a tool receipt reuses a received response and rejects changed arguments',async()=>{
  const f=fixture();let calls=0;
  const dispatch=async()=>{calls++;return{data:{id:'external-id',text:'Preserve the actual business result'}};};
  const first=await f.journal.invoke(f.input,dispatch),second=await f.journal.invoke(f.input,dispatch);
  assert.equal(calls,1);assert.deepEqual(first.data,second.data);assert.equal(second.operation_receipt.reused,true);assert.equal(first.operation_receipt.postcondition_verified,false);
  await assert.rejects(f.journal.invoke({...f.input,input:[{title:'Different operation'}]},dispatch),{code:'AGENT_OPERATION_CONFLICT'});
  assert.equal(calls,1);
});
test('an ambiguous provider failure cannot be automatically sent a second time',async()=>{
  const f=fixture();let calls=0;
  const dispatch=async()=>{calls++;throw Object.assign(new Error('Connection lost after dispatch'),{statusCode:503});};
  await assert.rejects(f.journal.invoke(f.input,dispatch),error=>error.outcome_unknown&&error.retryable===false&&Boolean(error.operation_id));
  await assert.rejects(f.journal.invoke(f.input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);assert.equal([...f.rows.values()][0].state,'outcome_unknown');
});
test('receipt persistence failure preserves uncertainty instead of replaying a successful effect',async()=>{
  const f=fixture();f.failSave();let calls=0;
  const dispatch=async()=>{calls++;return{created:true};};
  await assert.rejects(f.journal.invoke(f.input,dispatch),error=>error.outcome_unknown===true);
  await assert.rejects(f.journal.invoke(f.input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);
});

test('proven pre-dispatch failures release only the matching reservation and preserve the original error',async()=>{
 const f=fixture();let dispatches=0;
 const error=Object.assign(new Error('Invalid approved input schema'),{code:'MCP_SCHEMA_CHANGED',statusCode:409,effect_dispatched:false});
 await assert.rejects(f.journal.invoke(f.input,async()=>{throw error;}),failure=>failure===error&&!failure.outcome_unknown&&Boolean(failure.operation_id));
 assert.equal(f.rows.size,0);
 const dispatch=async()=>{dispatches++;return{data:{id:'created'}};};
 await f.journal.invoke(f.input,dispatch);await f.journal.invoke(f.input,dispatch);
 assert.equal(dispatches,1);assert.equal(f.rows.size,1);
});

test('an uncertain dispatch or a missing reservation-release receipt never becomes permission to repeat an action',async()=>{
 for(const patch of [{outcome_unknown:true},{transactionOutcomeUnknown:true},{}]){
  const f=fixture();if(!Object.keys(patch).length)f.failSave();let calls=0;
  await assert.rejects(f.journal.invoke(f.input,async()=>{calls++;throw Object.assign(new Error('No safe acknowledgement'),{effect_dispatched:false,...patch});}),{outcome_unknown:true,retryable:false});
  await assert.rejects(f.journal.invoke(f.input,async()=>{calls++;return{};}),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);assert.equal([...f.rows.values()][0].state,'outcome_unknown');
 }
});

const automationInput=(f,{story='story-one',caseIndex=0}={})=>({
 ...f.input,
 run:{...f.input.run,iteration_path:['loop','item-1','automation',story,caseIndex]},
 node:{id:'engineer-node',data:{kind:'artifactTask',artifactTask:'automation-engineer',automationBrowserMode:'perform_steps'}},
 input:{story_id:story,case_index:caseIndex,draft:{title:'Create employee'}},
 maxResponseBytes:2*1024*1024
});

test('interactive automation reuses the complete large final artifact after a checkpoint acknowledgement is lost',async()=>{
 const f=fixture(),input=automationInput(f);let calls=0;
 const output={executable:{filename:'automation.spec.ts',code:'// Saved native source\n'+'x'.repeat(160*1024)},verification_status:'unverified'};
 const dispatch=async()=>{calls++;return output;};
 const first=await f.journal.invoke(input,dispatch),resumed=await f.journal.invoke(input,dispatch);
 assert.equal(calls,1);
 assert.equal(first.executable.code,output.executable.code);
 assert.deepEqual(resumed.executable,output.executable);
 assert.equal(resumed.operation_receipt.reused,true);
 assert.equal(resumed.operation_receipt.postcondition_verified,false);
 assert.equal([...f.rows.values()][0].state,'response_received');
});

test('automation case identity retains the actual node and separates Story, case and loop iterations',async()=>{
 const f=fixture();let calls=0;
 const base=automationInput(f),secondCase=automationInput(f,{caseIndex:1}),secondStory=automationInput(f,{story:'story-two'});
 const secondIteration={...base,run:{...base.run,iteration_path:['loop','item-2','automation','story-one',0]}};
 const identities=[];
 for(const input of [base,secondCase,secondStory,secondIteration]){
  assert.equal(input.node.id,'engineer-node');
  const result=await f.journal.invoke(input,async()=>({script:`artifact-${++calls}`}));
  identities.push(result.operation_receipt.id);
 }
 assert.equal(calls,4);assert.equal(new Set(identities).size,4);
 const reused=await f.journal.invoke(base,async()=>{throw Error('Must not redispatch');});
 assert.equal(reused.script,'artifact-1');
 await assert.rejects(f.journal.invoke({...base,input:{...base.input,draft:{title:'Different employee'}}},async()=>{calls++;return{};}),{code:'AGENT_OPERATION_CONFLICT'});
 assert.equal(calls,4);
});

test('interactive automation failure after a possible browser dispatch never releases or replays the case',async()=>{
 for(const problem of ['transport','invalid-source']){
  const f=fixture(),input=automationInput(f);let calls=0;
  const dispatch=async()=>{calls++;throw Object.assign(new Error('Browser action may have completed'),{code:problem==='transport'?'BROWSER_TRANSPORT_TIMEOUT':'AUTOMATION_UPSTREAM_SOURCE_INVALID'});};
  await assert.rejects(f.journal.invoke(input,dispatch),{outcome_unknown:true,retryable:false});
  await assert.rejects(f.journal.invoke(input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);assert.equal([...f.rows.values()][0].state,'outcome_unknown');
 }
});

test('oversized automation artifacts retain uncertainty and never cause a second browser dispatch',async()=>{
 const f=fixture(),input=automationInput(f);let calls=0;
 const dispatch=async()=>{calls++;return{executable:{code:'x'.repeat(2*1024*1024)}};};
 await assert.rejects(f.journal.invoke(input,dispatch),{code:'AGENT_OPERATION_RECEIPT_LIMIT',outcome_unknown:true});
 await assert.rejects(f.journal.invoke(input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
 assert.equal(calls,1);assert.equal([...f.rows.values()][0].state,'outcome_unknown');
});

test('ordinary operation receipts and Automation Engineer without an override retain the 128KiB limit',async()=>{
 for(const automation of [false,true]){
  const f=fixture(),input=automation?automationInput(f):f.input;delete input.maxResponseBytes;
  await assert.rejects(f.journal.invoke(input,async()=>({code:'x'.repeat(128*1024)})),{code:'AGENT_OPERATION_RECEIPT_LIMIT',outcome_unknown:true});
  assert.equal([...f.rows.values()][0].state,'outcome_unknown');
 }
});

test('invalid receipt overrides are rejected before reserving or dispatching any operation',async()=>{
 for(const target of ['ordinary','other-artifact',0,-1,1.5,NaN,Infinity,'2097152',2*1024*1024+1]){
  const f=fixture();let calls=0;const input=automationInput(f);
  if(target==='ordinary')input.node=f.input.node;
  else if(target==='other-artifact')input.node={...input.node,data:{...input.node.data,artifactTask:'test-case-generation'}};
  else input.maxResponseBytes=target;
  await assert.rejects(f.journal.invoke(input,async()=>{calls++;return{};}),{code:'AGENT_OPERATION_RECEIPT_LIMIT_INVALID',statusCode:422,effect_dispatched:false});
  assert.equal(calls,0);assert.equal(f.rows.size,0);
 }
});
