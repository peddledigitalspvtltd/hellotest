const { setTimeout: delay } = require('node:timers/promises');
const { fail } = require('../../endpointPolicy');

function validate(node) {
  const data = node.data || {};
  if (!['number', 'string'].includes(typeof data.waitMs) || String(data.waitMs).trim() === '' || !Number.isInteger(Number(data.waitMs)) || Number(data.waitMs) < 0 || Number(data.waitMs) > 60000) return ['Wait duration must be an integer from 0 to 60000 milliseconds.'];
  if (Number(data.timeoutMs || 30000) <= Number(data.waitMs)) return ['Set the step timeout longer than its wait duration.'];
  return [];
}
async function execute({ node, context, signal }) {
  const errors = validate(node);
  if (errors.length) throw fail(errors.join(' '), 422);
  const ms = Number(node.data.waitMs);
  await delay(ms, undefined, { signal });
  return { data: context.input, waited_ms: ms };
}
module.exports=require("../definition")("wait",{ validate, execute });
