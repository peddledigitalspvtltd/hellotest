const test = require('node:test');
const assert = require('node:assert/strict');
const operations = require('../../backend/workflows/nodeOperations');
const dataOperations = require('../../backend/workflows/dataOperations');
const catalog = require('../../shared/workflowDataOperations.json');

const node = (operation, config = {}) => ({ id: 'data', data: { kind: 'dataOperation', dataOperation: operation, ...config } });
async function execute(operation, input, config = {}, extra = {}) {
  const definition = node(operation, config);
  assert.deepEqual(operations.validate(definition), []);
  return operations.execute({ run: { project_id: 'project', input_payload: { request_id: 'request' } }, node: definition,
    sources: [{ node_id: 'source', output: { data: input } }], ...extra });
}

test('shared data catalog defaults validate through the actual node adapter', () => {
  assert.deepEqual([...dataOperations.OPERATIONS], Object.keys(catalog));
  assert.equal(operations.KINDS.has('dataOperation'), true);
  for (const [id, entry] of Object.entries(catalog)) {
    assert.ok(entry.label && entry.description && entry.defaults);
    assert.deepEqual(operations.validate(node(id)), [], id);
  }
  assert.match(operations.validate(node('unknown'))[0], /supported data operation/);
});

test('Edit Fields maps each item with request, node and iteration context without mutating source values', async () => {
  const input = [{ id: 'a', detail: { retained: true }, status: 'new' }, { id: 'b', detail: { retained: true }, status: 'new' }];
  const before = structuredClone(input);
  const result = await execute('editFields', input, { dataMapping: JSON.stringify({ 'detail.name': '$item.id', index: '$iteration.index', request_id: '$request.request_id', copied: '$input.status', literal: '{{ process.env.SECRET }}' }) });
  assert.deepEqual(result.data, input.map((item, index) => ({ ...item, detail: { retained: true, name: item.id }, index, request_id: 'request', copied: 'new', literal: '{{ process.env.SECRET }}' })));
  assert.deepEqual(input, before);
  result.data[0].detail.retained = false;
  assert.equal(input[0].detail.retained, true);
  assert.deepEqual(result.source_items, [{ input_index: 0, output_indexes: [0] }, { input_index: 1, output_indexes: [1] }]);
  const primitive = await execute('editFields', ['first', 'second'], { dataKeepOtherFields: false, dataMapping: '{"value":"$item","number":"$iteration.number"}' });
  assert.deepEqual(primitive.data, [{ value: 'first', number: 1 }, { value: 'second', number: 2 }]);
});

test('Split Out produces each child with explicit parent selection and full input-to-output links', async () => {
  const input = [{ id: 'story-a', private: 'not requested', meta: { sprint: 's1' }, cases: [{ id: 'case-a' }, { id: 'case-b' }] }, { id: 'story-b', cases: [] }];
  const result = await execute('splitOut', input, { dataSplitField: 'cases', dataDestinationField: 'case', dataIncludeFields: 'selected', dataFields: 'id,meta.sprint' });
  assert.deepEqual(result.data, [{ id: 'story-a', meta: { sprint: 's1' }, case: { id: 'case-a' } }, { id: 'story-a', meta: { sprint: 's1' }, case: { id: 'case-b' } }]);
  assert.deepEqual(result.source_items, [{ input_index: 0, output_indexes: [0, 1] }, { input_index: 1, output_indexes: [] }]);
  assert.equal(input[0].cases.length, 2);
  await assert.rejects(execute('splitOut', [{ cases: 'not an array' }], { dataSplitField: 'cases' }), /requires an array/);
});

test('Aggregate collects selected fields, merges lists only when requested, and preserves missing/null alignment', async () => {
  const input = [{ id: 'a', tags: ['smoke'], count: 0 }, { id: 'b', tags: ['api', 'smoke'], count: null }, { id: 'c' }];
  const result = await execute('aggregate', input, { dataAggregateMode: 'fields', dataAggregateFields: JSON.stringify([{ field: 'tags', outputField: 'all.tags' }, { field: 'count', outputField: 'counts' }]), dataMergeLists: true, dataKeepMissing: true });
  assert.deepEqual(result.data, [{ all: { tags: ['smoke', 'api', 'smoke', null] }, counts: [0, null, null] }]);
  assert.ok(result.source_items.every(item => item.output_indexes[0] === 0));
  const selected = await execute('aggregate', input, { dataOutputField: 'cases', dataIncludeFields: 'selected', dataFields: 'id' });
  assert.deepEqual(selected.data, [{ cases: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }]);
  const empty = await execute('aggregate', []);
  assert.deepEqual(empty.data, [{ items: [] }]);
});

test('Limit keeps deterministic first/last items including a deliberate zero without fabricating a row', async () => {
  const input = [1, 2, 3, 4];
  assert.deepEqual((await execute('limit', input, { dataLimit: '2' })).data, [1, 2]);
  const last = await execute('limit', input, { dataLimit: 2, dataKeep: 'last' });
  assert.deepEqual(last.data, [3, 4]);
  assert.deepEqual(last.source_items.map(item => item.output_indexes), [[], [], [0], [1]]);
  assert.deepEqual((await execute('limit', input, { dataLimit: 0, dataKeep: 'last' })).data, []);
  assert.deepEqual(input, [1, 2, 3, 4]);
});

test('Sort compares numbers numerically, keeps stable ties, and places nulls independently from descending direction', async () => {
  const input = [{ id: 'ten', priority: 10, group: 'b' }, { id: 'two', priority: 2, group: 'a' }, { id: 'tie', priority: 2, group: 'a' }, { id: 'missing' }];
  const result = await execute('sort', input, { dataSortFields: '[{"field":"priority","type":"number","direction":"asc","nulls":"last"}]' });
  assert.deepEqual(result.data.map(item => item.id), ['two', 'tie', 'ten', 'missing']);
  assert.deepEqual(result.source_items.map(item => item.output_indexes), [[2], [0], [1], [3]]);
  const descending = await execute('sort', input, { dataSortFields: '[{"field":"priority","type":"number","direction":"desc","nulls":"first"}]' });
  assert.deepEqual(descending.data.map(item => item.id), ['missing', 'ten', 'two', 'tie']);
  const multiple = await execute('sort', input.slice(0, 3), { dataSortFields: '[{"field":"group","direction":"asc"},{"field":"id","direction":"desc"}]' });
  assert.deepEqual(multiple.data.map(item => item.id), ['two', 'tie', 'ten']);
  await assert.rejects(execute('sort', [{ priority: '2' }, { priority: 10 }]), /mixed types/);
  const dated = await execute('sort', [{ at: '2026-10-31T09:00:00+05:30' }, { at: '2026-10-31T02:00:00Z' }], { dataSortFields: '[{"field":"at","type":"date"}]' });
  assert.equal(dated.data[0].at, '2026-10-31T02:00:00Z');
  for (const at of ['2026-10-31T09:00:00', '2026-02-30', 'not-a-date']) await assert.rejects(execute('sort', [{ at }], { dataSortFields: '[{"field":"at","type":"date"}]' }), /configured date type/);
});

test('Remove Duplicates compares structural values independent of object key order and keeps provenance for discarded copies', async () => {
  const input = [{ id: 'a', detail: { count: 1, passed: true } }, { detail: { passed: true, count: 1 }, id: 'a' }, { id: 'b', detail: { count: 1, passed: true } }];
  const result = await execute('removeDuplicates', input);
  assert.deepEqual(result.data, [input[0], input[2]]);
  assert.deepEqual(result.source_items.map(item => item.output_indexes), [[0], [0], [1]]);
  const selected = await execute('removeDuplicates', [{ key: null }, {}, { key: null }, {}, { key: false }], { dataCompare: 'selected', dataFields: 'key' });
  assert.deepEqual(selected.data, [{ key: null }, {}, { key: false }]);
  const excluded = await execute('removeDuplicates', [{ id: 'a', version: 1 }, { id: 'b', version: 1 }], { dataCompare: 'allExcept', dataFields: 'id' });
  assert.deepEqual(excluded.data, [{ id: 'a', version: 1 }]);
});

test('Filter uses all/any strict typed shared comparisons on each item, including nested values', async () => {
  const input = [{ id: 'a', meta: { ready: true }, score: 90 }, { id: 'b', meta: { ready: true }, score: 20 }, { id: 'c', meta: { ready: false }, score: 100 }];
  const dataConditions = JSON.stringify([{ conditionPath: 'item.meta.ready', conditionOperator: 'isTrue' }, { conditionPath: 'input.score', conditionOperator: 'greaterOrEqual', conditionValue: '80' }]);
  const all = await execute('filter', input, { dataConditions });
  assert.deepEqual(all.data.map(item => item.id), ['a']);
  const any = await execute('filter', input, { dataConditions, dataConditionCombinator: 'any' });
  assert.deepEqual(any.data, input);
  const empty = await execute('filter', input, { dataConditions: JSON.stringify([{ conditionPath: 'item.score', conditionOperator: 'equals', conditionValue: '"90"' }]) });
  assert.deepEqual(empty.data, []);
});

test('Switch exposes stable named arrays with first/all matching and explicit fallback behavior', async () => {
  const input = [{ id: 'a', status: 'passed', score: 90 }, { id: 'b', status: 'failed', score: 90 }, { id: 'c', status: 'unknown', score: 0 }];
  const dataRoutes = JSON.stringify([{ id: 'passed', conditions: [{ conditionPath: 'item.status', conditionOperator: 'equals', conditionValue: '"passed"' }] }, { id: 'high-score', conditions: [{ conditionPath: 'item.score', conditionOperator: 'greater', conditionValue: '80' }] }]);
  const first = await execute('switch', input, { dataRoutes });
  assert.deepEqual(Object.fromEntries(Object.entries(first.routes).map(([key, rows]) => [key, rows.map(item => item.id)])), { passed: ['a'], 'high-score': ['b'], fallback: ['c'] });
  assert.deepEqual(first.route_items, { passed: [0], 'high-score': [1], fallback: [2] });
  const all = await execute('switch', input, { dataRoutes, dataRouteAll: true, dataFallback: 'none' });
  assert.deepEqual(all.routes.passed, [input[0]]);
  assert.deepEqual(all.routes['high-score'], [input[0], input[1]]);
  assert.equal(all.routed_count, 3); assert.equal(all.item_count, 2);
  const fallbackFirst = await execute('switch', [input[2]], { dataRoutes, dataFallback: 'first' });
  assert.deepEqual(fallbackFirst.routes.passed, [input[2]]);
  assert.equal(Object.hasOwn(fallbackFirst.routes, 'fallback'), false);
});

test('configuration rejects dangerous paths, invalid unused conditions, duplicate ports and unsupported coercions before execution', () => {
  for (const config of [
    node('editFields', { dataMapping: '{"__proto__.polluted":true}' }),
    node('editFields', { dataMapping: '{"safe":{"constructor":{"polluted":true}}}' }),
    node('editFields', { dataMapping: '{"safe":"$item.__proto__.polluted"}' }),
    node('editFields', { dataMapping: '{"detail":{},"detail.name":"conflict"}' }),
    node('splitOut', { dataDestinationField: 'constructor.prototype.polluted' }),
    node('limit', { dataLimit: '1.5' }), node('limit', { dataLimit: -1 }), node('limit', { dataLimit: true }),
    node('editFields', { dataKeepOtherFields: 'false' }),
    node('filter', { dataConditions: '[{"conditionPath":"item.id","conditionOperator":"exists"},{"conditionPath":"item.id","conditionOperator":"eval","conditionValue":"true"}]' }),
    node('filter', { dataConditions: '[{"conditionPath":"item.id","conditionOperator":"equals","conditionValue":false}]' }),
    node('switch', { dataRoutes: '[{"id":"fallback","conditions":[{"conditionOperator":"exists"}]}]' }),
    node('switch', { dataRoutes: '[{"id":"same","conditions":[{"conditionOperator":"exists"}]},{"id":"same","conditions":[{"conditionOperator":"exists"}]}]' }),
    node('aggregate', { dataAggregateMode: 'fields', dataAggregateFields: '[{"field":"a","outputField":"result"},{"field":"b","outputField":"result.nested"}]' }),
    node('sort', { dataSortFields: '[{"field":"priority","type":"javascript"}]' }),
  ]) assert.ok(operations.validate(config).length, JSON.stringify(config.data));
  assert.equal({}.polluted, undefined);
});

test('item, byte and cancellation bounds fail explicitly without yielding a successful truncated prefix', async () => {
  await assert.rejects(execute('limit', Array.from({ length: 1001 }, (_, i) => i)), /1000 input items/);
  await assert.rejects(execute('splitOut', [{ items: Array.from({ length: 1001 }, (_, i) => i) }]), /1000 output items/);
  await assert.rejects(execute('limit', [{ text: 'x'.repeat(dataOperations.MAX_BYTES) }]), /128 KB limit/);
  await assert.rejects(execute('sort', { priority: 1 }), /must resolve to an array/);
  await assert.rejects(execute('removeDuplicates', [{ value: undefined }]), /JSON values/);
  const nested = {}; let child = nested; for (let depth = 0; depth < 35; depth++) { child.next = {}; child = child.next; }
  await assert.rejects(execute('removeDuplicates', [nested]), /32 levels/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(execute('limit', [1, 2], {}, { signal: controller.signal }), { statusCode: 499, retryable: false });
  assert.ok(operations.validate(node('editFields', { dataMapping: JSON.stringify({ value: 'x'.repeat(17 * 1024) }) })).some(message => /16 KB/.test(message)));
});
