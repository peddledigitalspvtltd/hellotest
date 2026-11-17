const workflows=require('../services/agenticWorkflow.service');
const triggers=require('../services/workflowTriggers.service');
module.exports=async fastify=>{
 const access=async(req,permission)=>{
  await fastify.authenticate(req);
  const workflow=await workflows.getWorkflow(req.params.id);
  await require('@hellotest/platform/backend/public/projectAccess').getProject(workflow.project_id,req.user.id);
  await fastify.requirePermission(permission,{projectId:workflow.project_id})(req);
  return workflow;
 };
 fastify.get('/agentic-workflows/:id/trigger',async req=>triggers.status(await access(req,'agentic_workflow.view')));
 fastify.post('/agentic-workflows/:id/trigger/rotate-secret',async req=>{
  const workflow=await access(req,'agentic_workflow.manage');
  await fastify.requirePermission('agentic_workflow.run',{projectId:workflow.project_id})(req);
  if(req.apiKey)throw Object.assign(new Error('Use your signed-in session to rotate a signing secret.'),{statusCode:403});
  return triggers.rotateSecret(workflow,req.user);
 });
 fastify.get('/agentic-workflow-runs/:id/resume-plan',async req=>{
  await fastify.authenticate(req);
  if(typeof req.query.node_id!=='string'||req.query.node_id.length>160)throw Object.assign(new Error('Choose a source step.'),{statusCode:400});
  return require('../services/workflowResume.service').preview(req.params.id,req.query.node_id,req.user);
 });
 fastify.post('/agentic-workflow-runs/:id/resume',{bodyLimit:32*1024},async(req,reply)=>{
  await fastify.authenticate(req);
  if(req.apiKey)throw Object.assign(new Error('Use your signed-in session to reconcile and resume a workflow.'),{statusCode:403});
  const run=await require('../services/workflowResume.service').resume(req.params.id,req.body||{},req.user);
  return reply.code(202).send(await require('../workflows/executionReadAccess').publicRun(run,req.user));
 });
 fastify.post('/agentic-workflow-hooks/:id',{bodyLimit:16*1024},async(req,reply)=>reply.code(202).send(await triggers.webhook(req.params.id,req.headers,req.body)));
};
