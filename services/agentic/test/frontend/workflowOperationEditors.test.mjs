import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {workflowEditorFixture,workflowEditorRoot} from './helpers/workflowEditorFixture.mjs';
const definitions=JSON.parse(readFileSync(new URL('../../shared/workflowNodeKinds.json',import.meta.url),'utf8')).kinds;
const http={id:'http',name:'Managed HTTP',kind:'http',url:'https://api.test/base',authenticated:true,methods:['GET','POST'],tools:[],timeoutMs:12000};
const server={id:'mcp',name:'Managed MCP',kind:'mcp',url:'https://mcp.test',authenticated:true,methods:[],tools:['allowed'],toolDefinitions:[{name:'allowed',description:'Approved project tool',inputSchema:{type:'object'}},{name:'disabled',description:'Not enabled',inputSchema:{}}]};
const change=(fixture,label,value)=>fixture.control(label).props.onChange({target:{value}});

test('every canonical kind has an explicit editor owner and the canonical panel descriptor',()=>{
 const f=workflowEditorFixture(),{workflowOperationEditors,workflowOperationEditor}=f.registry();
 assert.deepEqual(Object.keys(workflowOperationEditors).sort(),Object.keys(definitions).sort());
 for(const [kind,entry]of Object.entries(workflowOperationEditors)){
  assert.deepEqual(entry.descriptor,definitions[kind]);
  assert.equal(entry.descriptor.ui.panel,definitions[kind].ui.panel);
  assert.equal(entry.owner==='operation',typeof entry.Fields==='function',kind);
  if(entry.Fields)assert.doesNotMatch(readFileSync(resolve(workflowEditorRoot,'operationEditors',entry.Fields.name+'.tsx'),'utf8'),/WorkflowOperationFields|workflowOperationEditor\(/,'A leaf cannot dispatch back into the former conditional owner');
 }
 assert.equal(workflowOperationEditor('unknown-future-kind'),undefined);
 assert.deepEqual(f.render({kind:'output'}).html,'');
});

test('inactive and flow editors do not mount model, provider or artifact-resource queries',()=>{
 const f=workflowEditorFixture();for(const kind of ['wait','stop','aggregator','loop','transform','knowledgeTool','repositoryTool','testOpsTool','log','errorHandler']){f.render({kind});assert.equal(f.queries.length,0,kind);}
 f.render({kind:'artifactTask',artifactTask:'story-assurance'});assert.ok(f.queries.every(query=>query.enabled===false));
 f.render({kind:'artifactTask',artifactTask:'automation-engineer'});assert.equal(f.queries.find(query=>query.queryKey[0]==='workflow-test-environments').enabled,true);assert.equal(f.queries.find(query=>query.queryKey[0]==='workflow-test-data-sets').enabled,false);
});

test('merge, loop and wait own their dependent initialization patches without changing literal inputs',()=>{
 const f=workflowEditorFixture();f.render({kind:'aggregator'});change(f,'Merge inputs','combineMatching');assert.deepEqual(f.patches.pop(),{mergeMode:'combineMatching',mergeMatchFields:'[{"left":"id","right":"id"}]'});
 f.render({kind:'aggregator',mergeMatchFields:'[]'});change(f,'Merge inputs','combineMatching');assert.deepEqual(f.patches.pop(),{mergeMode:'combineMatching'});
 f.render({kind:'loop',loopAction:'workflow'});change(f,'Action for each item','transform');assert.deepEqual(f.patches.pop(),{loopAction:'transform',transformMapping:'{\n  "item": "$item"\n}'});
 f.render({kind:'loop',loopAction:'transform',transformMapping:''});change(f,'Action for each item','transform');assert.deepEqual(f.patches.pop(),{loopAction:'transform'});change(f,'Maximum items','0');assert.deepEqual(f.patches.pop(),{loopMaxIterations:0});
 f.render({kind:'wait',waitMs:0,timeoutMs:'1000'});assert.equal(f.control('Wait duration (ms)').props.value,'0');change(f,'Wait duration (ms)','2000');assert.deepEqual(f.patches.pop(),{waitMs:2000,timeoutMs:'3000'});change(f,'Wait duration (ms)','');assert.deepEqual(f.patches.pop(),{waitMs:''});
});

test('managed HTTP connections clear legacy secrets, bind Sprint scope and retain read-only web methods',()=>{
 const f=workflowEditorFixture({connections:[http]});f.render({kind:'apiTool',connectionId:'',credentialId:'old',apiAuth:'old',apiResource:'sprintStories'});change(f,'API connection','http');assert.deepEqual(f.patches.pop(),{connectionId:'http',credentialId:'',apiAuth:'',timeoutMs:'12000',apiUrl:'https://api.test/base/requirements?project_id=project&sprint_id=sprint&include_page=true&page_size=20',apiMethod:'GET'});
 f.render({kind:'apiAgent',connectionId:'http',apiMethod:'POST',apiBody:'{"flag":false}'});assert.equal(f.control('Request body JSON').props.value,'{"flag":false}');change(f,'Request body JSON','');assert.deepEqual(f.patches.pop(),{apiBody:''});
 f.render({kind:'webAgent',connectionId:'http'});assert.equal(f.control('HTTP method').props.children.length,1);change(f,'API connection','http');assert.equal(f.patches.pop().apiMethod,'GET');
});

test('MCP tool editor advertises only project-enabled tools and respects execution permission',()=>{
 const f=workflowEditorFixture({connections:[server],tools:server.toolDefinitions});const view=f.render({kind:'mcpTool',connectionId:'mcp',mcpTool:'allowed'});assert.match(view.html,/Approved project tool/);assert.doesNotMatch(view.html,/>disabled<|Not enabled/);assert.match(view.html,/Server input schema/);
 change(f,'MCP server','mcp');assert.deepEqual(f.patches.pop(),{connectionId:'mcp',apiAuth:'',credentialId:'',mcpTool:'',mcpArguments:'{}'});
 const reader=workflowEditorFixture({connections:[server],canRun:false});assert.doesNotMatch(reader.render({kind:'mcpTool',connectionId:'mcp'}).html,/Load server tools|Refresh server tools/);assert.equal(reader.queries.find(query=>query.queryKey[0]==='workflow-mcp-tools').enabled,false);
 assert.match(f.render({kind:'mcpTool',connectionId:'mcp',mcpTool:'disabled'}).html,/This tool is no longer enabled/);
});

test('native task editor preserves defaults, source options, dataset identity and environment scope',async()=>{
 const f=workflowEditorFixture({testDataSets:[{id:'data',name:'Case rows'}],testEnvironments:[{id:'environment',name:'QA',base_url:'https://qa.test',variables:[{name:'password',is_secret:true}]}]});
 f.render({kind:'artifactTask',artifactTask:'test-case-generation'});assert.equal(f.control('Test Cases per Story').props.value,'4');assert.equal(f.control('Test Case format').props.value,'gherkin');change(f,'Test Cases per Story','');assert.deepEqual(f.patches.pop(),{maxCasesPerStory:''});
 f.render({kind:'artifactTask',artifactTask:'test-data-generator',testDataSource:'dataset',testDataSetId:'missing'});assert.match(f.control('Test Data Set').props.children.map(child=>typeof child==='object'?child?.props?.children:child).flat().join(' '),/Unavailable Test Data Set/);await f.queries.find(query=>query.queryKey[0]==='workflow-test-data-sets').queryFn({signal:new AbortController().signal});assert.deepEqual(f.calls[0][1],{project_id:'project',app_type_id:'app'});
 const view=f.render({kind:'artifactTask',artifactTask:'automation-engineer',testEnvironmentId:'environment'});assert.match(view.html,/1 variables, including protected values/);assert.equal(f.control('Browser generation').props.value,'read_only');assert.equal(f.control('Readiness handling').props.value,'verify-inputs');change(f,'Test Environment','');assert.deepEqual(f.patches.pop(),{testEnvironmentId:''});
 change(f,'Native task','test-case-generation');assert.equal(f.patches.at(-1).prompt,'');assert.equal(f.patches.at(-1).artifactTask,'test-case-generation');
});
