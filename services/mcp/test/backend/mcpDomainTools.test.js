const test=require('node:test');
const assert=require('node:assert/strict');
const {createDomainTools}=require('../../backend/domainTools');
const contracts=require('../../backend/toolContracts');
const z=require('zod');
const actor={user:{id:'caller'},projectId:'project',clientId:'host'};
const fail=(message,statusCode=403,code='DENIED')=>Object.assign(new Error(message),{message,publicMessage:message,statusCode,code});
function fixture() {
  const operations=[
    {id:'list-cases',method:'GET',path:'/test-cases',read:true,prepare:false},
    {id:'get-case',method:'GET',path:'/test-cases/:id',read:true,prepare:false},
    {id:'create-case',method:'POST',path:'/test-cases',read:false,prepare:true},
    {id:'update-case',method:'PUT',path:'/test-cases/:id',read:false,prepare:true},
    {id:'get-project',method:'GET',path:'/projects/:id',read:true,prepare:false},
  ];
  const queries=[],reads=[],plans=[];
  const projections={entities:{test_cases:{}},query:async(...args)=>{queries.push(args);return {rows:[{id:'case-1',title:'Registration'}],next_offset:25,observed_at:'2026-10-31T00:00:00Z'};}};
  const backplane={read:async(...args)=>{reads.push(args);return {data:{id:'case-1',title:'Registration'},bounded:true,observed_at:'2026-10-31T00:00:00Z'};},prepare:async(...args)=>{plans.push(args);return {plan_id:'plan',state:'requires_authorization'};}};
  return {tools:createDomainTools({backplane,projections,registry:{all:()=>operations},fail}),backplane,projections,operations,queries,reads,plans};
}
async function call(f,name,args={}) {
  const tool=f.tools[name];return tool.run(actor,tool.schema.parse(args));
}

test('named resources use literal safe filters and real bounded projection pagination',async()=>{
  const f=fixture();
  const result=await call(f,'hellotest_test_cases_list',{search:'50%_off',status:'Ready',application_id:'app',limit:25,offset:0});
  assert.deepEqual(f.queries[0],[actor,{entity:'test_cases',filters:[{field:'title',op:'contains',value:'50%_off'},{field:'status',op:'eq',value:'Ready'},{field:'app_type_id',op:'eq',value:'app'}],limit:25,offset:0}]);
  assert.equal(f.reads.length,0,'Native unpaginated collection routes must not pretend to paginate.');
  assert.deepEqual(result.items,[{id:'case-1',title:'Registration'}]);assert.equal(result.next_offset,25);
  assert.equal(f.tools.hellotest_test_cases_list.output.safeParse(result).success,true);
});

test('named detail resolves the actual native operation and never accepts another project identity',async()=>{
  const f=fixture();
  const result=await call(f,'hellotest_test_cases_get',{test_case_id:'case-1'});
  assert.deepEqual(f.reads[0].slice(0,2),[actor,{operation_id:'get-case',arguments:{path:{id:'case-1'}}}]);
  assert.equal(result.resource,'test_cases');assert.equal(result.record.id,'case-1');
  assert.equal(f.tools.hellotest_test_cases_get.schema.safeParse({test_case_id:'case-1',project_id:'foreign'}).success,false);
  await call(f,'hellotest_project_get');
  assert.equal(f.reads[1][1].arguments.path.id,'project');
});

test('named get tools preserve delivery omissions instead of presenting an excerpt as complete evidence',async()=>{
  const f=fixture(),delivery={truncated:true,redacted:true,omitted_items:3,truncated_strings:1};
  f.operations.push({id:'get-source',method:'GET',path:'/knowledge/sources/:id',read:true,prepare:false});
  f.backplane.read=async()=>({data:{id:'saved-record',description:'A shortened display excerpt'},observed_at:'2026-10-31T00:00:00Z',bounded:true,delivery});
  for(const [name,args]of [['hellotest_test_cases_get',{test_case_id:'case'}],['hellotest_project_get',{}],['hellotest_knowledge_source_get',{source_id:'source'}]]){
    const value=await call(f,name,args);
    assert.deepEqual(value.delivery,delivery);
    assert.equal(f.tools[name].output.safeParse(value).success,true);
    assert.equal(f.tools[name].output.safeParse({...value,delivery:{...delivery,omitted_items:-1}}).success,false);
  }
});

test('unsupported named tools stay out of discovery and cannot activate an unwrapped mutation',async()=>{
  const f=fixture();
  assert.equal(f.tools.hellotest_stories_list.available(),false);
  assert.equal(f.tools.hellotest_test_cases_list.available(),true);
  f.operations.find(item=>item.id==='create-case').prepare=false;
  assert.equal(f.tools.hellotest_test_case_create_prepare.available(),false);
  await assert.rejects(call(f,'hellotest_test_case_create_prepare',{app_type_id:'app',title:'Registration'}),{code:'MCP_OPERATION_UNAVAILABLE'});
  assert.equal(f.plans.length,0);
});

test('Automation Engineer prepares the shared durable domain operation without browser transport or execution',async()=>{
  const f=fixture(),name='hellotest_automation_engineer_prepare',tool=f.tools[name];
  assert.equal(tool.available(),false);
  await assert.rejects(call(f,name,{test_case_id:'case-1'}),{code:'MCP_OPERATION_UNAVAILABLE'});
  f.operations.push({id:'build-case',method:'POST',path:'/test-cases/:id/automation/generator-jobs',prepare:true});
  assert.equal(tool.available(),true);
  const result=await call(f,name,{test_case_id:'case-1',integration_id:'model',start_url:'https://application.test/login',test_environment_id:'environment',test_configuration_id:'configuration',test_suite_id:'suite',test_data_set_id:'data',parameter_plan_key:'reviewed-plan'});
  assert.deepEqual(f.plans,[ [actor,{operation_id:'build-case',arguments:{path:{id:'case-1'},body:{integration_id:'model',start_url:'https://application.test/login',test_environment_id:'environment',test_configuration_id:'configuration',test_suite_id:'suite',test_data_set_id:'data',parameter_plan_key:'reviewed-plan',ai_feature:'ai.agentic.automation-engineer',verification_mode:'generate_only'}}}] ]);
  assert.equal(result.state,'requires_authorization');
  assert.equal(f.reads.length,0);assert.equal(f.queries.length,0);
  assert.equal(tool.schema.safeParse({test_case_id:'case-1',project_id:'foreign'}).success,false);
  for(const extra of [{browser_driver:'custom'},{allow_browser_actions:true},{parameter_values:{password:'private'}},{approved:true},{paired_browser_bridge_id:'machine-grant'}])assert.equal(tool.schema.safeParse({test_case_id:'case-1',...extra}).success,false);
  for(const start_url of ['file:///etc/passwd','javascript:alert(1)','https://user:private@application.test/'])assert.equal(tool.schema.safeParse({test_case_id:'case-1',start_url}).success,false);
  const controller=new AbortController();controller.abort();
  await assert.rejects(tool.run(actor,tool.schema.parse({test_case_id:'case-1'}),controller.signal),{name:'AbortError'});
  assert.equal(f.plans.length,1,'Cancellation must not prepare another plan.');
  f.operations.at(-1).prepare=false;
  await assert.rejects(call(f,name,{test_case_id:'case-1'}),{code:'MCP_OPERATION_UNAVAILABLE'});
  assert.equal(f.plans.length,1);
});

test('Automation Engineer status follows its original durable transaction through native project checks',async()=>{
  const f=fixture(),name='hellotest_automation_engineer_status',tool=f.tools[name];
  assert.equal(tool.available(),false);
  f.operations.push({id:'build-status',method:'GET',path:'/test-cases/automation/jobs/:transactionId',read:true});
  assert.equal(tool.available(),true);
  const delivery={truncated:false,redacted:true,omitted_items:0,truncated_strings:0};
  f.backplane.read=async(...args)=>{f.reads.push(args);return {data:{transaction_id:'original',status:'running'},observed_at:'2026-11-06T00:00:00Z',bounded:true,delivery};};
  const signal=new AbortController().signal;
  const result=await tool.run(actor,tool.schema.parse({transaction_id:'original'}),signal);
  assert.deepEqual(f.reads[0],[actor,{operation_id:'build-status',arguments:{path:{transactionId:'original'}}},signal]);
  assert.equal(result.record.status,'running');assert.deepEqual(result.delivery,delivery);
  assert.equal(tool.output.safeParse(result).success,true);
  assert.equal(tool.schema.safeParse({transaction_id:'original',project_id:'foreign'}).success,false);
  assert.equal(f.plans.length,0);
  f.backplane.read=async()=>{throw fail('Current build access was revoked.',403,'MCP_ACCESS_DENIED');};
  await assert.rejects(call(f,name,{transaction_id:'original'}),{code:'MCP_ACCESS_DENIED'});
});

test('agent and workflow evidence tools use audited routes and projection fields with exact native identifiers',async()=>{
  const f=fixture();
  const domains=[
    ['test_modules','/test-case-modules','module_id','name'],['schedules','/execution-schedules','schedule_id','name'],
    ['workflow_runs','/agentic-workflow-runs','workflow_run_id','id'],['agents','/agentic-workflows/agents','agent_id','name'],
    ['repository_runs','/repository-agents/runs','repository_run_id','id'],['knowledge_collections','/knowledge/collections','collection_id','name'],
    ['dashboards','/quality-dashboards','dashboard_id','name']
  ];
  for(const [name,path,key,field]of domains){
    const parameter=name==='agents'?'agentId':'id';
    assert.equal(f.tools[`hellotest_${name}_list`].available(),false,'Unaudited deployments omit this named tool');
    f.projections.entities[name]={};
    f.operations.push({id:`list-${name}`,method:'GET',path,read:true},{id:`get-${name}`,method:'GET',path:`${path}/:${parameter}`,read:true});
    assert.equal(f.tools[`hellotest_${name}_list`].available(),true);
    const tool=f.tools[`hellotest_${name}_list`],args={search:'saved',...(tool.schema.shape.status?{status:'running'}:{}),...(tool.schema.shape.application_id?{application_id:'app'}:{})};
    await call(f,`hellotest_${name}_list`,args);
    const query=f.queries.at(-1)[1];assert.equal(query.entity,name);assert.deepEqual(query.filters[0],{field,op:'contains',value:'saved'});
    if(args.application_id)assert.ok(query.filters.some(item=>item.field==='app_type_id'&&item.value==='app'));
    await call(f,`hellotest_${name}_get`,{[key]:'saved-id'});
    assert.deepEqual(f.reads.at(-1)[1],{operation_id:`get-${name}`,arguments:{path:{[parameter]:'saved-id'}}});
    assert.equal(f.tools[`hellotest_${name}_get`].schema.safeParse({[key]:'saved-id',project_id:'foreign'}).success,false);
  }
});

test('updates prepare only requested fields and never inject a structured-mode default',async()=>{
  const f=fixture();
  await call(f,'hellotest_test_case_update_prepare',{test_case_id:'gherkin-case',title:'A clearer Gherkin title'});
  assert.deepEqual(f.plans[0],[actor,{operation_id:'update-case',arguments:{path:{id:'gherkin-case'},body:{title:'A clearer Gherkin title'}}}]);
  await assert.rejects(call(f,'hellotest_test_case_update_prepare',{test_case_id:'gherkin-case'}),{code:'MCP_INVALID_ARGUMENT'});
  assert.equal(f.tools.hellotest_test_case_create_prepare.schema.safeParse({app_type_id:'app',title:'Case',approved:true}).success,false);
  assert.equal(f.tools.hellotest_test_case_update_prepare.schema.safeParse({test_case_id:'case',app_type_id:'new-app'}).success,false,'The named editor must not advertise an ignored application move.');
  assert.equal(f.tools.hellotest_defect_create_prepare.schema.safeParse({title:'Broken checkout'}).success,false,'The native Defect contract requires an observed problem message.');
  assert.equal(f.tools.hellotest_defect_create_prepare.schema.safeParse({title:'Broken checkout',message:'The confirmation remains empty.',linked_test_case_ids:['case']}).success,true);
  assert.equal(f.tools.hellotest_defect_create_prepare.schema.safeParse({title:'Broken checkout',message:'Problem',test_case_id:'ignored-link'}).success,false,'Use the native linked_test_case_ids field.');
  assert.equal(f.tools.hellotest_test_run_create_prepare.schema.safeParse({test_case_ids:['case']}).success,false,'Run creation requires an explicit application scope.');
  assert.equal(f.tools.hellotest_test_run_create_prepare.schema.safeParse({app_type_id:'app',test_case_ids:['case']}).success,true);
});

test('public schema definitions are self-contained and plan annotations describe preparation rather than business effects',()=>{
  const f=fixture();
  for(const [name,tool] of Object.entries(f.tools)) {
    const schema=z.toJSONSchema(tool.schema);
    assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false,name);
    assert.doesNotMatch(JSON.stringify(schema),/"\$ref"/,name);
    if(name.endsWith('_prepare'))assert.deepEqual(contracts.annotations(name,tool),{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false});
  }
  assert.equal(contracts.annotations('hellotest_operation_execute',{write:true}).idempotentHint,true);
  assert.equal(contracts.annotations('hellotest_operation_execute',{write:true}).destructiveHint,true);
  const output=z.toJSONSchema(contracts.envelope(contracts.schemas.plan));
  assert.equal(output.properties.data.required.includes('plan_id'),true);
  assert.equal(output.properties.data.properties.preview.properties.arguments.type,'object');
});
