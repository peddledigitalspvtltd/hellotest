const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function repositoryFixture() {
  const state = {
    entries: [],
    apps: new Map([
      ["app-a", { id: "app-a", project_id: "project-a" }],
      ["app-b", { id: "app-b", project_id: "project-b" }]
    ])
  };
  const scopeDb = {
    prepare: () => ({
      get: async (id) => state.apps.get(id),
      all: async (projectId) => [...state.apps.values()].filter((app) => app.project_id === projectId),
      run: async () => ({ changes: 0 })
    }),
    transaction: (callback) => callback
  };
  const obsDb = {
    prepare: (statement) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      return {
        get: async (id) => state.entries.find((entry) => entry.id === id),
        all: async (...args) => {
          let rows = [...state.entries];
          if (/app_type_id IS NOT DISTINCT FROM/.test(sql)) {
            rows = rows.filter((entry) => entry.app_type_id === args[0] && (entry.metadata.screen_name || entry.page_key) === args[1] && (!args[2] || entry.project_id === args[2]));
          } else if (/WHERE 1 = 1/.test(sql)) {
            let parameter = 0;
            if (/project_id = \?/.test(sql)) {
              const projectId = args[parameter++];
              const legacyScopeCount = (sql.match(/app_type_id IN \(([^)]+)\)/)?.[1].match(/\?/g) || []).length;
              const legacyApps = args.slice(parameter, parameter + legacyScopeCount);
              parameter += legacyScopeCount;
              rows = rows.filter((entry) => entry.project_id === projectId || (!entry.project_id && legacyApps.includes(entry.app_type_id)));
            }
            if (/AND app_type_id = \?/.test(sql)) {
              const appTypeId = args[parameter++];
              rows = rows.filter((entry) => entry.app_type_id === appTypeId);
            }
            rows = rows.slice(args[parameter + 1], args[parameter + 1] + args[parameter]);
          }
          return rows.map((entry) => ({ ...entry }));
        },
        run: async (...args) => {
          if (/^INSERT INTO automation_learning_cache/.test(sql)) {
            const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(",").map((column) => column.trim());
            const entry = Object.fromEntries(columns.slice(0, args.length).map((column, index) => [column, args[index]]));
            const existing = entry.app_type_id ? state.entries.find((candidate) => candidate.app_type_id === entry.app_type_id && candidate.page_key === entry.page_key && candidate.locator_intent === entry.locator_intent && candidate.locator === entry.locator) : null;
            if (existing) Object.assign(existing, entry, { id: existing.id });
            else state.entries.push({ ...entry, hit_count: 1 });
            return { changes: 1 };
          }
          if (/^UPDATE automation_learning_cache SET page_url/.test(sql)) {
            const columns = sql.match(/ SET (.+) WHERE id = \?/)[1].split(",").filter((assignment) => assignment.includes("?")).map((assignment) => assignment.split("=")[0].trim());
            const entry = state.entries.find((candidate) => candidate.id === args[args.length - 1]);
            columns.forEach((column, index) => { entry[column] = args[index]; });
          }
          return { changes: 1 };
        }
      };
    }
  };
  const service = {};
  const requireFixture = (dependency) => {
    if (dependency === "@hellotest/platform/backend/src/db") return scopeDb;
    if (dependency === "@hellotest/platform/backend/src/obsDb") return obsDb;
    if (dependency === "crypto") return require("node:crypto");
    if (dependency === "@hellotest/platform/backend/src/utils/testStepAutomation") return require("../../../platform/backend/src/utils/testStepAutomation");
    return {};
  };
  const source = readFileSync(path.join(__dirname, "../../backend/services/aiAutomationBuilder.service.js"), "utf8");
  new Function("require", "exports", "module", source)(requireFixture, service, { exports: service });
  return { state, service };
}

test("saved screens and selected fields survive an asynchronous database reload with their evidence", async () => {
  const { service } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "__screen__", locator_intent: "__screen__", object_name: "__screen__", source: "manual_screen",
    metadata: { record_kind: "screen", screen_dom_compressed: "<form>Login</form>", screen_screenshot_url: "data:image/png;base64,screen" }
  });
  const field = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "#email", object_name: "email",
    metadata: { target_criteria: ["Email address"], screen_dom_compressed: "<form>Login</form>", screen_screenshot_url: "data:image/png;base64,screen", dom_structure: '<input id="email">', screenshot_url: "data:image/png;base64,field" }
  });
  const otherScreen = await service.createLearningCacheEntry({ app_type_id: "app-a", screen_name: "Checkout", locator: "__screen__", locator_intent: "__screen__", source: "manual_screen" });
  const refreshed = await service.listLearningCache({ app_type_id: "app-a", limit: 200 });
  assert.deepEqual(new Set(refreshed.map((entry) => entry.id)), new Set([screen.id, field.id, otherScreen.id]));
  assert.equal(refreshed.every((entry) => entry.project_id === "project-a"), true);
  assert.equal(refreshed.find((entry) => entry.id === field.id).metadata.screen_dom_compressed, "<form>Login</form>");
  assert.deepEqual(refreshed.find((entry) => entry.id === field.id).metadata.target_criteria, ["Email address"]);
  assert.equal(refreshed.find((entry) => entry.id === field.id).metadata.screenshot_url, "data:image/png;base64,field");
  await service.updateLearningCacheEntry(field.id, { description: "Email field", screen_dom_compressed: "<form>Updated</form>" });
  const updated = await service.getLearningCacheEntry(field.id);
  assert.equal(updated.metadata.screen_dom_compressed, "<form>Updated</form>");
  assert.equal(updated.metadata.screen_screenshot_url, "data:image/png;base64,screen");
});

test("repository listing remains scoped and paginated, including historical app-owned rows without project IDs", async () => {
  const { service, state } = repositoryFixture();
  for (const [app, screen] of [["app-a", "A"], ["app-a", "B"], ["app-b", "Other project"]]) {
    await service.createLearningCacheEntry({ app_type_id: app, screen_name: screen, locator: "__screen__", locator_intent: "__screen__" });
  }
  state.entries[0].project_id = null;
  const projectRows = await service.listLearningCache({ project_id: "project-a", limit: 200 });
  assert.deepEqual(projectRows.map((entry) => entry.metadata.screen_name), ["A", "B"]);
  assert.equal((await service.listLearningCache({ app_type_id: "app-a", limit: 1, offset: 1 }))[0].metadata.screen_name, "B");
  await assert.rejects(service.createLearningCacheEntry({ app_type_id: "app-a", project_id: "project-b", screen_name: "Wrong", locator: "#wrong" }), /scope must match/);
});

test("identical project-level screen names stay isolated and cannot overwrite one another", async () => {
  const { service } = repositoryFixture();
  const first = await service.createLearningCacheEntry({ project_id: "project-a", screen_name: "Login", locator: "#email", object_name: "email" });
  const second = await service.createLearningCacheEntry({ project_id: "project-b", screen_name: "Login", locator: "#email", object_name: "email" });
  assert.notEqual(first.id, second.id);
  assert.equal((await service.listLearningCache({ project_id: "project-a" })).length, 1);
  await assert.rejects(service.createLearningCacheEntry({ project_id: "project-a", screen_name: "Login", locator: "#email", object_name: "email" }), /same locator/);
});

test("selected fields retain the confirmed screen identity after stale drafts, refresh and retry", async () => {
  const { service } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", page_url: "https://app.test/login",
    locator: "__screen__", locator_intent: "__screen__", source: "manual_screen"
  });
  const unrelated = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Checkout", locator: "#email", object_name: "Email"
  });
  const capture = {
    app_type_id: "app-a", project_id: "project-a", screen_name: "Stale name", page_key: "Stale name",
    locator: "#email", object_name: "Email", source: "live_inspect",
    metadata: {
      screen_entry_id: screen.id, screen_name: "Older metadata name", last_validated_status: "missing",
      dom_structure: '<input id="email">', screen_screenshot_url: "data:image/png;base64,captured"
    }
  };
  const field = await service.createLearningCacheEntry(capture);
  assert.equal(field.page_key, "Login");
  assert.equal(field.metadata.screen_name, "Login");
  assert.equal(field.metadata.screen_entry_id, screen.id);
  assert.equal(field.metadata.last_validated_status, "missing", "saving a capture must not claim it was live-validated");
  const retried = await service.createLearningCacheEntry({ ...capture, dom_structure: '<input id="email" type="email">' });
  assert.equal(retried.id, field.id, "a partial-save retry updates the same parent/locator instead of creating or rejecting a duplicate");
  const reopened = await service.listLearningCache({ app_type_id: "app-a", limit: 200 });
  assert.equal(reopened.length, 3);
  const savedField = reopened.find((entry) => entry.id === field.id);
  assert.equal(savedField.metadata.dom_structure, '<input id="email" type="email">');
  assert.equal(savedField.metadata.screen_screenshot_url, "data:image/png;base64,captured");
  assert.equal(reopened.find((entry) => entry.id === unrelated.id).metadata.screen_name, "Checkout");
  await service.updateLearningCacheEntry(field.id, { page_key: "Wrong page", screen_name: "Wrong name", description: "Curated" });
  assert.equal((await service.getLearningCacheEntry(field.id)).metadata.screen_name, "Login");
});

test("field parent references cannot cross project/app scope or refer to a missing screen or another field", async () => {
  const { service, state } = repositoryFixture();
  const screen = await service.createLearningCacheEntry({
    app_type_id: "app-a", screen_name: "Login", locator: "__screen__", locator_intent: "__screen__", source: "manual_screen"
  });
  const field = await service.createLearningCacheEntry({ app_type_id: "app-a", screen_name: "Login", locator: "#email" });
  const initialCount = state.entries.length;
  const input = { app_type_id: "app-b", project_id: "project-b", locator: "#foreign", metadata: { screen_entry_id: screen.id } };
  await assert.rejects(service.createLearningCacheEntry(input), /same project and app type/);
  await assert.rejects(service.createLearningCacheEntry({ ...input, app_type_id: "app-a", project_id: "project-a", metadata: { screen_entry_id: "missing" } }), /no longer exists/);
  await assert.rejects(service.createLearningCacheEntry({ ...input, app_type_id: "app-a", project_id: "project-a", metadata: { screen_entry_id: field.id } }), /no longer exists/);
  assert.equal(state.entries.length, initialCount, "invalid parent bindings fail before writes");
});
