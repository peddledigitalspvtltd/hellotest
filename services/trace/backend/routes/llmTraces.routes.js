const projects = require('@hellotest/platform/backend/public/projectAccess');
const traces = require('../services/llmTraceQuery.service');

module.exports = async fastify => {
  const access = async req => {
    const project = req.query?.project_id;
    if (typeof project !== 'string' || !project.trim() || project.length > 128) throw Object.assign(new Error('project_id is required.'), { statusCode: 400 });
    await projects.getProject(project, req.user.id);
    return project;
  };
  fastify.get('/ops-telemetry/llm-traces', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return traces.list(await access(req), req.query);
  });
  fastify.get('/ops-telemetry/llm-traces/:id', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    // Payloads can combine several source systems and private documents. Only
    // workspace administrators can inspect content; ops viewers see timings.
    return traces.detail(await access(req), req.params.id, { includeContent: req.user.role === 'admin' });
  });
};
