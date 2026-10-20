const test=require('node:test');
const assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {buildFailureProgress}=require('../../backend/lib/automationBuildFailureProgress');
const {stepBuildError}=require('../../backend/lib/automationStepBuildErrors');

test('identical unsupported assertion proposals stop on unchanged evidence before another MCP call or review',async()=>{
 const observations=[],events=[];let actorCalls=0,browserCalls=0,reviews=0;
 const url='https://app.test/login?state=clipped';
 const current={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',url,url_truncated:true,observation_id:'pinned',scope:'body',elements:[]})}]}};
 await assert.rejects(runAutomationBrowserAgent({prompt:'Verify the login form',actorMode:true,parse:JSON.parse,maxTurns:5,
  execution:{required:true,step_id:'login',action:'Open the login form',expected_result:'The login form is displayed',semantic_review_required:true},
  initialObservations:[current],browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async()=>{browserCalls++;throw Error('Unsupported proposal reached MCP');}},
  onObservation:item=>observations.push(item),onProgress:event=>events.push(event),
  complete:async(_prompt,_remaining,trace)=>{
   if(trace?.generationScope==='section_semantic_review'){reviews++;throw Error('Unsupported proposal reached review');}
   actorCalls++;return JSON.stringify({stage:'act',step_id:'login',section_complete:false,tool_calls:[{name:'browser_assert',arguments:{assertion:'url',value:url}}]});
  }
 }),error=>{
  assert.equal(error.code,'AUTOMATION_BROWSER_ASSERTION_PROPOSAL_STALLED');assert.equal(error.nonRetryable,true);
  assert.equal(error.details.action_outcome,'not_attempted');assert.doesNotMatch(JSON.stringify(error.details),/app\.test|state=clipped/);
  const progress=buildFailureProgress(error,{modelStarted:true});
  assert.equal(progress.phase,'automation.agent.browser.failed');assert.match(progress.message,/same unsupported assertion/i);
  const publicError=stepBuildError(progress,new Date().toISOString());assert.match(publicError.message,/no repeated browser check/i);
  assert.doesNotMatch(JSON.stringify(publicError),/app\.test|state=clipped/);return true;
 });
 assert.equal(actorCalls,2,'one correction opportunity, then stop');assert.equal(browserCalls,0);assert.equal(reviews,0);
 assert.equal(observations.filter(item=>item.tool==='automation_assertion_feedback').length,1);
 assert.equal(events.filter(item=>item.phase==='automation.agent.assertion.excerpt').length,1);
});
