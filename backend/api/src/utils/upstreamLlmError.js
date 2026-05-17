const AUTH_STATUSES = new Set([401, 403]);

const trimProviderDetail = (value, maxLength = 240) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

exports.createLlmProviderError = ({ status, detail, retryAfterMs } = {}) => {
  const statusCode = Number(status || 0);
  const providerDetail = trimProviderDetail(detail);
  const message = AUTH_STATUSES.has(statusCode)
    ? `LLM integration rejected the request with status ${statusCode}. Check the selected provider credentials, model access, and base URL${providerDetail ? `: ${providerDetail}` : "."}`
    : `LLM request failed with status ${statusCode || "unknown"}${providerDetail ? `: ${providerDetail}` : ""}`;
  const error = new Error(message);

  error.statusCode = AUTH_STATUSES.has(statusCode) ? 502 : statusCode || 502;
  error.upstreamStatusCode = statusCode || undefined;

  if (Number.isFinite(Number(retryAfterMs)) && Number(retryAfterMs) > 0) {
    error.retryAfterMs = Number(retryAfterMs);
  }

  return error;
};
