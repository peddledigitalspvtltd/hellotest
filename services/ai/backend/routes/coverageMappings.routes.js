const projectService = require("@hellotest/platform/backend/public/projectAccess");


module.exports = async function coverageMappingsRoutes(fastify) {
  const coverageReview = require('../services/qualityCoverageReview.service');
  const coverageAccess = async req => {
    await fastify.authenticate(req);
    const input = req.method === 'GET' ? req.query : req.body;
    fastify.validate({ project_id:{required:true,type:'string',maxLength:255},story_id:{required:true,type:'string',maxLength:255} },input || {});
    await projectService.getProject(input.project_id,req.user.id);
    for (const permission of ['requirement.view','testcase.view',...(req.method === 'GET' ? [] : ['testcase.update'])]) await fastify.requirePermission(permission,{projectId:input.project_id})(req);
    return {projectId:input.project_id,user:req.user,input};
  };
  fastify.get('/ai/coverage-mappings',async(req,reply)=> { reply.header('cache-control','no-store'); return coverageReview.load(await coverageAccess(req)); });
  fastify.post('/ai/coverage-mappings', {bodyLimit:12000}, async(req)=>coverageReview.save(await coverageAccess(req)));
};
