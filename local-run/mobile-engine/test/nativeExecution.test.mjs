import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCapabilities, resolveMobilePlatform } from '../src/mobileCapabilities.js';
import { executeMobileStepsWithDriver, app } from '../src/server.js';
import { createExecutionSessions } from '../src/executionSessions.js';
const { buildMobileRecorderPlan } = createRequire(import.meta.url)('../../../services/automation/backend/domain/mobileRecorderPlan.js');

test('iOS targets XCUITest and preserves native app/device identity', () => {
  const result = buildCapabilities({ platform_name: 'ios', config: { device_name: 'iPhone 16', bundle_id: 'app.hello', udid: 'device', android_app: 'wrong.apk', ios_app: 'right.ipa', provider_options: { platformName: 'Android' } } });
  assert.equal(result.capabilities.platformName, 'iOS');
  assert.equal(result.capabilities['appium:automationName'], 'XCUITest');
  assert.equal(result.capabilities['appium:app'], 'right.ipa');
  assert.equal(result.capabilities['appium:bundleId'], 'app.hello');
  assert.equal(result.capabilities['appium:udid'], 'device');
  assert.equal(buildCapabilities({ platform_name: 'android' }).capabilities['appium:automationName'], 'UiAutomator2');
  assert.throws(() => resolveMobilePlatform({ platform_name: 'ios', steps: [{ step_type: 'android' }] }), /does not match/);
});

test('native code executes aliases, repository bindings, captures and configured failure evidence', async () => {
  const seen = [];
  const driver = { $: (selector) => { seen.push(selector); return { getText: async () => 'Created', click: async () => {} }; }, takeScreenshot: async () => 'cG5n' };
  const payload = { platform_name: 'ios', artifact_policy: { screenshot_on_failure: true }, parameter_values: { 't.label': 'Submit' }, object_repository: [{ page_key: 'Account', object_name: 'Submit', locator: '~@t.label' }], steps: [
    { id: 'first', step_type: 'ios', automation_code: 'await ios.tap("Account.Submit"); await mobile.captureText("~receipt", "t.receipt");' },
    { id: 'second', step_type: 'ios', automation_code: 'if(params["t.receipt"]!=="Created") throw new Error("capture missing"); throw new Error("assertion failed");' }
  ] };
  const result = await executeMobileStepsWithDriver(driver, payload);
  assert.equal(result.results[0].status, 'passed');
  assert.equal(result.results[0].captures['t.receipt'], 'Created');
  assert.deepEqual(seen, ['~Submit', '~receipt']);
  assert.equal(result.results[1].status, 'failed');
  assert.match(result.results[1].evidence.dataUrl, /^data:image\/png/);
  payload.artifact_policy.screenshot_on_failure = false;
  const off = await executeMobileStepsWithDriver(driver, payload);
  assert.equal(off.results[1].evidence, null);
  const placeholder = await executeMobileStepsWithDriver(driver, { steps: [{ id: 'bad', step_type: 'android', automation_code: 'await android.aiStep("log in");' }] });
  assert.equal(placeholder.status, 'failed');
  assert.match(placeholder.results[0].note, /no executable automation/);
});

test('mobile local execution inherits engine timeout, honors per-step timeout, and applies screenshot mode', async () => {
  const timeouts = [], screenshots = [];
  const driver = {
    setTimeout: async value => { timeouts.push(value.implicit); },
    $: () => ({ waitForDisplayed: async ({ timeout }) => { timeouts.push(timeout); }, click: async () => {} }),
    takeScreenshot: async () => { screenshots.push('captured'); return 'cG5n'; }
  };
  const step = automation_code => ({ id: 'wait', step_type: 'android', automation_code });
  const recordedCode = buildMobileRecorderPlan({ caseId: 'case', applicationPlatform: 'android', capturedActions: [{ type: 'tap', locator: '~late' }] })[0].input.automation_code;
  const timed = await executeMobileStepsWithDriver(driver, {
    timeouts: { action_timeout_ms: 7000 },
    artifact_policy: { screenshot_mode: 'passed' },
    steps: [step('// @hellotest-options timeoutMs=3000\n' + recordedCode)]
  });
  assert.equal(timed.results[0].status, 'passed');
  assert.deepEqual(timeouts, [3000, 3000, 7000]);
  assert.match(timed.results[0].evidence.dataUrl, /^data:image\/png/);
  timeouts.length = 0;
  await executeMobileStepsWithDriver(driver, { timeouts: { action_timeout_ms: 7000 }, steps: [step(recordedCode)] });
  assert.deepEqual(timeouts, [7000, 7000, 7000], 'the engine default is used for actions and restored after each step');

  const failingDriver = {
    setTimeout: async () => {},
    $: () => ({ waitForDisplayed: async () => { throw new Error('not ready'); } }),
    takeScreenshot: async () => { screenshots.push('failed'); return 'cG5n'; }
  };
  const noFailedEvidence = await executeMobileStepsWithDriver(failingDriver, {
    artifact_policy: { screenshot_mode: 'passed' }, steps: [step('await android.waitForDisplayed("~late");')]
  });
  assert.equal(noFailedEvidence.results[0].status, 'failed');
  assert.equal(noFailedEvidence.results[0].evidence, null);
  const failedEvidence = await executeMobileStepsWithDriver(failingDriver, {
    artifact_policy: { screenshot_mode: 'failed' }, steps: [step('await android.waitForDisplayed("~late");')]
  });
  assert.match(failedEvidence.results[0].evidence.dataUrl, /^data:image\/png/);
});

test('device sessions are bounded, keep state across blocks, and release on failure', async () => {
  let created = 0, closed = 0;
  const store = createExecutionSessions({ maxSessions: 1, createDriver: async () => ({ state: ++created, deleteSession: async () => { closed++; } }) });
  const id = 'test-session-one-1';
  try {
    assert.equal(await store.execute(id, 'ios', {}, async (driver) => driver.state), 1);
    assert.equal(await store.execute(id, 'ios', {}, async (driver) => driver.state), 1);
    await assert.rejects(store.execute('test-session-two-2', 'ios', {}, async () => {}), /capacity/);
    await assert.rejects(store.execute(id, 'android', {}, async () => {}), /change platform/);
    await assert.rejects(store.execute(id, 'ios', {}, async () => { throw new Error('offline'); }), /offline/);
    assert.equal(closed, 1);
    assert.equal(await store.execute(id, 'ios', {}, async (driver) => driver.state), 2);
  } finally { await store.dispose(); }
  assert.equal(closed, 2);
});
test.after(() => app.close());
