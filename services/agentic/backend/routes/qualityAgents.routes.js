const service=require('../services/qualityAgents.service');
module.exports=async function qualityAgentRoutes(fastify) {
  fastify.get('/agentic-quality/catalog',async req=>{await fastify.authenticate(req);return service.catalog(req.query,req.user);});
  fastify.post('/agentic-quality/plan',{bodyLimit:24000},async req=>{await fastify.authenticate(req);return service.plan(req.body||{},req.user);});
  fastify.get('/agentic-quality/runs',async req=>{await fastify.authenticate(req);return service.listRuns(req.query,req.user);});
  fastify.post('/agentic-quality/runs',{bodyLimit:24000},async(req,reply)=>{await fastify.authenticate(req);const run=await service.createRun(req.body||{},req.user,{requestKey:req.headers['idempotency-key']});return reply.code(202).header('Location',`/agentic-quality/runs/${run.id}`).send(run);});
  fastify.get('/agentic-quality/runs/:id',async req=>{await fastify.authenticate(req);return service.getRun(req.params.id,req.user);});
  fastify.post('/agentic-quality/runs/:id/cancel',async req=>{await fastify.authenticate(req);return service.cancelRun(req.params.id,req.user);});
  fastify.get('/agentic-quality/baselines',async req=>{await fastify.authenticate(req);return service.listBaselines(req.query,req.user);});
  fastify.post('/agentic-quality/runs/:id/baseline',{bodyLimit:2048},async(req,reply)=>{await fastify.authenticate(req);return reply.code(201).send(await service.approveBaseline(req.params.id,req.body||{},req.user));});
  const sendArtifact=(reply,result)=>reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Content-Disposition',`${result.content_type==='image/png'?'inline':'attachment'}; filename="${result.content_type==='image/png'?'quality-evidence.png':'quality-evidence.json'}"`).type(result.content_type).send(result.bytes);
  fastify.get('/agentic-quality/runs/:id/artifacts/:artifactId',async(req,reply)=>{await fastify.authenticate(req);return sendArtifact(reply,await service.getArtifact(req.params.id,req.params.artifactId,req.user));});
  fastify.get('/agentic-quality/baselines/:id/artifact',async(req,reply)=>{await fastify.authenticate(req);return sendArtifact(reply,await service.getBaselineArtifact(req.params.id,req.user));});
};
