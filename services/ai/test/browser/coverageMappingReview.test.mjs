import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile,rm } from 'node:fs/promises';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('assertion review records approval and withdrawal, refreshes stale revisions and fits mobile', {timeout:90000},async()=>{
  const name=`assertion-review-${randomUUID()}`;let browser;
  const fixture=`import ReactDOM from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';import {api,sessionStorage} from '/src/lib/api';
import {CoverageMappingReview} from '/services/ai/frontend/components/CoverageMappingReview';
import '/src/styles.css';import '/src/dark-theme.css';import '/services/ai/frontend/components/AiLifecycleReview.css';import '/services/ai/frontend/components/QualityEvidencePanel.css';
const session={token:'fixture',user:{id:'reviewer',role:'admin'}};sessionStorage.write(session);api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:{},dependencies:{}});
ReactDOM.createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><main className="quality-evidence-panel" style={{maxWidth:850,margin:'24px auto'}}><h1>Acceptance coverage</h1><CoverageMappingReview projectId="project" storyId="story"/></main></AuthProvider></QueryClientProvider>);`;
  try {
    await writeFile(new URL(`${name}.tsx`,root),fixture);
    await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    let stale=false,gets=0;
    const inventory={story_id:'story',story_revision:'story-v1',obligations:[{id:'criterion',text:'A successful payment records its transaction reference.'}],tests:[{id:'case',title:'Payment reference is retained',revision:'case-v1',assertions:[{id:'step',action:'Submit a valid payment',expected_result:'The confirmation displays the saved transaction reference.',hash:'oracle-v1'}]}],reviews:[],limitations:[]};
    await page.route('**/ai/coverage-mappings*',async route=>{
      if(route.request().method()==='GET'){gets++;return route.fulfill({json:inventory});}
      const body=route.request().postDataJSON();requests.push(body);
      if(stale){inventory.story_revision='story-v2';return route.fulfill({status:409,json:{message:'The Story or assertion changed. Reload and review the current revision.'}});}
      inventory.reviews=[{...body,id:`review-${requests.length}`}];return route.fulfill({json:inventory.reviews[0]});
    });
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5178'}/${name}.html`);
    await page.getByLabel('Acceptance criterion').selectOption('criterion');await page.getByLabel('Linked Test Case').selectOption('case');await page.getByLabel('Assertion / expected result').selectOption('step');
    await page.getByLabel('Evidence and rationale').fill('The observable transaction reference matches the persisted reference and detects its absence.');
    await page.getByRole('button',{name:'Save assertion review',exact:true}).click();await page.getByRole('status').getByText(/Review saved/).waitFor();
    assert.equal(requests[0].story_revision,'story-v1');assert.equal(requests[0].decision,'approved');assert.equal(requests[0].step_id,'step');
    await page.getByLabel('Review decision').selectOption('revoked');await page.getByLabel('Evidence and rationale').fill('Withdraw this approval because the test lacks the rejected payment boundary.');
    await page.getByRole('button',{name:'Save assertion review',exact:true}).click();await page.getByText('revoked',{exact:true}).waitFor();
    assert.equal(requests[1].decision,'revoked');assert.notEqual(requests[0].request_id,requests[1].request_id);
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'/tmp/hellotest-coverage-review-mobile.png',fullPage:true});
    stale=true;const previousGets=gets;await page.getByLabel('Evidence and rationale').fill('Review the updated criterion against the current expected result.');
    await page.getByRole('button',{name:'Save assertion review',exact:true}).click();await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Acceptance criterion').inputValue(),'');await page.waitForTimeout(100);assert.ok(gets>previousGets);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await Promise.all(['tsx','html'].map(ext=>rm(new URL(`${name}.${ext}`,root),{force:true})));}
});
