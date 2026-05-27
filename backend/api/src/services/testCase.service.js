const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const suiteTestCaseService = require("./suiteTestCase.service");
const testSuiteService = require("./testSuite.service");
const sharedStepSyncService = require("./sharedStepSync.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { DOMAIN_METADATA, TEST_CASE_AUTOMATED_VALUES, TEST_CASE_STATUS_VALUES } = require("../domain/catalog");
const displayIdService = require("./displayId.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("../utils/testStepAutomation");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("../utils/externalReferences");

const DEFAULT_PRIORITY = 3;
const DEFAULT_STATUS = DOMAIN_METADATA.test_cases.default_status;
const DEFAULT_AUTOMATED = DOMAIN_METADATA.test_cases.default_automated || "no";
const AUTOMATION_STATUS_VALUES = ["not_automated", "ready", "incomplete"];
const IMPORT_SOURCE_LABELS = {
  csv: "CSV",
  junit_xml: "JUnit XML",
  testng_xml: "TestNG XML",
  postman_collection: "Postman collection"
};

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const selectSuite = db.prepare(`
  SELECT id, app_type_id
  FROM test_suites
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, project_id
  FROM requirements
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name
  FROM shared_step_groups
  WHERE id = ?
`);

const selectSuitesForAppType = db.prepare(`
  SELECT id, name, app_type_id
  FROM test_suites
  WHERE app_type_id = ?
`);

const selectRequirementsForProject = db.prepare(`
  SELECT id, title, project_id
  FROM requirements
  WHERE project_id = ?
`);

const selectSharedStepGroupsForAppType = db.prepare(`
  SELECT id, name, app_type_id
  FROM shared_step_groups
  WHERE app_type_id = ?
`);

const insertTestCaseRecord = db.prepare(`
  INSERT INTO test_cases (
    id,
    display_id,
    app_type_id,
    suite_id,
    title,
    description,
    external_references,
    parameter_values,
    automated,
    automation_status,
    priority,
    status,
    requirement_id,
    ai_generation_source,
    ai_generation_review_status,
    ai_generation_job_id,
    ai_generated_at,
    created_by,
    updated_by,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const updateTestCaseRecord = db.prepare(`
  UPDATE test_cases
  SET app_type_id = ?, suite_id = ?, title = ?, description = ?, external_references = ?, parameter_values = ?, automated = ?, automation_status = ?, priority = ?, status = ?, requirement_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const insertSuiteMapping = db.prepare(`
  INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
  VALUES (?, ?, ?)
`);

const deleteSuiteMappings = db.prepare(`
  DELETE FROM suite_test_cases
  WHERE test_case_id = ?
`);

const insertRequirementMapping = db.prepare(`
  INSERT INTO requirement_test_cases (requirement_id, test_case_id)
  VALUES (?, ?)
  ON CONFLICT DO NOTHING
`);

const deleteRequirementMappings = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE test_case_id = ?
`);

const insertStep = db.prepare(`
  INSERT INTO test_steps (
    id,
    test_case_id,
    step_order,
    action,
    expected_result,
    step_type,
    automation_code,
    api_request,
    group_id,
    group_name,
    group_kind,
    reusable_group_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteStepsForTestCase = db.prepare(`
  DELETE FROM test_steps
  WHERE test_case_id = ?
`);

const deleteTestCaseRecord = db.prepare(`
  DELETE FROM test_cases
  WHERE id = ?
`);

const updateGeneratedReviewState = db.prepare(`
  UPDATE test_cases
  SET ai_generation_review_status = ?
  WHERE id = ?
`);

const hydrateSuiteIds = async (testCase) => {
  if (!testCase) {
    return testCase;
  }

  return {
    ...testCase,
    external_references: normalizeStoredReferenceList(testCase.external_references),
    parameter_values: normalizeParameterValues(testCase.parameter_values),
    suite_ids: await suiteTestCaseService.getSuiteIdsForTestCase(testCase.id),
    requirement_ids: await requirementTestCaseService.getRequirementIdsForTestCase(testCase.id)
  };
};

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeParameterName = (value) => {
  const normalized = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return normalized ? normalized : null;
};

const normalizeParameterValues = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.entries(values).reduce((next, [key, value]) => {
    const normalizedKey = normalizeParameterName(key);

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
};

const normalizeTextList = (values = []) => {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
};

const normalizeImportSource = (value, fallback = "csv") => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback;
  }

  if (!Object.prototype.hasOwnProperty.call(IMPORT_SOURCE_LABELS, normalized)) {
    throw new Error(`Unsupported import source: ${normalized}`);
  }

  return normalized;
};

const getImportSourceLabel = (value) => IMPORT_SOURCE_LABELS[normalizeImportSource(value)] || IMPORT_SOURCE_LABELS.csv;

const normalizeComparableText = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizePriority = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PRIORITY;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULT_PRIORITY;
};

const normalizeAiGenerationSource = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (normalized !== "scheduler") {
    throw new Error("ai_generation_source must be 'scheduler' when provided");
  }

  return normalized;
};

const normalizeAiGenerationReviewStatus = (value, source) => {
  const normalized = normalizeText(value);

  if (!source || !normalized) {
    return null;
  }

  if (!["pending", "accepted"].includes(normalized)) {
    throw new Error("ai_generation_review_status must be 'pending' or 'accepted'");
  }

  return normalized;
};

const normalizeIsoDateTime = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeStatus = (value, fallback = DEFAULT_STATUS) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback;
  }

  if (!TEST_CASE_STATUS_VALUES.includes(normalized)) {
    throw new Error(`Test case status must be one of: ${TEST_CASE_STATUS_VALUES.join(", ")}`);
  }

  return normalized;
};

const normalizeAutomated = (value, fallback = DEFAULT_AUTOMATED) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === "true" || normalized === "y" || normalized === "1") {
    return "yes";
  }

  if (normalized === "false" || normalized === "n" || normalized === "0") {
    return "no";
  }

  if (!TEST_CASE_AUTOMATED_VALUES.includes(normalized)) {
    throw new Error(`Test case automated value must be one of: ${TEST_CASE_AUTOMATED_VALUES.join(", ")}`);
  }

  return normalized;
};

const normalizeAutomationStatus = (value, automated, fallback = null, hasAutomation = false) => {
  if (automated !== "yes") {
    return "not_automated";
  }

  const normalized = normalizeText(value);

  if (normalized && AUTOMATION_STATUS_VALUES.includes(normalized)) {
    return normalized;
  }

  if (fallback && AUTOMATION_STATUS_VALUES.includes(fallback)) {
    return fallback;
  }

  return hasAutomation ? "ready" : "incomplete";
};

const normalizeGroupKind = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const canonical = normalized.toLowerCase().replace(/[^a-z]/g, "");

  if (canonical === "local" || canonical === "grouped") {
    return "local";
  }

  if (canonical === "reusable" || canonical === "shared" || canonical === "sharedgroup" || canonical === "snapshot") {
    return "reusable";
  }

  return null;
};

const normalizeSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult),
      step_type: normalizeTestStepType(step?.step_type || step?.stepType, "web"),
      automation_code: normalizeRichText(step?.automation_code || step?.automationCode),
      api_request: normalizeApiRequest(step?.api_request || step?.apiRequest),
      group_id: normalizeText(step?.group_id || step?.groupId),
      group_name: normalizeText(step?.group_name || step?.groupName),
      group_kind: normalizeGroupKind(step?.group_kind || step?.groupKind || (step?.group_id || step?.groupId ? "local" : null)),
      reusable_group_id: normalizeText(step?.reusable_group_id || step?.reusableGroupId)
    }))
    .filter((step) => step.action || step.expected_result || step.automation_code || step.api_request)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const splitImportSequence = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(/\r?\n|\|/)
    .map((item) => item.trim());
};

const buildNameLookup = (items = [], field) => {
  return items.reduce((lookup, item) => {
    const key = normalizeComparableText(item?.[field]);

    if (!key) {
      return lookup;
    }

    lookup[key] = lookup[key] || [];
    lookup[key].push(item);
    return lookup;
  }, {});
};

const resolveNamedRows = (lookup, values = [], entityLabel) => {
  const resolved = [];

  for (const value of normalizeTextList(values)) {
    const matches = lookup[normalizeComparableText(value)] || [];

    if (!matches.length) {
      throw new Error(`${entityLabel} not found: ${value}`);
    }

    if (matches.length > 1) {
      throw new Error(`Multiple ${entityLabel.toLowerCase()} records match "${value}". Rename duplicates before importing.`);
    }

    resolved.push(matches[0]);
  }

  return resolved;
};

const resolveOrCreateImportSuites = async ({ lookup, values = [], app_type_id, created_by }) => {
  const resolved = [];

  for (const value of normalizeTextList(values)) {
    const key = normalizeComparableText(value);
    const matches = lookup[key] || [];

    if (matches.length > 1) {
      throw new Error(`Multiple test suite records match "${value}". Rename duplicates before importing.`);
    }

    if (!matches.length) {
      const response = await testSuiteService.createTestSuite({
        app_type_id,
        name: value,
        created_by
      });
      const createdSuite = await selectSuite.get(response.id);

      lookup[key] = createdSuite ? [createdSuite] : [];
      if (!createdSuite) {
        throw new Error(`Unable to create test suite: ${value}`);
      }
    }

    resolved.push(lookup[key][0]);
  }

  return resolved;
};

const normalizeImportBatches = ({ batches = [], rows = [], import_source, file_name } = {}) => {
  if (Array.isArray(batches) && batches.length) {
    return batches
      .map((batch, index) => ({
        batch_index: index + 1,
        file_name: normalizeText(batch?.file_name || batch?.fileName) || `Batch ${index + 1}`,
        import_source: normalizeImportSource(batch?.import_source || batch?.importSource || import_source || "csv"),
        row_offset: Math.max(Number(batch?.row_offset ?? batch?.rowOffset ?? 0) || 0, 0),
        rows: Array.isArray(batch?.rows) ? batch.rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : []
      }))
      .filter((batch) => batch.rows.length);
  }

  return Array.isArray(rows) && rows.length
    ? [{
        batch_index: 1,
        file_name: normalizeText(file_name) || getImportSourceLabel(import_source || "csv"),
        import_source: normalizeImportSource(import_source || "csv"),
        row_offset: 0,
        rows: rows.filter((row) => row && typeof row === "object" && !Array.isArray(row))
      }].filter((batch) => batch.rows.length)
    : [];
};

const pickImportSequenceValue = (items, index) => {
  if (!items.length) {
    return null;
  }

  if (index < items.length) {
    return normalizeText(items[index]);
  }

  if (items.length === 1) {
    return normalizeText(items[0]);
  }

  return null;
};

const normalizeImportedActionPrefixKind = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return null;
  }

  if (normalized === "shared" || normalized === "sharedgroup" || normalized === "sharedsteps" || normalized === "reusable") {
    return "reusable";
  }

  if (normalized === "group" || normalized === "grouped" || normalized === "local") {
    return "local";
  }

  return null;
};

const IMPORTED_ACTION_PREFIX_PATTERN = /^\[(shared|sharedgroup|shared steps|group|grouped|local)\s*:\s*([^\]]+)\]\s*(.*)$/i;

const parseImportedActionLine = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return {
      action: null,
      group_name: null,
      group_kind: null
    };
  }

  const match = normalized.match(IMPORTED_ACTION_PREFIX_PATTERN);

  if (!match) {
    return {
      action: normalized,
      group_name: null,
      group_kind: null
    };
  }

  return {
    action: normalizeText(match[3]),
    group_name: normalizeText(match[2]),
    group_kind: normalizeImportedActionPrefixKind(match[1])
  };
};

const finalizeImportedSteps = (steps = []) => {
  let previousGroupSignature = null;
  let currentGroupId = null;

  return steps
    .map((step, index) => {
      const groupName = normalizeText(step?.group_name || step?.groupName);
      const reusableGroupId = normalizeText(
        step?.reusable_group_id || step?.reusableGroupId || step?.shared_group_id || step?.sharedGroupId
      );
      const groupKind = normalizeGroupKind(
        step?.group_kind
        || step?.groupKind
        || step?.step_group_kind
        || step?.stepGroupKind
        || (groupName || reusableGroupId ? (reusableGroupId ? "reusable" : "local") : null)
      );
      const explicitGroupId = normalizeText(step?.group_id || step?.groupId);
      const hasGroupMetadata = Boolean(groupName || reusableGroupId || groupKind || explicitGroupId);
      const groupSignature = hasGroupMetadata
        ? `${groupKind || "local"}::${groupName || ""}::${reusableGroupId || ""}::${explicitGroupId || ""}`
        : null;

      if (explicitGroupId) {
        currentGroupId = explicitGroupId;
      } else if (groupSignature && groupSignature !== previousGroupSignature) {
        currentGroupId = uuid();
      } else if (!groupSignature) {
        currentGroupId = null;
      }

      previousGroupSignature = groupSignature;

      return {
        ...step,
        step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
        action: normalizeText(step?.action),
        expected_result: normalizeText(step?.expected_result || step?.expectedResult),
        step_type: normalizeTestStepType(step?.step_type || step?.stepType, "web"),
        automation_code: normalizeRichText(step?.automation_code || step?.automationCode),
        api_request: normalizeApiRequest(step?.api_request || step?.apiRequest),
        group_id: currentGroupId,
        group_name: groupName,
        group_kind: groupKind,
        reusable_group_id: reusableGroupId
      };
    })
    .filter((step) => step.action || step.expected_result || step.automation_code || step.api_request)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const buildStepsFromImportRow = (row, options = {}) => {
  const {
    sharedGroupLookup = {}
  } = options;

  if (Array.isArray(row?.steps) && row.steps.length) {
    return finalizeImportedSteps(row.steps);
  }

  const actions = splitImportSequence(row.action);
  const expectedResults = splitImportSequence(row.expected_result || row.expectedResult);
  const groupNames = splitImportSequence(row.step_group_name || row.stepGroupName);
  const groupKinds = splitImportSequence(row.step_group_kind || row.stepGroupKind);
  const sharedGroupIds = splitImportSequence(row.shared_group_id || row.sharedGroupId || row.reusable_group_id || row.reusableGroupId);

  if (!actions.length && !expectedResults.length && !groupNames.length && !groupKinds.length && !sharedGroupIds.length) {
    return [];
  }

  const size = Math.max(actions.length, expectedResults.length, groupNames.length, groupKinds.length, sharedGroupIds.length, 1);

  return finalizeImportedSteps(Array.from({ length: size }, (_, index) => {
    const annotatedAction = parseImportedActionLine(pickImportSequenceValue(actions, index));
    const expectedResult = pickImportSequenceValue(expectedResults, index);
    let groupName = annotatedAction.group_name || pickImportSequenceValue(groupNames, index);
    let reusableGroupId = pickImportSequenceValue(sharedGroupIds, index);
    let groupKind =
      annotatedAction.group_kind ||
      normalizeGroupKind(pickImportSequenceValue(groupKinds, index)) ||
      (reusableGroupId ? "reusable" : groupName ? "local" : null);

    if (!reusableGroupId && groupKind === "reusable" && groupName) {
      const matches = sharedGroupLookup[normalizeComparableText(groupName)] || [];

      if (!matches.length) {
        throw new Error(`Shared step group not found: ${groupName}`);
      }

      if (matches.length > 1) {
        throw new Error(`Multiple shared step groups match "${groupName}". Rename duplicates before importing.`);
      }

      reusableGroupId = matches[0].id;
      groupName = matches[0].name;
    }

    return {
      step_order: index + 1,
      action: annotatedAction.action || "",
      expected_result: expectedResult || "",
      group_name: groupName,
      group_kind: groupKind,
      reusable_group_id: reusableGroupId
    };
  }));
};

const ensureAppTypeExists = async (appTypeId) => {
  if (!appTypeId) {
    return null;
  }

  const appType = await selectAppType.get(appTypeId);

  if (!appType) {
    throw new Error("App type not found");
  }

  return appType;
};

const ensureRequirementsExist = async (requirementIds = [], appTypeProjectId = null) => {
  for (const requirementId of requirementIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error("Requirement not found");
    }

    if (appTypeProjectId && requirement.project_id !== appTypeProjectId) {
      throw new Error("Requirements must belong to the same project as the selected app type");
    }
  }
};

const ensureSuitesMatchAppType = async (suiteIds = [], appTypeId = null) => {
  let resolvedAppTypeId = appTypeId;

  for (const suiteId of suiteIds) {
    const suite = await selectSuite.get(suiteId);

    if (!suite) {
      throw new Error("Test suite not found");
    }

    if (!resolvedAppTypeId) {
      resolvedAppTypeId = suite.app_type_id;
      continue;
    }

    if (suite.app_type_id !== resolvedAppTypeId) {
      throw new Error("All suites must belong to the selected app type");
    }
  }

  return resolvedAppTypeId;
};

const syncSuiteMappings = async (testCaseId, suiteIds = []) => {
  await deleteSuiteMappings.run(testCaseId);

  for (const [index, suiteId] of suiteIds.entries()) {
    await insertSuiteMapping.run(suiteId, testCaseId, index + 1);
  }
};

const syncRequirementMappings = async (testCaseId, requirementIds = []) => {
  await deleteRequirementMappings.run(testCaseId);

  for (const requirementId of requirementIds) {
    await insertRequirementMapping.run(requirementId, testCaseId);
  }
};

const createPersistablePayload = async ({
  app_type_id,
  suite_id,
  suite_ids = [],
  title,
  description,
  external_references,
  automated,
  automation_status,
  priority,
  status,
  requirement_id,
  requirement_ids = [],
  parameter_values,
  steps = [],
  ai_generation_source,
  ai_generation_review_status,
  ai_generation_job_id,
  ai_generated_at,
  created_by,
  updated_by
}) => {
  const resolvedTitle = normalizeText(title);

  if (!resolvedTitle) {
    throw new Error("Test case title is required");
  }

  const display_id = await displayIdService.createDisplayId("test_case");

  let resolvedAppTypeId = normalizeText(app_type_id);
  const resolvedSuiteIds = normalizeTextList([suite_id, ...suite_ids]);
  const resolvedRequirementIds = normalizeTextList([requirement_id, ...requirement_ids]);
  const resolvedAiGenerationSource = normalizeAiGenerationSource(ai_generation_source);
  const resolvedAiGenerationReviewStatus = normalizeAiGenerationReviewStatus(
    ai_generation_review_status,
    resolvedAiGenerationSource
  );

  const appType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(resolvedSuiteIds, resolvedAppTypeId);
  const resolvedAppType = resolvedAppTypeId !== appType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : appType;
  await ensureRequirementsExist(resolvedRequirementIds, resolvedAppType?.project_id || null);

  const normalizedSteps = normalizeSteps(steps);
  const normalizedAutomated = normalizeAutomated(automated);

  return {
    app_type_id: resolvedAppTypeId,
    suite_ids: resolvedSuiteIds,
    requirement_ids: resolvedRequirementIds,
    title: resolvedTitle,
    description: normalizeText(description),
    external_references: normalizeReferenceList(external_references),
    parameter_values: normalizeParameterValues(parameter_values),
    automated: normalizedAutomated,
    automation_status: normalizeAutomationStatus(
      automation_status,
      normalizedAutomated,
      null,
      normalizedSteps.some((step) => Boolean(step.automation_code || step.api_request))
    ),
    priority: normalizePriority(priority),
    status: normalizeStatus(status),
    display_id,
    steps: normalizedSteps,
    ai_generation_source: resolvedAiGenerationSource,
    ai_generation_review_status: resolvedAiGenerationReviewStatus,
    ai_generation_job_id: normalizeText(ai_generation_job_id),
    ai_generated_at: normalizeIsoDateTime(ai_generated_at) || (resolvedAiGenerationSource ? new Date().toISOString() : null),
    created_by: normalizeText(created_by),
    updated_by: normalizeText(updated_by) || normalizeText(created_by)
  };
};

const createOne = db.transaction(async (payload) => {
  const id = uuid();

  await insertTestCaseRecord.run(
    id,
    payload.display_id,
    payload.app_type_id,
    payload.suite_ids[0] || null,
    payload.title,
    payload.description,
    payload.external_references,
    payload.parameter_values,
    payload.automated,
    payload.automation_status,
    payload.priority,
    payload.status,
    payload.requirement_ids[0] || null,
    payload.ai_generation_source,
    payload.ai_generation_review_status,
    payload.ai_generation_job_id,
    payload.ai_generated_at,
    payload.created_by,
    payload.updated_by
  );

  await syncSuiteMappings(id, payload.suite_ids);
  await syncRequirementMappings(id, payload.requirement_ids);

  for (const step of payload.steps) {
    await insertStep.run(
      uuid(),
      id,
      step.step_order,
      step.action,
      step.expected_result,
      step.step_type || "web",
      step.automation_code,
      step.api_request,
      step.group_id,
      step.group_name,
      step.group_kind,
      step.reusable_group_id
    );
  }

  return { id };
});

exports.createTestCase = async (input) => {
  const payload = await createPersistablePayload(input);
  const response = await createOne(payload);
  const sharedGroupTargets = payload.steps
    .filter((step) => step.reusable_group_id && step.group_id)
    .reduce((targets, step) => {
      const key = `${step.reusable_group_id}::${step.group_id}`;

      if (targets.some((target) => target.key === key)) {
        return targets;
      }

      targets.push({
        key,
        reusable_group_id: step.reusable_group_id,
        group_id: step.group_id
      });
      return targets;
    }, []);

  for (const target of sharedGroupTargets) {
    await sharedStepSyncService.syncSharedGroupFromReference(
      target.reusable_group_id,
      response.id,
      target.group_id
    );
  }

  return response;
};

exports.bulkImportTestCases = async ({ app_type_id, requirement_id, rows = [], created_by, import_source, batches = [], transaction_id } = {}) => {
  const resolvedAppTypeId = normalizeText(app_type_id);
  const defaultRequirementId = normalizeText(requirement_id);
  const normalizedBatches = normalizeImportBatches({ batches, rows, import_source });
  const sharedGroupCache = new Map();

  if (!resolvedAppTypeId) {
    throw new Error("app_type_id is required");
  }

  if (!normalizedBatches.length) {
    throw new Error("At least one import row is required");
  }

  const appType = await ensureAppTypeExists(resolvedAppTypeId);
  const totalRowCount = normalizedBatches.reduce((count, batch) => count + batch.rows.length, 0);
  const uniqueSources = [...new Set(normalizedBatches.map((batch) => batch.import_source))];
  const isSingleBatch = normalizedBatches.length === 1;
  const isSingleSource = uniqueSources.length === 1;
  const transactionSourceLabel = isSingleSource ? getImportSourceLabel(uniqueSources[0]) : "mixed-source";
  const sourceSummary =
    normalizedBatches.length === 1
      ? `${transactionSourceLabel} file`
      : `${normalizedBatches.length} source files`;

  if (defaultRequirementId) {
    await ensureRequirementsExist([defaultRequirementId]);
  }

  const [availableSuites, availableRequirements, availableSharedGroups] = await Promise.all([
    selectSuitesForAppType.all(resolvedAppTypeId),
    selectRequirementsForProject.all(appType?.project_id || ""),
    selectSharedStepGroupsForAppType.all(resolvedAppTypeId)
  ]);
  const suiteLookup = buildNameLookup(availableSuites, "name");
  const requirementLookup = buildNameLookup(availableRequirements, "title");
  const sharedGroupLookup = buildNameLookup(availableSharedGroups, "name");
  const transactionMetadata = {
    import_source: isSingleSource ? uniqueSources[0] : "mixed",
    import_sources: uniqueSources,
    total_batches: normalizedBatches.length,
    total_rows: totalRowCount,
    total_items: totalRowCount,
    processed_items: 0,
    imported: 0,
    failed: 0,
    progress_percent: 0,
    current_phase: "prepare",
    requirement_id: defaultRequirementId
  };
  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        project_id: appType.project_id,
        app_type_id: resolvedAppTypeId,
        category: "bulk_import",
        action: "test_case_import",
        status: "running",
        title: isSingleBatch ? `${transactionSourceLabel} test case import` : "Test case source import batch",
        description: `Importing ${totalRowCount} test case${totalRowCount === 1 ? "" : "s"} from ${sourceSummary}.`,
        metadata: transactionMetadata,
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id: appType.project_id,
        app_type_id: resolvedAppTypeId,
        category: "bulk_import",
        action: "test_case_import",
        status: "running",
        title: isSingleBatch ? `${transactionSourceLabel} test case import` : "Test case source import batch",
        description: `Importing ${totalRowCount} test case${totalRowCount === 1 ? "" : "s"} from ${sourceSummary}.`,
        metadata: transactionMetadata,
        created_by,
        started_at: new Date().toISOString()
      });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "prepare",
    message: `Started test case import for ${sourceSummary}.`,
    details: {
      import_source: isSingleSource ? uniqueSources[0] : "mixed",
      import_sources: uniqueSources,
      total_batches: normalizedBatches.length,
      total_rows: totalRowCount,
      requirement_id: defaultRequirementId
    }
  });

  const created = [];
  const errors = [];
  let processedRows = 0;

  for (const batch of normalizedBatches) {
    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      phase: "batch",
      message: `Processing ${getImportSourceLabel(batch.import_source)} batch "${batch.file_name}".`,
      details: {
        batch_index: batch.batch_index,
        file_name: batch.file_name,
        import_source: batch.import_source,
        row_count: batch.rows.length
      }
    });

    for (const [index, row] of batch.rows.entries()) {
      const rowNumber = batch.row_offset + index + 1;

      try {
        const normalizedRow = row || {};
        const importedSteps = buildStepsFromImportRow(normalizedRow, { sharedGroupLookup }).map((step) => ({ ...step }));
        const resolvedSuites = await resolveOrCreateImportSuites({
          lookup: suiteLookup,
          values: splitImportSequence(normalizedRow.suites || normalizedRow.suite),
          app_type_id: resolvedAppTypeId,
          created_by
        });
        const resolvedSuiteIds = resolvedSuites.map((suite) => suite.id);
        const resolvedRequirementIdsFromNames = resolveNamedRows(
          requirementLookup,
          splitImportSequence(normalizedRow.requirements || normalizedRow.requirement),
          "Requirement"
        ).map((requirement) => requirement.id);

        for (const step of importedSteps) {
          if (step.group_kind !== "reusable") {
            continue;
          }

          if (!step.reusable_group_id) {
            step.group_kind = step.group_id ? "local" : null;
            continue;
          }

          if (!sharedGroupCache.has(step.reusable_group_id)) {
            sharedGroupCache.set(step.reusable_group_id, await selectSharedStepGroup.get(step.reusable_group_id));
          }

          const sharedGroup = sharedGroupCache.get(step.reusable_group_id);

          if (!sharedGroup || sharedGroup.app_type_id !== resolvedAppTypeId) {
            step.group_kind = step.group_id ? "local" : null;
            step.reusable_group_id = null;
            continue;
          }

          if (!step.group_name) {
            step.group_name = sharedGroup.name;
          }
        }

        const response = await exports.createTestCase({
          app_type_id: resolvedAppTypeId,
          title: normalizedRow?.title,
          description: normalizedRow?.description,
          external_references: normalizeReferenceList(
            normalizedRow?.external_references
            || normalizedRow?.externalReferences
            || normalizedRow?.reference
            || normalizedRow?.references
          ),
          parameter_values: normalizedRow?.parameter_values || normalizedRow?.parameterValues,
          automated: normalizedRow?.automated,
          priority: normalizedRow?.priority,
          status: normalizeStatus(normalizedRow?.status, "draft"),
          suite_ids: resolvedSuiteIds,
          requirement_ids: normalizeTextList([
            defaultRequirementId,
            normalizedRow?.requirement_id,
            normalizedRow?.requirementId,
            ...resolvedRequirementIdsFromNames
          ]),
          steps: importedSteps,
          created_by
        });

        created.push({
          row: rowNumber,
          batch_index: batch.batch_index,
          file_name: batch.file_name,
          import_source: batch.import_source,
          id: response.id,
          title: normalizeText(row?.title) || "Untitled test case"
        });
      } catch (error) {
        errors.push({
          row: rowNumber,
          batch_index: batch.batch_index,
          file_name: batch.file_name,
          import_source: batch.import_source,
          title: normalizeText(row?.title),
          message: error.message || "Unable to import test case"
        });
      }

      processedRows += 1;

      if (processedRows === 1 || processedRows === totalRowCount || processedRows % 10 === 0) {
        await workspaceTransactionService.updateTransaction(transaction.id, {
          description: `Imported ${created.length} of ${totalRowCount} test case${totalRowCount === 1 ? "" : "s"} so far.`,
          metadata: {
            processed_items: processedRows,
            total_items: totalRowCount,
            imported: created.length,
            failed: errors.length,
            progress_percent: totalRowCount ? Math.round((processedRows / totalRowCount) * 100) : 0,
            current_phase: "import",
            import_source: isSingleSource ? uniqueSources[0] : "mixed",
            import_sources: uniqueSources
          }
        });
        await workspaceTransactionService.appendTransactionEvent(transaction.id, {
          phase: "import",
          message: `Processed ${processedRows} of ${totalRowCount} test case row${totalRowCount === 1 ? "" : "s"}.`,
          details: {
            processed_items: processedRows,
            total_items: totalRowCount,
            imported: created.length,
            failed: errors.length
          }
        });
      }
    }
  }

  const response = {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Imported ${created.length} of ${totalRowCount} test case${totalRowCount === 1 ? "" : "s"} from ${sourceSummary}.`
      : `No test cases were imported from ${sourceSummary}.`,
    metadata: {
      import_source: isSingleSource ? uniqueSources[0] : "mixed",
      import_sources: uniqueSources,
      total_batches: normalizedBatches.length,
      total_rows: totalRowCount,
      total_items: totalRowCount,
      processed_items: totalRowCount,
      imported: created.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed",
      requirement_id: defaultRequirementId
    },
    completed_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length ? "success" : "error",
    phase: "complete",
    message: created.length
      ? `Imported ${created.length} test case${created.length === 1 ? "" : "s"} with ${errors.length} failure${errors.length === 1 ? "" : "s"}.`
      : `The test case source import finished without creating test cases.`,
    details: {
      import_source: isSingleSource ? uniqueSources[0] : "mixed",
      import_sources: uniqueSources,
      total_batches: normalizedBatches.length,
      imported: created.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  return response;
};

exports.getTestCases = async ({ suite_id, requirement_id, status, app_type_id }) => {
  let query = `
    WITH ranked_test_cases AS (
      SELECT
        test_cases.*,
        ${suite_id ? "suite_test_cases.sort_order" : "NULL"} AS matched_suite_sort_order,
        COALESCE(test_cases.updated_at, test_cases.created_at) AS case_activity_at,
        ROW_NUMBER() OVER (
          PARTITION BY test_cases.id
          ORDER BY ${suite_id ? "suite_test_cases.sort_order ASC, " : ""}COALESCE(test_cases.updated_at, test_cases.created_at) DESC, test_cases.created_at DESC
        ) AS case_row_number
      FROM test_cases
  `;
  const joins = [];
  const where = [`1=1`];
  const params = [];

  if (suite_id) {
    joins.push(`JOIN suite_test_cases ON suite_test_cases.test_case_id = test_cases.id`);
    joins.push(`JOIN test_suites ON test_suites.id = suite_test_cases.suite_id`);
  }

  if (requirement_id) {
    joins.push(`JOIN requirement_test_cases ON requirement_test_cases.test_case_id = test_cases.id`);
  }

  if (suite_id) {
    where.push(`suite_test_cases.suite_id = ?`);
    params.push(suite_id);
  }

  if (app_type_id) {
    where.push(`test_cases.app_type_id = ?`);
    params.push(app_type_id);
  }

  if (requirement_id) {
    where.push(`requirement_test_cases.requirement_id = ?`);
    params.push(requirement_id);
  }

  if (status) {
    where.push(`test_cases.status = ?`);
    params.push(status);
  }

  if (joins.length) {
    query += ` ${joins.join(" ")}`;
  }

  query += ` WHERE ${where.join(" AND ")}`;
  query += `
    )
    SELECT *
    FROM ranked_test_cases
    WHERE case_row_number = 1
  `;
  query += suite_id
    ? ` ORDER BY matched_suite_sort_order ASC, case_activity_at DESC, created_at DESC`
    : ` ORDER BY case_activity_at DESC, created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(
    rows.map(({ matched_suite_sort_order, case_activity_at, case_row_number, ...testCase }) => hydrateSuiteIds(testCase))
  );
};

exports.getTestCase = async (id) => {
  const testCase = await db.prepare(`
    SELECT *
    FROM test_cases
    WHERE id = ?
  `).get(id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  return hydrateSuiteIds(testCase);
};

exports.updateTestCase = async (id, data) => {
  const existing = await exports.getTestCase(id);

  const requestedSuiteIds = data.suite_ids !== undefined
    ? normalizeTextList(data.suite_ids)
    : data.suite_id !== undefined
      ? normalizeTextList([data.suite_id, ...(existing.suite_ids || []).filter((suiteId) => suiteId !== data.suite_id)])
      : existing.suite_ids || [];
  const requestedRequirementIds = data.requirement_ids !== undefined
    ? normalizeTextList(data.requirement_ids)
    : data.requirement_id !== undefined
      ? normalizeTextList([data.requirement_id])
      : existing.requirement_ids || [];

  let resolvedAppTypeId = normalizeText(data.app_type_id) || existing.app_type_id || null;

  const resolvedAppType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(requestedSuiteIds, resolvedAppTypeId);
  const finalAppType = resolvedAppTypeId !== resolvedAppType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : resolvedAppType;
  await ensureRequirementsExist(requestedRequirementIds, finalAppType?.project_id || null);

  const payload = {
    app_type_id: resolvedAppTypeId,
    suite_ids: requestedSuiteIds,
    requirement_ids: requestedRequirementIds,
    title: normalizeText(data.title) || existing.title,
    description: data.description !== undefined ? normalizeText(data.description) : existing.description,
    external_references: data.external_references !== undefined
      ? normalizeReferenceList(data.external_references)
      : normalizeStoredReferenceList(existing.external_references),
    parameter_values: data.parameter_values !== undefined ? normalizeParameterValues(data.parameter_values) : normalizeParameterValues(existing.parameter_values),
    automated: data.automated !== undefined ? normalizeAutomated(data.automated, existing.automated || DEFAULT_AUTOMATED) : existing.automated || DEFAULT_AUTOMATED,
    priority: data.priority !== undefined ? normalizePriority(data.priority) : existing.priority ?? DEFAULT_PRIORITY,
    status: data.status !== undefined ? normalizeStatus(data.status) : existing.status || DEFAULT_STATUS,
    steps: data.steps !== undefined ? normalizeSteps(data.steps) : null,
    updated_by: normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null
  };
  payload.automation_status = normalizeAutomationStatus(
    data.automation_status,
    payload.automated,
    data.automated === undefined ? existing.automation_status : null,
    Boolean(payload.steps?.some((step) => step.automation_code || step.api_request))
  );

  const executeUpdate = db.transaction(async () => {
    await updateTestCaseRecord.run(
      payload.app_type_id,
      payload.suite_ids[0] || null,
      payload.title,
      payload.description,
      payload.external_references,
      payload.parameter_values,
      payload.automated,
      payload.automation_status,
      payload.priority,
      payload.status,
      payload.requirement_ids[0] || null,
      payload.updated_by,
      id
    );

    if (data.suite_ids !== undefined || data.suite_id !== undefined) {
      await syncSuiteMappings(id, payload.suite_ids);
    }

    if (data.requirement_ids !== undefined || data.requirement_id !== undefined) {
      await syncRequirementMappings(id, payload.requirement_ids);
    }

    if (data.steps !== undefined) {
      await deleteStepsForTestCase.run(id);

      for (const step of payload.steps || []) {
        await insertStep.run(
          uuid(),
          id,
          step.step_order,
          step.action,
          step.expected_result,
          step.step_type || "web",
          step.automation_code,
          step.api_request,
          step.group_id,
          step.group_name,
          step.group_kind,
          step.reusable_group_id
        );
      }
    }
  });

  await executeUpdate();

  if (data.steps !== undefined) {
    const sharedGroupTargets = (payload.steps || [])
      .filter((step) => step.reusable_group_id && step.group_id)
      .reduce((targets, step) => {
        const key = `${step.reusable_group_id}::${step.group_id}`;

        if (targets.some((target) => target.key === key)) {
          return targets;
        }

        targets.push({
          key,
          reusable_group_id: step.reusable_group_id,
          group_id: step.group_id
        });
        return targets;
      }, []);

    for (const target of sharedGroupTargets) {
      await sharedStepSyncService.syncSharedGroupFromReference(
        target.reusable_group_id,
        id,
        target.group_id
      );
    }
  }

  return { updated: true };
};

exports.deleteTestCase = async (id) => {
  await exports.getTestCase(id);

  const executeDelete = db.transaction(async () => {
    await deleteStepsForTestCase.run(id);
    await deleteRequirementMappings.run(id);
    await deleteSuiteMappings.run(id);
    await deleteTestCaseRecord.run(id);
  });

  await executeDelete();

  return { deleted: true };
};

exports.acceptGeneratedTestCase = async (id) => {
  const testCase = await exports.getTestCase(id);

  if (testCase.ai_generation_source !== "scheduler" || testCase.ai_generation_review_status !== "pending") {
    throw new Error("Only pending scheduler-generated test cases can be accepted");
  }

  await updateGeneratedReviewState.run("accepted", id);
  return { accepted: true };
};

exports.rejectGeneratedTestCase = async (id) => {
  const testCase = await exports.getTestCase(id);

  if (testCase.ai_generation_source !== "scheduler" || testCase.ai_generation_review_status !== "pending") {
    throw new Error("Only pending scheduler-generated test cases can be rejected");
  }

  return exports.deleteTestCase(id);
};
