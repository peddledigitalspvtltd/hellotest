const db = require("../db");
const { v4: uuid } = require("uuid");
const { sanitizeVariablesForRead } = require("../utils/contextVariables");
const integrationService = require("./integration.service");
const testEngineDispatchService = require("./testEngineDispatch.service");
const executionResultService = require("./executionResult.service");
const apiRequestExecutionService = require("./apiRequestExecution.service");
const executionStepRuntimeService = require("./executionStepRuntime.service");
const opsTelemetryService = require("./opsTelemetry.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");
const { materializeDataSetSnapshot, materializeParameterValues } = require("../utils/testDataGenerators");

const getSuiteIdsForExecution = db.prepare(`
  SELECT suite_id, suite_name
  FROM execution_suites
  WHERE execution_id = ?
  ORDER BY suite_id ASC
`);

const getCaseSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, test_case_title, test_case_description, external_references, suite_id, suite_name, priority, status, parameter_values, parameter_template_values, suite_parameter_values, suite_parameter_template_values, sort_order, assigned_to
  FROM execution_case_snapshots
  WHERE execution_id = ?
  ORDER BY sort_order ASC, test_case_title ASC
`);

const getStepSnapshotsForExecution = db.prepare(`
  SELECT execution_id, test_case_id, snapshot_step_id, step_order, action, expected_result, step_type, automation_code, api_request, group_id, group_name, group_kind, reusable_group_id
  FROM execution_step_snapshots
  WHERE execution_id = ?
  ORDER BY test_case_id ASC, step_order ASC
`);

const getResultsForExecution = db.prepare(`
  SELECT test_case_id, status, created_at
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY created_at DESC, id DESC
`);

const getResultLogsForExecution = db.prepare(`
  SELECT test_case_id, logs, created_at, id
  FROM execution_results
  WHERE execution_id = ?
  ORDER BY created_at ASC, id ASC
`);

const insertExecutionSuite = db.prepare(`
  INSERT INTO execution_suites (execution_id, suite_id, suite_name)
  VALUES (?, ?, ?)
`);

const insertExecutionCaseSnapshot = db.prepare(`
  INSERT INTO execution_case_snapshots (
    execution_id,
    test_case_id,
    test_case_title,
    test_case_description,
    external_references,
    suite_id,
    suite_name,
    priority,
    status,
    parameter_values,
    parameter_template_values,
    suite_parameter_values,
    suite_parameter_template_values,
    sort_order,
    assigned_to
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertExecutionStepSnapshot = db.prepare(`
  INSERT INTO execution_step_snapshots (
    execution_id,
    test_case_id,
    snapshot_step_id,
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
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const validateSuite = db.prepare(`
  SELECT id, app_type_id, name
  FROM test_suites
  WHERE id = ?
`);

const selectCasesForSuite = db.prepare(`
  SELECT
    test_cases.id AS test_case_id,
    test_cases.title AS test_case_title,
    test_cases.description AS test_case_description,
    test_cases.external_references,
    test_cases.parameter_values,
    test_suites.parameter_values AS suite_parameter_values,
    test_cases.priority,
    test_cases.status,
    suite_test_cases.sort_order
  FROM suite_test_cases
  JOIN test_cases ON test_cases.id = suite_test_cases.test_case_id
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.suite_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_cases.created_at DESC
`);

const selectCaseForExecution = db.prepare(`
  SELECT
    id AS test_case_id,
    app_type_id,
    title AS test_case_title,
    description AS test_case_description,
    external_references,
    parameter_values,
    priority,
    status
  FROM test_cases
  WHERE id = ?
`);

const selectTestEnvironment = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, base_url, browser, notes, variables
  FROM test_environments
  WHERE id = ?
`);

const selectTestConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, variables
  FROM test_configurations
  WHERE id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, mode, columns, rows
  FROM test_data_sets
  WHERE id = ?
`);

const selectExecutionAssignee = db.prepare(`
  SELECT id, email, name, avatar_data_url
  FROM users
  WHERE id = ?
`);

const selectExecutionRecord = db.prepare(`
  SELECT *
  FROM executions
  WHERE id = ?
`);

const selectExecutionCaseSnapshot = db.prepare(`
  SELECT execution_id, test_case_id, assigned_to
  FROM execution_case_snapshots
  WHERE execution_id = ? AND test_case_id = ?
`);

const updateExecutionAssignment = db.prepare(`
  UPDATE executions
  SET assigned_to = ?
  WHERE id = ?
`);

const updateExecutionCaseAssignment = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = ?
  WHERE execution_id = ? AND test_case_id = ?
`);

const assignExecutionOwnershipIfMissing = db.prepare(`
  UPDATE executions
  SET assigned_to = COALESCE(assigned_to, ?)
  WHERE id = ?
`);

const assignExecutionCaseOwnershipIfMissing = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = COALESCE(assigned_to, ?)
  WHERE execution_id = ?
`);

const selectProjectMember = db.prepare(`
  SELECT id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT id, step_order, action, expected_result, step_type, automation_code, api_request, group_id, group_name, group_kind, reusable_group_id
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

function parseJsonValue(value, fallback) {
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
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeParameterValues(values = {}) {
  const parsed = parseJsonValue(values, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.entries(parsed).reduce((next, [key, value]) => {
    const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
}

function buildExecutionRuntimeParameterValues(execution, caseSnapshot, capturedValues = {}) {
  const values = {};

  Object.entries(normalizeParameterValues(caseSnapshot?.suite_parameter_values)).forEach(([key, value]) => {
    values[`s.${key.replace(/^s\./, "")}`] = value;
  });

  Object.entries(normalizeParameterValues(caseSnapshot?.parameter_values)).forEach(([key, value]) => {
    values[`t.${key.replace(/^t\./, "")}`] = value;
  });

  (execution?.test_environment?.snapshot?.variables || []).forEach((entry) => {
    const normalizedKey = String(entry?.key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return;
    }

    values[`r.${normalizedKey.replace(/^r\./, "")}`] = entry?.value === undefined || entry?.value === null ? "" : String(entry.value);
  });

  (execution?.test_configuration?.snapshot?.variables || []).forEach((entry) => {
    const normalizedKey = String(entry?.key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return;
    }

    values[`r.${normalizedKey.replace(/^r\./, "")}`] = entry?.value === undefined || entry?.value === null ? "" : String(entry.value);
  });

  const dataSetSnapshot = execution?.test_data_set?.snapshot || null;

  if (dataSetSnapshot?.mode === "key_value") {
    (dataSetSnapshot.rows || []).forEach((row) => {
      const normalizedKey = String(row?.key || "").trim().replace(/^@+/, "").toLowerCase();
      if (!normalizedKey) {
        return;
      }
      values[`t.${normalizedKey.replace(/^t\./, "")}`] = row?.value === undefined || row?.value === null ? "" : String(row.value);
    });
  } else if (Array.isArray(dataSetSnapshot?.rows) && dataSetSnapshot.rows.length) {
    Object.entries(dataSetSnapshot.rows[0] || {}).forEach(([key, value]) => {
      const normalizedKey = String(key || "").trim().toLowerCase();

      if (!normalizedKey) {
        return;
      }

      values[`t.${normalizedKey}`] = value === undefined || value === null ? "" : String(value);
    });
  }

  Object.entries(capturedValues || {}).forEach(([key, value]) => {
    const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return;
    }

    values[normalizedKey] = value === undefined || value === null ? "" : String(value);
  });

  return values;
}

function collectSuiteScopedCapturedValues(execution, caseSnapshot, currentTestCaseId) {
  if (!execution?.id || !caseSnapshot?.suite_id) {
    return {};
  }

  const latestLogsByCaseId = new Map();

  getResultLogsForExecution.all(execution.id).forEach((row) => {
    latestLogsByCaseId.set(row.test_case_id, row.logs);
  });

  return (execution.case_snapshots || [])
    .filter((snapshot) =>
      snapshot.suite_id === caseSnapshot.suite_id
      && snapshot.test_case_id !== currentTestCaseId
      && Number(snapshot.sort_order || 0) <= Number(caseSnapshot.sort_order || 0)
    )
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    .reduce((accumulator, snapshot) => {
      const logs = latestLogsByCaseId.get(snapshot.test_case_id);

      if (!logs) {
        return accumulator;
      }

      const captures = executionStepRuntimeService.extractCapturedValuesFromLogs(logs);

      Object.entries(captures || {}).forEach(([key, value]) => {
        const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

        if (normalizedKey.startsWith("s.")) {
          accumulator[normalizedKey] = value === undefined || value === null ? "" : String(value);
        }
      });

      return accumulator;
    }, {});
}

function resolveExecutionCaseDurationMs(execution, existingResult) {
  const executionStartedAt = execution?.started_at ? new Date(execution.started_at).getTime() : 0;
  const existingCreatedAt = existingResult?.created_at ? new Date(existingResult.created_at).getTime() : 0;
  const startedAt = executionStartedAt || existingCreatedAt || Date.now();
  const computed = Math.max(Date.now() - startedAt, 0);

  return typeof existingResult?.duration_ms === "number"
    ? Math.max(existingResult.duration_ms, computed)
    : computed;
}

function shapeAssignedUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    avatar_data_url: user.avatar_data_url || null
  };
}

function attachExecutionContext(execution) {
  if (!execution) {
    return execution;
  }

  const environmentSnapshot = parseJsonValue(execution.test_environment_snapshot, null);
  const configurationSnapshot = parseJsonValue(execution.test_configuration_snapshot, null);
  const dataSetSnapshot = parseJsonValue(execution.test_data_set_snapshot, null);

  return {
    ...execution,
    test_environment: execution.test_environment_name || environmentSnapshot
      ? {
          id: execution.test_environment_id || environmentSnapshot?.id || null,
          name: execution.test_environment_name || environmentSnapshot?.name || "Deleted environment",
          snapshot: environmentSnapshot
            ? {
                ...environmentSnapshot,
                variables: sanitizeVariablesForRead(environmentSnapshot.variables)
              }
            : null
        }
      : null,
    test_configuration: execution.test_configuration_name || configurationSnapshot
      ? {
          id: execution.test_configuration_id || configurationSnapshot?.id || null,
          name: execution.test_configuration_name || configurationSnapshot?.name || "Deleted configuration",
          snapshot: configurationSnapshot
            ? {
                ...configurationSnapshot,
                variables: sanitizeVariablesForRead(configurationSnapshot.variables)
              }
            : null
        }
      : null,
    test_data_set: execution.test_data_set_name || dataSetSnapshot
      ? {
          id: execution.test_data_set_id || dataSetSnapshot?.id || null,
          name: execution.test_data_set_name || dataSetSnapshot?.name || "Deleted data set",
          snapshot: dataSetSnapshot
        }
      : null
  };
}

async function attachExecutionAssignee(execution) {
  if (!execution) {
    return execution;
  }

  if (!execution.assigned_to) {
    return {
      ...execution,
      assigned_user: null
    };
  }

  const assignedUser = await selectExecutionAssignee.get(execution.assigned_to);

  return {
    ...execution,
    assigned_user: shapeAssignedUser(assignedUser)
  };
}

async function attachExecutionCaseAssignees(caseSnapshots) {
  if (!Array.isArray(caseSnapshots) || !caseSnapshots.length) {
    return [];
  }

  const userIds = [...new Set(caseSnapshots.map((snapshot) => snapshot.assigned_to).filter(Boolean))];
  const assignedUsersById = {};

  for (const userId of userIds) {
    assignedUsersById[userId] = shapeAssignedUser(await selectExecutionAssignee.get(userId));
  }

  return caseSnapshots.map((snapshot) => ({
    ...snapshot,
    external_references: normalizeStoredReferenceList(snapshot.external_references),
    parameter_values: normalizeParameterValues(snapshot.parameter_values),
    parameter_template_values: normalizeParameterValues(snapshot.parameter_template_values || snapshot.parameter_values),
    suite_parameter_values: normalizeParameterValues(snapshot.suite_parameter_values),
    suite_parameter_template_values: normalizeParameterValues(snapshot.suite_parameter_template_values || snapshot.suite_parameter_values),
    assigned_user: snapshot.assigned_to ? assignedUsersById[snapshot.assigned_to] || null : null
  }));
}

async function validateExecutionAssignee(projectId, assignedTo) {
  if (!assignedTo) {
    return null;
  }

  const assignedUser = await selectExecutionAssignee.get(assignedTo);

  if (!assignedUser) {
    throw new Error("Assigned user not found");
  }

  const member = await selectProjectMember.get(projectId, assignedTo);

  if (!member) {
    throw new Error("Assigned user must be a member of the selected project");
  }

  return assignedUser;
}

function resolveExecutionAssignee(assignedTo, createdBy) {
  return normalizeText(assignedTo) || normalizeText(createdBy) || null;
}

async function resolveExecutionAssigneeForCreate(projectId, assignedTo, createdBy) {
  const explicitAssignee = normalizeText(assignedTo);

  if (explicitAssignee) {
    await validateExecutionAssignee(projectId, explicitAssignee);
    return explicitAssignee;
  }

  const creatorId = normalizeText(createdBy);

  if (!creatorId) {
    return null;
  }

  const creatorMembership = await selectProjectMember.get(projectId, creatorId);
  return creatorMembership ? creatorId : null;
}

async function resolveExecutionOwnershipCandidate(projectId, ...candidateIds) {
  for (const candidateId of candidateIds) {
    const normalizedCandidateId = normalizeText(candidateId);

    if (!normalizedCandidateId) {
      continue;
    }

    const membership = await selectProjectMember.get(projectId, normalizedCandidateId);

    if (membership) {
      return normalizedCandidateId;
    }
  }

  return null;
}

async function resolveExecutionContextResource({ id, label, projectId, appTypeId, lookup, snapshotBuilder }) {
  if (!id) {
    return null;
  }

  const resource = await lookup.get(id);

  if (!resource) {
    throw new Error(`${label} not found`);
  }

  if (resource.project_id !== projectId) {
    throw new Error(`${label} must belong to the selected project`);
  }

  if (resource.app_type_id && resource.app_type_id !== appTypeId) {
    throw new Error(`${label} must belong to the selected app type or be shared at project level`);
  }

  return {
    id: resource.id,
    name: resource.name,
    snapshot: snapshotBuilder(resource)
  };
}

async function buildSnapshotPayload(executionId, suiteRows, options = {}) {
  const seenCaseIds = new Set();
  const caseSnapshots = [];
  const stepSnapshots = [];
  const materializedSuiteParameters = new Map();
  const resolvedAssignedTo = normalizeText(options.assignedTo) || null;
  let sortOrder = 0;

  for (const suiteRow of suiteRows) {
    const suiteCases = await selectCasesForSuite.all(suiteRow.suite_id);

    for (const suiteCase of suiteCases) {
      if (seenCaseIds.has(suiteCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(suiteCase.test_case_id);
      sortOrder += 1;
      const parameterTemplateValues = normalizeParameterValues(suiteCase.parameter_values);
      const suiteParameterTemplateValues = normalizeParameterValues(suiteCase.suite_parameter_values);
      const suiteParameterValues = materializedSuiteParameters.get(suiteRow.suite_id)
        || materializeParameterValues(suiteParameterTemplateValues);
      materializedSuiteParameters.set(suiteRow.suite_id, suiteParameterValues);

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: suiteCase.test_case_id,
        test_case_title: suiteCase.test_case_title,
        test_case_description: suiteCase.test_case_description,
        external_references: normalizeStoredReferenceList(suiteCase.external_references),
        suite_id: suiteRow.suite_id,
        suite_name: suiteRow.suite_name,
        priority: suiteCase.priority,
        status: suiteCase.status,
        parameter_values: materializeParameterValues(parameterTemplateValues),
        parameter_template_values: parameterTemplateValues,
        suite_parameter_values: suiteParameterValues,
        suite_parameter_template_values: suiteParameterTemplateValues,
        sort_order: sortOrder,
        assigned_to: resolvedAssignedTo
      });

      const steps = await selectStepsForCase.all(suiteCase.test_case_id);

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: suiteCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${suiteCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id
        });
      }
    }
  }

  const directCases = Array.isArray(options.directCases) ? options.directCases : [];

  if (directCases.length) {
    for (const directCase of directCases) {
      if (seenCaseIds.has(directCase.test_case_id)) {
        continue;
      }

      seenCaseIds.add(directCase.test_case_id);
      sortOrder += 1;
      const parameterTemplateValues = normalizeParameterValues(directCase.parameter_values);

      caseSnapshots.push({
        execution_id: executionId,
        test_case_id: directCase.test_case_id,
        test_case_title: directCase.test_case_title,
        test_case_description: directCase.test_case_description,
        external_references: normalizeStoredReferenceList(directCase.external_references),
        suite_id: null,
        suite_name: null,
        priority: directCase.priority,
        status: directCase.status,
        parameter_values: materializeParameterValues(parameterTemplateValues),
        parameter_template_values: parameterTemplateValues,
        suite_parameter_values: {},
        suite_parameter_template_values: {},
        sort_order: sortOrder,
        assigned_to: resolvedAssignedTo
      });

      const steps = await selectStepsForCase.all(directCase.test_case_id);

      for (const step of steps) {
        stepSnapshots.push({
          execution_id: executionId,
          test_case_id: directCase.test_case_id,
          snapshot_step_id: options.persisted
            ? uuid()
            : `${executionId}:${directCase.test_case_id}:${step.id}`,
          step_order: step.step_order,
          action: step.action,
          expected_result: step.expected_result,
          step_type: step.step_type,
          automation_code: step.automation_code,
          api_request: step.api_request,
          group_id: step.group_id,
          group_name: step.group_name,
          group_kind: step.group_kind,
          reusable_group_id: step.reusable_group_id
        });
      }
    }
  }

  return {
    caseSnapshots,
    stepSnapshots
  };
}

async function attachScope(execution) {
  if (!execution) {
    return execution;
  }

  const executionWithMetadata = await attachExecutionAssignee(attachExecutionContext(execution));
  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const suite_ids = suiteRows.map((row) => row.suite_id);

  return {
    ...executionWithMetadata,
    suite_ids,
    suite_snapshots: suiteRows.map((row) => ({ id: row.suite_id, name: row.suite_name || "Deleted Suite", parameter_values: {} }))
  };
}

function mergeSuiteSnapshotsWithParameters(suiteSnapshots = [], caseSnapshots = []) {
  const suitesById = new Map(
    suiteSnapshots.map((suite) => [
      suite.id,
      {
        ...suite,
        parameter_values: normalizeParameterValues(suite.parameter_values)
      }
    ])
  );

  caseSnapshots.forEach((snapshot) => {
    if (!snapshot?.suite_id) {
      return;
    }

    const current = suitesById.get(snapshot.suite_id) || {
      id: snapshot.suite_id,
      name: snapshot.suite_name || "Deleted Suite",
      parameter_values: {}
    };

    if (!Object.keys(current.parameter_values || {}).length) {
      current.parameter_values = normalizeParameterValues(snapshot.suite_parameter_values);
    }

    suitesById.set(snapshot.suite_id, current);
  });

  return [...suitesById.values()];
}

async function attachDetailedScope(execution) {
  if (!execution) {
    return execution;
  }

  const hydrated = await attachScope(execution);
  const suiteRows = await getSuiteIdsForExecution.all(execution.id);
  const storedCaseSnapshots = await getCaseSnapshotsForExecution.all(execution.id);
  const storedStepSnapshots = await getStepSnapshotsForExecution.all(execution.id);
  const hydratedCaseSnapshots = await attachExecutionCaseAssignees(storedCaseSnapshots);
  const hydratedSuiteSnapshots = mergeSuiteSnapshotsWithParameters(hydrated.suite_snapshots || [], hydratedCaseSnapshots);

  if (storedCaseSnapshots.length || storedStepSnapshots.length || !suiteRows.length) {
    return {
      ...hydrated,
      suite_snapshots: hydratedSuiteSnapshots,
      case_snapshots: hydratedCaseSnapshots,
      step_snapshots: storedStepSnapshots
    };
  }

  const liveSnapshotPayload = await buildSnapshotPayload(
    execution.id,
    suiteRows.map((row) => ({
      suite_id: row.suite_id,
      suite_name: row.suite_name || "Deleted Suite"
    })),
    {
      assignedTo: hydrated.assigned_to || null
    }
  );

  return {
    ...hydrated,
    suite_snapshots: mergeSuiteSnapshotsWithParameters(
      hydrated.suite_snapshots || [],
      liveSnapshotPayload.caseSnapshots
    ),
    case_snapshots: await attachExecutionCaseAssignees(liveSnapshotPayload.caseSnapshots),
    step_snapshots: liveSnapshotPayload.stepSnapshots
  };
}

exports.createExecution = async ({
  project_id,
  app_type_id,
  suite_ids = [],
  test_case_ids = [],
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  execution_hooks = [],
  assigned_to,
  name,
  created_by,
  trigger = "manual",
  initial_status = "queued"
}) => {
  if (!project_id || !created_by) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const user = await db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(created_by);

  if (!user) throw new Error("Invalid user");

  const resolvedAssignedTo = await resolveExecutionAssigneeForCreate(project_id, assigned_to, created_by);

  if (app_type_id) {
    const appType = await db.prepare(`
      SELECT id, project_id FROM app_types WHERE id = ?
    `).get(app_type_id);

    if (!appType) throw new Error("App type not found");
    if (appType.project_id !== project_id) {
      throw new Error("App type must belong to the selected project");
    }
  }

  const selectedEnvironment = await resolveExecutionContextResource({
    id: test_environment_id,
    label: "Test environment",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestEnvironment,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      base_url: resource.base_url,
      browser: resource.browser,
      notes: resource.notes,
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedConfiguration = await resolveExecutionContextResource({
    id: test_configuration_id,
    label: "Test configuration",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestConfiguration,
    snapshotBuilder: (resource) => ({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      browser: resource.browser,
      mobile_os: resource.mobile_os,
      platform_version: resource.platform_version,
      variables: parseJsonValue(resource.variables, [])
    })
  });
  const selectedDataSet = await resolveExecutionContextResource({
    id: test_data_set_id,
    label: "Test data set",
    projectId: project_id,
    appTypeId: app_type_id || null,
    lookup: selectTestDataSet,
    snapshotBuilder: (resource) => materializeDataSetSnapshot({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      mode: resource.mode,
      columns: parseJsonValue(resource.columns, []),
      rows: parseJsonValue(resource.rows, [])
    })
  });

  const uniqueSuiteIds = [...new Set(suite_ids)];
  const uniqueTestCaseIds = [...new Set(test_case_ids)];

  if ((uniqueSuiteIds.length || uniqueTestCaseIds.length) && !app_type_id) {
    throw new Error("app_type_id is required when scope is provided");
  }

  const suiteRows = [];

  for (const suiteId of uniqueSuiteIds) {
    const suite = await validateSuite.get(suiteId);

    if (!suite) {
      throw new Error(`Suite not found: ${suiteId}`);
    }

    if (suite.app_type_id !== app_type_id) {
      throw new Error("All suites must belong to the selected app type");
    }

    suiteRows.push({
      suite_id: suite.id,
      suite_name: suite.name
    });
  }

  const directCaseRows = [];

  for (const testCaseId of uniqueTestCaseIds) {
    const testCase = await selectCaseForExecution.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (testCase.app_type_id !== app_type_id) {
      throw new Error("All test cases must belong to the selected app type");
    }

    directCaseRows.push(testCase);
  }

  const id = uuid();
  const normalizedTrigger = trigger === "local" ? "local" : trigger === "ci" ? "ci" : "manual";
  const normalizedInitialStatus = initial_status === "running" ? "running" : "queued";

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        execution_hooks,
        assigned_to,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project_id,
      app_type_id || null,
      name || "Execution Run",
      normalizedTrigger,
      normalizedInitialStatus,
      selectedEnvironment?.id || null,
      selectedEnvironment?.name || null,
      selectedEnvironment?.snapshot || null,
      selectedConfiguration?.id || null,
      selectedConfiguration?.name || null,
      selectedConfiguration?.snapshot || null,
      selectedDataSet?.id || null,
      selectedDataSet?.name || null,
      selectedDataSet?.snapshot || null,
      Array.isArray(execution_hooks) ? execution_hooks : [],
      resolvedAssignedTo,
      created_by
    );

    for (const suiteRow of suiteRows) {
      await insertExecutionSuite.run(id, suiteRow.suite_id, suiteRow.suite_name);
    }

    const snapshotPayload = await buildSnapshotPayload(id, suiteRows, {
      persisted: true,
      directCases: directCaseRows,
      assignedTo: resolvedAssignedTo
    });

    for (const caseSnapshot of snapshotPayload.caseSnapshots) {
      await insertExecutionCaseSnapshot.run(
        caseSnapshot.execution_id,
        caseSnapshot.test_case_id,
        caseSnapshot.test_case_title,
        caseSnapshot.test_case_description,
        caseSnapshot.external_references || [],
        caseSnapshot.suite_id,
        caseSnapshot.suite_name,
        caseSnapshot.priority,
        caseSnapshot.status,
        caseSnapshot.parameter_values || {},
        caseSnapshot.parameter_template_values || caseSnapshot.parameter_values || {},
        caseSnapshot.suite_parameter_values || {},
        caseSnapshot.suite_parameter_template_values || caseSnapshot.suite_parameter_values || {},
        caseSnapshot.sort_order,
        caseSnapshot.assigned_to || null
      );
    }

    for (const stepSnapshot of snapshotPayload.stepSnapshots) {
      await insertExecutionStepSnapshot.run(
        stepSnapshot.execution_id,
        stepSnapshot.test_case_id,
        stepSnapshot.snapshot_step_id,
        stepSnapshot.step_order,
        stepSnapshot.action,
        stepSnapshot.expected_result,
        stepSnapshot.step_type,
        stepSnapshot.automation_code,
        stepSnapshot.api_request,
        stepSnapshot.group_id,
        stepSnapshot.group_name,
        stepSnapshot.group_kind,
        stepSnapshot.reusable_group_id
      );
    }
  });

  await transaction();

  return { id };
};

exports.createLocalRun = async (input = {}) => {
  const created = await exports.createExecution({
    ...input,
    trigger: "local",
    initial_status: "running",
    name: input.name || "Local Run"
  });

  try {
    const result = await exports.startLocalExecution(created.id, {
      initiated_by: input.created_by,
      engine_base_url: input.engine_base_url
    });
    return {
      id: created.id,
      ...result
    };
  } catch (error) {
    await db.prepare(`
      UPDATE executions
      SET status = 'failed', ended_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(created.id);
    throw error;
  }
};

exports.getExecutions = async ({ project_id, app_type_id, status }) => {
  let query = `SELECT * FROM executions WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  const createdAtOrderedQuery = `${query} ORDER BY created_at DESC NULLS LAST, started_at DESC NULLS LAST, ended_at DESC NULLS LAST, id DESC`;
  const legacyOrderedQuery = `${query} ORDER BY started_at DESC NULLS LAST, ended_at DESC NULLS LAST, id DESC`;

  try {
    const rows = await db.prepare(createdAtOrderedQuery).all(...params);
    return Promise.all(rows.map(attachScope));
  } catch (error) {
    if (error?.code !== "42703") {
      throw error;
    }

    const rows = await db.prepare(legacyOrderedQuery).all(...params);
    return Promise.all(rows.map(attachScope));
  }
};

const executionCache = new Map();
const CACHE_TTL_MS = Number(process.env.EXECUTION_CACHE_TTL_MS) || 2000;

exports.getExecution = async (id, forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = executionCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  let attempts = 0;
  while (attempts < 3) {
    try {
      const execution = await selectExecutionRecord.get(id);
      if (!execution) throw new Error("Execution not found");
      const detailedExecution = await attachDetailedScope(execution);
      executionCache.set(id, { timestamp: Date.now(), data: detailedExecution });
      return detailedExecution;
    } catch (err) {
      if (err.message === "Execution not found") throw err;
      if (err.code === 'SQLITE_BUSY' || err.code === '40001' || (err.message && (err.message.includes('deadlock') || err.message.includes('locked')))) {
        attempts++;
        if (attempts >= 3) throw err;
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempts)));
      } else {
        throw err;
      }
    }
  }
};

exports.rerunExecution = async (id, { failed_only = false, created_by, name } = {}) => {
  if (!created_by) {
    throw new Error("created_by is required");
  }

  const sourceExecution = await exports.getExecution(id);
  const sourceCaseSnapshots = sourceExecution.case_snapshots || [];
  const sourceStepSnapshots = sourceExecution.step_snapshots || [];
  const sourceSuiteSnapshots = sourceExecution.suite_snapshots || [];

  if (!sourceCaseSnapshots.length) {
    throw new Error("This execution does not contain any snapped cases to rerun.");
  }

  let filteredCaseSnapshots = sourceCaseSnapshots;

  if (failed_only) {
    const latestStatusByCaseId = new Map();
    const executionResults = await getResultsForExecution.all(id);

    executionResults.forEach((result) => {
      if (!latestStatusByCaseId.has(result.test_case_id)) {
        latestStatusByCaseId.set(result.test_case_id, result.status);
      }
    });

    const failedCaseIds = new Set(
      [...latestStatusByCaseId.entries()]
        .filter(([, status]) => status === "failed")
        .map(([test_case_id]) => test_case_id)
    );

    filteredCaseSnapshots = sourceCaseSnapshots.filter((snapshot) => failedCaseIds.has(snapshot.test_case_id));

    if (!filteredCaseSnapshots.length) {
      throw new Error("This execution does not have any failed cases to rerun.");
    }
  }

  const nextExecutionId = uuid();
  const allowedCaseIds = new Set(filteredCaseSnapshots.map((snapshot) => snapshot.test_case_id));
  const filteredSuiteSnapshots = sourceSuiteSnapshots.filter((suite) =>
    filteredCaseSnapshots.some((snapshot) => snapshot.suite_id === suite.id)
  );
  const filteredStepSnapshots = sourceStepSnapshots.filter((snapshot) => allowedCaseIds.has(snapshot.test_case_id));
  const rerunName =
    normalizeText(name) ||
    `${sourceExecution.name || "Execution Run"}${failed_only ? " Failed Rerun" : " Rerun"}`;
  const rerunAssignedTo = resolveExecutionAssignee(created_by, sourceExecution.assigned_to);
  const rerunDataSetSnapshot = materializeDataSetSnapshot(sourceExecution.test_data_set?.snapshot || null);
  const rerunSuiteParameters = new Map();

  await validateExecutionAssignee(sourceExecution.project_id, rerunAssignedTo);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO executions
      (
        id,
        project_id,
        app_type_id,
        name,
        trigger,
        status,
        test_environment_id,
        test_environment_name,
        test_environment_snapshot,
        test_configuration_id,
        test_configuration_name,
        test_configuration_snapshot,
        test_data_set_id,
        test_data_set_name,
        test_data_set_snapshot,
        assigned_to,
        created_by
      )
      VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextExecutionId,
      sourceExecution.project_id,
      sourceExecution.app_type_id || null,
      rerunName,
      sourceExecution.test_environment?.id || null,
      sourceExecution.test_environment?.name || null,
      sourceExecution.test_environment?.snapshot || null,
      sourceExecution.test_configuration?.id || null,
      sourceExecution.test_configuration?.name || null,
      sourceExecution.test_configuration?.snapshot || null,
      sourceExecution.test_data_set?.id || null,
      sourceExecution.test_data_set?.name || null,
      rerunDataSetSnapshot,
      rerunAssignedTo,
      created_by
    );

    for (const suite of filteredSuiteSnapshots) {
      await insertExecutionSuite.run(nextExecutionId, suite.id, suite.name || "Deleted Suite");
    }

    for (const [index, snapshot] of filteredCaseSnapshots.entries()) {
      const parameterTemplateValues = normalizeParameterValues(snapshot.parameter_template_values || snapshot.parameter_values);
      const suiteParameterTemplateValues = normalizeParameterValues(snapshot.suite_parameter_template_values || snapshot.suite_parameter_values);
      const suiteKey = snapshot.suite_id || `case:${snapshot.test_case_id}`;
      const suiteParameterValues = rerunSuiteParameters.get(suiteKey)
        || materializeParameterValues(suiteParameterTemplateValues);
      rerunSuiteParameters.set(suiteKey, suiteParameterValues);
      await insertExecutionCaseSnapshot.run(
        nextExecutionId,
        snapshot.test_case_id,
        snapshot.test_case_title,
        snapshot.test_case_description,
        snapshot.external_references || [],
        snapshot.suite_id,
        snapshot.suite_name,
        snapshot.priority,
        snapshot.status,
        materializeParameterValues(parameterTemplateValues),
        parameterTemplateValues,
        suiteParameterValues,
        suiteParameterTemplateValues,
        index + 1,
        rerunAssignedTo
      );
    }

    for (const snapshot of filteredStepSnapshots) {
      await insertExecutionStepSnapshot.run(
        nextExecutionId,
        snapshot.test_case_id,
        uuid(),
        snapshot.step_order,
        snapshot.action,
        snapshot.expected_result,
        snapshot.step_type,
        snapshot.automation_code,
        snapshot.api_request,
        snapshot.group_id,
        snapshot.group_name,
        snapshot.group_kind,
        snapshot.reusable_group_id
      );
    }
  });

  await transaction();

  return { id: nextExecutionId };
};

exports.startExecution = async (id, options = {}) => {
  const execution = await exports.getExecution(id);
  const skipTestEngineDispatch = Boolean(options.skip_testengine_dispatch)
    || (execution.trigger === "manual" && options.execution_mode !== "local" && options.execution_mode !== "remote");

  if (execution.status !== "queued") {
    throw new Error("Only queued executions can be started");
  }

  const initiatedBy = await resolveExecutionOwnershipCandidate(
    execution.project_id,
    options.initiated_by,
    execution.assigned_to,
    execution.created_by
  );

  if (initiatedBy) {
    await assignExecutionOwnershipIfMissing.run(initiatedBy, id);
    await assignExecutionCaseOwnershipIfMissing.run(initiatedBy, id);
  }

  let dispatchPlan = null;
  let testEngineIntegration = null;
  let shouldMarkAsCi = false;

  const normalizeLocalEngineBaseUrl = (value) => {
    const normalized = typeof value === "string" ? value.trim() : "";

    if (!normalized) {
      return null;
    }

    const parsed = new URL(normalized);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Local execution engine URL must use http or https.");
    }

    const hostname = parsed.hostname.toLowerCase();
    const isPrivate =
      hostname === "localhost"
      || hostname === "host.docker.internal"
      || hostname === "testengine"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    if (!isPrivate) {
      throw new Error("Local execution engine URL must point to localhost, the local Docker service, or a private network address.");
    }

    return parsed.toString().replace(/\/+$/, "");
  };

  if (!skipTestEngineDispatch) {
    dispatchPlan = await testEngineDispatchService.planExecutionDispatch(execution);

    if (dispatchPlan.eligible_automated_case_count > 0) {
      testEngineIntegration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);
      const localEngineBaseUrl = options.execution_mode === "local"
        ? normalizeLocalEngineBaseUrl(options.engine_base_url)
        : null;

      if (testEngineIntegration && localEngineBaseUrl) {
        testEngineIntegration = {
          ...testEngineIntegration,
          base_url: localEngineBaseUrl,
          config: {
            ...(testEngineIntegration.config || {}),
            execution_mode: "local",
            public_base_url: "http://localhost:4301",
            live_view_url: "http://localhost:4301/api/v1/live-session?provider=playwright"
          }
        };
      }

      if (!testEngineIntegration) {
        const canContinueManually = dispatchPlan.manual_case_count > 0 || dispatchPlan.unsupported_automated_case_count > 0;

        if (!canContinueManually) {
          throw new Error("Configure an active Test Engine integration for this project before starting automated runs.");
        }

        dispatchPlan.warnings = [
          ...(dispatchPlan.warnings || []),
          `${dispatchPlan.eligible_automated_case_count} automated case${dispatchPlan.eligible_automated_case_count === 1 ? "" : "s"} could not be handed off because no active Test Engine integration is configured. Manual step execution remains available.`
        ];
        dispatchPlan.unsupported_automated_case_count += dispatchPlan.eligible_automated_case_count;
        dispatchPlan.eligible_automated_case_count = 0;
        dispatchPlan.eligibleCases = [];
      }

      shouldMarkAsCi =
        dispatchPlan.eligible_automated_case_count > 0
        && dispatchPlan.manual_case_count === 0
        && dispatchPlan.unsupported_automated_case_count === 0;
    }
  }

  await db.prepare(`
    UPDATE executions
    SET status = 'running', started_at = CURRENT_TIMESTAMP, trigger = ?
    WHERE id = ?
  `).run(shouldMarkAsCi ? "ci" : execution.trigger || "manual", id);

  let dispatchSummary = {
    automated_case_count: 0,
    queued_for_engine_count: 0,
    manual_case_count: Array.isArray(execution.case_snapshots) ? execution.case_snapshots.length : 0,
    unsupported_automated_case_count: 0,
    warnings: []
  };

  if (!skipTestEngineDispatch && dispatchPlan) {
    try {
      dispatchSummary = await testEngineDispatchService.queueExecutionDispatch({
        plan: dispatchPlan,
        integration: testEngineIntegration,
        initiatedBy: options.initiated_by || null
      });
    } catch (error) {
      dispatchSummary = {
        automated_case_count: dispatchPlan.automated_case_count,
        queued_for_engine_count: 0,
        manual_case_count: dispatchPlan.manual_case_count,
        unsupported_automated_case_count: dispatchPlan.unsupported_automated_case_count,
        warnings: [
          ...(dispatchPlan.warnings || []),
          error instanceof Error
            ? `QAira started the run, but could not queue automated handoff: ${error.message}`
            : "QAira started the run, but could not queue automated handoff."
        ]
      };
    }
  }

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "qaira.execution.start",
      summary: "Execution started."
    });
  } catch {
    // OPS telemetry is best-effort and must not block execution start.
  }

  return {
    started: true,
    ...dispatchSummary
  };
};

exports.startLocalExecution = async (id, options = {}) => {
  const execution = await exports.getExecution(id, true);

  if (execution.status !== "running") {
    throw new Error("Local runs must be created in running state");
  }

  const initiatedBy = await resolveExecutionOwnershipCandidate(
    execution.project_id,
    options.initiated_by,
    execution.assigned_to,
    execution.created_by
  );

  if (initiatedBy) {
    await assignExecutionOwnershipIfMissing.run(initiatedBy, id);
    await assignExecutionCaseOwnershipIfMissing.run(initiatedBy, id);
  }

  const dispatchPlan = await testEngineDispatchService.planExecutionDispatch(execution, {
    allowIncompleteAutomation: true
  });

  if (!dispatchPlan.eligible_automated_case_count) {
    throw new Error("Local run requires a recorded automated web test case.");
  }

  const localEngineBaseUrl = options.engine_base_url || process.env.QAIRA_LOCAL_RUN_ENGINE_URL || "http://host.docker.internal:4311";
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id)
    || {
      id: null,
      base_url: localEngineBaseUrl,
      config: {
        active_web_engine: "playwright",
        headless: false,
        video_mode: "retain-on-failure",
        trace_mode: "retain-on-failure"
      }
    };
  const dispatchSummary = await testEngineDispatchService.runExecutionDirectLocal({
    plan: dispatchPlan,
    integration,
    initiatedBy,
    engineBaseUrl: localEngineBaseUrl
  });

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "qaira.execution.local-start",
      summary: "Local execution started."
    });
  } catch {
    // OPS telemetry is best-effort and must not block local execution start.
  }

  return {
    started: true,
    execution_mode: "local",
    engine_base_url: localEngineBaseUrl,
    ...dispatchSummary
  };
};

exports.completeExecution = async (id, status) => {
  if (!["completed", "failed", "aborted"].includes(status)) {
    throw new Error("Invalid completion status");
  }

  const execution = await exports.getExecution(id);

  if (execution.status !== "running") {
    throw new Error("Only running executions can be completed");
  }

  await db.prepare(`
    UPDATE executions
    SET status = ?, ended_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, id);

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: id,
      source: "qaira.execution.complete",
      summary: `Execution ${status}.`
    });
  } catch {
    // OPS telemetry is best-effort and must not block execution completion.
  }

  return { completed: true };
};

exports.runExecutionApiStep = async (executionId, testCaseId, stepId, { executed_by } = {}) => {
  const execution = await exports.getExecution(executionId);

  if (execution.status !== "running") {
    throw new Error("Only running executions support API step execution");
  }

  const caseSnapshot = (execution.case_snapshots || []).find((snapshot) => snapshot.test_case_id === testCaseId);

  if (!caseSnapshot) {
    throw new Error("Execution test case not found");
  }

  const stepSnapshot = (execution.step_snapshots || []).find((snapshot) =>
    snapshot.test_case_id === testCaseId && snapshot.snapshot_step_id === stepId
  );

  if (!stepSnapshot) {
    throw new Error("Execution step not found");
  }

  const apiRequest = parseJsonValue(stepSnapshot.api_request, null);
  const resolvedStepType = stepSnapshot.step_type || (apiRequest ? "api" : "web");

  const existingResult = await executionResultService.findLatestExecutionResult({
    execution_id: executionId,
    test_case_id: testCaseId
  });
  const existingLogs = executionStepRuntimeService.parseStructuredLogs(existingResult?.logs || null);
  const currentCaseCapturedValues = executionStepRuntimeService.extractCapturedValuesFromLogs(existingLogs);
  const capturedValues = {
    ...collectSuiteScopedCapturedValues(execution, caseSnapshot, testCaseId),
    ...currentCaseCapturedValues
  };

  if (resolvedStepType === "web") {
    const testEngineIntegration = await integrationService.getActiveIntegrationByTypeForProject("testengine", execution.project_id);
    const queued = await testEngineDispatchService.queueSingleStepDispatch({
      execution,
      caseSnapshot,
      stepSnapshot,
      integration: testEngineIntegration,
      initiatedBy: executed_by || null,
      capturedValues,
      existingLogs
    });
    const queuedNote = `Queued web step ${stepSnapshot.step_order} for Test Engine execution with ${queued.active_web_engine || "the configured web engine"}. Open the provider live viewer while the engine reports step progress.`;
    const mergedLogs = {
      ...existingLogs,
      stepNotes: {
        ...existingLogs.stepNotes,
        [stepId]: queuedNote
      }
    };
    const result = await executionResultService.upsertExecutionResult({
      execution_id: executionId,
      test_case_id: testCaseId,
      app_type_id: execution.app_type_id,
      status: "running",
      duration_ms: resolveExecutionCaseDurationMs(execution, existingResult),
      error: null,
      logs: JSON.stringify(mergedLogs),
      executed_by: normalizeText(executed_by) || execution.assigned_to || null
    });

    try {
      await opsTelemetryService.emitExecutionHierarchyEvents({
        execution_id: executionId,
        test_case_id: testCaseId,
        step_id: stepId,
        source: "qaira.execution-console.web-step-queued",
        summary: queuedNote,
        execution_result_id: result.id,
        step_note: queuedNote,
        captures: capturedValues
      });
    } catch {
      // OPS telemetry is best-effort and must not block web step handoff.
    }

    return {
      execution_id: executionId,
      test_case_id: testCaseId,
      step_id: stepId,
      step_status: null,
      case_status: "running",
      execution_status: execution.status,
      note: queuedNote,
      detail: null,
      captures: capturedValues,
      execution_result_id: result.id,
      queued_for_engine: true,
      job_id: queued.job_id,
      engine_run_id: queued.engine_run_id,
      transaction_id: queued.transaction_id,
      active_web_engine: queued.active_web_engine,
      live_view_url: queued.live_view_url
    };
  }

  if (resolvedStepType !== "api" || !apiRequest) {
    throw new Error("Only API and web execution steps can be run through the execution console");
  }

  const parameterValues = buildExecutionRuntimeParameterValues(execution, caseSnapshot, capturedValues);
  const stepResult = await apiRequestExecutionService.executeApiRequestStep({
    api_request: apiRequest,
    parameter_values: parameterValues
  });
  const normalizedStepCaptures = executionStepRuntimeService.extractCapturedValuesFromLogs({
    stepCaptures: {
      [stepId]: stepResult.captures || {}
    }
  });
  const formattedStepNote = executionStepRuntimeService.formatApiStepEvidenceNote(stepResult);
  const mergedLogs = {
    ...existingLogs,
    stepStatuses: {
      ...existingLogs.stepStatuses,
      [stepId]: stepResult.status
    },
    stepNotes: {
      ...existingLogs.stepNotes,
      [stepId]: formattedStepNote
    },
    stepEvidence: {
      ...existingLogs.stepEvidence,
      ...(stepResult.evidence ? { [stepId]: stepResult.evidence } : {})
    },
    stepApiDetails: {
      ...existingLogs.stepApiDetails,
      [stepId]: stepResult.detail
    },
    stepCaptures: Object.keys(normalizedStepCaptures).length
      ? {
          ...existingLogs.stepCaptures,
          [stepId]: {
            ...(existingLogs.stepCaptures?.[stepId] || {}),
            ...normalizedStepCaptures
          }
        }
      : {
          ...existingLogs.stepCaptures
        }
  };
  const caseStepIds = (execution.step_snapshots || [])
    .filter((snapshot) => snapshot.test_case_id === testCaseId)
    .sort((left, right) => left.step_order - right.step_order)
    .map((snapshot) => snapshot.snapshot_step_id);
  const caseStatus = executionStepRuntimeService.deriveCaseStatusFromStepStatuses(
    caseStepIds,
    mergedLogs.stepStatuses
  );
  const result = await executionResultService.upsertExecutionResult({
    execution_id: executionId,
    test_case_id: testCaseId,
    app_type_id: execution.app_type_id,
    status: caseStatus,
    duration_ms: resolveExecutionCaseDurationMs(execution, existingResult),
    error: caseStatus === "failed" ? stepResult.note : null,
    logs: JSON.stringify(mergedLogs),
    executed_by: normalizeText(executed_by) || execution.assigned_to || null
  });

  await testEngineDispatchService.settleExecutionIfComplete(executionId);

  try {
    await opsTelemetryService.emitExecutionHierarchyEvents({
      execution_id: executionId,
      test_case_id: testCaseId,
      step_id: stepId,
      source: "qaira.execution-console",
      summary: formattedStepNote,
      execution_result_id: result.id,
      step_status: stepResult.status,
      step_note: formattedStepNote,
      step_detail: stepResult.detail,
      step_evidence: stepResult.evidence,
      captures: stepResult.captures
    });
  } catch {
    // OPS telemetry is best-effort and must not block API step execution.
  }

  const refreshedExecution = await selectExecutionRecord.get(executionId);

  return {
    execution_id: executionId,
    test_case_id: testCaseId,
    step_id: stepId,
    step_status: stepResult.status,
    case_status: caseStatus,
    execution_status: refreshedExecution?.status || execution.status,
    note: formattedStepNote,
    detail: stepResult.detail,
    captures: normalizedStepCaptures,
    execution_result_id: result.id
  };
};

exports.updateExecution = async (id, input = {}) => {
  if (!Object.prototype.hasOwnProperty.call(input, "assigned_to")) {
    throw new Error("assigned_to is required");
  }

  const execution = await selectExecutionRecord.get(id);

  if (!execution) {
    throw new Error("Execution not found");
  }

  const assignedTo = normalizeText(input.assigned_to);
  await validateExecutionAssignee(execution.project_id, assignedTo);
  await updateExecutionAssignment.run(assignedTo, id);

  return { updated: true };
};

exports.updateExecutionCaseAssignment = async (executionId, testCaseId, input = {}) => {
  if (!Object.prototype.hasOwnProperty.call(input, "assigned_to")) {
    throw new Error("assigned_to is required");
  }

  const execution = await selectExecutionRecord.get(executionId);

  if (!execution) {
    throw new Error("Execution not found");
  }

  const caseSnapshot = await selectExecutionCaseSnapshot.get(executionId, testCaseId);

  if (!caseSnapshot) {
    throw new Error("Execution test case not found");
  }

  const assignedTo = normalizeText(input.assigned_to);
  await validateExecutionAssignee(execution.project_id, assignedTo);
  await updateExecutionCaseAssignment.run(assignedTo, executionId, testCaseId);

  return { updated: true };
};

exports.deleteExecution = async (id) => {
  await exports.getExecution(id);

  const used = await db.prepare(`
    SELECT id FROM execution_results WHERE execution_id = ?
  `).get(id);

  if (used) {
    throw new Error("Cannot delete execution with results");
  }

  await db.prepare(`DELETE FROM execution_step_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_case_snapshots WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM execution_suites WHERE execution_id = ?`).run(id);
  await db.prepare(`DELETE FROM executions WHERE id = ?`).run(id);

  return { deleted: true };
};
