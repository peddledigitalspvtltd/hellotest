/** A provider-declared JSON generation rejection produced no usable decision.
 * Retry that model request once while its caller retains the browser, receipts,
 * permissions and original deadline. Other errors never enter this recovery. */
async function retryActorJsonOutput(task, { browserActor = false, timeoutMs = 90_000, signal, onRetry } = {}) {
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 90_000);
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('The model request was cancelled.'), { name: 'AbortError' });
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('The model request deadline elapsed before dispatch.'), { code: 'DEADLINE_EXCEEDED', statusCode: 504 });
    try { return await task({ timeoutMs: remaining, signal }); }
    catch (error) {
      if (browserActor !== true || attempt !== 1 || error?.name === 'AbortError'
        || error?.code !== 'LLM_REQUEST_REJECTED' || error?.upstreamStatusCode !== 400
        || error?.provider_error?.code !== 'json_validate_failed') throw error;
      if (signal?.aborted) throw signal.reason || error;
      if (Date.now() >= deadline) throw error;
      // Only fixed protocol identifiers enter progress; provider bodies may
      // contain credentials, prompts or partial untrusted generated content.
      await onRetry?.({ attempt: 2, max_attempts: 2, error_code: 'LLM_REQUEST_REJECTED', provider_error_code: 'json_validate_failed' });
    }
  }
}

module.exports = { retryActorJsonOutput };
