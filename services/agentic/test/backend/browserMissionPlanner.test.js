const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/browserMissionPlanner.js');
function fixture(model,options={}){const native=createRequire(filename),requests=[];const mocks={
 '@hellotest/integration/backend/services/aiLlmSelection.service':{resolveLlmIntegrationForUsage:async input=>{assert.equal(input.projectId,'project');assert.equal(input.userId,'user');return model;}},
 '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init,policy)=>{requests.push({url,...init,policy});if(options.respond)return options.respond(requests.length,init);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'complete',summary:'The requested page has been observed.',outcome:{title:'Page observed',summary:'The requested page has been observed.',columns:[],rows:[]}})}}]});}}
};const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports);return {...module.exports,requests};}
const request={project_id:'project',target_url:'https://app.test/',goal:'Inspect the page',kind:'web',options:{mission:{max_actions:4,allow_form_submission:false}}};
const observation={sequence:1,url:request.target_url,title:'App',text:'Observed content',elements:[{id:'element-1',tag:'button',label:'Menu',type:'button',sensitive:false}]};
test('credential-free model connections omit dummy bearer headers and missing models fail with actionable guidance',async()=>{
 const f=fixture({id:'model',model:'local-model',base_url:'https://model.test/v1',config:{project_id:'project'}});
 const decision=await f.decideMission(request,{id:'user'},observation);assert.equal(decision.action,'complete');assert.equal(f.requests.length,1);assert.equal('Authorization' in f.requests[0].headers,false);
 const missing=fixture(null);await assert.rejects(missing.resolveMissionModel(request,{id:'user'}),e=>e.code==='QUALITY_AGENT_MODEL_REQUIRED'&&/AI Settings/.test(e.publicMessage));assert.equal(missing.requests.length,0);
 const foreign=fixture({config:{project_id:'other'}});await assert.rejects(foreign.resolveMissionModel(request,{id:'user'}),e=>e.statusCode===403);
});
test('browser decisions support bounded scroll/hover/wait/back/assertions without accepting arbitrary selectors or code',()=>{
 const f=fixture(null);
 for(const value of [{action:'scroll',direction:'down'},{action:'hover',element_id:'element-1'},{action:'wait'},{action:'back'},{action:'assert_text',text:'Observed content'}])assert.equal(f.decision({...value,summary:'Reviewed action'},observation,request.target_url).action,value.action);
 for(const value of [{action:'scroll',direction:'sideways'},{action:'hover',element_id:'invented'},{action:'evaluate',code:'fetch(private)'},{action:'assert_text',text:'Bearer private-token'}])assert.throws(()=>f.decision({...value,summary:'Bad action'},observation,request.target_url));
});

test('browser task outcomes keep useful tables and reject fabricated observation quotes',()=>{
 const f=fixture(null);
 const outcome={title:'Observed checkout facts',summary:'The visible checkout exposes a menu.',columns:['Control','Observed state'],rows:[{cells:['Menu','Visible'],evidence:{sequence:1,quote:'Menu'}}]};
 const result=f.decision({action:'complete',summary:'Requested controls reviewed',outcome},observation,request.target_url);
 assert.equal(result.outcome.rows[0].evidence.url,request.target_url);
 assert.deepEqual(result.outcome.rows[0].cells,['Menu','Visible']);
 assert.throws(()=>f.decision({action:'complete',summary:'Reviewed',outcome:{...outcome,rows:[{cells:['Payment','Successful'],evidence:{sequence:1,quote:'Payment succeeded'}}]}},observation,request.target_url),error=>error.code==='QUALITY_AGENT_OUTCOME_INVALID');
 assert.throws(()=>f.decision({action:'click',element_id:'element-1',summary:'Open menu',outcome},observation,request.target_url));
 const previous={...observation,sequence:1,text:'Order total: 25',elements:[]};
 const second={...observation,sequence:2};
 const historyOutcome={...outcome,rows:[{cells:['Total','25'],evidence:{sequence:1,quote:'Order total: 25'}}]};
 assert.equal(f.decision({action:'complete',summary:'Reviewed two pages',outcome:historyOutcome},second,request.target_url,[previous]).outcome.rows[0].evidence.sequence,1);
});

test('mission decisions receive the full task, specialist intent and governed skill with bounded prior evidence',async()=>{
 const f=fixture({id:'model',model:'local-model',base_url:'https://model.test/v1',config:{project_id:'project'}});
 const previous=Array.from({length:11},(_,index)=>({...observation,sequence:index+1,text:`Page ${index+1} `+'x'.repeat(9900)}));
 const current={...observation,sequence:12};const reviewed='User-reviewed brief '+ 'b'.repeat(11970);
 await f.decideMission({...request,kind:'accessibility',smart_context:{reviewed_context:reviewed}}, {id:'user'},current,[],{observations:previous});
 const body=JSON.parse(f.requests[0].body),packet=JSON.parse(body.messages.at(-1).content);
 assert.equal(packet.goal,request.goal);assert.equal(packet.reviewed_context,reviewed);assert.equal(packet.task_brief.agent_id,'browser-accessibility');
 assert.match(packet.task_brief.intent,/accessibility/);assert.ok(packet.task_brief.checks.length);assert.ok(packet.task_brief.limitations.length);
 assert.match(body.messages[1].content,/ai.agentic.browser.accessibility:browserMissionPlanner.skill/);
 assert.ok(JSON.stringify(packet.prior_observations).length<12500);assert.ok(packet.prior_observations.length<11);
 assert.ok(packet.context_manifest.prior_observations_excerpted>0);assert.equal(packet.context_manifest.prior_observations_available,11);
 assert.equal(packet.observation.text,current.text);assert.deepEqual(packet.observation.elements,current.elements);
});

test('host-rejected decisions get one concrete correction without browser replay or raw model content',async()=>{
 const progress=[];
 const f=fixture({model:'small-model'}, {respond:async call=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(call===1?{action:'click',element_id:'invented-private-target',summary:'private invalid decision'}:{action:'assert_text',text:'Observed content',summary:'Verify the observed outcome'})}}]})});
 const result=await f.decideMission(request,{id:'user'},observation,[],{onProgress:update=>progress.push(update)});
 assert.equal(result.action,'assert_text');assert.equal(f.requests.length,2);assert.deepEqual(progress.map(item=>item.phase),['deciding','revising']);
 const corrected=JSON.parse(f.requests[1].body);assert.match(corrected.messages[2].content,/browserMissionPlanner.revision/);
 const packet=JSON.parse(corrected.messages.at(-1).content);assert.equal(packet.validation_feedback.actions_dispatched,0);assert.equal(packet.validation_feedback.sequence,1);
 assert.match(packet.validation_feedback.message,/unavailable or sensitive/);assert.ok(!f.requests[1].body.includes('invented-private-target'));assert.ok(!f.requests[1].body.includes('private invalid decision'));
 assert.ok(f.requests.every(item=>item.policy.maxAttempts===1&&item.policy.contextFallback===false&&item.policy.timeoutMs<=20000));
});

test('a second invalid decision stops, and refusal or cancellation never trigger correction',async()=>{
 const invalid=fixture({model:'small'}, {respond:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"action":"invented"}'}}]})});
 await assert.rejects(invalid.decideMission(request,{id:'user'},observation));assert.equal(invalid.requests.length,2);
 const refusal=fixture({model:'small'}, {respond:async()=>Response.json({choices:[{finish_reason:'stop',message:{refusal:'No',content:'{}'}}]})});
 await assert.rejects(refusal.decideMission(request,{id:'user'},observation),error=>error.code==='QUALITY_AGENT_DECISION_INCOMPLETE');assert.equal(refusal.requests.length,1);
 const controller=new AbortController();controller.abort();const cancelled=fixture({model:'small'});
 await assert.rejects(cancelled.decideMission(request,{id:'user'},observation,[],{signal:controller.signal}),error=>error.code==='QUALITY_AGENT_CANCELLED');assert.equal(cancelled.requests.length,0);
});

test('provider failures are not replayed and cancellation after a response discards its action',async()=>{
 const unavailable=fixture({model:'small'}, {respond:async()=>new Response('Unavailable',{status:503})});
 await assert.rejects(unavailable.decideMission(request,{id:'user'},observation),error=>error.statusCode===503);assert.equal(unavailable.requests.length,1);
 const controller=new AbortController();const late=fixture({model:'small'}, {respond:async(_call,init)=>{assert.equal(init.signal,controller.signal);controller.abort();return Response.json({choices:[{message:{content:JSON.stringify({action:'click',element_id:'element-1',summary:'Open menu'})}}]});}});
 await assert.rejects(late.decideMission(request,{id:'user'},observation,[],{signal:controller.signal}),error=>error.code==='QUALITY_AGENT_CANCELLED');assert.equal(late.requests.length,1);
});

test('completion requires an outcome and only compatible observed controls accept fill or select',()=>{
 const f=fixture(null);
 assert.throws(()=>f.decision({action:'complete',summary:'Done'},observation,request.target_url),error=>error.code==='QUALITY_AGENT_OUTCOME_INVALID');
 for(const action of ['fill','select'])assert.throws(()=>f.decision({action,element_id:'element-1',value:'Value',summary:'Try control'},observation,request.target_url));
 const fields={...observation,elements:[{id:'element-1',tag:'select',label:'Category',type:'select-one',sensitive:false}]};
 assert.equal(f.decision({action:'select',element_id:'element-1',value:'Books',summary:'Choose books'},fields,request.target_url).value,'Books');
});
