// A generation POST can finish at the provider even if its client loses the
// response. Retry only explicit rejection or a local pre-dispatch boundary.
const SAFE_BOUNDARY_CODES = new Set(['DEPENDENCY_CIRCUIT_OPEN', 'DEPENDENCY_OVERLOADED']);
const upstreamStatus = error => Number(error?.upstreamStatusCode || error?.upstreamStatus || error?.statusCode || 0);
const isAiCapacityError = error => upstreamStatus(error) === 429;
const isRetryableLlmError = error => {
  if (error?.nonRetryable === true || error?.retryable === false || /^AI_|^INVALID_AI_/i.test(String(error?.code || ''))) return false;
  return isAiCapacityError(error) || SAFE_BOUNDARY_CODES.has(error?.code);
};
function isRetryableGenerationError(error, { bufferedProposal = false } = {}) {
  if (error?.nonRetryable === true || error?.retryable === false || error?.generation_received === true || /^AI_|^INVALID_AI_/i.test(String(error?.code || ''))) return false;
  return isRetryableLlmError(error) || bufferedProposal === true && ['DEPENDENCY_NETWORK_ERROR', 'DEPENDENCY_TIMEOUT', 'DEPENDENCY_UNAVAILABLE'].includes(error?.code);
}
module.exports = { isAiCapacityError, isRetryableLlmError, isRetryableGenerationError };
