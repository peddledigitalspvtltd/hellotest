import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const compiled = ts.transpileModule(readFileSync(new URL('../src/shared/hooks/useRecorderStatus.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const operations = [], timers = new Map(), listeners = new Map();
    let nextTimer = 0, cleanup, state = { id: 'record-a', status: 'running', status_url: 'https://fixture.test/status' };
    const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const window = { setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) };
    const transport = { consumeApiResponse: (url, init, options, consume) => new Promise(resolve => operations.push({ url, signal: init.signal, options, reply: body => resolve(consume({ ok: true, json: async () => body })) })) };
    const exports = {};
    new Function('require', 'exports', 'document', 'window', compiled)(name => name === 'react' ? { useEffect: fn => cleanup = fn() } : transport, exports, document, window);
    exports.useRecorderStatus(state, update => state = update(state));
    return { operations, timers, document, state: () => state, cleanup: () => cleanup(), visibility: () => listeners.get('visibilitychange')?.(), tick: () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); } };
}
test('status polling is serial, deadline bounded and resumes visible tabs', async () => {
    const view = fixture();
    assert.equal(view.operations.length, 1);
    assert.equal(view.operations[0].options.timeoutMs, 5000);
    view.visibility();
    assert.equal(view.operations.length, 1, 'visibility cannot overlap the pending request');
    view.operations[0].reply({ id: 'record-a', action_count: 2 });
    await flush();
    assert.equal(view.state().action_count, 2);
    view.document.hidden = true;
    view.tick();
    await flush();
    assert.equal(view.operations.length, 1, 'hidden tabs issue no requests');
    view.document.hidden = false;
    view.visibility();
    assert.equal(view.operations.length, 2);
    view.cleanup();
});
test('foreign recorder responses and late completion after cleanup cannot replace the session', async () => {
    const view = fixture();
    view.operations[0].reply({ id: 'record-b', action_count: 99 });
    await flush();
    assert.equal(view.state().id, 'record-a');
    assert.equal(view.state().action_count, undefined);
    view.tick();
    view.cleanup();
    assert.equal(view.operations[1].signal.aborted, true);
    view.operations[1].reply({ id: 'record-a', action_count: 9 });
    await flush();
    assert.equal(view.state().action_count, undefined);
    assert.equal(view.timers.size, 0);
});
