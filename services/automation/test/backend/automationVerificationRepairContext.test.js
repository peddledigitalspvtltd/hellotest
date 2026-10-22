const { expandManagedInstructions } = require('../../../platform/backend/test/helpers/managedInstructions');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerificationRepairContext } = require('../../backend/lib/automationVerificationRepairContext');
const { applyLocatorRepair } = require('../../backend/lib/automationVerificationPipeline');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');

const operation = value => ({ name: 'browser_fill', arguments: { locator: '#old-name', value } });
const requirement = { step_id: 'manual:name', action: 'Enter @r.name', expected_result: 'The name retains @r.name' };
const failure = { step_id: requirement.step_id, operation_index: 2, operation_kind: 'browser_fill',
  code: 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED', action_outcome: 'not_attempted', summary: 'The saved locator did not resolve.' };
const target = (index = 0, extra = {}) => ({ tag: 'input', accessible_role: 'textbox', accessible_name: `Name ${index}`,
  displayed: true, disabled: false, in_viewport: true, locators_validated: true, locator_candidates: [`#current-name-${index}`], ...extra });
const snapshot = (extra = {}) => ({ source: 'playwright', observation_id: 'native-capture-id', url: 'https://app.test/profile',
  title: 'Profile', scope: 'body', accessibility: '- main\n  - textbox "Name"', elements: [target()], ...extra });
const options = extra => ({ requirement: structuredClone(requirement), failedOperation: operation('@r.name'), failure: structuredClone(failure), snapshot: snapshot(), ...extra });
const proposal = (context, extra = {}) => ({ step_id: requirement.step_id, operation_index: failure.operation_index,
  locator: context.packet.current_snapshot.targets[0]?.ref, ...extra });

test('repair context exposes exact proposal identity and opaque current targets with no portable locator map', () => {
  const input = options(), before = structuredClone(input), context = createVerificationRepairContext(input);
  assert.deepEqual(context.packet.requirement, input.requirement);
  assert.deepEqual(context.packet.failed_operation, input.failedOperation);
  assert.deepEqual(context.packet.failure, input.failure);
  assert.equal(context.packet.current_snapshot.observation_id, input.snapshot.observation_id);
  const choices = context.packet.response_contract.return_one_of;
  assert.deepEqual(choices, [{ step_id: requirement.step_id, operation_index: 2, locator: 'One exact ref from current_snapshot.targets.' }, {}]);
  assert.equal(context.packet.response_contract.extra_keys, false);
  assert.match(expandManagedInstructions(context.packet.response_contract.instruction), /preserve every action, parameter binding, input value and assertion/);
  assert.doesNotMatch(JSON.stringify(context.packet.current_snapshot), /#current-name|locator_candidates|attributes|"value":/);
  assert.deepEqual(context.resolveProposal(proposal(context)), { step_id: requirement.step_id, operation_index: 2, locator: '#current-name-0' });
  assert.deepEqual(input, before);
});

test('large page evidence stays bounded and omitted targets do not acquire repair authority', () => {
  const page = snapshot({ accessibility: 'Page contents '.repeat(100_000), elements: Array.from({ length: 2000 }, (_, index) => target(index, {
    accessible_name: `Name ${index} ${'n'.repeat(500)}`, text: 'hidden or decorative text'.repeat(1000)
  })) });
  const before = JSON.stringify(page), context = createVerificationRepairContext(options({ snapshot: page }));
  const current = context.packet.current_snapshot;
  assert.ok(JSON.stringify(current).length <= 16_000);
  assert.ok(current.targets.length > 0 && current.targets.length < 120);
  assert.equal(current.partial, true);assert.equal(current.targets_omitted, true);assert.equal(current.accessibility_truncated, true);
  assert.ok(current.targets.every(row => row.name_truncated));
  assert.deepEqual(context.resolveProposal(proposal(context)), { step_id: requirement.step_id, operation_index: 2, locator: '#current-name-0' });
  const epoch = current.targets[0].ref.split(':')[1];
  assert.deepEqual(context.resolveProposal(proposal(context, { locator: `ref:${epoch}:120` })), {});
  assert.equal(JSON.stringify(page), before);
});

test('missing native capture provenance or validated targets never receives invented references', () => {
  for (const page of [undefined, {}, snapshot({ source: 'model' }), snapshot({ observation_id: undefined }), snapshot({ observation_id: '' }),
    snapshot({ elements: [] }), snapshot({ elements: [target(0, { locators_validated: false })] }),
    snapshot({ elements: [target(0, { locator_candidates: [] })] }), { targets: [{ ref: 'ref:abcdefabcdef:1', locator: '#invented' }] }]) {
    const context = createVerificationRepairContext(options({ snapshot: page }));
    assert.deepEqual(context.packet.current_snapshot.targets, []);
    assert.equal(context.packet.current_snapshot.targets_unavailable, true);
    assert.deepEqual(context.packet.response_contract.return_one_of, [{}]);
    assert.deepEqual(context.resolveProposal({ step_id: requirement.step_id, operation_index: 2, locator: 'ref:abcdefabcdef:1' }), {});
  }
});

test('raw, guessed, malformed, foreign-epoch and wrong-identity proposals fail closed', () => {
  const context = createVerificationRepairContext(options());
  for (const invalid of [null, [], {}, '#current-name-0', proposal(context, { locator: '#current-name-0' }),
    proposal(context, { locator: 'ref:abcdefabcdef:1' }), proposal(context, { locator: 'ref:bad:1' }),
    proposal(context, { step_id: 'different-step' }), proposal(context, { operation_index: 1 }),
    proposal(context, { operation_index: '2' }), proposal(context, { value: 'replacement-data' }),
    proposal(context, { assertion: 'visible' }), proposal(context, { arguments: { locator: '#invented' } })]) {
    assert.deepEqual(context.resolveProposal(invalid), {});
  }
});

test('model-copied metadata and changed packet identity cannot replace the private locator binding', () => {
  const context = createVerificationRepairContext(options()), original = proposal(context);
  const publicCopy = structuredClone(context.packet);
  publicCopy.current_snapshot.targets[0].locator_candidates = ['#forged'];
  publicCopy.current_snapshot.targets[0].attributes = { 'data-testid': 'forged' };
  context.packet.requirement.step_id = 'changed-public-identity';
  context.packet.failed_operation.arguments.value = 'changed-public-data';
  context.packet.current_snapshot.targets[0].ref = 'ref:abcdefabcdef:1';
  assert.deepEqual(context.resolveProposal({ ...original, snapshot: publicCopy.current_snapshot }), {});
  assert.deepEqual(context.resolveProposal(original), { step_id: requirement.step_id, operation_index: 2, locator: '#current-name-0' });
  assert.deepEqual(context.resolveProposal(proposal(context)), {});
});

test('another context built from a copied native snapshot has independent opaque references', () => {
  const first = createVerificationRepairContext(options()), second = createVerificationRepairContext(options({ snapshot: structuredClone(snapshot()) }));
  assert.notEqual(first.packet.current_snapshot.targets[0].ref, second.packet.current_snapshot.targets[0].ref);
  assert.deepEqual(first.resolveProposal(proposal(second)), {});
  assert.deepEqual(second.resolveProposal(proposal(first)), {});
});

test('caller mutation of the snapshot cannot retarget an existing model reference', () => {
  const input = options(), context = createVerificationRepairContext(input), chosen = proposal(context);
  input.snapshot.observation_id = 'new-capture';
  input.snapshot.elements[0].locator_candidates[0] = '#replaced-by-caller';
  input.snapshot.elements.push(target(1));
  input.failedOperation.arguments.value = 'changed-data';input.failure.operation_index = 99;
  assert.deepEqual(context.resolveProposal(chosen), { step_id: requirement.step_id, operation_index: 2, locator: '#current-name-0' });
  assert.equal(context.packet.failed_operation.arguments.value, '@r.name');
  assert.equal(context.packet.failure.operation_index, 2);
});

test('data and parameter bindings remain exact through context and final locator-only host repair', () => {
  for (const value of ['@r.name', 'params["r.privateName"]', 'Exact public literal', '', 'prefix @r.name literal']) {
    const fill = operation(value), check = { name: 'browser_assert', arguments: { assertion: 'value', locator: fill.arguments.locator, value } };
    const context = createVerificationRepairContext(options({ failedOperation: fill }));
    assert.equal(context.packet.failed_operation.arguments.value, value);
    assert.equal(context.packet.requirement.action, requirement.action);
    const operations = [{ name: 'browser_navigate', arguments: { url: 'https://app.test/profile' } }, fill, check];
    const section = { ...requirement, operations, automation_code: compileRecordedProgram(operations).source };
    const before = structuredClone(section), repaired = applyLocatorRepair([section], failure, context.resolveProposal(proposal(context)), snapshot());
    assert.ok(repaired);assert.equal(repaired[0].operations[1].arguments.value, value);assert.equal(repaired[0].operations[2].arguments.value, value);
    assert.equal(repaired[0].operations[2].arguments.assertion, 'value');
    assert.equal(repaired[0].operations[1].arguments.locator, '#current-name-0');
    assert.deepEqual(repaired[0].operations[2], before.operations[2], 'the complete saved assertion remains unchanged');
    assert.deepEqual(section, before);
  }
});

test('native explicit test-ID preference stays private and final repair still requires actual uniqueness', () => {
  const stable = 'getByTestId("profile.name")';
  const page = snapshot({ elements: [target(0, { attributes: { 'data-testid': 'profile.name' }, locator_candidates: ['#dynamic-name', stable] })] });
  const context = createVerificationRepairContext(options({ snapshot: page }));
  assert.deepEqual(context.resolveProposal(proposal(context)), { step_id: requirement.step_id, operation_index: 2, locator: stable });
  assert.doesNotMatch(JSON.stringify(context.packet.current_snapshot), /profile\.name|getByTestId|#dynamic-name/);
  const operations = [{ name: 'browser_navigate', arguments: { url: 'https://app.test/profile' } }, operation('@r.name')];
  const rows = [{ ...requirement, operations, automation_code: compileRecordedProgram(operations).source }];
  const duplicate = snapshot({ elements: [target(), target(1, { locator_candidates: ['#current-name-0'] })] });
  const duplicateContext = createVerificationRepairContext(options({ snapshot: duplicate }));
  assert.equal(applyLocatorRepair(rows, failure, duplicateContext.resolveProposal(proposal(duplicateContext)), duplicate), null);
});

test('bounded relationships omit hidden target references and mark the evidence incomplete', () => {
  const elements = Array.from({ length: 120 }, (_, index) => target(index, {
    accessible_name: 'n'.repeat(180), attributes: { id: `node-${index}`, ...(index === 0 ? { 'aria-describedby': 'node-119' } : {}) }
  }));
  const context = createVerificationRepairContext(options({ snapshot: snapshot({ elements }) }));
  const current = context.packet.current_snapshot, relationship = current.targets[0].field_relationships;
  assert.equal(current.targets_omitted, true);assert.ok(current.targets.length < 120);
  assert.deepEqual(relationship.description_refs, []);assert.deepEqual(relationship.error_refs, []);
  assert.equal(relationship.relationship_refs_incomplete, true);
  assert.doesNotMatch(JSON.stringify(current), /node-119/);
});

test('missing or ineligible operation identity permits only the no-repair response', () => {
  for (const changed of [{ failure: { ...failure, action_outcome: 'unknown' } }, { failure: { ...failure, step_id: 'other' } },
    { failure: { ...failure, operation_index: 0 } }, { failure: { ...failure, code: 'AUTOMATION_VERIFICATION_ASSERTION_FAILED' } },
    { failedOperation: { name: 'browser_assert', arguments: { assertion: 'value', locator: '#old-name', value: '@r.name' } } },
    { failedOperation: { name: 'browser_fill', arguments: { value: '@r.name' } } }, { requirement: undefined }]) {
    const context = createVerificationRepairContext(options(changed));
    assert.deepEqual(context.packet.response_contract.return_one_of, [{}]);
    assert.deepEqual(context.resolveProposal({ step_id: requirement.step_id, operation_index: 2, locator: 'ref:abcdefabcdef:1' }), {});
  }
});
