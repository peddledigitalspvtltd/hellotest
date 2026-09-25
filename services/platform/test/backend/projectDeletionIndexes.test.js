const assert = require("node:assert/strict");
const test = require("node:test");
const { ensureProjectDeletionIndexes } = require("../../backend/services/projectDeletionIndexes");

const definition = {
  name: "idx_delete_cases_parent", table: "cases", columns: ["parent_id"],
  sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delete_cases_parent ON cases(parent_id)"
};
const metadata = (overrides = {}) => ({
  name: definition.name, valid: true, ready: true, target_table: true,
  access_method: "btree", full_index: true, plain_index: true,
  key_columns: ["parent_id"], ...overrides
});
const clientFor = (...snapshots) => {
  const calls = [];
  return {
    calls,
    async query(query) {
      const text = typeof query === "string" ? query : query.text;
      calls.push(text);
      return { rows: text.startsWith("SELECT") ? snapshots.shift() || [] : [] };
    }
  };
};

test("deletion preflight reuses a valid full btree prefix including composite indexes", async () => {
  const client = clientFor([metadata({ name: "existing", key_columns: ["parent_id", "id"] })]);
  await ensureProjectDeletionIndexes(client, [definition]);
  assert.equal(client.calls.length, 1);
});

test("deletion preflight rejects same-name conflicting definitions without dropping them", async t => {
  for (const [name, fields] of Object.entries({
    expression: { plain_index: false, key_columns: [null] },
    partial: { full_index: false },
    hash: { access_method: "hash" },
    otherTable: { target_table: false },
    wrongLeadingColumn: { key_columns: ["id", "parent_id"] }
  })) await t.test(name, async () => {
    const client = clientFor([metadata(fields)]);
    await assert.rejects(ensureProjectDeletionIndexes(client, [definition]), { code: "DELETION_INDEX_CONFLICT" });
    assert.equal(client.calls.length, 1);
  });
});

test("included columns cannot substitute for missing required key columns", async () => {
  const client = clientFor([metadata({ name: "existing" })], [metadata({ key_columns: ["parent_id", "id"] })]);
  const composite = { ...definition, columns: ["parent_id", "id"] };
  await ensureProjectDeletionIndexes(client, [composite]);
  assert.ok(client.calls.includes(definition.sql));
});

test("deletion preflight repairs only its own matching invalid index", async () => {
  const client = clientFor([metadata({ valid: false, ready: false })], [metadata()]);
  await ensureProjectDeletionIndexes(client, [definition]);
  assert.ok(client.calls.includes('DROP INDEX CONCURRENTLY "public"."idx_delete_cases_parent"'));
  assert.ok(client.calls.includes(definition.sql));
  assert.ok(client.calls.includes("SET statement_timeout = '60s'"));
});

test("post-build verification rejects a valid expression index created under the expected name", async () => {
  const client = clientFor([], [metadata({ plain_index: false, key_columns: [null] })]);
  await assert.rejects(ensureProjectDeletionIndexes(client, [definition]), { code: "DELETION_INDEX_INCOMPLETE" });
});
