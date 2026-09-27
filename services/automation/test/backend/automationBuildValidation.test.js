const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automationUtils = require("../../../platform/backend/src/utils/testStepAutomation");

function builderFunctions() {
  const filename = path.join(__dirname, "../../backend/services/aiAutomationBuilder.service.js");
  const source = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const database = { prepare: () => ({}) };
  new Function("require", "exports", "module", `${source}\nmodule.exports = { normalizeLlmBuild, buildPrompt };`)((name) => {
    if (name.endsWith("/db") || name.endsWith("/obsDb")) return database;
    if (name.endsWith("/testStepAutomation")) return automationUtils;
    if (name === "crypto") return require("node:crypto");
    return {};
  }, module.exports, module);
  return module.exports;
}

test("native builds validate JavaScript and preserve the iOS runtime", () => {
  const { normalizeLlmBuild } = builderFunctions();
  const steps = [{ id: "native", step_order: 1, step_type: "ios" }];
  const build = (candidate) => normalizeLlmBuild({ steps: [{ step_id: "native", ...candidate }] }, steps, [], null);
  for (const candidate of [
    { automation_code: "await driver.;" },
    { step_type: "selenium", automation_code: "await driver.back();" },
    { step_type: "android", automation_code: "await driver.back();" },
    { step_order: 2, automation_code: "await driver.back();" },
    { automation_code: 'test("native flow", async () => { await driver.back(); });' }
  ]) assert.throws(() => build(candidate));
  const result = build({ step_type: "ios", step_order: 1, automation_code: 'await ios.tap("SignIn.Submit");' });
  assert.equal(result.updates[0].step_type, "ios");
  assert.equal(result.updates[0].automation_code, 'await ios.tap("SignIn.Submit");');
});

test("API builds reject requests whose normalization would discard behavior or assertions", () => {
  const { normalizeLlmBuild } = builderFunctions();
  const steps = [{ id: "api", step_order: 1, step_type: "api" }];
  const build = (request) => normalizeLlmBuild({ steps: [{ step_id: "api", api_request: request, automation_code: "ignored body" }] }, steps, [], null);
  for (const request of [
    { url: "/accounts", method: "FETCH" },
    { url: "/accounts", method: "POST", body_mode: "binary" },
    { url: "/accounts", method: "POST", body_mode: "json", body: { account: 1 } },
    { url: "/accounts", headers: { Authorization: "@t.token" } },
    { url: "/accounts", validations: [{ kind: "json_schema", expected: "{}" }] },
    { url: "/accounts", validations: [{ kind: "json_path", expected: "active" }] },
    { url: "/accounts", captures: [{ path: "$.id" }] }
  ]) assert.throws(() => build(request), /API/);
  const result = build({ method: "POST", url: "/accounts", body_mode: "json", body: '{"email":"@t.email"}',
    validations: [{ kind: "status", expected: "201" }, { kind: "json_path", target: "$.status", expected: "active" }],
    captures: [{ path: "$.id", parameter: "@t.account_id" }] });
  assert.equal(result.updates[0].automation_code, null);
  assert.equal(result.updates[0].api_request.body, '{"email":"@t.email"}');
  assert.equal(result.updates[0].api_request.validations.length, 2);
});

test("agent guidance includes API shape, native aliases and knowledge records without text", () => {
  const { buildPrompt } = builderFunctions();
  const prompt = buildPrompt({ testCase: { title: "Mixed checkout" }, steps: [], cacheRows: [],
    knowledgeRows: [{ title: "Attached specification", content: null }], capturedActions: [], capturedNetwork: [] });
  assert.match(prompt, /body_mode/);
  assert.match(prompt, /android, ios, mobile, driver/);
  assert.match(prompt, /Attached specification/);
});
