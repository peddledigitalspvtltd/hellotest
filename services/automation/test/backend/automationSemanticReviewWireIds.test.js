const test=require('node:test');
const assert=require('node:assert/strict');
const {createAutomationSemanticReviewer}=require('../../backend/lib/automationSemanticReview');
const {recordBrowserOperation,recordedSectionRequests}=require('../../backend/lib/automationBrowserRecording');

const longId='manual:7e5ecfe7-d915-4e02-9f67-3bcbca420605:938582c7-9eba-4c48-9f8b-c6579af4af6a';
const goal=id=>({id,source:id==='current'?'section':'manual',action:'Enter @r.username in the Username field.',expected_result:'The Username field contains the entered username.'});
const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/login',...value})}]});
function observations(){
 const page=()=>({tool:'browser_snapshot',result:receipt({observation_id:'current-page',elements:[{tag:'input',attributes:{type:'text'},accessible_name:'Username',locators_validated:true,locator_candidates:['#username']}]})});
 const recorded=(name,args)=>{const row={tool:name,execution_step_id:'current',result:receipt(name==='browser_fill'?{action_outcome:'completed'}:{assertion_outcome:'satisfied'})};recordBrowserOperation(row,{name,arguments:args});return row;};
 return[page(),recorded('browser_fill',{locator:'#username',value:'@r.username'}),page(),recorded('browser_assert',{assertion:'value',locator:'#username',value:'@r.username'})];
}
const packet=prompt=>JSON.parse(prompt.split('\n').at(-1));
const verdict=(ids,decision='accept',issues=[])=>JSON.stringify({decision,obligations:ids.map(id=>({id,action_operations:[1],assertion_operations:[2]})),issues});
const create=(ids,complete,extra={})=>createAutomationSemanticReviewer({execution:{required:true,step_id:'current',obligations:ids.map(goal)},complete,...extra});

test('long composite identity is short and consistent on wire, then restores exact private source mappings and cached coverage',async()=>{
 const rows=observations();let calls=0;
 const review=create(['current',longId],async prompt=>{
  calls++;const data=packet(prompt),ids=data.obligations.map(row=>row.id);
  assert.equal(ids[0],'current');assert.ok(ids[1].length<24);assert.notEqual(ids[1],longId);assert.equal(prompt.includes(longId),false);
  assert.deepEqual(data.response_contract.obligations.required_ids,ids);
  assert.deepEqual(data.assertion_evidence_contract.map(row=>row.obligation_id),ids);
  assert.deepEqual(data.assertion_evidence_contract.map(row=>row.parameter_reference),['r.username','r.username']);
  return verdict(ids);
 });
 const result=await review.review({observations:rows});assert.equal(result.accepted,true);
 assert.deepEqual(result.obligation_mappings.map(row=>row.id),['current',longId]);
 assert.equal((await review.review({observations:rows})).cached,true);assert.equal(calls,1);
 assert.equal(recordedSectionRequests(rows,'current').filter(row=>row.name==='browser_fill').length,1);
 assert.equal(recordedSectionRequests(rows,'current').filter(row=>row.name==='browser_assert').length,1);
});

test('rejected wire issue identities restore exact immutable source IDs in private feedback and activity',async()=>{
 const events=[];
 const review=create(['current',longId],async prompt=>{const ids=packet(prompt).obligations.map(row=>row.id);
  return verdict(ids,'reject',[{code:'unsupported_claim',obligation_id:ids[1],message:'The supplied evidence does not establish the requested outcome.'}]);
 },{onProgress:async event=>events.push(event)});
 const result=await review.review({observations:observations()});assert.equal(result.accepted,false);
 assert.equal(result.feedback.issues[0].obligation_id,longId);assert.equal(result.private_feedback.issues[0].obligation_id,longId);
 assert.equal(events.find(event=>event.phase==='automation.agent.semantic.rejected').details.semantic_issues[0].obligation_id,longId);
});

test('unknown, truncated and copied original long IDs never acquire wire authority or replay protected work',async()=>{
 for(const invalidId of [wire=>wire+'x',wire=>wire.slice(0,-1),()=>longId,()=> 'unknown_goal']){
  const rows=observations(),before=recordedSectionRequests(rows,'current');let calls=0;
  const review=create(['current',longId],async prompt=>{calls++;const ids=packet(prompt).obligations.map(row=>row.id);ids[1]=invalidId(ids[1]);return verdict(ids);});
  await assert.rejects(review.review({observations:rows}),error=>error.code==='AUTOMATION_SEMANTIC_REVIEW_INVALID');
  assert.equal(calls,2);assert.deepEqual(recordedSectionRequests(rows,'current'),before);assert.equal(rows.length,4);
 }
});

test('an original short ID colliding with an issued long-ID label remains distinct and maps without guessing',async()=>{
 let firstWire;
 const first=create([longId],async prompt=>{firstWire=packet(prompt).obligations[0].id;return verdict([firstWire]);});
 assert.equal((await first.review({observations:observations()})).accepted,true);
 const second=create([longId,firstWire],async prompt=>{const ids=packet(prompt).obligations.map(row=>row.id);
  assert.equal(ids[1],firstWire);assert.notEqual(ids[0],firstWire);assert.equal(new Set(ids).size,2);return verdict(ids);
 });
 const result=await second.review({observations:observations()});assert.equal(result.accepted,true);
 assert.deepEqual(result.obligation_mappings.map(row=>row.id),[longId,firstWire]);
});

test('other-review aliases and verdict caches cannot substitute another immutable source obligation',async()=>{
 let firstWire,calls=0;const rows=observations();
 const first=create([longId],async prompt=>{firstWire=packet(prompt).obligations[0].id;return verdict([firstWire]);});
 assert.equal((await first.review({observations:rows})).accepted,true);assert.equal((await first.review({observations:rows})).cached,true);
 const otherId=longId+'-other';
 const invalid=create([otherId],async prompt=>{calls++;assert.notEqual(packet(prompt).obligations[0].id,firstWire);return verdict([firstWire]);});
 await assert.rejects(invalid.review({observations:rows}),error=>error.code==='AUTOMATION_SEMANTIC_REVIEW_INVALID');assert.equal(calls,2);
 let ownCalls=0;const own=create([otherId],async prompt=>{ownCalls++;return verdict(packet(prompt).obligations.map(row=>row.id));});
 const result=await own.review({observations:rows});assert.equal(result.accepted,true);assert.equal(result.obligation_mappings[0].id,otherId);assert.equal(ownCalls,1);
});
