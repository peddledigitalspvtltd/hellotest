const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../../backend/src/db");
const { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } = require("../../backend/src/security/permissions.catalog");
const { DEFAULT_ROLE_PRESETS, findDefaultRolePreset } = require("../../backend/src/security/rolePresets.catalog");
const service = require("../../backend/services/rolePreset.service");
const roles = require("../../backend/services/role.service");
const flags = require("../../backend/services/featureFlag.service");

const has = (name, code) => findDefaultRolePreset(name).permission_codes.includes(code);

test("default personas contain known, explicit grants and no access-administration permissions", () => {
  const known = new Set(PERMISSIONS.map(permission => permission.code));
  assert.deepEqual(DEFAULT_ROLE_PRESETS.map(role => role.name), ["Product Owner", "QA Lead", "QA Member", "Automation Engineer", "AI Engineer", "Reporter", "Viewer"]);
  const forbidden = ["user.manage", "user.import", "role.manage", "project_member.manage", "integration.manage", "integration.import_export", "settings.manage", "workspace_preferences.manage", "feature_flag.manage", "localization.manage", "ai_prompt.manage", "api_key.manage", "ops.manage"];
  for (const role of DEFAULT_ROLE_PRESETS) {
    assert.equal(new Set(role.permission_codes).size, role.permission_codes.length, role.name);
    for (const code of role.permission_codes) assert.ok(known.has(code), `${role.name}: unknown permission ${code}`);
    for (const code of forbidden) assert.ok(!role.permission_codes.includes(code), `${role.name} must not administer access: ${code}`);
    for (const code of ["workspace.view", "project.view", "app_type.view", "settings.view", "dashboard.view"]) assert.ok(role.permission_codes.includes(code), `${role.name}: missing navigation ${code}`);
  }
  assert.equal(findDefaultRolePreset("  pRoDuCt OwNeR  ").key, "product-owner");
  assert.equal(findDefaultRolePreset("A custom role"), undefined);
});

test("persona responsibilities include their required parent reads and bounded write capabilities", () => {
  for (const code of ["requirement.create", "requirement.update", "requirement.delete", "requirement_iteration.create", "requirement_iteration.update", "requirement_iteration.delete"]) assert.ok(has("Product Owner", code), code);
  for (const code of ["testcase.delete", "suite.delete", "plan.delete", "quality_gate.delete", "run.delete", "schedule.delete"]) assert.ok(has("QA Lead", code), code);
  assert.ok(!has("QA Member", "testcase.delete"));
  for (const code of ["automation.view", "automation.code.view", "automation.asset.delete", "automation.build", "automation.run.local", "automation.run.remote", "automation.run.parallel", "schedule.create"]) assert.ok(has("Automation Engineer", code), code);
  for (const code of ["agentic_workflow.view", "agentic_workflow.manage", "agentic_workflow.run", "knowledge.view", "knowledge.manage", "prompt_template.view", "prompt_template.manage", "testcase.ai", "data.ai"]) assert.ok(has("AI Engineer", code), code);
  assert.ok(!has("AI Engineer", "automation.run.remote"));
  assert.ok(!has("Product Owner", "automation.code.view"));
  for (const name of ["Product Owner", "QA Lead", "QA Member", "Automation Engineer", "AI Engineer"]) {
    assert.ok(has(name, "transaction.view"), name + " can read its background work");
    assert.ok(has(name, "transaction.artifact.download"), name + " can download its import/export evidence");
  }
  for (const role of DEFAULT_ROLE_PRESETS) {
    const requirements = [
      ["feedback.create", ["feedback.view", "project.view"]],
      ["requirement_iteration.update", ["requirement_iteration.view", "requirement.view"]],
      ["step.manage", ["testcase.view", "testcase.update"]],
      ["suite.update", ["suite.view", "testcase.view"]],
      ["run.execute", ["run.view", "testcase.view", "result.view", "result.manage"]],
      ["automation.build", ["automation.view", "testcase.view", "testcase.update", "automation.code.view"]],
      ["agentic_workflow.run", ["agentic_workflow.view", "knowledge.view"]],
      ["prompt_template.manage", ["prompt_template.view"]],
      ["attachment.create", ["attachment.view"]],
      ["comment.create", ["comment.view"]]
    ];
    for (const [action, parents] of requirements) if (role.permission_codes.includes(action)) {
      for (const parent of parents) assert.ok(role.permission_codes.includes(parent), `${role.name}: ${action} requires ${parent}`);
    }
  }
});

test("Reporter creates Bugs and evidence without broad Bug management; Viewer cannot mutate records", () => {
  const reporter = findDefaultRolePreset("Reporter").permission_codes;
  assert.deepEqual(reporter.filter(code => /\.(create|manage|update|delete|execute|run|import)$/.test(code)), ["attachment.create", "comment.create", "feedback.create", "notification.manage"]);
  for (const code of ["feedback.manage", "attachment.delete", "testcase.create", "run.create"]) assert.ok(!reporter.includes(code));
  assert.ok(findDefaultRolePreset("Viewer").permission_codes.every(code => code.endsWith(".view")));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.admin.includes("feedback.create"));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.member.includes("feedback.manage"), "Legacy member retains its compatible Bug grant");
});

function installDatabase(t, initialRoles = [], unavailableCodes = []) {
  const state = { roles: structuredClone(initialRoles), depth: 0, locks: 0, grants: 0, inserts: 0, failGrant: null, raceName: null, flags: {} };
  const available = PERMISSIONS.filter(permission => !unavailableCodes.includes(permission.code));
  t.mock.method(db, "transaction", callback => async () => {
    const before = structuredClone(state.roles);
    state.depth++;
    try { return await callback(); } catch (error) { state.roles = before; throw error; } finally { state.depth--; }
  });
  t.mock.method(db, "prepare", sql => ({
    all: async (...params) => {
      if (/FROM roles\s+LEFT JOIN role_permissions/.test(sql)) return structuredClone(state.roles.filter(role => params.includes(role.name.trim().toLowerCase())));
      if (/FROM permissions/.test(sql)) return available.filter(permission => !params.length || params.includes(permission.code));
      throw new Error("Unexpected all: " + sql);
    },
    get: async (...params) => {
      if (/pg_advisory_xact_lock/.test(sql)) { assert.ok(state.depth > 0); state.locks++; return {}; }
      if (/INSERT INTO roles/.test(sql)) {
        assert.ok(state.depth > 0);
        const [id, name, normalized] = params;
        if (state.raceName === name) {
          state.roles.push({ id: "concurrent-custom", name: name.toUpperCase(), permission_codes: ["workspace.view"] });
          state.raceName = null;
          return undefined;
        }
        if (state.roles.some(role => role.name.trim().toLowerCase() === normalized)) return undefined;
        state.inserts++;
        state.roles.push({ id, name, permission_codes: [] });
        return { id, name };
      }
      if (/FROM roles WHERE LOWER\(BTRIM\(name\)\)/.test(sql)) return state.roles.find(role => role.name.trim().toLowerCase() === params[0]);
      if (/FROM roles WHERE LOWER\(name\)/.test(sql)) return state.roles.find(role => role.name.toLowerCase() === params[0].toLowerCase());
      if (/FROM app_settings/.test(sql)) return { value: { flags: state.flags } };
      throw new Error("Unexpected get: " + sql);
    },
    run: async (...params) => {
      assert.ok(state.depth > 0);
      if (/INSERT INTO role_permissions/.test(sql)) {
        const [id, ...codes] = params, role = state.roles.find(role => role.id === id);
        if (state.failGrant === role.name) throw new Error("Grant persistence failed");
        state.grants++;
        for (const code of codes) assert.ok(available.some(permission => permission.code === code));
        role.permission_codes = [...new Set([...role.permission_codes, ...codes])].sort();
        return { changes: codes.length };
      }
      throw new Error("Unexpected write: " + sql);
    }
  }));
  return state;
}

test("setup creates all missing roles with exact grants and a repeat install changes nothing", async t => {
  const state = installDatabase(t);
  const first = await service.ensureSetupRoles();
  assert.equal(first.created.length, 7); assert.deepEqual(first.retained, []);
  for (const preset of DEFAULT_ROLE_PRESETS) assert.deepEqual(state.roles.find(role => role.name === preset.name).permission_codes, preset.permission_codes);
  const before = structuredClone(state.roles), beforeGrants = state.grants;
  const second = await service.ensureSetupRoles();
  assert.deepEqual(second.created, []); assert.equal(second.retained.length, 7);
  assert.deepEqual(state.roles, before); assert.equal(state.grants, beforeGrants);
  assert.ok((await service.getSetupRoleCatalog()).every(role => role.status === "installed"));
});

test("setup preserves customized, empty, differently cased and unrelated roles", async t => {
  const original = [
    { id: "owner-custom", name: "PRODUCT OWNER", permission_codes: ["requirement.view", "workspace.view"] },
    { id: "reporter-empty", name: " reporter ", permission_codes: [] },
    { id: "other-role", name: "Operations reviewer", permission_codes: ["ops.view"] }
  ];
  const state = installDatabase(t, original);
  const result = await service.ensureSetupRoles();
  assert.equal(result.created.length, 5); assert.equal(result.retained.length, 2);
  assert.deepEqual(state.roles.slice(0, original.length), original);
  const catalog = await service.getSetupRoleCatalog();
  assert.equal(catalog.find(role => role.key === "product-owner").status, "customized");
  const reporter = catalog.find(role => role.key === "reporter");
  assert.equal(reporter.status, "customized"); assert.equal(reporter.role_id, "reporter-empty");
  assert.deepEqual(reporter.current_permission_codes, []);
  assert.ok(reporter.permission_codes.includes("feedback.create"));
  await service.ensureSetupRoles();
  assert.deepEqual(state.roles.slice(0, original.length), original);
});

test("a concurrently created custom role is retained without receiving default grants", async t => {
  const state = installDatabase(t); state.raceName = "QA Lead";
  const result = await service.ensureSetupRoles();
  assert.equal(result.created.length, 6);
  assert.deepEqual(result.retained, [{ id: "concurrent-custom", name: "QA LEAD" }]);
  assert.deepEqual(state.roles.find(role => role.id === "concurrent-custom").permission_codes, ["workspace.view"]);
});

test("missing permission schema or grant failure cannot partially create roles", async t => {
  const state = installDatabase(t, [], ["feedback.create"]);
  await assert.rejects(service.ensureSetupRoles(), error => error.statusCode === 409 && /feedback.create/.test(error.message));
  assert.deepEqual(state.roles, []); assert.equal(state.inserts, 0);
});

test("grant persistence failure rolls back every new role in the setup transaction", async t => {
  const state = installDatabase(t); state.failGrant = "QA Lead";
  await assert.rejects(service.ensureSetupRoles(), /Grant persistence failed/);
  assert.deepEqual(state.roles, []);
});

test("role catalog is a read-only preview and retains disabled feature grants without enabling them", async t => {
  const state = installDatabase(t);
  const preview = await service.getSetupRoleCatalog();
  assert.ok(preview.every(role => role.status === "not_installed" && role.role_id === null));
  assert.equal(state.locks, 0); assert.equal(state.inserts, 0);
  state.flags = { "hellotest.ai.agentic_workflows": false, "hellotest.automation.workspace": false };
  await service.ensureSetupRoles();
  const ai = state.roles.find(role => role.name === "AI Engineer");
  assert.ok(ai.permission_codes.includes("agentic_workflow.run"));
  const filtered = await flags.filterPermissionsByEnabledFeatures(ai.permission_codes.map(code => ({ code })));
  assert.ok(!filtered.some(permission => permission.code === "agentic_workflow.run" || permission.code === "automation.build"));
  assert.deepEqual(state.flags, { "hellotest.ai.agentic_workflows": false, "hellotest.automation.workspace": false });
});

test("creating a named persona through role management uses its preset instead of broad member defaults", async t => {
  let assigned;
  t.mock.method(flags, "getDisabledPermissionCodes", async () => []);
  t.mock.method(db, "transaction", callback => async () => callback());
  t.mock.method(db, "prepare", sql => ({
    get: async () => undefined,
    all: async () => PERMISSIONS,
    run: async (...params) => {
      if (/DELETE FROM role_permissions/.test(sql)) assigned = [];
      if (/INSERT INTO role_permissions/.test(sql)) {
        for (let index = 1; index < params.length; index += 2) assigned.push(PERMISSIONS.find(permission => permission.id === params[index]).code);
      }
      return { changes: 1 };
    }
  }));
  await roles.createRole({ name: "Reporter" });
  assert.deepEqual(assigned.sort(), findDefaultRolePreset("Reporter").permission_codes);
  assert.ok(!assigned.includes("feedback.manage"));
});
