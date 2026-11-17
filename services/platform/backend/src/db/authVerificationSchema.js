module.exports = [
  `
    CREATE TABLE IF NOT EXISTS auth_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS purpose TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE auth_verification_codes DROP CONSTRAINT IF EXISTS auth_verification_codes_purpose_check`,
  `ALTER TABLE auth_verification_codes ADD CONSTRAINT auth_verification_codes_purpose_check CHECK (purpose IN ('signup', 'password_reset'))`,
  `CREATE INDEX IF NOT EXISTS idx_auth_verification_codes_lookup ON auth_verification_codes (email, purpose, created_at DESC)`,
];
