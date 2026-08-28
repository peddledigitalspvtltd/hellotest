const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const cwd = path.join(__dirname, "..");
const databaseKeys = [
  "POSTGRES_URL", "DATABASE_URL", "PGHOST", "POSTGRES_HOST", "PGPORT", "POSTGRES_PORT",
  "PGUSER", "POSTGRES_USER", "PGPASSWORD", "POSTGRES_PASSWORD", "PGDATABASE", "POSTGRES_DB",
  "OBS_POSTGRES_URL", "OBS_DATABASE_URL", "OBS_PGHOST", "OBS_POSTGRES_HOST", "OBS_PGPORT",
  "OBS_POSTGRES_PORT", "OBS_PGUSER", "OBS_POSTGRES_USER", "OBS_PGPASSWORD",
  "OBS_POSTGRES_PASSWORD", "OBS_PGDATABASE", "OBS_POSTGRES_DB"
];

const runConfig = (overrides) => {
  const env = { ...process.env, ...overrides };
  for (const key of databaseKeys) {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) delete env[key];
  }
  return spawnSync(process.execPath, ["-e", [
    "const { config } = require('./src/config');",
    "process.stdout.write(JSON.stringify({ mainUrl: config.postgresUrl, obsUrl: config.obsPostgresUrl, main: config.postgres, obs: config.obsPostgres }));"
  ].join(" ")], { cwd, env, encoding: "utf8" });
};

test("execution storage defaults to the primary HelloTest database", () => {
  const url = "postgresql://hellotest:secret@localhost:5432/hellotest";
  const result = runConfig({ DATABASE_URL: url });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.obsUrl, url);

  const componentResult = runConfig({
    POSTGRES_HOST: "database.internal",
    POSTGRES_DB: "hello_custom",
    POSTGRES_USER: "app_user",
    POSTGRES_PASSWORD: "secret"
  });
  assert.equal(componentResult.status, 0, componentResult.stderr);
  const componentPayload = JSON.parse(componentResult.stdout);
  assert.deepEqual(componentPayload.obs, componentPayload.main);
});

test("an explicitly separate execution database fails fast with a clear contract", () => {
  const result = runConfig({
    DATABASE_URL: "postgresql://app:secret@postgres:5432/hellotest",
    OBS_DATABASE_URL: "postgresql://ops:secret@postgres:5432/hellotest_obs"
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /separate OBS database is not supported/);

  const sameDatabase = runConfig({
    DATABASE_URL: "postgresql://app:secret@postgres:5432/hellotest",
    OBS_DATABASE_URL: "postgresql://ops:different@postgres:5432/hellotest"
  });
  assert.equal(sameDatabase.status, 0, sameDatabase.stderr);
});
