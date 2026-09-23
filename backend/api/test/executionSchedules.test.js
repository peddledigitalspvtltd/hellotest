const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const savedSchedule = { id: 'schedule', project_id: 'project', app_type_id: 'app', name: 'Smoke', cadence: 'weekly', next_run_at: '2026-10-01T10:00:00.000Z', suite_ids: ['suite'], test_case_ids: [], assigned_to_ids: [], created_by: 'creator', is_active: false };
function fixture(schedule = {}) {
  const current = { ...savedSchedule, ...schedule };
  const created = [], writes = [];
  const overrides = {
    '../db': { transaction: task => task, prepare(sql) { return {
      get: async id => /FROM execution_schedules/.test(sql) ? current : { id, project_id: 'project', app_type_id: 'app' },
      all: async () => [], run: async (...values) => { writes.push({ sql, values }); return { changes: 1 }; }
    }; } },
    './execution.service': { createExecution: async input => { created.push(input); return { id: 'run' }; } },
    './mobileFeature.service': { assertExecutionMobileFeatureEnabled: async () => {} }
  };
  const filename = path.resolve(__dirname, '../src/services/executionSchedule.service.js');
  const localRequire = createRequire(filename), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id), module, module.exports);
  return { service: module.exports, created, writes, current };
}

test('Run now launches paused recurrence while keeping its time and paused state', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.runExecutionSchedule('schedule', 'actor'), { id: 'run' });
  assert.equal(f.created[0].created_by, 'actor');
  assert.equal(f.created[0].execution_mode, 'remote');
  assert.deepEqual(f.writes[0].values, [savedSchedule.next_run_at, false, 'schedule']);
});

test('Run now preserves the next recurring time and consumes an active one-time schedule', async () => {
  for (const cadence of ['weekly', 'once']) {
    const f = fixture({ is_active: true, cadence });
    await f.service.runExecutionSchedule('schedule', 'actor');
    assert.deepEqual(f.writes[0].values, [cadence === 'once' ? null : savedSchedule.next_run_at, cadence !== 'once', 'schedule']);
  }
});

test('Claimed automatic schedules advance recurrence and carry durable idempotency', async () => {
  const f = fixture({ is_active: true });
  await f.service.runExecutionSchedule('schedule', null, { claimedSchedule: f.current, leaseOwner: 'worker' });
  assert.equal(f.created[0].source_idempotency_key, `execution-schedule:schedule:${savedSchedule.next_run_at}`);
  assert.deepEqual(f.writes[0].values, ['2026-10-08T10:00:00.000Z', true, 'schedule', 'worker']);
});

test('Automatic workers reject paused schedules and malformed schedules return actionable client errors', async () => {
  const paused = fixture();
  await assert.rejects(paused.service.runExecutionSchedule('schedule', null, { claimedSchedule: paused.current }), { statusCode: 409 });
  for (const invalid of [{ app_type_id: null }, { suite_ids: [], test_case_ids: [] }]) {
    const f = fixture(invalid);
    await assert.rejects(f.service.runExecutionSchedule('schedule', 'actor'), error => error.statusCode === 400 && /Edit schedule/.test(error.message));
    assert.equal(f.created.length, 0);
  }
});
