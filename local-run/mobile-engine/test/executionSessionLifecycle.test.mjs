import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionSessions } from '../src/executionSessions.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('closing a starting session never runs operations on its deleted driver', async () => {
  const starting = deferred();
  let ran = false, deleted = 0;
  const sessions = createExecutionSessions({ createDriver: () => starting.promise });
  const execution = sessions.execute('starting-session-001', 'ios', {}, async () => { ran = true; });
  const rejection = assert.rejects(execution, error => error.code === 'MOBILE_SESSION_CLOSING');
  const closing = sessions.close('starting-session-001');
  starting.resolve({ deleteSession: async () => { deleted++; } });
  await closing; await rejection; await sessions.dispose();
  assert.equal(ran, false); assert.equal(deleted, 1);
});

test('closing drivers retain capacity and failed old operations cannot close replacements', async () => {
  const cleanup = deferred(), running = deferred(), started = deferred();
  let created = 0, deleted = 0;
  const sessions = createExecutionSessions({ maxSessions: 1, createDriver: async () => {
    const generation = ++created;
    return { generation, deleteSession: async () => { deleted++; if (generation === 1) await cleanup.promise; } };
  } });
  const id = 'concurrent-session-001';
  const first = sessions.execute(id, 'android', {}, async () => { started.resolve(); await running.promise; throw new Error('old operation failed'); });
  const rejected = assert.rejects(first, /old operation failed/);
  await started.promise;
  const closing = sessions.close(id);
  await assert.rejects(sessions.execute('concurrent-session-002', 'android', {}, async () => {}), error => error.code === 'MOBILE_EXECUTION_CAPACITY' && error.statusCode === 429);
  cleanup.resolve(); await closing;
  assert.equal(await sessions.execute(id, 'android', {}, async driver => driver.generation), 2);
  running.resolve(); await rejected;
  assert.equal(await sessions.execute(id, 'android', {}, async driver => driver.generation), 2);
  assert.equal(deleted, 1);
  await sessions.dispose();
  await assert.rejects(sessions.execute(id, 'android', {}, async () => {}), error => error.code === 'MOBILE_ENGINE_STOPPING');
  assert.equal(deleted, 2);
});

test('cleanup diagnostics cannot replace the original device failure', async () => {
  const sessions = createExecutionSessions({ createDriver: async () => ({ deleteSession: async () => { throw new Error('delete failed'); } }), onCloseError: () => { throw new Error('logger failed'); } });
  await assert.rejects(sessions.execute('failed-session-001', 'ios', {}, async () => { throw new Error('device failed'); }), /device failed/);
  await sessions.dispose();
});
