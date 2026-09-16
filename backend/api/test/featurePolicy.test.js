const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../src/db");
const policy = require("../src/services/featureFlag.service");
const { PERMISSIONS } = require("../src/security/permissions.catalog");

function stored(t, flags = {}) {
  t.mock.method(db, "prepare", sql => {
    assert.match(sql, /SELECT value/);
    return { get: async () => ({ value: { flags } }) };
  });
}

test("feature snapshots map every known permission explicitly and keep optional links informational", async t => {
  stored(t, { "hellotest.manual.requirements": false, "hellotest.manual.suites": false, "hellotest.manual.test_data": false, "hellotest.manual.environments": false });
  const snapshot = await policy.getSnapshot();
  assert.deepEqual(Object.keys(snapshot.permission_features).sort(), PERMISSIONS.map(permission => permission.code).sort());
  assert.deepEqual(snapshot.permission_features["attachment.view"], []);
  assert.deepEqual(snapshot.permission_features["feedback.create"], ["hellotest.manual.bugs"]);
  for (const feature of ["hellotest.manual.test_cases", "hellotest.manual.runs", "hellotest.manual.bugs"]) {
    assert.equal(snapshot.flags[feature], true, feature + " works without optional context");
    assert.ok(snapshot.optional_dependencies[feature].includes("hellotest.manual.requirements"));
  }
  assert.equal(snapshot.local_flags["hellotest.manual.requirements"], false, "A collaborator is never silently enabled");
  assert.deepEqual(await policy.getDisabledPermissionCodes(["testcase.create", "run.create", "feedback.create", "requirement.view"]), ["requirement.view"]);
});

test("hard requirements resolve recursively and unknown, cyclic or malformed dependencies fail closed", () => {
  const local = { core: false, parent: true, child: true, standalone: true, cycleA: true, cycleB: true, missing: true, malformed: true };
  const dependencies = { parent: ["core"], child: ["parent"], cycleA: ["cycleB"], cycleB: ["cycleA"], missing: ["unknown"], malformed: "core" };
  assert.deepEqual(policy.evaluateFeatureFlags(local, dependencies), { core: false, parent: false, child: false, standalone: true, cycleA: false, cycleB: false, missing: false, malformed: false });
  assert.equal(local.child, true, "Blocked children retain the administrator's configured choice");
  assert.equal(policy.evaluateFeatureFlags({ ...local, core: true }, dependencies).child, true);
});

test("Automation retains its explicit master boundary while saved code and API previews stay independent", async t => {
  stored(t, { "hellotest.automation.workspace": false, "hellotest.automation.object_repository": true, "hellotest.automation.step_code": true, "hellotest.automation.preview": true });
  const snapshot = await policy.getSnapshot();
  for (const feature of ["assets", "object_repository", "builder", "local_execution", "remote_execution", "parallel_execution"]) assert.equal(snapshot.flags["hellotest.automation." + feature], false);
  assert.equal(snapshot.local_flags["hellotest.automation.object_repository"], true);
  assert.equal(snapshot.flags["hellotest.automation.step_code"], true);
  assert.equal(snapshot.flags["hellotest.automation.preview"], true);
  assert.equal(snapshot.flags["hellotest.manual.runs"], true);
});

test("background evidence reads do not require automation batch management", async t => {
  stored(t, { "hellotest.automation.batch_process": false });
  assert.deepEqual(await policy.getDisabledPermissionCodes(["transaction.view", "transaction.artifact.download", "transaction.manage"]), ["transaction.manage"]);
  const snapshot = await policy.getSnapshot();
  assert.equal(snapshot.flags["hellotest.ops.background_jobs"], true);
  assert.equal(snapshot.local_flags["hellotest.automation.batch_process"], false);
});

test("disabled background jobs and unknown permission keys still fail closed", async t => {
  stored(t, { "hellotest.ops.background_jobs": false });
  assert.deepEqual(await policy.getDisabledPermissionCodes(["transaction.view", "transaction.artifact.download", "unknown.permission", "__proto__"]), ["transaction.view", "transaction.artifact.download", "unknown.permission", "__proto__"]);
  assert.deepEqual(policy.getFeatureKeysForPermission("__proto__"), []);
});

test("all published dependencies target known features and hard/optional sets do not overlap", () => {
  const known = new Set(policy.FEATURE_DEFINITIONS.map(feature => feature.key));
  for (const [feature, parents] of Object.entries(policy.FEATURE_DEPENDENCIES)) {
    assert.ok(known.has(feature));
    for (const parent of parents) {
      assert.ok(known.has(parent)); assert.notEqual(parent, feature);
      assert.ok(!(policy.OPTIONAL_FEATURE_DEPENDENCIES[feature] || []).includes(parent));
    }
  }
  for (const [feature, collaborators] of Object.entries(policy.OPTIONAL_FEATURE_DEPENDENCIES)) {
    assert.ok(known.has(feature));
    for (const collaborator of collaborators) { assert.ok(known.has(collaborator)); assert.notEqual(collaborator, feature); }
  }
});
