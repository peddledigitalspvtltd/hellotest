const { AsyncLocalStorage } = require("async_hooks");
const { Pool } = require("pg");
const { config } = require("../config");

const transactionContext = new AsyncLocalStorage();

const resolveSsl = () => {
  if (process.env.PGSSL === "true") {
    return { rejectUnauthorized: false };
  }

  return false;
};

const resolvePoolConfig = () => {
  if (config.postgresUrl) {
    return {
      connectionString: config.postgresUrl,
      ssl: resolveSsl(),
      max: Number(process.env.DB_POOL_MAX || 10)
    };
  }

  return {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
    ssl: resolveSsl(),
    max: Number(process.env.DB_POOL_MAX || 10)
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
  let output = "";
  let quote = null;
  let dollarTag = null;

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    const next = sql[cursor + 1];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, cursor)) {
        output += dollarTag;
        cursor += dollarTag.length - 1;
        dollarTag = null;
      } else {
        output += char;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (char === quote) {
        if (quote === "'" && next === "'") {
          output += next;
          cursor += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    const dollarMatch = sql.slice(cursor).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      output += dollarTag;
      cursor += dollarTag.length - 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }

    if (char === "-" && next === "-") {
      const newlineIndex = sql.indexOf("\n", cursor + 2);
      const endIndex = newlineIndex === -1 ? sql.length : newlineIndex;
      output += sql.slice(cursor, endIndex);
      cursor = endIndex - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const commentEndIndex = sql.indexOf("*/", cursor + 2);
      const endIndex = commentEndIndex === -1 ? sql.length : commentEndIndex + 2;
      output += sql.slice(cursor, endIndex);
      cursor = endIndex - 1;
      continue;
    }

    if (char === "?") {
      if (next === "|" || next === "&") {
        output += char;
        continue;
      }

      const previousNonSpace = output.match(/\S(?=\s*$)/)?.[0] || "";
      const nextNonSpace = sql.slice(cursor + 1).match(/\S/)?.[0] || "";
      const isJsonbExistsOperator = /[\w)"\]]/.test(previousNonSpace) && nextNonSpace === "'";
      output += isJsonbExistsOperator ? char : `$${++index}`;
      continue;
    }

    output += char;
  }

  return output;
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
