// A generation POST can finish at the provider even if its client loses the
// response. Retry only explicit rejection or a local pre-dispatch boundary.
const SAFE_BOUNDARY_CODES = new Set(['DEPENDENCY_CIRCUIT_OPEN', 'DEPENDENCY_OVERLOADED']);
const upstreamStatus = error => Number(error?.upstreamStatusCode || error?.upstreamStatus || error?.statusCode || 0);
const isAiCapacityError = error => upstreamStatus(error) === 429;
const isRetryableLlmError = error => {
  if (error?.retryable === false || /^AI_|^INVALID_AI_/i.test(String(error?.code || ''))) return false;
  return isAiCapacityError(error) || SAFE_BOUNDARY_CODES.has(error?.code);
};
module.exports = { isAiCapacityError, isRetryableLlmError };
