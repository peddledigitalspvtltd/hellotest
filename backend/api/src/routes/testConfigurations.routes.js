const service = require("../services/testConfiguration.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { hasMobileOperatingSystem, isMobileAppType } = require("../utils/mobileFeature");
const { configurationTargetsUseMobile } = require("../utils/configurationTargets");

const createScopeError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const resolveListProjectId = async ({ project_id, app_type_id } = {}) => {
  if (!project_id && !app_type_id) {
    throw createScopeError("project_id or app_type_id is required when listing Test Configurations");
  }

  if (!app_type_id) return project_id;
  const appType = await appTypeService.getAppType(app_type_id);
  if (project_id && appType.project_id !== project_id) {
    throw createScopeError("App type must belong to the selected project");
  }
  return project_id || appType.project_id;
};

const configurationUsesMobile = async (configuration, appType = null) => {
  const resolvedAppType = appType || (configuration?.app_type_id
    ? await appTypeService.getAppType(configuration.app_type_id)
    : null);
  return hasMobileOperatingSystem(configuration?.mobile_os)
    || configurationTargetsUseMobile(configuration?.targets)
    || isMobileAppType(resolvedAppType?.type);
};

const requireMobileConfigurationPermission = async (fastify, req, permissionCode, configuration, appType = null) => {
  if (await configurationUsesMobile(configuration, appType)) {
    await fastify.requirePermission(permissionCode, { projectId: configuration.project_id })(req);
  }
};

module.exports = async function (fastify) {
  fastify.post("/test-configurations", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      browser: { required: false, type: "string" },
      mobile_os: { required: false, type: "string" },
      platform_version: { required: false, type: "string" },
      targets: { required: false, type: "array", maxItems: 100 },
      variables: { required: false, type: "array" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("configuration.manage", { projectId: req.body.project_id })(req);

    let appType = null;
    if (req.body.app_type_id) {
      appType = await appTypeService.getAppType(req.body.app_type_id);

      if (appType.project_id !== req.body.project_id) {
        throw new Error("App type must belong to the selected project");
      }
    }
    await requireMobileConfigurationPermission(fastify, req, "mobile.manage", req.body, appType);

    return service.createTestConfiguration(req.body);
  });

  fastify.get("/test-configurations", async (req) => {
    await fastify.authenticate(req);
    const { project_id, app_type_id } = req.query;

    const scopedProjectId = await resolveListProjectId({ project_id, app_type_id });
    await projectService.getProject(scopedProjectId, req.user.id);
    await fastify.requirePermission("configuration.view", { projectId: scopedProjectId })(req);

    const configurations = await service.getTestConfigurations({ project_id, app_type_id });
    const visible = [];
    for (const configuration of configurations) {
      try {
        await requireMobileConfigurationPermission(fastify, req, "mobile.view", configuration);
        visible.push(configuration);
      } catch (error) {
        if (error?.statusCode !== 403 || !await configurationUsesMobile(configuration)) throw error;
      }
    }
    return visible;
  });

  fastify.get("/test-configurations/:id", async (req) => {
    await fastify.authenticate(req);
    const configuration = await service.getTestConfiguration(req.params.id);
    await projectService.getProject(configuration.project_id, req.user.id);
    await fastify.requirePermission("configuration.view", { projectId: configuration.project_id })(req);
    await requireMobileConfigurationPermission(fastify, req, "mobile.view", configuration);
    return configuration;
  });

  fastify.put("/test-configurations/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      browser: { required: false, type: "string" },
      mobile_os: { required: false, type: "string" },
      platform_version: { required: false, type: "string" },
      targets: { required: false, type: "array", maxItems: 100 },
      variables: { required: false, type: "array" }
    }, req.body);

    const configuration = await service.getTestConfiguration(req.params.id);
    await projectService.getProject(configuration.project_id, req.user.id);
    await fastify.requirePermission("configuration.manage", { projectId: configuration.project_id })(req);

    if (req.body.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
      await fastify.requirePermission("configuration.manage", { projectId: req.body.project_id })(req);
    }

    const targetProjectId = req.body.project_id || configuration.project_id;
    const targetAppTypeId = Object.prototype.hasOwnProperty.call(req.body, "app_type_id")
      ? req.body.app_type_id
      : configuration.app_type_id;
    const targetAppType = targetAppTypeId ? await appTypeService.getAppType(targetAppTypeId) : null;
    if (targetAppType && targetAppType.project_id !== targetProjectId) {
      throw new Error("App type must belong to the selected project");
    }
    const updatesTargets = Object.prototype.hasOwnProperty.call(req.body, "targets");
    const effectiveMobileOs = Object.prototype.hasOwnProperty.call(req.body, "mobile_os")
      ? req.body.mobile_os
      : updatesTargets
        ? req.body.targets.find((target) => String(target?.mobile_os || "").trim())?.mobile_os || null
        : configuration.mobile_os;
    await requireMobileConfigurationPermission(fastify, req, "mobile.manage", {
      ...configuration,
      ...req.body,
      project_id: targetProjectId,
      app_type_id: targetAppTypeId,
      mobile_os: effectiveMobileOs,
      targets: updatesTargets
        ? req.body.targets
        : configuration.targets
    }, targetAppType);

    return service.updateTestConfiguration(req.params.id, req.body);
  });

  fastify.delete("/test-configurations/:id", async (req) => {
    await fastify.authenticate(req);
    const configuration = await service.getTestConfiguration(req.params.id);
    await projectService.getProject(configuration.project_id, req.user.id);
    await fastify.requirePermission("configuration.manage", { projectId: configuration.project_id })(req);
    return service.deleteTestConfiguration(req.params.id);
  });
};
