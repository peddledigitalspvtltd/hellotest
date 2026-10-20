const { parse } = require('acorn');
const {hasExecutableAssertion}=require('./automationGeneratedProgram');

const actionTools = {
  goto: 'browser_navigate', openTab: 'browser_navigate', click: 'browser_click',
  fill: 'browser_fill', type: 'browser_fill', press: 'browser_press_key',
  selectOption: 'browser_select_option', check: 'browser_check',
  uncheck: 'browser_uncheck', hover: 'browser_hover'
};
const typedActionTools = new Set(Object.values(actionTools));
const isBrowserActionTool = name => typedActionTools.has(name);
const root = node => node?.type === 'Identifier' ? node.name
  : node?.type === 'CallExpression' ? root(node.callee)
  : node?.type === 'MemberExpression' ? root(node.object) : null;
const member = node => node?.computed ? node.property?.value : node?.property?.name;
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function browserActionRequirements(source) {
  const actions = {};
  let tree;
  try { tree = parse(source || '', { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
  catch { return actions; } // The authoritative program validator reports syntax errors.
  const aliases=new Map();
  walk(tree,node=>{if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier')aliases.set(node.id.name,node.init);});
  const origin=(node,seen=new Set())=>{
    if(node?.type==='Identifier'&&aliases.has(node.name)&&!seen.has(node.name)){seen.add(node.name);return origin(aliases.get(node.name),seen);}
    if(node?.type==='CallExpression')return origin(node.callee,seen);
    if(node?.type==='MemberExpression')return origin(node.object,seen);
    return root(node);
  };
  walk(tree, node => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return;
    if (!['page', 'playwrightPage', 'web'].includes(origin(node.callee.object))) return;
    const tool = actionTools[member(node.callee)];
    if (tool) actions[tool] = (actions[tool] || 0) + 1;
  });
  return actions;
}
function browserReceipt(observation) {
  if (observation.result?.isError) return null;
  for (const item of observation.result?.content || []) if (item.type === 'text') {
    try { const value = JSON.parse(item.text); if (value?.source === 'playwright') return value; } catch {}
  }
  return null;
}

/** Only real, current-section tool receipts can substantiate interactive progress. */
function interactiveEvidenceFeedback({ payload, execution, observations }) {
  if (!execution?.required) return null;
  const candidates = (payload?.steps || []).filter(step => (step.step_id || step.id) === execution.step_id);
  if (!candidates.length) return null;
  const requiredActions = browserActionRequirements(candidates[0].automation_code);
  const missingSourceCheck=Boolean(String(execution.expected_result||'').trim())&&!hasExecutableAssertion(candidates[0].automation_code);
  const completed = {};
  let lastAction = -1, lastAssertion = -1, lastFailedAssertion = -1, lastFailedAction = -1;
  for (const [index, observation] of observations.entries()) {
    if (observation.execution_step_id !== execution.step_id || observation.mcp_call === false) continue;
    // A failed action may have changed the application before reporting its
    // error. An older successful check cannot establish the resulting state.
    // Read-only snapshot/locator failures do not establish such a mutation.
    if(isBrowserActionTool(observation.tool)&&observation.result?.isError){lastAction=index;lastFailedAction=index;}
    if (observation.tool === 'browser_assert' && observation.result?.isError) lastFailedAssertion = index;
    const receipt = browserReceipt(observation);
    if (!receipt) continue;
    if (receipt.action_outcome === 'completed' && isBrowserActionTool(observation.tool)) {
      completed[observation.tool] = (completed[observation.tool] || 0) + 1;
      lastAction = index;
    }
    if (observation.tool === 'browser_assert') {
      if(receipt.assertion_outcome === 'satisfied')lastAssertion = index;
      else lastFailedAssertion = index;
    }
  }
  const missingActions = Object.fromEntries(Object.entries(requiredActions).map(([tool, count]) => [tool, Math.max(0, count - (completed[tool] || 0))]).filter(([, count]) => count));
  const assertionRequired = Boolean(String(execution.expected_result || '').trim()) || lastFailedAssertion>=0 || lastFailedAction>=0;
  // A later failed check invalidates earlier evidence for this section. A code
  // revision alone cannot turn an unobserved condition into a completed check.
  const assertionSatisfied = lastAssertion >= 0 && lastAssertion > Math.max(lastAction,lastFailedAssertion);
  if (!Object.keys(missingActions).length && (!assertionRequired || assertionSatisfied)&&!missingSourceCheck) return null;
  return {
    code: 'AUTOMATION_BROWSER_EXECUTION_REQUIRED', step_id: execution.step_id,
    completed_actions: completed, missing_actions: missingActions,
    ...(missingSourceCheck?{source_expected_result_check:'executable_assertion_required'}:{}),
    expected_result_check: assertionRequired && !assertionSatisfied ? lastFailedAssertion>lastAssertion?'browser_assert_required_after_failed_check':'browser_assert_required_after_actions' : 'satisfied',
    message: 'Use the current accessibility evidence to perform only the remaining section actions through MCP and check its expected result with browser_assert. Keep an executable expected-result assertion in the final section source: development tool receipts alone do not verify future test runs. Already completed actions must not be replayed to correct generated code. Return executable instructions after these tool receipts confirm the section.'
  };
}

module.exports = { browserActionRequirements, interactiveEvidenceFeedback, browserReceipt, isBrowserActionTool };
