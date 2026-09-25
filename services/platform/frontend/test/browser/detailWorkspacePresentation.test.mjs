import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const artifacts = '/tmp/qaira-detail-workspace';
async function fixtureFrom(file, route) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = "import '/src/platform/components/workspace-surfaces.css';import '/src/platform/components/workspace-shell.css';import '/src/dark-theme.css';\n" + fixture;
  fixture = fixture.replace(/<main style=\{\{height:'100vh',[^}]+\}\}>/, `<div className='app-shell app-layout app-layout--workspace-wide workspace-experience-v2'><aside className='sidebar'>Navigation</aside><main className='workspace-main main main--library-fill' data-route='${route}'><header className='workspace-context-bar'><div className='workspace-header-leading'><strong>Project / ${route.slice(1)}</strong></div></header>`)
    .replace('</main></LocalizationProvider>', '</main></div></LocalizationProvider>');
  return fixture;
}
async function withFixture(fixture, check) {
  const name = 'detail-workspace-' + randomUUID(); let browser;
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    await check(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
}
async function assertCompactTabs(page, selector, desktop) {
  const geometry = await page.locator(selector).evaluate(element => {
    const tabs = [...element.querySelectorAll('[role="tab"]')];
    return { rowHeight: element.clientHeight, width: element.clientWidth, scrollWidth: element.scrollWidth,
      tabs: tabs.map(tab => { const box = tab.getBoundingClientRect(); const icon = tab.querySelector('.detail-section-tab-icon').getBoundingClientRect(); const label = tab.querySelector('strong').getBoundingClientRect();return { y: box.y, height: box.height, inline: Math.abs(icon.y + icon.height/2 - label.y - label.height/2) < 3 }; }),
      color: getComputedStyle(element.querySelector('[aria-selected="true"]')).color,
      expectedColor: getComputedStyle(element).getPropertyValue('--ws2-green').trim()
    };
  });
  assert.ok(geometry.rowHeight <= 55, 'tabs stay compact');
  assert.equal(new Set(geometry.tabs.map(tab => Math.round(tab.y))).size, 1, 'all tabs stay on one row');
  assert.ok(geometry.tabs.every(tab => tab.height <= 48 && tab.inline), 'icon and label are inline');
  if (desktop) assert.ok(geometry.scrollWidth <= geometry.width + 1, 'desktop tabs fit available width: '+JSON.stringify(geometry));
  const activeColor = await page.locator(selector).evaluate(element => { const probe=document.createElement('span');probe.style.color='var(--ws2-green)';element.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color; });
  assert.equal(geometry.color, activeColor, 'selected tab uses the current application accent');
}

test('Test Case detail fills the viewport and reaches the end of long steps in light/dark desktop/mobile', { timeout: 90000 }, async () => {
  let fixture = await fixtureFrom('../../../../testing/test/browser/testCaseDataSets.test.mjs', '/test-cases');
  fixture = fixture.replace('api.testCases.listPage=', "steps.push(...Array.from({length:30},(_,index)=>({id:'long-'+index,test_case_id:'case1',step_order:index+3,action:'Validation step '+(index+3),expected_result:'Expected outcome '+(index+3),step_type:'web',automation_code:'',api_request:null})));item.step_count=steps.length;api.testCases.listPage=");
  await withFixture(fixture, async page => {
    await page.locator('.test-case-title-field input').waitFor();
    const stepsSection = page.locator('.editor-accordion-section').filter({ has: page.locator('.editor-accordion-toggle-copy>strong', { hasText: 'Test steps' }) });
    if (await stepsSection.locator('.editor-accordion-toggle').getAttribute('aria-expanded') === 'false') await stepsSection.locator('.editor-accordion-toggle').click();
    for (const theme of ['light','dark']) for (const width of [1440,390]) {
      const height=width===390?844:900;
      await page.setViewportSize({ width, height });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.waitForTimeout(300);
      await assertCompactTabs(page, '.test-case-detail-navigation', width===1440);
      const geometry = await page.evaluate(() => {
        const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {y:r.y,bottom:r.bottom,height:r.height,width:r.width}};
        return { shell:box('.test-case-workspace-shell'),scroll:box('.test-case-detail-grid'),footer:box('.test-case-detail-footer'),bodyWidth:document.documentElement.scrollWidth };
      });
      assert.ok(geometry.shell.bottom >= height-2 && geometry.shell.bottom <= height+1, 'case panel reaches viewport bottom');
      assert.ok(geometry.scroll.height > height*.5, 'editor uses most of the viewport instead of stopping halfway');
      assert.ok(geometry.footer.bottom <= height+1, 'save footer remains visible');
      assert.ok(geometry.bodyWidth<=width+1, 'no page horizontal overflow');
      const last=page.getByRole('button',{name:'Show step 32 details',exact:true});
      await last.scrollIntoViewIfNeeded();
      const lastBox=await last.boundingBox();
      assert.ok(lastBox.y>=geometry.scroll.y && lastBox.y+lastBox.height<=geometry.scroll.bottom+1, 'last persisted step can be reached');
      await page.locator('.test-case-detail-grid').evaluate(element=>element.scrollTop=element.scrollHeight);
      assert.equal(await page.locator('.test-case-detail-grid').evaluate(element=>Math.abs(element.scrollHeight-element.clientHeight-element.scrollTop)<2),true,'editor reaches the end');
      await page.screenshot({path:`${artifacts}/case-${theme}-${width}-end.png`});
      await page.locator('.test-case-detail-grid').evaluate(element=>element.scrollTop=0);
      await page.screenshot({path:`${artifacts}/case-${theme}-${width}.png`});
    }
    await page.getByRole('tab',{name:/^History/}).click();
    await page.getByRole('tab',{name:/^Details/}).click();
    await page.locator('.test-case-title-field input').fill('Updated viewport case');
    await page.locator('.test-case-detail-footer').getByRole('button',{name:'Save test case',exact:true}).click();
    await page.waitForFunction(()=>window.updates.some(input=>input.title==='Updated viewport case'));
  });
});

test('Story details have one-row themed tabs and Save Story in the bottom-right form footer', { timeout: 90000 }, async () => {
  let fixture=await fixtureFrom('../../../../manual/test/browser/storyPlanningAssignments.test.mjs','/stories');
  fixture=fixture.replace('let story=null;', "let story={id:'saved-story',display_id:'ST-1',project_id:'project',title:'Checkout story',description:'Save delivery preferences.',status:'open',priority:2,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],related_items:[],revision:1,iteration_id:'native-sprint',sprint:'Sprint Alpha'};");
  fixture=fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
  await withFixture(fixture,async page=>{
    await page.getByRole('button',{name:'Open Story ST-1: Checkout story',exact:true}).click();
    await page.locator('.story-detail-form').waitFor();
    for(const theme of ['light','dark'])for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(300);
      await page.locator('.story-detail-navigation').scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/story-${theme}-${width}-top.png`});await assertCompactTabs(page,'.story-detail-navigation',width===1440);
      const formatTheme=await page.locator('.story-specification-tabs').evaluate(element=>({background:getComputedStyle(element).backgroundColor,inactiveText:getComputedStyle(element.querySelector('[aria-selected="false"] strong')).color}));if(theme==='dark'){assert.notEqual(formatTheme.background,'rgb(255, 255, 255)','format selector uses a dark surface');assert.notEqual(formatTheme.inactiveText,formatTheme.background,'inactive format label remains readable');}const footer=page.locator('footer.story-detail-footer[aria-label="Story actions"]');await footer.scrollIntoViewIfNeeded();
      const position=await footer.evaluate(element=>{const box=element.getBoundingClientRect();const button=element.querySelector('button').getBoundingClientRect();return {right:box.right-button.right,children:[...element.closest('form').children].at(-1)===element,afterSpecification:box.y>=element.closest('form').querySelector('.story-specification-editor').getBoundingClientRect().bottom}});
      assert.ok(Math.abs(position.right)<2,'Save Story aligns with footer right edge');assert.equal(position.children,true,'footer is last in the form');assert.equal(position.afterSpecification,true,'Save Story is visually below the complete acceptance specification');
      await page.screenshot({path:`${artifacts}/story-${theme}-${width}-footer.png`});
      await page.getByRole('tab',{name:/^Related items/}).click();await page.locator('.related-work-hero').scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/story-${theme}-${width}-related.png`});await page.getByRole('tab',{name:/^Details/}).click();
    }
    const form=page.locator('.story-detail-form');await form.locator('.story-detail-title-field input').fill('Updated checkout story');
    await form.getByRole('button',{name:'Save Story',exact:true}).click();await page.waitForFunction(()=>window.calls.some(call=>call.kind==='update'&&call.input.title==='Updated checkout story'));
  });
});
