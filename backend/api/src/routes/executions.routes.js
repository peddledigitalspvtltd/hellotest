const service = require("../services/execution.service");
const executionPlanningService = require("../services/executionPlanning.service");
const executionAiAnalysisService = require("../services/executionAiAnalysis.service");
const executionReportService = require("../services/executionReport.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { EXECUTION_FINAL_STATUS_VALUES } = require("../domain/catalog");

module.exports = async function (fastify) {

  fastify.post("/executions/smart-plan-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      release_scope: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      impacted_requirement_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== req.body.project_id) {
      throw new Error("App type must belong to the selected project");
    }

    return executionPlanningService.previewSmartExecution({
      project_id: req.body.project_id,
      appType,
      integration_id: req.body.integration_id,
      release_scope: req.body.release_scope,
      additional_context: req.body.additional_context,
      impacted_requirement_ids: req.body.impacted_requirement_ids,
      test_environment_id: req.body.test_environment_id,
      test_configuration_id: req.body.test_configuration_id,
      test_data_set_id: req.body.test_data_set_id
    });
  });

  // CREATE EXECUTION
  fastify.post("/executions", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      execution_hooks: { required: false, type: "array" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" },
      execution_mode: { required: false, type: "string" },
      engine_base_url: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" }
    }, req.body);

    // Verify user is member of project
    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createExecution(req.body);
  });

  fastify.post("/executions/local-run", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" },
      engine_base_url: { required: false, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createLocalRun({
      ...req.body,
      created_by: req.user.id
    });
  });


  // GET ALL EXECUTIONS
  fastify.get("/executions", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, status } = req.query;
    let scopedProjectId = project_id;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);

      if (project_id && project_id !== appType.project_id) {
        throw new Error("Selected app type must belong to the current project");
      }

      scopedProjectId = appType.project_id;
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }

    return service.getExecutions({ project_id: scopedProjectId, app_type_id, status });
  });


  // GET ONE EXECUTION
  fastify.get("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return execution;
  });

  fastify.put("/executions/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.updateExecution(req.params.id, req.body);
  });

  fastify.put("/executions/:id/cases/:testCaseId/assignment", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.updateExecutionCaseAssignment(req.params.id, req.params.testCaseId, req.body);
  });

  fastify.post("/executions/:id/rerun", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      failed_only: { required: false, type: "boolean" },
      created_by: { required: true, type: "string" },
      name: { required: false, type: "string" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.rerunExecution(req.params.id, req.body);
  });


  // START EXECUTION
  fastify.post("/executions/:id/start", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return service.startExecution(req.params.id, {
      initiated_by: req.user.id,
      execution_mode: req.body?.execution_mode,
      engine_base_url: req.body?.engine_base_url
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/steps/:stepId/run", async (req) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.runExecutionApiStep(req.params.id, req.params.testCaseId, req.params.stepId, {
      executed_by: req.user.id
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/ai-analysis", async (req) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return executionAiAnalysisService.analyzeExecutionCase({
      execution,
      testCaseId: req.params.testCaseId,
      requestedBy: req.user.id
    });
  });

  fastify.get("/executions/:id/report.pdf", async (req, reply) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    const pdf = await executionReportService.renderReportPdf(req.params.id);
    const safeName = String(execution.name || execution.id || "qaira-run-report")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "qaira-run-report";

    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    return reply.send(pdf);
  });

  fastify.get("/executions/:id/report.html", async (req, reply) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    const html = await executionReportService.renderReportHtml(req.params.id);
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  fastify.post("/executions/:id/share-report", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      recipients: { required: true, type: "array", items: "string" }
    }, req.body || {});

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return executionReportService.emailReport({
      execution_id: req.params.id,
      recipients: req.body.recipients,
      requested_by: req.user.id
    });
  });


  // COMPLETE EXECUTION
  fastify.post("/executions/:id/complete", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: true, enum: EXECUTION_FINAL_STATUS_VALUES }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);

    return service.completeExecution(req.params.id, req.body.status);
  });


  // DELETE EXECUTION
  fastify.delete("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return service.deleteExecution(req.params.id);
  });

};
