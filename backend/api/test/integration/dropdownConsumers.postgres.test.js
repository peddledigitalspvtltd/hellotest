const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("admin dropdown assignments persist through native consumers without widening system enums", {
  skip: process.env.DROPDOWN_CONSUMERS_POSTGRES !== "1", timeout: 120000
}, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_dropdowns_[a-z0-9_]+$/);
  const db = require("../../src/db");
  let app;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO roles(id,name) VALUES ('verification-role','Dropdown verification');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','dropdowns@example.test','not-a-login','Dropdown verifier',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Dropdown verification','actor');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('member','project','actor','verification-role');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web');`);
    const registry = require("../../src/services/dropdownCatalog.service");
    const cases = require("../../src/services/testCase.service");
    const issues = require("../../src/services/issues.service");
    const native = require("../../src/utils/nativeIssueMetadata");
    const updateOptions = async (key, transform, defaultValue) => {
      const revision = (await registry.getCatalog()).revision;
      const options = (await registry.getOptions(key, { includeInactive: true }))
        .map(({ value, label, description, active }) => ({ value, label, description, active }));
      return registry.updateField(key, { expected_revision: revision, options: transform(options),
        ...(defaultValue !== undefined ? { default_value: defaultValue } : {}) }, { actorId: "actor" });
    };
    const fields = [
      ["root_cause", "issues.root_causes", "Upstream contract drift"],
      ["qa_root_cause", "issues.qa_root_causes", "Missing contract coverage"],
      ["bug_type", "issues.bug_types", "Contract compatibility"]
    ];
    for (const [, key, value] of fields) await updateOptions(key, options => [...options, { value, label: value, active: true }]);
    await updateOptions("test_cases.types", options => [...options, { value: "contract_compatibility", label: "Contract compatibility", active: true }], "contract_compatibility");
    const bugInput = { project_id: "project", user_id: "actor", title: "Contract mismatch", message: "A provider response differs from the contract." };
    const caseInput = { app_type_id: "app", title: "Check provider contract", created_by: "actor", steps: [] };
    let bugId, caseId;

    await context.test("native Bug creation and metadata use all three administrator classifications", async () => {
      bugId = (await issues.createIssue({ ...bugInput, ...Object.fromEntries(fields.map(([field, , value]) => [field, value])) })).id;
      const stored = await issues.getIssueItem(bugId);
      const metadata = await native.issueMetadata({ project: { id: "project" } });
      for (const [field, , value] of fields) {
        assert.equal(stored[field], value);
        assert.ok(metadata.core_fields.find(item => item.id === field).allowed_values.some(option => option.value === value));
      }
      assert.ok((await issues.getIssueHistory(bugId)).some(event => event.action === "created"));
    });

    await context.test("Test Case API accepts registered types and uses the configured default only when omitted", async () => {
      app = require("fastify")({ logger: false });
      app.decorate("authenticate", async req => { req.user = { id: "actor", role: "admin" }; });
      app.decorate("requirePermission", () => async () => {});
      await app.register(require("../../src/plugins/validator"));
      await app.register(require("../../src/routes/testCases.routes"));
      await app.ready();
      const response = await app.inject({ method: "POST", url: "/test-cases", payload: { ...caseInput, test_case_type: "contract_compatibility" } });
      assert.equal(response.statusCode, 200, response.body);
      caseId = response.json().id;
      assert.equal((await cases.getTestCase(caseId)).test_case_type, "contract_compatibility");
      const defaulted = await cases.createTestCase({ ...caseInput, title: "Configured default" });
      assert.equal((await cases.getTestCase(defaulted.id)).test_case_type, "contract_compatibility");
      for (const value of ["", "   ", null]) await assert.rejects(cases.createTestCase({ ...caseInput, test_case_type: value }), { statusCode: 400 });
      await assert.rejects(cases.createTestCase({ ...caseInput, test_case_type: "unregistered_type" }), { statusCode: 400 });
      assert.equal((await app.inject({ method: "POST", url: "/test-cases", payload: { ...caseInput, status: "invented_workflow_state" } })).statusCode, 400);
      assert.equal((await app.inject({ method: "POST", url: "/test-cases", payload: { ...caseInput, automated: "sometimes" } })).statusCode, 400);
    });

    await context.test("retired Bug classifications remain editable only on records already holding them", async () => {
      for (const [, key, value] of fields) await updateOptions(key, options => options.map(option => option.value === value ? { ...option, active: false } : option));
      await issues.updateIssue(bugId, { title: "Renamed Bug", ...Object.fromEntries(fields.map(([field, , value]) => [field, value])) }, { actorId: "actor" });
      const stored = await issues.getIssueItem(bugId);
      for (const [field, , value] of fields) {
        assert.equal(stored[field], value);
        await assert.rejects(issues.createIssue({ ...bugInput, [field]: value }), { statusCode: 400 });
      }
      const metadata = await native.issueMetadata({ project: { id: "project" }, mode: "edit", currentValues: stored });
      for (const [field, , value] of fields) {
        assert.equal(metadata.core_fields.find(item => item.id === field).allowed_values.find(option => option.value === value).inactive, true);
      }
      await issues.updateIssue(bugId, { qa_root_cause: "" }, { actorId: "actor" });
      assert.equal((await issues.getIssueItem(bugId)).qa_root_cause, null);
    });

    await context.test("unregistered historical Bug values survive unchanged edits but cannot be assigned elsewhere", async () => {
      await db.prepare("UPDATE feedback SET root_cause='Legacy imported cause' WHERE id=?").run(bugId);
      await issues.updateIssue(bugId, { root_cause: "Legacy imported cause", title: "Preserved legacy classification" }, { actorId: "actor" });
      const before = await issues.getIssueItem(bugId);
      await assert.rejects(issues.updateIssue(bugId, { root_cause: "Another unknown cause", title: "Must not save" }, { actorId: "actor" }), { statusCode: 400 });
      assert.deepEqual(await issues.getIssueItem(bugId), before);
      await assert.rejects(issues.createIssue({ ...bugInput, root_cause: "Legacy imported cause" }), { statusCode: 400 });
    });

    await context.test("retired case types preserve saved edits and idempotent retries while rejecting new assignments", async () => {
      const sourceInput = { ...caseInput, test_case_type: "contract_compatibility", source_idempotency_key: "verification:case" };
      const original = await cases.createTestCase(sourceInput);
      await updateOptions("test_cases.types", options => options.map(option => option.value === "contract_compatibility" ? { ...option, active: false } : option), "functional");
      await cases.updateTestCase(caseId, { title: "Saved type unchanged", test_case_type: "contract_compatibility", updated_by: "actor" });
      assert.equal((await cases.getTestCase(caseId)).test_case_type, "contract_compatibility");
      const replay = await cases.createTestCase(sourceInput);
      assert.equal(replay.id, original.id); assert.equal(replay.idempotent_replay, true);
      await assert.rejects(cases.createTestCase({ ...sourceInput, source_idempotency_key: "verification:new-case" }), { statusCode: 400 });
      const nextDefault = await cases.createTestCase({ ...caseInput, title: "New default after retirement" });
      assert.equal((await cases.getTestCase(nextDefault.id)).test_case_type, "functional");
    });

    await context.test("historical custom case types survive edits and repeated schema bootstrap", async () => {
      await db.prepare("UPDATE test_cases SET test_case_type='legacy_custom_type' WHERE id=?").run(caseId);
      await cases.updateTestCase(caseId, { title: "Legacy type preserved", test_case_type: "legacy_custom_type", updated_by: "actor" });
      assert.equal((await cases.getTestCase(caseId)).test_case_type, "legacy_custom_type");
      await assert.rejects(cases.createTestCase({ ...caseInput, test_case_type: "legacy_custom_type" }), { statusCode: 400 });
      await require("../../src/db/bootstrap").reapplyRuntimeSchema();
      assert.equal((await cases.getTestCase(caseId)).test_case_type, "legacy_custom_type");
    });

    await context.test("concurrent catalog writes serialize by revision and only successful changes add audit events", async () => {
      const current = await registry.getCatalog();
      const options = await registry.getOptions("issues.bug_types", { includeInactive: true });
      const beforeCount = Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action='dropdown_values.update'").get()).count);
      const responses = await Promise.allSettled(["Concurrent classification A", "Concurrent classification B"].map(value => registry.updateField("issues.bug_types", {
        expected_revision: current.revision, options: [...options, { value, label: value, active: true }]
      }, { actorId: "actor" })));
      assert.equal(responses.filter(response => response.status === "fulfilled").length, 1);
      const failed = responses.find(response => response.status === "rejected");
      assert.equal(failed.reason.statusCode, 409);
      assert.equal(failed.reason.code, "DROPDOWN_REVISION_CONFLICT");
      const next = await registry.getCatalog();
      assert.equal(next.revision, current.revision + 1);
      assert.equal(Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action='dropdown_values.update'").get()).count), beforeCount + 1);
      const noChange = await registry.updateField("issues.bug_types", { expected_revision: next.revision,
        options: await registry.getOptions("issues.bug_types", { includeInactive: true }) }, { actorId: "actor" });
      assert.equal(noChange.revision, next.revision);
      assert.equal(Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action='dropdown_values.update'").get()).count), beforeCount + 1);
      await assert.rejects(registry.updateField("unknown.field", { expected_revision: next.revision, options: [] }), { statusCode: 404, code: "DROPDOWN_FIELD_NOT_FOUND" });
      await assert.rejects(registry.updateField("executions.statuses", { expected_revision: next.revision, options: [] }), { statusCode: 400, code: "DROPDOWN_SYSTEM_MANAGED" });
      assert.equal((await registry.getCatalog()).revision, next.revision);
      assert.equal(Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action='dropdown_values.update'").get()).count), beforeCount + 1);
    });
  } finally { if (app) await app.close(); await db.close(); }
});
