const attachmentService = require("../services/attachment.service");

module.exports = async function (fastify) {
  fastify.get("/attachments/meta", async (req) => {
    await fastify.authenticate(req);
    return attachmentService.meta();
  });

  fastify.get("/attachments", async (req) => {
    await fastify.authenticate(req);
    return attachmentService.list({
      user: req.user,
      entityType: req.query.entity_type,
      entityId: req.query.entity_id,
      projectId: req.query.project_id
    });
  });

  fastify.post("/attachments", async (req) => {
    await fastify.authenticate(req);
    const part = await req.file();
    if (!part) {
      const error = new Error("Choose a file to upload.");
      error.statusCode = 400;
      throw error;
    }
    const fieldValue = (name) => String(part.fields?.[name]?.value || "").trim();
    return attachmentService.upload({
      user: req.user,
      entityType: fieldValue("entity_type"),
      entityId: fieldValue("entity_id"),
      projectId: fieldValue("project_id"),
      fileName: part.filename,
      mimeType: part.mimetype,
      stream: part.file,
      expectedSha256: fieldValue('checksum_sha256') || undefined
    });
  });

  fastify.get("/attachments/:id/download", async (req, reply) => {
    await fastify.authenticate(req);
    const { row, stream } = await attachmentService.download({ user: req.user, id: req.params.id });
    const fileName = attachmentService.safeFileName(row.file_name).replace(/\"/g, "");
    const asciiFileName = fileName.replace(/[^\x20-\x7e]/g, "_");
    reply
      .header("Content-Disposition", `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .type(row.mime_type || "application/octet-stream");
    if (Number(row.size_bytes) > 0) reply.header("Content-Length", String(Number(row.size_bytes)));
    return reply.send(stream);
  });

  fastify.post('/attachments/:id/ai-access', async (req, reply) => {
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
    await fastify.authenticate(req);
    return require('../services/aiAttachmentAccess.service').createAccess({ user: req.user, id: req.params.id, projectId: req.body?.project_id });
  });

  // This narrowly scoped, expiring capability is intentionally independent of
  // browser cookies so the configured model provider can retrieve the bytes.
  fastify.get('/attachments/:id/ai-content', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer');
    const { row, stream } = await require('../services/aiAttachmentAccess.service').download({ id: req.params.id, token: req.query?.token });
    reply.header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachmentService.safeFileName(row.file_name))}`)
      .type(row.mime_type || 'application/octet-stream');
    if (Number(row.size_bytes) > 0) reply.header('Content-Length', String(Number(row.size_bytes)));
    return reply.send(stream);
  });

  fastify.post('/attachments/:id/copy', async req => {
    await fastify.authenticate(req);
    return attachmentService.copyToEntity({ user: req.user, id: req.params.id, projectId: req.body?.project_id, entityType: req.body?.entity_type, entityId: req.body?.entity_id });
  });

  fastify.delete("/attachments/:id", async (req) => {
    await fastify.authenticate(req);
    return attachmentService.remove({ user: req.user, id: req.params.id });
  });
};
