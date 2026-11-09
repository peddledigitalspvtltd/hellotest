const test=require('node:test');
const assert=require('node:assert/strict');
const {createUpstreamPrivateBindingScope}=require('../../backend/lib/automationUpstreamPrivateBindings');
const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');

const secret='synthetic-private-value-kept-off-model-wire',env='HELLOTEST_R_PASSWORD',blankEnv='HELLOTEST_R_EMPTY';
const bindings={secrets:{[env]:secret,[blankEnv]:''},secretBindings:{[env]:'r.password',[blankEnv]:'r.empty'},references:{'@r.password':env,'@r.empty':blankEnv},parameterValues:{'r.employee_name':'Alex','r.empty':''}};
const startUrl='https://app.test/start',goto=`await page.goto(${JSON.stringify(startUrl)});`;
const fill='await page.getByRole("textbox",{name:"Employee Name",exact:true}).fill("Alex");';
const check='await expect(page.getByRole("textbox",{name:"Employee Name",exact:true})).toHaveValue("Alex");';
const step={id:'employee',step_order:1,step_type:'web',action:'Enter @r.employee_name in Employee Name',expected_result:'Employee Name retains @r.employee_name',parameter_references:['r.employee_name']};
const native=code=>({content:[{type:'text',text:`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n### Snapshot\n\x60\x60\x60yaml\n- textbox "Employee Name" [ref=e1]\n\x60\x60\x60`}]});
const tools=[
 {name:'browser_navigate',inputSchema:{type:'object',required:['url'],properties:{url:{type:'string'}},additionalProperties:false}},
 {name:'browser_type',inputSchema:{type:'object',required:['ref','text'],properties:{ref:{type:'string'},text:{type:'string'}},additionalProperties:false}},
 {name:'browser_fill_form',inputSchema:{type:'object',required:['fields'],properties:{fields:{type:'array',items:{type:'object',required:['ref','name','type','value'],properties:{ref:{type:'string'},name:{type:'string'},type:{type:'string'},value:{type:'string'}},additionalProperties:false}}},additionalProperties:false}},
 {name:'browser_verify_value',inputSchema:{type:'object',required:['type','element','target','value'],properties:{type:{type:'string'},element:{type:'string'},target:{type:'string'},value:{type:'string'}},additionalProperties:false}}
];
function mapping(request){
 const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
 return {schema:'hellotest.playwrightInstructionMapping.v1',steps:packet.steps.map(item=>({step_id:item.step_id,source_sha256:item.source_sha256,instructions:item.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Perform observed instruction',args:[]}))}))};
}
function fixture({actor,source=()=>({automation_code:[goto,fill,check].join('\n')}),call,parameterBindings=bindings}={}){
 const dispatched=[],requests=[],saved=[],evidence=[];let turns=0,sourceTurns=0,closed=0;
 const run=(overrides={})=>buildWithUpstreamPlaywright({steps:[step],startUrl,interactive:true,parameterBindings,redact:text=>text.replaceAll(secret,'[private parameter value]'),validate:inspectExecutablePlan,
  browser:{tools,call:async(name,args)=>{dispatched.push({name,args});return call?call(name,args):native(name==='browser_navigate'?goto:fill);},close:async()=>{closed++;}},
  complete:async request=>{requests.push(request);if(request.phase==='upstream_browser_actor')return actor(request,++turns);if(request.phase==='upstream_source')return source(request,++sourceTurns);return mapping(request);},
  onSection:async update=>saved.push(update),onObservation:async observation=>evidence.push(observation),...overrides});
 return {run,dispatched,requests,saved,evidence,get closed(){return closed;}};
}
const isScopeError=error=>error.code==='AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE'&&!error.message.includes(secret);

test('explicit private scope filters tokens and blank metadata while omitted references retain the compatible binding contract',()=>{
 const scope=createUpstreamPrivateBindingScope({step,bindings});
 assert.deepEqual(scope.references,{});assert.deepEqual(scope.secretBindings,{});assert.deepEqual(scope.availability,{});assert.equal(scope.parameterValues['r.empty'],undefined);
 assert.doesNotThrow(()=>scope.assertArguments({text:'@r.password_extra'}));
 assert.throws(()=>scope.assertArguments({text:'@r.[password]'}),isScopeError);
 const login=createUpstreamPrivateBindingScope({step:{parameter_references:['@r.password','r.empty']},bindings});
 assert.deepEqual(login.references,bindings.references);assert.deepEqual(login.availability,{'@r.password':'configured','@r.empty':'reviewed_blank'});
 assert.equal(login.parameterValues['r.empty'],'');assert.doesNotMatch(JSON.stringify(login),new RegExp(secret));
 const legacy=createUpstreamPrivateBindingScope({step:{},bindings});assert.deepEqual(legacy.references,bindings.references);
 assert.doesNotThrow(()=>legacy.assertSource('const p=params; p[unknown];'));
 for(const parameter_references of [null,'r.password',{}])assert.throws(()=>createUpstreamPrivateBindingScope({step:{parameter_references},bindings}),isScopeError);
});

test('private password input, native env and marker attempts cannot reach Employee Name or the remainder of their batch',async()=>{
 const rejected=[
  {name:'browser_type',arguments:{ref:'e1',text:'@r.password'}},
  {name:'browser_type',arguments:{ref:'e1',text:'@password'}},
  {name:'browser_type',arguments:{ref:'e1',text:'params["r.password"]'}},
  {name:'browser_type',arguments:{ref:'e1',text:env}},
  {name:'browser_type',arguments:{ref:'e1',text:`<secret>${env}</secret>`}},
  {name:'browser_fill_form',arguments:{fields:[{ref:'e1',name:'Employee Name',type:'textbox',value:'@r.password'}]}},
  {name:'browser_verify_value',arguments:{type:'textbox',element:'Employee Name',target:'e1',value:env}},
  {name:'browser_type',arguments:{ref:`e1 @r.password`,text:'Alex'}}
 ];
 for(const rejectedCall of rejected){
  const state=fixture({actor:(request,count)=>{
   const packet=JSON.parse(request.prompt);assert.deepEqual(packet.private_parameter_tokens,{});assert.deepEqual(packet.private_parameter_availability,{});
   assert.equal(packet.parameters['r.empty'],undefined);
   if(count===1)return {tool_calls:[rejectedCall,{name:'browser_type',arguments:{ref:'e1',text:'batch-must-not-run'}}]};
   if(count===2){assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE');assert.match(packet.host_feedback.message,/No browser action was dispatched/);assert.equal(packet.latest_observation.tool,'browser_navigate');return {tool:{name:'browser_type',arguments:{ref:'e1',text:'Alex'}}};}
   return {done:true};
  }});
  const result=await state.run();
  assert.deepEqual(state.dispatched,[{name:'browser_navigate',args:{url:startUrl}},{name:'browser_type',args:{ref:'e1',text:'Alex'}}]);
  assert.match(result.updates[0].automation_code,/fill\(params\["r\.employee_name"\]\)/);assert.equal(state.saved.length,1);assert.equal(state.closed,1);
  assert.doesNotMatch(JSON.stringify({requests:state.requests,evidence:state.evidence,result}),new RegExp(secret));
 }
});

test('an explicit empty reference list denies global private values rather than inheriting every binding',async()=>{
 const state=fixture({actor:(_request,count)=>count===1?{tool:{name:'browser_type',arguments:{ref:'e1',text:'@r.password'}}}:{done:true},source:()=>({automation_code:goto+'\nawait expect(page.getByRole("textbox",{name:"Employee Name"})).toBeVisible();'})});
 const result=await state.run({steps:[{...step,action:'Inspect Employee Name',parameter_references:[]}]});
 assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate']);assert.equal(result.updates.length,1);
 assert.deepEqual(JSON.parse(state.requests[0].prompt).private_parameter_tokens,{});
});

test('an authored Login binding securely types and verifies its password while source and evidence stay symbolic',async()=>{
 const secretFill=`await page.getByLabel("Password").fill(process.env[${JSON.stringify(env)}]);`;
 const secretCheck=`await expect(page.getByLabel("Password")).toHaveValue(${JSON.stringify('<secret>'+env+'</secret>')});`;
 const state=fixture({actor:(request,count)=>{
  const packet=JSON.parse(request.prompt);assert.deepEqual(packet.private_parameter_tokens,{'@r.password':env});assert.deepEqual(packet.private_parameter_availability,{'@r.password':'configured'});
  if(count===1)return {tool:{name:'browser_type',arguments:{ref:'password',text:'@r.password'}}};
  if(count===2)return {tool:{name:'browser_verify_value',arguments:{type:'textbox',element:'Password',target:'password',value:env}}};
  return {done:true};
 },call:(name,args)=>{
  if(name==='browser_type')assert.equal(args.text,env);
  if(name==='browser_verify_value')assert.equal(args.value,secret);
  return native(name==='browser_navigate'?goto:name==='browser_type'?secretFill:secretCheck);
 },source:request=>{assert.deepEqual(JSON.parse(request.prompt).private_parameter_tokens,{'@r.password':env});return {automation_code:[goto,secretFill,secretCheck].join('\n')};}});
 const result=await state.run({steps:[{...step,id:'login',action:'Enter @r.password',expected_result:'Password retains its value',parameter_references:['r.password']}]});
 assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_type','browser_verify_value']);
 assert.match(result.updates[0].automation_code,/fill\(params\["r\.password"\]\)/);assert.match(result.updates[0].automation_code,/toHaveValue\(params\["r\.password"\]\)/);
 assert.doesNotMatch(JSON.stringify({requests:state.requests,evidence:state.evidence,result}),new RegExp(secret));assert.equal(bindings.secrets[env],secret,'the full runtime redaction dictionary is unchanged');
});

test('an explicitly authorized reviewed blank remains an empty native input and an exact scoped saved binding',async()=>{
 const emptyFill='await page.getByLabel("Password").fill("");',emptyCheck='await expect(page.getByLabel("Password")).toHaveValue("");';
 const state=fixture({actor:(request,count)=>{
  const packet=JSON.parse(request.prompt);assert.deepEqual(packet.private_parameter_tokens,{'@r.empty':blankEnv});assert.deepEqual(packet.private_parameter_availability,{'@r.empty':'reviewed_blank'});
  if(count===1)return {tool:{name:'browser_type',arguments:{ref:'password',text:'@r.empty'}}};
  if(count===2)return {tool:{name:'browser_verify_value',arguments:{type:'textbox',element:'Password',target:'password',value:'@r.empty'}}};
  return {done:true};
 },call:(name,args)=>{if(name==='browser_type')assert.equal(args.text,'');if(name==='browser_verify_value')assert.equal(args.value,'');return native(name==='browser_navigate'?goto:name==='browser_type'?emptyFill:emptyCheck);},source:()=>({automation_code:[goto,emptyFill,emptyCheck].join('\n')})});
 const result=await state.run({steps:[{...step,action:'Leave @r.empty blank',expected_result:'Password is blank',parameter_references:['r.empty']}]});
 assert.match(result.updates[0].automation_code,/fill\(params\["r\.empty"\]\)/);assert.match(result.updates[0].automation_code,/toHaveValue\(params\["r\.empty"\]\)/);
});

test('API sections share the authored private scope and cannot persist a global password through a generated request',async()=>{
 const state=fixture();let turns=0,normalized=0;
 const apiStep={...step,step_type:'api',action:'GET https://api.test/employee',expected_result:'HTTP 200',parameter_references:[]};
 await assert.rejects(state.run({steps:[apiStep],complete:async request=>{
  turns++;const packet=JSON.parse(request.prompt);assert.equal(request.phase,'upstream_api_source');assert.deepEqual(packet.private_parameter_tokens,{});assert.equal(packet.parameters['r.empty'],undefined);
  return {steps:[{step_id:step.id,step_type:'api',api_request:{method:'GET',url:'https://api.test/employee',headers:{Authorization:'Bearer @r.password'},validations:[{kind:'status',expected:'200'}]}}]};
 },normalizeApiBuild:async()=>{normalized++;throw new Error('Unauthorized binding must be rejected before normalization');}}),isScopeError);
 assert.equal(turns,3);assert.equal(normalized,0);assert.equal(state.saved.length,0);assert.equal(state.dispatched.length,0);assert.equal(state.closed,1);
});

test('source cannot introduce unauthorized private params, environment keys, markers or escaped lookup objects',async()=>{
 const sources=[
  'await expect(page.getByLabel("Name")).toHaveValue("@r.password");',
  'await expect(page.getByLabel("Name")).toHaveValue("@password");',
  'await expect(page.getByLabel("Name")).toHaveValue(\'params["r.password"]\');',
  'await expect(page.getByLabel("Name")).toHaveValue(params["r.password"]);',
  'await expect(page.getByLabel("Name")).toHaveValue(params["r."+"password"]);',
  'const p=params;await expect(page.getByLabel("Name")).toHaveValue(p["r.password"]);',
  'const {"r.password":value}=params;await expect(page.getByLabel("Name")).toHaveValue(value);',
  'await expect(page.getByLabel("Name")).toHaveValue(Object.values(params)[0]);',
  'await expect(page.getByLabel("Name")).toHaveValue(params[key]);',
  `await expect(page.getByLabel("Name")).toHaveValue(process.env.${env});`,
  `await expect(page.getByLabel("Name")).toHaveValue(process["env"][${JSON.stringify(env)}]);`,
  `await expect(page.getByLabel("Name")).toHaveValue(${JSON.stringify('Hello <secret>'+env+'</secret>')});`,
  'await expect(page.getByLabel("Name")).toHaveValue("@r."+"password");',
  'await expect(page.getByLabel("Name")).toHaveValue(`@r.password ${suffix}`);'
 ];
 for(const invalidSource of sources){
  const state=fixture({actor:()=>({done:true}),source:()=>({automation_code:goto+'\n'+invalidSource})});
  await assert.rejects(state.run({steps:[{...step,action:'Inspect Employee Name'}]}),isScopeError);
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate']);assert.equal(state.saved.length,0);assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,3);
  assert.equal(state.requests.some(item=>item.phase==='upstream_instruction_mapping'),false);assert.doesNotMatch(JSON.stringify(state.requests),new RegExp(secret));
 }
});

test('an unauthorized private binding in native emitted source stops before model continuation and evidence retention',async()=>{
 const state=fixture({actor:()=>({tool:{name:'browser_type',arguments:{ref:'e1',text:'Alex'}}}),call:name=>native(name==='browser_navigate'?goto:`await page.getByLabel("Name").fill(process.env.${env});`)});
 await assert.rejects(state.run(),isScopeError);
 assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_type']);assert.equal(state.requests.length,1);assert.equal(state.saved.length,0);assert.equal(state.evidence.length,1);
 assert.doesNotMatch(JSON.stringify({requests:state.requests,evidence:state.evidence}),new RegExp(secret));
});

test('private authorization preserves native action equivalence and cannot change the target of an allowed Login fill',async()=>{
 const secretFill=`await page.getByLabel("Password").fill(process.env[${JSON.stringify(env)}]);`;
 const state=fixture({actor:(_request,count)=>count===1?{tool:{name:'browser_type',arguments:{ref:'password',text:'@r.password'}}}:{done:true},call:name=>native(name==='browser_navigate'?goto:secretFill),source:()=>({automation_code:[goto,secretFill.replace('Password','Name'),'await expect(page.getByLabel("Password")).toHaveValue("@r.password");'].join('\n')})});
 await assert.rejects(state.run({steps:[{...step,action:'Enter @r.password in Password',parameter_references:['r.password']}]}),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CHANGED');
 assert.equal(state.dispatched.filter(item=>item.name==='browser_type').length,1);assert.equal(state.saved.length,0);
});
