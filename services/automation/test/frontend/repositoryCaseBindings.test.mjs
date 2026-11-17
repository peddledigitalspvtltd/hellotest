import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from '../../../platform/frontend/test/helpers/loadTsModule.mjs';
const { collectCaseRepositoryPages } = loadTsModule(fileURLToPath(new URL('../../frontend/lib/repositoryCaseBindings.ts', import.meta.url)), { URL });
const { formatRepositoryDate } = loadTsModule(fileURLToPath(new URL('../../frontend/lib/repositoryEntryPresentation.ts', import.meta.url)), { URL });
const entry = (id, screen, name, locator, metadata = {}) => ({ id, project_id: 'project', app_type_id: 'app', test_case_id: 'case', page_key: screen, page_url: 'https://fixture.test/' + screen, locator, locator_intent: 'fill', metadata: { screen_name: screen, object_name: name, object_role: 'input / textbox', html_tag: 'input', ...metadata } });
const ids = result => Array.from(result.members, member => member.entry.id).sort();

test('case objects include current target bindings, excluding captured ownership, input values and screen records', () => {
  const entries = [entry('email', 'Login', 'Login.Email', '#email'), entry('password', 'Login', 'Password', '#password'), entry('submit', 'Login', 'Submit', '#submit'), entry('address', 'Checkout', 'Address', '#address'), entry('screen', 'Login', 'Login', '', { record_kind: 'screen' })];
  entries.forEach(row => { Object.freeze(row.metadata); Object.freeze(row); }); Object.freeze(entries);
  const steps = [{ id: 'fill', automation_code: 'await web.fill("Login.Email", "Checkout.Address"); await web.click(params["t.submitfield"]); // web.fill("Login.Password", "secret")', objectRefs: [] }];
  const result = collectCaseRepositoryPages({ entries, steps, values: { 't.submitfield': 'Login.Submit' }, caseId: 'case' });
  assert.deepEqual(ids(result), ['email', 'submit']);
  assert.equal(result.pages.length, 1); assert.equal(result.pages[0].screenName, 'app::Login');
  assert.equal(result.pages[0].members[0].memberName, 'Email'); assert.equal(result.pages[0].members[0].ref, 'Login.Email');
  assert.equal(result.pages[0].members[0].entry, entries[0], 'Saved evidence is retained without rewriting repository rows.');
  assert.equal(collectCaseRepositoryPages({ entries, steps: [], caseId: 'case' }).members.length, 0);
});

test('route-specific bindings require current source and context digests; a generic duplicate cannot steal them', () => {
  const digest = 'a'.repeat(64), route = 'b'.repeat(64);
  const entries = [entry('route', 'Route A', 'Email', '#email', { observed_route_sha256: route, instruction_usages: [{ test_case_id: 'case', step_id: 'fill', source_sha256: digest, context_sha256: digest }] }), entry('generic', 'Curated', 'Email', '#email')];
  const step = { id: 'fill', automation_code: 'await page.locator("#email").fill("literal");', automation_source_sha256: digest, automation_context_sha256: digest, objectRefs: [] };
  assert.deepEqual(ids(collectCaseRepositoryPages({ entries, steps: [step], caseId: 'case' })), ['route']);
  assert.deepEqual(ids(collectCaseRepositoryPages({ entries, steps: [{ ...step, automation_source_sha256: undefined }], caseId: 'case' })), []);
  assert.deepEqual(ids(collectCaseRepositoryPages({ entries, steps: [{ ...step, automation_context_sha256: undefined }], caseId: 'case' })), []);
  assert.deepEqual(ids(collectCaseRepositoryPages({ entries, steps: [step], caseId: 'other' })), []);
});

test('repository date presentation handles missing and invalid evidence and formats valid dates', () => {
  assert.equal(formatRepositoryDate(null), 'Never validated'); assert.equal(formatRepositoryDate('not-a-date'), 'not-a-date');
  assert.notEqual(formatRepositoryDate('2026-11-16T10:00:00Z'), 'Never validated');
});
