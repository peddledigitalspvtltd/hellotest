const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../../backend/src/db");
const auth = require("../../backend/services/auth.service");

function verificationFixture(t, overrides = {}) {
  const state = { row: { id: "code", code_hash: "different-hash", attempt_count: 0, expires_at: new Date(Date.now() + 60000).toISOString(), ...overrides }, commits: 0, rollbacks: 0 };
  t.mock.method(db, "transaction", (callback) => async (...args) => {
    const before = structuredClone(state.row);
    try { const result = await callback(...args); state.commits += 1; return result; }
    catch (error) { state.row = before; state.rollbacks += 1; throw error; }
  });
  t.mock.method(db, "prepare", (sql) => ({
    get: async (email, purpose) => {
      assert.match(sql, /FROM auth_verification_codes/);
      assert.match(sql, /FOR UPDATE/);
      assert.equal(email, "member@example.test");
      assert.ok(["signup", "password_reset"].includes(purpose));
      return state.row && { ...state.row };
    },
    run: async (...params) => {
      if (/SET attempt_count/.test(sql)) state.row.attempt_count = params[0];
      else if (/DELETE FROM auth_verification_codes/.test(sql)) state.row = null;
      else assert.fail(`Unexpected verification mutation: ${sql}`);
      return { changes: 1 };
    }
  }));
  return state;
}

for (const [name, method] of [["signup", "verifySignupCode"], ["password reset", "verifyPasswordResetCode"]]) {
  test(`${name} commits failed attempts before rejecting and enforces the five-attempt limit`, async (t) => {
    const state = verificationFixture(t);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await assert.rejects(auth[method]({ email: "member@example.test", code: "000000" }), { statusCode: attempt === 5 ? 429 : 401 });
      assert.equal(state.row.attempt_count, attempt);
      assert.equal(state.commits, attempt);
      assert.equal(state.rollbacks, 0);
    }
    await assert.rejects(auth[method]({ email: "member@example.test", code: "000000" }), { statusCode: 429 });
    assert.equal(state.row, null);
  });

  test(`${name} durably removes expired codes while preserving an authentication error`, async (t) => {
    const state = verificationFixture(t, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await assert.rejects(auth[method]({ email: "member@example.test", code: "000000" }), { statusCode: 401 });
    assert.equal(state.row, null);
    assert.equal(state.commits, 1);
    assert.equal(state.rollbacks, 0);
  });
}
