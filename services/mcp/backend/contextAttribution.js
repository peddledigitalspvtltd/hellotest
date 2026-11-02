// Application-owned correlation only. These labels never select a principal,
// project, credential, permission or action, and are never read from tool args.
const fields = Object.freeze(['feature', 'session_id', 'task_id', 'run_id', 'node_id', 'request_id', 'trace_id']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const valid = (key, value) => typeof value === 'string'
  && value.length > 0 && value.length <= (key === 'feature' ? 160 : 255)
  && (key === 'feature' ? /^[A-Za-z0-9._:-]+$/ : /^[A-Za-z0-9._:/-]+$/).test(value);

function select(scope) {
  return Object.fromEntries(fields.filter(key => valid(key, scope?.[key])).map(key => [key, scope[key]]));
}
function isValid(value) {
  return object(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([key, item]) => fields.includes(key) && valid(key, item));
}
module.exports = { select, isValid };
