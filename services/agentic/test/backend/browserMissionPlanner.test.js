const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/browserMissionPlanner.js');
function fixture(model){const native=createRequire(filename),requests=[];const mocks={
 '@hellotest/integration/backend/services/aiLlmSelection.service':{resolveLlmIntegrationForUsage:async input=>{assert.equal(input.projectId,'project');assert.equal(input.userId,'user');return model;}},
 '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init)=>{requests.push({url,...init});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'complete',summary:'The requested page has been observed.'})}}]});}}
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
