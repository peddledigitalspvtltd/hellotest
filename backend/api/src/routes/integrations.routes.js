const service = require("../services/integration.service");
const { INTEGRATION_TYPE_VALUES } = require("../domain/catalog");

const MASKED_SECRET_VALUE = "********";

const maskSecret = (value) => value ? MASKED_SECRET_VALUE : null;

const sanitizeIntegration = (integration) => {
  const config = integration.config || {};
  const baseIntegration = {
    ...integration,
    api_key: maskSecret(integration.api_key)
  };

  if (integration.type === "google_drive") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        folder_id: config.folder_id || null,
        schedule_mode: config.schedule_mode || "manual",
        last_synced_at: config.last_synced_at || null,
        last_sync_status: config.last_sync_status || null,
        last_sync_transaction_id: config.last_sync_transaction_id || null,
        last_sync_summary: config.last_sync_summary || null
      }
    };
  }

  if (integration.type === "github") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        owner: config.owner || null,
        repo: config.repo || null,
        branch: config.branch || "main",
        directory: config.directory || "qaira-sync",
        schedule_mode: config.schedule_mode || "manual",
        last_synced_at: config.last_synced_at || null,
        last_sync_status: config.last_sync_status || null,
        last_sync_transaction_id: config.last_sync_transaction_id || null,
        last_sync_summary: config.last_sync_summary || null
      }
    };
  }

  if (integration.type === "testengine") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        runner: config.runner || "hybrid",
        dispatch_mode: config.dispatch_mode || "qaira-pull",
        execution_scope: config.execution_scope || "api+web",
        active_web_engine: config.active_web_engine || "playwright",
        browser: config.browser || "chromium",
        headless: config.headless !== false,
        healing_enabled: config.healing_enabled !== false,
        max_repair_attempts: config.max_repair_attempts ?? 0,
        trace_mode: config.trace_mode || "off",
        video_mode: config.video_mode || "off",
        capture_console: config.capture_console !== false,
        capture_network: config.capture_network !== false,
        artifact_retention_days: config.artifact_retention_days ?? 7,
        run_timeout_seconds: config.run_timeout_seconds ?? 1800,
        navigation_timeout_ms: config.navigation_timeout_ms ?? 30000,
        action_timeout_ms: config.action_timeout_ms ?? 5000,
        assertion_timeout_ms: config.assertion_timeout_ms ?? 10000,
        recovery_wait_ms: config.recovery_wait_ms ?? 750,
        max_video_attachment_mb: config.max_video_attachment_mb ?? 25,
        queue_poll_interval_minutes: config.queue_poll_interval_minutes ?? 5,
        qaira_api_base_url: config.qaira_api_base_url || null,
        promote_healed_patches: config.promote_healed_patches || "review",
        live_view_url: config.live_view_url || null,
        mobile_engine_url: config.mobile_engine_url || null,
        mobile_cloud_provider: config.mobile_cloud_provider || null,
        mobile_remote_url: config.mobile_remote_url || null,
        mobile_username: config.mobile_username || null,
        mobile_access_key: maskSecret(config.mobile_access_key),
        device_name: config.device_name || null,
        platform_version: config.platform_version || null,
        android_app: config.android_app || null
      }
    };
  }

  if (integration.type === "cloudrun") {
    return {
      ...baseIntegration,
      config: {
        provider: config.provider || "browserstack",
        project_id: config.project_id || null,
        remote_url: config.remote_url || null,
        browser: config.browser || "Chrome",
        os: config.os || "Windows",
        device_name: config.device_name || null,
        platform_version: config.platform_version || null,
        build_name: config.build_name || null,
        session_name: config.session_name || null,
        provider_options: config.provider_options && typeof config.provider_options === "object" ? config.provider_options : {}
      }
    };
  }

  if (integration.type === "ops") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        events_path: config.events_path || "/api/v1/events",
        health_path: config.health_path || "/health",
        api_key_header: config.api_key_header || "Authorization",
        api_key_prefix: Object.prototype.hasOwnProperty.call(config, "api_key_prefix") ? config.api_key_prefix : "Bearer",
        service_name: config.service_name || "qaira-testengine",
        environment: config.environment || "production",
        timeout_ms: config.timeout_ms ?? 4000,
        emit_step_events: config.emit_step_events !== false,
        emit_case_events: config.emit_case_events !== false,
        emit_suite_events: config.emit_suite_events !== false,
        emit_run_events: config.emit_run_events !== false
      }
    };
  }

  if (integration.type === "email") {
    return {
      ...baseIntegration,
      config: {
        host: config.host || null,
        port: config.port || 587,
        secure: Boolean(config.secure),
        password: maskSecret(config.password),
        sender_email: config.sender_email || null,
        sender_name: config.sender_name || null
      }
    };
  }

  if (integration.type === "google_auth") {
    return {
      ...baseIntegration,
      config: {
        client_id: config.client_id || null
      }
    };
  }

  return {
    ...baseIntegration,
    config: {}
  };
};

module.exports = async function (fastify) {
  fastify.post("/integrations", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      type: { required: true, type: "string", enum: INTEGRATION_TYPE_VALUES },
      name: { required: true, type: "string", minLength: 2 },
      base_url: { required: false, type: "string" },
      api_key: { required: false, type: "string" },
      model: { required: false, type: "string" },
      project_key: { required: false, type: "string" },
      username: { required: false, type: "string" },
      config: { required: false, type: "object" },
      is_active: { required: false, type: "boolean" }
    }, req.body);

    return service.createIntegration(req.body);
  });

  fastify.get("/integrations", async (req) => {
    await fastify.authenticate(req);
    const { type, is_active } = req.query;

    const integrations = await service.getIntegrations({
      type,
      is_active: is_active !== undefined ? is_active === "true" : undefined
    });

    const scopedIntegrations = req.user.role === "admin"
      ? integrations
      : integrations.filter((integration) => integration.is_active);

    return scopedIntegrations.map(sanitizeIntegration);
  });

  fastify.post("/integrations/test-connection", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      type: { required: true, type: "string", enum: INTEGRATION_TYPE_VALUES },
      base_url: { required: false, type: "string" },
      api_key: { required: false, type: "string" },
      config: { required: false, type: "object" }
    }, req.body);

    return service.testConnection(req.body);
  });

  fastify.get("/integrations/export", async (req) => {
    await fastify.authenticate(req);

    if (req.user.role !== "admin") {
      const error = new Error("Only admins can export integrations");
      error.statusCode = 403;
      throw error;
    }

    const payload = await service.exportIntegrations();
    return {
      ...payload,
      integrations: payload.integrations.map(sanitizeIntegration)
    };
  });

  fastify.post("/integrations/import", async (req) => {
    await fastify.authenticate(req);

    if (req.user.role !== "admin") {
      const error = new Error("Only admins can import integrations");
      error.statusCode = 403;
      throw error;
    }

    fastify.validate({
      integrations: { required: true, type: "array" }
    }, req.body);

    return service.importIntegrations(req.body);
  });

  fastify.get("/integrations/:id", async (req) => {
    await fastify.authenticate(req);
    const integration = await service.getIntegration(req.params.id);

    if (req.user.role !== "admin" && !integration.is_active) {
      const error = new Error("Integration not found");
      error.statusCode = 404;
      throw error;
    }

    return sanitizeIntegration(integration);
  });

  fastify.put("/integrations/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      type: { required: false, type: "string", enum: INTEGRATION_TYPE_VALUES },
      name: { required: false, type: "string", minLength: 2 },
      base_url: { required: false, type: "string" },
      api_key: { required: false, type: "string" },
      model: { required: false, type: "string" },
      project_key: { required: false, type: "string" },
      username: { required: false, type: "string" },
      config: { required: false, type: "object" },
      is_active: { required: false, type: "boolean" }
    }, req.body);

    return service.updateIntegration(req.params.id, req.body);
  });

  fastify.delete("/integrations/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteIntegration(req.params.id);
  });
};
