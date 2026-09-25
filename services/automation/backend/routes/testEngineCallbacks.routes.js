const { Readable } = require("stream");
const { config } = require("@hellotest/platform/backend/src/config");
const service = require("../services/testEngineCallback.service");

const payloadTooLarge = () => Object.assign(
  new Error(`Test Engine callback payload exceeds ${config.http.largeBodyLimitBytes} bytes.`),
  { statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE" }
);

const captureRawCallbackBody = async (req, _reply, payload) => {
  const chunks = [];
  let totalBytes = 0;

  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > config.http.largeBodyLimitBytes) {
    throw payloadTooLarge();
  }

  for await (const chunk of payload) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > config.http.largeBodyLimitBytes) {
      throw payloadTooLarge();
    }
    chunks.push(buffer);
  }

  const bodyBuffer = Buffer.concat(chunks);
  req.rawBody = bodyBuffer.toString("utf8");

  const replayStream = Readable.from(bodyBuffer);
  replayStream.receivedEncodedLength = bodyBuffer.length;
  return replayStream;
};

module.exports = async function (fastify) {
  fastify.post("/api/testengine/callbacks/runs", {
    bodyLimit: config.http.largeBodyLimitBytes,
    preParsing: captureRawCallbackBody
  }, async (req) => {
    fastify.validate({
      engine_run_id: { required: true, type: "string" },
      hellotest_run_id: { required: false, type: "string" },
      hellotest_execution_id: { required: false, type: "string" },
      hellotest_test_case_id: { required: true, type: "string" },
      event: { required: false, type: "string" },
      summary: { required: false, type: "string" },
      state: { required: false, type: "string" },
      emitted_at: { required: false, type: "string" },
      case_result: { required: false, type: "object" },
      artifact_bundle: { required: false, type: "object" }
    }, req.body);

    return service.handleRunCallback({
      headers: req.headers,
      payload: req.body,
      rawPayload: req.rawBody || null
    });
  });
};

module.exports.captureRawCallbackBody = captureRawCallbackBody;
