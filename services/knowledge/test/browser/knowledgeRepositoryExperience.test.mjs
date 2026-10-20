import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/platform/hooks/useCurrentProject';
import { KnowledgeRepoPage } from '/services/knowledge/frontend/pages/KnowledgeRepoPage';
import { knowledgeApi } from '/services/knowledge/frontend/api.client';
import '/src/platform/components/workspace-shell.css';import '/src/platform/components/workspace-surfaces.css';import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';
const readonly = new URLSearchParams(location.search).has('readonly');
const session={token:'fixture',user:{id:'u',role:readonly?'member':'admin',name:'Reviewer',permissions:['knowledge.view'],project_permissions:{p:['knowledge.view']}}};
sessionStorage.write(session);setCurrentScope('p','app');
api.auth.session=async()=>session;
api.featureFlags.snapshot=async()=>({flags:new Proxy({}, {get:()=>true})});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.projects.list=async()=>[{id:'p',name:'Checkout'}];api.appTypes.list=async()=>[{id:'app',project_id:'p',name:'Web'}];
window.knowledgeCalls={notes:0,search:[],records:[],creates:[],updates:[],add:[],remove:[],ingestions:[]};
window.knowledgeSources=[
{id:'s-ready',project_id:'p',title:'Checkout acceptance criteria',source_kind:'requirement',source_ref_id:'ST-024',extraction_status:'ready',chunk_count:12,document_count:1,updated_at:'2026-10-06T13:20:00Z',collection_ids:['c-payments']},
{id:'s-caption',project_id:'p',title:'Payment failure screenshot',source_kind:'file',file_name:'payment-failure.png',mime_type:'image/png',size_bytes:48201,extraction_status:'needs_extraction',chunk_count:0,document_count:0,updated_at:'2026-10-05T13:20:00Z',collection_ids:[]},
{id:'s-notes',project_id:'p',title:'Release sign-off decisions',source_kind:'text',extraction_status:'ready',chunk_count:3,document_count:1,updated_at:'2026-10-04T13:20:00Z',collection_ids:[]},
{id:'s-archived',project_id:'p',title:'Previous checkout notes',source_kind:'text',extraction_status:'archived',chunk_count:0,document_count:1,updated_at:'2026-10-03T13:20:00Z',collection_ids:[]}
];
window.knowledgeCollection={id:'c-payments',project_id:'p',name:'Payments release',description:'Evidence for checkout changes.',source_ids:['s-ready','hidden-source'],source_count:2,document_count:1,chunk_count:12,color:'#0d9488',is_active:true};
knowledgeApi.knowledgeRepo.list=async()=>(window.knowledgeCalls.notes++, [{id:'k1',title:'Release approval rules',description:'Evidence for release sign-off',is_active:true,content_type:'text',content:'Use current run results.'}]);
api.knowledgeRepo.overview=async()=>({counts:{sources:3,ready_sources:2,documents:2,chunks:15,collections:1,processing_sources:0,failed_sources:0},capabilities:{hybrid_search:true,embedding:{configured:true}},recent_jobs:[]});
api.knowledgeRepo.sources=async()=>window.knowledgeSources;
api.knowledgeRepo.collections.list=async()=>[window.knowledgeCollection];
knowledgeApi.knowledgeRepo.collections.get=async()=>window.knowledgeCollection;
knowledgeApi.knowledgeRepo.collections.update=async(id,input)=>{window.knowledgeCalls.updates.push({id,...input});window.knowledgeCollection={...window.knowledgeCollection,...input};return window.knowledgeCollection;};
knowledgeApi.knowledgeRepo.collections.create=async(input)=>{window.knowledgeCalls.creates.push(input);return {...input,id:'c-new'};};
knowledgeApi.knowledgeRepo.collections.addSources=async(id,source_ids)=>{window.knowledgeCalls.add.push({id,source_ids});return window.knowledgeCollection;};
knowledgeApi.knowledgeRepo.collections.removeSources=async(id,source_ids)=>{window.knowledgeCalls.remove.push({id,source_ids});return window.knowledgeCollection;};
knowledgeApi.knowledgeRepo.refresh.get=async()=>({project_id:'p',enabled:false,interval_ms:300000,status:'idle',requested:false,last_result:{scanned:3,queued:0,unchanged:3}});
api.requirements.list=async()=>{window.knowledgeCalls.records.push('requirements');return [{id:'r1',title:'Pay by saved card',display_id:'ST-026',status:'approved'}];};
api.testCases.list=async()=>{window.knowledgeCalls.records.push('test_cases');return [];};
api.executions.list=async()=>{window.knowledgeCalls.records.push('executions');return [];};
api.issues.list=async()=>{window.knowledgeCalls.records.push('bugs');return [];};
knowledgeApi.knowledgeRepo.search=async(input)=>{window.knowledgeCalls.search.push(input);return {results:[{id:'chunk1',source_id:'s-ready',source_kind:'requirement',title:'Checkout acceptance criteria',excerpt:'Saved cards must support a retry after payment failure.',score:.91,semantic_score:.88,lexical_score:.7}],retrieval:{candidate_count:4,vector_mode:'hybrid'}};};
knowledgeApi.knowledgeRepo.sourceDetail=async(id)=>({source:window.knowledgeSources.find(s=>s.id===id),revision:{id:'rev1',version:2,is_current:true,effective_from:'2026-10-06T13:20:00Z',index_state:{required_indexes_ready:true,lexical_state:'ready',dense_state:'ready',indexed_chunk_count:4}},fragments:[{id:'f1',heading:'Payment recovery',content:'Retry failed payments safely.',chunk_index:0},{id:'f2',heading:'Saved cards',content:'Use a saved card securely.',chunk_index:1},{id:'f3',heading:'Refunds',content:'Refund once.',chunk_index:2},{id:'f4',heading:'Accessibility',content:'Payment errors announce their messages.',chunk_index:3}]});
knowledgeApi.knowledgeRepo.sourceRevisions=async()=>({revisions:[]});
api.knowledgeRepo.ingestions.create=async(input)=>{window.knowledgeCalls.ingestions.push(input);return {job:{id:'j1',status:'completed',config:{title:input.title}},sources:[]};};
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={client}><AuthProvider><div className="app-shell workspace-experience-v2" style={{gridTemplateColumns:"minmax(0,1fr)"}}><main className="workspace-main"><KnowledgeRepoPage /></main></div></AuthProvider></QueryClientProvider></MemoryRouter>);
`;

test('knowledge browse, guided ingestion, revision evidence and collection membership stay usable and permission scoped', { timeout: 90000 }, async () => {
  const name='knowledge-experience-'+randomUUID();const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
  try {
    await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});const errors=[];context.on('page',page=>page.on('pageerror',cause=>errors.push(cause.message)));
    await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Unexpected fixture API request'})}));
    const page=await context.newPage();page.setDefaultTimeout(15000);const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5294'}/${name}.html`;
    await page.goto(url);await page.getByRole('heading',{name:'AI Knowledge Base',exact:true}).waitFor();await page.getByRole('button',{name:'Checkout acceptance criteria',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Previous checkout notes',exact:true}).count(),0,'archived evidence stays outside current inventory');
    assert.deepEqual(await page.evaluate(()=>window.knowledgeCalls.records),[],'record pickers load only when opened');assert.equal(await page.evaluate(()=>window.knowledgeCalls.notes),0,'hidden notes do not fetch full document bodies');
    await mkdir('/tmp/qaira-knowledge-experience',{recursive:true});await page.screenshot({path:'/tmp/qaira-knowledge-experience/01-sources-desktop.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Source filters',exact:true}).click();await page.getByLabel('Source status',{exact:true}).selectOption('attention');assert.equal(await page.getByRole('button',{name:'Payment failure screenshot',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Checkout acceptance criteria',exact:true}).count(),0);await page.getByRole('button',{name:'Reset',exact:true}).click();await page.getByRole('button',{name:'Source filters',exact:true}).click();
    await page.getByRole('button',{name:'Add sources',exact:true}).first().click();await page.getByRole('heading',{name:'Add sources',exact:true}).waitFor();await page.getByRole('button',{name:'Choose files',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Note content').count(),0,'one source workflow is shown at a time');
    await page.evaluate(()=>{const file=new File(['Checkout supports saved cards.'],'rules.txt',{type:'text/plain',lastModified:1000});const data=new DataTransfer();data.items.add(file);data.items.add(file);const input=document.querySelector('input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await page.getByRole('button',{name:'Remove rules.txt',exact:true}).count(),1,'duplicate file selection is collapsed');
    await page.screenshot({path:'/tmp/qaira-knowledge-experience/02-add-sources-desktop.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:/Project records/}).click();await page.getByText('Pay by saved card',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.knowledgeCalls.records),['requirements']);
    await page.getByRole('button',{name:/Notes & conversations/}).click();await page.getByLabel('Source title',{exact:true}).fill('Checkout product rules');await page.getByLabel('Note content').fill('Payment retries reuse a stable request identity.');
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('tab',{name:'Search',exact:true}).click();await page.getByLabel('Search indexed project context').fill('Payment retries');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('Saved cards must support a retry after payment failure.',{exact:true}).waitFor();
    await page.getByLabel('Search indexed project context').fill('Refunds');await page.getByRole('status').filter({hasText:'Search again to apply your changes'}).waitFor();
    await page.getByRole('button',{name:'Inspect source',exact:true}).click();await page.getByRole('dialog',{name:'Checkout acceptance criteria',exact:true}).waitFor();await page.getByLabel('Search source passages').fill('Refund');assert.equal(await page.getByText('Refund once.',{exact:true}).count(),1);await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'Collections',exact:true}).click();await page.getByRole('button',{name:'Manage sources',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Manage collection',exact:true});await dialog.waitFor();await dialog.getByRole('checkbox',{name:/Checkout acceptance criteria/}).uncheck();await dialog.getByRole('checkbox',{name:/Payment failure screenshot/}).check();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>window.knowledgeCalls.remove),[{id:'c-payments',source_ids:['s-ready']}],'hidden authorization-scoped members are retained');assert.deepEqual(await page.evaluate(()=>window.knowledgeCalls.add),[{id:'c-payments',source_ids:['s-caption']}]);
    await page.getByRole('button',{name:'New collection',exact:true}).click();const createDialog=page.getByRole('dialog',{name:'New collection',exact:true});await createDialog.waitFor();await createDialog.getByLabel('Name',{exact:true}).fill('Accessibility');await createDialog.getByRole('checkbox',{name:/Release sign-off decisions/}).check();await createDialog.getByRole('button',{name:'Create collection',exact:true}).click();await createDialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.knowledgeCalls.creates.length),1);
    await page.getByRole('tab',{name:'Sources',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'/tmp/qaira-knowledge-experience/03-sources-mobile-dark.png',fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'inventory fits narrow viewport');assert.equal(await page.getByRole('tab',{name:'Sources',exact:true}).isVisible(),true,'navigation stays visible on mobile');assert.equal(await page.evaluate(()=>{const n=document.querySelector('.knowledge-studio');return n.scrollHeight<=n.clientHeight+2;}),true,'repository does not clip evidence');
    await page.getByRole('button',{name:'Add sources',exact:true}).first().click();await page.screenshot({path:'/tmp/qaira-knowledge-experience/04-add-sources-mobile-dark.png',fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'builder fits narrow viewport');
    const reader=await context.newPage();await reader.goto(url+'?readonly=true');await reader.getByRole('button',{name:'Checkout acceptance criteria',exact:true}).waitFor();assert.equal(await reader.getByRole('button',{name:'Add sources',exact:true}).count(),0);await reader.getByRole('button',{name:/Notes & rules/}).click();await reader.getByRole('button',{name:'Open knowledge item Release approval rules'}).click();await reader.getByRole('dialog',{name:'Release approval rules',exact:true}).waitFor();assert.equal(await reader.evaluate(()=>window.knowledgeCalls.notes),1,'notes load when explicitly opened');assert.equal(await reader.getByRole('button',{name:'Add note',exact:true}).count(),0);assert.deepEqual(errors,[]);
  } finally { await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]); }
});
