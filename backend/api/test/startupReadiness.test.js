const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Fastify = require("fastify");

const { config } = require("../src/config");
const appFile = path.join(__dirname, "../src/app.js");
const appSource = readFileSync(appFile, "utf8");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const createApp = ({
  startupTimeoutMs = 1_000,
  main = async () => {},
  observability = async () => {},
  admin = async () => {}
} = {}) => {
  const quietFastify = (options) => Fastify({ ...options, logger: false });
  quietFastify.LogController = Fastify.LogController;
  const noopPlugin = async () => {};
  const stubs = {
    fastify: quietFastify,
    "./config": { config: { ...config, startupTimeoutMs } },
    "./utils/token": { generateRequestId: () => "startup-test" },
    "./db/bootstrap": { ensureRuntimeSchema: main },
    "./obsDb/bootstrap": { ensureRuntimeSchema: observability },
    "./services/adminPortal.service": { ensureAdminFoundation: admin },
    "@fastify/cors": noopPlugin,
    "@fastify/multipart": noopPlugin,
    "./routes": noopPlugin
  };
  const appModule = { exports: {} };
  vm.runInNewContext(appSource, {
    module: appModule,
    process,
    require: (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith("./plugins/")) return noopPlugin;
      throw new Error(`Unexpected application dependency: ${name}`);
    }
  }, { filename: appFile });
  return appModule.exports;
};

test("application readiness waits for both schemas and the administrator foundation", async (t) => {
  const main = deferred();
  const observability = deferred();
  const admin = deferred();
  const mainStarted = deferred();
  const observabilityStarted = deferred();
  const adminStarted = deferred();
  const phases = [];
  const app = createApp({
    main: async () => { phases.push("main"); mainStarted.resolve(); await main.promise; },
    observability: async () => { phases.push("observability"); observabilityStarted.resolve(); await observability.promise; },
    admin: async () => { phases.push("admin"); adminStarted.resolve(); await admin.promise; }
  });
  t.after(async () => {
    main.resolve();
    observability.resolve();
    admin.resolve();
    await app.close();
  });

  let ready = false;
  const pending = app.ready().then(() => { ready = true; });
  await mainStarted.promise;
  assert.equal(ready, false);
  assert.deepEqual(phases, ["main"]);

  main.resolve();
  await observabilityStarted.promise;
  assert.equal(ready, false);
  assert.deepEqual(phases, ["main", "observability"]);

  observability.resolve();
  await adminStarted.promise;
  assert.equal(ready, false);
  assert.deepEqual(phases, ["main", "observability", "admin"]);

  admin.resolve();
  await pending;
  assert.equal(ready, true);
});

test("a failure in any bootstrap phase rejects readiness and skips later phases", async (t) => {
  const phaseNames = ["main", "observability", "admin"];
  for (const failingPhase of phaseNames) {
    await t.test(failingPhase, async (context) => {
      const calls = [];
      const error = new Error(`${failingPhase} bootstrap failed`);
      const app = createApp(Object.fromEntries(phaseNames.map((phase) => [phase, async () => {
        calls.push(phase);
        if (phase === failingPhase) throw error;
      }])));
      context.after(() => app.close());
      await assert.rejects(app.ready(), (actual) => actual === error);
      assert.deepEqual(calls, phaseNames.slice(0, phaseNames.indexOf(failingPhase) + 1));
    });
  }
});

test("the configured startup budget reaches Fastify and a stalled bootstrap remains bounded", async (t) => {
  const gate = deferred();
  const app = createApp({ startupTimeoutMs: 30, main: () => gate.promise });
  t.after(async () => {
    gate.resolve();
    await app.close();
  });
  assert.equal(app.initialConfig.pluginTimeout, 30);
  await assert.rejects(app.ready(), (error) => {
    assert.equal(error.code, "FST_ERR_HOOK_TIMEOUT");
    assert.match(error.message, /bootstrapRuntime/);
    return true;
  });
});

const readConfigInChild = (value) => {
  const env = { ...process.env, NODE_ENV: "test" };
  if (value === undefined) delete env.API_STARTUP_TIMEOUT_MS;
  else env.API_STARTUP_TIMEOUT_MS = value;
  return spawnSync(process.execPath, ["-e", "process.stdout.write(String(require('./src/config').config.startupTimeoutMs))"], {
    cwd: path.join(__dirname, ".."),
    env,
    encoding: "utf8"
  });
};

test("startup timeout has a cold-start budget and accepts bounded operator overrides", () => {
  for (const [input, expected] of [[undefined, 180_000], ["", 180_000], ["10000", 10_000], ["240000", 240_000], ["600000", 600_000]]) {
    const result = readConfigInChild(input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, String(expected));
  }
});

test("startup timeout rejects invalid or unbounded configuration before serving", () => {
  for (const input of ["0", "9999", "600001", "10000.5", "unbounded"]) {
    const result = readConfigInChild(input);
    assert.notEqual(result.status, 0, `Accepted invalid timeout: ${input}`);
    assert.match(result.stderr, /API_STARTUP_TIMEOUT_MS must be an integer between 10000 and 600000/);
  }
});
