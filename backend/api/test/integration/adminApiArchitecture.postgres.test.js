const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const test = require("node:test");

test("admin architecture changes preserve real PostgreSQL transactions, ownership and bounded result transfer", {
  skip: process.env.ADMIN_ARCHITECTURE_POSTGRES !== "1", timeout: 60000
}, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_admin_arch_[a-z0-9_]+$/);
  process.env.VERIFICATION_CODE_SECRET = "admin-architecture-disposable-verification-secret";
  const db = require("../../src/db");
  const auth = require("../../src/services/auth.service");
  const notices = require("../../src/services/notification.service");
  const roles = require("../../src/services/role.service");
  const users = require("../../src/services/user.service");
  const token = require("../../src/utils/token");
  try {
    await db.query(`
      CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, password_hash TEXT, email_verified BOOLEAN DEFAULT FALSE, auth_provider TEXT DEFAULT 'local', must_change_password BOOLEAN DEFAULT TRUE, is_workspace_admin BOOLEAN DEFAULT FALSE, default_role_id TEXT, avatar_data_url TEXT);
      CREATE TABLE auth_verification_codes(id TEXT PRIMARY KEY, email TEXT, purpose TEXT, code_hash TEXT, payload JSONB, attempt_count INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE password_reset_tokens(id TEXT PRIMARY KEY, user_id TEXT);
      CREATE TABLE notifications(id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, message TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX notification_scope ON notifications(user_id, status, created_at DESC);
      CREATE TABLE roles(id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE permissions(id TEXT PRIMARY KEY, code TEXT, description TEXT);
      CREATE TABLE role_permissions(role_id TEXT REFERENCES roles(id), permission_id TEXT REFERENCES permissions(id), PRIMARY KEY(role_id, permission_id));
    `);
    await db.prepare("INSERT INTO users(id,email,password_hash,name) VALUES(?,?,?,?),(?,?,?,?)").run("owner", "owner@example.test", "old", "Owner", "foreign", "foreign@example.test", "other", "Foreign");
    const codeHash = crypto.createHmac("sha256", process.env.VERIFICATION_CODE_SECRET).update("123456").digest("hex");
    const seedCode = async (id, { expires = new Date(Date.now() + 60000).toISOString(), payload = { password_hash: "replacement" } } = {}) => db.prepare(`INSERT INTO auth_verification_codes(id,email,purpose,code_hash,payload,expires_at) VALUES(?,?,'password_reset',?,?,?)`).run(id, "owner@example.test", codeHash, payload, expires);

    await seedCode("attempts");
    await assert.rejects(auth.verifyPasswordResetCode({ email: "owner@example.test", code: "000000" }), { statusCode: 401 });
    assert.equal((await db.prepare("SELECT attempt_count FROM auth_verification_codes WHERE id = ?").get("attempts")).attempt_count, 1, "Rejected requests commit attempt accounting");
    const failures = await Promise.allSettled(Array.from({ length: 4 }, () => auth.verifyPasswordResetCode({ email: "owner@example.test", code: "000000" })));
    assert.deepEqual(failures.map((item) => item.reason.statusCode).sort(), [401, 401, 401, 429]);
    assert.equal((await db.prepare("SELECT attempt_count FROM auth_verification_codes WHERE id = ?").get("attempts")).attempt_count, 5);
    await assert.rejects(auth.verifyPasswordResetCode({ email: "owner@example.test", code: "123456" }), { statusCode: 429 });
    assert.equal(await db.prepare("SELECT id FROM auth_verification_codes WHERE id = ?").get("attempts"), undefined);
    assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id = 'owner'").get()).password_hash, "old");

    await seedCode("expired", { expires: new Date(Date.now() - 1000).toISOString() });
    await assert.rejects(auth.verifyPasswordResetCode({ email: "owner@example.test", code: "123456" }), { statusCode: 401 });
    assert.equal(await db.prepare("SELECT id FROM auth_verification_codes WHERE id = 'expired'").get(), undefined);

    await seedCode("one-use");
    const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => auth.verifyPasswordResetCode({ email: "owner@example.test", code: "123456" })));
    assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1, "Only one request consumes a valid code");
    assert.equal(concurrent.filter((item) => item.status === "rejected" && item.reason.statusCode === 400).length, 7);
    assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id = 'owner'").get()).password_hash, "replacement");

    await seedCode("incomplete", { payload: {} });
    await assert.rejects(auth.verifyPasswordResetCode({ email: "owner@example.test", code: "123456" }), { statusCode: 400 });
    assert.equal((await db.prepare("SELECT consumed_at FROM auth_verification_codes WHERE id = 'incomplete'").get()).consumed_at, null, "Failed account mutation rolls consumption back");

    await db.prepare("INSERT INTO roles(id,name) VALUES('reviewer','Reviewer')").run();
    await db.prepare("INSERT INTO permissions(id,code,description) SELECT 'p-' || n, 'feature-' || n || '.view', 'Permission' FROM generate_series(1,120) n").run();
    const permissionCodes = (await db.prepare("SELECT code FROM permissions ORDER BY code").all()).map((item) => item.code);
    await roles.replaceRolePermissions("reviewer", permissionCodes);
    assert.equal((await db.prepare("SELECT COUNT(*)::INTEGER AS total FROM role_permissions").get()).total, 120);
    await roles.replaceRolePermissions("reviewer", []);
    assert.equal((await db.prepare("SELECT COUNT(*)::INTEGER AS total FROM role_permissions").get()).total, 0);

    await db.prepare("UPDATE users SET is_workspace_admin = TRUE, password_hash = 'concurrent-reset' WHERE id = 'owner'").run();
    await users.updateUser("owner", { name: "Updated owner" });
    const preserved = await db.prepare("SELECT name, password_hash, is_workspace_admin FROM users WHERE id = 'owner'").get();
    assert.deepEqual(preserved, { name: "Updated owner", password_hash: "concurrent-reset", is_workspace_admin: true });

    const originalHash = await token.hashPasswordAsync("Current password value");
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = 'owner'").run(originalHash);
    const originalQuery = db.pool.query;
    const racedQuery = t.mock.method(db.pool, "query", async function (...args) {
      const result = await originalQuery.apply(this, args);
      if (/SELECT id, password_hash, auth_provider/.test(String(args[0]?.text || args[0]))) {
        await originalQuery.call(this, "UPDATE users SET password_hash = 'newer-reset' WHERE id = 'owner'");
      }
      return result;
    });
    await assert.rejects(users.changeOwnPassword({ id: "owner", current_password: "Current password value", new_password: "Requested replacement value" }), { statusCode: 409 });
    racedQuery.mock.restore();
    assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id = 'owner'").get()).password_hash, "newer-reset");

    await db.prepare(`INSERT INTO notifications(id,user_id,type,title,message,status,created_at)
      SELECT 'notice-' || LPAD(n::TEXT,6,'0'), 'owner', 'execution.failed', 'Notice ' || n, repeat('evidence ',80),
        CASE WHEN n % 2 = 0 THEN 'read' ELSE 'unread' END, '2026-09-01'::timestamptz
      FROM generate_series(1,30000) n`).run();
    await db.prepare("INSERT INTO notifications(id,user_id,type,title,message,status) VALUES('foreign-notice','foreign','execution.failed','Foreign','Private','unread')").run();
    const oldStart = performance.now();
    const all = await notices.getNotifications({ user_id: "owner" });
    const unboundedMs = performance.now() - oldStart;
    const newStart = performance.now();
    const page = await notices.getNotificationPage({ user_id: "owner", page_size: 50 });
    const boundedMs = performance.now() - newStart;
    assert.equal(all.length, 30000);
    assert.equal(page.items.length, 50);
    assert.equal(page.total, 30000);
    assert.equal(page.unread_count, 15000);
    assert.equal(page.items[0].id, "notice-030000");
    const next = await notices.getNotificationPage({ user_id: "owner", page_size: 50, cursor: page.next_cursor });
    assert.equal(new Set([...page.items, ...next.items].map((item) => item.id)).size, 100);
    assert.equal((await notices.getNotificationPage({ user_id: "owner", status: "read" })).unread_count, 0);
    await assert.rejects(notices.markRead("foreign-notice", "owner"), { statusCode: 404 });
    assert.equal((await db.prepare("SELECT status FROM notifications WHERE id = 'foreign-notice'").get()).status, "unread");
    t.diagnostic(JSON.stringify({ notification_rows_before: all.length, notification_rows_after: page.items.length, unbounded_ms: +unboundedMs.toFixed(2), bounded_ms: +boundedMs.toFixed(2), serialized_bytes_before: Buffer.byteLength(JSON.stringify(all)), serialized_bytes_after: Buffer.byteLength(JSON.stringify(page)) }));
  } finally {
    await db.close();
  }
});
