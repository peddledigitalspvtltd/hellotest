import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/platform/hooks/useCurrentProject';
import { AgenticWorkflowsPage } from '/services/agentic/frontend/pages/AgenticWorkflowsPage';
import '/src/styles.css'; import '/src/dark-theme.css'; import '/src/modal-system.css'; import '/src/workspace-layout.css';
const params = new URLSearchParams(window.location.search);
const readOnly = params.get('readonly') === 'true';
const session = { token: 'specialist-fixture', user: { id: 'specialist-reviewer', role: readOnly ? 'member' : 'admin', name: 'Reviewer', email: 'reviewer@example.test', permissions: ['workspace.view', 'agentic_workflow.view'], project_permissions: { project: ['agentic_workflow.view'], other: ['agentic_workflow.view'] } } };
sessionStorage.write(session); setCurrentScope('project', 'app');
const realAsk = api.agenticWorkflows.ask; const realGetSession = api.agenticWorkflows.getSession;
window.realWorkspaceTransactions = { ...api.workspaceTransactions };
for (const methods of Object.values(api)) if (methods && typeof methods === 'object') for (const [name, value] of Object.entries(methods)) if (typeof value === 'function') methods[name] = async () => [];
window.workspaceCalls = { sessions: [], lookups: [], events: [], providers: [], writes: [] };
api.auth.session = async () => session;
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: () => true }) });
api.projects.list = async () => [{ id: 'project', name: 'Checkout project' }, { id: 'other', name: 'Other project' }];
api.appTypes.list = async ({ project_id }) => [{ id: project_id === 'project' ? 'app' : 'other-app', project_id, name: project_id === 'project' ? 'Web portal' : 'Other app' }];
api.integrations.list = async query => { window.workspaceCalls.providers.push(query); return [{ id: 'model', type: 'llm', name: 'Project model', model: 'review-model', is_active: true }, { id: 'disabled-model', type: 'llm', name: 'Disabled model', is_active: false }]; };
api.agenticWorkflows.ask = realAsk; api.agenticWorkflows.getSession = realGetSession;
window.savedReviews = [];
api.workspaceTransactions.list = api.agenticWorkflows.listSessions = async query => { window.workspaceCalls.sessions.push(query); return structuredClone(window.savedReviews); };
api.workspaceTransactions.events = async id => { window.workspaceCalls.events.push(id); return structuredClone(window.savedEvents || []); };
api.workspaceTransactions.get = async (id, options) => { window.workspaceCalls.lookups.push(id); if (window.lookupDelay) return new Promise(resolve => { window.finishLookup = () => resolve(structuredClone(window.deepReview)); window.lookupSignal = options.signal; }); return structuredClone(window.deepReview); };
api.repositoryAgents.list = async () => ({ items: [], total: 0, has_more: false });
for (const name of ['testCases', 'issues', 'knowledgeRepo', 'agenticWorkflows']) for (const method of ['create', 'update', 'delete']) if (api[name]?.[method]) api[name][method] = async input => { window.workspaceCalls.writes.push({ name, method, input }); throw new Error('This fixture does not publish assets.'); };
window.enablePreviewFixture = () => {
  api.agenticWorkflows.create = async payload => { window.previewWorkflow = { id: 'workflow-preview', ...payload, created_at: '2026-09-10T10:00:00Z' }; window.workspaceCalls.writes.push({ name: 'workflow', method: 'create', input: payload }); return structuredClone(window.previewWorkflow); };
  api.agenticWorkflows.list = async () => window.previewWorkflow ? [structuredClone(window.previewWorkflow)] : [];
  api.agenticWorkflows.listRuns = async () => window.previewRecord ? [structuredClone(window.previewRecord)] : [];
  api.agenticWorkflows.run = async (id, input) => { window.workspaceCalls.writes.push({ name: 'workflow-preview', method: 'run', input }); window.previewRecord = { id: 'preview-created', workflow_id: id, workflow_name: window.previewWorkflow.name, project_id: 'project', app_type_id: 'app', status: 'completed', trigger_kind: 'manual', workflow_snapshot: structuredClone(window.previewWorkflow), node_results: [{ node_id: window.previewWorkflow.nodes[0].id, status: 'completed', output: { preview_only: true, tools_executed: false } }], output_payload: { preview_only: true }, started_at: '2026-09-10T10:00:00Z', completed_at: '2026-09-10T10:00:01Z', created_at: '2026-09-10T10:00:00Z' }; return structuredClone(window.previewRecord); };
};
window.changeSpecialistProject = () => setCurrentScope('other', 'other-app'); window.restoreSpecialistProject = () => setCurrentScope('project', 'app');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function RouteObserver() { const location = useLocation(); const navigate = useNavigate(); window.navigateWorkspace = navigate; useEffect(() => { window.workspaceRoute = location.pathname + location.search; }, [location]); return null; }
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[params.get('route') || '/agentic-workflows?view=agents']}><AuthProvider><RouteObserver /><div className="app-shell app-layout" style={{ gridTemplateColumns: 'minmax(0,1fr)', padding: 0 }}><main className="workspace-main" data-route="/agentic-workflows"><AgenticWorkflowsPage /></main></div></AuthProvider></MemoryRouter></QueryClientProvider>);
`;
const specialists = [
  ['quality-orchestrator', 'Quality Orchestrator', 6, 'Prioritized quality plan'],
  ['story-architect', 'Story Architect', 3, 'Acceptance criteria review'],
  ['test-designer', 'Test Design Agent', 5, 'Traceable scenario brief'],
  ['automation-engineer', 'Automation Engineer', 5, 'Automation improvement plan'],
  ['run-planner', 'Smart Run Planner', 5, 'Risk-based run recommendation'],
  ['failure-analyst', 'Failure Analyst', 4, 'Failure investigation brief'],
  ['bug-reporter', 'Defect Reporter', 5, 'Reviewable defect outline'],
  ['bug-triage', 'Defect Triage Agent', 5, 'Defect prioritization brief'],
  ['quality-evaluator', 'Quality Evaluator', 6, 'Evidence readiness review'],
  ['repository-curator', 'Object Repository Curator', 4, 'Repository maintenance brief']
];
const result = {
  headline: 'Checkout coverage needs one targeted review',
  executive_summary: 'The retry boundary is documented; the duplicate-order outcome needs confirmation.',
  response: 'Review the checkout retry behavior against the linked story before adding a case.',
  recommendations: ['Review the retry acceptance boundary.', 'Add a duplicate-order scenario after confirming the contract.'],
  assumptions: ['The selected story is the current approved revision.'],
  evidence_gaps: ['No runtime retry trace was supplied.'],
  citation_ids: ['story-checkout'],
  findings: [{ title: 'Retry boundary is documented', detail: 'The story requires a single order for repeated submissions.', priority: 'high', citation_ids: ['story-checkout'] }],
  deliverables: [{ title: 'Duplicate-order test outline', type: 'test_scenario', detail: 'Arrange an approved retry state and observe the order count.' }],
  evaluation: { grounding: 80, completeness: 65, traceability: 80, risk_control: 90, label: 'Review evidence diagnostics', rationale: 'The contract is cited; runtime behavior still needs evidence.' },
  readiness: { status: 'limited_evidence', limitations: ['One documented story; runtime outcomes remain unverified.'] }
};
function response(id = 'review-created', agent = 'test-designer') {
  const citations = [{ scope: 'stories', id: 'story-checkout', label: 'Checkout retry acceptance' }];
  const events = [{ id: 'event-context', transaction_id: id, phase: 'context', level: 'info', message: 'Retrieved the permitted checkout story.', details: { permitted_sources: 1 }, created_at: '2026-09-10T10:00:00Z' }];
  const metadata = { agent_id: agent, agent_name: 'Test Design Agent', prompt: 'Review checkout retry coverage.', result, citations, guardrails: ['Project-scoped evidence only.'], generation_mode: 'deterministic' };
  return { transaction: { id, project_id: 'project', app_type_id: 'app', title: 'Checkout retry review', category: 'ai_agent', status: 'completed', metadata, event_count: 1, created_at: '2026-09-10T10:00:00Z' }, result, citations, guardrails: metadata.guardrails, events, provenance: { provider: 'Evidence engine', generation_mode: 'deterministic', requires_human_review: true, context_route: { input_type: 'test_design', priority_scopes: ['stories', 'test-cases'], deliverable_contract: 'Reviewable scenario brief' } } };
}
async function fit(page, width) {
  await page.setViewportSize({ width, height: 1050 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `no page overflow at ${width}px`);
}
async function capture(page, path) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.workspace-main, .page-agentic-workflows').forEach(element => { element.scrollTop = 0; }); });
  await page.waitForTimeout(350);
  await page.screenshot({ path, fullPage: true });
}

test('agent library and specialists provide scoped, editable evidence reviews with honest outcomes', { timeout: 120000 }, async () => {
  const name = 'agent-workspace-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  const screenshots = '/tmp/qaira-agents-product-after'; let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture); await mkdir(screenshots, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true }); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const baseUrl = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5178'}/${name}.html`;
    await page.route('**/agentic-assistant/sessions/*', async route => {
      const id = new URL(route.request().url()).pathname.split('/').pop();
      const saved = id === 'viewer-review' ? response('viewer-review') : await page.evaluate(id => { window.workspaceCalls.lookups.push(id); return window.deepReview; }, id);
      await route.fulfill({ status: saved ? 200 : 404, contentType: 'application/json', body: JSON.stringify(saved || { message: 'Review not found.' }) });
    });
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Open Object Repository Generator', exact: true }).waitFor();
    assert.equal(await page.locator('.agent-library-card').count(), 14);
    assert.deepEqual(await page.evaluate(() => window.workspaceCalls.providers), [], 'library avoids model lookups');
    await capture(page, screenshots + '/01-library-desktop.png');
    await page.getByLabel('Search agents', { exact: true }).fill('locators');
    assert.ok(await page.locator('.agent-library-card').count() > 0); assert.ok(await page.locator('.agent-library-card').count() < 14);
    await page.getByLabel('Search agents', { exact: true }).fill('no matching task 712');
    await page.getByRole('heading', { name: 'No matching agents', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Show all agents', exact: true }).click();
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^Build from source/ }).click();
    assert.equal(await page.locator('.agent-library-card').count(), 4);
    await page.getByRole('button', { name: 'Pin API Test Case Generator', exact: true }).click();
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^Pinned/ }).click();
    assert.equal(await page.locator('.agent-library-card').count(), 1);
    await page.reload(); await page.getByRole('button', { name: 'Unpin API Test Case Generator', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^Plan & assess/ }).click();
    assert.equal(await page.locator('.agent-library-card').count(), 3);
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^Design & automate/ }).click();
    assert.equal(await page.locator('.agent-library-card').count(), 3);
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^Investigate & improve/ }).click();
    assert.equal(await page.locator('.agent-library-card').count(), 4);
    await page.getByRole('group', { name: 'Filter agents by purpose' }).getByRole('button', { name: /^All agents/ }).click();
    await fit(page, 390); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await capture(page, screenshots + '/02-library-dark-390.png');
    await page.evaluate(() => document.documentElement.dataset.theme = ''); await fit(page, 1440);
    for (const [id, name, scopes, output] of specialists) {
      await page.getByRole('button', { name: 'Open ' + name, exact: true }).click();
      await page.getByRole('heading', { name: 'Your task', exact: true }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Specialist agent', exact: true }).inputValue(), id);
      assert.match(await page.evaluate(() => window.workspaceRoute), new RegExp('agent=' + id));
      assert.equal(await page.locator('.agent-command-context input:checked').count(), scopes);
      assert.ok((await page.getByLabel('Ask or delegate to HelloTest AI', { exact: true }).inputValue()).length > 30);
      await page.getByRole('heading', { name: output, exact: true }).first().waitFor();
      await page.getByRole('button', { name: /^Start with a focused review/ }).click();
      assert.ok((await page.getByLabel('Ask or delegate to HelloTest AI', { exact: true }).inputValue()).length > 50);
      assert.equal(await page.getByRole('button', { name: 'Accept agent output', exact: true }).count(), 0);
      if (id === 'failure-analyst') await capture(page, screenshots + '/03-specialist-ready.png');
      await page.getByRole('button', { name: 'Back to all AI Agents', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Open Test Design Agent', exact: true }).click();
    const task = page.getByLabel('Ask or delegate to HelloTest AI', { exact: true });
    await task.fill('Review checkout retry coverage and identify one useful scenario.');
    await page.getByRole('group', { name: 'Review format' }).getByRole('button', { name: 'Review brief', exact: true }).click();
    await page.getByRole('combobox', { name: 'AI provider', exact: true }).selectOption('model');
    assert.equal(await page.getByRole('option', { name: 'Disabled model', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Add context', exact: true }).click();
    await page.getByLabel('Defects', { exact: true }).uncheck();
    await page.locator('.agent-command-context > summary').click();
    const requests = []; let requestMode = 'success', pendingRoute;
    await page.route(/\/agentic-assistant\/sessions(?:\?.*)?$/, async route => {
      requests.push({ headers: route.request().headers(), body: JSON.parse(route.request().postData()) });
      if (requestMode === 'pending') { pendingRoute = route; return; }
      if (requestMode === 'failure') { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'The review provider is unavailable. Try again.' }) }); return; }
      const reply = response('review-created');
      await page.evaluate(reply => { window.savedReviews = [reply.transaction]; window.savedEvents = reply.events; window.deepReview = reply; }, reply);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    });
    await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByText(result.headline, { exact: true }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, 'Bearer specialist-fixture');
    assert.equal(requests[0].body.project_id, 'project'); assert.equal(requests[0].body.app_type_id, 'app');
    assert.equal(requests[0].body.agent_id, 'test-designer'); assert.equal(requests[0].body.integration_id, 'model');
    assert.equal(requests[0].body.mode, 'agent'); assert.ok(!requests[0].body.context_scopes.includes('bugs'));
    assert.equal(await page.getByRole('button', { name: 'Accept agent output', exact: true }).count(), 0);
    await page.getByText('Limited evidence', { exact: true }).waitFor();
    await page.getByText(result.evidence_gaps[0], { exact: true }).waitFor();
    await capture(page, screenshots + '/04-specialist-result.png');
    await page.getByRole('button', { name: 'Edit brief', exact: true }).click();
    await page.locator('#agent-outcome-response').fill('Edited review: confirm one order after an approved retry.');
    await page.getByLabel('Edit next action 1', { exact: true }).fill('Review the approved retry contract with the product owner.');
    await page.locator('.agent-outcome-recommendation-review input[type=checkbox]').nth(1).uncheck();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download brief', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'specialist-review.md');
    const exported = await readFile(await download.path(), 'utf8');
    assert.match(exported, /Edited review: confirm one order/); assert.match(exported, /Review the approved retry contract with the product owner/);
    assert.doesNotMatch(exported, /Add a duplicate-order scenario after confirming the contract\./);
    assert.ok(exported.includes(result.deliverables[0].detail));
    assert.ok(exported.includes(result.findings[0].detail));
    assert.match(exported, /Checkout retry acceptance/); assert.match(exported, /No runtime retry trace/);
    assert.deepEqual(await page.evaluate(() => window.workspaceCalls.writes), []);
    await page.getByRole('button', { name: 'Finish editing', exact: true }).click();
    await page.getByRole('button', { name: 'View outcome evidence', exact: true }).click();
    await page.getByRole('dialog', { name: 'Outcome evidence', exact: true }).waitFor();
    await page.getByText('Checkout retry acceptance', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close Outcome evidence', exact: true }).click();
    await page.getByRole('group', { name: 'Specialist review views' }).getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByText('Retrieved the permitted checkout story.', { exact: true }).waitFor();
    await page.getByRole('group', { name: 'Specialist review views' }).getByRole('button', { name: 'Review brief', exact: true }).click();
    await fit(page, 390); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await capture(page, screenshots + '/05-specialist-result-dark-390.png');
    await page.getByRole('button', { name: 'Review another task', exact: true }).click();
    await page.locator('.agent-command-context > summary').click();
    await page.getByLabel('Defects', { exact: true }).check();
    assert.equal(await page.getByLabel('Defects', { exact: true }).isChecked(), true);
    const contextBox = await page.locator('.agent-command-context__menu').boundingBox();
    assert.ok(contextBox.x >= 0 && contextBox.x + contextBox.width <= 391, 'mobile context menu fits the viewport');
    await capture(page, screenshots + '/08-specialist-context-dark-390.png');
    await page.locator('.agent-command-context > summary').click();
    const darkContrast = await page.evaluate(() => {
      const element = document.querySelector('.agent-command-mode button[aria-pressed="true"]');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d');
      const luminance = rgb => rgb.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.push(node);
      context.fillStyle = 'white'; context.fillRect(0, 0, 1, 1);
      for (const node of ancestors.reverse()) { context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1); }
      const background = luminance([...context.getImageData(0, 0, 1, 1).data]);
      context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
      const foreground = luminance([...context.getImageData(0, 0, 1, 1).data]);
      return { color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, ratio: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) };
    });
    assert.ok(darkContrast.ratio >= 4.5, 'selected review mode contrast: ' + JSON.stringify(darkContrast));
    await page.getByRole('button', { name: 'Hide task setup', exact: true }).click();
    await page.evaluate(() => document.documentElement.dataset.theme = ''); await fit(page, 1440);
    await page.getByRole('button', { name: 'New review', exact: true }).click();
    requestMode = 'failure'; await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'review provider is unavailable' }).waitFor();
    assert.match(await task.inputValue(), /Review checkout retry coverage/);
    assert.equal(await page.locator('.agent-outcome-panel').count(), 0, 'failed reviews do not retain a previous successful outcome');
    requestMode = 'pending'; await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByRole('button', { name: 'Stop review', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop review', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Review stopped' }).waitFor();
    assert.match(await task.inputValue(), /Review checkout retry coverage/);
    if (pendingRoute) await pendingRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response('late-review')) }).catch(() => {});
    assert.equal(await page.locator('.agent-outcome-panel').count(), 0, 'cancelled late responses do not replace the current task');

    pendingRoute = null; requestMode = 'pending';
    await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByRole('button', { name: 'Stop review', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Specialist review views' }).getByRole('button', { name: /^Saved reviews/ }).click();
    await page.locator('.agent-specialist-history > button').filter({ hasText: 'Checkout retry review' }).click();
    await page.getByText(result.headline, { exact: true }).waitFor();
    if (pendingRoute) await pendingRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response('superseded-live-review')) }).catch(() => {});
    assert.match(await page.evaluate(() => window.workspaceRoute), /session=review-created/);
    assert.doesNotMatch(await page.evaluate(() => window.workspaceRoute), /superseded-live-review/);
    await page.getByRole('button', { name: 'New review', exact: true }).click();

    pendingRoute = null; requestMode = 'pending';
    await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByRole('button', { name: 'Stop review', exact: true }).waitFor();
    await page.evaluate(() => window.changeSpecialistProject());
    await page.getByRole('button', { name: 'Stop review', exact: true }).waitFor({ state: 'detached' });
    if (pendingRoute) await pendingRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response('stale-project-review')) }).catch(() => {});
    assert.equal(await page.locator('.agent-outcome-panel').count(), 0, 'a response for the previous project cannot populate the current scope');
    assert.doesNotMatch(await page.evaluate(() => window.workspaceRoute), /session=stale-project-review/);
    await page.evaluate(() => window.restoreSpecialistProject());

    const foreign = response('foreign-review'); foreign.transaction.project_id = 'other';
    await page.evaluate(reply => { window.deepReview = reply; window.navigateWorkspace('/agentic-workflows?view=workbench&agent=test-designer&session=foreign-review'); }, foreign);
    await page.getByText('This review belongs to a different project, application or specialist.', { exact: true }).waitFor();
    assert.equal(await page.locator('.agent-outcome-panel').count(), 0, 'foreign saved results are not rendered');

    // A direct link must fetch its review even when it is outside the 20-item history.
    const deep = response('older-review');
    deep.transaction.description = 'Review the saved checkout retry boundary against approved cases.';
    deep.transaction.metadata.context_scopes = ['stories', 'test-cases'];
    await page.evaluate(reply => { window.savedReviews = []; window.deepReview = reply; window.savedEvents = reply.events; window.navigateWorkspace('/agentic-workflows?view=workbench&agent=test-designer&session=older-review'); }, deep);
    await page.getByText(result.headline, { exact: true }).waitFor();
    assert.ok((await page.evaluate(() => window.workspaceCalls.lookups)).includes('older-review'));
    await page.evaluate(reply => { window.savedReviews = [reply.transaction]; }, deep);
    await page.getByRole('button', { name: 'Recent work', exact: true }).click();
    await page.getByRole('heading', { name: 'Recent work', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh work', exact: true }).click();
    await page.locator('.agent-activity-row').filter({ hasText: 'Checkout retry review' }).waitFor();
    await page.getByRole('checkbox', { name: 'Needs attention', exact: true }).check();
    assert.equal(await page.locator('.agent-activity-row').count(), 1);
    await capture(page, screenshots + '/07-recent-work.png');
    await page.locator('.agent-activity-row').filter({ hasText: 'Checkout retry review' }).click();
    await page.getByText(result.headline, { exact: true }).waitFor();
    await page.getByText('Plan a reusable workflow', { exact: true }).click();
    await page.getByText('Create a reusable specialist review with evidence evaluation and a human decision at the end.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Create workflow draft', exact: true }).click();
    await page.getByRole('button', { name: 'Preview workflow', exact: true }).waitFor();
    await page.getByText('Check execution readiness before starting.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Run workflow', exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.workspaceCalls.writes), []);
    assert.ok(await page.locator('.agentic-inspector-card .rovo-provider-copy').evaluate(element => element.getBoundingClientRect().width) >= 180, 'workflow provider message remains readable in the inspector');
    await capture(page, screenshots + '/06-workflow-preview.png');
    await page.evaluate(() => window.enablePreviewFixture());
    await page.getByRole('button', { name: 'Preview workflow', exact: true }).click();
    await page.getByText('Workflow preview captured. Tools and model calls were not executed.', { exact: true }).waitFor();
    await page.getByText('Preview graph', { exact: true }).waitFor();
    const previewWrites = await page.evaluate(() => window.workspaceCalls.writes);
    assert.deepEqual(previewWrites.map(call => call.name), ['workflow', 'workflow-preview']);
    assert.equal(previewWrites[0].input.settings.source_review_id, 'older-review');
    assert.deepEqual(previewWrites[0].input.settings.context_scopes, ['stories', 'test-cases']);
    assert.equal(previewWrites[1].input.input_payload.request, deep.transaction.description);
    assert.equal(previewWrites[1].input.input_payload.source_review_id, 'older-review');
    assert.equal(previewWrites[1].input.input_payload.reviewed_outcome, result.response);
    await capture(page, screenshots + '/09-workflow-preview-result.png');
    await page.goto(baseUrl + '?readonly=true&route=' + encodeURIComponent('/agentic-workflows?view=workbench&agent=test-designer&session=viewer-review'));
    await page.getByText(result.headline, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review another task', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Start review', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Accept agent output', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create workflow draft', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Download brief', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
