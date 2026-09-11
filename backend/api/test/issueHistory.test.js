const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const db = require("../src/db");
const displayIds = require("../src/services/displayId.service");
const issues = require("../src/services/issues.service");
const history = require("../src/services/issueHistory.service");

const installDatabase = (t) => {
  const state = { issue: null, events: [], failHistory: false, locks: 0, depth: 0 };
  const users = {
    reporter: { id: "reporter", name: "Original Reporter", email: "reporter@example.test" },
    editor: { id: "editor", name: "Editing User", email: "editor@example.test" }
  };
  t.mock.method(displayIds, "createDisplayId", async () => "BUG-42");
  t.mock.method(db, "transaction", (callback) => async () => {
    const snapshot = structuredClone({ issue: state.issue, events: state.events });
    state.depth += 1;
    try {
      return await callback();
    } catch (error) {
      state.issue = snapshot.issue;
      state.events = snapshot.events;
      throw error;
    } finally {
      state.depth -= 1;
    }
  });
  t.mock.method(db, "prepare", (sql) => ({
    get: async (...params) => {
      if (/FOR UPDATE/.test(sql)) {
        assert.ok(state.depth > 0, "The previous values must be read under a transaction lock");
        state.locks += 1;
        return state.issue && { id: state.issue.id };
      }
      if (/FROM users/.test(sql)) return users[params[0]];
      if (/FROM projects/.test(sql)) return { id: "project-1", name: "Payments" };
      if (/FROM app_settings/.test(sql)) return undefined;
      if (/FROM feedback/.test(sql)) return state.issue && { ...structuredClone(state.issue), user_name: users[state.issue.user_id]?.name };
      throw new Error(`Unexpected get: ${sql}`);
    },
    all: async (...params) => {
      if (/FROM issue_history/.test(sql)) return structuredClone(state.events).reverse();
      if (/AS label FROM users/.test(sql)) return params.flatMap((id) => users[id] ? [{ id, label: users[id].name }] : []);
      if (/AS label FROM projects/.test(sql)) return [{ id: "project-1", label: "Payments" }];
      if (/AS label FROM test_cases/.test(sql)) return params.map((id) => ({ id, label: `Case ${id}` }));
      return [];
    },
    run: async (...params) => {
      assert.ok(state.depth > 0, "Issue writes and history must share a transaction");
      assert.equal((sql.match(/\?/g) || []).length, params.length, "Every SQL placeholder must have a value");
      if (/INSERT INTO feedback/.test(sql)) {
        const columns = sql.match(/INSERT INTO feedback\s*\(([\s\S]+?)\)\s*VALUES/)[1].split(",").map((value) => value.trim());
        state.issue = { ...Object.fromEntries(columns.map((column, index) => [column, params[index]])), created_at: "2026-09-09T09:00:00.000Z" };
      } else if (/UPDATE feedback/.test(sql)) {
        const columns = [...sql.matchAll(/(\w+) = \?/g)].map((match) => match[1]).filter((column) => column !== "id");
        columns.forEach((column, index) => { state.issue[column] = params[index]; });
      } else if (/INSERT INTO issue_history/.test(sql)) {
        if (state.failHistory) throw new Error("History write failed");
        const [id, issue_id, actor_id, actor_name, actor_email, action, changes] = params;
        state.events.push({ id, issue_id, actor_id, actor_name, actor_email, action, changes: structuredClone(changes), created_at: "2026-09-09T10:00:00.000Z" });
      }
      return { changes: 1 };
    }
  }));
  return state;
};

const createPayload = {
  project_id: "project-1",
  user_id: "reporter",
  title: "Checkout does not complete",
  message: "Payment confirmation is absent.",
  root_cause: "Code Defect",
  qa_root_cause: "Missed test scenario",
  labels: ["checkout", "payments"]
};

test("Bug creation persists independent primary/QA causes and a named creation event", async (t) => {
  const state = installDatabase(t);
  const result = await issues.createIssue(createPayload);
  const item = await issues.getIssueItem(result.id);
  assert.equal(item.root_cause, "Code Defect");
  assert.equal(item.qa_root_cause, "Missed test scenario");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].action, "created");
  assert.equal(state.events[0].actor_name, "Original Reporter");
  assert.equal(state.events[0].changes.find((change) => change.field === "qa_root_cause").new_value, "Missed test scenario");
});

test("Bug edits record exact previous/new values and the editor independently of the reporter", async (t) => {
  const state = installDatabase(t);
  const { id } = await issues.createIssue(createPayload);
  await issues.updateIssue(id, { title: "Checkout confirmation fails", qa_root_cause: "Unique data variation", assignee_id: "editor" }, { actorId: "editor" });
  assert.equal(state.issue.user_id, "reporter");
  assert.equal(state.issue.root_cause, "Code Defect");
  assert.equal(state.locks, 1);
  const event = (await issues.getIssueHistory(id))[0];
  assert.equal(event.actor_name, "Editing User");
  assert.equal(event.actor_id, "editor");
  assert.equal(event.action, "updated");
  assert.equal(event.changes.length, 3);
  assert.deepEqual(event.changes.find((change) => change.field === "qa_root_cause"), {
    field: "qa_root_cause", label: "QA Root Cause", old_value: "Missed test scenario", new_value: "Unique data variation"
  });
  assert.equal(event.changes.find((change) => change.field === "assignee_id").new_display, "Editing User");
  assert.equal(event.created_at, "2026-09-09T10:00:00.000Z");
});

test("Clearing QA Root Cause persists null and produces an explicit history change", async (t) => {
  const state = installDatabase(t);
  const { id } = await issues.createIssue(createPayload);
  await issues.updateIssue(id, { qa_root_cause: "" }, { actorId: "editor" });
  assert.equal(state.issue.qa_root_cause, null);
  assert.deepEqual(state.events.at(-1).changes, [{ field: "qa_root_cause", label: "QA Root Cause", old_value: "Missed test scenario", new_value: null }]);
});

test("No-op saves and reordered label sets do not manufacture history entries", async (t) => {
  const state = installDatabase(t);
  const { id } = await issues.createIssue(createPayload);
  await issues.updateIssue(id, { title: createPayload.title, labels: ["payments", "checkout"] }, { actorId: "editor" });
  assert.equal(state.events.length, 1);
});

test("An invalid QA cause or failed history write cannot partially save a Bug", async (t) => {
  const state = installDatabase(t);
  const { id } = await issues.createIssue(createPayload);
  await assert.rejects(issues.updateIssue(id, { qa_root_cause: "Unlisted cause" }, { actorId: "editor" }), { statusCode: 400 });
  state.failHistory = true;
  await assert.rejects(issues.updateIssue(id, { title: "Changed title" }, { actorId: "editor" }), /History write failed/);
  assert.equal(state.issue.title, createPayload.title);
  assert.equal(state.issue.qa_root_cause, createPayload.qa_root_cause);
  assert.equal(state.events.length, 1);
});

test("Failed creation history rolls back the new Bug", async (t) => {
  const state = installDatabase(t);
  state.failHistory = true;
  await assert.rejects(issues.createIssue(createPayload), /History write failed/);
  assert.equal(state.issue, null);
  assert.equal(state.events.length, 0);
});

test("Legacy Bugs expose their known creation date without inventing earlier edits", async (t) => {
  const state = installDatabase(t);
  const { id } = await issues.createIssue(createPayload);
  state.events = [];
  const entries = await issues.getIssueHistory(id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].legacy, true);
  assert.equal(entries[0].created_at, "2026-09-09T09:00:00.000Z");
  assert.deepEqual(entries[0].changes, []);
  assert.deepEqual(history.buildChanges({ labels: ["one", "two"] }, { labels: ["two", "one"] }), []);
});

test("History reads enforce project permission and edits use the authenticated actor", async () => {
  const handlers = new Map();
  const calls = [];
  let allowed = false;
  const service = {
    getIssueItem: async (id) => ({ id, project_id: "project-1" }),
    getIssueHistory: async (id) => { calls.push(["history", id]); return []; },
    updateIssue: async (id, data, context) => { calls.push(["update", id, context.actorId]); return { updated: true }; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/routes/issues.routes"), "utf8"), {
    module,
    require: (name) => name === "../services/issues.service" ? service : {}
  });
  const fastify = {
    authenticate: async () => {},
    validate: () => {},
    requirePermission: (code, scope) => async () => {
      calls.push(["permission", code, scope.projectId]);
      if (!allowed) throw new Error("Forbidden");
    },
    get: (route, handler) => handlers.set(`GET ${route}`, handler),
    post: (route, handler) => handlers.set(`POST ${route}`, handler),
    put: (route, handler) => handlers.set(`PUT ${route}`, handler),
    delete: (route, handler) => handlers.set(`DELETE ${route}`, handler)
  };
  await module.exports(fastify);
  const req = { params: { id: "bug-1" }, user: { id: "authenticated-editor" }, body: { user_id: "reporter", actorId: "forged-editor" } };
  await assert.rejects(handlers.get("GET /feedback/:id/history")(req), /Forbidden/);
  assert.ok(!calls.some(([action]) => action === "history"));
  allowed = true;
  await handlers.get("GET /issues/:id/history")(req);
  await handlers.get("PUT /feedback/:id")(req);
  assert.ok(calls.some(([action, code, project]) => action === "permission" && code === "feedback.view" && project === "project-1"));
  assert.ok(calls.some(([action, id, actor]) => action === "update" && id === "bug-1" && actor === "authenticated-editor"));
});
