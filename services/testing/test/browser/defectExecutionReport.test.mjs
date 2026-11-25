import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

const executionFixture = `
const caseRows = [
  { id:'checkout-case', display_id:'TC-1', title:'Saved checkout case', action:'Submit checkout', note:'Confirmation banner stayed hidden.', expected:'Order confirmation appears.', suite_id:'checkout-suite' },
  { id:'other-case', display_id:'TC-2', title:'Saved payment case', action:'Confirm payment', note:'Payment showed error 502.', expected:'Payment receipt appears.' }
];
const testCases = caseRows.map(row => ({ ...row, app_type_id:'catalog-app', project_id:'catalog-project', priority:2, status:'approved',
  suite_ids:row.suite_id?[row.suite_id]:[], requirement_ids:[], external_references:[], parameter_values:{}, steps:[] }));
const snapshots = testCases.map((item, index) => ({ execution_id:'failed-run', test_case_id:item.id, test_case_display_id:item.display_id,
  test_case_title:item.title, test_case_description:'Saved as executed', priority:2, status:'approved', sort_order:index,
  suite_id:item.suite_id, suite_name:item.suite_id?'Checkout suite':null, requirement_ids:[], external_references:[], parameter_values:{} }));
const steps = caseRows.flatMap(item => [
  { execution_id:'failed-run', test_case_id:item.id, snapshot_step_id:item.id+'-open', step_order:1, action:'Open storefront', expected_result:'Storefront opens.', step_type:'web' },
  { execution_id:'failed-run', test_case_id:item.id, snapshot_step_id:item.id+'-fail', step_order:2, action:item.action, expected_result:item.expected, step_type:'web' },
  { execution_id:'failed-run', test_case_id:item.id, snapshot_step_id:item.id+'-later', step_order:3, action:'Review confirmation details', expected_result:'Details appear.', step_type:'web' }
]);
const run = { id:'failed-run', display_id:'RUN-1', project_id:'catalog-project', app_type_id:'catalog-app', name:'Checkout regression run',
  status:'failed', trigger:'manual', run_mode:'manual', test_case_ids:testCases.map(row=>row.id), direct_test_case_ids:['other-case'],
  suite_ids:['checkout-suite'], created_by:'reviewer', created_at:'2026-09-09T08:00:00Z', started_at:'2026-09-09T09:00:00Z', ended_at:'2026-09-09T10:00:00Z',
  metrics:{total_cases:2,failed_cases:2,passed_cases:0,blocked_cases:0,pending_cases:0,running_cases:0,defect_count:0,story_count:0,failed_story_count:0},
  case_snapshots:snapshots, step_snapshots:steps, suite_snapshots:[{ id:'checkout-suite', name:'Checkout suite', test_case_ids:['checkout-case'] }], module_snapshots:[], requirement_snapshots:[],
  build:'2026.09.09', test_environment:{id:'stage',name:'Staging',snapshot:{browser:'Chromium',base_url:'https://store.example.test/checkout?token=never-forward',variables:[{key:'TOKEN',value:'never-forward'}]}},
  test_configuration:{id:'desktop',name:'Desktop checks',snapshot:{browser:'Chromium',platform_version:'130',targets:[{os:'Linux',browser:'Chromium',version:'130'}],variables:[]}}
};
const results = caseRows.map((item,index) => ({ id:item.id+'-result', execution_id:run.id, test_case_id:item.id, test_case_title:item.title, app_type_id:'catalog-app', status:'failed',
  duration_ms:1200, error:'Recorded result error.', created_at:'2026-09-09T09:1'+index+':00Z', defects:[], executed_by:'reviewer',
  logs:JSON.stringify({ stepStatuses:{[item.id+'-open']:'passed',[item.id+'-fail']:'failed'},
    stepNotes:{[item.id+'-open']:'Passing step was checked.',[item.id+'-fail']:item.note},
    stepEvidence:{[item.id+'-fail']:{attachmentId:item.id+'-screen',fileName:item.id+'-failure.png'},
      ...(index===0 ? {[item.id+'-open']:{dataUrl:'data:image/png;base64,AA==',fileName:'legacy-step.png'}} : {})} })
}));
const linked = new URLSearchParams(location.search).has('linked');
const linkedResult = { ...results[0], id:'linked:checkout-case:failed-run', logs:null, derived:true, result_origin:'linked_automation',
  source_result_id:'automation-source-result', source_test_case_id:'automated-checkout-case', source_display_id:'AT_101', covers_entire_case:true };
window.created=[];window.copied=[];window.uploaded=[];window.draftInputs=[];window.evidenceReads=[];
api.executions.list=async()=>[run];api.executions.get=async()=>run;
api.executionResults.list=async()=>linked?[linkedResult,results[1]]:results;api.executionResults.get=async id=>results.find(row=>row.id===id);
api.testCases.list=async()=>testCases;api.testCases.get=async id=>testCases.find(row=>row.id===id);
api.testCases.listPicker=async()=>({items:testCases,is_last:true,next_cursor:null});
api.executionResultAttachments.list=async id=>{
  window.evidenceReads.push(id);
  if(id==='automation-source-result')return [{id:'automation-screen',filename:'automation-failure.png',step_id:'automation-checkout-step'}];
  const caseId=results.find(row=>row.id===id).test_case_id;
  return [{id:caseId+'-screen',filename:caseId+'-failure.png',step_id:caseId+'-fail'}, {id:caseId+'-log',filename:caseId+'-result.log'}];
};
api.attachments.list=async scope=>scope.entity_type==='execution'?[{id:'run-trace',filename:'run-trace.log'}]:[];
api.attachments.copy=async(id,scope)=>{window.copied.push({id,scope});return{id}};
api.attachments.upload=async(scope,file)=>{window.uploaded.push({name:file.name,scope});return{id:file.name}};
api.issues.createMetadata=api.issues.editMetadata;
api.issues.create=async input=>{window.created.push(input);const saved={...input,id:'reported',display_id:'BUG-NEW',revision:1};bugs.unshift(saved);return{id:saved.id}};
api.issues.previewAiDraft=async input=>{window.draftInputs.push(input);throw new Error('Fixture captured the request')};
`;

test('Failed case, run and suite reports ground editable fields, attachments and AI intent in the saved result', {timeout: 90000}, async () => {
  const catalog = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  const fixture = runInNewContext(catalog.match(/const fixture = (`[\s\S]*?`);/)[1])
    .replace("import { IssuesPage }", "import { ExecutionsPage } from '/services/testing/frontend/pages/ExecutionsPage';\nimport { IssuesPage }")
    .replace('const client=new QueryClient', executionFixture + '\nconst client=new QueryClient')
    .replace("[{path:'/issues'", "[{path:'/executions',element:<ExecutionsPage/>},{path:'/issues'")
    .replace("initialEntries:['/issues']", "initialEntries:[new URLSearchParams(location.search).get('entry')]");
  const name = 'failed-execution-defect-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({headless: true, ...(process.env.CHROME_EXECUTABLE ? {executablePath: process.env.CHROME_EXECUTABLE} : {})});
    const errors = [];
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/**', route => { errors.push('Unexpected API request: ' + route.request().url()); return route.abort(); });
    const openRun = (caseId, linked = false) => page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html?entry=${encodeURIComponent('/executions?view=suite-runs&execution=failed-run' + (caseId ? '&testCase=' + caseId : ''))}${linked ? '&linked=1' : ''}`);
    for (const scope of ['case', 'suite', 'run']) {
      await openRun(scope === 'case' ? 'checkout-case' : '');
      if (scope === 'suite') await page.getByRole('button', {name: /^Suite Checkout suite/}).click();
      const launcher = page.locator({case: '.execution-case-run-report-bug', suite: '.execution-command-scope-actions', run: '.execution-command-report-bug'}[scope]);
      await launcher.getByRole('button', {name: 'Report Defect', exact: true}).click();
      const form = page.getByRole('dialog', {name: 'Report Defect', exact: true});
      const caseId = scope === 'run' ? 'other-case' : 'checkout-case';
      const action = scope === 'run' ? 'Confirm payment' : 'Submit checkout';
      const note = scope === 'run' ? 'Payment showed error 502.' : 'Confirmation banner stayed hidden.';
      const title = form.getByRole('textbox', {name: 'Defect Title', exact: true});
      await title.waitFor().catch(async error => {
        const route = await page.evaluate(() => window.fixtureRoute());
        const visible = (await page.locator('body').innerText()).slice(0, 900);
        throw new Error(`${scope} report did not open at ${route}. ${errors.join(' ')}\n${visible}`, {cause: error});
      });
      assert.equal(await title.inputValue(), 'Failed: ' + action, scope);
      const evidence = form.locator('.issue-form-section--evidence [contenteditable=true]');
      const description = await evidence.nth(0).innerText();
      for (const text of ['Checkout regression run', 'Staging', 'Desktop checks', '2026.09.09', note]) assert.ok(description.includes(text), scope + ' description includes ' + text);
      assert.doesNotMatch(description, /never-forward|Passing step was checked/);
      assert.deepEqual(await evidence.nth(1).locator('ol li').allTextContents(), ['Open storefront', action]);
      assert.equal(await evidence.nth(2).innerText(), scope === 'run' ? 'Payment receipt appears.' : 'Order confirmation appears.');
      assert.ok((await evidence.nth(3).innerText()).includes(note));
      const attachments = form.getByRole('region', {name: 'Attachments for new Defect'});
      await attachments.getByText(caseId + '-result.log', {exact: true}).waitFor();
      assert.equal(await attachments.getByText('run-trace.log', {exact: true}).count(), scope === 'run' ? 1 : 0);
      assert.equal(await attachments.getByText(scope === 'run' ? 'checkout-case-result.log' : 'other-case-result.log', {exact: true}).count(), 0);
      if (scope !== 'case') continue;
      await attachments.getByText('legacy-step.png', {exact: true}).waitFor();
      await page.setViewportSize({width: 390, height: 844});
      assert.ok(await attachments.evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth + 1));
      await page.setViewportSize({width: 1440, height: 1000});
      await evidence.nth(1).fill('Reporter reviewed the checkout reproduction.');
      await form.getByRole('button', {name: 'Create', exact: true}).click();
      await page.waitForFunction(() => window.copied.length === 2 && window.uploaded.length === 1);
      const writes = await page.evaluate(() => ({issue: window.created[0], copied: window.copied, uploaded: window.uploaded}));
      assert.equal(writes.issue.title, 'Failed: ' + action);
      assert.match(writes.issue.steps_to_reproduce, /Reporter reviewed the checkout reproduction/);
      assert.equal(writes.issue.linked_execution_result_id, 'checkout-case-result');
      assert.equal(writes.issue.linked_step_id, 'checkout-case-fail');
      assert.deepEqual(writes.copied.map(file => file.id).sort(), ['checkout-case-log', 'checkout-case-screen']);
      assert.equal(writes.uploaded[0].name, 'legacy-step.png');
      assert.ok([...writes.copied, ...writes.uploaded].every(file => file.scope.project_id === 'catalog-project' && file.scope.entity_id === 'reported'));
    }
    await openRun('checkout-case');
    await page.locator('.execution-case-run-report-bug').getByRole('button', {name: 'Choose defect reporting method', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Report Defect using AI', exact: true}).click();
    const studio = page.getByRole('dialog', {name: 'Report Defect using AI', exact: true});
    const intent = studio.getByRole('textbox', {name: 'Instructions for Defect Reporter', exact: true});
    await intent.waitFor();
    assert.match(await intent.inputValue(), /Saved checkout case[\s\S]*Confirmation banner stayed hidden/);
    const edited = 'Saved checkout case: confirmation stays hidden after order submission.';
    await intent.fill(edited);
    await studio.getByRole('button', {name: 'Generate draft', exact: true}).click();
    await page.waitForFunction(() => window.draftInputs.length === 1);
    const input = await page.evaluate(() => window.draftInputs[0]);
    assert.equal(input.intent, edited);
    assert.equal(input.linked_execution_result_id, 'checkout-case-result');
    assert.equal(input.linked_test_run_id, 'failed-run');
    assert.match(input.evidence, /Staging[\s\S]*Desktop checks/);
    assert.doesNotMatch(input.evidence, /never-forward|Confirmation banner stayed hidden/);

    await openRun('checkout-case', true);
    await page.locator('.execution-case-run-report-bug').getByRole('button', {name: 'Report Defect', exact: true}).click();
    const linkedForm = page.getByRole('dialog', {name: 'Report Defect', exact: true});
    await linkedForm.getByText('automation-failure.png', {exact: true}).waitFor();
    assert.match(await linkedForm.locator('.jira-attachment-card').innerText(), /Linked automation result/);
    assert.equal(await linkedForm.getByRole('textbox', {name: 'Defect Title', exact: true}).inputValue(), 'Failed: Saved checkout case');
    const reproduction = linkedForm.locator('#defect-reproduction [contenteditable=true]');
    assert.equal((await reproduction.nth(0).innerText()).trim(), '');
    assert.equal((await reproduction.nth(1).innerText()).trim(), '');
    assert.match(await reproduction.nth(2).innerText(), /Recorded result error/);
    await linkedForm.getByRole('button', {name: 'Create', exact: true}).click();
    await page.waitForFunction(() => window.copied.length === 1);
    const linkedWrite = await page.evaluate(() => ({issue: window.created[0], copied: window.copied[0], evidenceReads: window.evidenceReads}));
    assert.deepEqual(linkedWrite.evidenceReads, ['automation-source-result']);
    assert.equal(linkedWrite.copied.id, 'automation-screen');
    assert.deepEqual(linkedWrite.issue.linked_test_case_ids, ['checkout-case']);
    assert.ok(!linkedWrite.issue.linked_execution_result_id && !linkedWrite.issue.linked_step_id);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), {force: true})));
  }
});
