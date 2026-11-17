module.exports = [
  `CREATE TABLE IF NOT EXISTS auth_login_protection (
    email TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_failure_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    last_notice_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_login_protection_user ON auth_login_protection(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_login_protection_expiry ON auth_login_protection(updated_at) WHERE user_id IS NULL`
];
