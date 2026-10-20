import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { captureAutomationBrowserSnapshot } from '../../dist/lib/automationMcp.js';
import { resolveRepositoryLocator } from '../../dist/lib/repositoryLocator.js';
import { groundSnapshotLocators } from '../../dist/lib/automationSnapshotLocators.js';

test('snapshot names and unique locator candidates agree with actual Playwright accessibility, including hidden required markers', {timeout: 30_000}, async t => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><h1>Set up your access</h1>
    <label for="email-input">Email<span aria-hidden="true"> *</span></label><input id="email-input" type="email" placeholder="Email*">
    <label for="literal">Literal * marker</label><input id="literal">
    <label for="password">Password<span hidden>hidden decoration</span></label><input id="password" type="password" value="owned-private-fixture">
    <span id="first">Account</span><span id="second" hidden>required</span><input id="referenced" aria-labelledby="first second">
    <button id="continue" data-testid="duplicate">Continue<span aria-hidden="true"> *</span></button>
    <button id="later" data-testid="duplicate">Continue later</button>
    <button id="save-one">Save</button><button id="save-two">Save</button>`);
  const before = await page.content(), snapshot = await captureAutomationBrowserSnapshot(page);
  const email = snapshot.elements.find(row => row.attributes.id === 'email-input');
  assert.match(snapshot.accessibility, /textbox "Email"/);
  assert.equal(email.label, 'Email'); assert.equal(email.accessible_name, 'Email'); assert.equal(email.locators_validated, true);
  assert.ok(email.locator_candidates.includes('getByRole("textbox", { name: "Email", exact: true })'));
  assert.ok(email.locator_candidates.includes('#email-input'));
  assert.ok(!email.locator_candidates.some(value => /getByRole\(.*Email \*/.test(value)), 'raw label text must not be advertised as the accessible role name');
  assert.equal(snapshot.elements.find(row => row.attributes.id === 'literal').label, 'Literal * marker', 'a literal star in a real accessible name must be preserved');
  const referenced = snapshot.elements.find(row => row.attributes.id === 'referenced');
  assert.equal(referenced.accessible_name, 'Account required', 'directly referenced hidden labels follow the real browser accessible-name algorithm');
  for (const element of snapshot.elements) {
    assert.equal(element.snapshot_selector, undefined); assert.equal(element.snapshot_candidates, undefined); assert.equal(element.snapshot_role, undefined);
    for (const candidate of element.locator_candidates) {
      const locator = resolveRepositoryLocator(page, candidate);
      assert.equal(await locator.count(), 1, candidate);
      if (element.attributes.id) assert.equal(await locator.getAttribute('id'), element.attributes.id, candidate);
    }
  }
  const save = snapshot.elements.find(row => row.attributes.id === 'save-one');
  assert.ok(!save.locator_candidates.some(value => value.startsWith('getByRole(')), 'a name shared by two buttons is not a unique candidate');
  const next = snapshot.elements.find(row => row.attributes.id === 'continue');
  assert.ok(!next.locator_candidates.includes('getByTestId("duplicate")'), 'duplicate test IDs are not unique locators');
  assert.doesNotMatch(JSON.stringify(snapshot), /owned-private-fixture|snapshot_selector|snapshot_candidates|snapshot_role/);
  assert.equal(await page.content(), before, 'grounding must not inject IDs or change page attributes');
});

test('an expired locator-grounding budget omits unverified candidates', async () => {
  const elements = [{snapshot_selector:'#email',snapshot_candidates:['getByLabel("Email *")'],snapshot_role:'textbox',locator_candidates:['invented'],displayed:true}];
  const result = await groundSnapshotLocators({}, elements, Date.now()-1);
  assert.equal(result.incomplete, true); assert.deepEqual(elements[0].locator_candidates, []);
  assert.equal(elements[0].snapshot_selector, undefined); assert.equal(elements[0].snapshot_candidates, undefined);
});

test('redaction never changes a validated locator and preserves safe alternatives for secret-named targets', {timeout: 30_000}, async t => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const secret of ['fixture"private\\token', '9fixture:secret?value']) {
    await page.setContent('<!doctype html><label>Private token<input type=password></label><button data-testid="safe-target"></button><button class="secret-only"></button><select data-testid="choice"><option>Private choice</option></select>');
    await page.evaluate(value => {
      document.querySelector('input').value = value;
      const target = document.querySelector('[data-testid="safe-target"]');
      target.id = value;
      target.textContent = value;
      document.querySelector('.secret-only').textContent = value;
      document.querySelector('option').value = value;
    }, secret);
    const before = await page.content(), snapshot = await captureAutomationBrowserSnapshot(page);
    const target = snapshot.elements.find(element => element.attributes['data-testid'] === 'safe-target');
    assert.ok(target, 'the target remains discoverable through its safe test ID');
    assert.equal(target.text, '[redacted]');
    assert.ok(target.locator_candidates.includes('getByTestId("safe-target")'));
    assert.ok(!target.locator_candidates.some(candidate => candidate.includes('[redacted]')), 'redaction cannot manufacture an executable candidate');
    for (const candidate of target.locator_candidates) {
      const locator = resolveRepositoryLocator(page, candidate);
      assert.equal(await locator.count(), 1, candidate);
      assert.equal(await locator.getAttribute('data-testid'), 'safe-target', candidate);
    }
    const option = snapshot.elements.find(element => element.attributes['data-testid'] === 'choice').options[0];
    assert.equal(option.value, undefined, 'a redacted option value must not become selectable input');
    assert.equal(option.value_excerpt, '[redacted]');
    assert.equal(option.value_truncated, true);
    const encoded = JSON.stringify(snapshot);
    assert.doesNotMatch(encoded, /fixture|private|secret\?value|sensitive_selector_values/, 'rendered, JSON escaped and CSS escaped secrets stay out of evidence');
    assert.equal(await page.content(), before, 'privacy protection never modifies application DOM');
  }
});
