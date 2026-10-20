const {normalizeAgentContext,retrieveAgentContext}=require("../lib/automationAgentContext");
const { buildFeature } = require('./aiAutomationFeaturePolicy');
exports.buildFeature = buildFeature;
const { resilientHttpRequest } = require('@hellotest/platform/backend/src/utils/resilientHttpClient');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { connectAutomationBrowser, runAutomationBrowserAgent, remainingBrowserCalls } = require("../lib/automationBrowserAgent");
const { completeAutomationBuild } = require("../lib/automationBuildCompletion");
const {canonicalizeRepositoryRows,canonicalPageUrl,repositoryInputMetadata}=require("../lib/repositoryScreenIdentity");
const {sameRecordedLocator}=require("../lib/automationLocatorIdentity");
const {normalizeGeneratedProgram,preserveGeneratedAssertions}=require("../lib/automationGeneratedProgram");
const {navigationOrigins,validateNavigationGrounding,scopeRepositoryToTarget,buildNavigationOrigins}=require('../lib/automationGenerationGrounding');
const {normalizeAutomationStartUrl,requiresAutomationStartUrl}=require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { loadAutomationStoryContext, loadAutomationManualContext, manualContextKey, automationPromptParameters, loadAutomationParameterContext, resolveAutomationStartUrl } = require("../lib/automationBuildContext");
const { resolveMobileRecorderPlatform } = require("../domain/mobileRecorderPlan");
const { persistMobileRecorderPlan } = require("./mobileRecorderPersistence.service");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid } = require("crypto");
const automationCasePreparationService = require("./automationCasePreparation.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const testStepService = require("@hellotest/testing/backend/services/testStep.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const testEnvironmentService = require("@hellotest/testing/backend/services/testEnvironment.service");
const testConfigurationService = require("@hellotest/testing/backend/services/testConfiguration.service");
const testDataSetService = require("@hellotest/testing/backend/services/testDataSet.service");
const aiKnowledgeService = require("@hellotest/knowledge/backend/services/aiKnowledge.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { retryLlmCapacity } = require("@hellotest/platform/backend/src/utils/llmCapacityRetry");
const { isMobileAppType, isMobileRecorderTarget } = require("@hellotest/platform/backend/src/utils/mobileFeature");
const { resolveMobileEngineSecret } = require("@hellotest/platform/backend/src/security/runtimeSecrets");

const LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.AUTOMATION_BUILDER_LLM_TIMEOUT_MS || 90_000));
const ENGINE_TIMEOUT_MS = Math.max(2_000, Number(process.env.AUTOMATION_BUILDER_ENGINE_TIMEOUT_MS || 15_000));
const MAX_CACHE_ROWS = 40;
const MAX_CAPTURED_ACTIONS = 180;
const MAX_CAPTURED_NETWORK = 80;
const DEFAULT_BATCH_FAILURE_THRESHOLD = Math.max(1, Number(process.env.AUTOMATION_BUILDER_BATCH_FAILURE_THRESHOLD || 3));
const RECORDER_ORPHAN_TTL_MS = Math.max(60_000, Number(process.env.RECORDER_ORPHAN_TTL_MS || 3 * 60_000));
const MOBILE_ENGINE_SECRET_HEADER = "x-hellotest-mobile-engine-secret";

const selectCaseWithScope = db.prepare(`
  SELECT
    test_cases.*,
    COALESCE((SELECT MAX(version.revision) FROM test_case_versions version WHERE version.test_case_id=test_cases.id),0)+1 AS revision,
    app_types.name AS app_type_name,
    app_types.type AS app_type_kind,
    app_types.project_id,
    projects.name AS project_name
  FROM test_cases
  LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
  LEFT JOIN projects ON projects.id = app_types.project_id
  WHERE test_cases.id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const selectCasesForBatch = db.prepare(`
  SELECT test_cases.id
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.app_type_id = ?
    AND COALESCE(test_cases.automated, 'no') <> 'yes'
    AND app_types.type IN ('api', 'web', 'android', 'ios', 'unified')
  ORDER BY COALESCE(test_cases.updated_at, test_cases.created_at) DESC, test_cases.created_at DESC, test_cases.id DESC
`);

const selectStaleRecorderTransactions = obsDb.prepare(`
  SELECT *
  FROM workspace_transactions
  WHERE action = 'test_case_recorder'
    AND status = 'running'
    AND started_at IS NOT NULL
    AND started_at < ?
  ORDER BY started_at ASC
  LIMIT ?
`);

const upsertLearningCacheRecord = obsDb.prepare(`
  INSERT INTO automation_learning_cache (
    id,
    project_id,
    app_type_id,
    test_case_id,
    page_url,
    page_key,
    locator_intent,
    locator,
    locator_kind,
    confidence,
    source,
    metadata,
    hit_count
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT (app_type_id, page_key, locator_intent, locator)
  DO UPDATE SET
    project_id = COALESCE(EXCLUDED.project_id, automation_learning_cache.project_id),
    test_case_id = COALESCE(EXCLUDED.test_case_id, automation_learning_cache.test_case_id),
    page_url = COALESCE(EXCLUDED.page_url, automation_learning_cache.page_url),
    locator_kind = COALESCE(EXCLUDED.locator_kind, automation_learning_cache.locator_kind),
    confidence = GREATEST(automation_learning_cache.confidence, EXCLUDED.confidence),
    source = EXCLUDED.source,
    metadata = EXCLUDED.metadata,
    hit_count = automation_learning_cache.hit_count + 1,
    updated_at = CURRENT_TIMESTAMP
`);
const upsertLearningCache={run:(...args)=>persistCanonicalRepositoryRow(args)};

const selectLearningCacheEntry = obsDb.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE id = ?
`);

const selectLearningCacheScreenEntries = obsDb.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
    AND (?::text IS NULL OR project_id IS NOT DISTINCT FROM ?)
  ORDER BY hit_count DESC, updated_at DESC
`);

const updateLearningCacheEntry = obsDb.prepare(`
  UPDATE automation_learning_cache
  SET page_url = ?,
      page_key = ?,
      locator_intent = ?,
      locator = ?,
      locator_kind = ?,
      confidence = ?,
      source = ?,
      metadata = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteLearningCacheEntry = obsDb.prepare(`
  DELETE FROM automation_learning_cache
  WHERE id = ?
`);

const deleteLearningCacheScreen = obsDb.prepare(`
  DELETE FROM automation_learning_cache
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
`);

const renameLearningCacheScreen = obsDb.prepare(`
  UPDATE automation_learning_cache
  SET page_key = CASE WHEN page_key = ? THEN ? ELSE page_key END,
      metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb,
      updated_at = CURRENT_TIMESTAMP
  WHERE app_type_id IS NOT DISTINCT FROM ?
    AND COALESCE(metadata->>'screen_name', page_key, page_url, '') = ?
`);

const replaceTestStepRepositoryReference = db.prepare(`
  UPDATE test_steps
  SET action = CASE WHEN action IS NULL THEN NULL ELSE REPLACE(action, ?, ?) END,
      automation_code = CASE WHEN automation_code IS NULL THEN NULL ELSE REPLACE(automation_code, ?, ?) END
  WHERE test_case_id IN (
    SELECT id FROM test_cases WHERE app_type_id IS NOT DISTINCT FROM ?
  )
    AND (
      COALESCE(action, '') LIKE ?
      OR COALESCE(automation_code, '') LIKE ?
    )
`);

const markTestCaseAutomationReady = db.prepare(`
  UPDATE test_cases
  SET automated = 'yes',
      automation_status = CASE WHEN EXISTS (
        SELECT 1 FROM test_steps
        WHERE test_steps.test_case_id = test_cases.id
          AND COALESCE(BTRIM(test_steps.automation_code), '') = ''
          AND (test_steps.api_request IS NULL OR test_steps.api_request = '{}'::jsonb)
      ) THEN 'incomplete' ELSE 'ready' END,
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const markTestCaseAutomationIncomplete = db.prepare(`
  UPDATE test_cases
  SET automation_status = 'incomplete',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND automated = 'yes'
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeIdList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean))];

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeObject = (value) => (isPlainObject(value) ? value : {});

const clampNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeJson = (value, fallback) => parseJsonValue(value, fallback);

const inferLocatorStrategy = (locator, fallback) => {
  const value = String(locator || "");
  if (/data-testid/i.test(value)) return "data-testid";
  if (/aria-label/i.test(value)) return "aria-label";
  if (/getbyrole|role=/i.test(value)) return "role + name";
  if (/^#|\bid=/i.test(value)) return "stable id";
  if (/\bname=/i.test(value)) return "name attribute";
  if (/placeholder/i.test(value)) return "placeholder";
  if (/^text=|getbytext/i.test(value)) return "text";
  if (/xpath|^\/\//i.test(value)) return "xpath";
  return fallback || "css";
};

const normalizeLearningCacheRow = (row) => row
  ? {
      ...row,
      confidence: clampNumber(row.confidence, 0),
      metadata: safeJson(row.metadata, {})
    }
  : null;

const listLearningCacheRows = async ({ projectId, appTypeId, limit = MAX_CACHE_ROWS, offset = 0 } = {}) => {
  let query = `
    SELECT *
    FROM automation_learning_cache
    WHERE 1 = 1
  `;
  const params = [];

  if (projectId) {
    const projectApps = await db.prepare(`SELECT id FROM app_types WHERE project_id = ?`).all(projectId);
    const appIds = projectApps.map((app) => app.id);
    query += appIds.length
      ? ` AND (project_id = ? OR (project_id IS NULL AND app_type_id IN (${appIds.map(() => "?").join(", ")})))`
      : ` AND project_id = ?`;
    params.push(projectId);
    params.push(...appIds);
  }

  if (appTypeId) {
    query += ` AND app_type_id = ?`;
    params.push(appTypeId);
  }

  query += ` ORDER BY hit_count DESC, updated_at DESC, id ASC`;

  const rows = await obsDb.prepare(query).all(...params);
  const canonical=await canonicalRepositoryProjection(rows);
  const start=Math.max(0,Number(offset)||0);
  return canonical.rows.slice(start,start+Math.max(1,Math.min(200,Number(limit)||MAX_CACHE_ROWS)));
};

const canonicalRepositoryProjection=async rows=>{
  const normalized=rows.map(normalizeLearningCacheRow).filter(Boolean);
  const projects=new Map();
  for(const row of normalized)if(!row.project_id&&row.app_type_id){if(!projects.has(row.app_type_id))projects.set(row.app_type_id,(await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(row.app_type_id))?.project_id||null);row.project_id=projects.get(row.app_type_id);}
  return canonicalizeRepositoryRows(normalized);
};
const readRepositoryScope=async({appTypeId,projectId})=>(await obsDb.prepare(`/* repository canonical scope */ SELECT * FROM automation_learning_cache WHERE app_type_id IS NOT DISTINCT FROM ? AND (project_id IS NOT DISTINCT FROM ? OR (?::text IS NOT NULL AND project_id IS NULL)) ORDER BY created_at, id`).all(appTypeId||null,projectId||null,appTypeId||null)).map(normalizeLearningCacheRow);
const lockRepositoryScope=({appTypeId,projectId})=>obsDb.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('repository-screen:'+JSON.stringify([projectId||null,appTypeId||null]));
const saveRepositoryProjection=async projection=>{
  for(const row of projection.all)if(!row._pending)await obsDb.prepare('UPDATE automation_learning_cache SET metadata = ? WHERE id = ? AND metadata IS DISTINCT FROM ?::jsonb').run(row.metadata,row.id,row.metadata);
};
const reconcileRepositoryScope=async scope=>{const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));await saveRepositoryProjection(projection);return projection;};
const persistCanonicalRepositoryRow=args=>obsDb.transaction(async()=>{
  const [id,projectId,appTypeId,testCaseId,pageUrl,pageKey,intent,locator,kind,confidence,source,metadata]=args;
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const rows=await readRepositoryScope(scope);
  const candidate={id,project_id:projectId,app_type_id:appTypeId,test_case_id:testCaseId,page_url:pageUrl,page_key:pageKey,locator_intent:intent,locator,locator_kind:kind,confidence,source,metadata:repositoryInputMetadata(metadata),_pending:true};
  const projection=await canonicalRepositoryProjection([...rows,candidate]);
  const proposed=projection.byId.get(id),target=projection.byId.get(proposed.metadata.merged_into_entry_id)||proposed;
  if(target!==proposed){for(const [key,value]of Object.entries(candidate.metadata))if(value!==null&&value!==undefined&&target.metadata[key]===undefined)target.metadata[key]=value;}
  await saveRepositoryProjection(projection);
  if(target===proposed)await upsertLearningCacheRecord.run(id,projectId,appTypeId,testCaseId,pageUrl,target.metadata.screen_name||pageKey,intent,locator,kind,confidence,source,target.metadata);
  return {id:target.id,changes:1};
})();

const listLearningCacheScreenRows = async ({ appTypeId, projectId, screenName } = {}) => {
  const rows=(await canonicalRepositoryProjection(await readRepositoryScope({appTypeId:normalizeText(appTypeId),projectId:normalizeText(projectId)||(appTypeId?(await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null)}))).rows;
  const exact=rows.filter(row=>(row.metadata.screen_name||row.page_key)===normalizeText(screenName));
  return exact.length?exact:rows.filter(row=>row.metadata.screen_aliases?.includes(normalizeText(screenName)));
};

const listAllLearningCacheRows = async ({ appTypeId } = {}) => {
  const appType = normalizeText(appTypeId);

  if (!appType) {
    throw new Error("App type scope is required");
  }

  const rows = await obsDb.prepare(`
    SELECT *
    FROM automation_learning_cache
    WHERE app_type_id = ?
    ORDER BY COALESCE(metadata->>'screen_name', page_key, page_url, ''), locator_intent, updated_at DESC
  `).all(appType);

  return (await canonicalRepositoryProjection(rows)).rows;
};

const normalizeRepositoryPatch = (existing, patch = {}) => {
  const existingMetadata = normalizeObject(safeJson(existing.metadata, {}));
  const nextMetadata = {
    ...existingMetadata,
    ...normalizeObject(patch.metadata)
  };
  const metadataFieldMap = {
    screen_name: "screen_name",
    object_name: "object_name",
    object_role: "object_role",
    target_criteria: "target_criteria",
    dom_structure: "dom_structure",
    dom_path: "dom_path",
    screenshot_url: "screenshot_url",
    screenshot_path: "screenshot_path",
    fallback_strategy: "fallback_strategy",
    platform: "platform",
    url_pattern_type: "url_pattern_type",
    url_pattern_value: "url_pattern_value",
    screen_fingerprint: "screen_fingerprint",
    screen_dom_compressed: "screen_dom_compressed",
    screen_screenshot_url: "screen_screenshot_url",
    accessibility_tree: "accessibility_tree",
    fallback_locators: "fallback_locators",
    description: "description",
    business_meaning: "business_meaning",
    usage_keywords: "usage_keywords",
    stability_score: "stability_score",
    last_validated_at: "last_validated_at",
    validation_history: "validation_history",
    ancestor_dom: "ancestor_dom",
    ancestor_screenshot_url: "ancestor_screenshot_url",
    element_screenshot_url: "element_screenshot_url"
  };

  Object.entries(metadataFieldMap).forEach(([inputKey, metadataKey]) => {
    if (patch[inputKey] !== undefined) {
      nextMetadata[metadataKey] = patch[inputKey];
    }
  });

  const nextLocator = normalizeText(patch.locator) || existing.locator;
  if (existing.locator && nextLocator !== existing.locator) {
    nextMetadata.previous_locators = [
      ...new Set([
        ...(Array.isArray(nextMetadata.previous_locators) ? nextMetadata.previous_locators : []),
        existing.locator
      ].filter(Boolean))
    ];
  }

  nextMetadata.repository_version = Number(nextMetadata.repository_version || 0) + 1;
  nextMetadata.last_curated_at = new Date().toISOString();

  return {
    page_url: patch.page_url !== undefined ? normalizeText(patch.page_url) : existing.page_url,
    page_key: normalizeText(patch.page_key) || existing.page_key,
    locator_intent: normalizeText(patch.locator_intent || patch.intent) || existing.locator_intent,
    locator: nextLocator,
    locator_kind: patch.locator_kind !== undefined ? normalizeText(patch.locator_kind) : existing.locator_kind,
    confidence: Math.max(0, Math.min(1, clampNumber(patch.confidence, clampNumber(existing.confidence, 0)))),
    source: normalizeText(patch.source) || "curated_repository",
    metadata: nextMetadata
  };
};

const summarizeVariables = (variables = []) =>
  (Array.isArray(variables) ? variables : [])
    .map((entry) => ({
      key: normalizeText(entry?.key),
      value: entry?.is_secret || /password|secret|token|credential|api.?key|passcode|otp|verification.?code|one.?time.?code/i.test(String(entry?.key || "")) ? "[secret]" : String(entry?.value ?? ""),
      is_secret: Boolean(entry?.is_secret)
    }))
    .filter((entry) => entry.key);

const summarizeDataSetRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .slice(0, 5)
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        const normalizedKey = normalizeText(key);

        if (!normalizedKey) {
          return accumulator;
        }

        accumulator[normalizedKey] = (normalizedKey === "value" && (row.is_secret || /password|secret|token|credential|api.?key|passcode|otp|verification.?code|one.?time.?code/i.test(String(row.key || "")))) || /password|secret|token|credential|api.?key|passcode|otp|verification.?code|one.?time.?code/i.test(normalizedKey) && normalizedKey !== "is_secret" ? "[private parameter reference]" : String(value ?? "");
        return accumulator;
      }, {})
    );

const ensureScopedBuildResource = (resource, testCase, label) => {
  if (!resource) {
    return null;
  }

  if (resource.project_id && testCase.project_id && resource.project_id !== testCase.project_id) {
    throw new Error(`${label} must belong to the same project as the test case`);
  }

  if (resource.app_type_id && testCase.app_type_id && resource.app_type_id !== testCase.app_type_id) {
    throw new Error(`${label} must belong to the same app type as the test case`);
  }

  return resource;
};

const resolveBuildContext = async ({
  testCase,
  test_environment_id,
  test_configuration_id,
  test_data_set_id
} = {}) => {
  const [environment, configuration, dataSet] = await Promise.all([
    normalizeText(test_environment_id) ? testEnvironmentService.getTestEnvironment(test_environment_id) : Promise.resolve(null),
    normalizeText(test_configuration_id) ? testConfigurationService.getTestConfiguration(test_configuration_id) : Promise.resolve(null),
    normalizeText(test_data_set_id) ? testDataSetService.getTestDataSet(test_data_set_id) : Promise.resolve(null)
  ]);
  const scopedEnvironment = ensureScopedBuildResource(environment, testCase, "Test environment");
  const scopedConfiguration = ensureScopedBuildResource(configuration, testCase, "Test configuration");
  const scopedDataSet = ensureScopedBuildResource(dataSet, testCase, "Test data");

  return {
    environment: scopedEnvironment
      ? {
          id: scopedEnvironment.id,
          name: scopedEnvironment.name,
          base_url: normalizeText(scopedEnvironment.base_url),
          browser: normalizeText(scopedEnvironment.browser),
          notes: normalizeRichText(scopedEnvironment.notes),
          variables: summarizeVariables(scopedEnvironment.variables)
        }
      : null,
    configuration: scopedConfiguration
      ? {
          id: scopedConfiguration.id,
          name: scopedConfiguration.name,
          browser: normalizeText(scopedConfiguration.browser),
          mobile_os: normalizeText(scopedConfiguration.mobile_os),
          platform_version: normalizeText(scopedConfiguration.platform_version),
          targets: Array.isArray(scopedConfiguration.targets) ? scopedConfiguration.targets : [],
          variables: summarizeVariables(scopedConfiguration.variables)
        }
      : null,
    data_set: scopedDataSet
      ? {
          id: scopedDataSet.id,
          name: scopedDataSet.name,
          mode: scopedDataSet.mode,
          columns: Array.isArray(scopedDataSet.columns) ? scopedDataSet.columns : [],
          rows: summarizeDataSetRows(scopedDataSet.rows),
          row_count: Array.isArray(scopedDataSet.rows) ? scopedDataSet.rows.length : 0,
          sample_only: Array.isArray(scopedDataSet.rows) && scopedDataSet.rows.length > 5
        }
      : null
  };
};

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw Object.assign(new Error("LLM response was empty"),{code:"AI_INVALID_JSON"});
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw Object.assign(new Error("Unable to parse JSON from the LLM response"),{code:"AI_INVALID_JSON"});
  }
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = LLM_TIMEOUT_MS, integration, featureKey, maxAttempts) => {
  return fetchLlmWithRetry(url, init, { integration, featureKey, timeoutMs, maxAttempts, operation: "automation.generate" });
};

const resolveLlmIntegration = async (integrationId, { allowFallback = true, userId, usageKey, projectId } = {}) => {
  const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
    integrationId,
    userId,
    usageKey,
    projectId,
    fallback: "project-then-global",
    allowMissing: allowFallback
  });

  if (!integration) {
    if (allowFallback) {
      return null;
    }

    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, prompt, content, featureKey, signal, timeoutMs = LLM_TIMEOUT_MS, maxAttempts, onCapacityWait, activeGoal, beforeDispatch }) => retryLlmCapacity(async ({timeoutMs: remainingMs}) => {
  const accessCheckStarted=Date.now();
  await beforeDispatch?.();
  signal?.throwIfAborted();
  remainingMs-=Date.now()-accessCheckStarted;
  if(remainingMs<=0)throw Object.assign(new Error('The model request deadline elapsed before dispatch.'),{code:'DEADLINE_EXCEEDED',statusCode:504});
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        ...(activeGoal && typeof activeGoal.action === 'string' && typeof activeGoal.expected_result === 'string'
          && activeGoal.action.length + activeGoal.expected_result.length <= 2000 ? [{role:'system',content:'The host selected ONLY this current manual section: '+JSON.stringify({action:activeGoal.action,expected_result:activeGoal.expected_result})+'. Complete this action and every listed outcome using current evidence. The broader case brief remains constraints and context; later actions are not requested in this call. Tools excluded by the current action policy are unnecessary for this section, not a missing prerequisite for later actions.'}] : []),
        {
          role: "user",
          content: content || prompt
        }
      ]
    })
  }, remainingMs, integration, featureKey, maxAttempts);

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw, headers: response.headers });
  }

  const payload = await response.json();
  const messageContent = getCompletionContent(payload);

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
}, { timeoutMs, signal, maxAttempts: maxAttempts === 1 ? 1 : 3, onWait: onCapacityWait });

const normalizeUrlKey = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "unknown-page";
  }

  try {
    const parsed = new URL(normalized, "http://hellotest.local");
    return `${parsed.pathname || "/"}`.replace(/\/+$/, "") || "/";
  } catch {
    return normalized.replace(/\?.*$/, "").replace(/\/+$/, "") || "unknown-page";
  }
};

const toTitleWords = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Za-z0-9\s.]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const toObjectSegment = (value, fallback = "Object") => {
  const normalized = toTitleWords(value);
  return normalized || fallback;
};

const inferScreenName = (action) => {
  return inferScreenNameFromUrl(action?.url)
    || inferScreenNameFromTitle(action?.page_title)
    || "Screen";
};

const inferScreenNameFromTitle = (title) => {
  const normalized = normalizeText(title);
  if (!normalized || /^about:blank$/i.test(normalized)) {
    return null;
  }

  return toObjectSegment(normalized, "Screen").slice(0, 48);
};

const GENERIC_SCREEN_PATH_SEGMENTS = new Set([
  "app",
  "apps",
  "page",
  "pages",
  "index",
  "home",
  "main",
  "default",
  "dashboard"
]);

const normalizeUrlPathSegment = (value) => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const inferScreenNameFromUrl = (url) => {
  const normalized = normalizeText(url);

  if (!normalized || /^about:blank$/i.test(normalized)) {
    return null;
  }

  try {
    const parsed = new URL(normalized, "http://hellotest.local");
    const segments = parsed.pathname
      .split("/")
      .map(normalizeUrlPathSegment)
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .filter((part) => !GENERIC_SCREEN_PATH_SEGMENTS.has(part.toLowerCase()))
      .filter((part) => !/^[a-f0-9-]{12,}$/i.test(part));
    const tail = segments.slice(-2);
    const candidate = toObjectSegment(tail.join(" "), "");

    if (candidate) {
      return candidate.slice(0, 48);
    }
  } catch {
    const segments = normalized
      .split(/[/?#]/)
      .map(normalizeText)
      .filter(Boolean);
    const candidate = toObjectSegment(segments.at(-1), "");

    if (candidate) {
      return candidate.slice(0, 48);
    }
  }

  return null;
};

const inferObjectRole = (action) => {
  const type = String(action?.type || "").toLowerCase();
  const locator = String(action?.locator || "").toLowerCase();
  const text = String(action?.text || "").toLowerCase();

  if (type === "upload" || /\b(file|upload)\b/.test(`${locator} ${text}`)) {
    return "file";
  }

  if (["fill", "change"].includes(type) || /\b(input|textarea|textbox|email|password|search)\b/.test(`${locator} ${text}`)) {
    return "field";
  }

  if (type === "select" || /\b(select|dropdown|combobox)\b/.test(`${locator} ${text}`)) {
    return "dropdown";
  }

  if (["check", "uncheck"].includes(type) || /\b(checkbox|radio|switch)\b/.test(`${locator} ${text}`)) {
    return "toggle";
  }

  if (["click", "dblclick", "rightclick", "submit"].includes(type)) {
    return /\blink\b/.test(`${locator} ${text}`) ? "link" : "button";
  }

  return type || "object";
};

const inferObjectLabel = (action) => {
  const text = normalizeText(action?.text);
  if (text && text.length <= 80) {
    return text;
  }

  const locator = normalizeText(action?.locator) || "";
  const labelMatch = locator.match(/^(?:label|placeholder|text|role)=(.+)$/i);
  if (labelMatch?.[1]) {
    return labelMatch[1];
  }

  const attrMatch = locator.match(/\[(?:aria-label|name|id|data-testid)=["']?([^"'\]]+)["']?\]/i);
  if (attrMatch?.[1]) {
    return attrMatch[1];
  }

  return normalizeText(locator.replace(/[#.[\]'":=]/g, " ").slice(0, 60));
};

const NON_REPOSITORY_RECORDING_LOCATORS = new Set(["location", "browser.tab", "keyboard", "viewport"]);

const isRecorderRepositoryLocator = (locator) => {
  const normalized = normalizeText(locator);
  return Boolean(normalized && !NON_REPOSITORY_RECORDING_LOCATORS.has(normalized));
};

const normalizeRepositoryNameKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniqueRepositoryName = (base, usedNames, fallbackBase = "Field") => {
  const normalizedBase = toObjectSegment(base, "") || fallbackBase;
  let candidate = normalizedBase;
  let suffix = 2;

  if (fallbackBase === "Screen" && !toObjectSegment(base, "")) {
    candidate = "Screen 1";
  }

  while (usedNames.has(normalizeRepositoryNameKey(candidate))) {
    candidate = `${normalizedBase} ${suffix}`;
    suffix += 1;
  }

  usedNames.add(normalizeRepositoryNameKey(candidate));
  return candidate.slice(0, 64);
};

const recorderPageIdentity = (action) => {
  const pageKey = normalizeUrlKey(action?.url);

  if (pageKey && pageKey !== "unknown-page") {
    return pageKey;
  }

  return normalizeText(action?.page_id) || normalizeText(action?.page_title) || "unknown-page";
};

const repositoryActionKey = (action) => `${recorderPageIdentity(action)}|${normalizeText(action?.locator) || ""}`;

const inferKeywordForAction = (action) => {
  const type = String(action?.type || "").toLowerCase();

  if (type === "navigation") {
    return "web.goto";
  }
  if (type === "fill" || type === "change") {
    return "web.fill";
  }
  if (type === "upload") {
    return "web.uploadFile";
  }
  if (type === "select") {
    return "web.select";
  }
  if (type === "check" || type === "uncheck") {
    return `web.${type}`;
  }
  if (type === "dblclick") {
    return "web.dblclick";
  }
  if (type === "rightclick") {
    return "web.rightClick";
  }
  if (type === "press" || type === "tab") {
    return "web.press";
  }

  return "web.click";
};

const inferRecorderKeywordForPlatform = (action, platform) => {
  if (normalizeText(platform) === "android") {
    const type = String(action?.type || "").toLowerCase();
    if (type === "tap") return "android.tap";
    if (type === "type") return "android.type";
    if (type === "pressback") return "android.pressBack";
    return "android.step";
  }

  return inferKeywordForAction(action);
};

const buildObjectRepositoryEntry = (action) => {
  const locator = normalizeText(action?.locator);
  if (!isRecorderRepositoryLocator(locator)) {
    return null;
  }

  const screenName = inferScreenName(action);
  const role = inferObjectRole(action);
  const label = inferObjectLabel(action) || `${role} ${action?.index || ""}`.trim();
  const fieldName = toObjectSegment(label, toObjectSegment(role));

  return {
    screen_name: screenName,
    field_name: fieldName,
    object_name: fieldName,
    object_role: role,
    object_label: label,
    keyword: inferKeywordForAction(action),
    parameter_hint: role === "field" ? inferRecorderFillValue(action) : role === "file" ? "@t.uploadFilePath" : null
  };
};

const platformSource = (platform, fallback) =>
  normalizeText(platform) === "android" ? `android_${fallback}` : fallback;

const loadRepositoryRowsForNaming = async (testCase) => {
  if (testCase.app_type_id) {
    return (await listAllLearningCacheRows({ appTypeId: testCase.app_type_id }))
      .map(normalizeLearningCacheRow)
      .filter(Boolean);
  }

  return (await listLearningCacheRows({
    projectId: testCase.project_id || null,
    appTypeId: testCase.app_type_id || null,
    limit: 200
  })).map(normalizeLearningCacheRow).filter(Boolean);
};

const buildRecorderRepositoryNamingPrompt = ({ pages, fields, testCase }) => [
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.1"),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.2"),
  "{",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.3"),
  "}",
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.43"),
  "",
  [aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRecorderRepositoryNamingPrompt.segment.1"),String(testCase.title),""].join(''),
  [aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRecorderRepositoryNamingPrompt.segment.2"),String(testCase.description || "No description provided."),""].join(''),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.9"),
  JSON.stringify(pages, null, 2),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.10"),
  JSON.stringify(fields, null, 2)
].join("\n");

const buildAiRecorderRepositoryNameSuggestions = async ({
  testCase,
  actions,
  integrationId,
  userId,
  transactionId
}) => {
  const pages = [];
  const fields = [];
  const seenPages = new Set();
  const seenFields = new Set();

  actions.forEach((action) => {
    const pageKey = recorderPageIdentity(action);
    const naturalScreenName = inferScreenNameFromUrl(action.url) || inferScreenNameFromTitle(action.page_title);

    if (!naturalScreenName && !seenPages.has(pageKey)) {
      pages.push({
        page_key: pageKey,
        url: action.url || null,
        title: action.page_title || null,
        action_type: action.type || null,
        text: action.text || null
      });
      seenPages.add(pageKey);
    }

    if (!isRecorderRepositoryLocator(action.locator)) {
      return;
    }

    const fieldKey = repositoryActionKey(action);
    const deterministicLabel = inferObjectLabel(action);

    if (!deterministicLabel && !seenFields.has(fieldKey)) {
      fields.push({
        field_key: fieldKey,
        page_key: pageKey,
        action_type: action.type || null,
        locator: action.locator || null,
        text: action.text || null,
        value_hint: action.value ? "captured" : null
      });
      seenFields.add(fieldKey);
    }
  });

  if (!pages.length && !fields.length) {
    return { screens: new Map(), fields: new Map(), ai_used: false, fallback_reason: null };
  }

  let integration = null;
  try {
    integration = await resolveLlmIntegration(integrationId, {
      userId,
      projectId: testCase.project_id,
      usageKey: "ai.automation.dom_extraction"
    });
  } catch (error) {
    return {
      screens: new Map(),
      fields: new Map(),
      ai_used: false,
      fallback_reason: error instanceof Error ? error.message : "Unable to resolve LLM integration"
    };
  }

  if (!integration) {
    return {
      screens: new Map(),
      fields: new Map(),
      ai_used: false,
      fallback_reason: "No active LLM integration is configured"
    };
  }

  try {
    const content = await requestChatCompletion({
      integration,
      prompt: buildRecorderRepositoryNamingPrompt({ pages, fields, testCase }),
      featureKey: 'ai.automation.dom_extraction'
    });
    const payload = extractJsonPayload(content);
    const screenSuggestions = new Map();
    const fieldSuggestions = new Map();

    (Array.isArray(payload?.screens) ? payload.screens : []).forEach((item) => {
      const pageKey = normalizeText(item?.page_key || item?.pageKey);
      const name = toObjectSegment(item?.name || item?.screen_name, "");
      if (pageKey && name) {
        screenSuggestions.set(pageKey, name);
      }
    });
    (Array.isArray(payload?.fields) ? payload.fields : []).forEach((item) => {
      const fieldKey = normalizeText(item?.field_key || item?.fieldKey);
      const name = toObjectSegment(item?.name || item?.object_name, "");
      if (fieldKey && name) {
        fieldSuggestions.set(fieldKey, name);
      }
    });

    return {
      screens: screenSuggestions,
      fields: fieldSuggestions,
      ai_used: screenSuggestions.size > 0 || fieldSuggestions.size > 0,
      fallback_reason: null
    };
  } catch (error) {
    await appendEvent(transactionId, {
      level: "warning",
      phase: "recorder.repository.naming.fallback",
      message: "AI repository naming was unavailable, so HelloTest used deterministic screen and field names from the recording.",
      details: {
        error: error instanceof Error ? error.message : "AI repository naming failed"
      }
    }).catch(() => null);

    return {
      screens: new Map(),
      fields: new Map(),
      ai_used: false,
      fallback_reason: error instanceof Error ? error.message : "AI repository naming failed"
    };
  }
};

const buildExistingRepositoryNameIndex = (rows = []) => {
  const screenNames = new Set();
  const fieldNamesByScreen = new Map();
  const screenByPageIdentity = new Map();
  const fieldByLocator = new Map();

  rows.forEach((row) => {
    const metadata = normalizeObject(row.metadata);
    const screenName = normalizeText(metadata.screen_name || row.page_key || row.page_url);

    if (!screenName) {
      return;
    }

    screenNames.add(normalizeRepositoryNameKey(screenName));
    [row.page_key, normalizeUrlKey(row.page_url), row.page_url].map(normalizeText).filter(Boolean).forEach((key) => {
      screenByPageIdentity.set(key, screenName);
    });

    const fieldNames = fieldNamesByScreen.get(screenName) || new Set();
    const objectName = getRepositoryObjectName(row, screenName);

    if (objectName && !isRepositoryScreenRecord(row)) {
      fieldNames.add(normalizeRepositoryNameKey(objectName));
      if (row.locator) {
        fieldByLocator.set(`${screenName}|${row.locator}`, {
          screen_name: screenName,
          field_name: objectName,
          reference: `${screenName}.${objectName}`,
          locator: row.locator,
          locator_kind: row.locator_kind || inferLocatorStrategy(row.locator, "css")
        });
      }
    }

    fieldNamesByScreen.set(screenName, fieldNames);
  });

  return {
    screenNames,
    fieldNamesByScreen,
    screenByPageIdentity,
    fieldByLocator
  };
};

const buildRecorderRepositoryModel = async ({
  testCase,
  capturedActions = [],
  integrationId,
  userId,
  transactionId,
  platform = "web"
} = {}) => {
  const actions = normalizeCapturedActions(capturedActions).filter((action) => isRecorderRepositoryLocator(action.locator));
  const existingRows = await loadRepositoryRowsForNaming(testCase);
  const index = buildExistingRepositoryNameIndex(existingRows);
  const aiSuggestions = await buildAiRecorderRepositoryNameSuggestions({
    testCase,
    actions,
    integrationId,
    userId,
    transactionId
  });
  const screenByPageKey = new Map();
  const screens = new Map();
  const fields = new Map();
  const byActionIndex = new Map();
  let fallbackScreenCount = 1;

  const resolveScreen = (action) => {
    const pageKey = recorderPageIdentity(action);
    const existingScreen = index.screenByPageIdentity.get(pageKey)
      || index.screenByPageIdentity.get(normalizeUrlKey(action.url))
      || index.screenByPageIdentity.get(action.url);

    if (existingScreen) {
      screenByPageKey.set(pageKey, existingScreen);
    }

    const cached = screenByPageKey.get(pageKey);
    if (cached) {
      return cached;
    }

    const baseName =
      inferScreenNameFromUrl(action.url)
      || inferScreenNameFromTitle(action.page_title)
      || aiSuggestions.screens.get(pageKey)
      || `Screen ${fallbackScreenCount++}`;
    const screenName = uniqueRepositoryName(baseName, index.screenNames, "Screen");

    screenByPageKey.set(pageKey, screenName);
    return screenName;
  };

  actions.forEach((action) => {
    const locator = normalizeText(action.locator);
    const screenName = resolveScreen(action);
    const pageKey = recorderPageIdentity(action);
    const fieldKey = repositoryActionKey(action);
    const existingField = index.fieldByLocator.get(`${screenName}|${locator}`);

    if (!screens.has(screenName)) {
      screens.set(screenName, {
        screen_name: screenName,
        page_key: screenName,
        page_identity: pageKey,
        page_url: normalizeText(action.url),
        page_title: normalizeText(action.page_title),
        platform,
        url_pattern_type: normalizeText(action.url) ? "endsWith" : "contains",
        url_pattern_value: normalizeText(action.url) ? normalizeUrlKey(action.url) : pageKey
      });
    }

    if (existingField) {
      const field = {
        ...existingField,
        object_role: inferObjectRole(action),
        object_label: inferObjectLabel(action),
        action,
        keyword: inferRecorderKeywordForPlatform(action, platform),
        parameter_hint: inferObjectRole(action) === "field" ? inferRecorderFillValue(action) : inferObjectRole(action) === "file" ? "@t.uploadFilePath" : null,
        page_url: normalizeText(action.url),
        page_key: screenName,
        page_identity: pageKey,
        page_title: normalizeText(action.page_title),
        platform,
        source_action_indexes: [Number(action.index)].filter(Number.isFinite)
      };
      fields.set(`${screenName}|${locator}`, field);
      byActionIndex.set(Number(action.index), field);
      return;
    }

    if (fields.has(`${screenName}|${locator}`)) {
      const field = fields.get(`${screenName}|${locator}`);
      const actionIndex = Number(action.index);
      if (Number.isFinite(actionIndex) && !field.source_action_indexes.includes(actionIndex)) {
        field.source_action_indexes.push(actionIndex);
      }
      byActionIndex.set(Number(action.index), field);
      return;
    }

    const role = inferObjectRole(action);
    const baseFieldName =
      aiSuggestions.fields.get(fieldKey)
      || inferObjectLabel(action)
      || `${toObjectSegment(role, "Field")} ${fields.size + 1}`;
    const usedFieldNames = index.fieldNamesByScreen.get(screenName) || new Set();
    const fieldName = uniqueRepositoryName(baseFieldName, usedFieldNames, "Field");
    index.fieldNamesByScreen.set(screenName, usedFieldNames);

    const field = {
      screen_name: screenName,
      field_name: fieldName,
      reference: `${screenName}.${fieldName}`,
      locator,
      locator_kind: inferLocatorStrategy(locator, "recorder"),
      object_role: role,
      object_label: inferObjectLabel(action),
      keyword: inferRecorderKeywordForPlatform(action, platform),
      parameter_hint: role === "field" ? inferRecorderFillValue(action) : role === "file" ? "@t.uploadFilePath" : null,
      page_url: normalizeText(action.url),
      page_key: screenName,
      page_identity: pageKey,
      page_title: normalizeText(action.page_title),
      platform,
      source_action_indexes: [Number(action.index)].filter(Number.isFinite),
      action
    };

    fields.set(`${screenName}|${locator}`, field);
    byActionIndex.set(Number(action.index), field);
  });

  if (aiSuggestions.ai_used) {
    await appendEvent(transactionId, {
      phase: "recorder.repository.naming.ai",
      message: "AI supplied friendly fallback names for recorded repository screens or fields.",
      details: {
        screen_suggestions: aiSuggestions.screens.size,
        field_suggestions: aiSuggestions.fields.size
      }
    }).catch(() => null);
  }

  return {
    screens,
    fields,
    byActionIndex,
    ai_used: aiSuggestions.ai_used,
    ai_fallback_reason: aiSuggestions.fallback_reason
  };
};

const summarizeStep = (step) => ({
  id: step.id,
  order: Number(step.step_order || 0),
  type: step.step_type || "web",
  action: step.action || "",
  expected_result: step.expected_result || "",
  group: { id: step.group_id, name: step.group_name, kind: step.group_kind, shared_group_id: step.reusable_group_id },
  has_existing_automation: Boolean(normalizeRichText(step.automation_code) || normalizeApiRequest(step.api_request)),
  existing_automation_code: normalizeRichText(step.automation_code),
  existing_api_request: normalizeApiRequest(step.api_request)
});

const summarizeCache = (rows = []) =>
  rows.filter((row) => row?.locator_intent !== "__screen__" && row?.metadata?.record_kind !== "screen").map((row) => ({
    page_key: row.page_key,
    page_url: row.page_url,
    screen_name: row.metadata?.screen_name || row.page_key || "",
    object_name: row.metadata?.object_name || row.locator_intent || "",
    object_role: row.metadata?.object_role || "field",
    intent: row.locator_intent,
    locator: row.locator,
    kind: row.locator_kind || "unknown",
    confidence: Number(row.confidence || 0),
    hit_count: Number(row.hit_count || 0),
    usage_keywords: Array.isArray(row.metadata?.usage_keywords) ? row.metadata.usage_keywords : [],
    target_criteria: Array.isArray(row.metadata?.target_criteria) ? row.metadata.target_criteria : []
  }));

const summarizeScreenCatalog = (rows = []) => {
  const screens = new Map();

  rows.forEach((row) => {
    const metadata = row?.metadata || {};
    const screenName = normalizeText(metadata.screen_name || row.page_key || row.locator_intent);

    if (!screenName) {
      return;
    }

    const existing = screens.get(screenName) || {
      screen_name: screenName,
      page_key: row.page_key || screenName,
      page_url: row.page_url || null,
      page_title: metadata.page_title || null,
      page_identity: metadata.page_identity || null,
      url_pattern_value: metadata.url_pattern_value || metadata.page_identity || row.page_url || null,
      field_count: 0,
      fields: []
    };

    if (row.locator_intent !== "__screen__" && metadata.record_kind !== "screen") {
      existing.field_count += 1;
      existing.fields.push({
        object_name: metadata.object_name || row.locator_intent,
        object_role: metadata.object_role || "field",
        object_label: metadata.object_label || null,
        locator: row.locator,
        locator_kind: row.locator_kind || "unknown",
        confidence: Number(row.confidence || 0),
        usage_keywords: Array.isArray(metadata.usage_keywords) ? metadata.usage_keywords : [],
        target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.slice(0, 4) : []
      });
    }

    screens.set(screenName, existing);
  });

  return Array.from(screens.values())
    .map((screen) => ({
      ...screen,
      fields: screen.fields
        .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))
        .slice(0, 40)
    }))
    .sort((left, right) => left.screen_name.localeCompare(right.screen_name));
};

const summarizeKnowledge = (rows = []) =>
  require('../lib/automationKnowledgeContext').summarizeAutomationKnowledge(rows, { normalizeContent: normalizeRichText });

const normalizeCapturedActions = (actions = []) =>
  (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({
      index: Number.isFinite(Number(action?.index)) ? Number(action.index) : index + 1,
      type: normalizeText(action?.type) || "action",
      url: normalizeText(action?.url),
      locator: normalizeText(action?.locator),
      text: normalizeText(action?.text),
      value: normalizeText(action?.value),
      page_id: normalizeText(action?.page_id || action?.pageId),
      page_title: normalizeText(action?.page_title || action?.pageTitle),
      x: action?.x != null && String(action.x).trim() && Number.isFinite(Number(action.x)) ? Number(action.x) : null,
      y: action?.y != null && String(action.y).trim() && Number.isFinite(Number(action.y)) ? Number(action.y) : null,
      source: normalizeText(action?.source),
      timestamp: normalizeText(action?.timestamp)
    }))
    .filter((action) => action.type || action.locator || action.text || action.value)
    .slice(-MAX_CAPTURED_ACTIONS);

const normalizeCapturedNetwork = (network = []) =>
  (Array.isArray(network) ? network : [])
    .map((entry) => ({
      method: normalizeText(entry?.method) || "GET",
      url: normalizeText(entry?.url),
      status: Number.isFinite(Number(entry?.status)) ? Number(entry.status) : null,
      resource_type: normalizeText(entry?.resource_type || entry?.resourceType),
      page_id: normalizeText(entry?.page_id || entry?.pageId),
      page_title: normalizeText(entry?.page_title || entry?.pageTitle),
      request_body: normalizeRichText(entry?.request_body || entry?.requestBody || entry?.post_data || entry?.postData),
      response_body_sample: normalizeRichText(entry?.response_body_sample || entry?.responseBodySample),
      content_type: normalizeText(entry?.content_type || entry?.contentType)
    }))
    .filter((entry) => entry.url && ["fetch", "xhr"].includes(String(entry.resource_type || "").toLowerCase()))
    .slice(-MAX_CAPTURED_NETWORK);

const parseActionTimestamp = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const stripRecorderLocatorPrefix = (locator) => {
  const normalized = normalizeText(locator);

  if (!normalized) {
    return null;
  }

  return normalized;
};

const getRecorderRepositoryMember = (action, repositoryModel) =>
  repositoryModel?.byActionIndex?.get(Number(action?.index)) || null;

const resolveRecorderTarget = (action, repositoryModel) => {
  const repositoryMember = getRecorderRepositoryMember(action, repositoryModel);
  if (repositoryMember?.reference) {
    return repositoryMember.reference;
  }

  const locator = stripRecorderLocatorPrefix(action.locator);

  if (locator && !NON_REPOSITORY_RECORDING_LOCATORS.has(locator)) {
    return locator;
  }

  return normalizeText(action.text);
};

const quoteCodeString = (value) => JSON.stringify(String(value || ""));
const unescapeLocatorLiteral = (value) => String(value || "").replace(/\\(["'`\\])/g, "$1");
const extractLocatorCallArgument = (value) => {
  const match = String(value || "").match(/\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/);
  return match ? unescapeLocatorLiteral(match[2]) : "";
};
const extractLocatorOptionName = (value) => {
  const match = String(value || "").match(/\bname\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/i);
  return match ? unescapeLocatorLiteral(match[2]) : "";
};
const playwrightLocatorCode = (target) => {
  const normalized = String(target || "").trim();
  const methodMatch = normalized.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|locator)\s*\(/i);
  const legacyRoleMatch = normalized.match(/^role=([A-Za-z0-9_-]+)(?:\[name=(["']?)(.+?)\2\])?$/i);

  if (methodMatch) {
    const method = methodMatch[1];
    const arg = extractLocatorCallArgument(normalized);
    const optionName = extractLocatorOptionName(normalized);

    if (method.toLowerCase() === "locator") {
      return `page.locator(${quoteCodeString(arg || normalized)}).first()`;
    }
    if (method.toLowerCase() === "getbyrole") {
      return `page.getByRole(${quoteCodeString(arg)}, ${optionName ? `{ name: ${quoteCodeString(optionName)} }` : "{}"}).first()`;
    }
    return `page.${method}(${quoteCodeString(arg)}).first()`;
  }

  if (legacyRoleMatch) {
    return `page.getByRole(${quoteCodeString(legacyRoleMatch[1])}, ${legacyRoleMatch[3] ? `{ name: ${quoteCodeString(unescapeLocatorLiteral(legacyRoleMatch[3]))} }` : "{}"}).first()`;
  }
  if (/^(?:testid|data-testid)=/i.test(normalized)) {
    return `page.getByTestId(${quoteCodeString(normalized.replace(/^(?:testid|data-testid)=/i, ""))}).first()`;
  }
  if (/^label=/i.test(normalized)) {
    return `page.getByLabel(${quoteCodeString(normalized.slice(6))}).first()`;
  }
  if (/^placeholder=/i.test(normalized)) {
    return `page.getByPlaceholder(${quoteCodeString(normalized.slice(12))}).first()`;
  }
  if (/^text=/i.test(normalized)) {
    return `page.getByText(${quoteCodeString(normalized.slice(5))}).first()`;
  }

  return `page.locator(${quoteCodeString(normalized)}).first()`;
};
const playwrightLocatorBlock = (target, lines = []) => [
  "{",
  `  const target = ${playwrightLocatorCode(target)};`,
  ...lines.map((line) => `  ${line}`),
  "}"
].join("\n");
const keywordOptionsCode = (options = {}) => {
  const entries = Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) {
    return "{}";
  }

  return `{\n${entries.map(([key, value]) => `  ${key}: ${typeof value === "string" ? quoteCodeString(value) : String(value)}`).join(",\n")}\n}`;
};

const WEB_ELEMENT_OPTIONS_CODE = keywordOptionsCode({
  timeoutMs: 10000,
  scroll: "nearest",
  waitFor: "visible",
  force: false
});
const WEB_TYPE_OPTIONS_CODE = keywordOptionsCode({
  timeoutMs: 10000,
  scroll: "nearest",
  waitFor: "visible",
  clear: true,
  type: "char-by-char",
  delayMs: 35
});

const inferRecorderFillValue = (action) => {
  const targetText = `${action.locator || ""} ${action.text || ""}`.toLowerCase();
  const value = normalizeRichText(action.value);

  if (/\b(password|secret|token|otp|passcode)\b/.test(targetText)) {
    return "@t.password";
  }

  if (/\b(email)\b/.test(targetText)) {
    return value || "@t.email";
  }

  if (/\b(user|username|login)\b/.test(targetText)) {
    return value || "@t.username";
  }

  if (/\b(search|query)\b/.test(targetText)) {
    return value || "@t.search";
  }

  return value || "@t.value";
};

const describeRecorderTarget = (action, fallback, repositoryModel) =>
  getRecorderRepositoryMember(action, repositoryModel)?.field_name
  || normalizeText(action.text)
  || stripRecorderLocatorPrefix(action.locator)
  || fallback;

const keywordComment = (keyword, args = []) =>
  `// Keyword: ${keyword}(${args.map((arg) => quoteCodeString(arg)).join(", ")})`;

const buildRecorderStepCandidate = (action, order, repositoryModel) => {
  const type = String(action.type || "").toLowerCase();
  const target = resolveRecorderTarget(action, repositoryModel);
  const targetLabel = describeRecorderTarget(action, "recorded target", repositoryModel);
  const url = normalizeText(action.url);
  const key = normalizeText(action.text || action.value);
  const keyword = inferKeywordForAction(action);

  if (type === "navigation") {
    if (!url || url === "about:blank") {
      return null;
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: `Open ${url}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [url],
      automation_code: [
        keywordComment(keyword, [url]),
        `await page.goto(${quoteCodeString(url)});`,
        `await page.waitForLoadState("domcontentloaded");`
      ].join("\n")
    };
  }

  if (type === "click" || type === "submit") {
    if (target) {
      return {
        source_action_index: action.index,
        step_order: order,
        action: type === "submit" ? `Submit ${targetLabel}` : `Click ${targetLabel}`,
        expected_result: "",
        step_type: "web",
        keyword,
        keyword_arguments: [target],
        automation_code: [
          keywordComment(keyword, [target]),
          playwrightLocatorBlock(target, [
            `await target.waitFor({ state: "visible", timeout: 10000 });`,
            `await target.click();`
          ])
        ].join("\n")
      };
    }

    const position = Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))
      ? ` at ${Math.round(Number(action.x))}, ${Math.round(Number(action.y))}`
      : "";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `Click recorded screen position${position}`,
      expected_result: "Review the locator before running this step.",
      step_type: "web",
      keyword,
      keyword_arguments: ["body"],
      automation_code: [
        keywordComment(keyword, ["body"]),
        `// TODO: Replace this fallback with a stable locator for the recorded click${position}.`,
        playwrightLocatorBlock("body", [
          `await target.click();`
        ])
      ].join("\n")
    };
  }

  if (type === "dblclick" || type === "rightclick") {
    if (!target) {
      return null;
    }

    const verb = type === "dblclick" ? "Double click" : "Right click";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${verb} ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target],
      automation_code: [
        keywordComment(keyword, [target]),
        playwrightLocatorBlock(target, [
          `await target.waitFor({ state: "visible", timeout: 10000 });`,
          type === "dblclick" ? `await target.dblclick();` : `await target.click({ button: "right" });`
        ])
      ].join("\n")
    };
  }

  if (type === "fill" || type === "change") {
    const value = inferRecorderFillValue(action);

    if (target) {
      return {
        source_action_index: action.index,
        step_order: order,
        action: `Fill ${targetLabel}`,
        expected_result: "",
        step_type: "web",
        keyword,
        keyword_arguments: [target, value],
        automation_code: [
          keywordComment(keyword, [target, value]),
          playwrightLocatorBlock(target, [
            `await target.waitFor({ state: "visible", timeout: 10000 });`,
            `await target.fill(${quoteCodeString(value)});`
          ])
        ].join("\n")
      };
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Fill recorded field",
      expected_result: "Review the locator before running this step.",
      step_type: "web",
      keyword,
      keyword_arguments: ["body", value],
      automation_code: [
        keywordComment(keyword, ["body", value]),
        "// TODO: Replace this fallback with a stable locator for the recorded field.",
        playwrightLocatorBlock("body", [
          `await target.fill(${quoteCodeString(value)});`
        ])
      ].join("\n")
    };
  }

  if (type === "upload") {
    const value = normalizeRichText(action.value) || "@t.uploadFilePath";

    if (target) {
      return {
        source_action_index: action.index,
        step_order: order,
        action: `Upload file to ${targetLabel}`,
        expected_result: "",
        step_type: "web",
        keyword,
        keyword_arguments: [target, value],
        automation_code: [
          keywordComment(keyword, [target, value]),
          `await web.uploadFile(${quoteCodeString(target)}, ${quoteCodeString(value)}, { waitFor: "attached" });`
        ].join("\n")
      };
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Upload file",
      expected_result: "Review the file input locator before running this step.",
      step_type: "web",
      keyword,
      keyword_arguments: ["input[type=file]", value],
      automation_code: [
        keywordComment(keyword, ["input[type=file]", value]),
        `await web.uploadFile("input[type=file]", ${quoteCodeString(value)}, { waitFor: "attached" });`
      ].join("\n")
    };
  }

  if (type === "select") {
    const value = normalizeRichText(action.value) || normalizeRichText(action.text) || "@t.value";

    if (target) {
      return {
        source_action_index: action.index,
        step_order: order,
        action: `Select ${describeRecorderTarget(action, value, repositoryModel)} in ${targetLabel}`,
        expected_result: "",
        step_type: "web",
        keyword,
        keyword_arguments: [target, value],
        automation_code: [
          keywordComment(keyword, [target, value]),
          playwrightLocatorBlock(target, [
            `await target.waitFor({ state: "visible", timeout: 10000 });`,
            `await target.selectOption(${quoteCodeString(value)});`
          ])
        ].join("\n")
      };
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Select recorded dropdown value",
      expected_result: "Review the locator before running this step.",
      step_type: "web",
      keyword,
      keyword_arguments: ["select", value],
      automation_code: [
        keywordComment(keyword, ["select", value]),
        "// TODO: Replace this fallback with a stable locator for the recorded dropdown.",
        playwrightLocatorBlock("select", [
          `await target.selectOption(${quoteCodeString(value)});`
        ])
      ].join("\n")
    };
  }

  if (type === "check" || type === "uncheck") {
    if (!target) {
      return null;
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${type === "check" ? "Check" : "Uncheck"} ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target],
      automation_code: [
        keywordComment(keyword, [target]),
        playwrightLocatorBlock(target, [
          `await target.waitFor({ state: "visible", timeout: 10000 });`,
          `await target.${type}();`
        ])
      ].join("\n")
    };
  }

  if (type === "press") {
    const normalizedKey = key || "Enter";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `Press ${normalizedKey}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [normalizedKey],
      automation_code: [
        keywordComment(keyword, [normalizedKey]),
        `await page.keyboard.press(${quoteCodeString(normalizedKey)});`
      ].join("\n")
    };
  }

  if (type === "tab") {
    return {
      source_action_index: action.index,
      step_order: order,
      action: "Press Tab",
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: ["Tab"],
      automation_code: [
        keywordComment(keyword, ["Tab"]),
        `await page.keyboard.press("Tab");`
      ].join("\n")
    };
  }

  if (type === "scroll") {
    let deltaX = 0;
    let deltaY = 600;
    try {
      const payload = JSON.parse(action.value || "{}");
      deltaX = Number(payload.delta_x || 0);
      deltaY = Number(payload.delta_y || payload.y || 600);
    } catch {
      // Keep a deterministic scroll fallback.
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Scroll page",
      expected_result: "",
      step_type: "web",
      keyword: "web.scroll",
      keyword_arguments: [String(Number.isFinite(deltaX) ? deltaX : 0), String(Number.isFinite(deltaY) ? deltaY : 600)],
      automation_code: [
        keywordComment("web.scroll", [String(Number.isFinite(deltaX) ? deltaX : 0), String(Number.isFinite(deltaY) ? deltaY : 600)]),
        `await page.mouse.wheel(${Number.isFinite(deltaX) ? deltaX : 0}, ${Number.isFinite(deltaY) ? deltaY : 600});`
      ].join("\n")
    };
  }

  return null;
};

const isRecorderActionSuperseded = (action, actions, index) => {
  const type = String(action.type || "").toLowerCase();

  if (type === "click" && action.source === "remote-control") {
    const timestamp = parseActionTimestamp(action.timestamp);
    return actions.slice(index + 1, index + 4).some((candidate) =>
      String(candidate.type || "").toLowerCase() === "click"
      && (candidate.locator || candidate.text)
      && candidate.source !== "remote-control"
      && (!timestamp || Math.abs(parseActionTimestamp(candidate.timestamp) - timestamp) < 2_000)
    );
  }

  if ((type === "change" || type === "fill" || type === "upload" || type === "select" || type === "check" || type === "uncheck") && action.locator) {
    const previousSameLocator = actions.slice(0, index).some((candidate) =>
      ["fill", "change", "upload", "select", "check", "uncheck"].includes(String(candidate.type || "").toLowerCase())
      && candidate.locator === action.locator
      && Math.abs(parseActionTimestamp(candidate.timestamp) - parseActionTimestamp(action.timestamp)) < 12_000
    );
    const laterSameLocator = actions.slice(index + 1).some((candidate) =>
      ["fill", "change", "upload", "select", "check", "uncheck"].includes(String(candidate.type || "").toLowerCase())
      && candidate.locator === action.locator
      && Math.abs(parseActionTimestamp(candidate.timestamp) - parseActionTimestamp(action.timestamp)) < 12_000
    );

    return previousSameLocator && laterSameLocator
      ? true
      : laterSameLocator;
  }

  if (type === "navigation") {
    const url = normalizeText(action.url);

    if (!url || url === "about:blank") {
      return true;
    }

    return actions.slice(0, index).some((candidate) =>
      String(candidate.type || "").toLowerCase() === "navigation"
      && normalizeText(candidate.url) === url
      && Math.abs(parseActionTimestamp(candidate.timestamp) - parseActionTimestamp(action.timestamp)) < 1_500
    );
  }

  return false;
};

const buildRecorderStepCandidates = (actions = [], repositoryModel = null) => {
  const allowedTypes = new Set(["navigation", "click", "dblclick", "rightclick", "fill", "change", "upload", "select", "check", "uncheck", "submit", "press", "tab", "scroll"]);
  const candidates = [];

  actions.forEach((action, index) => {
    const type = String(action.type || "").toLowerCase();

    if (!allowedTypes.has(type) || isRecorderActionSuperseded(action, actions, index)) {
      return;
    }

    const candidate = buildRecorderStepCandidate(action, candidates.length + 1, repositoryModel);

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
};

const tokenizeMappingText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "into", "from"].includes(token));

const scoreRecorderMapping = (manualStep, candidate) => {
  const manualTokens = new Set(tokenizeMappingText(`${manualStep.action || ""} ${manualStep.expected_result || ""}`));
  const candidateTokens = tokenizeMappingText(`${candidate.action || ""} ${candidate.automation_code || ""}`);

  if (!manualTokens.size || !candidateTokens.length) {
    return 0;
  }

  const overlap = candidateTokens.filter((token) => manualTokens.has(token)).length;
  return overlap / Math.max(candidateTokens.length, manualTokens.size);
};

const buildFallbackRecorderMappings = (manualSteps = [], stepCandidates = []) => {
  if (!manualSteps.length || !stepCandidates.length) {
    return [];
  }

  const groups = manualSteps.map((step) => ({
    step,
    candidates: [],
    mapping_source: "fallback"
  }));

  stepCandidates.forEach((candidate, index) => {
    let targetIndex = Math.min(groups.length - 1, Math.floor((index * groups.length) / stepCandidates.length));
    let bestScore = 0;

    groups.forEach((group, groupIndex) => {
      const score = scoreRecorderMapping(group.step, candidate);

      if (score > bestScore) {
        bestScore = score;
        targetIndex = groupIndex;
      }
    });

    groups[targetIndex].candidates.push(candidate);
  });

  return groups.filter((group) => group.candidates.length);
};

const orderRecorderCandidates = (candidates = []) => {
  const seen = new Set();
  return candidates.filter(Boolean).map((candidate, position) => {
    const rawIndex = candidate.source_action_index;
    const index = rawIndex !== null && rawIndex !== undefined && rawIndex !== "" && Number.isFinite(Number(rawIndex))
      ? Number(rawIndex) : null;
    return { candidate, index, position };
  }).filter(({ index }) => {
    // Missing identities are not interchangeable: retain their original order.
    if (index === null) return true;
    if (seen.has(index)) return false;
    seen.add(index);
    return true;
  }).sort((left, right) => (left.index ?? Infinity) - (right.index ?? Infinity) || left.position - right.position)
    .map(({ candidate }) => candidate);
};

const mergeRecorderMappingGroups = (groups = []) => {
  const byStepId = new Map();

  groups.forEach((group) => {
    if (!group?.step?.id || !Array.isArray(group.candidates) || !group.candidates.length) {
      return;
    }

    const current = byStepId.get(group.step.id) || {
      ...group,
      candidates: [],
      confidence: group.confidence || 0
    };

    current.candidates.push(...group.candidates);
    current.confidence = Math.max(Number(current.confidence || 0), Number(group.confidence || 0));
    current.mapping_source =
      current.mapping_source && current.mapping_source !== group.mapping_source
        ? "mixed"
        : current.mapping_source || group.mapping_source;
    byStepId.set(group.step.id, current);
  });

  return [...byStepId.values()]
    .map((group) => ({ ...group, candidates: orderRecorderCandidates(group.candidates) }))
    .sort((left, right) => Number(left.step.step_order || 0) - Number(right.step.step_order || 0));
};

const buildRecorderMappingPrompt = ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  additionalContext
}) => [
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.1"),
  "",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.2"),
  "",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.8"),
  "{",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.9"),
  "}",
  "",
  [aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.buildRecorderMappingPrompt.segment.3"),String(testCase.title),""].join(''),
  [aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.buildRecorderMappingPrompt.segment.4"),String(testCase.description || "No description provided."),""].join(''),
  "",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.17"),
  JSON.stringify(manualSteps.map(summarizeStep), null, 2),
  "",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.18"),
  JSON.stringify(stepCandidates.map((candidate) => ({
    source_action_index: candidate.source_action_index,
    generated_order: candidate.step_order,
    action: candidate.action,
    expected_result: candidate.expected_result,
    automation_code: candidate.automation_code
  })), null, 2),
  "",
  aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.19"),
  JSON.stringify(capturedActions.slice(0, MAX_CAPTURED_ACTIONS), null, 2),
  additionalContext ? `\nAdditional guidance:\n${additionalContext}` : ""
].filter(Boolean).join("\n");

const normalizeRecorderAiMappings = (payload, manualSteps = [], stepCandidates = []) => {
  const stepsById = new Map(manualSteps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(manualSteps.map((step) => [Number(step.step_order || 0), step]));
  const candidatesBySourceIndex = new Map(stepCandidates.map((candidate) => [Number(candidate.source_action_index), candidate]));
  const candidatesByGeneratedOrder = new Map(stepCandidates.map((candidate) => [Number(candidate.step_order), candidate]));
  const usedSourceIndexes = new Set();
  const groupsByStepId = new Map();
  const mappings = Array.isArray(payload?.mappings) ? payload.mappings : [];

  mappings.forEach((mapping) => {
    if (!isPlainObject(mapping)) {
      return;
    }

    const stepId = normalizeText(mapping.manual_step_id || mapping.step_id || mapping.id);
    const stepOrder = Number(mapping.manual_step_order || mapping.step_order || mapping.order);
    const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

    if (!step) {
      return;
    }

    const rawReferences = [
      ...(Array.isArray(mapping.source_action_indexes) ? mapping.source_action_indexes : []),
      ...(Array.isArray(mapping.source_action_indices) ? mapping.source_action_indices : []),
      ...(Array.isArray(mapping.recorder_action_indexes) ? mapping.recorder_action_indexes : []),
      ...(Array.isArray(mapping.action_indexes) ? mapping.action_indexes : []),
      ...(Array.isArray(mapping.candidate_orders) ? mapping.candidate_orders : []),
      ...(Array.isArray(mapping.generated_orders) ? mapping.generated_orders : [])
    ];
    const candidates = rawReferences
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => candidatesBySourceIndex.get(value) || candidatesByGeneratedOrder.get(value))
      .filter(Boolean)
      .filter((candidate) => {
        const sourceIndex = Number(candidate.source_action_index);

        if (usedSourceIndexes.has(sourceIndex)) {
          return false;
        }

        usedSourceIndexes.add(sourceIndex);
        return true;
      });

    if (!candidates.length) {
      return;
    }

    const current = groupsByStepId.get(step.id) || {
      step,
      candidates: [],
      mapping_source: "ai",
      confidence: 0
    };

    current.candidates.push(...candidates);
    current.confidence = Math.max(current.confidence, Math.max(0, Math.min(1, clampNumber(mapping.confidence, 0))));
    groupsByStepId.set(step.id, current);
  });

  return {
    summary: normalizeRichText(payload?.summary) || "Recorder automation mapped to existing manual steps.",
    mappings: [...groupsByStepId.values()].map((group) => ({ ...group, candidates: orderRecorderCandidates(group.candidates) }))
  };
};

const buildAiRecorderMappings = async ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  integrationId,
  userId,
  additionalContext,
  transactionId
}) => {
  let integration = null;

  try {
    integration = await resolveLlmIntegration(integrationId, {
      userId,
      projectId: testCase.project_id,
      usageKey: "ai.automation.recorder_mapping"
    });
  } catch (error) {
    return {
      mappings: [],
      summary: null,
      integration: null,
      fallback_reason: error instanceof Error ? error.message : "Unable to resolve LLM integration"
    };
  }

  if (!integration) {
    return {
      mappings: [],
      summary: null,
      integration: null,
      fallback_reason: "No active LLM integration is configured"
    };
  }

  try {
    const content = await requestChatCompletion({
      integration,
      featureKey: "ai.automation.recorder_mapping",
      prompt: buildRecorderMappingPrompt({
        testCase,
        manualSteps,
        stepCandidates,
        capturedActions,
        additionalContext: normalizeRichText(additionalContext)
      })
    });
    const normalized = normalizeRecorderAiMappings(extractJsonPayload(content), manualSteps, stepCandidates);

    if (!normalized.mappings.length && stepCandidates.length) {
      throw new Error("LLM did not return usable recorder step mappings");
    }

    await appendEvent(transactionId, {
      phase: "recorder.ai.mapping.completed",
      message: `AI mapped recorder automation onto ${normalized.mappings.length} manual step${normalized.mappings.length === 1 ? "" : "s"}.`,
      details: {
        integration_id: integration.id,
        model: integration.model,
        mapped_steps: normalized.mappings.length,
        mapped_interactions: normalized.mappings.reduce((total, group) => total + group.candidates.length, 0)
      }
    });

    return {
      mappings: normalized.mappings,
      summary: normalized.summary,
      integration,
      fallback_reason: null
    };
  } catch (error) {
    return {
      mappings: [],
      summary: null,
      integration,
      fallback_reason: error instanceof Error ? error.message : "LLM recorder mapping failed"
    };
  }
};

const createRecorderAutomationCode = (candidates = []) =>
  orderRecorderCandidates(candidates)
    .map((candidate) => [
      `// Recorded: ${candidate.action || "browser interaction"}`,
      candidate.automation_code
    ].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");

const buildPrompt = ({
  testCase,
  steps,
  cacheRows,
  knowledgeRows,
  capturedActions,
  capturedNetwork,
  buildContext,
  startUrl,
  additionalContext
}) => {
  // Shared native request templates belong to keyword generation. The model
  // boundary still applies the active specialist's prompt, model and policies,
  // and any matching published specialist block overrides these source blocks.
  const prompt = [
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.44"),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.45"),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.66"),
    "{",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.67"),
    "}",
    "",
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.5"),String(testCase.project_name || testCase.project_id || "Unknown project"),""].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.6"),String(testCase.app_type_name || testCase.app_type_id || "Unknown app"),aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.7"),String(testCase.app_type_kind || "web"),aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.8")].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.9"),String(testCase.title),""].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.10"),String(testCase.description || "No description provided."),""].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.11"),String((safeJson(testCase.external_references, []) || []).join(", ") || "None"),""].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.12"),String((safeJson(testCase.labels, []) || []).join(", ") || "None"),""].join(''),
    [aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.13"),String(startUrl || "Not provided"),""].join(''),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.89"),
    JSON.stringify(buildContext || { environment: null, configuration: null, data_set: null }, null, 2),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.90"),
    JSON.stringify(steps.map(summarizeStep), null, 2),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.91"),
    JSON.stringify(summarizeScreenCatalog(cacheRows), null, 2),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.92"),
    JSON.stringify(summarizeCache(cacheRows), null, 2),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.93"),
    JSON.stringify(safeJson(testCase.parameter_values, {}), null, 2),
    "",
    aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.94"),
    JSON.stringify(summarizeKnowledge(knowledgeRows?.knowledge || knowledgeRows), null, 2)
  ];

  if (capturedActions.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.95"));
    prompt.push(JSON.stringify(capturedActions, null, 2));
  }

  if (capturedNetwork.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.96"));
    prompt.push(JSON.stringify(capturedNetwork, null, 2));
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.97"));
    prompt.push(additionalContext);
  }

  return prompt.join("\n");
};

const buildRepositoryImprovePrompt = ({ entry, guidance }) => [
  aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.11"),
  "",
  aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.12"),
  "{",
  aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.13"),
  "}",
  "",
  aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.99"),
  "",
  aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.20"),
  JSON.stringify(entry, null, 2),
  "",
  guidance ? `User guidance:\n${guidance}` : "User guidance: none"
].join("\n");

const buildRepositoryExtractPrompt = ({ screenName, pageUrl, domStructure, businessMeaning, candidateFields }) => [
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.21"),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.22"),
  "{",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.23"),
  "}",
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.104"),
  "",
  [aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.14"),String(screenName),""].join(''),
  [aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.15"),String(pageUrl || "Not supplied"),""].join(''),
  [aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.16"),String(businessMeaning || "Not supplied"),""].join(''),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.105"),
  String(domStructure || "Not supplied").slice(0, 50_000),
  "",
  aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.38"),
  JSON.stringify(candidateFields || [], null, 2)
].join("\n");

const normalizeRepositoryExtractFields = (payload, fallbackFields = []) => {
  const supplied = Array.isArray(payload?.fields) ? payload.fields : [];
  const sourceFields = supplied.length ? supplied : fallbackFields;
  const seenLocators = new Set();
  const fields = sourceFields.slice(0, 100).map((field, index) => {
    const fallbackLocators = Array.isArray(field?.fallback_locators || field?.fallbackLocators)
      ? field.fallback_locators || field.fallbackLocators
      : [];
    const locator = normalizeText(field?.locator || field?.primaryLocator);

    return {
      name: normalizeText(field?.name || field?.object_name) || `Field ${index + 1}`,
      tag: normalizeText(field?.tag || field?.html_tag) || "element",
      role: normalizeText(field?.role || field?.object_role) || "field",
      locator,
      locatorKind: normalizeText(field?.locator_kind || field?.locatorKind || field?.primaryStrategy) || "css",
      dom: normalizeText(field?.dom || field?.dom_structure) || "",
      fallbackLocators: fallbackLocators.map((candidate) => ({
        locator: normalizeText(candidate?.locator),
        strategy: normalizeText(candidate?.strategy || candidate?.locator_kind) || "css",
        confidenceScore: clampNumber(candidate?.confidenceScore ?? candidate?.confidence, 0.65)
      })).filter((candidate) => candidate.locator),
      description: normalizeText(field?.description),
      businessMeaning: normalizeText(field?.business_meaning || field?.businessMeaning),
      usageKeywords: Array.isArray(field?.usage_keywords || field?.usageKeywords)
        ? field.usage_keywords || field.usageKeywords
        : []
    };
  }).filter((field) => {
    if (!field.locator || seenLocators.has(field.locator)) {
      return false;
    }

    seenLocators.add(field.locator);
    return true;
  });

  return {
    screen_summary: normalizeText(payload?.screen_summary) || null,
    intended_flows: Array.isArray(payload?.intended_flows)
      ? payload.intended_flows.map(normalizeText).filter(Boolean)
      : [],
    fields
  };
};

const buildDeterministicRepositorySuggestion = (entry, guidance) => {
  const metadata = normalizeObject(entry.metadata);
  const objectName = normalizeText(metadata.object_name) || normalizeText(entry.locator_intent) || "Object";
  const screenName = normalizeText(metadata.screen_name) || normalizeText(entry.page_key) || "Screen";
  const criteria = [
    entry.locator ? `Primary locator: ${entry.locator}` : null,
    entry.locator_kind ? `Locator kind: ${entry.locator_kind}` : null,
    normalizeText(metadata.dom_structure) ? "Use curated DOM structure as secondary evidence." : null,
    normalizeText(metadata.screenshot_url || metadata.screenshot_path) ? "Use screenshot fallback when locator confidence drops." : null,
    guidance ? `Curator guidance: ${guidance}` : null
  ].filter(Boolean);

  return {
    page_key: entry.page_key,
    screen_name: screenName,
    object_name: objectName,
    object_role: normalizeText(metadata.object_role) || entry.locator_kind || "field",
    locator: entry.locator,
    locator_kind: entry.locator_kind || "curated",
    target_criteria: criteria,
    dom_structure: normalizeText(metadata.dom_structure || metadata.dom_path || metadata.html) || `Stable ${objectName} control on ${screenName}.`,
    fallback_strategy: normalizeText(metadata.fallback_strategy) || "Use screenshot and nearby DOM/accessibility labels only after locator retry fails.",
    confidence: clampNumber(entry.confidence, 0.5),
    fallback_used: true,
    fallback_reason: "No active LLM repository improvement was available."
  };
};

const inferQuotedText = (value) => {
  const text = normalizeRichText(value);

  if (!text) {
    return null;
  }

  const quoteMatch = text.match(/["“']([^"”']{2,})["”']/);
  if (quoteMatch) {
    return quoteMatch[1].trim();
  }

  return null;
};

const inferLocatorText = (step) => {
  const action = normalizeRichText(step.action) || "";
  const quoted = inferQuotedText(action);

  if (quoted) {
    return quoted;
  }

  const matches = [
    action.match(/\b(?:click|tap|select|choose|open)\s+(?:on\s+)?(?:the\s+)?(.+)$/i),
    action.match(/\b(?:enter|type|fill|input)\s+.+?\s+(?:in|into|on)\s+(?:the\s+)?(.+)$/i),
    action.match(/\b(?:field|button|link|tab|menu)\s+(.+)$/i)
  ];

  for (const match of matches) {
    const candidate = normalizeRichText(match?.[1]);
    if (candidate) {
      return candidate.replace(/[.。]$/, "");
    }
  }

  return action.slice(0, 80) || `step ${step.step_order || 1}`;
};

const findCachedLocator = (step, cacheRows = []) => {
  const intent = `${step.action || ""} ${step.expected_result || ""}`.toLowerCase();

  return cacheRows.find((row) => {
    const haystack = `${row.locator_intent || ""} ${row.page_key || ""}`.toLowerCase();
    return haystack && intent && haystack.split(/\s+/).some((token) => token.length > 3 && intent.includes(token));
  })?.locator || null;
};

const normalizeStepCandidate = (candidate, stepsById, stepsByOrder) => {
  if (!isPlainObject(candidate)) {
    return null;
  }

  const stepId = normalizeText(candidate.step_id || candidate.id);
  const suppliedOrder = candidate.step_order ?? candidate.order;
  const stepOrder = Number(suppliedOrder);
  const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

  if (!step) {
    return null;
  }

  if (suppliedOrder !== undefined && stepOrder !== Number(step.step_order)) {
    throw new Error("Automation output changed a step position. Keep the supplied step IDs and sequence.");
  }
  const suppliedType = candidate.step_type ?? candidate.stepType;
  if (suppliedType !== undefined && !normalizeTestStepType(suppliedType)) {
    throw new Error("Automation output contains an unsupported runtime. Use web, api, android or ios.");
  }
  const apiRequest = candidate.api_request ?? candidate.apiRequest;
  if (apiRequest && normalizeTestStepType(suppliedType, step.step_type || "web") === "api") {
    const request = parseJsonValue(apiRequest, null);
    const method = String(request?.method || "GET").trim().toUpperCase();
    const bodyMode = String(request?.body_mode || request?.bodyMode || request?.bodyType || "none").trim().toLowerCase();
    if (!request || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)
      || !["none", "json", "text", "xml", "form"].includes(bodyMode)
      || (request.body != null && typeof request.body !== "string")) {
      throw new Error(`Step ${step.step_order} contains an invalid API request. Use a supported method and a string request body.`);
    }
    for (const key of ["headers", "validations", "captures"]) {
      if (request[key] != null && !Array.isArray(request[key])) throw new Error(`Step ${step.step_order} API ${key} must be an array.`);
    }
    if(request.headers?.some(header=>!isPlainObject(header)||!normalizeText(header.key)||typeof header.value!=="string"))throw new Error(`Step ${step.step_order} contains an invalid API header. Preserve each header name and string value.`);
    if (request.validations?.some((validation) => !["status", "header", "body_contains", "json_path"].includes(validation?.kind || validation?.type)
      || typeof (validation.expected ?? validation.value) !== "string"
      || (["header", "json_path"].includes(validation.kind || validation.type) && !normalizeText(validation.target || validation.path)))) {
      throw new Error(`Step ${step.step_order} contains an invalid API assertion. Provide a supported kind, target when required, and string expected value.`);
    }
    if (request.captures?.some((capture) => !normalizeText(capture?.path) || !normalizeText(capture?.parameter))) throw new Error(`Step ${step.step_order} contains an incomplete API capture.`);
    const normalized=normalizeApiRequest(request);
    if(['headers','validations','captures'].some(key=>(request[key]?.length||0)!==(normalized?.[key]?.length||0)))throw new Error(`Step ${step.step_order} contains API fields that would be discarded. Provide complete headers, assertions and captures.`);
    if(request.body && (bodyMode==='none'||['GET','HEAD'].includes(method)))throw new Error(`Step ${step.step_order} supplies an API body that this method or body mode would discard.`);
    if(request.timeout_ms!==undefined&&Number(request.timeout_ms)!==normalized?.timeout_ms)throw new Error(`Step ${step.step_order} API timeout must fit the supported runtime range without normalization.`);
    const existing=normalizeApiRequest(step.api_request);
    for(const key of ['validations','captures'])if(existing?.[key]?.some(item=>!normalized?.[key]?.some(next=>JSON.stringify(next)===JSON.stringify(item))))throw new Error(`Step ${step.step_order} removed or changed an existing API ${key==='validations'?'assertion':'capture'}. Preserve the saved behavior and expected values.`);
  }

  return {
    step,
    step_type: normalizeTestStepType(candidate.step_type || candidate.stepType, step.step_type || "web"),
    automation_code: normalizeRichText(candidate.automation_code || candidate.automationCode || candidate.code),
    api_request: normalizeApiRequest(candidate.api_request || candidate.apiRequest)
  };
};

const normalizeLlmBuild = (payload, steps, cacheRows, startUrl, grounding) => {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(steps.map((step) => [Number(step.step_order || 0), step]));
  const candidates = Array.isArray(payload?.steps) ? payload.steps : [];
  const byStepId = new Map();

  candidates.forEach((candidate) => {
    const normalized = normalizeStepCandidate(candidate, stepsById, stepsByOrder);
    if (!normalized || byStepId.has(normalized.step.id)) throw new Error("Automation output contains an unknown or duplicate step. Retry generation.");
    if (normalized.step_type !== normalizeTestStepType(normalized.step.step_type, "web")) throw new Error("Automation output changed a step runtime. Keep web, API and native steps in their original runtime.");
    byStepId.set(normalized.step.id, normalized);
  });

  if (byStepId.size !== steps.length) throw new Error("Automation output is incomplete. Every manual step needs an executable mapping. Retry with more context.");
  const updates = steps.map((step) => {
    const candidate = byStepId.get(step.id);
    const stepType = candidate?.step_type || normalizeTestStepType(step.step_type, "web");
    let automationCode = candidate?.automation_code;
    if (stepType !== "api") {
      try {automationCode=normalizeGeneratedProgram(automationCode,{runtime:stepType});if(stepType==='web')preserveGeneratedAssertions(step.automation_code,automationCode,{parameters:grounding?.parameters,resolveParameter:grounding?.resolveAssertionParameter});}
      catch(error){throw Object.assign(new Error(`Step ${step.step_order}: ${error.message}`),error.code==='AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'?{code:error.code}:{});}
      if(stepType==='web'&&grounding)validateNavigationGrounding(automationCode,grounding.origins,{parameters:grounding.parameters,resolveText:grounding.resolveText});
      const runtimeNames = stepType === "web" ? ["page", "expect", "web", "params", "capture", "playwrightPage"] : ["android", "ios", "mobile", "driver", "browser", "$", "params", "capture"];
      try { new (Object.getPrototypeOf(async function () {}).constructor)(...runtimeNames, automationCode); }
      catch { throw new Error(`Step ${step.step_order} contains invalid JavaScript. Retry generation.`); }
    }
    if (stepType === "api" && !candidate?.api_request?.url) throw new Error(`Step ${step.step_order} needs a complete API request.`);

    return {
      step,
      step_type: stepType,
      automation_code: stepType === "api" ? null : automationCode,
      api_request: stepType === "api" ? candidate.api_request : null
    };
  }).filter((update) => update.automation_code || update.api_request);

  const learnedLocators = (Array.isArray(payload?.learned_locators) ? payload.learned_locators : [])
    .map((item) => ({
      page_url: normalizeText(item?.page_url || item?.pageUrl),
      page_key: normalizeText(item?.page_key || item?.pageKey) || normalizeUrlKey(item?.page_url || startUrl),
      locator_intent: normalizeText(item?.intent || item?.locator_intent || item?.name),
      locator: normalizeText(item?.locator),
      locator_kind: normalizeText(item?.kind || item?.locator_kind),
      confidence: Math.max(0, Math.min(1, clampNumber(item?.confidence, 0.5))),
      metadata: normalizeObject(item?.metadata)
    }))
    .filter((item) => item.page_key && item.locator_intent && item.locator)
    .filter(item=>!startUrl||!grounding||scopeRepositoryToTarget([item],startUrl).length>0);

  return {
    summary: normalizeRichText(payload?.summary) || "Automation generated for the manual test case.",
    base_url: normalizeText(payload?.base_url || payload?.baseUrl),
    updates,
    learned_locators: learnedLocators
  };
};


const appendEvent = async (transactionId, event) => {
  if (!transactionId) {
    return;
  }

  await workspaceTransactionService.appendTransactionEvent(transactionId, event);
};

const updateTransaction = async (transactionId, patch) => {
  if (!transactionId) {
    return null;
  }

  return workspaceTransactionService.updateTransaction(transactionId, patch);
};

const createArtifactContent = input => require('../lib/automationPortableArtifact').createPortableAutomationArtifact(input);

const persistLearning = async ({
  testCase,
  learnedLocators = [],
  capturedActions = [],
  capturedNetwork = [],
  transactionId,
  repositoryModel = null,
  integrationId = null
}) => {
  let persisted = 0;
  const recorderRepositoryModel = repositoryModel
    || (capturedActions?.length
      ? await buildRecorderRepositoryModel({
        testCase,
        capturedActions,
        integrationId,
        transactionId
      })
      : null);

  if (recorderRepositoryModel) {
    for (const screen of recorderRepositoryModel.screens.values()) {
      await upsertLearningCache.run(
        uuid(),
        testCase.project_id || null,
        testCase.app_type_id || null,
        testCase.id,
        screen.page_url || null,
        screen.screen_name,
        "__screen__",
        "__screen__",
        "screen",
        1,
        platformSource(screen.platform, "recorder_screen"),
        {
          record_kind: "screen",
          screen_name: screen.screen_name,
          object_name: "__screen__",
          object_role: "screen",
          platform: screen.platform || "web",
          page_identity: screen.page_identity || null,
          page_title: screen.page_title || null,
          url_pattern_type: screen.url_pattern_type || "contains",
          url_pattern_value: screen.url_pattern_value || screen.page_identity || screen.page_url || null,
          learned_from: "recorder",
          test_case_title: testCase.title,
          last_recorded_at: new Date().toISOString()
        }
      );
      persisted += 1;
    }

    for (const field of recorderRepositoryModel.fields.values()) {
      await upsertLearningCache.run(
        uuid(),
        testCase.project_id || null,
        testCase.app_type_id || null,
        testCase.id,
        field.page_url || null,
        field.screen_name,
        field.field_name,
        field.locator,
        field.locator_kind || inferLocatorStrategy(field.locator, "recorder"),
        0.88,
        platformSource(field.platform, "object_repository_recorder"),
        {
          record_kind: "field",
          screen_name: field.screen_name,
          object_name: field.field_name,
          object_role: field.object_role || "field",
          object_label: field.object_label || null,
          keyword: field.keyword || null,
          parameter_hint: field.parameter_hint || null,
          page_identity: field.page_identity || null,
          page_title: field.page_title || null,
          source_action_indexes: field.source_action_indexes || [],
          value_captured: Boolean(field.action?.value),
          platform: field.platform || "web",
          usage_keywords: [field.keyword].filter(Boolean),
          target_criteria: [
            field.object_label ? `Recorded label: ${field.object_label}` : null,
            field.keyword ? `Recorded keyword: ${field.keyword}` : null,
            field.locator ? `Primary locator: ${field.locator}` : null
          ].filter(Boolean),
          test_case_title: testCase.title,
          last_recorded_at: new Date().toISOString()
        }
      );
      persisted += 1;
    }
  }

  for (const locator of learnedLocators) {
    await upsertLearningCache.run(
      uuid(),
      testCase.project_id || null,
      testCase.app_type_id || null,
      testCase.id,
      locator.page_url,
      locator.page_key,
      locator.locator_intent,
      locator.locator,
      locator.locator_kind,
      locator.confidence,
      "ai_builder",
      {
        ...locator.metadata,
        test_case_title: testCase.title
      }
    );
    persisted += 1;
  }

  if (capturedNetwork.length) {
    await appendEvent(transactionId, {
      phase: "recorder.network.learned",
      message: `Recorder retained ${capturedNetwork.length} API interaction${capturedNetwork.length === 1 ? "" : "s"} as flow evidence without creating a companion case.`,
      details: {
        captured_network_count: capturedNetwork.length,
        companion_case_created: false,
        sample: capturedNetwork.slice(0, 5)
      }
    });
  }

  return persisted;
};

const applyBuild = async ({ build, executionGuard, createdBy, progressiveState, partial = false }) => {
  if (partial && !progressiveState) throw Object.assign(new Error('Progressive saves require the complete original case baseline.'), { code: 'AUTOMATION_BUILD_BASELINE_REQUIRED' });
  const committed = await db.transaction(async () => {
    await executionGuard?.ensureOwnership();
    const updated = [];
    const caseId = build.updates[0]?.step.test_case_id;
    const baseline = progressiveState ? progressiveState.steps : build.updates.map(update => update.step);
    const parameterKey = progressiveState ? progressiveState.parameter_context_key : build.parameter_context_key;
    const inputContext = progressiveState ? progressiveState.input_context : build.input_context;
    const dataSnapshot = progressiveState ? progressiveState.data_snapshot : build.data_snapshot;
    const caseSql = 'SELECT tc.id,tc.display_id,tc.suite_id,tc.automated,tc.parameter_values,tc.test_data_options,tc.automation_start_url,tc.app_type_id,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id = ? FOR UPDATE OF tc FOR SHARE OF app';
    const stepsSql = 'SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC FOR UPDATE';
    let current = [];
    if (caseId) {
      const currentCase = await db.prepare(caseSql).get(caseId);
      if (build.app_type_id !== undefined && (!currentCase || currentCase.app_type_id !== build.app_type_id || currentCase.project_id !== build.project_id)) throw Object.assign(new Error('The automation case application or project changed while the agent was building. Existing instructions were retained; refresh before building again.'), { statusCode: 409, code: 'AUTOMATION_TARGET_CHANGED' });
      if (build.case_start_url !== undefined && (currentCase.automation_start_url || null) !== build.case_start_url) throw Object.assign(new Error('Start URL changed while the agent was building. Existing instructions were retained; retry using the reviewed target.'), { statusCode: 409, code: 'AUTOMATION_START_URL_CHANGED' });
      if (build.manual_context) {
        const links = await db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ? ORDER BY manual_test_case_id').all(caseId);
        if (JSON.stringify(links.map(row => row.manual_test_case_id)) !== JSON.stringify(build.manual_link_ids)) throw new Error('Linked manual cases changed while the agent was building. Existing instructions were retained; retry using the current linked cases.');
        for (const row of links) await db.prepare('SELECT id FROM test_cases WHERE id = ? FOR UPDATE').get(row.manual_test_case_id);
        const currentManual = await loadAutomationManualContext({ caseId, projectId: build.project_id, userId: createdBy, lock: true });
        if (manualContextKey(currentManual) !== manualContextKey(build.manual_context)) throw new Error('A linked manual case or its steps changed while the agent was building. Existing instructions were retained; retry using the current specification.');
      }
      if (parameterKey != null || inputContext) {
        const currentParameters = await loadAutomationParameterContext({ testCase: currentCase, projectId: build.project_id, userId: createdBy, lock: true });
        if (parameterKey != null && currentParameters.source_key !== parameterKey) throw Object.assign(new Error('Linked manual or automation test parameters changed while the agent was building. Existing instructions were retained; retry with the current parameters.'), { statusCode: 409, code: 'AUTOMATION_PARAMETERS_CHANGED' });
        if(inputContext){
          const currentInputs=await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase:currentCase,projectId:build.project_id,userId:createdBy,caseValues:currentParameters.runtime_parameter_values,privateParameterNames:currentParameters.private_parameter_names,parameterOverrides:currentParameters.parameter_overrides,...inputContext.selection,materialize:false,lock:true});
          if(currentInputs.inputSourceKey!==inputContext.source_key)throw Object.assign(new Error('Selected test data, environment, configuration or case data changed while the agent was building. Existing instructions were retained; review the current inputs before rebuilding.'),{statusCode:409,code:'AUTOMATION_PARAMETERS_CHANGED'});
        }
      }
      current = await db.prepare(stepsSql).all(caseId);
      const fields = ['action', 'expected_result', 'automation_code', 'step_type', 'step_order', 'group_id', 'group_name', 'group_kind', 'reusable_group_id', 'api_request'];
      if (!Array.isArray(baseline) || current.length !== baseline.length || baseline.some(step => {
        const latest = current.find(row => row.id === step.id);
        return !latest || fields.some(key => JSON.stringify(latest[key] ?? null) !== JSON.stringify(step[key] ?? null));
      }) || new Set(build.updates.map(update => update.step.id)).size !== build.updates.length || build.updates.some(update => !current.some(row => row.id === update.step.id))) {
        throw new Error('The case changed while the agent was building. Existing edits were preserved; retry using the latest case.');
      }
      if (dataSnapshot) await require('../lib/automationBuildDataSnapshot').persistBuildDataSnapshot({ testCase: currentCase, projectId: build.project_id, userId: createdBy, snapshot: dataSnapshot });
    }

    for (const update of build.updates) {
      const latest = current.find(row => row.id === update.step.id);
      if (!latest || ['step_type', 'automation_code', 'api_request'].some(key => JSON.stringify(latest[key] ?? null) !== JSON.stringify(update[key] ?? null))) {
        await testStepService.updateTestStep(update.step.id, {
          step_type: update.step_type,
          automation_code: update.automation_code,
          api_request: update.api_request
        }, { syncSharedGroup: false });
      }
      updated.push({ step_id: update.step.id, step_order: update.step.step_order, step_type: update.step_type,
        has_code: Boolean(update.automation_code), has_api_request: Boolean(update.api_request) });
    }
    if (caseId && updated.length) {
      if (partial) await markTestCaseAutomationIncomplete.run(caseId);
      else await markTestCaseAutomationReady.run(normalizeText(createdBy), caseId);
    }
    let nextState;
    if (caseId && progressiveState) {
      // Both reads are still protected by this transaction's source/target
      // locks. Only our own committed writes become the next save baseline.
      const nextCase = await db.prepare(caseSql).get(caseId);
      const nextParameters = await loadAutomationParameterContext({ testCase: nextCase, projectId: build.project_id, userId: createdBy, lock: true });
      const nextInputs=inputContext?await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase:nextCase,projectId:build.project_id,userId:createdBy,caseValues:nextParameters.runtime_parameter_values,privateParameterNames:nextParameters.private_parameter_names,parameterOverrides:nextParameters.parameter_overrides,...inputContext.selection,materialize:false,lock:true}):null;
      nextState = { steps: JSON.parse(JSON.stringify(await db.prepare(stepsSql).all(caseId))),
        parameter_context_key: nextParameters.source_key, input_context:inputContext?{...inputContext,source_key:nextInputs.inputSourceKey}:undefined, data_snapshot: null };
    }
    return { updated, nextState };
  })();
  // A failed transaction or COMMIT must never advance the in-memory baseline.
  if (progressiveState && committed.nextState) Object.assign(progressiveState, committed.nextState);
  return committed.updated;
};

const buildCaseCore = async ({
  test_case_id,
  integration_id,
  ai_feature,
  created_by,
  start_url,
  start_url_review,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver = "mcp",
  verification_driver = "native",
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_suite_id,
  parameter_values,
  parameter_plan_key,
  captured_actions = [],
  captured_network = [],
  additional_context,
  agent_context,
  execution_guard,
  transaction_id
}) => {
  const pipelineOptions=require("../lib/automationBuildPipelineOptions").normalizeBuildPipelineOptions({verification_mode,browser_driver,verification_driver,allow_browser_actions});
  await execution_guard?.ensureOwnership();
  let testCase = await selectCaseWithScope.get(test_case_id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const access = await getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["automation.ai", "automation.build"]);
  if (!access["automation.ai"] || !access["automation.build"]) throw Object.assign(new Error("Automation AI is disabled or your build permission is no longer available."), { statusCode: 403 });

  if(pipelineOptions.verification_mode!=="generate_only"){
    const runAccess=await getOptionalEvidenceAccess({id:created_by},testCase.project_id,["automation.run.local","run.create"]);
    if(!runAccess["automation.run.local"]||!runAccess["run.create"])throw Object.assign(new Error("Isolated verification requires local automation execution and run creation permissions."),{statusCode:403,code:"AUTOMATION_VERIFICATION_ACCESS_REQUIRED"});
  }
  const resourcePermissions=[...(test_environment_id?["environment.view"]:[]),...(test_configuration_id?["configuration.view"]:[]),...(test_data_set_id?["data.view"]:[]),...(test_suite_id?["suite.view"]:[])];
  const resourceAccess=await getOptionalEvidenceAccess({id:created_by},testCase.project_id,resourcePermissions);
  if(resourcePermissions.some(key=>!resourceAccess[key]))throw Object.assign(new Error("Selected execution context access is no longer available."),{statusCode:403});
  const buildParameterValues=require('../lib/automationBuildParameterPlan').buildParameterValues(parameter_values||{});
  const reviewedParameterState=await require('./automationBuildParameterPlan.service').loadState({testCase,userId:created_by,test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,parameter_values:buildParameterValues,expectedKey:parameter_plan_key});
  test_suite_id ??= reviewedParameterState.plan.test_suite_id;
  let steps = await selectStepsForCase.all(test_case_id);

  if (isMobileAppType(testCase.app_type_kind) || steps.some((step) => ["android", "ios"].includes(step.step_type))) {
    await mobileFeatureService.assertMobileFeatureEnabled();
    const mobileAccess = await getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!mobileAccess["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to build native automation."), { statusCode: 403 });
  }

  const browserBuild=requiresAutomationStartUrl({appTypeKind:testCase.app_type_kind,steps});
  const selectedStartUrl=normalizeAutomationStartUrl(start_url!=null?start_url:testCase.automation_start_url,{required:browserBuild});
  const preparedTarget = await automationCasePreparationService.prepareAutomationTarget({ testCaseId: test_case_id, createdBy: created_by, aiGenerated: true, startUrl:selectedStartUrl });
  if (preparedTarget.test_case_id !== test_case_id) {
    test_case_id = preparedTarget.test_case_id;
    testCase = await selectCaseWithScope.get(test_case_id);
    steps = await selectStepsForCase.all(test_case_id);
  }
  const reviewedNavigation = await require('../lib/automationBuildStartUrl').resolveBuildStartUrl({testCase,steps,startUrl:selectedStartUrl,userId:created_by,startUrlReview:start_url_review});
  testCase=await selectCaseWithScope.get(test_case_id);
  if((testCase.automation_start_url||null)!==reviewedNavigation.savedStartUrl)throw Object.assign(new Error('Start URL changed before generation started. Submit a new build with the current target.'),{statusCode:409,code:'AUTOMATION_START_URL_CHANGED'});
  const needsFlowPlanning=!steps.length;
  if(needsFlowPlanning)require('../lib/automationFlowPlanning').assertFlowPlanningFeature(buildFeature(ai_feature));
  const flowBrief=normalizeRichText(additional_context)||normalizeRichText(testCase.description);
  if(needsFlowPlanning&&!flowBrief)throw Object.assign(new Error('Describe the intended flow and expected outcome in Agent brief before building an empty automation case.'),{code:'AUTOMATION_FLOW_BRIEF_REQUIRED',statusCode:422,nonRetryable:true});
  await require('./automationBuildTargets.service').registerTarget(transaction_id,test_case_id);
  const progress=async event=>{await execution_guard?.ensureOwnership();return require('./automationAgentActivity.service').recordProgress(transaction_id,{...event,details:{test_case_id,...event.details},metadata:{current_phase:event.phase,phase_message:event.message}});};
  const progressionPolicy=allow_browser_actions===true&&browserBuild?'performed_generated_saved':'generated_saved';
  await progress({phase:'automation.agent.plan',message:needsFlowPlanning?'Preparing a manual flow from the agent brief.':`Queued ${steps.length} saved sections for generation.`,details:{progression_policy:progressionPolicy,flow_source:needsFlowPlanning?'agent_brief':'saved_sections',steps:steps.map(step=>({step_id:step.id,step_order:step.step_order,step_type:step.step_type,action:step.action,expected_result:step.expected_result})),manual_steps:[]}});

  const cacheRows = scopeRepositoryToTarget(await listLearningCacheRows({
    projectId: testCase.project_id || null,
    appTypeId: testCase.app_type_id || null,
    limit: MAX_CACHE_ROWS
  }),browserBuild?selectedStartUrl:null);
  const contextSelection = normalizeAgentContext(agent_context);
  const featureProfile=await require("@hellotest/platform/backend/services/aiConfiguration.service").resolve(buildFeature(ai_feature));
  const featureConfiguration=featureProfile.config;
  const contextPolicy=featureConfiguration.context;
  const knowledgeRows = await retrieveAgentContext({testCase,userId:created_by,selection:contextSelection,prompt:additional_context,policy:contextPolicy,signal:execution_guard?.signal});
  if(!test_data_set_id && (await getOptionalEvidenceAccess({id:created_by},testCase.project_id,["data.view"]))["data.view"]) {
    test_data_set_id=(await db.prepare("SELECT test_data_set_id FROM test_case_data_sets WHERE test_case_id = ? ORDER BY sort_order, test_data_set_id LIMIT 1").get(test_case_id))?.test_data_set_id;
  }
  const capturedActions = normalizeCapturedActions(captured_actions);
  const capturedNetwork = normalizeCapturedNetwork(captured_network);
  const buildContext = await resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  buildContext.linked_manual_cases = await loadAutomationManualContext({caseId:test_case_id,projectId:testCase.project_id,userId:created_by});
  const manualLinkIds=(await db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ? ORDER BY manual_test_case_id').all(test_case_id)).map(row=>row.manual_test_case_id);
  buildContext.story_context = contextPolicy.mode !== "none" && contextSelection.context_scopes.includes("stories") ? await loadAutomationStoryContext({ caseId: test_case_id, projectId: testCase.project_id, userId: created_by }) : {stories:[],related_stories:[]};
  buildContext.retrieval = {transport:knowledgeRows.context_transport,scopes:contextSelection.context_scopes,limitations:knowledgeRows.limitations,coverage:knowledgeRows.coverage,reviewed_context:knowledgeRows.reviewed_context,supplemental_limitations:knowledgeRows.supplemental_limitations};
  buildContext.case_metadata = {id:testCase.id,title:testCase.title,description:testCase.description,authoring_mode:testCase.authoring_mode,gherkin_document:testCase.gherkin_document,preconditions:testCase.preconditions,priority:testCase.priority,labels:safeJson(testCase.labels,[])};
  let navigation = resolveAutomationStartUrl({startUrl:selectedStartUrl,caseUrl:testCase.automation_start_url,environmentUrl:buildContext.environment?.base_url,steps,required:browserBuild});
  let startUrl = navigation.url;
  buildContext.browser_policy={transport:'playwright_mcp',interaction_mode:startUrl?(allow_browser_actions===true?'interactive':'read_only'):'not_configured',entry_url:startUrl,entry_origin:startUrl?new URL(startUrl).origin:null,target_source:navigation.source,entry_url_is_authoritative:browserBuild,verification_status:'unverified'};
  let integration = null;
  let fallbackReason = null;
  let build = null;

  await appendEvent(transaction_id, {
    phase: "automation.context",
    message: `Packed ${steps.length} manual step${steps.length === 1 ? "" : "s"} with ${cacheRows.length} cached locator learning item${cacheRows.length === 1 ? "" : "s"} and ${Array.isArray(knowledgeRows?.knowledge) ? knowledgeRows.knowledge.length : 0} active knowledge item${Array.isArray(knowledgeRows?.knowledge) && knowledgeRows.knowledge.length === 1 ? "" : "s"}.`,
    details: {
      test_case_id,
      step_count: steps.length,
      cache_hits: cacheRows.length,
      knowledge_items: Array.isArray(knowledgeRows?.knowledge) ? knowledgeRows.knowledge.length : 0,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null,
      browser_entry_source:navigation.source,browser_entry_step_id:navigation.step_id||null,
      browser_interaction_mode:buildContext.browser_policy.interaction_mode
    }
  });

  try {
    integration = await resolveLlmIntegration(integration_id, {
      userId: created_by,
      projectId: testCase.project_id,
      usageKey: buildFeature(ai_feature)
    });
  } catch (error) {
    throw error;
  }

  if (!integration) throw new Error("No active LLM integration is configured. Select a model and retry the automation build.");
  const parameterContext=await loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by});
  const browserParameters=await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase,projectId:testCase.project_id,userId:created_by,caseValues:parameterContext.runtime_parameter_values,privateParameterNames:parameterContext.private_parameter_names,parameterOverrides:parameterContext.parameter_overrides,steps:[...steps,...buildContext.linked_manual_cases.flatMap(item=>item.steps)],test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,buildParameterValues,defaultMissingInputs:true});
  if(reviewedParameterState&&reviewedParameterState.inputSourceKey!==browserParameters.inputSourceKey)throw Object.assign(new Error('Reviewed build parameters changed before generation started. Review the current inputs before rebuilding.'),{statusCode:409,code:'AUTOMATION_PARAMETER_PLAN_CHANGED',nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
  if(reviewedParameterState){
    const plans=require('../lib/automationBuildParameterPlan');
    if(reviewedParameterState.plan.resolved_test_case_id===testCase.id){
      const reviewedCase=reviewedParameterState.dataAccess?testCase:{id:testCase.id,app_type_id:testCase.app_type_id,project_id:testCase.project_id};
      plans.assertParameterPlanKey(reviewedParameterState.plan.parameter_plan_key,plans.parameterPlanKey({testCase:reviewedCase,steps,manualCases:buildContext.linked_manual_cases,parameterSourceKey:parameterContext.source_key,inputSourceKey:browserParameters.inputSourceKey}));
    }else{
      const linkedSource=buildContext.linked_manual_cases.find(item=>item.id===reviewedParameterState.plan.resolved_test_case_id);
      const goals=source=>JSON.stringify(source.map(({id,step_order,action,expected_result,step_type})=>({id,step_order,action,expected_result,step_type})));
      if(!linkedSource||goals(linkedSource.steps)!==goals(reviewedParameterState.sourceSteps))throw Object.assign(new Error('The reviewed manual steps changed before their automation target was prepared. Review the current inputs before rebuilding.'),{statusCode:409,code:'AUTOMATION_PARAMETER_PLAN_CHANGED',nonRetryable:true,failure_stage:'context',generation_provider_requests:0,browser_actions:0});
    }
  }
  let dataSnapshot=await require('../lib/automationBuildDataSnapshot').prepareBuildDataSnapshot({testCase,projectId:testCase.project_id,userId:created_by,generatedValues:browserParameters.generatedCaseValues,authoredValues:browserParameters.reviewedCaseValues,defaultedValues:browserParameters.defaultedCaseValues,parameterOverrides:parameterContext.parameter_overrides,privateNames:browserParameters.privateParameterNames});
  const inputContext={selection:{test_environment_id,test_configuration_id,test_data_set_id,test_suite_id},source_key:browserParameters.inputSourceKey};
  const progressiveState={steps:structuredClone(steps),parameter_context_key:parameterContext.source_key,input_context:inputContext,data_snapshot:dataSnapshot};
  const buildIdentity={manual_context:buildContext.linked_manual_cases,manual_link_ids:manualLinkIds,parameter_context_key:parameterContext.source_key,input_context:inputContext,data_snapshot:dataSnapshot,project_id:testCase.project_id,app_type_id:testCase.app_type_id,case_start_url:reviewedNavigation.savedStartUrl};
  const promptCase=browserParameters.projectCase(testCase);
  let promptSteps=browserParameters.projectSteps(steps);
  navigation=resolveAutomationStartUrl({startUrl:selectedStartUrl,caseUrl:testCase.automation_start_url,environmentUrl:browserParameters.projectText(buildContext.environment?.base_url),steps:promptSteps,required:browserBuild});
  startUrl=navigation.url;
  buildContext.browser_policy={...buildContext.browser_policy,interaction_mode:startUrl?(allow_browser_actions===true?'interactive':'read_only'):'not_configured',entry_url:startUrl,entry_origin:startUrl?new URL(startUrl).origin:null};
  const promptBuildContext=browserParameters.projectBuildContext(buildContext);
  if(transaction_id)try{
    const artifact=await require('./automationAgentActivity.service').createBuildData(transaction_id,browserParameters.buildData({testCaseId:test_case_id,steps,manualCases:buildContext.linked_manual_cases}));
    await progress({phase:'automation.agent.data',message:'Prepared the linked case data for this build.',details:artifact});
  }catch(error){
    if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
    await appendEvent(transaction_id,{phase:'automation.agent.data.unavailable',level:'warning',message:'The optional resolved-data display could not be stored. Generation continues with the same configured data.'}).catch(()=>{});
  }
  let prompt = buildPrompt({ featureKey:buildFeature(ai_feature), testCase:promptCase, steps:promptSteps, cacheRows, knowledgeRows, capturedActions, capturedNetwork, buildContext:promptBuildContext, startUrl, additionalContext: browserParameters.projectText(normalizeRichText(additional_context)) });
  let browser;
  const browserObservations=[];
  const savedSectionIds=new Set();
  const annotateBuildFailure=error=>{
    error.automation_test_case_id=test_case_id;
    error.source_test_case_id=preparedTarget.source_test_case_id;
    error.saved_step_ids=[...savedSectionIds];
    error.saved_sections=savedSectionIds.size;
    if(completionActiveStepId){error.active_step_id=completionActiveStepId;error.active_manual_step_ids=completionActiveManualStepIds;}
    // Requeueing the whole case after a provider/storage failure could repeat
    // an already performed submission. A new user-reviewed build is separate.
    if(browserObservations.some(item=>['browser_click','browser_fill','browser_press_key','browser_select_option','browser_check','browser_uncheck','browser_hover'].includes(item.tool)&&!item.result?.isError))error.nonRetryable=true;
    return error;
  };
  const generationEvidence=new Map();
  const generationModelCalls=new Map();
  let generationRequested=false;
  let completionAttempt=1;
  let completionActiveStepId=null;
  let completionActiveManualStepIds=[];
  let completionSectionAttempt=null;
  let completionSectionIds=[];
  const generationProvenance=new Map();
  const generationContracts=new Map();
  const usedObjectManifests=new Map();
  const usedObjectRowsByAttempt=new Map();
  let confirmedObjectsSaved=0;
  let planningFlow=needsFlowPlanning;
  const caseBudgetMs=Math.max(240_000,Math.min(1_800_000,Number(process.env.AUTOMATION_BUILDER_CASE_TIMEOUT_MS)||Math.max(240_000,steps.length*120_000)));
  const callsPerSection=Math.max(6,Math.min(30,Number(process.env.AUTOMATION_BUILDER_BROWSER_CALLS_PER_SECTION)||12));
  let browserCallBudget=Math.min(400,Math.max(callsPerSection,steps.filter(step=>normalizeTestStepType(step.step_type,'web')==='web').length*callsPerSection));
  const buildStartedAt=Date.now();
  let completionDeadline=buildStartedAt+caseBudgetMs;
  const assertBuildContextAccess=async()=>{
    await execution_guard?.ensureOwnership();
    const permissions=[...new Set(['automation.ai','automation.build',...browserParameters.required_permissions,...(browserParameters.availableParameterNames.length?['data.view']:[])])];
    const access=await getOptionalEvidenceAccess({id:created_by},testCase.project_id,permissions);
    if(permissions.some(permission=>!access[permission]))throw Object.assign(new Error('Automation build or test context access changed. Existing instructions were retained.'),{statusCode:403});
  };
  const completeBuild=async(input,remainingMs=LLM_TIMEOUT_MS,traceOptions={})=>{await assertBuildContextAccess();const attempt=completionAttempt;if(!planningFlow&&!generationModelCalls.has(attempt))generationModelCalls.set(attempt,[]);return require("@hellotest/platform/backend/src/utils/llmTraceContext").run({project_id:testCase.project_id,actor_id:created_by,session_id:transaction_id,completion_attempt:attempt,test_case_id,generation_scope:traceOptions.generationScope||(planningFlow?'flow_plan':completionActiveStepId?'section_attempt':'case_attempt'),generation_section_ids:completionSectionIds,section_attempt:completionSectionAttempt,
    on_llm_trace:transaction_id?record=>{
      // Bind previews to the actual response being consumed, before the optional
      // event sink. One case-level response can develop several sections.
      if(!planningFlow&&record.status==="succeeded"&&record.dispatched&&typeof record.call_id==="string")generationModelCalls.set(attempt,[...new Set([...(generationModelCalls.get(attempt)||[]),record.call_id])]);
      return appendEvent(transaction_id,require("@hellotest/platform/backend/src/utils/agentModelTrace").modelTraceEvent(record,{name:"Automation engineer",caseId:test_case_id}));
    }:undefined,
    automation_case_generation:true,automation_actor_phase:traceOptions.browserActor===true,automation_browser_loop:Boolean(browser)||planningFlow,mcp_context_depth:1,mcp_context:knowledgeRows.knowledge.length?"retrieved":knowledgeRows.context_transport === "not_required"?"not_required":"unavailable"},()=>{generationRequested=true;return requestChatCompletion({integration,featureKey:buildFeature(ai_feature),prompt:input,signal:execution_guard?.signal,timeoutMs:Math.min(LLM_TIMEOUT_MS,remainingMs),maxAttempts:traceOptions.generationScope==='verification_repair'?1:undefined,beforeDispatch:assertBuildContextAccess,activeGoal:traceOptions.browserActor===true?promptSteps.find(step=>step.id===completionActiveStepId):undefined,onCapacityWait:details=>progress({phase:'automation.agent.model.capacity.wait',message:'The model provider requested a short wait. Retaining the current browser and completed actions before retrying the rejected request.',details:{...details,active_step_id:completionActiveStepId}})});} );};
  try {
    if(allow_browser_actions===true&&browserBuild&&!needsFlowPlanning){
      try {
        const resumed=await require('./automationUsedObjects.service').resume({testCase,userId:created_by,assertAccess:assertBuildContextAccess,executionGuard:execution_guard});
        confirmedObjectsSaved+=resumed.synced||0;
      } catch(error) {
        if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
        await progress({phase:'automation.agent.objects.pending',level:'warning',message:'Previously confirmed object bindings remain pending. Browser work will not be replayed to synchronize objects.',details:{error_code:error.code||'AUTOMATION_OBJECT_SYNC_UNAVAILABLE'}});
      }
      try{require('../lib/automationBuildInputPreflight').assertBuildInputs(steps,browserParameters);}
      catch(error){completionActiveStepId=error.active_step_id;await progress({phase:'automation.agent.dependencies',level:'warning',message:error.message,details:{blocked_steps:error.blocked_steps,active_step_id:error.active_step_id,generation_provider_requests:0,browser_actions:0}});throw error;}
    }
    if (startUrl && (needsFlowPlanning&&browserBuild||steps.some((step) => normalizeTestStepType(step.step_type, "web") === "web"))) {
      const engine = await resolveTestEngineIntegration(testCase);
      browser = await connectAutomationBrowser({ integration: engine, startUrl, allowBrowserActions: allow_browser_actions === true, signal:execution_guard?.signal });
      const callBrowser=browser.call;
      // Tool values resolve only when the complete argument is a parameter
      // reference. Already-rendered prose and token-looking literals retain
      // their exact meaning while private material remains projected.
      browser.projectPromptText=value=>require('../lib/automationBrowserParameters').referenceKey(value)?browserParameters.projectText(value):browserParameters.projectPrivateText(value);
      browser.projectPrivateText=browserParameters.projectPrivateText;
      browser.canonicalizeParameterArguments=browserParameters.canonicalArguments;
      browser.call=async(name,args)=>{
        // Materialized public inputs can also be literal model tool arguments.
        // Recheck their source access even when no parameter token remains.
        await assertBuildContextAccess();
        try{return browserParameters.redactResult(await callBrowser(name,browserParameters.resolve(name,args)));}catch(error){throw browserParameters.redactError(error);}
      };
    } else {
      await appendEvent(transaction_id, { phase: "automation.agent.context", message: "Generating from the supplied case and repository context. No live web inspection was requested." });
    }
    if(needsFlowPlanning){
      const allowedTypes=testCase.app_type_kind==='unified'?['web','api','android','ios']:[normalizeTestStepType(testCase.app_type_kind,'web')];
      const flowPlanning=require('../lib/automationFlowPlanning');
      const planningCase={...promptCase};
      for(const field of ['title','description','gherkin_document','preconditions'])if(typeof testCase[field]==='string')planningCase[field]=flowPlanning.projectFlowPlanningBrief(testCase[field],browserParameters);
      const draftFlow=await flowPlanning.planAutomationFlow({featureKey:buildFeature(ai_feature),allowedTypes,browser,startUrl,complete:completeBuild,parse:extractJsonPayload,observations:browserObservations,deadlineMs:completionDeadline,onProgress:progress,
        requiredParameterNames:browserParameters.referencedParameterNames([{action:flowBrief,expected_result:''}]),referencedParameterNames:browserParameters.referencedParameterNames,
        context:require('../lib/automationActorPrompt').projectAutomationActorTask({user_request:flowPlanning.projectFlowPlanningBrief(flowBrief,browserParameters),case:planningCase,build_context:promptBuildContext,repository:summarizeCache(cacheRows),knowledge:summarizeKnowledge(knowledgeRows.knowledge)}),
        onObservation:async observation=>{
          await assertBuildContextAccess();browserObservations.push(observation);
          try{const evidence=await require('./automationAgentActivity.service').createBrowserEvidence(transaction_id,{observation,testCaseId:test_case_id,attempt:1,interactionMode:'read_only'});if(evidence)await progress({phase:'automation.agent.observation',message:'Read application evidence for the proposed manual flow.',details:evidence});}
          catch(error){if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;}
        }});
      try{steps=await require('./automationFlowPlan.service').saveFlowPlan({testCase,steps:draftFlow,userId:created_by,executionGuard:execution_guard,assertSources:async()=>{
        const currentManual=await loadAutomationManualContext({caseId:test_case_id,projectId:testCase.project_id,userId:created_by,lock:true});
        const currentParameters=await loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by,lock:true});
        if(manualContextKey(currentManual)!==manualContextKey(buildContext.linked_manual_cases)||currentParameters.source_key!==parameterContext.source_key)throw Object.assign(new Error('Linked case context or test parameters changed while the manual flow was being planned.'),{code:'AUTOMATION_FLOW_BASELINE_CHANGED',statusCode:409,nonRetryable:true});
      }});}catch(error){error.automation_stage='save';throw error;}
      const firstWebSection=steps.find(step=>normalizeTestStepType(step.step_type,'web')==='web');
      const adoptedNavigation=firstWebSection?require('../lib/automationBrowserRecording').adoptPlanningNavigation(browserObservations,firstWebSection.id):0;
      if(adoptedNavigation)await progress({phase:'automation.agent.flow.navigation.reused',message:'Retained confirmed planning navigation as the first browser section’s setup. No browser action was replayed.',details:{active_step_id:firstWebSection.id,confirmed_navigation_count:adoptedNavigation,evidence_source:'protected_planning_operations'}});
      browserParameters.registerStepReferences?.(steps);
      promptSteps=browserParameters.projectSteps(steps);
      dataSnapshot=await require('../lib/automationBuildDataSnapshot').prepareBuildDataSnapshot({testCase,projectId:testCase.project_id,userId:created_by,generatedValues:browserParameters.generatedCaseValues,authoredValues:browserParameters.reviewedCaseValues,defaultedValues:browserParameters.defaultedCaseValues,parameterOverrides:parameterContext.parameter_overrides,privateNames:browserParameters.privateParameterNames});
      Object.assign(progressiveState,{steps:structuredClone(steps),data_snapshot:dataSnapshot});buildIdentity.data_snapshot=dataSnapshot;
      prompt=buildPrompt({featureKey:buildFeature(ai_feature),testCase:promptCase,steps:promptSteps,cacheRows,knowledgeRows,capturedActions,capturedNetwork,buildContext:promptBuildContext,startUrl,additionalContext:browserParameters.projectText(normalizeRichText(additional_context))});
      browserCallBudget=Math.min(400,Math.max(callsPerSection,steps.filter(step=>step.step_type==='web').length*callsPerSection));
      if(!process.env.AUTOMATION_BUILDER_CASE_TIMEOUT_MS)completionDeadline=buildStartedAt+Math.min(1_800_000,Math.max(caseBudgetMs,steps.length*120_000));
      planningFlow=false;
      if(transaction_id)try{const artifact=await require('./automationAgentActivity.service').createBuildData(transaction_id,browserParameters.buildData({testCaseId:test_case_id,steps,manualCases:buildContext.linked_manual_cases}));await progress({phase:'automation.agent.data',message:'Prepared the same fixed test data for the newly planned sections.',details:artifact});}
      catch(error){if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;await appendEvent(transaction_id,{phase:'automation.agent.data.unavailable',level:'warning',message:'The optional planned-data display could not be stored. Generation continues with the same fixed values.'}).catch(()=>{});}
      await progress({phase:'automation.agent.flow.planned',message:`Prepared ${steps.length} draft manual actions. Each will be performed, generated and saved in order.`,details:{flow_source:'agent_brief',total_sections:steps.length,verification_status:'unverified'}});
    }
    build = await completeAutomationBuild({steps,manualSteps:buildContext.linked_manual_cases.flatMap(item=>item.steps.map(step=>({...step,test_case_id:item.id}))),displaySteps:promptSteps,displayManualSteps:promptBuildContext.linked_manual_cases.flatMap(item=>item.steps.map(step=>({...step,test_case_id:item.id}))),sequential:browserBuild||buildContext.linked_manual_cases.length>0,progressionPolicy,availableParameters:browserParameters.availableParameterNames,feedbackInstruction:aiInstructionBlock(buildFeature(ai_feature),"automationBuild.completionFeedback"),
      validate:(payload,requiredSteps)=>normalizeLlmBuild(payload,requiredSteps,cacheRows,startUrl,{origins:buildNavigationOrigins({startUrl,additionalContext:additional_context,observations:browserObservations}),parameters:browserParameters.promptValues,resolveText:browserParameters.projectText,
        resolveAssertionParameter:key=>browserParameters.resolve('browser_assert',{value:require('../lib/automationBrowserParameters').parameterReference(key)}).value}),
      validateOutcome:payload=>require('@hellotest/platform/backend/src/utils/aiFeatureRuntime').validateValue(payload,featureProfile),
      onProgress:async event=>{await execution_guard?.ensureOwnership();return progress(event);},
      onBeforeSaveSection:async({step,normalized,attempt})=>{
        await execution_guard?.ensureOwnership();
        const recordedContract=generationContracts.get(attempt);
        if(!recordedContract)return;
        const update=normalized.updates.find(item=>item.step.id===step.id);
        const manualSpecification=buildContext.linked_manual_cases.flatMap(item=>item.steps.map(source=>({...source,manual_test_case_id:item.id,manual_step_id:source.id})));
        require('../lib/automationRecordedContract').recordedContractMetadata(recordedContract,{stepId:step.id,source:update.automation_code,section:step,manualSpecification});
        const manifest=await require('./automationUsedObjects.service').stage({testCase,step,source:update.automation_code,sourceContext:{caseStartUrl:buildIdentity.case_start_url,steps:progressiveState.steps},seal:recordedContract,manualSpecification,browserObservations,transactionId:transaction_id,userId:created_by,assertAccess:assertBuildContextAccess,executionGuard:execution_guard});
        if(manifest)usedObjectManifests.set(attempt,manifest);
      },
      onSaveSection:async({step,normalized,attempt})=>{
        try {
          await assertBuildContextAccess();
          await applyBuild({build:{...normalized,...buildIdentity},executionGuard:execution_guard,createdBy:created_by,progressiveState,partial:true});
          savedSectionIds.add(step.id);
          const receipt={instruction_status:'saved',development_status:'completed',saved_at:new Date().toISOString()};
          const manifest=usedObjectManifests.get(attempt);
          if(manifest){
            try {
              const objects=await require('./automationUsedObjects.service').sync({artifactId:manifest.artifact_id,testCase,userId:created_by,assertAccess:assertBuildContextAccess,executionGuard:execution_guard});
              receipt.object_status=objects.status;receipt.objects_saved=objects.status==='synced'?objects.object_count:0;
              confirmedObjectsSaved+=receipt.objects_saved;
              if(objects.status==='synced'&&Array.isArray(objects.repository_rows))usedObjectRowsByAttempt.set(attempt,objects.repository_rows);
              await progress({phase:'automation.agent.objects.saved',level:objects.status==='synced'?'info':'warning',message:objects.status==='synced'?'Saved the repository objects actually used by this section.':'Instructions are saved; confirmed object bindings remain pending synchronization.',details:{active_step_id:step.id,object_status:objects.status,objects_saved:receipt.objects_saved,error_code:objects.error_code}});
            } catch(error) {
              if(error.code==='AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED')await assertBuildContextAccess();
              else if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
              receipt.object_status='pending';receipt.objects_saved=0;
              await progress({phase:'automation.agent.objects.pending',level:'warning',message:'Instructions are saved. Their confirmed objects remain queued for synchronization; no browser action needs to run again.',details:{active_step_id:step.id,error_code:error.code||'AUTOMATION_OBJECT_SYNC_UNAVAILABLE'}}).catch(()=>{});
            }
          }
          try{await progress({phase:'automation.agent.section.saved',message:`Saved section ${step.step_order} instructions to Plan. The case remains incomplete until every section is finished.`,details:{...receipt,attempt,step_id:step.id,step_ids:[step.id],verification_status:'unverified'}});}
          catch(error){if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;}
          return receipt;
        } catch(error) { error.automation_stage='save'; throw error; }
      },
      onValidatedSection:async({step,normalized,attempt,manualCoverage})=>{
        await execution_guard?.ensureOwnership();
        const update=normalized.updates.find(item=>item.step.id===step.id);
        const recordedContract=generationContracts.get(attempt);
        const manualSpecification=buildContext.linked_manual_cases.flatMap(item=>item.steps.map(source=>({...source,manual_test_case_id:item.id,manual_step_id:source.id})));
        const previewRows=[...new Map([...cacheRows,...(usedObjectRowsByAttempt.get(attempt)||[])].map(row=>[row.id,row])).values()];
        return require('./automationAgentActivity.service').createSectionPreview(transaction_id,{testCaseId:test_case_id,step,update,attempt,manualCoverage,repositoryRows:previewRows,confirmedRepositoryIds:(usedObjectRowsByAttempt.get(attempt)||[]).map(row=>row.id),evidence:generationEvidence.get(attempt),modelCallIds:generationModelCalls.get(attempt)||[],modelCallScope:completionActiveStepId?'section_attempt':'case_attempt',generationProvenance:generationProvenance.get(attempt),recordedContract,manualSpecification});
      },
      generate:async({attempt,sectionAttempt,activeStepId,activeManualStepIds=[],completionOnly=false,feedback,feedbackInstruction,onPartial})=>{
        completionAttempt=attempt;
        completionActiveStepId=activeStepId||null;
        completionActiveManualStepIds=activeManualStepIds;
        completionSectionAttempt=sectionAttempt||null;
        completionSectionIds=(feedback.required_sections||[]).map(step=>step.step_id);
        if(Date.now()>=completionDeadline)throw Object.assign(new Error("Automation agent reached its completion deadline. Existing instructions were retained."),{code:"AUTOMATION_BUILD_DEADLINE",statusCode:422});
        if(completionOnly||!(feedback.required_sections||[]).length){
          // Coverage and final metadata repair cannot reopen an already saved
          // browser section or replay its actions. The completion helper owns
          // the immutable accepted instructions and validates every mapping.
          const metadataPrompt=[aiInstructionBlock(buildFeature(ai_feature),'automationBuild.metadataCompletion'),feedbackInstruction,
            JSON.stringify({phase:'metadata_completion',case:{id:promptCase.id,title:promptCase.title},feedback})].filter(Boolean).join('\n\n');
          return completeBuild(metadataPrompt,completionDeadline-Date.now(),{generationScope:'case_metadata'});
        }
        const requestedSectionIds=new Set((feedback.required_sections||[]).map(step=>step.step_id));
        const currentSection=promptSteps.find(step=>step.id===activeStepId);
        const interactiveActor=Boolean(browser&&allow_browser_actions===true&&normalizeTestStepType(currentSection?.step_type,'web')==='web');
        const obligations=interactiveActor?require('../lib/automationGoalObligations').buildAutomationGoalObligations({section:currentSection,manualCases:promptBuildContext.linked_manual_cases,activeManualStepIds,requiredManualSteps:feedback.required_manual_steps}):undefined;
        const sourceObligations=interactiveActor?require('../lib/automationGoalObligations').goalSourceObligations({section:steps.find(step=>step.id===activeStepId),manualCases:buildContext.linked_manual_cases,obligations}):undefined;
        const navigationParameterReferences=interactiveActor?browserParameters.referencedParameterNames(sourceObligations):undefined;
        if(interactiveActor)require('../lib/automationBuildInputPreflight').assertCurrentBuildInputs({stepId:activeStepId,parameterReferences:navigationParameterReferences},browserParameters);
        generationProvenance.set(attempt,{source_origin:interactiveActor?'unknown':'model_generated',compiler:interactiveActor?'unknown':'normalized_runtime_v1',review_status:'not_performed'});
        const obligationParameterBindings=interactiveActor?require('../lib/automationParameterBindings').buildAutomationParameterBindings({obligations:sourceObligations,referencedParameterNames:browserParameters.referencedParameterNames}):undefined;
        const inputParameterBinding=interactiveActor?require('../lib/automationInputParameterBinding').createAutomationInputParameterBinding({stepId:activeStepId,obligations:sourceObligations,bindings:obligationParameterBindings,
          parameterValues:browserParameters.promptValues,privateParameterNames:browserParameters.privateParameterNames}):null;
        const retainedAssertionContract=interactiveActor?require('../lib/automationRetainedAssertions').createRetainedAssertionContract({step:steps.find(step=>step.id===activeStepId)}):undefined;
        const caseJourney=interactiveActor?require('../lib/automationCaseJourney').createAutomationCaseJourney({testCase,steps,activeStepId,completedStepIds:[...savedSectionIds].filter(id=>steps.findIndex(step=>step.id===id)<steps.findIndex(step=>step.id===activeStepId)),projectText:browserParameters.projectPrivateText}):undefined;
        const taskContext=interactiveActor
          ?require('../lib/automationActorContext').createAutomationActorContext({canonicalGoals:true,projectText:browserParameters.projectPrivateText,obligations,
            parameterBindings:obligationParameterBindings,caseJourney,task:{start_url:startUrl,case:promptCase,current_section:currentSection,
            user_request:browserParameters.projectText(normalizeRichText(additional_context)),build_context:{...promptBuildContext,generation_scope:{mode:'sequential',active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds}},
            repository:summarizeCache(cacheRows),knowledge:summarizeKnowledge(knowledgeRows.knowledge),captured_actions:capturedActions,captured_network:capturedNetwork}})
          :null;
        if(taskContext)await progress({phase:'automation.agent.context.packed',message:'Selected the current manual requirements and retained additional authorized context for bounded lookup.',details:{active_step_id:activeStepId,...taskContext.measurements}});
        const requestPrompt=taskContext?taskContext.prompt:feedback.generation_mode==='sequential'
          ?buildPrompt({featureKey:buildFeature(ai_feature),testCase:promptCase,steps:promptSteps.filter(step=>requestedSectionIds.has(step.id)),cacheRows,knowledgeRows,capturedActions,capturedNetwork,
            buildContext:{...promptBuildContext,generation_scope:{mode:'sequential',active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds}},startUrl,additionalContext:browserParameters.projectText(normalizeRichText(additional_context))})
          :prompt;
        const attemptPrompt=[requestPrompt,interactiveActor?'':feedbackInstruction,JSON.stringify(interactiveActor?require('../lib/automationActorPrompt').projectAutomationActorFeedback(feedback):feedback)].filter(Boolean).join("\n\n");
        if(!browser)return completeBuild(attemptPrompt,completionDeadline-Date.now());
        return runAutomationBrowserAgent({featureKey:buildFeature(ai_feature),prompt:attemptPrompt,browser,startUrl:attempt===1&&!needsFlowPlanning?startUrl:undefined,complete:completeBuild,parse:extractJsonPayload,generationMode:feedback.generation_mode,
          execution:{required:allow_browser_actions===true&&normalizeTestStepType(currentSection?.step_type,'web')==='web',step_id:activeStepId,action:currentSection?.action||'',expected_result:currentSection?.expected_result||'',
            retained_assertion_contract:retainedAssertionContract,
            case_journey:caseJourney,
            semantic_review_required:interactiveActor,obligations,source_obligations:sourceObligations,navigation_parameter_references:navigationParameterReferences,
            future_actions:interactiveActor?steps.slice(steps.findIndex(step=>step.id===activeStepId)+1).filter(step=>normalizeTestStepType(step.step_type,'web')==='web').slice(0,200).map(step=>({step_id:step.id,action:step.action||''})):undefined},actorMode:interactiveActor,
          onPartialBuild:onPartial,onRecordedContract:seal=>{generationContracts.set(attempt,seal);},taskContext,inputParameterBinding,
          deadlineMs:completionDeadline,initialObservations:browserObservations,maxCalls:Math.min(callsPerSection,remainingBrowserCalls(browserObservations,browserCallBudget)),onObservation:async observation=>{
            await execution_guard?.ensureOwnership();
            browserObservations.push(observation);
            if(!transaction_id)return;
            try{
              const evidence=await require('./automationAgentActivity.service').createBrowserEvidence(transaction_id,{observation,testCaseId:test_case_id,attempt,active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds,interactionMode:buildContext.browser_policy.interaction_mode});
              if(!evidence)return;
              generationEvidence.set(attempt,{...generationEvidence.get(attempt),...evidence});
              await progress({phase:'automation.agent.observation',message:'Captured application evidence from Playwright MCP. Generated instructions and case execution remain unverified.',details:{...evidence,active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds}});
              if(evidence.screenshot_unavailable)await appendEvent(transaction_id,{phase:'automation.agent.screenshot.unavailable',level:'warning',message:'The optional screenshot was unavailable. Actual accessibility evidence was retained.',details:{test_case_id,attempt}}).catch(()=>{});
              if(evidence.screenshot_artifact_id)await appendEvent(transaction_id,{phase:'automation.agent.screenshot',message:'Optional browser screenshot captured as supporting evidence. Execution remains unverified.',details:{test_case_id,artifact_id:evidence.screenshot_artifact_id,observed_at:evidence.observed_at,attempt}});
            }catch(error){
              if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
              await appendEvent(transaction_id,{phase:'automation.agent.evidence.unavailable',level:'warning',message:'Optional application evidence could not be retained. Generation continues with available browser observations.',details:{test_case_id,attempt}}).catch(()=>{});
            }
          },
          onProgress:event=>{
            if(event.phase==='automation.agent.semantic.accepted')generationProvenance.set(attempt,{...generationProvenance.get(attempt),review_status:'accepted'});
            if(event.phase==='automation.agent.source.compiled')generationProvenance.set(attempt,{...generationProvenance.get(attempt),source_origin:'confirmed_browser_operations',compiler:'recorded_playwright_v1'});
            return progress({...event,details:{...event.details,attempt,active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds}});
          }});
      },parse:value=>typeof value==="string"?extractJsonPayload(value):value});
    Object.assign(build,buildIdentity);
    await appendEvent(transaction_id, { phase: "automation.llm.completed", message: `Generated ${build.updates.length} complete step mappings. Run the case to verify behavior.`, details: { generated_steps: build.updates.length } });
  } catch (error) {
    if(execution_guard?.signal.aborted)throw execution_guard.signal.reason;
    if(error.code==='AUTOMATION_PARAMETER_MISSING'&&completionActiveStepId){
      error.code='AUTOMATION_DEPENDENCY_MISSING';
      error.blocked_steps=[{step_id:completionActiveStepId,dependency_type:'parameter',reason:'A required browser input has no configured value.',required_context:[],required_parameters:error.parameter_reference?[error.parameter_reference]:[]}];
      await progress({level:'warning',phase:'automation.agent.dependencies',message:error.message,details:{blocked_steps:error.blocked_steps,saved_sections:savedSectionIds.size,saved_step_ids:[...savedSectionIds]}});
    }
    annotateBuildFailure(error);
    await require('../lib/automationBrowserDiagnosticArtifact').retainBrowserDiagnostic({error,transactionId:transaction_id,
      assertAccess:assertBuildContextAccess,createArtifact:workspaceTransactionService.createTransactionArtifact,appendEvent});
    const failureProgress=require('../lib/automationBuildFailureProgress').buildFailureProgress(error,{modelStarted:generationRequested||generationModelCalls.size>0});
    error.failure_stage=failureProgress.details.failure_stage;
    await progress(failureProgress);
    throw error;
  } finally { await browser?.close(); }

  let stepUpdates;
  try{await assertBuildContextAccess();stepUpdates=await applyBuild({build,executionGuard:execution_guard,createdBy:created_by,progressiveState});}
  catch(error){if(execution_guard?.signal.aborted)throw execution_guard.signal.reason;error.automation_stage='save';error.failure_stage='save';annotateBuildFailure(error);await progress({phase:'automation.agent.save.failed',level:'error',message:'Final completion could not be saved. Previously saved sections remain in Plan; current edits were preserved.',details:{error_code:error.code||null,failure_stage:'save'}}).catch(()=>{});throw error;}
  const warnings=[];
  const verification = await require('./automationSavedBuildVerification.service').verifySavedBuild({
    options: pipelineOptions, testCase, startUrl, state: progressiveState, activityId: transaction_id,
    parameterResolver: browserParameters, manualLinkIds, manualContext: buildIdentity.manual_context,
    signal: execution_guard?.signal
  }, {
    assertAccess: async () => {
      await assertBuildContextAccess();
      const permissions = await getOptionalEvidenceAccess({id: created_by}, testCase.project_id, ['automation.run.local', 'run.create']);
      if (!permissions['automation.run.local'] || !permissions['run.create']) {
        throw Object.assign(new Error('Verification access changed.'), {statusCode: 403});
      }
    },
    readCase: id => selectCaseWithScope.get(id),
    readSteps: id => selectStepsForCase.all(id),
    readManualLinkIds: async id => (await db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ? ORDER BY manual_test_case_id').all(id)).map(row => row.manual_test_case_id),
    readManualContext: id => loadAutomationManualContext({caseId: id, projectId: testCase.project_id, userId: created_by}),
    manualContextKey,
    readParameters: currentCase => loadAutomationParameterContext({testCase: currentCase, projectId: testCase.project_id, userId: created_by}),
    readInputs: (currentCase, params, selection) => require('../lib/automationBrowserParameters').loadBrowserParameterResolver({
      testCase: currentCase, projectId: testCase.project_id, userId: created_by,
      caseValues: params.runtime_parameter_values, privateParameterNames: params.private_parameter_names,
      parameterOverrides: params.parameter_overrides, ...selection, materialize: false
    }),
    prepareRun: async () => {
      const integration = await resolveTestEngineIntegration(testCase);
      return request => require('../lib/automationVerificationClient').verifyRecordedAutomation({
        integration, request, signal: execution_guard?.signal
      });
    },
    onProgress: summary => progress({phase: 'automation.agent.verification', message: summary.message, details: {verification: summary}}),
    diagnose: async ({sections, failure, snapshot}) => {
      const section = sections.find(row => row.step_id === failure.step_id);
      const packet = {requirement: {step_id: section.step_id, action: section.action, expected_result: section.expected_result}, failed_operation: section.operations[failure.operation_index - 1], failure, snapshot};
      const projected = JSON.parse(browserParameters.redactResult({content: [{type: 'text', text: JSON.stringify(packet)}]}).content[0].text);
      const repairContext = require('../lib/automationVerificationRepairContext').createVerificationRepairContext({requirement: projected.requirement, failedOperation: projected.failed_operation, failure: projected.failure, snapshot: projected.snapshot});
      if (!repairContext.packet.current_snapshot.targets.length) return {};
      const prompt = [aiInstructionBlock(buildFeature(ai_feature), 'automationBrowserAgent.verificationRepair'), JSON.stringify(repairContext.packet)].join('\n\n');
      const response = await completeBuild(prompt, 30_000, {generationScope: 'verification_repair'});
      return repairContext.resolveProposal(extractJsonPayload(response));
    },
    commitRepair: async ({before, after}) => {
      const sources = new Map(after.map(row => [row.step_id, row.automation_code]));
      const repaired = {...build, updates: build.updates.map(update => ({...update, automation_code: sources.get(update.step.id) || update.automation_code}))};
      stepUpdates = await applyBuild({build: repaired, executionGuard: execution_guard, createdBy: created_by, progressiveState});
      const replaced = new Set();
      for (let section = 0; section < before.length; section++) {
        for (let index = 0; index < before[section].operations.length; index++) {
          if (before[section].operations[index].arguments.locator !== after[section].operations[index].arguments.locator) {
            replaced.add(before[section].operations[index].arguments.locator);
          }
        }
      }
      repaired.learned_locators = (repaired.learned_locators || []).filter(row => !replaced.has(row.locator));
      build = repaired;
      return progressiveState;
    }
  });
  let learnedCount=confirmedObjectsSaved;
  try {learnedCount+=await persistLearning({testCase,learnedLocators:allow_browser_actions===true&&browserBuild?[]:build.learned_locators,capturedActions:allow_browser_actions===true&&browserBuild?[]:capturedActions,capturedNetwork,transactionId:transaction_id,integrationId:integration_id});}
  catch {warnings.push("Instructions were saved, but locator learning could not be saved.");}
  let artifact = null;

  if (transaction_id) {
    try {artifact = await workspaceTransactionService.createTransactionArtifact(transaction_id, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-automation.spec.ts`,
      mime_type: "text/typescript; charset=utf-8",
      content: await createArtifactContent({testCase,updates:build.updates,repositoryRows:cacheRows,values:browserParameters.exportParameterValues,sensitiveNames:browserParameters.privateParameterNames,baseURL:startUrl})
    });}catch{warnings.push("Instructions were saved, but the downloadable source artifact could not be created. Source remains available in the case.");}
  }
  for(const message of warnings)await appendEvent(transaction_id,{level:"warning",phase:"automation.agent.saved.warning",message,details:{test_case_id}}).catch(()=>{});

  await progress({
    level: stepUpdates.length ? "success" : "warning",
    phase: "automation.case.updated",
    message: stepUpdates.length
      ? `Associated generated automation with "${testCase.title}".`
      : `No step automation was associated with "${testCase.title}".`,
    details: {
      test_case_id,
      updated_steps: stepUpdates.length,
      step_ids:build.updates.map(update=>update.step.id),
      manual_coverage:build.manual_coverage,
      learned_locator_count: learnedCount,
      artifact_id: artifact?.id || null
    }
  }).catch(()=>{});

  return {
    test_case_id,
    source_test_case_id: preparedTarget.source_test_case_id,
    title: testCase.title,
    automated: stepUpdates.length ? "yes" : testCase.automated || "no",
    automation_status: stepUpdates.length ? "ready" : testCase.automation_status || "not_automated",
    generated_step_count: stepUpdates.length,
    completion_attempts: build.completion_attempts,
    verification_status: verification.status==='passed'?'verified':'unverified',
    verification,
    warnings,
    learned_locator_count: learnedCount,
    cache_hits: cacheRows.length,
    fallback_used: Boolean(fallbackReason),
    fallback_reason: fallbackReason,
    integration: integration
      ? {
          id: integration.id,
          name: integration.name,
          model: integration.model
        }
      : null,
    summary: build.summary,
    artifact_id: artifact?.id || null,
    step_updates: stepUpdates
  };
};

const applyRecorderSteps = async ({ testCase, stepCandidates, recorderMappings = [], createdBy, targetStepId }) => {
  const caseSteps = await selectStepsForCase.all(testCase.id);
  const existingSteps = targetStepId ? caseSteps.filter((step) => step.id === targetStepId) : caseSteps;
  const applied = [];
  let createdCount = 0;

  if (existingSteps.length) {
    const mappings = mergeRecorderMappingGroups(recorderMappings.length
      ? recorderMappings
      : buildFallbackRecorderMappings(existingSteps, stepCandidates));

    for (const mapping of mappings) {
      const automationCode = createRecorderAutomationCode(mapping.candidates);

      if (!automationCode) {
        continue;
      }

      await testStepService.updateTestStep(mapping.step.id, {
        step_type: "web",
        automation_code: automationCode,
        api_request: null
      });
      applied.push({
        step_id: mapping.step.id,
        step_order: mapping.step.step_order,
        step_type: "web",
        action: mapping.step.action || "",
        expected_result: mapping.step.expected_result || "",
        automation_code: automationCode,
        operation: "updated",
        mapping_source: mapping.mapping_source || "fallback",
        mapping_confidence: Number(mapping.confidence || 0) || null,
        source_action_index: mapping.candidates[0]?.source_action_index ?? null,
        source_action_indexes: mapping.candidates.map((candidate) => candidate.source_action_index)
          .filter((index) => index !== null && index !== undefined && index !== "" && Number.isFinite(Number(index))),
        keywords: [...new Set(mapping.candidates.map((candidate) => candidate.keyword).filter(Boolean))],
        has_code: true,
        has_api_request: false
      });
    }

    return applied;
  }

  for (let candidateIndex = 0; candidateIndex < stepCandidates.length; candidateIndex += 1) {
    const candidate = stepCandidates[candidateIndex];
    const stepOrder = createdCount + 1;
    const created = await testStepService.createTestStep({
      test_case_id: testCase.id,
      step_order: stepOrder,
      action: candidate.action,
      expected_result: candidate.expected_result,
      step_type: "web",
      automation_code: candidate.automation_code,
      api_request: null
    });

    applied.push({
      step_id: created.id,
      step_order: stepOrder,
      step_type: "web",
      action: candidate.action,
      expected_result: candidate.expected_result,
      automation_code: candidate.automation_code,
      operation: "created",
      source_action_index: candidate.source_action_index,
      source_action_indexes: [candidate.source_action_index]
        .filter((index) => index !== null && index !== undefined && index !== "" && Number.isFinite(Number(index))),
      keywords: [candidate.keyword].filter(Boolean),
      mapping_source: "created",
      has_code: true,
      has_api_request: false
    });
    createdCount += 1;
  }

  return applied;
};

const finalizeRecorderBuild = async ({
  testCase,
  session,
  createdBy,
  transactionId,
  capturedActions,
  capturedNetwork,
  integrationId,
  additionalContext,
  targetStepId
}) => {
  const repositoryModel = await buildRecorderRepositoryModel({
    testCase,
    capturedActions,
    integrationId,
    userId: createdBy,
    transactionId,
    platform: "web"
  });
  const stepCandidates = buildRecorderStepCandidates(capturedActions, repositoryModel);
  const caseSteps = await selectStepsForCase.all(testCase.id);
  const existingSteps = targetStepId ? caseSteps.filter((step) => step.id === targetStepId) : caseSteps;
  let recorderMappings = [];
  let mappingSource = existingSteps.length ? "fallback" : "created";
  let aiMappingFallbackReason = null;

  await appendEvent(transactionId, {
    phase: "recorder.steps.mapping",
    message: existingSteps.length
      ? `Preparing to map ${stepCandidates.length} recorder interaction${stepCandidates.length === 1 ? "" : "s"} onto ${existingSteps.length} existing manual step${existingSteps.length === 1 ? "" : "s"}.`
      : `Preparing to create manual step rows from ${stepCandidates.length} recorder interaction${stepCandidates.length === 1 ? "" : "s"}.`,
    details: {
      recorder_session_id: session.id,
      manual_step_count: existingSteps.length,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      generated_step_candidates: stepCandidates.length,
      target_step_id: targetStepId || null
    }
  });

  if (existingSteps.length && stepCandidates.length) {
    const aiMappings = await buildAiRecorderMappings({
      testCase,
      manualSteps: existingSteps,
      stepCandidates,
      capturedActions,
      integrationId,
      userId: createdBy,
      additionalContext,
      transactionId
    });

    if (aiMappings.mappings.length) {
      const mappedActionIndexes = new Set(
        aiMappings.mappings.flatMap((group) => group.candidates.map((candidate) => candidate.source_action_index))
      );
      const unmappedCandidates = stepCandidates.filter((candidate) => !mappedActionIndexes.has(candidate.source_action_index));
      const fallbackMappings = unmappedCandidates.length
        ? buildFallbackRecorderMappings(existingSteps, unmappedCandidates)
        : [];

      recorderMappings = mergeRecorderMappingGroups([...aiMappings.mappings, ...fallbackMappings]);
      mappingSource = fallbackMappings.length ? "mixed" : "ai";

      if (fallbackMappings.length) {
        await appendEvent(transactionId, {
          level: "warning",
          phase: "recorder.ai.mapping.partial",
          message: "AI mapped part of the recorder flow; HelloTest mapped the remaining recorded interactions with deterministic flow matching.",
          details: {
            ai_mapped_steps: aiMappings.mappings.length,
            fallback_mapped_steps: fallbackMappings.length,
            fallback_interactions: unmappedCandidates.length
          }
        });
      }
    } else {
      aiMappingFallbackReason = aiMappings.fallback_reason;
      recorderMappings = mergeRecorderMappingGroups(buildFallbackRecorderMappings(existingSteps, stepCandidates));
      await appendEvent(transactionId, {
        level: "warning",
        phase: "recorder.ai.mapping.fallback",
        message: "AI recorder mapping was unavailable, so HelloTest mapped recorded automation to the existing manual steps using deterministic flow matching.",
        details: {
          fallback_reason: aiMappingFallbackReason,
          mapped_steps: recorderMappings.length,
          mapped_interactions: recorderMappings.reduce((total, group) => total + group.candidates.length, 0)
        }
      });
    }
  }

  const appliedSteps = await applyRecorderSteps({
    testCase,
    stepCandidates,
    recorderMappings,
    createdBy,
    targetStepId
  });
  const learnedCount = await persistLearning({
    testCase,
    learnedLocators: [],
    capturedActions,
    capturedNetwork,
    transactionId,
    repositoryModel,
    integrationId
  });
  if (appliedSteps.length) {
    await markTestCaseAutomationReady.run(normalizeText(createdBy), testCase.id);
  }
  const apiCase = null;
  let artifact = null;

  if (transactionId && appliedSteps.length) {
    artifact = await workspaceTransactionService.createTransactionArtifact(transactionId, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-recorder-keywords.spec.ts`,
      mime_type: "text/typescript; charset=utf-8",
      content: await createArtifactContent({
        testCase,
        repositoryRows: await listLearningCacheRows({projectId:testCase.project_id,appTypeId:testCase.app_type_id,limit:MAX_CACHE_ROWS}),
        updates: appliedSteps.map((step) => ({
          step: {
            id: step.step_id,
            step_order: step.step_order,
            action: step.action
          },
          automation_code: step.automation_code,
          api_request: null
        }))
      })
    });
  }

  await appendEvent(transactionId, {
    level: appliedSteps.length ? "success" : "warning",
    phase: "recorder.completed",
    message: appliedSteps.length
      ? existingSteps.length
        ? `Recorder associated automation with ${appliedSteps.length} existing manual step${appliedSteps.length === 1 ? "" : "s"} for "${testCase.title}".`
        : `Recorder created ${appliedSteps.length} web keyword step${appliedSteps.length === 1 ? "" : "s"} for "${testCase.title}".`
      : `Recorder stopped for "${testCase.title}", but no supported interactions were available to create web keyword steps.`,
    details: {
      recorder_session_id: session.id,
      mapping_source: mappingSource,
      ai_mapping_fallback_reason: aiMappingFallbackReason,
      manual_step_count: existingSteps.length,
      updated_steps: appliedSteps.filter((step) => step.operation === "updated").length,
      created_steps: appliedSteps.filter((step) => step.operation === "created").length,
      learned_locator_count: learnedCount,
      api_test_case_id: null,
      api_step_count: 0,
      captured_api_evidence_count: capturedNetwork.length,
      artifact_id: artifact?.id || null
    }
  });

  await updateTransaction(transactionId, {
    status: "completed",
    description: appliedSteps.length
      ? existingSteps.length
        ? `Recorder mapped web keyword automation onto ${appliedSteps.length} existing manual step${appliedSteps.length === 1 ? "" : "s"}.`
        : `Recorder generated web keyword automation for ${appliedSteps.length} step${appliedSteps.length === 1 ? "" : "s"}.`
      : "Recorder stopped without supported interactions to convert.",
    metadata: {
      current_phase: "recorder.completed",
      progress_percent: 100,
      processed_items: appliedSteps.length,
      generated_steps: appliedSteps.length,
      mapped_manual_steps: appliedSteps.filter((step) => step.operation === "updated").length,
      mapping_source: mappingSource,
      ai_mapping_fallback_reason: aiMappingFallbackReason,
      learned_locator_count: learnedCount,
      api_test_case_id: null,
      api_step_count: 0,
      captured_api_evidence_count: capturedNetwork.length,
      artifact_id: artifact?.id || null
    },
    completed_at: new Date().toISOString()
  });

  return {
    test_case_id: testCase.id,
    title: testCase.title,
    automated: appliedSteps.length ? "yes" : testCase.automated || "no",
    automation_status: appliedSteps.length ? (await selectCaseWithScope.get(testCase.id))?.automation_status || "incomplete" : testCase.automation_status || "not_automated",
    generated_step_count: appliedSteps.length,
    created_step_count: appliedSteps.filter((step) => step.operation === "created").length,
    updated_step_count: appliedSteps.filter((step) => step.operation === "updated").length,
    learned_locator_count: learnedCount,
    api_test_case: apiCase,
    cache_hits: 0,
    fallback_used: Boolean(aiMappingFallbackReason),
    fallback_reason: aiMappingFallbackReason,
    integration: null,
    summary: appliedSteps.length
      ? existingSteps.length
        ? "Recorder interactions were mapped onto the existing manual test steps without replacing the manual text."
        : "Recorder interactions were converted into HelloTest web keyword automation steps."
      : "Recorder stopped cleanly, but no supported interactions were captured.",
    artifact_id: artifact?.id || null,
    step_updates: appliedSteps.map(({ automation_code, operation, source_action_index, ...step }) => ({
      ...step,
      operation,
      source_action_index
    }))
  };
};

exports.buildAutomationForCase = async ({
  test_case_id,
  integration_id,
  ai_feature,
  created_by,
  start_url,
  start_url_review,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver = "mcp",
  verification_driver = "native",
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_suite_id,
  parameter_values,
  parameter_plan_key,
  captured_actions,
  captured_network,
  additional_context,
  agent_context,
  execution_guard,
  transaction_id,
  transaction_action,
  transaction_title,
  transaction_description
} = {}) => {
  const selectedFeature = buildFeature(ai_feature);
  const normalizedCaseId = normalizeText(test_case_id);

  if (!normalizedCaseId) {
    throw new Error("test_case_id is required");
  }

  const existingTransactionId = normalizeText(transaction_id);
  const testCase = await selectCaseWithScope.get(normalizedCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const transaction = existingTransactionId
    ? await workspaceTransactionService.updateTransaction(existingTransactionId, {
        project_id: testCase.project_id || null,
        app_type_id: testCase.app_type_id || null,
        category: "automation_build",
        action: normalizeText(transaction_action) || "single_case_automation_build",
        status: "running",
        title: normalizeText(transaction_title) || `AI automation for ${testCase.title}`,
        description: normalizeText(transaction_description) || "Building automation from manual steps, expected results and application context.",
        metadata: {
          agent_activity: true,
          input_test_case_ids: [normalizedCaseId],
          verification_status: "unverified",
          current_phase: "automation.context",
          progress_percent: 10,
          total_items: 1,
          processed_items: 0,
          test_case_id: normalizedCaseId,
          test_environment_id: normalizeText(test_environment_id),
          test_configuration_id: normalizeText(test_configuration_id),
          test_data_set_id: normalizeText(test_data_set_id)
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id: testCase.project_id || null,
        app_type_id: testCase.app_type_id || null,
        category: "automation_build",
        action: normalizeText(transaction_action) || "single_case_automation_build",
        status: "running",
        title: normalizeText(transaction_title) || `AI automation for ${testCase.title}`,
        description: normalizeText(transaction_description) || "Building automation from manual steps, expected results and application context.",
        metadata: {
          agent_activity: true,
          input_test_case_ids: [normalizedCaseId],
          verification_status: "unverified",
          current_phase: "automation.context",
          progress_percent: 10,
          total_items: 1,
          processed_items: 0,
          test_case_id: normalizedCaseId,
          test_environment_id: normalizeText(test_environment_id),
          test_configuration_id: normalizeText(test_configuration_id),
          test_data_set_id: normalizeText(test_data_set_id)
        },
        related_kind: "test_case",
        related_id: normalizedCaseId,
        created_by,
        started_at: new Date().toISOString()
      });

  try {
    const result = await buildCaseCore({
      test_case_id: normalizedCaseId,
      integration_id,
      ai_feature: selectedFeature,
      execution_guard,
      created_by,
      start_url,
      start_url_review,
      allow_browser_actions,
      verification_mode, browser_driver, verification_driver,
      test_environment_id,
      test_configuration_id,
      test_data_set_id,
      test_suite_id,
      parameter_values,
      parameter_plan_key,
      captured_actions,
      captured_network,
      additional_context,
  agent_context,
      transaction_id: transaction.id
    });

    if (!result.generated_step_count) throw new Error("Automation builder did not produce any executable step updates.");

    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: result.generated_step_count ? "completed" : "failed",
      related_kind: "test_case",
      related_id: result.test_case_id,
      description: result.generated_step_count
        ? `Generated instructions for ${result.generated_step_count} sections. ${result.verification_status==='verified'?'The saved source passed isolated verification.':'Isolated verification has not passed.'}`
        : "Automation builder did not produce any step updates.",
      metadata: {
        current_phase: "completed",
        outcome_status: "generated",
        verification_status:result.verification_status,
        phase_message: `Instructions saved for ${result.generated_step_count} sections. ${result.verification_status==='verified'?'Isolated verification passed.':'Review the verification result before execution.'}`,
        generated: 1,
        failed: 0,
        output_test_case_ids: [result.test_case_id],
        retry_test_case_ids: [],
        case_outcomes: [{test_case_id:result.test_case_id,title:result.title,status:"generated",generated_step_count:result.generated_step_count,completion_attempts:result.completion_attempts,verification_status:result.verification_status,verification:result.verification}],
        progress_percent: 100,
        total_items: 1,
        processed_items: 1,
        test_case_id: result.test_case_id,
        source_test_case_id: result.source_test_case_id,
        generated_steps: result.generated_step_count,
        learned_locator_count: result.learned_locator_count,
        fallback_used: result.fallback_used,
        artifact_id: result.artifact_id
      },
      completed_at: new Date().toISOString()
    });

    return {
      ...result,
      transaction_id: transaction.id
    };
  } catch (error) {
    if(execution_guard?.signal.aborted||error.code==="BATCH_JOB_LEASE_LOST")throw execution_guard?.signal.reason||error;
    const message = error instanceof Error ? error.message : "Automation build failed";
    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: "failed",
      description: message,
      metadata: {
        current_phase: "failed",
        outcome_status: "incomplete",
        failed: 1,
        retry_test_case_ids: [normalizedCaseId],
        case_outcomes: [{test_case_id:error.automation_test_case_id||normalizedCaseId,source_test_case_id:error.source_test_case_id,title:testCase.title,status:["AUTOMATION_BUILD_INCOMPLETE","AUTOMATION_DEPENDENCY_MISSING"].includes(error.code)?"incomplete":"failed",message,error:message,code:error.code,error_code:error.code||null,failure_stage:error.failure_stage||null,...(error.code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&Number.isInteger(error.http_status)&&error.http_status>=400&&error.http_status<=599?{http_status:error.http_status}:{}),active_step_id:error.active_step_id,failed_step_id:error.active_step_id,active_manual_step_ids:error.active_manual_step_ids,changes_saved:Boolean(error.saved_sections),saved_sections:error.saved_sections||0,saved_step_ids:error.saved_step_ids||[],completed_sections:error.completed_sections,total_sections:error.total_sections,pending_step_ids:error.pending_step_ids,blocked_steps:error.blocked_steps}],
        progress_percent: 100,
        error: message
      },
      completed_at: new Date().toISOString()
    });
    await appendEvent(transaction.id, {
      level: "error",
      phase: "automation.failed",
      message,
      details: {
        test_case_id: normalizedCaseId,active_step_id:error.active_step_id,active_manual_step_ids:error.active_manual_step_ids,error_code:error.code||null
      }
    });
    throw error;
  }
};

exports.buildAutomationBatch = async ({
  app_type_id,
  test_case_ids = [],
  integration_id,
  created_by,
  start_url,
  start_urls_by_case_id,
  start_url_reviews_by_case_id,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver = "mcp",
  verification_driver = "native",
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_suite_id,
  test_suite_ids_by_case,
  parameter_values_by_case,
  parameter_plan_keys_by_case,
  failure_threshold,
  additional_context,
  agent_context,
  ai_feature,
  execution_guard,
  transaction_id
} = {}) => {
  const selectedFeature = buildFeature(ai_feature);
  const appTypeId = normalizeText(app_type_id);

  if (!appTypeId) {
    throw new Error("app_type_id is required");
  }

  const selectedIds = normalizeIdList(test_case_ids);
  const targetIds = selectedIds.length
    ? selectedIds
    : (await selectCasesForBatch.all(appTypeId)).map((row) => row.id);
  const failureThreshold = Math.max(1, Number(failure_threshold) || DEFAULT_BATCH_FAILURE_THRESHOLD);

  if (!targetIds.length) {
    throw new Error("No manual test cases were found for automation build");
  }

  const firstCase = await selectCaseWithScope.get(targetIds[0]);
  if (!firstCase || firstCase.app_type_id !== appTypeId) throw new Error("Every selected automation case must belong to the batch application.");
  const transactionId = normalizeText(transaction_id);

  if (transactionId) {
    await updateTransaction(transactionId, {
      project_id: firstCase?.project_id || null,
      app_type_id: appTypeId,
      category: "automation_build",
      action: "batch_case_automation_build",
      status: "running",
      title: "Automation engineer activity",
      description: `Developing ${targetIds.length} automation case${targetIds.length === 1 ? "" : "s"}.`,
      metadata: {
        agent_activity: true,
        input_test_case_ids: targetIds,
        verification_status: "unverified",
        current_phase: "queued",
        total_items: targetIds.length,
        processed_items: 0,
        generated: 0,
        failed: 0,
        failure_threshold: failureThreshold,
        progress_percent: 0
      },
      started_at: new Date().toISOString()
    });
  }

  const created = [];
  const errors = [];
  const caseOutcomes=[];
  const retryableErrors=[];
  let stoppedByThreshold = false;

  for (const [index, testCaseId] of targetIds.entries()) {
    await execution_guard?.ensureOwnership();
    if (errors.length >= failureThreshold) {
      stoppedByThreshold = true;
      await appendEvent(transactionId, {
        level: "warning",
        phase: "automation.failure_threshold",
        message: `Automation build stopped after ${errors.length} failed case${errors.length === 1 ? "" : "s"}.`,
        details: {
          failure_threshold: failureThreshold,
          remaining_case_count: targetIds.length - index
        }
      });
      break;
    }

    await appendEvent(transactionId, {
      phase: "automation.case.started",
      message: `Building automation for case ${index + 1} of ${targetIds.length}.`,
      details: {
        test_case_id: testCaseId,
        case_index: index + 1,
        total_cases: targetIds.length
      }
    });

    try {
      const scopedCase = await selectCaseWithScope.get(testCaseId);
      if (!scopedCase || scopedCase.app_type_id !== appTypeId) throw new Error("Every selected automation case must belong to the batch application.");
      const pinnedStartUrl=start_urls_by_case_id?.[testCaseId]??start_url;
      if(transactionId){
        const savedSteps=await selectStepsForCase.all(testCaseId);
        normalizeAutomationStartUrl(pinnedStartUrl,{required:requiresAutomationStartUrl({appTypeKind:scopedCase.app_type_kind,steps:savedSteps})});
      }
      const result = await buildCaseCore({
        test_case_id: testCaseId,
        integration_id,
        ai_feature: selectedFeature,
        execution_guard,
        created_by,
        start_url:pinnedStartUrl,
        start_url_review:start_url_reviews_by_case_id?.[testCaseId],
        allow_browser_actions,
        verification_mode, browser_driver, verification_driver,
        test_environment_id,
        test_configuration_id,
        test_data_set_id,
        test_suite_id:test_suite_ids_by_case&&Object.hasOwn(test_suite_ids_by_case,testCaseId)?test_suite_ids_by_case[testCaseId]:test_suite_id,
        parameter_values:parameter_values_by_case?.[testCaseId],
        parameter_plan_key:parameter_plan_keys_by_case?.[testCaseId],
        additional_context,
  agent_context,
        transaction_id: transactionId
      });
      if (!result.generated_step_count) throw new Error("Automation builder did not produce any executable step updates.");
      created.push(result);
      caseOutcomes.push({test_case_id:result.test_case_id,source_test_case_id:result.source_test_case_id,title:result.title,status:"generated",generated_step_count:result.generated_step_count,completion_attempts:result.completion_attempts,verification_status:result.verification_status,verification:result.verification});
    } catch (error) {
      if(execution_guard?.signal.aborted||error.code==="BATCH_JOB_LEASE_LOST")throw execution_guard?.signal.reason||error;
      if(!error.nonRetryable&&!["AI_INSTRUCTION_MISSING","AI_FEATURE_UNMAPPED","AI_CONFIGURATION_INVALID"].includes(error.code)&&[408,425,429,500,502,503,504].includes(Number(error.statusCode||error.status)))retryableErrors.push(error);
      errors.push({
        test_case_id: error.automation_test_case_id||testCaseId,
        source_test_case_id:error.source_test_case_id,
        message: error instanceof Error ? error.message : "Automation build failed",
        code: error.code || null,
        error_code: error.code || null,
        failure_stage: error.failure_stage || null,
        ...(error.code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&Number.isInteger(error.http_status)&&error.http_status>=400&&error.http_status<=599?{http_status:error.http_status}:{}),
        active_step_id:error.active_step_id,failed_step_id:error.active_step_id,active_manual_step_ids:error.active_manual_step_ids,
        completed_sections: error.completed_sections,
        saved_sections:error.saved_sections||0,
        saved_step_ids:error.saved_step_ids||[],
        total_sections: error.total_sections,
        pending_step_ids: error.pending_step_ids,
        blocked_steps:error.blocked_steps
      });
      caseOutcomes.push({...errors[errors.length-1],status:["AUTOMATION_BUILD_INCOMPLETE","AUTOMATION_DEPENDENCY_MISSING"].includes(error.code)?"incomplete":"failed",changes_saved:Boolean(error.saved_sections)});
      await appendEvent(transactionId, {
        level: "error",
        phase: "automation.case.failed",
        message: `Automation build failed for case ${testCaseId}.`,
        details: errors[errors.length - 1]
      });
    }

    const processed = index + 1;
    await updateTransaction(transactionId, {
      description: `Built automation for ${created.length} of ${targetIds.length} case${targetIds.length === 1 ? "" : "s"} so far.`,
      metadata: {
        current_phase: "automation.build",
        total_items: targetIds.length,
        processed_items: processed,
        generated: created.length,
        failed: errors.length,
        case_outcomes: caseOutcomes,
        failure_threshold: failureThreshold,
        progress_percent: Math.round((processed / targetIds.length) * 100)
      }
    });
  }

  const processedCount = created.length + errors.length;
  const skippedCount = stoppedByThreshold ? Math.max(0, targetIds.length - processedCount) : 0;
  if(!created.length&&errors.length&&retryableErrors.length===errors.length) {
    await updateTransaction(transactionId,{metadata:{case_outcomes:caseOutcomes,retry_test_case_ids:targetIds,current_phase:"automation.agent.retry",phase_message:"A temporary provider or context service failure interrupted generation. The durable agent worker will apply its bounded retry policy."}});
    throw retryableErrors[0];
  }
  const outcomeStatus=!created.length?"incomplete":errors.length||skippedCount?"partial":"generated";
  const verifiedCount=created.filter(result=>result.verification_status==='verified').length;
  const outcomeMessage=`Generated instructions for ${created.length} of ${targetIds.length} cases; ${errors.length} failed and ${skippedCount} skipped. ${verifiedCount} saved source(s) passed isolated verification.`;
  const registeredTargets=transactionId?(await workspaceTransactionService.getTransaction(transactionId)).metadata?.output_test_case_ids||[]:[];

  await updateTransaction(transactionId, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? outcomeMessage
      : "The agent did not complete any case. Existing instructions were retained.",
    metadata: {
      current_phase: "automation.agent."+outcomeStatus,
      phase_message: outcomeMessage,
      outcome_status: outcomeStatus,
      verification_status: verifiedCount===targetIds.length?"verified":"unverified",
      case_outcomes: caseOutcomes,
      total_items: targetIds.length,
      processed_items: processedCount,
      generated: created.length,
      failed: errors.length,
      skipped: skippedCount,
      failure_threshold: failureThreshold,
      stopped_by_failure_threshold: stoppedByThreshold,
      progress_percent: 100,
      output_test_case_ids: require('./automationBuildTargets.service').mergeTargets(registeredTargets,created.map(result=>result.test_case_id)),
      retry_test_case_ids: targetIds.filter(id => !created.some(result => result.test_case_id === id)),
      sample_errors: errors.slice(0, 10)
    },
    completed_at: new Date().toISOString()
  });
  await appendEvent(transactionId, {
    level: !created.length ? "error" : errors.length||skippedCount ? "warning" : "success",
    phase: "automation.agent.finished",
    message: outcomeMessage,
    details: {
      generated: created.length,
      failed: errors.length,
      skipped: skippedCount,
      failure_threshold: failureThreshold,
      stopped_by_failure_threshold: stoppedByThreshold,
      sample_errors: errors.slice(0, 10)
    }
  });

  return {
    generated: created.length,
    failed: errors.length,
    skipped: skippedCount,
    created,
    errors
  };
};

exports.listLearningCache = async ({ project_id, app_type_id, limit, offset } = {}) => {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await listLearningCacheRows({
    projectId: normalizeText(project_id),
    appTypeId: normalizeText(app_type_id),
    limit: boundedLimit,
    offset: Math.max(0, Number(offset) || 0)
  });

  return rows.map(normalizeLearningCacheRow);
};

exports.exportRepositoryContext = async ({ project_id, app_type_id, limit } = {}) => {
  const entries = await exports.listLearningCache({ project_id, app_type_id, limit: limit || 200 });
  const screens = new Map();

  entries.forEach((entry) => {
    const metadata = normalizeObject(entry.metadata);
    const screenName = normalizeText(metadata.screen_name) || entry.page_key || "Unassigned screen";
    const isScreenRecord = metadata.record_kind === "screen" || entry.locator_intent === "__screen__";
    const existingScreen = screens.get(screenName);
    const screen = existingScreen || {
      screen: screenName,
      appType: normalizeText(metadata.platform) || null,
      urlPattern: {
        type: normalizeText(metadata.url_pattern_type) || "contains",
        value: normalizeText(metadata.url_pattern_value) || entry.page_url || entry.page_key
      },
      fingerprint: normalizeText(metadata.screen_fingerprint) || null,
      fields: []
    };

    if (isScreenRecord && existingScreen) {
      screen.appType = normalizeText(metadata.platform) || screen.appType;
      screen.urlPattern = {
        type: normalizeText(metadata.url_pattern_type) || screen.urlPattern.type,
        value: normalizeText(metadata.url_pattern_value) || entry.page_url || screen.urlPattern.value
      };
      screen.fingerprint = normalizeText(metadata.screen_fingerprint) || screen.fingerprint;
    }

    const fallbackLocators = Array.isArray(metadata.fallback_locators)
      ? metadata.fallback_locators
      : [];

    if (!isScreenRecord) {
      screen.fields.push({
        name: normalizeText(metadata.object_name) || entry.locator_intent,
        type: normalizeText(metadata.object_role) || entry.locator_kind || "field",
        primaryLocator: entry.locator,
        primaryStrategy: inferLocatorStrategy(entry.locator, entry.locator_kind),
        confidenceScore: clampNumber(entry.confidence, 0),
        fallbackLocators,
        description: normalizeText(metadata.description) || null,
        businessMeaning: normalizeText(metadata.business_meaning) || null,
        usageKeywords: Array.isArray(metadata.usage_keywords) ? metadata.usage_keywords : [],
        stabilityScore: clampNumber(metadata.stability_score, 0),
        lastValidatedDate: normalizeText(metadata.last_validated_at) || null
      });
    }
    screens.set(screenName, screen);
  });

  return {
    repositoryType: "ui_intelligence_repository",
    generatedAt: new Date().toISOString(),
    screens: Array.from(screens.values())
  };
};

const csvValue = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;

exports.exportLearningCacheCsv = async ({ app_type_id } = {}) => {
  const entries = await listAllLearningCacheRows({ appTypeId: app_type_id });
  const headers = [
    "screen_name",
    "record_type",
    "page_url",
    "url_pattern_type",
    "url_pattern_value",
    "object_name",
    "object_role",
    "locator",
    "locator_kind",
    "confidence",
    "source",
    "description",
    "business_meaning",
    "target_criteria",
    "fallback_locators",
    "usage_keywords",
    "stability_score",
    "dom_structure",
    "screenshot_url",
    "metadata_json"
  ];
  const rows = entries.map((entry) => {
    const metadata = normalizeObject(entry.metadata);
    const screenName = normalizeText(metadata.screen_name) || entry.page_key || entry.page_url || "Screen";
    const screenRecord = isRepositoryScreenRecord(entry);

    return [
      screenName,
      screenRecord ? "screen" : "field",
      entry.page_url,
      metadata.url_pattern_type,
      metadata.url_pattern_value,
      screenRecord ? "__screen__" : normalizeText(metadata.object_name) || entry.locator_intent,
      screenRecord ? "screen" : metadata.object_role,
      screenRecord ? "__screen__" : entry.locator,
      screenRecord ? "screen" : entry.locator_kind,
      entry.confidence,
      entry.source,
      metadata.description,
      metadata.business_meaning,
      JSON.stringify(Array.isArray(metadata.target_criteria) ? metadata.target_criteria : []),
      JSON.stringify(Array.isArray(metadata.fallback_locators) ? metadata.fallback_locators : []),
      JSON.stringify(Array.isArray(metadata.usage_keywords) ? metadata.usage_keywords : []),
      metadata.stability_score,
      metadata.dom_structure,
      metadata.screenshot_url,
      JSON.stringify(metadata)
    ].map(csvValue).join(",");
  });

  return [headers.map(csvValue).join(","), ...rows].join("\n");
};

exports.getLearningCacheEntry = async (id) => {
  let entry = normalizeLearningCacheRow(await selectLearningCacheEntry.get(normalizeText(id)));

  if (!entry) {
    throw new Error("Object repository entry not found");
  }

  const projectId=entry.project_id||(entry.app_type_id?(await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(entry.app_type_id))?.project_id:null);
  const projection=await canonicalRepositoryProjection(await readRepositoryScope({appTypeId:entry.app_type_id,projectId}));
  entry=projection.byId.get(entry.id)||entry;
  const seen=new Set();
  while(entry.metadata?.merged_into_entry_id){if(seen.has(entry.id))throw new Error('Repository redirect is invalid.');seen.add(entry.id);const target=projection.byId.get(entry.metadata.merged_into_entry_id);if(!target)throw new Error('Repository redirect target is unavailable.');entry=target;}
  return entry;
};

const getRepositoryObjectName = (entry, screenName = normalizeText(entry?.metadata?.screen_name || entry?.page_key || entry?.page_url)) => {
  const objectName = normalizeText(entry?.metadata?.object_name || entry?.locator_intent);
  const screenPrefix = screenName ? `${screenName}.` : "";
  return screenPrefix && objectName?.startsWith(screenPrefix) ? objectName.slice(screenPrefix.length) : objectName;
};

const isRepositoryScreenRecord = (entry) =>
  entry?.locator_intent === "__screen__"
  || entry?.metadata?.record_kind === "screen"
  || entry?.source === "manual_screen";

const getRepositoryMemberReference = (entry) => {
  const screenName = normalizeText(entry?.metadata?.screen_name || entry?.page_key || entry?.page_url);
  const objectName = getRepositoryObjectName(entry, screenName);
  return screenName && objectName ? `${screenName}.${objectName}` : null;
};

const migrateRepositoryMemberReference = async ({ appTypeId, from, to } = {}) => {
  if (!from || !to || from === to) {
    return 0;
  }

  const pattern = `%${from}%`;
  const result = await replaceTestStepRepositoryReference.run(
    from,
    to,
    from,
    to,
    normalizeText(appTypeId) || null,
    pattern,
    pattern
  );
  return result.changes || 0;
};

exports.updateLearningCacheEntry = async (id, patch = {}, internal = {}) => {
  return obsDb.transaction(async()=>{
  let existing = await exports.getLearningCacheEntry(id);
  const scope={appTypeId:existing.app_type_id,projectId:existing.project_id};await lockRepositoryScope(scope);
  existing=await exports.getLearningCacheEntry(id);
  patch = await resolveRepositoryScreenBinding({
    ...patch,
    metadata: { ...normalizeObject(existing.metadata), ...repositoryInputMetadata(patch.metadata), ...Object.fromEntries(Object.entries(internal.identityMetadata||{}).filter(([,value])=>value!==undefined)) }
  }, existing);
  const next = normalizeRepositoryPatch(existing, patch);
  // Capture the projected family before writing. Legacy rows may still carry
  // an old screen name and no parent ID until this first authorized write.
  const screenFamilyIds=isRepositoryScreenRecord(existing)&&next.page_url!==existing.page_url
    ?(await canonicalRepositoryProjection(await readRepositoryScope(scope))).all.filter(row=>(row.metadata.screen_name||row.page_key)===(existing.metadata.screen_name||existing.page_key)).map(row=>row.id)
    :[];
  // Physical legacy keys stay stable; canonical names and historical bindings
  // live in metadata, avoiding unique-key collisions with retained redirects.
  next.page_key=existing.page_key;
  const previousReference=getRepositoryMemberReference(existing);
  if(previousReference&&!isRepositoryScreenRecord(existing))next.metadata.reference_aliases=[...new Set([...(existing.metadata.reference_aliases||[]),previousReference,...(next.metadata.reference_aliases||[])])];
  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: existing.app_type_id,
    project_id: existing.project_id,
    screen_name: next.metadata?.screen_name || next.page_key || next.page_url,
    locator: next.locator,
    exclude_id: existing.id
  });

  if (duplicate && !canonicalPageUrl(next.page_url)) {
    throw new Error("Another object repository field on this screen already uses the same locator.");
  }
  if(duplicate&&!isRepositoryScreenRecord(existing)&&canonicalPageUrl(next.page_url)===canonicalPageUrl(duplicate.page_url)){
    const metadata={...next.metadata,merged_into_entry_id:duplicate.id};
    await obsDb.prepare('UPDATE automation_learning_cache SET metadata = ? WHERE id = ? AND metadata IS DISTINCT FROM ?::jsonb').run(metadata,existing.id,metadata);
    await reconcileRepositoryScope(scope);
    return {...await exports.getLearningCacheEntry(existing.id),updated_step_references:0};
  }

  await updateLearningCacheEntry.run(
    next.page_url,
    next.page_key,
    next.locator_intent,
    next.locator,
    next.locator_kind,
    next.confidence,
    next.source,
    next.metadata,
    existing.id
  );
  for(const memberId of screenFamilyIds)if(memberId!==existing.id)await obsDb.prepare('UPDATE automation_learning_cache SET page_url = ? WHERE id = ?').run(next.page_url,memberId);
  await reconcileRepositoryScope(scope);
  const updated = await exports.getLearningCacheEntry(existing.id);

  return {
    ...updated,
    updated_step_references: 0
  };
  })();
};

exports.renameLearningCacheScreen = async ({ app_type_id, project_id, screen_name, new_name } = {}) => obsDb.transaction(async()=>{
  const appTypeId=normalizeText(app_type_id),screenName=normalizeText(screen_name),newName=normalizeText(new_name);
  if(!screenName||!newName)throw new Error("Current and new screen names are required");
  const projectId=normalizeText(project_id)||(appTypeId?(await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null);
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  const selected=projection.all.filter(row=>(row.metadata.screen_name||row.page_key)===screenName);
  if(!selected.length)throw new Error("Object repository screen not found");
  for(const row of selected){const reference=getRepositoryMemberReference(row);row.metadata={...row.metadata,screen_name:newName,screen_aliases:[...new Set([...(row.metadata.screen_aliases||[]),screenName,newName])],...(!isRepositoryScreenRecord(row)&&reference?{reference_aliases:[...new Set([...(row.metadata.reference_aliases||[]),reference])]}:{}),last_curated_at:new Date().toISOString()};}
  await saveRepositoryProjection(projection);
  await reconcileRepositoryScope(scope);
  return {renamed:true,screen_name:newName,updated_fields:selected.length,updated_step_references:0};
})();

// A selected field belongs to the screen confirmed by the save operation.
// Browser navigation and stale client metadata must not silently move it to a
// different screen or application. The reference lives in existing metadata.
const resolveRepositoryScreenBinding = async (input, existing = null) => {
  const metadata = normalizeObject(input.metadata);
  const screenId = normalizeText(metadata.screen_entry_id);
  if (!screenId) return input;
  let screen;try{screen=await exports.getLearningCacheEntry(screenId);}catch{screen=null;}
  if (!screen || !isRepositoryScreenRecord(screen)) {
    throw new Error("The selected repository screen no longer exists. Reopen the screen before saving its fields.");
  }
  if (isRepositoryScreenRecord({ ...existing, ...input, metadata })) {
    throw new Error("Only repository fields can be linked to a parent screen.");
  }
  const requestedApp = normalizeText(input.app_type_id) || normalizeText(existing?.app_type_id);
  const requestedProject = normalizeText(input.project_id) || normalizeText(existing?.project_id);
  if ((requestedApp && requestedApp !== screen.app_type_id)
    || (requestedProject && screen.project_id && requestedProject !== screen.project_id)
    || (existing && (existing.app_type_id || null) !== (screen.app_type_id || null))) {
    throw new Error("The selected repository screen and field must belong to the same project and app type.");
  }
  const screenName = normalizeText(screen.metadata?.screen_name) || normalizeText(screen.page_key);
  return {
    ...input,
    project_id: screen.project_id || requestedProject || null,
    app_type_id: screen.app_type_id || null,
    page_key: screenName,
    page_url: screen.page_url || input.page_url || null,
    screen_name: screenName,
    metadata: { ...metadata, screen_entry_id: screen.id, screen_name: screenName, record_kind: "field" }
  };
};

exports.createLearningCacheEntry = async (input = {}) => {
  input = await resolveRepositoryScreenBinding(input);
  const appTypeId = normalizeText(input.app_type_id);
  let projectId = normalizeText(input.project_id);
  if (appTypeId) {
    const appType = await db.prepare(`SELECT id, project_id FROM app_types WHERE id = ?`).get(appTypeId);
    if (!appType) throw new Error("App type not found");
    if (projectId && projectId !== appType.project_id) throw new Error("Object repository project scope must match the selected app type");
    projectId = appType.project_id;
  }
  const metadata = normalizeObject(input.metadata);
  const pageKey = normalizeText(input.page_key) || normalizeText(input.screen_name) || normalizeUrlKey(input.page_url) || "unknown-page";
  const locator = normalizeText(input.locator);
  const screenName = normalizeText(input.screen_name) || pageKey;

  if (!locator) {
    throw new Error("Locator is required");
  }

  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: appTypeId,
    project_id: projectId,
    screen_name: screenName,
    locator
  });

  if (duplicate) {
    // Inspect can retry after a partial save or a stale repository reload.
    // The confirmed parent and locator identify the same field durably.
    if (metadata.screen_entry_id && !isRepositoryScreenRecord(duplicate)) {
      return exports.updateLearningCacheEntry(duplicate.id, {...input,locator:duplicate.locator});
    }
    if(!canonicalPageUrl(input.page_url))throw new Error("Another object repository field on this screen already uses the same locator.");
  }

  const persisted=await upsertLearningCache.run(
    uuid(),
    projectId,
    appTypeId,
    normalizeText(input.test_case_id),
    normalizeText(input.page_url),
    pageKey,
    normalizeText(input.locator_intent || input.object_name) || "field",
    locator,
    normalizeText(input.locator_kind) || "css",
    clampNumber(input.confidence, 0.8),
    normalizeText(input.source) || "object_repository",
    {
      ...metadata,
      screen_name: screenName,
      object_name: normalizeText(input.object_name) || normalizeText(input.locator_intent) || "field",
      object_role: normalizeText(input.object_role) || "field",
      target_criteria: input.target_criteria !== undefined ? input.target_criteria : Array.isArray(metadata.target_criteria) ? metadata.target_criteria : [],
      dom_structure: normalizeText(input.dom_structure !== undefined ? input.dom_structure : metadata.dom_structure),
      screenshot_url: normalizeText(input.screenshot_url !== undefined ? input.screenshot_url : metadata.screenshot_url),
      fallback_strategy: normalizeText(input.fallback_strategy !== undefined ? input.fallback_strategy : metadata.fallback_strategy),
      screen_dom_compressed: normalizeText(input.screen_dom_compressed !== undefined ? input.screen_dom_compressed : metadata.screen_dom_compressed),
      screen_screenshot_url: normalizeText(input.screen_screenshot_url !== undefined ? input.screen_screenshot_url : metadata.screen_screenshot_url)
    }
  );

  return exports.getLearningCacheEntry(persisted.id);
};

exports.findDuplicateLearningCacheEntry = async ({ app_type_id, project_id, screen_name, locator, exclude_id } = {}) => {
  const normalizedScreen = normalizeText(screen_name);
  const normalizedLocator = normalizeText(locator);

  if (!normalizedScreen || !normalizedLocator) {
    return null;
  }

  const rows = await listLearningCacheScreenRows({ appTypeId: normalizeText(app_type_id), projectId: normalizeText(project_id), screenName: normalizedScreen });
  return rows.find((entry) =>
    entry.id !== exclude_id
    && ((entry.metadata?.platform||'web')==='web'?sameRecordedLocator(normalizeText(entry.locator),normalizedLocator):normalizeText(entry.locator)===normalizedLocator)
    && normalizeText(entry.metadata?.screen_name || entry.page_key || entry.page_url) === normalizedScreen
  ) || null;
};

exports.importLearningCacheEntries = async ({ project_id, app_type_id, entries, import_source } = {}) => {
  const appTypeId = normalizeText(app_type_id);
  const projectId = normalizeText(project_id);
  const rows = Array.isArray(entries) ? entries : [];

  if (!appTypeId) {
    throw new Error("App type scope is required");
  }
  if (!rows.length) {
    throw new Error("Provide at least one object repository entry to import");
  }
  if (rows.length > 200) {
    throw new Error("Import batches cannot exceed 200 repository entries");
  }

  const result = { created: 0, updated: 0, failed: 0, errors: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const raw = normalizeObject(rows[index]);
    const rawMetadata = normalizeObject(raw.metadata);
    const screenName = normalizeText(raw.screen_name || rawMetadata.screen_name || raw.page_key);
    const screenRecord = raw.record_type === "screen"
      || raw.locator_intent === "__screen__"
      || rawMetadata.record_kind === "screen";
    const objectName = screenRecord ? "__screen__" : normalizeText(raw.object_name || rawMetadata.object_name || raw.locator_intent);
    const locator = screenRecord ? "__screen__" : normalizeText(raw.locator);

    try {
      if (!screenName) {
        throw new Error("Screen name is required");
      }
      if (!screenRecord && (!objectName || !locator)) {
        throw new Error("Fields require an object name and locator");
      }

      const metadata = {
        ...rawMetadata,
        screen_name: screenName,
        object_name: objectName,
        object_role: screenRecord ? "screen" : normalizeText(raw.object_role || rawMetadata.object_role) || "field",
        ...(screenRecord ? { record_kind: "screen" } : {}),
        import_source: normalizeText(import_source) || "object_repository_import",
        imported_at: new Date().toISOString()
      };
      const input = {
        project_id: projectId,
        app_type_id: appTypeId,
        page_url: normalizeText(raw.page_url),
        page_key: screenName,
        screen_name: screenName,
        locator_intent: objectName,
        object_name: objectName,
        object_role: metadata.object_role,
        locator,
        locator_kind: screenRecord ? "screen" : normalizeText(raw.locator_kind) || inferLocatorStrategy(locator, "css"),
        confidence: Math.max(0, Math.min(1, clampNumber(raw.confidence, screenRecord ? 1 : 0.8))),
        source: normalizeText(raw.source) || (screenRecord ? "imported_screen" : "imported_repository"),
        target_criteria: Array.isArray(raw.target_criteria) ? raw.target_criteria : rawMetadata.target_criteria,
        dom_structure: normalizeText(raw.dom_structure || rawMetadata.dom_structure),
        screenshot_url: normalizeText(raw.screenshot_url || rawMetadata.screenshot_url),
        fallback_strategy: normalizeText(raw.fallback_strategy || rawMetadata.fallback_strategy),
        screen_dom_compressed: normalizeText(raw.screen_dom_compressed || rawMetadata.screen_dom_compressed),
        screen_screenshot_url: normalizeText(raw.screen_screenshot_url || rawMetadata.screen_screenshot_url),
        metadata
      };
      let screenRows = await listLearningCacheScreenRows({ appTypeId, projectId,screenName });
      if(canonicalPageUrl(input.page_url))screenRows=screenRows.filter(entry=>canonicalPageUrl(entry.page_url)===canonicalPageUrl(input.page_url));
      const normalizedObjectName = String(objectName).toLowerCase();
      const existing = screenRecord
        ? screenRows.find(isRepositoryScreenRecord)
        : screenRows.find((entry) => !isRepositoryScreenRecord(entry)
            && String(getRepositoryObjectName(entry, screenName) || "").toLowerCase() === normalizedObjectName)
          || screenRows.find((entry) => !isRepositoryScreenRecord(entry) && normalizeText(entry.locator) === locator);

      if (existing) {
        if(canonicalPageUrl(input.page_url)&&canonicalPageUrl(input.page_url)===canonicalPageUrl(existing.page_url)){
          input.metadata.screen_aliases=[...new Set([...(existing.metadata.screen_aliases||[]),screenName])];
          if(!screenRecord)input.metadata.reference_aliases=[...new Set([...(existing.metadata.reference_aliases||[]),`${screenName}.${objectName}`])];
          input.screen_name=existing.metadata.screen_name||existing.page_key;input.page_key=existing.page_key;input.metadata.screen_name=input.screen_name;
          if(!screenRecord){input.object_name=getRepositoryObjectName(existing);input.locator_intent=existing.locator_intent;input.metadata.object_name=input.object_name;}
        }
        await exports.updateLearningCacheEntry(existing.id, input,{identityMetadata:{screen_aliases:input.metadata.screen_aliases,reference_aliases:input.metadata.reference_aliases}});
        result.updated += 1;
      } else {
        await exports.createLearningCacheEntry(input);
        result.created += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        index,
        screen_name: screenName,
        object_name: objectName,
        message: error instanceof Error ? error.message : "Unable to import repository entry"
      });
    }
  }

  return result;
};

const buildRepositoryUsageNeedles = (entry) => {
  if (isRepositoryScreenRecord(entry)) {
    return [];
  }

  const screenName = normalizeText(entry.metadata?.screen_name || entry.page_key);
  const objectName = getRepositoryObjectName(entry, screenName);
  return [
    entry.locator,
    objectName,
    screenName && objectName ? `${screenName}.${objectName}` : null,
    entry.locator_intent
    ,...(Array.isArray(entry.metadata?.reference_aliases)?entry.metadata.reference_aliases:[])
  ].map(normalizeText).filter(Boolean);
};

exports.findLearningCacheUsage = async (entryOrEntries) => {
  const entries = (Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]).filter(Boolean);
  const needles = [...new Set(entries.flatMap(buildRepositoryUsageNeedles))];

  if (!needles.length) {
    return [];
  }

  const scopedAppTypeIds = [...new Set(entries.map((entry) => normalizeText(entry.app_type_id)).filter(Boolean))];
  let query = `
    SELECT DISTINCT test_cases.id, test_cases.display_id, test_cases.title, test_cases.automated
    FROM test_steps
    JOIN test_cases ON test_cases.id = test_steps.test_case_id
    WHERE 1 = 1
  `;
  const params = [];

  if (scopedAppTypeIds.length === 1) {
    query += ` AND test_cases.app_type_id = ?`;
    params.push(scopedAppTypeIds[0]);
  }

  const likeClauses = needles.flatMap(() => [
    `LOWER(COALESCE(test_steps.action, '')) LIKE ?`,
    `LOWER(COALESCE(test_steps.expected_result, '')) LIKE ?`,
    `LOWER(COALESCE(test_steps.automation_code, '')) LIKE ?`
  ]);
  query += ` AND (${likeClauses.join(" OR ")}) ORDER BY test_cases.title`;
  needles.forEach((needle) => {
    const pattern = `%${needle.toLowerCase()}%`;
    params.push(pattern, pattern, pattern);
  });

  return obsDb.prepare(query).all(...params);
};

exports.findLearningCacheScreenUsage = async ({ app_type_id, project_id, screen_name } = {}) => {
  const screenName = normalizeText(screen_name);
  const appTypeId = normalizeText(app_type_id);

  if (!screenName) {
    throw new Error("Screen name is required");
  }

  const rows = await listLearningCacheScreenRows({ appTypeId, projectId:normalizeText(project_id), screenName });

  return exports.findLearningCacheUsage(rows);
};

const invalidateRepositoryUsage = async (usage = []) => {
  const affected = [];

  for (const testCase of usage) {
    if (testCase.automated !== "yes") {
      continue;
    }

    const result = await markTestCaseAutomationIncomplete.run(testCase.id);
    if (result.changes) {
      affected.push(testCase);
    }
  }

  return affected;
};

exports.deleteLearningCacheEntry = async (id, { confirmed = false } = {}) => obsDb.transaction(async()=>{
  let existing = await exports.getLearningCacheEntry(id);
  const scope={appTypeId:existing.app_type_id,projectId:existing.project_id};await lockRepositoryScope(scope);
  existing=await exports.getLearningCacheEntry(id);
  const usage = await exports.findLearningCacheUsage(existing);

  if (usage.length && !confirmed) {
    return { deleted: false, requires_confirmation: true, usage, invalidated_cases: [] };
  }

  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  for(const row of projection.all)if(row.id===existing.id||row.metadata.merged_into_entry_id===existing.id)await deleteLearningCacheEntry.run(row.id);
  const invalidatedCases = await invalidateRepositoryUsage(usage);
  return { deleted: true, requires_confirmation: false, usage, invalidated_cases: invalidatedCases };
})();

exports.deleteLearningCacheScreen = async ({ app_type_id, project_id, screen_name, confirmed = false } = {}) => obsDb.transaction(async()=>{
  const screenName = normalizeText(screen_name);
  const appTypeId = normalizeText(app_type_id);

  if (!screenName) {
    throw new Error("Screen name is required");
  }

  const projectId=normalizeText(project_id)||(appTypeId?(await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId))?.project_id:null);
  const scope={appTypeId,projectId};await lockRepositoryScope(scope);
  const rows = await listLearningCacheScreenRows({ appTypeId, projectId, screenName });
  const usage = await exports.findLearningCacheUsage(rows);

  if (usage.length && !confirmed) {
    return { deleted: false, requires_confirmation: true, usage, invalidated_cases: [] };
  }

  const names=new Set(rows.map(row=>row.metadata.screen_name||row.page_key));
  const projection=await canonicalRepositoryProjection(await readRepositoryScope(scope));
  for(const row of projection.all)if(names.has(row.metadata.screen_name||row.page_key))await deleteLearningCacheEntry.run(row.id);
  const invalidatedCases = await invalidateRepositoryUsage(usage);
  return { deleted: true, requires_confirmation: false, usage, invalidated_cases: invalidatedCases };
})();

exports.improveLearningCacheEntry = async ({ id, integration_id, user_id, guidance } = {}) => {
  const existing = await exports.getLearningCacheEntry(id);
  let suggestion;
  let integration = null;

  try {
    integration = await resolveLlmIntegration(integration_id, {
      userId: user_id,
      projectId: existing.project_id,
      usageKey: "ai.automation.locator_repair"
    });
  } catch {
    integration = null;
  }

  if (integration) {
    try {
      const content = await requestChatCompletion({
        integration,
        featureKey: "ai.automation.locator_repair",
        prompt: buildRepositoryImprovePrompt({ entry: existing, guidance: normalizeText(guidance) })
      });
      suggestion = extractJsonPayload(content);
    } catch (error) {
      suggestion = {
        ...buildDeterministicRepositorySuggestion(existing, normalizeText(guidance)),
        fallback_reason: error instanceof Error ? error.message : "LLM repository improvement failed"
      };
    }
  } else {
    suggestion = buildDeterministicRepositorySuggestion(existing, normalizeText(guidance));
  }

  const locator = normalizeText(suggestion?.locator);
  const strategy = normalizeText(suggestion?.strategy || suggestion?.locator_kind || suggestion?.kind);
  if (!locator || !strategy) {
    suggestion = { ...buildDeterministicRepositorySuggestion(existing, normalizeText(guidance)), fallback_reason: "The model did not return a usable locator and strategy." };
  }
  const fallback = Boolean(suggestion.fallback_used);
  return {
    entry: existing,
    suggestion: {
      locator: normalizeText(suggestion.locator),
      strategy: normalizeText(suggestion.strategy || suggestion.locator_kind || suggestion.kind) || existing.locator_kind || "css",
      confidence: clampNumber(suggestion.confidence, existing.confidence),
      reason: normalizeText(suggestion.reason || suggestion.fallback_strategy) || "Review this locator against the captured evidence before applying."
    },
    fallback_used: fallback,
    fallback_reason: suggestion.fallback_reason || null,
    generation_mode: fallback ? "deterministic" : "llm",
    generated_at: new Date().toISOString(),
    request_id: uuid(),
    requires_human_review: true,
    provenance: { provider: fallback ? "HelloTest deterministic rules" : integration?.name || integration?.type || "Configured AI provider", model: fallback ? null : integration?.config?.model || null }
  };
};

exports.applyLearningCacheImprovement = async ({ id, confirmed, locator, strategy, confidence, expected_locator, request_id, user_id } = {}) => {
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
  if (confirmed !== true) throw invalid("Review and confirm the proposed locator before applying it.");
  locator = normalizeText(locator);
  strategy = normalizeText(strategy);
  if (!locator || !strategy || locator.length > 8192 || strategy.length > 100) throw invalid("A valid locator and strategy are required.");
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw invalid("Confidence must be between 0 and 1.");
  return obsDb.transaction(async () => {
    let existing = await exports.getLearningCacheEntry(id);
    await lockRepositoryScope({appTypeId:existing.app_type_id,projectId:existing.project_id});
    await obsDb.prepare("SELECT id FROM automation_learning_cache WHERE id = ? FOR UPDATE").get(existing.id);
    existing = await exports.getLearningCacheEntry(id);
    if (isRepositoryScreenRecord(existing)) throw invalid("Select a repository field to improve.");
    if (typeof expected_locator !== "string" || existing.locator !== expected_locator) {
      throw Object.assign(new Error("This field changed since the proposal was generated. Refresh and generate a new proposal."), { statusCode: 409 });
    }
    const reviewedAt = new Date().toISOString();
    const changed = existing.locator !== locator || existing.locator_kind !== strategy;
    const fallbacks = Array.isArray(existing.metadata?.fallback_locators) ? existing.metadata.fallback_locators : [];
    const previous = { locator: existing.locator, strategy: existing.locator_kind || "css", confidenceScore: existing.confidence, isPrimary: false };
    const entry = await exports.updateLearningCacheEntry(id, {
      locator, locator_kind: strategy, confidence: confidence ?? existing.confidence,
      source: "reviewed_locator_improvement",
      metadata: {
        ...existing.metadata,
        fallback_locators: [ ...(changed ? [previous] : []), ...fallbacks ].filter((item, index, all) => item.locator !== locator && all.findIndex(other => other.locator === item.locator) === index),
        ...(changed ? { last_validated_at: null, last_validated_status: "not_validated" } : {}),
        locator_review_history: [...(Array.isArray(existing.metadata?.locator_review_history) ? existing.metadata.locator_review_history : []), {
          before: { locator: existing.locator, strategy: existing.locator_kind }, after: { locator, strategy },
          reviewed_by: user_id, reviewed_at: reviewedAt, request_id: request_id || null
        }].slice(-50)
      }
    });
    return { entry, applied: true };
  })();
};

exports.extractRepositoryFields = async ({
  screen_name,
  page_url,
  dom_structure,
  screenshot_url,
  business_meaning,
  candidate_fields,
  integration_id,
  user_id,
  project_id
} = {}) => {
  const screenName = normalizeText(screen_name) || "Screen";
  const pageUrl = normalizeText(page_url);
  const domStructure = normalizeText(dom_structure);
  const screenshotUrl = normalizeText(screenshot_url);
  const candidateFields = Array.isArray(candidate_fields) ? candidate_fields : [];

  if (!domStructure && !screenshotUrl) {
    throw new Error("Provide captured DOM or a screenshot before extracting fields.");
  }

  let integration = null;
  try {
    integration = await resolveLlmIntegration(integration_id, {
      userId: user_id,
      projectId: project_id,
      usageKey: "ai.automation.dom_extraction"
    });
  } catch {
    integration = null;
  }

  if (!integration) {
    return {
      ...normalizeRepositoryExtractFields({}, candidateFields),
      ai_used: false,
      fallback_used: true,
      fallback_reason: "No active LLM integration is configured; extracted deterministic DOM candidates."
    };
  }

  const prompt = buildRepositoryExtractPrompt({
    screenName,
    pageUrl,
    domStructure,
    businessMeaning: normalizeText(business_meaning),
    candidateFields
  });

  try {
    const content = screenshotUrl
      ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: screenshotUrl } }
      ]
      : prompt;
    const response = await requestChatCompletion({ integration, prompt, content, featureKey: "ai.automation.dom_extraction" });
    const payload = extractJsonPayload(response);
    const hasAiFields = Array.isArray(payload?.fields) && payload.fields.length > 0;
    return {
      ...normalizeRepositoryExtractFields(payload, candidateFields),
      ai_used: hasAiFields,
      fallback_used: !hasAiFields,
      fallback_reason: hasAiFields ? null : "AI returned no usable fields; extracted deterministic DOM candidates."
    };
  } catch (error) {
    return {
      ...normalizeRepositoryExtractFields({}, candidateFields),
      ai_used: false,
      fallback_used: true,
      fallback_reason: error instanceof Error ? error.message : "AI screen extraction failed; extracted deterministic DOM candidates."
    };
  }
};

const resolveTestEngineIntegration = async (testCase) => {
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", testCase.project_id);

  if (!integration?.base_url) {
    throw new Error("Configure an active Test Engine integration before using browser automation or recording");
  }

  return integration;
};

const resolveMobileEngineBaseUrl = (integration, recorderMode) => {
  const config = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const configured = normalizeText(config.mobile_engine_url) || normalizeText(process.env.MOBILE_ENGINE_PUBLIC_URL);
  const internal = normalizeText(process.env.MOBILE_ENGINE_URL) || normalizeText(config.mobile_engine_internal_url);

  if (recorderMode === "local") {
    return normalizeText(process.env.MOBILE_ENGINE_LOCAL_URL) || configured || "http://host.docker.internal:4312";
  }

  return configured || internal || "http://mobile-engine:4312";
};

const hasRemoteMobileProvider = (integration) => {
  const config = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const provider = normalizeText(config.mobile_cloud_provider);
  const remoteUrl = normalizeText(config.mobile_remote_url);
  return Boolean(provider && provider !== "none" && remoteUrl);
};

const readEngineJson = async (url, init = {}) => {
  const response = await resilientHttpRequest(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers || {})
    }
  }, { dependency: 'test-engine', operation: 'automation.engine.request', deadlineMs: ENGINE_TIMEOUT_MS,
    attemptTimeoutMs: ENGINE_TIMEOUT_MS, maxAttempts: 1, idempotent: !init.method || init.method === 'GET' });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || `Test Engine request failed with status ${response.status}`);
  }

  return payload;
};

const readMobileEngineJson = async (url, init = {}) => readEngineJson(url, {
  ...init,
  headers: {
    [MOBILE_ENGINE_SECRET_HEADER]: resolveMobileEngineSecret(),
    ...(init.headers || {})
  }
});

const buildEngineUrl = (baseUrl, value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return new URL(normalized, `${String(baseUrl || "").replace(/\/+$/, "")}/`).toString();
  }
};

const isPrivateAddress = (hostname) =>
  hostname === "localhost"
  || hostname === "host.docker.internal"
  || hostname === "testengine"
  || hostname === "127.0.0.1"
  || hostname === "::1"
  || /^10\./.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const normalizeLocalEngineBaseUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Local recorder engine URL must be an absolute http or https URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Local recorder engine URL must use http or https.");
  }

  if (!isPrivateAddress(parsed.hostname)) {
    throw new Error("Local recorder engine URL must point to localhost, the local Docker service, or a private network address.");
  }

  if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && process.env.DATABASE_URL?.includes("postgres")) {
    parsed.hostname = "host.docker.internal";
  }

  return parsed.toString().replace(/\/+$/, "");
};

const resolveRecorderPublicBaseUrl = (integration, fallbackBaseUrl, recorderMode) => {
  if (recorderMode === "local" && fallbackBaseUrl) {
    let parsedFallback;
    try {
      parsedFallback = new URL(fallbackBaseUrl);
      if (parsedFallback.hostname === "host.docker.internal") {
        parsedFallback.hostname = "localhost";
      }
      return parsedFallback.toString().replace(/\/+$/, "");
    } catch {
      // Ignore
    }
  }
  const config = integration?.config && typeof integration.config === "object" ? integration.config : {};
  return normalizeText(config.recorder_public_base_url)
    || normalizeText(config.public_base_url)
    || normalizeText(config.live_view_url)
    || fallbackBaseUrl;
};

const parseTransactionMetadata = (transaction) => safeJson(transaction?.metadata, {});

const isRecorderSessionPastOrphanTtl = (session, transaction) => {
  const metadata = parseTransactionMetadata(transaction);
  const lastActivity = Date.parse(
    session?.last_activity_at
    || session?.started_at
    || metadata.recorder_started_at
    || transaction?.started_at
    || transaction?.created_at
    || ""
  );

  if (!Number.isFinite(lastActivity)) {
    return true;
  }

  return Date.now() - lastActivity > RECORDER_ORPHAN_TTL_MS;
};

exports.cleanupOrphanRecorderSessions = async ({ limit = 25 } = {}) => {
  const cutoff = new Date(Date.now() - RECORDER_ORPHAN_TTL_MS).toISOString();
  const transactions = await selectStaleRecorderTransactions.all(cutoff, Math.max(1, Math.min(100, Number(limit) || 25)));
  let stopped = 0;
  let checked = 0;

  for (const transaction of transactions) {
    const metadata = parseTransactionMetadata(transaction);
    const sessionId = normalizeText(metadata.recorder_session_id);
    const mobileRecorder = normalizeText(metadata.recorder_target) === "mobile";
    const baseUrl = mobileRecorder
      ? normalizeText(metadata.mobile_engine_base_url)
      : normalizeText(metadata.engine_base_url);
    const readRecorderEngineJson = mobileRecorder ? readMobileEngineJson : readEngineJson;

    if (!sessionId || !baseUrl) {
      continue;
    }

    checked += 1;

    try {
      const sessionPath = mobileRecorder ? "/api/v1/mobile/recorder/sessions" : "/api/v1/recorder/sessions";
      const session = await readRecorderEngineJson(`${baseUrl}${sessionPath}/${encodeURIComponent(sessionId)}`);
      const shouldStop = session?.status === "running" && isRecorderSessionPastOrphanTtl(session, transaction);

      if (!shouldStop && session?.status === "running") {
        continue;
      }

      if (shouldStop) {
        await readRecorderEngineJson(`${baseUrl}${sessionPath}/${encodeURIComponent(sessionId)}/stop`, {
          method: "POST"
        }).catch(() => null);
        stopped += 1;
      }

      const message = shouldStop
        ? "Recorder session was auto-stopped after more than 3 minutes without live-view or input activity."
        : "Recorder session was already stopped while HelloTest still had the process marked as running.";

      await appendEvent(transaction.id, {
        level: "warning",
        phase: "recorder.orphan.cleaned",
        message,
        details: {
          recorder_session_id: sessionId,
          engine_base_url: baseUrl,
          last_activity_at: session?.last_activity_at || null,
          recorder_status: shouldStop ? "auto-stopped" : session?.status || "unknown",
          orphan_ttl_ms: RECORDER_ORPHAN_TTL_MS
        }
      });
      await updateTransaction(transaction.id, {
        status: "failed",
        description: message,
        metadata: {
          current_phase: "recorder.orphan.cleaned",
          progress_percent: 100,
          recorder_status: shouldStop ? "auto-stopped" : session?.status || "unknown",
          last_activity_at: session?.last_activity_at || null,
          orphan_ttl_ms: RECORDER_ORPHAN_TTL_MS
        },
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to inspect recorder session";
      await appendEvent(transaction.id, {
        level: "warning",
        phase: "recorder.orphan.inspect_failed",
        message,
        details: {
          recorder_session_id: sessionId,
          engine_base_url: baseUrl
        }
      }).catch(() => null);
    }
  }

  return {
    checked,
    stopped
  };
};

exports.startRecorderSession = async ({
  test_case_id,
  start_url,
  recorder_mode,
  recorder_target,
  engine_base_url,
  recorder_public_base_url,
  reuse_existing,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  target_step_id,
  created_by
} = {}) => {
  const testCaseId = normalizeText(test_case_id);

  if (!testCaseId) {
    throw new Error("test_case_id is required");
  }

  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const steps = await selectStepsForCase.all(testCaseId);
  const targetStepId = normalizeText(target_step_id);

  if (targetStepId && !steps.some((step) => step.id === targetStepId)) {
    throw new Error("The selected recorder target step does not belong to this test case.");
  }
  const buildContext = await resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  const integration = await resolveTestEngineIntegration(testCase);
  const recorderMode = normalizeText(recorder_mode) === "local" ? "local" : "remote";
  const targetStep = targetStepId ? steps.find((step) => step.id === targetStepId) : null;
  if (targetStep?.step_type === "api") throw new Error("Use the request editor for API steps; choose a Web or native step for recording.");
  const recorderTarget = targetStep ? (isMobileAppType(targetStep.step_type) ? "mobile" : "web")
    : isMobileRecorderTarget(recorder_target) || isMobileAppType(testCase.app_type_kind)
      || (steps.some((step) => isMobileAppType(step.step_type)) && !steps.some((step) => step.step_type === "web")) ? "mobile" : "web";
  const mobilePlatform = recorderTarget === "mobile" ? resolveMobileRecorderPlatform({ applicationPlatform: testCase.app_type_kind, steps, targetStepId, configuration: buildContext.configuration || integration.config }) : null;

  if (recorderTarget === "mobile") {
    await mobileFeatureService.assertMobileFeatureEnabled();
    const access = await getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!access["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to record native automation."), { statusCode: 403 });
  }

  if (recorderTarget === "mobile" && recorderMode === "remote" && !hasRemoteMobileProvider(integration)) {
    throw new Error("Configure a mobile cloud provider connection before starting remote mobile recording.");
  }

  const localBaseUrl = recorderMode === "local" && recorderTarget === "web" ? normalizeLocalEngineBaseUrl(engine_base_url) : null;
  const baseUrl = String(localBaseUrl || integration.base_url || "").replace(/\/+$/, "");
  const mobileBaseUrl = (recorderTarget === "mobile" && recorderMode === "local"
    ? normalizeText(engine_base_url) || resolveMobileEngineBaseUrl(integration, recorderMode)
    : resolveMobileEngineBaseUrl(integration, recorderMode)).replace(/\/+$/, "");
  const publicBaseUrl = String(
    recorderTarget === "mobile"
      ? normalizeText(recorder_public_base_url) || mobileBaseUrl
      : recorderMode === "local"
      ? normalizeText(recorder_public_base_url) || resolveRecorderPublicBaseUrl(integration, baseUrl, recorderMode)
      : resolveRecorderPublicBaseUrl(integration, baseUrl, recorderMode)
    || baseUrl
  ).replace(/\/+$/, "");
  const resolvedStartUrl = normalizeText(start_url) || testCase.automation_start_url || buildContext.environment?.base_url || null;
  const sessionEndpoint = recorderTarget === "mobile"
    ? `${mobileBaseUrl}/api/v1/mobile/recorder/sessions`
    : `${baseUrl}/api/v1/recorder/sessions`;
  const session = await (recorderTarget === "mobile" ? readMobileEngineJson : readEngineJson)(sessionEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      start_url: resolvedStartUrl,
      reuse_existing: recorderMode === "local" && recorderTarget === "web" && reuse_existing !== false,
      purpose: "automation-recording",
      recorder_mode: recorderMode,
      platform_name: mobilePlatform || undefined,
      platform_version: recorderTarget === "mobile" ? buildContext.configuration?.targets?.find((target) => target.mobile_os?.toLowerCase() === mobilePlatform)?.version || buildContext.configuration?.platform_version || undefined : undefined,
      provider: recorderTarget === "mobile" ? integration.config?.mobile_cloud_provider || "local-appium" : undefined,
      config: recorderTarget === "mobile" ? integration.config || {} : undefined,
      test_case: {
        id: testCase.id,
        title: testCase.title,
        description: testCase.description || "",
        steps: steps.map(summarizeStep)
      }
    })
  });
  const transaction = await workspaceTransactionService.createTransaction({
    project_id: testCase.project_id || null,
    app_type_id: testCase.app_type_id || null,
    category: "automation_build",
    action: "test_case_recorder",
    status: "running",
    title: `Recorder session for ${testCase.title}`,
    description: recorderTarget === "mobile"
      ? `A Mobile Engine recorder session is capturing ${mobilePlatform === "ios" ? "iOS" : "Android"} interactions.`
      : "A local Test Engine browser recorder session is capturing user actions and API requests.",
    metadata: {
      current_phase: "recorder.running",
      progress_percent: 20,
      test_case_id: testCase.id,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null,
      recorder_session_id: session.id,
      recorder_started_at: session.started_at || new Date().toISOString(),
      recorder_last_activity_at: session.last_activity_at || session.started_at || null,
      engine_base_url: baseUrl,
      mobile_engine_base_url: recorderTarget === "mobile" ? mobileBaseUrl : null,
      recorder_mode: recorderMode,
      recorder_target: recorderTarget,
      platform_name: mobilePlatform,
      recorder_public_base_url: publicBaseUrl,
      target_step_id: targetStepId || null
    },
    related_kind: "test_case",
    related_id: testCase.id,
    created_by,
    started_at: new Date().toISOString()
  });

  await appendEvent(transaction.id, {
    phase: "recorder.started",
    message: session.live_view_path || session.live_view_url
      ? `Started a ${recorderTarget} recorder session with a HelloTest live view.`
      : `Started a ${recorderTarget} recorder session.`,
    details: {
      recorder_session_id: session.id,
      engine_base_url: baseUrl,
      mobile_engine_base_url: recorderTarget === "mobile" ? mobileBaseUrl : null,
      recorder_mode: recorderMode,
      recorder_target: recorderTarget,
      platform_name: mobilePlatform,
      target_step_id: targetStepId || null,
      display_mode: session.display_mode || null,
      live_view_available: Boolean(session.live_view_path || session.live_view_url),
      reused_existing_session: session.reused === true,
      start_url: resolvedStartUrl,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null
    }
  });

  return {
    ...session,
    transaction_id: transaction.id,
    engine_base_url: baseUrl,
    recorder_target: recorderTarget,
    platform_name: mobilePlatform,
    target_step_id: targetStepId || null,
    live_view_url: buildEngineUrl(publicBaseUrl, session.live_view_url || session.live_view_path),
    status_url: buildEngineUrl(
      publicBaseUrl,
      session.status_url || (recorderTarget === "mobile"
        ? `/api/v1/mobile/recorder/sessions/${session.id}`
        : `/api/v1/recorder/sessions/${session.id}`)
    )
  };
};

exports.finishRecorderSession = async ({
  test_case_id,
  recorder_session_id,
  transaction_id,
  integration_id,
  additional_context,
  agent_context,
  recorder_mode,
  recorder_target,
  engine_base_url,
  target_step_id,
  included_action_indices,
  created_by
} = {}) => {
  const testCaseId = normalizeText(test_case_id);
  const sessionId = normalizeText(recorder_session_id);

  if (!testCaseId || !sessionId) {
    throw new Error("test_case_id and recorder_session_id are required");
  }

  let testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const engineIntegration = await resolveTestEngineIntegration(testCase);
  const transactionId = normalizeText(transaction_id);
  const transaction = transactionId
    ? await workspaceTransactionService.getTransaction(transactionId).catch(() => null)
    : null;
  const metadata = parseTransactionMetadata(transaction);
  if (transaction && (metadata.test_case_id !== testCaseId || metadata.recorder_session_id !== sessionId)) throw new Error("The recorder transaction does not belong to this case and session.");
  let targetStepId = normalizeText(target_step_id) || normalizeText(metadata.target_step_id);
  const targetSteps = await selectStepsForCase.all(testCaseId);

  if (targetStepId && !targetSteps.some((step) => step.id === targetStepId)) {
    throw new Error("The selected recorder target step does not belong to this test case.");
  }
  const requestedTarget = normalizeText(metadata.recorder_target) || normalizeText(recorder_target);
  const target = requestedTarget ? (isMobileRecorderTarget(requestedTarget) ? "mobile" : "web")
    : isMobileAppType(testCase.app_type_kind) || targetSteps.some((step) => step.id === targetStepId && isMobileAppType(step.step_type)) ? "mobile" : "web";
  if (target === "mobile") {
    await mobileFeatureService.assertMobileFeatureEnabled();
    const access = await getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!access["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to save native automation."), { statusCode: 403 });
  }
  const localBaseUrl = normalizeText(recorder_mode) === "local" && target !== "mobile" ? normalizeLocalEngineBaseUrl(engine_base_url) : null;
  const baseUrl = String(localBaseUrl || metadata.engine_base_url || engineIntegration.base_url || "").replace(/\/+$/, "");
  const mobileBaseUrl = String(metadata.mobile_engine_base_url || resolveMobileEngineBaseUrl(engineIntegration, normalizeText(recorder_mode) || metadata.recorder_mode || "remote")).replace(/\/+$/, "");
  const sessionBaseUrl = target === "mobile" ? mobileBaseUrl : baseUrl;
  const sessionPath = target === "mobile" ? "/api/v1/mobile/recorder/sessions" : "/api/v1/recorder/sessions";
  const readRecorderEngineJson = target === "mobile" ? readMobileEngineJson : readEngineJson;
  const session = await readRecorderEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}`);
  const mobilePlatform = target === "mobile" ? resolveMobileRecorderPlatform({ applicationPlatform: testCase.app_type_kind, steps: targetSteps, targetStepId, recordedPlatform: session.platform || session.platform_name || metadata.platform_name }) : null;
  const allCapturedActions = normalizeCapturedActions(session.actions || []);
  if ((session.action_count || session.actions?.length || 0) > allCapturedActions.length) throw new Error(`This recording exceeds the ${MAX_CAPTURED_ACTIONS}-action build limit. Record a smaller flow or split it into reusable groups; incomplete recordings will not replace the plan.`);
  const selectedActionIndices = Array.isArray(included_action_indices) ? new Set(included_action_indices.map(Number)) : null;
  if (selectedActionIndices) {
    const recordedIndices = new Set(allCapturedActions.map((action) => action.index));
    if ([...selectedActionIndices].some((index) => !Number.isSafeInteger(index) || !recordedIndices.has(index))) {
      throw Object.assign(new Error("The selected recorder actions are no longer available. Refresh the recording before saving."), { code: "AUTOMATION_RECORDER_ACTIONS_CHANGED", statusCode: 409 });
    }
  }
  // Selection is a subset of the recording, not a new action order. Preserve
  // capture chronology and deduplicate before compiling code.
  const capturedActions = selectedActionIndices ? allCapturedActions.filter((action) => selectedActionIndices.has(action.index)) : allCapturedActions;
  const capturedNetwork = normalizeCapturedNetwork(session.network || []);
  const preparedTarget = capturedActions.length
    ? await automationCasePreparationService.prepareAutomationTarget({ testCaseId, createdBy: created_by, targetStepId, startUrl:session.start_url||metadata.start_url||null })
    : { test_case_id: testCaseId, source_test_case_id: null, target_step_id: targetStepId };
  if (preparedTarget.test_case_id !== testCaseId) {
    testCase = await selectCaseWithScope.get(preparedTarget.test_case_id);
    targetStepId = preparedTarget.target_step_id;
  }


  await readRecorderEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}/stop`, {
    method: "POST"
  }).catch(() => null);

  if (target === "mobile") {
    const repositoryModel = await buildRecorderRepositoryModel({
      testCase,
      capturedActions,
      integrationId: integration_id,
      userId: created_by,
      transactionId,
      platform: mobilePlatform
    });
    const stepUpdates = await persistMobileRecorderPlan({
      caseId: testCase.id,
      applicationPlatform: testCase.app_type_kind,
      capturedActions,
      targetStepId,
      repositoryReferences: repositoryModel.byActionIndex,
      platform: mobilePlatform
    }, {
      transaction: (callback) => db.transaction(callback)(),
      lockCase: (caseId) => db.prepare("SELECT id FROM test_cases WHERE id = ? FOR UPDATE").get(caseId),
      readSteps: (caseId) => db.prepare("SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC FOR UPDATE").all(caseId),
      updateStep: testStepService.updateTestStep,
      createStep: testStepService.createTestStep,
      updateCaseReadiness: (caseId) => markTestCaseAutomationReady.run(normalizeText(created_by), caseId)
    });
    const learnedCount = await persistLearning({
      testCase,
      learnedLocators: [],
      capturedActions,
      capturedNetwork,
      transactionId,
      repositoryModel,
      integrationId: integration_id
    });
    await workspaceTransactionService.updateTransaction(transactionId, {
      status: "completed",
      metadata: {
        ...metadata,
        current_phase: "recorder.mobile.completed",
        progress_percent: 100,
        recorder_session_id: session.id,
        platform_name: mobilePlatform,
        action_count: capturedActions.length,
        learned_locator_count: learnedCount,
        updated_step_count: stepUpdates.filter((step) => step.operation === "updated").length,
        created_step_count: stepUpdates.filter((step) => step.operation === "created").length
      },
      completed_at: new Date().toISOString()
    }).catch(() => null);
    await appendEvent(transactionId, {
      level: stepUpdates.length ? "success" : "warning",
      phase: "recorder.mobile.steps.created",
      message: stepUpdates.length
        ? `Mobile recorder saved ${stepUpdates.length} ${mobilePlatform === "ios" ? "iOS" : "Android"} keyword step${stepUpdates.length === 1 ? "" : "s"}.`
        : `Mobile recorder stopped without captured ${mobilePlatform === "ios" ? "iOS" : "Android"} actions.`,
      details: {
        recorder_session_id: session.id,
        action_count: capturedActions.length,
        learned_locator_count: learnedCount,
        step_count: stepUpdates.length
      }
    });
    return {
      test_case_id: testCase.id,
      source_test_case_id: preparedTarget.source_test_case_id,
      generated_step_count: stepUpdates.length,
      created_step_count: stepUpdates.filter((step) => step.operation === "created").length,
      updated_step_count: stepUpdates.filter((step) => step.operation === "updated").length,
      learned_locator_count: learnedCount,
      message: stepUpdates.length
        ? `Mobile recorder stopped and ${mobilePlatform === "ios" ? "iOS" : "Android"} keyword steps were saved.`
        : `Mobile recorder stopped. No ${mobilePlatform === "ios" ? "iOS" : "Android"} actions were captured.`,
      step_updates: stepUpdates,
      recorder_session: {
        id: session.id,
        platform_name: mobilePlatform,
        action_count: capturedActions.length,
        network_count: capturedNetwork.length
      }
    };
  }

  const result = await finalizeRecorderBuild({
    testCase,
    session,
    createdBy: created_by,
    transactionId: transaction_id,
    capturedActions,
    capturedNetwork,
    integrationId: integration_id,
    additionalContext: additional_context,
    targetStepId
  });

  return {
    ...result,
    test_case_id: testCase.id,
    source_test_case_id: preparedTarget.source_test_case_id,
    recorder_session: {
      id: session.id,
      action_count: capturedActions.length,
      network_count: capturedNetwork.length
    }
  };
};

exports.connectCaseBrowser = async ({projectId,appTypeId,user,caseId,environmentId,startUrl,allowBrowserActions=false,signal}) => {
  const testCase=await selectCaseWithScope.get(caseId);
  if(!testCase || testCase.project_id!==projectId || appTypeId && testCase.app_type_id!==appTypeId)throw Object.assign(new Error("The automation case is unavailable in this application."),{statusCode:404});
  const permissions=["automation.view","automation.code.view","automation.ai","testcase.view",...(allowBrowserActions?["automation.build"]:[]),...(environmentId?["environment.view"]:[])];
  const access=await getOptionalEvidenceAccess(user,projectId,permissions);
  if(permissions.some(key=>!access[key]))throw Object.assign(new Error("Automation browser evidence requires case, code, AI and selected environment access; browser interactions also require build permission."),{statusCode:403});
  const steps=await selectStepsForCase.all(caseId);
  if(!steps.some(step=>normalizeTestStepType(step.step_type,"web")==="web"))throw Object.assign(new Error("Playwright MCP supports web sections; API-only or native mobile cases use their own runtime."),{statusCode:422});
  const buildContext=await resolveBuildContext({testCase,test_environment_id:environmentId});
  const url=resolveAutomationStartUrl({startUrl,caseUrl:testCase.automation_start_url,steps,required:true}).url;
  if(!url)throw Object.assign(new Error("Select an environment with a start URL for live Playwright MCP inspection."),{statusCode:422});
  const engine=await resolveTestEngineIntegration(testCase);
  const parameterContext=await loadAutomationParameterContext({testCase,projectId,userId:user.id});
  const browserParameters=await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase,projectId,userId:user.id,caseValues:parameterContext.runtime_parameter_values,privateParameterNames:parameterContext.private_parameter_names,parameterOverrides:parameterContext.parameter_overrides,test_environment_id:environmentId});
  const browser=await connectAutomationBrowser({integration:engine,startUrl:url,allowBrowserActions,signal});
  const call=browser.call;
  browser.call=async(name,args)=>{const current=await getOptionalEvidenceAccess(user,projectId,[...permissions,'data.view']);if(permissions.some(key=>!current[key])||browserParameters.requiresDataAccess(name,args)&&!current['data.view'])throw Object.assign(new Error("Automation browser access changed."),{statusCode:403});try{return browserParameters.redactResult(await call(name,browserParameters.resolve(name,args)));}catch(error){throw browserParameters.redactError(error);}};
  return {browser,startUrl:url};
};

exports.loadAutomationAgentCaseContext = async ({projectId,appTypeId,user,caseId}) => {
  const testCase=await selectCaseWithScope.get(caseId);
  const permissions=["testcase.view","automation.view","automation.code.view"];
  const access=await getOptionalEvidenceAccess(user,projectId,[...permissions,"data.view"]);
  if(permissions.some(key=>!access[key]))throw Object.assign(new Error("Case and automation code access are required."),{statusCode:403});
  if(!testCase||testCase.project_id!==projectId||appTypeId&&testCase.app_type_id!==appTypeId)throw Object.assign(new Error("The case is unavailable in this application."),{statusCode:404});
  const parameters=await loadAutomationParameterContext({testCase,projectId,userId:user.id});
  const manual=await loadAutomationManualContext({caseId,projectId,userId:user.id}),sections=(await selectStepsForCase.all(caseId)).map(summarizeStep);
  // Preview resolves static authorized values only. Random generators are
  // materialized once by the actual build, then shown from its pinned artifact.
  const resolver=await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase,projectId,userId:user.id,
    caseValues:parameters.runtime_parameter_values,privateParameterNames:parameters.private_parameter_names,parameterOverrides:parameters.parameter_overrides,steps:[...sections,...manual.flatMap(item=>item.steps)],materialize:false,allowUnselectedSuite:true});
  return {linked_manual_cases:resolver.projectManualCases(manual),case:{...resolver.projectCase({id:testCase.id,title:testCase.title,description:testCase.description,gherkin_document:testCase.gherkin_document,priority:testCase.priority,labels:safeJson(testCase.labels,[])}),parameter_values:resolver.publicParameterValues},
    sections:resolver.projectSteps(sections),deferred_parameter_references:resolver.deferredParameterNames,private_parameter_references:resolver.privateParameterNames,suite_selection_required:resolver.suite_selection_required===true,
    stories:await loadAutomationStoryContext({caseId,projectId,userId:user.id})};
};
