const { fail } = require('../../endpointPolicy');

function validate(node) {
  const data = node.data || {};
  return typeof data.stopMessage !== 'string' || !data.stopMessage.trim() || data.stopMessage.length > 2000 ? ['Enter a Stop reason of 1–2000 characters.'] : [];
}
async function execute({ node }) {
  const errors = validate(node);
  if (errors.length) throw fail(errors.join(' '), 422);
  throw Object.assign(fail(node.data.stopMessage.trim(), 422), { code: 'WORKFLOW_STOPPED', retryable: false });
}
module.exports=require("../definition")("stop",{connectionPolicy:{incoming:"required",outgoing:"optional"}, validate, execute });
