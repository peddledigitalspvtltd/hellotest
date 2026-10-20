const { createHash } = require('node:crypto');

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value : '';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function apiRequest(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } }
  return value || null;
}
function sourceVersion(step, update = step) {
  return hash({ step_type: update.step_type || step.step_type || 'web', automation_code: text(update.automation_code) || null, api_request: apiRequest(update.api_request) });
}
function specificationVersion({ testCaseId, step }) {
  return hash({ test_case_id: testCaseId, step_id: step.id || step.step_id, step_order: Number(step.step_order) || 0,
    step_type: step.step_type || 'web', action: text(step.action), expected_result: text(step.expected_result),
    group_id: step.group_id || null, group_name: step.group_name || null, group_kind: step.group_kind || null, reusable_group_id: step.reusable_group_id || null });
}
function manualIdentity(row) {
  return { manual_test_case_id: row.manual_test_case_id || row.test_case_id, manual_step_id: row.manual_step_id || row.id };
}
function manualVersion(row) {
  const identity = manualIdentity(row);
  return specificationVersion({ testCaseId: identity.manual_test_case_id, step: { ...row, id: identity.manual_step_id } });
}

/** Host inputs only. Generated candidate fields cannot assert compiler/review
 * provenance, and hashes never duplicate source, literals or private test data. */
function createGenerationManifest({ testCaseId, step, update, manualCoverage = [], manualSpecification = [], generationProvenance = {}, recordedContract }) {
  const rows = Array.isArray(manualSpecification) ? manualSpecification : [];
  const coverage = (Array.isArray(manualCoverage) ? manualCoverage : []).filter(row => row.section_step_id === step.id);
  const manuals = [], seen = new Set();
  let complete = true;
  for (const mapping of coverage) {
    const matches = rows.filter(row => { const id = manualIdentity(row);return id.manual_step_id === mapping.manual_step_id && (!mapping.manual_test_case_id || id.manual_test_case_id === mapping.manual_test_case_id); });
    if (matches.length !== 1) { complete = false;continue; }
    const identity = manualIdentity(matches[0]);
    if (typeof identity.manual_test_case_id !== 'string' || typeof identity.manual_step_id !== 'string') { complete = false;continue; }
    const key = JSON.stringify(identity);
    if (!seen.has(key)) { seen.add(key);manuals.push({ ...identity, specification_sha256: manualVersion(matches[0]) }); }
  }
  manuals.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const provenance = record(generationProvenance);
  const origin = ['confirmed_browser_operations', 'model_generated'].includes(provenance.source_origin) ? provenance.source_origin : 'unknown';
  const compiler = ['recorded_playwright_v1', 'normalized_runtime_v1'].includes(provenance.compiler) ? provenance.compiler : 'unknown';
  const contract = recordedContract === undefined ? undefined : require('./automationRecordedContract').recordedContractMetadata(recordedContract, {
    stepId: step.id || step.step_id, source: text((update || step).automation_code), section: step, manualSpecification: rows
  });
  return { schema_version: 1, algorithm: 'sha256', source_sha256: sourceVersion(step, update), specification_sha256: specificationVersion({ testCaseId, step }),
    manual_specification: manuals, manual_specification_status: complete ? 'bound' : 'unavailable',
    source_origin: origin, compiler, review_status: provenance.review_status === 'accepted' ? 'accepted' : 'not_performed', verification_status: 'unverified',
    ...(contract ? { recorded_contract: contract } : {}) };
}

/** Compare with fresh scoped Plan records without returning their source or
 * specification. History stays readable when a record is edited or removed. */
function generationApplicability({ manifest, testCaseId, currentStep, currentManualSteps = [] }) {
  const value = record(manifest);
  const unknown = reason => ({ status: 'unknown', reasons: [reason] });
  if (value.schema_version !== 1 || value.algorithm !== 'sha256' || !digest(value.source_sha256) || !digest(value.specification_sha256)
    || value.verification_status !== 'unverified' || !Array.isArray(value.manual_specification) || !['bound', 'unavailable'].includes(value.manual_specification_status)) return unknown('generation_version_unavailable');
  if (value.recorded_contract !== undefined && !require('./automationRecordedContract').validateRecordedContractMetadata(value.recorded_contract)) return unknown('recorded_contract_unavailable');
  if (!currentStep) return { status: 'historical', reasons: ['section_removed'] };
  const reasons = [];
  if (sourceVersion(currentStep) !== value.source_sha256) reasons.push('source_changed');
  if (specificationVersion({ testCaseId, step: currentStep }) !== value.specification_sha256) reasons.push('specification_changed');
  for (const expected of value.manual_specification) {
    if (!expected || typeof expected.manual_test_case_id !== 'string' || typeof expected.manual_step_id !== 'string' || !digest(expected.specification_sha256)) return unknown('generation_version_unavailable');
    const matches = currentManualSteps.filter(row => { const id = manualIdentity(row);return id.manual_test_case_id === expected.manual_test_case_id && id.manual_step_id === expected.manual_step_id; });
    if (matches.length !== 1 || manualVersion(matches[0]) !== expected.specification_sha256) reasons.push('manual_specification_changed');
  }
  if (reasons.length) return { status: 'historical', reasons: [...new Set(reasons)] };
  if (value.manual_specification_status !== 'bound') return unknown('manual_specification_unavailable');
  return { status: 'current', reasons: [] };
}

module.exports = { createGenerationManifest, generationApplicability };
