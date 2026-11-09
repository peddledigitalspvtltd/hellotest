import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/lib/recorder.ts', import.meta.url), 'utf8');
const declaration = source.slice(source.indexOf('const recorderInitScript ='), source.indexOf('const recorderExtensionContentScript ='));
const init = vm.runInNewContext(`${declaration}\nrecorderInitScript;`);
function recorder() {
  const events = [], listeners = new Map(), timers = new Map();let sequence = 0;
  const window = { location: { href: 'https://fixture.test/form' }, addEventListener() {}, __hellotestRecorderEmit: async event => { events.push(event); } };
  vm.runInNewContext(init, { window, document: { addEventListener: (name, handler) => listeners.set(name, handler) }, Node: { ELEMENT_NODE: 1 },
    setTimeout: callback => { timers.set(++sequence, callback);return sequence; }, clearTimeout: id => timers.delete(id) });
  const input = { nodeType: 1, tagName: 'INPUT', type: 'text', value: '', getAttribute: name => name === 'id' ? 'name' : '', querySelector: () => null };
  return { events, input, window, timers, fire: (name, details = {}) => listeners.get(name)({ target: input, ...details }) };
}

test('Enter flushes debounced field input before the key and preserves exact whitespace and explicit blanks', async () => {
  const state = recorder();state.input.value = '  exact value  ';
  state.fire('input');assert.equal(state.events.length, 0);
  state.fire('keydown', { key: 'Enter' });
  await state.window.__hellotestRecorderFlush();
  assert.deepEqual(state.events.map(event => [event.type, event.value]), [['fill', '  exact value  '], ['press', 'Enter']]);
  state.input.value = '';state.fire('input');await state.window.__hellotestRecorderFlush();
  assert.equal(state.events.at(-1).value, '');assert.equal(state.timers.size, 0);
});

test('saving before the input debounce fires captures the final value and waits for all emitted bindings', async () => {
  const state = recorder();let finish;
  state.window.__hellotestRecorderEmit = event => { state.events.push(event);return new Promise(resolve => { finish = resolve; }); };
  state.input.value = 'Final unsaved field';state.fire('input');
  let completed = false;
  const flushed = state.window.__hellotestRecorderFlush().then(() => { completed = true; });
  assert.equal(state.events[0].value, 'Final unsaved field');assert.equal(completed, false);
  finish();await flushed;assert.equal(completed, true);assert.equal(state.timers.size, 0);
});

test('a change event cancels its pending timer and cannot later reorder a recorded click', async () => {
  const state = recorder();state.input.value = 'Customer';state.fire('input');state.fire('change');
  const button = { ...state.input, tagName: 'BUTTON', innerText: 'Save', closest() { return this; } };
  state.fire('click', { target: button });await state.window.__hellotestRecorderFlush();
  assert.deepEqual(state.events.map(event => event.type), ['change', 'click']);assert.equal(state.timers.size, 0);
});
