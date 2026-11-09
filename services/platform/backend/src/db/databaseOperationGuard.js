const { AsyncLocalStorage } = require("async_hooks");

const databaseOperationContext = new AsyncLocalStorage();

const guardError = (code, message) => Object.assign(new Error(message), {
  name: "AbortError",
  code,
  nonRetryable: true
});

const getDatabaseOperationGuard = () => databaseOperationContext.getStore();

const assertDatabaseOperationActive = (guard = getDatabaseOperationGuard()) => {
  for (let scope = guard; scope; scope = scope.parent) {
    if (scope.signal?.aborted) {
      throw scope.signal.reason || guardError("DATABASE_OPERATION_ABORTED", "The database operation was cancelled.");
    }
    if (Number.isFinite(scope.deadlineMs) && Date.now() >= scope.deadlineMs) {
      throw guardError("DATABASE_OPERATION_DEADLINE", "The database operation deadline was reached.");
    }
  }
};

// deadlineMs is an absolute Unix millisecond deadline. Async descendants retain
// this authority even when their caller has already returned from an abort race.
const runWithDatabaseOperationGuard = ({ signal, deadlineMs } = {}, callback) => {
  const guard = Object.freeze({ signal, deadlineMs, parent: getDatabaseOperationGuard() });
  return databaseOperationContext.run(guard, () => {
    assertDatabaseOperationActive(guard);
    return callback();
  });
};

const runWithoutDatabaseOperationGuard = callback => databaseOperationContext.run(undefined, callback);

// A checked-out client must also stop while its callback is awaiting non-SQL
// work. The adapter removes these listeners when that client scope finishes.
const onDatabaseOperationCancelled = (guard, callback) => {
  const cleanups = [];
  let notified = false;
  const notify = () => {
    if (notified) return;
    try { assertDatabaseOperationActive(guard); }
    catch (error) {
      notified = true;
      callback(error);
    }
  };
  for (let scope = guard; scope; scope = scope.parent) {
    if (scope.signal) {
      scope.signal.addEventListener("abort", notify, { once: true });
      cleanups.push(() => scope.signal.removeEventListener("abort", notify));
    }
    if (Number.isFinite(scope.deadlineMs)) {
      const timer = setTimeout(notify, Math.max(0, scope.deadlineMs - Date.now()));
      timer.unref?.();
      cleanups.push(() => clearTimeout(timer));
    }
  }
  notify();
  return () => cleanups.forEach(cleanup => cleanup());
};

module.exports = {
  assertDatabaseOperationActive,
  getDatabaseOperationGuard,
  onDatabaseOperationCancelled,
  runWithDatabaseOperationGuard,
  runWithoutDatabaseOperationGuard
};
