import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalRunnerEnvironment } from "../../../local-run/lib/runner-environment.mjs";
import { spawn } from "node:child_process";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";

test("host runner reads local stack credentials without evaluating shell values and honors terminal overrides", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hellotest-runner-configuration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const generated = join(directory, "generated.env"), local = join(directory, ".env");
  await writeFile(generated, 'HELLOTEST_TESTENGINE_SECRET="generated-secret"\nHELLOTEST_API_BASE_URL=https://other.test\n');
  await writeFile(local, 'TESTENGINE_SHARED_SECRET="local-stack-secret" # API credential\nTESTENGINE_CALLBACK_SECRET=literal-$(no-shell-evaluation)\nHELLOTEST_TESTENGINE_SECRET=ignored-lower-priority\n');
  const environment = createLocalRunnerEnvironment({ TESTENGINE_QUEUE_REQUIRED: "true", HELLOTEST_API_BASE_URL: "https://queue.test" }, [generated, local]);
  assert.equal(environment.TESTENGINE_SHARED_SECRET, "generated-secret");
  assert.equal(environment.HELLOTEST_TESTENGINE_SECRET, "generated-secret");
  assert.equal(environment.TESTENGINE_CALLBACK_SECRET, "literal-$(no-shell-evaluation)");
  assert.equal(environment.HELLOTEST_API_BASE_URL, "");
  assert.equal(environment.TESTENGINE_QUEUE_REQUIRED, "false");
  assert.equal(createLocalRunnerEnvironment({ TESTENGINE_SHARED_SECRET: "terminal" }, [local]).TESTENGINE_SHARED_SECRET, "terminal");
  assert.equal(createLocalRunnerEnvironment({ HELLOTEST_TESTENGINE_SECRET: "terminal-alias" }, [local]).TESTENGINE_SHARED_SECRET, "terminal-alias");
  assert.equal(createLocalRunnerEnvironment({}, [local]).TESTENGINE_SHARED_SECRET, "local-stack-secret");
});

test("invalid credential quoting reports the issue without exposing the credential", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hellotest-runner-invalid-configuration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, ".env");
  await writeFile(file, 'TESTENGINE_SHARED_SECRET="private-invalid-credential\n');
  assert.throws(() => createLocalRunnerEnvironment({}, [file]), error => /invalid quoting/.test(error.message) && !error.message.includes("private-invalid"));
});

test("launcher readiness probe rejects unrelated apps, inspection-only agents and unready engines", async t => {
  let payload;
  const app = Fastify();app.get("/health", async () => payload);
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  for (const [health, expected] of [
    [{ ok: true }, 1],
    [{ ready: true, capabilities: { local_execution: false } }, 1],
    [{ ready: false, supported_web_engines: ["playwright"] }, 1],
    [{ ready: true, supported_web_engines: ["playwright"], capabilities: { local_execution: true } }, 0]
  ]) {
    payload = health;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("../../../local-run/lib/probe-runner.mjs", import.meta.url)), base], { stdio: "ignore" });
      child.once("error", reject);child.once("exit", resolve);
    });
    assert.equal(code, expected);
  }
});
