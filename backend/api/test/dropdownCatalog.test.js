const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { DROPDOWN_FIELDS, DROPDOWN_FIELDS_BY_KEY } = require('../src/domain/dropdownCatalog');
const service = require('../src/services/dropdownCatalog.service');
const editable = key => DROPDOWN_FIELDS_BY_KEY.get(key);
const rows = key => editable(key).options.map(({builtin,...option})=>option);

test('catalog usage links resolve to existing workspace routes and field keys are unique', () => {
  const routes = readFileSync(path.join(__dirname,'../../../frontend/src/lib/workspaceRoutes.ts'),'utf8');
  const paths = new Set([...routes.matchAll(/:\s*"(\/[^"\n]*)"/g)].map(match=>match[1]));
  assert.equal(new Set(DROPDOWN_FIELDS.map(field=>field.key)).size,DROPDOWN_FIELDS.length);
  for (const field of DROPDOWN_FIELDS) {
    for (const location of field.usage) assert.ok(paths.has(location.path),`${field.key}: ${location.path}`);
    if (field.manage_path) assert.ok(paths.has(field.manage_path),field.key);
    if (['system','records'].includes(field.kind)) assert.equal(field.can_edit,false);
  }
});

test('option edits preserve codes, allow labels/order/retirement and reject ambiguous entries', () => {
  const field=editable('issues.root_causes'), input=rows(field.key);
  const changed=[...input].reverse(); changed[0]={...changed[0],label:'Cause not identified',active:false};
  const accepted=service.normalizeOptions(field,[...changed,{value:'Contract drift',label:'Contract drift',description:'API contract changed',active:true}],field);
  assert.equal(accepted.at(-1).value,'Contract drift'); assert.equal(accepted[0].active,false);
  for (const candidate of [input.slice(1),[...input,{value:'CODE DEFECT',label:'Different',active:true}],[...input,{value:'different',label:'code defect',active:true}],[...input,{value:'Bad\ncode',label:'Bad',active:true}],[...input,{value:'x',label:'',active:true}]]) {
    assert.throws(()=>service.normalizeOptions(field,candidate,field),{statusCode:400});
  }
});

test('case types use bounded canonical codes and always retain an active choice', () => {
  const field=editable('test_cases.types'), input=rows(field.key);
  assert.equal(service.normalizeOptions(field,[...input,{value:'contract_test',label:'Contract testing',active:true}],field).at(-1).value,'contract_test');
  for (const value of ['MixedCase','has spaces','1first','x'.repeat(121)]) assert.throws(()=>service.normalizeOptions(field,[...input,{value,label:value,active:true}],field),{statusCode:400});
  assert.throws(()=>service.normalizeOptions(field,input.map(row=>({...row,active:false})),field),/active option/);
});

test('story estimate suggestions enforce positive whole numbers and option payload bounds', () => {
  const field=editable('requirements.story_points'), input=rows(field.key);
  assert.equal(service.normalizeOptions(field,[...input,{value:'34',label:'34 points',active:true}],field).at(-1).value,'34');
  for (const value of ['0','-1','3.5','1000','03']) assert.throws(()=>service.normalizeOptions(field,[...input,{value,label:value,active:true}],field));
  assert.throws(()=>service.normalizeOptions(field,Array(201).fill(input[0]),field),/200/);
});

test('public metadata carries the revision and retired labels without changing workflow codes', () => {
  const metadata = require('../src/domain/catalog').cloneDomainMetadata();
  const fields=DROPDOWN_FIELDS.map(field=>structuredClone(field));
  const types=fields.find(field=>field.key==='test_cases.types');
  types.options.push({value:'contract',label:'Contract',active:true,builtin:false}); types.default_value='contract'; types.options[0].active=false;
  const published=service.applyToDomainMetadata(metadata,{revision:7,updated_at:'2026-09-10',fields});
  assert.equal(published.dropdowns.revision,7); assert.equal(published.test_cases.default_type,'contract');
  assert.equal(published.test_cases.types.some(option=>option.value==='functional'),false);
  assert.equal(published.dropdowns.fields['test_cases.types'].options[0].active,false);
  assert.deepEqual(published.executions.result_statuses,metadata.executions.result_statuses);
  assert.deepEqual(published.test_cases.statuses,metadata.test_cases.statuses);
  assert.equal(metadata.dropdowns,undefined);
});

test('admin catalog routes reject unauthenticated/non-admin callers and preserve conflict responses', async context => {
  const fastify=require('fastify')({logger:false});
  fastify.decorate('requireAdmin',async req=>{
    const role=req.headers['x-test-role'];
    if (!role) throw Object.assign(new Error('Authentication required'),{statusCode:401});
    if(role!=='admin') throw Object.assign(new Error('Admin access required'),{statusCode:403});
    req.user={id:'admin',role};
  });
  fastify.decorate('validate',()=>{});
  let writes=0;
  context.mock.method(service,'getCatalog',async()=>({revision:0,fields:[]}));
  context.mock.method(service,'updateField',async(key,input,actor)=>{
    writes++; assert.equal(actor.actorId,'admin');assert.equal(key,'test_cases.types');
    if(input.expected_revision===0) throw Object.assign(new Error('Reload the latest catalog'),{statusCode:409,code:'DROPDOWN_REVISION_CONFLICT'});
    return {revision:2,fields:[]};
  });
  await fastify.register(require('../src/routes/adminPortal.routes'));
  try {
    for(const method of ['GET','PUT']) for(const role of [null,'member']) {
      const result=await fastify.inject({method,url:method==='GET'?'/admin-portal/dropdowns':'/admin-portal/dropdowns/test_cases.types',headers:role?{'x-test-role':role}:{},...(method==='PUT'?{payload:{expected_revision:0,options:[]}}:{})});
      assert.equal(result.statusCode,role?403:401);
    }
    assert.equal(writes,0);
    const catalog=await fastify.inject({method:'GET',url:'/admin-portal/dropdowns',headers:{'x-test-role':'admin'}});
    assert.equal(catalog.statusCode,200); assert.equal(catalog.headers['cache-control'],'no-store');
    const conflict=await fastify.inject({method:'PUT',url:'/admin-portal/dropdowns/test_cases.types',headers:{'x-test-role':'admin'},payload:{expected_revision:0,options:[]}});
    assert.equal(conflict.statusCode,409);assert.equal(conflict.json().code,'DROPDOWN_REVISION_CONFLICT');
    const result=await fastify.inject({method:'PUT',url:'/admin-portal/dropdowns/test_cases.types',headers:{'x-test-role':'admin'},payload:{expected_revision:1,options:[]}});
    assert.equal(result.statusCode,200); assert.equal(result.json().revision,2);
  } finally { await fastify.close(); }
});
