type TransportOptions = {
  timeoutMs: number;
  timeoutMessage: string;
};

/** Keep cancellation and the deadline active until the response body is consumed. */
export async function consumeApiResponse<T>(
  url: string,
  init: RequestInit,
  options: TransportOptions,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  init.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  let response: Response | undefined;
  try {
    response = await fetch(url, { ...init, signal });
    const value = await consume(response);
    signal.throwIfAborted();
    return value;
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (deadline.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
      throw new Error(options.timeoutMessage);
    }
    if (!response) throw new Error("Unable to reach the API. Check your connection and try again.");
    if (error instanceof SyntaxError) {
      const reference = response.headers.get("x-trace-id") || response.headers.get("x-request-id");
      throw new Error(`The API returned an invalid response.${reference ? ` (support reference: ${reference})` : ""}`);
    }
    throw error;
  } finally {
    // Gateway HTML/text errors are intentionally not parsed as application data.
    // Release their stream immediately instead of occupying a connection until
    // the request deadline; cleanup must never replace the original failure.
    if (response?.body && !response.bodyUsed && !response.body.locked) {
      void response.body.cancel().catch(() => undefined);
    }
  }
}
