const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {
  buildConfigurationTargetsForStorage,
  configurationTargetsForRead
} = require("../src/utils/configurationTargets");
const { executionShapeUsesMobile } = require("../src/utils/mobileFeature");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("configuration target rows are canonical, ordered, and independently identified", () => {
  const targets = buildConfigurationTargetsForStorage([
    { id: "desktop", os: "windows", browser: "Chrome", mobile_os: "", version: "latest" },
    { id: "mobile", os: "mac", browser: "Safari", mobile_os: "ios", version: "17" },
    { os: "linux", browser: "Firefox", mobile_os: "android", version: "14" }
  ]);

  assert.deepEqual(targets.map(({ os, browser, mobile_os, version }) => ({ os, browser, mobile_os, version })), [
    { os: "Windows", browser: "Chrome", mobile_os: "", version: "latest" },
    { os: "macOS", browser: "Safari", mobile_os: "iOS", version: "17" },
    { os: "Linux", browser: "Firefox", mobile_os: "Android", version: "14" }
  ]);
  assert.equal(targets[0].id, "desktop");
  assert.ok(targets[2].id);
});

test("configuration target rows reject blank, unsupported, and duplicate tuples", () => {
  assert.throws(
    () => buildConfigurationTargetsForStorage([{ os: "", browser: "", mobile_os: "", version: "" }]),
    /must include an operating system, browser, mobile OS, or version/
  );
  assert.throws(
    () => buildConfigurationTargetsForStorage([{ os: "ChromeOS", browser: "Chrome" }]),
    /operating system must be one of: Windows, macOS, Linux/
  );
  assert.throws(
    () => buildConfigurationTargetsForStorage([{ mobile_os: "Windows Phone" }]),
    /mobile OS must be one of: Android, iOS/
  );
  assert.throws(
    () => buildConfigurationTargetsForStorage([
      { os: "Windows", browser: "Chrome", version: "latest" },
      { os: "windows", browser: "chrome", version: "LATEST" }
    ]),
    /duplicates an earlier target/
  );
});

test("legacy scalar configurations expose one compatibility row and remain mobile-aware", () => {
  assert.deepEqual(configurationTargetsForRead([], {
    browser: "Firefox",
    mobile_os: "Android",
    platform_version: "14"
  }), [{
    id: "legacy-target",
    os: "",
    browser: "Firefox",
    mobile_os: "Android",
    version: "14"
  }]);

  assert.equal(executionShapeUsesMobile({
    test_configuration: {
      snapshot: {
        targets: [{ os: "", browser: "", mobile_os: "iOS", version: "17" }]
      }
    }
  }), true);
});

test("configuration matrices have schema, API, permission, snapshot, and engine parity", async () => {
  const [schema, bootstrap, seed, service, routes, execution, dispatch, planning, mobile, engineContract, openapi] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/seed.sql"),
    readSource("../src/services/testConfiguration.service.js"),
    readSource("../src/routes/testConfigurations.routes.js"),
    readSource("../src/services/execution.service.js"),
    readSource("../src/services/testEngineDispatch.service.js"),
    readSource("../src/services/executionPlanning.service.js"),
    readSource("../src/services/mobileFeature.service.js"),
    readSource("../../../testengine/backend/src/contracts/hellotest.ts"),
    readSource("../../../openapi.yaml")
  ]);

  for (const source of [schema, bootstrap]) {
    assert.match(source, /targets JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(source, /test_configurations_targets_array_check/);
  }
  assert.match(seed, /cfg-web-windows-chrome/);
  assert.match(seed, /"targets":\[/);
  assert.match(service, /buildConfigurationTargetsForStorage/);
  assert.match(service, /configurationTargetsForRead/);
  assert.match(service, /primaryTarget\?\.browser/);
  assert.match(routes, /targets: \{ required: false, type: "array", maxItems: 100 \}/);
  assert.match(routes, /configurationTargetsUseMobile/);
  assert.match(execution, /targets: configurationTargetsForRead\(resource\.targets, resource\)/);
  assert.match(dispatch, /selectedConfigurationTarget/);
  assert.match(dispatch, /targets: configurationTargets/);
  assert.match(planning, /configurationTargetsForRead/);
  assert.match(mobile, /configurationTargetsUseMobile/);
  assert.match(engineContract, /EngineConfigurationTarget/);
  assert.match(engineContract, /targets\?: EngineConfigurationTarget\[\]/);
  assert.match(openapi, /^  \/test-configurations:$/m);
  assert.match(openapi, /^    ConfigurationTarget:$/m);
  assert.match(openapi, /ExecutionConfigurationSnapshot:[\s\S]*targets:/);
  assert.match(openapi, /TestEngineRunConfiguration:[\s\S]*targets:/);
});
