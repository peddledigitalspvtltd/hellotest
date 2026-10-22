import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

test('AI improvement preserves current Gherkin when requesting structured output and retains edited step counts', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient', `
item.requirement_id=null;item.requirement_ids=[];
api.requirements.list=async()=>[{id:'story',project_id:'p',title:'Checkout Story',status:'open',priority:3,acceptance_criteria:['A purchase completes.']}];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.authoringRequests=[];
api.testCases.previewCaseAuthoring=async input=>{window.authoringRequests.push(structuredClone(input));return {case:{title:'Improved checkout',description:'A purchase completes',authoring_mode:input.authoring_mode,parameter_values:{},parameter_count:0,gherkin_document:input.authoring_mode==='gherkin'?'Feature: Checkout\\nScenario: Purchase\\nWhen the customer buys\\nThen a receipt appears':null,steps:input.authoring_mode==='gherkin'?[]:[{step_order:1,action:'Buy',expected_result:'Receipt appears'}],step_count:input.authoring_mode==='gherkin'?2:1}}};
const client=new QueryClient`);
  fixture += "\nimport '/src/product-experience.css';";
  const name = 'authoring-formats-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html?mode=gherkin`);
    await page.getByRole('button', { name: 'AI Improve Test Cases', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI Improve Test Case', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('radio', { name: 'Gherkin', exact: true }).getAttribute('aria-checked'), 'true');
    await dialog.getByRole('radio', { name: 'Structured', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await dialog.getByRole('heading', {name: 'Improved checkout', exact: true}).waitFor();
    await dialog.getByRole('button',{name:'Compare',exact:true}).click();
    const comparison=dialog.getByRole('region',{name:'Current and proposed content',exact:true});
    await comparison.waitFor();assert.match(await comparison.innerText(), /Scenario Outline: A purchase/);assert.match(await comparison.innerText(), /Buy/);
    await dialog.getByRole('button',{name:'Hide comparison',exact:true}).click();
    const request = await page.evaluate(() => window.authoringRequests[0]);
    assert.equal(request.authoring_mode, 'structured');
    assert.equal(request.requirement_id, undefined);
    assert.equal(request.test_case.authoring_mode, 'gherkin');
    assert.match(request.test_case.gherkin_document, /Scenario Outline: A purchase/);
    await dialog.getByRole('radio', { name: 'Gherkin', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await dialog.locator('.ai-artifact-item small').filter({hasText:'2 scenario lines'}).waitFor();
    await dialog.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Test case title', exact: true }).fill('Reviewed checkout');
    await dialog.getByRole('button', { name: 'Finish editing draft', exact: true }).click();
    assert.equal(await dialog.locator('.ai-artifact-item small').filter({hasText:'2 scenario lines'}).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
});

test('AI generation accepts user instructions without any available Stories', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/test-cases']");
  fixture = fixture.replace('const client=new QueryClient', `
api.requirements.list=async()=>[];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.generationRequests=[];
api.testCases.previewDesignedCases=async input=>{window.generationRequests.push(structuredClone(input));return {cases:[{client_id:'draft',title:'Measure latency',description:'Measure latency',priority:3,authoring_mode:'structured',requirement_ids:[],requirement_titles:[],steps:[{step_order:1,action:'Measure latency',expected_result:'Latency satisfies the supplied threshold'}],parameter_values:{}}],generated:1}};
const client=new QueryClient`);
  const name = 'optional-story-generation-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage();
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('button', {name:'Open create test case options',exact:true}).click();
    await page.getByRole('menuitem', {name:/AI Test Cases Generation/}).click();
    const dialog = page.getByRole('dialog', {name:'AI Test Case Generator',exact:true});
    await dialog.waitFor();
    await dialog.locator('.ai-intent-canvas textarea').fill('Measure latency under 250 ms for 150 concurrent users.');
    await dialog.getByRole('button', {name:'Generate drafts',exact:true}).click();
    await page.waitForFunction(()=>window.generationRequests.length===1);
    const request=await page.evaluate(()=>window.generationRequests[0]);
    assert.deepEqual(request.requirement_ids, []);
    assert.match(request.additional_context,/250 ms/);
    await dialog.getByText('Measure latency',{exact:true}).first().waitFor();
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});

test('AI generation and improvement retain original prompt files and attach their evidence after review', { timeout: 120000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:[new URLSearchParams(location.search).get('flow')==='generate'?'/test-cases':'/test-cases?case=case1']");
  fixture = fixture.replace('const client=new QueryClient', `
item.requirement_id=null;item.requirement_ids=[];
api.requirements.list=async()=>[];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.fileUploads=[];window.fileAccess=[];window.fileCopies=[];window.generationRequests=[];window.authoringRequests=[];window.accepted=[];
api.attachments.meta=async()=>({enabled:true,uploadLimit:2000000});
api.attachments.upload=async(scope,file,options)=>{const id='reference-'+(window.fileUploads.length+1);window.fileUploads.push({id,scope,name:file.name,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),checksum:options.checksumSha256});return{id,filename:file.name}};
api.attachments.aiAccess=async(id,projectId)=>{window.fileAccess.push({id,projectId});return{id,url:'https://files.example.test/api/attachments/'+id+'/ai-content?token=fixture-signature',expires_at:'2030-01-01T00:00:00.000Z'}};
api.attachments.copy=async(id,scope)=>{window.fileCopies.push({id,scope});return{id:'copied-'+id}};
const evidenceDraft={client_id:'evidence-draft',title:'Validate invoice amount',description:'Reject invalid invoice amounts.',priority:3,test_case_type:'functional',authoring_mode:'structured',parameter_values:{},parameter_count:0,requirement_ids:[],requirement_titles:[],steps:[{step_order:1,step_type:'web',action:'Submit an invalid amount.',expected_result:'The amount is rejected.'}],step_count:1};
api.testCases.previewDesignedCases=async input=>{window.generationRequests.push(structuredClone(input));return{cases:[evidenceDraft],generated:1}};
api.testCases.previewCaseAuthoring=async input=>{window.authoringRequests.push(structuredClone(input));return{case:evidenceDraft}};
api.testCases.acceptDesignedCases=async input=>{window.accepted.push(structuredClone(input));return{created:[]}};
const client=new QueryClient`);
  const name = 'authoring-file-evidence-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
    const documentBytes = Buffer.from('Synthetic invoice specification: reject zero or negative invoice amounts.');
    for (const flow of ['generate', 'improve']) {
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?flow=${flow}`);
      const imageBytes = Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width=16; canvas.height=16;
        const context=canvas.getContext('2d'); context.fillStyle='#147d64'; context.fillRect(0,0,16,16);
        return canvas.toDataURL('image/png').split(',')[1];
      }), 'base64');
      if (flow === 'generate') {
        await page.getByRole('button', { name: 'Open create test case options', exact: true }).click();
        await page.getByRole('menuitem', { name: 'AI Test Cases Generation', exact: true }).click();
      } else await page.getByRole('button', { name: 'AI Improve Test Cases', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: flow === 'generate' ? 'AI Test Case Generator' : 'AI Improve Test Case', exact: true });
      await dialog.getByRole('textbox', { name: 'Additional instructions', exact: true }).fill('Create invoice amount validation Test Cases.');
      await dialog.getByRole('button', { name: 'Show context', exact: true }).click();
      const context = page.getByRole('dialog', { name: 'Context & options', exact: true });
      await context.getByRole('tab', { name: 'Files', exact: true }).click();
      await context.locator('.ai-context-file-button input[type="file"]').setInputFiles({ name:'invoice-spec.txt', mimeType:'text/plain', buffer:documentBytes });
      await context.getByText('invoice-spec.txt', { exact:true }).waitFor();
      await context.getByRole('tab', { name:'Images', exact:true }).click();
      await context.locator('.ai-reference-photos-field input[type="file"]').setInputFiles({ name:'invoice-original.png', mimeType:'image/png', buffer:imageBytes });
      await context.getByText('invoice-original.png', { exact:true }).waitFor();
      await page.keyboard.press('Escape');
      await context.waitFor({ state:'hidden' });
      await dialog.getByRole('button', { name:'Show context', exact:true }).click();
      await context.getByRole('tab', { name:/^Files/ }).click();
      await context.getByText('invoice-spec.txt', { exact:true }).waitFor();
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name:'Generate drafts', exact:true }).click();
      await dialog.getByRole('heading', { name:'Validate invoice amount', exact:true }).waitFor();
      const retained = await page.evaluate(flow => ({uploads:window.fileUploads,access:window.fileAccess,request:flow==='generate'?window.generationRequests[0]:window.authoringRequests[0]}), flow);
      assert.deepEqual(retained.uploads.map(item=>item.name), ['invoice-spec.txt','invoice-original.png']);
      assert.deepEqual(Buffer.from(retained.uploads[0].bytes), documentBytes);
      assert.deepEqual(Buffer.from(retained.uploads[1].bytes), imageBytes, 'Evidence retains the exact original image bytes');
      for (const upload of retained.uploads) {
        assert.deepEqual(upload.scope, {project_id:'p',entity_type:'project',entity_id:'p'});
        assert.match(upload.checksum, /^[a-f0-9]{64}$/);
      }
      assert.equal(retained.access.length,2);
      assert.match(retained.request.additional_context,/reject zero or negative invoice amounts/);
      assert.match(retained.request.additional_context,/https:\/\/files\.example\.test\/api\/attachments\/reference-1\/ai-content\?token=fixture-signature/);
      assert.equal(retained.request.images.length,1);
      assert.match(retained.request.images[0].url,/^data:image\//, 'The model receives the bounded image representation');
      await dialog.getByRole('button', {name:'Edit draft',exact:true}).click();
      await dialog.getByRole('textbox', {name:'Test case title',exact:true}).fill('Reviewed invoice amount validation');
      await dialog.getByRole('button', {name:'Finish editing draft',exact:true}).click();
      if (flow==='generate') {
        await dialog.getByRole('button',{name:'Accept Into Test Case Library (1)',exact:true}).click();
        await page.waitForFunction(()=>window.accepted.length===1);
        const accepted=await page.evaluate(()=>window.accepted[0]);
        assert.deepEqual(accepted.cases[0].reference_attachment_ids,['reference-1','reference-2']);
        assert.equal(accepted.cases[0].title,'Reviewed invoice amount validation');
      } else {
        await dialog.getByRole('button',{name:'Apply Reviewed Improvement (1)',exact:true}).click();
        const confirmation=page.getByRole('dialog',{name:'Replace saved steps?',exact:true});
        await confirmation.getByRole('button',{name:'Replace steps',exact:true}).click();
        await page.waitForFunction(()=>window.fileCopies.length===2);
        const result=await page.evaluate(()=>({copies:window.fileCopies,updates:window.updates}));
        assert.deepEqual(result.copies.map(item=>item.id),['reference-1','reference-2']);
        for(const copy of result.copies)assert.deepEqual(copy.scope,{project_id:'p',entity_type:'test_case',entity_id:'case1'});
        assert.equal(result.updates[0].title,'Reviewed invoice amount validation');
      }
    }
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});

test('image-only Test Case generation and improvement send the image without inventing user instructions and retain its evidence', { timeout: 120000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:[new URLSearchParams(location.search).get('flow')==='improve'?'/test-cases?case=case1':'/test-cases']");
  fixture = fixture.replace('const client=new QueryClient', `
item.requirement_id=null;item.requirement_ids=[];
const story={id:'story',display_id:'ST-1',project_id:'p',title:'Checkout receipt',description:'Show the receipt after the customer completes checkout.',status:'open',priority:3,acceptance_criteria:['Show the purchased item and paid total.']};
api.requirements.list=async()=>new URLSearchParams(location.search).get('flow')==='linked'?[story]:[];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.fileUploads=[];window.fileAccess=[];window.fileCopies=[];window.generationRequests=[];window.authoringRequests=[];window.accepted=[];
api.attachments.meta=async()=>({enabled:true,uploadLimit:2000000});
api.attachments.upload=async(scope,file,options)=>{window.fileUploads.push({scope,name:file.name,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),checksum:options.checksumSha256});return{id:'image-source',filename:file.name}};
api.attachments.aiAccess=async(id,projectId)=>{window.fileAccess.push({id,projectId});return{id,url:'https://files.example.test/api/attachments/'+id+'/ai-content?token=fixture-signature',expires_at:'2030-01-01T00:00:00.000Z'}};
api.attachments.copy=async(id,scope)=>{window.fileCopies.push({id,scope});return{id:'copied-'+id}};
const evidenceDraft={client_id:'image-draft',title:'Verify checkout receipt',description:'Verify the visible receipt details.',priority:3,test_case_type:'functional',authoring_mode:'structured',parameter_values:{},parameter_count:0,requirement_ids:[],requirement_titles:[],steps:[{step_order:1,step_type:'web',action:'Complete checkout.',expected_result:'The receipt displays the purchased item and paid total.'}],step_count:1};
api.testCases.previewDesignedCases=async input=>{window.generationRequests.push(structuredClone(input));return{cases:[{...evidenceDraft,requirement_ids:input.requirement_ids,requirement_titles:input.requirement_ids.length?[story.title]:[]}],generated:1}};
api.testCases.previewCaseAuthoring=async input=>{window.authoringRequests.push(structuredClone(input));return{case:evidenceDraft}};
api.testCases.acceptDesignedCases=async input=>{window.accepted.push(structuredClone(input));return{created:[]}};
const client=new QueryClient`);
  fixture += "\nimport '/src/product-experience.css';";
  const name = 'image-only-case-authoring-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name+'.tsx', root), fixture);
    await writeFile(new URL(name+'.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir('/tmp/qaira-image-only-authoring', {recursive:true});
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/api/**', route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort();});
    for (const flow of ['generate','linked','improve']) {
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?flow=${flow}`);
      const imageBytes = Buffer.from(await page.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=720;canvas.height=240;
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,720,240);
        context.fillStyle='#147d64';context.font='24px sans-serif';context.fillText('Checkout complete',30,60);
        context.fillStyle='#172b4d';context.fillText('Invoice: item 1 — paid total ₹ 100',30,110);context.fillText('Receipt available',30,160);
        return canvas.toDataURL('image/png').split(',')[1];
      }),'base64');
      if (flow==='improve') await page.getByRole('button',{name:'AI Improve Test Cases',exact:true}).click();
      else {
        await page.getByRole('button',{name:'Open create test case options',exact:true}).click();
        await page.getByRole('menuitem',{name:'AI Test Cases Generation',exact:true}).click();
      }
      const dialog=page.getByRole('dialog',{name:flow==='improve'?'AI Improve Test Case':'AI Test Case Generator',exact:true});
      const instructions=dialog.getByRole('textbox',{name:'Additional instructions',exact:true});
      assert.equal(await instructions.inputValue(),'','No custom prompt is supplied');
      if (flow==='linked') {
        await dialog.getByRole('button',{name:/^Story \(optional\)/}).click();
        const storyPicker=page.getByRole('dialog',{name:'Select Story context',exact:true});
        await storyPicker.getByRole('checkbox',{name:/Checkout receipt/}).check();
        await storyPicker.getByRole('button',{name:'Use selected context',exact:true}).click();
      }
      await dialog.getByRole('button',{name:'Show context',exact:true}).click();
      const context=page.getByRole('dialog',{name:'Context & options',exact:true});
      await context.getByRole('tab',{name:'Images',exact:true}).click();
      await context.locator('.ai-reference-photos-field input[type="file"]').setInputFiles({name:'checkout-receipt.png',mimeType:'image/png',buffer:imageBytes});
      await context.getByText('checkout-receipt.png',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await context.waitFor({state:'hidden'});
      assert.equal(await instructions.inputValue(),'','Attaching an image does not populate user instructions');
      assert.equal(await dialog.getByRole('button',{name:'Generate drafts',exact:true}).isEnabled(),true);
      await dialog.getByRole('button',{name:'Generate drafts',exact:true}).click();
      await dialog.getByRole('heading',{name:'Verify checkout receipt',exact:true}).waitFor();
      const retained=await page.evaluate(flow=>({uploads:window.fileUploads,access:window.fileAccess,request:flow==='improve'?window.authoringRequests[0]:window.generationRequests[0]}),flow);
      assert.equal(retained.uploads.length,1);
      assert.deepEqual(Buffer.from(retained.uploads[0].bytes),imageBytes,'The exact original image is retained for evidence');
      assert.deepEqual(retained.uploads[0].scope,{project_id:'p',entity_type:'project',entity_id:'p'});
      assert.match(retained.uploads[0].checksum,/^[a-f0-9]{64}$/);
      assert.deepEqual(retained.access,[{id:'image-source',projectId:'p'}]);
      assert.equal(retained.request.images.length,1);
      assert.match(retained.request.images[0].url,/^data:image\//,'The image itself reaches the model input, independently of its URL');
      const packed=retained.request.additional_context;
      assert.ok(packed.startsWith('[HELLOTEST_SMART_CONTEXT_START]\n'),'Context contains only source metadata, with no invented custom prompt');
      const evidence=JSON.parse(packed.slice('[HELLOTEST_SMART_CONTEXT_START]\n'.length,-'\n[HELLOTEST_SMART_CONTEXT_END]'.length));
      assert.equal(evidence.text_excerpts,'','No text document is supplied');
      assert.equal(evidence.files.length,1);
      assert.equal(evidence.files[0].name,'checkout-receipt.png');
      if (flow==='improve') {
        assert.equal(retained.request.requirement_id,undefined);
        assert.equal(retained.request.test_case.title,'Checkout @r.title');
        assert.equal(retained.request.test_case.steps.length,2,'Existing case content remains the improvement source');
      } else assert.deepEqual(retained.request.requirement_ids,flow==='linked'?['story']:[]);
      await dialog.screenshot({path:`/tmp/qaira-image-only-authoring/test-case-${flow}.png`});
      if (flow==='improve') {
        await dialog.getByRole('button',{name:'Apply Reviewed Improvement (1)',exact:true}).click();
        const confirmation=page.getByRole('dialog',{name:'Replace saved steps?',exact:true});
        await confirmation.getByRole('button',{name:'Replace steps',exact:true}).click();
        await page.waitForFunction(()=>window.fileCopies.length===1);
        assert.deepEqual(await page.evaluate(()=>window.fileCopies),[{id:'image-source',scope:{project_id:'p',entity_type:'test_case',entity_id:'case1'}}]);
      } else {
        await dialog.getByRole('button',{name:'Accept Into Test Case Library (1)',exact:true}).click();
        await page.waitForFunction(()=>window.accepted.length===1);
        const accepted=await page.evaluate(()=>window.accepted[0]);
        assert.deepEqual(accepted.cases[0].reference_attachment_ids,['image-source']);
        assert.deepEqual(accepted.cases[0].requirement_ids,flow==='linked'?['story']:[]);
      }
    }
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
