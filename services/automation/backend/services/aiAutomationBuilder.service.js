// Extracted implementations retain module-relative dependency injection for tests and hosts.
const builderDependency = specifier => require(specifier.startsWith("../") ? specifier.slice(3) : specifier);
const { LLM_TIMEOUT_MS, extractJsonPayload, resolveLlmIntegration, requestChatCompletion } = require("../lib/build/automationModelClient");
const {normalizeAgentContext,retrieveAgentContext}=require("../lib/build/automationAgentContext");
const { buildFeature } = require('./aiAutomationFeaturePolicy');
const { requireBuildEnvironment } = require("../lib/build/automationBuildEnvironment");
exports.buildFeature = buildFeature;
const { resilientHttpRequest } = require('@hellotest/platform/backend/src/utils/resilientHttpClient');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { completeAutomationBuild } = require("../lib/build/automationBuildCompletion");
const {canonicalizeRepositoryRows,canonicalPageUrl,repositoryInputMetadata}=require("../lib/build/repositoryScreenIdentity");
const {sameRecordedLocator}=require("../lib/build/automationLocatorIdentity");
const {normalizeGeneratedProgram,preserveGeneratedAssertions}=require("../lib/build/automationGeneratedProgram");
const { resolveAutomationCaseType, resolveAutomationCaseSteps, resolveAutomationDraftSteps, automationStepType, storedAutomationCaseType } = require('@hellotest/platform/backend/src/utils/automationCaseType');
const { runtimeSpecialist, runtimeSpecialistInstructions } = require("../lib/build/automationRuntimeSpecialist");
const { assertApiParameterBindings, apiParameterBindingContext } = require("../lib/build/automationApiParameterContract");
const { automationExpectedResultTemplate } = require("../lib/build/automationExpectedResultTemplate");
const {navigationOrigins,validateNavigationGrounding,validateApiRequestGrounding,scopeRepositoryToTarget,buildNavigationOrigins}=require("../lib/build/automationGenerationGrounding");
const {normalizeAutomationStartUrl,requiresAutomationStartUrl}=require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { loadAutomationStoryContext, loadAutomationManualContext, manualContextKey, automationPromptParameters, loadAutomationParameterContext, resolveAutomationStartUrl } = require("../lib/build/automationBuildContext");
const { resolveMobileRecorderPlatform } = require("../domain/mobileRecorderPlan");
const { persistMobileRecorderPlan } = require("./mobileRecorderPersistence.service");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const { randomUUID: uuid } = require("crypto");
const automationCasePreparationService = require("./automationCasePreparation.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const testStepService = require("@hellotest/testing/backend/services/testStep.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const testEnvironmentService = require("@hellotest/testing/backend/services/testEnvironment.service");
const testConfigurationService = require("@hellotest/testing/backend/services/testConfiguration.service");
const testDataSetService = require("@hellotest/testing/backend/services/testDataSet.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const {
  normalizeApiRequest,
  inferAutomationStepType,
  validateGeneratedApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { isMobileAppType, isMobileRecorderTarget } = require("@hellotest/platform/backend/src/utils/mobileFeature");
const { resolveMobileEngineSecret } = require("@hellotest/platform/backend/src/security/runtimeSecrets");

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
const { selectStaleRecorderTransactions, applyRecorderSteps, preflightRecorderUploadBindings, finalizeRecorderBuild } = require('./builder/recorderImport').createRecorderImport({exports,require:builderDependency,get MAX_CACHE_ROWS(){return MAX_CACHE_ROWS;},get MAX_CAPTURED_ACTIONS(){return MAX_CAPTURED_ACTIONS;},get RECORDER_ORPHAN_TTL_MS(){return RECORDER_ORPHAN_TTL_MS;},get appendEvent(){return appendEvent;},get automationCasePreparationService(){return automationCasePreparationService;},get buildEngineUrl(){return buildEngineUrl;},get buildFallbackRecorderMappings(){return buildFallbackRecorderMappings;},get buildRecorderRepositoryModel(){return buildRecorderRepositoryModel;},get buildRecorderStepCandidate(){return buildRecorderStepCandidate;},get buildRecorderStepCandidates(){return buildRecorderStepCandidates;},get createArtifactContent(){return createArtifactContent;},get createRecorderAutomationCode(){return createRecorderAutomationCode;},get db(){return db;},get getOptionalEvidenceAccess(){return getOptionalEvidenceAccess;},get hasRemoteMobileProvider(){return hasRemoteMobileProvider;},get inferAutomationStepType(){return inferAutomationStepType;},get isMobileAppType(){return isMobileAppType;},get isMobileRecorderTarget(){return isMobileRecorderTarget;},get isRecorderSessionPastOrphanTtl(){return isRecorderSessionPastOrphanTtl;},get listLearningCacheRows(){return listLearningCacheRows;},get loadAutomationParameterContext(){return loadAutomationParameterContext;},get markTestCaseAutomationIncomplete(){return markTestCaseAutomationIncomplete;},get markTestCaseAutomationReady(){return markTestCaseAutomationReady;},get mobileFeatureService(){return mobileFeatureService;},get normalizeCapturedActions(){return normalizeCapturedActions;},get normalizeCapturedNetwork(){return normalizeCapturedNetwork;},get normalizeGeneratedProgram(){return normalizeGeneratedProgram;},get normalizeLocalEngineBaseUrl(){return normalizeLocalEngineBaseUrl;},get normalizeText(){return normalizeText;},get obsDb(){return obsDb;},get orderRecorderCandidates(){return orderRecorderCandidates;},get parseTransactionMetadata(){return parseTransactionMetadata;},get persistLearning(){return persistLearning;},get persistMobileRecorderPlan(){return persistMobileRecorderPlan;},get readEngineJson(){return readEngineJson;},get readMobileEngineJson(){return readMobileEngineJson;},get resolveAutomationCaseSteps(){return resolveAutomationCaseSteps;},get resolveBuildContext(){return resolveBuildContext;},get resolveMobileEngineBaseUrl(){return resolveMobileEngineBaseUrl;},get resolveMobileRecorderPlatform(){return resolveMobileRecorderPlatform;},get resolveRecorderPublicBaseUrl(){return resolveRecorderPublicBaseUrl;},get resolveTestEngineIntegration(){return resolveTestEngineIntegration;},get selectCaseWithScope(){return selectCaseWithScope;},get selectStepsForCase(){return selectStepsForCase;},get summarizeStep(){return summarizeStep;},get testStepService(){return testStepService;},get updateTransaction(){return updateTransaction;},get uuid(){return uuid;},get workspaceTransactionService(){return workspaceTransactionService;}});

const { upsertLearningCacheRecord, upsertLearningCache, selectLearningCacheEntry, selectLearningCacheScreenEntries, updateLearningCacheEntry, deleteLearningCacheEntry, deleteLearningCacheScreen, renameLearningCacheScreen, replaceTestStepRepositoryReference, inferLocatorStrategy, normalizeLearningCacheRow, listLearningCacheRows, canonicalRepositoryProjection, readRepositoryScope, lockRepositoryScope, saveRepositoryProjection, reconcileRepositoryScope, persistCanonicalRepositoryRow, listLearningCacheScreenRows, listAllLearningCacheRows, normalizeRepositoryPatch, persistLearning, csvValue, getRepositoryObjectName, isRepositoryScreenRecord, getRepositoryMemberReference, migrateRepositoryMemberReference, resolveRepositoryScreenBinding, buildRepositoryUsageNeedles, invalidateRepositoryUsage } = require('./builder/repositoryStorage').createRepositoryStorage({exports,require:builderDependency,get MAX_CACHE_ROWS(){return MAX_CACHE_ROWS;},get appendEvent(){return appendEvent;},get buildDeterministicRepositorySuggestion(){return buildDeterministicRepositorySuggestion;},get buildRecorderRepositoryModel(){return buildRecorderRepositoryModel;},get buildRepositoryExtractPrompt(){return buildRepositoryExtractPrompt;},get buildRepositoryImprovePrompt(){return buildRepositoryImprovePrompt;},get canonicalPageUrl(){return canonicalPageUrl;},get canonicalizeRepositoryRows(){return canonicalizeRepositoryRows;},get clampNumber(){return clampNumber;},get db(){return db;},get extractJsonPayload(){return extractJsonPayload;},get markTestCaseAutomationIncomplete(){return markTestCaseAutomationIncomplete;},get normalizeObject(){return normalizeObject;},get normalizeRepositoryExtractFields(){return normalizeRepositoryExtractFields;},get normalizeText(){return normalizeText;},get normalizeUrlKey(){return normalizeUrlKey;},get obsDb(){return obsDb;},get platformSource(){return platformSource;},get repositoryInputMetadata(){return repositoryInputMetadata;},get requestChatCompletion(){return requestChatCompletion;},get resolveLlmIntegration(){return resolveLlmIntegration;},get safeJson(){return safeJson;},get sameRecordedLocator(){return sameRecordedLocator;},get uuid(){return uuid;}});


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
    requireBuildEnvironment(normalizeText(test_environment_id), testEnvironmentService.getTestEnvironment),
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
const { normalizeUrlKey, toTitleWords, toObjectSegment, inferScreenName, inferScreenNameFromTitle, GENERIC_SCREEN_PATH_SEGMENTS, normalizeUrlPathSegment, inferScreenNameFromUrl, inferObjectRole, inferObjectLabel, NON_REPOSITORY_RECORDING_LOCATORS, isRecorderRepositoryLocator, normalizeRepositoryNameKey, uniqueRepositoryName, recorderPageIdentity, repositoryActionKey, inferKeywordForAction, inferRecorderKeywordForPlatform, buildObjectRepositoryEntry, platformSource, loadRepositoryRowsForNaming, buildRecorderRepositoryNamingPrompt, buildAiRecorderRepositoryNameSuggestions, buildExistingRepositoryNameIndex, buildRecorderRepositoryModel, summarizeStep, summarizeCache, summarizeScreenCatalog, summarizeKnowledge, buildRepositoryImprovePrompt, buildRepositoryExtractPrompt, normalizeRepositoryExtractFields, buildDeterministicRepositorySuggestion } = require('./builder/repositoryModel').createRepositoryModel({exports,require:builderDependency,get aiInstructionBlock(){return aiInstructionBlock;},get appendEvent(){return appendEvent;},get clampNumber(){return clampNumber;},get extractJsonPayload(){return extractJsonPayload;},get getRepositoryObjectName(){return getRepositoryObjectName;},get inferAutomationStepType(){return inferAutomationStepType;},get inferLocatorStrategy(){return inferLocatorStrategy;},get isRepositoryScreenRecord(){return isRepositoryScreenRecord;},get listAllLearningCacheRows(){return listAllLearningCacheRows;},get listLearningCacheRows(){return listLearningCacheRows;},get normalizeApiRequest(){return normalizeApiRequest;},get normalizeCapturedActions(){return normalizeCapturedActions;},get normalizeLearningCacheRow(){return normalizeLearningCacheRow;},get normalizeObject(){return normalizeObject;},get normalizeRichText(){return normalizeRichText;},get normalizeText(){return normalizeText;},get recorderParameterHint(){return recorderParameterHint;},get requestChatCompletion(){return requestChatCompletion;},get resolveLlmIntegration(){return resolveLlmIntegration;}});

const { normalizeCapturedActions, normalizeCapturedNetwork, parseActionTimestamp, stripRecorderLocatorPrefix, getRecorderRepositoryMember, resolveRecorderTarget, quoteCodeString, playwrightLocatorCode, playwrightLocatorBlock, inferRecorderFillValue, recorderParameterHint, describeRecorderTarget, keywordComment, buildRecorderStepCandidate, isRecorderActionSuperseded, buildRecorderStepCandidates, tokenizeMappingText, scoreRecorderMapping, buildFallbackRecorderMappings, orderRecorderCandidates, mergeRecorderMappingGroups, buildRecorderMappingPrompt, normalizeRecorderAiMappings, buildAiRecorderMappings, createRecorderAutomationCode } = require('./builder/recordedProgram').createRecordedProgram({exports,require:builderDependency,get MAX_CAPTURED_ACTIONS(){return MAX_CAPTURED_ACTIONS;},get MAX_CAPTURED_NETWORK(){return MAX_CAPTURED_NETWORK;},get NON_REPOSITORY_RECORDING_LOCATORS(){return NON_REPOSITORY_RECORDING_LOCATORS;},get aiInstructionBlock(){return aiInstructionBlock;},get appendEvent(){return appendEvent;},get clampNumber(){return clampNumber;},get extractJsonPayload(){return extractJsonPayload;},get inferKeywordForAction(){return inferKeywordForAction;},get isPlainObject(){return isPlainObject;},get normalizeRichText(){return normalizeRichText;},get normalizeText(){return normalizeText;},get requestChatCompletion(){return requestChatCompletion;},get resolveLlmIntegration(){return resolveLlmIntegration;},get summarizeStep(){return summarizeStep;}});

const { buildPrompt, normalizeStepCandidate, normalizeLlmBuild, buildCaseCore } = require('./builder/programGeneration').createProgramGeneration({exports,require:builderDependency,get LLM_TIMEOUT_MS(){return LLM_TIMEOUT_MS;},get MAX_CACHE_ROWS(){return MAX_CACHE_ROWS;},get aiInstructionBlock(){return aiInstructionBlock;},get apiParameterBindingContext(){return apiParameterBindingContext;},get appendEvent(){return appendEvent;},get applyBuild(){return applyBuild;},get assertApiParameterBindings(){return assertApiParameterBindings;},get automationCasePreparationService(){return automationCasePreparationService;},get automationExpectedResultTemplate(){return automationExpectedResultTemplate;},get automationStepType(){return automationStepType;},get buildFeature(){return buildFeature;},get buildNavigationOrigins(){return buildNavigationOrigins;},get clampNumber(){return clampNumber;},get completeAutomationBuild(){return completeAutomationBuild;},get createArtifactContent(){return createArtifactContent;},get db(){return db;},get extractJsonPayload(){return extractJsonPayload;},get getOptionalEvidenceAccess(){return getOptionalEvidenceAccess;},get inferAutomationStepType(){return inferAutomationStepType;},get isPlainObject(){return isPlainObject;},get listLearningCacheRows(){return listLearningCacheRows;},get loadAutomationManualContext(){return loadAutomationManualContext;},get loadAutomationParameterContext(){return loadAutomationParameterContext;},get loadAutomationStoryContext(){return loadAutomationStoryContext;},get manualContextKey(){return manualContextKey;},get mobileFeatureService(){return mobileFeatureService;},get navigationOrigins(){return navigationOrigins;},get normalizeAgentContext(){return normalizeAgentContext;},get normalizeApiRequest(){return normalizeApiRequest;},get normalizeAutomationStartUrl(){return normalizeAutomationStartUrl;},get normalizeCapturedActions(){return normalizeCapturedActions;},get normalizeCapturedNetwork(){return normalizeCapturedNetwork;},get normalizeGeneratedProgram(){return normalizeGeneratedProgram;},get normalizeObject(){return normalizeObject;},get normalizeRichText(){return normalizeRichText;},get normalizeTestStepType(){return normalizeTestStepType;},get normalizeText(){return normalizeText;},get normalizeUrlKey(){return normalizeUrlKey;},get parseJsonValue(){return parseJsonValue;},get persistLearning(){return persistLearning;},get preserveGeneratedAssertions(){return preserveGeneratedAssertions;},get requestChatCompletion(){return requestChatCompletion;},get requiresAutomationStartUrl(){return requiresAutomationStartUrl;},get resolveAutomationCaseSteps(){return resolveAutomationCaseSteps;},get resolveAutomationCaseType(){return resolveAutomationCaseType;},get resolveAutomationDraftSteps(){return resolveAutomationDraftSteps;},get resolveAutomationStartUrl(){return resolveAutomationStartUrl;},get resolveBuildBrowserIntegration(){return resolveBuildBrowserIntegration;},get resolveBuildContext(){return resolveBuildContext;},get resolveLlmIntegration(){return resolveLlmIntegration;},get resolveTestEngineIntegration(){return resolveTestEngineIntegration;},get retrieveAgentContext(){return retrieveAgentContext;},get runtimeSpecialist(){return runtimeSpecialist;},get runtimeSpecialistInstructions(){return runtimeSpecialistInstructions;},get safeJson(){return safeJson;},get scopeRepositoryToTarget(){return scopeRepositoryToTarget;},get selectCaseWithScope(){return selectCaseWithScope;},get selectStepsForCase(){return selectStepsForCase;},get storedAutomationCaseType(){return storedAutomationCaseType;},get summarizeCache(){return summarizeCache;},get summarizeKnowledge(){return summarizeKnowledge;},get summarizeScreenCatalog(){return summarizeScreenCatalog;},get summarizeStep(){return summarizeStep;},get testEnvironmentService(){return testEnvironmentService;},get validateApiRequestGrounding(){return validateApiRequestGrounding;},get validateGeneratedApiRequest(){return validateGeneratedApiRequest;},get validateNavigationGrounding(){return validateNavigationGrounding;},get workspaceTransactionService(){return workspaceTransactionService;}});



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

const createArtifactContent = input => require("../lib/build/automationPortableArtifact").createPortableAutomationArtifact(input);

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
      if (build.case_platform_key !== undefined && storedAutomationCaseType(currentCase) !== build.case_platform_key) throw Object.assign(new Error('The automation case type changed while the agent was building. Existing instructions were retained; rebuild using the current platform.'), { statusCode: 409, code: 'AUTOMATION_CASE_TYPE_CHANGED' });
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
          const currentInputs=await require("../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase:currentCase,projectId:build.project_id,userId:createdBy,caseValues:currentParameters.runtime_parameter_values,privateParameterNames:currentParameters.private_parameter_names,parameterOverrides:currentParameters.parameter_overrides,...inputContext.selection,materialize:false,lock:true});
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
      if (dataSnapshot) await require("../lib/build/automationBuildDataSnapshot").persistBuildDataSnapshot({ testCase: currentCase, projectId: build.project_id, userId: createdBy, snapshot: dataSnapshot });
    }

    const replacementById = new Map(build.updates.map(update => [update.step.id, update]));
    const validationSteps = (partial ? build.updates.map(update => update.step) : current.length ? current : baseline).map(step => {
      const update = replacementById.get(step.id);
      return update ? { ...step, step_type: update.step_type, automation_code: update.automation_code, api_request: update.api_request } : step;
    });
    const executableIssues = require('./automationReadiness.service').inspectExecutablePlan(validationSteps);
    if (executableIssues.length) throw Object.assign(new Error(`Generated instructions are not executable. ${executableIssues.join(' ')} Existing instructions were retained.`), {
      code: 'AUTOMATION_SAVED_PLAN_INVALID', statusCode: 422, validation_feedback: executableIssues
    });

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
      const nextInputs=inputContext?await require("../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase:nextCase,projectId:build.project_id,userId:createdBy,caseValues:nextParameters.runtime_parameter_values,privateParameterNames:nextParameters.private_parameter_names,parameterOverrides:nextParameters.parameter_overrides,...inputContext.selection,materialize:false,lock:true}):null;
      nextState = { steps: JSON.parse(JSON.stringify(await db.prepare(stepsSql).all(caseId))),
        parameter_context_key: nextParameters.source_key, input_context:inputContext?{...inputContext,source_key:nextInputs.inputSourceKey}:undefined, data_snapshot: null };
    }
    return { updated, nextState };
  })();
  // A failed transaction or COMMIT must never advance the in-memory baseline.
  if (progressiveState && committed.nextState) Object.assign(progressiveState, committed.nextState);
  return committed.updated;
};

exports.buildAutomationForCase = async ({
  test_case_id,
  paired_browser_bridge_id,
  integration_id,
  ai_feature,
  created_by,
  start_url,
  start_url_review,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver,
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

  const transaction = await require('./automationAuthoringAdmission.service').withBuild({testCase,excludeTransactionId:existingTransactionId},async()=>(existingTransactionId
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
      })));

  const caseStartedAt = Date.now();
  try {
    const result = await buildCaseCore({
      test_case_id: normalizedCaseId,
      paired_browser_bridge_id,
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
    const engineMetadata=result.build_engine?{build_engine:result.build_engine,
      ...(result.browser_evidence?.transport==='upstream_playwright_mcp'?{browser_driver:require("../lib/build/automationBuildPipelineOptions").UPSTREAM_BROWSER_DRIVER}:{})}:{};

    await workspaceTransactionService.updateTransaction(transaction.id, {
      status: result.generated_step_count ? "completed" : "failed",
      related_kind: "test_case",
      related_id: result.test_case_id,
      description: result.generated_step_count
        ? `Generated instructions for ${result.generated_step_count} sections. ${result.verification_status==='verified'?'The saved source passed isolated verification.':'Isolated verification has not passed.'}`
        : "Automation builder did not produce any step updates.",
      metadata: {
        ...engineMetadata,
        current_phase: "completed",
        outcome_status: "generated",
        verification_status:result.verification_status,
        phase_message: `Instructions saved for ${result.generated_step_count} sections. ${result.verification_status==='verified'?'Isolated verification passed.':'Review the verification result before execution.'}`,
        generated: 1,
        failed: 0,
        output_test_case_ids: [result.test_case_id],
        retry_test_case_ids: [],
        case_outcomes: [{test_case_id:result.test_case_id,title:result.title,status:"generated",generated_step_count:result.generated_step_count,completion_attempts:result.completion_attempts,verification_status:result.verification_status,verification:result.verification,duration_ms:Date.now()-caseStartedAt,...engineMetadata}],
        progress_percent: 100,
        total_items: 1,
        processed_items: 1,
        test_case_id: result.test_case_id,
        source_test_case_id: result.source_test_case_id,
        generated_steps: result.generated_step_count,
        learned_locator_count: result.learned_locator_count,
        fallback_used: result.fallback_used,
        warnings: result.warnings || [],
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
        retry_test_case_ids: error.effect_dispatched ? [] : [normalizedCaseId],
        case_outcomes: [{test_case_id:error.automation_test_case_id||normalizedCaseId,source_test_case_id:error.source_test_case_id,title:testCase.title,status:error.saved_sections||["AUTOMATION_BUILD_INCOMPLETE","AUTOMATION_DEPENDENCY_MISSING"].includes(error.code)?"incomplete":"failed",message,error:message,code:error.code,error_code:error.code||null,failure_stage:error.failure_stage||null,...(error.code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&Number.isInteger(error.http_status)&&error.http_status>=400&&error.http_status<=599?{http_status:error.http_status}:{}),active_step_id:error.active_step_id,failed_step_id:error.active_step_id,active_manual_step_ids:error.active_manual_step_ids,changes_saved:Boolean(error.saved_sections),saved_sections:error.saved_sections||0,saved_step_ids:error.saved_step_ids||[],completed_sections:error.completed_sections,total_sections:error.total_sections,pending_step_ids:error.pending_step_ids,blocked_steps:error.blocked_steps,effect_dispatched:error.effect_dispatched===true,outcome_unknown:error.outcome_unknown===true}],
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
  paired_browser_bridge_id,
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
  let transactionId = normalizeText(transaction_id);

  const admissionInput = {
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
        test_environment_id: normalizeText(test_environment_id),
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
  };
  const admissionReceipt=await require('./automationAuthoringAdmission.service').withBuild({testCase:firstCase,caseIds:targetIds,excludeTransactionId:transactionId},async()=> transactionId
    ? updateTransaction(transactionId,admissionInput)
    : workspaceTransactionService.createTransaction({...admissionInput,created_by}));
  transactionId=admissionReceipt?.id||transactionId;

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

    const caseStartedAt = Date.now();
    try {
      const scopedCase = await selectCaseWithScope.get(testCaseId);
      if (!scopedCase || scopedCase.app_type_id !== appTypeId) throw new Error("Every selected automation case must belong to the batch application.");
      const pinnedStartUrl = start_urls_by_case_id && Object.hasOwn(start_urls_by_case_id,testCaseId)
        ? start_urls_by_case_id[testCaseId] : start_url !== undefined ? start_url : scopedCase.automation_start_url;
      if(transactionId){
        const savedSteps=await selectStepsForCase.all(testCaseId);
        normalizeAutomationStartUrl(pinnedStartUrl,{required:requiresAutomationStartUrl({appTypeKind:scopedCase.app_type_kind,steps:savedSteps})});
      }
      const result = await buildCaseCore({
        test_case_id: testCaseId,
        paired_browser_bridge_id,
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
      caseOutcomes.push({test_case_id:result.test_case_id,source_test_case_id:result.source_test_case_id,title:result.title,status:"generated",generated_step_count:result.generated_step_count,completion_attempts:result.completion_attempts,verification_status:result.verification_status,verification:result.verification,duration_ms:Date.now()-caseStartedAt});
    } catch (error) {
      if(execution_guard?.signal.aborted||error.code==="BATCH_JOB_LEASE_LOST")throw execution_guard?.signal.reason||error;
      if(!error.nonRetryable&&!["AI_INSTRUCTION_MISSING","AI_FEATURE_UNMAPPED","AI_CONFIGURATION_INVALID"].includes(error.code)&&[408,425,429,500,502,503,504].includes(Number(error.statusCode||error.status)))retryableErrors.push(error);
      errors.push({
        test_case_id: error.automation_test_case_id||testCaseId,
        source_test_case_id:error.source_test_case_id,
        message: error instanceof Error ? error.message : "Automation build failed",
        code: error.code || null,
        error_code: error.code || null,
        duration_ms: Date.now()-caseStartedAt,
        failure_stage: error.failure_stage || null,
        ...(error.code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&Number.isInteger(error.http_status)&&error.http_status>=400&&error.http_status<=599?{http_status:error.http_status}:{}),
        active_step_id:error.active_step_id,failed_step_id:error.active_step_id,active_manual_step_ids:error.active_manual_step_ids,
        completed_sections: error.completed_sections,
        saved_sections:error.saved_sections||0,
        saved_step_ids:error.saved_step_ids||[],
        total_sections: error.total_sections,
        pending_step_ids: error.pending_step_ids,
        blocked_steps:error.blocked_steps,
        effect_dispatched:error.effect_dispatched===true,
        outcome_unknown:error.outcome_unknown===true
      });
      caseOutcomes.push({...errors[errors.length-1],status:error.saved_sections||["AUTOMATION_BUILD_INCOMPLETE","AUTOMATION_DEPENDENCY_MISSING"].includes(error.code)?"incomplete":"failed",changes_saved:Boolean(error.saved_sections)});
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
      retry_test_case_ids: targetIds.filter(id => !created.some(result => result.test_case_id === id || result.source_test_case_id === id)
        && !errors.some(error => error.effect_dispatched && (error.test_case_id === id || error.source_test_case_id === id))),
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
const { resolveTestEngineIntegration, resolveBuildBrowserIntegration, resolveMobileEngineBaseUrl, hasRemoteMobileProvider, readEngineJson, readMobileEngineJson, buildEngineUrl, isPrivateAddress, normalizeLocalEngineBaseUrl, resolveRecorderPublicBaseUrl, parseTransactionMetadata, isRecorderSessionPastOrphanTtl } = require('./builder/engineResolution').createEngineResolution({exports,require:builderDependency,get ENGINE_TIMEOUT_MS(){return ENGINE_TIMEOUT_MS;},get MOBILE_ENGINE_SECRET_HEADER(){return MOBILE_ENGINE_SECRET_HEADER;},get RECORDER_ORPHAN_TTL_MS(){return RECORDER_ORPHAN_TTL_MS;},get integrationService(){return integrationService;},get normalizeText(){return normalizeText;},get resilientHttpRequest(){return resilientHttpRequest;},get resolveMobileEngineSecret(){return resolveMobileEngineSecret;},get safeJson(){return safeJson;}});


/** Open only the reviewed entry page from the selected browser worker. */
exports.preflightAutomationBrowser = async ({
  projectId, appTypeId, user, startUrl, environmentId, signal, caseId, configurationId, dataSetId, suiteId, integrationId, checkModel = false, retryStartup = false
} = {}) => {
  const { browserEntryError, probeBrowserEntry } = require('../lib/browser/automationBrowserEntry');
  signal?.throwIfAborted();
  const testCase = caseId ? await selectCaseWithScope.get(caseId) : null;
  if (caseId && (!testCase || projectId && projectId !== testCase.project_id || appTypeId && appTypeId !== testCase.app_type_id)) {
    throw browserEntryError('AUTOMATION_CASE_UNAVAILABLE', 'The automation case is unavailable in this application.', 404);
  }
  projectId ??= testCase?.project_id;
  appTypeId ??= testCase?.app_type_id;
  if (!projectId || !appTypeId || !user?.id) throw browserEntryError('AUTOMATION_BROWSER_SCOPE_REQUIRED', 'Choose a project and application for the browser build.', 400);
  const permissions = ['automation.build', 'automation.ai', ...(environmentId ? ['environment.view'] : []), ...(configurationId ? ['configuration.view'] : []), ...(dataSetId ? ['data.view'] : []), ...(suiteId ? ['suite.view'] : [])];
  const assertAccess = async () => {
    const access = await getOptionalEvidenceAccess(user, projectId, permissions);
    if (permissions.some(permission => !access[permission])) throw browserEntryError('AUTOMATION_BUILD_ACCESS_REQUIRED', 'Browser setup requires automation build, AI and selected execution context access.', 403);
  };
  await assertAccess();
  const app = await db.prepare('SELECT id FROM app_types WHERE id=? AND project_id=?').get(appTypeId, projectId);
  if (!app) throw browserEntryError('AUTOMATION_APPLICATION_UNAVAILABLE', 'The selected application is unavailable in this project.', 404);
  const environment = await requireBuildEnvironment(environmentId, testEnvironmentService.getTestEnvironment);
  if (environment && (environment.project_id !== projectId || environment.app_type_id && environment.app_type_id !== appTypeId)) {
    throw browserEntryError('AUTOMATION_ENVIRONMENT_UNAVAILABLE', 'Choose a Test Environment in this project and application.', 422);
  }
  let url;
  try {
    url = normalizeAutomationStartUrl(startUrl ?? testCase?.automation_start_url ?? environment?.base_url, { required: true });
  } catch (error) {
    throw browserEntryError(error.code, error.message, error.statusCode);
  }
  if (testCase) {
    const { plan } = await require('./automationBuildParameterPlan.service').loadState({
      testCase, userId: user.id, test_environment_id: environmentId, test_configuration_id: configurationId,
      test_data_set_id: dataSetId, test_suite_id: suiteId
    });
    const privateNames = new Set(plan.private_parameter_references);
    const deferredNames = new Set(plan.deferred_parameter_references);
    const environmentNames = require('../lib/build/automationBuildInputPreflight').protectedEnvironmentParameters(environment);
    const missing = [...new Set([...plan.missing_parameter_references, ...plan.empty_parameter_references])]
      .filter(name => (environmentNames.has(name) || /^[ts]\./.test(name) && privateNames.has(name)) && !deferredNames.has(name));
    if (missing.length) throw browserEntryError('AUTOMATION_DEPENDENCY_MISSING', `Set protected test inputs before building: ${missing.map(name => `@${name}`).join(', ')}.`);
  }
  if (checkModel) {
    try { await resolveLlmIntegration(integrationId, { allowFallback: false, userId: user.id, projectId, usageKey: buildFeature('ai.agentic.automation-engineer') }); }
    catch { throw browserEntryError('AUTOMATION_MODEL_UNAVAILABLE', 'Choose an active model connection for Automation Build Agent.'); }
  }
  await probeBrowserEntry({ integration: await resolveTestEngineIntegration({ project_id: projectId }), startUrl: url, signal,
    ...(retryStartup ? {retryStartup:true,beforeConnect:assertAccess} : {}) });
  return { status: 'ready', browser: 'reachable', ...(environment ? { environment: { id: environment.id, name: environment.name } } : {}) };
};

exports.connectCaseBrowser = async ({projectId,appTypeId,user,caseId,environmentId,startUrl,allowBrowserActions=false,browser_driver='playwright_mcp_upstream',signal}) => {
  const testCase=await selectCaseWithScope.get(caseId);
  if(!testCase || testCase.project_id!==projectId || appTypeId && testCase.app_type_id!==appTypeId)throw Object.assign(new Error("The automation case is unavailable in this application."),{statusCode:404});
  const permissions=["automation.view","automation.code.view","automation.ai","testcase.view",...(allowBrowserActions?["automation.build"]:[]),...(environmentId?["environment.view"]:[])];
  const access=await getOptionalEvidenceAccess(user,projectId,permissions);
  if(permissions.some(key=>!access[key]))throw Object.assign(new Error("Automation browser evidence requires case, code, AI and selected environment access; browser interactions also require build permission."),{statusCode:403});
  const steps=resolveAutomationCaseSteps(testCase,await selectStepsForCase.all(caseId),{appTypeKind:testCase.app_type_kind}).steps;
  if(!steps.some(step=>normalizeTestStepType(step.step_type,"web")==="web"))throw Object.assign(new Error("Playwright MCP supports web sections; API-only or native mobile cases use their own runtime."),{statusCode:422});
  const buildContext=await resolveBuildContext({testCase,test_environment_id:environmentId});
  const url=resolveAutomationStartUrl({startUrl,caseUrl:testCase.automation_start_url ?? buildContext.environment?.base_url,steps,required:true}).url;
  if(!url)throw Object.assign(new Error("Select an environment with a start URL for live Playwright MCP inspection."),{statusCode:422});
  const engine=await resolveTestEngineIntegration(testCase);
  const parameterContext=await loadAutomationParameterContext({testCase,projectId,userId:user.id});
  const browserParameters=await require("../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase,projectId,userId:user.id,caseValues:parameterContext.runtime_parameter_values,privateParameterNames:parameterContext.private_parameter_names,parameterOverrides:parameterContext.parameter_overrides,test_environment_id:environmentId});
  if(browser_driver!=='legacy_repair_mcp'){
    require("../lib/build/automationBuildPipelineOptions").normalizeBuildPipelineOptions({browser_driver});
    const {toolsForPolicy,validateRequest,resolveSecretReferences}=require("../lib/upstream/automationUpstreamEngineer");
    const bindings=browserParameters.upstreamBindings();
    const activePermissions=[...new Set([...permissions,...browserParameters.required_permissions||[]])];
    const guard=async args=>{signal?.throwIfAborted();const current=await getOptionalEvidenceAccess(user,projectId,[...activePermissions,'data.view']);if(activePermissions.some(key=>!current[key])||(Object.keys(bindings.secrets).length>0||/@[tsr]\./.test(JSON.stringify(args||{})))&&!current['data.view'])throw Object.assign(new Error('Automation browser access changed.'),{statusCode:403});};
    await guard();
    const browser=await require("../lib/upstream/automationUpstreamMcpClient").connectUpstreamPlaywright({integration:engine,startUrl:url,secrets:bindings.secrets,signal});
    const nativeCall=browser.call;
    browser.tools=toolsForPolicy(browser.tools,allowBrowserActions===true);browser.driver='playwright_mcp_upstream';
    browser.projectPrivateText=browserParameters.projectPrivateText;
    const catalog=new Map(browser.tools.map(tool=>[tool.name,tool]));
    browser.call=async(name,args,options)=>{
      await guard(args);const resolved=resolveSecretReferences(name,args,bindings.references,bindings.secrets,bindings.parameterValues);
      validateRequest({name,arguments:resolved},catalog,{interactive:allowBrowserActions===true,startUrl:url});
      try{return browserParameters.redactResult(await nativeCall(name,resolved,options));}catch(error){throw browserParameters.redactError(error);}
    };
    let navigated=false;
    browser.navigateToStart=async()=>{if(navigated)throw Object.assign(new Error('The initial browser navigation already ran.'),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});navigated=true;await guard();try{return browserParameters.redactResult(await nativeCall('browser_navigate',{url}));}catch(error){throw browserParameters.redactError(error);}};
    return {browser,startUrl:url,browser_driver:'playwright_mcp_upstream'};
  }
  const {connectAutomationBrowser}=require("../lib/browser/automationBrowserAgent");
  const browser=await connectAutomationBrowser({integration:engine,startUrl:url,allowBrowserActions,signal});
  const call=browser.call;
  browser.call=async(name,args,options)=>{const current=await getOptionalEvidenceAccess(user,projectId,[...permissions,'data.view']);if(permissions.some(key=>!current[key])||browserParameters.requiresDataAccess(name,args)&&!current['data.view'])throw Object.assign(new Error("Automation browser access changed."),{statusCode:403});try{return browserParameters.redactResult(await call(name,browserParameters.resolve(name,args),options));}catch(error){throw browserParameters.redactError(error);}};
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
  const resolver=await require("../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase,projectId,userId:user.id,
    caseValues:parameters.runtime_parameter_values,privateParameterNames:parameters.private_parameter_names,parameterOverrides:parameters.parameter_overrides,steps:[...sections,...manual.flatMap(item=>item.steps)],materialize:false,allowUnselectedSuite:true});
  const stories=await loadAutomationStoryContext({caseId,projectId,userId:user.id});
  return {evidence_permissions:[...permissions,...(access['data.view']?['data.view']:[]),...(stories.stories?.length?['requirement.view']:[])],linked_manual_cases:resolver.projectManualCases(manual),case:{...resolver.projectCase({id:testCase.id,title:testCase.title,description:testCase.description,gherkin_document:testCase.gherkin_document,priority:testCase.priority,labels:safeJson(testCase.labels,[])}),revision:testCase.revision,automated:testCase.automated,parameter_values:resolver.publicParameterValues},
    sections:resolver.projectSteps(sections),deferred_parameter_references:resolver.deferredParameterNames,private_parameter_references:resolver.privateParameterNames,suite_selection_required:resolver.suite_selection_required===true,
    stories};
};

/** Configured source/model adapter for a protected, evidence-backed preview.
 * This does not enter case generation, connect Playwright or persist a step. */
exports.completeRetainedSourceProposal = async ({projectId,userId,integrationId,prompt,phase,caseId,sectionId,signal,timeoutMs,beforeDispatch,sessionId}) => {
  if (!['upstream_source','upstream_instruction_mapping'].includes(phase) || typeof beforeDispatch !== 'function') throw Object.assign(new Error('Only the guarded native source and display-mapping phases are supported.'),{statusCode:400});
  await beforeDispatch();
  const featureKey='ai.agentic.automation-engineer';
  const integration=await resolveLlmIntegration(integrationId,{userId,projectId,usageKey:featureKey});
  if(!integration)throw Object.assign(new Error('Configure an active LLM integration before requesting a source proposal.'),{statusCode:422});
  return require('@hellotest/platform/backend/src/utils/llmTraceContext').run({project_id:projectId,actor_id:userId,session_id:sessionId,test_case_id:caseId,generation_scope:phase,generation_section_ids:[sectionId],section_attempt:1,completion_attempt:1,automation_source_proposal:true,mcp_context_depth:1,mcp_context:'retained_native_evidence'},()=>requestChatCompletion({integration,featureKey,prompt,signal,timeoutMs,upstreamPhase:phase,browserReview:true,beforeDispatch}));
};
