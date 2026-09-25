import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('Story AI requires an explicit Generate click and discards work from closed, reopened, or changed scopes', { timeout: 120000 }, async () => {
  const planningSource = await readFile(new URL('../../../manual/test/browser/storyPlanningAssignments.test.mjs', import.meta.url), 'utf8');
  const templateModule = { exports: {} };
  new Function('require', 'module', 'exports', await readFile(new URL('../../backend/services/aiPromptTemplate.service.js', import.meta.url), 'utf8'))(
    id => id === '@hellotest/platform/backend/src/db' ? { prepare: () => ({ all: async () => [] }) } : require(id), templateModule, templateModule.exports
  );
  const builtIns = [...await templateModule.exports.listPromptTemplates({ project_id: 'project', scope: 'requirement_creation' }), ...await templateModule.exports.listPromptTemplates({ project_id: 'project', scope: 'requirement_completion' })];
  let fixture = runInNewContext(planningSource.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('let story=null;', "let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Save delivery preferences',description:'Customers can save delivery preferences.',status:'open',priority:2,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],revision:1};");
  fixture = fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
  fixture = fixture.replace('api.requirements.get=async()=>story;', `api.requirements.get=async()=>story;
api.integrations.list=async()=>[{id:'llm',name:'Product LLM',type:'llm',is_active:true}];
api.aiPromptTemplates.list=async input=>${JSON.stringify(builtIns)}.filter(item=>item.scope===input.scope);
api.settings.getWorkspacePreferences=async()=>({preferences:{ai_prompt_registry_overrides:{'ai.requirement.creation':'CREATION_POLICY_SENTINEL','ai.requirement.optimization':'COMPLETION_POLICY_SENTINEL'}}});
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
    const candidate = { client_id: 'draft-1', title: 'Fresh delivery Story', description: 'A customer can save delivery preferences.', acceptance_criteria: ['An eligible address is saved.'], priority: 2, status: 'open', external_references: [], risks: ['HIDDEN_RISK_SENTINEL'], open_questions: ['HIDDEN_QUESTION_SENTINEL'], rationale: 'HIDDEN_RATIONALE_SENTINEL' };
    let dialog = await open('create');
    await waitIdle(dialog);
    assert.deepEqual(await generationCalls(), [], 'Opening must not recover jobs or invoke AI');
    const brief = 'BRIEF_SENTINEL: Customers can save an eligible delivery address.';
    await dialog.locator('.ai-prompt-copy-field textarea').fill(brief);
    await dialog.getByRole('button', { name: 'Templates', exact: true }).click();
    const templateLibrary = page.getByRole('dialog', { name: 'Choose or create a Story-generation template', exact: true });
    assert.equal(await templateLibrary.locator('.ai-prompt-template-card').count(), 4);
    await templateLibrary.locator('.ai-prompt-template-card').filter({ hasText: 'API and integration' }).getByRole('button', { name: 'Use', exact: true }).click();
    assert.equal(await dialog.locator('.ai-prompt-copy-field textarea').inputValue(), brief, 'Selecting guidance preserves the product brief');
    await dialog.getByLabel('Story template guidance', { exact: true }).waitFor();
    assert.match(await dialog.getByLabel('Story template guidance', { exact: true }).inputValue(), /service outcomes/);
    assert.equal(await dialog.locator('.story-studio-model-grid select').last().inputValue(), '2', 'Template default updates the actual requested count');

    // A job submission may finish after the user closes and reopens the modal.
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    const createInput = (await generationCalls()).find(call => call.kind === 'create').input;
    assert.equal(createInput.max_requirements, 2);
    assert.equal(createInput.additional_context, brief);
    assert.match(createInput.prompt_guidance, /CREATION_POLICY_SENTINEL/);
    assert.match(createInput.prompt_guidance, /service outcomes/);
    assert.doesNotMatch(createInput.prompt_guidance, /Draft count:/);
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
    await dialog.getByRole('heading', { name: 'Title', exact: true }).waitFor();
    await dialog.getByRole('heading', { name: 'Description', exact: true }).waitFor();
    assert.equal(await dialog.getByText('Review notes', { exact: true }).count(), 0);
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
    await dialog.getByRole('button', { name: 'Templates', exact: true }).click();
    const completionLibrary = page.getByRole('dialog', { name: 'Choose or create a Story-completion template', exact: true });
    await completionLibrary.locator('.ai-prompt-template-card').filter({ hasText: 'Clarify acceptance' }).getByRole('button', { name: 'Use', exact: true }).click();
    await dialog.getByRole('button', { name: 'Complete Story', exact: true }).click();
    await page.waitForFunction(() => window.pending.complete.length === 1);
    const completionInput = (await generationCalls()).filter(call => call.kind === 'complete').at(-1).input;
    assert.match(completionInput.prompt_guidance, /COMPLETION_POLICY_SENTINEL/);
    assert.match(completionInput.prompt_guidance, /Refine only the supplied current Story/);
    assert.equal(completionInput.requirement_context.id, 'saved-story');
    assert.equal(completionInput.requirement_context.description, 'Customers can save delivery preferences.');
    await page.evaluate(candidate => window.respond('complete', { requirement: { id: 'saved-story' }, suggestion: candidate }), candidate);
    await dialog.getByLabel('Story title', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Story title', { exact: true }).inputValue(), candidate.title);
    assert.equal(await dialog.locator('.story-studio-draft-tile').count(), 1, 'Only the regenerated proposal is shown');
    assert.equal(await dialog.getByText('Current Story', { exact: true }).count(), 0);
    assert.equal(await dialog.getByText('Review notes', { exact: true }).count(), 0);
    await dialog.getByRole('heading', { name: 'Title', exact: true }).waitFor();
    await dialog.getByRole('heading', { name: 'Description', exact: true }).waitFor();
    await mkdir('/tmp/qaira-story-ai-lifecycle', { recursive: true });
    await page.screenshot({ animations: 'disabled', path: '/tmp/qaira-story-ai-lifecycle/proposal-only.png' });
    await dialog.getByRole('button', { name: 'Apply to Story', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const updateInput = await page.evaluate(() => window.calls.filter(call => call.kind === 'update').at(-1).input);
    assert.equal(updateInput.description, candidate.description, 'Applying completion saves the visible description without hidden review notes');
    assert.doesNotMatch(updateInput.description, /HIDDEN_|Review notes|Open questions|Risks:/);

    // Accepted creation content likewise matches the editable preview.
    dialog = await open('create');
    await dialog.getByLabel('Include Gherkin', { exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await page.waitForFunction(() => window.pending.create.length === 1);
    await page.evaluate(candidate => window.respond('create', { id: 'accept-job', status: 'completed', requirements: [candidate] }), candidate);
    await dialog.getByLabel('Story title', { exact: true }).waitFor();
    await dialog.getByRole('checkbox', { name: 'Select all', exact: true }).check();
    await dialog.getByRole('button', { name: 'Accept into Library', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const acceptedCreation = await page.evaluate(() => window.calls.filter(call => call.kind === 'create' && call.input.title).at(-1).input);
    assert.equal(acceptedCreation.description, candidate.description, 'Creation saves the visible description without hidden review notes');
    assert.doesNotMatch(acceptedCreation.description, /HIDDEN_|Review notes|Open questions|Risks:/);

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
