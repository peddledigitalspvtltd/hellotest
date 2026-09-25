const { config } = require("../config");
const { createPostgresAdapter } = require("../db/createPostgresAdapter");
const { createPoolOptions } = require("../db/poolConfig");

const resolveSsl = () => process.env.PGSSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const sharedPoolOptions = {
  ...createPoolOptions({
    envPrefix: "OBS_DB_",
    applicationName: "hellotest-api-execution",
    defaultMax: 5
  }),
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
