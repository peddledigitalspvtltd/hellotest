const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
function fixture() {
  const people = [{ id:'author',name:'Author',email:'author@example.test' },{id:'alice',name:'Alice',email:'alice@example.test'}, {id:'a',name:'Same'}, {id:'b',name:'Same'}];
  const saved = new Map(), writes = [], artifacts = [], updates = [];
  let failNext = false;
  const db = { transaction: callback => callback, prepare: sql => ({
    all: async () => people,
    get: async (id, project) => sql.includes('FROM feedback') ? saved.get(`${project}:${id}`) : undefined
  }) };
  const service = {};
  new Function('require', 'exports', readFileSync(require.resolve('../../backend/services/issueImport.service'), 'utf8'))(id => {
    if (id === '@hellotest/platform/backend/src/db') return db;
    if (id.endsWith('/dropdownCatalog.service')) return { getOptions: async () => [{value:'Functional', label:'Functional'}, {value:'Retired',label:'Retired',active:false}] };
    if (id.endsWith('/workspaceTransaction.service')) return {
      updateTransaction: async (id, input) => updates.push({id,...input}), appendTransactionEvent: async () => {},
      createTransactionArtifact: async (id, input) => { artifacts.push(input); return {id:'artifact'}; }
    };
    if (id === './issues.service') return { createIssue: async (input, options) => {
      if (failNext && writes.length === 1) { failNext = false; throw Object.assign(new Error('Database unavailable'), {statusCode:503}); }
      writes.push({input,options}); const record = {id: options.issueId,display_id:`BUG-${writes.length}`}; saved.set(`${input.project_id}:${record.id}`, record); return record;
    } };
    return require(id);
  }, service);
  return {service, writes, artifacts, updates, fail: () => { failNext = true; }};
}
const row = { title:'Cannot check out',message:'Payment fails',severity:'High',priority:'high',user_id:'alice@example.test',labels:['checkout'],regression:false,bug_type:'Functional' };
test('bug import resolves project people and metadata and defaults reporter to the creator', async () => {
  const {service} = fixture();
  const result = await service.validateRows({project_id:'p',created_by:'author',rows:[row,{title:'Second bug',message:'Different failure'}]});
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].user_id,'alice'); assert.equal(result.rows[0].priority,'High'); assert.equal(result.rows[0].severity,'high');
  assert.equal(result.rows[1].user_id,'author'); assert.equal(result.rows[1].status,'open');
});
test('invalid, duplicate, out-of-project and ambiguous values return CSV row errors without creating bugs', async () => {
  const {service,writes} = fixture();
  for (const patch of [{user_id:'outsider'}, {assignee_id:'Same'}, {bug_type:'Retired'}, {priority:'unknown'}, {regression:'false'}, {labels:'bad'}, {project_id:'other'}, {title:'x'}]) {
    const result = await service.validateRows({project_id:'p',created_by:'author',rows:[{...row,...patch}]});
    assert.equal(result.errors.length,1); assert.equal(result.errors[0].row,2);
  }
  const repeated = await service.validateRows({project_id:'p',created_by:'author',rows:[row,row]});
  assert.match(repeated.errors[0].message,/Duplicate of row 2/);
  assert.equal(writes.length,0);
  await assert.rejects(service.validateRows({project_id:'p',created_by:'author',rows:Array(501).fill(row)}), /500/);
});
test('worker retry resumes safely after a partial import and records the actual actor and a downloadable result', async () => {
  const {service,writes,artifacts,updates,fail} = fixture();
  const input={project_id:'p',created_by:'author',transaction_id:'job',rows:[row,{title:'Second bug',message:'Different failure'}]};
  fail(); await assert.rejects(service.run(input),/Database unavailable/);
  assert.equal(writes.length,1);
  const result=await service.run(input);
  assert.equal(result.imported,2); assert.equal(writes.length,2);
  assert.equal(writes[0].options.actorId,'author'); assert.equal(writes[0].input.user_id,'alice');
  assert.equal(new Set(writes.map(write=>write.options.issueId)).size,2);
  assert.equal(JSON.parse(artifacts[0].content).rows.length,2);
  assert.equal(updates.at(-1).status,'completed');
  await service.run(input); assert.equal(writes.length,2);
});
