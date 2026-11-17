const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserLoopState } = require('../../backend/lib/browser/automationBrowserLoopState');

test('browser loop accepts the observed action cycle and terminal completion rejects further actions', async () => {
  const state = new BrowserLoopState();
  const result = await state.run(async () => {
    for (const phase of ['planning', 'validating', 'acting', 'observing', 'verifying', 'publishing']) { state.enter(phase);state.assertActive(); }
    return { generated: true };
  });
  assert.equal(result.generated, true);assert.equal(state.state, 'completed');
  assert.throws(() => state.assertActive(), { code: 'AUTOMATION_BROWSER_LOOP_CLOSED' });
  assert.throws(() => state.enter('acting'), { code: 'AUTOMATION_BROWSER_LOOP_TRANSITION_INVALID' });
});

test('a provider completing after cancellation or deadline cannot complete the browser loop', async () => {
  for (const mode of ['cancel', 'deadline']) {
    const controller = new AbortController();let release;
    const state = new BrowserLoopState({ signal: controller.signal }), wait = new Promise(resolve => { release = resolve; });
    const run = state.run(async () => { state.enter('planning');await wait;return { generated: true }; });
    if (mode === 'cancel') controller.abort(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    else state.deadline = Date.now() - 1;
    release();
    await assert.rejects(run, error => mode === 'cancel' ? error.name === 'AbortError' : error.code === 'AUTOMATION_BUILD_DEADLINE');
    assert.equal(state.state, mode === 'cancel' ? 'cancelled' : 'failed');
  }
});
