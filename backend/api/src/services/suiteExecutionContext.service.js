const { normalizeDataOptions } = require("../utils/scopedTestData");
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
    const owner = [...chain].reverse().find(row => row.data_set?.id);
    const data = owner?.data_set || null;
    const policyOwner = [...chain].reverse().find(row => row.test_data_options && Object.keys(row.test_data_options).length);
    return [id, { parameters, dataSet: data, dataOptions: normalizeDataOptions(policyOwner?.test_data_options ?? owner?.test_data_options) }];
  }));
}

async function loadSuiteContexts(suiteIds = [], overrides = new Map()) {
  const ids = [...new Set(suiteIds.filter(Boolean))];
  if (!ids.length) return new Map();
  // Keep the recursive row narrow and use UNION so legacy cycles terminate.
  // Unrelated suites and their potentially large data rows are never loaded.
  const storedRows = await db.prepare(`WITH RECURSIVE ancestry AS (
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
  // A Suite edit preview substitutes only its draft resource/policy. Descendants
  // keep their nearest data owner, while an explicit clear can inherit a parent.
  const rows = storedRows.map(row => ({ ...row, ...(overrides.get(row.id) || {}) }));
  const dataSetIds = [...new Set(rows.map(row => row.test_data_set_id).filter(Boolean))];
  const dataSets = dataSetIds.length ? await db.prepare(`SELECT data.* FROM test_data_sets data
    WHERE data.id IN (${dataSetIds.map(() => "?").join(",")})
  `).all(...dataSetIds) : [];
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
