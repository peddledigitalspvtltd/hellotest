const { browserReceipt } = require('./automationInteractiveEvidence');
const { maskParameterReferences } = require('./automationBrowserParameters');

const navigationInteractions = new Set(['browser_fill', 'browser_click', 'browser_press_key', 'browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover']);
const navigationTools = Object.freeze(['browser_navigate', 'browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']);

function navigationOnlyAction(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) return false;
  // Classify one explicit URL instruction only. Unknown language, markup,
  // parameterized destinations and compound actions retain semantic review.
  const match = value.trim().match(/^(?:please[\t ]+)?(?:navigate(?:[\t ]+to)?|go[\t ]+to|open|visit)[\t ]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([^\s<>"'`]+))[.!]?$/i);
  if (!match) return false;
  const literal = match.slice(1).find(part => part !== undefined);
  if (!literal || literal.length > 2_000 || /\s/.test(literal)) return false;
  try {
    const url = new URL(literal);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** A presentation/dispatch restriction derived from the original pinned
 * actions. Intersect this list with discovery; it grants no tool, URL or
 * expected-result authority and never classifies unknown/compound prose. */
function browserCurrentActionPolicy(execution) {
  if (execution?.required !== true || !Array.isArray(execution.source_obligations)) return undefined;
  const actions = execution.source_obligations.map(row => row?.action);
  if (!actions.every(action => typeof action === 'string') || !actions.some(action => action.trim())
    || !actions.filter(action => action.trim()).every(navigationOnlyAction)) return undefined;
  return Object.freeze({ kind: 'navigation_only', scope: 'current_pinned_actions', source: 'original_source_obligations',
    allowed_tools: navigationTools, interactive_actions_allowed: false });
}

function authoredAction(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) return null;
  return maskParameterReferences(value)
    .replace(/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

// This is a narrow ordering safeguard, not a natural-language action planner.
// Unknown or compound instructions retain the ordinary actor/reviewer path.
function entryOnlyAction(value) {
  const action = authoredAction(value);
  if (!action || /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(action)
    || !/^(?:please )?(?:enter|type|fill|input|populate)\b/i.test(action)) return false;
  // "Enter the details page" is a navigation instruction. A parameter or
  // generic field/content noun provides the additional entry context without
  // introducing application-specific field names. Other entry verbs already
  // describe text/data input. Mixed/conditional clauses remain unclassified.
  if (/^(?:please )?enter\b/i.test(action) && maskParameterReferences(value) === value
    && !/\b(?:field|input|control|textbox|textarea|box|data|value)\b/i.test(action)) return false;
  if (/\b(?:and|then|after|before|once|when|until|while|also|followed)\b|[;\r\n]/i.test(action)) return false;
  return !/\b(?:click(?:s|ed|ing)?|press(?:es|ed|ing)?|submit(?:s|ted|ting)?|submission|tap(?:s|ped|ping)?|confirm|complete|finish|send|log|login|sign|signup|register|continue|next|proceed|select|choose|open|navigate|wait|focus|blur|validate|verify|check|save|upload|attach|drag|drop|reload|refresh|accept|reject)\b/i.test(action);
}

function explicitSubmitAction(value) {
  const action = authoredAction(value);
  return Boolean(action && !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(action)
    && /^(?:please )?submit\b/i.test(action));
}

/** A current entry-only section cannot borrow a later authored submission to
 * make its expected outcome true. Authority comes only from original host
 * actions and a current uniquely observed native submit control. Expected
 * prose, page labels, substituted data and model proposals grant no action. */
function browserActionOrderFeedback({ request, snapshot, execution } = {}) {
  if (navigationInteractions.has(request?.name) && browserCurrentActionPolicy(execution)) return {
      code: 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', step_id: execution.step_id, tool: request.name,
      phase: 'current_section_order', issue_kind: 'expectation_mismatch', action_outcome: 'not_attempted', retry_safe: true,
      remaining_contract: 'complete_current_authored_navigation_and_checks',
      message: 'The current pinned actions only navigate to explicit URLs. This proposed field or control interaction is outside the current section; a broader brief or later section does not authorize it. No browser action was attempted. Complete the authored navigation and its supported expected-result checks, or report an observed unmet prerequisite without performing later actions.'
    };
  if (execution?.required !== true || request?.name !== 'browser_click' || typeof request.arguments?.locator !== 'string'
    || snapshot?.tool !== 'browser_snapshot' || snapshot.mcp_call === false || snapshot.result?.isError
    || !Array.isArray(execution.source_obligations) || !Array.isArray(execution.future_actions)) return null;
  const current = execution.source_obligations.map(row => row?.action).filter(action => typeof action === 'string' && action.trim());
  if (!current.length || !current.every(entryOnlyAction)
    || !execution.future_actions.some(row => row && typeof row.step_id === 'string' && row.step_id && row.step_id !== execution.step_id && explicitSubmitAction(row.action))) return null;
  const page = browserReceipt(snapshot);
  const matches = Array.isArray(page?.elements) ? page.elements.filter(element => element?.locators_validated === true
    && Array.isArray(element.locator_candidates) && element.locator_candidates.includes(request.arguments.locator)) : [];
  if (matches.length !== 1) return null;
  const target = matches[0], tag = typeof target.tag === 'string' ? target.tag.toLowerCase() : '';
  if (!['button', 'input'].includes(tag) || target.truncated_attributes?.includes('type')
    || typeof target.attributes?.type !== 'string' || target.attributes.type.toLowerCase() !== 'submit') return null;
  return {
    code: 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', step_id: execution.step_id, tool: request.name,
    phase: 'current_section_order', issue_kind: 'expectation_mismatch', action_outcome: 'not_attempted', retry_safe: true,
    remaining_contract: 'complete_current_authored_entry_and_checks_without_submitting_future_steps',
    message: 'This native submit action belongs to a later authored section. The current section instructs data entry only. No browser action was attempted. Complete only the current entry and supported outcome checks; if its expected result requires later submission, report the ordering conflict without executing future actions.'
  };
}

module.exports = { browserActionOrderFeedback, browserCurrentActionPolicy };
