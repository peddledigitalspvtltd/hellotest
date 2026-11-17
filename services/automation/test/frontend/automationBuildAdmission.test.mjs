import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');async function moduleAt(path){const source=await readFile(new URL(path,import.meta.url),'utf8'),exports={};runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Error,Object,Date,Promise,Set,Map});return exports;}
const {admitAutomationBuild}=await moduleAt('../../frontend/workspaces/cases/admitAutomationBuild.ts');const {createAutomationAuthoringStore,caseAuthoringState}=await moduleAt('../../frontend/lib/automationAuthoringState.ts');
function fixture(){const store=createAutomationAuthoringStore({projectId:'p',appTypeId:'a',actorId:'u'});let count=0;const commands={beginBuild(caseIds,scheduledAt){const operationId='operation-'+(++count);store.dispatch({type:'build.requested',build:{operationId,caseIds,status:'submitting',scheduledAt,startedAt:Date.now()}});return operationId;},buildAccepted(operationId,activityId,status){store.dispatch({type:'build.accepted',operationId,activityId,status});},buildRejected(operationId,error){store.dispatch({type:'build.rejected',operationId,definite:error.statusCode===400,message:error.message});}};return{store,commands,state:id=>caseAuthoringState(store.snapshot(),id)};}
test('build admission reserves synchronously, prevents duplicate submission and records only observed queue receipt',async()=>{
 const f=fixture();let finish,calls=0;const pending=admitAutomationBuild(f.commands,['case'],undefined,()=>{calls++;return new Promise(resolve=>finish=resolve);});assert.equal(f.state('case').phase,'building');assert.equal(f.state('case').build.status,'submitting');
 await assert.rejects(admitAutomationBuild(f.commands,['case'],undefined,async()=>{calls++;return{transaction_id:'duplicate'};}),{code:'AUTOMATION_AUTHORING_BUSY'});assert.equal(calls,1);
 finish({transaction_id:'activity'});await pending;assert.equal(f.state('case').build.activityId,'activity');assert.equal(f.state('case').build.status,'queued');
});
test('recording conflicts block a build before its network request and preserve the recording origin',async()=>{
 const f=fixture();f.store.dispatch({type:'record.requested',recording:{operationId:'record',origin:{projectId:'p',appTypeId:'a',caseId:'case',targetStepId:null},options:{},parameterBindings:{},privateValues:[],session:null}});
 await assert.rejects(admitAutomationBuild(f.commands,['case'],undefined,async()=>assert.fail('No network request is allowed')),{code:'AUTOMATION_AUTHORING_BUSY'});assert.equal(f.state('case').phase,'record_starting');assert.equal(f.state('case').recording.origin.caseId,'case');
});
test('missing or uncertain queue receipt remains a conflict, while explicit rejection releases admission',async()=>{
 for(const error of [null,new Error('Network outcome unknown'),Object.assign(new Error('Invalid request'),{statusCode:400})]){
  const f=fixture();await assert.rejects(admitAutomationBuild(f.commands,['case'],undefined,async()=>{if(error)throw error;return{};}));assert.equal(f.state('case').phase,error?.statusCode===400?'idle':'conflict');
 }
});
