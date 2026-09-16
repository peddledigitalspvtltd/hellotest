const assert = require("node:assert/strict");
const test = require("node:test");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { INDEX_CATALOG, createPerformanceIndexingService, indexingClientOptions } = require("../src/services/performanceIndexing.service");

test("the dedicated connection preserves pg-pool's hidden credentials without changing the API pool", () => {
  const poolOptions = { host: "database", statement_timeout: 120000, query_timeout: 125000, ssl: { rejectUnauthorized: true } };
  Object.defineProperty(poolOptions, "password", { value: "test-only", enumerable: false });
  const options = indexingClientOptions(poolOptions);
  assert.equal(options.password, "test-only");
  assert.equal(options.ssl, poolOptions.ssl);
  assert.equal(options.statement_timeout, 900000);
  assert.equal(options.query_timeout, 0);
  assert.equal(options.lock_timeout, 5000);
  assert.equal(poolOptions.statement_timeout, 120000);
});

function fixture() {
  const state = { job: null, lock: null, clients: [], statements: [], indexes: [], audits: [], tasks: [], fail: new Map(), gate: null };
  const query = async () => ({ rows: [{ job: structuredClone(state.job), running: Boolean(state.lock) }] });
  const connect = async () => {
    const client = {
      ended: false,
      async query(sql, parameters = []) {
        state.statements.push({ sql, parameters });
        if (sql.includes("pg_try_advisory_lock")) {
          if (state.lock) return { rows: [{ acquired: false }] };
          state.lock = client; return { rows: [{ acquired: true }] };
        }
        if (sql.startsWith("INSERT INTO app_settings")) { state.job = JSON.parse(parameters[1]); return { rows: [] }; }
        if (sql.startsWith("INSERT INTO admin_audit_log")) { state.audits.push(parameters[2]); return { rows: [] }; }
        if (sql.includes("pg_get_indexdef")) return { rows: state.indexes.filter(index => `public.${index.table}` === parameters[0]) };
        if (sql.startsWith("DROP INDEX")) { state.indexes = state.indexes.filter(index => !sql.endsWith(`public.${index.name}`)); return { rows: [] }; }
        if (sql.startsWith("CREATE INDEX")) {
          const index = INDEX_CATALOG.find(index => sql.includes(` ${index.name} `));
          assert.ok(index, "all DDL must refer to the fixed index catalog");
          if (state.gate) { const gate = state.gate; state.gate = null; await gate; }
          const failure = state.fail.get(index.name);
          state.indexes.push({ ...index, definition: `CREATE INDEX ${index.name} ON public.${index.table} USING btree ${index.definition}`, valid: !failure });
          if (failure) { state.fail.delete(index.name); throw Object.assign(new Error("sensitive server details"), { code: failure }); }
          return { rows: [] };
        }
        if (sql.includes("SELECT i.indisvalid AS valid")) return { rows: state.indexes.filter(index => `public.${index.name}` === parameters[0] && `public.${index.table}` === parameters[1]) };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async end() { client.ended = true; if (state.lock === client) state.lock = null; }
    };
    state.clients.push(client);
    return client;
  };
  const makeService = () => createPerformanceIndexingService({ query, connect, schedule: task => state.tasks.push(task) });
  const service = makeService();
  const finish = async () => {
    state.tasks.splice(0).forEach(task => task());
    for (let tries = 0; tries < 100; tries += 1) {
      await nextTurn();
      if (!state.lock) return;
    }
    throw new Error("Indexing worker did not finish");
  };
  return { state, service, makeService, finish };
}

test("indexing runs asynchronously with persistent progress, cross-instance exclusion, and no transaction", async () => {
  const { state, service, makeService, finish } = fixture();
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  const started = await service.start({ actorId: "admin", ipAddress: "127.0.0.1" });
  assert.equal(started.running, true);
  assert.equal(started.job.completed, 0);
  assert.equal(started.job.ip_address, undefined);
  state.tasks.shift()();
  await nextTurn();
  const observed = await makeService().status();
  assert.equal(observed.job.indexes[0].status, "running");
  const duplicate = await makeService().start({ actorId: "second-admin" });
  assert.equal(duplicate.job.id, started.job.id);
  assert.equal(state.clients[1].ended, true);
  assert.equal(state.audits.length, 1, "duplicate clicks cannot schedule a second build");
  release(); await finish();
  const result = await service.status();
  assert.equal(result.running, false);
  assert.equal(result.job.status, "completed");
  assert.equal(result.job.completed, INDEX_CATALOG.length);
  assert.ok(result.job.indexes.every(index => index.status === "created"));
  assert.equal(state.clients[0].ended, true);
  assert.deepEqual(state.audits, ["schema.performance_indexing.start", "schema.performance_indexing.finish"]);
  assert.ok(state.statements.filter(item => item.sql.startsWith("CREATE INDEX")).every(item => item.sql.includes("CONCURRENTLY IF NOT EXISTS")));
  assert.ok(state.statements.every(item => !/^BEGIN|^COMMIT|^TRUNCATE|^DELETE FROM/i.test(item.sql)));
});

test("reruns retain valid equivalent indexes, including bootstrap indexes with different names", async () => {
  const { state, service, finish } = fixture();
  const index = INDEX_CATALOG.find(item => item.table === "test_cases");
  state.indexes.push({ ...index, name: "existing_catalog_index", valid: true, definition: `CREATE INDEX existing_catalog_index ON public.${index.table} USING btree ${index.definition.replace("(COALESCE(updated_at, created_at))", "COALESCE(updated_at, created_at)")}` });
  await service.start({ actorId: "admin" }); await finish();
  assert.equal(state.job.indexes.find(item => item.name === index.name).existing_name, "existing_catalog_index");
  const ddlBefore = state.statements.filter(item => item.sql.startsWith("CREATE INDEX")).length;
  await service.start({ actorId: "admin" }); await finish();
  assert.ok(state.job.indexes.every(index => index.status === "existing"));
  assert.equal(state.statements.filter(item => item.sql.startsWith("CREATE INDEX")).length, ddlBefore);
});

test("timed out builds report partial results and repair only their own invalid indexes on retry", async () => {
  const { state, service, finish } = fixture();
  const index = INDEX_CATALOG[0];
  state.fail.set(index.name, "57014");
  await service.start({ actorId: "admin" }); await finish();
  assert.equal(state.job.status, "partial");
  assert.equal(state.job.completed, INDEX_CATALOG.length);
  assert.match(state.job.indexes[0].error, /time limit/);
  assert.doesNotMatch(JSON.stringify(state.job), /sensitive server details/);
  await service.start({ actorId: "admin" }); await finish();
  assert.equal(state.job.status, "completed");
  assert.deepEqual(state.statements.filter(item => item.sql.startsWith("DROP INDEX")).map(item => item.sql), [`DROP INDEX CONCURRENTLY IF EXISTS public.${index.name}`]);
});

test("an interrupted worker is recognized from the database lock and can resume", async () => {
  const { state, service, finish } = fixture();
  await service.start({ actorId: "admin" });
  state.tasks.length = 0;
  await state.clients[0].end();
  const interrupted = await service.status();
  assert.equal(interrupted.running, false);
  assert.equal(interrupted.job.status, "interrupted");
  assert.match(interrupted.job.error, /resume safely/);
  await service.start({ actorId: "admin" }); await finish();
  assert.equal(state.job.status, "completed");
});

test("a conflicting index definition is reported and never removed, even when invalid", async () => {
  for (const valid of [true, false]) {
    const { state, service, finish } = fixture();
    const index = INDEX_CATALOG[0];
    state.indexes.push({ ...index, valid, definition: `CREATE INDEX ${index.name} ON public.users USING btree (id)` });
    await service.start({ actorId: "admin" }); await finish();
    assert.equal(state.job.status, "partial");
    assert.match(state.job.indexes[0].error, /different definition/);
    assert.equal(state.statements.some(item => item.sql.startsWith("DROP INDEX")), false);
  }
});

test("API shutdown closes indexing sessions, releases locks, and refuses new jobs", async () => {
  const { state, service } = fixture();
  await service.start({ actorId: "admin" });
  await service.close();
  assert.equal(state.clients[0].ended, true);
  assert.equal(state.lock, null);
  assert.equal((await service.status()).job.status, "interrupted");
  state.tasks.shift()();
  await nextTurn();
  assert.equal(state.statements.some(item => item.sql.startsWith("CREATE INDEX")), false);
  await assert.rejects(service.start({ actorId: "admin" }), { statusCode: 503 });
});
