const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const catalog = require('../../shared/metricCatalog.json');
const features = require('../../shared/aiFeatureCatalog.json');
const analytics = require('../../../dashboard/backend/services/qualityAnalytics.service');
const formulas = require('../../shared/metricFormulaValues');
const repository = resolve(__dirname, '../../../..');
const ids = new Map(catalog.map(item => [item.key, item]));

function loadWithRows(rows) {
  const file = require.resolve('../services/metricGovernance.service');
  const local = createRequire(file), module = { exports: {} };
  const db = { prepare: sql => ({ all: async (...keys) => rows.filter(row => keys.includes(row.key)), get: async () => undefined }) };
  new Function('require', 'module', 'exports', readFileSync(file, 'utf8'))(id => id === '../src/db' ? db : local(id), module, module.exports);
  return module.exports;
}

test('every native dashboard measurement has one active canonical governance definition', () => {
  assert.equal(ids.size, catalog.length, 'Metric identities must not be duplicated.');
  const mappings = catalog.filter(item => item.runtime_status !== 'reference').flatMap(item => (item.runtime_keys || []).map(key => [key, item.key]));
  assert.equal(new Set(mappings.map(([key]) => key)).size, mappings.length, 'A measured value must not resolve competing review configurations.');
  for (const key of analytics.NATIVE_DASHBOARD_METRICS) {
    assert.equal(mappings.filter(([runtime]) => runtime === `dashboard.${key}`).length, 1, `Missing native dashboard metric: ${key}`);
  }
});

test('metric consumers and source ownership remain discoverable across service code and shared measurements', () => {
  const featureIds = new Set(features.map(item => item.id));
  for (const metric of catalog) {
    assert.ok(metric.calculation_sources?.length, `${metric.key}: missing calculation source`);
    for (const source of metric.calculation_sources) assert.ok(existsSync(join(repository, source)), `${metric.key}: missing source ${source}`);
    for (const id of metric.feature_ids || []) {
      assert.ok(featureIds.has(id), `${metric.key}: unknown feature ${id}`);
      assert.ok(!id.startsWith('ai.agentic.'), 'Agent review criteria belong to the saved agent/node definition.');
    }
    if (metric.runtime_status === 'reference') assert.ok(metric.runtime_note, `${metric.key}: disclose that this is a reference`);
  }
  const inspect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'test', 'tests', 'dist', 'dist-admin', 'eval', 'instance-setup-data', 'runtime'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:js|mjs|ts|tsx)$/.test(path)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/["'](metric\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]+)["']/g)) {
          assert.ok(ids.has(match[1]), `${path}: missing metric definition ${match[1]}`);
        }
      }
    }
  };
  inspect(join(repository, 'services'));
});

test('server model reviews use the relevant published criteria and retain exact provenance', async () => {
  const id = 'metric.assurance.story';
  const service = loadWithRows([
    { key: `metric_governance:${id}`, value: { published: { version: 4, config: { criteria: 'Explain only the selected acceptance objective.', parameters: {} } } } },
    { key: 'workspace_governed_preference:ai_metric_criteria_overrides', value: { [id]: 'Old organization criteria.', 'metric.assurance.test_case': 'Do not include unrelated case review text.' } }
  ]);
  const result = await service.resolveForFeature('ai.quality.story_assurance');
  assert.match(result.instruction, /Explain only the selected acceptance objective/);
  assert.doesNotMatch(result.instruction, /Old organization|unrelated case review text/);
  assert.deepEqual(result.metrics.map(item => [item.id, item.version, item.source]), [[id, 4, 'published']]);
  assert.match(result.instruction, /Arithmetic.*application-owned/);
  assert.deepEqual(await service.resolveForFeature('ai.agentic.test-improvement'), { instruction: '', metrics: [] });
});

test('review criteria budget preserves ownership and discloses shortened organization instructions', async () => {
  const relevant = catalog.filter(item => item.feature_ids.includes('ai.case_authoring.full_case'));
  const service = loadWithRows([{ key: 'workspace_governed_preference:ai_metric_criteria_overrides', value: Object.fromEntries(relevant.map(item => [item.key, 'Full organization rubric. '.repeat(350)])) }]);
  const result = await service.resolveForFeature('ai.case_authoring.full_case');
  assert.ok(result.instruction.length <= 12000);
  assert.match(result.instruction, /Criteria excerpt/);
  assert.equal(result.metrics.length, relevant.length, 'All applied metric identities remain in trace metadata.');
});

test('legacy metric values merge per key and use the same bounded normalized values as calculations', async () => {
  const id = 'metric.project.portfolio_health';
  const previous = { [id]: { story_weight: 2, automation_weight: 3, pass_weight: 5 }, 'metric.project.release_ready': { readiness_threshold: 87 } };
  const service = loadWithRows([
    { key: 'workspace_metric_formula_values', value: previous },
    { key: 'workspace_governed_preference:ai_metric_formula_values', value: { 'metric.project.release_ready': { readiness_threshold: 91 } } }
  ]);
  assert.deepEqual((await service.detail(id)).config.parameters, formulas.normalizeFormulaValues(previous)[id]);
  assert.equal((await service.detail('metric.project.release_ready')).config.parameters.readiness_threshold, 91);
  const defaults = formulas.normalizeFormulaValues({ [id]: { story_weight: null, automation_weight: '', pass_weight: false } });
  assert.deepEqual(defaults[id], formulas.DEFAULT_FORMULA_VALUES[id], 'Missing and nonnumeric legacy input must not silently become zero weights.');
});

test('reference and transport definitions cannot publish settings that pretend to govern a calculation', async () => {
  const service = loadWithRows([]);
  for (const id of ['metric.jira.average_age', 'metric.analytics.release_posture', 'metric.ai.transport_observability']) {
    await assert.rejects(service.mutate(id, { expected_revision: 0, config: service.defaults(ids.get(id)) }, { actorId: 'admin' }, 'publish'), { statusCode: 422 });
  }
});

test.after(() => require('../src/db').close());
