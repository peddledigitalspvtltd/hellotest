const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFlowPlan, planAutomationFlow, projectFlowPlanningBrief } = require('../../backend/lib/automationFlowPlanning');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

const flow = [{ action: 'Enter @t.email', expected_result: 'The supplied email appears', step_type: 'web' },
  { action: 'Continue', expected_result: 'The review page displays the email', step_type: 'web' }];

test('a brief becomes ordered manual specifications without invented code or identifiers', () => {
  const result = normalizeFlowPlan({ flow_steps: flow.map(row => ({ ...row, id: 'untrusted', step_order: 999 })) });
  assert.deepEqual(result.map(row => row.step_order), [1, 2]);
  assert.equal(result[0].action, 'Enter @t.email');
  assert.equal(result[0].id, undefined);assert.equal(result[0].automation_code, undefined);
});

test('the real data resolver keeps public, private, empty and escaped authored bindings symbolic in the planner request',async()=>{
 const privateValue='FIXTURE_PRIVATE_CREDENTIAL',publicValue='public-fixture@example.test';
 const resolver=createBrowserParameterResolver({caseValues:{'r.email':publicValue,'r.password':privateValue,'r.empty':'','r.[Customer label]':'Public customer value','r.secret_alias':'@r.email'},materialize:false});
 const refs=['@r.email','@r.password','@r.empty','@r.[Customer label]'];
 const brief='Enter '+refs.join(', ')+' using the configured case values. A pasted credential '+privateValue+' must stay private.';
 const projected=projectFlowPlanningBrief(brief,resolver);
 for(const ref of refs)assert.ok(projected.includes(ref),ref);
 assert.equal(projected,brief.replace(privateValue,'[private parameter value]'));
 assert.ok(!projected.includes(publicValue),'public inputs retain their authored binding identity rather than becoming fixed literals');
 assert.ok(!projected.includes('Public customer value'));assert.match(projected,/A pasted credential \[private parameter value\]/);
 const buildContext=resolver.projectBuildContext({linked_manual_cases:[]});let calls=0;
 const result=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',allowedTypes:['web'],parse:JSON.parse,
  context:{user_request:projected,build_context:buildContext},complete:async prompt=>{
   calls++;const packet=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"generation_stage":')));
   assert.equal(packet.context.user_request,projected);for(const ref of refs)assert.ok(packet.context.user_request.includes(ref));
   assert.equal(packet.context.build_context.parameter_data.values['r.email'],publicValue,'known public values remain separately available as authorized data');
   assert.equal(packet.context.build_context.parameter_data.values['r.customer label'],'Public customer value');
   assert.equal(packet.context.build_context.parameter_data.values['r.empty'],'');
   assert.equal(packet.context.build_context.parameter_data.values['r.password'],'@r.password');
   assert.doesNotMatch(prompt,/FIXTURE_PRIVATE_CREDENTIAL/);
   return JSON.stringify({flow_steps:refs.map(ref=>({action:'Enter '+ref+' into its requested field',expected_result:'The field contains '+ref,step_type:'web'}))});
  }});
 assert.equal(calls,1);assert.deepEqual(result.map(step=>step.action),refs.map(ref=>'Enter '+ref+' into its requested field'));
 assert.equal(resolver.resolve('browser_fill',{value:'@r.email'}).value,publicValue);assert.equal(resolver.resolve('browser_fill',{value:'@r.empty'}).value,'');
 for(const invalid of [{}, {projectPrivateText:()=>undefined}])assert.throws(()=>projectFlowPlanningBrief(brief,invalid),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID'});
});

test('a public input materialized by the planner requires bounded correction with retained browser evidence and no literal reconstruction',async()=>{
 const publicValue='public-planning-fixture@example.test',privateValue='PRIVATE_PLANNING_FIXTURE';
 const resolver=createBrowserParameterResolver({caseValues:{'r.email':publicValue,'r.password':privateValue,'r.empty':'','r.unrelated':'unused fixture'},materialize:false});
 const brief='Enter @r.email, @r.password and @r.empty into the requested fields.';
 const requiredParameterNames=resolver.referencedParameterNames([{action:brief,expected_result:''}]);
 const calls=[],observations=[],prompts=[];let turns=0;
 const result=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{user_request:projectFlowPlanningBrief(brief,resolver)},parse:JSON.parse,
  requiredParameterNames,referencedParameterNames:resolver.referencedParameterNames,startUrl:'https://app.test/auth',onObservation:observation=>observations.push(observation),
  browser:{tools:['browser_navigate','browser_snapshot'].map(name=>({name,inputSchema:{type:'object'}})),call:async name=>{
   calls.push(name);return{content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/auth',action_outcome:'completed',observation_id:'retained-reference-evidence',accessibility:'- form "Observed sign in"',elements:[]})}]};
  }},complete:async prompt=>{
   prompts.push(prompt);turns++;
   const packet=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"generation_stage":')));
   assert.deepEqual(packet.planning_parameter_contract.required_references,['@r.email','@r.empty','@r.password']);
   assert.match(packet.planning_parameter_contract.instruction,/public, private or empty/);
   assert.doesNotMatch(prompt,/PRIVATE_PLANNING_FIXTURE/);
   if(turns===1)return JSON.stringify({flow_steps:[{action:`Enter ${publicValue}, @r.password and @r.empty into the requested fields.`,expected_result:'The fields contain the supplied inputs',step_type:'web'}]});
   assert.equal(turns,2);assert.equal(packet.validation_feedback.code,'AUTOMATION_FLOW_PLAN_INVALID');
   assert.match(packet.validation_feedback.message,/@r.email/);assert.doesNotMatch(packet.validation_feedback.message,/public-planning-fixture|PRIVATE_PLANNING_FIXTURE|r\.unrelated/);
   assert.match(prompt,/Observed sign in/,'the existing browser observation survives reference-contract correction');
   return JSON.stringify({flow_steps:[{action:brief,expected_result:'The fields contain the supplied inputs',step_type:'web'}]});
  }});
 assert.equal(turns,2);assert.deepEqual(calls,['browser_navigate','browser_snapshot']);assert.equal(observations.length,2);
 assert.equal(result[0].action,brief);assert.ok(!result[0].action.includes(publicValue));assert.equal(prompts.length,2);
 assert.ok(!resolver.referencedParameterNames(result).includes('r.unrelated'),'known but unauthored data does not create a planning requirement');
});

test('canonical required bindings accept resolver aliases, deferred inputs and escaped names without materializing values',async()=>{
 const brief='Enter @email, @r.password, @r.empty, @random and @r.[Customer \\] label].';
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'case inherited fixture','r.password':'PRIVATE_ALIAS_FIXTURE','r.empty':'','r.[Customer \\] label]':'customer fixture'},steps:[{action:brief,expected_result:''}],materialize:false});
 const requiredParameterNames=resolver.referencedParameterNames([{action:brief,expected_result:''}]);
 assert.deepEqual(requiredParameterNames,['r.customer ] label','r.empty','r.password','r.random','t.email']);assert.ok(resolver.deferredParameterNames.includes('r.random'));
 assert.equal(resolver.promptValues['r.random'],'[generated for each build]');
 let calls=0;
 const result=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{user_request:projectFlowPlanningBrief(brief,resolver)},parse:JSON.parse,
  requiredParameterNames,referencedParameterNames:resolver.referencedParameterNames,complete:async prompt=>{
   calls++;const packet=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"generation_stage":')));
   assert.deepEqual(packet.planning_parameter_contract.required_references,['@r.[customer \\] label]','@r.empty','@r.password','@r.random','@t.email']);
   assert.doesNotMatch(prompt,/PRIVATE_ALIAS_FIXTURE|case inherited fixture|customer fixture/);
   return JSON.stringify({flow_steps:[{action:'Enter @t.email, @r.password, @r.empty, @r.random and @r.[customer \\] label].',expected_result:'All supplied inputs appear in the requested fields',step_type:'web'}]});
  }});
 assert.equal(calls,1);assert.deepEqual(resolver.referencedParameterNames(result),requiredParameterNames);
});

test('invalid required reference contracts stop before progress, model or browser work',async()=>{
 for(const requiredParameterNames of [null,'r.email',Array(1),['r.email','r.email'],[null],[1],['email'],['@r.email'],['R.Email'],['r.'],['r.bad\nname'],['r.'+'x'.repeat(220)]]){
  let effects=0;
  await assert.rejects(planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{},parse:JSON.parse,requiredParameterNames,referencedParameterNames:()=>[],
   complete:async()=>{effects++;},browser:{tools:[],call:async()=>{effects++;}},onProgress:async()=>{effects++;}}),error=>error.code==='AUTOMATION_FLOW_PLAN_CONTEXT_INVALID'&&error.nonRetryable===true);
  assert.equal(effects,0);
 }
 for(const referencedParameterNames of [undefined,null,{},'resolver']){
  let calls=0;
  await assert.rejects(planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{},parse:JSON.parse,requiredParameterNames:['r.email'],referencedParameterNames,
   complete:async()=>{calls++;}}),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID'});
  assert.equal(calls,0);
 }
});

test('missing bindings exhaust only the existing validation attempts and do not turn literals into references',async()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'r.email':'fixed fixture'},materialize:false});let calls=0;
 await assert.rejects(planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{},parse:JSON.parse,requiredParameterNames:['r.email'],referencedParameterNames:resolver.referencedParameterNames,
  complete:async()=>{calls++;return JSON.stringify({flow_steps:[{action:'Enter fixed fixture',expected_result:'The supplied input appears',step_type:'web'}]});}}),{code:'AUTOMATION_FLOW_PLAN_INVALID'});
 assert.equal(calls,3);
});

test('equal-valued parameters in another scope cannot discharge an authored required binding',async()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'same fixture','r.email':'same fixture'},materialize:false});let calls=0;
 const result=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{},parse:JSON.parse,requiredParameterNames:['r.email'],referencedParameterNames:resolver.referencedParameterNames,
  complete:async prompt=>{
   calls++;
   if(calls===2){const packet=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"generation_stage":')));assert.match(packet.validation_feedback.message,/@r.email/);assert.doesNotMatch(packet.validation_feedback.message,/same fixture/);}
   return JSON.stringify({flow_steps:[{action:calls===1?'Enter @t.email':'Enter @r.email',expected_result:'The supplied input appears',step_type:'web'}]});
  }});
 assert.equal(calls,2);assert.equal(result[0].action,'Enter @r.email');
});

test('malformed host reference extraction fails closed without model retries',async()=>{
 for(const extracted of [null,'r.email',Array(1),['r.email','r.email'],['@r.email'],[undefined]]){
  let calls=0;
  await assert.rejects(planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{},parse:JSON.parse,requiredParameterNames:['r.email'],referencedParameterNames:()=>extracted,
   complete:async()=>{calls++;return JSON.stringify({flow_steps:flow});}}),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID'});
  assert.equal(calls,1);
 }
});

test('empty, incomplete, duplicate, executable and out-of-platform flow plans are rejected', () => {
  for (const rows of [[], Array(41).fill(flow[0]), [null], [{ action: 'Continue' }],
    [{ ...flow[0], expected_result: ' ' }], [flow[0], flow[0]], [{ ...flow[0], automation_code: 'await page.click("#submit")' }],
    [{ ...flow[0], step_type: 'ios' }], [{ ...flow[0], action: 'x'.repeat(3001) }]]) {
    assert.throws(() => normalizeFlowPlan({ flow_steps: rows }), error => error.code === 'AUTOMATION_FLOW_PLAN_INVALID');
  }
});

test('planning uses the configured Engineer with read-only MCP discovery and bounded corrections', async () => {
  const requests = [], calls = [], observations = [], events = [];
  const browser = { tools: ['browser_navigate', 'browser_snapshot', 'browser_fill'].map(name => ({ name })), call: async name => {
    calls.push(name);return { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test', action_outcome: 'completed', accessibility: 'Email and Continue' }) }] };
  } };
  const result = await planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: { user_request: 'Review the supplied email', story: { title: 'Contact details' } }, allowedTypes: ['web'], browser, startUrl: 'https://app.test', observations,
    parse: JSON.parse, complete: async prompt => {
      requests.push(prompt);
      assert.match(prompt, /automationFlowPlanning.instructions/);
      assert.match(prompt, /Contact details/);
      const catalog = JSON.parse(prompt.match(/Tool catalog: ([^\n]+)/)[1]);
      assert.equal(catalog.some(tool => tool.name === 'browser_fill'), false);
      return JSON.stringify(requests.length === 1 ? { flow_steps: [{ action: 'Continue' }] } : { flow_steps: flow });
    }, onObservation: observation => observations.push(observation), onProgress: event => events.push(event) });
  assert.equal(result.length, 2);assert.equal(requests.length, 2);
  assert.match(requests[1], /validation_feedback/);
  assert.deepEqual(calls, ['browser_navigate', 'browser_snapshot']);
  assert.ok(events.some(event => event.phase === 'automation.agent.flow.planning'));
});

test('flow planning cannot dispatch a model-requested form mutation', async () => {
  const calls = [];let turns = 0;
  const result = await planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: { user_request: 'Enter email' }, allowedTypes: ['web'], parse: JSON.parse,
    browser: { tools: ['browser_fill', 'browser_snapshot'].map(name => ({ name })), call: async name => { calls.push(name); } },
    complete: async () => JSON.stringify(++turns === 1 ? { tool_calls: [{ name: 'browser_fill', arguments: { locator: '#email', value: '@t.email' } }] } : { flow_steps: flow }) });
  assert.equal(result.length, 2);assert.deepEqual(calls, []);
});

test('an empty repair plan reports the missing repair target before browser or model work',async()=>{
 let calls=0;
 await assert.rejects(planAutomationFlow({featureKey:'ai.agentic.automation-repair',allowedTypes:['web'],context:{user_request:'Repair the flow'},parse:JSON.parse,
  browser:{tools:[],call:async()=>{calls++;}},complete:async()=>{calls++;}}),error=>error.code==='AUTOMATION_REPAIR_PLAN_REQUIRED'&&error.statusCode===422&&error.nonRetryable);
 assert.equal(calls,0);
});

test('malformed JSON is corrected within the same bounded planner phase without echoing raw parser details', async () => {
  let calls = 0;
  const result = await planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: { user_request: 'Review email' }, allowedTypes: ['web'], parse: value => {
    if (value === 'malformed') throw Object.assign(new Error('private-provider-content-secret'), { code: 'AI_INVALID_JSON' });
    return JSON.parse(value);
  }, complete: async prompt => {
    calls++;
    if (calls === 1) return 'malformed';
    assert.match(prompt, /AI_INVALID_JSON/);
    assert.match(prompt, /planning_protocol/);
    assert.doesNotMatch(prompt, /private-provider-content-secret/);
    return JSON.stringify({ flow_steps: flow });
  } });
  assert.equal(calls, 2); assert.equal(result.length, 2);
});

test('provider and permission failures are propagated without turning them into planner retries', async () => {
  for (const error of [Object.assign(new Error('provider detail'), { code: 'AI_PROVIDER_FAILED' }), Object.assign(new Error('not authorized'), { statusCode: 403 }), new SyntaxError('provider response body')]) {
    let calls = 0;
    await assert.rejects(planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, parse: JSON.parse,
      complete: async () => { calls++; throw error; } }), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test('all planner validation attempts share six model calls rather than restarting the browser-loop model budget', async () => {
  let calls = 0;
  await assert.rejects(planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, parse: JSON.parse,
    browser: { tools: [], call: async () => assert.fail('no tool was proposed') },
    complete: async () => { calls++; return 'invalid JSON'; }
  }), error => error.code === 'AUTOMATION_FLOW_PLAN_MODEL_BUDGET_EXHAUSTED' && error.nonRetryable === true && error.details.model_call_count === 6);
  assert.equal(calls, 6);
});

test('planning retains observed evidence between format corrections without a caller-maintained ledger', async () => {
  let calls = 0, reads = 0;
  const result = await planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, parse: JSON.parse,
    browser: { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }], call: async () => {
      reads++; return { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test', accessibility: '- heading "Retained planning evidence"', elements: [] }) }] };
    } }, complete: async prompt => {
      calls++;
      if (calls === 1) return JSON.stringify({ tool_calls: [{ name: 'browser_snapshot', arguments: {} }] });
      if (calls === 2) return JSON.stringify({ flow_steps: [{ action: 'Incomplete plan' }] });
      assert.match(prompt, /Retained planning evidence/);
      assert.match(prompt, /AUTOMATION_FLOW_PLAN_INVALID/);
      return JSON.stringify({ flow_steps: flow });
    }
  });
  assert.equal(result.length, 2); assert.equal(reads, 1); assert.equal(calls, 3);
});

test('the real planner loop scopes snapshots through opaque refs and retains compact evidence across format correction without assertions or history replay',async()=>{
 const hostLocator='getByRole("form", {name:"Contact details",exact:true})',browserCalls=[],prompts=[];
 const receipt=(id,scoped=false)=>({content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:id,url:'https://app.test/contact',title:'Contact details',scope:scoped?hostLocator:'body',
  accessibility:'- form "Contact details"',raw_dom:'PRIVATE_RAW_DOM '.repeat(3000),
  elements:[{tag:'form',accessible_role:'form',accessible_name:'Contact details',displayed:true,locators_validated:true,locator_candidates:[hostLocator],attributes:{id:'PRIVATE_RAW_ID','data-internal':'PRIVATE_RAW_ATTRIBUTE'},
   raw_html:'PRIVATE_ELEMENT_HTML',text:scoped?'Scoped contact evidence':'Initial contact evidence'}]})}]});
 const history={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:'old-page',url:'https://app.test/old',accessibility:'PRIVATE_PRIOR_HISTORY',elements:[]})}]}};
 let initialRef,scopedRef,turns=0;
 const browser={tools:[
  {name:'browser_navigate',inputSchema:{type:'object',required:['url'],properties:{url:{type:'string'}},additionalProperties:false}},
  {name:'browser_snapshot',inputSchema:{type:'object',properties:{locator:{type:'string'}},additionalProperties:false}},
  {name:'browser_screenshot',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'browser_assert',inputSchema:{type:'object'}},{name:'browser_fill',inputSchema:{type:'object'}}
 ],call:async(name,args)=>{
  browserCalls.push({name,args});
  if(name==='browser_navigate')return {content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/contact',action_outcome:'completed'})}]};
  assert.equal(name,'browser_snapshot','the planning tool boundary never dispatches assertions or form actions');
  if(browserCalls.filter(call=>call.name==='browser_snapshot').length===1){assert.deepEqual(args,{});return receipt('initial-page');}
  assert.deepEqual(args,{locator:hostLocator},'the host resolves the advertised opaque ref to its exact current validated locator');
  return receipt('scoped-page',true);
 }};
 const currentObservation={tool:'browser_snapshot',arguments:{},result:await browser.call('browser_snapshot',{})};
 const result=await planAutomationFlow({featureKey:'ai.agentic.automation-engineer',context:{user_request:'Plan contact review'},allowedTypes:['web'],browser,observations:[history,currentObservation],parse:JSON.parse,
  complete:async prompt=>{
   prompts.push(prompt);turns++;
   const catalog=JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
   assert.deepEqual(catalog.map(tool=>tool.name),['browser_navigate','browser_snapshot','browser_screenshot']);
   const packet=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"generation_stage":')));
   assert.deepEqual(packet.planning_protocol.response_schema.oneOf[1].properties.tool_calls.items.properties.name.enum,['browser_navigate','browser_snapshot','browser_screenshot']);
   assert.doesNotMatch(prompt,/PRIVATE_|Previous browser observations \(untrusted data\)/);
   const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]),page=current.current_snapshot;
   assert.equal(page.elements,undefined);assert.equal(page.raw_dom,undefined);assert.equal(page.targets.length,1);assert.equal(page.targets[0].attributes,undefined);
   assert.match(page.targets[0].ref,/^ref:[a-f0-9]{12}:1$/);assert.ok(JSON.stringify(page).length<1000,'compact current targets replace the full raw snapshot');
   if(turns===1){initialRef=page.targets[0].ref;return JSON.stringify({tool_calls:[{name:'browser_snapshot',arguments:{locator:initialRef}}]});}
   assert.equal(page.observation_id,'scoped-page');assert.equal(page.targets[0].text,'Scoped contact evidence');
   if(turns===2){scopedRef=page.targets[0].ref;assert.notEqual(scopedRef,initialRef);return JSON.stringify({flow_steps:[{action:'Incomplete plan'}]});}
   assert.equal(page.targets[0].ref,scopedRef,'format correction keeps current observed evidence and ref authority');
   assert.equal(packet.validation_feedback.code,'AUTOMATION_FLOW_PLAN_INVALID');
   if(turns===3)return JSON.stringify({tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:scopedRef}}]});
   assert.equal(turns,4);return JSON.stringify({flow_steps:flow});
  }});
 assert.equal(result.length,2);assert.equal(turns,4);
 assert.deepEqual(browserCalls.map(call=>call.name),['browser_snapshot','browser_snapshot']);
 assert.equal(prompts.length,4);
});

test('planner browser reads share one four-call allowance across validation attempts', async () => {
  let calls = 0, reads = 0;
  await assert.rejects(planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, parse: JSON.parse,
    browser: { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }], call: async () => {
      reads++; return { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test', accessibility: 'State ' + reads, elements: [] }) }] };
    } }, complete: async () => {
      calls++;
      return JSON.stringify(calls % 2 ? { tool_calls: Array.from({ length: 4 }, () => ({ name: 'browser_snapshot', arguments: {} })) } : { flow_steps: [{ action: 'Incomplete plan' }] });
    }
  }), error => ['AUTOMATION_FLOW_PLAN_TOOL_BUDGET_EXHAUSTED', 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'].includes(error.code));
  assert.equal(reads, 4);
});

test('a shared expired deadline stops before planning or browser calls', async () => {
  let calls = 0;
  await assert.rejects(planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, parse: JSON.parse,
    deadlineMs: Date.now() - 1, complete: async () => { calls++; }
  }), error => error.code === 'AUTOMATION_FLOW_PLAN_DEADLINE_EXHAUSTED' && error.nonRetryable === true);
  assert.equal(calls, 0);
});

test('a completed manual proposal cannot smuggle executable source or a mixed inspection batch', () => {
  for (const extra of [{ tool_calls: [] }, { steps: [] }, { automation_code: 'await page.click("#submit")' }, { api_request: { method: 'POST' } }]) {
    assert.throws(() => normalizeFlowPlan({ flow_steps: flow, ...extra }), error => error.code === 'AUTOMATION_FLOW_PLAN_INVALID');
  }
});
