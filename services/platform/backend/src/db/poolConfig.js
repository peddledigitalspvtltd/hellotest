const DEFAULTS = Object.freeze({
  connectTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
  maxConnections: 10,
  maxConnectionUses: 7_500,
  maxConnectionLifetimeSeconds: 900,
  statementTimeoutMs: 120_000,
  queryTimeoutMs: 125_000,
  lockTimeoutMs: 10_000,
  idleTransactionTimeoutMs: 60_000
});

const boundedInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const envValue = (prefix, name) => process.env[`${prefix}${name}`];

const createPoolOptions = ({
  envPrefix = "DB_",
  applicationName,
  defaultMax = DEFAULTS.maxConnections
}) => {
  const statementTimeoutMs = boundedInteger(
    envValue(envPrefix, "STATEMENT_TIMEOUT_MS"),
    DEFAULTS.statementTimeoutMs,
    { min: 1_000, max: 30 * 60_000 }
  );

  return {
    allowExitOnIdle: process.env.NODE_ENV === "test",
    application_name: applicationName,
    connectionTimeoutMillis: boundedInteger(
      envValue(envPrefix, "CONNECT_TIMEOUT_MS"),
      DEFAULTS.connectTimeoutMs,
      { min: 250, max: 120_000 }
    ),
    idleTimeoutMillis: boundedInteger(
      envValue(envPrefix, "IDLE_TIMEOUT_MS"),
      DEFAULTS.idleTimeoutMs,
      { min: 1_000, max: 30 * 60_000 }
    ),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: boundedInteger(
      envValue(envPrefix, "POOL_MAX"),
      defaultMax,
      { min: 1, max: 100 }
    ),
    min: boundedInteger(
      envValue(envPrefix, "POOL_MIN"),
      0,
      { min: 0, max: 20 }
    ),
    maxUses: boundedInteger(
      envValue(envPrefix, "CONNECTION_MAX_USES"),
      DEFAULTS.maxConnectionUses,
      { min: 100, max: 1_000_000 }
    ),
    maxLifetimeSeconds: boundedInteger(
      envValue(envPrefix, "CONNECTION_MAX_LIFETIME_SECONDS"),
      DEFAULTS.maxConnectionLifetimeSeconds,
      { min: 60, max: 24 * 60 * 60 }
    ),
    statement_timeout: statementTimeoutMs,
    query_timeout: boundedInteger(
      envValue(envPrefix, "QUERY_TIMEOUT_MS"),
      Math.max(DEFAULTS.queryTimeoutMs, statementTimeoutMs + 5_000),
      { min: statementTimeoutMs, max: 31 * 60_000 }
    ),
    lock_timeout: boundedInteger(
      envValue(envPrefix, "LOCK_TIMEOUT_MS"),
      DEFAULTS.lockTimeoutMs,
      { min: 250, max: 5 * 60_000 }
    ),
    idle_in_transaction_session_timeout: boundedInteger(
      envValue(envPrefix, "IDLE_TRANSACTION_TIMEOUT_MS"),
      DEFAULTS.idleTransactionTimeoutMs,
      { min: 1_000, max: 30 * 60_000 }
    )
  };
};

module.exports = {
  DEFAULTS,
  boundedInteger,
  createPoolOptions
};
