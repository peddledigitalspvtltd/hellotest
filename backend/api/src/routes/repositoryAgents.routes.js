const service = require('../agents/repositoryAgents.service');
const { publishRun } = require('../agents/publish');
const { AGENTS, LIMITS, PUBLISH_PERMISSIONS, error } = require('../agents/catalog');
const compiler = require('../agents/compiler');
const mobileFeatureService = require('../services/mobileFeature.service');

module.exports = async function repositoryAgentsRoutes(fastify) {
  fastify.get('/repository-agents', async req => {
    await fastify.authenticate(req);
    await fastify.requirePermission('agentic_workflow.view')(req);
    return { agents: AGENTS, limits: LIMITS, runtime: await compiler.runtimeStatus() };
  });
  fastify.get('/repository-agents/runs', async req => {
    await fastify.authenticate(req);
    await fastify.requirePermission('agentic_workflow.view', { projectId: req.query.project_id })(req);
    return service.listRuns(req.query, req.user);
  });
  fastify.post('/repository-agents/runs', { bodyLimit: LIMITS.max_archive_bytes + 1024 * 1024 }, async (req, reply) => {
    await fastify.authenticate(req);
    let input = req.body || {}, file;
    if (req.isMultipart()) {
      input = {};
      for await (const part of req.parts({ limits: { files: 1, fields: 3, fileSize: LIMITS.max_archive_bytes, fieldSize: 1000 } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') throw error('Choose a source ZIP archive.');
          file = { filename: part.filename, buffer: await part.toBuffer(), truncated: Boolean(part.file.truncated) };
        } else if (['project_id','app_type_id','agent_type'].includes(part.fieldname)) input[part.fieldname] = part.value;
      }
      if (!file) throw error('Choose a source ZIP archive.');
    }
    await fastify.requirePermission('agentic_workflow.run', { projectId: input.project_id })(req);
    if (input.source?.integration_id) await fastify.requirePermission('integration.view', { projectId: input.project_id })(req);
    const run = await service.createRun(input, req.user, { file, requestKey: req.headers['idempotency-key'] });
    return reply.code(202).header('Location', `/repository-agents/runs/${run.id}`).send(run);
  });
  fastify.get('/repository-agents/runs/:id', async req => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user);
    await fastify.requirePermission('agentic_workflow.view', { projectId: run.project_id })(req);
    return run;
  });
  fastify.post('/repository-agents/runs/:id/cancel', async req => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user);
    await fastify.requirePermission('agentic_workflow.run', { projectId: run.project_id })(req);
    return service.cancelRun(run.id, req.user);
  });
  fastify.post('/repository-agents/runs/:id/retry', async (req, reply) => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user);
    await fastify.requirePermission('agentic_workflow.run', { projectId: run.project_id })(req);
    if (run.source.uses_saved_connection) await fastify.requirePermission('integration.view', { projectId: run.project_id })(req);
    const next = await service.retryRun(run.id, req.user);
    return reply.code(202).header('Location', `/repository-agents/runs/${next.id}`).send(next);
  });
  fastify.post('/repository-agents/runs/:id/publish', async req => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user);
    await fastify.requirePermission('agentic_workflow.run', { projectId: run.project_id })(req);
    await fastify.requirePermission(PUBLISH_PERMISSIONS[run.agent_type], { projectId: run.project_id })(req);
    if (['api_tests', 'component_tests'].includes(run.agent_type) && await mobileFeatureService.appTypeUsesMobile(run.app_type_id)) {
      await fastify.requirePermission('mobile.manage', { projectId: run.project_id })(req);
    }
    if (req.body?.module_id) await fastify.requirePermission('testcase.update', { projectId: run.project_id })(req);
    return publishRun(run.id, req.body || {}, req.user);
  });
  fastify.get('/repository-agents/runs/:id/artifacts/:name', async (req, reply) => {
    await fastify.authenticate(req);
    const { project_id, artifact } = await service.getArtifact(req.params.id, req.params.name, req.user);
    await fastify.requirePermission('agentic_workflow.view', { projectId: project_id })(req);
    // Always download source/generated content; it must never execute in the app origin.
    return reply.header('Content-Disposition', `attachment; filename="${artifact.name}"`).header('Cache-Control', 'private, no-store').type('application/octet-stream').send(artifact.content);
  });
};
