const { AsyncLocalStorage } = require("async_hooks");
const { Pool } = require("pg");

const transactionContext = new AsyncLocalStorage();

const resolveSsl = () => {
  if (process.env.PGSSL === "true") {
    return { rejectUnauthorized: false };
  }

  return false;
};

const resolvePoolConfig = () => {
  if (process.env.OBS_DATABASE_URL) {
    return {
      connectionString: process.env.OBS_DATABASE_URL,
      ssl: resolveSsl(),
      max: Number(process.env.OBS_DB_POOL_MAX || 10)
    };
  }

  return {
    host: process.env.OBS_PGHOST || process.env.OBS_POSTGRES_HOST || "localhost",
    port: Number(process.env.OBS_PGPORT || process.env.OBS_POSTGRES_PORT || 5432),
    user: process.env.OBS_PGUSER || process.env.OBS_POSTGRES_USER || "qaira",
    password: process.env.OBS_PGPASSWORD || process.env.OBS_POSTGRES_PASSWORD || "qaira",
    database: process.env.OBS_PGDATABASE || process.env.OBS_POSTGRES_DB || "qaira_obs",
    ssl: resolveSsl(),
    max: Number(process.env.OBS_DB_POOL_MAX || 10)
  };
};

const pool = new Pool(resolvePoolConfig());

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const serializeParam = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value);
  }

  return value;
};

const toPgPlaceholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

const getExecutor = () => {
  return transactionContext.getStore()?.client || pool;
};

const query = async (sql, params = []) => {
  const executor = getExecutor();
  return executor.query(toPgPlaceholders(sql), params.map(serializeParam));
};

const prepare = (sql) => {
  return {
    async get(...params) {
      const result = await query(sql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await query(sql, params);
      return result.rows;
    },
    async run(...params) {
      const result = await query(sql, params);
      return {
        changes: result.rowCount
      };
    }
  };
};

const transaction = (callback) => {
  return async (...args) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await transactionContext.run({ client }, async () => {
        return callback(...args);
      });

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
};

const close = async () => {
  await pool.end();
};

module.exports = {
  pool,
  query,
  prepare,
  transaction,
  close
};
