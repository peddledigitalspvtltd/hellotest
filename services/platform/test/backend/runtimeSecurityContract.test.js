const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const token = require("../../backend/src/utils/token");

test("password hashes use a unique salt, current work factor, and retain legacy verification", () => {
  const first = token.hashPassword("Correct Horse Battery Staple!");
  const second = token.hashPassword("Correct Horse Battery Staple!");

  assert.notEqual(first, second);
  assert.match(first, /^pbkdf2_sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(token.verifyPassword("Correct Horse Battery Staple!", first), true);
  assert.equal(token.verifyPassword("wrong", first), false);
  assert.equal(token.passwordNeedsRehash(first), false);

  const legacy = crypto.pbkdf2Sync(
    "legacy-password",
    process.env.PASSWORD_SALT || "hellotest-dev-salt",
    100_000,
    64,
    "sha256"
  ).toString("hex");
  assert.equal(token.verifyPassword("legacy-password", legacy), true);
  assert.equal(token.passwordNeedsRehash(legacy), true);
});

test("production refuses default or missing session secrets", () => {
  const cwd = path.join(__dirname, "../../backend");
  for (const sessionSecret of [undefined, "hellotest-dev-secret", "too-short"]) {
    const env = { ...process.env, NODE_ENV: "production" };
    if (sessionSecret === undefined) delete env.SESSION_SECRET;
    else env.SESSION_SECRET = sessionSecret;

    const result = spawnSync(process.execPath, ["-e", "require('./src/utils/token')"], {
      cwd,
      env,
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /SESSION_SECRET/);
  }

  const valid = spawnSync(process.execPath, ["-e", "require('./src/utils/token')"], {
    cwd,
    env: { ...process.env, NODE_ENV: "production", SESSION_SECRET: "a-secure-random-session-secret-with-ample-length-2026" },
    encoding: "utf8"
  });
  assert.equal(valid.status, 0, valid.stderr);
});

test("production disables bootstrap credentials unless explicitly configured", () => {
  const cwd = path.join(__dirname, "../../backend");
  const result = spawnSync(process.execPath, ["-e", [
    "const { config } = require('./src/config');",
    "if (config.adminPortal.bootstrapEnabled) process.exit(2);",
    "if (config.adminPortal.bootstrapPassword) process.exit(3);"
  ].join(" ")], {
    cwd,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

test("the platform deployment has no published sample login and requires generated credentials", () => {
  const repoRoot = path.join(__dirname, "../../../..");
  const compose = fs.readFileSync(path.join(repoRoot, "docker-compose.platform.yml"), "utf8");
  const adminService = fs.readFileSync(path.join(__dirname, "../../backend/services/adminPortal.service.js"), "utf8");

  assert.match(compose, /NODE_ENV:\s*production/);
  assert.doesNotMatch(compose, /backend\/db\/seed\.sql/);
  for (const required of [
    "POSTGRES_PASSWORD:?",
    "SESSION_SECRET:?",
    "MOBILE_ENGINE_SHARED_SECRET:?",
    "MINIO_ROOT_PASSWORD:?",
        "ADMIN_BOOTSTRAP_PASSWORD:?"
  ]) {
    assert.ok(compose.includes(`\${${required}`), `${required} must fail closed in the platform manifest`);
  }
  assert.match(adminService, /retireLegacySampleCredentials/);
  assert.match(adminService, /security\.sample_credentials_retired/);
  assert.match(adminService, /status = 'suspended'/);
  const ops = fs.readFileSync(path.join(__dirname, "../../../../docker-compose.ops.yml"), "utf8");
  assert.ok(ops.includes("GRAFANA_ADMIN_PASSWORD:?"), "shared ops manifest must require generated Grafana credentials");
  assert.match(compose, /file: docker-compose.ops.yml/);

});
