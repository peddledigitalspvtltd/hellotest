const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");

test("startup case backfills repair legacy values without rewriting current rows", {
  skip: !process.env.SCHEMA_BACKFILL_TEST_DATABASE_URL,
  timeout: 30_000
}, async () => {
  const source = await readFile(path.join(__dirname, "../../src/db/bootstrap.js"), "utf8");
  const updates = [...source.matchAll(/`(UPDATE (requirements|test_suites|shared_step_groups|test_cases) SET updated_at = [^`]+)`/g)];
  assert.deepEqual(updates.map(match => match[2]).sort(), ["requirements", "shared_step_groups", "test_cases", "test_suites"]);
  const client = new Client({ connectionString: process.env.SCHEMA_BACKFILL_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    // Only temporary tables are visible to the actual bootstrap statements.
    // Both the temporary schema and all writes disappear on rollback/close.
    await client.query("SET LOCAL search_path = pg_temp");
    const transactionTime = (await client.query("SELECT CURRENT_TIMESTAMP AS now")).rows[0].now;
    for (const [, statement, table] of updates) {
      await client.query(`CREATE TEMP TABLE ${table}(id text PRIMARY KEY, created_at timestamptz, updated_at timestamptz) ON COMMIT DROP`);
      await client.query(`INSERT INTO ${table} VALUES
        ('current', '2025-01-01', '2026-01-01'),
        ('current_without_creation', NULL, '2026-02-01'),
        ('missing_update', '2025-03-01', NULL),
        ('missing_both', NULL, NULL)`);
      const before = (await client.query(`SELECT id, ctid::text AS tuple, updated_at FROM ${table} ORDER BY id`)).rows;
      assert.equal((await client.query(statement)).rowCount, 2, `${table}: only missing timestamps need a write`);
      const after = (await client.query(`SELECT id, ctid::text AS tuple, created_at, updated_at FROM ${table} ORDER BY id`)).rows;
      for (const existing of before.filter(row => row.updated_at !== null)) {
        const current = after.find(row => row.id === existing.id);
        assert.equal(current.tuple, existing.tuple, `${table}: valid row keeps its physical tuple`);
        assert.deepEqual(current.updated_at, existing.updated_at, `${table}: existing activity timestamp stays exact`);
      }
      assert.deepEqual(after.find(row => row.id === "missing_update").updated_at, new Date("2025-03-01T00:00:00Z"));
      assert.deepEqual(after.find(row => row.id === "missing_both").updated_at, transactionTime);
      assert.equal((await client.query(statement)).rowCount, 0, `${table}: subsequent startup rewrites no rows`);
    }

    const normalizers = [...source.matchAll(/`(\s*UPDATE test_cases\s+SET (automated|automation_status) = [^`]+)`/g)];
    assert.deepEqual(normalizers.map(match => match[2]), ["automated", "automation_status"]);
    await client.query("ALTER TABLE test_cases ADD COLUMN automated text DEFAULT 'no', ADD COLUMN automation_status text DEFAULT 'not_automated'");
    await client.query(`INSERT INTO test_cases(id, automated, automation_status) VALUES
      ('canonical_yes_ready', 'yes', 'ready'),
      ('canonical_yes_incomplete', 'yes', 'incomplete'),
      ('canonical_no', 'no', 'not_automated'),
      ('legacy_yes', ' YES ', 'not_automated'),
      ('legacy_no', 'FALSE', 'ready'),
      ('legacy_null', NULL, NULL),
      ('legacy_blank', ' ', 'incomplete'),
      ('yes_without_status', 'yes', NULL),
      ('yes_needs_ready', 'yes', 'not_automated'),
      ('no_needs_status', 'no', NULL)`);
    const before = (await client.query("SELECT id, ctid::text AS tuple FROM test_cases WHERE id LIKE 'canonical_%' OR id = 'yes_without_status'")).rows;
    assert.equal((await client.query(normalizers[0][1])).rowCount, 4, "Only noncanonical automation flags are normalized");
    assert.equal((await client.query(normalizers[1][1])).rowCount, 6, "Only statuses changed by the compatibility mapping are rewritten");
    const after = (await client.query("SELECT id, ctid::text AS tuple, automated, automation_status FROM test_cases")).rows;
    for (const current of before) {
      assert.equal(after.find(row => row.id === current.id).tuple, current.tuple, `${current.id}: valid automation row keeps its physical tuple`);
    }
    const expected = {
      legacy_yes: ["yes", "ready"], legacy_no: ["no", "not_automated"],
      legacy_null: ["no", "not_automated"], legacy_blank: ["no", "not_automated"],
      yes_without_status: ["yes", null], yes_needs_ready: ["yes", "ready"],
      no_needs_status: ["no", "not_automated"]
    };
    for (const [id, values] of Object.entries(expected)) {
      const row = after.find(item => item.id === id);
      assert.deepEqual([row.automated, row.automation_status], values, id);
    }
    for (const [, statement] of normalizers) assert.equal((await client.query(statement)).rowCount, 0, "Repeated startup does not rewrite canonical automation rows");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
