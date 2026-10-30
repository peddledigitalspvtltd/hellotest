import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { groomingCandidate } = createRequire(import.meta.url)('../../../platform/backend/test/helpers/groomingCandidate');
const root = new URL('../../../platform/frontend/', import.meta.url), name = `grooming-measurements-${randomUUID()}`;
test('Grooming keeps source measurements collapsed and explains the preserved model assessment on expansion', { timeout: 60000 }, async () => {
 const grooming = groomingCandidate();
 grooming.readiness.model_checks = [{ id: 'implementation-approach', label: 'Implementation approach', status: 'met', detail: 'MODEL_ASSESSMENT_RETAINED', evidence_refs: ['requirement:story'] }];
 grooming.readiness.measurement_adjustments = [{ check_id: 'implementation-approach', label: 'Implementation approach', model_status: 'met', measured_status: 'missing', applied_status: 'missing', reason: 'No implementation evidence was supplied.', applicability: 'unconfirmed' }];
 const response = { grooming, generated_at: new Date().toISOString(), generation_mode: 'llm', fallback_used: false, requires_human_review: true, request_id: 'review', input_fingerprint: 'input',
  integration: { name: 'Fixture model', model: 'fixture' }, requirement: { id: 'story', title: 'Review Story' },
  context: { scope: { project_id: 'project', project_key: 'PROJECT' }, sources: [{ ref: 'requirement:story', type: 'story', id: 'story', title: 'Review Story', excerpt: 'The customer updates a profile.' }], included: {}, omitted: {}, limits: {}, unavailable_sources: [], partial_sources: [] } };
 const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{StoryGroomingWorkspace}from'@hellotest/ai/frontend/components/StoryGroomingWorkspace';import'/src/styles.css';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto'}}><StoryGroomingWorkspace response={${JSON.stringify(response)}} storyTitle="Review Story" isLoading={false} onGenerate={()=>{}}/></main>);`;
 let browser;
 try {
  await writeFile(new URL(`${name}.tsx`, root), fixture); await writeFile(new URL(`${name}.html`, root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html`);
  const summary = page.getByText('1 source completeness adjustments', { exact: true }); await summary.waitFor();
  const details = summary.locator('..'); assert.equal(await details.getAttribute('open'), null);
  assert.equal(await page.getByText('MODEL_ASSESSMENT_RETAINED', { exact: false }).isVisible(), false);
  await summary.click();
  assert.equal(await page.getByText('MODEL_ASSESSMENT_RETAINED', { exact: false }).isVisible(), true);
  assert.equal(await page.getByText('Model: met · Measured: missing · Applied: missing', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/A missing source signal does not establish that a topic is required/).isVisible(), true);
  assert.equal(await page.getByText('Evidence-only fallback', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
 } finally { await browser?.close(); await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]); }
});
