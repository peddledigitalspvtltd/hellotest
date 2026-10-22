const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const file=path.resolve(__dirname,'../../backend/registry.js'),original=createRequire(file);
const moduleStub={exports:{}};
new Function('require','module','exports',fs.readFileSync(file,'utf8'))(original,moduleStub,moduleStub.exports);
const registry=moduleStub.exports;

test('generated ordinary execution contracts do not inherit nested Smart Run acceptance fields',()=>{
 const schema=require('../../backend/contracts.json').schemas['POST /executions'].body;
 assert.equal(schema.properties.test_case_ids.type,'array');assert.equal(schema.properties.expected_case_revisions.type,'array');
 assert.ok(schema.required.includes('project_id'));assert.ok(!schema.required.includes('acceptance_token'));
});

test('actual report, binary and ALM GET routes are discoverable as wrapper-required rather than executable JSON reads',()=>{
 for(const url of ['/executions/:id/report.pdf','/executions/:id/report.html','/knowledge/sources/:id/file','/requirements/alm/projects','/requirements/alm/requirements']){
  registry.register({method:'GET',url});
  const operation=registry.all().find(item=>item.path===url);
  assert.ok(operation.permission,`Missing real route permission for ${url}`);
  assert.equal(operation.read,false,url);assert.equal(operation.exposure,'requires_domain_wrapper',url);
  assert.match(operation.reason,/wrapper/i);
 }
 for(const url of ['/executions/:id','/knowledge/sources/:id','/requirements/:id','/agentic-quality/runs/:id']){
  registry.register({method:'GET',url});
  assert.equal(registry.all().find(item=>item.path===url).read,true,url);
 }
});
