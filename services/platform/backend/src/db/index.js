const { config } = require("../config");
const { createPostgresAdapter } = require("./createPostgresAdapter");
const { createPoolOptions } = require("./poolConfig");

const resolveSsl = () => process.env.PGSSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const sharedPoolOptions = {
  ...createPoolOptions({
    envPrefix: "DB_",
    applicationName: "hellotest-api-main",
    defaultMax: 10
  }),
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
