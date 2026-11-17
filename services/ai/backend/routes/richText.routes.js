const projectService = require("@hellotest/platform/backend/public/projectAccess");

const richTextAi = require("../services/richTextAi.service");

module.exports = async function richTextRoutes(fastify) {
  fastify.post("/ai/rich-text-rephrase", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      content: { required: true, type: "string" },
      content_html: { required: false, type: "string" },
      entity_type: { required: false, type: "string" },
      entity_title: { required: false, type: "string" },
      field_label: { required: false, type: "string" },
      aria_label: { required: false, type: "string" },
      additional_context: { required: false, type: "string", maxLength: 12000 }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    return richTextAi.rephrase({
      user: req.user,
      projectId: req.body.project_id,
      content: req.body.content,
      contentHtml: req.body.content_html,
      entityType: req.body.entity_type,
      entityTitle: req.body.entity_title,
      fieldLabel: req.body.field_label,
      ariaLabel: req.body.aria_label,
      additionalContext: req.body.additional_context
    });
  });
};
