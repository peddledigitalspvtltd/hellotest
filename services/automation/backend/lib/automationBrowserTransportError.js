const { networkFailureCode } = require('@hellotest/platform/backend/src/utils/serviceErrors');
const browserTransportMessages = Object.freeze({
  AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED: 'TestEngine rejected the browser connection (HTTP 401). Check that HelloTest and TestEngine use the same shared secret, then reconnect before rebuilding.',
  AUTOMATION_BROWSER_ENGINE_ACCESS_DENIED: 'TestEngine denied the browser connection (HTTP 403). Check the engine access policy and paired browser authorization, then reconnect before rebuilding.',
  AUTOMATION_BROWSER_SESSION_EXPIRED: 'The automation browser session expired or is unavailable. Reconnect and review the current application state before rebuilding.',
  AUTOMATION_BROWSER_ENGINE_UNAVAILABLE: 'The browser connection to TestEngine is unavailable. Check the engine connection and review the current application state before rebuilding.',
  AUTOMATION_BROWSER_PROTOCOL_INVALID: 'TestEngine returned an incompatible browser response. Check that HelloTest and TestEngine use compatible versions, then reconnect before rebuilding.',
  BROWSER_TRANSPORT_TIMEOUT: 'The browser request to TestEngine reached its transport deadline. Review the current application state before rebuilding.'
});

function browserTransportError(status, { method, protocol = false, timeout = false, cause, tool } = {}) {
  const responseReceived = Number.isInteger(status);
  const httpError = responseReceived && status >= 400 && status <= 599;
  const transportCode = networkFailureCode(cause);
  const operation = ['initialize','notifications/initialized','tools/list','tools/call'].includes(method) ? method : 'browser request';
  const path = typeof tool === 'string' && /^browser_[a-z0-9_]{1,48}$/.test(tool) ? `/browser_tools/${tool}` : '/browser_transport';
  const code = timeout ? 'BROWSER_TRANSPORT_TIMEOUT' : protocol ? 'AUTOMATION_BROWSER_PROTOCOL_INVALID'
    : status === 401 ? 'AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED'
      : status === 403 ? 'AUTOMATION_BROWSER_ENGINE_ACCESS_DENIED'
        : [404, 410].includes(status) && method !== 'initialize' ? 'AUTOMATION_BROWSER_SESSION_EXPIRED'
          : 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE';
  const detail = timeout ? `TestEngine ${operation} did not finish within its transport deadline${responseReceived ? ` after HTTP ${status} headers` : ' before an HTTP response was received'}.`
    : protocol ? `TestEngine ${operation} returned an invalid MCP response${responseReceived ? ` with HTTP ${status}` : ''}.`
      : httpError ? `TestEngine returned HTTP ${status} for ${operation}.`
        : `${responseReceived ? `TestEngine's HTTP ${status} response was interrupted` : 'No HTTP response was received from TestEngine'} for ${operation}${transportCode ? ` (${transportCode})` : ''}.`;
  return Object.assign(new Error(browserTransportMessages[code]), {
    code, statusCode: timeout ? 504 : protocol ? 502 : httpError ? status : 503, nonRetryable: true,
    ...(timeout ? {name:'TimeoutError'} : {}),
    publicMessage: browserTransportMessages[code],
    validation_errors: [{path,keyword:timeout?'browser_transport_timeout':protocol?'browser_protocol_invalid':httpError?'browser_http_error':'browser_network_error',message:detail}],
    // A rejected request is not a browser receipt. Do not grant permission to
    // replay a mutation or automatically start a replacement browser session.
    retry_safe: false,
    ...(httpError ? { upstreamStatusCode: status } : {}),
    ...(transportCode ? {transport_error_code:transportCode} : {})
  });
}

const isBrowserTransportError = error => Object.hasOwn(browserTransportMessages, error?.code);
module.exports = { browserTransportError, browserTransportMessages, isBrowserTransportError };
