const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");

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
  return parsed.toISOString();
};

const validateDateRange = (startDate, endDate) => {
  if (startDate && endDate && endDate <= startDate) throw new Error("Iteration end date must be after its start date");
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
  return Promise.all(rows.map((row) => hydrateIteration(row)));
};

exports.getIteration = async (id) => {
  const iteration = await selectIteration.get(id);

  if (!iteration) {
    throw new Error("Iteration not found");
  }

  return hydrateIteration(iteration);
};

exports.listRequirements = async (id, { limit } = {}) => {
  await exports.getIteration(id);
  const boundedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 10000) : null;
  return db.prepare(`
    SELECT requirements.*
    FROM requirements
    WHERE requirements.iteration_id = ?
    ORDER BY COALESCE(requirements.updated_at, requirements.created_at) DESC, requirements.title ASC
    ${boundedLimit ? "LIMIT ?" : ""}
  `).all(...(boundedLimit ? [id, boundedLimit] : [id]));
};

exports.createIteration = async ({ project_id, name, description, goal, labels, external_references, state, start_date, end_date, requirement_ids = [], created_by } = {}) => {
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

  const id = uuid();
  const displayId = await displayIdService.createDisplayId("requirement_iteration");
  const actorId = normalizeText(created_by);
  const startDate = normalizeDate(start_date);
  const endDate = normalizeDate(end_date);
  validateDateRange(startDate, endDate);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO requirement_iterations (id, display_id, project_id, name, description, goal, labels, external_references, state, start_date, end_date, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      displayId,
      project.id,
      normalizedName,
      normalizeText(description),
      normalizeText(goal) || normalizeText(description),
      JSON.stringify(normalizeTextList(labels)),
      JSON.stringify(normalizeTextList(external_references)),
      normalizeState(state),
      startDate,
      endDate,
      actorId,
      actorId
    );

    for (const requirementId of requirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, requirementId);
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

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE requirement_iterations
      SET name = ?, description = ?, goal = ?, labels = ?, external_references = ?, state = ?, start_date = ?, end_date = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextName,
      data.description !== undefined ? normalizeText(data.description) : existing.description,
      data.goal !== undefined ? normalizeText(data.goal) : existing.goal,
      data.labels !== undefined ? JSON.stringify(normalizeTextList(data.labels)) : JSON.stringify(existing.labels || []),
      data.external_references !== undefined ? JSON.stringify(normalizeTextList(data.external_references)) : JSON.stringify(existing.external_references || []),
      data.state !== undefined ? normalizeState(data.state, existing.state) : normalizeState(existing.state),
      startDate,
      endDate,
      normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null,
      id
    );

    if (requirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(id);

      for (const requirementId of requirementIds) {
        await db.prepare(`
          UPDATE requirements
          SET iteration_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(id, requirementId);
      }
    }
  });

  await transaction();

  return { updated: true, sprint: await exports.getIteration(id) };
};

exports.assignRequirements = async (id, requirementIds = [], { append = true } = {}) => {
  const iteration = await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);
  await ensureRequirementsMatchProject(normalizedRequirementIds, iteration.project_id);

  let assigned = 0;
  const transaction = db.transaction(async () => {
    if (!append) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(id);
    }

    for (const requirementId of normalizedRequirementIds) {
      const result = await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, requirementId);
      assigned += result.changes || 0;
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
  await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);

  if (!normalizedRequirementIds.length) {
    return { updated: true, removed: 0 };
  }

  const result = await db.prepare(`
    UPDATE requirements
    SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE iteration_id = ? AND id IN (${normalizedRequirementIds.map(() => "?").join(",")})
  `).run(id, ...normalizedRequirementIds);

  return { updated: true, removed: result.changes || 0 };
};

exports.deleteIteration = async (id) => {
  await exports.getIteration(id);

  let unassigned = 0;
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE requirements
      SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE iteration_id = ?
    `).run(id);
    unassigned = result.changes || 0;

    await db.prepare(`
      DELETE FROM requirement_iterations
      WHERE id = ?
    `).run(id);
  });

  await transaction();

  return { deleted: true, id, unassigned };
};
