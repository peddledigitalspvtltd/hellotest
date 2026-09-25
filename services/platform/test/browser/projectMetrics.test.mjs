import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../frontend/', import.meta.url);
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AppShell} from '/src/platform/components/AppShell';
import {ProjectsPage} from '/services/platform/frontend/pages/ProjectsPage';import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
const session={token:'isolated-project-metrics',user:{id:'reviewer',name:'Reviewer',role:'admin',email:'reviewer@example.test'}};
sessionStorage.write(session);setCurrentScope('commerce','web');
function stub(value){for(const [key,entry] of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.metadata.domain=async()=>({});api.notifications.unreadCount=async()=>({total:0,by_preference:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
const projects=[{id:'commerce',name:'Commerce platform',description:'Entire project coverage and newest run outcomes.',has_access:true},{id:'empty',name:'Empty project',has_access:true},{id:'rolling',name:'Pending metric upgrade',has_access:true},{id:'private',name:'Private project',has_access:false}];
api.metadata.workspaceScopes=async()=>({projects:projects.filter(p=>p.has_access)});api.projects.list=async()=>projects.filter(p=>p.has_access);api.projects.catalog=async()=>projects;api.projects.get=async(id)=>projects.find(p=>p.id===id);
api.appTypes.list=async({project_id})=>[{id:project_id==='commerce'?'web':project_id+'-app',project_id,name:'Web app',type:'web'}];
const base=p=>({project_id:p.id,name:p.name,counts:{stories:4,modules:2,cases:8,suites:1,bugs:5,members:1,app_types:1,open_bugs:0},members:[],app_types:[],story_coverage:{total:4,covered:3,percent:75},automation_coverage:{total:8,automated:8,percent:100},pass_confidence:{total:10,passed:10,percent:100,case_total:5,case_passed:5,bug_total:5,bug_resolved:5},execution_evidence:{total:5,evidenced:5,missing:0,percent:100,threshold:80,violates:false},latest_execution:{id:'older',name:'Older finalized run',status:'passed'},latest_failed_count:0,latest_blocked_count:0,bug_count:5,open_bug_count:0,failure_impacts:{modules:{total:0,top:[]},requirements:{total:0,top:[]}},bug_impacts:{modules:{total:0,top:[]},requirements:{total:0,top:[]}},readiness_score:91,health_tone:'success',health_label:'Healthy',readiness_label:'Release Ready',attention_reasons:[]});
const metrics=projects.filter(p=>p.has_access).map(base);
metrics[0].latest_run_pass_rate={execution:{id:'newest',name:'Newest project run',status:'running'},total:8,passed:3,percent:38,counts:{passed:3,failed:1,not_applicable:1,blocked:1,pending:2}};
metrics[1].story_coverage={total:0,covered:0,percent:0};metrics[1].latest_run_pass_rate={execution:null,total:0,passed:0,percent:null,counts:{}};
api.projects.portfolioAnalytics=async()=>({projects:metrics,configuration:{}});
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{path:'projects',element:<ProjectsPage/>}]}],{initialEntries:['/projects']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId={session.user.id}><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test('Project tiles show whole-project coverage, newest-run status counts and inline header evidence', { timeout: 60000 }, async () => {
  const name = 'project-metrics-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API call'); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5188'}/${name}.html`);
    const tile = title => page.locator('article.project-catalog-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const commerce = tile('Commerce platform');
    await commerce.getByRole('region', { name: 'Latest Run Pass Rate: 38%', exact: true }).waitFor();
    assert.equal(await commerce.getByRole('region', { name: 'Overall Story Coverage: 75%', exact: true }).count(), 1);
    const run = commerce.getByRole('region', { name: 'Latest Run Pass Rate: 38%', exact: true });
    assert.equal(await run.getByRole('img').getAttribute('aria-label'), '3 Passed, 1 Failed, 1 N/A, 1 Blocked, 2 Not Run');
    assert.match(await run.getAttribute('title'), /Newest project run/);
    assert.equal(await commerce.locator('.project-metric-detail').count(), 0);
    assert.equal(await commerce.locator('.project-metric-status-counts, .project-metric-status-legend').count(), 0, 'legends do not consume tile space');
    assert.equal(await run.getByRole('img').getAttribute('title'), '3 Passed, 1 Failed, 1 N/A, 1 Blocked, 2 Not Run', 'bar hover retains all status counts');
    const coverage = commerce.getByRole('region', { name: 'Overall Story Coverage: 75%', exact: true });
    assert.equal(await coverage.locator('.is-covered').getAttribute('title'), 'Covered: 3');
    assert.equal(await coverage.locator('.is-covered').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(133, 184, 255)', 'covered stories use a light blue');
    assert.equal(await run.locator('.is-passed').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(34, 160, 107)', 'passed test results retain their status color');
    assert.doesNotMatch(await run.innerText(), /Bug|100%|Older/);
    assert.equal(await commerce.locator('.project-metric-status-bar').count(), 2, 'one stacked bar per metric');
    assert.equal(await tile('Empty project').getByRole('region', { name: 'Overall Story Coverage: —', exact: true }).count(), 1);
    assert.equal(await tile('Empty project').getByRole('region', { name: 'Latest Run Pass Rate: —', exact: true }).count(), 1);
    assert.equal(await tile('Pending metric upgrade').getByRole('region', { name: 'Latest Run Pass Rate: —', exact: true }).count(), 1, 'old responses never fall back to combined pass confidence');
    assert.equal(await tile('Private project').locator('.project-metric-breakdown').count(), 0);
    const evidence = page.locator('.projects-page-header .page-header-text .projects-command-card--evidence');
    assert.equal(await evidence.count(), 1);
    await evidence.getByRole('button', { name: 'Inspect portfolio evidence', exact: true }).click();
    await page.locator('.project-risk-evidence-dialog').waitFor();
    await page.keyboard.press('Escape');
    await mkdir('/tmp/qaira-project-metrics', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('.projects-page-header').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page fits viewport');
      const headerBox = await page.locator('.projects-page-header').boundingBox();
      const evidenceBox = await evidence.boundingBox();
      assert.ok(evidenceBox.width >= Math.min(300, headerBox.width), 'evidence is not squeezed to its intrinsic button width');
      assert.ok(evidenceBox.x >= headerBox.x - 1 && evidenceBox.x + evidenceBox.width <= headerBox.x + headerBox.width + 1, 'evidence fits inside header');
      await page.screenshot({ path: `/tmp/qaira-project-metrics/projects-${width}.png` });
      await commerce.scrollIntoViewIfNeeded();
      const cardBox = await commerce.boundingBox();
      for (const box of await commerce.locator('.project-metric-status-bar').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })))) {
        assert.ok(box.x >= cardBox.x - 1 && box.x + box.width <= cardBox.x + cardBox.width + 1);
        assert.ok(box.width < cardBox.width * 0.8, 'bars remain compact without legends');
      }
      if (width < 700) await page.screenshot({ path: `/tmp/qaira-project-metrics/project-tile-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(new URL(name + '.tsx', root), { force: true });
    await rm(new URL(name + '.html', root), { force: true });
  }
});
