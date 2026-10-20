const db = require('@hellotest/platform/backend/src/db');

const invalid = (message, code = 'AUTOMATION_CASE_HOOK_INVALID') => Object.assign(new Error(message), {statusCode: 422, code, nonRetryable: true});
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { throw invalid('Before / After selections must be a valid list.'); } };

// Save references, never caller-supplied executable snapshots. The run freezes
// source code and private data separately, under the initiating user's access.
function normalizeCaseExecutionHooks(value = []) {
  const hooks = parse(value) || [];
  if (!Array.isArray(hooks) || hooks.length > 20) throw invalid('Choose up to 20 Before Test and After Test cases.');
  const ids = new Set(), selections = new Set();
  return hooks.map((hook, index) => {
    if (!hook || typeof hook !== 'object' || Array.isArray(hook) || hook.scope !== 'test' || !['pre','post'].includes(hook.phase)
      || !['test','suite'].includes(hook.target_kind) || typeof hook.target_id !== 'string' || !hook.target_id.trim()) throw invalid('Each Before / After entry must select a saved test case or suite.');
    const id = typeof hook.id === 'string' && hook.id.trim() ? hook.id.trim() : `case-hook-${index + 1}`;
    const selection = `${hook.phase}:${hook.target_kind}:${hook.target_id.trim()}`;
    if (ids.has(id) || selections.has(selection)) throw invalid('The same source can appear only once in each Before / After section.');
    ids.add(id); selections.add(selection);
    const failBehavior = hook.fail_behavior || (hook.phase === 'post' ? 'continue' : 'fail-run');
    if (!['continue','fail-run','mark-blocked'].includes(failBehavior)) throw invalid('Choose a supported hook failure behavior.');
    return {id, scope:'test', phase:hook.phase, target_kind:hook.target_kind, target_id:hook.target_id.trim(),
      name: typeof hook.name === 'string' ? hook.name.slice(0,500) : '', fail_behavior:failBehavior, execution_order:index + 1};
  });
}

async function validateCaseExecutionHooks(hooks, {projectId, appTypeId, caseId = null} = {}) {
  const normalized = normalizeCaseExecutionHooks(hooks);
  for (const hook of normalized) {
    if (hook.target_kind === 'test' && hook.target_id === caseId) throw invalid('A case cannot run itself as a Before / After case.', 'AUTOMATION_CASE_HOOK_CYCLE');
    const table = hook.target_kind === 'suite' ? 'test_suites' : 'test_cases';
    const row = await db.prepare(`SELECT source.id FROM ${table} source JOIN app_types app ON app.id = source.app_type_id
      WHERE source.id = ? AND app.project_id = ? AND source.app_type_id = ?`).get(hook.target_id, projectId, appTypeId);
    if (!row) throw invalid('Before / After sources must belong to this project and application.');
  }
  return normalized;
}

async function snapshotCaseExecutionHooks(caseId, hooks, context) {
  const normalized = normalizeCaseExecutionHooks(hooks);
  if (!normalized.length) return [];
  const frozen = await require('./executionHookSnapshots.service').snapshotExecutionHooks(normalized, {...context, ownerCaseId:caseId});
  return frozen.map(hook => ({...hook, id:`case:${caseId}:${hook.id}`, owner_test_case_id:caseId}));
}

module.exports = {normalizeCaseExecutionHooks, validateCaseExecutionHooks, snapshotCaseExecutionHooks};
