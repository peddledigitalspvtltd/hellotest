const guide = (cause, action, owner, retry) => ({cause,action,owner,retry});

const resolutions = {
  AUTOMATION_BUILD_INCOMPLETE: guide('The builder could not produce runnable source for every authored step.', 'Review the affected section and its inputs before rebuilding the case.', 'Test Case owner', 'After correcting the case inputs'),
  AUTOMATION_UPSTREAM_BUILD_INCOMPLETE: guide('The browser and generator did not complete every authored section.', 'Review the recorded section, application state and expected result. Supply any missing fixture or state.', 'Test Case owner', 'After confirming the application state'),
  AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED: guide('The browser did not return a conclusive acknowledgement for an action.', 'Inspect the application for any change and reconcile the original operation before resubmitting it.', 'Environment owner', 'Reconciliation required'),
  AUTOMATION_BROWSER_ENGINE_UNAVAILABLE: guide('The browser runner could not open a TestEngine session.', 'Check the TestEngine integration and confirm that a browser worker is online.', 'TestEngine administrator', 'After restoring the connection'),
  AUTOMATION_BROWSER_ENTRY_TIMEOUT: guide('The browser runner or Start URL did not respond during the connectivity check.', 'Check TestEngine health and verify that its browser can reach the application.', 'TestEngine administrator', 'After restoring connectivity'),
  AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR: guide('The application returned an HTTP error at its Start URL.', 'Confirm the environment URL and access rules from the TestEngine network.', 'Environment owner', 'After restoring the application'),
  AUTOMATION_BROWSER_ENTRY_UNAVAILABLE: guide('The browser could not open the application Start URL.', 'Check app availability, DNS and TLS from the TestEngine network.', 'Environment owner', 'After restoring connectivity'),
  AUTOMATION_VERIFICATION_OUTCOME_UNKNOWN: guide('TestEngine did not confirm the result of a verification run.', 'Inspect the recorded verification and check application state before repeating its steps.', 'Environment owner', 'Reconciliation required'),
  AUTOMATION_DEPENDENCY_MISSING: guide('An authored action needs a value or environment fixture.', 'Provide the listed input through the selected Test Environment, Test Data Set or case parameters.', 'Test Case owner', 'After providing the input'),
  AUTOMATION_UPSTREAM_SOURCE_INVALID: guide('A generated section failed executable source validation.', 'Use the section diagnostics to check the selector, assertion or parameter binding.', 'Automation owner', 'After correcting the failing section'),
  AUTOMATION_UPSTREAM_SOURCE_CHANGED: guide('Generated source changed a confirmed browser action.', 'Review the section source against its native action receipt.', 'Automation owner', 'After checking prior actions and correcting source'),
  AUTOMATION_UPSTREAM_AUTHORED_ACTION_UNCONFIRMED: guide('The authored action has no successful browser receipt in this section.', 'Review the named action, current page and availability of the required control.', 'Test Case owner', 'After confirming the target and application state'),
  AUTOMATION_START_URL_REQUIRED: guide('The browser build has no application Start URL.', 'Choose a Test Environment with a base URL or enter a Start URL on the node.', 'Workflow author', 'After adding a Start URL'),
  AUTOMATION_START_URL_INVALID: guide('The Start URL could not be used for browser automation.', 'Use a complete HTTP or HTTPS Start URL without credentials.', 'Workflow author', 'After updating the URL'),
  AUTOMATION_ENVIRONMENT_UNAVAILABLE: guide('The selected Test Environment is unavailable.', 'Choose an environment in this workflow project and application.', 'Workflow author', 'After selecting an environment'),
  AUTOMATION_MANUAL_CASE_REQUIRED: guide('The node has no manual Test Case to build from.', 'Select a saved manual Test Case or supply manual_test_case_id in the trigger input.', 'Workflow author', 'After selecting the case'),
  AUTOMATION_MANUAL_CASE_UNAVAILABLE: guide('The manual Test Case is unavailable in the selected application.', 'Select a case in the workflow application or update the workflow scope.', 'Workflow author', 'After selecting a case in scope'),
  AI_INPUT_BUDGET_EXCEEDED: guide('The model request exceeds its input budget.', 'Shorten supplementary guidance or split the source case into smaller cases.', 'Workflow author', 'After reducing the input'),
  LLM_REQUEST_TOO_LARGE: guide('The provider rejected this case’s request size.', 'Shorten supplementary context or choose a model that supports the required input.', 'Workflow author', 'After reducing the input'),
  LLM_RATE_LIMIT_REQUEST_TOO_LARGE: guide('This case’s request exceeds the provider token limit for a single request.', 'Shorten supplementary context or choose a model that supports the required input.', 'Workflow author', 'After reducing the input'),
  LLM_CONTEXT_LIMIT: guide('This case exceeds the selected model’s context window.', 'Shorten supplementary context or choose a model with a larger context window.', 'Workflow author', 'After reducing the input'),
  LLM_PROVIDER_UNAVAILABLE: guide('The model provider did not complete the request.', 'Check the integration status and provider capacity.', 'Model integration administrator', 'After the provider recovers'),
  NODE_EXECUTION_FAILED: guide('The node stopped before returning a complete result.', 'Review the node input, recorded activity and operation history to identify the failing dependency.', 'Workflow author', 'After reviewing the operation history')
};

function failureResolution(classification, code, outcomeUnknown, effectDispatched = false) {
  const resolution = resolutions[classification] || resolutions[code];
  if (!resolution) return undefined;
  const retry = outcomeUnknown ? 'Reconciliation required' : effectDispatched ? 'After checking prior actions and resetting the test data' : resolution.retry;
  return {...resolution,retry};
}

module.exports = { failureResolution };
