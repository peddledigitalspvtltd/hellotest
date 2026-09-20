const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeTextList = (values = []) => {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))];
};

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const selectModule = db.prepare(`
  SELECT *
  FROM test_case_modules
  WHERE id = ?
`);

const selectCase = db.prepare(`
  SELECT id, app_type_id
  FROM test_cases
  WHERE id = ?
`);

const selectRequirement = db.prepare(`
  SELECT id, project_id
  FROM requirements
  WHERE id = ?
`);

const selectModuleCaseIds = db.prepare(`
  SELECT test_case_id
  FROM test_case_effective_module_cases
  WHERE module_id = ?
  ORDER BY sort_order ASC, test_case_id ASC
`);

const selectModuleRequirementIds = db.prepare(`
  SELECT requirement_id
  FROM test_case_module_requirements
  WHERE module_id = ?
  ORDER BY sort_order ASC, requirement_id ASC
`);

const deleteModuleCases = db.prepare(`
  DELETE FROM test_case_module_cases
  WHERE module_id = ?
`);

const deleteModuleRequirements = db.prepare(`
  DELETE FROM test_case_module_requirements
  WHERE module_id = ?
`);

const deleteCaseModuleMembership = db.prepare(`
  DELETE FROM test_case_module_cases
  WHERE test_case_id = ?
`);

const insertModuleCase = db.prepare(`
  INSERT INTO test_case_module_cases (module_id, test_case_id, sort_order)
  VALUES (?, ?, ?)
  ON CONFLICT (test_case_id) DO UPDATE
  SET module_id = EXCLUDED.module_id,
      sort_order = EXCLUDED.sort_order
`);

const insertModuleRequirement = db.prepare(`
  INSERT INTO test_case_module_requirements (module_id, requirement_id, sort_order)
  VALUES (?, ?, ?)
  ON CONFLICT (module_id, requirement_id) DO UPDATE
  SET sort_order = EXCLUDED.sort_order
`);

const hydrateModule = async (module) => {
  if (!module) {
    return module;
  }

  const [caseRows, requirementRows] = await Promise.all([
    selectModuleCaseIds.all(module.id),
    selectModuleRequirementIds.all(module.id)
  ]);

  return {
    ...module,
    test_case_ids: caseRows.map((row) => row.test_case_id),
    requirement_ids: requirementRows.map((row) => row.requirement_id)
  };
};

const parseStoredIds = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hydrateModuleListRow = (module) => ({
  ...module,
  test_case_ids: parseStoredIds(module.test_case_ids),
  requirement_ids: parseStoredIds(module.requirement_ids)
});

const ensureAppTypeExists = async (appTypeId) => {
  const resolvedAppTypeId = normalizeText(appTypeId);

  if (!resolvedAppTypeId) {
    throw new Error("app_type_id is required");
  }

  const appType = await selectAppType.get(resolvedAppTypeId);

  if (!appType) {
    throw new Error("App type not found");
  }

  return appType;
};

const ensureCasesMatchAppType = async (caseIds, appTypeId) => {
  for (const testCaseId of caseIds) {
    const testCase = await selectCase.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (testCase.app_type_id && testCase.app_type_id !== appTypeId) {
      throw new Error("Test case must belong to the same app type as the module");
    }
  }
};

const ensureRequirementsMatchProject = async (requirementIds, projectId) => {
  for (const requirementId of requirementIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    if (requirement.project_id !== projectId) {
      throw new Error("Requirement must belong to the same project as the module");
    }
  }
};

exports.listModules = async ({ app_type_id, project_id, projection } = {}) => {
  let query = `
    SELECT
      test_case_modules.*,
      COUNT(test_case_effective_module_cases.test_case_id)::INTEGER AS test_case_count,
      ${projection === "summary" ? "'[]'::jsonb" : `COALESCE(
        jsonb_agg(test_case_effective_module_cases.test_case_id ORDER BY test_case_effective_module_cases.sort_order ASC)
          FILTER (WHERE test_case_effective_module_cases.test_case_id IS NOT NULL),
        '[]'::jsonb
      )`} AS test_case_ids,
      COALESCE(
        (
          SELECT jsonb_agg(
            test_case_module_requirements.requirement_id
            ORDER BY test_case_module_requirements.sort_order ASC, test_case_module_requirements.requirement_id ASC
          )
          FROM test_case_module_requirements
          WHERE test_case_module_requirements.module_id = test_case_modules.id
        ),
        '[]'::jsonb
      ) AS requirement_ids
    FROM test_case_modules
    LEFT JOIN test_case_effective_module_cases ON test_case_effective_module_cases.module_id = test_case_modules.id
    WHERE 1 = 1
  `;
  const params = [];

  if (app_type_id) {
    query += ` AND test_case_modules.app_type_id = ?`;
    params.push(app_type_id);
  }

  if (project_id) {
    query += ` AND test_case_modules.app_type_id IN (SELECT id FROM app_types WHERE project_id = ?)`;
    params.push(project_id);
  }

  query += `
    GROUP BY test_case_modules.id
    ORDER BY COALESCE(test_case_modules.updated_at, test_case_modules.created_at) DESC, test_case_modules.name ASC
  `;

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateModuleListRow);
};

exports.getModule = async (id, { summary = false } = {}) => {
  const module = await selectModule.get(id);

  if (!module) {
    throw new Error("Module not found");
  }

  return summary ? module : hydrateModule(module);
};

exports.getModuleCases = async (moduleId) => {
  await exports.getModule(moduleId);

  const rows = await db.prepare(`
    SELECT test_cases.*
    FROM test_case_effective_module_cases
    JOIN test_cases ON test_cases.id = test_case_effective_module_cases.test_case_id
    WHERE test_case_effective_module_cases.module_id = ?
    ORDER BY test_case_effective_module_cases.sort_order ASC, test_cases.title ASC
  `).all(moduleId);

  return rows.map((row) => ({
    ...row,
    external_references: normalizeStoredReferenceList(row.external_references),
    labels: normalizeStoredReferenceList(row.labels)
  }));
};

exports.createModule = async ({ app_type_id, name, description, test_case_ids = [], requirement_ids = [], created_by } = {}) => {
  const appType = await ensureAppTypeExists(app_type_id);
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    throw new Error("Module name is required");
  }

  const caseIds = normalizeTextList(test_case_ids);
  const requirementIds = normalizeTextList(requirement_ids);
  await ensureCasesMatchAppType(caseIds, appType.id);
  await ensureRequirementsMatchProject(requirementIds, appType.project_id);

  const id = uuid();
  const displayId = await displayIdService.createDisplayId("test_case_module");
  const actorId = normalizeText(created_by);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO test_case_modules (id, display_id, app_type_id, name, description, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, displayId, appType.id, normalizedName, normalizeText(description), actorId, actorId);

    for (const [index, testCaseId] of caseIds.entries()) {
      await deleteCaseModuleMembership.run(testCaseId);
      await insertModuleCase.run(id, testCaseId, index + 1);
    }

    for (const [index, requirementId] of requirementIds.entries()) {
      await insertModuleRequirement.run(id, requirementId, index + 1);
    }
  });

  await transaction();

  return { id };
};

exports.updateModule = async (id, data = {}) => {
  const existing = await exports.getModule(id);
  const nextName = data.name !== undefined ? normalizeText(data.name) : existing.name;

  if (!nextName) {
    throw new Error("Module name is required");
  }

  const caseIds = data.test_case_ids !== undefined ? normalizeTextList(data.test_case_ids) : null;
  const requirementIds = data.requirement_ids !== undefined ? normalizeTextList(data.requirement_ids) : null;

  if (caseIds) {
    await ensureCasesMatchAppType(caseIds, existing.app_type_id);
  }

  if (requirementIds !== null) {
    const appType = await ensureAppTypeExists(existing.app_type_id);
    await ensureRequirementsMatchProject(requirementIds, appType.project_id);
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE test_case_modules
      SET name = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextName,
      data.description !== undefined ? normalizeText(data.description) : existing.description,
      normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null,
      id
    );

    if (caseIds) {
      await deleteModuleCases.run(id);

      for (const [index, testCaseId] of caseIds.entries()) {
        await deleteCaseModuleMembership.run(testCaseId);
        await insertModuleCase.run(id, testCaseId, index + 1);
      }
    }

    if (requirementIds !== null) {
      await deleteModuleRequirements.run(id);

      for (const [index, requirementId] of requirementIds.entries()) {
        await insertModuleRequirement.run(id, requirementId, index + 1);
      }
    }
  });

  await transaction();

  return { updated: true };
};

exports.assignCases = async (id, testCaseIds = [], { append = true } = {}) => {
  const module = await exports.getModule(id);
  const caseIds = normalizeTextList(testCaseIds);
  await ensureCasesMatchAppType(caseIds, module.app_type_id);

  const existingIds = append ? (await db.prepare("SELECT test_case_id FROM test_case_module_cases WHERE module_id = ? ORDER BY sort_order, test_case_id").all(id)).map((row) => row.test_case_id) : [];
  const nextIds = [...new Set([...existingIds, ...caseIds])];

  const transaction = db.transaction(async () => {
    await deleteModuleCases.run(id);

    for (const [index, testCaseId] of nextIds.entries()) {
      await deleteCaseModuleMembership.run(testCaseId);
      await insertModuleCase.run(id, testCaseId, index + 1);
    }
  });

  await transaction();

  return { updated: true, assigned: caseIds.length };
};

exports.removeCases = async (id, testCaseIds = []) => {
  await exports.getModule(id, { summary: true });
  const caseIds = normalizeTextList(testCaseIds);
  return db.transaction(async () => {
    const removed = await db.prepare(`
      DELETE FROM test_case_module_cases
      WHERE module_id = ? AND test_case_id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))
    `).run(id, JSON.stringify(caseIds));
    const retained = await db.prepare(`
      SELECT test_case_id FROM test_case_effective_module_cases
      WHERE module_id = ? AND test_case_id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))
      ORDER BY test_case_id
    `).all(id, JSON.stringify(caseIds));
    return {
      updated: true, removed: removed.changes,
      retained_test_case_ids: retained.map(row => row.test_case_id),
      ...(retained.length ? { message: 'Story-linked module membership remains. Change the Test Case Story assignment or remove the Story from the module to remove this inherited membership.' } : {})
    };
  })();
};

exports.deleteModule = async (id) => {
  await exports.getModule(id);

  const transaction = db.transaction(async () => {
    await deleteModuleCases.run(id);
    await deleteModuleRequirements.run(id);
    await db.prepare(`
      DELETE FROM test_case_modules
      WHERE id = ?
    `).run(id);
  });

  await transaction();

  return { deleted: true };
};
