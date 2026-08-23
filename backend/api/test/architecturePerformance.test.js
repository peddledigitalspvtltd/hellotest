const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createStatementName,
  serializeParam,
  toPgPlaceholders
} = require("../src/db/createPostgresAdapter");
const { groupRows, placeholdersFor, uniqueIds } = require("../src/utils/batchHydration");

test("shared PostgreSQL adapter compiles positional parameters without rewriting SQL literals or JSON operators", () => {
  const sql = `
    SELECT payload ? 'enabled', payload ?| array['a', 'b'], '?' AS literal, $$?$$ AS body
    FROM records
    WHERE project_id = ? AND status = ?
  `;
  const compiled = toPgPlaceholders(sql);

  assert.match(compiled, /payload \? 'enabled'/);
  assert.match(compiled, /payload \?\| array/);
  assert.match(compiled, /'\?' AS literal/);
  assert.match(compiled, /\$\$\?\$\$ AS body/);
  assert.match(compiled, /project_id = \$1 AND status = \$2/);
});

test("prepared statement identities are deterministic, bounded, and isolated by database namespace", () => {
  const sql = "SELECT * FROM requirements WHERE project_id = $1";
  const mainName = createStatementName(sql, "hellotest_main");

  assert.equal(mainName, createStatementName(sql, "hellotest_main"));
  assert.notEqual(mainName, createStatementName(sql, "hellotest_obs"));
  assert.ok(mainName.length <= 63);
});

test("adapter serialization preserves scalar values and normalizes structured JSON inputs", () => {
  assert.equal(serializeParam("value"), "value");
  assert.equal(serializeParam(7), 7);
  assert.equal(serializeParam(null), null);
  assert.equal(serializeParam(["a", "b"]), '["a","b"]');
  assert.equal(serializeParam({ enabled: true }), '{"enabled":true}');
});

test("batch hydration utilities de-duplicate identifiers and group relation rows in linear time", () => {
  const source = [{ id: "a" }, { id: "b" }, { id: "a" }, null];
  const relations = [
    { owner_id: "a", child_id: "1" },
    { owner_id: "b", child_id: "2" },
    { owner_id: "a", child_id: "3" }
  ];

  assert.deepEqual(uniqueIds(source), ["a", "b"]);
  assert.equal(placeholdersFor(["a", "b", "c"]), "?, ?, ?");
  assert.deepEqual(groupRows(relations, "owner_id").get("a"), [relations[0], relations[2]]);
});
