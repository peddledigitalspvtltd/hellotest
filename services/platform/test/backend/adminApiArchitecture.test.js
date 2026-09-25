const { sourceFile } = require("../../backend/test/helpers/sourceFile");
const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../../backend/src/db");
const settings = require("../../backend/services/settings.service");
const notifications = require("../../backend/services/notification.service");
const roles = require("../../backend/services/role.service");
const auth = require("../../backend/services/auth.service");
const { encodeCursor } = require("../../backend/src/utils/pagination");

async function routeApp(t, routes, user = { id: "member", role: "member" }) {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.decorate("authenticate", async (req) => { req.user = user; });
  app.decorate("requirePermission", (permission) => async () => {
    throw Object.assign(new Error(`Permission required: ${permission}`), { statusCode: 403 });
  });
  await app.register(require("../../backend/src/plugins/validator"));
  await app.register(require("../../backend/src/plugins/errorHandler"));
  await app.register(require(sourceFile(routes, "routes")));
  return app;
}

test("governed preference authorization uses persistence's canonical keys", async (t) => {
  const writes = t.mock.method(settings, "updateWorkspacePreferences", async () => ({ updated: true }));
  const app = await routeApp(t, "settings.routes");
  for (const key of settings.GOVERNED_WORKSPACE_PREFERENCE_KEYS) {
    for (const submittedKey of [key, ` ${key} `, `\t${key}\n`]) {
      const response = await app.inject({ method: "PUT", url: "/settings/workspace-preferences", payload: { preferences: { [submittedKey]: {} } } });
      assert.equal(response.statusCode, 403, submittedKey);
    }
  }
  assert.equal(writes.mock.callCount(), 0);
  assert.equal((await app.inject({ method: "PUT", url: "/settings/workspace-preferences", payload: { preferences: { " theme ": "dark" } } })).statusCode, 200);
  assert.equal(writes.mock.callCount(), 1);
});

test("profile updates cannot pass an undeclared password hash to persistence", async (t) => {
  const users = require("../../backend/services/user.service");
  const update = t.mock.method(users, "updateUser", async () => ({ updated: true }));
  const app = await routeApp(t, "users.routes");
  const response = await app.inject({ method: "PUT", url: "/users/member", payload: { name: "Updated", password_hash: "injected" } });
  assert.equal(response.statusCode, 400);
  assert.equal(update.mock.callCount(), 0);
});

test("profile patches write no stale credentials, administrator flag or other omitted fields", async (t) => {
  const writes = [];
  t.mock.method(db, "transaction", (callback) => async () => callback());
  t.mock.method(db, "prepare", (sql) => ({
    get: async () => {
      assert.match(sql, /SELECT id, email FROM users/);
      return { id: "member", email: "member@example.test" };
    },
    run: async (...params) => { writes.push({ sql, params }); return { changes: 1 }; }
  }));
  const users = require("../../backend/services/user.service");
  await users.updateUser("member", { name: " Updated " });
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /UPDATE users SET name = \? WHERE id = \?/);
  assert.doesNotMatch(writes[0].sql, /password_hash|is_workspace_admin|default_role_id|avatar_data_url|email/);
  assert.deepEqual(writes[0].params, ["Updated", "member"]);
  await assert.rejects(users.updateUser("member", { password_hash: "injected" }), { statusCode: 400 });
  assert.equal(writes.length, 1);
});

test("role replacement uses two mutation queries independent of grant count and keeps atomic rollback", async (t) => {
  const permissions = Array.from({ length: 120 }, (_, index) => ({ id: `permission-${index}`, code: `feature-${index}.view` }));
  let assigned = ["old"];
  let insertsFail = false;
  let mutations = 0;
  t.mock.method(db, "transaction", (callback) => async () => {
    const before = [...assigned];
    try { return await callback(); } catch (error) { assigned = before; throw error; }
  });
  t.mock.method(db, "prepare", (sql) => ({
    get: async () => ({ id: "role", name: "Custom" }),
    all: async () => permissions,
    run: async (...params) => {
      mutations += 1;
      if (/DELETE/.test(sql)) assigned = [];
      else {
        assert.match(sql, /INSERT INTO role_permissions/);
        assert.equal(params.length, 240);
        if (insertsFail) throw new Error("insertion failed");
        assigned = params.filter((_, index) => index % 2 === 1);
      }
      return { changes: 1 };
    }
  }));
  const result = await roles.replaceRolePermissions("role", permissions.map((item) => item.code));
  assert.equal(mutations, 2, "Previously one delete plus 120 inserts");
  assert.equal(assigned.length, 120);
  assert.equal(result.permission_codes.length, 120);
  insertsFail = true;
  await assert.rejects(roles.replaceRolePermissions("role", permissions.map((item) => item.code)), /insertion failed/);
  assert.equal(assigned.length, 120, "An insert failure restores previous grants");
});

test("notification pages transfer only requested rows with exact scoped totals and stable ordering", async (t) => {
  const queries = [];
  t.mock.method(db, "prepare", (sql) => ({
    get: async (...params) => { queries.push({ sql, params }); return { total: 50000, unread_count: 25000 }; },
    all: async (...params) => {
      queries.push({ sql, params });
      assert.match(sql, /WHERE user_id = \? AND status = \?/);
      assert.match(sql, /ORDER BY created_at DESC, id DESC LIMIT \? OFFSET \?/);
      assert.deepEqual(params, ["member", "unread", 50, 150]);
      return Array.from({ length: 50 }, (_, index) => ({ id: `notice-${index + 150}`, type: "execution.failed", status: "unread" }));
    }
  }));
  const result = await notifications.getNotificationPage({ user_id: "member", status: "unread", cursor: encodeCursor(150) });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, ["member", "unread"]);
  assert.equal(result.items.length, 50);
  assert.equal(result.total, 50000);
  assert.equal(result.unread_count, 25000);
  assert.equal(result.items[0].preference, "executionFailures");
  assert.equal(result.next_cursor, encodeCursor(200));
  assert.equal(result.is_last, false);
});

test("notification paging bounds limits and rejects invalid cursors before querying", async (t) => {
  let queryCount = 0;
  t.mock.method(db, "prepare", (sql) => ({
    get: async () => { queryCount += 1; return { total: 1, unread_count: 0 }; },
    all: async (...params) => { queryCount += 1; assert.deepEqual(params, ["member", 200, 0]); return [{ id: "notice", status: "read" }]; }
  }));
  await assert.rejects(notifications.getNotificationPage({ user_id: "member", cursor: "invalid" }), { statusCode: 400 });
  await assert.rejects(notifications.getNotificationPage({ user_id: "member", cursor: encodeCursor(1e30) }), { statusCode: 400 });
  await assert.rejects(notifications.getNotificationPage({}), { statusCode: 400 });
  assert.equal(queryCount, 0);
  const page = await notifications.getNotificationPage({ user_id: "member", limit: 100000 });
  assert.equal(page.next_cursor, null);
  assert.equal(page.is_last, true);
});

test("notification read mutation is owner-scoped in its single SQL write", async (t) => {
  const calls = [];
  t.mock.method(db, "prepare", (sql) => ({ run: async (...params) => {
    calls.push({ sql, params });
    assert.match(sql, /WHERE id = \? AND user_id = \?/);
    return { changes: params[1] === "owner" ? 1 : 0 };
  } }));
  await assert.rejects(notifications.markRead("notice", "other"), { statusCode: 404 });
  assert.deepEqual(await notifications.markRead("notice", "owner"), { updated: true });
  assert.equal(calls.length, 2);
});

test("project viewers cannot expand the transaction list into global administration activity", async (t) => {
  const transactions = require("../../backend/services/workspaceTransaction.service");
  const list = t.mock.method(transactions, "listTransactions", async () => []);
  const app = await routeApp(t, "workspaceTransactions.routes");
  const response = await app.inject({ method: "GET", url: "/workspace-transactions?project_id=project&include_global=true" });
  assert.equal(response.statusCode, 403);
  assert.equal(list.mock.callCount(), 0);
});

test("session route treats missing credentials as unauthorized and accepts case-insensitive bearer scheme", async (t) => {
  const session = t.mock.method(auth, "getSession", async (token) => ({ token }));
  const app = await routeApp(t, "auth.routes");
  assert.equal((await app.inject({ url: "/auth/session" })).statusCode, 401);
  assert.equal(session.mock.callCount(), 0);
  assert.deepEqual((await app.inject({ url: "/auth/session", headers: { authorization: "bearer token" } })).json(), { token: "token" });
});

test("public administration asset gateway cannot escape its configured origin or base path", async (t) => {
  const { config } = require("../../backend/src/config");
  const previous = config.adminPortal.frontendInternalUrl;
  config.adminPortal.frontendInternalUrl = "http://frontend.internal:81/admin-assets";
  t.after(() => { config.adminPortal.frontendInternalUrl = previous; });
  const upstream = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "http://frontend.internal:81/admin-assets/assets/app.js");
    assert.equal(options.redirect, "error", "Upstream redirects cannot escape the validated origin");
    return new Response("asset source", { headers: { "content-type": "application/javascript", "cache-control": "public, max-age=300" } });
  });
  const app = await routeApp(t, "adminUi.routes");
  for (const path of ["https:%2F%2Fforeign.example/secret", "%5C%5Cforeign.example/secret", "%2E%2E%2Fsecret", "data:text/plain,unexpected"]) {
    assert.equal((await app.inject({ url: `/admin/${path}` })).statusCode, 400, path);
  }
  assert.equal(upstream.mock.callCount(), 0, "Invalid paths make no provider request");
  const valid = await app.inject({ url: "/admin/assets/app.js" });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body, "asset source");
  assert.equal(valid.headers["content-type"], "application/javascript");
  assert.equal(upstream.mock.callCount(), 1);
});
