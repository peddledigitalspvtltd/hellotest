const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const keys = require('../services/apiKey.service');

test('Design and User keys permit Story reads and writes while Read and unrelated scopes remain limited', () => {
  for (const [method, permission] of [['GET','requirement.view'],['POST','requirement.create'],['PUT','requirement.update'],['PUT','requirement_iteration.update']]) {
    assert.equal(keys.isScopeAllowed('design', permission, method), true);
    assert.equal(keys.isScopeAllowed('user', permission, method), true);
    assert.equal(keys.isScopeAllowed('read', permission, method), method === 'GET');
    assert.equal(keys.isScopeAllowed('runs', permission, method), false);
  }
  assert.equal(keys.isScopeAllowed('design', 'user.manage', 'POST'), false);
  assert.equal(keys.isScopeAllowed('desgin', 'requirement.update', 'PUT'), false, 'An unknown scope cannot become broad User access');
  assert.equal(keys.isScopeAllowed('', 'requirement.update', 'PUT'), false);
});

test('unsupported creation scopes fail before persisting a credential', async t => {
  let writes = 0;
  t.mock.method(db, 'prepare', () => { writes++; return { get: async () => ({}) }; });
  for (const scope of ['desgin', '', null, 'all']) await assert.rejects(keys.createApiKey({ user_id: 'user', name: 'Scoped API test', scope }), { statusCode: 400 });
  assert.equal(writes, 0);
});

test('credentials persist only a SHA-256 digest and list responses omit secret material', async t => {
  let stored;
  t.mock.method(db, 'prepare', sql => ({
    get: async (...values) => {
      stored = { id: values[0], user_id: values[1], name: values[2], key_hash: values[3], key_prefix: values[4], scope: values[5], is_active: true };
      return stored;
    },
    all: async () => [stored]
  }));
  const issued = await keys.createApiKey({ user_id: 'user', name: 'Scoped API test' });
  assert.equal(issued.api_key.scope, 'user', 'An omitted scope preserves the documented default');
  assert.ok(/^[a-f0-9]{64}$/.test(stored.key_hash));
  assert.ok(!stored.key_hash.includes(issued.key));
  const listed = await keys.listApiKeys('user');
  assert.ok(!JSON.stringify(listed).includes(issued.key));
  assert.equal(listed[0].key_hash, undefined);
});
