const test=require('node:test'),assert=require('node:assert/strict');
const {createService,security}=require('../../backend/services/pairedLocalExecution.service');
const execution={id:'execution',project_id:'project',status:'queued',created_by:'owner'};
function fixture() {
  const rows=new Map(),runs=new Map([[execution.id,{...execution}]]),calls=[];
  let active=true,allowed=true,prepared=0;
  const store={transaction:fn=>(...args)=>fn(...args),prepare:sql=>({
    get:async(...values)=>{
      calls.push({sql,values});
      if(sql.includes('FROM users'))return active?{id:values[0],role:'member'}:undefined;
      if(sql.includes('FROM automation_paired_dispatches WHERE execution_id'))return [...rows.values()].find(row=>row.execution_id===values[0]);
      if(sql.includes('FROM automation_paired_dispatches WHERE id'))return rows.get(values[0]);
      if(sql.includes('FROM executions'))return runs.get(values[0]);
      throw Error('Unexpected read: '+sql);
    },run:async(...values)=>{
      calls.push({sql,values});
      if(sql.includes('INSERT INTO automation_paired_dispatches')){
        const keys=['id','execution_id','project_id','actor_id','agent_id','application_origin','request_hash','grant_nonce','envelope_cipher','claim_expires_at','callback_expires_at'];
        const row=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));row.state='pending';rows.set(row.id,row);
      }else if(sql.includes('UPDATE automation_paired_dispatches'))rows.get(values[0]).state='claimed';
      else if(sql.includes('UPDATE executions'))runs.get(values[0]).status='running';
      else throw Error('Unexpected write: '+sql);
      return {changes:1};
    }
  })};
  const service=createService({db:store,projects:{getProject:async(project,actor)=>{assert.equal(project,'project');assert.equal(actor,'owner');}},permissions:{hasPermission:async()=>allowed},
    flags:{getFeatureKeysForPermission:()=>['local'],areEnabled:async()=>allowed},dispatch:{preparePairedLocalDispatch:async input=>{
      prepared++;return {local_run_count:input.plan.eligibleCases.length,envelopes:input.plan.eligibleCases.map(item=>({engine_run_id:item.engine_run_id,
        hellotest_execution_id:execution.id,hellotest_test_case_id:item.case_snapshot.test_case_id,project:{id:'project'},
        run_parameters:{password:'PRIVATE_RUNTIME_VALUE'},callback:input.callbackFor(item)}))};
    }}});
  const input={execution:{...execution},user:{id:'owner'},agentId:'machine',applicationOrigin:'https://app.example.test',requestHash:security.digest('input'),
    plan:{eligibleCases:[{engine_run_id:'engine-1',case_snapshot:{test_case_id:'case-1'}},{engine_run_id:'engine-2',case_snapshot:{test_case_id:'case-2'}}]}};
  return {rows,runs,calls,service,input,prepared:()=>prepared,active:value=>{active=value;},allowed:value=>{allowed=value;}};
}
test('paired dispatch freezes an encrypted scoped plan and claims without contacting a server-side localhost runner',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Preparing or claiming local work never probes a runner.'));
  const f=fixture(),result=await f.service.prepare(f.input),row=[...f.rows.values()][0];
  assert.equal(result.id,execution.id);assert.equal(result.local_dispatch.execution_id,execution.id);
  assert.match(result.local_dispatch.claim_url,/https:\/\/app.example.test\/api\/executions\/execution\/local-dispatch\/claim$/);
  assert.ok(!JSON.stringify(row).includes('PRIVATE_RUNTIME_VALUE'));assert.ok(!JSON.stringify(result).includes('signing_secret'));
  const input={executionId:execution.id,grantToken:result.local_dispatch.grant_token,agentId:'machine'};
  const claimed=await f.service.claim(input);assert.equal(claimed.envelopes.length,2);assert.equal(claimed.envelopes[0].run_parameters.password,'PRIVATE_RUNTIME_VALUE');
  assert.notEqual(claimed.envelopes[0].callback.signing_secret,claimed.envelopes[1].callback.signing_secret);
  assert.deepEqual(await f.service.claim(input),claimed);assert.equal(f.prepared(),1);
});
test('lost acknowledgements reuse an immutable owner/machine-bound dispatch and reject changed selection inputs',async()=>{
  const f=fixture(),first=await f.service.prepare(f.input),again=await f.service.prepare(f.input);
  assert.deepEqual(again.local_dispatch,first.local_dispatch);assert.equal(f.prepared(),1);
  for(const patch of [{agentId:'other'},{applicationOrigin:'https://foreign.example.test'},{requestHash:security.digest('changed')}]){
    await assert.rejects(f.service.prepare({...f.input,...patch}),error=>error.statusCode===409);
  }
});
test('claim credentials cannot cross machines, executions, expiry, active-account or current permission boundaries',async()=>{
  const f=fixture(),receipt=(await f.service.prepare(f.input)).local_dispatch;
  const valid={executionId:execution.id,grantToken:receipt.grant_token,agentId:'machine'};
  for(const patch of [{grantToken:'f'.repeat(64)},{grantToken:'界'.repeat(64)},{agentId:'foreign'},{executionId:'other'}])await assert.rejects(f.service.claim({...valid,...patch}),error=>error.statusCode===401);
  f.active(false);await assert.rejects(f.service.claim(valid),{statusCode:403});f.active(true);
  f.allowed(false);await assert.rejects(f.service.claim(valid),{statusCode:403});f.allowed(true);
  [...f.rows.values()][0].claim_expires_at=new Date(Date.now()-1).toISOString();await assert.rejects(f.service.claim(valid),{code:'PAIRED_LOCAL_EXPIRED'});
});
test('server cancellation remains visible after browser closure and blocks late callback changes to the Run',async()=>{
  const f=fixture(),receipt=(await f.service.prepare(f.input)).local_dispatch,row=[...f.rows.values()][0];
  const grant={executionId:execution.id,grantToken:receipt.grant_token,agentId:'machine'};
  await f.service.claim(grant);assert.equal((await f.service.control(grant)).cancelled,false);
  const payload={engine_run_id:'engine-1',hellotest_test_case_id:'case-1'},transaction={created_by:'owner',metadata:{paired_dispatch_id:row.id,data_set_iteration_index:null}};
  const callback=await f.service.callbackSecretFor({execution:f.runs.get(execution.id),payload,transaction});assert.ok(callback);
  await assert.rejects(f.service.callbackSecretFor({execution:f.runs.get(execution.id),payload:{...payload,data_set_iteration:{index:1}},transaction}),{code:'PAIRED_LOCAL_SCOPE'});
  f.runs.get(execution.id).status='aborted';assert.equal((await f.service.control(grant)).cancelled,true);
  await assert.rejects(f.service.callbackSecretFor({execution:f.runs.get(execution.id),payload,transaction}),{code:'PAIRED_LOCAL_RUN_FINISHED'});
});
test('malformed or oversized local work never returns a successful prefix and saved ciphertext cannot change scope',async()=>{
  const f=fixture();
  await assert.rejects(f.service.prepare({...f.input,plan:{eligibleCases:[]}}),{code:'PAIRED_LOCAL_BUDGET'});assert.equal(f.prepared(),0);
  const receipt=(await f.service.prepare(f.input)).local_dispatch,row=[...f.rows.values()][0];row.envelope_cipher.tag='0'.repeat(32);
  await assert.rejects(f.service.claim({executionId:execution.id,grantToken:receipt.grant_token,agentId:'machine'}),{code:'PAIRED_LOCAL_CONFIGURATION'});
  const encrypted=security.seal({private:'value'},'scope-a');assert.throws(()=>security.open(encrypted,'scope-b'),{code:'PAIRED_LOCAL_CONFIGURATION'});
  assert.equal(security.equal('x','界'),false);
});
