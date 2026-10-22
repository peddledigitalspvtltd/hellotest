const service = require('../agents/repositoryAgents.service');
const { publishRun } = require('../agents/publish');
const { AGENTS, LIMITS, PUBLISH_PERMISSIONS, PUBLISH_ADDITIONAL_PERMISSIONS, error } = require('../agents/catalog');
const knowledgePublication = require('../agents/knowledgePublication.service');
const compiler = require('../agents/compiler');
const mobileFeatureService = require('@hellotest/platform/backend/services/mobileFeature.service');

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
    try {
    if (req.isMultipart()) {
      input = {};
      for await (const part of req.parts({ limits: { files: 1, fields: 4, fileSize: LIMITS.max_archive_bytes, fieldSize: 24000 } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') throw error('Choose a source ZIP archive.');
          if (!input.project_id) throw error('Send project and application scope before the source file.');
          await fastify.requirePermission('agentic_workflow.run', { projectId: input.project_id })(req);
          await service.requireScope(input.project_id, input.app_type_id || null, req.user, 'agentic_workflow.run');
          file = await require('../agents/archiveTransfer').spoolArchive(part.file, { filename: part.filename });
          file.truncated = Boolean(part.file.truncated);
        } else if (part.fieldname === 'context') { let context; try { context = JSON.parse(part.value); } catch { throw error('The repository context selection is invalid.'); } const selected = require('../services/qualityAgentContracts').contextSelection(context); Object.assign(input, selected, { goal: typeof context.goal === 'string' ? context.goal.trim().slice(0,2000) : '' }); } else if (['project_id','app_type_id','agent_type'].includes(part.fieldname)) input[part.fieldname] = part.value;
      }
      if (!file) throw error('Choose a source ZIP archive.');
    }
    await fastify.requirePermission('agentic_workflow.run', { projectId: input.project_id })(req);
    if (input.source?.integration_id) await fastify.requirePermission('integration.view', { projectId: input.project_id })(req);
    const run = await service.createRun(input, req.user, { file, requestKey: req.headers['idempotency-key'] });
    return reply.code(202).header('Location', `/repository-agents/runs/${run.id}`).send(run);
    } finally { await file?.dispose?.(); }
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
    for (const permission of PUBLISH_ADDITIONAL_PERMISSIONS[run.agent_type] || []) {
      await fastify.requirePermission(permission, { projectId: run.project_id })(req);
    }
    if (['api_tests', 'component_tests'].includes(run.agent_type) && await mobileFeatureService.appTypeUsesMobile(run.app_type_id)) {
      await fastify.requirePermission('mobile.manage', { projectId: run.project_id })(req);
    }
    if (req.body?.module_id) await fastify.requirePermission('testcase.update', { projectId: run.project_id })(req);
    return publishRun(run.id, req.body || {}, req.user);
  });
  fastify.get('/repository-agents/runs/:id/publication-status', async (req, reply) => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user);
    await fastify.requirePermission('agentic_workflow.view', { projectId: run.project_id })(req);
    await fastify.requirePermission('knowledge.view', { projectId: run.project_id })(req);
    const status = await knowledgePublication.getPublicationStatus(run.id, req.user);
    return reply.header('Cache-Control', 'private, no-store').send(status);
  });
  fastify.post('/repository-agents/runs/:id/process-knowledge', async (req, reply) => {
    await fastify.authenticate(req);
    const run = await service.getRun(req.params.id, req.user, 'agentic_workflow.run');
    await fastify.requirePermission('agentic_workflow.run', { projectId: run.project_id })(req);
    await fastify.requirePermission('knowledge.manage', { projectId: run.project_id })(req);
    const status = await knowledgePublication.processPublishedKnowledge(run.id, req.body || {}, req.user);
    return reply.code(202).header('Cache-Control', 'private, no-store').send(status);
  });
  fastify.get('/repository-agents/runs/:id/artifacts/:name', async (req, reply) => {
    await fastify.authenticate(req);
    const { project_id, artifact } = await service.getArtifact(req.params.id, req.params.name, req.user);
    await fastify.requirePermission('agentic_workflow.view', { projectId: project_id })(req);
    // Always download source/generated content; it must never execute in the app origin.
    return reply.header('Content-Disposition', `attachment; filename="${artifact.name}"`).header('Cache-Control', 'private, no-store').type('application/octet-stream').send(artifact.content);
  });
};
