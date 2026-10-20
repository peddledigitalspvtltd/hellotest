function receipt(result) {
  for (const part of result?.content || []) {
    if (part?.type !== 'text' || typeof part.text !== 'string' || part.text.length > 64 * 1024) continue;
    try { const value = JSON.parse(part.text); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch {}
  }
  return {};
}

const navigationHttpStatus = value => Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
function navigationHttpFailureMessage(value) {
  const status = navigationHttpStatus(value);
  if (status === null) return null;
  const guidance = [401, 403].includes(status) ? 'Check the application authentication and access requirements.'
    : [404, 410].includes(status) ? 'Review the saved Start URL and application route.'
      : status === 429 ? 'Wait for the application rate limit to clear before retrying.'
        : status >= 500 ? 'Check application availability and upstream services before retrying.'
          : 'Review the saved Start URL and application access before retrying.';
  return `The selected application returned HTTP ${status} while opening the Start URL. ${guidance} No navigation was retried.`;
}

function startupDiagnostic(observed, browserCode, tool) {
  const { sanitize } = require('@hellotest/platform/backend/src/utils/llmTraceCapture');
  const sanitized = sanitize(String(observed.message || '')).payload;
  if (typeof sanitized !== 'string' || !sanitized.trim()) return null;
  const diagnostic = { code: browserCode, launch_phase: 'startup', browser_tool: tool,
    ...(['proxy', 'browser', 'context', 'page'].includes(observed.startup_stage) ? { startup_stage: observed.startup_stage } : {}), message: sanitized };
  // Retain both the launch heading and fatal tail after redaction. Bound the
  // serialized artifact, including multibyte text and JSON escaping.
  const characters = Array.from(sanitized);
  let limit = Math.min(characters.length, 1800);
  do {
    diagnostic.message = characters.length <= limit ? sanitized
      : `${characters.slice(0, Math.floor(limit / 2)).join('')}\n[DIAGNOSTIC_TRUNCATED]\n${characters.slice(-Math.ceil(limit / 2)).join('')}`;
    if (Buffer.byteLength(JSON.stringify(diagnostic), 'utf8') <= 2048) return diagnostic;
    limit -= 100;
  } while (limit > 0);
  return null;
}

/** Retry a bootstrap failure only when MCP confirms no browser action began. */
function browserBootstrapFailure(result, { tool = 'browser_navigate', cause } = {}) {
  const observed = receipt(result);
  const browserCode = typeof observed.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(observed.code) ? observed.code : null;
  const notAttempted = observed.action_outcome === 'not_attempted' && observed.retry_safe === true;
  const policyFailure = /AUTH|FORBIDDEN|PERMISSION|INVALID|POLICY|ORIGIN|HOST|URL/.test(browserCode || '');
  const launchFailure = browserCode === 'BROWSER_LAUNCH_FAILED' && observed.launch_phase === 'startup'
    || browserCode === 'BROWSER_TOOL_FAILED' && /^\s*browserType\.launch:/i.test(String(observed.message || ''));
  const retrySafe = tool === 'browser_navigate' && notAttempted && launchFailure && !policyFailure && !cause;
  const httpStatus = tool === 'browser_navigate' && ['BROWSER_NAVIGATION_FAILED', 'BROWSER_PAGE_NOT_READY'].includes(browserCode) && !cause ? navigationHttpStatus(observed.http_status) : null;
  const code = httpStatus ? 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR' : retrySafe ? 'AUTOMATION_BROWSER_STARTUP_FAILED'
    : observed.action_outcome === 'unknown' || cause ? 'AUTOMATION_BROWSER_BOOTSTRAP_OUTCOME_UNKNOWN' : 'AUTOMATION_BROWSER_INSPECTION_FAILED';
  const message = httpStatus ? navigationHttpFailureMessage(httpStatus) : retrySafe
    ? 'The automation browser could not start before any test action. Check the TestEngine browser runtime; this build can be retried safely.'
    : code === 'AUTOMATION_BROWSER_BOOTSTRAP_OUTCOME_UNKNOWN'
      ? 'The initial browser inspection did not return a confirmed outcome. Further actions stopped; inspect TestEngine before starting another build.'
      : 'The automation browser could not inspect the selected application. Review its URL, access and browser readiness before starting another build.';
  const error = Object.assign(new Error(message), {
    code, statusCode: retrySafe ? 503 : 422, nonRetryable: !retrySafe,
    action_outcome: observed.action_outcome || 'unknown', retry_safe: retrySafe,
    browser_code: browserCode, browser_tool: tool, ...(retrySafe ? { launch_phase: 'startup' } : {}), ...(cause ? { cause } : {}),
    ...(httpStatus ? { http_status: httpStatus } : {})
  });
  // Protected artifact input only: never serialize into public outcomes or
  // include browser process diagnostics in generation prompts.
  if (retrySafe) {
    const diagnostic = startupDiagnostic(observed, browserCode, tool);
    if (diagnostic) Object.defineProperty(error, 'browser_diagnostic', { value: diagnostic });
  }
  return error;
}

module.exports = { browserBootstrapFailure, navigationHttpStatus, navigationHttpFailureMessage };
