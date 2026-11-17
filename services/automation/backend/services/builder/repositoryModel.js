// repositoryModel: cohesive builder implementation; dependencies are explicit lazy ports.
function createRepositoryModel(ports) {
const exports = ports.exports;
const require = ports.require;


const normalizeUrlKey = (value) => {
  const normalized = ports.normalizeText(value);

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
  const normalized = ports.normalizeText(title);
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
  const normalized = ports.normalizeText(url);

  if (!normalized || /^about:blank$/i.test(normalized)) {
    return null;
  }

  try {
    const parsed = new URL(normalized, "http://hellotest.local");
    const segments = parsed.pathname
      .split("/")
      .map(normalizeUrlPathSegment)
      .map((part) => ports.normalizeText(part))
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
      .map(ports.normalizeText)
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
  const text = ports.normalizeText(action?.text);
  if (text && text.length <= 80) {
    return text;
  }

  const locator = ports.normalizeText(action?.locator) || "";
  const labelMatch = locator.match(/^(?:label|placeholder|text|role)=(.+)$/i);
  if (labelMatch?.[1]) {
    return labelMatch[1];
  }

  const attrMatch = locator.match(/\[(?:aria-label|name|id|data-testid)=["']?([^"'\]]+)["']?\]/i);
  if (attrMatch?.[1]) {
    return attrMatch[1];
  }

  return ports.normalizeText(locator.replace(/[#.[\]'":=]/g, " ").slice(0, 60));
};


const NON_REPOSITORY_RECORDING_LOCATORS = new Set(["location", "browser.tab", "keyboard", "viewport", "body"]);


const isRecorderRepositoryLocator = (locator) => {
  const normalized = ports.normalizeText(locator);
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

  return ports.normalizeText(action?.page_id) || ports.normalizeText(action?.page_title) || "unknown-page";
};


const repositoryActionKey = (action) => `${recorderPageIdentity(action)}|${ports.normalizeText(action?.locator) || ""}`;


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
  if (ports.normalizeText(platform) === "android") {
    const type = String(action?.type || "").toLowerCase();
    if (type === "tap") return "android.tap";
    if (type === "type") return "android.type";
    if (type === "pressback") return "android.pressBack";
    return "android.step";
  }

  return inferKeywordForAction(action);
};


const buildObjectRepositoryEntry = (action) => {
  const locator = ports.normalizeText(action?.locator);
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
    parameter_hint: role === "field" || role === "file" ? ports.recorderParameterHint(action) : null
  };
};


const platformSource = (platform, fallback) =>
  ports.normalizeText(platform) === "android" ? `android_${fallback}` : fallback;


const loadRepositoryRowsForNaming = async (testCase) => {
  if (testCase.app_type_id) {
    return (await ports.listAllLearningCacheRows({ appTypeId: testCase.app_type_id }))
      .map(ports.normalizeLearningCacheRow)
      .filter(Boolean);
  }

  return (await ports.listLearningCacheRows({
    projectId: testCase.project_id || null,
    appTypeId: testCase.app_type_id || null,
    limit: 200
  })).map(ports.normalizeLearningCacheRow).filter(Boolean);
};


const buildRecorderRepositoryNamingPrompt = ({ pages, fields, testCase }) => [
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.1"),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.2"),
  "{",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.3"),
  "}",
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.43"),
  "",
  [ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRecorderRepositoryNamingPrompt.segment.1"),String(testCase.title),""].join(''),
  [ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRecorderRepositoryNamingPrompt.segment.2"),String(testCase.description || "No description provided."),""].join(''),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.9"),
  JSON.stringify(pages, null, 2),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRecorderRepositoryNamingPrompt.10"),
  JSON.stringify(fields, null, 2)
].join("\n");


const buildAiRecorderRepositoryNameSuggestions = async ({
  testCase,
  actions,
  integrationId,
  userId,
  transactionId,
  projectPrompt = value => value
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
    integration = await ports.resolveLlmIntegration(integrationId, {
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
    const content = await ports.requestChatCompletion({
      integration,
      prompt: projectPrompt(buildRecorderRepositoryNamingPrompt({ pages, fields, testCase })),
      featureKey: 'ai.automation.dom_extraction'
    });
    const payload = ports.extractJsonPayload(content);
    const screenSuggestions = new Map();
    const fieldSuggestions = new Map();

    (Array.isArray(payload?.screens) ? payload.screens : []).forEach((item) => {
      const pageKey = ports.normalizeText(item?.page_key || item?.pageKey);
      const name = toObjectSegment(item?.name || item?.screen_name, "");
      if (pageKey && name) {
        screenSuggestions.set(pageKey, name);
      }
    });
    (Array.isArray(payload?.fields) ? payload.fields : []).forEach((item) => {
      const fieldKey = ports.normalizeText(item?.field_key || item?.fieldKey);
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
    await ports.appendEvent(transactionId, {
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
    const metadata = ports.normalizeObject(row.metadata);
    const screenName = ports.normalizeText(metadata.screen_name || row.page_key || row.page_url);

    if (!screenName) {
      return;
    }

    screenNames.add(normalizeRepositoryNameKey(screenName));
    [row.page_key, normalizeUrlKey(row.page_url), row.page_url].map(ports.normalizeText).filter(Boolean).forEach((key) => {
      screenByPageIdentity.set(key, screenName);
    });

    const fieldNames = fieldNamesByScreen.get(screenName) || new Set();
    const objectName = ports.getRepositoryObjectName(row, screenName);

    if (objectName && !ports.isRepositoryScreenRecord(row)) {
      fieldNames.add(normalizeRepositoryNameKey(objectName));
      if (row.locator) {
        fieldByLocator.set(`${screenName}|${row.locator}`, {
          persisted: true,
          screen_name: screenName,
          field_name: objectName,
          reference: `${screenName}.${objectName}`,
          locator: row.locator,
          locator_kind: row.locator_kind || ports.inferLocatorStrategy(row.locator, "css")
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
  platform = "web",
  projectPrompt,
  allowAiNaming = true
} = {}) => {
  const actions = ports.normalizeCapturedActions(capturedActions).filter((action) => isRecorderRepositoryLocator(action.locator));
  let existingRows = [], repositoryWarning = null;
  try { existingRows = await loadRepositoryRowsForNaming(testCase); }
  catch { repositoryWarning = 'The object repository was unavailable. Recorded instructions use their observed locators; repository learning can be retried later.'; }
  const index = buildExistingRepositoryNameIndex(existingRows);
  const aiSuggestions = allowAiNaming ? await buildAiRecorderRepositoryNameSuggestions({
    testCase,
    actions,
    integrationId,
    userId,
    transactionId,
    projectPrompt
  }) : { screens: new Map(), fields: new Map(), ai_used: false, fallback_reason: null };
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
    const locator = ports.normalizeText(action.locator);
    const screenName = resolveScreen(action);
    const pageKey = recorderPageIdentity(action);
    const fieldKey = repositoryActionKey(action);
    const existingField = index.fieldByLocator.get(`${screenName}|${locator}`);

    if (!screens.has(screenName)) {
      screens.set(screenName, {
        screen_name: screenName,
        page_key: screenName,
        page_identity: pageKey,
        page_url: ports.normalizeText(action.url),
        page_title: ports.normalizeText(action.page_title),
        platform,
        url_pattern_type: ports.normalizeText(action.url) ? "endsWith" : "contains",
        url_pattern_value: ports.normalizeText(action.url) ? normalizeUrlKey(action.url) : pageKey
      });
    }

    if (existingField) {
      const field = {
        ...existingField,
        object_role: inferObjectRole(action),
        object_label: inferObjectLabel(action),
        action,
        keyword: inferRecorderKeywordForPlatform(action, platform),
        parameter_hint: ['field','file'].includes(inferObjectRole(action)) ? ports.recorderParameterHint(action) : null,
        page_url: ports.normalizeText(action.url),
        page_key: screenName,
        page_identity: pageKey,
        page_title: ports.normalizeText(action.page_title),
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
      locator_kind: ports.inferLocatorStrategy(locator, "recorder"),
      object_role: role,
      object_label: inferObjectLabel(action),
      keyword: inferRecorderKeywordForPlatform(action, platform),
      parameter_hint: role === "field" || role === "file" ? ports.recorderParameterHint(action) : null,
      page_url: ports.normalizeText(action.url),
      page_key: screenName,
      page_identity: pageKey,
      page_title: ports.normalizeText(action.page_title),
      platform,
      source_action_indexes: [Number(action.index)].filter(Number.isFinite),
      action
    };

    fields.set(`${screenName}|${locator}`, field);
    byActionIndex.set(Number(action.index), field);
  });

  if (aiSuggestions.ai_used) {
    await ports.appendEvent(transactionId, {
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
    ai_fallback_reason: aiSuggestions.fallback_reason,
    repository_warning: repositoryWarning
  };
};


const summarizeStep = (step) => ({
  id: step.id,
  order: Number(step.step_order || 0),
  type: ports.inferAutomationStepType(step),
  action: step.action || "",
  expected_result: step.expected_result || "",
  ...(step.parameterized_expected_result ? {parameterized_expected_result:step.parameterized_expected_result} : {}),
  ...(step.parameter_bindings ? {parameter_bindings:step.parameter_bindings} : {}),
  group: { id: step.group_id, name: step.group_name, kind: step.group_kind, shared_group_id: step.reusable_group_id },
  has_existing_automation: Boolean(ports.normalizeRichText(step.automation_code) || ports.normalizeApiRequest(step.api_request)),
  existing_automation_code: ports.normalizeRichText(step.automation_code),
  existing_api_request: ports.normalizeApiRequest(step.api_request)
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
    const screenName = ports.normalizeText(metadata.screen_name || row.page_key || row.locator_intent);

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
  require("../../lib/build/automationKnowledgeContext").summarizeAutomationKnowledge(rows, { normalizeContent: ports.normalizeRichText });


const buildRepositoryImprovePrompt = ({ entry, guidance }) => [
  ports.aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.11"),
  "",
  ports.aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.12"),
  "{",
  ports.aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.13"),
  "}",
  "",
  ports.aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.99"),
  "",
  ports.aiInstructionBlock("ai.automation.locator_repair", "aiAutomationBuilder.buildRepositoryImprovePrompt.20"),
  JSON.stringify(entry, null, 2),
  "",
  guidance ? `User guidance:\n${guidance}` : "User guidance: none"
].join("\n");


const buildRepositoryExtractPrompt = ({ screenName, pageUrl, domStructure, businessMeaning, candidateFields }) => [
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.21"),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.22"),
  "{",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.23"),
  "}",
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.104"),
  "",
  [ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.14"),String(screenName),""].join(''),
  [ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.15"),String(pageUrl || "Not supplied"),""].join(''),
  [ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.service.buildRepositoryExtractPrompt.segment.16"),String(businessMeaning || "Not supplied"),""].join(''),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.105"),
  String(domStructure || "Not supplied").slice(0, 50_000),
  "",
  ports.aiInstructionBlock("ai.automation.dom_extraction", "aiAutomationBuilder.buildRepositoryExtractPrompt.38"),
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
    const locator = ports.normalizeText(field?.locator || field?.primaryLocator);

    return {
      name: ports.normalizeText(field?.name || field?.object_name) || `Field ${index + 1}`,
      tag: ports.normalizeText(field?.tag || field?.html_tag) || "element",
      role: ports.normalizeText(field?.role || field?.object_role) || "field",
      locator,
      locatorKind: ports.normalizeText(field?.locator_kind || field?.locatorKind || field?.primaryStrategy) || "css",
      dom: ports.normalizeText(field?.dom || field?.dom_structure) || "",
      fallbackLocators: fallbackLocators.map((candidate) => ({
        locator: ports.normalizeText(candidate?.locator),
        strategy: ports.normalizeText(candidate?.strategy || candidate?.locator_kind) || "css",
        confidenceScore: ports.clampNumber(candidate?.confidenceScore ?? candidate?.confidence, 0.65)
      })).filter((candidate) => candidate.locator),
      description: ports.normalizeText(field?.description),
      businessMeaning: ports.normalizeText(field?.business_meaning || field?.businessMeaning),
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
    screen_summary: ports.normalizeText(payload?.screen_summary) || null,
    intended_flows: Array.isArray(payload?.intended_flows)
      ? payload.intended_flows.map(ports.normalizeText).filter(Boolean)
      : [],
    fields
  };
};


const buildDeterministicRepositorySuggestion = (entry, guidance) => {
  const metadata = ports.normalizeObject(entry.metadata);
  const objectName = ports.normalizeText(metadata.object_name) || ports.normalizeText(entry.locator_intent) || "Object";
  const screenName = ports.normalizeText(metadata.screen_name) || ports.normalizeText(entry.page_key) || "Screen";
  const criteria = [
    entry.locator ? `Primary locator: ${entry.locator}` : null,
    entry.locator_kind ? `Locator kind: ${entry.locator_kind}` : null,
    ports.normalizeText(metadata.dom_structure) ? "Use curated DOM structure as secondary evidence." : null,
    ports.normalizeText(metadata.screenshot_url || metadata.screenshot_path) ? "Use screenshot fallback when locator confidence drops." : null,
    guidance ? `Curator guidance: ${guidance}` : null
  ].filter(Boolean);

  return {
    page_key: entry.page_key,
    screen_name: screenName,
    object_name: objectName,
    object_role: ports.normalizeText(metadata.object_role) || entry.locator_kind || "field",
    locator: entry.locator,
    locator_kind: entry.locator_kind || "curated",
    target_criteria: criteria,
    dom_structure: ports.normalizeText(metadata.dom_structure || metadata.dom_path || metadata.html) || `Stable ${objectName} control on ${screenName}.`,
    fallback_strategy: ports.normalizeText(metadata.fallback_strategy) || "Use screenshot and nearby DOM/accessibility labels only after locator retry fails.",
    confidence: ports.clampNumber(entry.confidence, 0.5),
    fallback_used: true,
    fallback_reason: "No active LLM repository improvement was available."
  };
};
return { normalizeUrlKey, toTitleWords, toObjectSegment, inferScreenName, inferScreenNameFromTitle, GENERIC_SCREEN_PATH_SEGMENTS, normalizeUrlPathSegment, inferScreenNameFromUrl, inferObjectRole, inferObjectLabel, NON_REPOSITORY_RECORDING_LOCATORS, isRecorderRepositoryLocator, normalizeRepositoryNameKey, uniqueRepositoryName, recorderPageIdentity, repositoryActionKey, inferKeywordForAction, inferRecorderKeywordForPlatform, buildObjectRepositoryEntry, platformSource, loadRepositoryRowsForNaming, buildRecorderRepositoryNamingPrompt, buildAiRecorderRepositoryNameSuggestions, buildExistingRepositoryNameIndex, buildRecorderRepositoryModel, summarizeStep, summarizeCache, summarizeScreenCatalog, summarizeKnowledge, buildRepositoryImprovePrompt, buildRepositoryExtractPrompt, normalizeRepositoryExtractFields, buildDeterministicRepositorySuggestion };
}
module.exports = { createRepositoryModel };
