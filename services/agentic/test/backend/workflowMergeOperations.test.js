const test = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../../backend/workflows/mergeOperations');
const { appendInputs, mergeInputs } = require('../../backend/workflows/nodeOperations')._internals;
const source = (id, data) => ({ node_id: id, output: { data } });
const execute = (data, left, right) => merge.execute(data, [source('left', left), source('right', right)], { appendInputs, mergeInputs });

test('positional merge preserves pairing, optional unpaired values and explicit clash policies', () => {
  const left = [{ id: 'a', nested: { left: true, conflict: 1 } }, { id: 'unpaired' }], right = [{ id: 'b', nested: { right: true, conflict: 2 } }];
  const result = execute({ mergeMode: 'combinePosition', mergeClash: 'keepBoth', mergeIncludeUnpaired: true }, left, right);
  assert.deepEqual(result.data, [{ id_input1: 'a', id_input2: 'b', nested: { left: true, right: true, conflict_input1: 1, conflict_input2: 2 } }, { id: 'unpaired' }]);
  assert.deepEqual(result.paired_items, [{ input1: 0, input2: 0 }, { input1: 1, input2: null }]);
  assert.deepEqual(execute({ mergeMode: 'combinePosition', mergeClash: 'preferFirst', mergeDeep: false }, left, right).data, [left[0]]);
  assert.deepEqual(execute({ mergeMode: 'combinePosition', mergeClash: 'preferLast' }, [{ x: 1 }], [{ x: 2 }]).data, [{ x: 2 }]);
  assert.deepEqual(left[0].nested, { left: true, conflict: 1 });
});

test('matching merge implements inner, left, right, outer and non-match joins with strict nested-key equality', () => {
  const left = [{ leftId: 'a', key: { id: 1 } }, { leftId: 'b', key: { id: 2 } }, { leftId: 'missing' }];
  const right = [{ rightId: 'a', foreign: 1 }, { rightId: 'c', foreign: 3 }, { rightId: 'missing' }];
  const config = { mergeMode: 'combineMatching', mergeMatchFields: '[{"left":"key.id","right":"foreign"}]' };
  assert.deepEqual(execute({ ...config, mergeJoin: 'inner' }, left, right).paired_items, [{ input1: 0, input2: 0 }]);
  assert.deepEqual(execute({ ...config, mergeJoin: 'left' }, left, right).paired_items, [{ input1: 0, input2: 0 }, { input1: 1, input2: null }, { input1: 2, input2: null }]);
  assert.deepEqual(execute({ ...config, mergeJoin: 'right' }, left, right).paired_items, [{ input1: 0, input2: 0 }, { input1: null, input2: 1 }, { input1: null, input2: 2 }]);
  assert.equal(execute({ ...config, mergeJoin: 'outer' }, left, right).data.length, 5);
  assert.deepEqual(execute({ ...config, mergeJoin: 'nonMatches' }, left, right).paired_items, [{ input1: 1, input2: null }, { input1: 2, input2: null }, { input1: null, input2: 1 }, { input1: null, input2: 2 }]);
  assert.equal(execute(config, [{ key: { id: '1' } }], right).data.length, 0);
});

test('first-match mode never incorrectly re-emits other matching right items as outer/non-match orphans', () => {
  const config = { mergeMode: 'combineMatching', mergeMatchFields: [{ left: 'id', right: 'id' }], mergeMultiple: 'first' };
  const left = [{ id: 1 }], right = [{ id: 1, sequence: 'first' }, { id: 1, sequence: 'second' }, { id: 2 }];
  const outer = execute({ ...config, mergeJoin: 'outer' }, left, right);
  assert.deepEqual(outer.paired_items, [{ input1: 0, input2: 0 }, { input1: null, input2: 2 }]);
  assert.deepEqual(execute({ ...config, mergeJoin: 'nonMatches' }, left, right).data, [{ id: 2 }]);
});

test('all combinations are ordered, choose-input keeps exact falsy data, and bounds reject excessive cartesian work', () => {
  const combined = execute({ mergeMode: 'combineAll' }, [{ a: 1 }, { a: 2 }], [{ b: 1 }, { b: 2 }]);
  assert.deepEqual(combined.data, [{ a: 1, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 1 }, { a: 2, b: 2 }]);
  assert.deepEqual(execute({ mergeMode: 'chooseInput', mergeChooseInput: 2 }, [{ a: 1 }], [null, false, 0, '']).data, [null, false, 0, '']);
  assert.throws(() => execute({ mergeMode: 'combineAll' }, Array(40).fill({ a: 1 }), Array(40).fill({ b: 1 })), /more than 1000/);
  assert.throws(() => execute({ mergeMode: 'combinePosition', mergeClash: 'keepBoth' }, [{ id: 1, id_input1: 'must preserve' }], [{ id: 2 }]), /overwrite existing fields/);
  assert.throws(() => execute({ mergeMode: 'combinePosition' }, [false], [{ a: 1 }]), /JSON object items/);
  assert.ok(merge.validate({ mergeMode: 'combineMatching', mergeMatchFields: '[{"left":"constructor.x","right":"id"}]' }, 2).length);
  assert.ok(merge.validate({ mergeMode: 'combinePosition' }, 3).length);
  for (const mergeChooseInput of [0, true, false, -1, 3, '1.5']) assert.ok(merge.validate({ mergeMode: 'chooseInput', mergeChooseInput }, 2).length, JSON.stringify(mergeChooseInput));
});
