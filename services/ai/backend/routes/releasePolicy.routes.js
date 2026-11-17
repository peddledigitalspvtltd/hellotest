const projectService = require("@hellotest/platform/backend/public/projectAccess");


module.exports = async function releasePolicyRoutes(fastify) {
  const releasePolicy = require('../services/qualityReleasePolicy.service');
  const policyAccess = async (req, waiver = false) => {
    await fastify.authenticate(req);
    const input = (req.method === 'GET' ? req.query : req.body) || {};
    fastify.validate({project_id:{required:true,type:'string',maxLength:255}},input);
    await projectService.getProject(input.project_id,req.user.id);
    for (const code of ['quality_gate.view', ...(req.method === 'GET' ? [] : ['quality_gate.update']), ...(waiver ? ['requirement.view','testcase.view','run.view','result.view','feedback.view'] : [])]) await fastify.requirePermission(code,{projectId:input.project_id})(req);
    return input;
  };
  fastify.get('/ai/release-policy',async(req,reply)=>{const input=await policyAccess(req);reply.header('cache-control','no-store');return {policy:await releasePolicy.current(input.project_id)};});
  fastify.post('/ai/release-policy',{bodyLimit:12000},async(req)=>{const input=await policyAccess(req);return releasePolicy.approve(input.project_id,req.user,input);});
  fastify.post('/ai/release-waivers',{bodyLimit:12000},async(req)=>{const input=await policyAccess(req,true);return releasePolicy.waive(input.project_id,req.user,input);});
};
