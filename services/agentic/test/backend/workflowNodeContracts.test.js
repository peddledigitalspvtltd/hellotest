const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const operations = require('../../backend/workflows/nodeOperations');
const connections = require('../../backend/workflows/connections');
const tasks = require('../../backend/workflows/artifactTasks');
const { generationOptions } = require('../../backend/workflows/generationNodeOptions');

const node = (id, kind, data = {}) => ({id, type:'agenticStep', data:{kind, label:id, retryCount:0, ...data}});
const edge = (source, target, sourceHandle, targetHandle) => ({source,target,...(sourceHandle?{sourceHandle}:{}),...(targetHandle?{targetHandle}:{})});
const workflow = (nodes, edges) => ({id:'workflow',project_id:'project',app_type_id:'app',status:'draft',trigger_kind:'manual',settings:{},nodes,edges});

test('all 23 exposed node kinds have valid implemented readiness paths, including loop ports and error routes', () => {
  const definitions = {
    artifactTask:{artifactTask:'story-assurance'}, customAI:{prompt:'Review the selected evidence.'},
    mcpTool:{connectionId:'managed-mcp',mcpTool:'read'},repositoryAgent:{repositoryAgentType:'api_tests'},
    trigger:{},agent:{agentId:'quality-evaluator',prompt:'Review the selected evidence.'},
    llmAgent:{agentId:'quality-evaluator',prompt:'Review the selected evidence.'},webAgent:{apiUrl:'https://example.test/api'},
    apiAgent:{apiUrl:'https://example.test/api'},apiTool:{apiUrl:'https://example.test/api'},knowledgeTool:{},repositoryTool:{},testOpsTool:{testOpsAction:'read-runs'},
    condition:{conditionOperator:'equals',conditionPath:'input.ready',conditionValue:'true'},loop:{loopAction:'workflow',loopSourceKey:'input.items',loopMaxIterations:100,loopBatchSize:1},
    aggregator:{mergeMode:'waitAllAppend'},transform:{transformMapping:'{"value":"$input"}'},dataOperation:{dataOperation:'editFields'},
    wait:{waitMs:0},stop:{stopMessage:'Stop because the configured condition was reached.'},errorHandler:{},log:{},output:{}
  };
  const source = ts.createSourceFile('workflowGraph.ts',fs.readFileSync(require.resolve('../../frontend/workflows/workflowGraph.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const declared=source.statements.find(item=>ts.isTypeAliasDeclaration(item)&&item.name.text==='WorkflowNodeKind');
  assert.deepEqual(Object.keys(definitions).sort(),declared.type.types.map(item=>item.literal.text).sort(),'Every exposed node kind must have a reviewed fixture');
  for(const [kind,data] of Object.entries(definitions)) {
    const start=node('start','trigger'),task=node('task',kind,data),finish=node('finish','output');
    let nodes=[start,task,finish],edges=[edge('start','task'),edge('task','finish')];
    if(['trigger','output'].includes(kind)){nodes=[start,finish];edges=[edge('start','finish')];}
    if(kind==='condition')edges[1].sourceHandle='true';
    if(kind==='loop'){
      nodes.push(node('body','transform',{transformMapping:'{"value":"$input"}'}));
      edges=[edge('start','task'),edge('task','body','loop'),edge('body','task',undefined,'continue'),edge('task','finish','done')];
    }
    if(kind==='errorHandler'){
      const risky=node('risky','transform',{transformMapping:'{"value":"$input"}',onError:'errorOutput'});nodes.push(risky);
      edges=[edge('start','risky'),edge('risky','task'),edge('risky','finish'),edge('task','finish')];
    }
    const report=runtime.readiness(workflow(nodes,edges));
    assert.equal(report.ready,true,`${kind}: ${JSON.stringify(report.blockers)}`);
  }
});

test('typed comparison values preserve false, zero and null and malformed raw values cannot select another branch',async()=>{
  for(const expected of [false,0,null,'', {ready:false},[0,false]]) {
    const definition=node('condition','condition',{conditionPath:'input.value',conditionOperator:'equals',conditionValue:JSON.stringify(expected)});
    assert.deepEqual(operations.validate(definition),[]);
    const result=await operations.execute({run:{input_payload:{}},node:definition,sources:[{node_id:'source',output:{data:{value:expected}}}]});
    assert.equal(result.matched,true,JSON.stringify(expected));
  }
  for(const value of [false,true,0,1,null,{},[]]) {
    const definition=node('condition','condition',{conditionPath:'input.value',conditionValue:value});
    assert.ok(operations.validate(definition).some(message=>/Comparison value must be JSON/.test(message)),JSON.stringify(value));
    await assert.rejects(operations.execute({run:{input_payload:{}},node:definition,sources:[]}),/Comparison value must be JSON/);
  }
});

test('changing an HTTP node to a data node cannot dispatch its retained Sprint resource settings',async t=>{
  let calls=0;t.mock.method(connections,'callHttp',async()=>{calls++;throw Error('A transformation cannot dispatch HTTP');});
  const definition=node('mapped','transform',{transformMapping:'{"value":"$input.value"}',apiResource:'sprintStories',apiPagination:'legacy-stale'});
  assert.deepEqual(operations.validate(definition),[]);
  const result=await operations.execute({run:{project_id:'project',input_payload:{}},node:definition,sources:[{node_id:'source',output:{data:{value:0}}}]});
  assert.deepEqual(result,{data:{value:0}});assert.equal(calls,0);
});

test('mapping configuration rejects reserved fields and prototype paths during readiness, before tool dispatch',()=>{
  for(const definition of [
    node('map','transform',{transformMapping:'{"value":"$input.constructor.secret"}'}),
    node('map','transform',{transformMapping:'{"__proto__":{"polluted":true}}'}),
    node('loop','loop',{loopAction:'transform',loopMaxIterations:2,transformMapping:'{"value":"$item.__proto__.secret"}'}),
    node('mcp','mcpTool',{connectionId:'managed-mcp',mcpTool:'read',mcpArguments:'{"value":"$input.constructor.secret"}'}),
    node('http','apiTool',{apiUrl:'https://example.test/items',apiMethod:'POST',apiBody:'{"value":"$input.prototype.secret"}'})
  ])assert.ok(operations.validate(definition).some(message=>/prototype|reserved/.test(message)),definition.id);
  assert.equal({}.polluted,undefined);
});

test('Web evidence always validates and dispatches GET, ignoring a retained write body',async t=>{
  let request;t.mock.method(connections,'callHttp',async input=>{request=input;return{status:200,data:{available:true}};});
  const definition=node('web','webAgent',{apiUrl:'https://example.test/items',apiMethod:'POST',apiBody:'stale invalid JSON',retryCount:1});
  assert.deepEqual(operations.validate(definition),[]);
  await operations.execute({run:{project_id:'project',input_payload:{}},node:definition,sources:[]});
  assert.equal(request.data.apiMethod,'GET');assert.equal(request.data.apiBody,'');
  assert.ok(operations.validate(node('write','apiTool',{apiUrl:'https://example.test/items',apiMethod:'POST',apiPagination:'cursor'})).some(message=>/only for HTTP GET/.test(message)));
});

test('an explicitly malformed HTTP method cannot silently become a GET request',async t=>{
  let calls=0;t.mock.method(connections,'callHttp',async()=>{calls++;throw Error('Invalid methods cannot dispatch HTTP');});
  for(const kind of ['apiTool','apiAgent'])for(const method of [false,true,0,1,null,{},[],['GET'],'',' ']){
    const definition=node('http',kind,{apiUrl:'https://example.test/items',apiMethod:method});
    assert.ok(operations.validate(definition).some(message=>/HTTP method/.test(message)),`${kind}: ${JSON.stringify(method)}`);
    await assert.rejects(operations.execute({run:{project_id:'project',input_payload:{}},node:definition,sources:[]}),/HTTP method/);
  }
  assert.equal(calls,0);
  assert.deepEqual(operations.validate(node('web','webAgent',{apiUrl:'https://example.test/items',apiMethod:false})),[],'Web evidence ignores an obsolete method field and always uses GET');
});

test('normalized read methods avoid mutation journaling while writes still require an operation identity',async t=>{
  const permissions=require('@hellotest/platform/backend/services/permission.service'),flags=require('@hellotest/platform/backend/services/featureFlag.service');
  t.mock.method(permissions,'hasPermission',async()=>true);t.mock.method(flags,'areEnabled',async()=>true);
  t.mock.method(connections,'callHttp',async({data})=>({status:200,data:{method:data.apiMethod}}));
  let mutations=0;t.mock.method(require('../../backend/workflows/operationJournal'),'invoke',async(_input,callback)=>{mutations++;return callback();});
  for(const method of [' get ','head','options','post']){
    const definition=node('http','apiTool',{apiUrl:'https://example.test/items',apiMethod:method,timeoutMs:1000});
    assert.deepEqual(operations.validate(definition),[]);
    const run={id:'run',project_id:'project',input_payload:{},node_results:[],workflow_snapshot:{nodes:[definition],edges:[]}};
    const result=await runtime._internals.executeNode(run,definition,{id:'reader'},new AbortController().signal,async()=>{});
    assert.equal(result.data.method,method.trim().toUpperCase());
  }
  assert.equal(mutations,1);
});

test('invalid Sprint identifiers and count types stop native generation before any model request',()=>{
  const run={project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint'}};
  for(const sprint of [true,1,{},[],['sprint'],' sprint','sprint\n','x'.repeat(256)]) assert.throws(()=>tasks.checkInput({...run,input_payload:{sprint_id:sprint}}),/Supply sprint_id/);
  for(const count of [true,false,[1],{value:1}]){
    assert.throws(()=>generationOptions({maxCasesPerStory:count}),/Choose 1–10/);
    assert.throws(()=>tasks.checkInput({...run,input_payload:{sprint_id:'sprint',max_cases_per_story:count}}),/Choose 1–10/);
  }
  assert.equal(generationOptions({maxCasesPerStory:'10'}).maxCases,10);
  assert.doesNotThrow(()=>tasks.checkInput(run));
});

test('node retries, deadlines and parallel settings reject boolean and array coercion',()=>{
  const start=node('start','trigger'),task=node('task','agent',{agentId:'quality-evaluator',prompt:'Review evidence.'}),finish=node('finish','output');
  for(const patch of [{retryCount:true},{retryCount:[1]},{retryDelayMs:true},{retryDelayMs:[1]},{timeoutMs:[1000]},{timeoutMs:1000.5}]){
    const report=runtime.readiness(workflow([start,{...task,data:{...task.data,...patch}},finish],[edge('start','task'),edge('task','finish')]));
    assert.equal(report.ready,false,JSON.stringify(patch));
    assert.ok(report.blockers.some(blocker=>blocker.node_id==='task'));
  }
  for(const settings of [{max_parallel_nodes:[2]},{maxDurationMs:[1000]}]){
    const definition=workflow([start,finish],[edge('start','finish')]);definition.settings=settings;
    assert.equal(runtime.readiness(definition).ready,false);
  }
});
