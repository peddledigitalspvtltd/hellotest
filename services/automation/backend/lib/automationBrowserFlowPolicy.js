const automationBrowserScope = Object.freeze({
  pages: 'single_page', navigation: 'configured_application_origin', popups: 'unsupported', external_sso: 'unsupported',
  unsupported_flow_policy: 'stop_and_reconcile_without_replay'
});
const unsupportedCapabilities = new Set(['new_page', 'cross_origin_navigation']);
const unsupportedBrowserFlowMessage = capability => `Automation Engineer supports one page within the configured application origin. ${capability === 'new_page'
  ? 'This flow opened a popup or a new tab.' : 'This flow requires cross-origin navigation or external SSO.'} Use a single-page, same-origin flow; this runner cannot build the requested browser transition. Inspect the original application state before retrying. The action was not replayed.`;

function unsupportedBrowserFlowError(receipt) {
  if (receipt?.source !== 'playwright' || receipt.code !== 'BROWSER_FLOW_UNSUPPORTED' || !unsupportedCapabilities.has(receipt.unsupported_capability)) return null;
  return Object.assign(new Error(unsupportedBrowserFlowMessage(receipt.unsupported_capability)), {
    code: 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED', statusCode: 422, nonRetryable: true,
    unsupported_capability: receipt.unsupported_capability,
    action_outcome: ['unknown', 'completed', 'not_attempted'].includes(receipt.action_outcome) ? receipt.action_outcome : 'unknown',
    retry_safe: false
  });
}
function unsupportedBrowserFlowResult(result) {
  if (!result?.isError) return null;
  for (const part of result.content || []) if (part?.type === 'text' && typeof part.text === 'string' && part.text.length <= 64 * 1024) {
    try { const error = unsupportedBrowserFlowError(JSON.parse(part.text)); if (error) return error; } catch { /* Unstructured tool errors retain their ordinary classification. */ }
  }
  return null;
}
module.exports = { automationBrowserScope, unsupportedBrowserFlowError, unsupportedBrowserFlowResult, unsupportedBrowserFlowMessage };
