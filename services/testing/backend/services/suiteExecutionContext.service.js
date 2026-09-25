const { createSuiteContextRepository } = require("../repositories/suiteContext.repository");
const { resolveSuiteContexts } = require("../domain/suiteContext");

function createSuiteExecutionContext(repository) {
  // UNION (rather than UNION ALL) terminates safely even for legacy cyclic trees.
  async function expandSuiteSelection(ids = [], appTypeId) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];
    const rows = await repository.findDescendants(unique);
    if (unique.some(id => !rows.some(row => row.id === id)) || rows.some(row => row.app_type_id !== appTypeId)) {
      throw Object.assign(new Error("All selected suites must exist in the selected application."), { statusCode: 400 });
    }
    return [...unique, ...rows.map(row => row.id).filter(id => !unique.includes(id))];
  }


  async function loadSuiteContexts(suiteIds = [], overrides = new Map()) {
    const ids = [...new Set(suiteIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const storedRows = await repository.findAncestors(ids);
    // A Suite edit preview substitutes only its draft resource/policy. Descendants
    // keep their nearest data owner, while an explicit clear can inherit a parent.
    const rows = storedRows.map(row => ({ ...row, ...(overrides.get(row.id) || {}) }));
    const dataSetIds = [...new Set(rows.map(row => row.test_data_set_id).filter(Boolean))];
    const dataSets = dataSetIds.length ? await repository.findDataSets(dataSetIds) : [];
    const dataById = new Map(dataSets.map(data => [data.id, data]));
    return resolveSuiteContexts(rows.map(row => {
      const data = dataById.get(row.test_data_set_id);
      // A dataset valid for one selected app cannot legitimize a stale link from
      // another selected app/project when both share this batched query.
      return { ...row, data_set: data && data.project_id === row.project_id
        && (data.app_type_id == null || data.app_type_id === row.app_type_id) ? data : null };
    }), ids);
  }

  return { expandSuiteSelection, loadSuiteContexts, resolveSuiteContexts };
}

module.exports = {
  ...createSuiteExecutionContext(createSuiteContextRepository()),
  createSuiteExecutionContext
};
