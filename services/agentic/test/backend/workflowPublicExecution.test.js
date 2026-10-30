const test = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../../backend/routes/agenticWorkflows.routes');
const workflows = require('../../backend/services/agenticWorkflow.service');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const projects = require('@hellotest/platform/backend/public/projectAccess');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');

test('workflow execution API exposes owned node I/O while retaining private lineage for native acceptance', async t => {
  const registered = new Map();
  const app = { ...Object.fromEntries(['get','post','put','delete'].map(method=>[method,(path,...args)=>registered.set(`${method} ${path}`,args.at(-1))])),
    authenticate:async()=>{},validate:()=>{},requirePermission:()=>async()=>{} };
  const internal = { id:'run',project_id:'project-a',node_results:[{node_id:'native',output:{data:[{owned:'case'}]},execution_context:{data:[{story_id:'s',story_revision:'r',earlier_review:'private lineage'}]}}] };
  t.mock.method(projects,'getProject',async()=>({id:'project-a'}));
  t.mock.method(workflows,'getWorkflow',async()=>({id:'workflow',project_id:'project-a'}));
  t.mock.method(workflows,'getWorkflowRun',async()=>internal);
  t.mock.method(workflows,'listWorkflowRuns',async()=>[internal]);
  t.mock.method(runtime,'start',async()=>internal);
  t.mock.method(runtime,'cancel',async()=>internal);
  await routes(app);
  const req={user:{id:'user'},params:{id:'run'},query:{project_id:'project-a'},body:{}};
  const run=await registered.get('get /agentic-workflow-runs/:id')(req);
  const list=await registered.get('get /agentic-workflow-runs')(req);
  const cancelled=await registered.get('post /agentic-workflow-runs/:id/cancel')(req);
  let started;
  await registered.get('post /agentic-workflows/:id/executions')(req,{code:()=>({send:value=>{started=value;}})});
  for(const value of [run,list[0],cancelled,started]) {
    assert.deepEqual(value.node_results[0].output,{data:[{owned:'case'}]});
    assert.equal(Object.hasOwn(value.node_results[0],'execution_context'),false);
    assert.equal(JSON.stringify(value).includes('private lineage'),false);
  }
  assert.equal(internal.node_results[0].execution_context.data[0].earlier_review,'private lineage','HTTP projection cannot mutate the recorded acceptance checkpoint');
});

test('workflow execution routes recheck automation source permission and feature access without hiding unrelated stages',async t=>{
  const registered=new Map();
  const app={...Object.fromEntries(['get','post','put','delete'].map(method=>[method,(path,...args)=>registered.set(`${method} ${path}`,args.at(-1))])),
    authenticate:async()=>{},validate:()=>{},requirePermission:()=>async()=>{}};
  const code='const private_generated_source = "protected-playwright-content";';
  const automation={artifact_task:'automation-engineer',data:[{story_id:'s',automation:[{executable:{language:'typescript',code},steps:[{step_type:'web',automation_code:code}]}]}]};
  const internal={id:'run',project_id:'project-a',created_by:'original-author',workflow_snapshot:{nodes:[{id:'manual',data:{artifactTask:'test-case-generation'}},{id:'automation',data:{artifactTask:'automation-engineer'}},{id:'derived',data:{kind:'transform'}},{id:'finish',data:{kind:'agent',agentId:'automation-engineer'}}],
    edges:[{source:'manual',target:'automation'},{source:'automation',target:'derived'},{source:'derived',target:'finish'}]},node_results:[
      {node_id:'manual',output:{data:[{title:'Readable manual case',steps:[{action:'Open account',automation_code:null,api_request:null}]}],code:'ordinary-code-field'}},
      {node_id:'automation',input:{input:[{case_assurance:{summary:'Readiness assessed'}}]},output:automation,progress:{completed_items:automation.data},execution_context:{data:[{private:code}]}},
      {node_id:'derived',input:{input:automation.data,upstream:[{preview:JSON.stringify(automation)}]},output:{data:code},logs:[{message:code}]},
      {node_id:'finish',input:{input:code},output:{data:code}}],output_payload:{status:'completed',completed_steps:4,results:[{node_id:'finish',output:{data:code}}]}};
  t.mock.method(projects,'getProject',async()=>({id:'project-a'}));
  t.mock.method(workflows,'getWorkflow',async()=>({id:'workflow',project_id:'project-a'}));
  t.mock.method(workflows,'getWorkflowRun',async()=>internal);
  t.mock.method(workflows,'listWorkflowRuns',async()=>[internal,{...internal,id:'run-two'}]);
  t.mock.method(runtime,'start',async()=>internal);t.mock.method(runtime,'cancel',async()=>internal);
  let canView=true,canCode=false,disabled=[];
  const checks=[];
  t.mock.method(flags,'getDisabledPermissionCodes',async()=>disabled);
  t.mock.method(permissions,'hasPermission',async(user,permission,project)=>{
    checks.push({user:user.id,permission,project});return permission==='automation.view'?canView:canCode;
  });
  await routes(app);
  const req={user:{id:'current-reader'},params:{id:'run'},query:{project_id:'project-a'},body:{}};
  const read=()=>registered.get('get /agentic-workflow-runs/:id')(req);
  const restricted=await read();
  const listed=await registered.get('get /agentic-workflow-runs')(req);
  const cancelled=await registered.get('post /agentic-workflow-runs/:id/cancel')(req);
  let started;await registered.get('post /agentic-workflows/:id/executions')(req,{code:()=>({send:value=>{started=value;}})});
  for(const run of [restricted,...listed,cancelled,started]) {
    assert.equal(JSON.stringify(run).includes('protected-playwright-content'),false);
    assert.equal(run.node_results[0].output.code,'ordinary-code-field');
    assert.equal(run.node_results[0].output.data[0].title,'Readable manual case');
    assert.deepEqual(run.node_results[1].input,internal.node_results[1].input,'Source-free prior native task input remains readable');
    for(const index of [1,2,3]) assert.equal(run.node_results[index].output.automation_source_hidden,true);
    assert.equal(run.node_results[1].progress.automation_source_hidden,true);
    assert.equal(run.node_results[2].input.automation_source_hidden,true);
    assert.equal(run.node_results[3].input.automation_source_hidden,true,'A subsequent Automation Engineer also inherits the source permission boundary');
    assert.deepEqual(run.node_results[2].logs,[],'Derived free-text logs cannot bypass code permission');
    assert.equal(run.output_payload.automation_source_hidden,true);
    assert.equal(Object.hasOwn(run.node_results[1],'execution_context'),false);
  }
  assert.equal(checks.length,8,'Each response checks each permission once per project, including multi-run lists');
  assert.ok(checks.every(check=>check.user==='current-reader'&&check.project==='project-a'),'Access belongs to the current reader, rather than the original actor');
  canCode=true;
  const allowed=await read();assert.equal(allowed.node_results[1].output.data[0].automation[0].executable.code,code);
  assert.equal(allowed.node_results[2].output.data,code);
  disabled=['automation.code.view'];
  assert.equal((await read()).node_results[1].output.automation_source_hidden,true,'A disabled code feature overrides a previously granted permission');
  disabled=[];canView=false;
  assert.equal((await read()).node_results[1].output.automation_source_hidden,true,'Automation view is also required');
  assert.equal(internal.node_results[1].output.data[0].automation[0].executable.code,code,'Projection cannot mutate the recorded checkpoint');
});

test('workflow execution projection protects API automation steps and legacy specialist prose',async t=>{
  t.mock.method(flags,'getDisabledPermissionCodes',async()=>[]);
  t.mock.method(permissions,'hasPermission',async()=>false);
  const {publicRun}=require('../../backend/workflows/executionReadAccess');
  const native=await publicRun({project_id:'p',node_results:[{node_id:'api',output:{steps:[{step_type:'api',api_request:{method:'POST',url:'https://internal.test/protected-api'}}]}}]}, {id:'reader'});
  assert.equal(native.node_results[0].output.automation_source_hidden,true);
  assert.equal(JSON.stringify(native).includes('protected-api'),false);
  const specialist=await publicRun({project_id:'p',node_results:[{node_id:'specialist',specialist_id:'automation-engineer',output:{response:'```ts\nconst legacy_private_source=true\n```'}}],output_payload:{reviews:[{node_id:'specialist',response:'legacy_private_source'}]}},{id:'reader'});
  assert.equal(JSON.stringify(specialist).includes('legacy_private_source'),false);
  assert.equal(specialist.node_results[0].output.automation_source_hidden,true);
});
