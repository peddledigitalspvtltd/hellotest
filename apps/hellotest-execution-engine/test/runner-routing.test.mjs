import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveRunner } from "../dist/runners/runner-router.js";
import { UnifiedCaseExecutor } from "../dist/runners/unified-case-executor.js";

const context = {
  runVariables: {},
  caseVariables: {},
  shared: {},
  outputs: {}
};

const step = (overrides = {}) => ({
  stepId: "step-1",
  order: 1,
  stepType: "web",
  runnerType: "playwright",
  action: "goto",
  ...overrides
});

test("runner routing has no router-to-unified static dependency cycle", async () => {
  const [routerSource, unifiedSource] = await Promise.all([
    readFile(new URL("../src/runners/runner-router.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/runners/unified-case-executor.ts", import.meta.url), "utf8")
  ]);

  assert.match(routerSource, /unified-case-executor\.js/);
  assert.doesNotMatch(unifiedSource, /runner-router\.js/);
  assert.match(unifiedSource, /step-runner-resolver\.js/);
});

test("supported case types resolve without starting their external runtimes", () => {
  const selections = [
    ["web", "playwright", "PlaywrightRunner"],
    ["api", "axios", "AxiosApiRunner"],
    ["android", "wdio", "AndroidWdioRunner"],
    ["unified", "unified", "UnifiedCaseExecutor"]
  ];

  for (const [caseType, runnerType, expectedClass] of selections) {
    const runner = resolveRunner({ caseId: `case-${caseType}`, caseType, runnerType, steps: [] });
    assert.equal(runner.constructor.name, expectedClass);
  }
});

test("an unknown top-level case type resolves to a terminal failed runner", async () => {
  const runner = resolveRunner({
    caseId: "case-unknown",
    caseType: "desktop",
    runnerType: "mystery",
    steps: []
  });

  assert.equal(runner.constructor.name, "UnsupportedStepRunner");
  const result = await runner.executeStep(
    step({ stepType: "desktop", runnerType: "mystery" }),
    context
  );
  assert.equal(result.status, "failed");
  assert.equal(result.data.errorCode, "UNSUPPORTED_STEP_TYPE");
  assert.match(result.note, /desktop/);
});

test("a unified case with an unsupported leaf step fails closed without recursion", { timeout: 1_000 }, async () => {
  const runner = new UnifiedCaseExecutor();
  const result = await runner.executeStep(
    step({ stepType: "unified", runnerType: "unified" }),
    context
  );

  assert.equal(result.status, "failed");
  assert.equal(result.data.errorCode, "UNSUPPORTED_STEP_TYPE");
  assert.match(result.note, /concrete web, api, or android/);
});
