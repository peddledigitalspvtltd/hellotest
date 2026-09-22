import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{StoryChangeImpactDialog}from'/src/components/StoryChangeImpactDialog';
import{QualityMetricStrip}from'/src/components/QualityMetricStrip';import{BacklogGrowthValue}from'/src/components/BacklogGrowthValue';
import{api}from'/src/lib/api';import'/src/styles.css';import'/src/modal-system.css';
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const response={request_id:'review-current',generated_at:'2026-09-22T10:00:00Z',generation_mode:'deterministic',integration:{name:'Workspace evidence'},requirement:{id:'story',display_id:'ST-21',title:'Saved title'},impact:{risk_level:'medium',test_cases:[{id:'case',display_id:'TC-3',title:'Restore the checkout address',status:'ready'}],test_suites:[{id:'suite',display_id:'TS-1',name:'Checkout regression'}],test_runs:[{id:'run',display_id:'RUN-7',name:'Payment recovery run',status:'queued'}],automation_assets:[],totals:{test_cases:1,test_suites:1,test_runs:1,automation_assets:0}},explanation:'Current links connect this Story to checkout coverage and an upcoming run.',recommended_actions:['Review expected results against the changed acceptance criteria.','Reassess the queued run before applying the change.']};
function App(){const[open,setOpen]=useState(false);const[mode,setMode]=useState('normal');window.setImpactMode=setMode;return <main style={{padding:24}}><button onClick={()=>setOpen(true)}>Preview impact</button><QualityMetricStrip ariaLabel="Story health metrics" showCaptions={false} metrics={[{label:'Dev completion',value:'65%',progress:65,detail:'13 of20 Stories completed.'},{label:'Backlog Growth Rate',value:<BacklogGrowthValue growth={{added:3,departures:5}}/>,detail:'3 intake and5 outflow.'}]}/><div id="growing"><BacklogGrowthValue growth={{added:5,departures:3}}/></div><div id="idle"><BacklogGrowthValue growth={{added:0,departures:0}}/></div><StoryChangeImpactDialog open={open} storyTitle="Unsaved checkout recovery Story" response={mode==='error'?null:mode==='restricted'?{...response,scope:{unavailable_sources:['testcase.view']}}:response} error={mode==='error'?'Provider unavailable':null} onRetry={()=>setMode('normal')} onClose={()=>setOpen(false)}/></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);`;

test('Story impact consolidates searchable evidence, respects unavailable sources and stays usable across themes', { timeout: 60000 }, async () => {
  const name=`story-impact-${randomUUID()}`, files=[new URL(`${name}.tsx`,root),new URL(`${name}.html`,root)];
  let browser;
  try {
    await writeFile(files[0],fixture);await writeFile(files[1],`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5189'}/${name}.html`);
    const metrics=page.getByRole('group',{name:'Story health metrics'});
    assert.doesNotMatch(await metrics.innerText(), /% measured|Open for evidence/);
    await metrics.getByRole('button',{name:'View evidence for Dev Completion',exact:true}).click();
    await metrics.getByText('13 of20 Stories completed.',{exact:true}).waitFor();
    const colors=await page.evaluate(()=>['.is-healthy .backlog-growth-intake','.is-healthy .backlog-growth-outflow','.is-growing .backlog-growth-intake','.is-growing .backlog-growth-outflow'].map(selector=>getComputedStyle(document.querySelector(selector)).color));
    assert.equal(colors[0],colors[3]);assert.equal(colors[1],colors[2]);assert.notEqual(colors[0],colors[1]);
    await page.getByRole('button',{name:'Preview impact',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Preview Story change impact'});await dialog.waitFor();
    assert.match(await dialog.innerText(),/Unsaved checkout recovery Story/);
    assert.equal(await dialog.locator('.story-impact-records li').count(),3);
    assert.ok(await dialog.locator('.story-impact-evidence').evaluate(element => element.querySelector('li:last-child').getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom), 'All record rows fit the evidence panel rather than being clipped');
    assert.equal(await dialog.getByRole('button',{name:/evidence/i}).count(),0);
    assert.equal(await page.getByRole('dialog').count(),1);
    await mkdir('/tmp/qaira-story-impact',{recursive:true});await page.screenshot({path:'/tmp/qaira-story-impact/initial.png'});
    assert.ok(await dialog.getByLabel('Search impact evidence').isVisible(), await dialog.evaluate(el=>JSON.stringify([...el.querySelectorAll('.story-impact-body,.story-impact-evidence,.story-impact-filters,input')].map(node=>({tag:node.className,rect:node.getBoundingClientRect().toJSON(),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility})))));
    await dialog.getByLabel('Search impact evidence').fill('TC-3');assert.equal(await dialog.locator('.story-impact-records li').count(),1);
    await dialog.getByLabel('Search impact evidence').fill('');await dialog.getByLabel('Impact evidence type').selectOption('test_runs');
    assert.match(await dialog.locator('.story-impact-records').innerText(),/Payment recovery run/);
    await dialog.getByLabel('Impact evidence type').selectOption('all');
    await mkdir('/tmp/qaira-story-impact',{recursive:true});await page.screenshot({path:'/tmp/qaira-story-impact/desktop.png'});
    await dialog.getByText('Review details and limitations',{exact:true}).click();await dialog.getByText('review-current',{exact:true}).waitFor();
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Preview impact');
    await page.evaluate(()=>window.setImpactMode('restricted'));await page.getByRole('button',{name:'Preview impact',exact:true}).click();
    assert.match(await dialog.innerText(),/Their absence is not a coverage conclusion/);assert.doesNotMatch(await dialog.innerText(),/Coverage gap\./);
    assert.equal(await dialog.locator('.story-impact-records li').count(),2);
    await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
    await page.evaluate(()=>window.setImpactMode('error'));await page.getByRole('button',{name:'Preview impact',exact:true}).click();
    await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Retry preview'}).click();
    assert.equal(await dialog.locator('.story-impact-records li').count(),3);
    for(const theme of ['light','dark']){
      await page.setViewportSize({width:390,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      if(theme==='dark') await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="Search impact evidence"]')).backgroundColor==='rgb(18, 32, 48)');
      await page.screenshot({path:'/tmp/qaira-story-impact/mobile-'+theme+'.png'});
      if(theme==='dark') {
        assert.equal(await dialog.getByLabel('Search impact evidence').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(18, 32, 48)','Dark evidence input uses the dialog surface');
        assert.equal(await dialog.getByLabel('Search impact evidence').evaluate(element=>getComputedStyle(element).backgroundImage),'none','Legacy white field gradients must not hide the dark surface');
      }
      assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
      const footer=await dialog.getByRole('button',{name:'Close preview',exact:true}).boundingBox();assert.ok(footer.y+footer.height<=844);
    }
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await Promise.all(files.map(file=>rm(file,{force:true})));}
});
