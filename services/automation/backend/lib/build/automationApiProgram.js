const invalid = (message, code = 'AUTOMATION_UPSTREAM_API_INVALID') =>
  Object.assign(new Error(message), { code, statusCode: 422, nonRetryable: true });

/** Generate one native HTTP contract inside a mixed plan without making a
 * request to the application. The same native normalizer is used for an API
 * plan built entirely from its authored specification. */
async function generateApiSection({ step, startUrl, brief, context, authoredFlow, configuredContract, privateScope,
  complete, parse, normalize, validate, redact, guard }) {
  let feedback;
  for (let attempt = 0; attempt < 3; attempt++) {
    await guard();
    let proposal;
    try {
      proposal = parse(await complete({ phase: 'upstream_api_source', step, prompt: JSON.stringify({
        task: 'Generate only this authored API section using its documented request and response assertions. Return the native automation JSON contract: {summary:"...",steps:[{step_id:"exact current id",step_type:"api",api_request:{...}}]}. Preserve the authored method, endpoint, parameter references and expected results. API requests are run by Test Engine when the complete plan is executed.',
        current_section: step, start_url: startUrl, brief, context, parameters: privateScope.parameterValues,
        private_parameter_tokens: privateScope.references, private_parameter_availability: privateScope.availability,
        configured_contract: configuredContract, authored_flow: authoredFlow, feedback
      }) }));
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== 'AI_INVALID_JSON') throw error;
      if (attempt === 2) throw invalid('The API source model did not return valid request JSON after three proposals.', 'AI_INVALID_JSON');
      feedback = 'Return valid JSON with exactly one authored API request.';
      continue;
    }
    try {
      privateScope.assertArguments(proposal);
      const build = await normalize(proposal, [step]);
      const update = build?.updates?.[0];
      if (build?.updates?.length !== 1 || update?.step?.id !== step.id || update.step_type !== 'api' || !update.api_request || update.automation_code) {
        throw invalid('Return exactly one complete native API request for the current authored section.');
      }
      const issues = validate([{ ...step, step_type: 'api', automation_code: null, api_request: update.api_request }]);
      if (issues.length) throw invalid(issues.join(' '));
      privateScope.assertArguments(update.api_request);
      const request = JSON.stringify(update.api_request);
      if (redact(request) !== request) throw invalid('Use the exact scoped parameter reference for private request inputs.', 'AUTOMATION_PRIVATE_VALUE_IN_SOURCE');
      return { ...update, automation_code: null };
    } catch (error) {
      if (attempt === 2) throw error;
      feedback = redact(error.message);
    }
  }
}

module.exports = { generateApiSection };
