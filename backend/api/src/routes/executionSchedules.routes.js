const service = require("../services/executionSchedule.service");
const projectService = require("../services/project.service");

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
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      created_by: { required: true, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createExecutionSchedule(req.body);
  });

  fastify.get("/execution-schedules", async (req) => {
    await fastify.authenticate(req);

    if (req.query.project_id) {
      await projectService.getProject(req.query.project_id, req.user.id);
    }

    return service.getExecutionSchedules({
      project_id: req.query.project_id,
      app_type_id: req.query.app_type_id,
      is_active: req.query.is_active === undefined
        ? undefined
        : req.query.is_active === "true" || req.query.is_active === true
    });
  });

  fastify.get("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    const schedule = await service.getExecutionSchedule(req.params.id);
    await projectService.getProject(schedule.project_id, req.user.id);
    return schedule;
  });

  fastify.put("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    const schedule = await service.getExecutionSchedule(req.params.id);
    await projectService.getProject(schedule.project_id, req.user.id);
    if (req.body?.project_id && req.body.project_id !== schedule.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
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
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.updateExecutionSchedule(req.params.id, req.body, req.user.id);
  });

  fastify.post("/execution-schedules/:id/run", async (req) => {
    await fastify.authenticate(req);
    const schedule = await service.getExecutionSchedule(req.params.id);
    await projectService.getProject(schedule.project_id, req.user.id);
    return service.runExecutionSchedule(req.params.id, req.user.id);
  });

  fastify.delete("/execution-schedules/:id", async (req) => {
    await fastify.authenticate(req);
    const schedule = await service.getExecutionSchedule(req.params.id);
    await projectService.getProject(schedule.project_id, req.user.id);
    return service.deleteExecutionSchedule(req.params.id);
  });
};
