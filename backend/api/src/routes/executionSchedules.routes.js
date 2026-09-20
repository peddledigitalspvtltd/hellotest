const service = require("../services/executionSchedule.service");
const projectService = require("../services/project.service");
const testDataSetService = require("../services/testDataSet.service");
const mobileFeatureService = require("../services/mobileFeature.service");

const ensureSelectedTestDataAccess = async (fastify, req, projectId, dataSetId) => {
  if (!dataSetId) return;
  const dataSet = await testDataSetService.getTestDataSet(dataSetId);
  if (dataSet.project_id !== projectId) {
    const error = new Error("Test Data Set must belong to the scheduled Run project");
    error.statusCode = 403;
    throw error;
  }
  await fastify.requirePermission("data.view", { projectId: dataSet.project_id })(req);
};

const ensureSchedulePermission = async (fastify, req, permissionCode) => {
  const schedule = await service.getExecutionSchedule(req.params.id);
  await projectService.getProject(schedule.project_id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: schedule.project_id })(req);
  return schedule;
};

const requireMobileSchedulePermission = async (fastify, req, schedule, projectId = schedule.project_id) => {
  if (await mobileFeatureService.executionUsesMobile(schedule)) {
    await fastify.requirePermission("mobile.manage", { projectId })(req);
  }
};

module.exports = async function (fastify) {
  fastify.post("/execution-schedules", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string" },
      cadence: { required: false, type: "string" },
      next_run_at: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      created_by: { required: false, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    await requireMobileSchedulePermission(fastify, req, req.body);
    await ensureSelectedTestDataAccess(fastify, req, req.body.project_id, req.body.test_data_set_id);

    return service.createExecutionSchedule({ ...req.body, created_by: req.user.id });
  });

  fastify.get("/execution-schedules", async (req) => {
    await fastify.authenticate(req);
    let scopedProjectId = req.query.project_id || null;

    if (!scopedProjectId && req.query.app_type_id) {
      const appType = await require("../services/appType.service").getAppType(req.query.app_type_id);
      scopedProjectId = appType.project_id;
    }

    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("schedule.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing scheduled runs");
      error.statusCode = 400;
      throw error;
    }

    return service.getExecutionSchedules({
      project_id: scopedProjectId,
      app_type_id: req.query.app_type_id,
      is_active: req.query.is_active === undefined
        ? undefined
        : req.query.is_active === "true" || req.query.is_active === true
    });
  });

  fastify.get("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureSchedulePermission(fastify, req, "schedule.view");
  });

  fastify.put("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    const schedule = await ensureSchedulePermission(fastify, req, "schedule.update");
    if (req.body?.project_id && req.body.project_id !== schedule.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
      await fastify.requirePermission("schedule.update", { projectId: req.body.project_id })(req);
    }

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string" },
      cadence: { required: false, type: "string" },
      next_run_at: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    const targetProjectId = req.body.project_id || schedule.project_id;
    const effectiveDataSetId = Object.prototype.hasOwnProperty.call(req.body, "test_data_set_id")
      ? req.body.test_data_set_id
      : schedule.test_data_set_id;
    await requireMobileSchedulePermission(fastify, req, { ...schedule, ...req.body, project_id: targetProjectId }, targetProjectId);
    await ensureSelectedTestDataAccess(fastify, req, targetProjectId, effectiveDataSetId);

    return service.updateExecutionSchedule(req.params.id, req.body, req.user.id);
  });

  fastify.post("/execution-schedules/:id/run", async (req) => {
    await fastify.authenticate(req);
    const schedule = await ensureSchedulePermission(fastify, req, "schedule.run");
    await requireMobileSchedulePermission(fastify, req, schedule);
    return service.runExecutionSchedule(req.params.id, req.user.id);
  });

  fastify.delete("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureSchedulePermission(fastify, req, "schedule.delete");
    return service.deleteExecutionSchedule(req.params.id);
  });
};
