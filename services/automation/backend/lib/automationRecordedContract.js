const { createHash } = require('node:crypto');
const { compileRecordedProgram } = require('./automationRecordedProgram');

// This seal binds a host compiler candidate, not an approval or fresh replay.
// Callers must obtain requests from the protected browser recording and pass
// only the accepted review's mappings. Serialized metadata cannot issue a seal.
const issued = new WeakMap();
const MAX_OBLIGATIONS = 201, MAX_CASE_BYTES = 256_000;
const metadataKeys = ['schema_version', 'kind', 'algorithm', 'case_sha256', 'plan_sha256',
  'obligation_count', 'operation_count', 'assertion_count', 'mapped_assertion_count', 'verification_status'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const failure = reason => Object.assign(new Error('The host-recorded section contract does not match its authored requirements, confirmed operations and accepted coverage. The candidate was not sealed.'), {
  code: 'AUTOMATION_RECORDED_CONTRACT_INVALID', statusCode: 422, nonRetryable: true, details: { reason }
});
const requireThat = (condition, reason) => { if (!condition) throw failure(reason); };

function authoredCase(execution) {
  requireThat(plain(execution) && execution.required === true && typeof execution.step_id === 'string'
    && execution.step_id.length > 0 && execution.step_id.length <= 200, 'section_identity_invalid');
  const input = execution.source_obligations ?? execution.obligations ?? [{ id: execution.step_id, source: 'section',
    action: execution.action ?? '', expected_result: execution.expected_result ?? '' }];
  requireThat(Array.isArray(input) && input.length > 0 && input.length <= MAX_OBLIGATIONS, 'obligations_invalid');
  const seen = new Set(), obligations = [];
  for (const row of input) {
    requireThat(plain(row) && Object.keys(row).every(key => ['id', 'source', 'action', 'expected_result', 'manual_test_case_id', 'manual_step_id'].includes(key))
      && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 4000 && !seen.has(row.id)
      && typeof row.source === 'string' && row.source.length > 0 && row.source.length <= 100
      && typeof row.action === 'string' && row.action.length <= 20_000
      && typeof row.expected_result === 'string' && row.expected_result.length <= 20_000
      && Boolean(row.action.trim() || row.expected_result.trim()), 'obligation_invalid');
    const identityKeys = ['manual_test_case_id', 'manual_step_id'];
    requireThat(identityKeys.every(key => row[key] === undefined || typeof row[key] === 'string' && row[key].length > 0 && row[key].length <= 200), 'manual_identity_invalid');
    requireThat(identityKeys.every(key => Object.hasOwn(row, key)) || identityKeys.every(key => !Object.hasOwn(row, key)), 'manual_identity_incomplete');
    seen.add(row.id);
    obligations.push({ id: row.id, source: row.source, action: row.action, expected_result: row.expected_result,
      ...(Object.hasOwn(row, 'manual_test_case_id') ? { manual_test_case_id: row.manual_test_case_id, manual_step_id: row.manual_step_id } : {}) });
  }
  // The original and projected goals must retain their exact authorized IDs,
  // source, ordering and qualified manual identity. Projected text may differ.
  if (execution.source_obligations !== undefined && execution.obligations !== undefined) {
    requireThat(Array.isArray(execution.obligations) && execution.obligations.length === obligations.length
      && obligations.every((row, index) => {
        const projected = execution.obligations[index];
        return plain(projected) && projected.id === row.id && projected.source === row.source
          && ['manual_test_case_id', 'manual_step_id'].every(key => projected[key] === row[key]);
      }), 'projected_obligation_identity_changed');
  }
  const value = { schema_version: 1, kind: 'authored_section_requirements', step_id: execution.step_id, obligations };
  const bytes = JSON.stringify(value);
  requireThat(Buffer.byteLength(bytes, 'utf8') <= MAX_CASE_BYTES, 'authored_requirements_too_large');
  return { value, bytes };
}

function operationPlan(requests) {
  requireThat(Array.isArray(requests) && requests.length > 0 && requests.length <= 250, 'operations_invalid');
  return requests.map(request => {
    requireThat(plain(request) && typeof request.name === 'string' && plain(request.arguments)
      && Object.keys(request).every(key => ['name', 'arguments', 'navigation_intent'].includes(key))
      && (request.navigation_intent === undefined || request.name === 'browser_navigate' && request.navigation_intent === 'reload'), 'operation_shape_invalid');
    const args = Object.fromEntries(Object.keys(request.arguments).sort().map(key => {
      const value = request.arguments[key];
      requireThat(typeof value === 'string' && value.length <= 2000, 'operation_argument_invalid');
      return [key, value];
    }));
    return { name: request.name, arguments: args, ...(request.navigation_intent ? { navigation_intent: request.navigation_intent } : {}) };
  });
}

function acceptedCoverage(mappings, obligations, requests) {
  requireThat(Array.isArray(mappings) && mappings.length === obligations.length, 'coverage_incomplete');
  const byId = new Map(), assertions = new Set();
  for (const row of mappings) {
    requireThat(exactKeys(row, ['id', 'action_operations', 'assertion_operations']) && typeof row.id === 'string'
      && !byId.has(row.id) && obligations.some(item => item.id === row.id), 'coverage_identity_invalid');
    for (const [key, assertion] of [['action_operations', false], ['assertion_operations', true]]) {
      const indexes = row[key];
      requireThat(Array.isArray(indexes) && indexes.length <= requests.length && new Set(indexes).size === indexes.length
        && indexes.every(index => Number.isSafeInteger(index) && index > 0 && index <= requests.length
          && (requests[index - 1].name === 'browser_assert') === assertion), 'coverage_operation_invalid');
      // Coverage preserves actual execution order even if a reviewer lists
      // supported operations in another order. It never reorders the program.
    }
    const actions = [...row.action_operations].sort((left, right) => left - right);
    const checks = [...row.assertion_operations].sort((left, right) => left - right);
    const obligation = obligations.find(item => item.id === row.id);
    requireThat(!obligation.expected_result.trim() || checks.length > 0, 'expectation_coverage_missing');
    requireThat(checks.every(index => index > Math.max(0, ...actions)), 'assertion_precedes_action');
    checks.forEach(index => assertions.add(index));
    byId.set(row.id, { id: row.id, action_operations: actions, assertion_operations: checks });
  }
  return { mappings: obligations.map(row => byId.get(row.id)), mappedAssertionCount: assertions.size };
}

/** Seal the exact serialized Case/Plan byte snapshots after host compilation.
 * Assertion predicates remain the recorded predicates; this function does not
 * interpret prose, infer business identity, approve a binding or run a browser. */
function createRecordedSectionContract({ execution, requests, source, mappings } = {}) {
  const authored = authoredCase(execution), operations = operationPlan(requests);
  const compiled = compileRecordedProgram(operations);
  requireThat(compiled && typeof source === 'string' && source === compiled.source, 'compiled_source_mismatch');
  const coverage = acceptedCoverage(mappings, authored.value.obligations, operations);
  const caseHash = digest(authored.bytes);
  const plan = { schema_version: 1, kind: 'host_recorded_section_plan', step_id: execution.step_id,
    case_sha256: caseHash, operations, coverage: coverage.mappings, automation_code: compiled.source };
  const planBytes = JSON.stringify(plan);
  const metadata = Object.freeze({ schema_version: 1, kind: 'host_recorded_section_contract', algorithm: 'sha256',
    case_sha256: caseHash, plan_sha256: digest(planBytes), obligation_count: authored.value.obligations.length,
    operation_count: compiled.operation_count, assertion_count: compiled.assertion_count,
    mapped_assertion_count: coverage.mappedAssertionCount, verification_status: 'unverified' });
  issued.set(metadata, { caseBytes: authored.bytes, planBytes, source: compiled.source, stepId: execution.step_id,
    obligations: authored.value.obligations });
  return metadata;
}

/** A digest/count projection is safe to retain in existing generation metadata.
 * A parsed copy is not a host-issued capability and cannot add provenance. */
function recordedContractMetadata(seal, { source, stepId, section, manualSpecification, execution } = {}) {
  const state = issued.get(seal);
  requireThat(state, 'host_seal_required');
  requireThat(source === undefined || source === state.source, 'sealed_source_changed');
  requireThat(stepId === undefined || stepId === state.stepId, 'sealed_section_changed');
  requireThat(execution === undefined || authoredCase(execution).bytes === state.caseBytes, 'sealed_requirements_changed');
  if (section !== undefined) {
    const original = state.obligations.find(row => row.id === state.stepId && row.source === 'section');
    requireThat(plain(section) && original && (section.id || section.step_id) === state.stepId
      && (section.action ?? '') === original.action && (section.expected_result ?? '') === original.expected_result, 'sealed_requirements_changed');
  }
  if (manualSpecification !== undefined) {
    requireThat(Array.isArray(manualSpecification), 'sealed_manual_requirements_changed');
    for (const original of state.obligations.filter(row => row.manual_test_case_id !== undefined)) {
      const matches = manualSpecification.filter(row => plain(row)
        && (row.manual_test_case_id || row.test_case_id) === original.manual_test_case_id
        && (row.manual_step_id || row.id) === original.manual_step_id);
      requireThat(matches.length === 1 && (matches[0].action ?? '') === original.action
        && (matches[0].expected_result ?? '') === original.expected_result, 'sealed_manual_requirements_changed');
    }
  }
  return { ...seal };
}

/** Host-only artifact access. These exact UTF-8 snapshots contain authored
 * requirements and operation arguments; never put them into public metadata. */
function readRecordedSectionArtifacts(seal) {
  const state = issued.get(seal);
  requireThat(state, 'host_seal_required');
  return { case_json: state.caseBytes, plan_json: state.planBytes };
}

function validateRecordedContractMetadata(value) {
  return exactKeys(value, metadataKeys) && value.schema_version === 1 && value.kind === 'host_recorded_section_contract'
    && value.algorithm === 'sha256' && typeof value.case_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.case_sha256)
    && typeof value.plan_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.plan_sha256)
    && Number.isSafeInteger(value.obligation_count) && value.obligation_count > 0 && value.obligation_count <= MAX_OBLIGATIONS
    && Number.isSafeInteger(value.operation_count) && value.operation_count > 0 && value.operation_count <= 250
    && Number.isSafeInteger(value.assertion_count) && value.assertion_count >= 0 && value.assertion_count <= value.operation_count
    && Number.isSafeInteger(value.mapped_assertion_count) && value.mapped_assertion_count >= 0 && value.mapped_assertion_count <= value.assertion_count
    && value.verification_status === 'unverified';
}

module.exports = { createRecordedSectionContract, recordedContractMetadata, readRecordedSectionArtifacts, validateRecordedContractMetadata };
