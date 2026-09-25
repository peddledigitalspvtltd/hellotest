const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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

test("placeholder compilation preserves escaped quotes, dollar bodies, comments and JSON operator context", () => {
  const examples = [
    [
      `SELECT '?', 'it''s ?', "why?""quoted?" FROM records WHERE id = ? -- ? comment\n AND active = ? /* ? */`,
      `SELECT '?', 'it''s ?', "why?""quoted?" FROM records WHERE id = $1 -- ? comment\n AND active = $2 /* ? */`
    ],
    [
      `DO $tag_1$ BEGIN RAISE NOTICE '?'; PERFORM $$?$$; END; $tag_1$; SELECT ?, $$?$$, $other$?$other$, ?;`,
      `DO $tag_1$ BEGIN RAISE NOTICE '?'; PERFORM $$?$$; END; $tag_1$; SELECT $1, $$?$$, $other$?$other$, $2;`
    ],
    [
      `SELECT payload ? 'enabled', (payload) ? \n 'field', payload[1] ? 'x', "payload" ? 'x', payload ?| array['a'], payload ?& array['b'] WHERE id = ? AND flag = ?`,
      `SELECT payload ? 'enabled', (payload) ? \n 'field', payload[1] ? 'x', "payload" ? 'x', payload ?| array['a'], payload ?& array['b'] WHERE id = $1 AND flag = $2`
    ],
    [`SELECT ? ? 'field', ??'other', ?`, `SELECT $1 ? 'field', $2?'other', $3`],
    [`SELECT payload ?\u2003'key', ?`, `SELECT payload ?\u2003'key', $1`],
    [`SELECT ? -- unfinished ?`, `SELECT $1 -- unfinished ?`],
    [`SELECT ? /* unfinished ?`, `SELECT $1 /* unfinished ?`],
    [`SELECT $not_a_tag, $1, ?`, `SELECT $not_a_tag, $1, $1`]
  ];
  for (const [source, expected] of examples) assert.equal(toPgPlaceholders(source), expected);
});

test("large hydration IN queries compile within a bounded child process and preserve every parameter", { timeout: 10_000 }, () => {
  // A separate process enforces the limit even if synchronous compilation blocks
  // the event loop, as it did when the converter rescanned every emitted prefix.
  const child = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const { toPgPlaceholders } = require(process.argv[1]);
    const ids = Array(50_000).fill('?').join(', ');
    const sql = 'SELECT test_case_id FROM requirement_test_cases WHERE test_case_id IN (' + ids + ')'
      + ' UNION SELECT id FROM test_cases WHERE id IN (' + ids + ')';
    const started = performance.now();
    const compiled = toPgPlaceholders(sql);
    const elapsedMs = performance.now() - started;
    let index = 0;
    assert.equal(compiled, sql.replace(/\\?/g, () => '$' + (++index)));
    assert.equal(index, 100_000);
    process.stdout.write(JSON.stringify({ parameters: index, elapsedMs }));
  `, require.resolve("../src/db/createPostgresAdapter")], { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 });
  assert.equal(child.error, undefined, child.error?.message || "SQL compilation exceeded its time limit");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).parameters, 100_000);
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
