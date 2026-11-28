const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const registry=require('../../backend/workflows/nodeRegistry');
const connections=require('../../backend/workflows/connections');

test('every declared kind has its own complete implementation and portable presentation/scheduling contract',()=>{
  assert.deepEqual(Object.keys(registry.registry).sort(),Object.keys(registry.descriptors.kinds).sort());
  for(const[kind,node]of Object.entries(registry.registry)){
    const file=path.resolve(__dirname,'../../backend/workflows/nodes',node.executor==='flow'?'flow/'+kind+'.js':kind+'.js');
    assert.strictEqual(require(file),node,kind+' registry identity');
    assert.equal(typeof node.implementation.validate,'function');assert.equal(typeof node.implementation.execute,'function');
    assert.deepEqual(node.schema,registry.descriptors.kinds[kind].schema);assert.deepEqual(node.ui,registry.descriptors.kinds[kind].ui);
    assert.doesNotMatch(readFileSync(file,'utf8'),/require\(['"][^'"]*(?:nodeOperations|flowOperations|agenticWorkflowExecution\.service)/,kind+' cannot forward back to a family dispatcher');
  }
});

test('HTTP kind handlers execute the real bounded protocol with kind-specific method and body policy',async t=>{
  const calls=[];t.mock.method(connections,'callHttp',async input=>{calls.push(input);return{data:{accepted:true}};});
  const run={id:'run',project_id:'project',input_payload:{id:'a/b',message:'literal'}};
  await registry.get('apiTool').execute({run,node:{data:{kind:'apiTool',apiUrl:'https://api.test/{{ $request.id }}',apiMethod:'POST',apiBody:'{"message":"$request.message"}'}},sources:[]});
  await registry.get('webAgent').execute({run,node:{data:{kind:'webAgent',apiUrl:'https://web.test/',apiMethod:'POST',apiBody:'{"ignored":true}'}},sources:[]});
  assert.equal(calls[0].data.apiUrl,'https://api.test/a%2Fb');assert.equal(calls[0].data.apiMethod,'POST');assert.equal(calls[0].data.apiBody,'{"message":"literal"}');
  assert.equal(calls[1].data.apiMethod,'GET');assert.equal(calls[1].data.apiBody,'');
  assert.equal(registry.get('apiTool').isExclusive({apiMethod:'POST'}),true);assert.equal(registry.get('apiTool').isExclusive({apiMethod:'GET'}),false);
  assert.equal(registry.get('webAgent').isExclusive({apiMethod:'POST'}),false);
});

test('loop kind owns connected dispatch and bounded read-only batching without an executor-family switch',async()=>{
  const node={data:{kind:'loop',loopAction:'workflow'}},receipt={data:[{id:'saved'}]};let connected=0;
  assert.equal(registry.get('loop').connectedLoop(node.data),true);
  assert.strictEqual(await registry.get('loop').execute({run:{input_payload:{}},node,sources:[],executeConnectedLoop:async()=>{connected++;return receipt;}}),receipt);assert.equal(connected,1);
  const result=await registry.get('loop').execute({run:{input_payload:{items:[1,2,3]}},node:{data:{kind:'loop',loopAction:'transform',loopSourceKey:'request.items',loopBatchSize:2,loopMaxIterations:100,transformMapping:'{"batch":"$item"}'}},sources:[]});
  assert.deepEqual(result.data,[{batch:[1,2]},{batch:[3]}]);assert.equal(result.total_batches,2);assert.equal(result.processed,3);
});

test('kind validation, graph ports and timeout admission are owned by the registered definition',()=>{
  const repository=registry.get('repositoryAgent');
  assert.deepEqual(repository.validate({data:{kind:'repositoryAgent',repositoryAgentType:'missing',retryCount:1}}),[
    'Choose a source analysis agent.','Source analysis uses its existing worker. Set retries to zero; review a failed analysis before starting a new execution.'
  ]);
  const messages=registry.get('agent').validate({data:{kind:'agent',agentId:'not-registered',prompt:''}});
  assert.ok(messages.includes('Choose a registered workspace specialist in the step inspector.'));
  assert.ok(messages.includes('Describe the task this specialist should review.'));
  assert.ok(registry.get('condition').validate({data:{kind:'condition'}},{outgoing:[{sourceHandle:'wrong'}]}).includes('Connect condition outputs using the true or false ports.'));
  assert.equal(registry.get('trigger').connectionPolicy.incoming,'forbidden');assert.equal(registry.get('output').connectionPolicy.outgoing,'forbidden');assert.equal(registry.get('stop').connectionPolicy.outgoing,'optional');
  assert.equal(registry.get('artifactTask').timeoutMaxMs({}),3600000);assert.equal(registry.get('agent').timeoutMaxMs({}),150000);
  assert.equal(registry.get('llmAgent').timeoutMaxMs({}),70000);assert.equal(registry.get('loop').timeoutMaxMs({loopAction:'workflow'}),3600000);assert.equal(registry.get('loop').timeoutMaxMs({loopAction:'customAI'}),70000);
});

test('connection preflight dispatches only the kind-owned protocol and validates managed authorization',async t=>{
  const calls=[];t.mock.method(connections,'resolve',async(...args)=>{calls.push(args);return{connection:{methods:['GET'],tools:['read'],toolDefinitions:[{name:'read'}]}};});
  t.mock.method(connections._internals,'authHeaders',()=>({}));
  const workflow={project_id:'project'};
  await registry.get('webAgent').preflight.connection({workflow,node:{data:{connectionId:'http',apiUrl:'https://web.test/',apiMethod:'POST'}}});
  await registry.get('mcpTool').preflight.connection({workflow,node:{data:{connectionId:'mcp',mcpTool:'read'}}});
  assert.deepEqual(calls,[['http','project','https://web.test/','http'],['mcp','project',null,'mcp']]);
  await assert.rejects(registry.get('apiTool').preflight.connection({workflow,node:{data:{connectionId:'http',apiMethod:'POST'}}}),/method is not enabled/);
  await assert.rejects(registry.get('mcpTool').preflight.connection({workflow,node:{data:{connectionId:'mcp',mcpTool:'write'}}}),/Enable this tool/);
});

test('Browser Quality Agent nodes use the pinned environment and return only the validated assessment', async t => {
  const adapter = registry.get('qualityAgent');
  const quality = require('../../backend/services/qualityAgents.service');
  const environments = require('@hellotest/testing/backend/services/testEnvironment.service');
  const access = require('../../backend/workflows/artifactTasks');
  let project = 'project';
  t.mock.method(access, 'access', async (_user, projectId, permissions) => {
    assert.equal(projectId, 'project'); assert.deepEqual(permissions, ['environment.view']);
  });
  t.mock.method(environments, 'getTestEnvironment', async id => {
    assert.equal(id, 'qa');
    return {project_id: project, app_type_id: 'app', base_url: 'https://qa.example.test'};
  });
  const calls = [];
  t.mock.method(quality, 'createRun', async (request, _user, options) => {
    calls.push({request, options});
    return {id:'quality-run', kind:request.kind, status:'completed', outcome:'passed',
      agent_assessment:{summary:'Final evidence assessment'}, metrics:{pages:1},
      findings:[], limitations:[], stages:[{label:'Intermediate browser status'}], mission_progress:{percent:90}};
  });
  const run = {id:'workflow-run', project_id:'project', app_type_id:'app', iteration_path:['loop',0],
    input_payload:{path:'/catalog', quality_review:{target_url:'https://wrong.example.test', options:{credential_ref:'drop',mission:{max_actions:2,allow_form_submission:true}}}}};
  const node = {id:'journey', data:{kind:'qualityAgent', qualityAgentKind:'web', testEnvironmentId:'qa', qualityTargetPath:'$request.path'}};
  const execute = () => adapter.execute({run, node, sources:[], user:{id:'actor'}, signal:new AbortController().signal});
  const result = await execute();
  assert.equal(result.quality_run_id,'quality-run');
  assert.deepEqual(result.assessment,{summary:'Final evidence assessment'});
  assert.doesNotMatch(JSON.stringify(result), /Intermediate browser status|mission_progress/);
  assert.equal(calls[0].request.target_url,'https://qa.example.test/catalog');
  assert.deepEqual(calls[0].request.options,{mission:{max_actions:2,allow_form_submission:false}});
  assert.deepEqual(calls[0].options.workflowTrace,{run_id:'workflow-run',node_id:'journey'});
  await execute();
  assert.equal(calls[0].options.requestKey,calls[1].options.requestKey);
  run.iteration_path = ['loop',1];
  node.data.qualityAgentKind = 'security';
  await execute();
  assert.notEqual(calls[0].options.requestKey,calls[2].options.requestKey);
  assert.deepEqual(calls[2].request.options,{});
  run.input_payload.path = '//wrong.example.test/escape';
  await assert.rejects(execute,/relative page path/);
  delete run.input_payload.path;
  await assert.rejects(execute,/mapped page path is unavailable/);
  project = 'foreign';
  await assert.rejects(execute,/workflow project and application/);
  assert.equal(calls.length,3);
});
