const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const path = require('node:path');

const stories = [
  {id:'canonical-story',display_id:'Req_825',project_id:'sample-project',title:'Read the API readiness contract',additional_fields:'{"acceptance_criteria":["Readiness is reported"]}'},
  {id:'other-story',display_id:'Req_825',project_id:'other-project',title:'Private other-project Story'}
];
function loadService(rows = stories) {
  const calls = [], file = path.resolve(__dirname,'../../backend/services/requirement.service.js'),local = createRequire(file),service = {};
  const db = {prepare(sql) {return {
    get:async (...args)=>{calls.push({sql,args,method:'get'});return rows.find(row=>row.id===args[0]);},
    all:async (...args)=>{
      calls.push({sql,args,method:'all'});
      if (!sql.includes('WHERE project_id = ? AND (id = ? OR display_id = ?)')) return [];
      return rows.filter(row=>row.project_id===args[0]&&(row.id===args[1]||row.display_id===args[2]))
        .sort((a,b)=>Number(a.id!==args[3])-Number(b.id!==args[3])).slice(0,2);
    }
  };}};
  new Function('require','exports',fs.readFileSync(file,'utf8'))(id=>id==='@hellotest/platform/backend/src/db'?db:local(id),service);
  return {service,calls};
}
async function routeFixture(t) {
  const {service,calls} = loadService(),file = path.resolve(__dirname,'../../backend/routes/requirements.routes.js'),local = createRequire(file),moduleObject={exports:{}};
  const Fastify = createRequire(path.resolve(__dirname,'../../../platform/backend/package.json'))('fastify');
  const app = Fastify({logger:false}),events=[],state={authenticated:true,denied:null,projectDenied:false},metrics=[];
  app.decorateRequest('user',null);
  app.decorate('authenticate',async req=>{events.push('authenticate');if(!state.authenticated)throw Object.assign(new Error('Unauthorized'),{statusCode:401});req.user={id:'viewer',role:'member'};});
  app.decorate('validate',require('../../../platform/backend/src/plugins/validator').validateInput);
  app.decorate('requirePermission',(code,scope)=>async()=>{events.push({permission:code,project:scope.projectId});if(state.denied===code)throw Object.assign(new Error('Forbidden'),{statusCode:403});});
  new Function('require','module',fs.readFileSync(file,'utf8'))(id=>{
    if(id==='../services/requirement.service')return service;
    if(id==='@hellotest/platform/backend/public/projectAccess')return {getProject:async project=>{events.push({project});if(state.projectDenied)throw Object.assign(new Error('Forbidden'),{statusCode:403});return {id:project};}};
    if(id==='../services/requirementCatalog.service')return {withCatalogMetrics:async(rows,query)=>{metrics.push({rows,query});return rows;}};
    return local(id);
  },moduleObject);
  await moduleObject.exports(app);
  await app.ready();t.after(()=>app.close());
  return {app,calls,events,state,metrics};
}

test('project-scoped Story display IDs resolve to the canonical record with no cross-project fallback',async()=>{
  const {service,calls}=loadService();
  const first=await service.getRequirement('Req_825',{projectId:'sample-project',includeLinkedRecords:false});
  const second=await service.getRequirement('Req_825',{projectId:'other-project',includeLinkedRecords:false});
  assert.equal(first.id,'canonical-story');assert.equal(second.id,'other-story');
  assert.deepEqual(first.acceptance_criteria,['Readiness is reported']);
  assert.deepEqual(calls.map(call=>call.args),[['sample-project','Req_825','Req_825','Req_825'],['other-project','Req_825','Req_825','Req_825']]);
  await assert.rejects(service.getRequirement('canonical-story',{projectId:'other-project'}),{statusCode:404});
  await assert.rejects(service.getRequirement('Req_825',{projectId:'unknown-project'}),{statusCode:404});
});

test('legacy internal canonical-ID callers retain their exact lookup and linked-record option',async()=>{
  const {service,calls}=loadService();
  const record=await service.getRequirement('canonical-story',{includeLinkedRecords:false});
  assert.equal(record.id,'canonical-story');assert.equal(Object.hasOwn(record,'test_case_ids'),false);
  assert.equal(calls[0].method,'get');assert.match(calls[0].sql,/WHERE id = \?/);assert.doesNotMatch(calls[0].sql,/display_id/);
  const hydrated=await service.getRequirement('canonical-story');assert.deepEqual(hydrated.test_case_ids,[]);
  await assert.rejects(service.getRequirement('Req_825'),{statusCode:404},'An unscoped display reference never searches other projects.');
});

test('ambiguous scoped display references fail explicitly while an exact canonical ID wins',async()=>{
  const {service}=loadService([...stories,{id:'duplicate',display_id:'Req_825',project_id:'sample-project',title:'Duplicate display reference'},
    {id:'collision',display_id:'canonical-story',project_id:'sample-project',title:'Legacy reference collision'}]);
  await assert.rejects(service.getRequirement('Req_825',{projectId:'sample-project'}),{statusCode:409,code:'REQUIREMENT_REFERENCE_AMBIGUOUS'});
  assert.equal((await service.getRequirement('canonical-story',{projectId:'sample-project',includeLinkedRecords:false})).id,'canonical-story');
});

test('invalid explicit projects cannot silently downgrade a service read to an unscoped lookup',async()=>{
  const {service,calls}=loadService();
  for(const projectId of [null,'',' ',[],{},'x'.repeat(256)])await assert.rejects(service.getRequirement('canonical-story',{projectId}),{statusCode:400});
  assert.equal(calls.length,0);
});

test('the actual Story detail route accepts display and canonical links and preserves execution gates',async t=>{
  const f=await routeFixture(t);
  for(const id of ['Req_825','canonical-story']){
    const response=await f.app.inject({url:`/requirements/${id}?project_id=sample-project&include_execution=true`});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().id,'canonical-story');assert.equal(response.json().project_id,'sample-project');
  }
  assert.equal(f.metrics.length,2);
  assert.ok(f.metrics.every(item=>item.rows[0].id==='canonical-story'&&item.query.project_id==='sample-project'));
  assert.deepEqual(f.events.filter(item=>item.permission).map(item=>[item.permission,item.project]),
    Array.from({length:2},()=>[['requirement.view','sample-project'],['run.view','sample-project'],['result.view','sample-project']]).flat());
});

test('Story route authorizes the selected project before resolving its display reference',async t=>{
  const f=await routeFixture(t);
  for(const denial of ['project','requirement.view']){
    f.state.projectDenied=denial==='project';f.state.denied=denial==='requirement.view'?'requirement.view':null;
    const response=await f.app.inject({url:'/requirements/Req_825?project_id=sample-project'});
    assert.equal(response.statusCode,403);assert.equal(f.calls.length,0);assert.equal(f.metrics.length,0);
  }
  f.state.projectDenied=false;f.state.denied=null;f.state.authenticated=false;
  assert.equal((await f.app.inject({url:'/requirements/Req_825?project_id=sample-project'})).statusCode,401);
  assert.equal(f.calls.length,0);
});

test('wrong-project and missing Story links remain 404 and never read execution evidence',async t=>{
  const f=await routeFixture(t);
  for(const url of ['/requirements/canonical-story?project_id=other-project&include_execution=true',
    '/requirements/Req_999999?project_id=sample-project&include_execution=true','/requirements/Req_825']){
    const response=await f.app.inject({url});assert.equal(response.statusCode,404,response.body);
    assert.doesNotMatch(response.body,/Read the API|Private other-project/);
  }
  assert.equal(f.metrics.length,0);
  const legacy=await f.app.inject({url:'/requirements/canonical-story'});assert.equal(legacy.statusCode,200,legacy.body);
  assert.equal(f.events.filter(item=>item.permission==='requirement.view').at(-1).project,'sample-project');
});

test('execution permission loss and malformed project scope stop detail metrics',async t=>{
  const f=await routeFixture(t);
  for(const denied of ['run.view','result.view']){
    f.state.denied=denied;
    assert.equal((await f.app.inject({url:'/requirements/Req_825?project_id=sample-project&include_execution=true'})).statusCode,403);
    assert.equal(f.metrics.length,0);
  }
  f.state.denied=null;
  const reads=f.calls.length;
  for(const query of ['project_id=','project_id=%20','project_id=sample-project&project_id=other-project'])
    assert.equal((await f.app.inject({url:'/requirements/Req_825?'+query})).statusCode,400);
  assert.equal(f.calls.length,reads);assert.equal(f.metrics.length,0);
});
