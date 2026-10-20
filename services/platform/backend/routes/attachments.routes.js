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

  fastify.delete("/attachments/:id", async (req) => {
    await fastify.authenticate(req);
    return attachmentService.remove({ user: req.user, id: req.params.id });
  });
};
