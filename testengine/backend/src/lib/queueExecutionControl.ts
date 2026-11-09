/** One sequential control channel per case attempt. Losing authority stops
 * further application actions; it never grants permission to retry them. */
export function createQueueExecutionControl(options: {
  authorize: (signal: AbortSignal) => Promise<void>;
  onAbort: () => void;
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  let disposed = false, lostAuthority = false;
  let nextCheck: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  const abort = (reason: unknown, unauthorized = true) => {
    if (disposed || controller.signal.aborted) return;
    lostAuthority = unauthorized;
    controller.abort(reason instanceof Error ? reason : new Error("The queued execution is no longer authorized."));
    clearTimeout(nextCheck);
    options.onAbort();
  };
  const fromCaller = () => abort(options.signal?.reason);
  options.signal?.addEventListener("abort", fromCaller, { once: true });
  if (options.signal?.aborted) fromCaller();
  const check = async () => {
    controller.signal.throwIfAborted();
    if (disposed) return;
    if (!inFlight) {
      inFlight = options.authorize(controller.signal).catch(error => {
        if (!disposed) { abort(error); throw error; }
      }).finally(() => { inFlight = null; });
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
      deadline = setTimeout(() => abort(new Error("The queued execution exceeded its run timeout."), false), Math.max(1, options.timeoutMs));
      deadline.unref?.();
      schedule();
    },
    stop() {
      disposed = true;
      clearTimeout(deadline);clearTimeout(nextCheck);
      options.signal?.removeEventListener("abort", fromCaller);
    }
  };
}
