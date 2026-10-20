const test = require('node:test');
const assert = require('node:assert/strict');
const { createGenerationManifest, generationApplicability } = require('../../backend/lib/automationGenerationManifest');

const step = { id: 'section', test_case_id: 'automation', step_order: 2, step_type: 'web', action: 'Save @t.address', expected_result: 'The address is saved' };
const update = { automation_code: 'await page.getByRole("button", {name:"Save"}).click(); await expect(page.getByRole("status")).toContainText("Saved");', api_request: null, step_type: 'web' };
const manual = { manual_test_case_id: 'manual', manual_step_id: 'source', step_order: 1, step_type: 'web', action: 'Save @t.address', expected_result: 'Confirmation and the updated row are displayed' };
const inputs = { testCaseId: 'automation', step, update, manualCoverage: [{ manual_test_case_id: 'manual', manual_step_id: 'source', section_step_id: 'section' }], manualSpecification: [manual] };
const current = { ...step, ...update };
const applicability = (manifest, overrides = {}) => generationApplicability({ manifest, testCaseId: 'automation', currentStep: current, currentManualSteps: [manual], ...overrides });

test('generation manifest binds the exact normalized source and covered authored specification without copying their contents', () => {
  const manifest = createGenerationManifest(inputs);
  assert.equal(manifest.schema_version, 1);assert.match(manifest.source_sha256, /^[a-f0-9]{64}$/);assert.match(manifest.specification_sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.manual_specification[0].specification_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(manifest), /await|Confirmation|address|automation_code|expected_result/);
  assert.equal(manifest.source_origin, 'unknown');assert.equal(manifest.review_status, 'not_performed');assert.equal(manifest.verification_status, 'unverified');
  assert.deepEqual(applicability(manifest), { status: 'current', reasons: [] });
});

test('source edits make a retained generation historical without changing the immutable manifest', () => {
  const manifest = createGenerationManifest(inputs), before = JSON.stringify(manifest);
  const outcome = applicability(manifest, { currentStep: { ...current, automation_code: update.automation_code + '\nawait page.getByRole("button", {name:"Continue"}).click();' } });
  assert.deepEqual(outcome, { status: 'historical', reasons: ['source_changed'] });assert.equal(JSON.stringify(manifest), before);
});

test('action, expected result, runtime, order and group edits invalidate the matching generation version', () => {
  const manifest = createGenerationManifest(inputs);
  for (const change of [{ action: 'Save a different address' }, { expected_result: 'Only the row is displayed' }, { step_type: 'android' }, { step_order: 4 }, { group_id: 'setup' }, { group_kind: 'reusable', reusable_group_id: 'shared' }]) {
    const outcome = applicability(manifest, { currentStep: { ...current, ...change } });
    assert.equal(outcome.status, 'historical');assert.ok(outcome.reasons.includes('specification_changed'));
  }
});

test('covered manual edits and removed links make generation historical even when the automation source is unchanged', () => {
  const manifest = createGenerationManifest(inputs);
  for (const currentManualSteps of [[], [{ ...manual, action: 'Save and submit' }], [{ ...manual, expected_result: 'An additional receipt must appear' }], [{ ...manual, step_order: 3 }], [{ ...manual, manual_test_case_id: 'other' }]]) {
    assert.deepEqual(applicability(manifest, { currentManualSteps }), { status: 'historical', reasons: ['manual_specification_changed'] });
  }
});

test('unbound source manual coverage and legacy previews remain readable with explicitly unknown applicability', () => {
  assert.deepEqual(applicability(undefined), { status: 'unknown', reasons: ['generation_version_unavailable'] });
  const manifest = createGenerationManifest({ ...inputs, manualSpecification: [] });
  assert.equal(manifest.manual_specification_status, 'unavailable');assert.deepEqual(applicability(manifest), { status: 'unknown', reasons: ['manual_specification_unavailable'] });
  assert.deepEqual(applicability(createGenerationManifest(inputs), { currentStep: undefined }), { status: 'historical', reasons: ['section_removed'] });
});

test('only the host provenance argument can claim the recorded compiler and an accepted review', () => {
  const spoofed = createGenerationManifest({ ...inputs, update: { ...update, source_origin: 'confirmed_browser_operations', compiler: 'recorded_playwright_v1', review_status: 'accepted' } });
  assert.equal(spoofed.source_origin, 'unknown');assert.equal(spoofed.compiler, 'unknown');assert.equal(spoofed.review_status, 'not_performed');
  const actual = createGenerationManifest({ ...inputs, generationProvenance: { source_origin: 'confirmed_browser_operations', compiler: 'recorded_playwright_v1', review_status: 'accepted', verification_status: 'passed' } });
  assert.equal(actual.source_origin, 'confirmed_browser_operations');assert.equal(actual.compiler, 'recorded_playwright_v1');assert.equal(actual.review_status, 'accepted');assert.equal(actual.verification_status, 'unverified');
  const invalid = createGenerationManifest({ ...inputs, generationProvenance: { source_origin: 'invented', compiler: 'external', review_status: 'passed' } });
  assert.equal(invalid.source_origin, 'unknown');assert.equal(invalid.compiler, 'unknown');assert.equal(invalid.review_status, 'not_performed');
});

test('API versions preserve request semantics while ignoring object serialization order', () => {
  const apiStep = { ...step, step_type: 'api' };
  const request = { method: 'POST', url: 'https://api.test/addresses', headers: [{ key: 'Authorization', value: '@s.token' }], body_mode: 'json', body: '{"city":"Paris"}', validations: [{ kind: 'status', expected: '201' }] };
  const manifest = createGenerationManifest({ testCaseId: 'automation', step: apiStep, update: { step_type: 'api', api_request: request, automation_code: null } });
  const live = { ...apiStep, automation_code: null, api_request: JSON.stringify({ validations: request.validations, body: request.body, body_mode: request.body_mode, headers: request.headers, url: request.url, method: request.method }) };
  assert.equal(generationApplicability({ manifest, testCaseId: 'automation', currentStep: live }).status, 'current');
  assert.deepEqual(generationApplicability({ manifest, testCaseId: 'automation', currentStep: { ...live, api_request: { ...request, body: '{"city":"London"}' } } }), { status: 'historical', reasons: ['source_changed'] });
});

test('private source and authored values appear only in their existing protected payload, never again in the manifest or comparison result', () => {
  const secret = 'private-value-do-not-copy';
  const privateStep = { ...step, action: `Enter ${secret}`, expected_result: `${secret} is retained` };
  const manifest = createGenerationManifest({ testCaseId: 'automation', step: privateStep, update: { automation_code: `await page.locator("#private").fill(${JSON.stringify(secret)});` } });
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(secret));
  const outcome = generationApplicability({ manifest, testCaseId: 'automation', currentStep: { ...privateStep, automation_code: `await page.locator("#private").fill("different-private-value");` } });
  assert.doesNotMatch(JSON.stringify(outcome), /private-value|Enter|fill/);assert.equal(outcome.status, 'historical');
});
