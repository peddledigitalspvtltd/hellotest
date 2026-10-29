const db = require('@hellotest/platform/backend/src/db');
const { assertRetrievalActive, retrievalTimeout } = require('@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming');

const timeoutError = () => Object.assign(new Error('The scoped evidence SQL read exceeded its time budget.'), {
  code: 'SCOPED_EVIDENCE_READ_TIMEOUT', statusCode: 504
});
function milliseconds(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|min|h|d)?$/.exec(String(value || '0'));
  return match ? Number(match[1]) * ({ ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }[match[2]] || 1) : 0;
}

/**
 * Scope/ACL predicates can exceed PostgreSQL's JIT cost threshold even when
 * their selected record set is tiny. Compile-free execution is local to one
 * SQL read, with a server deadline, never to embedding/model/network work.
 * Savepoints preserve an enclosing caller's writes and transaction mode.
 */
async function all(sql, params = [], { signal, timeoutMs = 3500 } = {}) {
  assertRetrievalActive(signal);
  const deadline = Date.now() + retrievalTimeout(timeoutMs, 3500);
  if (deadline <= Date.now()) throw timeoutError();
  return db.serializedTransaction(async () => {
    assertRetrievalActive(signal);
    if (Date.now() >= deadline) throw timeoutError();
    const previous = await db.prepare(`SELECT current_setting('jit') AS jit,
      current_setting('statement_timeout') AS statement_timeout,
      current_setting('lock_timeout') AS lock_timeout`).get();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    const priorStatementMs = milliseconds(previous.statement_timeout);
    const priorLockMs = milliseconds(previous.lock_timeout);
    const statementMs = Math.max(1, Math.floor(Math.min(remaining, priorStatementMs || Infinity)));
    const lockMs = Math.max(1, Math.floor(Math.min(statementMs, 500, priorLockMs || Infinity)));
    await db.query(`SELECT set_config('jit', 'off', true),
      set_config('statement_timeout', ?, true), set_config('lock_timeout', ?, true)`, [`${statementMs}ms`, `${lockMs}ms`]);
    assertRetrievalActive(signal);
    const rows = await db.prepare(sql).all(...params);
    assertRetrievalActive(signal);
    // RELEASE SAVEPOINT preserves SET LOCAL values. Restore on success before
    // returning to a caller's transaction; a failed read rolls them back instead.
    await db.query(`SELECT set_config('jit', ?, true),
      set_config('statement_timeout', ?, true), set_config('lock_timeout', ?, true)`,
    [previous.jit, previous.statement_timeout, previous.lock_timeout]);
    return rows;
  })();
}

module.exports = { all };
