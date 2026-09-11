const db = require("../db");
const { normalizeParameterLayer } = require("../utils/stepParameterResolution");

// UNION (rather than UNION ALL) terminates safely even for legacy cyclic trees.
async function expandSuiteSelection(ids = [], appTypeId) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const rows = await db.prepare(`WITH RECURSIVE selected AS (
    SELECT id, app_type_id FROM test_suites WHERE id IN (${unique.map(() => "?").join(",")})
    UNION
    SELECT child.id, child.app_type_id FROM test_suites child JOIN selected parent ON child.parent_id = parent.id
    WHERE child.app_type_id = parent.app_type_id
  ) SELECT id, app_type_id FROM selected ORDER BY id`).all(...unique);
  if (unique.some(id => !rows.some(row => row.id === id)) || rows.some(row => row.app_type_id !== appTypeId)) {
    throw Object.assign(new Error("All selected suites must exist in the selected application."), { statusCode: 400 });
  }
  return [...unique, ...rows.map(row => row.id).filter(id => !unique.includes(id))];
}

function resolveSuiteContexts(rows, suiteIds) {
  const byId = new Map(rows.map(row => [row.id, row]));
  return new Map(suiteIds.map(id => {
    const chain = [], seen = new Set();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id); chain.unshift(current);
      const parent = byId.get(current.parent_id);
      current = parent?.app_type_id === current.app_type_id ? parent : null;
    }
    const parameters = Object.assign({}, ...chain.map(row => normalizeParameterLayer(row.parameter_values, "s")));
    const data = [...chain].reverse().find(row => row.data_set?.id)?.data_set || null;
    return [id, { parameters, dataSet: data }];
  }));
}

async function loadSuiteContexts(suiteIds = []) {
  const ids = [...new Set(suiteIds.filter(Boolean))];
  if (!ids.length) return new Map();
  // Keep the recursive row narrow and use UNION so legacy cycles terminate.
  // Unrelated suites and their potentially large data rows are never loaded.
  const rows = await db.prepare(`WITH RECURSIVE ancestry AS (
    SELECT id, app_type_id, parent_id FROM test_suites WHERE id IN (${ids.map(() => "?").join(",")})
    UNION
    SELECT parent.id, parent.app_type_id, parent.parent_id
    FROM test_suites parent JOIN ancestry child ON parent.id = child.parent_id
    WHERE parent.app_type_id = child.app_type_id
  ) SELECT suite.id, suite.parent_id, suite.app_type_id, suite.parameter_values,
      suite.test_data_set_id, app.project_id
    FROM ancestry JOIN test_suites suite ON suite.id = ancestry.id
    JOIN app_types app ON app.id = suite.app_type_id
  `).all(...ids);
  const dataSetIds = [...new Set(rows.map(row => row.test_data_set_id).filter(Boolean))];
  const ancestorIds = rows.map(row => row.id);
  const dataSets = dataSetIds.length ? await db.prepare(`SELECT data.* FROM test_data_sets data
    WHERE data.id IN (${dataSetIds.map(() => "?").join(",")}) AND EXISTS (
      SELECT 1 FROM test_suites suite JOIN app_types app ON app.id = suite.app_type_id
      WHERE suite.id IN (${ancestorIds.map(() => "?").join(",")}) AND suite.test_data_set_id = data.id
        AND data.project_id = app.project_id
        AND (data.app_type_id IS NULL OR data.app_type_id = suite.app_type_id)
    )
  `).all(...dataSetIds, ...ancestorIds) : [];
  const dataById = new Map(dataSets.map(data => [data.id, data]));
  return resolveSuiteContexts(rows.map(row => {
    const data = dataById.get(row.test_data_set_id);
    // A dataset valid for one selected app cannot legitimize a stale link from
    // another selected app/project when both share this batched query.
    return { ...row, data_set: data && data.project_id === row.project_id
      && (data.app_type_id == null || data.app_type_id === row.app_type_id) ? data : null };
  }), ids);
}

module.exports = { expandSuiteSelection, loadSuiteContexts, resolveSuiteContexts };
