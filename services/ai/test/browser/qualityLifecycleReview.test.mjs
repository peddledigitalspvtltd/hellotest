import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const engine = require(new URL('../../backend/services/qualityEvidenceRules.js', import.meta.url).pathname);
const root = new URL('../../../platform/frontend/', import.meta.url);
const snapshot = { project_id: 'project', scope: { release_id: 'release', build: 'release-24', environment_id: 'staging' }, as_of: '2026-10-04T09:15:00Z', complete: true, limitations: [],
  stories: Array.from({length: 36}, (_, i) => ({id: `s${i}`, title: `Checkout journey ${i + 1}`, acceptance_criteria: ['Confirmation records the payment reference.'], test_case_ids: [`t${i}`]})),
  tests: Array.from({length: 36}, (_, i) => ({id: `t${i}`, title: `Payment confirmation ${i + 1}`})), runs: [], attempts: [], defects: [] };
const reports = { 'quality-graph': engine.assess(snapshot, 'F17'), 'coverage-assurance': engine.assess(snapshot, 'F13'), 'release-readiness': engine.assess(snapshot, 'F11') };
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {AiLifecycleReview} from '@hellotest/ai/frontend/components/AiLifecycleReview';
import {agenticApi} from '@hellotest/agentic/frontend/api.client';
import '/src/styles.css'; import '/src/dark-theme.css';
const reports=${JSON.stringify(reports)}; window.requests=[]; window.fail=false; window.hold=false;
agenticApi.agenticWorkflows.ask=async input=>{window.requests.push(input); if(window.hold) await new Promise(resolve=>window.release=resolve); if(window.fail) throw new Error('The model could not finish this review. Retry or select another LLM.'); return {result:{headline:'Release evidence review',response:'## Review summary\\n\\nRecorded relationships connect the checkout journeys to their tests. Assertion coverage still requires verification.\\n\\n- Verify missing assertions.\\n- Review recorded evidence.\\n\\n| Evidence | Status |\\n| --- | --- |\\n| Recorded journeys | Needs review |',findings:[],recommendations:['Review criterion-level assertions before making a release decision.'],quality_assessment:reports[input.agent_id],model_execution:{effective_model:'Review model',model_calls:1}},citations:[{id:'source',label:'Recorded project relationships'}],provenance:{model:'Review model'}};};
function App(){const [release,setRelease]=useState('release'); window.changeScope=()=>setRelease('another-release'); return <main style={{maxWidth:1000,margin:'24px auto',padding:'0 16px'}}><h1>Release quality</h1><AiLifecycleReview projectId="project" inputs={{release_id:release}} title="AI release review" features={['quality-graph','coverage-assurance','release-readiness']} integrations={[{id:'model',type:'llm',name:'Project reviewer',model:'Review model'}]}/></main>};
createRoot(document.getElementById('root')).render(<App/>);`;

test('quality reviews keep unknown gates, bound graph rendering, handle errors and discard changed scopes', {timeout: 90000}, async () => {
  const name = 'quality-review-' + randomUUID(), html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  const output = '/tmp/hellotest-quality-review'; let browser;
  try {
    await mkdir(output,{recursive:true}); await writeFile(tsx,fixture);
    await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({headless:true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5178'}/${name}.html`);
    await page.locator('.ai-lifecycle-shell > summary').click();
    assert.equal(await page.evaluate(()=>window.requests.length),0);
    await page.getByLabel('Review focus').selectOption('quality-graph');
    await page.getByRole('button',{name:'Run AI review',exact:true}).click();
    const graph=page.getByRole('region',{name:'AI Quality Graph',exact:true}); await graph.waitFor();
    const narrative=page.locator('.ai-lifecycle-result .knowledge-formatted-text').first();await narrative.getByRole('heading',{name:'Review summary',exact:true}).waitFor();assert.equal(await narrative.locator('li').count(),2);assert.equal(await narrative.getByRole('cell',{name:'Needs review',exact:true}).count(),1);
    assert.equal(await graph.locator('tbody tr').count(),30);
    await graph.getByRole('button',{name:'Show more evidence'}).click(); assert.equal(await graph.locator('tbody tr').count(),60);
    await graph.getByLabel('Find evidence').fill('journey 36'); assert.equal(await graph.locator('tbody tr').count(),2);
    await graph.getByLabel('Find evidence').fill('');
    await page.screenshot({path:output+'/graph-desktop.png',fullPage:true});
    await page.getByLabel('Review focus').selectOption('coverage-assurance');
    assert.equal(await graph.count(),0);
    await page.getByRole('button',{name:'Run AI review',exact:true}).click();
    const coverage=page.getByRole('region',{name:'Acceptance coverage',exact:true}); await coverage.waitFor();
    assert.equal(await coverage.getByText('—',{exact:true}).count(),3);
    await page.setViewportSize({width:390,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1),true);
    await page.screenshot({path:output+'/coverage-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByLabel('Review focus').selectOption('release-readiness');
    await page.getByLabel('Exact build',{exact:true}).fill('release-24'); await page.getByLabel('Environment ID',{exact:true}).fill('staging');
    await page.getByRole('button',{name:'Run AI review',exact:true}).click();
    const gates=page.getByRole('region',{name:'Release gates',exact:true}); await gates.waitFor();
    assert.match(await gates.innerText(),/Organization release policy/);
    await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-lifecycle-guidance textarea')).backgroundColor === 'rgba(2, 6, 23, 0.78)');
    await page.screenshot({path:output+'/release-dark.png',fullPage:true});
    await page.evaluate(()=>{window.fail=true;});
    await page.getByRole('button',{name:'Run AI review',exact:true}).click();
    await page.getByRole('alert').waitFor(); assert.equal(await gates.count(),0);
    await page.evaluate(()=>{window.fail=false;window.hold=true;});
    await page.getByRole('button',{name:'Run AI review',exact:true}).click();
    await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
    await page.evaluate(()=>window.changeScope()); await page.getByRole('button',{name:'Run AI review',exact:true}).waitFor();
    await page.evaluate(()=>window.release());
    await page.waitForFunction(()=>!document.querySelector('.ai-lifecycle-result'));
    assert.equal(await page.getByLabel('Exact build',{exact:true}).inputValue(),'');
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]); }
});
