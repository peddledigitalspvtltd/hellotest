const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveSecretReferences,buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const env='HELLOTEST_R_PASSWORD',secret='synthetic-password-for-native-dispatch-only';
const references={'@r.password':env},secrets={[env]:secret},values={'r.first':'Alex','r.last':"O'Neil",'r.template':'Welcome','r.literal':'@r.next','r.next':'expanded-only-if-authored','r.email':'reader@r.first.test','r.url':'https://app.test/next'};
const resolve=(name,args)=>resolveSecretReferences(name,args,references,secrets,values);

test('only native data fields resolve scoped public inputs and composites while selectors, descriptions and regex remain exact',()=>{
 const text="Welcome for Alex O'Neil",template='@r.template for @r.first @r.last';
 for(const [name,args,expected]of [
  ['browser_type',{ref:'@r.first',text:'@r.first'},{ref:'@r.first',text:'Alex'}],
  ['browser_fill_form',{fields:[{target:'@r.first',name:'@r.first',value:template}]},{fields:[{target:'@r.first',name:'@r.first',value:text}]}],
  ['browser_verify_value',{target:'@r.first',element:'@r.first',value:template},{target:'@r.first',element:'@r.first',value:text}],
  ['browser_verify_text_visible',{text:template},{text}],
  ['browser_verify_list_visible',{target:'@r.first',items:['@r.first',template]},{target:'@r.first',items:['Alex',text]}],
  ['browser_wait_for',{text:template,textGone:'@r.first',time:3},{text,textGone:'Alex',time:3}],
  ['browser_find',{text:template,regex:'@r.first',maxResults:3},{text,regex:'@r.first',maxResults:3}],
  ['browser_select_option',{target:'@r.first',values:['@r.first',template]},{target:'@r.first',values:['Alex',text]}],
  ['browser_navigate',{url:'@r.url'},{url:'https://app.test/next'}],
  ['browser_click',{target:'@r.first',element:'@r.first'},{target:'@r.first',element:'@r.first'}]
 ])assert.deepEqual(resolve(name,args),expected,name);
});

test('inserted public email and token-like values are literal and never resolved for a second pass',()=>{
 assert.equal(resolve('browser_type',{text:'@r.literal'}).text,'@r.next');
 assert.equal(resolve('browser_type',{text:'@r.email'}).text,'reader@r.first.test');
 assert.equal(resolve('browser_type',{text:'Contact @r.email, token @r.literal'}).text,'Contact reader@r.first.test, token @r.next');
 assert.equal(resolve('browser_type',{text:'reader@r.first.test'}).text,'reader@r.first.test');
 assert.equal(resolve('browser_type',{text:'@r.password'}).text,env);assert.equal(resolve('browser_verify_value',{value:'@r.password'}).value,secret);
 assert.equal(resolve('browser_verify_text_visible',{text:'Value @r.password'}).text,'Value '+secret);
 assert.throws(()=>resolve('browser_type',{text:'prefix @r.password'}),{code:'AUTOMATION_UPSTREAM_PARAMETER_INVALID'});
 assert.throws(()=>resolve('browser_type',{text:'@r.missing'}),{code:'AUTOMATION_UPSTREAM_PARAMETER_INVALID'});
});

const startUrl='https://app.test/start',goto=`await page.goto(${JSON.stringify(startUrl)});`;
const native=code=>({content:[{type:'text',text:'### Ran Playwright code\n```js\n'+code+'\n```'}]});
const tools=[
 {name:'browser_navigate',inputSchema:{type:'object',required:['url'],properties:{url:{type:'string'}},additionalProperties:false}},
 {name:'browser_type',inputSchema:{type:'object',required:['ref','text'],properties:{ref:{type:'string'},text:{type:'string'}},additionalProperties:false}},
 {name:'browser_verify_text_visible',inputSchema:{type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false}}
];
function fixture({actor,source,call,parameterValues=values}={}){
 const dispatched=[],requests=[],saved=[];let turns=0;
 const run=(overrides={})=>buildWithUpstreamPlaywright({steps:[{id:'employee',step_type:'web',step_order:1,action:'Enter @r.first',expected_result:'@r.template for @r.first @r.last is visible',parameter_references:['r.first','r.last','r.template','r.url']}],startUrl,interactive:true,
  parameterBindings:{references,secrets,secretBindings:{[env]:'r.password'},parameterValues},redact:text=>text.replaceAll(secret,'[private parameter value]'),validate:inspectExecutablePlan,
  browser:{tools,call:async(name,args)=>{dispatched.push({name,args});return call(name,args,dispatched.length);},close:async()=>{}},
  complete:async request=>{requests.push(request);if(request.phase==='upstream_browser_actor')return actor(request,++turns);if(request.phase==='upstream_source')return {automation_code:source};const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));return {schema:'hellotest.playwrightInstructionMapping.v1',steps:packet.steps.map(item=>({step_id:item.step_id,source_sha256:item.source_sha256,instructions:item.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Observed instruction',args:[]}))}))};},onSection:async update=>saved.push(update),...overrides});
 return {run,dispatched,requests,saved};
}

test('the native MCP receives actual first-name and composite data while saved executable source remains symbolic',async()=>{
 const fill='await page.getByLabel("First name").fill("Alex");',check='await expect(page.getByText("Welcome for Alex O\'Neil")).toBeVisible();';
 const state=fixture({actor:(_request,count)=>count===1?{tool_calls:[{name:'browser_type',arguments:{ref:'first',text:'@r.first'}},{name:'browser_verify_text_visible',arguments:{text:'@r.template for @r.first @r.last'}}]}:{done:true},call:(name,args)=>native(name==='browser_navigate'?goto:name==='browser_type'?fill:check),source:[goto,fill,check].join('\n')});
 const result=await state.run();
 assert.deepEqual(state.dispatched.map(item=>item.args),[{url:startUrl},{ref:'first',text:'Alex'},{text:"Welcome for Alex O'Neil"}]);
 assert.match(result.updates[0].automation_code,/fill\(params\["r\.first"\]\)/);assert.ok(result.updates[0].automation_code.includes('getByText((params["r.template"] + " for " + params["r.first"] + " " + params["r.last"]))'));
 assert.equal(state.saved.length,1);assert.doesNotMatch(JSON.stringify({requests:state.requests,result}),new RegExp(secret));
});

test('public navigation resolves before origin admission and an external resolved URL never dispatches',async()=>{
 const next=values['r.url'],navigate=`await page.goto(${JSON.stringify(next)});`,check=`await expect(page).toHaveURL(${JSON.stringify(next)});`;
 const navigationStep={id:'employee',step_type:'web',step_order:1,action:'Navigate to @r.url',expected_result:'The current URL equals @r.url',parameter_references:['r.url']};
 const state=fixture({actor:(_request,count)=>count===1?{tool:{name:'browser_navigate',arguments:{url:'@r.url'}}}:{done:true},call:(_name,args)=>native(args.url===startUrl?goto:navigate),source:[goto,navigate,check].join('\n')});
 const result=await state.run({steps:[navigationStep]});assert.equal(state.dispatched[1].args.url,next);assert.match(result.updates[0].automation_code,/goto\(params\["r\.url"\]\)/);
 const external=fixture({actor:()=>({tool:{name:'browser_navigate',arguments:{url:'@r.url'}}}),call:()=>native(goto),parameterValues:{...values,'r.url':'https://external.test/private'}});
 await assert.rejects(external.run({steps:[navigationStep]}),{code:'AUTOMATION_UPSTREAM_NAVIGATION_DENIED'});assert.deepEqual(external.dispatched.map(item=>item.name),['browser_navigate']);
});

test('a public parameter alias cannot smuggle an unauthorized native secret key through resolution',async()=>{
 const state=fixture({parameterValues:{...values,'r.first':env},actor:(request,count)=>{
  const packet=JSON.parse(request.prompt);assert.deepEqual(packet.private_parameter_tokens,{});
  if(count===1)return {tool:{name:'browser_type',arguments:{ref:'employee-name',text:'@r.first'}}};
  assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE');return {blocked_reason:'The requested private alias is outside the authored section.'};
 },call:()=>native(goto),source:'await page.getByLabel("First name").fill(process.env.HELLOTEST_R_PASSWORD);\nawait expect(page.getByLabel("First name")).toHaveValue(process.env.HELLOTEST_R_PASSWORD);'});
 await assert.rejects(state.run(),{code:'AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE'});assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate']);assert.equal(state.saved.length,0);
 assert.doesNotMatch(JSON.stringify(state.requests),new RegExp(secret));
});
