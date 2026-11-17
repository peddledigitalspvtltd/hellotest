const activity=require('../services/agentActivity.service');
const descriptors=require('../agents/agentDescriptors.service');
module.exports=async function(fastify){
  fastify.get('/agent-runs',async req=>{await fastify.authenticate(req);fastify.validate({project_id:{required:true,type:'string'},app_type_id:{required:false,type:'string'},system:{required:false,type:'string'},status:{required:false,type:'string'},limit:{required:false,type:'string'},cursor:{required:false,type:'string'}},req.query||{});return activity.list(req.query,req.user);});
  fastify.get('/agent-runs/descriptors',async req=>{await fastify.authenticate(req);const systems=await activity.authorize(req.query.project_id,req.query.app_type_id,req.user);return descriptors.catalog().filter(descriptor=>systems.includes(descriptor.system));});
  fastify.get('/agent-runs/:id',async req=>{await fastify.authenticate(req);return activity.detail(req.params.id,req.user);});
};
