const { setTimeout: delay } = require('node:timers/promises');
const KINDS = new Set(['wait', 'stop']);
const fail = message => Object.assign(new Error(message), { publicMessage: message, statusCode: 422 });
function validate(node) {
  const data = node.data || {};
  if (data.kind === 'wait' && (!['number', 'string'].includes(typeof data.waitMs) || String(data.waitMs).trim() === '' || !Number.isInteger(Number(data.waitMs)) || Number(data.waitMs) < 0 || Number(data.waitMs) > 60000)) return ['Wait duration must be an integer from 0 to 60000 milliseconds.'];
  if (data.kind === 'wait' && Number(data.timeoutMs || 30000) <= Number(data.waitMs)) return ['Set the step timeout longer than its wait duration.'];
  if (data.kind === 'stop' && (typeof data.stopMessage !== 'string' || !data.stopMessage.trim() || data.stopMessage.length > 2000)) return ['Enter a Stop reason of 1–2000 characters.'];
  return [];
}
async function execute({ node, context, signal }) {
  const errors = validate(node);
  if (errors.length) throw fail(errors.join(' '));
  if (node.data.kind === 'stop') throw Object.assign(fail(node.data.stopMessage.trim()), { code: 'WORKFLOW_STOPPED', retryable: false });
  const ms = Number(node.data.waitMs);
  await delay(ms, undefined, { signal });
  return { data: context.input, waited_ms: ms };
}
module.exports = { KINDS, validate, execute };
