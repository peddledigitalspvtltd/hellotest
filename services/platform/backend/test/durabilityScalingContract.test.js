const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createPostgresAdapter } = require("../src/db/createPostgresAdapter");
const { boundedInteger, createPoolOptions } = require("../src/db/poolConfig");

const readSource = (relativePath) => fs.readFile(path.join(__dirname, relativePath), "utf8");

class FakePool extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.totalCount = 4;
    this.idleCount = 1;
    this.waitingCount = 2;
    this.queries = [];
    this.releaseArguments = [];
    this.endCalls = 0;
    this.failRollback = false;
    this.failSavepointRollback = false;
    this.client = Object.assign(new EventEmitter(), {
      query: async (query) => {
        const text = typeof query === "string" ? query : query.text;
        this.queries.push(text);
        if (this.failSavepointRollback && text.startsWith("ROLLBACK TO SAVEPOINT")) {
          throw new Error("savepoint cleanup failed");
        }
        if (this.failRollback && text === "ROLLBACK") throw new Error("rollback failed");
        return { rows: [], rowCount: 0 };
      },
      release: (destroy) => this.releaseArguments.push(Boolean(destroy))
    });
  }

  async connect() {
    return this.client;
  }

  async query(query) {
    return this.client.query(query);
  }

  async end() {
    this.endCalls += 1;
  }
}

test("nested transactions use savepoints and can recover without leaking inner writes", async () => {
  const adapter = createPostgresAdapter({ poolConfig: { max: 5 }, PoolClass: FakePool });
  const originalError = new Error("inner operation failed");
  const nested = adapter.transaction(async () => {
    await adapter.query("SELECT 'inner'");
    throw originalError;
  });
  const outer = adapter.transaction(async () => {
    await assert.rejects(nested(), (error) => error === originalError);
    await adapter.query("SELECT 'outer continues'");
  });

  await outer();

  assert.deepEqual(adapter.pool.queries, [
    "BEGIN",
    "SAVEPOINT hellotest_sp_1",
    "SELECT 'inner'",
    "ROLLBACK TO SAVEPOINT hellotest_sp_1",
    "RELEASE SAVEPOINT hellotest_sp_1",
    "SELECT 'outer continues'",
    "COMMIT"
  ]);
  assert.deepEqual(adapter.pool.releaseArguments, [false]);
});

test("opted-in concurrent reads preserve savepoints and continue after one read fails", async () => {
  const adapter = createPostgresAdapter({ poolConfig: { max: 5 }, PoolClass: FakePool });
  const events = [];
  let releaseFirst, startedFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const started = new Promise(resolve => { startedFirst = resolve; });
  const failure = new Error("second read failed");

  await adapter.transaction(async () => {
    const first = adapter.serializedTransaction(async () => {
      events.push("first started");
      startedFirst();
      await gate;
      await adapter.query("SELECT 'first read'");
      events.push("first finished");
    })();
    const second = adapter.serializedTransaction(async () => {
      events.push("second started");
      throw failure;
    })();
    const third = adapter.serializedTransaction(async () => {
      events.push("third started");
      await adapter.query("SELECT 'third read'");
    })();
    const outcomes = Promise.allSettled([first, second, third]);
    await started;
    assert.deepEqual(events, ["first started"]);
    releaseFirst();
    const results = await outcomes;
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected", "fulfilled"]);
    assert.equal(results[1].reason, failure);
    await adapter.query("INSERT INTO fixture VALUES ('outer write still works')");
  })();

  assert.deepEqual(events, ["first started", "first finished", "second started", "third started"]);
  assert.deepEqual(adapter.pool.queries, [
    "BEGIN",
    "SAVEPOINT hellotest_sp_1",
    "SELECT 'first read'",
    "RELEASE SAVEPOINT hellotest_sp_1",
    "SAVEPOINT hellotest_sp_2",
    "ROLLBACK TO SAVEPOINT hellotest_sp_2",
    "RELEASE SAVEPOINT hellotest_sp_2",
    "SAVEPOINT hellotest_sp_3",
    "SELECT 'third read'",
    "RELEASE SAVEPOINT hellotest_sp_3",
    "INSERT INTO fixture VALUES ('outer write still works')",
    "COMMIT"
  ]);
  assert.deepEqual(adapter.pool.releaseArguments, [false]);
});

test("transaction cleanup failures preserve the original error and evict a broken client", async () => {
  const adapter = createPostgresAdapter({ poolConfig: { max: 5 }, PoolClass: FakePool });
  const originalError = new Error("business failure");
  adapter.pool.failRollback = true;
  const transaction = adapter.transaction(async () => {
    throw originalError;
  });

  await assert.rejects(transaction(), (error) => {
    assert.equal(error, originalError);
    assert.equal(error.rollbackError?.message, "rollback failed");
    return true;
  });
  assert.deepEqual(adapter.pool.releaseArguments, [true]);
});

for (const outcome of ['commit', 'rollback']) {
  test(`detached work after ${outcome} opens a fresh transaction instead of reusing a released client`, async () => {
    const adapter = createPostgresAdapter({ poolConfig: { max: 5 }, PoolClass: FakePool });
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    let detached;
    const outer = adapter.transaction(async () => {
      detached = (async () => {
        await gate;
        await adapter.transaction(async () => adapter.query("SELECT 'later worker'"))();
      })();
      if (outcome === 'rollback') throw new Error('outer failed');
    });
    if (outcome === 'rollback') await assert.rejects(outer(), /outer failed/);
    else await outer();
    resume();
    await detached;
    assert.deepEqual(adapter.pool.queries, ['BEGIN', outcome === 'commit' ? 'COMMIT' : 'ROLLBACK', 'BEGIN', "SELECT 'later worker'", 'COMMIT']);
    assert.deepEqual(adapter.pool.releaseArguments, [false, false]);
  });
}

test('a detached plain query uses the pool after its parent transaction finishes', async () => {
  const adapter = createPostgresAdapter({ poolConfig: { max: 5 }, PoolClass: FakePool });
  let resume, detached, pooled = 0;
  const gate = new Promise(resolve => { resume = resolve; });
  const query = adapter.pool.query.bind(adapter.pool);
  adapter.pool.query = async (...args) => { pooled += 1; return query(...args); };
  await adapter.transaction(async () => {
    detached = (async () => { await gate; await adapter.query("SELECT 'detached query'"); })();
  })();
  resume(); await detached;
  assert.equal(pooled, 1, 'The expired async context must never query its released transaction client');
});

test("pool errors are captured, saturation is observable, and shutdown is idempotent", async () => {
  const errors = [];
  const adapter = createPostgresAdapter({
    poolConfig: { max: 5 },
    PoolClass: FakePool,
    onPoolError: (error) => errors.push(error.code)
  });

  adapter.pool.emit("error", Object.assign(new Error("network partition"), { code: "ECONNRESET" }));
  const stats = adapter.getPoolStats();
  assert.deepEqual(errors, ["ECONNRESET"]);
  assert.equal(stats.active, 3);
  assert.equal(stats.waiting, 2);
  assert.equal(stats.saturated, true);
  assert.equal(stats.background_error_count, 1);

  const firstClose = adapter.close();
  const secondClose = adapter.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(adapter.pool.endCalls, 1);
});

test("pool options reject pathological environment values and set finite failure bounds", () => {
  assert.equal(boundedInteger("not-a-number", 7, { min: 1, max: 10 }), 7);
  assert.equal(boundedInteger("0", 7, { min: 1, max: 10 }), 1);
  assert.equal(boundedInteger("999", 7, { min: 1, max: 10 }), 10);

  const options = createPoolOptions({ applicationName: "contract-test" });
  assert.equal(options.application_name, "contract-test");
  assert.ok(options.max >= 1);
  assert.ok(options.statement_timeout > 0);
  assert.ok(options.query_timeout >= options.statement_timeout);
  assert.ok(options.lock_timeout > 0);
  assert.ok(options.idle_in_transaction_session_timeout > 0);
});

test("runtime migrations, queues, schedules, and recurring workers use durable coordination", async () => {
  const [mainBootstrap, obsBootstrap, aiQueue, schedules, backgroundTasks, schema] = await Promise.all([
    readSource("../src/db/bootstrap.js"),
    readSource("../src/obsDb/bootstrap.js"),
    readSource("../../../ai/backend/services/aiTestCaseGeneration.service.js"),
    readSource("../../../testing/backend/services/executionSchedule.service.js"),
    readSource("../src/plugins/backgroundTasks.js"),
    readSource("../instance-setup-data/schema-setup/schema.sql")
  ]);

  for (const bootstrap of [mainBootstrap, obsBootstrap]) {
    assert.match(bootstrap, /pg_advisory_xact_lock/);
    assert.match(bootstrap, /\.transaction\(async/);
  }
  assert.match(aiQueue, /FOR UPDATE SKIP LOCKED/);
  assert.match(aiQueue, /lease_expires_at/);
  assert.match(aiQueue, /source_idempotency_key: `ai-job:/);
  assert.match(schedules, /FOR UPDATE SKIP LOCKED/);
  assert.match(schedules, /source_idempotency_key: claimedSchedule/);
  assert.match(backgroundTasks, /Promise\.allSettled\(\[\.\.\.inFlight\]\)/);
  assert.match(schema, /idx_ai_test_case_generation_jobs_idempotency/);
  assert.match(schema, /idx_executions_source_idempotency/);
  assert.match(schema, /idx_execution_schedules_due_claim/);
});

test("a disconnect on a checked-out transaction connection rejects work without crashing or replaying writes", async () => {
  const errors = [];
  const adapter = createPostgresAdapter({poolConfig:{max:5}, PoolClass:FakePool, onPoolError:error=>errors.push(error)});
  const disconnected = Object.assign(new Error("Connection terminated unexpectedly"), {code:"ECONNRESET"});
  await assert.rejects(adapter.transaction(async()=>{
    adapter.pool.client.emit("error", disconnected);
    await adapter.query("INSERT INTO fixture VALUES (1)");
  })(), error=>error===disconnected);
  assert.deepEqual(adapter.pool.releaseArguments,[true]);
  assert.ok(!adapter.pool.queries.some(sql=>sql.startsWith("INSERT") || sql==='COMMIT'));
  assert.equal(errors[0],disconnected);
  assert.equal(adapter.pool.client.listenerCount("error"),0);
  await adapter.transaction(async()=>adapter.query("SELECT 1"))();
  assert.deepEqual(adapter.pool.releaseArguments,[true,false]);
});
test("a disconnect during commit remains an unknown transaction outcome and is never automatically retried", async()=>{
 const adapter=createPostgresAdapter({poolConfig:{max:5},PoolClass:FakePool,onPoolError:()=>{}});
 const original=adapter.pool.client.query;const error=new Error('Connection terminated unexpectedly');let commits=0;
 adapter.pool.client.query=async query=>{if(query==='COMMIT'){commits++;adapter.pool.client.emit('error',error);throw error;}return original(query);};
 await assert.rejects(adapter.transaction(async()=>adapter.query('SELECT 1'))(), failure=>failure===error&&failure.transactionOutcomeUnknown===true);
 assert.equal(commits,1);assert.deepEqual(adapter.pool.releaseArguments,[true]);
});
