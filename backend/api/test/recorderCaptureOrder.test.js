const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loadRecorder = (steps = []) => {
  const writes = [];
  const database = { prepare: () => ({ get: async () => null, all: async () => steps, run: async () => ({ changes: 1 }) }) };
  const file = path.join(__dirname, "../src/services/aiAutomationBuilder.service.js");
  const sandbox = { module: { exports: {} }, exports: {}, process, URL, Buffer, setTimeout, clearTimeout, console,
    require: (id) => {
      if (id === "../db" || id === "../obsDb") return database;
      if (id === "crypto") return require("crypto");
      if (id === "../utils/testStepAutomation") return require("../src/utils/testStepAutomation");
      if (id === "./testStep.service") return {
        updateTestStep: async (id, fields) => { writes.push({ id, fields }); Object.assign(steps.find((step) => step.id === id), fields); },
        createTestStep: async () => { throw new Error("Targeted recording must preserve existing step rows"); }
      };
      return {};
    }
  };
  vm.runInNewContext(`${fs.readFileSync(file, "utf8")}\nmodule.exports = {
    orderRecorderCandidates,
    normalizeRecorderAiMappings: (payload, ...args) => normalizeRecorderAiMappings(JSON.parse(JSON.stringify(payload)), ...args),
    mergeRecorderMappingGroups,
    buildFallbackRecorderMappings, createRecorderAutomationCode, applyRecorderSteps
  };`, sandbox, { filename: file });
  return { ...sandbox.module.exports, writes };
};

const plain = (value) => JSON.parse(JSON.stringify(value));
const candidate = (index) => ({ source_action_index: index, step_order: index + 1,
  action: `Interaction ${index}`, keyword: "web.click", automation_code: `await web.click("action-${index}");` });
const execute = async (code) => {
  const calls = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("web", code)({ click: async (target) => { calls.push(target); } });
  return calls;
};

test("partial AI mapping restores missing middle interactions before persisting a targeted program", async () => {
  const target = { id: "login", step_order: 2, action: "Sign in", expected_result: "Dashboard appears",
    group_id: "login-group", reusable_group_id: "shared-login", automation_code: "old program" };
  const untouched = { id: "setup", step_order: 1, action: "Prepare account", automation_code: "setup program" };
  const recorder = loadRecorder([untouched, target]);
  const captures = [candidate(1), candidate(2), candidate(3)];
  const ai = recorder.normalizeRecorderAiMappings({ mappings: [{ manual_step_id: target.id, source_action_indexes: [3, 1] }] }, [target], captures);
  const fallback = recorder.buildFallbackRecorderMappings([target], [captures[1]]);
  const updates = await recorder.applyRecorderSteps({ testCase: { id: "case" }, targetStepId: target.id,
    stepCandidates: captures, recorderMappings: [...ai.mappings, ...fallback] });
  assert.deepEqual(await execute(target.automation_code), ["action-1", "action-2", "action-3"]);
  assert.deepEqual(plain(updates[0].source_action_indexes), [1, 2, 3]);
  assert.equal(updates[0].source_action_index, 1);
  assert.equal(recorder.writes.length, 1);
  assert.equal(recorder.writes[0].id, "login");
  assert.equal(target.action, "Sign in");
  assert.equal(target.expected_result, "Dashboard appears");
  assert.equal(target.group_id, "login-group");
  assert.equal(target.reusable_group_id, "shared-login");
  assert.equal(untouched.automation_code, "setup program");
});

test("out-of-order and duplicate AI/fallback references execute each capture once, including index zero", async () => {
  const target = { id: "flow", step_order: 1, action: "Complete flow", expected_result: "Complete" };
  const recorder = loadRecorder([target]);
  const captures = Array.from({ length: 5 }, (_, index) => candidate(index));
  const ai = recorder.normalizeRecorderAiMappings({ mappings: [
    { manual_step_id: "flow", source_action_indexes: [4, 0, 2, 4] },
    { manual_step_id: "flow", source_action_indexes: [2, 0] }
  ] }, [target], captures);
  const fallback = recorder.buildFallbackRecorderMappings([target], [captures[3], captures[1]]);
  const duplicate = { step: target, candidates: [captures[4], captures[0]], mapping_source: "fallback" };
  const updates = await recorder.applyRecorderSteps({ testCase: { id: "case" }, targetStepId: "flow",
    stepCandidates: captures, recorderMappings: [...ai.mappings, ...fallback, duplicate] });
  assert.deepEqual(await execute(target.automation_code), captures.map((item) => `action-${item.source_action_index}`));
  assert.deepEqual(plain(updates[0].source_action_indexes), [0, 1, 2, 3, 4]);
  assert.equal(updates[0].source_action_index, 0);
});

test("code assembly orders indexed candidates without mutating input or collapsing distinct repeated actions", async () => {
  const recorder = loadRecorder();
  const sameAction = { action: "Click again", automation_code: 'await web.click("same");' };
  const candidates = [candidate(3), { ...sameAction, source_action_index: 2 },
    { ...sameAction, source_action_index: 1 }, candidate(3), { ...sameAction }, { ...sameAction }];
  const before = JSON.stringify(candidates);
  assert.deepEqual(await execute(recorder.createRecorderAutomationCode(candidates)), ["same", "same", "action-3", "same", "same"]);
  assert.equal(JSON.stringify(candidates), before);
});
