import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomationAuthoringStore, caseAuthoringState, activeAuthoringRecording } from '../../frontend/lib/automationAuthoringState.ts';
import { createAutomationSelectionStore } from '../../frontend/lib/automationSelectionState.ts';
const scope = { projectId: 'project', appTypeId: 'app', actorId: 'reviewer' };
const build = (caseIds = ['case'], operationId = 'build-op') => ({ operationId, caseIds, status: 'submitting', scheduledAt: null, startedAt: 10 });
const recording = (operationId = 'record-op', caseId = 'case') => ({ operationId, origin: { caseId, projectId: 'project', appTypeId: 'app', targetStepId: 'target', environmentId: 'env', configurationId: 'config', dataSetId: 'data', suiteId: 'suite' }, options: { recorder_mode: 'remote', recorder_target: 'web' }, session: null, parameterBindings: {}, privateValues: ['private-fixture'] });
const idleServer = caseId => ({ case_id: caseId, state: 'idle', build: null, recording: null, can_build: true, can_record: true });

test('synchronous admission prevents overlapping builds/recordings and rejects a batch atomically', () => {
  const store = createAutomationAuthoringStore(scope);
  store.dispatch({ type: 'record.requested', recording: recording() });
  const before = store.snapshot();
  assert.throws(() => store.dispatch({ type: 'build.requested', build: build(['other', 'case']) }), { code: 'AUTOMATION_AUTHORING_BUSY' });
  assert.equal(store.snapshot(), before); assert.equal(caseAuthoringState(store.snapshot(), 'other').phase, 'idle');
  assert.throws(() => store.dispatch({ type: 'record.requested', recording: recording('other-op', 'other') }), { code: 'AUTOMATION_AUTHORING_BUSY' });
  const second = createAutomationAuthoringStore(scope); second.dispatch({ type: 'build.requested', build: build() });
  assert.throws(() => second.dispatch({ type: 'record.requested', recording: recording() }), { code: 'AUTOMATION_AUTHORING_BUSY' });
});
test('uncertain start retains the reservation/context until authoritative reconciliation; stale callbacks cannot replace it', () => {
  const store = createAutomationAuthoringStore(scope);
  store.dispatch({ type: 'record.requested', recording: recording() });
  store.dispatch({ type: 'server.synced', caseId: 'case', server: idleServer('case') });
  assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'record_starting', 'An early idle read cannot release an admitted POST.');
  store.dispatch({ type: 'record.start_rejected', operationId: 'record-op', definite: false, message: 'Start outcome is unknown.' });
  assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'conflict'); assert.equal(activeAuthoringRecording(store.snapshot()).recording.privateValues.length, 1);
  store.dispatch({ type: 'server.synced', caseId: 'case', server: idleServer('case') });
  store.dispatch({ type: 'record.requested', recording: recording('new-op') });
  store.dispatch({ type: 'record.started', operationId: 'record-op', session: { id: 'stale', status: 'running' } });
  assert.equal(activeAuthoringRecording(store.snapshot()).recording.session, null);
});
test('recording context survives immutable phase transitions, failed save remains retryable, completion clears private data', () => {
  const store = createAutomationAuthoringStore(scope), input = recording();
  store.dispatch({ type: 'record.requested', recording: input }); input.privateValues.push('later-mutation');
  store.dispatch({ type: 'record.started', operationId: 'record-op', session: { id: 'session', status: 'running' } });
  store.dispatch({ type: 'record.parameters_changed', caseId: 'case', operationId: 'record-op', parameterBindings: { 1: 't.private' } });
  const before = activeAuthoringRecording(store.snapshot()).recording;
  store.dispatch({ type: 'record.save_requested', caseId: 'case', sessionId: 'session' });
  assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'record_saving'); assert.equal(before.privateValues.length, 1); assert.equal(before.origin.targetStepId, 'target');
  store.dispatch({ type: 'record.save_rejected', caseId: 'case', sessionId: 'stale' }); assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'record_saving');
  store.dispatch({ type: 'record.save_rejected', caseId: 'case', sessionId: 'session' }); assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'recording');
  store.dispatch({ type: 'record.saved', caseId: 'case', sessionId: 'session' }); assert.equal(activeAuthoringRecording(store.snapshot()), null);
  store.dispatch({ type: 'build.requested', build: build() }); store.dispatch({ type: 'build.accepted', operationId: 'build-op', activityId: 'activity', status: 'queued' });
  store.dispatch({ type: 'build.updated', activityId: 'activity', status: 'completed' }); assert.equal(caseAuthoringState(store.snapshot(), 'case').phase, 'idle');
});
test('selection toggles observe synchronous current state and scope/case changes clear only the appropriate selection', () => {
  const store = createAutomationSelectionStore('scope');
  store.dispatch({ type: 'case.toggled', id: 'one', selected: true }); store.dispatch({ type: 'case.toggled', id: 'two', selected: true });
  store.dispatch({ type: 'step.toggled', id: 'step', selected: true }); store.dispatch({ type: 'instruction.shown', id: 'step' });
  store.dispatch({ type: 'case.changed', caseId: 'detail' }); assert.deepEqual(store.snapshot().caseIds, ['one', 'two']); assert.deepEqual(store.snapshot().stepIds, []);
  store.dispatch({ type: 'step.expansion_toggled', id: 'first' }); store.dispatch({ type: 'step.expansion_toggled', id: 'second' }); assert.deepEqual(store.snapshot().expandedStepIds, ['second']);
  store.dispatch({ type: 'scope.changed', scope: 'next' }); assert.deepEqual(store.snapshot().caseIds, []);
});

test('initial recorder parameter drafts are retained before POST and survive unknown-start reconciliation', () => {
  const store = createAutomationAuthoringStore(scope), draft = { caseValues: { 't.created': 'private-created-value' }, suiteValues: { 's.shared': 'shared-value' }, privateNames: ['t.created'], overrideNames: ['t.created'] };
  store.dispatch({ type: 'record.requested', recording: recording() });
  store.dispatch({ type: 'record.parameter_draft_changed', caseId: 'case', operationId: 'record-op', draft });
  draft.caseValues['t.created'] = 'later-edit';
  assert.equal(activeAuthoringRecording(store.snapshot()).recording.parameterDraft.caseValues['t.created'], 'private-created-value');
  store.dispatch({ type: 'record.start_rejected', operationId: 'record-op', definite: false, message: 'Start outcome unknown.' });
  store.dispatch({ type: 'server.synced', caseId: 'case', server: { ...idleServer('case'), state: 'recording', can_build: false, can_record: false, recording: { activity_id: 'reserved', status: 'running' } } });
  const current = activeAuthoringRecording(store.snapshot()); assert.equal(current.recording.privateValues.length, 1); assert.equal(current.recording.parameterDraft.caseValues['t.created'], 'private-created-value');
  assert.throws(() => store.dispatch({ type: 'build.requested', build: build() }), { code: 'AUTOMATION_AUTHORING_BUSY' });
});

test('display-ID route changes preserve the same case selection without hiding another case capture', async () => {
  const {selectionMatchesCaseRoute} = await import('../../frontend/lib/automationSelectionState.ts');
  const store=createAutomationSelectionStore('scope');
  store.dispatch({type:'case.changed',caseId:'case-uuid',routeCaseId:'AT_42'});
  store.dispatch({type:'steps.selected',ids:['step']});
  assert.equal(selectionMatchesCaseRoute(store.snapshot(),'case-uuid','AT_42'),true);
  assert.equal(selectionMatchesCaseRoute(store.snapshot(),'case-uuid','AT_43'),false);
  assert.equal(selectionMatchesCaseRoute(store.snapshot(),'case-uuid',''),false);
  store.dispatch({type:'case.changed',caseId:'case-uuid',routeCaseId:'case-uuid'});
  assert.deepEqual(store.snapshot().stepIds,['step']);
  assert.equal(selectionMatchesCaseRoute(store.snapshot(),'case-uuid','case-uuid'),true);
  store.dispatch({type:'case.changed',caseId:'other-uuid',routeCaseId:'AT_43'});
  assert.equal(selectionMatchesCaseRoute(store.snapshot(),'case-uuid','AT_43'),false);
});
