import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Story AI requires an explicit Generate click and discards work from closed, reopened, or changed scopes', { timeout: 120000 }, async () => {
  const planningSource = await readFile(new URL('./storyPlanningAssignments.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(planningSource.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('let story=null;', "let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Save delivery preferences',description:'Customers can save delivery preferences.',status:'open',priority:2,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],revision:1};");
  fixture = fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
  fixture = fixture.replace('api.requirements.get=async()=>story;', `api.requirements.get=async()=>story;
api.integrations.list=async()=>[{id:'llm',name:'Product LLM',type:'llm',is_active:true}];
window.pending={create:[],complete:[],gherkin:[],poll:[]};window.jobs={};window.deferPoll=false;
window.respond=(kind,payload)=>{if(kind==='create')window.jobs[payload.id]=payload;const resolve=window.pending[kind].shift();if(!resolve)throw new Error('No pending '+kind);resolve(payload)};
window.changeScope=()=>setCurrentScope('other-project','other-app');
const deferred=(kind,input)=>{window.calls.push({kind,input});return new Promise(resolve=>window.pending[kind].push(resolve))};
api.requirements.listGenerationJobs=async()=>{window.calls.push({kind:'recover'});return [{id:'previous-session',status:'completed',requirements:[{client_id:'stale',title:'Previously created Story',description:'Old draft',acceptance_criteria:['Old criterion']}]}]};
api.requirements.createGenerationJob=input=>deferred('create',input);
api.requirements.previewOptimization=(id,input)=>deferred('complete',{id,...input});
api.requirements.previewGherkin=input=>deferred('gherkin',input);
api.requirements.getGenerationJob=async id=>{if(window.deferPoll)return deferred('poll',{id});window.calls.push({kind:'poll-read',id});return window.jobs[id]};`);
  const name = `story-ai-lifecycle-${randomUUID()}`;
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected real request: ${route.request().url()}`); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    await page.getByText('Save delivery preferences', { exact: true }).first().waitFor().catch(async error => {
      throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${(await page.locator('body').innerText()).slice(0, 6000)}`);
    });
    const open = async mode => {
      const back = page.getByRole('button', { name: 'Back to Story tiles', exact: true });
      if (mode === 'create' && await back.isVisible()) await back.click();
      if (mode === 'improve' && !await page.getByRole('heading', { name: 'Story details', exact: true }).isVisible()) {
        await page.getByText('Save delivery preferences', { exact: true }).click();
        await page.getByRole('heading', { name: 'Story details', exact: true }).waitFor();
      }
      const name = mode === 'create' ? 'Create Stories using AI' : 'AI Complete Story';
      for (const button of await page.getByRole('button', { name, exact: true }).all()) {
        if (await button.isVisible() && await button.isEnabled()) { await button.click(); break; }
      }
      const dialog = page.getByRole('dialog', { name, exact: true });
      await dialog.waitFor();
      await dialog.getByRole('heading', { name: 'Your Story draft will appear here', exact: true }).waitFor();
      const action = dialog.locator('.story-studio-inspector-empty').getByRole('button', { name: mode === 'create' ? 'Generate drafts' : 'Complete Story', exact: true });
      await action.waitFor();
      assert.equal(await dialog.locator('.story-studio-command-bar .story-studio-primary-action').count(), 0);
      const headingBox = await dialog.getByRole('heading', { name: 'Your Story draft will appear here', exact: true }).boundingBox();
      const actionBox = await action.boundingBox();
      assert.ok(actionBox.y >= headingBox.y + headingBox.height, 'Generate sits below the empty output heading');
      return dialog;
    };
    const close = async (dialog, mode) => {
      await dialog.getByRole('button', { name: mode === 'create' ? 'Close AI Story creation' : 'Close AI Story improvement', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    const waitIdle = async dialog => {
      await page.waitForTimeout(150);
      assert.equal(await dialog.locator('.story-studio-draft-tile').count(), 0);
      assert.equal(await dialog.getByRole('button', { name: /Generate drafts|Complete Story/, exact: true }).isEnabled(), true);
    };
    const generationCalls = () => page.evaluate(() => window.calls.filter(call => ['create','complete','gherkin','recover','poll','poll-read'].includes(call.kind)));
    const candidate = { client_id: 'draft-1', title: 'Fresh delivery Story', description: 'A customer can save delivery preferences.', acceptance_criteria: ['An eligible address is saved.'], priority: 2, status: 'open', external_references: [] };
    let dialog = await open('create');
    await waitIdle(dialog);
    assert.deepEqual(await generationCalls(), [], 'Opening must not recover jobs or invoke AI');

    // A job submission may finish after the user closes and reopens the modal.
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    await close(dialog, 'create');
    dialog = await open('create');
    await page.evaluate(candidate => window.respond('create', { id: 'late-submit', status: 'completed', requirements: [candidate] }), candidate);
    await waitIdle(dialog);
    assert.deepEqual((await generationCalls()).map(call => call.kind), ['create']);

    // Poll completion from a closed dialog must not hydrate drafts or launch Gherkin.
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    await page.evaluate(() => { window.deferPoll = true; window.respond('create', { id: 'late-poll', status: 'queued' }); });
    await page.waitForFunction(() => window.pending.poll.length === 1);
    await close(dialog, 'create');
    dialog = await open('create');
    await page.evaluate(candidate => { window.deferPoll = false; window.respond('poll', { id: 'late-poll', status: 'completed', requirements: [candidate] }); }, candidate);
    await waitIdle(dialog);
    assert.equal((await generationCalls()).filter(call => call.kind === 'gherkin').length, 0);

    // A current explicit request still produces editable drafts and its optional Gherkin pass.
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    await page.evaluate(candidate => window.respond('create', { id: 'current-job', status: 'completed', requirements: [candidate] }), candidate);
    await dialog.locator('.story-studio-draft-tile').waitFor();
    await page.waitForFunction(() => window.pending.gherkin.length === 1);
    assert.equal(await dialog.getByRole('button', { name: 'Decline Draft', exact: true }).isDisabled(), true);
    await close(dialog, 'create');
    dialog = await open('improve');
    await page.evaluate(() => window.respond('gherkin', { requirements: [{ client_id: 'draft-1', gherkin_scenarios: ['Scenario: Stale result'] }] }));
    await waitIdle(dialog);
    assert.equal(await dialog.getByText('Fresh delivery Story', { exact: true }).count(), 0);

    // Completion responses are also session-bound, even for the same selected Story.
    await dialog.getByRole('button', { name: 'Complete Story', exact: true }).click();
    await page.waitForFunction(() => window.pending.complete.length === 1);
    await close(dialog, 'improve');
    dialog = await open('improve');
    await page.evaluate(candidate => window.respond('complete', { requirement: { id: 'saved-story' }, suggestion: candidate }), candidate);
    await waitIdle(dialog);
    assert.equal((await generationCalls()).filter(call => call.kind === 'gherkin').length, 1);
    await dialog.getByLabel('Include Gherkin', { exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Complete Story', exact: true }).click();
    await page.waitForFunction(() => window.pending.complete.length === 1);
    await page.evaluate(candidate => window.respond('complete', { requirement: { id: 'saved-story' }, suggestion: candidate }), candidate);
    await dialog.getByLabel('Story title', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Story title', { exact: true }).inputValue(), candidate.title);
    assert.equal(await dialog.locator('.story-studio-draft-tile').count(), 2, 'Current and completed Stories remain available for review');
    await close(dialog, 'improve');

    // Scope changes close the dialog and invalidate outstanding work immediately.
    dialog = await open('create');
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    await page.evaluate(() => window.changeScope());
    await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(candidate => window.respond('create', { id: 'foreign-scope-job', status: 'completed', requirements: [candidate] }), candidate);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.story-ai-workbench-dialog').count(), 0);
    assert.equal((await generationCalls()).filter(call => call.kind === 'recover').length, 0);
    assert.deepEqual(errors, []);
    await mkdir('/tmp/qaira-story-ai-lifecycle', { recursive: true });
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
