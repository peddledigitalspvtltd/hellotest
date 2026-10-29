const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../../agentic/backend/services/agenticWorkflowExecution.service');
const execution = require('../../../knowledge/backend/services/knowledgeExecution.service');
const user={id:'terminal-user'};
const node=(id,kind,data={})=>({id,type:'agenticStep',data:{label:id,kind,...data}});
const workflow=()=>({id:'terminal-workflow',project_id:'terminal-project',name:'Terminal persistence',status:'draft',trigger_kind:'manual',nodes:[node('request','trigger'),node('review','agent',{agentId:'quality-evaluator',prompt:'Review supplied evidence'}),node('finish','output')],edges:[{source:'request',target:'review'},{source:'review',target:'finish'}]});
function setup(t,{modelError,modelImpl,primaryFailure=false,recoveryFailure=false,cancelWins=false}={}) {
  const rows=new Map(),calls={model:0,primary:0,recovery:0,logs:[]};
  const available={primary:!primaryFailure,recovery:!recoveryFailure,readFailures:0,onReadFailure:null};
  t.mock.method(console,'error',message=>calls.logs.push(JSON.parse(message)));
  t.mock.method(require('../services/permission.service'),'hasPermission',async()=>true);
  t.mock.method(require('../services/featureFlag.service'),'areEnabled',async()=>true);
  t.mock.method(require('../../../agentic/backend/agents/agentRegistry.service'),'resolveModel',async()=>({id:'fixture',model:'fixture'}));
  t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'),'respond',async()=>{calls.model++;if(modelError)throw modelError;if(modelImpl)return modelImpl();return{transaction:{id:'review'},result:{response:'Review supplied evidence.',citation_ids:[],readiness:{status:'ready_for_review'}},provenance:{generation_mode:'llm'}};});
  const save=(id,status,nodes,output)=>{const previous=rows.get(id);if(previous?.status!=='running')return null;rows.set(id,structuredClone({...previous,status,node_results:nodes,output_payload:output}));return{id};};
  t.mock.method(runtime._internals.store,'get',async id=>{if(available.readFailures>0){available.readFailures--;available.onReadFailure?.();throw new Error('timeout exceeded when trying to connect');}return structuredClone(rows.get(id)||null);});
  t.mock.method(runtime._internals.store,'insert',async row=>{rows.set(row.id,structuredClone(row));return{id:row.id};});
  t.mock.method(runtime._internals.store,'save',async(id,status,nodes,output)=>{
    if(status!=='running') {
      calls.primary++;
      if(cancelWins)rows.set(id,{...rows.get(id),status:'cancelled',output_payload:{summary:'A person cancelled this run.'}});
      if(!available.primary)throw Object.assign(new Error('PRIVATE_DATABASE_ERROR'),{code:'57P01'});
    }
    return save(id,status,nodes,output);
  });
  t.mock.method(runtime._internals.store,'saveTerminal',async(id,status,nodes,output)=>{
    calls.recovery++;
    assert.equal(execution.current()?.signal?.aborted,false,'Terminal recovery must not inherit an aborted retrieval signal');
    if(!available.recovery)throw Object.assign(new Error('PRIVATE_RECOVERY_ERROR'),{code:'08006'});
    return save(id,status,nodes,output);
  });
  t.after(()=>{for(const id of rows.keys())runtime._internals.pendingTerminals.delete(id);});
  return{rows,calls,available};
}
async function run() {const started=await runtime.start(workflow(),{request_id:require('node:crypto').randomUUID()},user);await runtime._internals.active.get(started.id)?.promise;return runtime._internals.store.get(started.id);}

test('a failed completed-status write uses isolated recovery without replaying model work',async t=>{
  const {calls}=setup(t,{primaryFailure:true});
  const saved=await run();
  assert.equal(saved.status,'completed');assert.equal(calls.model,1);assert.equal(calls.primary,1);assert.equal(calls.recovery,1);
  assert.equal(runtime._internals.pendingTerminals.has(saved.id),false);
  assert.ok(calls.logs.some(entry=>entry.phase==='terminal_save'&&entry.code==='57P01'));
  assert.doesNotMatch(JSON.stringify(calls.logs),/PRIVATE_DATABASE_ERROR/);
});

test('a native-context failure cannot leave a running workflow when its first terminal save fails',async t=>{
  const failure=Object.assign(new Error('Private MCP detail'),{code:'MCP_CONTEXT_TIMEOUT',statusCode:504,publicMessage:'The evidence request exceeded its time budget.'});
  const {calls}=setup(t,{modelError:failure,primaryFailure:true});
  const saved=await run();
  assert.equal(saved.status,'failed');assert.equal(saved.node_results[1].status,'failed');assert.equal(saved.node_results[2].status,'skipped');
  assert.equal(saved.node_results[1].error_details.code,'MCP_CONTEXT_TIMEOUT');assert.equal(calls.model,1);assert.equal(calls.recovery,1);
  assert.equal(runtime._internals.active.has(saved.id),false);
});

test('an extended metadata outage retains its owned terminal snapshot and recovers on read without action replay',async t=>{
  const {calls,available}=setup(t,{modelError:Object.assign(new Error('Missing context'),{code:'MCP_CONTEXT_TIMEOUT',statusCode:504}),primaryFailure:true,recoveryFailure:true});
  const stranded=await run();
  assert.equal(stranded.status,'running');assert.equal(runtime._internals.active.has(stranded.id),false);
  assert.equal(runtime._internals.pendingTerminals.has(stranded.id),true);
  assert.ok(calls.logs.some(entry=>entry.phase==='detached_completion'&&entry.code==='WORKFLOW_TERMINAL_PERSISTENCE'));
  available.primary=true;available.recovery=true;
  const recovered=await runtime.reconcile(stranded);
  assert.equal(recovered.status,'failed');assert.equal(calls.model,1);assert.equal(runtime._internals.pendingTerminals.has(stranded.id),false);
});

test('terminal recovery preserves a winning cancellation and absence of an active entry does not imply ownership',async t=>{
  const {calls}=setup(t,{primaryFailure:true,cancelWins:true});
  const saved=await run();
  assert.equal(saved.status,'cancelled');assert.equal(saved.output_payload.summary,'A person cancelled this run.');assert.equal(calls.model,1);
  const foreign={id:'another-worker',status:'running',execution_mode:'review',workflow_snapshot:{runtime_contract:{orchestrator:'local',deadline_at:new Date(Date.now()+60000).toISOString()}}};
  assert.strictEqual(await runtime.reconcile(foreign),foreign);
  assert.equal(runtime._internals.pendingTerminals.has(foreign.id),false);
});

test('a transient heartbeat database failure never fabricates user cancellation or repeats the model call',async t=>{
  let resolveModel,readFailed;
  const modelResult=new Promise(resolve=>{resolveModel=resolve;});
  const observedReadFailure=new Promise(resolve=>{readFailed=resolve;});
  const {calls,available}=setup(t,{modelImpl:()=>modelResult});
  const started=await runtime.start(workflow(),{request_id:require('node:crypto').randomUUID()},user);
  available.readFailures=1;available.onReadFailure=readFailed;
  await observedReadFailure;
  assert.equal(runtime._internals.active.get(started.id).controller.signal.aborted,false);
  resolveModel({transaction:{id:'review'},result:{response:'Review supplied evidence.',citation_ids:[],readiness:{status:'ready_for_review'}},provenance:{generation_mode:'llm'}});
  await runtime._internals.active.get(started.id)?.promise;
  const completed=await runtime._internals.store.get(started.id);
  assert.equal(completed.status,'completed');assert.equal(calls.model,1);
  assert.ok(calls.logs.some(entry=>entry.phase==='heartbeat_read'&&entry.code==='WORKFLOW_DATABASE_CONNECT_TIMEOUT'));
  assert.ok(!calls.logs.some(entry=>entry.code==='REQUEST_CANCELLED'));
});
