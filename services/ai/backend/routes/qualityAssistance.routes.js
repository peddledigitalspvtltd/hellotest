const assistance = require("../services/qualityAssistance.service");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const richTextAi = require("../services/richTextAi.service");
const requirementService = require("@hellotest/manual/backend/services/requirement.service");
const testCaseService = require("@hellotest/testing/backend/services/testCase.service");
const executionService = require("@hellotest/testing/backend/services/execution.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");

module.exports = async function (fastify) {
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
  const coverageReview = require('../services/qualityCoverageReview.service');
  const coverageAccess = async req => {
    const input = req.method === 'GET' ? req.query : req.body;
    fastify.validate({ project_id:{required:true,type:'string',maxLength:255},story_id:{required:true,type:'string',maxLength:255} },input || {});
    await projectService.getProject(input.project_id,req.user.id);
    for (const permission of ['requirement.view','testcase.view',...(req.method === 'GET' ? [] : ['testcase.update'])]) await fastify.requirePermission(permission,{projectId:input.project_id})(req);
    return {projectId:input.project_id,user:req.user,input};
  };
  fastify.get('/ai/coverage-mappings',async(req,reply)=> { reply.header('cache-control','no-store'); return coverageReview.load(await coverageAccess(req)); });
  fastify.post('/ai/coverage-mappings', {bodyLimit:12000}, async(req)=>coverageReview.save(await coverageAccess(req)));

  const validateAssuranceInput = (body) => fastify.validate({
    project_id: { required: false, type: "string", maxLength: 255 },
    integration_id: { required: false, type: "string", maxLength: 255 },
    additional_context: { required: false, type: "string", maxLength: 12000 },
    review_purpose: { required: false, type: "string", enum: ["assurance", "change-impact"] },
    prompt_guidance: { required: false, type: "string", maxLength: 12000 },
    proposed_change: { required: false, type: "object" },
    assurance_baseline: { required: false, type: "object" }
  }, body || {});
  fastify.post("/ai/rich-text-rephrase", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      content: { required: true, type: "string" },
      content_html: { required: false, type: "string" },
      entity_type: { required: false, type: "string" },
      entity_title: { required: false, type: "string" },
      field_label: { required: false, type: "string" },
      aria_label: { required: false, type: "string" },
      additional_context: { required: false, type: "string", maxLength: 12000 }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    return richTextAi.rephrase({
      user: req.user,
      projectId: req.body.project_id,
      content: req.body.content,
      contentHtml: req.body.content_html,
      entityType: req.body.entity_type,
      entityTitle: req.body.entity_title,
      fieldLabel: req.body.field_label,
      ariaLabel: req.body.aria_label,
      additionalContext: req.body.additional_context
    });
  });

  fastify.post("/requirements/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    validateAssuranceInput(req.body);
    const requirement = await requirementService.getRequirement(req.params.id, { includeLinkedRecords: false });
    if (req.body?.project_id && req.body.project_id !== requirement.project_id) throw Object.assign(new Error("Story belongs to a different project"), { statusCode: 400 });
    await projectService.getProject(requirement.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: requirement.project_id })(req);
    return assistance.previewRequirementImpact({ user: req.user, requirementId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {},
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context, reviewPurpose: req.body?.review_purpose });
  });

  fastify.post("/test-cases/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    validateAssuranceInput(req.body);
    const testCase = await testCaseService.getTestCase(req.params.id);
    const appType = await appTypeService.getAppType(testCase.app_type_id);
    if (req.body?.project_id && req.body.project_id !== appType.project_id) throw Object.assign(new Error("Test Case belongs to a different project"), { statusCode: 400 });
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("testcase.ai", { projectId: appType.project_id })(req);
    return assistance.previewTestCaseImpact({ user: req.user, testCaseId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {},
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context, reviewPurpose: req.body?.review_purpose });
  });

  fastify.post("/executions/:id/ai-failure-clusters", async (req) => {
    await fastify.authenticate(req);
    const execution = await executionService.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    await fastify.requirePermission("run.ai", { projectId: execution.project_id })(req);
    return assistance.previewFailureClusters({ user: req.user, executionId: req.params.id, requestedScope: req.body?.scope, integrationId: req.body?.integration_id });
  });
};
