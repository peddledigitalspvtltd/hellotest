const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const db = require("../src/db");
const settingsService = require("../src/services/settings.service");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("governed workspace preferences are shared while ordinary preferences remain personal", async () => {
  const originalPrepare = db.prepare;
  const originalTransaction = db.transaction;
  const settings = new Map([
    ["workspace_preferences:admin", {
      theme: "dark",
      ai_prompt_registry_overrides: { legacy: "admin-only" }
    }],
    ["workspace_preferences:member", {
      compact_columns: true,
      ai_prompt_registry_overrides: { legacy: "member-only" }
    }],
    ["workspace_governed_preference:ai_prompt_registry_overrides", { story_create: "workspace prompt" }],
    ["workspace_governed_preference:ai_prompt_registry_llm_overrides", { story_create: "llm-primary" }],
    ["workspace_governed_preference:ai_metric_criteria_overrides", { release_ready: "workspace criteria" }],
    ["workspace_governed_preference:ai_metric_formula_values", { release_ready: { threshold: 90 } }]
  ]);

  db.prepare = (sql) => ({
    async get(key) {
      return settings.has(key) ? { value: settings.get(key) } : undefined;
    },
    async all(...keys) {
      assert.match(sql, /WHERE key IN/);
      return keys.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) }));
    },
    async run(key, value) {
      assert.match(sql, /INSERT INTO app_settings/);
      settings.set(key, value);
      return { changes: 1 };
    }
  });
  db.transaction = (callback) => async (...args) => callback(...args);

  try {
    const memberPreferences = await settingsService.getWorkspacePreferences("member");
    assert.equal(memberPreferences.compact_columns, true);
    assert.deepEqual(memberPreferences.ai_prompt_registry_overrides, { story_create: "workspace prompt" });
    assert.deepEqual(memberPreferences.ai_prompt_registry_llm_overrides, { story_create: "llm-primary" });
    assert.deepEqual(memberPreferences.ai_metric_criteria_overrides, { release_ready: "workspace criteria" });
    assert.deepEqual(memberPreferences.ai_metric_formula_values, { release_ready: { threshold: 90 } });

    await settingsService.updateWorkspacePreferences("admin", {
      theme: "light",
      ai_prompt_registry_overrides: { test_case_create: "new workspace prompt" }
    });

    assert.deepEqual(settings.get("workspace_preferences:admin"), { theme: "light" });
    assert.deepEqual(
      settings.get("workspace_governed_preference:ai_prompt_registry_overrides"),
      { test_case_create: "new workspace prompt" }
    );
    assert.deepEqual(
      (await settingsService.getWorkspacePreferences("member")).ai_prompt_registry_overrides,
      { test_case_create: "new workspace prompt" }
    );
  } finally {
    db.prepare = originalPrepare;
    db.transaction = originalTransaction;
  }
});

test("bootstrap migrates all governed keys out of legacy user rows", async () => {
  const [bootstrap, service, openapi] = await Promise.all([
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/settings.service.js"),
    readSource("../../../openapi.yaml")
  ]);

  for (const key of [
    "ai_prompt_registry_overrides",
    "ai_prompt_registry_llm_overrides",
    "ai_metric_criteria_overrides",
    "ai_metric_formula_values"
  ]) {
    assert.match(bootstrap, new RegExp(`workspace_governed_preference:[^\n]*${key}|\\('${key}'\\)`));
    assert.match(service, new RegExp(`(?:\"${key}\"|${key})`));
  }

  assert.match(bootstrap, /ranked_legacy_preferences/);
  assert.match(bootstrap, /ROW_NUMBER\(\) OVER/);
  assert.match(bootstrap, /value = value[\s\S]*- 'ai_prompt_registry_overrides'/);
  assert.match(service, /GOVERNED_WORKSPACE_PREFERENCE_KEYS\.forEach\(\(key\) => delete preferences\[key\]\)/);
  assert.match(openapi, /Governed preference keys are stored once for the workspace/);
});
