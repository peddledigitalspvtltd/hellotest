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

test('shared dynamic Defect routes expose the real required message and native evidence-link fields for both aliases',()=>{
 const schemas=require('../../backend/contracts.json').schemas;
 for(const base of ['/issues','/feedback']){
  const create=schemas[`POST ${base}`].body,update=schemas[`PUT ${base}/:id`].body;
  assert.deepEqual(create.required,['project_id','title','message']);
  assert.equal(create.properties.message.minLength,2);
  assert.equal(create.properties.linked_test_case_ids.type,'array');
  assert.equal(create.properties.linked_test_run_id.type,'string');
  assert.equal(update.required,undefined,'Updating a field must not require resubmitting the entire Defect.');
  assert.ok(update.properties.status.enum.length>0);
 }
});

test('shared release validators retain spread fields and create-only required keys',()=>{
 const schemas=require('../../backend/contracts.json').schemas;
 const create=schemas['POST /requirement-releases'].body,update=schemas['PUT /requirement-releases/:id'].body;
 assert.deepEqual(create.required,['project_id','name','fix_version']);
 assert.equal(create.properties.name.minLength,2);assert.equal(create.properties.name.maxLength,255);
 assert.deepEqual(create.properties.state.enum,['planned','in_progress','released']);
 assert.equal(update.required,undefined);assert.equal(update.properties.requirement_ids.items.type,'string');
 assert.equal(update.properties.description.maxLength,20000);
});

test('native lifecycle contracts retain real decisions and server-checked revision inputs',()=>{
 const schemas=require('../../backend/contracts.json').schemas;
 const start=schemas['POST /executions/:id/start'].body,complete=schemas['POST /executions/:id/complete'].body;
 assert.deepEqual(start.properties.execution_mode.enum,['manual','remote','local']);
 assert.equal(start.properties.expected_revision.type,'number');
 assert.deepEqual(complete.required,['status']);assert.deepEqual(complete.properties.status.enum,['completed','failed','blocked','partially_completed','aborted']);
 const review=schemas['POST /test-cases/:id/review'].body;
 assert.deepEqual(review.properties.review_status.enum,['accepted','changes_requested']);assert.deepEqual(review.required,['review_status']);
 for(const route of ['POST /test-cases/:id/accept-generated','DELETE /test-cases/:id/reject-generated']){
  assert.equal(schemas[route].body.properties.expected_revision.type,'number');
  assert.equal(schemas[route].body.properties.expected_updated_at.type,'string');
 }
 const draft=schemas['POST /agentic-workflow-runs/:id/drafts/accept'].body;
 assert.deepEqual(draft.required,['node_id','story_index','case_index']);assert.deepEqual(draft.properties.kind.enum,['manual','automation']);
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
