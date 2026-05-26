const db = require("../db");
const obsDb = require("../obsDb");
const { v4: uuid } = require("uuid");
const integrationService = require("./integration.service");
const testCaseService = require("./testCase.service");
const testStepService = require("./testStep.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const testEnvironmentService = require("./testEnvironment.service");
const testConfigurationService = require("./testConfiguration.service");
const testDataSetService = require("./testDataSet.service");
const aiKnowledgeService = require("./aiKnowledge.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("../utils/testStepAutomation");
const { createLlmProviderError } = require("../utils/upstreamLlmError");

const LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.AUTOMATION_BUILDER_LLM_TIMEOUT_MS || 90_000));
const ENGINE_TIMEOUT_MS = Math.max(2_000, Number(process.env.AUTOMATION_BUILDER_ENGINE_TIMEOUT_MS || 15_000));
const MAX_CACHE_ROWS = 40;
const MAX_CAPTURED_ACTIONS = 180;
const MAX_CAPTURED_NETWORK = 80;
const DEFAULT_BATCH_FAILURE_THRESHOLD = Math.max(1, Number(process.env.AUTOMATION_BUILDER_BATCH_FAILURE_THRESHOLD || 3));
const RECORDER_ORPHAN_TTL_MS = Math.max(60_000, Number(process.env.RECORDER_ORPHAN_TTL_MS || 3 * 60_000));

const selectCaseWithScope = obsDb.prepare(`
  SELECT
    test_cases.*,
    app_types.name AS app_type_name,
    app_types.type AS app_type_kind,
    app_types.project_id,
    projects.name AS project_name
  FROM test_cases
  LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
  LEFT JOIN projects ON projects.id = app_types.project_id
  WHERE test_cases.id = ?
`);

const selectStepsForCase = obsDb.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const selectCompanionApiCasesForSource = db.prepare(`
  SELECT id, title
  FROM test_cases
  WHERE app_type_id = ?
    AND external_references @> ?::jsonb
  ORDER BY created_at ASC, id ASC
`);

const selectCasesForBatch = db.prepare(`
  SELECT test_cases.id
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.app_type_id = ?
    AND COALESCE(test_cases.automated, 'no') <> 'yes'
    AND app_types.type IN ('web', 'unified')
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

const upsertLearningCache = obsDb.prepare(`
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

const selectLearningCacheEntry = obsDb.prepare(`
  SELECT *
  FROM automation_learning_cache
  WHERE id = ?
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

const listLearningCacheRows = async ({ projectId, appTypeId, limit = MAX_CACHE_ROWS } = {}) => {
  let query = `
    SELECT *
    FROM automation_learning_cache
    WHERE 1 = 1
  `;
  const params = [];

  if (projectId) {
    query += ` AND project_id = ?`;
    params.push(projectId);
  }

  if (appTypeId) {
    query += ` AND app_type_id = ?`;
    params.push(appTypeId);
  }

  query += ` ORDER BY hit_count DESC, updated_at DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(200, Number(limit) || MAX_CACHE_ROWS)));

  return obsDb.prepare(query).all(...params);
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
      value: entry?.is_secret ? "[secret]" : String(entry?.value ?? ""),
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

        accumulator[normalizedKey] = String(value ?? "");
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
          row_count: Array.isArray(scopedDataSet.rows) ? scopedDataSet.rows.length : 0
        }
      : null
  };
};

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
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
    throw new Error("Unable to parse JSON from the LLM response");
  }
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = LLM_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const resolveLlmIntegration = async (integrationId, { allowFallback = true } = {}) => {
  const integration = integrationId
    ? await integrationService.getIntegration(integrationId)
    : await integrationService.getActiveIntegrationByType("llm");

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

const requestChatCompletion = async ({ integration, prompt }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You are QAira Pilot, a senior test automation engineer.",
            "Return strict JSON only.",
            "Generate deterministic QAira web keyword automation that runs in the QAira Test Engine Playwright facade.",
            "Never invent business assertions that are not present in the manual case."
          ].join(" ")
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  }, LLM_TIMEOUT_MS);

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const normalizeUrlKey = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "unknown-page";
  }

  try {
    const parsed = new URL(normalized, "http://qaira.local");
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
  const title = normalizeText(action?.page_title);
  if (title && !/^about:blank$/i.test(title)) {
    return toObjectSegment(title, "Screen").slice(0, 48);
  }

  const url = normalizeText(action?.url);
  if (!url) {
    return "Screen";
  }

  try {
    const parsed = new URL(url, "http://qaira.local");
    const segments = parsed.pathname.split("/").map((part) => normalizeText(part)).filter(Boolean);
    return toObjectSegment(segments.at(-1) || parsed.hostname || "Screen", "Screen").slice(0, 48);
  } catch {
    return toObjectSegment(url.split(/[/?#]/).filter(Boolean).at(-1), "Screen").slice(0, 48);
  }
};

const inferObjectRole = (action) => {
  const type = String(action?.type || "").toLowerCase();
  const locator = String(action?.locator || "").toLowerCase();
  const text = String(action?.text || "").toLowerCase();

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

const inferKeywordForAction = (action) => {
  const type = String(action?.type || "").toLowerCase();

  if (type === "navigation") {
    return "web.goto";
  }
  if (type === "fill" || type === "change") {
    return "web.fill";
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

const buildObjectRepositoryEntry = (action) => {
  const locator = normalizeText(action?.locator);
  if (!locator || ["location", "browser.tab", "keyboard", "viewport"].includes(locator)) {
    return null;
  }

  const screenName = inferScreenName(action);
  const role = inferObjectRole(action);
  const label = inferObjectLabel(action) || `${role} ${action?.index || ""}`.trim();
  const fieldName = toObjectSegment(label, toObjectSegment(role));
  const objectName = `${toObjectSegment(screenName, "Screen")}.${fieldName}`;

  return {
    screen_name: screenName,
    field_name: fieldName,
    object_name: objectName,
    object_role: role,
    object_label: label,
    keyword: inferKeywordForAction(action),
    parameter_hint: role === "field" ? inferRecorderFillValue(action) : null
  };
};

const summarizeStep = (step) => ({
  id: step.id,
  order: Number(step.step_order || 0),
  type: step.step_type || "web",
  action: step.action || "",
  expected_result: step.expected_result || "",
  has_existing_automation: Boolean(normalizeRichText(step.automation_code) || normalizeApiRequest(step.api_request)),
  existing_automation_code: normalizeRichText(step.automation_code),
  existing_api_request: normalizeApiRequest(step.api_request)
});

const summarizeCache = (rows = []) =>
  rows.map((row) => ({
    page_key: row.page_key,
    page_url: row.page_url,
    intent: row.locator_intent,
    locator: row.locator,
    kind: row.locator_kind || "unknown",
    confidence: Number(row.confidence || 0),
    hit_count: Number(row.hit_count || 0)
  }));

const summarizeKnowledge = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      title: row.title,
      description: row.description || "",
      content_type: row.content_type || "text",
      content: normalizeRichText(row.content).slice(0, 4000),
      source_uri: row.source_uri || null
    }))
    .filter((row) => row.title || row.content);

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
      x: Number.isFinite(Number(action?.x)) ? Number(action.x) : null,
      y: Number.isFinite(Number(action?.y)) ? Number(action.y) : null,
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

  const match = normalized.match(/^(label|placeholder)=(.+)$/i);
  return match ? normalizeText(match[2]) : normalized;
};

const resolveRecorderTarget = (action) => {
  const locator = stripRecorderLocatorPrefix(action.locator);

  if (locator && !["browser.tab", "location", "keyboard", "viewport"].includes(locator)) {
    return locator;
  }

  return normalizeText(action.text);
};

const quoteCodeString = (value) => JSON.stringify(String(value || ""));

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

const describeRecorderTarget = (action, fallback) =>
  normalizeText(action.text)
  || stripRecorderLocatorPrefix(action.locator)
  || fallback;

const buildRecorderStepCandidate = (action, order) => {
  const type = String(action.type || "").toLowerCase();
  const target = resolveRecorderTarget(action);
  const targetLabel = describeRecorderTarget(action, "recorded target");
  const url = normalizeText(action.url);
  const key = normalizeText(action.text || action.value);

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
      automation_code: `await web.goto(${quoteCodeString(url)});`
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
      automation_code: `await web.click(${quoteCodeString(target)}, ${WEB_ELEMENT_OPTIONS_CODE});`
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
      automation_code: [
        `// TODO: Replace this fallback with a stable locator for the recorded click${position}.`,
        `await web.click("body", ${WEB_ELEMENT_OPTIONS_CODE});`
      ].join("\n")
    };
  }

  if (type === "dblclick" || type === "rightclick") {
    if (!target) {
      return null;
    }

    const verb = type === "dblclick" ? "Double click" : "Right click";
    const method = type === "dblclick" ? "dblclick" : "rightClick";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${verb} ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      automation_code: `await web.${method}(${quoteCodeString(target)}, ${WEB_ELEMENT_OPTIONS_CODE});`
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
      automation_code: `await web.fill(${quoteCodeString(target)}, ${quoteCodeString(value)}, ${WEB_TYPE_OPTIONS_CODE});`
      };
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Fill recorded field",
      expected_result: "Review the locator before running this step.",
      step_type: "web",
      automation_code: [
        "// TODO: Replace this fallback with a stable locator for the recorded field.",
        `await web.fill("body", ${quoteCodeString(value)}, ${WEB_TYPE_OPTIONS_CODE});`
      ].join("\n")
    };
  }

  if (type === "select") {
    const value = normalizeRichText(action.value) || normalizeRichText(action.text) || "@t.value";

    if (target) {
      return {
        source_action_index: action.index,
        step_order: order,
        action: `Select ${describeRecorderTarget(action, value)} in ${targetLabel}`,
        expected_result: "",
        step_type: "web",
      automation_code: `await web.select(${quoteCodeString(target)}, ${quoteCodeString(value)}, ${WEB_ELEMENT_OPTIONS_CODE});`
      };
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: "Select recorded dropdown value",
      expected_result: "Review the locator before running this step.",
      step_type: "web",
      automation_code: [
        "// TODO: Replace this fallback with a stable locator for the recorded dropdown.",
        `await web.select("select", ${quoteCodeString(value)}, ${WEB_ELEMENT_OPTIONS_CODE});`
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
      automation_code: `await web.${type}(${quoteCodeString(target)}, ${WEB_ELEMENT_OPTIONS_CODE});`
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
      automation_code: `await web.press(null, ${quoteCodeString(normalizedKey)}, ${WEB_ELEMENT_OPTIONS_CODE});`
    };
  }

  if (type === "tab") {
    return {
      source_action_index: action.index,
      step_order: order,
      action: "Press Tab",
      expected_result: "",
      step_type: "web",
      automation_code: `await web.press(null, "Tab", ${WEB_ELEMENT_OPTIONS_CODE});`
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
      automation_code: `await web.scroll(${Number.isFinite(deltaX) ? deltaX : 0}, ${Number.isFinite(deltaY) ? deltaY : 600}, ${keywordOptionsCode({ direction: Number(deltaY) < 0 ? "up" : "down", amount: Math.abs(Number(deltaY) || 600) })});`
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

  if ((type === "change" || type === "fill" || type === "select" || type === "check" || type === "uncheck") && action.locator) {
    const previousSameLocator = actions.slice(0, index).some((candidate) =>
      ["fill", "change", "select", "check", "uncheck"].includes(String(candidate.type || "").toLowerCase())
      && candidate.locator === action.locator
      && Math.abs(parseActionTimestamp(candidate.timestamp) - parseActionTimestamp(action.timestamp)) < 12_000
    );
    const laterSameLocator = actions.slice(index + 1).some((candidate) =>
      ["fill", "change", "select", "check", "uncheck"].includes(String(candidate.type || "").toLowerCase())
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

const buildRecorderStepCandidates = (actions = []) => {
  const allowedTypes = new Set(["navigation", "click", "dblclick", "rightclick", "fill", "change", "select", "check", "uncheck", "submit", "press", "tab", "scroll"]);
  const candidates = [];

  actions.forEach((action, index) => {
    const type = String(action.type || "").toLowerCase();

    if (!allowedTypes.has(type) || isRecorderActionSuperseded(action, actions, index)) {
      return;
    }

    const candidate = buildRecorderStepCandidate(action, candidates.length + 1);

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

  return [...byStepId.values()].sort((left, right) => Number(left.step.step_order || 0) - Number(right.step.step_order || 0));
};

const buildRecorderMappingPrompt = ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  additionalContext
}) => [
  "Map recorded browser automation snippets onto the existing QAira manual test steps.",
  "",
  "Rules:",
  "- Preserve the manual step rows, manual action text, and expected result text.",
  "- Attach one or more recorded automation snippets to the manual step they best satisfy.",
  "- Prefer semantic flow order, but use action/target meaning when the recording and manual text differ.",
  "- Do not invent new business assertions or new manual steps.",
  "- It is valid to map multiple recorded snippets to one manual step.",
  "",
  "Return strict JSON only with this shape:",
  "{",
  '  "summary": "string",',
  '  "mappings": [',
  "    {",
  '      "manual_step_id": "existing step id",',
  '      "source_action_indexes": [1, 2],',
  '      "confidence": 0.8',
  "    }",
  "  ]",
  "}",
  "",
  `Case: ${testCase.title}`,
  `Description: ${testCase.description || "No description provided."}`,
  "",
  "Manual steps:",
  JSON.stringify(manualSteps.map(summarizeStep), null, 2),
  "",
  "Recorded automation snippets:",
  JSON.stringify(stepCandidates.map((candidate) => ({
    source_action_index: candidate.source_action_index,
    generated_order: candidate.step_order,
    action: candidate.action,
    expected_result: candidate.expected_result,
    automation_code: candidate.automation_code
  })), null, 2),
  "",
  "Raw recorder actions:",
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
    mappings: [...groupsByStepId.values()]
  };
};

const buildAiRecorderMappings = async ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  integrationId,
  additionalContext,
  transactionId
}) => {
  let integration = null;

  try {
    integration = await resolveLlmIntegration(integrationId);
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
  candidates
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
  const prompt = [
    "Build automation for this QAira manual web test case.",
    "",
    "Runtime contract:",
    "- Use QAira keyword/facade calls only: web.aiStep, web.goto, web.click, web.dblclick, web.rightClick, web.fill, web.select, web.check, web.uncheck, web.press, web.scroll, web.wait, web.expectVisible, web.expectText, web.expectUrl, capture.",
    "- Each step automation_code must be executable JavaScript statements, not a full Playwright test file.",
    "- Include tweakable element-level option objects directly in keyword calls where relevant: timeoutMs, scroll, waitFor, force, clear, type, delayMs, direction, amount, match.",
    "- For text entry, prefer char-by-char typing by default: web.fill(target, value, { timeoutMs: 10000, scroll: \"nearest\", waitFor: \"visible\", clear: true, type: \"char-by-char\", delayMs: 35 }).",
    "- For scrolls, use web.scroll(0, 600, { direction: \"down\", amount: 600 }) or direction \"up\" when reversing.",
    "- Prefer semantic locators: getByRole-style text, labels, placeholders, data-testid, id/name, then CSS. In QAira keyword code pass the best target string to web.click/web.fill/etc.",
    "- Use @t.variable_name tokens when the manual case implies reusable data.",
    "- For API requests inferred from captured network, create api_request objects only for meaningful business API calls and ignore analytics, fonts, images, telemetry, auth refresh noise, and static assets.",
    "- Preserve the manual step sequence. Do not add hidden side-effect steps.",
    "- When existing automation code is supplied, map it to the manual step with the closest intent and flow position; express supported UI actions as QAira keyword calls instead of opaque code.",
    "- Reuse learning cache locators when they match the step intent and page.",
    "",
    "Return strict JSON with this shape:",
    "{",
    '  "summary": "string",',
    '  "base_url": "string or null",',
    '  "steps": [',
    "    {",
    '      "step_id": "string",',
    '      "step_order": 1,',
    '      "step_type": "web or api",',
    '      "automation_code": "await web.click(...);",',
    '      "api_request": null',
    "    }",
    "  ],",
    '  "learned_locators": [',
    "    {",
    '      "page_url": "string or null",',
    '      "page_key": "login",',
    '      "intent": "login submit button",',
    '      "locator": "button:has-text(\\"Sign in\\")",',
    '      "kind": "role|label|placeholder|testid|css|text",',
    '      "confidence": 0.88',
    "    }",
    "  ]",
    "}",
    "",
    `Project: ${testCase.project_name || testCase.project_id || "Unknown project"}`,
    `App type: ${testCase.app_type_name || testCase.app_type_id || "Unknown app"} (${testCase.app_type_kind || "web"})`,
    `Case: ${testCase.title}`,
    `Description: ${testCase.description || "No description provided."}`,
    `Start URL: ${startUrl || "Not provided"}`,
    "",
    "Execution context selected for automation:",
    JSON.stringify(buildContext || { environment: null, configuration: null, data_set: null }, null, 2),
    "",
    "Manual steps:",
    JSON.stringify(steps.map(summarizeStep), null, 2),
    "",
    "Reusable test data:",
    JSON.stringify(safeJson(testCase.parameter_values, {}), null, 2),
    "",
    "Learning cache:",
    JSON.stringify(summarizeCache(cacheRows), null, 2),
    "",
    "AI Knowledge / local agent education:",
    JSON.stringify(summarizeKnowledge(knowledgeRows), null, 2)
  ];

  if (capturedActions.length) {
    prompt.push("");
    prompt.push("Recorder actions:");
    prompt.push(JSON.stringify(capturedActions, null, 2));
  }

  if (capturedNetwork.length) {
    prompt.push("");
    prompt.push("Captured network requests:");
    prompt.push(JSON.stringify(capturedNetwork, null, 2));
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional builder guidance:");
    prompt.push(additionalContext);
  }

  return prompt.join("\n");
};

const buildRepositoryImprovePrompt = ({ entry, guidance }) => [
  "Improve this QAira object repository entry for stable Test Engine execution.",
  "",
  "Return strict JSON with this shape:",
  "{",
  '  "page_key": "stable screen key",',
  '  "screen_name": "human readable screen name",',
  '  "object_name": "human readable field/control name",',
  '  "object_role": "button|textbox|link|checkbox|dropdown|field|view|mobile-control",',
  '  "locator": "best target locator string",',
  '  "locator_kind": "role|label|placeholder|testid|css|xpath|text|accessibility_id|android_uiautomator",',
  '  "target_criteria": ["primary criteria", "secondary criteria"],',
  '  "dom_structure": "short DOM/accessibility structure around the element",',
  '  "fallback_strategy": "how screenshot/visual fallback should be used if locator fails",',
  '  "confidence": 0.91',
  "}",
  "",
  "Rules:",
  "- Prefer stable semantic locators over brittle CSS/XPath.",
  "- For mobile objects, use accessibility id or Android UiAutomator when available.",
  "- Keep screenshot fallback descriptive; do not replace locator-first execution.",
  "- Preserve user supplied intent unless there is a clear naming improvement.",
  "",
  "Current repository entry:",
  JSON.stringify(entry, null, 2),
  "",
  guidance ? `User guidance:\n${guidance}` : "User guidance: none"
].join("\n");

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
    confidence: Math.max(0.72, clampNumber(entry.confidence, 0.72)),
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

const buildDeterministicWebCode = (step, cacheRows, startUrl) => {
  const action = normalizeRichText(step.action) || "";
  const expected = normalizeRichText(step.expected_result) || "";
  const lower = action.toLowerCase();
  const cachedLocator = findCachedLocator(step, cacheRows);
  const target = cachedLocator || inferLocatorText(step);
  const lines = [];

  const urlMatch = action.match(/https?:\/\/\S+|\/[A-Za-z0-9_./?=&%-]+/);

  if (/\b(open|navigate|go to|launch)\b/i.test(action)) {
    lines.push(`await web.goto(${JSON.stringify(urlMatch?.[0] || startUrl || "/")}, ${keywordOptionsCode({ timeoutMs: 30000, waitUntil: "domcontentloaded" })});`);
  } else if (/\b(click|tap|select|choose)\b/i.test(action)) {
    lines.push(`await web.click(${JSON.stringify(target)}, ${WEB_ELEMENT_OPTIONS_CODE});`);
  } else if (/\b(enter|type|fill|input)\b/i.test(action)) {
    const value = inferQuotedText(action) || "@t.value";
    lines.push(`await web.fill(${JSON.stringify(target)}, ${JSON.stringify(value)}, ${WEB_TYPE_OPTIONS_CODE});`);
  } else if (/\b(wait)\b/i.test(action)) {
    lines.push("await web.wait(1000);");
  } else if (/\b(press)\b/i.test(action)) {
    lines.push(`await web.press(${JSON.stringify(target)}, "Enter", ${WEB_ELEMENT_OPTIONS_CODE});`);
  } else {
    lines.push(`await web.expectVisible(${JSON.stringify(target)}, ${keywordOptionsCode({ timeoutMs: 10000, state: "visible" })});`);
  }

  if (expected) {
    const expectedQuoted = inferQuotedText(expected) || expected.replace(/^verify\s+(?:that\s+)?/i, "").slice(0, 120);

    if (/\b(url|redirect)\b/i.test(expected)) {
      lines.push(`await web.expectUrl(${JSON.stringify(expectedQuoted)}, ${keywordOptionsCode({ timeoutMs: 10000, match: "contains" })});`);
    } else {
      lines.push(`await web.expectText("body", ${JSON.stringify(expectedQuoted)}, ${keywordOptionsCode({ timeoutMs: 10000, match: "contains" })});`);
    }
  }

  return lines.join("\n");
};

const normalizeStepCandidate = (candidate, stepsById, stepsByOrder) => {
  if (!isPlainObject(candidate)) {
    return null;
  }

  const stepId = normalizeText(candidate.step_id || candidate.id);
  const stepOrder = Number(candidate.step_order || candidate.order);
  const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

  if (!step) {
    return null;
  }

  return {
    step,
    step_type: normalizeTestStepType(candidate.step_type || candidate.stepType, step.step_type || "web"),
    automation_code: normalizeRichText(candidate.automation_code || candidate.automationCode || candidate.code),
    api_request: normalizeApiRequest(candidate.api_request || candidate.apiRequest)
  };
};

const normalizeLlmBuild = (payload, steps, cacheRows, startUrl) => {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(steps.map((step) => [Number(step.step_order || 0), step]));
  const candidates = Array.isArray(payload?.steps) ? payload.steps : [];
  const byStepId = new Map();

  candidates.forEach((candidate) => {
    const normalized = normalizeStepCandidate(candidate, stepsById, stepsByOrder);
    if (normalized) {
      byStepId.set(normalized.step.id, normalized);
    }
  });

  const updates = steps.map((step) => {
    const candidate = byStepId.get(step.id);
    const stepType = candidate?.step_type || normalizeTestStepType(step.step_type, "web");
    const automationCode = candidate?.automation_code
      || (stepType === "web" ? buildDeterministicWebCode(step, cacheRows, startUrl) : null);

    return {
      step,
      step_type: stepType,
      automation_code: automationCode,
      api_request: stepType === "api" ? candidate?.api_request || normalizeApiRequest(step.api_request) : null
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
    .filter((item) => item.page_key && item.locator_intent && item.locator);

  return {
    summary: normalizeRichText(payload?.summary) || "Automation generated for the manual test case.",
    base_url: normalizeText(payload?.base_url || payload?.baseUrl),
    updates,
    learned_locators: learnedLocators
  };
};

const buildFallbackBuild = (steps, cacheRows, startUrl, reason) => ({
  summary: `Generated keyword starter automation${reason ? ` without LLM completion: ${reason}` : "."}`,
  base_url: startUrl || null,
  updates: steps.map((step) => ({
    step,
    step_type: normalizeTestStepType(step.step_type, "web"),
    automation_code: buildDeterministicWebCode(step, cacheRows, startUrl),
    api_request: null
  })),
  learned_locators: []
});

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

const createArtifactContent = ({ testCase, updates }) => {
  const lines = [
    `// QAira generated automation artifact`,
    `// Test case: ${testCase.title}`,
    `// Test case id: ${testCase.id}`,
    ""
  ];

  updates.forEach((update) => {
    lines.push(`// Step ${update.step.step_order}: ${update.step.action || "No action recorded"}`);
    if (update.api_request) {
      lines.push(`// API request: ${JSON.stringify(update.api_request)}`);
    }
    lines.push(update.automation_code || "// API request is stored structurally on the QAira step.");
    lines.push("");
  });

  return lines.join("\n");
};

const persistLearning = async ({ testCase, learnedLocators, capturedActions, capturedNetwork, transactionId }) => {
  let persisted = 0;

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

  for (const action of capturedActions) {
    if (!action.locator) {
      continue;
    }

    const objectRepositoryEntry = buildObjectRepositoryEntry(action);

    await upsertLearningCache.run(
      uuid(),
      testCase.project_id || null,
      testCase.app_type_id || null,
      testCase.id,
      action.url || null,
      normalizeUrlKey(action.url),
      objectRepositoryEntry?.object_name || action.text || action.type || "recorded action",
      action.locator,
      "recorder",
      objectRepositoryEntry ? 0.82 : 0.72,
      objectRepositoryEntry ? "object_repository" : "recorder",
      {
        action_type: action.type,
        value_captured: Boolean(action.value),
        ...(objectRepositoryEntry || {})
      }
    );
    persisted += 1;
  }

  if (capturedNetwork.length) {
    await appendEvent(transactionId, {
      phase: "recorder.network.learned",
      message: `Recorder captured ${capturedNetwork.length} candidate API request${capturedNetwork.length === 1 ? "" : "s"} for API test generation.`,
      details: {
        captured_network_count: capturedNetwork.length,
        sample: capturedNetwork.slice(0, 5)
      }
    });
  }

  return persisted;
};

const applyBuild = async ({ build }) => {
  const updated = [];

  for (const update of build.updates) {
    await testStepService.updateTestStep(update.step.id, {
      step_type: update.step_type,
      automation_code: update.automation_code,
      api_request: update.api_request
    });
    updated.push({
      step_id: update.step.id,
      step_order: update.step.step_order,
      step_type: update.step_type,
      has_code: Boolean(update.automation_code),
      has_api_request: Boolean(update.api_request)
    });
  }

  return updated;
};

const buildCaseCore = async ({
  test_case_id,
  integration_id,
  created_by,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  captured_actions = [],
  captured_network = [],
  additional_context,
  transaction_id
}) => {
  const testCase = await selectCaseWithScope.get(test_case_id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  if (!["web", "unified"].includes(String(testCase.app_type_kind || "web"))) {
    throw new Error("Automation builder currently supports web and unified app types");
  }

  const steps = await selectStepsForCase.all(test_case_id);

  if (!steps.length) {
    throw new Error("Add manual steps before building automation");
  }

  const cacheRows = await listLearningCacheRows({
    projectId: testCase.project_id || null,
    appTypeId: testCase.app_type_id || null,
    limit: MAX_CACHE_ROWS
  });
  const knowledgeRows = await aiKnowledgeService.getActiveKnowledgeForLLM(
    testCase.project_id || null,
    testCase.app_type_id || null
  );
  const capturedActions = normalizeCapturedActions(captured_actions);
  const capturedNetwork = normalizeCapturedNetwork(captured_network);
  const buildContext = await resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  const startUrl = normalizeText(start_url) || buildContext.environment?.base_url || null;
  let integration = null;
  let fallbackReason = null;
  let build = null;

  await appendEvent(transaction_id, {
    phase: "automation.context",
    message: `Packed ${steps.length} manual step${steps.length === 1 ? "" : "s"} with ${cacheRows.length} cached locator learning item${cacheRows.length === 1 ? "" : "s"} and ${knowledgeRows.length} active knowledge item${knowledgeRows.length === 1 ? "" : "s"}.`,
    details: {
      test_case_id,
      step_count: steps.length,
      cache_hits: cacheRows.length,
      knowledge_items: knowledgeRows.length,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null
    }
  });

  try {
    integration = await resolveLlmIntegration(integration_id);
  } catch (error) {
    throw error;
  }

  if (integration) {
    try {
      const prompt = buildPrompt({
        testCase,
        steps,
        cacheRows,
        knowledgeRows,
        capturedActions,
        capturedNetwork,
        buildContext,
        startUrl,
        additionalContext: normalizeRichText(additional_context)
      });
      const content = await requestChatCompletion({ integration, prompt });
      build = normalizeLlmBuild(extractJsonPayload(content), steps, cacheRows, startUrl);

      await appendEvent(transaction_id, {
        phase: "automation.llm.completed",
        message: `LLM generated ${build.updates.length} step automation update${build.updates.length === 1 ? "" : "s"}.`,
        details: {
          integration_id: integration.id,
          model: integration.model,
          generated_steps: build.updates.length,
          learned_locators: build.learned_locators.length
        }
      });
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "LLM generation failed";
      build = buildFallbackBuild(steps, cacheRows, startUrl, fallbackReason);
      await appendEvent(transaction_id, {
        level: "warning",
        phase: "automation.llm.fallback",
        message: "LLM automation generation failed; QAira created deterministic keyword starter automation instead.",
        details: {
          error: fallbackReason
        }
      });
    }
  } else {
    fallbackReason = "No active LLM integration is configured";
    build = buildFallbackBuild(steps, cacheRows, startUrl, fallbackReason);
    await appendEvent(transaction_id, {
      level: "warning",
      phase: "automation.llm.unavailable",
      message: "No active LLM integration is configured; QAira created deterministic keyword starter automation.",
      details: {
        fallback_reason: fallbackReason
      }
    });
  }

  const stepUpdates = await applyBuild({
    build
  });
  const learnedCount = await persistLearning({
    testCase,
    learnedLocators: build.learned_locators,
    capturedActions,
    capturedNetwork,
    transactionId: transaction_id
  });
  const artifactContent = createArtifactContent({
    testCase,
    updates: build.updates
  });
  let artifact = null;

  if (transaction_id) {
    artifact = await workspaceTransactionService.createTransactionArtifact(transaction_id, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-automation.spec.js`,
      mime_type: "text/javascript; charset=utf-8",
      content: artifactContent
    });
  }

  await appendEvent(transaction_id, {
    level: stepUpdates.length ? "success" : "warning",
    phase: "automation.case.updated",
    message: stepUpdates.length
      ? `Associated generated automation with "${testCase.title}".`
      : `No step automation was associated with "${testCase.title}".`,
    details: {
      test_case_id,
      updated_steps: stepUpdates.length,
      learned_locator_count: learnedCount,
      artifact_id: artifact?.id || null
    }
  });

  return {
    test_case_id,
    title: testCase.title,
    automated: testCase.automated || "no",
    generated_step_count: stepUpdates.length,
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
        source_action_index: mapping.candidates[0]?.source_action_index || null,
        source_action_indexes: mapping.candidates.map((candidate) => candidate.source_action_index).filter(Boolean),
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
      source_action_indexes: [candidate.source_action_index].filter(Boolean),
      mapping_source: "created",
      has_code: true,
      has_api_request: false
    });
    createdCount += 1;
  }

  return applied;
};

const buildMobileAutomationCode = (action) => {
  if (action.type === "tap") {
    return `await android.tap("${action.locator || `point:${action.x || 0},${action.y || 0}`}");`;
  }

  if (action.type === "type") {
    return `await android.type("focused", ${JSON.stringify(action.value || "")});`;
  }

  if (action.type === "pressBack") {
    return "await android.pressBack();";
  }

  return "";
};

const buildMobileStepCandidate = (action) => {
  const automationCode = buildMobileAutomationCode(action);

  if (!automationCode) {
    return null;
  }

  if (action.type === "tap") {
    return {
      action: `Tap Android screen at ${action.locator || `${action.x || 0},${action.y || 0}`}`,
      expected_result: "The Android app accepts the tap and continues the flow.",
      automation_code: automationCode
    };
  }

  if (action.type === "type") {
    return {
      action: "Type text into the focused Android field",
      expected_result: "The value is entered in the Android app.",
      automation_code: automationCode
    };
  }

  return {
    action: "Press Android back",
    expected_result: "The Android app navigates back.",
    automation_code: automationCode
  };
};

const applyMobileRecorderSteps = async ({ testCase, capturedActions, createdBy, targetStepId }) => {
  const candidates = capturedActions.map(buildMobileStepCandidate).filter(Boolean);
  const caseSteps = await selectStepsForCase.all(testCase.id);
  const existingSteps = targetStepId ? caseSteps.filter((step) => step.id === targetStepId) : caseSteps;
  const applied = [];
  let createdCount = 0;

  if (targetStepId && existingSteps[0] && candidates.length) {
    const existing = existingSteps[0];
    const automationCode = candidates.map((candidate) => candidate.automation_code).filter(Boolean).join("\n");

    await testStepService.updateTestStep(existing.id, {
      step_type: "android",
      automation_code: automationCode,
      api_request: null
    });
    return [{
      step_id: existing.id,
      step_order: existing.step_order,
      step_type: "android",
      action: existing.action || candidates[0].action,
      expected_result: existing.expected_result || candidates[0].expected_result,
      automation_code: automationCode,
      operation: "updated",
      has_code: true,
      has_api_request: false
    }];
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const existing = existingSteps[index];

    if (existing) {
      await testStepService.updateTestStep(existing.id, {
        step_type: "android",
        automation_code: candidate.automation_code,
        api_request: null
      });
      applied.push({
        step_id: existing.id,
        step_order: existing.step_order,
        step_type: "android",
        action: existing.action || candidate.action,
        expected_result: existing.expected_result || candidate.expected_result,
        automation_code: candidate.automation_code,
        operation: "updated",
        has_code: true,
        has_api_request: false
      });
      continue;
    }

    const stepOrder = existingSteps.length + createdCount + 1;
    const created = await testStepService.createTestStep({
      test_case_id: testCase.id,
      step_order: stepOrder,
      action: candidate.action,
      expected_result: candidate.expected_result,
      step_type: "android",
      automation_code: candidate.automation_code,
      api_request: null
    });
    applied.push({
      step_id: created.id,
      step_order: stepOrder,
      step_type: "android",
      action: candidate.action,
      expected_result: candidate.expected_result,
      automation_code: candidate.automation_code,
      operation: "created",
      has_code: true,
      has_api_request: false
    });
    createdCount += 1;
  }

  return applied;
};

const isBusinessApiNetworkEntry = (entry) => {
  const method = normalizeText(entry?.method)?.toUpperCase() || "GET";
  const resourceType = normalizeText(entry?.resource_type)?.toLowerCase();
  const url = normalizeText(entry?.url);

  if (!url || method === "OPTIONS") {
    return false;
  }

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = parsed.pathname || "/";
  const host = parsed.hostname.toLowerCase();

  if (/\.(?:css|js|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|wav|pdf)$/i.test(path)) {
    return false;
  }

  if (/(analytics|segment|posthog|rudder|sentry|hotjar|googletagmanager|google-analytics|doubleclick)/i.test(host + path)) {
    return false;
  }

  if (/\/(?:health|ops-telemetry|live-session|recorder\/sessions)(?:\/|$)/i.test(path)) {
    return false;
  }

  return resourceType === "fetch" || resourceType === "xhr" || /\/api(?:\/|$)/i.test(path);
};

const resolveBodyMode = (entry) => {
  const contentType = normalizeText(entry?.content_type)?.toLowerCase() || "";
  const body = normalizeRichText(entry?.request_body);

  if (!body) {
    return "none";
  }

  if (contentType.includes("json") || /^[\[{]/.test(body)) {
    return "json";
  }

  if (contentType.includes("xml") || /^<[\s\S]+>$/.test(body)) {
    return "xml";
  }

  if (contentType.includes("x-www-form-urlencoded")) {
    return "form";
  }

  return "text";
};

const summarizeTriggerAction = (networkEntry, capturedActions = []) => {
  const requestTime = Date.parse(networkEntry?.timestamp || "");
  const samePageActions = capturedActions
    .filter((action) => !networkEntry?.page_id || action.page_id === networkEntry.page_id)
    .map((action) => ({
      action,
      time: Date.parse(action.timestamp || "")
    }))
    .filter((item) => Number.isFinite(item.time));

  if (!Number.isFinite(requestTime) || !samePageActions.length) {
    return null;
  }

  const prior = samePageActions
    .filter((item) => item.time <= requestTime + 1500)
    .sort((a, b) => Math.abs(requestTime - a.time) - Math.abs(requestTime - b.time))[0];

  if (!prior) {
    return null;
  }

  return [
    prior.action.type,
    prior.action.text || prior.action.locator || prior.action.value || null
  ].filter(Boolean).join(": ");
};

const buildApiStepFromNetwork = (entry, index, capturedActions = []) => {
  const method = normalizeText(entry?.method)?.toUpperCase() || "GET";
  const url = normalizeText(entry?.url);
  const status = Number(entry?.status);
  const trigger = summarizeTriggerAction(entry, capturedActions);
  const bodyMode = resolveBodyMode(entry);
  const request = normalizeApiRequest({
    method,
    url,
    headers: [],
    body_mode: bodyMode,
    body: bodyMode === "none" ? null : normalizeRichText(entry?.request_body),
    validations: Number.isFinite(status)
      ? [{ kind: "status", expected: String(status) }]
      : [{ kind: "status", expected: "200" }],
    captures: []
  });

  if (!request) {
    return null;
  }

  let pathLabel = url;

  try {
    const parsed = new URL(url);
    pathLabel = `${parsed.pathname}${parsed.search || ""}`;
  } catch {
    pathLabel = url;
  }

  return {
    step_order: index + 1,
    action: trigger
      ? `${method} ${pathLabel} after web action "${trigger}"`
      : `${method} ${pathLabel}`,
    expected_result: Number.isFinite(status)
      ? `Response status is ${status}.`
      : "Response returns a successful status.",
    step_type: "api",
    automation_code: "",
    api_request: request
  };
};

const getApiRequestKey = (request) => {
  const normalized = normalizeApiRequest(request);

  if (!normalized?.url) {
    return null;
  }

  let url = normalized.url;

  try {
    const parsed = new URL(normalized.url);
    parsed.hash = "";
    url = parsed.toString();
  } catch {
    url = normalized.url;
  }

  return [
    normalizeText(normalized.method)?.toUpperCase() || "GET",
    url,
    normalizeRichText(normalized.body) || ""
  ].join(" ");
};

const listExistingCompanionApiRequestKeys = async (testCase) => {
  const companions = await selectCompanionApiCasesForSource.all(
    testCase.app_type_id,
    JSON.stringify([`source-web-case:${testCase.id}`])
  );
  const keys = new Set();

  for (const companion of companions) {
    const steps = await selectStepsForCase.all(companion.id);

    steps.forEach((step) => {
      const key = getApiRequestKey(step.api_request);
      if (key) {
        keys.add(key);
      }
    });
  }

  return { companions, keys };
};

const createCompanionApiCaseFromNetwork = async ({ testCase, capturedActions, capturedNetwork, session, createdBy, transactionId }) => {
  const unique = new Set();
  const candidateSteps = capturedNetwork
    .filter(isBusinessApiNetworkEntry)
    .filter((entry) => {
      const key = [
        normalizeText(entry.method)?.toUpperCase() || "GET",
        normalizeText(entry.url),
        normalizeRichText(entry.request_body) || ""
      ].join(" ");

      if (unique.has(key)) {
        return false;
      }

      unique.add(key);
      return true;
    })
    .slice(0, 25)
    .map((entry, index) => buildApiStepFromNetwork(entry, index, capturedActions))
    .filter(Boolean);
  const existing = await listExistingCompanionApiRequestKeys(testCase);
  const steps = candidateSteps.filter((step) => {
    const key = getApiRequestKey(step.api_request);
    return key && !existing.keys.has(key);
  }).map((step, index) => ({
    ...step,
    step_order: index + 1
  }));

  if (!steps.length) {
    if (candidateSteps.length && existing.companions.length) {
      await appendEvent(transactionId, {
        level: "info",
        phase: "recorder.api_case.skipped_duplicate",
        message: "Recorder skipped companion API case creation because the captured endpoints already exist for this web case.",
        details: {
          source_test_case_id: testCase.id,
          existing_api_case_ids: existing.companions.map((item) => item.id),
          captured_api_step_count: candidateSteps.length
        }
      });
    }
    return null;
  }

  const title = `[API capture] ${testCase.title}`;
  const created = await testCaseService.createTestCase({
    app_type_id: testCase.app_type_id,
    title,
    description: [
      `Companion API test generated from recorder session ${session.id}.`,
      `Source web case: ${testCase.title}.`,
      "Steps are linked to the nearest captured web action when timing and page context are available."
    ].join(" "),
    external_references: [
      `source-web-case:${testCase.id}`,
      `recorder-session:${session.id}`
    ],
    automated: "yes",
    status: testCase.status || "ready",
    priority: testCase.priority,
    created_by: createdBy,
    updated_by: createdBy,
    steps
  });

  await appendEvent(transactionId, {
    level: "success",
    phase: "recorder.api_case.created",
    message: `Recorder created a companion API case with ${steps.length} captured request step${steps.length === 1 ? "" : "s"}.`,
    details: {
      source_test_case_id: testCase.id,
      api_test_case_id: created.id,
      recorder_session_id: session.id,
      api_step_count: steps.length
    }
  });

  return {
    id: created.id,
    title,
    step_count: steps.length
  };
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
  const stepCandidates = buildRecorderStepCandidates(capturedActions);
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
          message: "AI mapped part of the recorder flow; QAira mapped the remaining recorded interactions with deterministic flow matching.",
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
        message: "AI recorder mapping was unavailable, so QAira mapped recorded automation to the existing manual steps using deterministic flow matching.",
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
    transactionId
  });
  const apiCase = await createCompanionApiCaseFromNetwork({
    testCase,
    capturedActions,
    capturedNetwork,
    session,
    createdBy,
    transactionId
  });
  let artifact = null;

  if (transactionId && appliedSteps.length) {
    artifact = await workspaceTransactionService.createTransactionArtifact(transactionId, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-recorder-keywords.spec.js`,
      mime_type: "text/javascript; charset=utf-8",
      content: createArtifactContent({
        testCase,
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
      api_test_case_id: apiCase?.id || null,
      api_step_count: apiCase?.step_count || 0,
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
      api_test_case_id: apiCase?.id || null,
      api_step_count: apiCase?.step_count || 0,
      artifact_id: artifact?.id || null
    },
    completed_at: new Date().toISOString()
  });

  return {
    test_case_id: testCase.id,
    title: testCase.title,
    automated: testCase.automated || "no",
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
        : "Recorder interactions were converted into QAira web keyword automation steps."
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
  created_by,
  start_url,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  captured_actions,
  captured_network,
  additional_context,
  transaction_id,
  transaction_action,
  transaction_title,
  transaction_description
} = {}) => {
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
        description: normalizeText(transaction_description) || "Automating the manual web case with AI-assisted step mapping.",
        metadata: {
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
        description: normalizeText(transaction_description) || "Automating the manual web case with AI-assisted step mapping.",
        metadata: {
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
      created_by,
      start_url,
      test_environment_id,
      test_configuration_id,
      test_data_set_id,
      captured_actions,
      captured_network,
      additional_context,
      transaction_id: transaction.id
    });

    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: result.generated_step_count ? "completed" : "failed",
      description: result.generated_step_count
        ? `Generated automation for ${result.generated_step_count} step${result.generated_step_count === 1 ? "" : "s"} and associated it with the manual case.`
        : "Automation builder did not produce any step updates.",
      metadata: {
        current_phase: "completed",
        progress_percent: 100,
        total_items: 1,
        processed_items: 1,
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
    const message = error instanceof Error ? error.message : "Automation build failed";
    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: "failed",
      description: message,
      metadata: {
        current_phase: "failed",
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
        test_case_id: normalizedCaseId
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
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  failure_threshold,
  additional_context,
  transaction_id
} = {}) => {
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
    throw new Error("No manual web test cases were found for automation build");
  }

  const firstCase = await selectCaseWithScope.get(targetIds[0]);
  const transactionId = normalizeText(transaction_id);

  if (transactionId) {
    await updateTransaction(transactionId, {
      project_id: firstCase?.project_id || null,
      app_type_id: appTypeId,
      category: "automation_build",
      action: "batch_case_automation_build",
      status: "running",
      title: "Batch AI automation",
      description: `Automating ${targetIds.length} manual web case${targetIds.length === 1 ? "" : "s"} with AI.`,
      metadata: {
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
  let stoppedByThreshold = false;

  for (const [index, testCaseId] of targetIds.entries()) {
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
      const result = await buildCaseCore({
        test_case_id: testCaseId,
        integration_id,
        created_by,
        start_url,
        test_environment_id,
        test_configuration_id,
        test_data_set_id,
        additional_context,
        transaction_id: transactionId
      });
      created.push(result);
    } catch (error) {
      errors.push({
        test_case_id: testCaseId,
        message: error instanceof Error ? error.message : "Automation build failed"
      });
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
        failure_threshold: failureThreshold,
        progress_percent: Math.round((processed / targetIds.length) * 100)
      }
    });
  }

  const processedCount = created.length + errors.length;
  const skippedCount = stoppedByThreshold ? Math.max(0, targetIds.length - processedCount) : 0;

  await updateTransaction(transactionId, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Associated generated automation with ${created.length} manual case${created.length === 1 ? "" : "s"}.`
      : "Batch automation build completed without updating a case.",
    metadata: {
      current_phase: "completed",
      total_items: targetIds.length,
      processed_items: processedCount,
      generated: created.length,
      failed: errors.length,
      skipped: skippedCount,
      failure_threshold: failureThreshold,
      stopped_by_failure_threshold: stoppedByThreshold,
      progress_percent: 100,
      sample_errors: errors.slice(0, 10)
    },
    completed_at: new Date().toISOString()
  });
  await appendEvent(transactionId, {
    level: created.length ? "success" : "error",
    phase: "automation.batch.completed",
    message: `Batch automation build completed with ${created.length} generated, ${errors.length} failed, and ${skippedCount} skipped.`,
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

exports.listLearningCache = async ({ project_id, app_type_id, limit } = {}) => {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await listLearningCacheRows({
    projectId: normalizeText(project_id),
    appTypeId: normalizeText(app_type_id),
    limit: boundedLimit
  });

  return rows.map(normalizeLearningCacheRow);
};

exports.exportRepositoryContext = async ({ project_id, app_type_id, limit } = {}) => {
  const entries = await exports.listLearningCache({ project_id, app_type_id, limit: limit || 200 });
  const screens = new Map();

  entries.forEach((entry) => {
    const metadata = normalizeObject(entry.metadata);
    const screenName = normalizeText(metadata.screen_name) || entry.page_key || "Unassigned screen";
    const screen = screens.get(screenName) || {
      screen: screenName,
      appType: normalizeText(metadata.platform) || null,
      urlPattern: {
        type: normalizeText(metadata.url_pattern_type) || "contains",
        value: normalizeText(metadata.url_pattern_value) || entry.page_url || entry.page_key
      },
      fingerprint: normalizeText(metadata.screen_fingerprint) || null,
      fields: []
    };
    const fallbackLocators = Array.isArray(metadata.fallback_locators)
      ? metadata.fallback_locators
      : [];

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
    screens.set(screenName, screen);
  });

  return {
    repositoryType: "ui_intelligence_repository",
    generatedAt: new Date().toISOString(),
    screens: Array.from(screens.values())
  };
};

exports.getLearningCacheEntry = async (id) => {
  const entry = normalizeLearningCacheRow(await selectLearningCacheEntry.get(normalizeText(id)));

  if (!entry) {
    throw new Error("Object repository entry not found");
  }

  return entry;
};

exports.updateLearningCacheEntry = async (id, patch = {}) => {
  const existing = await exports.getLearningCacheEntry(id);
  const next = normalizeRepositoryPatch(existing, patch);
  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: existing.app_type_id,
    screen_name: next.metadata?.screen_name || next.page_key || next.page_url,
    locator: next.locator,
    exclude_id: existing.id
  });

  if (duplicate) {
    throw new Error("Another object repository field on this screen already uses the same locator.");
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

  return exports.getLearningCacheEntry(existing.id);
};

exports.createLearningCacheEntry = async (input = {}) => {
  const pageKey = normalizeText(input.page_key) || normalizeText(input.screen_name) || normalizeUrlKey(input.page_url) || "unknown-page";
  const locator = normalizeText(input.locator);
  const screenName = normalizeText(input.screen_name) || pageKey;

  if (!locator) {
    throw new Error("Locator is required");
  }

  const duplicate = await exports.findDuplicateLearningCacheEntry({
    app_type_id: normalizeText(input.app_type_id),
    screen_name: screenName,
    locator
  });

  if (duplicate) {
    throw new Error("Another object repository field on this screen already uses the same locator.");
  }

  await upsertLearningCache.run(
    uuid(),
    normalizeText(input.project_id),
    normalizeText(input.app_type_id),
    normalizeText(input.test_case_id),
    normalizeText(input.page_url),
    pageKey,
    normalizeText(input.locator_intent || input.object_name) || "field",
    locator,
    normalizeText(input.locator_kind) || "css",
    clampNumber(input.confidence, 0.8),
    normalizeText(input.source) || "object_repository",
    {
      ...normalizeObject(input.metadata),
      screen_name: screenName,
      object_name: normalizeText(input.object_name) || normalizeText(input.locator_intent) || "field",
      object_role: normalizeText(input.object_role) || "field",
      target_criteria: Array.isArray(input.target_criteria) ? input.target_criteria : [],
      dom_structure: normalizeText(input.dom_structure),
      screenshot_url: normalizeText(input.screenshot_url),
      fallback_strategy: normalizeText(input.fallback_strategy),
      screen_dom_compressed: normalizeText(input.screen_dom_compressed),
      screen_screenshot_url: normalizeText(input.screen_screenshot_url)
    }
  );

  const rows = await listLearningCacheRows({
    projectId: normalizeText(input.project_id),
    appTypeId: normalizeText(input.app_type_id),
    limit: 200
  });
  return rows.map(normalizeLearningCacheRow).find((row) =>
    row.locator === locator && (row.metadata?.screen_name || row.page_key) === screenName
  ) || null;
};

exports.findDuplicateLearningCacheEntry = async ({ app_type_id, screen_name, locator, exclude_id } = {}) => {
  const normalizedScreen = normalizeText(screen_name);
  const normalizedLocator = normalizeText(locator);

  if (!normalizedScreen || !normalizedLocator) {
    return null;
  }

  const rows = await listLearningCacheRows({ appTypeId: normalizeText(app_type_id), limit: 200 });
  return rows.map(normalizeLearningCacheRow).find((entry) =>
    entry.id !== exclude_id
    && normalizeText(entry.locator) === normalizedLocator
    && normalizeText(entry.metadata?.screen_name || entry.page_key || entry.page_url) === normalizedScreen
  ) || null;
};

const buildRepositoryUsageNeedles = (entry) => {
  const screenName = normalizeText(entry.metadata?.screen_name || entry.page_key);
  const objectName = normalizeText(entry.metadata?.object_name || entry.locator_intent);
  return [
    entry.locator,
    objectName,
    screenName && objectName ? `${screenName}.${objectName}` : null,
    entry.locator_intent
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

exports.deleteLearningCacheEntry = async (id) => {
  const existing = await exports.getLearningCacheEntry(id);
  const usage = await exports.findLearningCacheUsage(existing);

  if (usage.length) {
    return { deleted: false, blocked: true, usage };
  }

  await deleteLearningCacheEntry.run(existing.id);
  return { deleted: true, blocked: false, usage: [] };
};

exports.deleteLearningCacheScreen = async ({ app_type_id, screen_name } = {}) => {
  const screenName = normalizeText(screen_name);
  const appTypeId = normalizeText(app_type_id);

  if (!screenName) {
    throw new Error("Screen name is required");
  }

  const rows = (await listLearningCacheRows({ appTypeId, limit: 200 }))
    .map(normalizeLearningCacheRow)
    .filter((entry) => normalizeText(entry.metadata?.screen_name || entry.page_key || entry.page_url) === screenName);
  const usage = await exports.findLearningCacheUsage(rows);

  if (usage.length) {
    return { deleted: false, blocked: true, usage };
  }

  await deleteLearningCacheScreen.run(appTypeId || null, screenName);
  return { deleted: true, blocked: false, usage: [] };
};

exports.improveLearningCacheEntry = async ({ id, integration_id, guidance } = {}) => {
  const existing = await exports.getLearningCacheEntry(id);
  let suggestion;
  let integration = null;

  try {
    integration = await resolveLlmIntegration(integration_id);
  } catch {
    integration = null;
  }

  if (integration) {
    try {
      const content = await requestChatCompletion({
        integration,
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

  const updated = await exports.updateLearningCacheEntry(existing.id, {
    page_key: suggestion.page_key,
    locator_intent: suggestion.intent || suggestion.locator_intent || suggestion.object_name,
    locator: suggestion.locator,
    locator_kind: suggestion.locator_kind || suggestion.kind,
    confidence: suggestion.confidence,
    source: suggestion.fallback_used ? "ai_repository_fallback" : "ai_repository_improved",
    metadata: {
      ...existing.metadata,
      screen_name: suggestion.screen_name,
      object_name: suggestion.object_name,
      object_role: suggestion.object_role,
      target_criteria: Array.isArray(suggestion.target_criteria) ? suggestion.target_criteria : [],
      dom_structure: suggestion.dom_structure,
      fallback_strategy: suggestion.fallback_strategy,
      ai_improved_at: new Date().toISOString(),
      ai_integration_id: integration?.id || null,
      ai_fallback_used: Boolean(suggestion.fallback_used),
      ai_fallback_reason: suggestion.fallback_reason || null
    }
  });

  return {
    entry: updated,
    suggestion,
    fallback_used: Boolean(suggestion.fallback_used),
    fallback_reason: suggestion.fallback_reason || null
  };
};

const resolveTestEngineIntegration = async (testCase) => {
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", testCase.project_id);

  if (!integration?.base_url) {
    throw new Error("Configure an active Test Engine integration before starting a local browser recorder session");
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
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers || {})
    }
  }, ENGINE_TIMEOUT_MS);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || `Test Engine request failed with status ${response.status}`);
  }

  return payload;
};

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
    const baseUrl = normalizeText(metadata.engine_base_url);

    if (!sessionId || !baseUrl) {
      continue;
    }

    checked += 1;

    try {
      const session = await readEngineJson(`${baseUrl}/api/v1/recorder/sessions/${encodeURIComponent(sessionId)}`);
      const shouldStop = session?.status === "running" && isRecorderSessionPastOrphanTtl(session, transaction);

      if (!shouldStop && session?.status === "running") {
        continue;
      }

      if (shouldStop) {
        await readEngineJson(`${baseUrl}/api/v1/recorder/sessions/${encodeURIComponent(sessionId)}/stop`, {
          method: "POST"
        }).catch(() => null);
        stopped += 1;
      }

      const message = shouldStop
        ? "Recorder session was auto-stopped after more than 3 minutes without live-view or input activity."
        : "Recorder session was already stopped while QAira still had the process marked as running.";

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
  const recorderTarget = normalizeText(recorder_target) === "mobile" || testCase.app_type_kind === "android" ? "mobile" : "web";

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
  const resolvedStartUrl = normalizeText(start_url) || buildContext.environment?.base_url || null;
  const sessionEndpoint = recorderTarget === "mobile"
    ? `${mobileBaseUrl}/api/v1/mobile/recorder/sessions`
    : `${baseUrl}/api/v1/recorder/sessions`;
  const session = await readEngineJson(sessionEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      start_url: resolvedStartUrl,
      recorder_mode: recorderMode,
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
      ? "A Mobile Engine recorder session is capturing Android interactions."
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
      ? `Started a ${recorderTarget} recorder session with a QAira live view.`
      : `Started a ${recorderTarget} recorder session.`,
    details: {
      recorder_session_id: session.id,
      engine_base_url: baseUrl,
      mobile_engine_base_url: recorderTarget === "mobile" ? mobileBaseUrl : null,
      recorder_mode: recorderMode,
      recorder_target: recorderTarget,
      target_step_id: targetStepId || null,
      display_mode: session.display_mode || null,
      live_view_available: Boolean(session.live_view_path || session.live_view_url),
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
    target_step_id: targetStepId || null,
    live_view_url: buildEngineUrl(publicBaseUrl, session.live_view_url || session.live_view_path),
    status_url: recorderTarget === "mobile"
      ? `${publicBaseUrl}/api/v1/mobile/recorder/sessions/${session.id}`
      : `${publicBaseUrl}/api/v1/recorder/sessions/${session.id}`
  };
};

exports.finishRecorderSession = async ({
  test_case_id,
  recorder_session_id,
  transaction_id,
  integration_id,
  additional_context,
  recorder_mode,
  recorder_target,
  engine_base_url,
  target_step_id,
  created_by
} = {}) => {
  const testCaseId = normalizeText(test_case_id);
  const sessionId = normalizeText(recorder_session_id);

  if (!testCaseId || !sessionId) {
    throw new Error("test_case_id and recorder_session_id are required");
  }

  const testCase = await selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const engineIntegration = await resolveTestEngineIntegration(testCase);
  const transactionId = normalizeText(transaction_id);
  const transaction = transactionId
    ? await workspaceTransactionService.getTransaction(transactionId).catch(() => null)
    : null;
  const metadata = parseTransactionMetadata(transaction);
  const targetStepId = normalizeText(target_step_id) || normalizeText(metadata.target_step_id);
  const targetSteps = targetStepId ? await selectStepsForCase.all(testCaseId) : [];

  if (targetStepId && !targetSteps.some((step) => step.id === targetStepId)) {
    throw new Error("The selected recorder target step does not belong to this test case.");
  }
  const target = normalizeText(recorder_target) || normalizeText(metadata.recorder_target) || "web";
  const localBaseUrl = normalizeText(recorder_mode) === "local" && target !== "mobile" ? normalizeLocalEngineBaseUrl(engine_base_url) : null;
  const baseUrl = String(localBaseUrl || metadata.engine_base_url || engineIntegration.base_url || "").replace(/\/+$/, "");
  const mobileBaseUrl = String(metadata.mobile_engine_base_url || resolveMobileEngineBaseUrl(engineIntegration, normalizeText(recorder_mode) || metadata.recorder_mode || "remote")).replace(/\/+$/, "");
  const sessionBaseUrl = target === "mobile" ? mobileBaseUrl : baseUrl;
  const sessionPath = target === "mobile" ? "/api/v1/mobile/recorder/sessions" : "/api/v1/recorder/sessions";
  const session = await readEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}`);
  const capturedActions = normalizeCapturedActions(session.actions || []);
  const capturedNetwork = normalizeCapturedNetwork(session.network || []);

  await readEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}/stop`, {
    method: "POST"
  }).catch(() => null);

  if (target === "mobile") {
    const stepUpdates = await applyMobileRecorderSteps({
      testCase,
      capturedActions,
      createdBy: created_by,
      targetStepId
    });
    await workspaceTransactionService.updateTransaction(transactionId, {
      status: "completed",
      metadata: {
        ...metadata,
        current_phase: "recorder.mobile.completed",
        progress_percent: 100,
        recorder_session_id: session.id,
        action_count: capturedActions.length,
        updated_step_count: stepUpdates.filter((step) => step.operation === "updated").length,
        created_step_count: stepUpdates.filter((step) => step.operation === "created").length
      },
      completed_at: new Date().toISOString()
    }).catch(() => null);
    await appendEvent(transactionId, {
      level: stepUpdates.length ? "success" : "warning",
      phase: "recorder.mobile.steps.created",
      message: stepUpdates.length
        ? `Mobile recorder saved ${stepUpdates.length} Android keyword step${stepUpdates.length === 1 ? "" : "s"}.`
        : "Mobile recorder stopped without captured Android actions.",
      details: {
        recorder_session_id: session.id,
        action_count: capturedActions.length,
        step_count: stepUpdates.length
      }
    });
    return {
      generated_step_count: stepUpdates.length,
      created_step_count: stepUpdates.filter((step) => step.operation === "created").length,
      updated_step_count: stepUpdates.filter((step) => step.operation === "updated").length,
      message: stepUpdates.length
        ? "Mobile recorder stopped and Android keyword steps were saved."
        : "Mobile recorder stopped. No Android actions were captured.",
      step_updates: stepUpdates,
      recorder_session: {
        id: session.id,
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
    recorder_session: {
      id: session.id,
      action_count: capturedActions.length,
      network_count: capturedNetwork.length
    }
  };
};
