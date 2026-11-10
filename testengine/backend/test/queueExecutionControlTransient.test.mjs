import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Keep this control-plane regression independent of a browser/build process.
const source = await readFile(new URL('../src/lib/queueExecutionControl.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createQueueExecutionControl } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const temporaryFailure = () => Object.assign(new Error('Temporary API timeout'), { code: 'REQUEST_TIMEOUT' });

test('a temporary heartbeat timeout retries within the confirmed lease and shares one authorization check', async () => {
  let calls = 0, retries = 0, aborts = 0;
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 10000).toISOString(), retryDelayMs: 1, timeoutMs: 10000,
    authorize: async () => { if (++calls === 1) throw temporaryFailure(); return { lease_expires_at: new Date(Date.now() + 10000).toISOString() }; },
    onRetry: () => { retries++; }, onAbort: () => { aborts++; }
  });
  await Promise.all([control.check(), control.check()]);
  assert.equal(calls, 2); assert.equal(retries, 1); assert.equal(aborts, 0); assert.equal(control.signal.aborted, false);
  control.stop();
});

test('an explicit denial aborts immediately despite a previously confirmed lease', async () => {
  let calls = 0;
  const denied = Object.assign(new Error('Ownership denied'), { code: 'HTTP_ERROR', status: 403 });
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 10000).toISOString(), timeoutMs: 10000,
    authorize: async () => { calls++; throw denied; }, onAbort() {}
  });
  await assert.rejects(control.check(), /Ownership denied/);
  assert.equal(calls, 1); assert.equal(control.authorityLost, true); control.stop();
});

test('an older successful receipt without lease metadata cannot grant a retry budget', async () => {
  let calls = 0;
  const control = createQueueExecutionControl({ timeoutMs: 10000, authorize: async () => { if (++calls > 1) throw temporaryFailure(); }, onAbort() {} });
  await control.check();
  await assert.rejects(control.check(), /Temporary API timeout/);
  assert.equal(calls, 2); assert.equal(control.authorityLost, true); control.stop();
});

test('an expired heartbeat receipt cannot authorize application work', async () => {
  const control = createQueueExecutionControl({ timeoutMs: 10000, authorize: async () => ({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }), onAbort() {} });
  await assert.rejects(control.check(), /invalid or expired lease receipt/);
  assert.equal(control.authorityLost, true); control.stop();
});

test('ownership denial during a transport retry stops further checks immediately', async () => {
  let calls = 0;
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 10000).toISOString(), retryDelayMs: 1, timeoutMs: 10000,
    authorize: async () => { if (++calls === 1) throw temporaryFailure(); throw new Error('Lease was revoked'); }, onAbort() {}
  });
  await assert.rejects(control.check(), /Lease was revoked/);
  assert.equal(calls, 2); assert.equal(control.authorityLost, true); control.stop();
});

test('a temporary service failure admits the next action only after a positive renewal receipt', async () => {
  let calls = 0, release, admitted = false;
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 10000).toISOString(), retryDelayMs: 1, timeoutMs: 10000,
    authorize: async () => { if (++calls === 1) throw Object.assign(new Error('Temporarily busy'), { code: 'HTTP_ERROR', status: 503 }); return new Promise(resolve => { release = resolve; }); }, onAbort() {}
  });
  const check = control.check().then(() => { admitted = true; });
  await delay(10); assert.equal(admitted, false); assert.equal(calls, 2);
  release({ lease_expires_at: new Date(Date.now() + 10000).toISOString() }); await check;
  assert.equal(admitted, true); control.stop();
});

test('an unknown or expired lease cannot authorize retry after a transport failure', async () => {
  for (const initialLeaseExpiresAt of [undefined, new Date(Date.now() - 1).toISOString()]) {
    let calls = 0;
    const control = createQueueExecutionControl({ initialLeaseExpiresAt, timeoutMs: 10000, authorize: async () => { calls++; throw temporaryFailure(); }, onAbort() {} });
    await assert.rejects(control.check(), /Temporary API timeout/);
    assert.equal(calls, 1); assert.equal(control.authorityLost, true); control.stop();
  }
});

test('the confirmed lease deadline fences a stalled control request before another action can be admitted', async () => {
  let aborts = 0;
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 1050).toISOString(), timeoutMs: 10000, intervalMs: 1000,
    authorize: signal => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }), onAbort: () => { aborts++; }
  });
  control.start();
  const pending = assert.rejects(control.check(), /confirmed lease before expiry/);
  await delay(80); await pending;
  assert.equal(aborts, 1); assert.equal(control.authorityLost, true); control.stop();
});

test('stopping during retry backoff does not send another control request', async () => {
  let calls = 0;
  const control = createQueueExecutionControl({ initialLeaseExpiresAt: new Date(Date.now() + 10000).toISOString(), retryDelayMs: 10, timeoutMs: 10000,
    authorize: async () => { calls++; throw temporaryFailure(); }, onRetry: () => control.stop(), onAbort() {}
  });
  await control.check(); assert.equal(calls, 1); assert.equal(control.signal.aborted, false);
});
