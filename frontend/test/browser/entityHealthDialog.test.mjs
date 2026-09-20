import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{EntityHealthDialog}from'/src/components/EntityHealthDialog';import{api}from'/src/lib/api';
import'/src/styles.css';import'/src/dark-theme.css';import'/src/modal-system.css';import'/src/catalog-list.css';
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
function App(){const[open,setOpen]=useState(false);const[tick,setTick]=useState(0);return <main><button onClick={()=>setOpen(true)}>Review Health</button>{open?<EntityHealthDialog entityType='Sprint' entityName='Checkout Delivery' summary='All 12 scoped Stories, across all pages.' onClose={()=>setOpen(false)} footer={<button className='ghost-button' onClick={()=>setTick(tick+1)}>Refresh Metrics {tick}</button>} metrics={[
{label:'Stories',value:12,detail:'12 unique Stories in the selected Sprint.'},
{label:'QA Story Completion',value:'50%',detail:'6 of 12 Stories reached QA Done.',methodology:'QA-completed Stories divided by all Stories.'},
{label:'Test Coverage',value:'75%',detail:'9 of 12 Stories have linked Test Cases.'},
{label:'Pass Rate',value:'Unavailable',detail:'Execution evidence is unavailable.'},
{label:'At Risk',value:2,tone:'danger',detail:'2 distinct Stories need attention.'},
{label:'Defect Density',value:'0.25',detail:'3 distinct linked Defects across 12 Stories.',methodology:'Defects divided by scoped Stories.'}
]}/>:null}</main>};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`;

test('Health review filters preserve values, unknowns, evidence and keyboard navigation', { timeout: 60000 }, async () => {
  const name = `entity-health-${randomUUID()}`;
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{errors.push('Unexpected API call');return route.abort();});
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    const trigger=page.getByRole('button',{name:'Review Health',exact:true});await trigger.click();
    const dialog=page.getByRole('dialog',{name:'Checkout Delivery',exact:true});await dialog.waitFor();
    assert.equal(await dialog.locator('.evidence-flip-card').count(),6);
    assert.equal(await dialog.locator('.entity-health-meter').count(),2,'Only the two explicit percentages receive proportional bars');
    const completion=dialog.getByRole('button',{name:'View evidence for QA Story Completion',exact:true});
    assert.equal(await completion.locator('.entity-health-meter > span').evaluate(node=>node.style.width),'50%');
    assert.equal(await dialog.getByRole('button',{name:'View evidence for Pass Rate',exact:true}).locator('strong').innerText(),'Unavailable');
    const originalBox=await dialog.boundingBox();
    for(const[label,expected]of[['Delivery',['Stories','QA Story Completion']],['Testing',['Test Coverage','Pass Rate']],['Risks',['At Risk','Defect Density']]]) {
      const filter=dialog.getByRole('button',{name:new RegExp('^'+label+' ')});await filter.click();
      assert.equal(await filter.getAttribute('aria-pressed'),'true');
      assert.deepEqual(await dialog.locator('.project-stat-card-trigger > span:not([class])').allTextContents(),expected);
      const filteredBox=await dialog.boundingBox();
      assert.equal(filteredBox.y,originalBox.y,'Filtering keeps the dialog and its navigation in place');
      assert.equal(filteredBox.height,originalBox.height);
    }
    await dialog.getByRole('button',{name:/^All Metrics /}).click();
    await completion.click();
    const evidence=dialog.getByRole('list',{name:'QA Story Completion evidence',exact:true});
    assert.match(await evidence.innerText(),/6 of 12 Stories/);
    await page.waitForTimeout(10500);
    assert.equal(await dialog.locator('.evidence-flip-card.is-flipped').count(),1,'Evidence remains open while the reviewer reads');
    await dialog.getByRole('button',{name:'Refresh Metrics 0',exact:true}).click();
    assert.equal(await dialog.locator('.evidence-flip-card.is-flipped').count(),1,'An unrelated parent render keeps the evidence open');
    await mkdir('/tmp/qaira-health-redesign',{recursive:true});
    await page.screenshot({path:'/tmp/qaira-health-redesign/dialog-desktop.png',animations:'disabled'});
    await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close Sprint Health');
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await trigger.click();
    assert.equal(await dialog.getByRole('button',{name:/^All Metrics /}).getAttribute('aria-pressed'),'true','A reopened review starts with all metrics');
    await dialog.getByRole('button',{name:/^Risks /}).click();
    assert.equal(await dialog.locator('.evidence-flip-card').count(),2);
    assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const footer=await dialog.locator('.entity-health-footer').boundingBox();
    assert.ok(footer.y+footer.height<=844,'Footer stays within the viewport');
    await page.screenshot({path:'/tmp/qaira-health-redesign/dialog-mobile-dark.png',animations:'disabled'});
    await page.setViewportSize({width:768,height:500});
    const shortFooter=await dialog.locator('.entity-health-footer').boundingBox();
    assert.ok(shortFooter.y+shortFooter.height<=500,'Actions remain visible in a short viewport');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`,root),{force:true}),rm(new URL(`${name}.html`,root),{force:true})]);
  }
});
