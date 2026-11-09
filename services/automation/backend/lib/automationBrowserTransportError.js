const browserTransportMessages = Object.freeze({
  AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED: 'TestEngine rejected the browser connection (HTTP 401). Check that HelloTest and TestEngine use the same shared secret, then reconnect before rebuilding. Previously saved Plan sections remain available.',
  AUTOMATION_BROWSER_ENGINE_ACCESS_DENIED: 'TestEngine denied the browser connection (HTTP 403). Check the engine access policy and paired browser authorization, then reconnect before rebuilding. Previously saved Plan sections remain available.',
  AUTOMATION_BROWSER_SESSION_EXPIRED: 'The automation browser session expired or is unavailable. Reconnect and review the current application state before rebuilding. Previously saved Plan sections remain available.',
  AUTOMATION_BROWSER_ENGINE_UNAVAILABLE: 'The browser connection to TestEngine is unavailable. Check the engine connection and review the current application state before rebuilding. Previously saved Plan sections remain available.',
  AUTOMATION_BROWSER_PROTOCOL_INVALID: 'TestEngine returned an incompatible browser response. Check that HelloTest and TestEngine use compatible versions, then reconnect before rebuilding. Previously saved Plan sections remain available.'
});

function browserTransportError(status, { method, protocol = false } = {}) {
  const code = protocol ? 'AUTOMATION_BROWSER_PROTOCOL_INVALID'
    : status === 401 ? 'AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED'
      : status === 403 ? 'AUTOMATION_BROWSER_ENGINE_ACCESS_DENIED'
        : [404, 410].includes(status) && method !== 'initialize' ? 'AUTOMATION_BROWSER_SESSION_EXPIRED'
          : 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE';
  return Object.assign(new Error(browserTransportMessages[code]), {
    code, statusCode: protocol ? 502 : status, nonRetryable: true,
    // A rejected request is not a browser receipt. Do not grant permission to
    // replay a mutation or automatically start a replacement browser session.
    retry_safe: false,
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { upstreamStatusCode: status } : {})
  });
}

const isBrowserTransportError = error => Object.hasOwn(browserTransportMessages, error?.code);
module.exports = { browserTransportError, browserTransportMessages, isBrowserTransportError };
