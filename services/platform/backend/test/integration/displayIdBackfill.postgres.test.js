const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("runtime display ID backfill preserves existing IDs and survives API restarts", {
  skip: process.env.DISPLAY_ID_POSTGRES !== "1", timeout: 120000
}, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_display_ids_[a-z0-9_]+$/);
  const db = require("../../src/db");
  const tables = [
    { table: "projects", prefix: "PROJ-", label: "name" },
    { table: "requirements", prefix: "RC_", label: "title", scope: "project_id", scopeId: "projects-existing-one" },
    { table: "test_cases", prefix: "TC_", label: "title", scope: "app_type_id", scopeId: "app" },
    { table: "test_suites", prefix: "TS-", label: "name", scope: "app_type_id", scopeId: "app" },
    { table: "shared_step_groups", prefix: "SG-", label: "name", scope: "app_type_id", scopeId: "app" }
  ];
  const insert = (entry, suffix, displayId, createdAt = "2026-01-01T00:00:00.000Z") => {
    const columns = ["id", "display_id", entry.label, "created_at", ...(entry.scope ? [entry.scope] : [])];
    return db.prepare(`INSERT INTO ${entry.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(`${entry.table}-${suffix}`, displayId, suffix, createdAt, ...(entry.scope ? [entry.scopeId] : []));
  };
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async ({ table }) => [
    table, await db.prepare(`SELECT id,display_id FROM ${table} ORDER BY id`).all()
  ])));
  const startFreshBootstrap = async () => {
    // ensureRuntimeSchema memoizes in one process. Reload only its module to
    // reproduce the next API process, so idempotence exercises actual SQL.
    const modulePath = require.resolve("../../src/db/bootstrap");
    delete require.cache[modulePath];
    await require(modulePath).ensureRuntimeSchema();
  };
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../instance-setup-data/schema-setup/schema.sql"), "utf8"));
    for (const entry of tables) {
      await insert(entry, "existing-one", `${entry.prefix}1`);
      if (entry.table === "projects") {
        await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES ('app','projects-existing-one','Verification','web')").run();
      }
      await insert(entry, "existing-high", `${entry.prefix}42`);
      await insert(entry, "existing-custom", "preserve-custom-label");
      await insert(entry, "missing-b", null);
      await insert(entry, "missing-a", null);
      await insert(entry, "missing-null-date", null, null);
    }
    const before = await snapshot();
    await startFreshBootstrap();
    const first = await snapshot();
    for (const { table, prefix } of tables) {
      await context.test(`${table}: unique backfill above existing maximum without renaming saved IDs`, () => {
        const current = new Map(first[table].map(row => [row.id, row.display_id]));
        assert.equal(current.size, before[table].length);
        assert.equal(new Set(current.values()).size, current.size);
        assert.ok([...current.values()].every(Boolean));
        for (const row of before[table].filter(row => row.display_id !== null)) {
          assert.equal(current.get(row.id), row.display_id);
        }
        assert.equal(current.get(`${table}-missing-a`), `${prefix}43`);
        assert.equal(current.get(`${table}-missing-b`), `${prefix}44`);
        assert.equal(current.get(`${table}-missing-null-date`), `${prefix}45`);
      });
    }
    await context.test("second process bootstrap is idempotent across all five tables", async () => {
      await startFreshBootstrap();
      assert.deepEqual(await snapshot(), first);
    });
    await context.test("later imported NULL IDs continue after the previously backfilled sequence", async () => {
      for (const entry of tables) await insert(entry, "later-import", null);
      await startFreshBootstrap();
      const after = await snapshot();
      for (const { table, prefix } of tables) {
        const current = new Map(after[table].map(row => [row.id, row.display_id]));
        for (const row of first[table]) assert.equal(current.get(row.id), row.display_id);
        assert.equal(current.get(`${table}-later-import`), `${prefix}46`);
        assert.equal(new Set(current.values()).size, current.size);
      }
    });
  } finally { await db.close(); }
});
