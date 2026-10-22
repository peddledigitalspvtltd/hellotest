import { randomUUID } from "node:crypto";

export class EngineHttpError extends Error {
  constructor(
    public readonly code: "INVALID_ENDPOINT" | "REQUEST_TIMEOUT" | "REQUEST_ABORTED" | "REQUEST_FAILED" | "HTTP_ERROR" | "RESPONSE_TOO_LARGE" | "INVALID_JSON",
    public readonly service: string,
    public readonly requestId: string,
    public readonly status?: number
  ) {
    const reason = { INVALID_ENDPOINT: "has an invalid HTTP endpoint", REQUEST_TIMEOUT: "request timed out", REQUEST_ABORTED: "request was cancelled", REQUEST_FAILED: "request failed", HTTP_ERROR: `returned HTTP ${status}`, RESPONSE_TOO_LARGE: "response exceeded the size limit", INVALID_JSON: "returned an invalid JSON response" }[code];
    // Upstream response bodies and URLs can contain credentials or test data.
    super(`${service} ${reason} (request ${requestId})`);
    this.name = "EngineHttpError";
  }
}

/** One bounded, non-redirecting service request. Callers retain retry and protocol policy. */
export async function requestEngineService<T = unknown>(options: {
  url: string;
  service: string;
  timeoutMs: number;
  maxResponseBytes?: number;
  responseType?: "json" | "none" | "buffer";
  init?: RequestInit;
}): Promise<T> {
  const { service, init = {} } = options;
  let requestId: string = randomUUID();
  const failure = (code: ConstructorParameters<typeof EngineHttpError>[0], status?: number) => new EngineHttpError(code, service, requestId, status);
  try {
    const endpoint = new URL(options.url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
  } catch { throw failure("INVALID_ENDPOINT"); }
  let headers: Headers;
  try { headers = new Headers(init.headers); headers.set("x-request-id", requestId); }
  catch { throw failure("REQUEST_FAILED"); }
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(900_000, options.timeoutMs)) : 15_000;
  const maxBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    response = await fetch(options.url, { ...init, headers: Object.fromEntries(headers), signal, redirect: "manual" });
    const responseRequestId = response.headers.get("x-request-id");
    if (responseRequestId && /^[A-Za-z0-9._-]{1,128}$/.test(responseRequestId)) requestId = responseRequestId;
    if (!response.ok) throw failure("HTTP_ERROR", response.status);
    if (options.responseType === "none") return undefined as T;
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw failure("RESPONSE_TOO_LARGE", response.status);
    const chunks: Uint8Array[] = [];
    let size = 0;
    reader = response.body?.getReader();
    while (reader) {
      if (signal.aborted) throw failure(controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(failure(controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      let item: ReadableStreamReadResult<Uint8Array>;
      try { item = await Promise.race([reader.read(), aborted]); }
      finally { signal.removeEventListener("abort", onAbort); }
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) throw failure("RESPONSE_TOO_LARGE", response.status);
      chunks.push(item.value);
    }
    if (options.responseType === "buffer") return Buffer.concat(chunks) as T;
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; }
    catch { throw failure("INVALID_JSON", response.status); }
  } catch (error) {
    if (error instanceof EngineHttpError) throw error;
    throw failure(controller.signal.aborted ? "REQUEST_TIMEOUT" : signal.aborted ? "REQUEST_ABORTED" : "REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
    // Cancel without awaiting a potentially broken upstream stream implementation.
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    else if (response?.body) void response.body.cancel().catch(() => undefined);
  }
}
