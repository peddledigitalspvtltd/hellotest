/** Complete API responses are bounded before assertions run; previews never become assertion inputs. */
export const API_RESPONSE_PREVIEW_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const apiResponseLimitBytes = () => {
  const configured = Number(process.env.TESTENGINE_API_RESPONSE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= 1024
    ? Math.min(32 * 1024 * 1024, configured) : DEFAULT_MAX_RESPONSE_BYTES;
};

export class ApiResponseLimitError extends Error {
  readonly code = 'API_RESPONSE_TOO_LARGE';
  readonly retryable = false;
  constructor(readonly maxBytes: number) {
    super(`The API response exceeded the ${maxBytes}-byte execution limit. Narrow the response or adjust TESTENGINE_API_RESPONSE_MAX_BYTES (up to 32 MiB); no assertions or captures were evaluated on an incomplete response.`);
    this.name = 'ApiResponseLimitError';
  }
}

export async function readApiResponseBody(response: Response, signal?: AbortSignal, maxBytes = apiResponseLimitBytes()) {
  const fail = () => new ApiResponseLimitError(maxBytes);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    throw fail();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // Native empty responses and small compatibility transports have no reader.
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw fail();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal?.reason || new DOMException('API response cancelled', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      let item: ReadableStreamReadResult<Uint8Array>;
      try { item = await Promise.race([reader.read(), aborted]); }
      finally { signal?.removeEventListener('abort', onAbort); }
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) throw fail();
      chunks.push(item.value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function apiResponsePreview(body: string, maxBytes = API_RESPONSE_PREVIEW_BYTES) {
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= maxBytes) return { body, body_truncated: false, body_original_bytes: bytes.length, body_retained_bytes: bytes.length };
  // Remove an incomplete trailing UTF-8 code point instead of adding a false replacement character.
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { body: bytes.subarray(0, end).toString('utf8'), body_truncated: true, body_original_bytes: bytes.length, body_retained_bytes: end };
}
