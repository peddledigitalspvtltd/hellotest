const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../backend/src/db');
const service = require('../../backend/services/adminPortal.service');
const samples = require('../../backend/services/sampleData');

function membershipFixture(t, { administrators = ['actor', 'other-admin'], existing = [], adminRole = { id: 'admin-role' } } = {}) {
  const state = { administrators, members: new Map(existing.map(member => [member.user_id, structuredClone(member)])), batches: [] };
  t.mock.method(samples, 'install', options => options.ensureWorkspace(options.actorId));
  t.mock.method(db, 'prepare', sql => ({
    get: async () => {
      assert.match(sql, /SELECT id FROM roles/);
      return adminRole;
    },
    all: async () => {
      assert.match(sql, /SELECT users.id FROM users/);
      return state.administrators.map(id => ({ id }));
    },
    run: async (...params) => {
      assert.match(sql, /INSERT INTO project_members/);
      assert.match(sql, /ON CONFLICT \(project_id, user_id\) DO NOTHING/);
      assert.equal(params.length % 3, 0);
      state.batches.push(params.length / 3);
      let changes = 0;
      for (let offset = 0; offset < params.length; offset += 3) {
        const [id, user_id, role_id] = params.slice(offset, offset + 3);
        if (state.members.has(user_id)) continue;
        state.members.set(user_id, { id, project_id: 'sample-project', user_id, role_id });
        changes++;
      }
      return { changes };
    }
  }));
  return state;
}

test('sample setup adds every eligible administrator and retains existing member identities and custom roles', async t => {
  const existing = [
    { id: 'custom-admin-membership', project_id: 'sample-project', user_id: 'other-admin', role_id: 'custom-reviewer' },
    { id: 'ordinary-membership', project_id: 'sample-project', user_id: 'ordinary-member', role_id: 'member-role' }
  ];
  const state = membershipFixture(t, { administrators: ['actor', 'other-admin', 'third-admin'], existing });
  assert.equal(await service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), 2);
  assert.equal(state.members.size, 4);
  for (const member of existing) assert.deepEqual(state.members.get(member.user_id), member);
  for (const id of ['actor', 'third-admin']) assert.equal(state.members.get(id).role_id, 'admin-role');
  const before = [...state.members.values()].map(member => structuredClone(member));
  assert.equal(await service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), 0);
  assert.deepEqual([...state.members.values()], before);
  state.administrators.push('new-admin');
  assert.equal(await service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), 1);
  assert.deepEqual([...state.members.values()].slice(0, before.length), before);
  assert.equal(state.members.get('new-admin').role_id, 'admin-role');
});

test('sample setup bounds membership batches while enrolling a large administrator list exactly once', async t => {
  const administrators = ['actor', ...Array.from({ length: 204 }, (_, index) => `admin-${index}`)];
  const state = membershipFixture(t, { administrators });
  assert.equal(await service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), 205);
  assert.deepEqual(state.batches, [100, 100, 5]);
  assert.equal(state.members.size, administrators.length);
  assert.equal(new Set([...state.members.values()].map(member => member.id)).size, administrators.length);
});

test('sample setup does not enroll an actor whose active workspace administrator access was revoked', async t => {
  const state = membershipFixture(t, { administrators: ['other-admin'] });
  await assert.rejects(service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), { statusCode: 403 });
  assert.equal(state.members.size, 0);
  assert.deepEqual(state.batches, []);
});

test('sample setup requires the canonical Admin role before creating memberships', async t => {
  const state = membershipFixture(t, { adminRole: null });
  await assert.rejects(service.seedSampleData({ actorId: 'actor', modules: ['workspace'] }), { statusCode: 409 });
  assert.equal(state.members.size, 0);
  assert.deepEqual(state.batches, []);
});
