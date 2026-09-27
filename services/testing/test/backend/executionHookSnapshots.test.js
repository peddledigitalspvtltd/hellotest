const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../../backend/services/executionHookSnapshots.service'), 'utf8');
function fixture({allowed = true, scoped = true, suiteIds = ['hook-case'], emptyCases = []} = {}) {
  const queries = [], module = {exports:{}};
  vm.runInNewContext(source, {module, require: (name) => {
    if (name.endsWith('/db')) return {prepare: (sql) => ({
      get: async (...args) => {queries.push({sql,args});return scoped ? {id:args[0],parameter_values:JSON.stringify({'t.account':'fixture',legacy:'source default'})} : null;},
      all: async (...args) => {queries.push({sql,args});return suiteIds.map(id => ({id}));}
    })};
    if (name.endsWith('executionSnapshot.repository')) return {loadSteps: async ids => new Map(ids.map(id => [id, emptyCases.includes(id) ? [] : [{id:`${id}-step`,test_case_id:id,step_type:'ios',automation_code:'await ios.tap("~submit");'}]]))};
    if (name.endsWith('optionalEvidenceAccess.service')) return {getOptionalEvidenceAccess: async()=>({'testcase.view':allowed,'suite.view':allowed})};
    if (name.startsWith('./')) return require(`../../backend/services/${name.slice(2)}`);
    return require(name);
  }});
  return {...module.exports,queries};
}
const hook = {id:'before',scope:'test',phase:'pre',target_kind:'test',target_id:'hook-case'};
const context = {projectId:'p',appTypeId:'a',userId:'u'};
test('freezes a hook outside the run membership with its source parameters and runtime', async()=>{
 const f=fixture();const result=await f.snapshotExecutionHooks([hook],context);
 assert.equal(result[0].steps[0].step_type,'ios');assert.equal(result[0].steps[0].source_case_parameters['t.account'],'fixture');
 assert.equal(result[0].steps[0].source_case_parameters['t.legacy'],'source default');
 assert.equal(result[0].steps[0].source_case_parameters['r.legacy'],undefined);
 assert.deepEqual(f.queries[0].args,['hook-case','p','a']);assert.match(f.queries[0].sql,/a.project_id = \?/);
});
test('hook snapshots reject unavailable scopes, revoked access and cross-project sources',async()=>{
 await assert.rejects(fixture().snapshotExecutionHooks([{...hook,scope:'run'}],context),/coordinated scheduling/);
 const denied=fixture({allowed:false});await assert.rejects(denied.snapshotExecutionHooks([hook],context),/permission/);assert.equal(denied.queries.length,0);
 await assert.rejects(fixture({scoped:false}).snapshotExecutionHooks([hook],context),/current project/);
});

test('invalid hook shapes and duplicate identifiers fail with actionable validation', async () => {
  for (const input of [{}, [null], [{...hook,target_id:''}], [{...hook,fail_behavior:'ignore'}], [hook, hook]]) {
    await assert.rejects(fixture().snapshotExecutionHooks(input,context), {statusCode:400});
  }
});

test('suite sources freeze descendants in stable order and deduplicate cases', async () => {
  const f = fixture({suiteIds:['hook-case','nested-case','hook-case']});
  const [result] = await f.snapshotExecutionHooks([{...hook,target_kind:'suite',target_id:'suite'}],context);
  assert.deepEqual(Array.from(result.steps, step => step.test_case_id), ['hook-case','nested-case']);
  assert.match(f.queries[0].sql,/WITH RECURSIVE selected/);
  assert.deepEqual(f.queries[0].args,['suite','p','a','suite']);
  await assert.rejects(fixture({suiteIds:['hook-case','empty'],emptyCases:['empty']}).snapshotExecutionHooks([{...hook,target_kind:'suite'}],context),/no executable steps/);
});

test('public hook snapshots redact shared secrets without changing stored runtime values', () => {
  const original = [{...hook,steps:[{id:'step',shared_parameter_values:{'r.secret':'credential','r.public':'safe'},shared_parameter_template_values:{'r.secret':'credential','r.public':'safe'},shared_parameter_sensitive_names:['r.secret']}]}];
  const visible = fixture().redactExecutionHooks(JSON.stringify(original));
  assert.equal(visible[0].steps[0].shared_parameter_values['r.secret'],undefined);
  assert.equal(visible[0].steps[0].shared_parameter_values['r.public'],'safe');
  assert.equal(original[0].steps[0].shared_parameter_values['r.secret'],'credential');
});

test('rerun hook code remains frozen while source parameters regenerate consistently per source case', () => {
  const original = [{...hook,steps:[1,2].map(index => ({id:`step-${index}`,test_case_id:'source',automation_code:'await page.click("#saved");',source_case_parameters:{'t.id':'old'},source_case_parameter_templates:{'t.id':'{{uuid}}'}}))}];
  const next = fixture().regenerateExecutionHooks(original);
  assert.notEqual(next[0].steps[0].source_case_parameters['t.id'],'old');
  assert.equal(next[0].steps[0].source_case_parameters['t.id'],next[0].steps[1].source_case_parameters['t.id']);
  assert.equal(next[0].steps[0].automation_code,original[0].steps[0].automation_code);
  assert.equal(original[0].steps[0].source_case_parameters['t.id'],'old');
});
