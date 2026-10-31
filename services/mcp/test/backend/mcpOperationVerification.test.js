const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createVerification}=require('../../backend/operationVerification');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code});
const actor={projectId:'project',user:{id:'user'}};
function fixture({collection=false,memberships=false}={}){
 let record={id:'record',revision:2,name:'Before',variables:[{name:'private',value:'never-deliver'}]},ids=['case-a'];
 const read={id:'read',method:'GET',path:collection?'/agents':'/records/:id',read:true,path_parameters:collection?[]:['id']};
 const op={id:'edit',method:'PUT',path:collection?'/agents/:id':'/records/:id',policy:{effect:'update',scope:{path_parameter:'id'},verification:{path:read.path,targetParameter:'id',...(collection?{collection:true}:{}),...(memberships?{memberships:[{bodyField:'case_ids',storage:'members',mode:'equals'}]}:{})}}};
 const invoke=async()=>{if(!record)throw fail('Missing',404,'MISSING');return collection?[record]:record;};
 const registry={all:()=>[read,op],get:id=>[read,op].find(item=>item.id===id)};
 const helper=createVerification({registry,invoke,fail,digest,readMembership:async()=>ids,bound:value=>({id:value.id,name:value.name})});
 return {helper,op,get record(){return record;},setRecord:value=>{record=value;},setIds:value=>{ids=value;}};
}

test('a reviewed target revision is checked before a mutation and changed values never count as verified',async()=>{
 const f=fixture(),args={path:{id:'record'},body:{name:'After'}};
 const pinned=await f.helper.capture(actor,f.op,args);
 f.setRecord({...f.record,revision:3});
 await assert.rejects(f.helper.check(actor,pinned),{code:'MCP_STALE_PLAN'});
 f.setRecord({...f.record,revision:2});
 await f.helper.check(actor,pinned);
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:args},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setRecord({...f.record,name:'After'});
 const result=await f.helper.verify(actor,f.op,{arguments:args},{id:'record'});
 assert.equal(result.state,'succeeded_verified');assert.deepEqual(result.verification.compared_fields,['name']);
 assert.doesNotMatch(JSON.stringify(result),/never-deliver|variables/,'Raw verification values are never the delivery payload.');
});

test('membership changes invalidate a reviewed plan even when the parent revision stays unchanged',async()=>{
 const f=fixture({memberships:true}),args={path:{id:'record'},body:{case_ids:['case-a','case-b']}};
 const pinned=await f.helper.capture(actor,f.op,args);
 f.setIds(['case-a','case-c']);
 await assert.rejects(f.helper.check(actor,pinned),{code:'MCP_STALE_PLAN'});
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:args},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setIds(['case-b','case-a']);
 assert.equal((await f.helper.verify(actor,f.op,{arguments:args},{id:'record'})).state,'succeeded_verified');
});

test('ordinary updates do not require omitted optional membership fields',async()=>{
 const f=fixture({memberships:true});f.setRecord({...f.record,name:'After'});
 assert.equal((await f.helper.verify(actor,f.op,{arguments:{path:{id:'record'},body:{name:'After'}}},{id:'record'})).state,'succeeded_verified');
});

test('collection read-backs select the exact saved agent and enforce requested activation',async()=>{
 const f=fixture({collection:true});
 f.op.policy.verification.activation={bodyField:'activate',versionPath:'current_version',activeVersionPath:'active_version'};
 f.setRecord({...f.record,current_version:4,active_version:3});
 const args={path:{id:'record'},body:{activate:true,name:'Before'}};
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:args},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setRecord({...f.record,active_version:4});
 assert.equal((await f.helper.verify(actor,f.op,{arguments:args},{id:'record'})).domain_id,'record');
 const pinned=await f.helper.capture(actor,f.op,args);await f.helper.check(actor,pinned);
});

test('creating a collection-backed record does not require an existing target',async()=>{
 const f=fixture({collection:true});
 f.op.method='POST';f.op.path='/agents';f.op.policy.effect='create';f.op.policy.scope={project:true};
 assert.equal(await f.helper.capture(actor,f.op,{body:{name:'Before'}}),null);
 assert.equal((await f.helper.verify(actor,f.op,{arguments:{body:{name:'Before'}}},{id:'record'})).state,'succeeded_verified');
});

test('proposal generation is explicitly unsaved and async acceptance is not a completed result',async()=>{
 const f=fixture();
 const proposal={...f.op,policy:{effect:'generate',verification:{response:'proposal'}}};
 const result=await f.helper.verify(actor,proposal,{arguments:{body:{}}},{cases:[]});
 assert.equal(result.state,'succeeded_proposal');assert.equal(result.verification.persisted,false);assert.equal(result.verification.approved,false);
 f.op.policy.verification.async=true;
 const command=await f.helper.verify(actor,f.op,{arguments:{body:{input_payload:{goal:'Does not belong on a run record'}}}},{id:'record'});
 assert.equal(command.state,'submitted');assert.equal(command.verification.kind,'durable_command_accepted');
});

test('deletion is verified by absence, not by a success acknowledgement',async()=>{
 const f=fixture();f.op.policy.effect='delete';f.op.policy.verification.deleteAbsence=true;
 const row={arguments:{path:{id:'record'},body:{}}};
 await assert.rejects(f.helper.verify(actor,f.op,row,{deleted:true}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setRecord(null);
 const result=await f.helper.verify(actor,f.op,row,{deleted:true});
 assert.equal(result.state,'succeeded_verified');assert.equal(result.verification.kind,'record_absence');
});

test('unsupported and empty changes are rejected before a plan can claim a native effect',()=>{
 const f=fixture();f.op.policy.verification.matchFields=['name'];
 assert.throws(()=>f.helper.validateArguments(f.op,{body:{ignored_by_native:'value'}}),{code:'MCP_UNSUPPORTED_EFFECT'});
 assert.throws(()=>f.helper.validateArguments(f.op,{body:{project_id:'project'}}),{code:'MCP_INVALID_ARGUMENT'});
 f.helper.validateArguments(f.op,{body:{name:'After'}});
});

test('scalar relationships and normalized lifecycle states require actual read-back evidence',async()=>{
 const f=fixture({memberships:true});f.op.policy.verification.memberships=[{bodyField:'release_id',storage:'members',mode:'equals',scalar:true}];
 const args={path:{id:'record'},body:{release_id:'release-a'}};
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:args},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setIds(['release-a']);assert.equal((await f.helper.verify(actor,f.op,{arguments:args},{id:'record'})).state,'succeeded_verified');
 f.op.policy.verification={path:'/records/:id',expectedValues:[{path:'name',value:'After'}]};
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:{path:{id:'record'},body:{}}},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.op.policy.verification={path:'/records/:id',responseFields:[{resultPath:'name',observedPath:'name'}]};
 await assert.rejects(f.helper.verify(actor,f.op,{arguments:{path:{id:'record'},body:{}}},{id:'record',name:'After'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 f.setRecord({...f.record,name:'After'});
 assert.equal((await f.helper.verify(actor,f.op,{arguments:{path:{id:'record'},body:{}}},{id:'record',name:'After'})).state,'succeeded_verified');
});

test('child reads pin the reviewed content and verify the exact saved steps',async()=>{
 const read={id:'record-read',method:'GET',path:'/records/:id',read:true,path_parameters:['id']};
 const child={id:'child-read',method:'GET',path:'/steps',read:true,path_parameters:[]};
 const op={id:'edit',method:'PUT',path:'/records/:id',policy:{effect:'update',scope:{path_parameter:'id'},verification:{path:read.path,relatedReads:[{bodyField:'steps',path:child.path,queryParameter:'test_case_id'}]}}};
 let steps=[{id:'step-a',action:'Before',expected_result:'Before'}];
 const helper=createVerification({registry:{all:()=>[read,child,op],get:id=>[read,child,op].find(item=>item.id===id)},fail,digest,invoke:async(_actor,selected,args)=>{
  if(selected===child){assert.equal(args.query.test_case_id,'record');return steps;}
  return {id:'record',revision:2};
 }});
 const args={path:{id:'record'},body:{steps:[{action:'After',expected_result:'Saved'}]}};
 const pinned=await helper.capture(actor,op,args);
 steps=[{id:'step-a',action:'Changed',expected_result:'Before'}];await assert.rejects(helper.check(actor,pinned),{code:'MCP_STALE_PLAN'});
 await assert.rejects(helper.verify(actor,op,{arguments:args},{id:'record'}),{code:'MCP_UNVERIFIED_COMPLETION'});
 steps=[{id:'step-new',action:'After',expected_result:'Saved'}];
 const verified=await helper.verify(actor,op,{arguments:args},{id:'record'});assert.deepEqual(verified.verification.compared_collections,['steps']);
 assert.throws(()=>helper.validateArguments(op,{body:{steps:[{step_order:9,action:'Wrong order'}]}}),{code:'MCP_INVALID_ARGUMENT'});
});
