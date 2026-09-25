const { normalizeDataOptions } = require("@hellotest/platform/backend/src/utils/scopedTestData");
const { normalizeParameterLayer } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");

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


module.exports = { resolveSuiteContexts };
