const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { createRecordedSectionContract, recordedContractMetadata, readRecordedSectionArtifacts, validateRecordedContractMetadata } = require('../../backend/lib/automationRecordedContract');
const { createGenerationManifest, generationApplicability } = require('../../backend/lib/automationGenerationManifest');

const operation = (name, args) => ({ name, arguments: args });
const obligation = { id: 'section', source: 'section', action: 'Enter @t.name', expected_result: 'The name retains @t.name' };
const linked = { ...obligation, id: 'manual:case:step', source: 'manual_step', manual_test_case_id: 'manual-case', manual_step_id: 'manual-step' };
function fixture() {
  const execution = { required: true, step_id: 'section', obligations: [{ ...obligation }], source_obligations: [{ ...obligation }] };
  const requests = [operation('browser_fill', { locator: '#name', value: '@t.name' }), operation('browser_assert', { assertion: 'value', locator: '#name', value: '@t.name' })];
  return { execution, requests, source: compileRecordedProgram(requests).source, mappings: [{ id: 'section', action_operations: [1], assertion_operations: [2] }] };
}
const reject = (input, reason) => assert.throws(() => createRecordedSectionContract(input), error => error.code === 'AUTOMATION_RECORDED_CONTRACT_INVALID'
  && error.nonRetryable === true && (!reason || error.details.reason === reason) && !error.message.includes('@t.name'));
const seal = input => createRecordedSectionContract(input || fixture());
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('host seal binds exact serialized authored requirements, operation order, operators, references and compiler source', () => {
  const input = fixture(), before = JSON.stringify(input), contract = seal(input), artifacts = readRecordedSectionArtifacts(contract);
  assert.equal(JSON.stringify(input), before);
  assert.equal(contract.case_sha256, sha(artifacts.case_json));assert.equal(contract.plan_sha256, sha(artifacts.plan_json));
  assert.deepEqual(JSON.parse(artifacts.case_json).obligations, [obligation]);
  const plan = JSON.parse(artifacts.plan_json);
  assert.equal(plan.case_sha256, contract.case_sha256);assert.equal(plan.automation_code, input.source);
  assert.deepEqual(plan.operations, input.requests);assert.deepEqual(plan.coverage, input.mappings);
  assert.equal(contract.verification_status, 'unverified');assert.equal(contract.operation_count, 2);assert.equal(contract.assertion_count, 1);
  assert.equal(contract.mapped_assertion_count, 1);assert.equal(Object.isFrozen(contract), true);
  assert.equal(validateRecordedContractMetadata(recordedContractMetadata(contract)), true);
});

test('all public metadata contains only bounded digests/counts and no authored prose, locators or input values', () => {
  const input = fixture(), secret = 'private-name-value-do-not-disclose';
  input.execution.obligations[0].action = input.execution.source_obligations[0].action = `Enter ${secret}`;
  input.requests[0].arguments.value = secret;input.requests[1].arguments.value = secret;
  input.source = compileRecordedProgram(input.requests).source;
  const contract = seal(input), metadata = recordedContractMetadata(contract);
  assert.doesNotMatch(JSON.stringify(metadata), /private-name|#name|Enter|retains|@t\.name|automation_code|operations|obligations/);
  assert.equal(JSON.parse(readRecordedSectionArtifacts(contract).plan_json).operations[0].arguments.value, secret);
  assert.equal('approval_status' in metadata, false);assert.equal('replay_status' in metadata, false);
});

test('parsed metadata, forged objects and private artifact copies cannot issue or upgrade host provenance', () => {
  const contract = seal();
  for (const copy of [undefined, null, {}, { ...contract }, JSON.parse(JSON.stringify(contract))]) {
    assert.throws(() => recordedContractMetadata(copy), error => error.details.reason === 'host_seal_required');
    assert.throws(() => readRecordedSectionArtifacts(copy), error => error.details.reason === 'host_seal_required');
  }
});

test('mutable input and artifact copies cannot alter sealed identity or source', () => {
  const input = fixture(), contract = seal(input), before = readRecordedSectionArtifacts(contract);
  input.execution.source_obligations[0].expected_result = 'Only visible';input.requests[1].arguments.assertion = 'visible';input.mappings[0].assertion_operations.length = 0;
  const copy = readRecordedSectionArtifacts(contract);copy.case_json = 'tampered';
  assert.deepEqual(readRecordedSectionArtifacts(contract), before);
  assert.throws(() => recordedContractMetadata(contract, { stepId: 'other' }), error => error.details.reason === 'sealed_section_changed');
  assert.throws(() => recordedContractMetadata(contract, { source: fixture().source + '\n' }), error => error.details.reason === 'sealed_source_changed');
  assert.throws(() => recordedContractMetadata(contract, { execution: input.execution }), error => error.details.reason === 'sealed_requirements_changed');
});

test('source omission, extra code, changed input, changed operator and reordered operations reject exact source agreement', () => {
  const source = fixture().source;
  for (const candidateSource of [source.split('\n')[0], source + '\nawait page.locator("#other").click();', source.replace('toHaveValue', 'toContainText'), source.replace('@t.name', '@t.other'), source.split('\n').reverse().join('\n'), source + '\n', source.replace('\n', '\r\n')]) {
    reject({ ...fixture(), source: candidateSource }, 'compiled_source_mismatch');
  }
});

test('unsupported tools, injected source, extra operation fields and nonstring inputs reject before sealing', () => {
  for (const request of [operation('browser_evaluate', { code: 'globalThis.secret' }), operation('browser_click', { locator: 'getByLabel("Name"); process.exit()' }),
    { ...fixture().requests[0], approved: true }, operation('browser_fill', { locator: '#name', value: 1 }), operation('browser_assert', { assertion: 'visible', locator: '#name', value: 'ignored' }),
    { ...fixture().requests[0], navigation_intent: 'reload' }]) {
    reject({ ...fixture(), requests: [request, fixture().requests[1]] });
  }
});

test('missing or duplicate obligation mappings and omitted expectation checks reject', () => {
  for (const mappings of [undefined, [], [fixture().mappings[0], fixture().mappings[0]], [{ ...fixture().mappings[0], id: 'foreign' }],
    [{ ...fixture().mappings[0], assertion_operations: [] }], [{ ...fixture().mappings[0], approved: true }]]) reject({ ...fixture(), mappings });
  const input = fixture();input.execution.obligations.push({ ...linked });input.execution.source_obligations.push({ ...linked });
  reject({ ...input, mappings: [input.mappings[0], { ...input.mappings[0] }] }, 'coverage_identity_invalid');
});

test('out-of-range, duplicate, fractional and wrong-kind operation references reject', () => {
  for (const mapping of [{ action_operations: [1, 1] }, { assertion_operations: [2, 2] }, { assertion_operations: [1] }, { action_operations: [2] },
    { assertion_operations: [3] }, { assertion_operations: [0] }, { assertion_operations: [1.5] }, { assertion_operations: ['2'] }]) {
    reject({ ...fixture(), mappings: [{ ...fixture().mappings[0], ...mapping }] }, 'coverage_operation_invalid');
  }
});

test('mapped assertions must follow their obligation actions, while legitimate intermediate checkpoints retain order', () => {
  const input = fixture();
  input.requests = [input.requests[1], input.requests[0]];input.source = compileRecordedProgram(input.requests).source;
  input.mappings = [{ id: 'section', action_operations: [2], assertion_operations: [1] }];
  reject(input, 'assertion_precedes_action');
  const valid = fixture();
  valid.execution.obligations.push({ ...linked });valid.execution.source_obligations.push({ ...linked });
  valid.requests.push(operation('browser_fill', { locator: '#city', value: '@t.city' }), operation('browser_assert', { assertion: 'value', locator: '#city', value: '@t.city' }));
  valid.source = compileRecordedProgram(valid.requests).source;
  valid.mappings.push({ id: linked.id, action_operations: [3], assertion_operations: [4] });
  const contract = seal(valid);
  assert.equal(contract.operation_count, 4);assert.equal(contract.mapped_assertion_count, 2);
  assert.deepEqual(JSON.parse(readRecordedSectionArtifacts(contract).plan_json).coverage, valid.mappings);
});

test('section and linked manual requirements can share the same confirmed assertion without losing unique coverage rows', () => {
  const input = fixture();input.execution.obligations.push({ ...linked });input.execution.source_obligations.push({ ...linked });
  input.mappings.unshift({ id: linked.id, action_operations: [1], assertion_operations: [2] });
  const contract = seal(input), plan = JSON.parse(readRecordedSectionArtifacts(contract).plan_json);
  assert.equal(contract.obligation_count, 2);assert.equal(contract.mapped_assertion_count, 1);
  assert.deepEqual(plan.coverage.map(row => row.id), ['section', linked.id]);
});

test('authored whitespace, obligation order and qualified source identity change Case identity', () => {
  const baseline = seal();
  const whitespace = fixture();whitespace.execution.source_obligations[0].action += ' ';
  assert.notEqual(seal(whitespace).case_sha256, baseline.case_sha256);
  const input = fixture();input.execution.obligations.push({ ...linked });input.execution.source_obligations.push({ ...linked });
  input.mappings.push({ ...input.mappings[0], id: linked.id });const first = seal(input);
  input.execution.obligations.reverse();input.execution.source_obligations.reverse();
  assert.notEqual(seal(input).case_sha256, first.case_sha256);
  input.execution.source_obligations[0].manual_test_case_id = input.execution.obligations[0].manual_test_case_id = 'another-case';
  assert.notEqual(seal(input).case_sha256, first.case_sha256);
});

test('projected text may expand data, but projected goal IDs, order and source identities cannot change', () => {
  const input = fixture();input.execution.obligations[0].action = 'Enter configured name';
  const contract = seal(input);assert.equal(JSON.parse(readRecordedSectionArtifacts(contract).case_json).obligations[0].action, obligation.action);
  for (const change of [{ id: 'other' }, { source: 'other' }, { manual_test_case_id: 'foreign' }]) {
    const invalid = fixture();Object.assign(invalid.execution.obligations[0], change);reject(invalid, 'projected_obligation_identity_changed');
  }
  const duplicate = fixture();duplicate.execution.source_obligations.push({ ...obligation });reject(duplicate, 'obligation_invalid');
});

test('reviewed blank data remains an actual input and exact empty-string assertion value', () => {
  const input = fixture();input.requests[0].arguments.value = '';input.requests[1].arguments.value = '';
  input.source = compileRecordedProgram(input.requests).source;
  const plan = JSON.parse(readRecordedSectionArtifacts(seal(input)).plan_json);
  assert.equal(plan.operations[0].arguments.value, '');assert.equal(plan.operations[1].arguments.value, '');
  assert.match(plan.automation_code, /fill\(""\)/);assert.match(plan.automation_code, /toHaveValue\(""\)/);
});

test('action-only authored requirement can have no assertion mapping without inventing an expected result', () => {
  const input = fixture();input.execution.obligations[0].expected_result = input.execution.source_obligations[0].expected_result = '';
  input.requests.pop();input.source = compileRecordedProgram(input.requests).source;input.mappings[0].assertion_operations = [];
  const contract = seal(input);assert.equal(contract.assertion_count, 0);assert.equal(contract.mapped_assertion_count, 0);
});

test('navigation reload intent and changed references/operators remain in Plan identity', () => {
  const input = fixture();input.requests.unshift(operation('browser_navigate', { url: 'https://fixture.example/' }));
  input.mappings[0].action_operations = [1, 2];input.mappings[0].assertion_operations = [3];input.source = compileRecordedProgram(input.requests).source;
  const baseline = seal(input);
  input.requests[0].navigation_intent = 'reload';assert.notEqual(seal(input).plan_sha256, baseline.plan_sha256);
  delete input.requests[0].navigation_intent;input.requests[1].arguments.value = '@t.another';input.source = compileRecordedProgram(input.requests).source;
  assert.notEqual(seal(input).plan_sha256, baseline.plan_sha256);
  input.requests[2].arguments.assertion = 'text';input.source = compileRecordedProgram(input.requests).source;
  assert.notEqual(seal(input).plan_sha256, baseline.plan_sha256);
});

test('existing manifest accepts only a host seal for the same source/section and preserves legacy applicability', () => {
  const input = fixture(), contract = seal(input), step = { id: 'section', action: obligation.action, expected_result: obligation.expected_result, step_type: 'web', step_order: 1 };
  const update = { automation_code: input.source, step_type: 'web' };
  const metadata = { testCaseId: 'case', step, update, recordedContract: contract };
  const manifest = createGenerationManifest(metadata);
  assert.deepEqual(manifest.recorded_contract, recordedContractMetadata(contract));assert.equal(manifest.verification_status, 'unverified');
  assert.equal(generationApplicability({ manifest, testCaseId: 'case', currentStep: { ...step, ...update } }).status, 'current');
  assert.throws(() => createGenerationManifest({ ...metadata, recordedContract: { ...contract } }), error => error.details.reason === 'host_seal_required');
  assert.throws(() => createGenerationManifest({ ...metadata, step: { ...step, id: 'foreign' } }), error => error.details.reason === 'sealed_section_changed');
  assert.throws(() => createGenerationManifest({ ...metadata, update: { ...update, automation_code: update.automation_code + '\n' } }), error => error.details.reason === 'sealed_source_changed');
  assert.throws(() => createGenerationManifest({ ...metadata, step: { ...step, expected_result: 'Only visible' } }), error => error.details.reason === 'sealed_requirements_changed');
  assert.equal(generationApplicability({ manifest: { ...manifest, recorded_contract: { ...manifest.recorded_contract, verification_status: 'passed' } }, testCaseId: 'case', currentStep: { ...step, ...update } }).status, 'unknown');
  const legacy = createGenerationManifest({ testCaseId: 'case', step, update });
  assert.equal('recorded_contract' in legacy, false);assert.equal(generationApplicability({ manifest: legacy, testCaseId: 'case', currentStep: { ...step, ...update } }).status, 'current');
});

test('manifest cannot bind a sealed manual requirement to changed or missing live source records', () => {
  const input = fixture();input.execution.obligations.push({ ...linked });input.execution.source_obligations.push({ ...linked });
  input.mappings.push({ ...input.mappings[0], id: linked.id });
  const contract = seal(input), step = { id: 'section', action: obligation.action, expected_result: obligation.expected_result, step_type: 'web' };
  const update = { automation_code: input.source }, manualSpecification = [{ ...linked }];
  const options = { testCaseId: 'case', step, update, recordedContract: contract, manualSpecification };
  assert.equal(createGenerationManifest(options).recorded_contract.plan_sha256, contract.plan_sha256);
  assert.throws(() => createGenerationManifest({ ...options, manualSpecification: [] }), error => error.details.reason === 'sealed_manual_requirements_changed');
  assert.throws(() => createGenerationManifest({ ...options, manualSpecification: [{ ...linked, expected_result: 'Only visible' }] }), error => error.details.reason === 'sealed_manual_requirements_changed');
});

test('malformed public projections cannot claim replay, approval, impossible counts or foreign schema', () => {
  const metadata = recordedContractMetadata(seal());
  for (const change of [{ verification_status: 'passed' }, { approval_status: 'approved' }, { schema_version: 2 }, { case_sha256: null }, { operation_count: 0 },
    { assertion_count: 3 }, { mapped_assertion_count: 2 }, { obligation_count: 0 }, { operation_count: 1.5 }, { plan_sha256: 'x'.repeat(64) }]) assert.equal(validateRecordedContractMetadata({ ...metadata, ...change }), false);
});
