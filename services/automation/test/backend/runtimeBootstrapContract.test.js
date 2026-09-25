const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => fs.readFile(path.join(__dirname, relativePath), "utf8");

test("runtime permission seeding is repeatable when both id and code already exist", async () => {
  const bootstrap = await readSource("../../../platform/backend/src/db/bootstrap.js");

  assert.match(
    bootstrap,
    /INSERT INTO permissions \(id, code, description\)[\s\S]*?ON CONFLICT DO NOTHING/
  );
  assert.match(
    bootstrap,
    /UPDATE permissions AS permission[\s\S]*?permission\.code = catalog\.code[\s\S]*?IS DISTINCT FROM catalog\.description/
  );
  assert.doesNotMatch(
    bootstrap,
    /INSERT INTO permissions \(id, code, description\)[\s\S]*?ON CONFLICT \(code\)/
  );
});

test("Test Engine queue schema stays aligned across canonical and compatibility bootstraps", async () => {
  const [schema, mainBootstrap, executionBootstrap, engineService] = await Promise.all([
    readSource("../../../platform/backend/instance-setup-data/schema-setup/schema.sql"),
    readSource("../../../platform/backend/src/db/bootstrap.js"),
    readSource("../../../platform/backend/src/obsDb/bootstrap.js"),
    readSource("../../backend/services/engine.service.js")
  ]);

  for (const source of [schema, mainBootstrap, executionBootstrap]) {
    assert.match(source, /heartbeat_at TIMESTAMPTZ/);
    assert.match(source, /engine_class TEXT NOT NULL DEFAULT 'web'/);
    assert.match(source, /engine_max_workers INTEGER NOT NULL DEFAULT 1/);
    assert.match(source, /idx_test_engine_jobs_execution_created_at/);
    assert.match(source, /status IN \('queued', 'leased', 'running', 'completed', 'failed', 'aborted'\)/);
  }

  assert.match(engineService, /SET status = 'leased'/);
  assert.doesNotMatch(engineService, /SET status = 'claimed'/);
});

test("canonical schema contains every concurrency and result column used by runtime bootstrap", async () => {
  const [schema, bootstrap] = await Promise.all([
    readSource("../../../platform/backend/instance-setup-data/schema-setup/schema.sql"),
    readSource("../../../platform/backend/src/db/bootstrap.js")
  ]);

  for (const [canonicalContract, runtimeContract = canonicalContract] of [
    [/ALTER TABLE requirements ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1/],
    [/ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1/],
    [/ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '\[\]'::jsonb/],
    [/ALTER TABLE executions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1/],
    [/ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS step_defects JSONB NOT NULL DEFAULT '\{\}'::jsonb/],
    [
      /ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS case_defects JSONB NOT NULL DEFAULT '\[\]'::jsonb/,
      /ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS case_defects JSONB/
    ],
    [/ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1/],
    [/ALTER TABLE test_case_module_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP/]
  ]) {
    assert.match(schema, canonicalContract);
    assert.match(bootstrap, runtimeContract);
  }
});
