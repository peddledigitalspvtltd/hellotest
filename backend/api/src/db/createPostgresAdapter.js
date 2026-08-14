const { AsyncLocalStorage } = require("async_hooks");
const { createHash } = require("crypto");
const { Pool } = require("pg");

const MAX_PLACEHOLDER_CACHE_SIZE = 2_000;

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

const createStatementName = (sql, namespace) => {
  const digest = createHash("sha256").update(sql).digest("hex").slice(0, 24);
  return `${namespace}_${digest}`.slice(0, 63);
};

function createPostgresAdapter({ poolConfig, statementNamespace = "qaira" }) {
  const transactionContext = new AsyncLocalStorage();
  const placeholderCache = new Map();
  const pool = new Pool(poolConfig);

  const compileSql = (sql) => {
    const cached = placeholderCache.get(sql);
    if (cached) {
      return cached;
    }

    const compiled = toPgPlaceholders(sql);
    if (placeholderCache.size >= MAX_PLACEHOLDER_CACHE_SIZE) {
      const oldestKey = placeholderCache.keys().next().value;
      if (oldestKey !== undefined) {
        placeholderCache.delete(oldestKey);
      }
    }
    placeholderCache.set(sql, compiled);
    return compiled;
  };

  const getExecutor = () => transactionContext.getStore()?.client || pool;

  const execute = (text, params = [], name) => {
    const values = params.map(serializeParam);
    return name
      ? getExecutor().query({ name, text, values })
      : getExecutor().query(text, values);
  };

  const query = (sql, params = []) => execute(compileSql(sql), params);

  const prepare = (sql) => {
    const text = compileSql(sql);
    const name = createStatementName(text, statementNamespace);
    const executePrepared = (params) => execute(text, params, name);

    return {
      async get(...params) {
        const result = await executePrepared(params);
        return result.rows[0];
      },
      async all(...params) {
        const result = await executePrepared(params);
        return result.rows;
      },
      async run(...params) {
        const result = await executePrepared(params);
        return { changes: result.rowCount };
      }
    };
  };

  const transaction = (callback) => async (...args) => {
    if (transactionContext.getStore()?.client) {
      return callback(...args);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await transactionContext.run({ client }, () => callback(...args));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const close = () => pool.end();

  return { pool, query, prepare, transaction, close };
}

module.exports = {
  createPostgresAdapter,
  createStatementName,
  serializeParam,
  toPgPlaceholders
};
