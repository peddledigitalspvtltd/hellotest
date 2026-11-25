// Transport-neutral contracts shared by all four agent runtimes.
const VERSION = 'agent-descriptor/1';
const RUN_VERSION = 'agent-run/1';
const SYSTEMS = Object.freeze(['workflow', 'repository', 'quality', 'automation']);
const STATUSES = Object.freeze(['queued', 'running', 'waiting', 'succeeded', 'partial', 'failed', 'cancelled', 'unknown']);
const STATUS_LABELS = Object.freeze({ queued:'Queued',running:'Running',waiting:'Needs input',succeeded:'Completed',partial:'Partial',failed:'Failed',cancelled:'Cancelled',unknown:'Outcome unknown' });
function status(value) {
  const native = String(value || '').toLowerCase();
  if (['completed','complete','passed','success','succeeded'].includes(native)) return 'succeeded';
  if (['cancelled','canceled','aborted','stopped'].includes(native)) return 'cancelled';
  if (['interrupted','incident','outcome_unknown','unknown'].includes(native)) return 'unknown';
  if (['needs_input','needs_review','waiting','blocked','approval_required'].includes(native)) return 'waiting';
  if (['error','failed'].includes(native)) return 'failed';
  return STATUSES.includes(native) ? native : 'unknown';
}
function descriptor(input) {
  if (!input || input.schema_version !== VERSION || !SYSTEMS.includes(input.system)) throw new TypeError('Use a supported versioned agent descriptor.');
  for (const key of ['id','name','objective']) if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError(`Agent descriptor requires ${key}.`);
  if (!input.instructions || typeof input.instructions.version !== 'string' || !Array.isArray(input.instructions.parts) || input.instructions.parts.some(part => typeof part !== 'string')) throw new TypeError('Agent instructions must be versioned text parts.');
  if (!Array.isArray(input.tools) || input.tools.some(tool => !tool || typeof tool.name !== 'string' || !['read','reviewed_action','compiler'].includes(tool.effect))) throw new TypeError('Describe each agent tool and its actual effect.');
  if (input.guardrails !== undefined && (!Array.isArray(input.guardrails) || input.guardrails.some(rule => !rule
    || typeof rule.id !== 'string' || !rule.id.trim() || typeof rule.text !== 'string' || !rule.text.trim()
    || !['code','prompt'].includes(rule.enforcement) || !['warning','error'].includes(rule.severity))
    || new Set(input.guardrails.map(rule => rule.id)).size !== input.guardrails.length)) throw new TypeError('Describe each guardrail, its enforcement and its severity.');
  if (!input.evidence || !Array.isArray(input.evidence.scopes) || typeof input.output?.contract !== 'string' || !input.output.contract || input.output.review_required !== true) throw new TypeError('Agent evidence and reviewed output contract are required.');
  if (!input.limits || Object.values(input.limits).some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('Agent limits must be bounded nonnegative numbers.');
  return JSON.parse(JSON.stringify(input));
}
module.exports = { VERSION, RUN_VERSION, SYSTEMS, STATUSES, STATUS_LABELS, status, descriptor };
