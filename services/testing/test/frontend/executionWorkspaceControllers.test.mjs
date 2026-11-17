import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parseExecutionLogs, stringifyExecutionLogs, deriveCaseStatusFromSteps } from '../../frontend/lib/executionLogs.ts';
import { selectLatestExecutionResultInstances } from '../../frontend/lib/executionResultMetrics.ts';
import { getExecutionResultDurationMs } from '../../frontend/lib/executionCaseLifecycle.ts';

function hook(name, dependencies = {}) {
  const file = new URL(`../../frontend/pages/execution-workspace/${name}.tsx`, import.meta.url);
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Exercise the exported production ${name}`);
  const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), code + `; return ${name};`)(...Object.values(dependencies));
}
const noop = () => {};
const isExecutionRunsView = view => view === 'suite-runs' || view === 'local-runs';

test('catalog filtering preserves scoped metrics and bulk selection includes only visible identities', () => {
  const selected = { current: ['outside-filter'] };
  const setSelectedActionExecutionIds = update => { selected.current = typeof update === 'function' ? update(selected.current) : update; };
  const controller = hook('useExecutionCatalogController', {
    useMemo: factory => factory(), useEffect: noop, isExecutionRunsView,
    normalizeExecutionStatus: value => value, parseExecutionLogs,
    hasExecutionEvidence: evidence => Boolean(evidence?.attachmentId || evidence?.dataUrl),
    resolveExecutionAssigneeSummary: () => 'QA', EMPTY_EXECUTION_RUN_SUMMARY: {},
  })({
    data: {
      executions: [{ id: 'run-a', project_id: 'project', name: 'Failure', status: 'failed', metrics: { defect_count: 1 } }, { id: 'run-b', project_id: 'project', name: 'Success', status: 'completed', metrics: { defect_count: 0 } }],
      executionSchedules: [], workspaceTransactions: [], workspaceTransactionStatusCounts: {},
      allExecutionResults: [{ execution_id: 'run-a', logs: JSON.stringify({ stepEvidence: { step: { attachmentId: 'evidence' } } }) }],
      executionSummaryById: { 'run-a': { passed: 1, failed: 1, blocked: 0 }, 'run-b': { passed: 2, failed: 0, blocked: 0 } },
      executionsQuery: {}, allExecutionResultsQuery: {}, executionSchedulesQuery: {}, workspaceTransactionsQuery: {},
    },
    state: { deferredExecutionSearch: '', executionStatusFilter: 'all', executionIssueFilter: 'with-issues', executionEvidenceFilter: 'with-evidence', selectedActionExecutionIds: selected.current, selectedActionScheduleIds: [], selectedActionOperationIds: [], executionCardMeasureRef: { current: null }, setExecutionListItemHeight: noop, setSelectedActionExecutionIds, setSelectedActionScheduleIds: noop, setSelectedActionOperationIds: noop },
    testRunsView: 'suite-runs', selectedOperationId: '', projectNameById: {}, appTypeNameById: {},
  });
  assert.deepEqual(controller.visibleRunLibraryIds, ['run-a']);
  assert.equal(controller.runCatalogMetricCards[0].value, 2, 'Filters must not rewrite the catalog population');
  assert.equal(controller.runCatalogMetricCards[2].value, '75%');
  controller.selectAllRunLibraryItems();
  assert.deepEqual(selected.current, ['outside-filter', 'run-a']);
  controller.clearRunLibrarySelection();
  assert.deepEqual(selected.current, []);
});

test('case navigation waits for pending notes and preserves the exact next data iteration', async () => {
  const changes = [], pending = new Set();
  const rows = ['row:0', 'row:1'].map(instance_key => ({ instance_key }));
  const testCase = { id: 'case', suite_id: 'suite', data_set_instances: rows };
  const options = {
    selection: { selectedExecutionId: 'run', selectedExecutionCaseInstance: rows[0], dismissedExecutionRouteRef: { current: 'run' }, dismissedCaseRouteRef: { current: 'run:case' }, setFocusedSuiteId: value => changes.push(['suite', value]), setSelectedExecutionId: noop, setSelectedTestCaseId: value => changes.push(['case', value]), setSelectedCaseInstanceKey: value => changes.push(['row', value]) },
    scope: { executionCaseOrder: [testCase], filteredExecutionCaseOrder: [testCase] },
    navigation: { pendingStepNoteSavesRef: { current: pending }, syncExecutionSearchParams: (...args) => changes.push(['url', ...args]) },
  };
  const navigation = hook('useExecutionCaseNavigation')(options);
  let complete;
  pending.add(new Promise(resolve => { complete = resolve; }));
  const blocked = navigation.focusNeighborExecutionCase(navigation.nextExecutionCaseInstance);
  await Promise.resolve();
  assert.deepEqual(changes, []);
  complete(false); await blocked;
  assert.deepEqual(changes, [], 'A failed note must keep the current case open');
  pending.clear();
  await navigation.focusNeighborExecutionCase(navigation.nextExecutionCaseInstance);
  assert.ok(changes.some(row => JSON.stringify(row) === JSON.stringify(['url', 'run', 'case', 'row:1'])));
  assert.equal(options.selection.dismissedExecutionRouteRef.current, '');
});

function lifecycle({ derived = false, automated = false, fail = false } = {}) {
  const events = [], cache = { current: null }, run = { id: 'run', app_type_id: 'app' };
  const instance = { instance_key: 'case:row:1', test_case_id: 'case', data_set_iteration_index: 1, data_set_iteration_key: 'data:2' };
  const result = { id: 'attempt', revision: 7, execution_id: 'run', test_case_id: 'case', status: 'running', started_at: '2026-11-17T00:00:00Z', data_set_iteration_index: 1, data_set_iteration_key: 'data:2', derived, logs: JSON.stringify({ stepNotes: { note: 'saved' }, stepStatuses: { a: 'passed' } }) };
  cache.current = [result];
  const api = { executionResults: {
    create: async () => { throw Error('Existing attempt must be updated'); },
    update: async (id, input) => { events.push(['update', id, input]); return { revision: 8, case_defects: [], defects: [] }; },
    transition: async input => { events.push(['transition', input]); if (fail) throw Error('Conflict'); },
    ensure: async input => { events.push(['ensure', input]); return result; },
  } };
  const subject = hook('useExecutionCaseLifecycle', {
    useState: initial => [initial, value => events.push(['busy', value])], useRef: initial => ({ current: initial }),
    useMutation: ({ mutationFn }) => ({ mutateAsync: mutationFn }), api, getExecutionResultDurationMs,
    selectLatestExecutionResultInstances, parseExecutionLogs, stringifyExecutionLogs, deriveCaseStatusFromSteps,
    executionResultMatchesCaseInstance: (row, target) => row.test_case_id === target.test_case_id && row.data_set_iteration_index === target.data_set_iteration_index,
    mergeExecutionEvidencePatch: (current, patch) => ({ ...current, ...patch }),
    resolveStepParameterText: value => value, executionStepText: value => value,
  })({
    scope: { selectedExecution: run, snapshotCases: [{ test_case_id: 'case' }], executionCaseOrder: [{ id: 'case', title: 'Case', data_set_instances: [instance] }], selectedTestCaseId: 'case', selectedExecutionCaseInstance: instance, executionResults: [result], stepsByCaseId: { case: [{ id: 'a', step_order: 1 }, { id: 'b', step_order: 2 }] }, isExecutionLocked: false, isExecutionStarted: true, stepNotes: {}, stepStatuses: {}, selectedSteps: [{ id: 'a' }, { id: 'b' }], bulkSelectedStepIds: [], resultForCaseInstance: () => result, selectedExecutionCaseSnapshot: { automated: automated ? 'yes' : 'no' }, selectedExecutionStartMode: 'manual', executionStepParameterValues: {} },
    cache: { queryClient: { getQueryData: () => cache.current, setQueryData: (_, update) => { cache.current = update(cache.current); } }, refreshExecutionScope: async id => events.push(['refresh', id]) },
    access: { session: { user: { id: 'tester' } }, canManageRunResults: true, canExecuteRuns: true },
    feedback: { showError: (_, message) => events.push(['error', message]), showSuccess: noop, setLinkingDefectStepId: noop, setBulkSelectedStepIds: noop, setLiveNow: value => events.push(['clock', value]) },
  });
  return { subject, events, cache };
}

test('case lifecycle submits exact attempt revision and iteration, refreshes and clears busy state', async () => {
  const { subject, events } = lifecycle();
  await subject.handleCaseLifecycle('pause');
  assert.deepEqual(events.find(([kind]) => kind === 'transition')[1], { execution_id: 'run', test_case_id: 'case', data_set_iteration_index: 1, data_set_iteration_key: 'data:2', expected_revision: 7, expected_result_id: 'attempt', action: 'pause' });
  assert.ok(events.some(([kind]) => kind === 'refresh'));
  assert.deepEqual(events.at(-1), ['busy', null]);
});

test('derived and engine-managed outcomes remain read-only, and transition conflicts reconcile', async () => {
  for (const options of [{ derived: true }, { automated: true }]) {
    const { subject, events } = lifecycle(options); await subject.handleCaseLifecycle('pass');
    assert.ok(!events.some(([kind]) => kind === 'transition'));
    assert.ok(events.some(([kind]) => kind === 'error'));
  }
  const { subject, events } = lifecycle({ fail: true }); await subject.handleCaseLifecycle('pass');
  assert.ok(events.some(([kind]) => kind === 'refresh'));
  assert.deepEqual(events.at(-1), ['busy', null]);
});

test('step persistence keeps earlier notes and statuses on the exact cached attempt', async () => {
  const { subject, events, cache } = lifecycle();
  await subject.persistCaseResult('case', { stepStatusesPatch: { b: 'failed' } });
  const [, id, input] = events.find(([kind]) => kind === 'update');
  assert.equal(id, 'attempt'); assert.equal(input.expected_revision, 7); assert.equal(input.status, 'failed');
  const logs = parseExecutionLogs(input.logs);
  assert.deepEqual(logs.stepStatuses, { a: 'passed', b: 'failed' });
  assert.deepEqual(logs.stepNotes, { note: 'saved' });
  assert.equal(cache.current[0].revision, 8);
});
