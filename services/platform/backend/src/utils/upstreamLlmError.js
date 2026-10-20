const AUTH_STATUSES = new Set([401, 403]);
const { readLlmRetryAfterMs } = require('./llmCapacityRetry');

const trimProviderDetail = (value, maxLength = 240) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

exports.createLlmProviderError = ({ status, detail, retryAfterMs, headers } = {}) => {
  const statusCode = Number(status || 0);
  const providerDetail = trimProviderDetail(detail);
  const raw = String(detail || '').slice(0, 16_000);
  const quota = statusCode === 429 && /insufficient_quota|quota_exceeded|billing_hard_limit|billing_not_active|payment_required|credits?[_\s]+(?:exhausted|insufficient)|(?:tokens?|requests?)\s+per\s+day|daily\s+(?:token|request|usage)\s+limit/i.test(raw);
  const tokenCounts = /(?:tokens?|\b[IO]?TPM\b|request\s+too\s+large)/i.test(raw) && raw.match(/limit\s*:?\s*([\d,]+)[\s\S]*?requested\s*:?\s*([\d,]+)/i);
  const tooLarge = statusCode === 429 && (/request\s+(?:is\s+)?too\s+large/i.test(raw) || Boolean(tokenCounts && Number(tokenCounts[2].replace(/,/g, '')) > Number(tokenCounts[1].replace(/,/g, ''))));
  const requestTooLarge = statusCode === 413;
  const code = AUTH_STATUSES.has(statusCode) ? 'LLM_AUTHENTICATION_FAILED' : requestTooLarge ? 'LLM_REQUEST_TOO_LARGE' : quota ? 'LLM_QUOTA_EXCEEDED' : tooLarge ? 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE' : statusCode === 429 ? 'LLM_RATE_LIMITED' : undefined;
  const message = AUTH_STATUSES.has(statusCode)
    ? `LLM integration rejected the request with status ${statusCode}. Check the selected provider credentials, model access, and base URL.`
    : requestTooLarge ? 'The selected model provider rejected this request because it is too large. Reduce the request size or select an integration that supports it.'
    : quota ? 'The selected model provider has exhausted its available quota or billing allowance. Review the integration usage and billing settings.'
    : tooLarge ? 'This model request exceeds the provider token rate limit even when idle. Reduce the request size or select an integration with sufficient capacity.'
    : statusCode === 429 ? 'The selected model provider temporarily rejected this request because its rate limit was reached.'
    : `LLM request failed with status ${statusCode || "unknown"}${providerDetail ? `: ${providerDetail}` : ""}`;
  const error = new Error(message);

  error.statusCode = AUTH_STATUSES.has(statusCode) ? 502 : statusCode || 502;
  error.upstreamStatusCode = statusCode || undefined;
  if (code) error.code = code;
  if (AUTH_STATUSES.has(statusCode)) { error.retryable = false; error.nonRetryable = true; }
  if (statusCode === 429) { error.providerRejected = true; error.retryable = !quota && !tooLarge; }
  if (quota || tooLarge || requestTooLarge) { error.nonRetryable = true; error.retryable = false; }

  const delay = retryAfterMs == null ? readLlmRetryAfterMs({ headers, detail: raw }) : Number(retryAfterMs);
  if (Number.isFinite(delay) && delay >= 0) {
    error.retryAfterMs = delay;
  }

  return error;
};
