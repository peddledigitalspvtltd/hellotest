import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const load = (file, deps, globals={}) => {
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('require','exports',...Object.keys(globals),source)(id=>deps[id]||{},exports,...Object.values(globals));return exports;
};
const storage=()=>{const items=new Map();return {getItem:key=>items.get(key)||null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key),items};};
function executionHarness({ready=true,parameterExpressions=true,failedAck=false}={}) {
 const apiCalls=[],agentCalls=[],sessionStorage=storage();let apiFailure=false,failAck=failedAck;
 const paired={probePairedLocalAgent:async()=>({publicBaseUrl:'http://127.0.0.1:4311',token:'private-pair-token',agentId:'device',localExecution:ready,parameterExpressions}),submitPairedLocalRun:async(agent,dispatch)=>{agentCalls.push({agent,dispatch});if(failAck){failAck=false;throw new Error('lost acknowledgment');}return {accepted:true};}};
 const client=load('../../frontend/lib/pairedLocalExecution.ts',{'@hellotest/agentic/frontend/lib/pairedLocalAgent':paired},{crypto:webcrypto,sessionStorage,window:{location:{origin:'https://app.hellotest.ai'}}});
 const request=async(path,input)=>{apiCalls.push({path,input});if(apiFailure){apiFailure=false;throw new Error('API response lost');}return {id:'run',started:true,local_dispatch:{protocol_version:1,execution_id:'run',claim_url:'https://app.hellotest.ai/api/executions/run/local-dispatch/claim',grant_token:'scoped',expires_at:new Date(Date.now()+600000).toISOString()}};};
 return {...client,apiCalls,agentCalls,sessionStorage,request,loseApiAck(){apiFailure=true;}};
}
const input={project_id:'project',app_type_id:'app',suite_ids:['suite'],created_by:'user'};
test('case/suite selection uses the paired machine without exposing its pairing token to the API',async()=>{
 const h=executionHarness();await h.startPairedLocalExecution('/executions/local-run',input,h.request);
 assert.equal(h.apiCalls.length,1);assert.deepEqual(h.apiCalls[0].input.suite_ids,['suite']);assert.equal(h.apiCalls[0].input.local_transport,'paired-agent');assert.equal(h.apiCalls[0].input.local_agent_id,'device');assert.equal(h.apiCalls[0].input.paired_origin,'https://app.hellotest.ai');assert.doesNotMatch(JSON.stringify(h.apiCalls),/private-pair-token/);assert.equal(h.agentCalls[0].dispatch.execution_id,'run');
});
test('lost agent acknowledgment reconnects the saved receipt without creating another run',async()=>{
 const h=executionHarness({failedAck:true});await assert.rejects(h.startPairedLocalExecution('/executions/local-run',input,h.request),/lost acknowledgment/);
 await h.startPairedLocalExecution('/executions/local-run',input,h.request);assert.equal(h.apiCalls.length,1);assert.equal(h.agentCalls.length,2);assert.deepEqual(h.agentCalls[0].dispatch,h.agentCalls[1].dispatch);
});
test('an already accepted receipt reconnects after its initial API claim deadline',async()=>{
 const h=executionHarness({failedAck:true});
 await assert.rejects(h.startPairedLocalExecution('/executions/local-run',input,h.request),/lost acknowledgment/);
 h.agentCalls[0].dispatch.expires_at=new Date(Date.now()-1000).toISOString();
 await h.startPairedLocalExecution('/executions/local-run',input,h.request);
 assert.equal(h.apiCalls.length,1);assert.equal(h.agentCalls.length,2);
 assert.equal(h.agentCalls[1].dispatch.grant_token,h.agentCalls[0].dispatch.grant_token);
});
test('lost API acknowledgment reuses the original idempotency request and concurrent clicks share a dispatch',async()=>{
 const h=executionHarness();h.loseApiAck();await assert.rejects(h.startPairedLocalExecution('/executions/local-run',input,h.request),/API response lost/);
 await Promise.all([h.startPairedLocalExecution('/executions/local-run',input,h.request),h.startPairedLocalExecution('/executions/local-run',input,h.request)]);assert.equal(h.apiCalls.length,2);assert.equal(h.apiCalls[0].input.request_id,h.apiCalls[1].input.request_id);assert.equal(h.agentCalls.length,1);
});
test('an explicitly finished creation request releases an old failed intent for the next user retry',async()=>{
 const h=executionHarness(),requests=[];let reject=true;
 const request=async(path,payload)=>{requests.push(payload);if(reject){reject=false;throw Object.assign(new Error('This Run has finished.'),{code:'PAIRED_LOCAL_RUN_FINISHED'});}return h.request(path,payload);};
 await assert.rejects(h.startPairedLocalExecution('/executions/local-run',input,request),{code:'PAIRED_LOCAL_RUN_FINISHED'});
 assert.equal(h.agentCalls.length,0);assert.equal(h.sessionStorage.items.size,0);
 await h.startPairedLocalExecution('/executions/local-run',input,request);
 assert.notEqual(requests[0].request_id,requests[1].request_id);assert.equal(h.agentCalls.length,1);
});
test('inspection-only agents fail before an execution is created and existing starts use the dispatch endpoint',async()=>{
 const old=executionHarness({ready:false});await assert.rejects(old.startPairedLocalExecution('/executions/local-run',input,old.request),/older inspection agent/);assert.equal(old.apiCalls.length,0);
 const h=executionHarness();await h.startPairedLocalExecution('/executions/run/local-dispatch',{execution_mode:'local'},h.request);assert.equal(h.apiCalls[0].path,'/executions/run/local-dispatch');
});
test('an older paired execution agent fails before creating or starting a Run until it advertises native parameter support',async()=>{
 for(const path of ['/executions/local-run','/executions/existing/local-dispatch']){
  const old=executionHarness({parameterExpressions:false});
  await assert.rejects(old.startPairedLocalExecution(path,input,old.request),/Update the paired agent.*native parameter expressions/);
  assert.equal(old.apiCalls.length,0);assert.equal(old.agentCalls.length,0);assert.equal(old.sessionStorage.items.size,0);
 }
});
test('the actual browser transport sends only the scoped grant to localhost and rejects foreign claim addresses',async()=>{
 const requests=[],store=storage();store.setItem('hellotest.repository-inspection.agent-token.v1','a'.repeat(64));
 const paired=load('../../../agentic/frontend/lib/pairedLocalAgent.ts',{}, {crypto:webcrypto,localStorage:store,window:{location:{origin:'https://app.hellotest.ai'}},fetch:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.endsWith('/status')?{ready:true,service:'hellotest-inspection-agent',protocol_version:1,agent_id:'device',capabilities:{local_execution:true},execution_protocol_version:1}:{accepted:true,execution_id:'run'}));}});
 const agent=await paired.probePairedLocalAgent();assert.equal(agent.localExecution,true);assert.equal(agent.parameterExpressions,false);
 const dispatch={protocol_version:1,execution_id:'run',claim_url:'https://app.hellotest.ai/api/executions/run/local-dispatch/claim',grant_token:'scoped',expires_at:'later'};
 await paired.submitPairedLocalRun(agent,dispatch);assert.equal(requests[1].url,'http://127.0.0.1:4311/api/v1/local-executions');assert.equal(requests[1].options.headers['X-HelloTest-Agent-Token'],'a'.repeat(64));assert.deepEqual(JSON.parse(requests[1].options.body),{claim_url:dispatch.claim_url,grant_token:'scoped',execution_id:'run'});
 await assert.rejects(paired.submitPairedLocalRun(agent,{...dispatch,claim_url:'https://attacker.test/api/executions/run/local-dispatch/claim'}),/does not belong/);assert.equal(requests.length,2);
});
test('the pairing health reader requires the exact advertised expression capability without changing its stored pairing',async()=>{
 const store=storage();store.setItem('hellotest.repository-inspection.agent-token.v1','a'.repeat(64));let advertised;
 const paired=load('../../../agentic/frontend/lib/pairedLocalAgent.ts',{}, {crypto:webcrypto,localStorage:store,fetch:async()=>new Response(JSON.stringify({ready:true,service:'hellotest-inspection-agent',protocol_version:1,agent_id:'device',execution_protocol_version:1,capabilities:{local_execution:true,parameter_expressions_v1:advertised}}))});
 for(const [capability,expected] of [[undefined,false],['true',false],[false,false],[true,true]]){
  advertised=capability;const status=await paired.probePairedLocalAgent();assert.equal(status.parameterExpressions,expected);assert.equal(status.localExecution,true);
  assert.equal(store.getItem('hellotest.repository-inspection.agent-token.v1'),'a'.repeat(64));
 }
});
test('local Engineer preflight binds scoped bridge while remote and scheduled choices behave explicitly',async()=>{
 const api=[],local=[];const mod=load('../../frontend/lib/pairedBrowserBuild.ts',{'@hellotest/agentic/frontend/lib/pairedLocalAgent':{probePairedLocalAgent:async()=>({agentId:'device',localExecution:true,publicBaseUrl:'http://127.0.0.1:4311',token:'pair'})}},{window:{location:{origin:'https://app.hellotest.ai'}},fetch:async(url,options)=>{local.push({url,options});return new Response(JSON.stringify({accepted:true,bridge_id:'bridge'}));}});
 const request=async(path,input)=>{api.push({path,input});return {id:'bridge',token:'grant',poll_url:'poll',result_url:'result',expires_at:'later'};};
 assert.deepEqual(await mod.preparePairedBrowserBuild({browser_location:'remote',test_case_ids:['case']},request),{test_case_ids:['case']});assert.equal(api.length,0);
 assert.deepEqual(await mod.preparePairedBrowserBuild({browser_location:'local',test_case_ids:['case']},request),{test_case_ids:['case'],paired_browser_bridge_id:'bridge'});assert.equal(api[0].input.local_agent_id,'device');assert.equal(local[0].url,'http://127.0.0.1:4311/api/v1/local-browser-bridges');
 await assert.rejects(mod.preparePairedBrowserBuild({browser_location:'local',scheduled_at:'future',test_case_ids:['case']},request),/must start now/);
});
test('paired recording stops and caches complete capture before import; a failed save retains it for retry',async()=>{
 const calls=[];const session={id:'session',status:'running',purpose:'automation-recording',live_view_path:'/live'};
 const mod=load('../../frontend/lib/pairedRecorder.ts',{'@hellotest/agentic/frontend/lib/pairedLocalAgent':{probePairedLocalAgent:async()=>({publicBaseUrl:'http://127.0.0.1:4311',token:'pair'})}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/stop')?{...session,status:'stopped',actions:[{index:1,type:'click',locator:'#button'}]}:session));}});
 const result=await mod.startPairedRecording(async()=>({id:'prepare',transaction_id:'transaction',paired_recording_id:'prepare',paired_session_payload:{start_url:'https://private.test',purpose:'automation-recording'}}));assert.equal(result.inspector_agent_token,'pair');assert.equal(result.transaction_id,'transaction');
 let first=true;const save=async capture=>{assert.equal(capture.paired_recording_id,'prepare');assert.equal(capture.captured_session.status,'stopped');if(first){first=false;throw new Error('save unavailable');}return {saved:true};};
 await assert.rejects(mod.finishPairedRecording('session',save),/save unavailable/);assert.deepEqual(await mod.finishPairedRecording('session',save),{saved:true});assert.equal(calls.filter(call=>call.url.endsWith('/stop')).length,1);assert.equal(mod.isPairedRecording('session'),false);
});
