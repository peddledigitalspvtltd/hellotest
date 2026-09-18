const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../src/db');
const roles = require('../src/services/role.service');
const flags = require('../src/services/featureFlag.service');

test('role editing retains configured grants through disable and re-enable without changing flags', async t => {
  const permissions = [
    { id: 'p-view', code: 'workspace.view', description: 'Workspace' },
    { id: 'p-create', code: 'testcase.create', description: 'Create cases' }
  ];
  let assigned = ['workspace.view', 'testcase.create'];
  let enabled = false;
  const flagWrites = [];
  t.mock.method(flags, 'updateLocalFlags', async patch => { flagWrites.push(patch); });
  t.mock.method(flags, 'getSnapshot', async () => ({
    flags: { 'hellotest.manual.test_cases': enabled },
    groups: [{ key: 'manual', label: 'Manual testing', features: [{ key: 'hellotest.manual.test_cases', label: 'Test cases' }] }]
  }));
  t.mock.method(db, 'transaction', callback => async () => {
    const before = [...assigned];
    try { return await callback(); } catch (error) { assigned = before; throw error; }
  });
  t.mock.method(db, 'prepare', sql => ({
    get: async id => { assert.equal(id, 'custom-role'); return { id, name: 'Custom role' }; },
    all: async () => /FROM role_permissions/.test(sql) ? permissions.filter(p => assigned.includes(p.code)) : permissions,
    run: async (id, ...permissionPairs) => {
      assert.equal(id, 'custom-role');
      if (/DELETE FROM role_permissions/.test(sql)) assigned = [];
      else if (/INSERT INTO role_permissions/.test(sql)) {
        for (let index = 0; index < permissionPairs.length; index += 2) assigned.push(permissions.find(p => p.id === permissionPairs[index]).code);
      }
      else throw new Error('Unexpected mutation: ' + sql);
    }
  }));
  const configured = await roles.getRolePermissions('custom-role');
  assert.deepEqual(configured.map(p => p.code), assigned);
  assert.equal(configured.find(p => p.code === 'testcase.create').features[0].enabled, false);
  const catalog = (await roles.listPermissions()).flatMap(group => group.permissions);
  assert.equal(catalog.find(p => p.code === 'testcase.create').features[0].enabled, false);
  await roles.replaceRolePermissions('custom-role', configured.map(p => p.code));
  assert.deepEqual(assigned, ['workspace.view', 'testcase.create']);
  await assert.rejects(roles.replaceRolePermissions('custom-role', ['unknown.permission']), /Unknown permissions/);
  assert.deepEqual(assigned, ['workspace.view', 'testcase.create']);
  enabled = true;
  assert.equal((await roles.getRolePermissions('custom-role')).find(p => p.code === 'testcase.create').features[0].enabled, true);
  assert.deepEqual(flagWrites, []);
  await roles.replaceRolePermissions('custom-role', ['workspace.view']);
  assert.deepEqual(assigned, ['workspace.view'], 'An explicit removal still removes the configured grant');
});
