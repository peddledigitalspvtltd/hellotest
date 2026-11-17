// engineTypes: cohesive builder implementation; dependencies are explicit lazy ports.
function createEngineTypes(ports) {
const exports = ports.exports;
const require = ports.require;


const normalizeEngineHostUrl = (value) => {
  const normalized = ports.normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return normalized.replace(/\/+$/, "");
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
};


const normalizeFallbackLocator = (value) => {
  if (typeof value === "string") {
    const locator = ports.normalizeText(value);
    return locator ? { locator, strategy: null, confidenceScore: null } : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const locator = ports.normalizeText(value.locator || value.selector || value.value);
  if (!locator) {
    return null;
  }

  const score = Number(value.confidenceScore ?? value.confidence_score ?? value.confidence);
  return {
    locator,
    strategy: ports.normalizeText(value.strategy || value.locator_kind || value.kind),
    confidenceScore: Number.isFinite(score) ? score : null
  };
};


const normalizeFallbackLocators = (...sources) => {
  const seen = new Set();
  const result = [];

  sources.flatMap((source) => Array.isArray(source) ? source : [source]).forEach((item) => {
    const locator = normalizeFallbackLocator(item);
    if (locator && !seen.has(locator.locator)) {
      seen.add(locator.locator);
      result.push(locator);
    }
  });

  return result;
};


const normalizeObjectRepositoryEntry = (row) => {
  const metadata = normalizeJsonValue(row.metadata, {});
  const fallbackLocators = normalizeFallbackLocators(
    metadata.fallback_locators,
    metadata.locator_candidates
  );
  const previousLocators = [
    ...(Array.isArray(metadata.previous_locators) ? metadata.previous_locators.map(String) : []),
    ports.normalizeText(metadata.playwright_locator),
    ports.normalizeText(metadata.primary_playwright_locator),
    ...fallbackLocators.map((item) => item.locator)
  ].filter(Boolean);
  // Execution needs locator bindings, not every field's captured DOM/images.
  // Keeping captures in the repository avoids multiplying them across runs
  // while allowing the complete scoped binding set to reach the engine.
  const executionMetadata = Object.fromEntries(['object_label', 'object_name', 'playwright_locator', 'primary_playwright_locator', 'locator']
    .filter(key => typeof metadata[key] === 'string').map(key => [key, metadata[key]]));

  return {
    id: row.id,
    test_case_id: ports.normalizeText(row.test_case_id),
    page_url: ports.normalizeText(row.page_url),
    page_key: ports.normalizeText(row.page_key) || "screen",
    locator_intent: ports.normalizeText(row.locator_intent) || "object",
    locator: ports.normalizeText(row.locator),
    locator_kind: ports.normalizeText(row.locator_kind),
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
    source: ports.normalizeText(row.source) || "repository",
    screen_name: ports.normalizeText(metadata.screen_name) || ports.normalizeText(row.page_key) || "Screen",
    object_name: ports.normalizeText(metadata.object_name) || ports.normalizeText(row.locator_intent) || "Object",
    object_role: ports.normalizeText(metadata.object_role) || ports.normalizeText(row.locator_kind) || null,
    target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.map(String) : [],
    fallback_strategy: ports.normalizeText(metadata.fallback_strategy),
    previous_locators: [...new Set(previousLocators)],
    reference_aliases: [...new Set((Array.isArray(metadata.reference_aliases) ? metadata.reference_aliases : []).filter(alias => typeof alias === "string").map(alias => alias.trim()).filter(Boolean))],
    fallback_locators: fallbackLocators,
    metadata: executionMetadata,
    updated_at: row.updated_at || null
  };
};


const normalizeInteger = (value, fallback = null) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};


const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};


const toRowArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.rows)) {
    return value.rows;
  }

  return [];
};


const normalizeTestEngineWebEngine = (value, fallback = "playwright") => {
  const normalized = ports.normalizeText(value)?.toLowerCase();
  return normalized && ports.TESTENGINE_WEB_ENGINE_VALUES.has(normalized) ? normalized : fallback;
};


const normalizeEngineClass = (value, fallback = null) => {
  const normalized = ports.normalizeText(value)?.toLowerCase();
  return normalized && ports.TESTENGINE_ENGINE_CLASSES.has(normalized) ? normalized : fallback;
};


const resolveStepEngineClass = (step = {}, appTypeKind = null) => {
  const stepType = ports.normalizeTestStepType(step?.step_type || step?.type, null);

  if (stepType === "api" || stepType === "web" || stepType === "android") {
    return stepType;
  }

  if (stepType === "ios") {
    return "android";
  }

  const normalizedAppType = ports.normalizeText(appTypeKind)?.toLowerCase();
  return normalizedAppType === "api" ? "api" : ["android", "ios"].includes(normalizedAppType) ? "android" : "web";
};


const resolveStepEngineClasses = (steps = [], appTypeKind = null) =>
  Array.from(new Set((steps || []).map((step) => resolveStepEngineClass(step, appTypeKind))));


const resolveOrchestrationClass = (steps = [], appTypeKind = null) => {
  const stepTypes = new Set((steps || []).map((step) => ports.normalizeTestStepType(step?.step_type || step?.type)).filter(Boolean));

  if (stepTypes.has("android") || stepTypes.has("ios")) {
    return "android";
  }

  if (stepTypes.has("web")) {
    return "web";
  }

  if (stepTypes.has("api")) {
    return "api";
  }

  const normalizedAppType = ports.normalizeText(appTypeKind)?.toLowerCase();
  return normalizedAppType === "api" ? "api" : ["android", "ios"].includes(normalizedAppType) ? "android" : "web";
};


const getQueueMaxWorkers = (engineClass) => {
  const normalized = normalizeEngineClass(engineClass, "web");
  const specificKey = `TESTENGINE_${normalized.toUpperCase()}_MAX_WORKERS`;
  const configured = normalizeInteger(process.env[specificKey], null)
    ?? normalizeInteger(process.env.TESTENGINE_MAX_WORKERS, null)
    ?? 3;

  return Math.max(1, configured);
};


const resolveIntegrationEngineMaxWorkers = (engineClass, integrationConfig = {}) => {
  const normalized = normalizeEngineClass(engineClass, "web");
  const specificKey = `max_${normalized}_workers`;
  const legacySpecificKey = `${normalized}_max_workers`;
  const configured = normalizeInteger(integrationConfig[specificKey], null)
    ?? normalizeInteger(integrationConfig[legacySpecificKey], null)
    ?? normalizeInteger(integrationConfig.max_worker_replicas, null)
    ?? normalizeInteger(integrationConfig.max_workers, null)
    ?? getQueueMaxWorkers(normalized);

  return Math.max(1, configured);
};


const resolveIntegrationEngineWorkerCaps = (integrationConfig = {}) => ({
  api: resolveIntegrationEngineMaxWorkers("api", integrationConfig),
  web: resolveIntegrationEngineMaxWorkers("web", integrationConfig),
  android: resolveIntegrationEngineMaxWorkers("android", integrationConfig)
});


const recommendWorkersForQueue = (queued, engineClass, maxWorkerOverride = null) => {
  const maxWorkers = Math.max(1, normalizeInteger(maxWorkerOverride, null) ?? getQueueMaxWorkers(engineClass));
  const queuedCount = Number(queued || 0);

  if (queuedCount <= 0) {
    return 0;
  }

  const targetBacklogPerWorker = Math.max(
    1,
    normalizeInteger(process.env.TESTENGINE_TARGET_QUEUED_PER_WORKER, engineClass === "api" ? 4 : 1) ?? 1
  );

  return Math.max(0, Math.min(maxWorkers, Math.ceil(queuedCount / targetBacklogPerWorker) || 0));
};


const normalizeEngineBrowser = (value, fallback = "chromium") => {
  const normalized = ports.normalizeText(value)?.toLowerCase();
  return normalized ? ports.TESTENGINE_BROWSER_ALIASES.get(normalized) || fallback : fallback;
};


const normalizeSessionMode = (value, fallback = "new") => {
  const normalized = ports.normalizeText(value)?.toLowerCase();
  return ["new", "reuse", "attach"].includes(normalized) ? normalized : fallback;
};


const normalizeHookFailBehavior = (value, fallback = "fail-run") => {
  const normalized = ports.normalizeText(value)?.toLowerCase();
  return ["fail-run", "mark-blocked", "continue"].includes(normalized) ? normalized : fallback;
};


const normalizeEngineHookStep = (step, index, fallbackType = "api") => {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    return null;
  }

  const stepType = resolveEngineStepType(step.step_type, fallbackType);
  return {
    id: ports.normalizeText(step.id) || `hook-step-${index + 1}`,
    order: Math.max(1, normalizeInteger(step.order ?? step.step_order, index + 1) ?? index + 1),
    step_type: stepType,
    engine_class: resolveStepEngineClass(step, fallbackType),
    source_case_parameters: normalizeStringRecord(step.source_case_parameters),
    ...(step.source_case_context ? {source_case_context:{case_parameters:step.source_case_context.case_parameters || {},suite_parameters:step.source_case_context.suite_parameters || {},data_policy:step.source_case_context.data_policy,data_set:step.source_case_context.data_set || null}} : {}),
    shared_parameter_values: normalizeStringRecord(step.shared_parameter_values),
    action: ports.normalizeText(step.action) || null,
    expected_result: ports.normalizeText(step.expected_result) || ports.normalizeText(step.expectedResult) || null,
    automation_code: ports.normalizeText(step.automation_code) || ports.normalizeText(step.automationCode) || null,
    api_request: ports.normalizeApiRequest(step.api_request || step.apiRequest || null),
    group_name: ports.normalizeText(step.group_name) || null,
    group_kind: ports.normalizeText(step.group_kind) || null
  };
};


const normalizeEngineHooks = (value, appTypeKind = "web") => {
  const entries = Array.isArray(value) ? value : [];

  return entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => {
      const phase = ports.normalizeText(entry.phase)?.toLowerCase();
      const scope = ports.normalizeText(entry.scope)?.toLowerCase();
      const steps = Array.isArray(entry.steps)
        ? entry.steps.map((step, stepIndex) => normalizeEngineHookStep(step, stepIndex, appTypeKind)).filter(Boolean)
        : [];

      if (!["pre", "post"].includes(phase) || !["run", "suite", "test"].includes(scope) || !steps.length) {
        return null;
      }

      return {
        id: ports.normalizeText(entry.id) || `hook-${scope}-${phase}-${index + 1}`,
        name: ports.normalizeText(entry.name) || `${scope} ${phase} hook`,
        scope,
        phase,
        fail_behavior: normalizeHookFailBehavior(entry.fail_behavior || entry.failBehavior, "fail-run"),
        target_kind: ports.normalizeText(entry.target_kind || entry.targetKind) || "inline",
        target_id: ports.normalizeText(entry.target_id || entry.targetId) || null,
        steps
      };
    })
    .filter(Boolean);
};


const buildHookStepFromSnapshot = (stepSnapshot, index, appTypeKind = "web") => {
  const stepType = resolveEngineStepType(stepSnapshot.step_type, appTypeKind);

  if (!stepType) {
    return null;
  }

  return {
    id: stepSnapshot.snapshot_step_id || stepSnapshot.id || `hook-step-${index + 1}`,
    order: index + 1,
    step_type: stepType,
    engine_class: resolveStepEngineClass({ step_type: stepType }, appTypeKind),
    action: ports.normalizeText(stepSnapshot.action),
    expected_result: ports.normalizeText(stepSnapshot.expected_result),
    automation_code: ports.normalizeRichText(stepSnapshot.automation_code),
    api_request: stepType === "api" ? ports.normalizeApiRequest(stepSnapshot.api_request) : null,
    shared_parameter_values: normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: ports.normalizeText(stepSnapshot.group_name),
    group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
      ? stepSnapshot.group_kind
      : null
  };
};


const normalizeHookArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
};


const resolveExecutionHooks = ({ execution, integrationHooks, caseSnapshot, stepsByCaseId, appTypeKind = "web" }) => {
  const executionHooks = normalizeHookArray(execution.execution_hooks);
  const runHooks = executionHooks.length ? executionHooks : normalizeHookArray(integrationHooks);
  const caseHooks = normalizeHookArray(caseSnapshot.execution_hooks);
  // Outer run setup, case setup, main case, case cleanup, outer run cleanup.
  // Do not apply the selected workspace case hooks to other selected cases.
  const rawHooks = [
    ...runHooks.filter(hook => hook?.phase !== "post"),
    ...caseHooks.filter(hook => hook?.phase !== "post"),
    ...caseHooks.filter(hook => hook?.phase === "post"),
    ...runHooks.filter(hook => hook?.phase === "post")
  ];
  const caseSnapshots = Array.isArray(execution.case_snapshots) ? execution.case_snapshots : [];

  const resolvedHooks = (Array.isArray(rawHooks) ? rawHooks : []).map((hook) => {
    if (!hook || typeof hook !== "object" || Array.isArray(hook) || Array.isArray(hook.steps) && hook.steps.length) {
      return hook;
    }

    const targetKind = ports.normalizeText(hook.target_kind || hook.targetKind) || "inline";
    const targetId = ports.normalizeText(hook.target_id || hook.targetId);
    let targetCaseIds = [];

    if (targetKind === "test" && targetId) {
      targetCaseIds = [targetId];
    } else if (targetKind === "suite" && targetId) {
      targetCaseIds = caseSnapshots
        .filter((snapshot) =>
          snapshot.suite_id === targetId
          || (Array.isArray(snapshot.suite_ids) && snapshot.suite_ids.includes(targetId))
        )
        .map((snapshot) => snapshot.test_case_id);
    }

    const steps = targetCaseIds
      .filter((testCaseId) => testCaseId !== caseSnapshot.test_case_id)
      .flatMap((testCaseId) => stepsByCaseId?.get(testCaseId) || [])
      .map((stepSnapshot, index) => buildHookStepFromSnapshot(stepSnapshot, index, appTypeKind))
      .filter(Boolean);

    return {
      ...hook,
      target_kind: targetKind,
      target_id: targetId,
      steps
    };
  });

  return normalizeEngineHooks(resolvedHooks, appTypeKind);
};


const buildStepAutomationDetail = (step, status, note = null, provider = null) => {
  const code = ports.normalizeRichText(step?.automation_code)
    || (step?.api_request ? JSON.stringify(step.api_request, null, 2) : "")
    || ports.normalizeText(step?.action)
    || "";

  return {
    engine: ports.normalizeTestStepType(step?.step_type || step?.type, "web"),
    provider,
    status,
    code,
    language: step?.api_request ? "json" : "javascript",
    active_line: null,
    error_line: status === "failed" || status === "blocked" ? 1 : null,
    error_message: status === "failed" || status === "blocked" ? ports.normalizeText(note) : null,
    ended_at: ports.nowIso()
  };
};


const buildProviderLiveViewUrl = (integration, provider) => {
  const configured = ports.normalizeText(integration?.config?.live_view_url);
  try {
    const parsed = new URL(configured);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname.endsWith("/api/v1/live-session")) {
      parsed.searchParams.set("provider", provider === "selenium" ? "selenium" : "playwright");
      return parsed.toString();
    }
  } catch {}

  const baseUrl = ports.normalizeText(integration?.config?.public_base_url || integration?.base_url);

  if (!baseUrl) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (!parsed.pathname.endsWith("/api/v1/live-session")) parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/api/v1/live-session`;
    parsed.search = `?provider=${provider === "selenium" ? "selenium" : "playwright"}`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};


const resolveDirectCallbackBaseUrl = (integration) =>
  ports.normalizeText(process.env.HELLOTEST_LOCAL_CALLBACK_BASE_URL)
  || ports.normalizeText(process.env.HELLOTEST_PUBLIC_API_BASE_URL)
  || ports.normalizeText(integration?.config?.local_callback_base_url)
  || "http://localhost:8080";


const resolveCallbackSecret = (integration) =>
  ports.resolveTestEngineSecret(
    ports.normalizeText(integration?.config?.callback_secret),
    ports.normalizeText(process.env.TESTENGINE_CALLBACK_SECRET)
  );


const buildDirectCallback = (integration) => {
  const baseUrl = new URL(resolveDirectCallbackBaseUrl(integration));
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("Configure a runner-reachable callback base URL without credentials, query or fragment.");
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath.endsWith("/api") ? basePath : `${basePath}/api`}/testengine/callbacks/runs`;
  return {
    url: baseUrl.toString(),
    signing_secret: resolveCallbackSecret(integration)
  };
};


const normalizeInlineEvidence = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const dataUrl = ports.normalizeText(value.dataUrl || value.data_url);

  if (!dataUrl || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    return null;
  }

  return {
    dataUrl,
    fileName: ports.normalizeText(value.fileName || value.file_name) || undefined,
    mimeType: ports.normalizeText(value.mimeType || value.mime_type) || undefined
  };
};


const normalizeApiDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};


const normalizeWebDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};


const normalizeAutomationDetail = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
};


const normalizeArtifactBundle = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
};




const normalizePatchProposals = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
};


const normalizeJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};


const normalizeStringRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = ports.normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};


const normalizeCapturedValuesRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = ports.normalizeText(String(key || "").replace(/^@+/, ""))?.toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};


const normalizeStepCapturesRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [stepId, captures]) => {
    const normalizedStepId = ports.normalizeText(stepId);

    if (!normalizedStepId) {
      return accumulator;
    }

    const normalizedCaptures = normalizeCapturedValuesRecord(captures);

    if (!Object.keys(normalizedCaptures).length) {
      return accumulator;
    }

    accumulator[normalizedStepId] = normalizedCaptures;
    return accumulator;
  }, {});
};


const toEngineKeyValueEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      key: ports.normalizeText(entry?.key),
      value: entry?.value === undefined || entry?.value === null ? "" : String(entry.value),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);
};


const toEngineDataSetRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = ports.normalizeText(String(key || ""));

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = value === undefined || value === null ? "" : String(value);
        return accumulator;
      }, {})
    );
};


const resolveCaseDataSetContext = (execution, caseSnapshot) => {
  const caseSnapshotData = normalizeJsonValue(caseSnapshot?.test_data_set_snapshot, null);

  if (caseSnapshotData || caseSnapshot?.test_data_set_id) {
    return {
      id: caseSnapshot?.test_data_set_id || caseSnapshotData?.id || null,
      name: caseSnapshot?.test_data_set_name || caseSnapshotData?.name || "Deleted data set",
      snapshot: caseSnapshotData,
      source: ["test_case", "suite"].includes(caseSnapshot?.data_set_source) ? caseSnapshot.data_set_source : "run"
    };
  }

  return execution?.test_data_set
    ? {
        ...execution.test_data_set,
        source: "run"
      }
    : null;
};


const resolveEngineStepType = (stepType, appTypeKind) => {
  const normalized = ports.normalizeTestStepType(stepType, null);

  if (normalized && ports.SUPPORTED_ENGINE_STEP_TYPES.has(normalized)) {
    return normalized;
  }

  if (appTypeKind === "api" && !normalized) {
    return "api";
  }

  if ((appTypeKind === "android" || appTypeKind === "ios") && !normalized) {
    return appTypeKind;
  }

  if ((appTypeKind === "web" || appTypeKind === "unified") && !normalized) {
    return "web";
  }

  return null;
};


const buildManualSpec = ({ caseSnapshot, steps, execution }) => {
  const preconditions = [];
  const environmentName = execution.test_environment?.name;
  const environmentBaseUrl = execution.test_environment?.snapshot?.base_url;
  const suiteName = ports.normalizeText(caseSnapshot.suite_name);

  if (suiteName && suiteName !== "Default") {
    preconditions.push(`Scope suite: ${suiteName}`);
  }

  if (environmentName) {
    preconditions.push(
      environmentBaseUrl
        ? `Environment: ${environmentName} (${environmentBaseUrl})`
        : `Environment: ${environmentName}`
    );
  }

  return {
    title: caseSnapshot.test_case_title,
    intent: ports.normalizeText(caseSnapshot.test_case_description) || `Execute and validate ${caseSnapshot.test_case_title}`,
    preconditions,
    steps: steps.map((step) => step.action || `Step ${step.order}`),
    detailed_steps: steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action || `Step ${step.order}`,
      expected_result: step.expected_result || null,
      automation_code: step.automation_code || null,
      api_request: step.api_request || null
    })),
    assertions: steps.map((step) => step.expected_result).filter(Boolean),
    test_data: {
      ...ports.normalizeParameterLayer(normalizeStringRecord(caseSnapshot.parameter_values), "r"),
      ...ports.normalizeParameterLayer(normalizeStringRecord(caseSnapshot.suite_parameter_values), "s")
    },
    environment_notes: ports.normalizeText(execution.test_environment?.snapshot?.notes)
  };
};
return { normalizeEngineHostUrl, normalizeFallbackLocator, normalizeFallbackLocators, normalizeObjectRepositoryEntry, normalizeInteger, normalizeBoolean, toRowArray, normalizeTestEngineWebEngine, normalizeEngineClass, resolveStepEngineClass, resolveStepEngineClasses, resolveOrchestrationClass, getQueueMaxWorkers, resolveIntegrationEngineMaxWorkers, resolveIntegrationEngineWorkerCaps, recommendWorkersForQueue, normalizeEngineBrowser, normalizeSessionMode, normalizeHookFailBehavior, normalizeEngineHookStep, normalizeEngineHooks, buildHookStepFromSnapshot, normalizeHookArray, resolveExecutionHooks, buildStepAutomationDetail, buildProviderLiveViewUrl, resolveDirectCallbackBaseUrl, resolveCallbackSecret, buildDirectCallback, normalizeInlineEvidence, normalizeApiDetail, normalizeWebDetail, normalizeAutomationDetail, normalizeArtifactBundle, normalizePatchProposals, normalizeJsonValue, normalizeStringRecord, normalizeCapturedValuesRecord, normalizeStepCapturesRecord, toEngineKeyValueEntries, toEngineDataSetRows, resolveCaseDataSetContext, resolveEngineStepType, buildManualSpec };
}
module.exports = { createEngineTypes };
