const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySchema, schemaMode, REQUIRED_SCHEMA_VERSION } = require('../src/db/schemaReadiness');

test('schema verification uses only reads and requires a committed compatible receipt', async () => {
  for (const [present, version, valid] of [[false, null, false], [true, null, false], [true, 0, false], [true, "invalid", false], [true, 1, false], [true, 2, false], [true, 3, false], [true, 4, false], [true, 5, false], [true, 6, false], [true, 7, false], [true, 8, false], [true, 9, false], [true, REQUIRED_SCHEMA_VERSION, true], [true, REQUIRED_SCHEMA_VERSION + 1, true]]) {
    const db = { prepare: sql => {
      assert.match(sql, /^SELECT /);
      return { get: async () => sql.includes('to_regclass') ? { name: present ? 'runtime_schema_receipts' : null } : version === null ? undefined : { version } };
    } };
    if (valid) await verifySchema(db, 'main');
    else await assert.rejects(verifySchema(db, 'main'), { code: 'SCHEMA_MIGRATION_REQUIRED', statusCode: 503 });
  }
});
test('schema mode defaults to compatible local startup and rejects mistyped deployment values', t => {
  const old = process.env.HELLOTEST_SCHEMA_MODE;
  t.after(() => { if (old === undefined) delete process.env.HELLOTEST_SCHEMA_MODE; else process.env.HELLOTEST_SCHEMA_MODE = old; });
  delete process.env.HELLOTEST_SCHEMA_MODE;
  assert.equal(schemaMode(), 'migrate');
  process.env.HELLOTEST_SCHEMA_MODE = 'verify';
  assert.equal(schemaMode(), 'verify');
  process.env.HELLOTEST_SCHEMA_MODE = 'verfy';
  assert.throws(schemaMode, /must be migrate or verify/);
});
