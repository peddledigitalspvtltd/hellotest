import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Actual Story and Test Case assurance reviews use edited inputs and keep deterministic scores', { timeout: 120000 }, async () => {
  let browser;
  let activePage;
  let activeKind;
  let pageErrors = [];
  let consoleErrors = [];
  const files = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    for (const kind of ['story', 'case']) {
      const source = await readFile(new URL(kind === 'story' ? '../../../../manual/test/browser/storyPlanningAssignments.test.mjs' : '../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
      let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
      if (kind === 'story') {
        fixture = fixture.replace('let story=null;', "let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Saved checkout Story',description:'As a customer, I want to save an address so checkout uses it.',acceptance_criteria:['An eligible address can be saved.'],status:'open',priority:2,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],revision:1};");
        fixture = fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
      }
      const entity = kind === 'story' ? 'requirements' : 'testCases';
      const injected = `
window.assuranceRequests=[];window.assuranceFallback=false;
api.integrations.list=async()=>[{id:'llm-a',name:'Draft LLM',type:'llm',is_active:true},{id:'llm-b',name:'Review LLM',type:'llm',is_active:true}];
api.${entity}.previewImpact=async(id,input)=>{window.assuranceRequests.push(structuredClone(input));return {
${kind === 'story' ? 'requirement' : 'test_case'}:{id,display_id:'ART-1',title:input.proposed_change.title},
impact:{risk_level:'low',requirements:[],test_cases:[],test_suites:[],test_runs:[],automation_assets:[],object_repository_items:[],totals:{}},risk_signals:[],
generated_at:new Date().toISOString(),fallback_used:window.assuranceFallback,fallback_reason:window.assuranceFallback?'Provider temporarily unavailable.':null,
assurance_review:window.assuranceFallback?undefined:{summary:'Review the unsaved checkout recovery path.',dimensions:[{id:input.assurance_baseline.dimensions[0].id,explanation:'AI explained the live draft evidence.',recommendation:'Verify the recovery outcome.',score:100,status:'strong'}]}
}};
`;
      if (kind === 'story') fixture = fixture.replace('const mode=new URLSearchParams', injected + `
window.groomingRequests=[];window.groomingFailure=false;
api.requirements.previewGrooming=async(id,input)=>{window.groomingRequests.push(structuredClone(input));if(window.groomingFailure)throw new Error('Provider refresh unavailable.');return {
requirement:{id,title:story.title,status:'open',priority:2},generated_at:new Date().toISOString(),generation_mode:'llm',fallback_used:false,
grooming:{layman:{explanation:'The saved brief explains checkout recovery.',analogy:'',evidence_refs:[]},business:{context:'Preserve customer work.',roles_and_flow:[],use_cases:[],evidence_refs:[]},technical:{overview:'Retry the failed checkout.',functional_requirements:[],data_and_integrations:[],non_functional_requirements:[],testability_notes:[],evidence_refs:[]},assumptions:[],open_questions:[],risks:[],review_evidence_refs:[]},
context:{scope:{project_id:'project',project_key:'P'},bounded:true,limits:{},included:{comments:0,attachments:0,linked_tickets:0,related_project_records:0,external_references:0},omitted:{},sources:[],partial_sources:[],unavailable_sources:[]}
}};
` + 'const mode=new URLSearchParams');
      else fixture = fixture.replace('const client=new QueryClient', injected + 'const client=new QueryClient');
      if (kind === 'story') fixture = fixture.replace('client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}', 'client={window.assuranceClient = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}');
      else fixture = fixture.replace("client.setQueryData(['feature-flags'],flags);", "client.setQueryData(['feature-flags'],flags);window.assuranceClient=client;");
      const name = `assurance-${kind}-${randomUUID()}`;
      const tsx = new URL(`${name}.tsx`, root), html = new URL(`${name}.html`, root); files.push(tsx, html);
      await writeFile(tsx, fixture);
      await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      const errors = [];
      activePage = page;
      activeKind = kind;
      pageErrors = errors;
      consoleErrors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html${kind === 'case' ? '?mode=gherkin' : ''}`);
      if (kind === 'story') {
        // Enter from the catalog explicitly instead of racing deep-link hydration against delayed capabilities.
        await page.getByRole('button', { name: 'Open Story ST-1: Saved checkout Story', exact: true }).click();
        await page.getByRole('heading', { name: 'Story details', exact: true }).waitFor({ timeout: 10000 });
        const title = page.getByLabel('Story Title', { exact: false });
        assert.equal(await title.inputValue(), 'Saved checkout Story');
        await title.fill('Unsaved checkout Story');
        await page.locator('.story-acceptance-criteria-field textarea').fill('The unsaved address is restored after retry.');
      } else {
        await page.getByRole('textbox', { name: /^Scenario(?: Outline)? name$/ }).fill('Unsaved checkout retry');
        const parameterPreview = page.getByRole('button', { name: 'Edit Behavior step 1', exact: true });
        if (await parameterPreview.count()) await parameterPreview.focus();
        await page.getByRole('combobox', { name: 'Behavior step 1', exact: true }).fill('an unsaved checkout retry is pending');
      }
      const assuranceTab = page.getByRole('tab', { name: /Assurance/ });
      await assuranceTab.scrollIntoViewIfNeeded();
      const tabLayout = await assuranceTab.evaluate(node => {
        const tab = node.getBoundingClientRect();
        const command = document.querySelector('.test-case-workspace-shell > .panel-actions-inline')?.getBoundingClientRect();
        return {
          tab: tab.toJSON(), command: command?.toJSON(),
          hit: document.elementFromPoint(tab.left + tab.width / 2, tab.top + tab.height / 2)?.className
        };
      });
      assert.ok(kind !== 'case' || !tabLayout.command || tabLayout.command.bottom <= tabLayout.tab.top + 1, `Test Case command bar must not cover detail tabs: ${JSON.stringify(tabLayout)}`);
      await assuranceTab.click();
      const workspace = page.locator('.artifact-assurance-workspace');
      await workspace.waitFor();
      const baseline = await workspace.locator('.artifact-assurance-overall-score').getAttribute('aria-valuenow');
      const scores = await workspace.locator('.artifact-assurance-dimension-score').allTextContents();
      await workspace.locator('.ai-llm-select select').selectOption('llm-b');
      await workspace.getByText('Prompt and Smart Context', { exact: true }).click();
      await workspace.getByLabel('AI review prompt', { exact: true }).fill('Review the current retry recovery behavior and cite supplied facts.');
      await workspace.getByLabel('Additional AI review context', { exact: true }).fill('Reviewed support context: retry must preserve the address.');
      await workspace.getByRole('button', { name: 'Analyze with AI', exact: true }).click();
      await workspace.getByText('Review the unsaved checkout recovery path.', { exact: true }).waitFor();
      const input = await page.evaluate(() => window.assuranceRequests[0]);
      assert.equal(input.integration_id, 'llm-b');
      assert.match(input.prompt_guidance, /Review the current retry recovery/);
      assert.equal(input.additional_context, 'Reviewed support context: retry must preserve the address.');
      assert.equal(input.assurance_baseline.overall_score, Number(baseline));
      if (kind === 'story') {
        assert.equal(input.proposed_change.title, 'Unsaved checkout Story');
        assert.deepEqual(input.proposed_change.acceptance_criteria, ['The unsaved address is restored after retry.']);
      } else {
        assert.equal(input.proposed_change.authoring_mode, 'gherkin');
        assert.match(input.proposed_change.gherkin_document, /Unsaved checkout retry/);
        assert.match(input.proposed_change.steps[0].action, /unsaved checkout retry is pending/);
        assert.doesNotMatch(input.proposed_change.steps[0].action, /Sign in/);
      }
      assert.equal(await workspace.locator('.artifact-assurance-overall-score').getAttribute('aria-valuenow'), baseline);
      assert.deepEqual(await workspace.locator('.artifact-assurance-dimension-score').allTextContents(), scores);
      if (kind === 'story') {
        await workspace.getByRole('button', { name: 'Inspect impact', exact: true }).click();
        const impact = page.getByRole('dialog', { name: 'Preview Story change impact', exact: true });
        await impact.waitFor();
        assert.match(await impact.innerText(), /Unsaved checkout Story/);
        assert.equal(await impact.locator('.story-impact-evidence').count(), 1);
        assert.equal(await page.evaluate(() => window.assuranceRequests.length), 1, 'Opening the current impact reuses the reviewed draft without another model request');
        await impact.getByRole('button', { name: 'Close preview', exact: true }).click();
      }
      await workspace.getByLabel('AI review prompt', { exact: true }).fill('Review a changed focus on retry recovery.');
      await workspace.getByText('Draft changed.', { exact: true }).waitFor();
      assert.equal(await workspace.getByText('Review the unsaved checkout recovery path.', { exact: true }).count(), 0);
      await page.evaluate(() => { window.assuranceFallback = true; });
      await workspace.getByRole('button', { name: 'Analyze with AI', exact: true }).click();
      await workspace.getByText(/AI review was not applied\. Provider temporarily unavailable/).waitFor();
      await workspace.getByRole('button', { name: 'Retry AI analysis', exact: true }).waitFor();
      assert.equal(await workspace.locator('.artifact-assurance-overall-score').getAttribute('aria-valuenow'), baseline);
      if (kind === 'story') {
        await page.getByRole('button', { name: 'AI Groom Story', exact: true }).click();
        assert.equal(await page.evaluate(() => window.groomingRequests.length), 0, 'Opening Groom Story lets the user review provider and context before generation');
        let grooming = page.locator('.story-grooming-workspace');
        await grooming.locator('.ai-llm-select select').selectOption('llm-b');
        await grooming.getByText('Prompt and Smart Context', { exact: true }).click();
        await grooming.getByLabel('AI review prompt', { exact: true }).fill('Review checkout planning decisions.');
        await grooming.getByLabel('Additional AI review context', { exact: true }).fill('Reviewed delivery constraint: preserve customer data.');
        await grooming.getByRole('button', { name: 'Generate refinement', exact: true }).click();
        await grooming.getByText('The saved brief explains checkout recovery.', { exact: true }).waitFor();
        const groomingInput = await page.evaluate(() => window.groomingRequests[0]);
        assert.equal(groomingInput.integration_id, 'llm-b');
        assert.equal(groomingInput.prompt_guidance, 'Review checkout planning decisions.');
        assert.equal(groomingInput.additional_context, 'Reviewed delivery constraint: preserve customer data.');
        await page.evaluate(() => { window.groomingFailure = true; });
        await grooming.getByRole('button', { name: 'Refresh brief', exact: true }).click();
        await grooming.getByText(/latest refresh failed; the previous brief remains visible/).waitFor();
        await grooming.getByText('The saved brief explains checkout recovery.', { exact: true }).waitFor();
        await grooming.getByText('Prompt and Smart Context', { exact: true }).click();
        await grooming.getByLabel('Additional AI review context', { exact: true }).fill('New delivery constraint awaiting review.');
        await grooming.getByText(/supporting evidence changed after the brief was generated/).waitFor();
      }
      await page.evaluate((key) => {
        window.assuranceClient.setQueryData(['feature-flags'], {flags:new Proxy({[key]:false},{get:(target,property)=>property===key?false:true})});
      }, kind === 'story' ? 'hellotest.ai.requirement_design' : 'hellotest.ai.test_authoring');
      await assuranceTab.waitFor({state:'detached'});
      assert.equal(await page.getByRole('tab', {name:/Assurance/}).count(), 0);
      assert.equal(await page.locator('.artifact-assurance-workspace').count(), 0, 'Revoked feature must unmount its panel');
      assert.equal(await page.locator('.story-grooming-workspace').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } catch (error) {
    const body = activePage && !activePage.isClosed()
      ? await activePage.locator('body').innerText().catch(() => '<body unavailable>')
      : '<page unavailable>';
    throw new Error(`${activeKind || 'setup'} assurance flow failed: ${error.message}\nPage errors: ${JSON.stringify(pageErrors)}\nConsole errors: ${JSON.stringify(consoleErrors)}\nBody:\n${body.slice(0, 8000)}`, { cause: error });
  } finally {
    await browser?.close();
    await Promise.all(files.map(file => rm(file, { force: true })));
  }
});
