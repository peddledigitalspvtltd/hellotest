import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

const source = readFileSync(new URL('../src/lib/qualityDashboardDrilldown.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, URL });
const { buildQualityDashboardDrilldown } = module.exports;
const options = { projectId: 'project-a', origin: 'https://workspace.example/dashboard?old=1#/old-route' };
const result = (patch = {}) => ({
  project: { id: 'project-a', key: 'A', name: 'Project A' },
  gadget: { id: 'widget', title: 'Evidence', data_source: 'hellotest', metric: 'count', type: 'table', group_by: 'status', jql: '' },
  rows: [], series: [], jql: '', total: 1, value: 1, value_label: '1', returned: 1, truncated: false,
  evaluated_at: '2026-09-10T10:00:00Z', ...patch
});
const row = (type) => ({ id: 'opaque /id?&=#', key: 'DISPLAY-42', title: 'Evidence', type, status: 'open', priority: null, assignee: null, updated: null });

test('native evidence rows open exact record IDs using canonical BrowserRouter paths', () => {
  const cases = [
    ['issue', '/issues', '/issues', 'issue', 'bug'],
    ['story', '/requirements', '/stories', 'requirement', 'story'],
    ['test-case', '/test-cases', '/test-cases', 'case', 'test case'],
    ['test-run', '/executions', '/executions', 'execution', 'test run'],
    ['test-suite', '/test-suites', '/design', 'suite', 'test suite']
  ];
  for (const [type, target, path, parameter, label] of cases) {
    const evidence = row(type);
    const link = buildQualityDashboardDrilldown(result({ drilldown_target: target }), { ...options, row: evidence });
    const url = new URL(link.url);
    assert.equal(url.origin, 'https://workspace.example');
    assert.equal(url.pathname, path);
    assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams.keys()], ['project', parameter]);
    assert.equal(url.searchParams.get('project'), options.projectId);
    assert.equal(url.searchParams.get(parameter), evidence.id);
    assert.equal(link.opensRecord, true);
    assert.equal(link.label, `Open ${label}`);
    assert.equal(link.notice, undefined);
  }
});

test('latest-outcome rows never mistake test-case identity for execution identity', () => {
  for (const metric of ['passRate', 'executionCompletion']) {
    const data = result({ drilldown_target: '/executions' });
    data.gadget.metric = metric;
    const link = buildQualityDashboardDrilldown(data, { ...options, row: row('test-case') });
    const url = new URL(link.url);
    assert.equal(url.pathname, '/test-cases');
    assert.equal(url.searchParams.get('case'), row('test-case').id);
    assert.equal(url.searchParams.has('execution'), false);
    assert.equal(link.opensRecord, true);
    assert.match(link.notice, /does not identify a specific run attempt/);
  }
});

test('chart groups and release filters open honest scoped lists without invented filter parameters', () => {
  for (const [metric, target, group] of [
    ['openDefects', '/issues', 'High'],
    ['moduleCaseCount', '/test-cases', 'Payments'],
    ['requirementCoverage', '/requirements', 'Uncovered'],
    ['testRuns', '/executions', '2026-W36'],
    ['testSuites', '/test-suites', 'Ready']
  ]) {
    const data = result({ drilldown_target: `${target}?dashboardGroup=ignored&release=ignored#old` });
    data.gadget.metric = metric;
    data.gadget.release = 'Release 42';
    const link = buildQualityDashboardDrilldown(data, { ...options, groupLabel: group });
    const url = new URL(link.url);
    assert.equal(link.opensRecord, false);
    assert.deepEqual([...url.searchParams], [['project', 'project-a']]);
    assert.equal(url.hash, '');
    assert.ok(link.notice.includes(group));
    assert.match(link.notice, /active project and current application scope/);
    assert.match(link.notice, /are not applied/);
  }
});

test('metric-only results and unknown row types resolve to truthful list destinations', () => {
  const destinations = { count: '/issues', openDefects: '/issues', coverageGaps: '/stories', testCases: '/test-cases', failedRuns: '/executions', testSuites: '/design', passRate: '/executions' };
  for (const [metric, path] of Object.entries(destinations)) {
    const data = result();
    data.gadget.metric = metric;
    const link = buildQualityDashboardDrilldown(data, { ...options, row: row('unknown') });
    assert.equal(new URL(link.url).pathname, path);
    assert.equal(link.opensRecord, false);
    assert.match(link.notice, /Widget filters are not applied/);
  }
});

test('stale project results, missing record IDs and nonnative destinations cannot navigate', () => {
  assert.throws(() => buildQualityDashboardDrilldown(result(), { ...options, projectId: 'project-b' }), /different project/);
  assert.throws(() => buildQualityDashboardDrilldown(result(), { ...options, projectId: '' }), /different project/);
  assert.throws(() => buildQualityDashboardDrilldown(result(), { ...options, row: { ...row('issue'), id: '' } }), /missing its identifier/);
  for (const target of ['https://outside.example/issues', '//outside.example/issues', 'javascript:alert(1)', '/not-a-workspace-route']) {
    assert.throws(() => buildQualityDashboardDrilldown(result({ drilldown_target: target }), options), /supported native evidence destination/);
  }
  assert.throws(() => buildQualityDashboardDrilldown(result(), { ...options, origin: 'file:///tmp/dashboard.html' }), /HTTP workspace URL/);
  const jira = result();
  jira.gadget.data_source = 'jira';
  assert.throws(() => buildQualityDashboardDrilldown(jira, options), /Connected work-tracker evidence/);
});

test('link creation is pure and keeps project/record identity safely encoded', () => {
  const data = result();
  data.project.id = 'project /?&=#';
  const before = JSON.stringify(data);
  const link = buildQualityDashboardDrilldown(data, { ...options, projectId: data.project.id, row: row('issue') });
  assert.equal(new URL(link.url).searchParams.get('project'), data.project.id);
  assert.equal(new URL(link.url).searchParams.get('issue'), row('issue').id);
  assert.equal(JSON.stringify(data), before);
});
