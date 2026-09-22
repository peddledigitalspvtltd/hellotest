const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const fixture = () => {
  const state = { cases: new Map(), depth: 0, failSteps: false, revisions: new Map() };
  const bugs = new Map([
    ["bug", { id: "bug", project_id: "project" }],
    ["other-project-bug", { id: "other-project-bug", project_id: "other-project" }]
  ]);
  const db = {
    transaction: (callback) => async (...args) => {
      const snapshot = structuredClone(state.cases);
      state.depth++;
      try { return await callback(...args); }
      catch (error) { state.cases = snapshot; throw error; }
      finally { state.depth--; }
    },
    prepare: (statement) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      return {
        get: async (id) => {
          if (/FROM app_types/.test(sql)) return { id: "app", project_id: "project" };
          if (/FROM users/.test(sql)) return { id: "author", name: "Author" };
          if (/FROM project_members/.test(sql)) return { user_id: "author" };
          if (/FROM feedback/.test(sql)) {
            assert.ok(state.depth > 0, "Source validation and insertion must share the transaction");
            assert.match(sql, /FOR SHARE/);
            return bugs.get(id);
          }
          if (/FROM test_cases/.test(sql)) return state.cases.has(id) ? { ...state.cases.get(id) } : null;
          return null;
        },
        all: async () => [],
        run: async (...args) => {
          assert.equal((sql.match(/\?/g) || []).length, args.length, "SQL placeholders match persisted values");
          if (/^INSERT INTO test_cases \(/.test(sql)) {
            assert.ok(state.depth > 0);
            const columns = sql.match(/^INSERT INTO test_cases \(([^)]+)\)/)[1].split(",").map((column) => column.trim());
            state.cases.set(args[0], Object.fromEntries(columns.slice(0, args.length).map((column, index) => [column, args[index]])));
          } else if (/^UPDATE test_cases SET app_type_id/.test(sql)) {
            const row = state.cases.get(args.at(-1));
            const columns = sql.match(/ SET (.+) WHERE id = \?/)[1].split(",").filter((assignment) => assignment.includes("?")).map((assignment) => assignment.split("=")[0].trim());
            columns.forEach((column, index) => { row[column] = args[index]; });
          } else if (/^INSERT INTO test_steps/.test(sql) && state.failSteps) throw new Error("Step persistence failed");
        }
      };
    }
  };
  const service = {};
  const noop = async () => {};
  vm.runInNewContext(readFileSync(path.join(__dirname, "../src/services/testCase.service.js"), "utf8"), {
    exports: service,
    require: (dependency) => {
      if (dependency === "../db") return db;
      if (dependency === "crypto") return require("node:crypto");
      if (dependency.startsWith("../utils/") || dependency === "../domain/catalog") return require(path.join(__dirname, "../src/services", dependency));
      if (dependency === "./displayId.service") return { createDisplayId: async () => "TC-1" };
      if (dependency === "./dropdownCatalog.service") return { getDefaultValue: async () => "functional", validateValue: async (key, value) => { assert.equal(key, "test_cases.types"); assert.equal(value, "functional"); return value; } };
      if (dependency === "./mobileFeature.service") return { assertAuthoringMobileFeatureEnabled: noop };
      if (dependency === "./testCaseVersion.service") return {
        assertExpectedRevision: noop,
        capture: async ({ testCase }) => {
          const revision = state.revisions.get(testCase.id) || 1;
          state.revisions.set(testCase.id, revision + 1);
          return { revision };
        },
        buildSnapshot: async () => ({ steps: [] })
      };
      return {};
    }
  });
  return { service, state };
};

const input = { app_type_id: "app", title: "Check corrected behavior", created_by: "author", steps: [] };

test("explicit Bug conversion persists origin on creation and ordinary edits cannot rewrite it", async () => {
  const { service, state } = fixture();
  const ordinary = await service.createTestCase(input);
  assert.equal(state.cases.get(ordinary.id).source_issue_id, null);
  const converted = await service.createTestCase({ ...input, source_issue_id: "bug" });
  assert.equal(state.cases.get(converted.id).source_issue_id, "bug");
  await service.updateTestCase(converted.id, { title: "Edited later", source_issue_id: "other-project-bug", updated_by: "author" });
  assert.equal((await service.getTestCase(converted.id)).source_issue_id, "bug");
});

test("missing and foreign-project Bug origins reject before inserting a Test Case", async () => {
  const { service, state } = fixture();
  for (const source_issue_id of ["missing-bug", "other-project-bug"]) {
    await assert.rejects(service.createTestCase({ ...input, source_issue_id }), { statusCode: 403 });
  }
  assert.equal(state.cases.size, 0);
});

test("a failed converted case transaction leaves no recorded conversion", async () => {
  const { service, state } = fixture();
  state.failSteps = true;
  await assert.rejects(service.createTestCase({
    ...input, source_issue_id: "bug", steps: [{ action: "Submit the form", expected_result: "Submission succeeds" }]
  }), /Step persistence failed/);
  assert.equal(state.cases.size, 0);
});

test("case creation requires Bug read permission when conversion origin is supplied", async (t) => {
  const Fastify = require("fastify");
  const service = require("../src/services/testCase.service");
  const appTypes = require("../src/services/appType.service");
  const projects = require("../src/services/project.service");
  const calls = [];
  t.mock.method(appTypes, "getAppType", async () => ({ id: "app", project_id: "project", platform: "web" }));
  t.mock.method(projects, "getProject", async () => ({ id: "project" }));
  t.mock.method(service, "createTestCase", async () => { calls.push("created"); return { id: "case" }; });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.decorate("authenticate", async (req) => { req.user = { id: "author", role: "member" }; });
  app.decorate("requirePermission", (permission, scope) => async () => {
    calls.push(permission);
    assert.equal(scope.projectId, "project");
    if (permission === "feedback.view") throw Object.assign(new Error("Bug access denied"), { statusCode: 403 });
  });
  await app.register(require("../src/plugins/validator"));
  await app.register(require("../src/routes/testCases.routes"));
  const response = await app.inject({ method: "POST", url: "/test-cases", payload: { app_type_id: "app", title: input.title, source_issue_id: "bug" } });
  assert.equal(response.statusCode, 403);
  assert.ok(calls.includes("feedback.view"));
  assert.equal(calls.includes("created"), false);
});
