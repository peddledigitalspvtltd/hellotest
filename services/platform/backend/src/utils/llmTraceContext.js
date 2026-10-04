const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
const integrations = new WeakMap();

// The request reference is resolved at call time, after authentication. Background
// activities bind their own identity; no context is stored on a process global.
function current(integration) {
  const local = storage.getStore() || {};
  const req = local.request;
  const selected = integration && integrations.get(integration) || {};
  return {
    project_id: selected.projectId || req?.body?.project_id || req?.query?.project_id || req?.params?.project_id || integration?.config?.project_id || null,
    actor_id: selected.userId || req?.user?.id || null,
    request_id: req?.id || null,
    trace_id: req?.traceId || null,
    feature: selected.usageKey || null,
    ...Object.fromEntries(Object.entries(local).filter(([key]) => key !== 'request'))
  };
}

module.exports = {
  current,
  run: (context, callback) => storage.run({ ...storage.getStore(), ...context }, callback),
  bindIntegration: (integration, context) => { if (integration) integrations.set(integration, context); },
  update: context => { const store = storage.getStore(); if (store) Object.assign(store, context); }
};
