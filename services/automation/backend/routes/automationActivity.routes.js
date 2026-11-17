const { Readable } = require('node:stream');
const activity = require('../services/automationAgentActivity.service');
const transactions = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const projects = require('@hellotest/platform/backend/public/projectAccess');
const { activityCursor, streamAutomationActivity } = require("../lib/build/automationActivityStream");

module.exports = async function automationActivityRoutes(fastify) {
  fastify.get('/test-cases/:id/automation/authoring-state', async req => {
    await fastify.authenticate(req);
    const testCase = await require('@hellotest/platform/backend/src/db').prepare('SELECT tc.id,tc.app_type_id,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=?').get(req.params.id);
    if (!testCase) throw Object.assign(new Error('Test case not found.'), { statusCode: 404 });
    await projects.getProject(testCase.project_id, req.user.id);
    for (const code of ['testcase.view', 'automation.view']) await fastify.requirePermission(code, { projectId: testCase.project_id })(req);
    return require('../services/automationAuthoringAdmission.service').state({ testCase });
  });
  fastify.get('/test-cases/automation/jobs/:transactionId/events', async (req, reply) => {
    await fastify.authenticate(req);
    const query = req.query?.after, header = req.headers['last-event-id'];
    if (query != null && header != null && String(query) !== String(header)) throw Object.assign(new Error('Activity cursors must match.'), { statusCode: 400 });
    const cursor = activityCursor(query ?? header ?? 0);
    const read = async offset => {
      const transaction = await transactions.getTransaction(req.params.transactionId);
      if (transaction.category !== 'automation_build' || !transaction.project_id) throw Object.assign(new Error('Automation build not found.'), { statusCode: 404 });
      await projects.getProject(transaction.project_id, req.user.id);
      for (const code of ['automation.build', 'automation.view', 'automation.code.view', 'automation.ai']) await fastify.requirePermission(code, { projectId: transaction.project_id })(req);
      return activity.activity(transaction, { events_offset: offset, events_limit: 200 });
    };
    const initial = await read(cursor), controller = new AbortController();
    const close = () => controller.abort();
    reply.raw.once('close', close);
    async function* events() {
      try { yield* streamAutomationActivity({ read, initial, cursor, signal: controller.signal }); }
      finally { reply.raw.off('close', close); controller.abort(); }
    }
    return reply.header('Cache-Control', 'private, no-store, no-transform').header('X-Accel-Buffering', 'no')
      .type('text/event-stream; charset=utf-8').send(Readable.from(events()));
  });
};
