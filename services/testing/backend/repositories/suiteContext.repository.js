// Persistence adapter owned by Testing. Use cases depend on these three reads.
function createSuiteContextRepository(db = require("@hellotest/platform/backend/src/db")) {
  return {
    async findDescendants(ids) {
      // UNION terminates safely even for legacy cyclic trees.
      return db.prepare(`WITH RECURSIVE selected AS (
        SELECT id, app_type_id FROM test_suites WHERE id IN (${ids.map(() => "?").join(",")})
        UNION
        SELECT child.id, child.app_type_id FROM test_suites child JOIN selected parent ON child.parent_id = parent.id
        WHERE child.app_type_id = parent.app_type_id
      ) SELECT id, app_type_id FROM selected ORDER BY id`).all(...ids);
    },
    async findAncestors(ids) {
      // Keep recursion narrow; unrelated suites and their data are never read.
      return db.prepare(`WITH RECURSIVE ancestry AS (
        SELECT id, app_type_id, parent_id FROM test_suites WHERE id IN (${ids.map(() => "?").join(",")})
        UNION
        SELECT parent.id, parent.app_type_id, parent.parent_id
        FROM test_suites parent JOIN ancestry child ON parent.id = child.parent_id
        WHERE parent.app_type_id = child.app_type_id
      ) SELECT suite.id, suite.parent_id, suite.app_type_id, suite.parameter_values,
          suite.test_data_set_id, suite.test_data_options, app.project_id
        FROM ancestry JOIN test_suites suite ON suite.id = ancestry.id
        JOIN app_types app ON app.id = suite.app_type_id
      `).all(...ids);
    },
    async findDataSets(ids) {
      return db.prepare(`SELECT data.* FROM test_data_sets data
        WHERE data.id IN (${ids.map(() => "?").join(",")})
      `).all(...ids);
    }
  };
}
module.exports = { createSuiteContextRepository };
