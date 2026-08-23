const { Readable } = require("stream");
const service = require("../services/testEngineCallback.service");

const captureRawCallbackBody = async (req, _reply, payload) => {
  const chunks = [];

  for await (const chunk of payload) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyBuffer = Buffer.concat(chunks);
  req.rawBody = bodyBuffer.toString("utf8");

  const replayStream = Readable.from(bodyBuffer);
  replayStream.receivedEncodedLength = bodyBuffer.length;
  return replayStream;
};

module.exports = async function (fastify) {
  fastify.post("/api/testengine/callbacks/runs", { preParsing: captureRawCallbackBody }, async (req) => {
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
