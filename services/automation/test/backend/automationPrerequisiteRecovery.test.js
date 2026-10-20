const test=require('node:test'),assert=require('node:assert/strict');
const {createAutomationCaseJourney}=require('../../backend/lib/automationCaseJourney');
const {reviewAutomationPrerequisite,approvedAutomationPrerequisite}=require('../../backend/lib/automationPrerequisiteRecovery');
const {projectModelSnapshot}=require('../../backend/lib/automationBrowserModelTargets');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const pageUrl='https://app.test/home',loginUrl='https://app.test/login';
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url:pageUrl,...value})}]});
const element={tag:'a',accessible_role:'link',accessible_name:'Sign in',displayed:true,disabled:false,attributes:{href:'/login'},locators_validated:true,locator_candidates:['getByRole("link", { name: "Sign in", exact: true })']};
const step={id:'current',step_type:'web',action:'Navigate to '+pageUrl,expected_result:'The login form is visible'};
const allow={decision:'allow',reason:'Open the observed login route required by the current expected result.',necessary_for_current_step:true,changes_expected_result:false,executes_later_step:false,requires_new_data:false};
const tool={name:'browser_click',inputSchema:{type:'object',properties:{locator:{type:'string'}},required:['locator'],additionalProperties:false}};
function fixture(extra={}){
 const snapshot={tool:'browser_snapshot',result:receipt({observation_id:'home-current',elements:[{...element,...extra}]})};
 const target=projectModelSnapshot(snapshot).targets[0];
 const journey=createAutomationCaseJourney({testCase:{title:'Invalid credentials must not sign in'},steps:[step,{id:'later',step_type:'web',action:'Enter @r.email',expected_result:'Value is retained'}],activeStepId:step.id,projectText:text=>text});
 const execution={...step,step_id:step.id,required:true,case_journey:journey,source_obligations:[{id:step.id,source:'section',action:step.action,expected_result:step.expected_result}]};
 const proposal={reason:'The home page needs one missing navigation to reach the required login form.',evidence_refs:['home-current',target.ref],tool_call:{name:'browser_click',arguments:{locator:target.ref}}};
 return {snapshot,execution,proposal,tool,observations:[snapshot],parse:JSON.parse,projectText:text=>text,deadlineMs:Date.now()+10000};
}

test('missing UI review binds one click to exact native evidence and preserves full intent and future order',async()=>{
 const state=fixture();let models=0;
 const result=await reviewAutomationPrerequisite({...state,complete:async prompt=>{models++;const packet=JSON.parse(prompt.split('\n\n').at(-1));
  assert.equal(packet.requirements.current.action,step.action);assert.equal(packet.requirements.future[0].action,'Enter @r.email');
  assert.equal(packet.proposed.same_origin_destination,loginUrl);return JSON.stringify(allow);}});
 assert.equal(models,1);assert.equal(result.request.arguments.locator,element.locator_candidates[0]);
 assert.equal(approvedAutomationPrerequisite(result.approval,result.request,state.snapshot,step.id),true);
 for(const changed of [{...result.request,arguments:{locator:'#other'}},{...result.request,name:'browser_fill'}])assert.equal(approvedAutomationPrerequisite(result.approval,changed,state.snapshot,step.id),false);
 assert.equal(approvedAutomationPrerequisite({},result.request,state.snapshot,step.id),false);
 state.snapshot.result.content[0].text=state.snapshot.result.content[0].text.replace('home-current','next-page');
 assert.equal(approvedAutomationPrerequisite(result.approval,result.request,state.snapshot,step.id),false);
});

test('submissions, invented evidence, cross-origin links, disabled controls and absent targets fail before a model request',async()=>{
 let models=0;
 for(const extra of [{tag:'button',role:'tab',attributes:{type:'submit','aria-controls':'dialog'}},{tag:'button',attributes:{type:'button'}},
  {attributes:{href:'https://foreign.test/login'}},{attributes:{href:'javascript:alert(1)'}},{attributes:{href:'/login',target:'_blank'}},{displayed:false},{disabled:true}]){
  await assert.rejects(reviewAutomationPrerequisite({...fixture(extra),complete:async()=>{models++;return JSON.stringify(allow);}}),error=>/^AUTOMATION_PREREQUISITE_/.test(error.code));
 }
 const state=fixture();state.proposal.evidence_refs=['foreign-evidence'];
 await assert.rejects(reviewAutomationPrerequisite({...state,complete:async()=>{models++;return JSON.stringify(allow);}}),{code:'AUTOMATION_PREREQUISITE_INVALID'});
 assert.equal(models,0);
});

test('review rejects changed outcomes, later actions, new data, malformed verdicts and provider failures without authorizing work',async()=>{
 for(const verdict of [{...allow,changes_expected_result:true},{...allow,executes_later_step:true},{...allow,requires_new_data:true},{...allow,necessary_for_current_step:false},{...allow,decision:'block'}])
  await assert.rejects(reviewAutomationPrerequisite({...fixture(),complete:async()=>JSON.stringify(verdict)}),{code:'AUTOMATION_PREREQUISITE_REJECTED'});
 await assert.rejects(reviewAutomationPrerequisite({...fixture(),complete:async()=>'not json'}),{code:'AUTOMATION_PREREQUISITE_REVIEW_INVALID'});
 const exhausted=Object.assign(new Error('Quota exhausted'),{code:'LLM_QUOTA_EXCEEDED'});
 await assert.rejects(reviewAutomationPrerequisite({...fixture(),complete:async()=>{throw exhausted;}}),error=>error===exhausted);
});

test('actual actor recovers a missing navigation under navigation-only policy, then checks and saves native receipts',async()=>{
 const state=fixture(),calls=[],events=[],sources=[];let actors=0,prerequisiteReviews=0,outcomeReviews=0,clicked=false;
 const login={tag:'input',accessible_role:'textbox',accessible_name:'Email',displayed:true,attributes:{type:'email'},locators_validated:true,locator_candidates:['#email']};
 const result=await runAutomationBrowserAgent({actorMode:true,prompt:'Open the application and show its login form.',startUrl:pageUrl,execution:{...state.execution,semantic_review_required:true},parse:JSON.parse,maxTurns:5,maxCalls:6,
  browser:{tools:[tool,{name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']}},{name:'browser_snapshot',inputSchema:{type:'object'}},{name:'browser_assert',inputSchema:{type:'object'}}],projectPromptText:text=>text,projectPrivateText:text=>text,
   call:async(name,args)=>{calls.push({name,args});if(name==='browser_snapshot')return receipt({url:clicked?loginUrl:pageUrl,observation_id:clicked?'login-page':'home-current',elements:[clicked?login:element]});if(name==='browser_click')clicked=true;return receipt({url:clicked?loginUrl:pageUrl,...(name==='browser_assert'?{assertion_outcome:'satisfied'}:{action_outcome:'completed'})});}},
  complete:async(prompt,_timeout,trace)=>{
   if(trace?.generationScope==='section_prerequisite_review'){prerequisiteReviews++;return JSON.stringify(allow);}
   if(trace?.generationScope==='section_semantic_review'){outcomeReviews++;return JSON.stringify({decision:'accept',obligations:[{id:step.id,action_operations:[1,2],assertion_operations:[3]}],issues:[]});}
   actors++;const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
   if(!clicked)return JSON.stringify({prerequisite_request:{reason:state.proposal.reason,evidence_refs:[current.current_snapshot.observation_id],tool_call:{name:'browser_click',arguments:{locator:current.current_snapshot.targets[0].ref}}},tool_calls:[{name:'browser_fill',arguments:{locator:'#ignored',value:'not authorized'}}]});
   return JSON.stringify({stage:'act',step_id:step.id,section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:current.current_snapshot.targets[0].ref}}]});
  },onProgress:event=>events.push(event),onPartialBuild:async payload=>{sources.push(payload);return {generation_complete:true};}
 });
 assert.equal(actors,2);assert.equal(prerequisiteReviews,1);assert.equal(outcomeReviews,1);assert.equal(sources.length,1);
 assert.equal(calls.filter(call=>call.name==='browser_click').length,1);assert.equal(calls.filter(call=>call.name==='browser_fill').length,0);
 assert.match(result.steps[0].automation_code,/\.goto\(/);assert.match(result.steps[0].automation_code,/\.click\(/);assert.match(result.steps[0].automation_code,/toBeVisible/);
 assert.ok(events.some(event=>event.phase==='automation.agent.prerequisite.approved'));
});
