const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const { SERVICE_ERROR_CODES, serviceError } = require("./serviceErrors");

const normalizeLimit = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_024
    ? Math.trunc(parsed)
    : DEFAULT_MAX_RESPONSE_BYTES;
};

const limitError = (label, maxBytes) => serviceError(SERVICE_ERROR_CODES.RESPONSE_TOO_LARGE, {
  message: `${label} exceeded ${maxBytes} bytes`,
  dependency: String(label || "provider-response").replace(/\s+response$/i, ""),
  operation: "response.read",
  retryable: false,
  statusCode: 502
});

const readBoundedResponseBuffer = async (response, {
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
  abort = null,
  label = "Provider response"
} = {}) => {
  const normalizedMaxBytes = normalizeLimit(maxBytes);
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > normalizedMaxBytes) {
    abort?.();
    await response.body?.cancel?.().catch(() => null);
    throw limitError(label, normalizedMaxBytes);
  }

  if (!response.body?.getReader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > normalizedMaxBytes) {
      abort?.();
      throw limitError(label, normalizedMaxBytes);
    }
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > normalizedMaxBytes) {
      abort?.();
      await reader.cancel().catch(() => null);
      throw limitError(label, normalizedMaxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
};

const readBoundedResponseText = async (response, options) => (
  await readBoundedResponseBuffer(response, options)
).toString("utf8");

const readBoundedResponseJson = async (response, options) => {
  const body = await readBoundedResponseText(response, options);
  if (!body) return null;
  return JSON.parse(body);
};

const cloneWithBoundedBody = async (response, options) => new Response(
  await readBoundedResponseBuffer(response, options),
  {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  }
);

/**
 * Read only a preview of a provider response. Unlike the strict bounded reader,
 * this intentionally returns a prefix and cancels the remainder so diagnostic
 * tools never buffer an untrusted response in full.
 */
const readResponsePrefix = async (response, {
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
  abort = null
} = {}) => {
  const normalizedMaxBytes = normalizeLimit(maxBytes);
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  const reader = response.body?.getReader?.();

  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    return {
      buffer: body.subarray(0, normalizedMaxBytes),
      bytesRead: Math.min(body.length, normalizedMaxBytes),
      truncated: body.length > normalizedMaxBytes
    };
  }

  const chunks = [];
  let bytesRead = 0;
  let truncated = Number.isFinite(declaredLength) && declaredLength > normalizedMaxBytes;
  while (bytesRead <= normalizedMaxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = normalizedMaxBytes - bytesRead;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(Buffer.from(value.subarray(0, remaining)));
      bytesRead += Math.max(0, remaining);
      truncated = true;
      break;
    }
    chunks.push(Buffer.from(value));
    bytesRead += value.byteLength;
  }

  if (truncated) {
    abort?.();
    await reader.cancel().catch(() => null);
  }

  return { buffer: Buffer.concat(chunks, bytesRead), bytesRead, truncated };
};

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  cloneWithBoundedBody,
  readBoundedResponseBuffer,
  readBoundedResponseJson,
  readBoundedResponseText,
  readResponsePrefix
};
