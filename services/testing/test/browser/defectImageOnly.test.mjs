import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aot8AAAAASUVORK5CYII=', 'base64');

test('Image-only Defect reporting sends image bytes, preserves private source evidence and retries source attachment without creating twice', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient(', `
window.created=[];window.uploads=[];window.sourceCopies=[];window.draftInputs=[];let failProvider=true;let failCopy=true;
api.issues.createMetadata=api.issues.editMetadata;
api.integrations.list=async()=>[{id:'vision-llm',name:'Vision LLM',type:'llm',is_active:true}];
api.attachments.meta=async()=>({enabled:true,uploadLimit:1000000});api.attachments.list=async()=>[];
api.attachments.upload=async(scope,file)=>{window.uploads.push({scope,name:file.name,size:file.size});return{id:'source-'+file.name,filename:file.name}};
api.attachments.aiAccess=async id=>({id,url:'https://evidence.example.test/signed/'+id,expires_at:'2026-10-22T12:00:00Z'});
api.attachments.copy=async(id,scope)=>{window.sourceCopies.push({id,scope});if(id==='source-checkout.png'&&failCopy){failCopy=false;throw new Error('Temporary source copy failure')}return{id:'saved-'+id,filename:id}};
api.issues.previewAiDraft=async input=>{window.draftInputs.push(input);if(failProvider){failProvider=false;throw new Error('This configured model does not support image input. Select a vision-capable LLM.')}return{
 draft:{title:'Checkout error visible in screenshot',message:'Checkout displays an error.',steps_to_reproduce:'',expected_result:'',actual_result:'An error banner is visible.',severity:'medium',priority:'Medium',environment:'',build:'',labels:[],linked_test_run_id:'',linked_test_case_ids:[],linked_requirement_ids:[],rationale:'The screenshot supports the observed error only.'},
 citations:[],evidence_sources:[{ref:'E1',type:'image',id:'screenshot',title:'Checkout screenshot',excerpt:'Visible error banner'}],field_evidence:{title:['E1'],message:['E1']},gaps:[{field:'steps_to_reproduce',reason:'The screenshot does not show the actions that caused the error.',required:true,evidence_refs:['E1']},{field:'expected_result',reason:'Expected checkout behavior was not supplied.',required:true,evidence_refs:['E1']}],assumptions:[],fallback_fields:[],boundaries:{limits:{},requested:{images:1},included:{images:1},omitted:{},content_limits:{},content_omissions:[],partial_sources:false},processing:{stages:[],active_stage_id:'review',completed_stage_count:4,total_stage_count:4,status_label:'Ready for review'},provenance:{generation_mode:'llm',fallback_used:false,requires_human_review:true,evidence:[]}
}};
api.issues.create=async input=>{window.created.push(input);const row={...input,id:'image-only-defect',display_id:'BUG-IMAGE',revision:1,created_at:'2026-10-22T00:00:00Z'};bugs.unshift(row);return{id:row.id,display_id:row.display_id}};
const client=new QueryClient(`);
  fixture += `\nimport '/src/product-experience.css';`;
  const name = 'defect-image-only-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name+'.tsx', root), fixture);
    await writeFile(new URL(name+'.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{errors.push('Unexpected real API request');return route.abort()});
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('button',{name:'Choose defect reporting method',exact:true}).click();
    await page.getByRole('menuitem',{name:'Report Defect using AI',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Report Defect using AI',exact:true});
    const instructions=dialog.getByRole('textbox',{name:'Instructions for Defect Reporter',exact:true});
    assert.equal(await instructions.inputValue(),'');
    assert.equal(await dialog.getByRole('button',{name:'Generate draft',exact:true}).isDisabled(),true,'Completely empty requests stay disabled');
    await dialog.getByRole('button',{name:'Show context',exact:true}).click();
    const context=page.getByRole('dialog',{name:'Context & options',exact:true});
    await context.getByRole('tab',{name:'Images',exact:true}).click();
    const images=context.locator('input[type=file][accept="image/*"]');
    await images.setInputFiles({name:'discarded.png',mimeType:'image/png',buffer:screenshot});
    await context.getByRole('img',{name:'discarded.png',exact:true}).waitFor();
    await context.locator('.ai-reference-image-card').getByRole('button',{name:'Remove',exact:true}).click();
    await context.getByRole('img',{name:'discarded.png',exact:true}).waitFor({state:'detached'});
    await images.setInputFiles({name:'checkout.png',mimeType:'image/png',buffer:screenshot});
    await context.getByRole('img',{name:'checkout.png',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button',{name:'Generate draft',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Select a vision-capable LLM'}).waitFor();
    assert.equal(await page.evaluate(()=>window.created.length),0,'Provider failure cannot create a Defect');
    assert.equal(await instructions.inputValue(),'','No synthetic custom intent is inserted');
    const first=await page.evaluate(()=>window.draftInputs[0]);
    assert.equal(first.intent,'');assert.equal(first.reference_photos.length,1);assert.match(first.reference_photos[0].url,/^data:image\/jpeg;base64,/);
    assert.match(first.additional_context,/https:\/\/evidence\.example\.test\/signed\/source-checkout.png/);
    assert.doesNotMatch(first.additional_context,/discarded.png/);
    const uploads=await page.evaluate(()=>window.uploads);assert.ok(uploads.every(item=>item.scope.entity_type==='project'&&item.name==='checkout.png'&&item.size===68));
    await dialog.getByRole('button',{name:'Retry draft generation',exact:true}).click();
    await dialog.getByLabel('Title',{exact:false}).waitFor();
    await dialog.getByRole('button',{name:'Show context',exact:true}).click();
    await context.getByRole('tab',{name:'Files',exact:true}).click();
    await context.locator('input[type=file][accept^=".txt"]').setInputFiles({name:'checkout.log',mimeType:'text/plain',buffer:Buffer.from('Checkout failed with HTTP 500')});
    await context.getByRole('button',{name:'Remove checkout.log',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button',{name:'Generate draft',exact:true}).click();
    await page.waitForFunction(()=>window.draftInputs.length===3);
    await dialog.getByLabel('Title',{exact:false}).waitFor();
    assert.equal(await dialog.getByLabel('Steps to reproduce',{exact:true}).inputValue(),'');
    assert.equal(await dialog.getByLabel('Expected result',{exact:true}).inputValue(),'');
    await dialog.getByText('2 gaps to verify',{exact:false}).waitFor();
    await dialog.locator('.ai-bug-review-card').screenshot({path:'/tmp/qaira-defect-image-only-draft.png',animations:'disabled'});
    const withFile=await page.evaluate(()=>window.draftInputs[2]);assert.match(withFile.additional_context,/Checkout failed with HTTP 500/);assert.equal(withFile.intent,'');
    await dialog.getByRole('button',{name:'Accept into Defect form',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const form=page.getByRole('dialog',{name:'Report Defect',exact:true}).locator('form');
    await form.getByRole('textbox',{name:'Defect Title',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.created.length),0,'Accepting a proposal only populates the form');
    assert.equal(await form.locator('.jira-attachment-card').count(),2,'Both original image and log are retained as source evidence');
    await form.getByRole('button',{name:'Create',exact:true}).click();
    const retry=page.getByRole('button',{name:'Retry file uploads',exact:true});await retry.waitFor();
    assert.equal(await page.evaluate(()=>window.created.length),1);
    assert.equal(await page.locator('.jira-attachment-panel[aria-label="Retry failed Defect attachments"] .jira-attachment-card').count(),1);
    await retry.click();await retry.waitFor({state:'detached'});
    const saved=await page.evaluate(()=>({created:window.created.length,copies:window.sourceCopies}));
    assert.equal(saved.created,1,'Retry must not repeat Defect creation');
    const factualFields=await page.evaluate(()=>({steps:window.created[0].steps_to_reproduce,expected:window.created[0].expected_result}));
    assert.equal(factualFields.steps,'');assert.equal(factualFields.expected,'','Unsupported fields remain empty when saved');
    assert.deepEqual(saved.copies.map(item=>item.id),['source-checkout.log','source-checkout.png','source-checkout.png']);
    assert.ok(saved.copies.every(item=>item.scope.entity_type==='issue'&&item.scope.entity_id==='image-only-defect'&&item.scope.project_id==='catalog-project'));
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
