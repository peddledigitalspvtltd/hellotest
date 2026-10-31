const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../backend');
function load(name,mocks){const file=path.join(root,name+'.js');const original=createRequire(file);const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports,file,root);return module.exports;}
const actor={user:{id:'user-a',role:'member'},projectId:'project-a',clientId:'host'};
const permit=async(a)=>{if(a.projectId!=='project-a')throw Object.assign(new Error('Denied'),{statusCode:403,code:'DENIED'});};
const fakeDb={prepare:()=>({run:async()=>{},get:async()=>undefined,all:async()=>[]})};
const backplane={catalog:async a=>({owner:a.user.id,project:a.projectId,catalog_revision:'fixture',total:0,operations:[],next_offset:null,coverage:{registered:0,discoverable:0},contract_note:'Only callable domain operations.'}),describe:async()=>({}),read:async()=>({}),context:async a=>({packet:{project_id:a.projectId,evidence:[]},owner:a.user.id}),graph:async()=>({}),prepare:async()=>({state:'requires_authorization'}),execute:async()=>({state:'requires_authorization'}),status:async()=>({state:'requires_authorization'}),bounded:value=>value,auditFailure:()=>{}};
const promptConfiguration={config:{role:'Configured investigator',domain:'Test results',task:'Investigate',prompt:'Follow published investigation guidance',guardrails:'Retain source ACLs',instruction_blocks:{'template.investigate_failure':'Published exact failure investigation'}},published_version:3};
const server=load('mcpServer',{'./backplane':backplane,'./projections':{entities:{projects:{}},schema:async()=>({}),query:async()=>({})},'./auth':{permit,fail:(message,statusCode=403,code='DENIED')=>Object.assign(new Error(message),{statusCode,code,publicMessage:message})},'@hellotest/platform/backend/src/db':fakeDb,
 '@hellotest/platform/backend/services/aiConfiguration.service':{resolve:async id=>{assert.equal(id,'ai.mcp.investigate_failure');return promptConfiguration;}}});
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
function request(body,headers={}){return new Request('http://localhost/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify(body)});}
const auth={authInfo:{token:'test',clientId:'host',scopes:[],extra:{actor}}};
test.after(()=>server.handler.close());
test('real SDK serves the modern stateless tool catalog and caller-bound results',async()=>{
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:meta}},{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'}),auth);
 assert.equal(response.status,200);const catalog=await response.json();assert.equal(catalog.result.tools.length,17);assert.ok(catalog.result.tools.every(tool=>tool.inputSchema.additionalProperties===false));assert.ok(catalog.result.tools.some(tool=>tool.name==='hellotest_browser_mission_prepare'));assert.ok(catalog.result.tools.some(tool=>tool.name==='hellotest_browser_mission_status'));assert.ok(catalog.result.tools.some(tool=>tool.name==='hellotest_graph_resolve'));
 const result=await server.callLocal(actor,'hellotest_capabilities',{});assert.equal(result.owner,'user-a');assert.equal(result.project,'project-a');
});
test('legacy initialize remains compatible without protocol session authority',async()=>{
 for(const version of ['2025-11-25','2025-06-18','2025-03-26']){
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'legacy',version:'1'}}}),auth);
 const text=await response.text();const result=JSON.parse(response.headers.get('content-type').includes('text/event-stream')?text.split('\n').find(line=>line.startsWith('data:')).slice(5):text);assert.equal(response.status,200);assert.equal(result.result.protocolVersion,version);assert.equal(response.headers.get('mcp-session-id'),null);
 }
});
test('each advertised legacy revision supports notifications, tools, resources and prompts through the real SDK',async()=>{
 const decode=async response=>{const raw=await response.text();return raw?JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')?raw.split('\n').find(line=>line.startsWith('data:')).slice(5):raw):null;};
 for(const version of ['2025-11-25','2025-06-18','2025-03-26']) {
  const headers={'MCP-Protocol-Version':version};
  const notified=await server.handler.fetch(request({jsonrpc:'2.0',method:'notifications/initialized'},headers),auth);assert.equal(notified.status,202,version);
  const list=await decode(await server.handler.fetch(request({jsonrpc:'2.0',id:3,method:'tools/list'},headers),auth));assert.ok(list.result.tools.some(tool=>tool.name==='hellotest_graph_context'),version);
  const call=await decode(await server.handler.fetch(request({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'hellotest_capabilities',arguments:{}}},headers),auth));assert.equal(call.result.structuredContent.scope.project_id,'project-a',version);
  const resource=await decode(await server.handler.fetch(request({jsonrpc:'2.0',id:5,method:'resources/read',params:{uri:'hellotest://schema'}},headers),auth));assert.equal(JSON.parse(resource.result.contents[0].text).scope.subject,'user-a',version);
  const prompt=await decode(await server.handler.fetch(request({jsonrpc:'2.0',id:6,method:'prompts/get',params:{name:'investigate_failure',arguments:{question:'the observed failed case'}}},headers),auth));assert.equal(JSON.parse(prompt.result.messages[0].content.text).instructions,'Published exact failure investigation',version);assert.match(prompt.result.messages[1].content.text,/observed failed case/,version);
 }
});
test('tool schemas reject model-supplied identity, approval and raw SQL',async()=>{
 for(const [name,args] of [['hellotest_context_build',{question:'help',user_id:'admin'}],['hellotest_operation_execute',{plan_id:'plan',approved:true}],['hellotest_database_query',{entity:'projects',sql:'SELECT * FROM users'}],['hellotest_browser_mission_prepare',{kind:'web',target_url:'https://shop.test',goal:'Inspect',password:'secret'}],['hellotest_browser_mission_status',{run_id:'run',project_id:'other'}]])await assert.rejects(server.invoke(actor,name,args),{code:'MCP_INVALID_ARGUMENT'});
 await assert.rejects(server.invoke({...actor,projectId:'project-b'},'hellotest_capabilities',{}),{code:'DENIED'});
});
test('modern transport validates mismatched method metadata',async()=>{
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:3,method:'tools/list',params:{_meta:meta}},{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call'}),auth);
 assert.equal(response.status,400);
});
test('resource-specific credentials cannot be mistaken for an app session and tampering fails',async()=>{
 const rows=new Map();const db={prepare:sql=>({run:async(...values)=>{rows.set(values[0],values);},get:async(id,user,project,client)=>{const row=rows.get(id);return row&&row[1]===user&&row[2]===project&&row[3]===client?{id}:undefined;}})};
 const real=load('auth',{'@hellotest/platform/backend/src/db':db,'@hellotest/platform/backend/src/security/runtimeSecrets':{resolveSessionSecret:()=> 'test-mcp-secret-32-characters-long-only'},'@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({id:'project-a'})},'@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},'@hellotest/platform/backend/services/featureFlag.service':{getFeatureKeysForPermission:()=>[],areEnabled:async()=>true},'@hellotest/platform/backend/services/user.service':{getUser:async id=>({id,status:'active',role:'member'})}});
 const issued=await real.issue(actor.user,actor.projectId);assert.equal(real.decode(issued.token).aud,'hellotest:mcp');assert.equal(issued.token.split('.').length,3);
 assert.equal((await real.authenticate(issued.token)).projectId,actor.projectId);
 await assert.rejects(real.authenticate(issued.token.slice(0,-1)+'!'),{code:'MCP_UNAUTHORIZED'});
 assert.throws(()=>real.decode('api-session.signature'),{code:'MCP_UNAUTHORIZED'});
 rows.clear();await assert.rejects(real.authenticate(issued.token),{code:'MCP_UNAUTHORIZED'});
});

test('bounded context preserves token budgets and provenance while removing credentials',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const result=real.bounded({max_context_tokens:2000,token_count:24,citation:{source_id:'source-a',observed_at:new Date('2026-10-06T00:00:00Z')},access_token:'private',token:'private',password:'private',headers:{Authorization:'Bearer private'},items:[{id:'a'}]});
 assert.equal(result.max_context_tokens,2000);assert.equal(result.token_count,24);assert.equal(result.citation.source_id,'source-a');assert.equal(result.citation.observed_at,'2026-10-06T00:00:00.000Z');assert.ok(!JSON.stringify(result).includes('private'));
 assert.throws(()=>real.bounded(Array.from({length:100},()=>({content:'a'.repeat(12000)}))),{code:'MCP_RESULT_TOO_LARGE'});
});

test('MCP redaction retains ContextPacket ACL provenance without retaining credential headers',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const safe=real.bounded({authorization:{project_scope_enforced:true,source_acl_enforced:true,allowed_record_permissions:['testcase.view'],token:'private',headers:{Authorization:'private'}},authorization_coverage:{fully_visible_objects:2,partially_visible_objects:0,unavailable_objects:1,secret:'private'},headers:{authorization:'Bearer private'}});
 assert.deepEqual(safe.authorization,{project_scope_enforced:true,source_acl_enforced:true,allowed_record_permissions:['testcase.view']});assert.equal(safe.authorization_coverage.fully_visible_objects,2);assert.ok(!JSON.stringify(safe).includes('private'));
});

test('bounded MCP serialization preserves typed numeric UUID identities and citations while still redacting prose and secrets',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const project='12345678-1234-4abc-8def-0123456789ab',app='12345678-1234-4567-8abc-abcdefabcdef',source=`live-project-${project}-stories`,citation=`K-${app}`;
 const safe=real.bounded({project_id:project,app_type_id:app,id:project,source_id:app,source_ref_id:project,requirement_ids:[project],source_ids:[app,source],evidence_ids:[citation],citation_ids:[`requirement:${project}`],
  evidence:[{evidence_id:citation,canonical_id:app,source_id:source,source_ref_id:project,document_id:`live-project-${project}`,content:'Call +1 415-555-0100; card 4111 1111 1111 1111; password=fixture-secret'}],
  relationship_evidence:[{source:source,target:app,evidence_ids:[citation]}],summary:project,notes:[project],custom_id:project,password:project,credential:{id:app},headers:{authorization:'Bearer fixture-token'}});
 assert.equal(safe.project_id,project);assert.equal(safe.app_type_id,app);assert.equal(safe.id,project);assert.equal(safe.source_id,app);assert.equal(safe.source_ref_id,project);
 assert.deepEqual(safe.requirement_ids,[project]);assert.deepEqual(safe.source_ids,[app,source]);assert.deepEqual(safe.evidence_ids,[citation]);assert.deepEqual(safe.citation_ids,[`requirement:${project}`]);
 assert.deepEqual({...safe.evidence[0],content:undefined},{evidence_id:citation,canonical_id:app,source_id:source,source_ref_id:project,document_id:`live-project-${project}`,content:undefined});
 assert.deepEqual(safe.relationship_evidence,[{source,target:app,evidence_ids:[citation]}]);
 assert.notEqual(safe.summary,project);assert.notEqual(safe.notes[0],project);assert.notEqual(safe.custom_id,project,'unknown identifier-looking keys do not bypass prose policy');
 assert.equal(Object.hasOwn(safe,'password'),false);assert.equal(Object.hasOwn(safe,'credential'),false);
 assert.doesNotMatch(JSON.stringify(safe),/415-555-0100|4111 1111 1111 1111|fixture-secret|fixture-token/);
 const invalid=real.bounded({project_id:'415-555-0100',source_ids:['4111 1111 1111 1111','source password=fixture-secret']});
 assert.doesNotMatch(JSON.stringify(invalid),/415-555-0100|4111 1111 1111 1111|fixture-secret/,'typed fields preserve only validated identity syntax');
});

test('numeric UUID ContextPackets round-trip through the actual bounded serializer and strict gateway without relaxing scope checks',async()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const project='12345678-1234-4abc-8def-0123456789ab';
 const gateway=load('gateway',{'./auth':{principal:async(userId,projectId)=>({user:{id:userId},projectId})}});
 let response={project_id:project,evidence:[{source_id:project,content:'Authorized selected-project evidence'}]};
 gateway.installTransport(async()=>({packet:real.bounded(response)}));
 const input={user:{id:'actor'},projectId:project,query:'Read selected Story'};
 const result=await gateway.retrievePacket(input);assert.equal(result.project_id,project);assert.equal(result.evidence[0].source_id,project);
 response={...response,project_id:'12345678-1234-4567-8abc-abcdefabcdef'};
 await assert.rejects(gateway.retrievePacket(input),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 response={project_id:project,evidence:{}};
 await assert.rejects(gateway.retrievePacket(input),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
});

test('delivery preserves validated provenance hashes and reports field and item omissions',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const hash='4155550100'+'a'.repeat(54);
 const delivery={truncated:false,redacted:false,omitted_items:0,truncated_strings:0};
 const value=real.bounded({source_hash:hash,integrity:{evidence_hash:hash},digest:hash,notes:'Call 415-555-0100',password:hash,items:Array.from({length:102},(_,i)=>i),fields:Object.fromEntries(Array.from({length:83},(_,i)=>['field'+i,i]))},delivery);
 assert.equal(value.source_hash,hash);assert.equal(value.integrity.evidence_hash,hash);assert.equal(value.digest,hash);
 assert.doesNotMatch(value.notes,/415-555-0100/);assert.equal(value.password,undefined);
 assert.equal(value.items.length,100);assert.equal(Object.keys(value.fields).length,80);
 assert.deepEqual(delivery,{truncated:true,redacted:true,omitted_items:5,truncated_strings:0});
 const malformed=real.bounded({evidence_hash:'Call 415-555-0100'});assert.doesNotMatch(malformed.evidence_hash,/415-555-0100/);
});

test('catalog discovery avoids repeated permission queries and rechecks permissions on the next request',async()=>{
 let checks=0,allowed=true;const operations=[{id:'a',method:'GET',path:'/test-cases',permission:'testcase.view'},{id:'b',method:'GET',path:'/test-cases/:id',permission:'testcase.view'}];
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit:async(a,permission)=>{await permit(a);if(permission==='testcase.view'){checks++;if(!allowed)throw Object.assign(new Error('Denied'),{statusCode:403});}},fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})},'./registry':{all:()=>operations,revision:()=> 'revision'}});
 assert.equal((await real.catalog(actor,{query:'test-cases'})).operations.length,2);assert.equal(checks,1);allowed=false;assert.equal((await real.catalog(actor,{query:'test-cases'})).operations.length,0);assert.equal(checks,2);
});

test('built-in status inspects the real SDK without executing the full capability catalog',async()=>{
 const prior=server.tools.hellotest_capabilities.run;let calls=0;server.tools.hellotest_capabilities.run=async()=>{calls++;throw new Error('Status should not execute catalog scans');};
 try{const tools=await server.inspectLocal(actor);assert.ok(tools.some(tool=>tool.name==='hellotest_context_build'));assert.equal(calls,0);}
 finally{server.tools.hellotest_capabilities.run=prior;}
});

test('the real SDK carries internal request cancellation into context retrieval',{timeout:3000},async()=>{
 const tool=server.tools.hellotest_context_build,prior=tool.run;let entered,observed;
 const started=new Promise(resolve=>entered=resolve);
 tool.run=async(_actor,_args,signal)=>{observed=signal;entered();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const controller=new AbortController();
 try{
  const pending=server.callLocal(actor,'hellotest_context_build',{question:'Read project context'},controller.signal);
  await started;controller.abort();await assert.rejects(pending);assert.equal(observed.aborted,true);
 }finally{tool.run=prior;}
});

test('the SDK advertises only callable named domain tools with typed receipts and caller-bound results',async()=>{
 const registry=require('../../backend/registry');
 for(const [method,url] of [['GET','/test-cases/:id'],['POST','/test-cases']])registry.register({method,url});
 const prior={read:backplane.read,prepare:backplane.prepare};
 const date='2026-10-31T00:00:00Z';
 backplane.read=async(actual,args)=>{assert.equal(actual,actor);assert.equal(args.arguments.path.id,'case-1');return {data:{id:'case-1',title:'Observed native Test Case'},observed_at:date,bounded:true};};
 backplane.prepare=async(actual,args)=>({plan_id:'review-plan',digest:'a'.repeat(64),state:'requires_authorization',preview:{operation:registry.get(args.operation_id),arguments:args.arguments},expires_at:date,authorization:'Review this exact plan in Agent Studio.'});
 try{
  const definitions=await server.inspectLocal(actor);
  const get=definitions.find(tool=>tool.name==='hellotest_test_cases_get'),prepare=definitions.find(tool=>tool.name==='hellotest_test_case_create_prepare');
  assert.ok(get);assert.ok(prepare);assert.ok(!definitions.some(tool=>tool.name==='hellotest_stories_get'));
  assert.equal(get.outputSchema.properties.data.properties.record.type,'object');
  assert.equal(prepare.annotations.destructiveHint,false,'Preparing creates a review plan, not the business artifact.');
  const result=await server.callLocal(actor,'hellotest_test_cases_get',{test_case_id:'case-1'});
  assert.equal(result.record.title,'Observed native Test Case');
  const planned=await server.callLocal(actor,'hellotest_test_case_create_prepare',{title:'Registration',app_type_id:'app'});
  assert.equal(planned.plan_id,'review-plan');assert.equal(planned.state,'requires_authorization');
 }finally{backplane.read=prior.read;backplane.prepare=prior.prepare;}
});
