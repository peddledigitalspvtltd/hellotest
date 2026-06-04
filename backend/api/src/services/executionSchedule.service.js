const db = require("../db");
const { v4: uuid } = require("uuid");
const executionService = require("./execution.service");

const selectProject = db.prepare(`
  SELECT id
  FROM projects
  WHERE id = ?
`);

const selectUser = db.prepare(`
  SELECT id, email, name, avatar_data_url
  FROM users
  WHERE id = ?
`);

const selectProjectMember = db.prepare(`
  SELECT id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

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

const selectTestCase = db.prepare(`
  SELECT id, app_type_id
  FROM test_cases
  WHERE id = ?
`);

const selectExecutionSchedule = db.prepare(`
  SELECT *
  FROM execution_schedules
  WHERE id = ?
`);

const insertExecutionSchedule = db.prepare(`
  INSERT INTO execution_schedules (
    id,
    project_id,
    app_type_id,
    name,
    cadence,
    next_run_at,
    suite_ids,
    test_case_ids,
    test_environment_id,
    test_configuration_id,
    test_data_set_id,
    assigned_to,
    created_by,
    is_active
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateExecutionSchedule = db.prepare(`
  UPDATE execution_schedules
  SET project_id = ?,
      app_type_id = ?,
      name = ?,
      cadence = ?,
      next_run_at = ?,
      suite_ids = ?,
      test_case_ids = ?,
      test_environment_id = ?,
      test_configuration_id = ?,
      test_data_set_id = ?,
      assigned_to = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateExecutionScheduleRun = db.prepare(`
  UPDATE execution_schedules
  SET last_run_at = CURRENT_TIMESTAMP, next_run_at = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteExecutionSchedule = db.prepare(`
  DELETE FROM execution_schedules
  WHERE id = ?
`);

const selectDueExecutionSchedules = db.prepare(`
  SELECT id
  FROM execution_schedules
  WHERE is_active = TRUE
    AND next_run_at IS NOT NULL
    AND next_run_at <= CURRENT_TIMESTAMP
  ORDER BY next_run_at ASC, created_at ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeTextList = (values = []) => [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];

const parseJsonValue = (value, fallback) => {
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

function addCadence(dateValue, cadence) {
  if (!dateValue) {
    return null;
  }

  const baseDate = new Date(dateValue);

  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  if (cadence === "daily") {
    baseDate.setDate(baseDate.getDate() + 1);
    return baseDate.toISOString();
  }

  if (cadence === "weekly") {
    baseDate.setDate(baseDate.getDate() + 7);
    return baseDate.toISOString();
  }

  if (cadence === "monthly") {
    baseDate.setMonth(baseDate.getMonth() + 1);
    return baseDate.toISOString();
  }

  const intervalMatch = String(cadence || "").match(/^every:(\d+):minutes$/);
  if (intervalMatch) {
    baseDate.setMinutes(baseDate.getMinutes() + Math.max(1, Number(intervalMatch[1]) || 5));
    return baseDate.toISOString();
  }

  return null;
}

async function hydrateSchedule(schedule) {
  if (!schedule) {
    return schedule;
  }

  const assignedUser = schedule.assigned_to ? await selectUser.get(schedule.assigned_to) : null;

  return {
    ...schedule,
    suite_ids: parseJsonValue(schedule.suite_ids, []),
    test_case_ids: parseJsonValue(schedule.test_case_ids, []),
    is_active: Boolean(schedule.is_active),
    assigned_user: assignedUser
      ? {
          id: assignedUser.id,
          email: assignedUser.email,
          name: assignedUser.name || null,
          avatar_data_url: assignedUser.avatar_data_url || null
        }
      : null
  };
}

async function validateSchedulePayload({
  project_id,
  app_type_id,
  suite_ids = [],
  test_case_ids = [],
  assigned_to,
  created_by
}) {
  if (!project_id || !created_by) {
    throw new Error("project_id and created_by are required");
  }

  const project = await selectProject.get(project_id);

  if (!project) {
    throw new Error("Project not found");
  }

  const creator = await selectUser.get(created_by);

  if (!creator) {
    throw new Error("Invalid user");
  }

  if (assigned_to) {
    const assignedUser = await selectUser.get(assigned_to);

    if (!assignedUser) {
      throw new Error("Assigned user not found");
    }

    const membership = await selectProjectMember.get(project_id, assigned_to);

    if (!membership) {
      throw new Error("Assigned user must belong to the selected project");
    }
  }

  if (app_type_id) {
    const appType = await selectAppType.get(app_type_id);

    if (!appType) {
      throw new Error("App type not found");
    }

    if (appType.project_id !== project_id) {
      throw new Error("App type must belong to the selected project");
    }
  }

  for (const suiteId of normalizeTextList(suite_ids)) {
    const suite = await selectSuite.get(suiteId);

    if (!suite) {
      throw new Error(`Suite not found: ${suiteId}`);
    }

    if (app_type_id && suite.app_type_id !== app_type_id) {
      throw new Error("All suites must belong to the selected app type");
    }
  }

  for (const testCaseId of normalizeTextList(test_case_ids)) {
    const testCase = await selectTestCase.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (app_type_id && testCase.app_type_id !== app_type_id) {
      throw new Error("All test cases must belong to the selected app type");
    }
  }
}

exports.createExecutionSchedule = async (input = {}) => {
  await validateSchedulePayload(input);

  const id = uuid();
  const suiteIds = normalizeTextList(input.suite_ids);
  const testCaseIds = normalizeTextList(input.test_case_ids);
  const cadence = normalizeText(input.cadence) || "once";
  const nextRunAt = normalizeText(input.next_run_at);

  await insertExecutionSchedule.run(
    id,
    input.project_id,
    normalizeText(input.app_type_id),
    normalizeText(input.name) || "Scheduled Execution",
    cadence,
    nextRunAt,
    suiteIds,
    testCaseIds,
    normalizeText(input.test_environment_id),
    normalizeText(input.test_configuration_id),
    normalizeText(input.test_data_set_id),
    normalizeText(input.assigned_to),
    input.created_by,
    input.is_active === false ? false : true
  );

  return { id };
};

exports.updateExecutionSchedule = async (id, input = {}, actorId = null) => {
  const existing = await exports.getExecutionSchedule(id);
  const payload = {
    project_id: Object.prototype.hasOwnProperty.call(input, "project_id") ? normalizeText(input.project_id) : existing.project_id,
    app_type_id: Object.prototype.hasOwnProperty.call(input, "app_type_id") ? normalizeText(input.app_type_id) : existing.app_type_id,
    suite_ids: Object.prototype.hasOwnProperty.call(input, "suite_ids") ? input.suite_ids : existing.suite_ids,
    test_case_ids: Object.prototype.hasOwnProperty.call(input, "test_case_ids") ? input.test_case_ids : existing.test_case_ids,
    assigned_to: Object.prototype.hasOwnProperty.call(input, "assigned_to") ? normalizeText(input.assigned_to) : existing.assigned_to,
    created_by: actorId || existing.created_by
  };

  await validateSchedulePayload(payload);

  const suiteIds = normalizeTextList(payload.suite_ids);
  const testCaseIds = normalizeTextList(payload.test_case_ids);

  await updateExecutionSchedule.run(
    payload.project_id,
    payload.app_type_id,
    Object.prototype.hasOwnProperty.call(input, "name") ? normalizeText(input.name) || "Scheduled Execution" : normalizeText(existing.name) || "Scheduled Execution",
    Object.prototype.hasOwnProperty.call(input, "cadence") ? normalizeText(input.cadence) || "once" : normalizeText(existing.cadence) || "once",
    Object.prototype.hasOwnProperty.call(input, "next_run_at") ? normalizeText(input.next_run_at) : existing.next_run_at,
    suiteIds,
    testCaseIds,
    Object.prototype.hasOwnProperty.call(input, "test_environment_id") ? normalizeText(input.test_environment_id) : existing.test_environment_id,
    Object.prototype.hasOwnProperty.call(input, "test_configuration_id") ? normalizeText(input.test_configuration_id) : existing.test_configuration_id,
    Object.prototype.hasOwnProperty.call(input, "test_data_set_id") ? normalizeText(input.test_data_set_id) : existing.test_data_set_id,
    payload.assigned_to,
    id
  );

  return { updated: true };
};

exports.getExecutionSchedules = async ({ project_id, app_type_id, is_active } = {}) => {
  let query = `
    SELECT *
    FROM execution_schedules
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (typeof is_active === "boolean") {
    query += ` AND is_active = ?`;
    params.push(is_active);
  }

  query += ` ORDER BY next_run_at ASC NULLS LAST, created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateSchedule));
};

exports.getExecutionSchedule = async (id) => {
  const schedule = await selectExecutionSchedule.get(id);

  if (!schedule) {
    throw new Error("Execution schedule not found");
  }

  return hydrateSchedule(schedule);
};

exports.runExecutionSchedule = async (id, created_by) => {
  const schedule = await exports.getExecutionSchedule(id);

  if (!schedule.is_active) {
    throw new Error("This execution schedule is inactive.");
  }

  const response = await executionService.createExecution({
    project_id: schedule.project_id,
    app_type_id: schedule.app_type_id,
    suite_ids: schedule.suite_ids || [],
    test_case_ids: schedule.test_case_ids || [],
    test_environment_id: schedule.test_environment_id || undefined,
    test_configuration_id: schedule.test_configuration_id || undefined,
    test_data_set_id: schedule.test_data_set_id || undefined,
    assigned_to: schedule.assigned_to || undefined,
    name: `${schedule.name} Run`,
    trigger: "ci",
    execution_mode: "remote",
    created_by: created_by || schedule.created_by
  });

  const nextRunAt = addCadence(schedule.next_run_at || new Date().toISOString(), schedule.cadence);
  const remainsActive = schedule.cadence !== "once";

  await updateExecutionScheduleRun.run(nextRunAt, remainsActive, id);

  return response;
};

exports.deleteExecutionSchedule = async (id) => {
  await exports.getExecutionSchedule(id);
  await deleteExecutionSchedule.run(id);
  return { deleted: true };
};

exports.processDueSchedules = async () => {
  const dueSchedules = await selectDueExecutionSchedules.all();

  for (const schedule of dueSchedules) {
    await exports.runExecutionSchedule(schedule.id);
  }

  return dueSchedules.length;
};
