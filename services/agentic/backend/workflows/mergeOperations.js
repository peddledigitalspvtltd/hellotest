const { isDeepStrictEqual } = require('node:util');
const MODES = new Set(['waitAllAppend', 'waitAllMerge', 'combinePosition', 'combineMatching', 'combineAll', 'chooseInput']);
const fail = message => Object.assign(new Error(message), { publicMessage: message, statusCode: 422, code: 'WORKFLOW_MERGE_INVALID' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safePath = value => typeof value === 'string' && /^[\w-]+(?:\.[\w-]+){0,11}$/.test(value) && !value.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key));
const read = (item, path) => path.split('.').reduce((value, key) => value != null && Object.hasOwn(value, key) ? value[key] : undefined, item);
const selectedInput = data => Number(data.mergeChooseInput ?? 1);
function matchingFields(data) {
  let fields;
  try { fields = typeof data.mergeMatchFields === 'string' ? JSON.parse(data.mergeMatchFields) : data.mergeMatchFields; } catch { throw fail('Matching fields must be a JSON array of left/right field paths.'); }
  if (!Array.isArray(fields) || !fields.length || fields.length > 10 || fields.some(pair => !object(pair) || !safePath(pair.left) || !safePath(pair.right))) throw fail('Choose 1–10 pairs of matching left/right field paths.');
  return fields;
}
function validate(data, inputCount) {
  const mode = data.mergeMode || 'waitAllAppend', errors = [];
  if (!MODES.has(mode)) errors.push('Choose an implemented Merge mode.');
  if (['combinePosition', 'combineMatching', 'combineAll'].includes(mode) && inputCount !== 2) errors.push('Combine requires exactly two connected inputs.');
  if (data.mergeClash != null && !['preferFirst', 'preferLast', 'keepBoth'].includes(data.mergeClash)) errors.push('Choose a field clash policy.');
  if (data.mergeDeep != null && typeof data.mergeDeep !== 'boolean') errors.push('Deep merge must be a boolean.');
  if (data.mergeIncludeUnpaired != null && typeof data.mergeIncludeUnpaired !== 'boolean') errors.push('Include unpaired items must be a boolean.');
  if (mode === 'chooseInput' && (typeof data.mergeChooseInput === 'boolean' || !Number.isInteger(selectedInput(data)) || selectedInput(data) < 1 || selectedInput(data) > inputCount)) errors.push('Choose a connected input number.');
  if (mode === 'combineMatching') {
    try { matchingFields(data); } catch (failure) { errors.push(failure.publicMessage); }
    if (data.mergeJoin != null && !['inner', 'left', 'right', 'outer', 'nonMatches'].includes(data.mergeJoin)) errors.push('Choose a supported join output.');
    if (data.mergeMultiple != null && !['all', 'first'].includes(data.mergeMultiple)) errors.push('Choose all matches or the first match.');
  }
  return errors;
}
function combine(left, right, data, depth = 0) {
  if (!object(left) || !object(right)) throw fail('Combine accepts JSON object items. Wrap scalar values with Edit fields first.');
  if (depth > 12) throw fail('Merge items exceed the supported nesting depth.');
  const result = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fail('Merge items contain a reserved field name.');
    const hasLeft = Object.hasOwn(left, key), hasRight = Object.hasOwn(right, key);
    if (!hasLeft || !hasRight || isDeepStrictEqual(left[key], right[key])) result[key] = hasRight ? right[key] : left[key];
    else if (data.mergeDeep !== false && object(left[key]) && object(right[key])) result[key] = combine(left[key], right[key], data, depth + 1);
    else if (data.mergeClash === 'keepBoth') {
      if (Object.hasOwn(left, `${key}_input1`) || Object.hasOwn(right, `${key}_input1`) || Object.hasOwn(left, `${key}_input2`) || Object.hasOwn(right, `${key}_input2`)) throw fail('Clash suffixes would overwrite existing fields. Rename those fields before merging.');
      result[`${key}_input1`] = left[key]; result[`${key}_input2`] = right[key];
    } else result[key] = data.mergeClash === 'preferFirst' ? left[key] : right[key];
  }
  return result;
}
function execute(data, sources, helpers) {
  const errors = validate(data, sources.length);
  if (errors.length) throw fail(errors.join(' '));
  const mode = data.mergeMode || 'waitAllAppend';
  if (mode === 'waitAllAppend') return helpers.appendInputs(sources);
  if (mode === 'waitAllMerge') { const merged = helpers.mergeInputs(sources); return { data: merged.data, merge_conflicts: merged.conflicts }; }
  const streams = sources.map(source => { const value = Object.hasOwn(source.output || {}, 'data') ? source.output.data : Object.hasOwn(source.output || {}, 'request') ? source.output.request : source.output; return Array.isArray(value) ? value : [value]; });
  if (streams.some(items => items.length > 1000)) throw fail('Merge accepts at most 1000 items per input.');
  if (mode === 'chooseInput') return { data: streams[selectedInput(data) - 1], selected_input: selectedInput(data) };
  const [left, right] = streams, result = [], paired_items = [];
  const push = (value, a, b) => {
    if (result.length >= 1000) throw fail('Merge would produce more than 1000 items. Narrow the matching fields or reduce the inputs.');
    result.push(value); paired_items.push({ input1: a, input2: b });
  };
  if (mode === 'combinePosition') {
    const count = data.mergeIncludeUnpaired ? Math.max(left.length, right.length) : Math.min(left.length, right.length);
    for (let i = 0; i < count; i++) push(i >= left.length ? right[i] : i >= right.length ? left[i] : combine(left[i], right[i], data), i < left.length ? i : null, i < right.length ? i : null);
  } else if (mode === 'combineAll') {
    if (left.length * right.length > 1000) throw fail('All combinations would produce more than 1000 items. Reduce the inputs first.');
    left.forEach((a, i) => right.forEach((b, j) => push(combine(a, b, data), i, j)));
  } else {
    const fields = matchingFields(data), join = data.mergeJoin || 'inner', matchedRight = new Set();
    left.forEach((a, i) => {
      const matches = right.map((b, j) => fields.every(pair => read(a, pair.left) !== undefined && read(b, pair.right) !== undefined && isDeepStrictEqual(read(a, pair.left), read(b, pair.right))) ? j : -1).filter(j => j >= 0);
      // Non-selected matches are still matches for outer/non-match semantics.
      matches.forEach(j => matchedRight.add(j));
      if (!matches.length && ['left', 'outer', 'nonMatches'].includes(join)) push(a, i, null);
      if (join !== 'nonMatches') (data.mergeMultiple === 'first' ? matches.slice(0, 1) : matches).forEach(j => push(combine(a, right[j], data), i, j));
    });
    if (['right', 'outer', 'nonMatches'].includes(join)) right.forEach((b, j) => { if (!matchedRight.has(j)) push(b, null, j); });
  }
  return { data: result, paired_items, item_count: result.length, merge_mode: mode };
}
module.exports = { MODES, validate, execute };
