const service = require("../services/testEngineDispatch.service");
const { config } = require("@hellotest/platform/backend/src/config");

module.exports = async function (fastify) {
  fastify.post('/testengine/internal/runs/:engineRunId/artifacts', { bodyLimit: config.objectStorage.maxAttachmentBytes + 65536 }, async req => {
    const artifacts = require('../services/engineArtifact.service');
    const grant = req.headers['x-testengine-artifact-context'] ? await artifacts.authorize({engineRunId:req.params.engineRunId,headers:req.headers}) : null;
    if (!grant) await fastify.authenticateTestEngine(req);
    const part = await req.file({ limits: { files: 1, fileSize: config.objectStorage.maxAttachmentBytes, fields: 4 } });
    if (!part) throw Object.assign(new Error('Choose an engine evidence file.'), { statusCode: 400 });
    try {
      if (grant && (grant.file_name !== part.filename || grant.content_type !== part.mimetype)) throw Object.assign(new Error('The evidence file does not match its signed grant.'),{statusCode:403});
      return await artifacts.upload({ engineRunId: req.params.engineRunId,
        kind: grant?.kind || part.fields.kind?.value, outcome: grant?.outcome || part.fields.outcome?.value, checksum: grant?.checksum || part.fields.checksum?.value,
        fileName: part.filename, mimeType: part.mimetype, stream: part.file });
    } finally { part.file.resume(); }
  });

  fastify.post("/testengine/internal/jobs/lease", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" },
      engine_host: { required: false, type: "string" },
      engine_class: { required: false, type: "string" },
      lease_seconds: { required: false, type: "number" }
    }, req.body || {});

    const job = await service.leaseNextQueuedJob(req.body || {});
    return { job };
  });

  fastify.get("/testengine/internal/jobs/queue-stats", async (req) => {
    await fastify.authenticateTestEngine(req);
    return service.getQueueStats();
  });

  fastify.get("/testengine/internal/jobs/:id", async (req) => {
    await fastify.authenticateTestEngine(req);
    return service.getQueuedJob(req.params.id);
  });

  fastify.post("/testengine/internal/jobs/:id/start", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" }
    }, req.body || {});

    return service.startQueuedJob({
      job_id: req.params.id,
      worker_id: req.body?.worker_id
    });
  });

  fastify.post("/testengine/internal/jobs/:id/steps/:stepId/execute", async (req) => {
    await fastify.authenticateTestEngine(req);

    return service.executeQueuedApiStep({
      job_id: req.params.id,
      step_id: req.params.stepId
    });
  });

  fastify.post("/testengine/internal/jobs/:id/steps/:stepId/report", {
    bodyLimit: config.http.largeBodyLimitBytes
  }, async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      status: { required: true, type: "string" },
      note: { required: false, type: "string" },
      evidence: { required: false, type: "object" },
      api_detail: { required: false, type: "object" },
      web_detail: { required: false, type: "object" },
      automation_detail: { required: false, type: "object" },
      captures: { required: false, type: "object" },
      recovery_attempted: { required: false, type: "boolean" },
      recovery_succeeded: { required: false, type: "boolean" }
    }, req.body || {});

    return service.reportQueuedStep({
      job_id: req.params.id,
      step_id: req.params.stepId,
      status: req.body?.status,
      note: req.body?.note,
      evidence: req.body?.evidence,
      api_detail: req.body?.api_detail,
      web_detail: req.body?.web_detail,
      automation_detail: req.body?.automation_detail,
      captures: req.body?.captures,
      recovery_attempted: req.body?.recovery_attempted,
      recovery_succeeded: req.body?.recovery_succeeded
    });
  });

  fastify.post("/testengine/internal/jobs/:id/complete", {
    bodyLimit: config.http.largeBodyLimitBytes
  }, async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      status: { required: false, type: "string" },
      error: { required: false, type: "string" },
      summary: { required: false, type: "string" },
      deterministic_attempted: { required: false, type: "boolean" },
      healing_attempted: { required: false, type: "boolean" },
      healing_succeeded: { required: false, type: "boolean" },
      artifact_bundle: { required: false, type: "object" },
      patch_proposals: { required: false, type: "array" }
    }, req.body || {});

    return service.completeQueuedJob({
      job_id: req.params.id,
      status: req.body?.status,
      error: req.body?.error,
      summary: req.body?.summary,
      deterministic_attempted: req.body?.deterministic_attempted,
      healing_attempted: req.body?.healing_attempted,
      healing_succeeded: req.body?.healing_succeeded,
      artifact_bundle: req.body?.artifact_bundle,
      patch_proposals: req.body?.patch_proposals
    });
  });

  fastify.post("/testengine/internal/jobs/:id/fail", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      message: { required: false, type: "string" }
    }, req.body || {});

    return service.failQueuedJob({
      job_id: req.params.id,
      message: req.body?.message
    });
  });
};
