const { AsyncLocalStorage } = require('node:async_hooks');

// Only host execution code can establish this scope. Request bodies, model
// messages and trace metadata never select the configuration owner.
const storage = new AsyncLocalStorage();
const sources = new Set(['workflow_node', 'agent_definition', 'agent_defaults', 'agent_run']);
function run(scope, callback) {
  if (!scope || !sources.has(scope.source) || typeof scope.id !== 'string' || !scope.id.trim() || scope.id.length > 200
    || typeof scope.feature_id !== 'string' || !scope.feature_id.trim() || scope.feature_id.length > 128
    || (scope.revision != null && !['string','number'].includes(typeof scope.revision))
    || (scope.config != null && (typeof scope.config !== 'object' || Array.isArray(scope.config)))) {
    throw Object.assign(new Error('Invalid agent execution configuration.'), {statusCode:422, code:'AI_EXECUTION_CONFIGURATION_INVALID'});
  }
  const pinned = JSON.parse(JSON.stringify({source:scope.source,id:scope.id,feature_id:scope.feature_id || null,revision:scope.revision ?? null,config:scope.config || {}}));
  return storage.run(pinned, callback);
}
const current = () => storage.getStore() || null;
module.exports = {run, current};
