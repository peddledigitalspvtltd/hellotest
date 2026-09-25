import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
const source = readFileSync(new URL('../../frontend/lib/qualityDashboardPresets.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports });
const { QUALITY_DASHBOARD_PRESETS, QUALITY_WIDGET_LIBRARY, QUALITY_QUERY_LIBRARY, compactDashboardSeries, createDashboardPreset, dashboardQueryGadgets, moveDashboardWidget } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('all audience presets immediately produce bounded native widgets isolated to their project', () => {
  assert.equal(QUALITY_DASHBOARD_PRESETS.length, 6);
  assert.ok(QUALITY_WIDGET_LIBRARY.length >= 40);
  for (const preset of QUALITY_DASHBOARD_PRESETS) {
    const first = createDashboardPreset('project-a', preset.id);
    const second = createDashboardPreset('project-b', preset.id);
    assert.equal(first.project_id, 'project-a');
    assert.equal(second.project_id, 'project-b');
    assert.ok(first.gadgets.length > 4 && first.gadgets.length <= 12);
    assert.equal(new Set(first.gadgets.map(item => item.id)).size, first.gadgets.length);
    assert.ok(first.gadgets.every(item => item.data_source === 'hellotest' && item.jql === ''));
    assert.ok(first.gadgets.some(item => item.type !== 'metric'));
    first.gadgets[0].title = 'Changed';
    assert.notEqual(second.gadgets[0].title, 'Changed');
  }
});

test('relational templates and query choices cover real saved relationships with supported chart styles', () => {
  for (const [id, metrics] of [['traceability', ['storyTestPassRate', 'linkedTestCases', 'storiesWithOpenDefects']], ['delivery', ['devStoryCompletion', 'qaStoryCompletion', 'stories']], ['triage', ['defectTraceability', 'failedCases', 'count']]]) {
    const preset = createDashboardPreset('p', id);
    for (const metric of metrics) assert.ok(preset.gadgets.some(gadget => gadget.metric === metric));
  }
  assert.equal(new Set(QUALITY_QUERY_LIBRARY.map(query => query.metric)).size, QUALITY_QUERY_LIBRARY.length);
  for (const widget of QUALITY_WIDGET_LIBRARY) assert.ok(QUALITY_QUERY_LIBRARY.some(query => query.metric === widget.gadget.metric));
  assert.match(QUALITY_QUERY_LIBRARY.find(query => query.metric === 'storyTestPassRate').relationship, /Stories.*Tests.*Results/);
  assert.ok(QUALITY_WIDGET_LIBRARY.some(widget => widget.gadget.type === 'area'));
  assert.ok(QUALITY_WIDGET_LIBRARY.some(widget => widget.gadget.type === 'column'));
});

test('bounded chart legends retain the complete denominator through an Other Groups segment', () => {
  const series = Array.from({length: 30}, (_, index) => ({label: `Owner ${index}`, value: index + 1}));
  const result = compactDashboardSeries(series, 8);
  assert.equal(result.length, 8);
  assert.equal(result.reduce((sum, item) => sum + item.value, 0), series.reduce((sum, item) => sum + item.value, 0));
  assert.equal(result.at(-1).label, 'Other Groups (23)');
  assert.equal(series.length, 30);
  assert.equal(compactDashboardSeries(series, 30), series);
});

test('widget movement supports distant positions without mutation or lost widgets', () => {
  const original = createDashboardPreset('project', 'quality').gadgets;
  const moved = moveDashboardWidget(original, original[0].id, 6);
  assert.equal(moved[6].id, original[0].id);
  assert.deepEqual(plain(moved.map(item => item.id).sort()), plain(original.map(item => item.id).sort()));
  assert.equal(original[0].id, 'quality:execution-completion');
  assert.equal(moveDashboardWidget(original, original[0].id, -1), original);
});

test('presentation and order reuse evaluated data while metric and release changes invalidate it', () => {
  const original = createDashboardPreset('project', 'quality').gadgets;
  const restyled = original.map(item => ({ ...item, title: 'New title', accent: 'red' })).reverse();
  assert.deepEqual(plain(dashboardQueryGadgets(original)), plain(dashboardQueryGadgets(restyled)));
  for (const patch of [{ release: 'next-release' }, { group_by: 'priority' }, { metric: 'openDefects' }, { type: 'table' }]) {
    const changed = original.map((item, index) => index === 0 ? { ...item, ...patch } : item);
    assert.notDeepEqual(plain(dashboardQueryGadgets(original)), plain(dashboardQueryGadgets(changed)));
  }
});
