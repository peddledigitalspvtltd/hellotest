// engineEnvelope: cohesive builder implementation; dependencies are explicit lazy ports.
function createEngineEnvelope(ports) {
const exports = ports.exports;
const require = ports.require;


const buildEngineEnvelope = async ({
  engineRunId,
  execution,
  project,
  appType,
  caseSnapshot,
  steps,
  stepsByCaseId,
  integration,
  objectRepository = [],
  dataSetIteration = null,
  initiatedBy,
  environmentCache
}) => {
  execution = await ports.executionWithCaseEnvironment({ execution, caseSnapshot, actorId: initiatedBy, cache: environmentCache });
  const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const configurationSnapshot = execution.test_configuration?.snapshot || {};
  const configurationTargets = ports.configurationTargetsForRead(configurationSnapshot.targets, configurationSnapshot);
  const appTypeKind = ports.resolveAutomationCaseType(caseSnapshot, { steps, appTypeKind: appType?.type || execution.app_type_type });
  const isMobileTarget = appTypeKind === "android" || appTypeKind === "ios";
  const selectedConfigurationTarget = isMobileTarget
    ? configurationTargets.find((target) => ports.normalizeText(target.mobile_os)?.toLowerCase() === appTypeKind)
    : configurationTargets.find((target) => ports.normalizeText(target.browser) && !ports.normalizeText(target.mobile_os))
      || configurationTargets.find((target) => ports.normalizeText(target.browser))
      || configurationTargets[0];
  const resolvedBrowser = ports.normalizeEngineBrowser(
    selectedConfigurationTarget?.browser
    || configurationSnapshot.browser
    || execution.test_environment?.snapshot?.browser
    || integrationConfig.browser
    || "chromium",
    "chromium"
  );
  const executionPolicy = await ports.resolveExecutionPolicy(execution, caseSnapshot);
  const caseDataSet = ports.resolveCaseDataSetContext(execution, caseSnapshot);
  let hooks = ports.resolveExecutionHooks({execution,integrationHooks:integrationConfig.execution_hooks,caseSnapshot,stepsByCaseId,appTypeKind:appType?.type||'web'});
  if (hooks.some(hook => hook.steps.some(step => step.step_type === 'web' && typeof step.automation_code === 'string'))) {
    const { canonicalizeSavedLocatorWrappers } = await import("../../../shared/automationProgramCompatibility.mjs");
    // Apply the same saved-source adapter to frozen hooks without adding an
    // assertion requirement to setup/teardown or editing their snapshots.
    hooks = hooks.map(hook => ({ ...hook, steps: hook.steps.map(step => {
      if (step.step_type !== 'web' || typeof step.automation_code !== 'string') return step;
      const normalized = canonicalizeSavedLocatorWrappers(step.automation_code);
      return normalized.changed ? { ...step, automation_code: normalized.source } : step;
    }) }));
  }
  const mobileEngine = require("../../lib/build/automationMobileConfiguration").buildMobileEngineConfiguration({automationCaseType:appTypeKind,steps,hooks,configurationSnapshot,integrationConfig});

  return require('@hellotest/contracts/engine').versionEngineEnvelope(ports.preserveFrozenEngineEnvelope({
    engine_run_id: engineRunId,
    parameter_scope_default: execution.parameter_scope_default || "r",
    hellotest_run_id: execution.id,
    hellotest_execution_id: execution.id,
    hellotest_test_case_id: caseSnapshot.test_case_id,
    hellotest_test_case_title: caseSnapshot.test_case_title,
    external_references: ports.normalizeStoredReferenceList(caseSnapshot.external_references),
    project: {
      id: project.id,
      name: project.name
    },
    app_type: {
      id: appType?.id || execution.app_type_id || "unknown",
      name: appType?.name || "Unknown App Type",
      kind: appType?.type || "web"
    },
    trigger: "execution",
    source_mode: "manual-handover",
    automated: true,
    automation_case_type: appTypeKind,
    execution_policy: executionPolicy,
    browser: resolvedBrowser,
    headless: integrationConfig.headless === true,
    max_repair_attempts:
      execution.repair_validation || integrationConfig.healing_enabled === false
        ? 0
        : Math.max(0, ports.normalizeInteger(integrationConfig.max_repair_attempts, 1) ?? 1),
    run_timeout_seconds: Math.max(60, ports.normalizeInteger(integrationConfig.run_timeout_seconds, 1800) ?? 1800),
    timeouts: {
      navigation_timeout_ms: Math.max(1000, ports.normalizeInteger(integrationConfig.navigation_timeout_ms, 30000) ?? 30000),
      action_timeout_ms: Math.max(250, ports.normalizeInteger(integrationConfig.action_timeout_ms, 5000) ?? 5000),
      assertion_timeout_ms: Math.max(250, ports.normalizeInteger(integrationConfig.assertion_timeout_ms, 10000) ?? 10000),
      recovery_wait_ms: Math.max(100, ports.normalizeInteger(integrationConfig.recovery_wait_ms, 750) ?? 750),
      domcontentloaded_wait_ms: Math.max(0, ports.normalizeInteger(integrationConfig.domcontentloaded_wait_ms, 5000) ?? 5000),
      network_idle_wait_ms: Math.max(0, ports.normalizeInteger(integrationConfig.network_idle_wait_ms, 1500) ?? 1500)
    },
    session_policy: {
      web: {
        mode: execution.repair_validation ? "new" : ports.normalizeSessionMode(integrationConfig.web_session_mode, "new"),
        reuse_key: execution.repair_validation ? null : ports.normalizeText(integrationConfig.web_session_reuse_key) || null,
        connect_over_cdp_endpoint: execution.repair_validation ? null : ports.normalizeText(integrationConfig.connect_over_cdp_endpoint || integrationConfig.playwright_cdp_endpoint) || null,
        close_on_finish: Boolean(execution.repair_validation) || integrationConfig.close_attached_web_session === true
      },
      mobile: {
        mode: ports.normalizeSessionMode(integrationConfig.mobile_session_mode, "new"),
        reuse_key: ports.normalizeText(integrationConfig.mobile_session_reuse_key) || null,
        existing_session_id: ports.normalizeText(integrationConfig.mobile_existing_session_id || integrationConfig.appium_session_id) || null,
        close_on_finish: integrationConfig.close_attached_mobile_session === true
      }
    },
    web_engine: {
      active: ports.normalizeTestEngineWebEngine(integrationConfig.active_web_engine, "playwright")
    },
    mobile_engine: mobileEngine,
    manual_spec: ports.buildManualSpec({ caseSnapshot, steps, execution }),
    auto_repair_brief: await ports.configuredRepairBrief(),
    hooks,
    object_repository: objectRepository,
    steps,
    suite_parameters: ports.normalizeStringRecord(caseSnapshot.suite_parameter_values),
    case_parameters: ports.normalizeStringRecord(caseSnapshot.parameter_values),
    run_parameters: ports.normalizeStringRecord(execution.parameter_values),
    parameters_frozen: true,
    data_policy: caseSnapshot.test_data_options?.runtime_policy,
    environment: execution.test_environment
      ? {
          name: execution.test_environment.name,
          base_url: execution.test_environment.snapshot?.base_url || null,
          browser: execution.test_environment.snapshot?.browser || null,
          variables: ports.toEngineKeyValueEntries(execution.test_environment.snapshot?.variables)
        }
      : null,
    configuration: execution.test_configuration
      ? {
          name: execution.test_configuration.name,
          os: selectedConfigurationTarget?.os || null,
          browser: selectedConfigurationTarget?.browser || configurationSnapshot.browser || null,
          mobile_os: isMobileTarget ? appTypeKind : selectedConfigurationTarget?.mobile_os || configurationSnapshot.mobile_os || null,
          platform_version: isMobileTarget ? mobileEngine.platform_version : selectedConfigurationTarget?.version || configurationSnapshot.platform_version || null,
          targets: configurationTargets,
          variables: ports.toEngineKeyValueEntries(execution.test_configuration.snapshot?.variables)
        }
      : null,
    data_set: caseDataSet
      ? {
          id: caseDataSet.id || null,
          name: caseDataSet.name,
          source: caseDataSet.source,
          mode: caseDataSet.snapshot?.mode === "key_value" ? "key_value" : "table",
          columns: Array.isArray(caseDataSet.snapshot?.columns)
            ? caseDataSet.snapshot.columns.map((entry) => String(entry))
            : [],
          rows: dataSetIteration?.row
            ? [dataSetIteration.row]
            : ports.toEngineDataSetRows(caseDataSet.snapshot?.rows),
          data_scope_policy: caseDataSet.snapshot?.data_scope_policy,
          parameter_data_layers: caseDataSet.snapshot?.parameter_data_layers ? Object.fromEntries(Object.entries(caseDataSet.snapshot.parameter_data_layers).map(([name, layer]) => [name, layer ? { ...layer,
            rows: [layer.rows[layer.rows.length === 1 ? 0 : dataSetIteration?.index || 0] || {}],
            template_rows: undefined } : null])) : undefined,
          shared_rows: Array.isArray(caseDataSet.snapshot?.shared_rows)
            ? [caseDataSet.snapshot.shared_rows[dataSetIteration?.index || 0] || {}] : undefined,
          iteration: dataSetIteration ? {
            index: dataSetIteration.index,
            number: dataSetIteration.index + 1,
            key: dataSetIteration.key,
            total: dataSetIteration.total
          } : null
        }
      : null,
    artifact_policy: {
      trace_mode: ports.normalizeText(integrationConfig.trace_mode) || "off",
      video_mode: ports.normalizeText(integrationConfig.video_mode) || "off",
      screenshot_mode: ["off", "all", "passed", "failed"].includes(integrationConfig.screenshot_mode)
        ? integrationConfig.screenshot_mode
        : (() => { const passed = integrationConfig.screenshot_on_success !== false, failed = integrationConfig.screenshot_on_failure !== false;
          return passed && failed ? "all" : passed ? "passed" : failed ? "failed" : "off"; })(),
      screenshot_on_failure: integrationConfig.screenshot_on_failure !== false,
      screenshot_on_success: integrationConfig.screenshot_on_success !== false,
      capture_console: integrationConfig.capture_console !== false,
      capture_network: integrationConfig.capture_network !== false,
      artifact_retention_days: Math.max(1, ports.normalizeInteger(integrationConfig.artifact_retention_days, 7) ?? 7),
      max_video_attachment_mb: Math.max(1, ports.normalizeInteger(integrationConfig.max_video_attachment_mb, 25) ?? 25)
    },
    callback: null
  }, execution.parameter_scope_default));
};
return { buildEngineEnvelope };
}
module.exports = { createEngineEnvelope };
