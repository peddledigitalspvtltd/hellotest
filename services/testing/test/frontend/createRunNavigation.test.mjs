import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCreateRunNavigation, createRunDeliveryUpdates, createRunSelectionReadiness, deriveCreateRunDelivery, readCreateRunNavigation } from '../../frontend/lib/createRunNavigation.ts';

const input = overrides => ({ createRun: { projectId: 'project', appTypeId: 'app', testCaseIds: ['last-page', 'first-page'], release: '', sprint: '', ...overrides } });

test('run navigation retains selection order and scope without placing IDs in the URL', () => {
  const state = input({ testCaseIds: [' z ', 'a', 'z', '', null], release: ' Release Alpha ', sprint: ' Sprint Alpha ' });
  const result = readCreateRunNavigation(state);
  assert.deepEqual(result, { projectId: 'project', appTypeId: 'app', testCaseIds: ['z', 'a'], release: 'Release Alpha', sprint: 'Sprint Alpha' });
  assert.deepEqual(state.createRun.testCaseIds, [' z ', 'a', 'z', '', null], 'Navigation input is never mutated');
});

test('malformed or unscoped selections cannot prefill a run', () => {
  for (const state of [null, [], { createRun: null }, input({ projectId: '' }), input({ appTypeId: null }), input({ testCaseIds: [] }), input({ testCaseIds: 'case' })]) {
    assert.equal(readCreateRunNavigation(state), null);
  }
});

test('consuming or cancelling navigation removes only create-run state and parameters so Back/Forward cannot replay it', () => {
  const state = { ...input(), returnTo: '/test-cases', tab: 'runs' };
  const cleared = clearCreateRunNavigation('?create=1&mode=manual&project=project&release_id=release&release=v1&sprint_id=sprint&sprint=s1&view=suite-runs&execution=run', state);
  assert.equal(cleared.search, '?view=suite-runs&execution=run');
  assert.deepEqual(cleared.state, { returnTo: '/test-cases', tab: 'runs' });
  assert.equal(readCreateRunNavigation(cleared.state), null);
  assert.equal(readCreateRunNavigation(state).testCaseIds[0], 'last-page');
  assert.deepEqual(clearCreateRunNavigation('?create=1', input()), { search: '', state: null });
});

test('delayed requirement data derives delivery before selected picker names resolve', () => {
  const requirements = [{ id: 'story', test_case_ids: ['last-page'], iteration_id: 'iteration', fix_version: 'Release Alpha' }];
  const iterations = [{ id: 'iteration', name: 'Sprint Alpha', jira_sprint_name: 'Jira Sprint Alpha' }];
  assert.deepEqual(deriveCreateRunDelivery(['last-page'], [], requirements, [], iterations), { release: 'Release Alpha', sprint: 'Jira Sprint Alpha' });
  assert.deepEqual(deriveCreateRunDelivery(['other-case'], [], requirements, [], iterations), { release: '', sprint: '' });
});

test('picker Story relationships resolve release and sprint membership without a full Test Case catalog', () => {
  const cases = [{ id: 'selected', requirement_ids: ['story'] }];
  const requirements = [{ id: 'story' }];
  const iterations = [{ id: 'iteration', name: 'Sprint Alpha', requirement_ids: ['story'] }];
  const releases = [{ id: 'release', name: 'Release Alpha', sprint_ids: ['iteration'] }];
  assert.deepEqual(deriveCreateRunDelivery(['selected'], cases, requirements, releases, iterations), { release: 'Release Alpha', sprint: 'Sprint Alpha' });
});

test('different selected delivery scopes do not choose an arbitrary default', () => {
  const requirements = [
    { id: 'a', test_case_ids: ['a'], fix_version: 'Release A', sprint: 'Shared sprint' },
    { id: 'b', test_case_ids: ['b'], fix_version: 'Release B', sprint: 'Shared sprint' }
  ];
  assert.deepEqual(deriveCreateRunDelivery(['b', 'a'], [], requirements, [], []), { release: '', sprint: 'Shared sprint' });
});

test('delayed delivery defaults preserve values supplied by navigation and fields already edited by the user', () => {
  const derived = { release: 'Derived release', sprint: 'Derived sprint' };
  assert.deepEqual(createRunDeliveryUpdates({ release: '', sprint: '' }, { release: false, sprint: false }, derived), derived);
  assert.deepEqual(createRunDeliveryUpdates({ release: '', sprint: '' }, { release: true, sprint: false }, derived), { release: undefined, sprint: 'Derived sprint' });
  assert.deepEqual(createRunDeliveryUpdates({ release: 'Chosen release', sprint: '' }, { release: false, sprint: true }, derived), { release: undefined, sprint: undefined });
});

test('delivery prefill waits for delayed selected-case links, including the render after the lookup settles', () => {
  const ids = ['off-page'];
  const completed = { selectionKey: JSON.stringify(ids), pending: false, error: null, unavailableIds: [] };
  const requirements = [{ id: 'story', fix_version: 'Release Alpha', sprint: 'Sprint Alpha' }];
  assert.equal(createRunSelectionReadiness(ids, [], null), 'pending');
  assert.equal(createRunSelectionReadiness(ids, [], { ...completed, pending: true }), 'pending');
  assert.equal(createRunSelectionReadiness(ids, [], completed), 'pending', 'The lookup can settle before its rows reach the parent');
  const cases = [{ id: 'off-page', requirement_ids: ['story'] }];
  assert.equal(createRunSelectionReadiness(ids, cases, completed), 'ready');
  assert.deepEqual(deriveCreateRunDelivery(ids, cases, requirements, [], []), { release: 'Release Alpha', sprint: 'Sprint Alpha' });
});

test('a changed selection ignores stale completion and unavailable cases finish with an actionable failure', () => {
  const previous = { selectionKey: JSON.stringify(['old']), pending: false, error: new Error('Previous failure'), unavailableIds: ['old'] };
  assert.equal(createRunSelectionReadiness(['new'], [], previous), 'pending');
  const current = { selectionKey: JSON.stringify(['new']), pending: false, error: null, unavailableIds: ['new'] };
  assert.equal(createRunSelectionReadiness(['new'], [], current), 'unavailable');
  assert.equal(createRunSelectionReadiness(['new'], [], { ...current, unavailableIds: [], error: new Error('Network failure') }), 'unavailable');
  assert.equal(createRunSelectionReadiness(['new'], [{ id: 'new' }], previous), 'ready');
});
