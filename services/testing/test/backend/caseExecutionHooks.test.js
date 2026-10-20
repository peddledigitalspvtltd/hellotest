const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({scoped=true}={}) {
  const calls=[],module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/services/caseExecutionHooks.service'),'utf8'),{module,require:name=>{
    if(name.endsWith('/db'))return {prepare:sql=>({get:async(...args)=>{calls.push({sql,args});return scoped?{id:args[0]}:null;}})};
    if(name.endsWith('executionHookSnapshots.service'))return {snapshotExecutionHooks:async(hooks,context)=>{calls.push({hooks,context});return hooks.map(hook=>({...hook,steps:[{automation_code:'saved code'}]}));}};
    throw Error(name);
  }});
  return {...module.exports,calls};
}
const hook={id:'before',scope:'test',phase:'pre',target_kind:'test',target_id:'source',name:'Before Test: Login'};
const context={projectId:'project',appTypeId:'web',userId:'actor'};

test('case hook references exclude client code, retain phase order and cannot select the owner',async()=>{
  const f=fixture(),input=[{...hook,steps:[{automation_code:'untrusted'}]}, {...hook,id:'after',phase:'post'}];
  const result=await f.validateCaseExecutionHooks(input,{...context,caseId:'owner'});
  assert.equal(result.length,2);assert.equal(result[0].steps,undefined);assert.equal(result[0].fail_behavior,'fail-run');assert.equal(result[1].fail_behavior,'continue');
  assert.deepEqual(f.calls.map(call=>Array.from(call.args)),[['source','project','web'],['source','project','web']]);
  await assert.rejects(f.validateCaseExecutionHooks([{...hook,target_id:'owner'}],{...context,caseId:'owner'}),{code:'AUTOMATION_CASE_HOOK_CYCLE'});
  await assert.rejects(fixture({scoped:false}).validateCaseExecutionHooks([hook],context),/project and application/);
});

test('case hook invalid, duplicate and unsupported selections fail without silently discarding sources',()=>{
  const f=fixture();
  for(const value of [{},'not-json',[null],[{...hook,scope:'run'}],[{...hook,target_kind:'inline'}],[{...hook,target_id:' '}],[hook,hook],[hook,{...hook,id:'other'}],[{...hook,fail_behavior:'ignore'}]])assert.throws(()=>f.normalizeCaseExecutionHooks(value),{code:'AUTOMATION_CASE_HOOK_INVALID'});
});

test('frozen case hook namespaces prevent collisions with run hooks and preserve initiating access context',async()=>{
  const f=fixture();
  const [result]=await f.snapshotCaseExecutionHooks('owner',[hook],context);
  assert.equal(result.id,'case:owner:before');assert.equal(result.owner_test_case_id,'owner');assert.equal(result.steps[0].automation_code,'saved code');
  assert.deepEqual({...f.calls[0].context},{...context,ownerCaseId:'owner'});
  assert.equal((await f.snapshotCaseExecutionHooks('other',[],context)).length,0);assert.equal(f.calls.length,1);
});
