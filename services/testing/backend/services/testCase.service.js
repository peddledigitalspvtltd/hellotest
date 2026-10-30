const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid } = require("crypto");
const testSuiteService = require("./testSuite.service");
const { validateTestCaseImportRow } = require("@hellotest/platform/backend/src/utils/testCaseImportValidation");
const sharedStepSyncService = require("./sharedStepSync.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const notificationService = require("@hellotest/platform/backend/services/notification.service");
const testCaseVersionService = require("./testCaseVersion.service");
const { redactTestDataSetRows } = require("./testDataSet.service");
const dropdownCatalog = require("@hellotest/platform/backend/services/dropdownCatalog.service");
const { DOMAIN_METADATA, TEST_CASE_AUTOMATED_VALUES, TEST_CASE_STATUS_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");
const displayIdService = require("@hellotest/platform/backend/services/displayId.service");
const {
  normalizeApiRequest,
  validateAuthoredApiRequest,
  normalizeRichText,
  normalizeTestStepType
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const { groupRows, placeholdersFor, uniqueIds } = require("@hellotest/platform/backend/src/utils/batchHydration");
const { normalizeDataOptions } = require("@hellotest/platform/backend/src/utils/scopedTestData");
const { setGherkinFeatureTitle } = require("@hellotest/platform/backend/src/utils/gherkinFeatureTitle");
const { normalizeAutomationStartUrl, requiresAutomationStartUrl } = require("@hellotest/platform/backend/src/utils/automationStartUrl");
const { storedAutomationCaseType, resolveAutomationCaseType, resolveAutomationCaseSteps } = require('@hellotest/platform/backend/src/utils/automationCaseType');
const {normalizeParameterLayer}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');

// Removing an authored own value restores its supplying layer's precedence.
// A stale name-only marker must never keep shadowing live linked defaults.
const caseDataOptions = (input, values, previousOptions) => {
  const options=normalizeDataOptions(input);
  const previousPrivate=previousOptions?normalizeDataOptions(previousOptions).private_parameter_names||[]:[];
  if(previousPrivate.length)options.private_parameter_names=[...new Set([...previousPrivate,...(options.private_parameter_names||[])])].sort();
  if(!options.parameter_overrides?.length&&!options.private_parameter_names?.length)return options;
  const ownNames=new Set(Object.keys(normalizeParameterLayer(values,'t')));
  for(const field of ['parameter_overrides','private_parameter_names'])if(options[field]){
    const names=options[field].filter(key=>ownNames.has(key));
    if(names.length)options[field]=names;else delete options[field];
  }
  return normalizeDataOptions(options);
};

const DEFAULT_PRIORITY = 3;
const DEFAULT_STATUS = DOMAIN_METADATA.test_cases.default_status;
const DEFAULT_AUTOMATED = DOMAIN_METADATA.test_cases.default_automated || "no";
const AUTOMATION_STATUS_VALUES = ["not_automated", "ready", "incomplete"];
const { TEST_CASE_REVIEW_STATUS_VALUES: REVIEW_STATUS_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");
const IMPORT_SOURCE_LABELS = {
  csv: "CSV",
  junit_xml: "JUnit XML",
  testng_xml: "TestNG XML",
  postman_collection: "Postman collection"
};

const selectAppType = db.prepare(`
  SELECT id, project_id, type
  FROM app_types
  WHERE id = ?
`);

const selectSuite = db.prepare(`
  SELECT id, app_type_id
  FROM test_suites
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, project_id, title
  FROM requirements
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name
  FROM shared_step_groups
  WHERE id = ?
`);

const selectUser = db.prepare(`
  SELECT id, name, email
  FROM users
  WHERE id = ?
`);

const selectProjectMember = db.prepare(`
  SELECT user_id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id
  FROM test_data_sets
  WHERE id = ?
`);

const selectSuitesForAppType = db.prepare(`
  SELECT id, display_id, name, app_type_id
  FROM test_suites
  WHERE app_type_id = ?
`);

const selectRequirementsForProject = db.prepare(`
  SELECT id, display_id, title, project_id
  FROM requirements
  WHERE project_id = ?
`);

const selectSharedStepGroupsForAppType = db.prepare(`
  SELECT id, display_id, name, app_type_id
  FROM shared_step_groups
  WHERE app_type_id = ?
`);

const selectManualTestCaseLink = db.prepare(`
  SELECT id, app_type_id, automated
  FROM test_cases
  WHERE id = ?
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
    labels,
    parameter_values,
    test_data_options,
    automated,
    automation_status,
    automation_start_url,
    manual_test_case_id,
    authoring_mode,
    test_case_type,
    gherkin_document,
    priority,
    status,
    requirement_id,
    ai_generation_source,
    ai_generation_review_status,
    ai_generation_job_id,
    source_idempotency_key,
    ai_generated_at,
    reviewer_id,
    review_status,
    review_history,
    ai_quality_score,
    author_id,
    created_by,
    updated_by,
    source_issue_id,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const selectTestCaseBySourceIdempotency = db.prepare(`
  SELECT id, display_id
  FROM test_cases
  WHERE app_type_id = ? AND source_idempotency_key = ?
`);

const updateTestCaseRecord = db.prepare(`
  UPDATE test_cases
  SET app_type_id = ?, suite_id = ?, title = ?, description = ?, external_references = ?, labels = ?, parameter_values = ?, test_data_options = ?, automated = ?, automation_status = ?, automation_start_url = ?, manual_test_case_id = ?, authoring_mode = ?, test_case_type = ?, gherkin_document = ?, priority = ?, status = ?, requirement_id = ?, reviewer_id = ?, review_status = ?, review_history = ?, ai_quality_score = ?, author_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteAutomationCaseLinks = db.prepare(`
  DELETE FROM automation_case_links
  WHERE automation_test_case_id = ?
`);

const insertAutomationCaseLink = db.prepare(`
  INSERT INTO automation_case_links (
    automation_test_case_id,
    manual_test_case_id,
    is_primary
  ) VALUES (?, ?, ?) ON CONFLICT(automation_test_case_id,manual_test_case_id) DO UPDATE SET is_primary=EXCLUDED.is_primary
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

const insertDataSetMapping = db.prepare(`
  INSERT INTO test_case_data_sets (test_case_id, test_data_set_id, sort_order)
  VALUES (?, ?, ?)
`);

const deleteDataSetMappings = db.prepare(`
  DELETE FROM test_case_data_sets
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

const selectStepsForTestCase = db.prepare(`
  SELECT step_type
  FROM test_steps
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

const hydrateTestCases = async (testCases) => {
  const ids = uniqueIds(testCases);
  if (!ids.length) {
    return testCases;
  }

  const placeholders = placeholdersFor(ids);
  const [suiteRows, requirementRows, moduleRows, defectRows, automationLinkRows, dataSetRows, authorRows] = await Promise.all([
    db.prepare(`
      SELECT test_case_id, suite_id
      FROM suite_test_cases
      WHERE test_case_id IN (${placeholders})
      ORDER BY test_case_id ASC, sort_order ASC, suite_id ASC
    `).all(...ids),
    db.prepare(`
      SELECT mapping.test_case_id, mapping.requirement_id, requirements.title, requirements.display_id
      FROM (
        SELECT test_case_id, requirement_id
        FROM requirement_test_cases
        WHERE test_case_id IN (${placeholders})
        UNION
        SELECT id AS test_case_id, requirement_id
        FROM test_cases
        WHERE id IN (${placeholders}) AND requirement_id IS NOT NULL
      ) AS mapping
      JOIN requirements ON requirements.id = mapping.requirement_id
      JOIN test_cases story_case ON story_case.id = mapping.test_case_id
      LEFT JOIN test_suites story_suite ON story_suite.id = story_case.suite_id
      LEFT JOIN app_types story_app ON story_app.id = COALESCE(story_case.app_type_id, story_suite.app_type_id)
      WHERE COALESCE(story_case.app_type_id, story_suite.app_type_id) IS NULL OR story_app.project_id = requirements.project_id
      ORDER BY mapping.test_case_id ASC, mapping.requirement_id ASC
    `).all(...ids, ...ids),
    db.prepare(`
      SELECT test_case_id, module_id, is_explicit
      FROM test_case_effective_module_cases
      WHERE test_case_id IN (${placeholders})
      ORDER BY test_case_id ASC, is_explicit DESC, sort_order ASC, module_id ASC
    `).all(...ids),
    db.prepare(`
      SELECT test_case_id, issue_id
      FROM test_case_defects
      WHERE test_case_id IN (${placeholders})
      ORDER BY test_case_id ASC, issue_id ASC
    `).all(...ids),
    db.prepare(`
      SELECT link.automation_test_case_id AS test_case_id, link.manual_test_case_id, link.is_primary,
        'manual' AS direction, manual.id AS linked_id, manual.display_id, manual.title
      FROM automation_case_links link JOIN test_cases manual ON manual.id=link.manual_test_case_id
      JOIN test_cases automation ON automation.id=link.automation_test_case_id AND automation.app_type_id=manual.app_type_id
      WHERE link.automation_test_case_id IN (${placeholders}) AND automation.automated='yes' AND COALESCE(manual.automated,'no')='no'
      UNION ALL
      SELECT link.manual_test_case_id AS test_case_id, link.manual_test_case_id, link.is_primary,
        'automation' AS direction, automation.id AS linked_id, automation.display_id, automation.title
      FROM automation_case_links link JOIN test_cases manual ON manual.id=link.manual_test_case_id
      JOIN test_cases automation ON automation.id=link.automation_test_case_id AND automation.app_type_id=manual.app_type_id
      WHERE link.manual_test_case_id IN (${placeholders}) AND automation.automated='yes' AND COALESCE(manual.automated,'no')='no'
      ORDER BY test_case_id,is_primary DESC,linked_id
    `).all(...ids, ...ids),
    db.prepare(`
      SELECT mapping.test_case_id, mapping.test_data_set_id, data_set.app_type_id, data_set.name, data_set.description, data_set.mode, data_set.columns, data_set.rows
      FROM test_case_data_sets AS mapping
      JOIN test_cases AS linked_case ON linked_case.id = mapping.test_case_id
      LEFT JOIN test_suites AS legacy_suite ON legacy_suite.id = linked_case.suite_id
      LEFT JOIN app_types AS case_app ON case_app.id = COALESCE(linked_case.app_type_id, legacy_suite.app_type_id)
      LEFT JOIN requirements AS story ON story.id = linked_case.requirement_id
      JOIN test_data_sets AS data_set ON data_set.id = mapping.test_data_set_id
        AND data_set.project_id = COALESCE(case_app.project_id, story.project_id)
        AND (data_set.app_type_id IS NULL OR data_set.app_type_id = case_app.id)
      WHERE mapping.test_case_id IN (${placeholders})
      ORDER BY mapping.test_case_id ASC, mapping.sort_order ASC, mapping.test_data_set_id ASC
    `).all(...ids),
    db.prepare(`
      SELECT test_cases.id AS test_case_id, users.id, users.name, users.email
      FROM test_cases
      LEFT JOIN users ON users.id = COALESCE(test_cases.author_id, test_cases.created_by)
      WHERE test_cases.id IN (${placeholders})
    `).all(...ids)
  ]);
  const suitesByCase = groupRows(suiteRows, "test_case_id");
  const requirementsByCase = groupRows(requirementRows, "test_case_id");
  const modulesByCase = groupRows(moduleRows, "test_case_id");
  const defectsByCase = groupRows(defectRows, "test_case_id");
  const automationLinksByCase = groupRows(automationLinkRows, "test_case_id");
  const dataSetsByCase = groupRows(dataSetRows, "test_case_id");
  const authorsByCase = groupRows(authorRows, "test_case_id");

  return testCases.map((testCase) => {
    const linkedRequirements = requirementsByCase.get(testCase.id) || [];
    const primaryRequirement = linkedRequirements.find((row) => row.requirement_id === testCase.requirement_id) || linkedRequirements[0];
    return {
      ...testCase,
      gherkin_document: setGherkinFeatureTitle(testCase.gherkin_document, primaryRequirement?.title),
      external_references: normalizeStoredReferenceList(testCase.external_references),
      labels: normalizeStoredReferenceList(testCase.labels),
      parameter_values: normalizeParameterValues(testCase.parameter_values),
      execution_hooks: require("./caseExecutionHooks.service").normalizeCaseExecutionHooks(testCase.execution_hooks),
      test_data_options: normalizeDataOptions(testCase.test_data_options || {}, testCase.automated === "yes" ? "sections" : "steps"),
      automation_case_type: testCase.automated === 'yes' ? storedAutomationCaseType(testCase) : null,
      review_history: normalizeReviewHistory(testCase.review_history),
      author_id: testCase.author_id || testCase.created_by || null,
      suite_ids: (suitesByCase.get(testCase.id) || []).map((row) => row.suite_id),
      requirement_ids: normalizeTextList([primaryRequirement?.requirement_id, ...linkedRequirements.map((row) => row.requirement_id)]),
      linked_requirements: linkedRequirements.map((row) => ({ id: row.requirement_id, display_id: row.display_id || null, title: row.title })),
      module_ids: (modulesByCase.get(testCase.id) || []).map((row) => row.module_id),
      primary_module_id: (modulesByCase.get(testCase.id) || []).find(row => row.is_explicit)?.module_id || null,
      defect_ids: (defectsByCase.get(testCase.id) || []).map((row) => row.issue_id),
      manual_test_case_ids: (automationLinksByCase.get(testCase.id) || []).filter(row => row.direction === "manual").map((row) => row.manual_test_case_id),
      automation_test_case_ids: (automationLinksByCase.get(testCase.id) || []).filter(row => row.direction === "automation").map((row) => row.linked_id),
      linked_manual_cases: (automationLinksByCase.get(testCase.id) || []).filter(row => row.direction === "manual").map(row => ({id:row.linked_id,display_id:row.display_id,title:row.title})),
      linked_automation_cases: (automationLinksByCase.get(testCase.id) || []).filter(row => row.direction === "automation").map(row => ({id:row.linked_id,display_id:row.display_id,title:row.title})),
      test_data_set_ids: (dataSetsByCase.get(testCase.id) || []).map((row) => row.test_data_set_id),
      test_data_sets: (dataSetsByCase.get(testCase.id) || []).map((row) => ({
        id: row.test_data_set_id,
        app_type_id: row.app_type_id,
        name: row.name,
        description: row.description,
        mode: row.mode,
        columns: Array.isArray(row.columns) ? row.columns : [],
        rows: redactTestDataSetRows(row.mode, row.rows)
      })),
      author: authorsByCase.get(testCase.id)?.[0]?.id ? {
        id: authorsByCase.get(testCase.id)[0].id,
        name: authorsByCase.get(testCase.id)[0].name,
        email: authorsByCase.get(testCase.id)[0].email
      } : null
    };
  });
};

const hydrateSuiteIds = async (testCase) => {
  if (!testCase) return testCase;
  return (await hydrateTestCases([testCase]))[0];
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

  if (!["scheduler", "interactive", "repository"].includes(normalized)) {
    throw new Error("ai_generation_source must be scheduler, interactive, or repository when provided");
  }

  return normalized;
};

const normalizeAiGenerationReviewStatus = (value, source) => {
  const normalized = normalizeText(value);

  if (!source || !normalized) {
    return null;
  }

  if (!["pending", "accepted", "rejected"].includes(normalized)) {
    throw new Error("ai_generation_review_status must be pending, accepted, or rejected");
  }

  return normalized;
};

const normalizeReviewStatus = (value, reviewerId = null, fallback = null) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback || (reviewerId ? "pending" : "not_requested");
  }

  if (!REVIEW_STATUS_VALUES.includes(normalized)) {
    throw new Error(`Review status must be one of: ${REVIEW_STATUS_VALUES.join(", ")}`);
  }

  return normalized;
};

const normalizeReviewHistory = (value) => {
  let parsed = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (_error) {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      id: normalizeText(entry.id) || uuid(),
      status: normalizeReviewStatus(entry.status || entry.review_status, null, "pending"),
      comment: normalizeText(entry.comment),
      user_id: normalizeText(entry.user_id || entry.reviewed_by || entry.created_by),
      created_at: normalizeIsoDateTime(entry.created_at) || new Date().toISOString()
    }));
};

const reviewError = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

const isAiReviewPending = (testCase) => Boolean(
  normalizeText(testCase.ai_generation_source)
  && testCase.ai_generation_review_status === "pending"
  && !["accepted", "changes_requested"].includes(testCase.review_status)
);

const assertReviewOwner = (testCase, actorId) => {
  const reviewerId = normalizeText(testCase.reviewer_id)
    || (isAiReviewPending(testCase) ? normalizeText(testCase.created_by) : null);
  if (!actorId || !reviewerId || reviewerId !== actorId) {
    throw reviewError("Only the assigned reviewer can review this test case", 403);
  }
};

const assertPendingReview = (testCase, generatedOnly = false) => {
  if (generatedOnly ? !isAiReviewPending(testCase) : testCase.review_status !== "pending" && !isAiReviewPending(testCase)) {
    throw reviewError("This test case is no longer pending review. Refresh the review queue.");
  }
};

const assertReviewTimestamp = (testCase, expectedUpdatedAt) => {
  if (expectedUpdatedAt === undefined) return;
  const expectedTime = new Date(expectedUpdatedAt).getTime();
  if (!Number.isFinite(expectedTime)) throw reviewError("expected_updated_at must be a valid timestamp", 400);
  if (new Date(testCase.updated_at).getTime() !== expectedTime) {
    throw reviewError("This test case changed after it was loaded. Refresh before reviewing.");
  }
};

const reviewStateKey = (testCase) => JSON.stringify([
  testCase.reviewer_id || null,
  testCase.review_status || "not_requested",
  testCase.ai_generation_source || null,
  testCase.ai_generation_review_status || null,
  testCase.updated_at ? new Date(testCase.updated_at).getTime() : null
]);

const normalizeAiQualityScore = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new Error("AI quality score must be between 0 and 100");
  }

  return Math.round(numeric);
};

const ensureReviewerExists = async (reviewerId, projectId = null) => {
  const normalizedReviewerId = normalizeText(reviewerId);

  if (!normalizedReviewerId) {
    return null;
  }

  const reviewer = await selectUser.get(normalizedReviewerId);

  if (!reviewer) {
    throw new Error("Reviewer not found");
  }

  if (projectId && !(await selectProjectMember.get(projectId, normalizedReviewerId))) {
    const error = new Error("Reviewer must be a member of the test case project");
    error.statusCode = 400;
    throw error;
  }

  return reviewer;
};

const ensureAuthorExists = async (authorId, projectId = null) => {
  const normalizedAuthorId = normalizeText(authorId);
  const rejectAuthor = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };

  if (!normalizedAuthorId) {
    rejectAuthor("Test case author is required");
  }

  const author = await selectUser.get(normalizedAuthorId);

  if (!author) {
    rejectAuthor("Author not found");
  }

  if (projectId && !(await selectProjectMember.get(projectId, normalizedAuthorId))) {
    rejectAuthor("Author must be a member of the test case project");
  }

  return author;
};

const notifyReviewer = async ({ reviewer_id, test_case_id, display_id, title, project_id, actor_id }) => {
  const reviewerId = normalizeText(reviewer_id);

  if (!reviewerId || reviewerId === normalizeText(actor_id)) {
    return;
  }

  try {
    await notificationService.createNotification({
      user_id: reviewerId,
      project_id,
      target_url: `/test-cases?case=${encodeURIComponent(display_id || test_case_id)}`,
      type: "test_case_review",
      title: "Test case review requested",
      message: `${title || "A test case"} is ready for your review.`
    });
  } catch (error) {
    console.warn("Unable to create test case review notification", {
      test_case_id,
      reviewer_id: reviewerId,
      message: error.message
    });
  }
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

const automationLinkValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const ensureManualTestCaseLinks = async ({ manualTestCaseIds = [], appTypeId, automated, currentTestCaseId = null }) => {
  const normalizedManualTestCaseIds = normalizeTextList(manualTestCaseIds);

  if (!normalizedManualTestCaseIds.length) return [];

  if (automated !== "yes") {
    throw automationLinkValidationError("Only automation cases can link to a manual test case");
  }

  for (const normalizedManualTestCaseId of normalizedManualTestCaseIds) {
    if (normalizedManualTestCaseId === currentTestCaseId) {
      throw automationLinkValidationError("An automation case cannot link to itself");
    }

    const manualTestCase = await selectManualTestCaseLink.get(normalizedManualTestCaseId);
    if (!manualTestCase) {
      throw automationLinkValidationError("Linked manual test case not found");
    }
    if (manualTestCase.automated === "yes") {
      throw automationLinkValidationError("Automation cases must link only to manual test cases");
    }
    if ((manualTestCase.app_type_id || null) !== (appTypeId || null)) {
      throw automationLinkValidationError("Automation and manual test cases must belong to the same application");
    }
  }

  return normalizedManualTestCaseIds;
};

const syncAutomationCaseLinks = async (automationTestCaseId, manualTestCaseIds = []) => {
  await db.prepare("DELETE FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id NOT IN (SELECT jsonb_array_elements_text(?::jsonb))").run(automationTestCaseId, manualTestCaseIds);
  await db.prepare("UPDATE automation_case_links SET is_primary=FALSE WHERE automation_test_case_id=?").run(automationTestCaseId);
  for (const [index, manualTestCaseId] of manualTestCaseIds.entries()) {
    await insertAutomationCaseLink.run(automationTestCaseId, manualTestCaseId, index === 0);
  }
};

const normalizeAuthoringMode = (value, fallback = "structured") => {
  const normalized = normalizeText(value) || fallback;
  if (!["structured", "gherkin"].includes(normalized)) {
    throw automationLinkValidationError("Test case authoring mode must be structured or gherkin");
  }
  return normalized;
};

const normalizeTestCaseType = async (value, existingValue) => {
  const normalized = value === undefined
    ? await dropdownCatalog.getDefaultValue("test_cases.types")
    : typeof value === "string" ? value.trim().toLowerCase() : value;
  return dropdownCatalog.validateValue("test_cases.types", normalized, { existingValue, allowEmpty: false });
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
      api_request: normalizeApiRequest(validateAuthoredApiRequest(step?.api_request || step?.apiRequest, {stepOrder:index+1})),
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

const buildNameLookup = (items = [], field) => items.reduce((lookup, item) => {
  for (const value of [item?.[field], item?.id, item?.display_id, item?.email]) {
    const key = normalizeComparableText(value);
    if (!key) continue;
    lookup[key] = lookup[key] || [];
    if (!lookup[key].some(row => row.id === item.id)) lookup[key].push(item);
  }
  return lookup;
}, {});

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

  if (normalized === "shared" || normalized === "sharedgroup" || normalized === "sharedstepgroup" || normalized === "sharedsteps" || normalized === "reusable") {
    return "reusable";
  }

  if (normalized === "group" || normalized === "grouped" || normalized === "local") {
    return "local";
  }

  return null;
};

const IMPORTED_ACTION_PREFIX_PATTERN = /^\[(shared step group|shared steps|sharedgroup|shared|group|grouped|local)\s*:\s*([^\]]+)\]\s*(.*)$/i;

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
        api_request: normalizeApiRequest(validateAuthoredApiRequest(step?.api_request || step?.apiRequest, {stepOrder:index+1})),
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
        throw new Error(`Shared Step Group not found: ${groupName}`);
      }

      if (matches.length > 1) {
        throw new Error(`Multiple Shared Step Groups match "${groupName}". Rename duplicates before importing.`);
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
  const requirements = [];
  for (const requirementId of requirementIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error("Requirement not found");
    }

    if (appTypeProjectId && requirement.project_id !== appTypeProjectId) {
      throw new Error("Requirements must belong to the same project as the selected app type");
    }
    requirements.push(requirement);
  }
  return requirements;
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

const ensureDataSetsExist = async (dataSetIds, projectId, appTypeId) => {
  const normalizedIds = normalizeTextList(dataSetIds);
  if (normalizedIds.length > 1) {
    const error = new Error("A test case can link to only one test data set");
    error.statusCode = 400;
    throw error;
  }
  for (const dataSetId of normalizedIds) {
    const dataSet = await selectTestDataSet.get(dataSetId);
    if (!dataSet) throw new Error(`Test data set not found: ${dataSetId}`);
    if (projectId && dataSet.project_id !== projectId) {
      throw new Error("All test data sets must belong to the test case project");
    }
    if (dataSet.app_type_id && appTypeId && dataSet.app_type_id !== appTypeId) {
      throw new Error("All test data sets must apply to the selected app type");
    }
  }
  return normalizedIds;
};

const syncDataSetMappings = async (testCaseId, dataSetIds = []) => {
  await deleteDataSetMappings.run(testCaseId);
  for (const [index, dataSetId] of dataSetIds.entries()) {
    await insertDataSetMapping.run(testCaseId, dataSetId, index + 1);
  }
};

const createPersistablePayload = async ({
  app_type_id,
  suite_id,
  suite_ids = [],
  title,
  description,
  external_references,
  labels,
  automated,
  automation_status,
  automation_case_type,
  automation_start_url,
  manual_test_case_id,
  manual_test_case_ids = [],
  authoring_mode,
  test_case_type,
  gherkin_document,
  priority,
  status,
  requirement_id,
  requirement_ids = [],
  test_data_set_ids = [],
  test_data_options = { override_shared_steps: false },
  parameter_values,
  execution_hooks = [],
  steps = [],
  ai_generation_source,
  ai_generation_review_status,
  ai_generation_job_id,
  source_idempotency_key,
  source_issue_id,
  ai_generated_at,
  reviewer_id,
  review_status,
  review_history,
  ai_quality_score,
  author_id,
  created_by,
  updated_by
}) => {
  const resolvedTitle = normalizeText(title);

  if (!resolvedTitle) {
    throw new Error("Test case title is required");
  }

  const display_id = await displayIdService.createDisplayId(normalizeAutomated(automated) === "yes" ? "automation_case" : "test_case");

  let resolvedAppTypeId = normalizeText(app_type_id);
  const resolvedSuiteIds = normalizeTextList([suite_id, ...suite_ids]);
  const resolvedRequirementIds = normalizeTextList([requirement_id, ...requirement_ids]);
  const resolvedAiGenerationSource = normalizeAiGenerationSource(ai_generation_source);

  const appType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(resolvedSuiteIds, resolvedAppTypeId);
  const resolvedAppType = resolvedAppTypeId !== appType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : appType;
  const linkedRequirements = await ensureRequirementsExist(resolvedRequirementIds, resolvedAppType?.project_id || null);
  const resolvedCreatorId = normalizeText(created_by);
  const resolvedReviewerId = normalizeText(reviewer_id) || (resolvedAiGenerationSource ? resolvedCreatorId : null);

  if (!resolvedCreatorId) {
    const error = new Error("Test case creator is required");
    error.statusCode = 400;
    throw error;
  }

  const resolvedAuthorId = normalizeText(author_id) || resolvedCreatorId;
  await ensureAuthorExists(resolvedAuthorId, resolvedAppType?.project_id || null);
  await ensureReviewerExists(resolvedReviewerId, resolvedAppType?.project_id || null);
  const resolvedDataSetIds = await ensureDataSetsExist(test_data_set_ids, resolvedAppType?.project_id || null, resolvedAppTypeId);

  const normalizedSteps = normalizeSteps(steps);
  const normalizedAutomated = normalizeAutomated(automated);
  const casePlatform = normalizedAutomated === 'yes'
    ? resolveAutomationCaseSteps({ automation_case_type, test_data_options }, Array.isArray(steps) ? steps : [], { appTypeKind: resolvedAppType?.type })
    : null;
  const resolvedManualTestCaseIds = await ensureManualTestCaseLinks({
    manualTestCaseIds: [manual_test_case_id, ...manual_test_case_ids],
    appTypeId: resolvedAppTypeId,
    automated: normalizedAutomated
  });
  const resolvedReviewStatus = normalizeReviewStatus(
    (resolvedAiGenerationSource && review_status === "not_requested" ? "pending" : review_status)
      || (ai_generation_review_status === "accepted" ? "accepted" : ai_generation_review_status === "rejected" ? "changes_requested" : null),
    resolvedReviewerId
  );
  const resolvedAiGenerationReviewStatus = normalizeAiGenerationReviewStatus(
    resolvedReviewStatus === "accepted" ? "accepted" : resolvedReviewStatus === "changes_requested" ? "rejected" : ai_generation_review_status || "pending",
    resolvedAiGenerationSource
  );
  const resolvedStatus = resolvedReviewStatus === "pending"
    ? "draft"
    : resolvedReviewStatus === "accepted"
      ? "ready"
      : resolvedReviewStatus === "changes_requested"
        ? "draft"
        : normalizeStatus(status);
  const previousSourceCase = source_idempotency_key
    ? await db.prepare("SELECT test_case_type, automation_start_url FROM test_cases WHERE app_type_id = ? AND source_idempotency_key = ?")
      .get(resolvedAppTypeId, normalizeText(source_idempotency_key))
    : null;

  return {
    app_type_id: resolvedAppTypeId,
    project_id: resolvedAppType?.project_id || null,
    suite_ids: resolvedSuiteIds,
    requirement_ids: resolvedRequirementIds,
    test_data_set_ids: resolvedDataSetIds,
    test_data_options: caseDataOptions({ ...normalizeDataOptions(test_data_options), ...(casePlatform ? { automation_case_type: casePlatform.automation_case_type } : {}) },normalizeParameterValues(parameter_values)),
    title: resolvedTitle,
    description: normalizeText(description),
    external_references: normalizeReferenceList(external_references),
    labels: normalizeReferenceList(labels),
    parameter_values: normalizeParameterValues(parameter_values),
    execution_hooks: await require("./caseExecutionHooks.service").validateCaseExecutionHooks(execution_hooks, {projectId:resolvedAppType?.project_id,appTypeId:resolvedAppTypeId}),
    automated: normalizedAutomated,
    automation_start_url: normalizeAutomationStartUrl(automation_start_url === undefined && previousSourceCase ? previousSourceCase.automation_start_url : automation_start_url, {
      required: !previousSourceCase && normalizedAutomated === "yes" && requiresAutomationStartUrl({ appTypeKind: casePlatform.automation_case_type, steps: casePlatform.steps })
    }),
    automation_status: normalizeAutomationStatus(
      automation_status,
      normalizedAutomated,
      null,
      normalizedSteps.some((step) => Boolean(step.automation_code || step.api_request))
    ),
    manual_test_case_id: resolvedManualTestCaseIds[0] || null,
    manual_test_case_ids: resolvedManualTestCaseIds,
    authoring_mode: normalizeAuthoringMode(authoring_mode),
    test_case_type: await normalizeTestCaseType(test_case_type, previousSourceCase?.test_case_type),
    gherkin_document: setGherkinFeatureTitle(normalizeText(gherkin_document), linkedRequirements[0]?.title),
    priority: normalizePriority(priority),
    status: resolvedStatus,
    display_id,
    steps: normalizedSteps,
    ai_generation_source: resolvedAiGenerationSource,
    ai_generation_review_status: resolvedAiGenerationReviewStatus,
    ai_generation_job_id: normalizeText(ai_generation_job_id),
    source_idempotency_key: normalizeText(source_idempotency_key),
    source_issue_id: normalizeText(source_issue_id),
    ai_generated_at: normalizeIsoDateTime(ai_generated_at) || (resolvedAiGenerationSource ? new Date().toISOString() : null),
    reviewer_id: resolvedReviewerId,
    review_status: resolvedReviewStatus,
    review_history: normalizeReviewHistory(review_history),
    ai_quality_score: normalizeAiQualityScore(ai_quality_score),
    author_id: resolvedAuthorId,
    created_by: resolvedCreatorId,
    updated_by: normalizeText(updated_by) || resolvedCreatorId
  };
};

const createOne = db.transaction(async (payload) => {
  if (payload.source_idempotency_key) {
    const existing = await selectTestCaseBySourceIdempotency.get(
      payload.app_type_id,
      payload.source_idempotency_key
    );
    if (existing) return { ...existing, idempotent_replay: true };
  }

  if (payload.source_issue_id) {
    // Conversion origin belongs to creation, independently of editable defect
    // links. Check and retain its project scope for the complete transaction.
    const source = await db.prepare("SELECT id, project_id FROM feedback WHERE id = ? FOR SHARE").get(payload.source_issue_id);
    if (!source || !payload.project_id || source.project_id !== payload.project_id) {
      throw Object.assign(new Error("The source Defect must belong to the Test Case project"), { statusCode: 403 });
    }
  }

  const id = uuid();

  await insertTestCaseRecord.run(
    id,
    payload.display_id,
    payload.app_type_id,
    payload.suite_ids[0] || null,
    payload.title,
    payload.description,
    payload.external_references,
    payload.labels,
    payload.parameter_values,
    payload.test_data_options,
    payload.automated,
    payload.automation_status,
    payload.automation_start_url,
    payload.manual_test_case_id,
    payload.authoring_mode,
    payload.test_case_type,
    payload.gherkin_document,
    payload.priority,
    payload.status,
    payload.requirement_ids[0] || null,
    payload.ai_generation_source,
    payload.ai_generation_review_status,
    payload.ai_generation_job_id,
    payload.source_idempotency_key,
    payload.ai_generated_at,
    payload.reviewer_id,
    payload.review_status,
    payload.review_history,
    payload.ai_quality_score,
    payload.author_id,
    payload.created_by,
    payload.updated_by,
    payload.source_issue_id
  );

  if (payload.execution_hooks?.length) await db.prepare("UPDATE test_cases SET execution_hooks = ? WHERE id = ?").run(payload.execution_hooks, id);
  await syncSuiteMappings(id, payload.suite_ids);
  await syncRequirementMappings(id, payload.requirement_ids);
  await syncDataSetMappings(id, payload.test_data_set_ids);
  await syncAutomationCaseLinks(id, payload.manual_test_case_ids);

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

  return { id, display_id: payload.display_id, idempotent_replay: false };
});

exports.createTestCase = async (input, { syncSharedGroups = true } = {}) => {
  const payload = await createPersistablePayload(input);
  await mobileFeatureService.assertAuthoringMobileFeatureEnabled({
    app_type_id: payload.app_type_id,
    payload: payload.steps
  });
  let response;
  try {
    response = await createOne(payload);
  } catch (error) {
    if (error?.code !== "23505" || !payload.source_idempotency_key) throw error;
    const existing = await selectTestCaseBySourceIdempotency.get(
      payload.app_type_id,
      payload.source_idempotency_key
    );
    if (!existing) throw error;
    response = { ...existing, idempotent_replay: true };
  }

  if (response.idempotent_replay) {
    return response;
  }
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

  for (const target of syncSharedGroups ? sharedGroupTargets : []) {
    await sharedStepSyncService.syncSharedGroupFromReference(
      target.reusable_group_id,
      response.id,
      target.group_id
    );
  }

  if (payload.reviewer_id && payload.review_status === "pending") {
    await notifyReviewer({
      reviewer_id: payload.reviewer_id,
      test_case_id: response.id,
      display_id: response.display_id,
      title: payload.title,
      project_id: payload.project_id,
      actor_id: payload.updated_by
    });
  }

  return response;
};

exports.bulkImportTestCases = async ({ app_type_id, requirement_id, rows = [], created_by, import_source, batches = [], transaction_id } = {}) => {
  const resolvedAppTypeId = normalizeText(app_type_id);
  const defaultRequirementId = normalizeText(requirement_id);
  const normalizedBatches = normalizeImportBatches({ batches, rows, import_source });

  if (!resolvedAppTypeId) {
    throw new Error("app_type_id is required");
  }

  if (!normalizedBatches.length) {
    throw new Error("At least one import row is required");
  }

  const appType = await ensureAppTypeExists(resolvedAppTypeId);
  await mobileFeatureService.assertAuthoringMobileFeatureEnabled({
    app_type_id: resolvedAppTypeId,
    payload: { batches: normalizedBatches, rows }
  });
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
    await ensureRequirementsExist([defaultRequirementId], appType.project_id);
  }

  const [availableSuites, availableRequirements, availableSharedGroups, availableModules, availableDataSets, availableUsers] = await Promise.all([
    selectSuitesForAppType.all(resolvedAppTypeId),
    selectRequirementsForProject.all(appType?.project_id || ""),
    selectSharedStepGroupsForAppType.all(resolvedAppTypeId),
    db.prepare("SELECT id, display_id, name FROM test_case_modules WHERE app_type_id = ?").all(resolvedAppTypeId),
    db.prepare("SELECT id, name FROM test_data_sets WHERE project_id = ? AND (app_type_id = ? OR app_type_id IS NULL)").all(appType.project_id, resolvedAppTypeId),
    db.prepare("SELECT u.id, u.name, u.email FROM users u JOIN project_members pm ON pm.user_id = u.id WHERE pm.project_id = ?").all(appType.project_id)
  ]);
  const suiteLookup = buildNameLookup(availableSuites, "name");
  const requirementLookup = buildNameLookup(availableRequirements, "title");
  const sharedGroupLookup = buildNameLookup(availableSharedGroups, "name");
  const moduleLookup = buildNameLookup(availableModules, "name");
  const dataSetLookup = buildNameLookup(availableDataSets, "name");
  const userLookup = buildNameLookup(availableUsers, "name");
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
        const normalizedRow = validateTestCaseImportRow(row);
        const sourceKey = `import:${transaction.id}:${batch.batch_index}:${rowNumber}`;
        // A worker lease can be retried after committing a row. Never recreate or
        // overwrite that case, even if the author has edited it since the import.
        let response = await selectTestCaseBySourceIdempotency.get(resolvedAppTypeId, sourceKey);
        if (!response) {
          const rowSuiteLookup = { ...suiteLookup };
          const rowSharedLookup = { ...sharedGroupLookup };
          response = await db.transaction(async () => {
            const linkedStories = resolveNamedRows(requirementLookup, [
              ...splitImportSequence(normalizedRow.requirements || normalizedRow.requirement),
              ...(Array.isArray(normalizedRow.requirement_ids) ? normalizedRow.requirement_ids : []),
              normalizedRow.requirement_id || normalizedRow.requirementId
            ], "Story").map(item => item.id);
            const moduleRefs = normalizeTextList(splitImportSequence(normalizedRow.modules || normalizedRow.module || normalizedRow.module_id));
            if (moduleRefs.length > 1) throw new Error("Only one primary Module can be imported; additional module membership comes from linked Stories");
            const linkedModules = resolveNamedRows(moduleLookup, moduleRefs, "Module");
            const dataSets = resolveNamedRows(dataSetLookup, [
              ...splitImportSequence(normalizedRow.test_data_references),
              ...(Array.isArray(normalizedRow.test_data_set_ids) ? normalizedRow.test_data_set_ids : [])
            ], "Test Data Set").map(item => item.id);
            const author = resolveNamedRows(userLookup, [normalizedRow.author || normalizedRow.author_id], "Author")[0];
            const reviewer = resolveNamedRows(userLookup, [normalizedRow.reviewer || normalizedRow.reviewer_id], "Reviewer")[0];
            const explicitSuites = resolveNamedRows(rowSuiteLookup, Array.isArray(normalizedRow.suite_ids) ? normalizedRow.suite_ids : [], "Test Suite");
            const namedSuites = await resolveOrCreateImportSuites({ lookup: rowSuiteLookup,
              values: splitImportSequence(normalizedRow.suites || normalizedRow.suite), app_type_id: resolvedAppTypeId, created_by });
            const resolvedSuites = [...new Map([...explicitSuites, ...namedSuites].map(item => [item.id, item])).values()];
            for (const definition of normalizedRow.shared_groups || []) {
              const name = normalizeText(definition.name);
              if (!name) throw new Error("Each Shared Step Group definition needs a name");
              const existing = rowSharedLookup[normalizeComparableText(definition.id || name)] || rowSharedLookup[normalizeComparableText(name)] || [];
              if (existing.length > 1) throw new Error(`Multiple Shared Step Groups match "${name}"; use an ID`);
              let group = existing[0];
              if (!group) {
                if (!Array.isArray(definition.steps) || !definition.steps.length) throw new Error(`Shared Step Group "${name}" needs steps before it can be created`);
                const createdGroup = await require("./sharedStepGroup.service").createSharedStepGroup({ ...definition, app_type_id: resolvedAppTypeId, created_by });
                group = { id: createdGroup.id, app_type_id: resolvedAppTypeId, name };
              }
              for (const ref of [definition.id, name, group.id]) if (ref) rowSharedLookup[normalizeComparableText(ref)] = [group];
            }
            const importedSteps = buildStepsFromImportRow(normalizedRow, { sharedGroupLookup: rowSharedLookup }).map(step => ({ ...step }));
            for (const step of importedSteps) {
              if (step.group_kind !== "reusable") continue;
              const shared = resolveNamedRows(rowSharedLookup, [step.reusable_group_id || step.group_name], "Shared Step Group")[0];
              if (!shared) throw new Error("Shared steps require a Shared Step Group name or ID");
              step.reusable_group_id = shared.id;
              step.group_name = shared.name;
            }
            const result = await exports.createTestCase({
              app_type_id: resolvedAppTypeId, title: normalizedRow.title, description: normalizedRow.description,
              labels: normalizedRow.labels, author_id: author?.id, reviewer_id: reviewer?.id,
              authoring_mode: normalizedRow.authoring_mode, test_case_type: normalizedRow.test_case_type,
              gherkin_document: normalizedRow.gherkin_document, automation_status: normalizedRow.automation_status,
              automation_start_url: normalizedRow.automation_start_url,
              external_references: normalizeReferenceList(normalizedRow.external_references || normalizedRow.externalReferences || normalizedRow.references || normalizedRow.reference),
              parameter_values: normalizedRow.parameter_values || normalizedRow.parameterValues,
              test_data_options: normalizedRow.test_data_options,
              automated: normalizedRow.automated, priority: normalizedRow.priority,
              status: normalizeStatus(normalizedRow.status, "draft"),
              suite_ids: resolvedSuites.map(item => item.id),
              requirement_ids: normalizeTextList([defaultRequirementId, ...linkedStories]),
              test_data_set_ids: dataSets, steps: importedSteps, source_idempotency_key: sourceKey, created_by
            }, { syncSharedGroups: false });
            if (linkedModules[0]) await require("./testCaseModule.service").assignCases(linkedModules[0].id, [result.id]);
            return result;
          })();
          Object.assign(suiteLookup, rowSuiteLookup);
          Object.assign(sharedGroupLookup, rowSharedLookup);
        }

        created.push({
          row: rowNumber,
          batch_index: batch.batch_index,
          file_name: batch.file_name,
          import_source: batch.import_source,
          id: response.id,
          display_id: response.display_id,
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

  const artifact = await workspaceTransactionService.createTransactionArtifact(transaction.id, {
    file_name: "test-case-import-results.json", mime_type: "application/json",
    content: JSON.stringify({ transaction_id: transaction.id, ...response }, null, 2)
  });
  return { ...response, transaction_id: transaction.id, artifact_id: artifact.id };
};

exports.getTestCases = async ({ project_id, suite_id, requirement_id, module_id, unassigned_module = false, status, app_type_id }) => {
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

  if (module_id) {
    joins.push(`JOIN test_case_effective_module_cases ON test_case_effective_module_cases.test_case_id = test_cases.id`);
  } else if (unassigned_module) {
    joins.push(`LEFT JOIN test_case_effective_module_cases ON test_case_effective_module_cases.test_case_id = test_cases.id`);
  }

  if (suite_id) {
    where.push(`suite_test_cases.suite_id = ?`);
    params.push(suite_id);
  }

  if (app_type_id) {
    where.push(`test_cases.app_type_id = ?`);
    params.push(app_type_id);
  }

  if (project_id) {
    where.push(`test_cases.app_type_id IN (SELECT id FROM app_types WHERE project_id = ?)`);
    params.push(project_id);
  }

  if (requirement_id) {
    where.push(`requirement_test_cases.requirement_id = ?`);
    params.push(requirement_id);
  }

  if (module_id) {
    where.push(`test_case_effective_module_cases.module_id = ?`);
    params.push(module_id);
  } else if (unassigned_module) {
    where.push(`test_case_effective_module_cases.module_id IS NULL`);
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
  return hydrateTestCases(
    rows.map(({ matched_suite_sort_order, case_activity_at, case_row_number, ...testCase }) => testCase)
  );
};

exports.getTestCasesForRequirements = async ({ app_type_id, requirement_ids = [] } = {}) => {
  const appTypeId = normalizeText(app_type_id);
  const requirementIds = normalizeTextList(requirement_ids);

  if (!appTypeId) {
    throw new Error("app_type_id is required");
  }

  if (!requirementIds.length) {
    return [];
  }

  const placeholders = placeholdersFor(requirementIds);
  const rows = await db.prepare(`
    SELECT test_cases.id, test_cases.display_id, test_cases.app_type_id, test_cases.title,
      test_cases.automated, test_cases.priority, test_cases.status, test_cases.requirement_id,
      COALESCE((SELECT jsonb_agg(linked.id ORDER BY linked.id) FROM (
        SELECT requirements.id FROM requirements JOIN app_types ON app_types.project_id = requirements.project_id
        WHERE requirements.id = test_cases.requirement_id AND app_types.id = test_cases.app_type_id
        UNION
        SELECT requirements.id FROM requirement_test_cases
        JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
        JOIN app_types ON app_types.project_id = requirements.project_id
        WHERE requirement_test_cases.test_case_id = test_cases.id AND app_types.id = test_cases.app_type_id
      ) linked), '[]'::jsonb) AS requirement_ids
    FROM test_cases
    WHERE test_cases.app_type_id = ?
      AND (test_cases.requirement_id IN (${placeholders}) OR EXISTS (
        SELECT 1
        FROM requirement_test_cases
        WHERE requirement_test_cases.test_case_id = test_cases.id
          AND requirement_test_cases.requirement_id IN (${placeholders})
      ))
    ORDER BY COALESCE(test_cases.updated_at, test_cases.created_at) DESC NULLS LAST, test_cases.id DESC
  `).all(appTypeId, ...requirementIds, ...requirementIds);

  // This explicit selection operation needs every linked ID, not full authoring
  // or execution details for every case in the selected Requirements.
  return rows.map((row) => ({ ...row, detail_complete: false, summary_complete: false }));
};

exports.getTestCase = async (id) => {
  const testCase = await db.prepare(`
    SELECT test_cases.*, (SELECT type FROM app_types WHERE app_types.id=test_cases.app_type_id) AS app_type_kind,
      COALESCE((SELECT MAX(version.revision) FROM test_case_versions version
        WHERE version.test_case_id = test_cases.id), 0) + 1 AS revision
    FROM test_cases
    WHERE test_cases.id = ? OR test_cases.display_id = ? OR test_cases.legacy_display_ids @> ?::jsonb
  `).get(id, id, [id]);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  return hydrateSuiteIds(testCase);
};

// Caller authorizes data visibility before exposing live linked-manual defaults.
exports.withParameterDefaults = async (testCase,{projectId}={}) => {
  const [projected]=await require('./linkedManualParameters.service').projectCases([testCase],{projectId});
  const data=await require('./effectiveCaseDataSets.service').loadEffectiveCaseDataSets({testCaseIds:[testCase.id],projectId,appTypeId:testCase.app_type_id});
  return {...projected,effective_test_data_set_ids:data.filter(row=>row.test_case_id===testCase.id).map(row=>row.test_data_set_id||row.id)};
};

exports.updateTestCase = async (id, data, { reviewHistoryEntry, syncSharedGroups = true, preserveLegacyAutomationStartUrl = false, expectedAutomationStartUrl } = {}) => {
  const existing = await exports.getTestCase(id);
  id=existing.id;
  if (data.automated !== undefined && normalizeAutomated(data.automated) !== normalizeAutomated(existing.automated)) {
    throw Object.assign(new Error("Manual and automation cases have separate identities. Create a linked automation case instead of changing this case type."), { statusCode: 409, code: "TEST_CASE_IDENTITY_IMMUTABLE" });
  }

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
  const requestedDataSetIds = data.test_data_set_ids !== undefined
    ? normalizeTextList(data.test_data_set_ids)
    : (existing.test_data_set_ids || []).slice(0, 1);

  let resolvedAppTypeId = normalizeText(data.app_type_id) || existing.app_type_id || null;

  const resolvedAppType = await ensureAppTypeExists(resolvedAppTypeId);
  resolvedAppTypeId = await ensureSuitesMatchAppType(requestedSuiteIds, resolvedAppTypeId);
  const finalAppType = resolvedAppTypeId !== resolvedAppType?.id ? await ensureAppTypeExists(resolvedAppTypeId) : resolvedAppType;
  if(resolvedAppTypeId!==existing.app_type_id && (existing.manual_test_case_ids?.length||existing.automation_test_case_ids?.length)){
    throw Object.assign(new Error("Unlink manual and automation cases before moving them to another application."),{statusCode:409,code:"AUTOMATION_LINK_SCOPE_CHANGED"});
  }
  const linkedRequirements = await ensureRequirementsExist(requestedRequirementIds, finalAppType?.project_id || null);
  await ensureDataSetsExist(requestedDataSetIds, finalAppType?.project_id || null, resolvedAppTypeId);
  const existingAuthorId = existing.author_id || existing.author?.id || existing.created_by || null;
  const requestedAuthorId = data.author_id !== undefined
    ? normalizeText(data.author_id)
    : existingAuthorId;
  await ensureAuthorExists(
    requestedAuthorId,
    (data.author_id !== undefined && requestedAuthorId !== existingAuthorId)
      || (data.app_type_id !== undefined && resolvedAppTypeId !== existing.app_type_id)
      ? finalAppType?.project_id || null
      : null
  );
  const requestedReviewerId = data.reviewer_id !== undefined ? normalizeText(data.reviewer_id) : existing.reviewer_id || null;
  await ensureReviewerExists(requestedReviewerId, finalAppType?.project_id || null);
  const existingReviewStatus = normalizeReviewStatus(existing.review_status, existing.reviewer_id || null, "not_requested");
  const reviewerChanged = requestedReviewerId !== (existing.reviewer_id || null);
  if (["accepted", "changes_requested"].includes(data.review_status) && data.review_status !== existingReviewStatus) {
    throw reviewError("Use the review action to approve a test case or request changes", 403);
  }
  const nextReviewStatus = reviewerChanged
    ? requestedReviewerId ? "pending" : "not_requested"
    : data.review_status !== undefined
      ? normalizeReviewStatus(data.review_status, requestedReviewerId, existingReviewStatus)
      : existingReviewStatus;

  const payload = {
    app_type_id: resolvedAppTypeId,
    project_id: finalAppType?.project_id || null,
    suite_ids: requestedSuiteIds,
    requirement_ids: requestedRequirementIds,
    test_data_set_ids: requestedDataSetIds,
    test_data_options: caseDataOptions(data.test_data_options === undefined ? existing.test_data_options || {} : data.test_data_options,normalizeParameterValues(data.parameter_values === undefined ? existing.parameter_values : data.parameter_values),existing.test_data_options),
    title: normalizeText(data.title) || existing.title,
    description: data.description !== undefined ? normalizeText(data.description) : existing.description,
    external_references: data.external_references !== undefined
      ? normalizeReferenceList(data.external_references)
      : normalizeStoredReferenceList(existing.external_references),
    labels: data.labels !== undefined
      ? normalizeReferenceList(data.labels)
      : normalizeStoredReferenceList(existing.labels),
    parameter_values: data.parameter_values !== undefined ? normalizeParameterValues(data.parameter_values) : normalizeParameterValues(existing.parameter_values),
    execution_hooks: data.execution_hooks === undefined && resolvedAppTypeId === existing.app_type_id
      ? require("./caseExecutionHooks.service").normalizeCaseExecutionHooks(existing.execution_hooks)
      : await require("./caseExecutionHooks.service").validateCaseExecutionHooks(data.execution_hooks === undefined ? existing.execution_hooks : data.execution_hooks, {projectId:finalAppType?.project_id,appTypeId:resolvedAppTypeId,caseId:id}),
    automated: data.automated !== undefined ? normalizeAutomated(data.automated, existing.automated || DEFAULT_AUTOMATED) : existing.automated || DEFAULT_AUTOMATED,
    automation_start_url: existing.automation_start_url || null,
    authoring_mode: data.authoring_mode !== undefined
      ? normalizeAuthoringMode(data.authoring_mode, existing.authoring_mode || "structured")
      : normalizeAuthoringMode(existing.authoring_mode || "structured"),
    test_case_type: data.test_case_type !== undefined
      ? await normalizeTestCaseType(data.test_case_type, existing.test_case_type)
      : existing.test_case_type || "functional",
    gherkin_document: setGherkinFeatureTitle(
      data.gherkin_document !== undefined ? normalizeText(data.gherkin_document) : normalizeText(existing.gherkin_document),
      linkedRequirements[0]?.title
    ),
    priority: data.priority !== undefined ? normalizePriority(data.priority) : existing.priority ?? DEFAULT_PRIORITY,
    status: data.status !== undefined ? normalizeStatus(data.status) : existing.status || DEFAULT_STATUS,
    reviewer_id: requestedReviewerId,
    review_status: nextReviewStatus,
    review_history: [
      ...normalizeReviewHistory(existing.review_history),
      ...normalizeReviewHistory(reviewHistoryEntry ? [reviewHistoryEntry] : [])
    ],
    ai_quality_score: data.ai_quality_score !== undefined
      ? normalizeAiQualityScore(data.ai_quality_score)
      : normalizeAiQualityScore(existing.ai_quality_score),
    steps: data.steps !== undefined ? normalizeSteps(data.steps) : null,
    author_id: requestedAuthorId,
    updated_by: normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null
  };
  if (payload.automated === 'yes') {
    const platform = resolveAutomationCaseSteps({
      automation_case_type: data.automation_case_type ?? storedAutomationCaseType({ test_data_options: data.test_data_options }) ?? storedAutomationCaseType(existing),
      test_data_options: payload.test_data_options
    }, data.steps !== undefined ? data.steps : await selectStepsForTestCase.all(id), { appTypeKind: finalAppType?.type });
    payload.test_data_options.automation_case_type = platform.automation_case_type;
  }
  if (data.automation_start_url !== undefined) {
    payload.automation_start_url = normalizeAutomationStartUrl(data.automation_start_url, {
      // Existing cases may predate the Start URL contract. Normal edits keep
      // that nullable value; only a trusted version restore may clear it.
      required: !preserveLegacyAutomationStartUrl && payload.automated === "yes" && requiresAutomationStartUrl({
        appTypeKind: payload.test_data_options.automation_case_type,
        steps: resolveAutomationCaseSteps({ test_data_options: payload.test_data_options }, payload.steps !== null ? payload.steps : await selectStepsForTestCase.all(id), { appTypeKind: finalAppType?.type }).steps
      })
    });
  }
  await mobileFeatureService.assertAuthoringMobileFeatureEnabled({
    app_type_id: payload.app_type_id,
    payload: payload.steps !== null ? payload.steps : await selectStepsForTestCase.all(id)
  });
  payload.manual_test_case_ids = payload.automated === "yes"
    ? await ensureManualTestCaseLinks({
        manualTestCaseIds: data.manual_test_case_ids !== undefined
          ? data.manual_test_case_ids
          : data.manual_test_case_id !== undefined
            ? [data.manual_test_case_id]
            : existing.manual_test_case_ids || (existing.manual_test_case_id ? [existing.manual_test_case_id] : []),
        appTypeId: payload.app_type_id,
        automated: payload.automated,
        currentTestCaseId: id
      })
    : [];
  payload.manual_test_case_id = payload.manual_test_case_ids[0] || null;
  payload.automation_status = normalizeAutomationStatus(
    data.automation_status,
    payload.automated,
    data.automated === undefined ? existing.automation_status : null,
    Boolean(payload.steps?.some((step) => step.automation_code || step.api_request))
  );
  if (payload.review_status === "pending" || payload.review_status === "changes_requested") {
    payload.status = "draft";
  } else if (payload.review_status === "accepted") {
    payload.status = "ready";
  }

  const executeUpdate = db.transaction(async () => {
    const current = await db.prepare("SELECT * FROM test_cases WHERE id = ? FOR UPDATE").get(id);
    if (!current) throw reviewError("Test case not found", 404);
    if (expectedAutomationStartUrl !== undefined && (current.automation_start_url ?? null) !== expectedAutomationStartUrl) {
      throw Object.assign(new Error('The automation Start URL changed after this build was reviewed. Review the current target and start a new build.'), { statusCode: 409, code: 'AUTOMATION_START_URL_CHANGED' });
    }
    if (reviewStateKey(current) !== reviewStateKey(existing)) {
      throw reviewError("The test case review changed while saving. Refresh before editing.");
    }
    await testCaseVersionService.assertExpectedRevision(id, data.expected_revision);
    const capturedVersion = await testCaseVersionService.capture({
      testCase: existing,
      createdBy: payload.updated_by,
      nextSnapshot: {
        ...payload,
        steps: payload.steps === null ? await testCaseVersionService.buildSnapshot(existing).then((snapshot) => snapshot.steps) : payload.steps
      }
    });
    await updateTestCaseRecord.run(
      payload.app_type_id,
      payload.suite_ids[0] || null,
      payload.title,
      payload.description,
      payload.external_references,
      payload.labels,
      payload.parameter_values,
      payload.test_data_options,
      payload.automated,
      payload.automation_status,
      payload.automation_start_url,
      payload.manual_test_case_id,
      payload.authoring_mode,
      payload.test_case_type,
      payload.gherkin_document,
      payload.priority,
      payload.status,
      payload.requirement_ids[0] || null,
      payload.reviewer_id,
      payload.review_status,
      payload.review_history,
      payload.ai_quality_score,
      payload.author_id,
      payload.updated_by,
      id
    );
    if (data.execution_hooks !== undefined) await db.prepare("UPDATE test_cases SET execution_hooks = ? WHERE id = ?").run(payload.execution_hooks, id);
    if (existing.ai_generation_source && (reviewerChanged || payload.review_status !== existingReviewStatus)) {
      await updateGeneratedReviewState.run(
        payload.review_status === "accepted" ? "accepted" : payload.review_status === "changes_requested" ? "rejected" : "pending",
        id
      );
    }

    if (data.manual_test_case_ids !== undefined || data.manual_test_case_id !== undefined || data.automated !== undefined) {
      await syncAutomationCaseLinks(id, payload.manual_test_case_ids);
    }

    if (data.suite_ids !== undefined || data.suite_id !== undefined) {
      await syncSuiteMappings(id, payload.suite_ids);
    }

    if (data.requirement_ids !== undefined || data.requirement_id !== undefined) {
      await syncRequirementMappings(id, payload.requirement_ids);
    }

    if (data.test_data_set_ids !== undefined) {
      await syncDataSetMappings(id, payload.test_data_set_ids);
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
    // The captured snapshot is the previous version. Return this write's new
    // revision while the row lock still protects it from concurrent saves.
    return capturedVersion.revision + 1;
  });

  const revision = await executeUpdate();

  if (
    payload.reviewer_id
    && payload.review_status === "pending"
    && (payload.reviewer_id !== existing.reviewer_id || existingReviewStatus !== "pending")
  ) {
    await notifyReviewer({
      reviewer_id: payload.reviewer_id,
      test_case_id: id,
      display_id: existing.display_id,
      title: payload.title,
      project_id: payload.project_id,
      actor_id: payload.updated_by
    });
  }

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

    for (const target of syncSharedGroups ? sharedGroupTargets : []) {
      await sharedStepSyncService.syncSharedGroupFromReference(
        target.reusable_group_id,
        id,
        target.group_id
      );
    }
  }

  return { updated: true, revision };
};

const applyReviewDecision = async (id, { review_status, comment, reviewed_by, expected_updated_at, expected_revision } = {}, { generatedOnly = false } = {}) => {
  if (!["accepted", "changes_requested"].includes(review_status)) {
    throw reviewError("Review action must be accepted or changes_requested", 400);
  }
  const reviewedBy = normalizeText(reviewed_by);
  const result = await db.transaction(async () => {
    // Hold the row lock through ownership, stale-state checks and the decision so
    // a concurrent review or reviewer reassignment cannot overwrite this result.
    const current = await db.prepare("SELECT * FROM test_cases WHERE id = ? FOR UPDATE").get(id);
    if (!current) throw reviewError("Test case not found", 404);
    assertReviewOwner(current, reviewedBy);
    assertPendingReview(current, generatedOnly);
    assertReviewTimestamp(current, expected_updated_at);
    await testCaseVersionService.assertExpectedRevision(id, expected_revision);
    const existing = await hydrateSuiteIds(current);
    const entry = {
      id: uuid(),
      status: review_status,
      comment: normalizeText(comment),
      user_id: reviewedBy,
      created_at: new Date().toISOString()
    };
    const history = [...normalizeReviewHistory(current.review_history), entry];
    const nextStatus = review_status === "accepted" ? "ready" : "draft";
    const aiReviewStatus = current.ai_generation_source
      ? review_status === "accepted" ? "accepted" : "rejected"
      : null;
    await testCaseVersionService.capture({
      testCase: existing,
      createdBy: reviewedBy,
      nextSnapshot: { ...await testCaseVersionService.buildSnapshot(existing), review_status, status: nextStatus }
    });
    await db.prepare(`
      UPDATE test_cases
      SET review_status = ?, status = ?, ai_generation_review_status = ?, review_history = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(review_status, nextStatus, aiReviewStatus, history, reviewedBy, id);
    return { existing, entry };
  })();
  const { existing, entry } = result;
  const appType = existing.app_type_id ? await selectAppType.get(existing.app_type_id) : null;
  const recipientId = normalizeText(existing.author_id) || normalizeText(existing.created_by);
  if (recipientId && recipientId !== reviewedBy) {
    try {
      await notificationService.createNotification({
        user_id: recipientId,
        project_id: appType?.project_id || null,
        target_url: `/test-cases?case=${encodeURIComponent(existing.display_id || id)}`,
        type: "test_case_review_result",
        title: review_status === "accepted" ? "Test case review accepted" : "Test case review updated",
        message: `${existing.title || "A test case"} was marked ${review_status.replace(/_/g, " ")}.`
      });
    } catch (error) {
      console.warn("Unable to create test case review result notification", {
        test_case_id: id,
        user_id: recipientId,
        message: error.message
      });
    }
  }
  return { updated: true, review: entry };
};

exports.reviewTestCase = (id, data) => applyReviewDecision(id, data);

exports.deleteTestCase = async (id, {deleted_by=null,ip_address=null}={}) => {
  const existing=await exports.getTestCase(id);
  id=existing.id;
  if(existing.automated==='yes'){
    const app=await selectAppType.get(existing.app_type_id);
    return require('./automationCaseDeletion.service').deleteAutomationCases({project_id:app?.project_id,app_type_id:existing.app_type_id,test_case_ids:[id]},{actorId:deleted_by,ipAddress:ip_address});
  }

  const executeDelete = db.transaction(async () => {
    await deleteStepsForTestCase.run(id);
    await deleteRequirementMappings.run(id);
    await deleteSuiteMappings.run(id);
    await deleteTestCaseRecord.run(id);
  });

  await executeDelete();

  return { deleted: true };
};

exports.acceptGeneratedTestCase = async (id, { reviewed_by, expected_updated_at, expected_revision } = {}) => {
  await applyReviewDecision(id, { review_status: "accepted", reviewed_by, expected_updated_at, expected_revision }, { generatedOnly: true });
  return { accepted: true };
};

exports.rejectGeneratedTestCase = async (id, { reviewed_by, expected_updated_at, expected_revision } = {}) => {
  return db.transaction(async () => {
    const current = await db.prepare("SELECT * FROM test_cases WHERE id = ? FOR UPDATE").get(id);
    if (!current) throw reviewError("Test case not found", 404);
    assertReviewOwner(current, normalizeText(reviewed_by));
    assertPendingReview(current, true);
    assertReviewTimestamp(current, expected_updated_at);
    await testCaseVersionService.assertExpectedRevision(id, expected_revision);
    await deleteStepsForTestCase.run(id);
    await deleteRequirementMappings.run(id);
    await deleteSuiteMappings.run(id);
    await deleteTestCaseRecord.run(id);
    return { deleted: true };
  })();
};
