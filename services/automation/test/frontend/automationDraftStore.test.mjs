import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomationDraftStore } from '../../frontend/lib/automationDraftStore.ts';

const draft = name => ({ name, expected_result: '', step_type: 'web', keyword: 'web.click', objectRef: '#save', value: '' });
test('edits publish an immutable row snapshot while retaining other rows and admission identity', () => {
  const store = createAutomationDraftStore(), steps = { a: draft('First'), b: draft('Second') };
  store.baseline({ steps, options: {}, code: {}, api: {} }); store.write('steps', steps);
  const other = store.row('b'), before = store.row('a');
  store.write('steps', current => ({ ...current, a: { ...current.a, name: 'Changed' } }));
  const admission = store.summary();
  store.write('steps', current => ({ ...current, a: { ...current.a, name: 'Changed again' } }));
  assert.equal(store.row('b'), other);
  assert.notEqual(store.row('a'), before);
  assert.equal(store.summary(), admission, 'ordinary typing does not notify the whole workspace');
  assert.equal(store.read('steps').a.name, 'Changed again', 'save/run admission can read the latest value before blur');
  assert.equal(before.step.name, 'First');
  store.write('steps', steps); assert.equal(store.row('a').dirty, false);
});
test('new parameter references update workspace admission and separate cases have isolated drafts', () => {
  const first = createAutomationDraftStore(), second = createAutomationDraftStore();
  first.write('steps', { a: draft('Type @t.customer') });
  assert.match(first.summary(), /t.customer/);
  assert.equal(second.read('steps').a, undefined);
});
