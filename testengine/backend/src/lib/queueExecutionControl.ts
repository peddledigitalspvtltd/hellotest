/** One sequential control channel per case attempt. Losing authority stops
 * further application actions; it never grants permission to retry them. */
export function createQueueExecutionControl(options: {
  authorize: (signal: AbortSignal) => Promise<void | { lease_expires_at?: string | null }>;
  onAbort: () => void;
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
  initialLeaseExpiresAt?: string | null;
  retryDelayMs?: number;
  onRetry?: (details: { attempt: number; remainingLeaseMs: number; error: unknown }) => void;
}) {
  const controller = new AbortController();
  let disposed = false, lostAuthority = false;
  let nextCheck: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let leaseDeadline: ReturnType<typeof setTimeout> | undefined;
  let leaseExpiresAt = Date.parse(options.initialLeaseExpiresAt || '');
  let started = false;
  let inFlight: Promise<void> | null = null;
  const abort = (reason: unknown, unauthorized = true) => {
    if (disposed || controller.signal.aborted) return;
    lostAuthority = unauthorized;
    controller.abort(reason instanceof Error ? reason : new Error("The queued execution is no longer authorized."));
    clearTimeout(nextCheck);
    clearTimeout(leaseDeadline);
    options.onAbort();
  };
  const fromCaller = () => abort(options.signal?.reason);
  options.signal?.addEventListener("abort", fromCaller, { once: true });
  if (options.signal?.aborted) fromCaller();
  const scheduleLeaseDeadline = () => {
    clearTimeout(leaseDeadline);
    if (!started || !Number.isFinite(leaseExpiresAt) || disposed || controller.signal.aborted) return;
    // Stop before the server may reclaim this attempt. A timed-out heartbeat
    // never proves that an unacknowledged renewal was committed.
    leaseDeadline = setTimeout(() => abort(new Error('The queued execution could not renew its confirmed lease before expiry.')), Math.max(1, leaseExpiresAt - Date.now() - 1000));
    leaseDeadline.unref?.();
  };
  const pause = (milliseconds: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { controller.signal.removeEventListener('abort', cancelled); resolve(); }
    function cancelled() { clearTimeout(timer); controller.signal.removeEventListener('abort', cancelled); reject(controller.signal.reason); }
    controller.signal.addEventListener('abort', cancelled, { once: true });
    if (controller.signal.aborted) cancelled();
  });
  const authorize = async () => {
    let attempt = 0;
    for (;;) {
      if (disposed) return;
      controller.signal.throwIfAborted();
      try {
        const receipt = await options.authorize(controller.signal);
        if (receipt && receipt.lease_expires_at != null) {
          const expiry = typeof receipt.lease_expires_at === 'string' ? Date.parse(receipt.lease_expires_at) : NaN;
          if (!Number.isFinite(expiry) || expiry <= Date.now() + 1000) throw new Error('The queued execution returned an invalid or expired lease receipt.');
          leaseExpiresAt = expiry;
          scheduleLeaseDeadline();
        }
        return;
      } catch (error) {
        if (disposed) return;
        controller.signal.throwIfAborted();
        const failure = error as { code?: string; status?: number };
        const transient = ['REQUEST_TIMEOUT', 'REQUEST_FAILED', 'REQUEST_ABORTED'].includes(failure?.code || '')
          || failure?.code === 'HTTP_ERROR' && [408, 429, 500, 502, 503, 504].includes(failure.status || 0);
        const remainingLeaseMs = leaseExpiresAt - Date.now() - 1000;
        const delay = Math.min(2000, Math.max(1, options.retryDelayMs ?? 250) * 2 ** Math.min(attempt, 3));
        if (!transient || !Number.isFinite(remainingLeaseMs) || remainingLeaseMs <= delay) { abort(error); throw error; }
        attempt++;
        try { options.onRetry?.({ attempt, remainingLeaseMs, error }); } catch { /* Diagnostics never change lease authority. */ }
        await pause(delay);
      }
    }
  };
  const check = async () => {
    controller.signal.throwIfAborted();
    if (disposed) return;
    if (!inFlight) {
      inFlight = authorize().finally(() => { inFlight = null; });
    }
    await inFlight;
    controller.signal.throwIfAborted();
  };
  const schedule = () => {
    if (disposed || controller.signal.aborted) return;
    nextCheck = setTimeout(() => {
      void check().catch(() => undefined).finally(schedule);
    }, Math.max(1, options.intervalMs ?? 5000));
    nextCheck.unref?.();
  };
  return {
    signal: controller.signal,
    get authorityLost() { return lostAuthority; },
    check,
    start() {
      if (disposed || controller.signal.aborted || deadline) return;
      started = true;
      deadline = setTimeout(() => abort(new Error("The queued execution exceeded its run timeout."), false), Math.max(1, options.timeoutMs));
      deadline.unref?.();
      scheduleLeaseDeadline();
      schedule();
    },
    stop() {
      disposed = true;
      clearTimeout(deadline);clearTimeout(nextCheck);clearTimeout(leaseDeadline);
      options.signal?.removeEventListener("abort", fromCaller);
    }
  };
}
