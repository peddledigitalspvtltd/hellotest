const { isNativeTextEntryControl } = require('./automationBrowserAssertionSubject');
const { maskParameterReferences, referenceKey } = require('./automationBrowserParameters');
const { parameterTemplateParts } = require('./automationParameterTemplates');

// This deliberately narrow English classifier is an additional proof boundary,
// not a natural-language specification parser. Other phrasing/languages remain
// subject to semantic review. Inspect ORIGINAL pinned expectations only: an
// inserted parameter value or quoted UI/test-data literal is not a new clause.
function requirementText(value) {
  if (typeof value !== 'string') return '';
  return maskParameterReferences(value)
    .replace(/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu, ' ')
    .replace(/\s+/g, ' ').toLowerCase();
}

function explicitFieldErrorAbsence(text) {
  const error = '(?:(?:field(?:[ -]level)?|input|validation|inline) )?errors?(?: messages?)?';
  return new RegExp(`\\bwithout (?:any |an? )?${error}\\b`).test(text)
    || new RegExp(`\\bno ${error} (?:(?:is|are|should be|must be|shall be) )?(?:shown|displayed|reported|present|visible|occurs?|appears?|exists?|remains?)\\b`).test(text)
    || /\berror[ -]free\b|\bfree of (?:any )?errors?\b/.test(text)
    || new RegExp(`\\b${error} (?:is|are|should be|must be|shall be) not (?:shown|displayed|reported|present|visible)\\b`).test(text);
}

function explicitFieldValidationRequirement(value) {
  const text = requirementText(value);
  return explicitFieldErrorAbsence(text)
    || /\bvalidation (?:passes|succeeds|is successful|is passed)\b|\b(?:passes|satisfies) (?:the )?validation\b/.test(text)
    || /\b(?:field|input|entered value|entered data) (?:is |are |remains |should be |must be )?(?:not )?valid\b/.test(text)
    || /\b(?:field|input|entered value|entered data) (?:is |are |should be |must be )?accepted\b/.test(text);
}

const nativeInputTypes = new Set(['button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week']);
const negatedProperty = text => /\b(?:not|never|neither|no|cannot|can't|non[- ]?editable|read[- ]?only)\b/.test(text);
const subjectName = value => String(value || '').replace(/\s+/g, ' ').replace(/^[\s:]+|[\s:*]+$/g, '').toLowerCase();
function namedFieldMatches(target,subject){
  if(typeof target?.name==='string'){
    if(subjectName(target.name)===subject)return true;
    // Native accessible names can repeat identical complete label text (for
    // example two associated required labels). Recognize at most three exact
    // authored phrases; never shorten the raw name or an executable locator.
    const phrase=subject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const decorated=`${phrase}(?:\\s*\\*+)?`;
    if(new RegExp(`^${decorated}(?:\\s+${decorated}){1,2}$`).test(target.name.replace(/\s+/g,' ').trim().toLowerCase()))return true;
  }
  // A placeholder remains an exact alternative, never a repeated-name alias.
  return typeof target?.placeholder==='string'&&subjectName(target.placeholder)===subject;
}
function authoredFieldSubject(goal) {
  for (const value of [goal.expected_result, goal.action]) {
    if (typeof value !== 'string') continue;
    const authored = maskParameterReferences(value).replace(/^(?:verify|check|ensure|inspect|confirm|assert)\s+(?:that\s+)?/i, '');
    const quoted = authored.match(/(?:^|[.;!?])\s*(?:the\s+)?["“'`]([^"”'`]{1,80})["”'`]\s+(?:input(?:\s+field)?|field|control|textbox)\b/i);
    const unquoted = requirementText(authored).match(/(?:^|[.;!?])\s*(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,3}?)\s+(?:input(?:\s+field)?|field|control|textbox)\b/);
    const name = subjectName(quoted?.[1] || unquoted?.[1]);
    if (name && !['the', 'a', 'an', 'this', 'that', 'native', 'current', 'selected', 'entered', 'input'].includes(name)) return name;
  }
  return null;
}
function nativeFieldPropertyRequirements(goal) {
  const expected = goal?.expected_result;
  if (typeof expected !== 'string') return [];
  const text = requirementText(expected), subject = authoredFieldSubject(goal);
  // A named field is necessary for this extra host boundary. Unknown subjects,
  // languages, negative clauses and quoted test data retain ordinary semantic
  // assessment rather than being rewritten into a positive native predicate.
  if (!subject || !/\b(?:field|input|control|textbox)\b/.test(requirementText(`${goal.action || ''} ${expected}`))) return [];
  const requirements = [];
  if (text.split(/[.;!?]/).some(clause => !negatedProperty(clause) && (/\beditable\b/.test(clause) || /\b(?:accepts|allows) (?:text|typing|text entry)\b/.test(clause)))) {
    requirements.push({ obligation_id: goal.id, requirement: 'native_editability_predicate', classifier: 'explicit_english_native_property_v1', subject, assertion: 'editable' });
  }
  // Quoted values count only as the literal following an authored type clause.
  // A complete quoted sentence such as "the type is password" stays data.
  const literals = [];
  const typedText = maskParameterReferences(expected).replace(/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu, literal => {
    const value = literal.slice(1, -1);
    if (!nativeInputTypes.has(value.toLowerCase())) return ' ';
    const index = literals.push(value) - 1;
    return ` type_literal_${index} `;
  });
  for (const clause of typedText.split(/[.;!?]/)) {
    if (negatedProperty(requirementText(clause))) continue;
    const match = clause.match(/\b(?:of\s+type|(?:input\s+)?type(?:\s+attribute)?)\s*(?:(?:is|must be|should be|shall be|=|:)\s*)?(type_literal_\d+|[a-z][a-z-]*)\b/i);
    if (!match) continue;
    const literal = /^type_literal_\d+$/.test(match[1]) ? literals[Number(match[1].slice('type_literal_'.length))] : match[1];
    if (!nativeInputTypes.has(literal?.toLowerCase())) continue;
    requirements.push({ obligation_id: goal.id, requirement: 'native_input_type_predicate', classifier: 'explicit_english_native_property_v1', subject, assertion: 'input_type', value: literal });
  }
  return requirements;
}

function namedInputRetentionRequirements(goal) {
  if (typeof goal?.expected_result !== 'string' || typeof goal.action !== 'string'
    || !/\b(?:enter|fill|type|paste|set)\b/i.test(requirementText(goal.action))) return [];
  const actionReferences = new Set((parameterTemplateParts(goal.action) || []).filter(part => part.key).map(part => part.key));
  if (!actionReferences.size) return [];
  const references = []; let marker = 'qaira_binding_span_';
  while (goal.expected_result.includes(marker)) marker += 'x';
  const parts = parameterTemplateParts(goal.expected_result);
  if (!parts) return [];
  const text = parts.map(part => part.key ? `${marker}${references.push(part.key) - 1}` : part.literal).join('');
  // Quoted UI/test data is not an authored retention clause. Reference spans
  // are indexed first, so dots/brackets/quotes inside parameter names stay data.
  const unquoted = text.replace(/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu, ' ');
  const requirements = [];
  for (const clause of unquoted.split(/[.;!?]/)) {
    if (negatedProperty(requirementText(clause))) continue;
    const subject = authoredFieldSubject({ expected_result: clause });
    if (!subject) continue;
    const expression = new RegExp(`\\b(?:retains|has (?:the )?value|value (?:is|equals))\\s+${marker}(\\d+)\\b(?=\\s*(?:$|,|\\band\\b|\\bwith\\b))`, 'gi');
    const matches = [...clause.matchAll(expression)];
    if (matches.length !== 1) continue;
    const parameter = references[Number(matches[0][1])];
    if (!actionReferences.has(parameter)) continue;
    requirements.push({ obligation_id: goal.id, requirement: 'named_input_retained_parameter', classifier: 'explicit_english_named_input_retention_v1',
      subject, assertion: 'value', parameter_reference: parameter });
  }
  return requirements;
}

// "The Username field contains the entered username" relates the oracle to
// this action's input. It does not authorize changing a separately authored
// literal ("contains admin"), or choosing among multiple action parameters.
function relationalInputRetentionRequirements(goal) {
  if (typeof goal?.expected_result !== 'string' || typeof goal.action !== 'string'
    || !/\b(?:enter|fill|type|paste|set)\b/i.test(requirementText(goal.action)) || negatedProperty(requirementText(goal.action))) return [];
  const parameters = [...new Set((parameterTemplateParts(goal.action) || []).filter(part => part.key).map(part => part.key))];
  if (parameters.length !== 1) return [];
  const requirements = [];
  for (const clause of goal.expected_result.split(/[.;!?]/)) {
    const subject = authoredFieldSubject({ expected_result: clause });
    if (!subject) continue;
    const text = requirementText(clause).trim();
    const name = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const relation = new RegExp(`^(?:the )?${name} (?:input(?: field)?|field|control|textbox) (?:contains|retains|displays|shows) (?:the )?entered (?:${name}|value)$`);
    if (!relation.test(text)) continue;
    requirements.push({ obligation_id: goal.id, requirement: 'named_input_retained_parameter',
      classifier: 'explicit_english_entered_input_retention_v1', subject, assertion: 'value', parameter_reference: parameters[0] });
  }
  return requirements;
}

function nativeValueCoverageRequirements(sourceObligations) {
  return [...sourceObligations.filter(goal => explicitFieldValidationRequirement(goal.expected_result)).map(goal => ({
    obligation_id: goal.id, requirement: 'independent_field_validation_predicate', classifier: 'explicit_english_validation_v2',
    ...(explicitFieldErrorAbsence(requirementText(goal.expected_result)) ? { validation_scope: 'declared_field_errors' } : {})
  })), ...sourceObligations.flatMap(nativeFieldPropertyRequirements), ...sourceObligations.flatMap(namedInputRetentionRequirements),
  ...sourceObligations.flatMap(relationalInputRetentionRequirements)];
}

function nativeContentOrPresentationOnly(operation) {
  const target = operation?.observed_target;
  if (operation?.name !== 'browser_assert' || !target) return false;
  const assertion = operation.arguments?.assertion, tag = String(target.tag || '').toLowerCase();
  // Native value is content for every input type, including non-text controls;
  // an unrelated checkbox/radio/hidden value does not establish validation.
  if (assertion === 'value') return ['input', 'textarea', 'select'].includes(tag);
  return ['visible', 'enabled', 'editable', 'input_type'].includes(assertion) && (tag === 'select'
    || isNativeTextEntryControl({ tag: target.tag, attributes: { type: target.input_type } }));
}

/** Reject only known insufficient content/native-constraint proof. Other
 * status/error predicates retain ordinary semantic relevance review; native
 * validity remains available for native-only requirements. This guard never
 * chooses a selector/value or manufactures a missing assertion. Native select
 * values are selections, not independent validation evidence. */
function nativeValueCoverageIssues({ requirements, operations, mappings } = {}) {
  if (!requirements?.length || !Array.isArray(operations)) return [];
  const allAssertions = operations.filter(operation => operation.name === 'browser_assert');
  const mapped = mappings && new Map(mappings.map(row => [row.id, row.assertion_operations]));
  const mappedActions = mappings && new Map(mappings.map(row => [row.id, row.action_operations]));
  const issues = [];
  for (const requirement of requirements) {
    const assertions = mapped ? (mapped.get(requirement.obligation_id) || []).map(index => operations[index - 1]) : allAssertions;
    if (requirement.requirement === 'named_input_retained_parameter') {
      const namedInput = operation => {
        const target = operation?.observed_target;
        return target && !target.excerpt_truncated && isNativeTextEntryControl({ tag: target.tag, attributes: { type: target.input_type } })
          && namedFieldMatches(target,requirement.subject);
      };
      const sameControl = (left, right) => left?.coverage_scope && left.coverage_scope === right?.coverage_scope
        && Array.isArray(left.coverage_aliases) && left.coverage_aliases.some(alias => right.coverage_aliases?.includes(alias));
      const fills = operations.filter(operation => operation.name === 'browser_fill' && namedInput(operation)
        && referenceKey(operation.arguments?.value) === requirement.parameter_reference);
      const uniqueField = fills.length > 0 && fills.every(operation => sameControl(operation.observed_target, fills[0].observed_target));
      const proof = uniqueField && assertions.some(operation => {
        if (operation?.name !== 'browser_assert' || operation.arguments?.assertion !== 'value' || !namedInput(operation)
          || referenceKey(operation.arguments.value) !== requirement.parameter_reference) return false;
        const index = operations.indexOf(operation);
        const preceding = operations.slice(0, index);
        const barrier = preceding.findLastIndex(item => item.name === 'browser_navigate');
        const latest = preceding.slice(barrier + 1).findLast(item => item.name === 'browser_fill' && sameControl(item.observed_target, operation.observed_target));
        return latest && fills.includes(latest) && (!mappedActions || (mappedActions.get(requirement.obligation_id) || []).includes(operations.indexOf(latest) + 1));
      });
      if (!proof) issues.push({ code: 'expected_result_not_covered', obligation_id: requirement.obligation_id,
        message: 'The authored named input must retain its exact configured parameter. A completed fill or input_type, visibility, enabled or masked appearance check does not prove the retained value. Add the native value assertion using the original symbolic reference on that same uniquely observed filled control and current frame document. Do not replay the completed input or substitute a literal, equal-valued parameter, different field or weaker predicate.' });
      if (issues.length >= 20) break;
      continue;
    }
    if (['native_editability_predicate', 'native_input_type_predicate'].includes(requirement.requirement)) {
      const proof = assertions.some(operation => {
        const target = operation?.observed_target;
        if (operation?.name !== 'browser_assert' || operation.arguments?.assertion !== requirement.assertion || !target || target.excerpt_truncated) return false;
        if (requirement.assertion === 'input_type' && (String(target.tag || '').toLowerCase() !== 'input' || operation.arguments.value !== requirement.value)) return false;
        if (requirement.assertion === 'editable' && !['input', 'textarea', 'select'].includes(String(target.tag || '').toLowerCase()) && target.role !== 'textbox') return false;
        return namedFieldMatches(target,requirement.subject);
      });
      if (!proof) issues.push({ code: 'expected_result_not_covered', obligation_id: requirement.obligation_id,
        message: requirement.assertion === 'editable'
          ? 'The authored named field must be editable. Visibility, enabled state, input value and page text do not prove editability. Record the advertised editable predicate on that same observed field, or report the unsupported requirement; do not fill invented data.'
          : 'The authored named input requires an exact native input type. Visibility, input value, appearance and page text do not prove that property. Record the advertised input_type predicate with the authored exact type on that same observed input, or report the unsupported requirement.' });
      if (issues.length >= 20) break;
      continue;
    }
    const declaredErrors = requirement.validation_scope === 'declared_field_errors';
    // Native valid/invalid inspect constraints only. They cannot establish an
    // authored absence of declared application-field errors/aria-invalid.
    // Other status/error predicates still need their ordinary relevance review.
    const insufficient = operation => nativeContentOrPresentationOnly(operation)
      || declaredErrors && operation?.name === 'browser_assert' && ['valid', 'invalid'].includes(operation.arguments?.assertion);
    if (!assertions.length || !assertions.every(insufficient)
      || !declaredErrors && !assertions.some(operation => operation?.arguments?.assertion === 'value')) continue;
    issues.push({ code: 'expected_result_not_covered', obligation_id: requirement.obligation_id,
      message: 'The authored expected result requires field validation or absence of field errors in addition to input content. Native value checks establish content only. '
        + (declaredErrors ? 'Native valid/invalid check constraints only, not aria-invalid or declared application-field errors. ' : '')
        + 'Record an independent relevant observed validation/status/error predicate in the exported instructions, or report the unsupported requirement. When advertised, field_valid checks the selected field constraints and associated errors; pair it with the original value check for an immediate entry-without-errors outcome. Broader business or server outcomes still require their own evidence. Current page context alone does not supply that executable check. Do not repeat the completed input or fill unrelated fields.' });
    if (issues.length === 20) break;
  }
  return issues;
}

module.exports = { explicitFieldValidationRequirement, nativeFieldPropertyRequirements, namedInputRetentionRequirements, relationalInputRetentionRequirements, nativeValueCoverageRequirements, nativeValueCoverageIssues };
