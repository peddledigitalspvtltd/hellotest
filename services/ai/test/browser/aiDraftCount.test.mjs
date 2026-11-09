import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AiDesignStudioModal} from '/services/ai/frontend/components/AiDesignStudioModal';
import {AI_DESIGN_DEFAULT_DRAFT_COUNT} from '/services/ai/frontend/lib/aiDesignStudio';
import {api,sessionStorage} from '/src/lib/api';
import {AuthProvider} from '/src/auth/AuthContext';
const session={token:'draft-count-fixture',user:{id:'author',name:'Author',role:'admin'}};
sessionStorage.write(session);api.auth.session=async()=>session;
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
api.aiPromptTemplates.list=async()=>[];
const draft={client_id:'login',title:'Review login inputs',description:'Check the login form.',priority:2,authoring_mode:'structured',
 requirement_ids:[],requirement_titles:[],steps:[{step_order:1,action:'Open @r.name',expected_result:'The login form appears.'}],step_count:1,
 parameter_values:{'r.name':'https://fixture.example.test/login','s.locale':'en-US','t.password':'PRIVATE_PASSWORD_VALUE','r.alias':'PRIVATE_PASSWORD_VALUE',
 'r.embedded':'https://fixture.example.test/?value=PRIVATE_PASSWORD_VALUE','r.query':'https://fixture.example.test/?access_token=PRIVATE_QUERY_VALUE','t.nickname':'PRIVATE_CUSTOM_VALUE'}};
function App(){
 const [count,setCount]=useState(AI_DESIGN_DEFAULT_DRAFT_COUNT);
 const [cases,setCases]=useState([]);
 const source=new URLSearchParams(location.search).has('parameters')?{title:'Existing login',description:'Saved case.',parameterValues:{'t.nickname':'PRIVATE_SAVED_VALUE'},privateParameterNames:['t.nickname'],steps:[]}:undefined;
 return <AiDesignStudioModal eyebrow='Stories' requirementLabel='Story' requirementHelpText='Select a Story'
  requirements={[]} selectedRequirementIds={[]} allowMultipleRequirements={false} onRequirementSelectionChange={()=>{}}
  integrations={[{id:'model',name:'Configured model',type:'llm',is_active:true}]} integrationId='model' onIntegrationIdChange={()=>{}}
  maxCases={count} onMaxCasesChange={setCount} additionalContext='Cover login' onAdditionalContextChange={()=>{}}
  externalLinksText='' onExternalLinksTextChange={()=>{}} referenceImages={[]} onAddImages={()=>{}} onRemoveImage={()=>{}}
  appTypeName='Web' existingCases={[]} existingCasesTitle='Existing cases' existingCasesSubtitle=''
  sourceCase={source} previewCases={cases} onRemovePreviewCase={()=>{}} previewMessage='' previewTone='success' onPreviewMessageDismiss={()=>{}}
  isPreviewing={false} isAccepting={false} onPreview={()=>{window.generatedCount=count;setCases([draft])}} onAccept={()=>{}} onClose={()=>{}}
  disablePreview={false} disableAccept acceptLabel='Accept drafts'/>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><App/></AuthProvider></QueryClientProvider>);
`;

test('draft count summary, accessible selection and generated count stay aligned', {timeout:45000}, async()=>{
 const name='ai-draft-count-'+randomUUID();let browser;
 const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 try {
  await writeFile(tsx,fixture);
  await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage();
  await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5187'}/${name}.html`);
  const dialog=page.getByRole('dialog',{name:'AI Test Case Generator',exact:true});
  await dialog.getByRole('button',{name:'Show context',exact:true}).click();
  const context=page.getByRole('dialog',{name:'Context & options',exact:true});
  await context.getByText('Model & generation',{exact:true}).click();
  const count=context.getByRole('combobox',{name:'Draft count',exact:true});
  assert.equal(await count.inputValue(),'3');
  assert.match(await context.locator('.ai-test-generator-model-settings summary').innerText(),/3 drafts/);
  await count.selectOption('1');
  assert.equal(await count.inputValue(),'1');
  assert.match(await context.locator('.ai-test-generator-model-settings summary').innerText(),/1 draft\b/);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button',{name:'Generate drafts',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.generatedCount),1);
 } finally {
  await browser?.close();
  await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);
 }
});

test('structured drafts show scoped public inputs and keep private values out of DOM and accessibility text', {timeout:45000}, async()=>{
 const name='ai-draft-inputs-'+randomUUID();let browser;
 const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 try {
  await writeFile(tsx,fixture);
  await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage();await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5187'}/${name}.html?parameters=1`);
  await page.getByRole('button',{name:'Generate drafts',exact:true}).click();
  await page.getByText('Test parameters · 7',{exact:true}).click();
  const table=page.getByRole('table',{name:'Generated test parameters',exact:true});
  await table.waitFor();
  assert.match(await table.getByRole('row').filter({has:page.getByText('@r.name',{exact:true})}).innerText(),/Run.*https:\/\/fixture\.example\.test\/login/s);
  assert.match(await table.getByRole('row').filter({has:page.getByText('@s.locale',{exact:true})}).innerText(),/Suite.*en-US/s);
  assert.match(await table.getByRole('row').filter({has:page.getByText('@t.password',{exact:true})}).innerText(),/Test case.*Hidden value/s);
  assert.equal(await table.getByRole('cell',{name:'Hidden value',exact:true}).count(),5);
  for(const value of [await page.locator('body').innerHTML(),await page.locator('body').ariaSnapshot()]) {
   assert.doesNotMatch(value,/PRIVATE_PASSWORD_VALUE|PRIVATE_QUERY_VALUE|PRIVATE_CUSTOM_VALUE|PRIVATE_SAVED_VALUE/);
  }
 } finally {
  await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);
 }
});
