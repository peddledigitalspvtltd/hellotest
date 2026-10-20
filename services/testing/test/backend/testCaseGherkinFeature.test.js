const { dependencyName } = require("../../../platform/backend/test/helpers/sourceFile");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { setGherkinFeatureTitle } = require("../../../platform/backend/src/utils/gherkinFeatureTitle");

test("requirement Feature names preserve scenarios, tags, examples, parameters and doc strings", () => {
  const source = '# language: en\n@regression\nFeature: Old story\n\n@smoke\nScenario Outline: Pay as <role>\n  When @t.account pays\n  Then @r.build is recorded\nExamples:\n  | role |\n  | owner |';
  assert.equal(setGherkinFeatureTitle(source, "<p>New\n story &amp; identity</p>"), source.replace("Feature: Old story", "Feature: New story & identity"));
  assert.equal(setGherkinFeatureTitle(source, null), source);
  assert.equal(setGherkinFeatureTitle(null, "Story"), null);
  const fragment = 'Scenario: Import\n  When a document is submitted\n  """\n  Feature: payload text\n  """';
  assert.equal(setGherkinFeatureTitle(fragment, "Documents"), `Feature: Documents\n\n${fragment}`);
});

const createServiceFixture = () => {
  const state = {
    row: null,
    revision: 1,
    requirementIds: new Set(),
    stories: new Map([
      ["z-primary", { id: "z-primary", title: "Account access", project_id: "project" }],
      ["a-secondary", { id: "a-secondary", title: "Account profile", project_id: "project" }]
    ])
  };
  const db = {
    transaction: (callback) => callback,
    prepare: (statement) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      return {
        get: async (id) => {
          if (/FROM app_types/.test(sql)) return { id: "app", project_id: "project" };
          if (/FROM requirements/.test(sql)) return state.stories.get(id);
          if (/FROM users/.test(sql)) return { id: "author", name: "Author", email: "author@example.test" };
          if (/FROM project_members/.test(sql)) return { user_id: "author" };
          if (/FROM test_cases/.test(sql)) return state.row ? { ...state.row } : null;
          return null;
        },
        all: async () => {
          if (/FROM requirement_test_cases/.test(sql)) {
            return [...new Set([...state.requirementIds, state.row?.requirement_id].filter(Boolean))]
              .sort()
              .map((requirement_id) => ({ test_case_id: state.row.id, requirement_id, title: state.stories.get(requirement_id)?.title }));
          }
          return [];
        },
        run: async (...args) => {
          if (/^INSERT INTO test_cases \(/.test(sql)) {
            const columns = sql.match(/^INSERT INTO test_cases \(([^)]+)\)/)[1].split(",").map((column) => column.trim());
            state.row = Object.fromEntries(columns.slice(0, args.length).map((column, index) => [column, args[index]]));
          } else if (/^UPDATE test_cases SET app_type_id/.test(sql)) {
            const columns = sql.match(/ SET (.+) WHERE id = \?/)[1].split(",").filter((assignment) => assignment.includes("?")).map((assignment) => assignment.split("=")[0].trim());
            columns.forEach((column, index) => { state.row[column] = args[index]; });
          } else if (/^DELETE FROM requirement_test_cases/.test(sql)) state.requirementIds.clear();
          else if (/^INSERT INTO requirement_test_cases/.test(sql)) state.requirementIds.add(args[0]);
        }
      };
    }
  };
  const hooksModule = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, "../../backend/services/caseExecutionHooks.service.js"), "utf8"), {
    module: hooksModule,
    require: (dependency) => dependencyName(dependency) === "db" ? db : require(dependency)
  });
  const service = {};
  const noop = async () => {};
  vm.runInNewContext(readFileSync(path.join(__dirname, "../../backend/services/testCase.service.js"), "utf8"), {
    exports: service,
    require: (dependency) => {
      if (dependencyName(dependency) === "db") return db;
      if (dependency === "crypto") return require("node:crypto");
      if (dependency.includes("/utils/") || dependencyName(dependency) === "catalog") return require(dependency.startsWith("@hellotest/") ? dependency : path.resolve(__dirname, "../../backend/services", dependency));
      if (dependencyName(dependency) === "displayId.service") return { createDisplayId: async () => "TC-1" };
      if (dependencyName(dependency) === "dropdownCatalog.service") return { getDefaultValue: async () => "functional", validateValue: async (key, value) => { assert.equal(key, "test_cases.types"); assert.equal(value, "functional"); return value; } };
      if (dependencyName(dependency) === "mobileFeature.service") return { assertAuthoringMobileFeatureEnabled: noop };
      if (dependencyName(dependency) === "testCaseVersion.service") return { assertExpectedRevision: noop, capture: async () => ({ revision: state.revision++ }), buildSnapshot: async () => ({ steps: [] }) };
      if (dependencyName(dependency) === "caseExecutionHooks.service") return hooksModule.exports;
      return {};
    }
  });
  return { service, state };
};

test("case creation, reads, updates and primary requirement changes all use the current story title", async () => {
  const { service, state } = createServiceFixture();
  const source = "Feature: Wrong heading\n\nScenario: Reject invalid credentials\n  When @t.password is invalid\n  Then access is denied";
  const created = await service.createTestCase({
    app_type_id: "app",
    title: "Reject invalid credentials",
    requirement_ids: ["z-primary", "a-secondary"],
    created_by: "author",
    authoring_mode: "gherkin",
    gherkin_document: source,
    steps: []
  });
  assert.match(state.row.gherkin_document, /^Feature: Account access\n/);
  assert.match(state.row.gherkin_document, /Scenario: Reject invalid credentials/);

  state.stories.get("z-primary").title = "Renamed account access";
  const refreshed = await service.getTestCase(created.id);
  assert.match(refreshed.gherkin_document, /^Feature: Renamed account access\n/);
  assert.equal(refreshed.requirement_ids[0], "z-primary");

  await service.updateTestCase(created.id, { title: "Updated case title", updated_by: "author" });
  assert.match(state.row.gherkin_document, /^Feature: Renamed account access\n/);
  assert.equal(state.row.requirement_id, "z-primary");

  await service.updateTestCase(created.id, { requirement_id: "a-secondary", gherkin_document: source, updated_by: "author" });
  assert.match(state.row.gherkin_document, /^Feature: Account profile\n/);
  assert.match(state.row.gherkin_document, /Scenario: Reject invalid credentials/);
  assert.equal(state.row.requirement_id, "a-secondary");
});
