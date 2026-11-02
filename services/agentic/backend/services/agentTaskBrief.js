const { fail } = require('../agents/agentDefinition');

// These inputs define the task, rather than optional retrieval excerpts.
const EXACT_INPUT_SCOPES = new Set(['automation_repair', 'case_intent', 'run_selection', 'workflow_input', 'task_input', 'reviewed_context', 'task_context']);
const SUPPLIED_INPUT_SCOPES = new Set(['workflow_input', 'task_input', 'reviewed_context', 'task_context']);

function completeTaskText(value, maximum, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > maximum) throw fail(`The complete ${label} exceeds its ${maximum.toLocaleString('en-US')}-character input limit. Shorten or split the brief; no partial brief was sent.`, 'AGENT_INPUT_BUDGET');
  return text;
}

// Carry only caller-supplied, sanitized task data. Each successor retrieves and
// authorizes its own product evidence; a parent packet cannot widen that scope.
function suppliedTaskContext(context = {}) {
  return Object.fromEntries([...SUPPLIED_INPUT_SCOPES].filter(scope => Array.isArray(context[scope]) && context[scope].length)
    .map(scope => [scope, context[scope].map(item => ({ ...item }))]));
}

module.exports = { EXACT_INPUT_SCOPES, completeTaskText, suppliedTaskContext };
