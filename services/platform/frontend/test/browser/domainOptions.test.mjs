// Real production case, bug and story forms; all API calls use isolated fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const frontend=new URL('../../',import.meta.url);

test('admin dropdown updates preserve actual form drafts, retired values, and free text',{timeout:120000},async()=>{
  // Reuse the maintained actual-page fixture, not a visual copy of the controls.
  const shell=await readFile(new URL('./workspaceShell.test.mjs',import.meta.url),'utf8');
  const expression=shell.slice(shell.indexOf('const fixture=')+'const fixture='.length,shell.indexOf('\nconst adminFixture='));
  let source=new Function('return '+expression)();
  source=source.replace('api.metadata.domain=async()=>({});',`const option=(value,label=value,active=true)=>({value,label,active,builtin:false});
api.issues.catalogPage=async()=>({items:[],next_cursor:null,is_last:true});api.issues.metrics=async()=>({total:0,open:0,priority_risks:0,unassigned:0,converted:0,statuses:{}});
const emptyStoryMetrics=Object.fromEntries('total mapped highPriority open completed qaTotal totalDefects completionPercent coveragePercent defectDensity groomed notGroomed described specified teamAssigned slipped onCourse sprintCommitted releaseScoped backlog'.split(' ').map(key=>[key,0]));api.requirements.metrics=async()=>({all:emptyStoryMetrics,backlog:emptyStoryMetrics,sprints:emptyStoryMetrics,sprint_health:[],filter_options:{statuses:[],labels:[],sprints:[],fix_versions:[],releases:[]},generated_at:'2026-09-16T00:00:00Z'});
api.issues.createMetadata=async()=>({core_fields:[],required_fields:[],workflow_statuses:{statuses:[option('connected_open','Connected workflow')]}});api.requirements.createMetadata=async()=>({core_fields:[],required_fields:[]});window.dropdownMetadata={test_cases:{default_status:'active',default_automated:'no',statuses:[option('active','Active'),option('draft','Draft'),option('ready','Ready'),option('retired','Retired')]},requirements:{default_status:'open',statuses:[option('open','Open')]},issues:{default_status:'open',statuses:[option('open','Open')]},dropdowns:{revision:1,fields:{
 'test_cases.types':{default_value:'contract',options:[option('contract','Contract behavior'),option('functional','Old functional',false),option('journey','Customer journey')]},
 'test_cases.labels':{options:[option('admin-case-label','Case coverage tag'),option('retired-label','Retired',false)]},
 'test_suites.labels':{options:[option('admin-suite-label','Suite coverage tag')]},
 'requirements.labels':{options:[option('admin-story-label','Story coverage tag')]},
 'requirements.scrum_teams':{options:[option('commerce-phoenix','Commerce Phoenix')]},
 'requirements.story_points':{options:[option('2','Two points'),option('8','Eight points')]},
 'issues.root_causes':{options:[option('Service contract gap'),option('Old cause','Old cause',false)]},
 'issues.qa_root_causes':{options:[option('Missing journey')]},
 'issues.bug_types':{options:[option('Contract compatibility')]},
 'issues.labels':{options:[option('admin-bug-label','Bug coverage tag')]}
}}};api.metadata.domain=async()=>structuredClone(window.dropdownMetadata);client.setQueryData(['domain-metadata'],window.dropdownMetadata);window.publishDropdowns=async()=>{window.dropdownMetadata.dropdowns.revision++;await client.invalidateQueries({queryKey:['domain-metadata']});};`);
  const name='domain-options-'+randomUUID(),entry=new URL(name+'.tsx',frontend),html=new URL(name+'.html',frontend);let browser;
  await writeFile(entry,source);await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);const errors=[];
    page.on('pageerror',error=>errors.push(error.stack));await page.route('**/api/**',route=>{errors.push('Unexpected API request '+new URL(route.request().url()).pathname);return route.abort();});
    const url=(process.env.VITE_TEST_URL||'http://127.0.0.1:5179')+'/'+name+'.html';
    await page.goto(url+'?route='+encodeURIComponent('/test-cases?case=case2'));
    const type=page.locator('select[aria-describedby="test-case-type-hint"]');await type.waitFor();assert.equal(await type.inputValue(),'functional');assert.equal(await type.locator('option:checked').textContent(),'Old functional');
    await page.getByRole('button',{name:'Back to test case tiles',exact:true}).click();await page.getByRole('button',{name:'Create Test Case',exact:true}).click();await type.waitFor();assert.equal(await type.inputValue(),'contract','new case uses configured default');
    const title=page.locator('.test-case-title-field input');await title.fill('Keep this unsaved case');
    await page.evaluate(async()=>{const field=window.dropdownMetadata.dropdowns.fields['test_cases.types'];field.default_value='journey';field.options[0].active=false;await window.publishDropdowns();});
    assert.equal(await type.inputValue(),'contract','retiring a selected type keeps the draft');assert.equal(await title.inputValue(),'Keep this unsaved case','metadata refresh cannot reset edited fields');assert.equal(await type.locator('option[value="functional"]').count(),0,'other retired types are omitted');
    await page.getByRole('button',{name:'Back to test case tiles',exact:true}).click();await page.getByRole('button',{name:'Create Test Case',exact:true}).click();assert.equal(await type.inputValue(),'journey','next draft receives the new default');
    const caseLabels=page.getByRole('combobox',{name:'Select or add labels'});await caseLabels.focus();await page.getByRole('option',{name:'Case coverage tag',exact:true}).click();await page.getByRole('button',{name:'Remove admin-case-label',exact:true}).waitFor();
    await page.getByRole('button',{name:'Back to test case tiles',exact:true}).click();await page.getByRole('button',{name:'Create Suite',exact:true}).click();
    const suiteDialog=page.getByRole('dialog',{name:'Create Suite',exact:true});await suiteDialog.waitFor();await suiteDialog.getByRole('combobox',{name:'Select or add suite labels'}).focus();await suiteDialog.getByRole('option',{name:'Suite coverage tag',exact:true}).waitFor();assert.equal(await suiteDialog.getByRole('option',{name:'Case coverage tag',exact:true}).count(),0,'suite uses its own configured suggestions');await page.keyboard.press('Escape');await suiteDialog.getByRole('button',{name:'Close create suite',exact:true}).click();await suiteDialog.waitFor({state:'hidden'});
    await page.evaluate(()=>window.fixtureNavigate('/issues'));
    await page.getByRole('button',{name:'Report Bug',exact:true}).click();
    const root=page.locator('.issue-root-cause-grid select').nth(0);await root.waitFor();await page.locator('.issue-report-form option[value=connected_open]').waitFor({state:'attached'});assert.deepEqual(await root.locator('option').allTextContents(),['Not determined','Service contract gap']);
    await page.locator('.issue-root-cause-grid select').nth(1).selectOption('Missing journey');await page.locator('.issue-form-section--classification select').nth(0).selectOption('Contract compatibility');
    const labels=page.getByRole('combobox',{name:'Select or add labels'});await labels.focus();await page.getByRole('option',{name:'Bug coverage tag',exact:true}).click();await page.getByRole('button',{name:'Remove label admin-bug-label',exact:true}).waitFor();await labels.fill('free-form-bug-label');await labels.press('Enter');await page.getByRole('button',{name:'Remove label free-form-bug-label',exact:true}).waitFor();
    await page.evaluate(()=>window.fixtureNavigate('/stories'));await page.getByRole('button',{name:'Create Story',exact:true}).first().click();
    const team=page.getByLabel('Scrum team',{exact:true});await team.waitFor();const list=await team.getAttribute('list');assert.deepEqual(await page.locator('datalist[id="'+list+'"] option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,label:node.label}))),[{value:'commerce-phoenix',label:'Commerce Phoenix'}]);await team.fill('commerce-phoenix');assert.equal(await team.inputValue(),'commerce-phoenix');await team.fill('An unlisted team');
    const points=page.getByLabel('Effort · Story points',{exact:true});assert.deepEqual(await points.locator('option').allTextContents(),['Not estimated','Two points','Eight points']);await points.selectOption('8');await page.getByRole('combobox',{name:'Select or add labels'}).focus();await page.getByRole('option',{name:'Story coverage tag',exact:true}).click();await page.getByRole('button',{name:'Remove label admin-story-label',exact:true}).waitFor();
    await page.setViewportSize({width:390,height:900});await points.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mkdir('/tmp/qaira-domain-options',{recursive:true});await page.screenshot({path:'/tmp/qaira-domain-options/story-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await Promise.allSettled([rm(entry,{force:true}),rm(html,{force:true})]);}
});
