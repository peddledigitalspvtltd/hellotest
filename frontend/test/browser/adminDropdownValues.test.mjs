import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { DROPDOWN_FIELDS } = require(new URL('../../../backend/api/src/domain/dropdownCatalog.js', import.meta.url).pathname);
const root = new URL('../../', import.meta.url);
const option = (value, label, description = '') => ({ value, label, description, active: true, builtin: true });
const field = (key, label, group, options, extra = {}) => ({ key, label, group, options,
  kind: 'configurable', value_format: 'slug', can_add: true, can_edit: true, required: true,
  default_value: null, supports_default: false, description: 'Consistent choices for planning and reviewing quality work.',
  usage: [{ label: 'Test cases', path: '/test-cases' }], ...extra });
const catalog = { revision: 3, updated_at: '2026-09-10T08:30:00Z', fields: [
  field('test_cases.types', 'Test case types', 'Test design', [option('functional', 'Functional', 'Verify the expected behavior of a feature.'), option('regression', 'Regression', 'Protect established behavior as the product changes.'), option('performance', 'Performance', 'Evaluate responsiveness and throughput.')], { supports_default: true, default_value: 'functional' }),
  field('bugs.qa_root_cause', 'QA root cause', 'Defect management', [option('missed_test_scenario', 'Missed test scenario'), option('missed_in_execution', 'Missed in execution'), option('edge_case_not_covered', 'Edge case not covered')], { description: 'Describe the testing gap that allowed a defect to escape.', usage: [{ label: 'Create bug', path: '/issues' }, { label: 'Bug details', path: '/issues' }] }),
  field('requirements.labels', 'Story labels', 'Planning', [option('Commerce', 'Commerce'), option('Release gate', 'Release gate')], { kind: 'suggestions', value_format: 'text', required: false, usage: [{ label: 'Stories', path: '/requirements' }] }),
  field('requirements.story_points', 'Story points', 'Planning', [option('1', '1'), option('3', '3'), option('5', '5')], { kind: 'suggestions', value_format: 'integer', required: false, usage: [{ label: 'Stories', path: '/requirements' }] }),
  field('runs.status', 'Run status', 'Execution', [option('queued', 'Queued'), option('running', 'Running'), option('completed', 'Completed')], { kind: 'system', can_add: false, can_edit: false, reason: 'Run statuses are controlled by execution lifecycle transitions. Changing these values would break progress and reporting.', usage: [{ label: 'Test runs', path: '/executions' }] }),
  field('shared_groups.records', 'Shared step groups', 'Test design', [], { kind: 'records', can_add: false, can_edit: false, required: false, reason: 'These choices come from shared step groups in each application.', manage_path: '/design?tab=shared-groups', usage: [{ label: 'Shared groups', path: '/design?tab=shared-groups' }] })
] };

test('admin dropdown editor preserves drafts, applies stable options and handles concurrent changes', { timeout: 120000 }, async () => {
  const name = `admin-dropdowns-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await mkdir('/tmp/qaira-admin-dropdowns', { recursive: true });
    await writeFile(tsx, `import React from 'react';import {createRoot} from 'react-dom/client';import {AdminApp} from '/src/admin/AdminApp';import {adminApi,sessionStore} from '/src/admin/api';import '/src/admin/admin.css';import '@fontsource/inter/400.css';import '@fontsource/inter/500.css';import '@fontsource/inter/600.css';import '@fontsource/hanken-grotesk/600.css';
window.__HELLOTEST_CONFIG__={WORKSPACE_BASE_URL:'http://localhost:8080'};
const state={catalog:${JSON.stringify(catalog)},failRead:true,conflict:false,failSave:false,calls:[]};window.dropdownFixture=state;
sessionStore.write({token:'isolated-dropdown-fixture',user:{id:'fixture-admin',name:'QA Administrator',email:'admin@example.test',role:'admin'}});
adminApi.overview=async()=>({status:'operational',schema:{status:'ready',required_tables:16,available_tables:16,missing_tables:[]},metrics:{users:2,administrators:2,projects:1,integrations:3,active_integrations:3,enabled_features:45,total_features:46},runtime:{}});
adminApi.dropdownCatalog=async()=>{if(state.failRead){state.failRead=false;throw new Error('Temporary catalog connection failure');}return structuredClone(state.catalog)};
adminApi.updateDropdown=async(key,input)=>{state.calls.push({key,input});if(state.conflict){state.conflict=false;state.catalog.revision++;throw Object.assign(new Error('Catalog changed'),{status:409});}if(input.expected_revision!==state.catalog.revision)throw Object.assign(new Error('Catalog changed'),{status:409});if(state.failSave){state.failSave=false;throw new Error('Temporary save failure');}state.catalog.fields=state.catalog.fields.map(field=>field.key===key?{...field,options:input.options.map(option=>({...option,builtin:field.options.find(old=>old.value===option.value)?.builtin||false})),...(Object.hasOwn(input,'default_value')?{default_value:input.default_value}:{})}:field);state.catalog.revision++;return structuredClone(state.catalog)};
createRoot(document.getElementById('root')).render(<AdminApp/>);`);
    await writeFile(html, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected live request'); return route.abort(); });
    await page.goto(`${process.env.ADMIN_TEST_URL || 'http://127.0.0.1:5179'}/${name}.html`);
    await page.getByRole('button', { name: 'Dropdown values', exact: true }).click();
    await page.getByText('Temporary catalog connection failure', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/error.png' });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'Test case types', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/desktop.png' });
    assert.equal(await page.locator('.dropdown-field').count(), 6);
    assert.equal(await page.locator('input[id^="option-code"]').count(), 0, 'Saved values have no code editor.');
    await page.getByRole('button', { name: 'Add value', exact: true }).click();
    const newRow = page.locator('.dropdown-option').last();
    assert.equal(await newRow.getByLabel('Display label', { exact: true }).evaluate(element => document.activeElement === element), true);
    await newRow.getByLabel('Display label', { exact: true }).fill('Accessibility');
    assert.equal(await newRow.getByLabel('Stored code', { exact: true }).inputValue(), 'accessibility');
    await newRow.getByLabel('Stored code', { exact: true }).fill('accessibility_review');
    await newRow.getByLabel('Display label', { exact: true }).fill('Accessibility review');
    assert.equal(await newRow.getByLabel('Stored code', { exact: true }).inputValue(), 'accessibility_review');
    await page.getByRole('button', { name: 'Move Accessibility review up', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Test case types saved. Updated choices are available to the workspace.', { exact: true }).waitFor();
    assert.equal(await page.locator('.dropdown-option').nth(2).getByLabel('Display label', { exact: true }).inputValue(), 'Accessibility review');
    assert.equal(await page.locator('input[id^="option-code"]').count(), 0);
    const firstSave = await page.evaluate(() => window.dropdownFixture.calls[0]);
    assert.equal(firstSave.input.expected_revision, 3);
    assert.equal(firstSave.input.options[2].value, 'accessibility_review');
    assert.ok(!firstSave.input.options[2].builtin);

    await page.getByLabel('Default for new records', { exact: true }).selectOption('accessibility_review');
    await page.locator('.dropdown-option').nth(2).getByRole('checkbox').uncheck();
    assert.equal(await page.getByLabel('Default for new records', { exact: true }).inputValue(), '');
    await page.getByText('Choose an active value as the default for new records.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('Accessibility review');
    await page.getByText('Display label “Accessibility review” is already used.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();

    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('Feature behavior');
    await page.getByRole('button', { name: /^QA root cause/ }).click();
    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('Missing scenario coverage');
    await page.evaluate(() => { window.dropdownFixture.conflict = true; });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Review the latest saved version', { exact: true }).waitFor();
    assert.equal(await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).inputValue(), 'Missing scenario coverage');
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/conflict.png' });
    await page.getByRole('button', { name: 'Reload saved values', exact: true }).click();
    await page.getByText('Latest saved values loaded. Changes to this field were discarded.', { exact: true }).waitFor();
    assert.equal(await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).inputValue(), 'Missed test scenario');
    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('Scenario gap');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('QA root cause saved. Updated choices are available to the workspace.', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Test case types/ }).click();
    assert.equal(await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).inputValue(), 'Feature behavior');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Review the latest saved version', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reload saved values', exact: true }).click();
    await page.getByText('Latest saved values loaded. Changes to this field were discarded.', { exact: true }).waitFor();

    await page.getByRole('button', { name: /^Story points/ }).click();
    assert.equal(await page.getByLabel('Default for new records', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Add value', exact: true }).click();
    await page.locator('.dropdown-option').last().getByLabel('Display label', { exact: true }).fill('0');
    await page.getByText(/must be a whole number from 1 to 999/).waitFor();
    await page.locator('.dropdown-option').last().getByLabel('Display label', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Story points saved. Updated choices are available to the workspace.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search dropdown fields' }).fill('not a field');
    await page.getByText('No matching fields', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: /^Run status/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Add value', exact: true }).count(), 0);
    assert.equal(await page.locator('.dropdown-editor input').count(), 0);
    await page.getByText('Part of the product workflow', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/system.png' });
    await page.getByRole('button', { name: /^Shared step groups/ }).click();
    assert.equal(await page.getByRole('link', { name: 'Open shared step groups' }).getAttribute('href'), 'http://localhost:8080/design?tab=shared-groups');
    await page.getByText('Choices come from existing records', { exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /^QA root cause/ }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('.topbar').getBoundingClientRect().top) < 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/mobile.png' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/mobile-overview.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('A very long reviewed quality escape category with enough words to verify the full editor remains contained');
    await page.getByRole('button', { name: 'Open administration navigation', exact: true }).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Control center', exact: true }).click();
    await page.getByRole('heading', { name: 'QA root cause', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).fill('Execution review gap');
    await page.evaluate(() => { window.dropdownFixture.failSave = true; });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Changes were not saved', { exact: true }).waitFor();
    assert.equal(await page.locator('.dropdown-option').first().getByLabel('Display label', { exact: true }).inputValue(), 'Execution review gap');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('QA root cause saved. Updated choices are available to the workspace.', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Control center', exact: true }).click();
    await page.evaluate(fields => { window.dropdownFixture.catalog.fields = fields; }, DROPDOWN_FIELDS);
    await page.getByRole('button', { name: 'Dropdown values', exact: true }).click();
    await page.getByRole('heading', { name: 'Primary Root Cause', exact: true }).waitFor();
    assert.equal(await page.locator('.dropdown-field').count(), DROPDOWN_FIELDS.length);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/catalog.png' });
    await page.getByLabel('Filter fields by product area', { exact: true }).selectOption('Knowledge and AI');
    assert.equal(await page.locator('.dropdown-field').count(), 2);
    await page.getByLabel('Filter fields by product area', { exact: true }).selectOption('all');
    await page.getByRole('button', { name: /^Test case type/  }).click();
    assert.equal(await page.locator('.dropdown-option').count(), 10);
    assert.equal(await page.getByLabel('Default for new records', { exact: true }).inputValue(), 'functional');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/qaira-admin-dropdowns/catalog-types.png' });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await Promise.all([rm(html, { force: true }), rm(tsx, { force: true })]); }
});
