const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../../backend/workflows/flowOperations');
const data = require('../../backend/workflows/dataOperations');
const strategies = require('../../backend/workflows/nodes/data');
const values = require('../../backend/workflows/nodeOperations')._internals;

test('Wait owns duration validation and preserves connected input through the actual flow facade', async () => {
  const node = { data: { kind: 'wait', waitMs: 0, timeoutMs: 1000 } }, context = { input: { receipt: 'retained' } };
  assert.deepEqual(flow.validate(node), []);
  assert.deepEqual(await flow.execute({ node, context }), { data: context.input, waited_ms: 0 });
  for (const waitMs of [false, '', -1, 60001, 1.5]) assert.ok(flow.validate({ data: { ...node.data, waitMs } }).length);
  assert.match(flow.validate({ data: { ...node.data, waitMs: 1000, timeoutMs: 1000 } })[0], /longer/);
});

test('Wait cancellation rejects without producing connected output and Stop always emits its authored terminal reason', async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(flow.execute({ node: { data: { kind: 'wait', waitMs: 60000, timeoutMs: 61000 } }, context: { input: 'unchanged' }, signal: controller.signal }), { name: 'AbortError' });
  assert.ok(flow.validate({ data: { kind: 'stop', stopMessage: '' } }).length);
  await assert.rejects(flow.execute({ node: { data: { kind: 'stop', stopMessage: '  Hold for review  ' } } }), error => error.code === 'WORKFLOW_STOPPED' && error.message === 'Hold for review' && error.retryable === false);
});

test('every data strategy owns its compilation and execution while the shared facade enforces bounds and provenance', t => {
  assert.deepEqual(Object.keys(strategies), [...data.OPERATIONS]);
  const configurations = {
    editFields: { dataMapping: '{"value":"$input.value"}' },
    splitOut: { dataSplitField: 'tags', dataDestinationField: 'tag', dataIncludeFields: 'all' },
    aggregate: { dataAggregateMode: 'all', dataOutputField: 'group', dataIncludeFields: 'all' },
    limit: { dataLimit: 1, dataKeep: 'first' },
    sort: { dataSortFields: '[{"field":"value","type":"number","direction":"asc"}]' },
    removeDuplicates: { dataCompare: 'all' },
    filter: { dataConditions: '[{"conditionPath":"input.value","conditionOperator":"greater","conditionValue":"0"}]' },
    switch: { dataRoutes: '[{"id":"positive","conditions":[{"conditionPath":"input.value","conditionOperator":"greater","conditionValue":"0"}]}]', dataFallback: 'none' }
  };
  const input = [{ value: 2, tags: ['x', 'y'] }, { value: 1, tags: ['z'] }], before = structuredClone(input);
  for (const [operation, config] of Object.entries(configurations)) {
    const owner = strategies[operation], compile = t.mock.method(owner, 'compile'), execute = t.mock.method(owner, 'execute');
    const result = data.execute({ dataOperation: operation, ...config }, { input }, { ...values });
    assert.equal(compile.mock.callCount(), 1, `${operation} compiles in its owner`);
    assert.equal(execute.mock.callCount(), 1, `${operation} executes in its owner`);
    assert.equal(result.operation, operation);assert.equal(result.input_count, input.length);
    assert.equal(result.source_items.length, input.length);assert.deepEqual(input, before);
  }
});
