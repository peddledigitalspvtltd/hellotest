const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createPostgresAdapter } = require("../src/db/createPostgresAdapter");
const {
  assertDatabaseOperationActive,
  getDatabaseOperationGuard,
  runWithDatabaseOperationGuard,
  runWithoutDatabaseOperationGuard
} = require("../src/db/databaseOperationGuard");

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

class FakePool extends EventEmitter {
  constructor() {
    super();
    this.queries = [];
    this.clients = [];
    this.poolQueries = 0;
    this.connectCalls = 0;
  }
  async connect() {
    this.connectCalls += 1;
    const client = Object.assign(new EventEmitter(), {
      releases: [],
      query: async input => {
        const sql = typeof input === "string" ? input : input.text;
        this.queries.push(sql);
        if (sql === "SELECT pending" && this.queryGate) {
          this.queryStarted.resolve();
          await this.queryGate.promise;
        }
        return { rows: [{ sql }], rowCount: 1 };
      },
      release: destroy => client.releases.push(Boolean(destroy))
    });
    this.clients.push(client);
    if (this.connectGate) await this.connectGate.promise;
    return client;
  }
  async query(input) {
    this.poolQueries += 1;
    this.queries.push(typeof input === "string" ? input : input.text);
    return { rows: [], rowCount: 1 };
  }
  async end() {}
}

const adapter = () => createPostgresAdapter({ poolConfig: {}, PoolClass: FakePool });

test("guard scopes inherit parent cancellation and can be cleared for control-plane work", () => {
  const parent = new AbortController(), child = new AbortController();
  const failure = new Error("parent cancelled");
  runWithDatabaseOperationGuard({ signal: parent.signal }, () => {
    assert.equal(getDatabaseOperationGuard().signal, parent.signal);
    runWithDatabaseOperationGuard({ signal: child.signal }, () => {
      parent.abort(failure);
      assert.throws(assertDatabaseOperationActive, error => error === failure);
      runWithoutDatabaseOperationGuard(() => {
        assert.equal(getDatabaseOperationGuard(), undefined);
        assert.doesNotThrow(assertDatabaseOperationActive);
      });
    });
  });
  assert.equal(getDatabaseOperationGuard(), undefined);
});

test("an aborted delayed transaction callback cannot write or commit after its caller returns", async () => {
  const db = adapter(), controller = new AbortController(), started = deferred(), resume = deferred();
  const failure = new Error("optional allowance ended");
  let lateWrite;
  const pending = runWithDatabaseOperationGuard({ signal: controller.signal }, () => db.transaction(async () => {
    started.resolve();
    await resume.promise;
    lateWrite = db.prepare("INSERT INTO records VALUES (?)").run("late");
    await lateWrite;
  })());
  await started.promise;
  controller.abort(failure);
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(db.pool.queries, ["BEGIN", "ROLLBACK"]);
  assert.deepEqual(db.pool.clients[0].releases, [true]);
  resume.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(lateWrite, error => error === failure);
  assert.deepEqual(db.pool.queries, ["BEGIN", "ROLLBACK"]);
  await db.query("SELECT independent");
  assert.equal(db.pool.poolQueries, 1);
  assert.equal(db.pool.clients[0].listenerCount("error"), 0);
});

for (const operation of ["transaction", "plain", "prepared"]) {
  test(`a ${operation} waiting for a pooled client cannot dispatch SQL after abort`, async () => {
    const db = adapter(), controller = new AbortController(), failure = new Error("acquisition expired");
    db.pool.connectGate = deferred();
    const pending = runWithDatabaseOperationGuard({ signal: controller.signal }, () => operation === "transaction"
      ? db.transaction(() => db.query("INSERT late"))()
      : operation === "prepared" ? db.prepare("INSERT late").run() : db.query("INSERT late"));
    assert.equal(db.pool.connectCalls, 1);
    controller.abort(failure);
    db.pool.connectGate.resolve();
    await assert.rejects(pending, error => error === failure);
    assert.deepEqual(db.pool.queries, []);
    assert.equal(db.pool.clients[0].releases.length, 1);
  });
}

test("cancellation during a dispatched query rolls back and never commits its late result", async () => {
  const db = adapter(), controller = new AbortController();
  db.pool.queryGate = deferred();
  db.pool.queryStarted = deferred();
  const failure = new Error("cancel in-flight work");
  const pending = runWithDatabaseOperationGuard({ signal: controller.signal }, () => db.transaction(async () => {
    await db.query("SELECT pending");
    await db.query("INSERT late");
  })());
  await db.pool.queryStarted.promise;
  controller.abort(failure);
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(db.pool.queries, ["BEGIN", "SELECT pending", "ROLLBACK"]);
  db.pool.queryGate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(db.pool.queries, ["BEGIN", "SELECT pending", "ROLLBACK"]);
  assert.deepEqual(db.pool.clients[0].releases, [true]);
});

test("a nested guarded callback aborts the checked-out transaction without a late savepoint release or commit", async () => {
  const db = adapter(), controller = new AbortController(), started = deferred(), resume = deferred();
  const failure = new Error("nested cancellation");
  const pending = db.transaction(() => runWithDatabaseOperationGuard({ signal: controller.signal }, () =>
    db.transaction(async () => { started.resolve(); await resume.promise; })()))();
  await started.promise;
  controller.abort(failure);
  await assert.rejects(pending, error => error === failure);
  resume.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(db.pool.queries.includes("ROLLBACK"));
  assert.ok(!db.pool.queries.includes("COMMIT"));
  assert.equal(db.pool.queries.filter(sql => sql === "RELEASE SAVEPOINT hellotest_sp_1").length, 1,
    "only the rollback cleanup may release a savepoint after cancellation");
  assert.deepEqual(db.pool.clients[0].releases, [true]);
});

test("an absolute deadline cancels an idle transaction even without an AbortSignal", async () => {
  const db = adapter(), started = deferred(), resume = deferred();
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const pending = runWithDatabaseOperationGuard({ deadlineMs: Date.now() + 20 }, () => db.transaction(async () => {
      started.resolve(); await resume.promise;
    })());
    await started.promise;
    await assert.rejects(pending, error => error.code === "DATABASE_OPERATION_DEADLINE");
    assert.deepEqual(db.pool.queries, ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(db.pool.clients[0].releases, [true]);
  } finally {
    resume.resolve(); clearTimeout(keepAlive);
  }
});

test("a parent catching a nested guard abort cannot escape its cancelled transaction through the pool", async () => {
  const db = adapter(), controller = new AbortController(), started = deferred(), resume = deferred(), continued = deferred();
  const failure = new Error("nested authority ended");
  const attempts = [];
  const pending = db.transaction(async () => {
    try {
      await runWithDatabaseOperationGuard({ signal: controller.signal }, () => db.transaction(async () => {
        started.resolve(); await resume.promise;
      })());
    } catch {
      for (const operation of [
        () => db.query("INSERT escaped_plain"),
        () => db.prepare("INSERT escaped_prepared").run(),
        () => db.transaction(() => db.query("INSERT escaped_transaction"))()
      ]) {
        try { await operation(); attempts.push(null); }
        catch (error) { attempts.push(error); }
      }
      continued.resolve();
    }
  })();
  await started.promise;
  controller.abort(failure);
  await assert.rejects(pending, error => error === failure);
  await continued.promise;
  resume.resolve();
  assert.deepEqual(attempts, [failure, failure, failure]);
  assert.equal(db.pool.poolQueries, 0);
  assert.equal(db.pool.connectCalls, 1);
  assert.ok(!db.pool.queries.some(sql => sql.startsWith("INSERT") || sql === "COMMIT"));
  assert.deepEqual(db.pool.clients[0].releases, [true]);
});

test("successful guards and normal calls retain transaction results and pooled-query behavior", async () => {
  const db = adapter(), controller = new AbortController();
  await db.query("SELECT normal");
  assert.equal(db.pool.poolQueries, 1);
  const result = await runWithDatabaseOperationGuard({ signal: controller.signal }, () => db.transaction(async () => {
    await db.prepare("INSERT INTO records VALUES (?)").run("ok");
    return "saved";
  })());
  controller.abort(new Error("scope closed after success"));
  assert.equal(result, "saved");
  assert.deepEqual(db.pool.queries, ["SELECT normal", "BEGIN", "INSERT INTO records VALUES ($1)", "COMMIT"]);
  assert.deepEqual(db.pool.clients[0].releases, [false]);
  assert.equal(db.pool.clients[0].listenerCount("error"), 0);
});

test("outsideTransaction opens an independent control-plane transaction and restores its caller", async () => {
  const db = adapter();
  await db.transaction(async () => {
    const outer = db.pool.clients[0];
    await db.outsideTransaction(() => db.transaction(() => db.query("SELECT control"))());
    assert.equal(db.pool.clients.length, 2);
    assert.deepEqual(outer.releases, []);
    await db.query("SELECT outer");
  })();
  assert.deepEqual(db.pool.queries, ["BEGIN", "BEGIN", "SELECT control", "COMMIT", "SELECT outer", "COMMIT"]);
  assert.deepEqual(db.pool.clients.map(client => client.releases), [[false], [false]]);
});
