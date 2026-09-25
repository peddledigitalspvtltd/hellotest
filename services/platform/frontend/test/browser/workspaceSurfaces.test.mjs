import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { PageHeader } from '/src/shared/components/PageHeader';
import { WorkspaceMasterDetail } from '/src/platform/components/WorkspaceMasterDetail';
import { SubnavTabs } from '/src/shared/components/SubnavTabs';
import { CatalogSearchFilter } from '/src/shared/components/CatalogSearchFilter';
import { CatalogViewToggle } from '/src/shared/components/CatalogViewToggle';
import { DataTable } from '/src/shared/components/DataTable';
import { StatusBadge } from '/src/shared/components/StatusBadge';
import '@fontsource/inter/400.css'; import '@fontsource/inter/500.css'; import '@fontsource/inter/600.css'; import '@fontsource/hanken-grotesk/600.css';
import '/src/styles.css'; import '/src/dark-theme.css'; import '/src/catalog-list.css'; import '/src/modal-system.css'; import '/src/workspace-layout.css';
import '/src/platform/components/workspace-experience.css'; import '/src/platform/components/workspace-surfaces.css';
const session={token:'surface-fixture',user:{id:'designer',role:'admin',name:'Reviewer',email:'reviewer@example.test'}}; sessionStorage.write(session);
for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const [name,value]of Object.entries(methods))if(typeof value==='function')methods[name]=async()=>[];
api.auth.session=async()=>session;api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const rows=[{id:'a',key:'SHOP-204',title:'Recover checkout after a payment authorization expires across regional payment providers',status:'in_progress',owner:'Maria Chen'},{id:'b',key:'SHOP-205',title:'Display clear delivery estimates before confirmation',status:'passed',owner:'Alex Morgan'},{id:'c',key:'SHOP-206',title:'Preserve an abandoned basket when a customer signs in',status:'blocked',owner:'Taylor Kim'}];
const routes={stories:['Stories','Product management','Plan acceptance criteria and connect your delivery evidence.'],cases:['Test Cases','Test management','Design reusable scenarios with clear steps and expected outcomes.'],runs:['Test Runs','Execution','Review run outcomes and follow the work that needs attention.'],agents:['AI Agents','AI specialists','Turn repository source and project evidence into useful quality work.'],settings:['Workspace Settings','Settings','Save interface defaults and behavior preferences for your workspace.']};
function Fixture(){const[route,setRoute]=React.useState('stories');const[tab,setTab]=React.useState('overview');const[mode,setMode]=React.useState('tile');const[search,setSearch]=React.useState('');const[detail,setDetail]=React.useState(false);const[long,setLong]=React.useState(false);window.surfaceRoute=setRoute;window.surfaceDetail=setDetail;window.surfaceLong=setLong;const title=long?'Release preparation and cross-platform regression coverage for international payment authorization and customer recovery':routes[route][0];const filtered=rows.filter(row=>row.title.toLowerCase().includes(search.toLowerCase()));
const table=<DataTable columns={[{key:'key',label:'Work item',render:row=>row.key},{key:'title',label:'Title',render:row=><strong>{row.title}</strong>},{key:'status',label:'Status',render:row=><StatusBadge value={row.status}/>},{key:'owner',label:'Owner',render:row=>row.owner}]} rows={filtered} getRowKey={row=>row.id} emptyMessage='No matching items' includeDiscoveredColumns={false} enableRowSelection enableColumnResize={false}/>;
const browse=<section className='panel card'><div className='catalog-command-toolbar test-case-catalog-toolbar'><div className='catalog-toolbar-discovery'><CatalogViewToggle value={mode} onChange={setMode}/><CatalogSearchFilter value={search} onChange={setSearch} placeholder='Search work items' title='Filters'><label className='catalog-filter-field'>Status<select><option>All statuses</option><option>In progress</option></select></label></CatalogSearchFilter></div><div className='catalog-toolbar-actions'><button className='primary-button' onClick={()=>setDetail(true)}>Create {route==='stories'?'story':'item'}</button><button className='ghost-button'>Import</button></div></div>{mode==='list'?table:<div className='record-grid tile-browser-grid' style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(250px,100%),1fr))',gap:16,padding:18}}>{filtered.map(row=><article key={row.id} className='record-card tile-card requirement-catalog-card' tabIndex={0}><div className='tile-card-main'><div className='tile-card-select-row requirement-tile-top-row'><input type='checkbox' aria-label={'Select '+row.key}/><span className='display-id-badge'>{row.key}</span><StatusBadge value={row.status}/></div><div className='tile-card-header requirement-tile-header'><div className='tile-card-title-group'><strong>{row.title}</strong></div></div><p>Traceable quality work with a clear owner and current evidence.</p><div className='tile-card-footer'><span>{row.owner}</span><button className='ghost-button' onClick={()=>setDetail(true)}>Open details</button></div></div></article>)}</div>}</section>;
const editor=<section className='panel card test-case-workspace-shell'><div className='test-case-workspace-toolbar'><button className='ghost-button workspace-back-button' onClick={()=>setDetail(false)}>Back to catalog</button><strong>Test case details</strong></div><div data-testid='virtual-list' style={{height:360,overflow:'auto',position:'relative'}}><div style={{height:2400,position:'relative'}}>{Array.from({length:40},(_,i)=><div key={i} data-testid='virtual-row' className='record-card virtual-card' style={{position:'absolute',top:i*60,height:60,left:0,right:0,padding:10}}>Step {i+1}: verify the next expected behavior</div>)}</div></div></section>;
return <div className='app-shell app-layout workspace-experience-v2 app-layout--workspace-wide' style={{gridTemplateColumns:'minmax(0,1fr)',padding:0}}><main className='workspace-main main main--library-fill' data-route={route==='cases'?'/test-cases':route==='runs'?'/executions':route==='agents'?'/agentic-workflows':'/'+route}><div className={'page-content'+(detail?' page-content--workspace-focus':'')}><PageHeader eyebrow={routes[route][1]} title={title} description={routes[route][2]} actions={<button className='ghost-button'>More options</button>}/><div className='workspace-section-tabs-shell'><SubnavTabs className='section-switch-bar' value={tab} onChange={setTab} items={[{value:'overview',label:'Overview',meta:'3'},{value:'evidence',label:'Evidence',meta:'12'},{value:'history',label:'History'}]}/></div><WorkspaceMasterDetail isDetailOpen={detail} browseView={browse} detailView={editor}/>{!detail&&route==='settings'&&<div className='settings-section-stack'><section className='settings-section'><div className='settings-section-heading'><h2>General</h2></div><div className='two-column-grid'><section className='panel card'><h3>Appearance</h3><label className='settings-input-field'>Workspace name<input defaultValue='Commerce platform'/></label></section><section className='panel card'><h3>Language and region</h3><label className='settings-input-field'>Language<select><option>English</option><option>Español</option></select></label></section></div></section></div>}</div></main></div>}
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><Fixture/></AuthProvider></QueryClientProvider></MemoryRouter>);
`;

test(
  "admin-derived shared workspace surfaces preserve catalog interaction, responsive fit and editor geometry",
  { timeout: 90000 },
  async () => {
    const name = "workspace-surfaces-" + randomUUID();
    const html = new URL(name + ".html", root),
      tsx = new URL(name + ".tsx", root);
    let browser;
    try {
      await writeFile(
        html,
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`,
      );
      await writeFile(tsx, fixture);
      await mkdir("/tmp/qaira-workspace-surfaces", { recursive: true });
      browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_EXECUTABLE
          ? { executablePath: process.env.CHROME_EXECUTABLE }
          : {}),
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `${process.env.VITE_TEST_URL || "http://127.0.0.1:5179"}/${name}.html`,
      );
      await page
        .getByRole("heading", { name: "Stories", exact: true })
        .waitFor();
      const routes = {
        stories: "Stories",
        cases: "Test Cases",
        runs: "Test Runs",
        agents: "AI Agents",
        settings: "Workspace Settings",
      };
      for (const [route, title] of Object.entries(routes)) {
        await page.evaluate((route) => window.surfaceRoute(route), route);
        await page.getByRole("heading", { name: title, exact: true }).waitFor();
        await page.screenshot({
          path: `/tmp/qaira-workspace-surfaces/${route}-shared-surfaces.png`,
          fullPage: true,
        });
      }
      await page.evaluate(() => window.surfaceRoute("stories"));
      await page.getByRole("tab", { name: /Overview/ }).focus();
      await page.getByRole("tab", { name: /Overview/ }).press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: /Evidence/ })
          .getAttribute("aria-selected"),
        "true",
      );
      await page
        .getByRole("textbox", { name: "Search work items" })
        .fill("basket");
      assert.equal(await page.locator(".requirement-catalog-card").count(), 1);
      await page.getByRole("textbox", { name: "Search work items" }).fill("");
      await page
        .getByRole("button", { name: "List view", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: "Select row 1", exact: true })
        .check();
      assert.equal(
        await page
          .getByRole("checkbox", { name: "Select row 1", exact: true })
          .isChecked(),
        true,
      );
      await page.screenshot({
        path: "/tmp/qaira-workspace-surfaces/catalog-table.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Open filters", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Filters", exact: true })
        .waitFor();
      await page
        .getByRole("dialog", { name: "Filters", exact: true })
        .press("Escape");
      await page
        .getByRole("dialog", { name: "Filters", exact: true })
        .waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Tile view", exact: true })
        .click();
      await page.evaluate(() => window.surfaceLong(true));
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const bound = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          viewport: innerWidth,
          main: document
            .querySelector(".workspace-main")
            .getBoundingClientRect().right,
        }));
        assert.ok(
          bound.doc <= width + 1 && bound.main <= width + 1,
          JSON.stringify(bound),
        );
        await page.screenshot({
          path: `/tmp/qaira-workspace-surfaces/long-title-${width}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        window.surfaceLong(false);
      });
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".requirement-catalog-card"))
            .backgroundColor === "rgb(25, 42, 51)",
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".catalog-toolbar-actions .primary-button"),
          ).color === "rgb(20, 45, 48)",
      );
      await page.screenshot({
        path: "/tmp/qaira-workspace-surfaces/dark.png",
        fullPage: true,
      });
      await page.evaluate(() => window.surfaceDetail(true));
      const before = await page
        .getByTestId("virtual-row")
        .first()
        .boundingBox();
      assert.equal(before.height, 60);
      await page
        .getByTestId("virtual-list")
        .evaluate((el) => (el.scrollTop = 900));
      assert.equal(
        await page.getByTestId("virtual-list").evaluate((el) => el.scrollTop),
        900,
      );
      await page.setViewportSize({ width: 390, height: 900 });
      const after = await page.getByTestId("virtual-row").first().boundingBox();
      assert.equal(after.height, 60);
      assert.ok(after.x >= 0 && after.x + after.width <= 391);
      await page
        .getByRole("button", { name: "Back to catalog", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create story", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await Promise.allSettled([unlink(html), unlink(tsx)]);
    }
  },
);
