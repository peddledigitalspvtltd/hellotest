const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("linked data set scope changes and case hydration enforce stored ownership", {
  skip: process.env.DATA_SET_SCOPE_POSTGRES !== "1", timeout: 120000
}, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_data_scope_[a-z0-9_]+$/);
  const db = require("../../src/db");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../instance-setup-data/schema-setup/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO projects(id,name) VALUES ('project-a','Scope A'),('project-b','Scope B');
      INSERT INTO app_types(id,project_id,name,type) VALUES
        ('app-a','project-a','App A','web'),('app-a2','project-a','App A2','web'),('app-b','project-b','App B','web');
      INSERT INTO requirements(id,project_id,title) VALUES ('story-a','project-a','Legacy Story');`);
    const data = require("../../../../testing/backend/services/testDataSet.service");
    const cases = require("../../../../testing/backend/services/testCase.service");
    const createData = async (name, app_type_id = "app-a") => (await data.createTestDataSet({
      project_id: "project-a", app_type_id, name, mode: "table", columns: ["email"], rows: [{ email: `${name}@example.test` }]
    })).id;
    const createCase = async (id, dataId, app = "app-a", suite = null, story = null) => {
      await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,requirement_id,title) VALUES (?,?,?,?,?)").run(id, app, suite, story, id);
      await db.prepare("INSERT INTO test_case_data_sets(test_case_id,test_data_set_id,sort_order) VALUES (?,?,1)").run(id, dataId);
    };
    const createSuite = (id, dataId, app = "app-a") => db.prepare("INSERT INTO test_suites(id,app_type_id,name,test_data_set_id) VALUES (?,?,?,?)").run(id, app, id, dataId);
    const expectConflict = async (id, patch) => {
      const before = await data.getTestDataSet(id);
      await assert.rejects(data.updateTestDataSet(id, patch), { statusCode: 409, code: "DATA_SET_SCOPE_CONFLICT" });
      assert.deepEqual(await data.getTestDataSet(id), before, "A rejected scope move must preserve all existing data");
    };

    await context.test("case links prevent cross-project and cross-application moves before any write", async () => {
      const id = await createData("Case data");
      await createCase("case-linked", id);
      await expectConflict(id, { project_id: "project-b", app_type_id: "app-b", name: "Must not save" });
      await expectConflict(id, { app_type_id: "app-a2", rows: [{ email: "must-not-save" }] });
      await expectConflict(id, { project_id: "project-b", app_type_id: null });
      assert.equal((await cases.getTestCase("case-linked")).test_data_sets[0].id, id);
    });

    await context.test("suite-only links prevent moving data outside the suite project or application", async () => {
      const id = await createData("Suite data");
      await createSuite("suite-linked", id);
      await expectConflict(id, { project_id: "project-b", app_type_id: "app-b" });
      await expectConflict(id, { app_type_id: "app-a2" });
    });

    await context.test("widening to project-shared and narrowing to a compatible app preserve case and suite links", async () => {
      const id = await createData("Compatible data");
      await createCase("case-compatible", id);
      await createSuite("suite-compatible", id);
      await data.updateTestDataSet(id, { app_type_id: null });
      assert.equal((await data.getTestDataSet(id)).app_type_id, null);
      assert.equal((await cases.getTestCase("case-compatible")).test_data_sets[0].id, id);
      await data.updateTestDataSet(id, { app_type_id: "app-a" });
      await data.updateTestDataSet(id, { name: "Updated without moving", rows: [{ email: "updated@example.test" }] });
      assert.equal((await data.getTestDataSet(id)).rows[0].email, "updated@example.test");
    });

    await context.test("project-shared data cannot narrow while another app still uses it", async () => {
      const caseData = await createData("Multiple application cases", null);
      await createCase("case-shared-a", caseData);
      await createCase("case-shared-a2", caseData, "app-a2");
      await expectConflict(caseData, { app_type_id: "app-a" });
      const suiteData = await createData("Multiple application suites", null);
      await createSuite("suite-shared-a", suiteData);
      await createSuite("suite-shared-a2", suiteData, "app-a2");
      await expectConflict(suiteData, { app_type_id: "app-a" });
    });

    await context.test("unlinked data can move to another project and valid application", async () => {
      const id = await createData("Unlinked data");
      await data.updateTestDataSet(id, { project_id: "project-b", app_type_id: "app-b" });
      assert.equal((await data.getTestDataSet(id)).project_id, "project-b");
      assert.equal((await data.getTestDataSet(id)).app_type_id, "app-b");
    });

    await context.test("historical foreign project and application links are excluded from case detail and list hydration", async () => {
      for (const [suffix, project, app] of [["project", "project-b", "app-b"], ["app", "project-a", "app-a2"]]) {
        const id = await createData(`Historical ${suffix}`);
        const caseId = `case-historical-${suffix}`;
        await createCase(caseId, id);
        // Deliberately emulate old database state, bypassing the new write guard.
        await db.prepare("UPDATE test_data_sets SET project_id=?,app_type_id=? WHERE id=?").run(project, app, id);
        const detail = await cases.getTestCase(caseId);
        assert.deepEqual(detail.test_data_sets, []);
        assert.deepEqual(detail.test_data_set_ids, []);
        const list = await cases.getTestCases({ project_id: "project-a", app_type_id: "app-a" });
        assert.deepEqual(list.find(row => row.id === caseId).test_data_sets, []);
        assert.doesNotMatch(JSON.stringify(detail), new RegExp(`Historical ${suffix}`));
      }
    });

    await context.test("legacy suite-scoped cases retain compatible shared data and reject foreign moves", async () => {
      const id = await createData("Legacy suite data", null);
      await createSuite("legacy-primary-suite", null);
      await createCase("case-legacy-suite", id, null, "legacy-primary-suite");
      assert.equal((await cases.getTestCase("case-legacy-suite")).test_data_sets[0].id, id);
      await data.updateTestDataSet(id, { app_type_id: "app-a" });
      await expectConflict(id, { app_type_id: "app-a2" });
    });

    await context.test("Story-only cases retain project-shared data without accepting an arbitrary application", async () => {
      const id = await createData("Legacy Story data", null);
      await createCase("case-legacy-story", id, null, null, "story-a");
      assert.equal((await cases.getTestCase("case-legacy-story")).test_data_sets[0].id, id);
      await expectConflict(id, { app_type_id: "app-a" });
      await expectConflict(id, { project_id: "project-b" });
    });

    await context.test("secret values stay redacted after scoped hydration and ordinary edits", async () => {
      const id = (await data.createTestDataSet({ project_id: "project-a", app_type_id: null, name: "Scoped credentials", mode: "key_value",
        rows: [{ id: "hidden", key: "password", value: "do-not-render", is_secret: true }] })).id;
      await createCase("case-secret", id);
      await data.updateTestDataSet(id, { description: "Same scope" });
      const row = (await cases.getTestCase("case-secret")).test_data_sets[0].rows[0];
      assert.equal(row.value, ""); assert.equal(row.has_stored_value, true);
      assert.equal((await db.prepare("SELECT rows FROM test_data_sets WHERE id=?").get(id)).rows[0].value, "do-not-render");
    });
  } finally { await db.close(); }
});
