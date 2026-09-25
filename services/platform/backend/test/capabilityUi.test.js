const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Fastify = require("fastify");

test("capability assets are bounded to the owning release with appropriate cache and content policies", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hellotest-capability-ui-"));
  const app = Fastify();
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await fs.mkdir(path.join(directory, "dashboard/assets"), { recursive: true });
  await fs.writeFile(path.join(directory, "dashboard/manifest.json"), JSON.stringify({ capability: "dashboard", protocol: 1 }));
  await fs.writeFile(path.join(directory, "dashboard/assets/entry-123.js"), "export const views = {};");
  await fs.writeFile(path.join(directory, "private.js"), "private");
  await fs.symlink(path.join(directory, "private.js"), path.join(directory, "dashboard/assets/escape.js"));
  await app.register(require("../src/plugins/capabilityUi"), { uiRoot: directory });
  const manifest = await app.inject("/capability-ui/dashboard/manifest.json");
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.headers["cache-control"], "no-store");
  const entry = await app.inject("/capability-ui/dashboard/assets/entry-123.js");
  assert.equal(entry.statusCode, 200);
  assert.match(entry.headers["content-type"], /javascript/);
  assert.match(entry.headers["cache-control"], /immutable/);
  assert.equal(entry.headers["x-content-type-options"], "nosniff");
  for (const url of ["/capability-ui/missing/manifest.json", "/capability-ui/dashboard/assets/escape.js", "/capability-ui/dashboard/package.json", "/capability-ui/dashboard/assets/missing.js", "/capability-ui/dashboard/%2e%2e/private.js"]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 404, url);
    assert.ok(!response.body.includes('export') && response.body !== 'private');
  }
});
