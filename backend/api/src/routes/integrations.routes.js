const service = require("../services/integration.service");
const workspaceTransactionService = require("../services/workspaceTransaction.service");
const projectService = require("../services/project.service");
const { INTEGRATION_TYPE_VALUES } = require("../domain/catalog");
const { containsMobileIntegrationConfig } = require("../utils/mobileFeature");

const MASKED_SECRET_VALUE = "********";

const maskSecret = (value) => value ? MASKED_SECRET_VALUE : null;

const requireMobileIntegrationWrite = async (fastify, req, input = {}, existing = null) => {
  const type = input.type || existing?.type;
  const submittedConfig = input.config && typeof input.config === "object" && !Array.isArray(input.config)
    ? input.config
    : {};

  if (!containsMobileIntegrationConfig({ type, config: submittedConfig })) return;

  const projectId = submittedConfig.project_id || existing?.config?.project_id || null;
  if (!projectId && req.user.role !== "admin") {
    const error = new Error("Project scope is required to manage mobile integration configuration.");
    error.statusCode = 400;
    throw error;
  }
  if (projectId) {
    await projectService.getProject(projectId, req.user.id);
  }
  await fastify.requirePermission("mobile.manage", projectId ? { projectId } : {})(req);
};

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
        directory: config.directory || "hellotest-sync",
        schedule_mode: config.schedule_mode || "manual",
        last_synced_at: config.last_synced_at || null,
        last_sync_status: config.last_sync_status || null,
        last_sync_transaction_id: config.last_sync_transaction_id || null,
        last_sync_summary: config.last_sync_summary || null
      }
    };
  }

  if (integration.type === "testengine" || integration.type === "local-desktop") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        runner: config.runner || (integration.type === "local-desktop" ? "local" : "hybrid"),
        dispatch_mode: config.dispatch_mode || "hellotest-pull",
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
        hellotest_api_base_url: config.hellotest_api_base_url || null,
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
        service_name: config.service_name || "hellotest-testengine",
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

  if (integration.type === "llm") {
    return {
      ...baseIntegration,
      config: {
        project_id: config.project_id || null,
        model: integration.model || null,
        base_url: integration.base_url || null
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

    await requireMobileIntegrationWrite(fastify, req, req.body);

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

    await requireMobileIntegrationWrite(fastify, req, req.body);

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
    const response = {
      ...payload,
      integrations: payload.integrations.map(sanitizeIntegration)
    };

    const transaction = await workspaceTransactionService.createTransaction({
      category: "bulk_export",
      action: "integration_export",
      status: "completed",
      title: "Integration export",
      description: `Exported ${response.integrations.length} integration${response.integrations.length === 1 ? "" : "s"}.`,
      metadata: {
        export_format: "json",
        total_items: response.integrations.length,
        processed_items: response.integrations.length,
        exported: response.integrations.length,
        failed: 0,
        progress_percent: 100,
        current_phase: "completed"
      },
      related_kind: "integrations",
      related_id: "all",
      created_by: req.user.id,
      started_at: response.exported_at,
      completed_at: response.exported_at
    });
    const artifact = await workspaceTransactionService.createTransactionArtifact(transaction.id, {
      file_name: "hellotest-integrations-export.json",
      mime_type: "application/json",
      content: JSON.stringify(response, null, 2)
    });
    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "success",
      phase: "complete",
      message: `Exported ${response.integrations.length} integration${response.integrations.length === 1 ? "" : "s"}.`,
      details: {
        artifact_id: artifact.id,
        exported: response.integrations.length
      }
    });
    await workspaceTransactionService.createTransactionNotification(transaction.id, {
      type: "batch_process.completed",
      title: "Integration export completed",
      message: "Integration export is available in TestOps."
    });

    return {
      ...response,
      transaction_id: transaction.id,
      artifact_id: artifact.id
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

    for (const integration of req.body.integrations) {
      if (integration && typeof integration === "object" && !Array.isArray(integration)) {
        await requireMobileIntegrationWrite(fastify, req, integration);
      }
    }

    const startedAt = new Date().toISOString();
    const transaction = await workspaceTransactionService.createTransaction({
      category: "bulk_import",
      action: "integration_import",
      status: "running",
      title: "Integration import",
      description: `Importing ${req.body.integrations.length} integration${req.body.integrations.length === 1 ? "" : "s"}.`,
      metadata: {
        import_source: "json",
        total_items: req.body.integrations.length,
        processed_items: 0,
        imported: 0,
        updated: 0,
        failed: 0,
        progress_percent: 0,
        current_phase: "import"
      },
      related_kind: "integrations",
      related_id: "all",
      created_by: req.user.id,
      started_at: startedAt
    });

    try {
      const result = await service.importIntegrations(req.body);
      const processed = result.imported + result.updated + result.failed;

      await workspaceTransactionService.updateTransaction(transaction.id, {
        status: "completed",
        description: `Integration import completed: ${result.imported} created, ${result.updated} updated, ${result.failed} failed.`,
        metadata: {
          total_items: req.body.integrations.length,
          processed_items: processed,
          imported: result.imported,
          updated: result.updated,
          failed: result.failed,
          progress_percent: 100,
          current_phase: "completed"
        },
        completed_at: new Date().toISOString()
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: result.failed ? "warning" : "success",
        phase: "complete",
        message: `Integration import completed: ${result.imported} created, ${result.updated} updated, ${result.failed} failed.`,
        details: result
      });
      await workspaceTransactionService.createTransactionNotification(transaction.id, {
        type: result.failed ? "batch_process.completed_with_warnings" : "batch_process.completed",
        title: "Integration import completed",
        message: `Created ${result.imported}, updated ${result.updated}, failed ${result.failed}.`
      });

      return {
        ...result,
        transaction_id: transaction.id
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Integration import failed";

      await workspaceTransactionService.updateTransaction(transaction.id, {
        status: "failed",
        description: message,
        metadata: {
          current_phase: "failed",
          error: message
        },
        completed_at: new Date().toISOString()
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: "error",
        phase: "failed",
        message
      });
      await workspaceTransactionService.createTransactionNotification(transaction.id, {
        type: "batch_process.failed",
        title: "Integration import failed",
        message
      });
      throw error;
    }
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

    const existing = await service.getIntegration(req.params.id);
    await requireMobileIntegrationWrite(fastify, req, req.body, existing);

    return service.updateIntegration(req.params.id, req.body);
  });

  fastify.delete("/integrations/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteIntegration(req.params.id);
  });
};

module.exports._internals = {
  sanitizeIntegration
};
