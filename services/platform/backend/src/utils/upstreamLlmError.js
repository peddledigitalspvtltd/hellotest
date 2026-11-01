const AUTH_STATUSES = new Set([401, 403]);
const { readLlmRetryAfterMs } = require('./llmCapacityRetry');

const { sanitizeAiText } = require('../security/aiTextPolicy');
// A provider may echo the full prompt or credentials in its error message.
// Preserve bounded protocol identifiers, never that body or arbitrary prose.
const token = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)
  && sanitizeAiText(value).text === value ? value : undefined;
function diagnostics(raw, headers) {
  let parsed; try { parsed = JSON.parse(raw); } catch { /* A non-JSON response still has a useful request header. */ }
  const detail = parsed?.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error) ? parsed.error : {};
  const fields = Object.fromEntries(['code', 'type'].flatMap(key => detail[key] === null ? [[key, null]] : token(detail[key]) ? [[key, detail[key]]] : []));
  if (detail.param === null) fields.param = null;
  else if (typeof detail.param === 'string' && /^(?:messages|response_format|model|temperature|top_p|max_tokens|max_completion_tokens|tools|tool_choice|stream|stop|n|seed)(?:[.\[\]A-Za-z0-9_-]){0,100}$/.test(detail.param)) fields.param = detail.param;
  const header = name => typeof headers?.get === 'function' ? headers.get(name)
    : Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const requestId = header('x-request-id') || header('request-id');
  if (typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(requestId) && sanitizeAiText(requestId).text === requestId) fields.request_id = requestId;
  return fields;
}

exports.createLlmProviderError = ({ status, detail, retryAfterMs, headers } = {}) => {
  const statusCode = Number(status || 0);
  const raw = String(detail || '').slice(0, 16_000);
  const quota = statusCode === 429 && /insufficient_quota|quota_exceeded|billing_hard_limit|billing_not_active|payment_required|credits?[_\s]+(?:exhausted|insufficient)|(?:tokens?|requests?)\s+per\s+day|daily\s+(?:token|request|usage)\s+limit/i.test(raw);
  const tokenCounts = /(?:tokens?|\b[IO]?TPM\b|request\s+too\s+large)/i.test(raw) && raw.match(/limit\s*:?\s*([\d,]+)[\s\S]*?requested\s*:?\s*([\d,]+)/i);
  const tooLarge = statusCode === 429 && (/request\s+(?:is\s+)?too\s+large/i.test(raw) || Boolean(tokenCounts && Number(tokenCounts[2].replace(/,/g, '')) > Number(tokenCounts[1].replace(/,/g, ''))));
  const requestTooLarge = statusCode === 413;
  const jsonInstruction = [400, 422].includes(statusCode) && /messages[\s\S]{0,100}contain[\s\S]{0,80}(?:word[\s\S]{0,20})?['"]?json['"]?/i.test(raw) && /json_object|response_format/i.test(raw);
  const contextLimit = statusCode === 413 || [400, 422].includes(statusCode) && /context_length_exceeded|maximum context length|context window/i.test(raw);
  const code = AUTH_STATUSES.has(statusCode) ? 'LLM_AUTHENTICATION_FAILED' : requestTooLarge ? 'LLM_REQUEST_TOO_LARGE' : quota ? 'LLM_QUOTA_EXCEEDED' : tooLarge ? 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE' : statusCode === 429 ? 'LLM_RATE_LIMITED'
    : jsonInstruction ? 'LLM_JSON_INSTRUCTION_REQUIRED' : contextLimit ? 'LLM_CONTEXT_LIMIT'
      : statusCode === 404 ? 'LLM_MODEL_NOT_FOUND' : [400, 422].includes(statusCode) ? 'LLM_REQUEST_REJECTED' : [408, 504].includes(statusCode) ? 'LLM_TIMEOUT' : 'LLM_PROVIDER_UNAVAILABLE';
  const message = AUTH_STATUSES.has(statusCode)
    ? `LLM integration rejected the request with status ${statusCode}. Check the selected provider credentials, model access, and base URL.`
    : requestTooLarge ? 'The selected model provider rejected this request because it is too large. Reduce the request size or select an integration that supports it.'
    : quota ? 'The selected model provider has exhausted its available quota or billing allowance. Review the integration usage and billing settings.'
    : tooLarge ? 'This model request exceeds the provider token rate limit even when idle. Reduce the request size or select an integration with sufficient capacity.'
    : statusCode === 429 ? 'The selected model provider temporarily rejected this request because its rate limit was reached.'
    : jsonInstruction ? 'The model rejected JSON output mode because its messages did not include a JSON instruction. Check the saved AI instructions and request configuration before starting a new run.'
    : contextLimit ? 'The selected model rejected this request because its context limit was exceeded. Narrow the supplied context or select a compatible model.'
    : statusCode === 404 ? 'The selected model or provider endpoint was not found. Check the integration model and base URL.'
    : [400, 422].includes(statusCode) ? 'The model provider rejected the request parameters. Check the selected model, output format and AI configuration.'
    : [408, 504].includes(statusCode) ? 'The selected model provider did not respond within its timeout.'
    : `The selected model provider could not complete the request (HTTP ${statusCode || "unknown"}).`;
  const error = new Error(message);

  error.statusCode = AUTH_STATUSES.has(statusCode) ? 502 : statusCode || 502;
  error.upstreamStatusCode = statusCode || undefined;
  error.publicMessage = message;
  error.provider_error = diagnostics(raw, headers);
  if (code) error.code = code;
  if (AUTH_STATUSES.has(statusCode)) { error.retryable = false; error.nonRetryable = true; }
  if (statusCode === 429) { error.providerRejected = true; error.retryable = !quota && !tooLarge; }
  if (quota || tooLarge || requestTooLarge) { error.nonRetryable = true; error.retryable = false; }
  if (statusCode >= 400 && statusCode < 500 && ![408, 429].includes(statusCode)) { error.nonRetryable = true; error.retryable = false; }

  const delay = retryAfterMs == null ? readLlmRetryAfterMs({ headers, detail: raw }) : Number(retryAfterMs);
  if (Number.isFinite(delay) && delay >= 0) {
    error.retryAfterMs = delay;
  }

  return error;
};
