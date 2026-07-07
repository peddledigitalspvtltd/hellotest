const db = require("../db");
const { v4: uuid } = require("uuid");
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

exports.createIteration = async ({ project_id, name, description, requirement_ids = [], created_by } = {}) => {
  const project = await ensureProjectExists(project_id);
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    throw new Error("Iteration name is required");
  }

  const requirementIds = normalizeTextList(requirement_ids);
  await ensureRequirementsMatchProject(requirementIds, project.id);

  const id = uuid();
  const displayId = await displayIdService.createDisplayId("requirement_iteration");
  const actorId = normalizeText(created_by);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO requirement_iterations (id, display_id, project_id, name, description, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, displayId, project.id, normalizedName, normalizeText(description), actorId, actorId);

    for (const requirementId of requirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, requirementId);
    }
  });

  await transaction();

  return { id };
};

exports.updateIteration = async (id, data = {}) => {
  const existing = await exports.getIteration(id);
  const nextName = data.name !== undefined ? normalizeText(data.name) : existing.name;

  if (!nextName) {
    throw new Error("Iteration name is required");
  }

  const requirementIds = data.requirement_ids !== undefined ? normalizeTextList(data.requirement_ids) : null;

  if (requirementIds) {
    await ensureRequirementsMatchProject(requirementIds, existing.project_id);
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE requirement_iterations
      SET name = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextName,
      data.description !== undefined ? normalizeText(data.description) : existing.description,
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

  return { updated: true };
};

exports.assignRequirements = async (id, requirementIds = [], { append = true } = {}) => {
  const iteration = await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);
  await ensureRequirementsMatchProject(normalizedRequirementIds, iteration.project_id);

  const transaction = db.transaction(async () => {
    if (!append) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE iteration_id = ?
      `).run(id);
    }

    for (const requirementId of normalizedRequirementIds) {
      await db.prepare(`
        UPDATE requirements
        SET iteration_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id, requirementId);
    }
  });

  await transaction();

  return { updated: true, assigned: normalizedRequirementIds.length };
};

exports.removeRequirements = async (id, requirementIds = []) => {
  await exports.getIteration(id);
  const normalizedRequirementIds = normalizeTextList(requirementIds);

  if (!normalizedRequirementIds.length) {
    return { updated: true, removed: 0 };
  }

  await db.prepare(`
    UPDATE requirements
    SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE iteration_id = ? AND id IN (${normalizedRequirementIds.map(() => "?").join(",")})
  `).run(id, ...normalizedRequirementIds);

  return { updated: true, removed: normalizedRequirementIds.length };
};

exports.deleteIteration = async (id) => {
  await exports.getIteration(id);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE requirements
      SET iteration_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE iteration_id = ?
    `).run(id);

    await db.prepare(`
      DELETE FROM requirement_iterations
      WHERE id = ?
    `).run(id);
  });

  await transaction();

  return { deleted: true };
};
