const MEBIBYTE = 1024 * 1024;

const readBoundedInteger = (name, fallback, { min, max }) => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
};

const bodyLimitBytes = readBoundedInteger("HTTP_BODY_LIMIT_BYTES", 4 * MEBIBYTE, {
  min: 64 * 1024,
  max: 16 * MEBIBYTE
});

const largeBodyLimitBytes = readBoundedInteger("HTTP_LARGE_BODY_LIMIT_BYTES", 48 * MEBIBYTE, {
  min: bodyLimitBytes,
  max: 128 * MEBIBYTE
});

const httpConfig = Object.freeze({
  bodyLimitBytes,
  largeBodyLimitBytes,
  requestTimeoutMs: readBoundedInteger("HTTP_REQUEST_TIMEOUT_MS", 210_000, {
    min: 5_000,
    max: 300_000
  }),
  connectionTimeoutMs: readBoundedInteger("HTTP_CONNECTION_TIMEOUT_MS", 210_000, {
    min: 5_000,
    max: 300_000
  }),
  keepAliveTimeoutMs: readBoundedInteger("HTTP_KEEP_ALIVE_TIMEOUT_MS", 72_000, {
    min: 1_000,
    max: 120_000
  }),
  maxRequestsPerSocket: readBoundedInteger("HTTP_MAX_REQUESTS_PER_SOCKET", 1_000, {
    min: 1,
    max: 100_000
  }),
  maxInflightRequests: readBoundedInteger("HTTP_MAX_INFLIGHT_REQUESTS", 200, {
    min: 1,
    max: 10_000
  }),
  maxInflightLargeRequests: readBoundedInteger("HTTP_MAX_INFLIGHT_LARGE_REQUESTS", 2, {
    min: 1,
    max: 100
  })
});

module.exports = {
  httpConfig,
  readBoundedInteger
};
