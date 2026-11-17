const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const sets=require('../../backend/toolSets');

test('there are four tool sets, and only knowledge and records are read-only defaults',()=>{
 assert.deepEqual(sets.SET_IDS,['knowledge','records','actions','automation']);
 assert.deepEqual(sets.SET_IDS.filter(id=>sets.SETS[id].read_only),['knowledge','records']);
 assert.deepEqual([...sets.DEFAULT_SCOPES],['knowledge','records']);
 assert.ok(sets.DEFAULT_SCOPES.every(id=>sets.SETS[id].read_only),'a credential is read-only unless a writing set is asked for');
});

test('scopes are completed with what they require, ordered, deduplicated and strictly validated',()=>{
 assert.deepEqual(sets.normalizeScopes(),['knowledge','records']);
 assert.deepEqual(sets.normalizeScopes(['actions']),['records','actions'],'preparing a change starts from discovery');
 assert.deepEqual(sets.normalizeScopes(['automation','knowledge','automation']),['knowledge','records','automation']);
 assert.deepEqual(sets.normalizeScopes('knowledge'),['knowledge']);
 for(const bad of [[],['admin'],['actions','*'],[null],[1],{},'',null,['KNOWLEDGE'],Array(20).fill('records')]){
  assert.throws(()=>sets.normalizeScopes(bad),{code:'MCP_INVALID_SCOPE',statusCode:400},JSON.stringify(bad));
 }
});

test('tools classify by exact name or generated shape, and anything else belongs to no set',()=>{
 const expected={
  hellotest_context_build:'knowledge',hellotest_graph_trace:'knowledge',hellotest_knowledge_collections_list:'knowledge',hellotest_knowledge_source_get:'knowledge',
  hellotest_capabilities:'records',hellotest_database_query:'records',hellotest_stories_list:'records',hellotest_test_cases_get:'records',hellotest_project_get:'records',
  hellotest_operation_prepare:'actions',hellotest_operation_execute:'actions',hellotest_operation_status:'actions',hellotest_story_create_prepare:'actions',hellotest_defect_update_prepare:'actions',
  hellotest_automation_engineer_prepare:'automation',hellotest_browser_mission_status:'automation'
 };
 for(const [name,set] of Object.entries(expected))assert.equal(sets.setOf(name),set,name);
 for(const unknown of ['hellotest_story_delete_prepare','hellotest_graph_expand','other_tool','hellotest_','hellotest_Stories_list','hellotest_x_get; DROP'])assert.equal(sets.setOf(unknown),null,unknown);
});

test('a credential sees a tool only through a set it holds, and a writing tool is never served from a read-only set',()=>{
 const read=['knowledge','records'],all=sets.SET_IDS;
 assert.equal(sets.permits(read,'hellotest_context_build'),true);
 assert.equal(sets.permits(read,'hellotest_operation_prepare'),false);
 assert.equal(sets.permits(read,'hellotest_automation_engineer_status'),false);
 assert.equal(sets.permits(all,'hellotest_operation_prepare'),true);
 assert.equal(sets.permits(['knowledge'],'hellotest_capabilities'),false,'records is a separate grant');
 assert.equal(sets.permits(all,'brand_new_tool'),false,'an unclassified tool is published to no scoped credential');
 assert.equal(sets.permits(undefined,'hellotest_context_build'),false);
 assert.equal(sets.permits('knowledge','hellotest_context_build'),false,'scopes must be a list');
 // The name looks like a read, but the tool can write: it stays out of the read-only set.
 assert.equal(sets.permits(all,'hellotest_story_get',{write:true}),false);
 assert.equal(sets.permits(all,'hellotest_story_get',{write:false}),true);
});

test('an internal call is scoped to exactly the set its tool needs',()=>{
 assert.deepEqual(sets.scopesFor('hellotest_context_build'),['knowledge']);
 assert.deepEqual(sets.scopesFor('hellotest_operation_prepare'),['records','actions']);
 assert.deepEqual(sets.scopesFor('hellotest_automation_engineer_prepare'),['records','automation']);
 assert.equal(sets.scopesFor('unknown_tool'),null);
});

test('a retired tool names its replacement',()=>{
 assert.match(sets.retiredReplacement('hellotest_graph_expand'),/hellotest_graph_context/);
 assert.equal(sets.retiredReplacement('hellotest_context_build'),null);
});

test('the catalog check reports unclassified tools and writing tools in read-only sets',()=>{
 assert.deepEqual(sets.problems({hellotest_context_build:{},hellotest_operation_prepare:{write:true}}),[]);
 assert.deepEqual(sets.problems({mystery:{}}),['mystery belongs to no tool set']);
 assert.match(sets.problems({hellotest_story_get:{write:true}})[0],/can write but is classified into the read-only records set/);
});

// --- the real catalog -------------------------------------------------------------------------------------

const root=path.resolve(__dirname,'../../backend');
const load=(name,mocks)=>{const file=path.join(root,name+'.js');const original=createRequire(file);const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports,file,root);return module.exports;};
const server=load('mcpServer',{'./backplane':{},'./projections':{entities:{},schema:async()=>({}),query:async()=>({})},'./auth':{permit:async()=>{},fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})},
 '@hellotest/platform/backend/src/db':{prepare:()=>({run:async()=>{}})}});
test.after(()=>server.handler.close());

test('every published tool belongs to exactly one set, and no writing tool is in a read-only set',()=>{
 const names=Object.keys(server.tools);
 assert.ok(names.length>60,`expected the full catalog, found ${names.length}`);
 assert.deepEqual(sets.problems(server.tools),[],'classify a new tool in toolSets.js before publishing it');
 const described=sets.describe(server.tools);
 assert.equal(described.reduce((sum,set)=>sum+set.tool_count,0),names.length,'the sets partition the catalog');
 assert.ok(described.every(set=>set.tool_count>0));
 const writers=names.filter(name=>server.tools[name].write);
 assert.ok(writers.length>=10);
 assert.ok(writers.every(name=>['actions','automation'].includes(sets.setOf(name))),`writing tools: ${writers.filter(name=>!['actions','automation'].includes(sets.setOf(name)))}`);
});

test('the default read-only credential reaches no tool that can write, prepare or execute',()=>{
 const reachable=Object.entries(server.tools).filter(([name,tool])=>sets.permits(sets.DEFAULT_SCOPES,name,tool));
 assert.ok(reachable.length>40);
 assert.deepEqual(reachable.filter(([,tool])=>tool.write).map(([name])=>name),[]);
 assert.deepEqual(reachable.map(([name])=>name).filter(name=>/_prepare$|_execute$|_status$/.test(name)),[],'prepare, execute and plan or build status tools are not read-only defaults');
});

test('the writing sets list exactly the tools that can prepare or run a change, so a new one is a deliberate edit',()=>{
 const members=id=>Object.keys(server.tools).filter(name=>sets.setOf(name)===id).sort();
 assert.deepEqual(members('automation'),['hellotest_automation_engineer_prepare','hellotest_automation_engineer_status','hellotest_automation_parameter_plan_prepare','hellotest_browser_mission_prepare','hellotest_browser_mission_status']);
 assert.deepEqual(members('actions'),['hellotest_defect_create_prepare','hellotest_defect_update_prepare','hellotest_operation_execute','hellotest_operation_prepare','hellotest_operation_status','hellotest_story_create_prepare','hellotest_story_update_prepare',
  'hellotest_test_case_create_prepare','hellotest_test_case_update_prepare','hellotest_test_run_create_prepare','hellotest_test_suite_create_prepare','hellotest_test_suite_update_prepare']);
});

test('the retired one-hop graph tool is gone and its replacement is published',()=>{
 assert.equal('hellotest_graph_expand' in server.tools,false);
 assert.ok('hellotest_graph_context' in server.tools&&'hellotest_graph_resolve' in server.tools&&'hellotest_graph_trace' in server.tools);
});
