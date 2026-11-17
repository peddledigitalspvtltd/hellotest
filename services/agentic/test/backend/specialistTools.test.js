const test=require('node:test');const assert=require('node:assert/strict');
const {createSpecialistTools}=require('../../backend/services/specialistTools');
const call=(name,args={},id='tool-1')=>({id,function:{name,arguments:JSON.stringify(args)}});
function fixture(extra={}){const calls=[],events=[],evidence=[];const controller=new AbortController();let access=0;
 const session=createSpecialistTools({user:{id:'u'},projectId:'p',appTypeId:'a',context:{stories:[{content:JSON.stringify({records:[{id:'story-1'}]})}]},requestedScopes:['stories','knowledge'],policy:{allowed_tools:['project_evidence','knowledge_search']},deadline:Date.now()+20000,signal:controller.signal,onEvent:async event=>events.push(event),onEvidence:async value=>evidence.push(value),assertAccess:async()=>{access++;},call:async input=>{calls.push(input);return {contract_type:'ContextPacket',project_id:'p',app_type_id:'a',evidence:[{evidence_id:'new-source',source_id:'source',content:'The retry preserves one order. password=veryprivatevalue'}]};},...extra});
 return {session,calls,events,evidence,controller,get access(){return access;}};
}
test('specialist tools reuse MCP context with fixed scope, cost cap and ingest redacted citations',async()=>{
 const f=fixture({smartContext:{source_ids:['chosen-source']},evidenceScope:{story_id:'story-1'}});
 assert.deepEqual(f.session.definitions().map(d=>d.function.name),['project_evidence','knowledge_search','record_read']);
 const messages=await f.session.execute([call('project_evidence',{question:'What does retry require?'})]);
 assert.equal(f.calls[0].name,'hellotest_context_build');assert.equal(f.calls[0].projectId,'p');assert.equal(f.calls[0].args.app_type_id,'a');
 assert.deepEqual(f.calls[0].args.filters.source_ids,['chosen-source']);assert.deepEqual(f.calls[0].args.filters.evidence_scope,{story_id:'story-1'});assert.equal(f.calls[0].args.planning_mode,'deterministic');assert.equal(f.calls[0].args.budgets.max_query_cost_usd,0);
 assert.equal(f.evidence[0].citation.id,'new-source');assert.doesNotMatch(messages[0].content,/veryprivatevalue/);assert.equal(f.access,1);assert.equal(f.events.at(-1).phase,'tool.completed');
});
test('extra scope arguments and unobserved record identities never reach MCP',async()=>{
 for(const c of [call('project_evidence',{question:'x',project_id:'foreign'}),call('record_read',{record_ref:'requirement:arbitrary'}),call('browser_click',{selector:'button'})]){
  const f=fixture();await assert.rejects(f.session.execute([c]),{code:'AGENT_TOOL_DENIED'});assert.equal(f.calls.length,0);
 }
});
test('read-only tools stop at four calls, cancellation and renewed access revocation',async()=>{
 const f=fixture();for(let i=0;i<4;i++)await f.session.execute([call('knowledge_search',{question:'Retry'},'tool-'+i)]);
 assert.equal(f.session.used,4);assert.deepEqual(f.session.definitions(),[]);await assert.rejects(f.session.execute([call('knowledge_search',{question:'Retry'})]),{code:'AGENT_TOOL_BUDGET'});assert.equal(f.calls.length,4);
 const cancelled=fixture();cancelled.controller.abort();await assert.rejects(cancelled.session.execute([call('knowledge_search',{question:'Retry'})]),{name:'AbortError'});assert.equal(cancelled.calls.length,0);
 const revoked=fixture({assertAccess:async()=>{throw Object.assign(new Error('revoked'),{statusCode:403});}});await assert.rejects(revoked.session.execute([call('knowledge_search',{question:'Retry'})]),{statusCode:403});assert.equal(revoked.calls.length,0);
});
test('foreign project/application and denied evidence cannot enter specialist context',async()=>{
 for(const packet of [{project_id:'foreign',evidence:[]},{project_id:'p',app_type_id:'foreign',evidence:[]},{project_id:'p',evidence:[{evidence_id:'bad',authorized:false}]}]){
  const f=fixture({call:async()=>packet});await assert.rejects(f.session.execute([call('knowledge_search',{question:'Retry'})]),{code:'AGENT_TOOL_DENIED'});assert.deepEqual(f.evidence,[]);
 }
});
test('graph reads cannot widen any explicit source or record selector',()=>{
 for(const extra of [{smartContext:{source_ids:['s']}},{smartContext:{source_kinds:['requirement']}},{evidenceScope:{story_id:'story-1'}}])assert.ok(!fixture(extra).session.definitions().some(d=>d.function.name==='graph_read'));
 assert.ok(fixture().session.definitions().some(d=>d.function.name==='graph_read'));
});
