const test=require('node:test'),assert=require('node:assert/strict');
const {recordNativeSnapshotRecoveryObservation:record,createAutomationSnapshotTargetRecovery:create}=require('../../backend/lib/automationSnapshotTargetRecovery');
let sequence=0;
function snapshot(extra={}){const row={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:`snapshot-${++sequence}`,url:'https://app.example/employees',scope:'body',accessibility:'- heading "Employees"',elements:[],partial:true,...extra})}]}};record(row);return row;}
function transition(){const row={tool:'browser_click',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed',url:'https://app.example/employees'})}]}};record(row);return row;}
const grounded=()=>snapshot({partial:false,elements:[{tag:'a',locators_validated:true,locator_candidates:['#addEmployeeButton']}]});
test('real AX-only snapshot gets exactly one fresh grounded read without dispatching an action',async()=>{
 const recovery=create(),old=snapshot(),actions=[transition(),old];let reads=0,guards=0;
 assert.equal(await recovery.recover({snapshot:old,observations:actions,capture:async frame=>{reads++;assert.deepEqual(frame,[]);return grounded();},assertActive:()=>guards++,beforeRead:()=>{assert.equal(reads,0);}}),true);
 assert.equal(reads,1);assert.equal(guards,2);
 await assert.rejects(recovery.recover({snapshot:old,observations:actions,capture:async()=>{reads++;return grounded();}}),{code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'});
 assert.equal(reads,1);
});
test('another partial receipt in the same transition stops without a read/model loop',async()=>{
 const recovery=create(),action=transition(),old=snapshot();let reads=0,fresh;
 await assert.rejects(recovery.recover({snapshot:old,observations:[action,old],capture:async()=>{reads++;return fresh=snapshot();}}),{code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'});
 await assert.rejects(recovery.recover({snapshot:fresh,observations:[action,old,fresh],capture:async()=>{reads++;return grounded();}}),{code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'});
 assert.equal(reads,1);
});
test('only a genuine completed transition opens a new once-only read allowance',async()=>{
 const recovery=create(),old=snapshot(),action=transition();let reads=0;
 const run=(snapshot,observations)=>recovery.recover({snapshot,observations,capture:async()=>{reads++;return grounded();}});
 assert.equal(await run(old,[action,old]),true);
 const copiedAction=JSON.parse(JSON.stringify(action)),another=snapshot();
 await assert.rejects(run(another,[action,copiedAction,another]),{code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'});
 assert.equal(await run(another,[action,transition(),another]),true);assert.equal(reads,2);
});
test('JSON copies, model feedback, mutated native receipts and failed reads grant no recovery authority',async()=>{
 const recovery=create(),real=snapshot();let reads=0;
 for(const candidate of [JSON.parse(JSON.stringify(real)),{...snapshot(),mcp_call:false},{...snapshot(),result:{isError:true,content:[]}}])assert.equal(await recovery.recover({snapshot:candidate,capture:async()=>{reads++;return grounded();}}),false);
 real.result.content[0].text=real.result.content[0].text.replace('Employees','Changed');
 assert.equal(await recovery.recover({snapshot:real,capture:async()=>{reads++;return grounded();}}),false);assert.equal(reads,0);
});
test('ordinary complete or partially grounded snapshots never consume a recovery call',async()=>{
 let reads=0;for(const old of [snapshot({partial:false}),grounded(),snapshot({elements:[{tag:'button',locators_validated:true,locator_candidates:['#ready']}]})])assert.equal(await create().recover({snapshot:old,capture:async()=>{reads++;}}),false);assert.equal(reads,0);
});
test('tool budget, cancellation and original section deadline stop before any read',async()=>{
 for(const failure of [Object.assign(new Error(),{code:'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'}),Object.assign(new Error(),{name:'AbortError'}),Object.assign(new Error(),{code:'AUTOMATION_BUILD_DEADLINE'})]){
  let reads=0;await assert.rejects(create().recover({snapshot:snapshot(),capture:async()=>{reads++;return grounded();},beforeRead:()=>{throw failure;}}),error=>error===failure);assert.equal(reads,0);
 }
});
test('late cancellation after the read preserves cancellation and never advertises fresh authority',async()=>{
 const stopped=Object.assign(new Error(),{name:'AbortError'});let checks=0,reads=0;
 await assert.rejects(create().recover({snapshot:snapshot(),capture:async()=>{reads++;return grounded();},assertActive:()=>{if(++checks===2)throw stopped;}}),error=>error===stopped);assert.equal(reads,1);
});
test('frame scope is preserved and foreign/mismatched/old evidence fails closed',async()=>{
 const framed={frame_path:['#employee-app'],frame_url:'https://app.example/child',frame_document_id:'child-1'};
 const old=snapshot(framed);let calls=0;
 assert.equal(await create().recover({snapshot:old,capture:async frame=>{calls++;assert.deepEqual(frame,['#employee-app']);return snapshot({...framed,partial:false,elements:[{tag:'button'}]});}}),true);
 for(const result of [()=>old,()=>grounded(),()=>snapshot({partial:false,url:'https://foreign.example/employees'})])await assert.rejects(create().recover({snapshot:old,capture:async()=>result()}),{code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'});
 assert.equal(calls,1);
});
