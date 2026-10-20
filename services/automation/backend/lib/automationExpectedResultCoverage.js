const { isNativeTextEntryControl } = require('./automationBrowserAssertionSubject');
const { maskParameterReferences } = require('./automationBrowserParameters');

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

function nativeValueCoverageRequirements(sourceObligations) {
  return sourceObligations.filter(goal => explicitFieldValidationRequirement(goal.expected_result)).map(goal => ({
    obligation_id: goal.id, requirement: 'independent_field_validation_predicate', classifier: 'explicit_english_validation_v2',
    ...(explicitFieldErrorAbsence(requirementText(goal.expected_result)) ? { validation_scope: 'declared_field_errors' } : {})
  }));
}

function nativeContentOrPresentationOnly(operation) {
  const target = operation?.observed_target;
  if (operation?.name !== 'browser_assert' || !target) return false;
  const assertion = operation.arguments?.assertion, tag = String(target.tag || '').toLowerCase();
  // Native value is content for every input type, including non-text controls;
  // an unrelated checkbox/radio/hidden value does not establish validation.
  if (assertion === 'value') return ['input', 'textarea', 'select'].includes(tag);
  return ['visible', 'enabled'].includes(assertion) && (tag === 'select'
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
  const issues = [];
  for (const requirement of requirements) {
    const assertions = mapped ? (mapped.get(requirement.obligation_id) || []).map(index => operations[index - 1]) : allAssertions;
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

module.exports = { explicitFieldValidationRequirement, nativeValueCoverageRequirements, nativeValueCoverageIssues };
