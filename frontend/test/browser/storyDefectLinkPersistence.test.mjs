import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Story Defect links survive failed saves and switching Stories before saving metadata', { timeout: 90_000 }, async () => {
  const name = `story-defect-persistence-${randomUUID()}`;
  const files = [];
  let browser;
  try {
    const source = await readFile(new URL('./storyPlanningAssignments.test.mjs', import.meta.url), 'utf8');
    let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
    fixture = fixture.replace('let story=null;', `
      const defect = { id:'defect-a', title:'Checkout payment fails', status:'open', link_source:'manual', project_id:'project' };
      let story = { id:'saved-story', display_id:'ST-1', project_id:'project', title:'Checkout Story', description:'Review checkout payments.',
        status:'open', priority:2, revision:1, iteration_id:'native-sprint', sprint:'Sprint Alpha',
        labels:[], external_references:[], test_case_ids:[], defect_ids:[defect.id], defects:[defect], gherkin_scenarios:[] };
      const secondStory = { ...story, id:'second-story', display_id:'ST-2', title:'Recovery Story', defect_ids:[], defects:[] };
    `);
    fixture = fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
    fixture = fixture.replace('const mode=new URLSearchParams', `
      window.defectWrites = []; window.failDefectSave = true; window.detailLoads = [];
      api.requirements.listPage = async () => page(structuredClone([story, secondStory]));
      api.requirementIterations.listRequirements = async () => page(structuredClone([story, secondStory]));
      api.requirements.get = async id => {
        const item = [story,secondStory].find(item => item.id === id || item.display_id === id);
        window.detailLoads.push({id:item.id,defect_ids:[...item.defect_ids]});
        return structuredClone(item);
      };
      api.issues.list = async () => [defect];
      api.requirementDefects.replace = async (id,ids) => {
        if (window.failDefectSave) throw new Error('Defect link save failed. Please retry.');
        window.defectWrites.push({id,ids});
        if (id === story.id) story = {...story, defect_ids:[...ids], defects:ids.includes(defect.id)?[defect]:[]};
        return {updated:true};
      };
      window.savedDefectIds = () => story.defect_ids;
      const mode=new URLSearchParams
    `);
    for (const [extension, content] of [
      ['tsx', fixture],
      ['html', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`]
    ]) {
      const file = new URL(`${name}.${extension}`, root);
      files.push(file);
      await writeFile(file, content);
    }
    browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport:{width:1500,height:1100} });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API request: ${route.request().url()}`); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    const openStory = async (id, title) => {
      await page.getByRole('button', { name:`Open Story ${id}: ${title}`, exact:true }).click();
      await page.getByRole('heading', {name:'Story details',exact:true}).waitFor();
    };
    await openStory('ST-1','Checkout Story');
    await page.getByRole('tab', {name:/Linked defects/}).click();
    let panel = page.getByRole('region', {name:'Linked defects',exact:true});
    const unlink = () => panel.getByRole('button', {name:'Unlink Checkout payment fails',exact:true});
    await unlink().click();
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.getByRole('heading', {name:'Checkout payment fails',exact:true}).count(), 1,
      'Failed link save must keep the saved row and parent mapping');
    assert.deepEqual(await page.evaluate(() => window.savedDefectIds()), ['defect-a']);
    assert.deepEqual(await page.evaluate(() => window.defectWrites), []);

    await page.evaluate(() => { window.failDefectSave = false; });
    await unlink().click();
    await panel.getByText('No items are linked yet.', {exact:true}).waitFor();
    await page.waitForFunction(() => window.detailLoads.some(item => item.id === 'saved-story' && item.defect_ids.length === 0));
    assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.kind === 'update')), [],
      'Unlink submits relationship IDs without saving the Story authoring draft');

    await page.getByRole('button', {name:'Back to Story tiles',exact:true}).click();
    await openStory('ST-2','Recovery Story');
    await page.getByRole('button', {name:'Back to Story tiles',exact:true}).click();
    await openStory('ST-1','Checkout Story');
    await page.getByRole('tab', {name:/Linked defects/}).click();
    panel = page.getByRole('region', {name:'Linked defects',exact:true});
    await panel.getByText('No items are linked yet.', {exact:true}).waitFor();
    await page.getByRole('tab', {name:/^Details/}).click();
    const form = page.locator('form.story-detail-form');
    await form.locator('.story-acceptance-criteria-field textarea').fill('The checkout shows the saved payment status.');
    await form.getByRole('button', {name:'Save Story',exact:true}).click();
    await page.waitForFunction(() => window.defectWrites.length === 2);
    assert.deepEqual(await page.evaluate(() => window.defectWrites), [
      {id:'saved-story',ids:[]}, {id:'saved-story',ids:[]}
    ], 'Returning to a cached Story must not restore a previously removed Defect on Save Story');
    assert.deepEqual(await page.evaluate(() => window.savedDefectIds()), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(files.map(file => rm(file, {force:true})));
  }
});
