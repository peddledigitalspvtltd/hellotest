const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");
const requirementReleaseService = require("./requirementRelease.service");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeTextList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))];

const normalizeState = (value, fallback = "future") => {
  const state = normalizeText(value) || fallback;
  if (!["future", "active", "closed"].includes(state)) throw new Error("Invalid iteration state");
  return state;
};

const normalizeDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid iteration date");
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toISOString();
};

const normalizeEffortPoints = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const points = Number(value);
  if (![1, 2, 3, 5, 8, 13, 21].includes(points)) throw new Error("Sprint effort must use Fibonacci Story points");
  return points;
};

const validateDateRange = (startDate, endDate) => {
  if (startDate && endDate && endDate <= startDate) throw new Error("Iteration end date must be after its start date");
};

const COMPLETED_STORY_STATUSES = ["qa_done", "qa done", "done", "closed", "resolved", "accepted", "complete", "completed"];

const ensureSprintStoriesComplete = async (iteration, requirementIds = null) => {
  const effectiveRequirementIds = Array.isArray(requirementIds) ? requirementIds : null;
  const incomplete = effectiveRequirementIds && !effectiveRequirementIds.length ? [] : await db.prepare(`
    SELECT id, display_id, title, status
    FROM requirements
    WHERE ${effectiveRequirementIds ? `id IN (${effectiveRequirementIds.map(() => "?").join(",")})` : "iteration_id = ?"}
      AND LOWER(TRIM(COALESCE(status, ''))) NOT IN (${COMPLETED_STORY_STATUSES.map(() => "?").join(",")})
    ORDER BY COALESCE(updated_at, created_at) DESC, title ASC
  `).all(...(effectiveRequirementIds || [iteration.id]), ...COMPLETED_STORY_STATUSES);
  if (!incomplete.length) return;
  const error = new Error(`Sprint “${iteration.name}” cannot be completed because ${incomplete.length} ${incomplete.length === 1 ? "Story is" : "Stories are"} unfinished. Move every Story to QA Done, Done, Resolved, Accepted, or Closed, then try again.`);
  error.statusCode = 409;
  error.code = "DELIVERY_STORIES_INCOMPLETE";
  throw error;
};

const selectProject = db.prepare(`
  SELECT id
  FROM projects
  WHERE id = ?
`);

const selectIteration = db.prepare(`
  SELECT *
  FROM requirement_iterations
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, project_id
  FROM requirements
  WHERE id = ?
`);

const hydrateIteration = async (iteration) => {
  if (!iteration) {
    return iteration;
  }

  const requirementIds = await db.prepare(`
    SELECT id
    FROM requirements
    WHERE iteration_id = ?
    ORDER BY COALESCE(updated_at, created_at) DESC, title ASC
  `).all(iteration.id);

  return {
    ...iteration,
    requirement_ids: requirementIds.map((row) => row.id),
    requirement_count: requirementIds.length
  };
};

const ensureProjectExists = async (projectId) => {
  const resolvedProjectId = normalizeText(projectId);

  if (!resolvedProjectId) {
    throw new Error("project_id is required");
  }

  const project = await selectProject.get(resolvedProjectId);

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
};

const ensureRequirementsMatchProject = async (requirementIds, projectId) => {
  for (const requirementId of requirementIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    if (requirement.project_id !== projectId) {
      throw new Error("Requirement must belong to the same project as the iteration");
    }
  }
};

exports.listIterations = async ({ project_id } = {}) => {
  let query = `
    SELECT requirement_iterations.*, COUNT(requirements.id)::INTEGER AS requirement_count
    FROM requirement_iterations
    LEFT JOIN requirements ON requirements.iteration_id = requirement_iterations.id
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += ` AND requirement_iterations.project_id = ?`;
    params.push(project_id);
  }

  query += `
    GROUP BY requirement_iterations.id
    ORDER BY COALESCE(requirement_iterations.updated_at, requirement_iterations.created_at) DESC, requirement_iterations.name ASC
  `;

  const rows = await db.prepare(query).all(...params);
  return rows;
};

exports.getIterationSummary = async (id) => {
  const iteration = await selectIteration.get(id);
  if (!iteration) throw new Error("Iteration not found");
  return iteration;
};

exports.getIteration = async (id) => {
  const iteration = await selectIteration.get(id);

  if (!iteration) {
    throw new Error("Iteration not found");
  }

  return hydrateIteration(iteration);
};

exports.listRequirements = async (id, { limit, projection } = {}) => {
  const iteration = await exports.getIterationSummary(id);
  const boundedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 10000) : null;
  return db.prepare(`
    SELECT ${projection === "health" ? "id, status, priority, dev_completion_target_date, qa_completion_target_date" : "requirements.*"}
    FROM requirements
    WHERE requirements.iteration_id = ? AND requirements.project_id = ?
    ORDER BY COALESCE(requirements.updated_at, requirements.created_at) DESC, requirements.title ASC
    ${boundedLimit ? "LIMIT ?" : ""}
  `).all(...(boundedLimit ? [id, iteration.project_id, boundedLimit] : [id, iteration.project_id]));
};

exports.createIteration = async ({ project_id, name, description, goal, labels, external_references, state, start_date, end_date, assignee_id, effort_points, original_dev_id, original_qa_id, requirement_ids = [], created_by } = {}) => {
  const project = await ensureProjectExists(project_id);
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    throw new Error("Iteration name is required");
  }

  const duplicate = await db.prepare(`
    SELECT id FROM requirement_iterations
    WHERE project_id = ? AND LOWER(name) = LOWER(?)
    LIMIT 1
  `).get(project.id, normalizedName);
  if (duplicate) throw new Error("A Sprint with this name already exists in the project");

  const requirementIds = normalizeTextList(requirement_ids);
  await ensureRequirementsMatchProject(requirementIds, project.id);
  const previousSprintRows = requirementIds.length ? await db.prepare(`
    SELECT DISTINCT iteration_id
    FROM requirements
    WHERE id IN (${requirementIds.map(() => "?").join(",")})
      AND iteration_id IS NOT NULL
  `).all(...requirementIds) : [];

  const id = uuid();
  const displayId = await displayIdService.createDisplayId("requirement_iteration");
  const actorId = normalizeText(created_by);
  const startDate = normalizeDate(start_date);
  const endDate = normalizeDate(end_date);
  validateDateRange(startDate, endDate);
  const nextState = normalizeState(state);

  const transaction = db.transaction(async () => {
    if (nextState === "closed") {
      await ensureSprintStoriesComplete({ id, name: normalizedName }, requirementIds);
    }
    await db.prepare(`
      INSERT INTO requirement_iterations (id, display_id, project_id, name, description, goal, labels, external_references, state, start_date, end_date, assignee_id, effort_points, original_dev_id, original_qa_id, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      displayId,
      project.id,
      normalizedName,
      normalizeText(description),
      normalizeText(goal) || normalizeText(description),
      JSON.stringify(normalizeTextList(labels)),
      JSON.stringify(normalizeTextList(external_references)),
      nextState,
      startDate,
      endDate,
      normalizeText(assignee_id),
      normalizeEffortPoints(effort_points),
      normalizeText(original_dev_id),
      normalizeText(original_qa_id),
      actorId,
      actorId
    );

    for (const requirementId of requirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, sprint = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, normalizedName, requirementId);
    }
    for (const sprintId of previousSprintRows.map((row) => row.iteration_id)) {
      await requirementReleaseService.syncSprintMembership(sprintId, { updated_by: created_by });
    }
  });

  await transaction();

  const sprint = await exports.getIteration(id);
  const assignedRows = requirementIds.length ? await db.prepare(`
    SELECT id, display_id
    FROM requirements
    WHERE iteration_id = ? AND id IN (${requirementIds.map(() => "?").join(",")})
    ORDER BY id ASC
  `).all(id, ...requirementIds) : [];

  return {
    id,
    sprint,
    assignment: requirementIds.length ? {
      assigned: assignedRows.length,
      assigned_issue_ids: assignedRows.map((row) => row.id),
      assigned_issue_keys: assignedRows.map((row) => row.display_id || row.id)
    } : null
  };
};

exports.updateIteration = async (id, data = {}) => {
  const existing = await exports.getIteration(id);
  const nextName = data.name !== undefined ? normalizeText(data.name) : existing.name;
  const nextState = data.state !== undefined ? normalizeState(data.state, existing.state) : normalizeState(existing.state);

  if (!nextName) {
    throw new Error("Iteration name is required");
  }

  const duplicate = await db.prepare(`
    SELECT id FROM requirement_iterations
    WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id != ?
    LIMIT 1
  `).get(existing.project_id, nextName, id);
  if (duplicate) throw new Error("A Sprint with this name already exists in the project");

  const requirementIds = data.requirement_ids !== undefined ? normalizeTextList(data.requirement_ids) : null;
  const startDate = data.start_date !== undefined ? normalizeDate(data.start_date) : existing.start_date;
  const endDate = data.end_date !== undefined ? normalizeDate(data.end_date) : existing.end_date;
  validateDateRange(startDate, endDate);

  if (requirementIds) {
    await ensureRequirementsMatchProject(requirementIds, existing.project_id);
  }
  const previousSprintRows = requirementIds?.length ? await db.prepare(`
    SELECT DISTINCT iteration_id
    FROM requirements
    WHERE id IN (${requirementIds.map(() => "?").join(",")})
      AND iteration_id IS NOT NULL
      AND iteration_id != ?
  `).all(...requirementIds, id) : [];

  if (nextState === "closed" && (normalizeState(existing.state) !== "closed" || requirementIds !== null)) {
    await ensureSprintStoriesComplete(existing, requirementIds);
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE requirement_iterations
      SET name = ?, description = ?, goal = ?, labels = ?, external_references = ?, state = ?, start_date = ?, end_date = ?, assignee_id = ?, effort_points = ?, original_dev_id = ?, original_qa_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextName,
      data.description !== undefined ? normalizeText(data.description) : existing.description,
      data.goal !== undefined ? normalizeText(data.goal) : existing.goal,
      data.labels !== undefined ? JSON.stringify(normalizeTextList(data.labels)) : JSON.stringify(existing.labels || []),
      data.external_references !== undefined ? JSON.stringify(normalizeTextList(data.external_references)) : JSON.stringify(existing.external_references || []),
      nextState,
      startDate,
      endDate,
      data.assignee_id !== undefined ? normalizeText(data.assignee_id) : existing.assignee_id,
      data.effort_points !== undefined ? normalizeEffortPoints(data.effort_points) : existing.effort_points,
      data.original_dev_id !== undefined ? normalizeText(data.original_dev_id) : existing.original_dev_id,
      data.original_qa_id !== undefined ? normalizeText(data.original_qa_id) : existing.original_qa_id,
      normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null,
      id
    );

    if (requirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = NULL,
            sprint = CASE WHEN sprint IN (?, ?) THEN NULL ELSE sprint END,
            updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(existing.name, nextName, id);

      for (const requirementId of requirementIds) {
        await db.prepare(`
          UPDATE requirements
          SET iteration_id = ?, sprint = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(id, nextName, requirementId);
      }
      for (const sprintId of [id, ...previousSprintRows.map((row) => row.iteration_id)]) {
        await requirementReleaseService.syncSprintMembership(sprintId, { updated_by: data.updated_by });
      }
    } else if (nextName !== existing.name) {
      await db.prepare(`
        UPDATE requirements
        SET sprint = ?, updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(nextName, id);
    }
  });

  await transaction();

  return { updated: true, sprint: await exports.getIteration(id) };
};

exports.assignRequirements = async (id, requirementIds = [], { append = true } = {}) => {
  const iteration = await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);
  await ensureRequirementsMatchProject(normalizedRequirementIds, iteration.project_id);
  const previousSprintRows = normalizedRequirementIds.length ? await db.prepare(`
    SELECT DISTINCT iteration_id
    FROM requirements
    WHERE id IN (${normalizedRequirementIds.map(() => "?").join(",")})
      AND iteration_id IS NOT NULL
      AND iteration_id != ?
  `).all(...normalizedRequirementIds, id) : [];

  let assigned = 0;
  const transaction = db.transaction(async () => {
    if (!append) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = NULL,
            sprint = CASE WHEN sprint = ? THEN NULL ELSE sprint END,
            updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(iteration.name, id);
    }

    for (const requirementId of normalizedRequirementIds) {
      const result = await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, sprint = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, iteration.name, requirementId);
      assigned += result.changes || 0;
    }
    for (const sprintId of [id, ...previousSprintRows.map((row) => row.iteration_id)]) {
      await requirementReleaseService.syncSprintMembership(sprintId);
    }
  });

  await transaction();

  const assignedRows = normalizedRequirementIds.length ? await db.prepare(`
    SELECT id, display_id
    FROM requirements
    WHERE iteration_id = ? AND id IN (${normalizedRequirementIds.map(() => "?").join(",")})
    ORDER BY id ASC
  `).all(id, ...normalizedRequirementIds) : [];
  return {
    updated: true,
    assigned: assignedRows.length || assigned,
    total: (await exports.getIteration(id)).requirement_count,
    assigned_issue_ids: assignedRows.map((row) => row.id),
    assigned_issue_keys: assignedRows.map((row) => row.display_id || row.id),
    sprint: await exports.getIteration(id)
  };
};

exports.removeRequirements = async (id, requirementIds = []) => {
  const iteration = await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);

  if (!normalizedRequirementIds.length) {
    return { updated: true, removed: 0 };
  }

  let removed = 0;
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE requirements
      SET iteration_id = NULL,
          sprint = CASE WHEN sprint = ? THEN NULL ELSE sprint END,
          updated_at = CURRENT_TIMESTAMP
      WHERE iteration_id = ? AND id IN (${normalizedRequirementIds.map(() => "?").join(",")})
    `).run(iteration.name, id, ...normalizedRequirementIds);
    removed = result.changes || 0;
    await requirementReleaseService.syncSprintMembership(id);
  });
  await transaction();

  return { updated: true, removed };
};

exports.deleteIteration = async (id) => {
  const iteration = await exports.getIteration(id);

  let unassigned = 0;
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE requirements
      SET iteration_id = NULL,
          sprint = CASE WHEN sprint = ? THEN NULL ELSE sprint END,
          updated_at = CURRENT_TIMESTAMP
      WHERE iteration_id = ?
    `).run(iteration.name, id);
    unassigned = result.changes || 0;

    await requirementReleaseService.syncSprintMembership(id, { remove: true });

    await db.prepare(`
      DELETE FROM requirement_iterations
      WHERE id = ?
    `).run(id);
  });

  await transaction();

  return { deleted: true, id, unassigned };
};
