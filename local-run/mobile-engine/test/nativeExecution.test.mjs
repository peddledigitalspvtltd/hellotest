import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilities, resolveMobilePlatform } from '../src/mobileCapabilities.js';
import { executeMobileStepsWithDriver, app } from '../src/server.js';
import { createExecutionSessions } from '../src/executionSessions.js';

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
