import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { runtimeDependencies } = require("../../../services/agentic/backend/services/inspectionAgentInstaller.js");

test("the downloaded runtime imports and serves pairing status with only installer-declared dependencies", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hellotest-inspection-dependencies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module", dependencies: runtimeDependencies }));
  await mkdir(join(directory, "node_modules"));
  for (const name of Object.keys(runtimeDependencies)) {
    assert.match(runtimeDependencies[name], /^\d+\.\d+\.\d+$/);
    await symlink(fileURLToPath(new URL(`../node_modules/${name}`, import.meta.url)), join(directory, "node_modules", name), "junction");
  }
  const bundle = JSON.parse(await readFile(new URL("../../../services/platform/backend/src/assets/inspection-agent-runtime.json", import.meta.url), "utf8"));
  const modules = JSON.parse(gunzipSync(Buffer.from(bundle.gzip_base64, "base64")));
  for (const [key, name] of Object.entries({ recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy", repository_locator: "repositoryLocator" })) {
    await writeFile(join(directory, `${name}.js`), modules[key]);
  }
  const previous = process.env.HELLOTEST_INSPECTOR_TOKEN;
  const token = "isolated-inspection-pairing-token";
  process.env.HELLOTEST_INSPECTOR_TOKEN = token;
  t.after(() => { if (previous === undefined) delete process.env.HELLOTEST_INSPECTOR_TOKEN; else process.env.HELLOTEST_INSPECTOR_TOKEN = previous; });
  const { default: Fastify } = await import(pathToFileURL(join(directory, "node_modules/fastify/fastify.js")));
  const { registerRecorderRoutes } = await import(pathToFileURL(join(directory, "recorder.js")));
  const app = Fastify();
  t.after(() => app.close());
  await registerRecorderRoutes(app);
  const status = await app.inject({ url: "/api/v1/recorder/agent/status", headers: { "x-hellotest-agent-token": token } });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().service, "hellotest-inspection-agent");
});
