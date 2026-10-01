import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('Defect reporter defaults, saved edits and named people filters work in the production UI', { timeout: 120000 }, async () => {
  const source = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('function matching(input){', `
const people = [session.user, {id:'alice',name:'Alice Developer',email:'alice@example.test'}, {id:'bob',name:'Bob Tester',email:'bob@example.test'}];
const names = item => ({...item,user_name:people.find(user=>user.id===item.user_id)?.name||'Former Reporter',assignee_name:people.find(user=>user.id===item.assignee_id)?.name});
bugs.splice(4);
bugs[0]=names({...bugs[0],user_id:'alice',assignee_id:'alice'});
bugs[1]=names({...bugs[1],user_id:'bob',assignee_id:'alice'});
bugs[2]=names({...bugs[2],user_id:'reviewer',assignee_id:'bob'});
bugs[3]=names({...bugs[3],user_id:'former',assignee_id:null});
window.writes=[];
window.memberLoads=0;
api.projectMembers.list=async()=>{window.memberLoads++;return people.map(user=>({user_id:user.id,user_name:user.name,user_email:user.email}));};
api.issues.createMetadata=async()=>({fields:[],core_fields:[],required_fields:[],workflow_statuses:{statuses,default_status:'open'}});
api.issues.create=async input=>{
  window.writes.push({kind:'create',input:structuredClone(input)});
  const row=names({...input,id:'created',display_id:'BUG-NEW',created_at:'2026-10-01T00:00:00Z'});
  bugs.unshift(row);return {id:row.id,display_id:row.display_id};
};
api.issues.update=async(id,input)=>{
  window.writes.push({kind:'update',id,input:structuredClone(input)});
  const index=bugs.findIndex(item=>item.id===id);bugs[index]=names({...bugs[index],...input});return {updated:true};
};
function matching(input){`);
  fixture = fixture.replace("&&(!input.status||item.status===input.status)", "&&(!input.user_id||item.user_id===input.user_id)&&(!input.status||item.status===input.status)");
  const name = `defect-people-${randomUUID()}`;
  const files = [new URL(`${name}.tsx`, root), new URL(`${name}.html`, root)];
  let browser;
  try {
    await writeFile(files[0], fixture);
    await writeFile(files[1], `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir('/tmp/qaira-defect-people', {recursive:true});
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/api/**', route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5294'}/${name}.html`, {timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===4&&window.memberLoads===1);
    await page.getByRole('button',{name:'Open filters',exact:true}).click();
    const assignee=page.getByLabel('Assignee',{exact:true});
    const reporter=page.getByLabel('Reported by',{exact:true});
    await assignee.waitFor();
    assert.deepEqual(await assignee.locator('option').allTextContents(),['All assignees','Unassigned','Alice Developer','Bob Tester','QA Reviewer']);
    assert.deepEqual(await reporter.locator('option').allTextContents(),['All reporters','Alice Developer','Bob Tester','QA Reviewer']);
    await assignee.selectOption('alice');
    await page.waitForFunction(()=>window.calls.metrics.at(-1).assignee_id==='alice'&&document.querySelectorAll('.issue-catalog-card').length===2);
    await reporter.selectOption('alice');
    await page.waitForFunction(()=>window.calls.metrics.at(-1).user_id==='alice'&&document.querySelectorAll('.issue-catalog-card').length===1);
    assert.equal(await page.locator('.issue-catalog-card').getAttribute('aria-label'),'Open Defect BUG-1: Checkout bug 01');
    assert.equal(await page.evaluate(()=>window.calls.catalog.at(-1).user_id),'alice');
    await page.screenshot({path:'/tmp/qaira-defect-people/filters.png'});
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===4);
    assert.equal(await reporter.inputValue(),'');
    assert.equal(await assignee.inputValue(),'');
    await page.keyboard.press('Escape');

    await page.getByRole('button',{name:'Report Defect',exact:true}).click();
    const form=page.locator('form.issue-report-form');
    const formReporter=form.getByRole('combobox',{name:'Reported by',exact:true});
    await formReporter.waitFor();
    assert.equal(await formReporter.inputValue(),'reviewer','New reports default to the creator');
    assert.equal(await formReporter.locator('option[value="reviewer"]').count(),1,'Current user is not duplicated');
    await formReporter.scrollIntoViewIfNeeded();
    const sprint=await form.getByLabel('Sprint',{exact:true}).boundingBox();
    const release=await form.getByLabel('Release / Fix version',{exact:true}).boundingBox();
    const person=await formReporter.boundingBox();
    assert.ok(Math.abs(sprint.y-person.y)<2&&Math.abs(release.y-person.y)<2,'Sprint, release and reporter share one row');
    await page.screenshot({path:'/tmp/qaira-defect-people/create.png'});
    await formReporter.selectOption('alice');
    await form.getByRole('textbox',{name:'Defect Title',exact:true}).fill('Notifications panel keeps stale counter');
    await form.locator('[contenteditable="true"]').first().fill('The notifications counter remains unchanged after reading the alert.');
    await form.getByRole('button',{name:'Create',exact:true}).click();
    await page.waitForFunction(()=>window.writes.some(write=>write.kind==='create'));
    assert.equal(await page.evaluate(()=>window.writes[0].input.user_id),'alice');
    await page.waitForFunction(()=>window.fixtureRoute().includes('issue=created'));
    await page.waitForFunction(()=>document.querySelector('.issue-detail-form select[aria-label="Reported by"]')?.value==='alice');
    await formReporter.selectOption('bob');
    await form.getByRole('button',{name:'Update Defect',exact:true}).click();
    await page.waitForFunction(()=>window.writes.some(write=>write.kind==='update'));
    assert.equal(await page.evaluate(()=>window.writes.at(-1).input.user_id),'bob');
    await page.getByRole('button',{name:'Back to defect tiles',exact:true}).click();
    await page.getByRole('article',{name:'Open Defect BUG-NEW: Notifications panel keeps stale counter',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.issue-detail-form select[aria-label="Reported by"]')?.value==='bob');
    await formReporter.scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/qaira-defect-people/details.png'});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await formReporter.scrollIntoViewIfNeeded();
    assert.equal(await formReporter.evaluate(element=>element.getBoundingClientRect().right<=window.innerWidth),true);
    await page.screenshot({path:'/tmp/qaira-defect-people/mobile-dark.png'});

    await page.evaluate(()=>window.fixtureNavigate('/issues?issue=bug-4'));
    await page.waitForFunction(()=>document.querySelector('.issue-detail-form select[aria-label="Reported by"]')?.value==='former');
    assert.equal(await formReporter.locator('option:checked').textContent(),'Former Reporter','Existing reporters stay visible after leaving the project');
    await page.evaluate(()=>window.fixtureNavigate('/issues?create=1'));
    await page.waitForFunction(()=>document.querySelector('.issue-report-form select[aria-label="Reported by"]')?.value==='reviewer');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all(files.map(file=>rm(file,{force:true})));
  }
});
