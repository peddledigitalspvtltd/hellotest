const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { serializeDiagnosticError } = require("../src/utils/diagnosticErrorSerializer");
const { ServiceBoundaryError, sanitizeInternalErrorText } = require("../src/utils/serviceErrors");
const { classifyError } = require("../src/utils/httpErrorPolicy");

test("unknown SQLSTATE details never become public legacy validation messages", () => {
  for (const code of ["42P01", "42703", "28P01", "XX000"]) {
    const error = Object.assign(new Error('missing table internal_users; password=private-value'), { code });
    const result = classifyError(error);
    assert.equal(result.statusCode, 500); assert.equal(result.code, "DATABASE_ERROR");
    assert.doesNotMatch(result.message, /internal_users|private-value/);
  }
  assert.equal(classifyError(new Error("Name is required")).message, "Name is required");
  assert.equal(classifyError(Object.assign(new Error("Record changed"), { statusCode: 409, code: "REVISION_CONFLICT" })).code, "REVISION_CONFLICT");
});

test("retry and upstream hints remain absent when unspecified and are bounded when supplied", () => {
  const error = new ServiceBoundaryError();
  assert.equal(error.retryAfterSeconds, null); assert.equal(error.upstreamStatus, null);
  assert.equal(classifyError(error).retryAfterSeconds, null);
  assert.equal(new ServiceBoundaryError("wait", { retryAfterSeconds: 1e20 }).retryAfterSeconds, 86_400);
  assert.equal(classifyError({ statusCode: 503, retryAfterSeconds: null }).retryAfterSeconds, 1);
});

test("credential redaction covers quoted JSON, whitespace in values and signed URL credentials", () => {
  const text = sanitizeInternalErrorText('invalid {"password":"with spaces", "client_secret": "quoted-value"} https://user:pass@host.test?X-Amz-Signature=signed-value Authorization: Bearer secret-value');
  assert.doesNotMatch(text, /with spaces|quoted-value|user:pass|signed-value|secret-value/);
  assert.match(text, /invalid/);
});

test("OAuth token spelling variants and complete cookie headers are redacted from error causes", () => {
  const details = JSON.stringify({ access_token: "access-value", id_token: "identity-value", session_token: "session-value", accessToken: "camel-value", "refresh-token": "refresh-value", cookie: "sid=quoted-first; session=quoted-second" });
  const error = new Error(details, { cause: new Error("Cookie: sid=first-value; session=second-value\nSet-Cookie: sid=third-value; Path=/\nprovider failed") });
  const serialized = JSON.stringify(serializeDiagnosticError(error));
  assert.doesNotMatch(serialized, /access-value|identity-value|session-value|camel-value|refresh-value|quoted-first|quoted-second|first-value|second-value|third-value/);
  assert.match(serialized, /provider failed/);
});

test("diagnostic serialization omits provider configs and bounds circular and aggregate causes", () => {
  const cause = new Error("provider token=credential-value");
  cause.cause = cause;
  const error = Object.assign(new Error("request failed", { cause }), {
    code: "UPSTREAM_ERROR", config: { headers: { Authorization: "private-header" } },
    query: "private SQL", parameters: ["private parameter"], response: { body: "private body" }
  });
  const value = serializeDiagnosticError(error);
  assert.equal(value.code, "UPSTREAM_ERROR"); assert.match(value.stack, /request failed/);
  assert.equal(value.cause.cause.message, "[circular cause]");
  assert.doesNotMatch(JSON.stringify(value), /credential-value|private-header|private SQL|private parameter|private body/);
  assert.equal(serializeDiagnosticError(new AggregateError(Array.from({ length: 50 }, () => new Error("child")))).errors.length, 5);
});

test("Fastify emits safe errors with the same request reference in logs and response", async t => {
  const lines = [];
  const app = Fastify({
    logger: { stream: { write: line => lines.push(JSON.parse(line)) }, serializers: { err: serializeDiagnosticError, error: serializeDiagnosticError } },
    genReqId: () => "request-reference"
  });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  app.get("/failure", async request => {
    const error = Object.assign(new Error('Invalid configuration password="private log secret"'), { statusCode: 400, config: { token: "config-secret" } });
    request.log.error({ err: error }, "Provider failed");
    throw error;
  });
  const response = await app.inject("/failure?token=query-secret");
  assert.equal(response.statusCode, 400); assert.equal(response.json().requestId, "request-reference");
  assert.equal(lines.find(line => line.event === "request_failed").request_id, response.json().requestId);
  const providerLog = lines.find(line => line.msg === "Provider failed");
  assert.doesNotMatch(JSON.stringify(providerLog), /private log secret|config-secret/);
  assert.doesNotMatch(response.body, /private log secret|config-secret/);
});
