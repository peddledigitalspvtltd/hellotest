const defaultDb = require('../src/db');
const { policy } = require('./authPolicy.service');
const MINUTE = 60_000;
const timestamp = value => value ? new Date(value).getTime() : 0;

function lockedError(row, now = Date.now()) {
  return Object.assign(new Error('Too many sign-in attempts. Wait before trying again, reset your password, or contact a workspace administrator.'), {
    statusCode: 429, code: 'AUTH_LOGIN_LOCKED',
    retryAfterSeconds: Math.max(1, Math.ceil((timestamp(row.locked_until) - now) / 1000))
  });
}

function createLoginProtection(db = defaultDb, now = Date.now) {
  const select = email => db.prepare('SELECT * FROM auth_login_protection WHERE email = ?').get(email);
  async function ensureLockedRow(email, userId = null) {
    await db.prepare(`INSERT INTO auth_login_protection(email, user_id) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`).run(email, userId);
    return db.prepare('SELECT * FROM auth_login_protection WHERE email = ? FOR UPDATE').get(email);
  }
  async function assertAllowed(email) {
    const row = await select(email);
    if (timestamp(row?.locked_until) > now()) throw lockedError(row, now());
  }
  const recordFailure = db.transaction(async (email, userId = null) => {
    const row = await ensureLockedRow(email, userId);
    const instant = now();
    if (timestamp(row.locked_until) > instant) return row;
    const expired = row.locked_until || timestamp(row.last_failure_at) < instant - policy.loginFailureWindowMinutes * MINUTE;
    const failures = expired ? 1 : row.failure_count + 1;
    const lockedUntil = failures >= policy.loginFailureLimit ? new Date(instant + policy.loginLockMinutes * MINUTE).toISOString() : null;
    await db.prepare(`UPDATE auth_login_protection SET user_id = COALESCE(?, user_id), failure_count = ?, last_failure_at = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`)
      .run(userId, failures, new Date(instant).toISOString(), lockedUntil, email);
    // Unknown addresses get the same protection without retaining them forever.
    await db.prepare(`DELETE FROM auth_login_protection WHERE user_id IS NULL AND updated_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`).run();
    return { ...row, failure_count: failures, locked_until: lockedUntil };
  });
  async function assertAndClear(email, userId) {
    const row = await ensureLockedRow(email, userId);
    if (timestamp(row.locked_until) > now()) throw lockedError(row, now());
    await clear(email);
  }
  async function clear(email) {
    await db.prepare(`UPDATE auth_login_protection SET failure_count = 0, locked_until = NULL, last_failure_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE email = ?`).run(email);
  }
  const claimAccountNotice = db.transaction(async (email, userId) => {
    const row = await ensureLockedRow(email, userId);
    if (timestamp(row.last_notice_at) > now() - policy.loginFailureWindowMinutes * MINUTE) return null;
    const claimedAt = new Date(now()).toISOString();
    await db.prepare(`UPDATE auth_login_protection SET last_notice_at = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`).run(claimedAt, email);
    return claimedAt;
  });
  async function releaseAccountNotice(email, claimedAt) {
    await db.prepare('UPDATE auth_login_protection SET last_notice_at = NULL WHERE email = ? AND last_notice_at = ?').run(email, claimedAt);
  }
  return { assertAllowed, recordFailure, assertAndClear, clear, claimAccountNotice, releaseAccountNotice };
}
module.exports = { ...createLoginProtection(), createLoginProtection, lockedError };
