const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), "utf8");

test("Mobile recorder calls use the dedicated service credential and preserve scoped browser URLs", () => {
  const builder = read("../src/services/aiAutomationBuilder.service.js");
  const secrets = read("../src/security/runtimeSecrets.js");

  assert.match(secrets, /resolveMobileEngineSecret/);
  assert.match(secrets, /MOBILE_ENGINE_SHARED_SECRET/);
  assert.match(secrets, /hellotest-mobile-engine-dev-secret/);
  assert.match(builder, /MOBILE_ENGINE_SECRET_HEADER = "x-hellotest-mobile-engine-secret"/);
  assert.match(builder, /\[MOBILE_ENGINE_SECRET_HEADER\]: resolveMobileEngineSecret\(\)/);
  assert.match(builder, /recorderTarget === "mobile" \? readMobileEngineJson : readEngineJson/);
  assert.match(builder, /target === "mobile" \? readMobileEngineJson : readEngineJson/);
  assert.match(builder, /session\.status_url \|\| \(recorderTarget === "mobile"/);
  assert.match(builder, /session\.live_view_url \|\| session\.live_view_path/);
});

test("every supported deployment wires an independent Mobile Engine secret", () => {
  const repoRoot = path.join(__dirname, "../../..");
  for (const relativePath of [
    "docker-compose.full.yml",
    "docker-compose.platform.yml",
    "local-run/docker-compose.yml",
    "local-run/docker-compose.images.yml",
    "testengine/docker-compose.yml",
    "testengine/docker-compose.deploy.yml",
    "testengine/k8s/testengine-workers.yaml"
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(source, /MOBILE_ENGINE_SHARED_SECRET/, `${relativePath} must wire Mobile Engine authentication`);
  }
});

