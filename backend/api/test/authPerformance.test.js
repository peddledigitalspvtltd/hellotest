const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { setImmediate: nextTurn } = require("node:timers/promises");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../src/db");
const auth = require("../src/services/auth.service");
const token = require("../src/utils/token");

const password = "Correct Horse Battery Staple!";
const modernHash = token.hashPassword(password);
const replacementHash = token.hashPassword("Replacement password after a reset!");
const legacyHash = crypto.pbkdf2Sync(password, process.env.PASSWORD_SALT || "hellotest-dev-salt", 100_000, 64, "sha256").toString("hex");

function sessionFixture(t, overrides = {}) {
  const state = {
    user: { id: "member-1", email: "member@example.test", name: "Member", status: "active", is_workspace_admin: false },
    hash: modernHash,
    grants: [
      { project_id: null, code: "workspace.view" },
      { project_id: null, code: "project.delete" },
      { project_id: "project-a", code: "project.view" },
      { project_id: "project-a", code: "test_case.view" }
    ],
    queries: [],
    writes: [],
    ...overrides
  };
  t.mock.method(db, "prepare", (sql) => ({
    get: async (...params) => {
      state.queries.push({ sql, params });
      if (/FROM users/.test(sql)) {
        if (!/password_hash/.test(sql)) state.onSessionRead?.();
        return state.user && { ...state.user, ...(/password_hash/.test(sql) ? { password_hash: state.hash } : {}) };
      }
      assert.fail(`Unexpected query: ${sql}`);
    },
    all: async (...params) => {
      state.queries.push({ sql, params });
      assert.match(sql, /role_permissions/);
      return state.grants;
    },
    run: async (...params) => {
      if (/UPDATE users/.test(sql) && /AND password_hash = \?/.test(sql) && params.at(-1) !== state.hash) return { changes: 0 };
      state.writes.push({ sql, params });
      if (/SET password_hash/.test(sql)) state.hash = params[0];
      return { changes: 1 };
    }
  }));
  return state;
}

test("async password work preserves strong modern/legacy verification and leaves the event loop available", async (t) => {
  t.mock.method(crypto, "pbkdf2Sync", () => { throw new Error("Synchronous password work is forbidden in requests"); });
  let completed = false;
  const pendingHash = token.hashPasswordAsync(password).then((hash) => { completed = true; return hash; });
  await nextTurn();
  assert.equal(completed, false, "A request can make progress while password derivation runs");
  const hash = await pendingHash;
  assert.match(hash, /^pbkdf2_sha256\$600000\$/);
  assert.notEqual(hash, modernHash);
  assert.equal(await token.verifyPasswordAsync(password, hash), true);
  assert.equal(await token.verifyPasswordAsync(password, modernHash), true);
  assert.equal(await token.verifyPasswordAsync(password, legacyHash), true);
  assert.equal(await token.verifyPasswordAsync("wrong", hash), false);
  assert.equal(await token.verifyPasswordAsync("", hash), false);
  assert.equal(await token.verifyPasswordAsync(password, "malformed"), false);
  assert.equal(await token.verifyPasswordAsync(password, hash.replace("600000", "99999999")), false);
});

test("session refresh uses two reads and sees permission changes without a stale authorization cache", async (t) => {
  const state = sessionFixture(t);
  const bearer = token.createToken(state.user);
  const session = await auth.getSession(bearer);
  assert.equal(state.queries.length, 2);
  assert.deepEqual(session.user.workspace_permissions, ["workspace.view"]);
  assert.deepEqual(session.user.project_permissions, { "project-a": ["project.view", "test_case.view"] });
  assert.equal(session.user.permissions.includes("project.delete"), false);
  assert.equal("password_hash" in session.user, false);

  state.grants = [];
  const refreshed = await auth.getSession(bearer);
  assert.deepEqual(refreshed.user.project_permissions, {});
  assert.deepEqual(refreshed.user.permissions, ["settings.view", "workspace.view"]);
  state.user.is_workspace_admin = true;
  const before = state.queries.length;
  assert.equal((await auth.getSession(bearer)).user.role, "admin");
  assert.equal(state.queries.length - before, 1, "Admin session only needs the live user lookup");
});

test("invalid, deleted and suspended sessions cannot return a permission profile", async (t) => {
  const state = sessionFixture(t);
  const bearer = token.createToken(state.user);
  await assert.rejects(auth.getSession("invalid"), { statusCode: 401 });
  assert.equal(state.queries.length, 0);
  state.user.status = "suspended";
  await assert.rejects(auth.getSession(bearer), { statusCode: 403 });
  assert.equal(state.queries.length, 1);
  state.user = null;
  await assert.rejects(auth.getSession(bearer), { statusCode: 404 });
});

test("a session request completes while login password verification is still in flight", async (t) => {
  const state = sessionFixture(t);
  t.mock.method(crypto, "pbkdf2Sync", () => { throw new Error("Blocking password work"); });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(require("../src/plugins/validator"));
  await app.register(require("../src/routes/auth.routes"));
  await app.ready();

  let loginCompleted = false;
  const login = app.inject({ method: "POST", url: "/auth/login", payload: { email: state.user.email, password } })
    .then((response) => { loginCompleted = true; return response; });
  await nextTurn();
  const session = await app.inject({ method: "GET", url: "/auth/session", headers: { authorization: `Bearer ${token.createToken(state.user)}` } });
  assert.equal(session.statusCode, 200);
  assert.equal(loginCompleted, false);
  const loggedIn = await login;
  assert.equal(loggedIn.statusCode, 200);
  assert.equal("password_hash" in loggedIn.json().user, false);
  assert.equal(state.writes.length, 1);
  assert.match(state.writes[0].sql, /last_login_at/);
});

test("legacy login upgrades the stored hash asynchronously and rejects wrong passwords", async (t) => {
  const state = sessionFixture(t, { hash: legacyHash });
  t.mock.method(crypto, "pbkdf2Sync", () => { throw new Error("Blocking password work"); });
  await assert.rejects(auth.login({ email: state.user.email, password: "wrong-password" }), { statusCode: 401 });
  assert.equal(state.writes.length, 0);
  const result = await auth.login({ email: state.user.email, password });
  assert.equal(result.user.id, state.user.id);
  assert.match(state.hash, /^pbkdf2_sha256\$600000\$/);
  assert.equal(await token.verifyPasswordAsync(password, state.hash), true);
});

test("login rereads account status after password verification before issuing a session", async (t) => {
  const state = sessionFixture(t);
  const pending = auth.login({ email: state.user.email, password });
  await nextTurn();
  state.user.status = "suspended";
  await assert.rejects(pending, { statusCode: 403 });
  assert.equal(state.writes.length, 0);
});

test("a modern password reset during async verification prevents the old credential from creating a session", async (t) => {
  const state = sessionFixture(t);
  const pending = auth.login({ email: state.user.email, password });
  await nextTurn();
  state.hash = replacementHash;
  await assert.rejects(pending, { statusCode: 401 });
  assert.equal(state.hash, replacementHash);
  assert.equal(state.writes.length, 0);
});

test("a reset after legacy verification is not overwritten by the asynchronous hash upgrade", async (t) => {
  let sessionRead;
  const verified = new Promise((resolve) => { sessionRead = resolve; });
  const state = sessionFixture(t, { hash: legacyHash, onSessionRead: () => sessionRead() });
  const pending = auth.login({ email: state.user.email, password });
  await verified;
  state.hash = replacementHash;
  await assert.rejects(pending, { statusCode: 401 });
  assert.equal(state.hash, replacementHash);
  assert.equal(state.writes.length, 0);
});

test("administrator login authenticates once and checks the fresh session role", async (t) => {
  const admin = require("../src/services/adminPortal.service");
  const state = sessionFixture(t);
  let role = "admin";
  const authenticate = t.mock.method(auth, "login", async ({ email, password: suppliedPassword }) => {
    assert.equal(email, state.user.email);
    assert.equal(suppliedPassword, password);
    return { token: "authenticated-token", user: { ...state.user, role } };
  });
  const result = await admin.login({ username: "administrator", password });
  assert.equal(result.user.role, "admin");
  assert.equal(authenticate.mock.callCount(), 1);
  assert.equal(state.writes.length, 1);
  assert.match(state.writes[0].sql, /admin_audit_log/);
  role = "member";
  await assert.rejects(admin.login({ username: "administrator", password }), { statusCode: 403 });
  assert.equal(authenticate.mock.callCount(), 2);
  assert.equal(state.writes.length, 1, "A denied portal login cannot write a successful administrator audit event");
});
