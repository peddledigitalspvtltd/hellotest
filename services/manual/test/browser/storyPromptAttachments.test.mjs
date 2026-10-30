import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const name=`story-prompt-attachments-${randomUUID()}`;
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2kAAAAASUVORK5CYII=','base64');
const document=Buffer.from('Original delivery acceptance boundaries.\n');

test('Story AI accepts original prompt files only for chosen Stories, retries uploads without duplicate saves and discards cancelled input',{timeout:120000},async()=>{
 const source=await readFile(new URL('../browser/storyPlanningAssignments.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
 fixture=fixture.replace('let story=null;',"let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Saved delivery preferences',description:'Keep the selected delivery address.',acceptance_criteria:[],status:'open',priority:3,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],revision:1};");
 fixture=fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']","initialEntries:['/']");
 const overrides=`
api.integrations.list=async()=>[{id:'llm',name:'Fixture LLM',type:'llm',is_active:true}];
const suggestion={client_id:'first',title:'Accepted delivery Story',description:'Preserve delivery preferences and expose validation errors.',acceptance_criteria:['Saved delivery preferences are restored when the customer returns.'],external_references:[],priority:3,status:'open',risks:[],open_questions:[],change_summary:['Clarified expected behavior']};
const job={id:'fixture-job',status:'completed',requirements:[suggestion,{...suggestion,client_id:'second',title:'Unaccepted delivery Story'}]};
api.requirements.createGenerationJob=async input=>{window.calls.push({kind:'generate',input});return job};api.requirements.getGenerationJob=async()=>job;
api.requirements.previewOptimization=async(id,input)=>{window.calls.push({kind:'complete',id,input});return{suggestion:{...suggestion,title:'Completed saved delivery Story'},fallback_used:false}};
let creates=0;api.requirements.create=async input=>{const id='created-story-'+(++creates);window.calls.push({kind:'create',id,input});story={...story,...input,id,project_id:'project',revision:1};return{id}};
api.attachments.meta=async()=>({enabled:true,uploadLimit:1024*1024});
window.uploads=[];window.failAttachmentOnce=new URLSearchParams(location.search).has('failure');
if(new URLSearchParams(location.search).has('noSubtle'))Object.defineProperty(window.crypto,'subtle',{value:undefined});
api.attachments.upload=async(scope,file,options)=>{window.uploads.push({scope,name:file.name,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),checksum:options?.checksumSha256});if(window.failAttachmentOnce&&file.name==='rules.txt'){window.failAttachmentOnce=false;throw new Error('Fixture upload unavailable')}return{id:'file-'+window.uploads.length,filename:file.name}};
`;
 fixture=fixture.replace('const mode=new URLSearchParams',overrides+'\nconst mode=new URLSearchParams');
 let browser;
 try{
  await writeFile(new URL(`${name}.tsx`,root),fixture);await writeFile(new URL(`${name}.html`,root),`<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  for(const scenario of (process.env.STORY_ATTACHMENT_SCENARIOS?process.env.STORY_ATTACHMENT_SCENARIOS.split(','):['cancel','create','failure','improve','httpfallback'])){
   const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/**',route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort()});
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html?${scenario==='failure'?'failure=1':scenario==='httpfallback'?'noSubtle=1':''}`);
   await page.getByText('Saved delivery preferences',{exact:true}).waitFor();
   if(scenario==='improve'){await page.getByText('Saved delivery preferences',{exact:true}).click();await page.getByRole('heading',{name:'Story details',exact:true}).waitFor();}
   const action=scenario==='improve'?'AI Complete Story':'Create Stories using AI';
   for(const button of await page.getByRole('button',{name:action,exact:true}).all())if(await button.isVisible()&&!await button.isDisabled()){await button.click();break;}
   const dialog=page.getByRole('dialog',{name:action,exact:true});await dialog.waitFor();
   await dialog.getByRole('button',{name:'Show context',exact:true}).click();
   const context=page.getByRole('dialog',{name:'Context & options',exact:true});await context.waitFor();
   await context.getByRole('tab',{name:/Files/}).click();
   await context.locator('input[type=file][accept^=".txt"]').setInputFiles({name:'rules.txt',mimeType:'text/plain',buffer:document});
   await context.getByRole('tab',{name:/Images/}).click();
   await context.locator('input[type=file][accept="image/*"]').evaluate((element,files)=>{
    const transfer=new DataTransfer();for(const file of files)transfer.items.add(new File([new Uint8Array(file.bytes)],file.name,{type:'image/png',lastModified:123456}));
    element.files=transfer.files;element.dispatchEvent(new Event('change',{bubbles:true}));
   },[{name:'original.png',bytes:Array.from(image)},{name:'same-preview.png',bytes:Array.from(image)},{name:'same-meta.png',bytes:[...image,1]},{name:'same-meta.png',bytes:[...image,2]}]);
   await context.locator('.ai-reference-image-card').waitFor();
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>window.uploads.length),0,'Preparing context never persists an attachment.');
   if(scenario==='cancel'){
    await dialog.getByRole('button',{name:'Close AI Story creation',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.kind==='create').length),0);assert.equal(await page.evaluate(()=>window.uploads.length),0);await page.close();continue;
   }
   await dialog.getByRole('textbox',{name:'Instructions for Story Architect',exact:true}).fill('Preserve delivery preferences and clarify validation.');
   await dialog.getByRole('button',{name:scenario==='improve'?'Complete Story':'Generate drafts',exact:true}).click();
   if(scenario==='improve'){
    await dialog.getByLabel('Story title',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Apply to Story',exact:true}).click();
   }else{
    await dialog.getByLabel('Select Accepted delivery Story',{exact:true}).check();
    await dialog.getByRole('button',{name:'Accept into Library',exact:true}).click();
   }
   if(scenario==='failure'){
    const notice=dialog.getByRole('alert').filter({hasText:'Stories are saved; some prompt files'});await notice.waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.kind==='create').length),1);
    await notice.getByRole('button',{name:'Retry attachments',exact:true}).click();
    await page.waitForFunction(()=>window.uploads.filter(item=>item.name==='rules.txt').length===2);
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.kind==='create').length),1,'Retrying files never recreates a Story.');
   }
   await page.waitForFunction(()=>window.uploads.some(item=>item.name==='original.png'));
   const uploads=await page.evaluate(()=>window.uploads);
   const png=uploads.find(item=>item.name==='original.png'),text=uploads.find(item=>item.name==='rules.txt');
   assert.ok(uploads.some(item=>item.name==='same-preview.png'),'Distinct original files survive compressed-preview deduplication.');
   const sameMetadata=uploads.filter(item=>item.name==='same-meta.png');assert.equal(sameMetadata.length,2);assert.notEqual(sameMetadata[0].checksum,sameMetadata[1].checksum,'Identical names, sizes and modification dates cannot discard distinct originals.');
   assert.deepEqual(png.bytes,Array.from(image));assert.equal(png.type,'image/png');assert.equal(png.checksum,createHash('sha256').update(image).digest('hex'));assert.deepEqual(text.bytes,Array.from(document));
   assert.ok(uploads.every(item=>item.scope.entity_type==='requirement'&&item.scope.project_id==='project'&&item.scope.entity_id===(scenario==='improve'?'saved-story':'created-story-1')),'Only the explicitly accepted or completed Story receives files.');
   const calls=await page.evaluate(()=>window.calls);
   assert.equal(calls.filter(call=>call.kind==='create').length,scenario==='improve'?0:1);
   assert.equal(calls.filter(call=>call.kind==='update').length,scenario==='improve'?1:0);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await Promise.all([rm(new URL(`${name}.tsx`,root),{force:true}),rm(new URL(`${name}.html`,root),{force:true})]);}
});
