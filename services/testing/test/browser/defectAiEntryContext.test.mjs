import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('AI Defect entry points preserve authoritative scope when optional Test Case names cannot load', { timeout: 90000 }, async () => {
  const catalog = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(catalog.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/issues']", "initialEntries:[new URLSearchParams(location.search).get('entry') || '/issues']");
  fixture = fixture.replace('const client=new QueryClient', `
api.integrations.list=async()=>[{id:'draft-llm',name:'Draft LLM',type:'llm',is_active:true}];
api.testCases.listPicker=async()=>{throw new Error('Temporary Test Case picker failure')};
api.executions.list=async()=>[{id:'run-1',name:'Checkout failures',status:'failed'}];
window.draftInputs=[];
api.issues.previewAiDraft=async input=>{window.draftInputs.push(input);return{
  draft:{title:'Checkout submission fails',message:'Checkout submission reports an error.',steps_to_reproduce:'Open checkout and submit the order.',expected_result:'The order is confirmed.',actual_result:'HTTP 500 is returned.',severity:'high',priority:'High',environment:'',build:'',labels:[],linked_test_run_id:input.linked_test_run_id||'',linked_test_case_ids:input.linked_test_case_ids||[],linked_requirement_ids:[],rationale:'The supplied failure comment records the server error.'},
  citations:[],evidence_sources:[{ref:'E1',type:'reporter',id:'failure',title:'Failure comment',excerpt:'HTTP 500 is returned.'}],field_evidence:{title:['E1'],message:['E1']},gaps:[],assumptions:[],fallback_fields:[],boundaries:{limits:{},requested:{notes:1},included:{notes:1},omitted:{},content_limits:{},content_omissions:[],partial_sources:false},processing:{stages:[],active_stage_id:'review',completed_stage_count:4,total_stage_count:4,status_label:'Ready for review'},provenance:{generation_mode:'llm',fallback_used:false,requires_human_review:true,evidence:[]}
}};
const client=new QueryClient`);
  const name = 'defect-entry-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const scopes = [
      { name: 'case', params: { run: 'run-1', linked_test_case_ids: 'case-1', executionResult: 'attempt-1' }, cases: ['case-1'], result: 'attempt-1' },
      { name: 'run', params: { run: 'run-1' }, cases: [] },
      { name: 'suite', params: { run: 'run-1', linked_test_suite_ids: 'suite-1' }, cases: [], suites: ['suite-1'] },
      { name: 'module', params: { run: 'run-1', linked_module_ids: 'module-1' }, cases: [], modules: ['module-1'] },
      { name: 'standalone', params: {}, cases: [] }
    ];
    for (const scope of scopes) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { errors.push('Unexpected API request: ' + route.request().url()); return route.abort(); });
      const entry = '/issues?' + new URLSearchParams({ ai: '1', message: 'Failure comment: checkout returned HTTP 500.', ...scope.params });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?entry=${encodeURIComponent(entry)}`);
      const dialog = page.getByRole('dialog', { name: 'Report Defect using AI', exact: true });
      await dialog.waitFor();
      if (scope.name !== 'run' && scope.name !== 'standalone') {
        await dialog.getByRole('button', { name: 'Show context', exact: true }).click();
        await page.getByRole('button', { name: /Review evidence setup/ }).click();
        await page.getByText('Test Case names could not be loaded.', { exact: false }).waitFor();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
      }
      await dialog.getByRole('button', { name: 'Generate draft', exact: true }).click();
      await dialog.getByLabel('Title', { exact: false }).waitFor();
      const [input] = await page.evaluate(() => window.draftInputs);
      assert.equal(input.project_id, 'catalog-project', scope.name);
      assert.equal(input.linked_test_run_id, scope.params.run || '', scope.name);
      assert.deepEqual(input.linked_test_case_ids, scope.cases, scope.name);
      assert.deepEqual(input.linked_test_suite_ids, scope.suites || [], scope.name);
      assert.deepEqual(input.linked_module_ids, scope.modules || [], scope.name);
      assert.equal(input.linked_execution_result_id, scope.result, scope.name);
      assert.match(input.evidence, /Failure comment: checkout returned HTTP 500\./);
      assert.equal(await page.evaluate(() => window.calls.all.some(call => ['issues.create', 'issues.update'].includes(call.path))), false, 'Drafting requires explicit acceptance and save');
      assert.deepEqual(errors, [], scope.name);
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
});
