const { config } = require("../config");
const { createPostgresAdapter } = require("../db/createPostgresAdapter");

const resolveSsl = () => process.env.PGSSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const sharedPoolOptions = {
  allowExitOnIdle: process.env.NODE_ENV === "test",
  connectionTimeoutMillis: Number(process.env.OBS_DB_CONNECT_TIMEOUT_MS || 5_000),
  idleTimeoutMillis: Number(process.env.OBS_DB_IDLE_TIMEOUT_MS || 30_000),
  keepAlive: true,
  max: Number(process.env.OBS_DB_POOL_MAX || 10),
  maxUses: Number(process.env.OBS_DB_CONNECTION_MAX_USES || 7_500),
  ssl: resolveSsl()
};

const poolConfig = config.obsPostgresUrl
  ? { ...sharedPoolOptions, connectionString: config.obsPostgresUrl }
  : {
      ...sharedPoolOptions,
      host: config.obsPostgres.host,
      port: config.obsPostgres.port,
      user: config.obsPostgres.user,
      password: config.obsPostgres.password,
      database: config.obsPostgres.database
    };

module.exports = createPostgresAdapter({
  poolConfig,
  statementNamespace: "hellotest_obs"
});
