import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const {normalizeReferenceImages}=createRequire(import.meta.url)('../../../platform/backend/src/utils/aiReferenceImages.js');
const root=new URL('../../../platform/frontend/',import.meta.url);
const triageFixture=`
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{DefectTriageDialog}from'@hellotest/ai/frontend/components/DefectTriageDialog';import{AuthProvider}from'/src/auth/AuthContext';import{api,sessionStorage}from'/src/lib/api';import'/src/styles.css';import'/src/modal-system.css';
const session={token:'isolated-image-test',user:{id:'reviewer',role:'admin',name:'Reviewer'}};sessionStorage.write(session);api.auth.session=async()=>session;api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.integrations.list=async()=>[];api.aiPromptTemplates.list=async()=>[];
api.issues.previewAiTriage=async input=>{window.receivedTriage=input;return{triage:[],evidence_sources:[],summary:'No record was modified.',boundaries:{omissions:[]}};};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><DefectTriageDialog projectId='project' issues={[{id:'issue',project_id:'project',title:'Invalid sign-in error',message:'A credential error remains visible',severity:'high',priority:'High'}]} canViewIntegrations={false} onClose={()=>{}} onOpenIssue={()=>{}}/></AuthProvider></QueryClientProvider>);
`;

async function sourceScreenshot(page){
 const url=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=800;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,1600,800);context.fillStyle='#111';context.font='42px sans-serif';context.fillText('Invalid sign in: credentials were rejected',40,100);return canvas.toDataURL('image/png');});
 return Buffer.from(url.split(',')[1],'base64');
}
test('triage and Smart Run screenshot controls compress real uploads and retain them in the submitted request',{timeout:120000},async()=>{
 const names=[],errors=[];let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
  for(const mode of ['triage','smart-run']){
   const name='ai-reference-'+mode+'-'+randomUUID();names.push(name);
   let source=triageFixture;
   if(mode==='smart-run'){
    source=await readFile(new URL('test/fixtures/previews/smartRunStudioPreview.tsx',root),'utf8');
    source=source.replaceAll('"../../../src/','"/src/').replace('"../../../../../testing/frontend/pages/ExecutionsPage"','"@hellotest/testing/frontend/pages/ExecutionsPage"');
    source="import{api,sessionStorage}from'/src/lib/api';import{AuthProvider}from'/src/auth/AuthContext';const fixtureSession={token:'isolated-image-test',user:{id:'reviewer',role:'admin',name:'Reviewer'}};sessionStorage.write(fixtureSession);api.auth.session=async()=>fixtureSession;api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});\n"+source;
    source=source.replace('<Preview />','<AuthProvider><Preview /></AuthProvider>');
    source=source.replace('function Preview() {','function Preview() {\n const [referenceImages,setReferenceImages]=useState([]);window.smartReferenceImages=referenceImages;');
    source=source.replace('<ExecutionCreateModal','<ExecutionCreateModal smartExecutionImages={referenceImages} onSmartExecutionImagesChange={setReferenceImages}');
    source=source.replace('document.body.dataset.qaPreviewed = "true";','document.body.dataset.qaPreviewed = "true";window.submittedSmartImages=referenceImages;');
   }
   await writeFile(new URL(name+'.tsx',root),source);
   await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body><div id='root'></div><script type='module' src='/${name}.tsx'></script></body></html>`);
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
   const file=page.locator('.ai-reference-photos-field input[type=file]');try{await file.waitFor({timeout:15000});}catch(error){throw new Error(mode+' upload missing; '+errors.join('; ')+'; '+(await page.locator('body').innerText()).slice(0,1200));}
   const png=await sourceScreenshot(page);await file.setInputFiles({name:'Invalid-signin.png',mimeType:'image/png',buffer:png});
   await page.locator('.ai-reference-image-card').waitFor();
   await page.waitForFunction(()=>!document.querySelector('.ai-reference-photos-field input[type=file]').disabled);
   if(mode==='triage'){
    await page.getByRole('button',{name:'Analyze selected Defects',exact:true}).click();await page.waitForFunction(()=>window.receivedTriage);
    const input=await page.evaluate(()=>window.receivedTriage);assert.deepEqual(input.issue_ids,['issue']);assert.equal(input.images.length,1);assert.match(input.images[0].url,/^data:image\/jpeg;base64,/);assert.ok(input.images[0].url.length<=950000/6);normalizeReferenceImages(input.images);
   }else{
    const images=await page.evaluate(()=>window.smartReferenceImages);assert.equal(images.length,1);assert.match(images[0].url,/^data:image\/jpeg;base64,/);normalizeReferenceImages(images);
    const previewButton=page.getByRole('button',{name:/Regenerate impact plan|Generate impact plan|Retry impact plan/});await previewButton.click();await page.waitForFunction(()=>window.submittedSmartImages);assert.deepEqual(await page.evaluate(()=>window.submittedSmartImages),images);
    await page.getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.locator('.ai-reference-image-card').count(),0);
   }
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all(names.flatMap(name=>['.tsx','.html'].map(extension=>rm(new URL(name+extension,root),{force:true}))));}
});
