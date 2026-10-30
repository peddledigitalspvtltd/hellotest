import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const {chromium} = require('playwright');
const root = new URL('../../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('../../../shared/aiFeatureCatalog.json', import.meta.url), 'utf8'));

test('resetting a primary prompt preserves other draft settings and requires explicit publication', {timeout: 60000}, async () => {
  const name = 'ai-prompt-reset-' + randomUUID();
  const definition = catalog.find(item => item.id === 'ai.test_case.design');
  const original = {
    ...structuredClone(definition.defaults),
    prompt: 'NFR_ONLY: a previously published custom objective.',
    role: 'A customized authoring role.',
    domain: 'A customized domain.',
    task: 'A customized task.',
    guardrails: 'A customized evidence policy.',
    integration_id: 'reviewed-provider',
    temperature: 0.65,
    top_p: 0.7,
    max_output_tokens: 4096,
    context: {mode: 'mcp', token_budget: 1250, max_items: 7, required: true, focus: 'Selected Stories only.'},
    output_schema: {type: 'object', required: ['cases']},
    instruction_blocks: {...definition.defaults.instruction_blocks, 'legacy.reviewed': 'Retain reviewed conditional guidance.'}
  };
  const feature = {...definition, config: {...structuredClone(definition.defaults), prompt: original.prompt, integration_id: original.integration_id}, revision: 5, published_version: 0, published_at: null, draft: {config: structuredClone(original), at: new Date().toISOString()}, history: [], fingerprint: 'fixture', configuration_source: 'legacy_override', legacy_override_fields: ['prompt', 'integration_id']};
  const writes = [], errors = [];
  let browser, pendingDraft;
  try {
    await writeFile(new URL(name + '.tsx', root), `import React from 'react';import {createRoot} from 'react-dom/client';import {AiControls} from './admin/AiControls';import './admin/admin.css';createRoot(document.getElementById('root')).render(<main style={{padding:24,maxWidth:1400,margin:'0 auto'}}><AiControls onDirtyChange={()=>{}}/></main>);`);
    await writeFile(new URL(name + '.html', root), `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      let body;
      if (path.endsWith('/ai-configuration/metrics')) body = {items: [], window_hours: 24, note: '', trace_storage: {failed_writes: 0}};
      else if (path.endsWith('/ai-configuration')) body = {features: [feature]};
      else if (path.endsWith('/integrations')) body = [{id: 'reviewed-provider', name: 'Reviewed provider', type: 'llm', is_active: true}];
      else if (/\/(draft|publish)$/.test(path)) {
        const mode = path.endsWith('/draft') ? 'draft' : 'publish', input = request.postDataJSON();
        writes.push({mode, input});
        if (mode === 'draft') await new Promise(resolve => {pendingDraft = resolve;});
        feature.revision++;
        if (mode === 'draft') feature.draft = {config: input.config, at: new Date().toISOString()};
        else {feature.config = input.config; feature.draft = null; feature.published_version++; feature.configuration_source = 'published'; feature.legacy_override_fields = [];}
        body = feature;
      } else throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
      await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('heading', {name: definition.label, exact: true}).waitFor();
    assert.equal(await page.locator('.ai-version-badge').innerText(), 'Saved override');
    assert.equal(await page.locator('.ai-feature-list button small').innerText(), 'Saved override · Draft');
    await page.getByText('These saved settings remain active across deployments. Publish a reviewed configuration to replace them for this feature.', {exact: true}).waitFor();
    await page.getByRole('tab', {name: 'Versions', exact: true}).click();
    await page.getByText('Saved overrides are active. Publish a reviewed configuration to start its history.', {exact: true}).waitFor();
    await page.getByRole('tab', {name: 'Guardrails', exact: true}).click();
    await page.getByLabel('Guardrail instructions').fill('An unsaved reviewed evidence policy.');
    await page.getByRole('tab', {name: 'Output contract', exact: true}).click();
    await page.locator('summary').filter({hasText: 'Additional JSON Schema constraints'}).click();
    const schema = {type: 'object', required: ['cases'], additionalProperties: false};
    await page.getByLabel('Additional output schema').fill(JSON.stringify(schema));
    await page.getByRole('tab', {name: 'Instructions', exact: true}).click();
    const reset = page.getByRole('button', {name: 'Use default prompt', exact: true});
    assert.equal(await reset.isEnabled(), true);
    await reset.click();
    assert.equal(await page.getByLabel('Primary prompt', {exact: true}).inputValue(), definition.defaults.prompt);
    assert.equal(await reset.isDisabled(), true);
    await page.getByRole('status').filter({hasText: 'Default prompt applied to your draft. Publish to use it for new model calls.'}).waitFor();
    assert.equal(writes.length, 0, 'Resetting must not save or publish the configuration.');
    assert.equal(feature.config.prompt, original.prompt, 'Published instructions remain unchanged.');
    assert.equal(await page.getByText('Unsaved changes', {exact: true}).count(), 1);

    await page.getByLabel('Primary prompt', {exact: true}).fill('A further draft edit.');
    await page.getByRole('button', {name: 'Save draft', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.ai-editor-actions')?.textContent.includes('Save draft') && document.querySelector('#ai-primary-prompt')?.disabled);
    assert.equal(await reset.isDisabled(), true, 'Reset must be disabled while a request is in flight.');
    assert.ok(pendingDraft);
    pendingDraft();
    await page.getByRole('status').filter({hasText: 'Draft saved.'}).waitFor();
    assert.equal(await reset.isEnabled(), true);
    await reset.click();
    assert.equal(writes.length, 1, 'Resetting a saved draft still makes no request.');
    await page.getByRole('button', {name: 'Publish', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Published. New model calls use this configuration.'}).waitFor();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], {
      mode: 'publish',
      input: {expected_revision: 6, config: {...original, prompt: definition.defaults.prompt, guardrails: 'An unsaved reviewed evidence policy.', output_schema: schema}}
    });
    assert.equal(await reset.isDisabled(), true);
    assert.equal(await page.locator('.ai-version-badge').innerText(), 'Published v1');
    assert.equal(await page.getByText('These saved settings remain active across deployments. Publish a reviewed configuration to replace them for this feature.', {exact: true}).count(), 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 1000});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `No horizontal overflow at ${width}px`);
    }
    assert.deepEqual(errors, []);
  } finally {
    pendingDraft?.();
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), {force: true}), rm(new URL(name + '.html', root), {force: true})]);
  }
});
