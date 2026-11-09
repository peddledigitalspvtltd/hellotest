const { browserReceipt } = require('./automationInteractiveEvidence');
const { recordedSectionRequests } = require('./automationBrowserRecording');
const { browserBatchTargetEvidence, modelTargetForLocator } = require('./automationBrowserModelTargets');
const { maskParameterReferences } = require('./automationBrowserParameters');
const { isDeepStrictEqual } = require('node:util');

// A browser/section retains its phase across actor attempts. Serialized history,
// model completion claims and a new page cannot reopen a confirmed submission.
const sessions = new WeakMap();
const mutations = new Set(['browser_navigate', 'browser_click', 'browser_fill', 'browser_press_key', 'browser_select_option', 'browser_hover', 'browser_check', 'browser_uncheck']);
const reads = Object.freeze(['browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']);
const quotes = /"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu;
const verbs = '(?:go to|navigate|visit|open|enter|type|fill|input|populate|filter|click|tap|press|select|choose|check|uncheck|tick|untick|hover|verify|assert|confirm|submit|save|search|continue|proceed|next)';
const normalize = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
const terminal = value => ({ login: 'login', 'log in': 'login', 'sign in': 'login', submit: 'submit', save: 'save', search: 'search', next: 'next' })[normalize(value)] || null;

/** Recognize only an explicit, final authored terminal operation. Operands are
 * opaque while splitting commands; UI labels, values and reference names never
 * introduce verbs. Unknown/conditional business plans retain semantic review. */
function authoredTerminalAction(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000 || /[<>\r\n]/.test(value)) return null;
  const literals = [];
  let action = maskParameterReferences(value).replace(quotes, text => {
    const index = literals.push(text.slice(1, -1)) - 1;
    return ` quotedoperand${index} `;
  }).replace(/https?:\/\/[^\s<>"'`]+/gi, ' urloperand ').replace(/[\t ]+/g, ' ').trim();
  if (/\b(?:if|unless|after|before|when|while|until)\b/i.test(action)) return null;
  const clauses = action.split(new RegExp(`\\s*(?:;\\s*|[.!]\\s+|,?\\s+(?:and then|and|then|also|followed by)\\s+|,\\s*)(?=(?:please\\s+)?${verbs}\\b)`, 'i'));
  const commands = [];
  for (const clause of clauses) {
    const match = clause.trim().replace(/[.!]+$/, '').match(new RegExp(`^(?:please\\s+)?(${verbs})\\b\\s*(.*)$`, 'i'));
    if (!match || /[;]|\b(?:then|also|followed by)\b/i.test(match[2])) return null;
    const verb = match[1].toLowerCase(), operand = match[2].trim();
    if (!operand && !['submit', 'save', 'search', 'next'].includes(verb)) return null;
    // An unparsed extra imperative must not be mistaken for an operand of the
    // earlier command, particularly when it follows a submission.
    if (/\b(?:and|to)\s+(?:create|add|edit|delete|remove|send|upload|attach|run|execute|invoke|trigger|complete|finish|log|sign|register)\b/i.test(operand)) {
      const observation = ['verify', 'assert', 'confirm'].includes(verb);
      const predicate = operand.search(/\b(?:is|are|remains?|should be)\s+(?:visible|displayed|present|checked|unchecked|enabled|disabled)\b/i);
      const extra = operand.search(/\b(?:and|to)\s+(?:create|add|edit|delete|remove|send|upload|attach|run|execute|invoke|trigger|complete|finish|log|sign|register)\b/i);
      if (!observation || predicate < 0 || extra > predicate) return null;
    }
    if (['verify', 'assert', 'confirm'].includes(verb)) {
      if (!/\b(?:visible|displayed|present|checked|unchecked|enabled|disabled|editable|masked|exists?|available)\b/i.test(operand)) return null;
      commands.push({ observe: true }); continue;
    }
    let control = null;
    if (['click', 'tap'].includes(verb)) {
      let label = operand.replace(/^(?:on\s+)?(?:the\s+)?/i, '').replace(/\s+(?:button|control|link)(?:\s+once)?$/i, '').replace(/\s+(?:once|one time)$/i, '').trim();
      const quoted = label.match(/^quotedoperand(\d+)$/);
      if (quoted) label = literals[Number(quoted[1])];
      control = terminal(label);
    } else if (['submit', 'save', 'search', 'next'].includes(verb) && /^(?:once|one time)?$/i.test(operand)) control = terminal(verb);
    commands.push({ control });
  }
  const mutating = commands.filter(command => !command.observe), last = mutating.at(-1);
  if (!last?.control) return null;
  return { control: last.control, occurrence: mutating.filter(command => command.control === last.control).length };
}

function originalTerminalPlan(execution) {
  if (execution?.required !== true || !Array.isArray(execution.source_obligations) || !execution.source_obligations.length) return null;
  const actions = execution.source_obligations.map(row => row?.action);
  if (!actions.every(action => typeof action === 'string')) return null;
  const plans = actions.filter(action => action.trim()).map(authoredTerminalAction);
  if (!plans.length || plans.some(plan => !plan) || plans.some(plan => plan.control !== plans[0].control)) return null;
  // Linked/manual duplicate obligations describe the same actions, not extra
  // submission occurrences. Preserve explicit repeated clicks within a row.
  return { control: plans[0].control, occurrence: Math.max(...plans.map(plan => plan.occurrence)) };
}

function observedControl(request, snapshot) {
  const evidence = browserBatchTargetEvidence(snapshot);
  if (!evidence || request?.name !== 'browser_click' || typeof request.arguments?.locator !== 'string') return null;
  const ref = modelTargetForLocator(request.arguments.locator, snapshot);
  const matches = evidence.targets.filter(row => row.ref === ref);
  if (matches.length !== 1) return null;
  const target = matches[0];
  if (!target.identity_complete || target.name_truncated || target.role_truncated || target.tag_truncated || target.input_type_truncated
    || target.visible !== true || target.disabled === true || !['button', 'input', 'a'].includes(normalize(target.tag))
    || !['button', 'link'].includes(normalize(target.role))
    || normalize(target.tag) === 'input' && !['button', 'submit', 'image'].includes(normalize(target.input_type))) return null;
  return target;
}

function readOnlyDisclosure(request, snapshot, approved) {
  if (!approved) return false;
  const target = observedControl(request, snapshot);
  if (!target || terminal(target.name) || normalize(target.input_type) === 'submit' || normalize(target.tag) !== 'button'
    || normalize(target.input_type) !== 'button') return false;
  const page = browserReceipt(snapshot);
  const elements = page?.elements?.filter(row => row?.locators_validated === true && row.locator_candidates?.includes(request.arguments.locator));
  if (elements?.length !== 1) return false;
  const attrs = elements[0].attributes || {};
  return !elements[0].truncated_attributes?.some(key => ['type', 'aria-haspopup', 'aria-expanded', 'aria-controls'].includes(key))
    && (['true', 'false'].includes(attrs['aria-expanded']) || ['menu', 'listbox', 'tree', 'grid', 'dialog', 'true'].includes(attrs['aria-haspopup'])
      || typeof attrs['aria-controls'] === 'string' && Boolean(attrs['aria-controls'].trim()));
}

function createAutomationTerminalActionGate({ browser, execution } = {}) {
  const eligible = browser && typeof browser === 'object' && execution?.required === true && typeof execution.step_id === 'string';
  let state;
  if (eligible) {
    let steps = sessions.get(browser);
    if (!steps) { steps = new Map(); sessions.set(browser, steps); }
    state = steps.get(execution.step_id);
    if (!state) { state = { plan: originalTerminalPlan(execution), completed: new Set(), actionId: null }; steps.set(execution.step_id, state); }
  }
  return {
    record(observation, request, snapshot) {
      if (!state?.plan || state.actionId || observation?.result?.isError || observation?.mcp_call === false || observation?.execution_step_id !== execution.step_id
        || typeof observation.action_id !== 'string' || !observation.action_id || state.completed.has(observation.action_id)) return;
      const receipt = browserReceipt(observation);
      const operation = recordedSectionRequests([observation], execution.step_id)[0];
      if (receipt?.action_outcome !== 'completed' || operation?.name !== 'browser_click' || !isDeepStrictEqual(operation.arguments, request?.arguments)) return;
      const target = observedControl(request, snapshot);
      if (!target || terminal(target.name) !== state.plan.control) return;
      state.completed.add(observation.action_id);
      if (state.completed.size >= state.plan.occurrence) state.actionId = observation.action_id;
    },
    policy() {
      return state?.actionId ? { kind: 'post_terminal_verification_only', scope: 'current_pinned_actions', source: 'original_actions_and_confirmed_native_terminal_control',
        allowed_tools: reads, interactive_actions_allowed: false, completed_action_id: state.actionId,
        remaining_contract: 'verify_original_expected_result_or_report_section_issue_without_new_data_or_submission' } : null;
    },
    feedback(request, { snapshot, approvedPrerequisite = false } = {}) {
      if (!state?.actionId || !mutations.has(request?.name) || readOnlyDisclosure(request, snapshot, approvedPrerequisite)) return null;
      return { code: 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', step_id: execution.step_id, tool: request.name,
        phase: 'post_terminal_verification_only', issue_kind: 'expectation_mismatch', action_outcome: 'not_attempted', retry_safe: true,
        completed_action_id: state.actionId, remaining_contract: 'verify_original_expected_result_or_report_section_issue_without_new_data_or_submission',
        message: 'The final explicit terminal action in the original current manual step already completed on its observed native control. No new action was attempted. Use read-only evidence and executable assertions for every original expected result, or report section_issue. A new page, field, locator, occurrence or model completion flag does not authorize further data entry, clicks, navigation or another submission. The confirmed action remains recorded and must not be replayed.' };
    }
  };
}

module.exports = { authoredTerminalAction, originalTerminalPlan, createAutomationTerminalActionGate };
