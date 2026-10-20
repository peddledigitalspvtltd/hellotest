import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright'),{expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);

test('Engineer model tabs lazily scope real call references, retain call selection, and enforce body access',{timeout:90000},async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';",`import {EngineerModelPayload} from '/services/trace/frontend/components/ModelCallDetails';import {traceApi} from '/services/trace/frontend/api.client';
 const viewer=new URLSearchParams(location.search).get('viewer')||'admin';
 function TraceFixture(){const [tab,setTab]=React.useState('source');const [scope,setScope]=React.useState({caseId:'case1',stepId:'one',attempt:2,modelCallIds:['call-two','call-one']});window.setTraceScope=setScope;return <section><button onClick={()=>setTab('source')}>Source</button><button onClick={()=>setTab('request')}>Model request</button><button onClick={()=>setTab('response')}>Model response</button>{tab==='source'?<p>Source instructions</p>:<EngineerModelPayload projectId="p" sessionId="activity" {...scope} kind={tab}/>}</section>;}`)
 .replace("const session={token:'dataset-fixture',user:{id:'author',name:'Author',role:'admin'}};", "const session={token:'trace-fixture',user:{id:'author',name:'Author',role:viewer==='admin'?'admin':'member',project_permissions:{p:viewer==='member'?['ops.view']:[]}}};")
 .replace('element:<TestCasesPage/>','element:<TraceFixture/>')
 .replace('const client=new QueryClient',`window.traceLists=[];window.traceDetails=[];window.copies=[];window.failDetails=false;
 const call=id=>{const scope=id==='review-call'?'section_semantic_review':id==='metadata-call'?'case_metadata':id==='flow-call'?'flow_plan':'case_attempt';return {id,project_id:'p',session_id:'activity',operation:'automation.build',feature:'ai.agentic.automation-engineer',status:'succeeded',effective_model:id,started_at:'2026-10-16T10:00:00Z',attempt:1,capture:{test_case_id:'case1',completion_attempt:2,generation_scope:scope,section_attempt:scope==='section_semantic_review'?2:undefined,generation_section_count:scope==='case_attempt'?3:scope==='section_semantic_review'?1:0,redacted:true}};};
 traceApi.llmTraces.list=async query=>{window.traceLists.push(query);if(query.test_case_id==='foreign-case')return {items:[{...call('foreign'),capture:{test_case_id:'foreign-case'}}],next_cursor:null};return {items:query.trace_ids?JSON.parse(query.trace_ids).map(call):query.cursor?[call('old-call')]:[call('call-two'),call('call-one')],next_cursor:query.trace_ids||query.cursor?null:'older'};};
 traceApi.llmTraces.detail=async(project,id)=>{window.traceDetails.push(id);if(window.failDetails)throw new Error('Access expired');return {...call(id),content_access:viewer==='admin',capture:{...call(id).capture,...id==='foreign'?{test_case_id:'another-case'}:{}},request_payload:{messages:[{role:'user',content:'Request '+id+' [REDACTED]'}]},response_payload:{choices:[{message:{content:'Response '+id}}]}};};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copies.push(text);}}});
 const client=new QueryClient`);
 const name='engineer-model-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});const page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API '+route.request().url());return route.abort();});
  const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`;
  await page.goto(url);await expect(page.getByText('Source instructions')).toBeVisible();assert.deepEqual(await page.evaluate(()=>window.traceLists),[]);
  await page.getByRole('button',{name:'Model request',exact:true}).click();await expect(page.locator('.engineer-model-payload pre')).toContainText('Request call-two');
  const queries=await page.evaluate(()=>window.traceLists);assert.equal(queries[0].session_id,'activity');assert.equal(queries[0].test_case_id,'case1');assert.equal(queries[0].completion_attempt,2);assert.deepEqual(JSON.parse(queries[0].trace_ids),['call-two','call-one']);
  await expect(page.getByText(/A request may develop several sections/)).toBeVisible();await expect(page.getByText(/Shared context for 3 sections/)).toBeVisible();
  await page.getByLabel('Selected section model call').selectOption('call-one');await expect(page.locator('.engineer-model-payload pre')).toContainText('Request call-one');
  await page.getByRole('button',{name:'Model response',exact:true}).click();await expect(page.locator('.engineer-model-payload pre')).toContainText('Response call-one');assert.equal(await page.getByLabel('Selected section model call').inputValue(),'call-one');
  await page.getByRole('button',{name:'Copy response',exact:true}).click();await expect(page.getByText('Response copied',{exact:true})).toBeVisible();assert.match((await page.evaluate(()=>window.copies)).at(-1),/Response call-one/);
  await page.evaluate(()=>window.setTraceScope({caseId:'case1',stepId:'reviewed',attempt:2,modelCallIds:['review-call']}));
  await expect(page.locator('.engineer-model-payload pre')).toContainText('Response review-call');
  await expect(page.locator('.engineer-model-call-body > .llm-traces-note').first()).toHaveText('Outcome review · Attempt 2 · succeeded');
  await expect(page.getByText(/This request checks the selected section against its pinned manual requirements/)).toBeVisible();
  assert.equal(await page.getByText(/Shared context for/).count(),0);assert.match(await page.getByLabel('Selected section model call').locator('option').innerText(),/^Outcome review/);
  await page.evaluate(()=>window.setTraceScope({caseId:'case1',stepId:'metadata',attempt:2,modelCallIds:['metadata-call']}));
  await expect(page.locator('.engineer-model-payload pre')).toContainText('Response metadata-call');
  await expect(page.locator('.engineer-model-call-body > .llm-traces-note').first()).toHaveText('Completion metadata · Attempt 2 · succeeded');
  await expect(page.getByText(/This request completes coverage or response metadata for retained instructions/)).toBeVisible();
  assert.equal(await page.getByText(/Shared context for/).count(),0);
  await page.evaluate(()=>window.setTraceScope({caseId:'case1',stepId:'planning',attempt:2,modelCallIds:['flow-call']}));
  await expect(page.locator('.engineer-model-payload pre')).toContainText('Response flow-call');
  await expect(page.locator('.engineer-model-call-body > .llm-traces-note').first()).toHaveText('Flow planning · Attempt 2 · succeeded');
  await expect(page.getByText(/This request prepares the case flow before section development/)).toBeVisible();
  await page.evaluate(()=>window.setTraceScope({caseId:'case1',stepId:'legacy',attempt:2,modelCallIds:[]}));await expect(page.getByRole('button',{name:'Older calls',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Older calls',exact:true}).click();await expect(page.locator('.engineer-model-payload pre')).toContainText('Response old-call');await expect(page.getByText(/an exact section-to-call reference was not retained/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.engineer-model-payload').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.evaluate(()=>window.setTraceScope({caseId:'foreign-case',stepId:'foreign',attempt:2,modelCallIds:['foreign']}));await expect(page.getByRole('alert')).toContainText('no longer matches the selected case');assert.equal(await page.locator('.engineer-model-payload pre').count(),0);
  await page.goto(url+'?viewer=member');await page.getByRole('button',{name:'Model request',exact:true}).click();await expect(page.getByText('Workspace administrator access is required to inspect prompt and response content.')).toBeVisible();assert.equal(await page.locator('.engineer-model-payload pre').count(),0);assert.equal(await page.getByRole('button',{name:'Copy request',exact:true}).count(),0);
  await page.goto(url+'?viewer=no-ops');await page.getByRole('button',{name:'Model response',exact:true}).click();await expect(page.getByText('Model call viewing permission is required to inspect requests and responses.')).toBeVisible();assert.deepEqual(await page.evaluate(()=>window.traceLists),[]);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
