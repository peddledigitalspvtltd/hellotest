const projectService = require("@hellotest/platform/backend/public/projectAccess");


module.exports = async function automationRepairRoutes(fastify) {
  const repair = require('../services/automationRepair.service');
  const repairAccess = async (req, writes = []) => {
    await fastify.authenticate(req);
    const input = (req.method === 'GET' ? req.query : req.body) || {};
    fastify.validate({project_id:{required:true,type:'string',maxLength:255}},input);
    await projectService.getProject(input.project_id,req.user.id);
    for(const code of [...repair.permissions,'data.view',...writes]) await fastify.requirePermission(code,{projectId:input.project_id})(req);
    return input;
  };
  fastify.get('/ai/automation-repairs/:id',async(req,reply)=>{const input=await repairAccess(req);reply.header('cache-control','no-store');return repair.load(input.project_id,req.params.id);});
  fastify.post('/ai/automation-repairs/:id/validation',{bodyLimit:12000},async req=>{const input=await repairAccess(req,['run.create']);return repair.plan(input.project_id,req.params.id,req.user,input);});
  fastify.post('/ai/automation-repairs/:id/start',{bodyLimit:12000},async req=>{const input=await repairAccess(req,['run.execute']);return repair.start(input.project_id,req.params.id,req.user,input);});
  fastify.post('/ai/automation-repairs/:id/apply',{bodyLimit:12000},async req=>{const input=await repairAccess(req,['step.manage','testcase.update']);return repair.apply(input.project_id,req.params.id,req.user);});
};
