const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createRuntimeLifecycle } = require("../src/services/runtimeLifecycle.service");

const createLogger = () => ({ info() {}, error() {}, fatal() {} });

test("runtime lifecycle drains the server and every registered adapter exactly once", async () => {
  const calls = [];
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  processRef.exit = () => { throw new Error("force exit should not be used"); };
  const lifecycle = createRuntimeLifecycle({
    app: { log: createLogger(), close: async () => calls.push("app") },
    resources: [
      { close: async () => calls.push("cache") },
      { close: async () => calls.push("database") }
    ],
    processRef,
    shutdownTimeoutMs: 500
  });

  const first = lifecycle.shutdown({ reason: "test", exitCode: 0 });
  const second = lifecycle.shutdown({ reason: "duplicate", exitCode: 1 });
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls.sort(), ["app", "cache", "database"]);
  assert.equal(processRef.exitCode, 0);
});

test("fatal process events trigger a non-zero graceful shutdown", async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  processRef.exit = () => {};
  let closed = false;
  const lifecycle = createRuntimeLifecycle({
    app: { log: createLogger(), close: async () => { closed = true; } },
    processRef,
    shutdownTimeoutMs: 500
  });

  lifecycle.registerProcessHandlers();
  processRef.emit("uncaughtException", new Error("fatal"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(closed, true);
  assert.equal(processRef.exitCode, 1);
});
