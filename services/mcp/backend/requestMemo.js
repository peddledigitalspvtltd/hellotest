'use strict';

// A memo that lives for one MCP request and no longer.
//
// Every permission check reloaded the user and the project, and one tool call
// makes several checks, so a single read could cost a dozen identical queries.
// Within a request those answers do not change in any way that matters, so the
// first caller loads them and the rest share the result.
//
// What this is not: a cache of authority across requests. A scope exists only
// while a request is open, nothing in it survives the request, an entry older than
// MAX_AGE_MS is loaded again (a long retrieval still sees a revoked membership
// within seconds), and a failed load is never remembered. Outside a scope every
// call loads, exactly as before.

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const maxAgeMs = () => {
  const configured = Number(process.env.HELLOTEST_MCP_REQUEST_CACHE_MS);
  return Number.isFinite(configured) && process.env.HELLOTEST_MCP_REQUEST_CACHE_MS !== '' ? Math.min(30_000, Math.max(0, configured)) : 5_000;
};

/** Run `task` inside a request scope. A task that is already inside one shares it. */
const open = task => storage.getStore() ? task() : storage.run({ entries: new Map() }, task);

/** The value for `key`, loaded once per request scope. `load` runs directly when no scope is open. */
const remember = (key, load) => {
  const scope = storage.getStore();
  const limit = maxAgeMs();
  if (!scope || limit === 0) return load();
  const now = Date.now();
  const hit = scope.entries.get(key);
  if (hit && now - hit.at <= limit) return hit.value;
  const entry = { at: now, value: undefined };
  entry.value = Promise.resolve().then(load).catch(error => {
    if (scope.entries.get(key) === entry) scope.entries.delete(key);
    throw error;
  });
  scope.entries.set(key, entry);
  return entry.value;
};

/** Whether a request scope is open; used by tests. */
const active = () => Boolean(storage.getStore());

module.exports = { active, open, remember };
