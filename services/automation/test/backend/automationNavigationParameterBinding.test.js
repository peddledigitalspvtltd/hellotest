const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {createAutomationInputParameterBinding}=require('../../backend/lib/automationInputParameterBinding');
const {buildAutomationParameterBindings}=require('../../backend/lib/automationParameterBindings');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {prepareVerificationSections}=require('../../backend/lib/automationVerificationSections');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {recordedSectionRequests,adoptPlanningNavigation}=require('../../backend/lib/automationBrowserRecording');
const {planAutomationFlow}=require('../../backend/lib/automationFlowPlanning');
const {exactLinearCoverage}=require('../../backend/lib/automationActionReconciliation');
const {navigationParameterNames}=require('../../backend/lib/automationNavigationParameters');

const destination='https://application.fixture/entry';
function state(action='Open @t.base_url',values={}){
  const resolver=createBrowserParameterResolver({caseValues:{'t.base_url':destination,'r.unrelated':destination,...values},materialize:false});
  const obligations=[{id:'open',source:'section',action,expected_result:'The selected destination is ready.'}];
  const bindings=buildAutomationParameterBindings({obligations,referencedParameterNames:resolver.referencedParameterNames});
  return {resolver,obligations,policy:createAutomationInputParameterBinding({stepId:'open',obligations,bindings,parameterValues:resolver.promptValues,privateParameterNames:resolver.privateParameterNames})};
}
const request=url=>({name:'browser_navigate',arguments:{url}});
const result=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:destination,...value})}]});

test('only an exact original navigation clause binds a literal URL; unrelated URL data and fill-only references stay literal',()=>{
  const {resolver,obligations,policy}=state();
  assert.equal(policy.canonicalize(request(destination)).arguments.url,'@t.base_url');
  assert.equal(resolver.canonicalArguments('browser_navigate',{url:destination},{navigationActions:obligations}).url,'@t.base_url');
  assert.equal(resolver.canonicalArguments('browser_navigate',{url:destination}).url,destination,'a populated data map is not provenance');
  const fillOnly=state('Fill @t.base_url into the URL textbox');
  assert.equal(fillOnly.policy.canonicalize(request(destination)).arguments.url,destination);
  assert.equal(resolver.resolve('browser_navigate',{url:'@t.base_url'}).url,destination);
  assert.equal(resolver.requiresDataAccess('browser_navigate',{url:'@t.base_url'}),true);
  assert.throws(()=>resolver.resolve('browser_navigate',{url:'@r.missing'}),{code:'AUTOMATION_PARAMETER_MISSING'});
  for(const bad of ['','file:///private','https://user:password@application.fixture/','javascript:alert(1)'])assert.throws(()=>state('Open @t.base_url',{'t.base_url':bad}).resolver.resolve('browser_navigate',{url:'@t.base_url'}),{code:'AUTOMATION_PARAMETER_INVALID'});
});

test('navigation names preserve scope, quoted names and legacy choices without binding ambiguous aliases or private values',()=>{
  const {resolver}=state('Open @s.[URL name]',{'s.url name':destination,'r.url]name':destination});
  assert.deepEqual(navigationParameterNames(['Open @s.[URL name] then visit @r.[url\\]name]'],resolver.referencedParameterNames),['s.url name','r.url]name']);
  const ambiguous=state('Open @t.base_url then open @r.other',{'r.other':destination});
  assert.equal(ambiguous.policy.canonicalize(request(destination)).arguments.url,destination);
  const privateState=state('Open @t.secret_url',{'t.secret_url':destination});
  assert.equal(privateState.policy.canonicalize(request(destination)).arguments.url,destination,'private URL values cannot be inferred or disclosed');
  const legacy=state('Open @base_url');assert.equal(legacy.policy.canonicalize(request(destination)).arguments.url,'@t.base_url');
});

test('recording, source lowering and frozen verifier preparation retain exact URL bindings in both native spellings',()=>{
  const resolver=state().resolver;
  for(const url of ['@t.base_url','params["t.base_url"]']){
    const operations=[request(url),{name:'browser_assert',arguments:{assertion:'title',value:'Destination ready'}}];
    const source=compileRecordedProgram(operations).source;
    assert.doesNotMatch(source,/application\.fixture/);assert.match(source,/page.goto\(/);
    assert.equal(deriveProgramTools({payload:{steps:[{step_id:'open',automation_code:source}]},execution:{required:true,step_id:'open'}})[0].arguments.url,'@t.base_url');
    const prepared=prepareVerificationSections([{id:'open',step_type:'web',automation_code:source}],resolver);
    assert.equal(prepared.sections[0].operations[0].arguments.url,url);assert.equal(prepared.parameters['t.base_url'],destination);
  }
  const checked=compileRecordedProgram([request('@t.base_url'),{name:'browser_assert',arguments:{assertion:'url',value:'@t.base_url'}}]);
  assert.equal(deriveProgramTools({payload:{steps:[{step_id:'open',automation_code:checked.source}]},execution:{required:true,step_id:'open'}})[1].arguments.value,'@t.base_url');
});

test('the actual browser-agent bootstrap records a scoped original URL while transport receives only its frozen current value',async()=>{
  const {resolver,obligations,policy}=state(),observations=[],calls=[];let saved;
  const browser={tools:['browser_navigate','browser_snapshot','browser_assert'].map(name=>({name,inputSchema:{type:'object'}})),canonicalizeParameterArguments:resolver.canonicalArguments,
    projectPromptText:resolver.projectText,projectPrivateText:resolver.projectPrivateText,call:async(name,args)=>{
      const resolved=resolver.resolve(name,args);calls.push({name,args:resolved});
      return result(name==='browser_navigate'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{title:'Destination ready',observation_id:'destination-page',elements:[]});
    }};
  const execution={required:true,step_id:'open',action:resolver.projectText(obligations[0].action),expected_result:obligations[0].expected_result,source_obligations:obligations,obligations:resolver.projectSteps(obligations),navigation_parameter_references:['t.base_url']};
  const built=await runAutomationBrowserAgent({browser,startUrl:destination,prompt:'Open the selected destination',actorMode:true,execution,inputParameterBinding:policy,parse:JSON.parse,maxTurns:2,maxCalls:4,
    onObservation:observation=>observations.push(observation),complete:async()=>JSON.stringify({stage:'act',step_id:'open',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'title',value:'Destination ready'}}]}),
    onPartialBuild:async payload=>{saved=payload;return {generation_complete:true};}});
  assert.equal(calls[0].args.url,destination);assert.equal(recordedSectionRequests(observations,'open')[0].arguments.url,'@t.base_url');
  assert.match(built.steps[0].automation_code,/page.goto\("@t.base_url"\)/);assert.doesNotMatch(built.steps[0].automation_code,/application\.fixture/);
  const coverage=exactLinearCoverage({payload:saved,execution,observations});assert.equal(coverage.supported,true);assert.equal(coverage.missing_action_count,0);
});

test('empty-plan bootstrap uses original brief navigation and keeps its reference when adopted by the first generated section',async()=>{
  const {resolver}=state(),observations=[],transport=[];
  const browser={tools:['browser_navigate','browser_snapshot'].map(name=>({name,inputSchema:{type:'object'}})),canonicalizeParameterArguments:resolver.canonicalArguments,
    projectPromptText:resolver.projectText,projectPrivateText:resolver.projectPrivateText,call:async(name,args)=>{
      if(name==='browser_navigate')transport.push(resolver.resolve(name,args).url);
      return result(name==='browser_navigate'?{action_outcome:'completed'}:{title:'Destination ready',elements:[],observation_id:'planning-page'});
    }};
  const rows=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{user_request:'Open @t.base_url and verify the destination.'},browser,startUrl:destination,
    requiredParameterNames:['t.base_url'],referencedParameterNames:resolver.referencedParameterNames,parse:JSON.parse,onObservation:observation=>observations.push(observation),
    complete:async()=>JSON.stringify({flow_steps:[{action:'Open @t.base_url',expected_result:'The page title is Destination ready.',step_type:'web'}]})});
  assert.equal(rows[0].action,'Open @t.base_url');assert.deepEqual(transport,[destination]);
  assert.equal(adoptPlanningNavigation(observations,'planned-open'),1);
  assert.equal(recordedSectionRequests(observations,'planned-open')[0].arguments.url,'@t.base_url');
});
