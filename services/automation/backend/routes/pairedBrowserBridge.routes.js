const service = require('../services/pairedBrowserBridge.service');
const db = require('@hellotest/platform/backend/src/db');
const projects = require('@hellotest/platform/backend/public/projectAccess');
const security = require('../lib/pairedLocalSecurity');
const agentAuth = req => ({ bridgeId:req.params.id, agentId:req.headers['x-hellotest-local-agent-id'], token:String(req.headers.authorization || '').replace(/^Bearer\s+/i,'') });

module.exports = async function (fastify) {
  fastify.post('/automation/browser-bridges', async (req,reply) => {
    reply.header('Cache-Control','no-store');
    await fastify.authenticate(req);
    const input = req.body || {}, pairedOrigin = security.origin(input.paired_origin);
    if (security.origin(req.headers.origin) !== pairedOrigin) throw security.fail('Use the current HelloTest browser origin.',403,'PAIRED_BROWSER_ORIGIN');
    const ids = [...new Set((Array.isArray(input.test_case_ids) ? input.test_case_ids : [input.test_case_id]).map(id => security.id(id,'test case')))];
    if (!ids.length || ids.length > 2000) throw security.fail('Select between 1 and 2,000 cases.',400);
    const rows = await db.prepare(`SELECT cases.id,cases.app_type_id,apps.project_id FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id
      WHERE cases.id IN(SELECT jsonb_array_elements_text(?::jsonb))`).all(JSON.stringify(ids));
    const first = rows[0];
    if (rows.length !== ids.length || !first || rows.some(row => row.app_type_id !== first.app_type_id || row.project_id !== first.project_id)
      || input.project_id && input.project_id !== first.project_id || input.app_type_id && input.app_type_id !== first.app_type_id) throw security.fail('Select existing cases in one project application.',400,'PAIRED_BROWSER_SCOPE');
    await projects.getProject(first.project_id,req.user.id);
    await fastify.requirePermission('automation.build',{projectId:first.project_id})(req);
    await fastify.requirePermission('automation.ai',{projectId:first.project_id})(req);
    return service.create({caseIds:ids,projectId:first.project_id,appTypeId:first.app_type_id,userId:req.user.id,agentId:input.local_agent_id,pairedOrigin});
  });
  fastify.get('/local-browser-bridges/:id/poll', (req,reply) => {reply.header('Cache-Control','no-store');return service.poll(agentAuth(req));});
  fastify.post('/local-browser-bridges/:id/result', {bodyLimit:5*1024*1024}, (req,reply) => {reply.header('Cache-Control','no-store');return service.result({...agentAuth(req),commandId:req.body?.command_id,response:req.body?.response});});
};
