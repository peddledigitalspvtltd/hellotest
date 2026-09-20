import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const name = `project-deletion-${randomUUID()}`;
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '/src/components/AppShell';
import {ProjectsPage} from '/src/pages/ProjectsPage';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
let session={token:'isolated-project-deletion',user:{id:'deletion-reviewer',name:'Reviewer',role:'admin',email:'reviewer@example.test'}};
window.removeProjectMemberships=()=>{session={...session,user:{...session.user,role:'member',permissions:[],workspace_permissions:['workspace.view'],project_permissions:{}}};sessionStorage.write(session);window.dispatchEvent(new Event('focus'))};
sessionStorage.write(session);if(!localStorage.getItem('deletion-fixture-initialized')){setCurrentScope('alpha','alpha-web');localStorage.setItem('deletion-fixture-initialized','1')}
const projectApi={delete:api.projects.delete,deletion:api.projects.deletion,catalog:api.projects.catalog,list:api.projects.list};
function stub(value){for(const [key,entry] of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);Object.assign(api.projects,projectApi);
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.metadata.domain=async()=>({});api.notifications.unreadCount=async()=>({total:0,by_preference:{}});
api.metadata.workspaceScopes=async()=>({projects:await api.projects.list()});api.projects.get=async(id)=>(await api.projects.list()).find(project=>project.id===id);
api.projects.portfolioAnalytics=async()=>({projects:[],configuration:{}});
api.appTypes.list=async({project_id})=>[{id:project_id+'-web',project_id,name:'Web app',type:'web'}];
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.refreshDeletions=()=>client.invalidateQueries({queryKey:['projects','deletion']});
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{path:'projects',element:<ProjectsPage/>},{path:'backlog',element:<p>Another workspace page</p>}]}],{initialEntries:['/projects']});
window.navigate=path=>router.navigate(path);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId={session.user.id}><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test('project deletion tracks accepted jobs through retries, navigation, reload and completion', { timeout: 90000 }, async () => {
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.clock.install({ time: new Date() });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const projects = ['alpha', 'beta', 'gamma', 'legacy'].map(id => ({ id, name: `${id.toUpperCase()} project`, has_access: true, description: 'Large test project' }));
    const jobs = new Map();
    const deletes = [];
    const polls = [];
    let pollFailure = false;
    let loseNextDeleteResponse = false;
    let catalogRequests = 0;
    const removed = new Set();
    const makeJob = (id, status = 'queued') => ({ id: `deletion-${id}`, project_id: id, project_name: `${id.toUpperCase()} project`, status, phase: status, processed_rows: 0, attempts: 1, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, '');
      const statusMatch = path.match(/^\/projects\/([^/]+)\/deletion$/);
      const deleteMatch = path.match(/^\/projects\/([^/]+)$/);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (request.method() === 'GET' && ['/projects', '/projects/catalog'].includes(path)) {
        if (path === '/projects/catalog') catalogRequests++;
        return json(200, projects.filter(project => !removed.has(project.id)));
      }
      if (request.method() === 'DELETE' && deleteMatch) {
        const id = decodeURIComponent(deleteMatch[1]);
        deletes.push(id);
        if (id === 'legacy') { removed.add(id); return json(200, { deleted: true }); }
        jobs.set(id, makeJob(id));
        if (loseNextDeleteResponse) { loseNextDeleteResponse = false; return route.abort('failed'); }
        return json(202, { accepted: true, job: jobs.get(id) });
      }
      if (request.method() === 'GET' && statusMatch) {
        const id = decodeURIComponent(statusMatch[1]);
        polls.push(id);
        if (pollFailure) return json(503, { message: 'Temporary status outage' });
        if (!jobs.has(id)) return json(404, { message: 'No deletion job found' });
        return json(200, jobs.get(id));
      }
      errors.push(`Unexpected request: ${request.method()} ${path}`);
      return route.abort();
    });
    const tile = id => page.locator('article.project-catalog-card').filter({ has: page.getByRole('heading', { name: `${id.toUpperCase()} project`, exact: true }) });
    const progress = id => page.locator(`.project-deletion-progress-item[data-project-id="${id}"]`);
    const openDelete = async id => {
      await tile(id).locator('.catalog-action-menu button[aria-haspopup="menu"]').click();
      await page.getByRole('menuitem', { name: /^Delete project/ }).click();
    };
    const confirm = async () => page.getByRole('dialog').getByRole('button', { name: 'Confirm delete', exact: true }).click();
    const setStatus = async (id, status, extra = {}) => {
      jobs.set(id, { ...jobs.get(id), status, phase: status, updated_at: new Date().toISOString(), ...extra });
      if (status === 'completed') removed.add(id);
      await page.evaluate(() => window.refreshDeletions());
    };
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html`, { waitUntil: 'domcontentloaded' });
    await tile('alpha').waitFor();
    await openDelete('alpha');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(deletes, [], 'cancel never sends DELETE');
    assert.equal(await page.getByRole('tablist', { name: 'Project detail sections' }).count(), 0, 'cancel does not open project details');
    await openDelete('alpha');
    await confirm();
    await progress('alpha').getByText('Queued for deletion', { exact: true }).waitFor();
    assert.equal(await tile('alpha').count(), 1, '202 does not remove the project');
    assert.equal(await page.evaluate(() => localStorage.getItem('hellotest.current_project_id')), 'alpha', '202 preserves the selected workspace');
    await tile('alpha').locator('.catalog-action-menu button[aria-haspopup="menu"]').click();
    assert.equal(await page.getByRole('menuitem', { name: /^Delete project/ }).isDisabled(), true, 'active job prevents duplicate deletion');
    await page.keyboard.press('Escape');
    await setStatus('alpha', 'running', { processed_rows: 12000 });
    await progress('alpha').getByText('Deleting project data… 12,000 records processed.', { exact: true }).waitFor();
    pollFailure = true;
    await page.evaluate(() => window.refreshDeletions());
    await progress('alpha').getByText(/Temporary status outage/).waitFor();
    assert.deepEqual(deletes, ['alpha'], 'polling failures do not resubmit DELETE');
    pollFailure = false;
    await page.waitForFunction(() => !document.querySelector('.project-deletion-progress-item[data-project-id="alpha"]')?.textContent.includes('Temporary status outage'));
    assert.ok(polls.filter(id => id === 'alpha').length >= 3, 'status polling recovers automatically');
    await page.evaluate(() => window.navigate('/backlog'));
    await page.getByText('Another workspace page', { exact: true }).waitFor();
    await page.evaluate(() => window.navigate('/projects'));
    await progress('alpha').getByText(/Deleting project data/).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await progress('alpha').getByText(/Deleting project data/).waitFor();
    assert.deepEqual(deletes, ['alpha'], 'route changes and reload recover the job without resubmitting');
    await setStatus('alpha', 'cleanup');
    await progress('alpha').getByText(/Cleaning up project files/).waitFor();
    assert.equal(await tile('alpha').count(), 1, 'cleanup is still in progress');
    await setStatus('alpha', 'completed');
    await progress('alpha').getByText(/Project deleted/).waitFor();
    await tile('alpha').waitFor({ state: 'detached' });
    assert.notEqual(await page.evaluate(() => localStorage.getItem('hellotest.current_project_id')), 'alpha', 'only completion clears the deleted scope');
    await page.getByRole('checkbox', { name: 'Select BETA project', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select GAMMA project', exact: true }).check();
    loseNextDeleteResponse = true;
    await page.getByRole('button', { name: 'Delete selected (2)', exact: true }).click();
    await confirm();
    await progress('beta').getByText('Queued for deletion', { exact: true }).waitFor();
    await progress('gamma').getByText('Queued for deletion', { exact: true }).waitFor();
    assert.deepEqual([...deletes].sort(), ['alpha', 'beta', 'gamma'], 'bulk queues every target despite a lost response');
    assert.equal(await page.getByRole('button', { name: 'Delete selected (2)', exact: true }).isDisabled(), true);
    await setStatus('beta', 'failed', { error: 'Storage is temporarily unavailable' });
    await progress('beta').getByText('Storage is temporarily unavailable', { exact: true }).waitFor();
    assert.equal(await progress('beta').getByRole('button', { name: 'Dismiss', exact: true }).count(), 1, 'failed deletion can be dismissed manually');
    await progress('beta').getByRole('button', { name: 'Retry deletion', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry deletion', exact: true }).click();
    await progress('beta').getByText('Queued for deletion', { exact: true }).waitFor();
    assert.equal(deletes.filter(id => id === 'beta').length, 2, 'failed jobs retry only after explicit confirmation');
    await tile('legacy').click();
    await page.getByRole('tablist', { name: 'Project detail sections' }).waitFor();
    await page.getByRole('button', { name: 'Delete project', exact: true }).click();
    await confirm();
    await progress('legacy').getByText('Project deleted.', { exact: true }).waitFor();
    await tile('legacy').waitFor({ state: 'detached' });
    await progress('legacy').getByRole('button', { name: 'Dismiss', exact: true }).click();
    await progress('legacy').waitFor({ state: 'detached' });
    // The original requester can finish cleanup after losing their final
    // project membership; project content must remain behind its normal gate.
    await setStatus('beta', 'failed', { error: 'File cleanup needs retry' });
    projects.forEach(project => removed.add(project.id));
    await page.evaluate(() => window.removeProjectMemberships());
    await page.getByRole('heading', { name: 'You need access to this area', exact: true }).waitFor();
    assert.equal(await page.locator('.projects-page').count(), 0, 'lost membership does not grant project page access');
    const gatedCatalogRequests = catalogRequests;
    await progress('beta').getByRole('button', { name: 'Retry deletion', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry deletion', exact: true }).click();
    await progress('beta').getByText('Queued for deletion', { exact: true }).waitFor();
    await setStatus('beta', 'completed');
    await progress('beta').getByText('Project deleted.', { exact: true }).waitFor();
    assert.equal(deletes.filter(id => id === 'beta').length, 3, 'receipt-only recovery can retry cleanup without current project permissions');
    assert.equal(catalogRequests, gatedCatalogRequests, 'receipt-only recovery never loads the project catalog');
    await page.clock.fastForward(30_000);
    assert.equal(await progress('beta').count(), 1, 'completion stays visible long enough for manual dismissal');
    await page.clock.fastForward(31_000);
    await progress('beta').waitFor({ state: 'detached' });
    assert.equal(await progress('gamma').count(), 1, 'active deletion never auto-dismisses');
    await setStatus('gamma', 'failed', { error: 'Temporary cleanup failure' });
    await progress('gamma').getByText('Temporary cleanup failure', { exact: true }).waitFor();
    await page.clock.fastForward(90_000);
    assert.equal(await progress('gamma').count(), 1, 'failure grants extra time to read and retry');
    await page.clock.fastForward(31_000);
    await progress('gamma').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('hellotest.project-deletions.deletion-reviewer') || '[]')), [], 'expired failure receipts do not reappear on reload');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(new URL(`${name}.tsx`, root), { force: true });
    await rm(new URL(`${name}.html`, root), { force: true });
  }
});
