const test = require('node:test');
const assert = require('node:assert/strict');
const { persistWebRecorderPlan } = require('../../backend/services/webRecorderPersistence.service');

const manual = (id, order, type = 'web') => ({ id, step_order: order, step_type: type, action: `Manual ${id}`, expected_result: `Manual outcome ${id}`, automation_code: `old ${id}` });
const candidate = index => ({ source_action_index: index, action: `Recorded action ${index}`, expected_result: '', automation_code: `await page.click("#${index}");`, keyword: 'web.click' });
function storage(initial, { failCreate = false } = {}) {
  let rows = structuredClone(initial), ready = false;
  const writes = [];
  const ports = {
    transaction: async callback => { const before = structuredClone(rows);try { return await callback(); } catch (error) { rows = before;throw error; } },
    lockCase: async () => ({ id: 'case' }), readSteps: async () => structuredClone(rows),
    updateStep: async (id, input, options) => { assert.equal(options.syncSharedGroup, false);writes.push(['update', id]);Object.assign(rows.find(row => row.id === id), input); },
    createStep: async (input, options) => { assert.equal(options.syncSharedGroup, false);if (failCreate) throw new Error('database write failed');const row = { id: `new-${rows.length}`, ...input };rows.push(row);return row; },
    deleteStep: async id => { rows = rows.filter(row => row.id !== id);writes.push(['delete', id]); },
    reorderStep: async (id, order) => { rows.find(row => row.id === id).step_order = order; },
    updateCaseReadiness: async () => { ready = true; }
  };
  return { ports, rows: () => rows, writes, ready: () => ready };
}

test('a complete recording overwrites copied manual actions and removes unmatched old automation rows atomically', async () => {
  const source = [manual('one', 1), manual('two', 2), manual('obsolete', 3)], original = structuredClone(source);
  const database = storage(source);
  const result = await persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: [candidate(1), candidate(2)] }, database.ports);
  assert.deepEqual(database.rows().map(row => [row.id, row.step_order, row.action, row.expected_result]), [
    ['one', 1, 'Recorded action 1', ''], ['two', 2, 'Recorded action 2', '']
  ]);
  assert.deepEqual(result.map(row => row.source_action_index), [1, 2]);assert.equal(database.ready(), true);
  assert.deepEqual(source, original, 'the linked source manual case is not changed by the recorder');
});

test('recording expands the web plan, detaches copied shared groups and preserves API/native sections', async () => {
  const source = [manual('setup', 1, 'api'), { ...manual('web', 2), group_id: 'shared-instance', reusable_group_id: 'shared-definition' }, manual('native', 3, 'android')];
  const database = storage(source);
  await persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: [candidate(1), candidate(2), candidate(3)] }, database.ports);
  const rows = database.rows().sort((a, b) => a.step_order - b.step_order);
  assert.deepEqual(rows.map(row => row.action), ['Manual setup', 'Recorded action 1', 'Recorded action 2', 'Recorded action 3', 'Manual native']);
  assert.equal(rows[1].reusable_group_id, null);assert.equal(rows[1].group_id, null);
  assert.equal(rows[0].automation_code, 'old setup');assert.equal(rows[4].automation_code, 'old native');
});

test('fewer, equal and additional recorded actions preserve interleaved API/native dependency order', async () => {
  for (const count of [1, 2, 4]) {
    const source = [manual('api-before', 1, 'api'), manual('web-one', 2), manual('api-between', 3, 'api'), manual('web-two', 4), manual('native-after', 5, 'ios')];
    const database = storage(source);
    await persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: Array.from({ length: count }, (_, index) => candidate(index + 1)) }, database.ports);
    const rows = database.rows().sort((a, b) => a.step_order - b.step_order);
    assert.deepEqual(rows.map(row => row.action), ['Manual api-before', 'Recorded action 1', 'Manual api-between',
      ...Array.from({ length: count - 1 }, (_, index) => `Recorded action ${index + 2}`), 'Manual native-after']);
    assert.deepEqual(rows.map(row => row.step_order), rows.map((_, index) => index + 1));
    for (const id of ['api-before', 'api-between', 'native-after']) assert.equal(rows.find(row => row.id === id).automation_code, `old ${id}`);
  }
});

test('a failed write rolls back all overwritten prose and a stale plan is rejected before writes', async () => {
  const source = [manual('one', 1)];
  const failed = storage(source, { failCreate: true });
  await assert.rejects(persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: [candidate(1), candidate(2)] }, failed.ports), /database write failed/);
  assert.deepEqual(failed.rows(), source);assert.equal(failed.ready(), false);
  const changed = storage([{ ...source[0], action: 'Changed during recording' }]);
  await assert.rejects(persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: [candidate(1)] }, changed.ports), { code: 'AUTOMATION_RECORDER_CASE_CHANGED' });
  assert.deepEqual(changed.writes, []);
});

test('empty recordings leave the current plan untouched', async () => {
  const source = [manual('one', 1)], database = storage(source);
  assert.deepEqual(await persistWebRecorderPlan({ caseId: 'case', expectedSteps: source, candidates: [] }, database.ports), []);
  assert.deepEqual(database.rows(), source);assert.deepEqual(database.writes, []);
});

test('legacy manual defaults are replaced while saved API requests with a historical web default are retained', async () => {
  const api={...manual('legacy-api',1),automation_code:null,api_request:{method:'GET',url:'https://fixture.test/account'}};
  const source=[api,{...manual('legacy-manual',2),step_type:'manual'}],database=storage(source);
  await persistWebRecorderPlan({caseId:'case',expectedSteps:source,candidates:[candidate(1)]},database.ports);
  assert.deepEqual(database.rows().map(row=>row.action),['Manual legacy-api','Recorded action 1']);
  assert.deepEqual(database.rows()[0].api_request,api.api_request);assert.equal(database.rows()[1].step_type,'web');
});
