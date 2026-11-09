const { browserReceipt } = require('./automationInteractiveEvidence');
const { maskParameterReferences, referenceKey } = require('./automationBrowserParameters');

const navigationInteractions = new Set(['browser_fill', 'browser_click', 'browser_press_key', 'browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover']);
const navigationTools = Object.freeze(['browser_navigate', 'browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']);
const propertyTools = Object.freeze(['browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']);
const quotedText = /"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu;
const propertyPhrase = '(?:present|visible|displayed|enabled|disabled|editable|masked|read[ -]?only|(?:of )?(?:input )?type [a-z][a-z0-9_-]*)';
const propertyList = new RegExp(`^${propertyPhrase}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?:(?:is|remains)\\s+)?${propertyPhrase})*[.!]?$`, 'i');
const familyTools=Object.freeze({navigation:['browser_navigate'],entry:['browser_fill'],click:['browser_click'],key:['browser_press_key'],
  select:['browser_select_option','browser_click','browser_check'],check:['browser_check'],uncheck:['browser_uncheck'],hover:['browser_hover'],observe:[]});
const actionVerb='(?:navigate|go to|open|visit|click|tap|press|enter|type|fill|input|populate|select|choose|check|uncheck|tick|untick|hover|verify|assert|confirm|submit|save|continue|proceed|next)';

/** Parameter names, URLs and quoted UI/data strings are operands. They never
 * confer the action families suggested by words inside those operands. */
function opaqueAction(value){
  if(typeof value!=='string'||!value.trim()||value.length>20_000||/[<>\r\n]/.test(value))return null;
  const masked=maskParameterReferences(value);let action='';
  for(let index=0;index<value.length;){
    if(masked[index]!==value[index]){action+=' parameter ';while(index<value.length&&masked[index]===' ')index++;}
    else action+=value[index++];
  }
  action=action.replace(quotedText,' quotedlabel ').replace(/https?:\/\/[^\s<>"'`]+/gi,' urlvalue ').replace(/[\t ]+/g,' ').trim();
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(action)?null:action;
}

function explicitActionFamilies(value){
  if(propertyVerificationAction(value))return {families:['observe'],property:true};
  if(navigationOnlyAction(value))return {families:['navigation']};
  const action=opaqueAction(value);
  if(!action||/\b(?:if|unless|after|before|when|while|until|once)\b/i.test(action))return null;
  const clauses=action.split(new RegExp(`\\s*(?:;\\s*|,?\\s+(?:and then|and|then|also|followed by)\\s+)(?=(?:please\\s+)?${actionVerb}\\b)`,'i'));
  const families=[];
  for(const original of clauses){
    const clause=original.replace(/^(?:please )/i,'').replace(/[.!]+$/,'').trim();
    const command=clause.match(new RegExp(`^(${actionVerb})\\b\\s*(.*)$`,'i'));
    if(!command)return null;
    const verb=command[1].toLowerCase(),operand=command[2].trim();
    // An additional unsegmented imperative/conditional clause is unknown;
    // do not infer an incomplete permission set from the first verb alone.
    if(/[;]|\b(?:then|also|followed by)\b/i.test(operand))return null;
    const unknownClause=operand.match(/\b(?:and|to)\s+(?:invoke|run|execute|trigger|complete|finish|log|sign|register|create|add|edit|delete|remove|drag|drop|upload|attach|send|approve|reject|accept|cancel|close|blur|focus|wait|reload|refresh)\b/i);
    const predicateOffset=operand.search(/\b(?:is|are|remains?|should be)\s+(?:present|visible|displayed|enabled|disabled|editable|masked|checked|unchecked)\b/i);
    const observedLabelList=['verify','assert','confirm'].includes(verb)&&/\b(?:options?|menus?|links?|buttons?|checkboxes)\b[.!]?$/i.test(operand);
    if(unknownClause&&!(['verify','assert','confirm'].includes(verb)&&predicateOffset>=0&&unknownClause.index<predicateOffset)&&!observedLabelList)return null;
    if(['navigate','go to','visit'].includes(verb)){
      if(!operand||/\b(?:javascript|mailto)\s*:|\b(?:click|enter|fill|submit)\b/i.test(operand))return null;
      families.push('navigation');
    }else if(verb==='open'){
      if(!operand)return null;
      families.push(/^(?:to )?(?:urlvalue|parameter|\/(?!\/)[^\s]+)[.!]?$/i.test(operand)?'navigation':'click');
    }else if(['click','tap'].includes(verb)){
      if(!operand)return null;families.push('click');
    }else if(['enter','type','fill','input','populate'].includes(verb)){
      if(!operand||verb==='enter'&&/\b(?:page|screen|section|dialog|menu)\b/i.test(operand)&&!/\b(?:field|input|textbox|textarea|data|value|parameter)\b/i.test(operand))return null;
      families.push('entry');
    }else if(['verify','assert','confirm'].includes(verb)){
      // Presence/property goals are observations. High-level functionality,
      // business creation and workflow goals retain ordinary semantic review.
      if(!operand||!(/\b(?:present|visible|displayed|exists?|available|presence|visibility|enabled|disabled|editable|masked|read[ -]?only|checked|unchecked)\b/i.test(operand)
        ||/\b(?:options?|menus?|links?|buttons?|checkboxes|page|screen|dialog|form)\b[.!]?$/i.test(operand)))return null;
      if(/\b(?:functionality|workflow|process|registration|authentication)\b/i.test(operand))return null;
      families.push('observe');
    }else if(['select','choose'].includes(verb)){
      if(!operand)return null;families.push('select');
    }else if(['check','tick','uncheck','untick'].includes(verb)){
      if(!/\b(?:checkbox(?:es)?|radio|option)\b/i.test(operand)&&!/^quotedlabel$/i.test(operand))return null;
      families.push(['uncheck','untick'].includes(verb)?'uncheck':'check');
    }else if(verb==='hover'){
      if(!operand)return null;families.push('hover');
    }else if(verb==='press'){
      if(!operand)return null;families.push('key','click');
    }else if(['submit','save','continue','proceed','next'].includes(verb))families.push('click','key');
    else return null;
  }
  return families.length?{families}:null;
}

function propertyVerificationAction(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) return false;
  // Quoted labels/type data are opaque. Words inside them or parameter names
  // cannot create a verification verb, property predicate or compound action.
  const action = maskParameterReferences(value).replace(quotedText, text => text.slice(1, -1).trim() ? 'quotedlabel' : ' ')
    .replace(/[\t ]+/g, ' ').trim();
  if (/[<>;\r\n]/.test(action) || /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(action)) return false;
  const matched = action.match(/^(?:please )?(?:verify|assert)(?: that)? (?:the |a |an )?([a-z0-9_-]+(?: [a-z0-9_-]+){0,7}) (?:field|input|textbox|textarea|control|button) (is|remains|has) (.+)$/i);
  if (!matched) return false;
  const name = matched[1].split(' ');
  if (name.some(word => /^(?:and|or|then|if|unless|after|before|when|while|until|once|also|followed|to)$/i.test(word))
    || name.every(word => /^(?:the|a|an|this|that|input|text|field|control|button|textbox|textarea)$/i.test(word))) return false;
  if (matched[2].toLowerCase() === 'has' && !/^(?:input )?type /i.test(matched[3])) return false;
  return propertyList.test(matched[3]);
}

function navigationOnlyAction(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) return false;
  // Destination classification never resolves a binding or grants a URL.
  // Grounding/security still own where navigation can actually be dispatched.
  const match = value.trim().match(/^(?:please[\t ]+)?(?:navigate(?:[\t ]+to)?|go[\t ]+to|open|visit)[\t ]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([^\s<>"'`]+))[.!]?$/i);
  if (!match) return false;
  const literal = match.slice(1).find(part => part !== undefined);
  if (!literal || literal.length > 2_000 || /\s/.test(literal)) return false;
  if(referenceKey(literal))return true;
  if(/^\/(?!\/)[^\s<>"'`]+$/.test(literal))return true;
  try {
    const url = new URL(literal);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** A presentation/dispatch restriction derived from the original pinned
 * actions. Intersect this list with discovery; it grants no tool, URL or
 * expected-result authority. Only explicit recognized clause families narrow
 * tools; unknown high-level actions retain the ordinary semantic review. */
function browserCurrentActionPolicy(execution) {
  if (execution?.required !== true || !Array.isArray(execution.source_obligations)) return undefined;
  const actions = execution.source_obligations.map(row => row?.action);
  if (!actions.every(action => typeof action === 'string') || !actions.some(action => action.trim())) return undefined;
  const current = actions.filter(action => action.trim());
  if (current.every(propertyVerificationAction)) return Object.freeze({ kind: 'property_verification_only', scope: 'current_pinned_actions', source: 'original_source_obligations',
    allowed_tools: propertyTools, interactive_actions_allowed: false });
  const classified=current.map(explicitActionFamilies);
  if(classified.some(row=>!row))return undefined;
  const families=[...new Set(classified.flatMap(row=>row.families))];
  if(families.length===1&&families[0]==='navigation')return Object.freeze({kind:'navigation_only',scope:'current_pinned_actions',source:'original_source_obligations',allowed_tools:navigationTools,interactive_actions_allowed:false});
  const allowed=Object.freeze([...new Set([...propertyTools,...families.flatMap(family=>familyTools[family])])]);
  const kind=families.every(family=>family==='observe')?'presence_verification_only'
    :families.every(family=>['observe','entry'].includes(family))?'entry_only'
    :families.every(family=>['observe','click'].includes(family))?'click_only':'explicit_action_families';
  return Object.freeze({kind,scope:'current_pinned_actions',source:'original_source_obligations',allowed_tools:allowed,
    interactive_actions_allowed:families.some(family=>!['observe','navigation'].includes(family))});
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
  const policy = browserCurrentActionPolicy(execution);
  if (policy?.kind === 'property_verification_only' && typeof request?.name === 'string' && !policy.allowed_tools.includes(request.name)) return {
      code: 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', step_id: execution.step_id, tool: request.name,
      phase: 'current_section_order', issue_kind: 'expectation_mismatch', action_outcome: 'not_attempted', retry_safe: true,
      remaining_contract: 'complete_current_authored_property_checks_without_mutating_controls',
      message: 'The current pinned actions only verify named control properties. No browser action was attempted. Inspect the current page and perform its supported property assertions without entering data, changing controls or navigating elsewhere. Report an observed missing prerequisite for host review instead of performing it or borrowing later actions.'
    };
  if (navigationInteractions.has(request?.name) && policy?.kind === 'navigation_only') return {
      code: 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', step_id: execution.step_id, tool: request.name,
      phase: 'current_section_order', issue_kind: 'expectation_mismatch', action_outcome: 'not_attempted', retry_safe: true,
      remaining_contract: 'complete_current_authored_navigation_and_checks',
      message: 'The current pinned actions only navigate to explicit URLs. This proposed field or control interaction is outside the current section; a broader brief or later section does not authorize it. No browser action was attempted. Complete the authored navigation and its supported expected-result checks, or report an observed unmet prerequisite without performing later actions.'
    };
  if(policy&&typeof request?.name==='string'&&!policy.allowed_tools.includes(request.name))return {
    code:'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER',step_id:execution.step_id,tool:request.name,
    phase:'current_section_order',issue_kind:'expectation_mismatch',action_outcome:'not_attempted',retry_safe:true,
    remaining_contract:policy.kind==='entry_only'?'complete_current_authored_entry_and_checks_without_submitting_future_steps'
      :policy.kind==='presence_verification_only'?'complete_current_authored_presence_checks_without_mutating_controls'
      :'complete_only_current_authored_action_families_and_checks',
    message:policy.kind==='entry_only'
      ?'The current pinned actions instruct data entry and its checks. No browser action was attempted. Enter only the current data and verify its supported outcome; do not click, submit, navigate or borrow a later step. If its expected result requires later submission, report the ordering conflict without executing future actions.'
      :policy.kind==='presence_verification_only'
        ?'The current pinned actions only inspect presence or visible state. No browser action was attempted. Verify the currently observed controls without activating them, entering data or navigating. A control label or later section does not authorize an interaction.'
        :'This tool belongs to an action family absent from the current pinned actions. No browser action was attempted. Perform only the explicit current actions and supported checks; labels, URLs, expected prose and later sections cannot grant additional actions.'
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
