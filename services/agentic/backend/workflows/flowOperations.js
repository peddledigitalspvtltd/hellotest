const handlers = require('./nodes/flow');
const { fail } = require('./endpointPolicy');
const KINDS = new Set(Object.keys(handlers));
const handler = node => handlers[node.data?.kind || node.type];
const validate = node => handler(node)?.validate(node) || [];
const execute = context => {
  const selected = handler(context.node);
  if (!selected) throw fail('This flow node does not have an execution adapter.', 422);
  return selected.execute(context);
};
module.exports = { KINDS, validate, execute };
