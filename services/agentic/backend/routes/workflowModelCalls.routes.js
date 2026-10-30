const workflows = require('../services/agenticWorkflow.service');
const projects = require('@hellotest/platform/backend/public/projectAccess');
const calls = require('@hellotest/trace/backend/public/workflowModelCalls');
const { publicRun } = require('../workflows/executionReadAccess');

module.exports = async fastify => {
  const access = async req => {
    await fastify.authenticate(req);
    const run = await workflows.getWorkflowRun(req.params.id);
    await projects.getProject(run.project_id, req.user.id);
    await fastify.requirePermission('agentic_workflow.view', { projectId: run.project_id })(req);
    await fastify.requirePermission('ops.view', { projectId: run.project_id })(req);
    if (!run.workflow_snapshot?.nodes?.some(node => node.id === req.params.nodeId)) {
      throw Object.assign(new Error('Node not found in this workflow execution.'), { statusCode: 404 });
    }
    return { run, context: { projectId: run.project_id, runId: run.id, nodeId: req.params.nodeId } };
  };
  fastify.get('/agentic-workflow-runs/:id/nodes/:nodeId/model-calls', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { context } = await access(req);
    return calls.list(context, { cursor: req.query.cursor });
  });
  fastify.get('/agentic-workflow-runs/:id/nodes/:nodeId/model-calls/:callId', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { run, context } = await access(req);
    const visible = await publicRun(run, req.user);
    const node = visible.node_results?.find(item => item.node_id === req.params.nodeId);
    const sourceHidden = node?.automation_source_hidden || ['input', 'output', 'progress'].some(field => node?.[field]?.automation_source_hidden);
    return calls.detail(context, req.params.callId, { includeContent: req.user.role === 'admin' && !sourceHidden });
  });
};
