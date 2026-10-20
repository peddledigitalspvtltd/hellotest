const { AsyncLocalStorage } = require("async_hooks");
const { createHash } = require("crypto");
const { Pool } = require("pg");

const MAX_PLACEHOLDER_CACHE_SIZE = 2_000;

const attachCleanupError = (originalError, property, cleanupError) => {
  if (!originalError || (typeof originalError !== "object" && typeof originalError !== "function")) {
    return;
  }

  try {
    Object.defineProperty(originalError, property, {
      configurable: true,
      enumerable: false,
      value: cleanupError
    });
  } catch {
    // The original error is deliberately preserved even when it is immutable.
  }
};

const defaultPoolErrorHandler = (error) => {
  const code = typeof error?.code === "string" ? error.code : "PG_POOL_ERROR";
  const message = String(error?.message || "PostgreSQL idle client failed")
    .replace(/:\/\/[^/@\s]+@/g, "://[redacted]@")
    .slice(0, 500);
  process.stderr.write(`[database] ${code}: ${message}\n`);
};

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
  const output = [];
  let previousNonSpace = "";
  let quote = null;
  let dollarTag = null;
  const dollarDelimiter = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
  const emit = (text) => {
    output.push(text);
    for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
      if (!/\s/.test(text[cursor])) {
        previousNonSpace = text[cursor];
        break;
      }
    }
  };

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    const next = sql[cursor + 1];

    if (dollarTag) {
      if (char === "$" && sql.startsWith(dollarTag, cursor)) {
        emit(dollarTag);
        cursor += dollarTag.length - 1;
        dollarTag = null;
      } else {
        emit(char);
      }
      continue;
    }

    if (quote) {
      emit(char);
      if (char === quote) {
        if (quote === "'" && next === "'") {
          emit(next);
          cursor += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    dollarDelimiter.lastIndex = cursor;
    const dollarMatch = char === "$" ? dollarDelimiter.exec(sql) : null;
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      emit(dollarTag);
      cursor += dollarTag.length - 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      emit(char);
      continue;
    }

    if (char === "-" && next === "-") {
      const newlineIndex = sql.indexOf("\n", cursor + 2);
      const endIndex = newlineIndex === -1 ? sql.length : newlineIndex;
      emit(sql.slice(cursor, endIndex));
      cursor = endIndex - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const commentEndIndex = sql.indexOf("*/", cursor + 2);
      const endIndex = commentEndIndex === -1 ? sql.length : commentEndIndex + 2;
      emit(sql.slice(cursor, endIndex));
      cursor = endIndex - 1;
      continue;
    }

    if (char === "?") {
      if (next === "|" || next === "&") {
        emit(char);
        continue;
      }

      // Never rescan the emitted prefix: large IN lists otherwise take quadratic
      // time and block every request on the API's JavaScript thread.
      let nextCursor = cursor + 1;
      while (nextCursor < sql.length && /\s/.test(sql[nextCursor])) nextCursor += 1;
      const nextNonSpace = sql[nextCursor] || "";
      const isJsonbExistsOperator = /[\w)"\]]/.test(previousNonSpace) && nextNonSpace === "'";
      emit(isJsonbExistsOperator ? char : `$${++index}`);
      continue;
    }

    emit(char);
  }

  return output.join("");
};

const createStatementName = (sql, namespace) => {
  const digest = createHash("sha256").update(sql).digest("hex").slice(0, 24);
  return `${namespace}_${digest}`.slice(0, 63);
};

function createPostgresAdapter({
  poolConfig,
  statementNamespace = "hellotest",
  PoolClass = Pool,
  onPoolError = defaultPoolErrorHandler
}) {
  const transactionContext = new AsyncLocalStorage();
  const placeholderCache = new Map();
  const pool = new PoolClass(poolConfig);
  const poolState = {
    backgroundErrorCount: 0,
    lastBackgroundErrorAt: null,
    lastBackgroundErrorCode: null
  };
  let closePromise = null;

  const reportConnectionError = (error, client) => {
    poolState.backgroundErrorCount += 1;
    poolState.lastBackgroundErrorAt = new Date().toISOString();
    poolState.lastBackgroundErrorCode = typeof error?.code === "string" ? error.code : null;
    try {
      onPoolError(error, client);
    } catch (handlerError) {
      defaultPoolErrorHandler(handlerError);
    }
  };
  pool.on?.("error", reportConnectionError);

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

  // Timers and durable workers inherit AsyncLocalStorage even after their
  // creator has committed. Only the callback's live transaction owns a client.
  const getActiveTransaction = () => {
    const store = transactionContext.getStore();
    return store?.active ? store : null;
  };
  const getExecutor = () => getActiveTransaction()?.client || pool;

  const execute = (text, params = [], name) => {
    const connectionError = getActiveTransaction()?.connectionError;
    if (connectionError) return Promise.reject(connectionError);
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

  const runNestedTransaction = async (store, callback, args) => {
    store.savepointCounter += 1;
    const savepoint = `hellotest_sp_${store.savepointCounter}`;
    await store.client.query(`SAVEPOINT ${savepoint}`);

    try {
      const result = await callback(...args);
      await store.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        await store.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await store.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (savepointError) {
        attachCleanupError(error, "savepointRollbackError", savepointError);
      }
      throw error;
    }
  };

  const transaction = (callback) => async (...args) => {
    const activeTransaction = getActiveTransaction();
    if (activeTransaction?.client) {
      return runNestedTransaction(activeTransaction, callback, args);
    }

    const client = await pool.connect();
    let transactionStarted = false;
    let commitAttempted = false;
    let destroyClient = false;
    const store = { client, savepointCounter: 0, connectionError: null, active: true };
    // pg forwards idle connection errors to the pool, but a checked-out client
    // emits its own error while application code awaits work between queries.
    const onClientError = error => {
      store.connectionError ||= error;
      destroyClient = true;
      reportConnectionError(error, client);
    };
    client.on?.("error", onClientError);
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const result = await transactionContext.run(
        store,
        () => callback(...args)
      );
      store.active = false;
      if (store.connectionError) throw store.connectionError;
      commitAttempted = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      store.active = false;
      if (commitAttempted) {
        attachCleanupError(error, "transactionOutcomeUnknown", true);
      }
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          destroyClient = true;
          attachCleanupError(error, "rollbackError", rollbackError);
        }
      } else {
        destroyClient = true;
      }
      throw error;
    } finally {
      store.active = false;
      try { client.release(destroyClient); }
      finally { client.removeListener?.("error", onClientError); }
    }
  };

  const getPoolStats = () => {
    const max = Number(pool.options?.max || poolConfig?.max || 10);
    const total = Number(pool.totalCount || 0);
    const idle = Number(pool.idleCount || 0);
    const waiting = Number(pool.waitingCount || 0);
    return {
      total,
      idle,
      active: Math.max(0, total - idle),
      waiting,
      max,
      utilization: max > 0 ? Math.min(1, Math.max(0, (total - idle) / max)) : 0,
      saturated: waiting > 0 || (max > 0 && total >= max && idle === 0),
      background_error_count: poolState.backgroundErrorCount,
      last_background_error_at: poolState.lastBackgroundErrorAt,
      last_background_error_code: poolState.lastBackgroundErrorCode
    };
  };

  const close = () => {
    if (!closePromise) {
      closePromise = Promise.resolve().then(() => pool.end());
    }
    return closePromise;
  };

  return { pool, query, prepare, transaction, getPoolStats, close };
}

module.exports = {
  createPostgresAdapter,
  createStatementName,
  defaultPoolErrorHandler,
  serializeParam,
  toPgPlaceholders
};
