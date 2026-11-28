function browserEntryError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), {
    code, publicMessage: message, statusCode, nonRetryable: true,
    effect_dispatched: false, outcome_unknown: false, failure_stage: 'browser_startup'
  });
}

function assertBrowserEntry(result, httpStatus) {
  // A login screen may be returned with HTTP 401. Let the Engineer observe
  // that screen so the authored sign-in step can use its configured inputs.
  if (httpStatus >= 400 && httpStatus <= 599 && httpStatus !== 401) {
    const { navigationHttpFailureMessage } = require('./automationBrowserBootstrapFailure');
    throw Object.assign(browserEntryError('AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR', navigationHttpFailureMessage(httpStatus)), {
      http_status: httpStatus
    });
  }
  const pageEvidence = Array.isArray(result?.content) && result.content.some(block =>
    block?.type === 'text' && typeof block.text === 'string' && block.text.trim());
  if (result?.isError || !pageEvidence) throw browserEntryError(
    'AUTOMATION_BROWSER_ENTRY_UNAVAILABLE',
    'The build browser could not open the application Start URL. Check the route and its network or access requirements.'
  );
}

async function probeBrowserEntry({ integration, startUrl, signal, retryStartup = false, beforeConnect = async () => {} }) {
  const browserDeadlineMs = 7_000;
  const deadline = Date.now() + browserDeadlineMs;
  const timeout = AbortSignal.timeout(browserDeadlineMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const { trustedNavigationHttpStatus } = require('../upstream/automationUpstreamMcpClient');
  const { connectPreviewBrowser } = require('../upstream/automationPreviewBrowser');
  let browser;
  try {
    browser = await connectPreviewBrowser({ integration, startUrl, signal: requestSignal, cleanupTimeoutMs: 500 }, {
      retryStartup,onProgress:async()=>{},beforeConnect
    });
    if (!browser.tools.some(tool => tool.name === 'browser_navigate')) throw browserEntryError(
      'AUTOMATION_UPSTREAM_MCP_UNSUPPORTED', 'The selected browser runtime cannot open an application. Update Test Engine or the paired browser agent.', 503
    );
    const opened = await browser.call('browser_navigate', { url: browser.startUrl }, { deadlineMs: deadline });
    assertBrowserEntry(opened, trustedNavigationHttpStatus(opened));
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw browserEntryError(
      browser ? 'AUTOMATION_BROWSER_ENTRY_TIMEOUT' : 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE',
      browser ? 'The Start URL did not respond within seven seconds from the build browser. Check the application and its connection.'
        : 'The build browser did not respond within seven seconds. Check the Test Engine connection.', 503
    );
    if (Object.isExtensible(error)) Object.assign(error, { effect_dispatched: false, outcome_unknown: false, failure_stage: 'browser_startup' });
    throw error;
  } finally {
    if (browser) void browser.close();
  }
}

module.exports = { browserEntryError, assertBrowserEntry, probeBrowserEntry };
