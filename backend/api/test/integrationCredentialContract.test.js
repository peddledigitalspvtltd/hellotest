const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const integrationService = require("../src/services/integration.service");

const SEEDED_LLM_IDS = [
  "17fa4724-6516-4ff2-b2aa-e7d27fe605b3",
  "3078d5bf-993d-4aeb-9ff2-e2ea0d93c42a"
];

const integrationSeedBlock = (source, id) => {
  const start = source.indexOf(`  '${id}',`);
  assert.ok(start >= 0, `seeded integration ${id} must exist`);
  const end = source.indexOf("\n)", start);
  assert.ok(end > start, `seeded integration ${id} must have a complete VALUES block`);
  return source.slice(start, end);
};

test("masked display values are never usable LLM credentials", async () => {
  for (const value of [null, undefined, "", "   ", "********", "******", "••••••", "●●●●●●"]) {
    assert.equal(integrationService.isUsableApiCredential(value), false, String(value));
  }
  assert.equal(integrationService.isUsableApiCredential("sk-live-test-value"), true);

  await assert.rejects(
    integrationService.createIntegration({
      type: "llm",
      name: "Placeholder provider",
      base_url: "https://llm.example.test/v1",
      api_key: "********",
      model: "test-model",
      is_active: true
    }),
    /usable API key; masked placeholders are not credentials/
  );
});

test("an update cannot preserve a legacy placeholder as an LLM credential", async () => {
  const originalGetIntegration = integrationService.getIntegration;
  integrationService.getIntegration = async () => ({
    id: "legacy-placeholder-llm",
    type: "llm",
    name: "Legacy placeholder",
    base_url: "https://llm.example.test/v1",
    api_key: "********",
    model: "test-model",
    config: {},
    is_active: true
  });

  try {
    await assert.rejects(
      integrationService.updateIntegration("legacy-placeholder-llm", {
        name: "Still invalid",
        api_key: "********"
      }),
      /usable API key; masked placeholders are not credentials/
    );
  } finally {
    integrationService.getIntegration = originalGetIntegration;
  }
});

test("sample LLM seed rows are credential-free and inactive by default", async () => {
  const [platformSeed, localSeed] = await Promise.all([
    readFile(path.join(__dirname, "../../db/seed.sql"), "utf8"),
    readFile(path.join(__dirname, "../../../local-run/db/03-local-integrations.sql"), "utf8")
  ]);

  for (const source of [platformSeed, localSeed]) {
    for (const id of SEEDED_LLM_IDS) {
      const block = integrationSeedBlock(source, id);
      assert.match(block, /\n  'llm',/);
      assert.match(block, /\n  NULL,\n  '(?:gpt-5\.4-mini|openai\/gpt-oss-20b)',/);
      assert.match(block, /\n  FALSE\s*$/);
      assert.doesNotMatch(block, /\*{6,}|[•●]{6,}/);
    }
  }

  assert.match(localSeed, /WHEN EXCLUDED\.type = 'llm' AND EXCLUDED\.api_key IS NULL/);
  assert.match(localSeed, /THEN integrations\.is_active/);
  assert.match(localSeed, /api_key = COALESCE\(NULLIF\(EXCLUDED\.api_key, '\*{8}'\), integrations\.api_key, EXCLUDED\.api_key\)/);
});
