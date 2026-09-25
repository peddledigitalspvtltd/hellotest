const db = require("../src/db");
const { randomUUID: uuid } = require("crypto");
const { APP_TYPE_VALUES } = require("../src/domain/catalog");

// Create
exports.createAppType = async ({ project_id, name, type, is_unified }) => {

  if (!APP_TYPE_VALUES.includes(type)) {
    throw new Error("Invalid app type");
  }

  // Validate project
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?")
    .get(project_id);

  if (!project) throw new Error("Project not found");

  const id = uuid();

  await db.prepare(`
    INSERT INTO app_types (id, project_id, name, type, is_unified)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, project_id, name, type, Boolean(is_unified));

  return { id };
};


// Get all (optionally by project)
exports.getAppTypes = async (project_id) => {
  if (project_id) {
    return db.prepare(`
      SELECT * FROM app_types WHERE project_id = ?
    `).all(project_id);
  }

  return db.prepare(`SELECT * FROM app_types`).all();
};


// Get one
exports.getAppType = async (id) => {
  const appType = await db.prepare(`
    SELECT * FROM app_types WHERE id = ?
  `).get(id);

  if (!appType) throw new Error("App type not found");

  return appType;
};


// Update
exports.updateAppType = async (id, data) => {
  const existing = await exports.getAppType(id);

  const name = data.name ?? existing.name;
  const is_unified = data.is_unified ?? existing.is_unified;

  await db.prepare(`
    UPDATE app_types 
    SET name = ?, is_unified = ?
    WHERE id = ?
  `).run(name, Boolean(is_unified), id);

  return { updated: true };
};


// Delete (with safety)
exports.deleteAppType = async (id) => {
  const existing = await exports.getAppType(id);

  const testSuite = await db.prepare(`
    SELECT id FROM test_suites WHERE app_type_id = ?
  `).get(id);

  if (testSuite) {
    throw new Error("Cannot delete app type with existing test suites");
  }

  const result = await db.prepare(`
    SELECT id FROM execution_results WHERE app_type_id = ?
  `).get(id);

  if (result) {
    throw new Error("Cannot delete app type with execution results");
  }

  await db.prepare(`DELETE FROM app_types WHERE id = ?`).run(id);

  return { deleted: true };
};
