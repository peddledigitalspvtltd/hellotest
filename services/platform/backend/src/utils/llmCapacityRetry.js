const statusOf = error => Number(error?.upstreamStatusCode || error?.upstreamStatus || error?.statusCode || error?.status || 0);

function durationMs(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text.length > 100) return null;
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)/g)];
  if (!parts.length || text.replace(/(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)/g, '').trim()) return null;
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const total = Math.ceil(parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0));
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

/** Every valid provider hint is a minimum. Reset headers are considered only
 * for an exhausted resource; unrelated RPD resets must not delay a TPM retry. */
function readLlmRetryAfterMs({ headers, detail = '', now = Date.now() } = {}) {
  const get = name => headers?.get?.(name) ?? (headers && Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]);
  const waits = [];
  const raw = get('retry-after');
  if (raw != null && String(raw).trim()) {
    const value = String(raw).trim();
    if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) { const ms = Math.ceil(Number(value) * 1000); if (Number.isSafeInteger(ms) && ms >= 0) waits.push(ms); }
    else { const date = Date.parse(value); if (Number.isFinite(date)) waits.push(Math.max(0, date - now)); }
  }
  const text = String(detail || '').slice(0, 16_000);
  for (const bodyWait of text.matchAll(/(?:try\s+again\s+in|retry\s+(?:in|after))\s*((?:\d+(?:\.\d+)?\s*(?:ms|d|h|m|s)\s*)+)/gi)) {
    const explicitBodyWait = durationMs(bodyWait[1]);
    if (explicitBodyWait != null) waits.push(explicitBodyWait);
  }
  for (const resource of ['tokens', 'requests']) {
    const remaining = get(`x-ratelimit-remaining-${resource}`), reset = durationMs(get(`x-ratelimit-reset-${resource}`));
    if (remaining != null && /^\d+(?:\.\d+)?$/.test(String(remaining).trim()) && Number(remaining) === 0 && reset != null) waits.push(reset);
  }
  return waits.length ? Math.max(...waits) : null;
}

const isLlmCapacityError = error => error?.retryable !== false && error?.nonRetryable !== true && statusOf(error) === 429;

const waitForCapacity = (delay, signal) => new Promise((resolve, reject) => {
  const cancelled = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); reject(signal?.reason || Object.assign(new Error('The model request was cancelled.'), { name: 'AbortError' })); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, delay);
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) cancelled();
});

/** Retry one explicitly rejected provider generation while its caller retains
 * the browser/session. Never retry transport uncertainty, successful output,
 * billing/quota rejection, oversized requests or application actions. */
async function retryLlmCapacity(task, { timeoutMs = 90_000, deadlineMs, signal, maxAttempts = 3, maxDelayMs = 60_000, onWait } = {}) {
  const started = Date.now(), deadline = Math.min(started + Math.max(1, Number(timeoutMs) || 90_000), Number.isFinite(deadlineMs) ? deadlineMs : Infinity);
  const attempts = Math.max(1, Math.min(3, Number.parseInt(maxAttempts, 10) || 3));
  const delayLimit = Math.max(0, Math.min(60_000, Math.floor(Number(maxDelayMs) || 0)));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('The model request was cancelled.'), { name: 'AbortError' });
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('The model request deadline elapsed before dispatch.'), { code: 'DEADLINE_EXCEEDED', statusCode: 504 });
    try { return await task({ attempt, timeoutMs: remaining, signal }); }
    catch (error) {
      const minimumDelay = error?.retryAfterMs;
      if (attempt >= attempts || error?.code !== 'LLM_RATE_LIMITED' || error?.providerRejected !== true || !isLlmCapacityError(error)
        || !Number.isFinite(minimumDelay) || minimumDelay < 0 || minimumDelay > delayLimit) throw error;
      // Provider estimates and integer headers can round down near a token
      // reset. Wait a bounded allowance beyond every advertised minimum,
      // without shortening a long minimum or extending the caller deadline.
      const delay = Math.min(delayLimit, Math.ceil(minimumDelay) + 1000);
      if (delay + 1000 >= deadline - Date.now()) throw error;
      if (signal?.aborted) throw signal.reason || error;
      await onWait?.({ attempt: attempt + 1, max_attempts: attempts, delay_ms: delay, provider_minimum_delay_ms: minimumDelay, error_code: error.code });
      if (delay + 1000 >= deadline - Date.now()) throw error;
      await waitForCapacity(delay, signal);
    }
  }
}

module.exports = { retryLlmCapacity, readLlmRetryAfterMs, isLlmCapacityError, durationMs };
