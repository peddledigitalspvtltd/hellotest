const { config } = require("../config");
const { createPostgresAdapter } = require("./createPostgresAdapter");

const resolveSsl = () => process.env.PGSSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const sharedPoolOptions = {
  allowExitOnIdle: process.env.NODE_ENV === "test",
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5_000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  keepAlive: true,
  max: Number(process.env.DB_POOL_MAX || 20),
  maxUses: Number(process.env.DB_CONNECTION_MAX_USES || 7_500),
  ssl: resolveSsl()
};

const poolConfig = config.postgresUrl
  ? { ...sharedPoolOptions, connectionString: config.postgresUrl }
  : {
      ...sharedPoolOptions,
      host: config.postgres.host,
      port: config.postgres.port,
      user: config.postgres.user,
      password: config.postgres.password,
      database: config.postgres.database
    };

module.exports = createPostgresAdapter({
  poolConfig,
  statementNamespace: "hellotest_main"
});
