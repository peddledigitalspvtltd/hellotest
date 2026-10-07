import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceScrollPort } from '../src/platform/lib/workspaceScroll.ts';
test('focused editors restore their own scroll position instead of the window', () => {
    const child = {}, main = { clientHeight: 400, scrollHeight: 1200, scrollTop: 250, firstElementChild: child, scrollTo({ top }) { this.scrollTop = top; } };
    const port = createWorkspaceScrollPort({ querySelector: () => main }, { getComputedStyle: () => ({ overflowY: 'auto' }) });
    assert.equal(port.position(), 250);
    assert.equal(port.maximum(), 800);
    port.restore(500);
    assert.equal(main.scrollTop, 500);
    assert.deepEqual(port.observe, [main, child]);
});
test('document scrolling remains the fallback for normal catalog pages', () => {
    const root = { scrollHeight: 1200 }, window = { innerHeight: 400, scrollY: 250, scrollTo({ top }) { this.scrollY = top; } };
    const port = createWorkspaceScrollPort({ querySelector: () => null, documentElement: root }, window);
    assert.equal(port.maximum(), 800);
    port.restore(300);
    assert.equal(window.scrollY, 300);
});
