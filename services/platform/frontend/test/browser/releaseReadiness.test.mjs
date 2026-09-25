import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { expect } = require(`${process.env.PLAYWRIGHT_MODULE || "playwright"}/test`);
const root = new URL("../../", import.meta.url);
const fixture = await readFile(
  new URL("./fixtures/releaseReadiness.fixture.tsx", import.meta.url),
  "utf8",
);
const screenshotRoot = "/tmp/qaira-readiness-design";
async function withPage(run) {
  const name = `readiness-check-${randomUUID()}`;
  const html = new URL(`${name}.html`, root),
    tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(
      html,
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`,
    );
    await writeFile(tsx, fixture);
    await mkdir(screenshotRoot, { recursive: true });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
    const base = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5179"}/${name}.html`;
    await run(page, base);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
}
const evidence = (page) => page.locator(".rr-layout-drilldown");

async function openEvidence(page) {
  await page.locator(".rr-layout-hero").waitFor();
  if (!(await evidence(page).count())) {
    await page.locator(".rr-layout-recommendation").click();
  }
  await evidence(page).waitFor();
}

async function ready(page) {
  await expect(page.locator(".rr-layout-hero .rr-badge")).toContainText("At risk");
  await openEvidence(page);
}

async function openSources(page) {
  const details = page.locator(".rr-layout-source-details");
  if (!(await details.evaluate((node) => node.open))) {
    await page.getByRole("button", {name: "Review scope, permissions, and source notices", exact: true}).click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function inspectGate(page, name) {
  await page.locator(".rr-layout-tabs").getByRole("tab", {name: /Decision brief/}).click();
  const gate = page.locator(".rr-layout-gate").filter({has: page.locator("summary strong").getByText(name, {exact: true})});
  if (!(await gate.evaluate((node) => node.open))) await gate.locator("summary").click();
  await gate.getByRole("button", {name: "Inspect gate evidence", exact: true}).click();
}

const metricValues = (page) => page.locator(".rr-layout-tile-head").allTextContents();

test('Release selection clears stale Sprint restrictions; standalone Sprint selection preserves native scope', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=native&iteration_id=obsolete&sprint=Old`);
  await ready(page);
  await page.waitForFunction(()=>window.readinessCalls.some(call=>call.kind==='runs' && call.input.release_id==='native-release'));
  assert.equal(await page.getByLabel('Sprint',{exact:true}).inputValue(),'');
  assert.equal(new URL(page.url()).searchParams.get('iteration_id'),null);
  const initial=await downloadEvidence(page);
  assert.equal(initial.stories.length,3,'shared Stories retain membership despite their text stamp naming another Release');
  assert.equal(initial.metrics.passing_outcomes.failed,1,'the native run remains evidence after its labels were renamed');
  await page.getByLabel('Sprint',{exact:true}).selectOption({label:'Sprint 24'});
  await page.waitForFunction(()=>window.readinessCalls.some(call=>call.kind==='runs' && !call.input.release_id && call.input.iteration_id==='native-sprint'));
  assert.equal(new URL(page.url()).searchParams.get('release_id'),null);
  assert.equal(new URL(page.url()).searchParams.get('iteration_id'),'native-sprint');
  const scoped=await downloadEvidence(page);
  assert.equal(scoped.stories.length,3,'Sprint association uses native IDs after a rename');
  await page.reload();
  await page.waitForFunction(()=>window.readinessCalls.some(call=>call.kind==='runs' && !call.input.release_id && call.input.iteration_id==='native-sprint'));
}));

test("release evidence preserves outcomes, scopes requests and discards stale AI responses after scope changes", {timeout: 60000}, async () => withPage(async (page, base) => {
  await page.goto(base);
  await ready(page);
  assert.equal(await page.getByRole("link", {name: "Review defect: Payment is captured twice after retry"}).getAttribute("href"), "/issues?issue=bug1&project_id=project");
  assert.match(await page.locator(".rr-actions").innerText(), /1 failed · 1 paused/);
  assert.ok((await page.evaluate(() => window.readinessCalls)).every(call => call.input.project_id === "project"));
  const review = evidence(page).getByRole("tab", {name: /Decision brief/});
  await review.focus();
  await review.press("ArrowRight");
  await expect(evidence(page).getByRole("tab", {name: /Traceability/})).toHaveAttribute("aria-selected", "true");
  assert.match(await page.locator(".rr-story-row").first().innerText(), /1 failed/);
  await evidence(page).getByRole("tab", {name: /Traceability/}).press("End");
  await expect(evidence(page).getByRole("tab", {name: /Defects/})).toHaveAttribute("aria-selected", "true");
  await evidence(page).getByRole("tab", {name: /Execution evidence/}).click();
  assert.match(await page.locator(".rr-run").first().innerText(), /2 passed.*1 failed.*1 not assessed/s);
  assert.match(await page.locator(".rr-run").first().innerText(), /Saved staging.*Saved Chromium 128/s);
  assert.match(await page.locator(".rr-run").last().innerText(), /Archived staging.*Archived Firefox.*1 not assessed/s);
  await evidence(page).getByRole("tab", {name: /Execution evidence/}).press("Home");
  await expect(review).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", {name: "Open evidence brief", exact: true}).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /AI scope: Autumn 2026 · all sprints/);
  await page.getByRole("dialog").getByRole("button", {name: /Close/}).first().click();
  await page.getByLabel("Release / fix version", {exact: true}).selectOption("");
  await page.getByLabel("Sprint", {exact: true}).selectOption("Sprint 24");
  await page.waitForFunction(() => window.readinessCalls.some(call => call.kind === "runs" && !call.input.release && call.input.sprint === "Sprint 24"));
  await page.evaluate(() => window.finishReadinessAi());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.setReadinessPreferences({language: "es", locale: "es-ES", timeZone: "UTC", hourCycle: "h23"}));
  await page.getByRole("heading", {name: "Preparación del lanzamiento", exact: true}).waitFor();
}));

test(
  "release review loads more evidence and recovers without discarding cached records",
  { timeout: 60000 },
  async () =>
    withPage(async (page, base) => {
      await page.goto(`${base}?scenario=partial`);
      await ready(page);
      await expect(page.locator('.rr-layout-hero .rr-badge')).toContainText(/provisional/i);
      await openSources(page);
      // Opening source details can already bring the sentinel into view. In
      // that case it disappears after loading; verify the result and exact
      // next-page request below instead of waiting for a removed sentinel.
      await page.evaluate(() => document.querySelector('.rr-boundary .hierarchy-auto-load-sentinel')?.scrollIntoView({block:'center'}));
      await page
        .locator(".rr-layout-hero").getByText("Loaded sources complete", { exact: false })
        .waitFor();
      assert.equal(
        (
          await page.evaluate(() =>
            window.readinessCalls.filter(
              (call) => call.kind === "stories" && call.input.cursor === "next",
            ),
          )
        ).length,
        1,
      );
      await page.evaluate(() => (window.readinessFailBugs = true));
      await page
        .getByRole("button", { name: "Refresh evidence", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Some sources could not be refreshed" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", {
            name: "Review defect: Payment is captured twice after retry",
          })
          .count(),
        1,
      );
      await page.screenshot({
        path: `${screenshotRoot}/readiness-refresh-error.png`,
        fullPage: true,
      });
      await page.evaluate(() => (window.readinessFailBugs = false));
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("alert").waitFor({ state: "hidden" });
      await page.evaluate(() => (window.readinessDenyBugs = true));
      await page
        .getByRole("button", { name: "Refresh evidence", exact: true })
        .click();
      await page.waitForFunction(
        () => {
          const actions = document.querySelector(".rr-actions");
          return actions && !actions.textContent.includes("Payment is captured twice");
        },
      );
      assert.match(
        await page.locator(".rr-layout-tile").last().textContent(),
        /—.*Unavailable/s,
      );
      await page.screenshot({
        path: `${screenshotRoot}/readiness-restricted.png`,
        fullPage: true,
      });
    }),
);
test(
  "empty scopes and a cross-project release link terminate in useful states",
  { timeout: 60000 },
  async () =>
    withPage(async (page, base) => {
      await page.goto(`${base}?scenario=empty`);
      await openEvidence(page);
      assert.equal(
        await page.locator(".rr-layout-tile-head").filter({ hasText: "—" }).count(),
        2,
      );
      await page.screenshot({
        path: `${screenshotRoot}/readiness-empty.png`,
        fullPage: true,
      });
      await page.goto(`${base}?scenario=linked`);
      await ready(page);
      await evidence(page).getByRole("tab",{name:/Traceability/}).click();
      await expect(page.locator(".rr-story-row")).toHaveCount(1);
      assert.match(await page.locator(".rr-story-row").innerText(),/CP-143/);
      assert.equal((await page.evaluate(()=>window.readinessCalls.filter(call=>call.kind==='stories'))).length,0);
      await page.getByLabel("Release / fix version", {exact: true}).selectOption("");
      await page.waitForURL(url => !url.searchParams.has("release_id"));
      await page.waitForFunction(() => window.readinessCalls.some(call => call.kind === "stories"));
      await page.goto(`${base}?scenario=wrong`);
      await page
        .getByRole("heading", {
          name: "This release could not be loaded in the current project.",
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.readinessCalls)).length,
        0,
      );
      await page.screenshot({
        path: `${screenshotRoot}/readiness-unavailable-release.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Change scope", exact: true })
        .first()
        .click();
      await ready(page);
      await page.goto(`${base}?scenario=restricted`);
      await ready(page);
      assert.equal(
        (
          await page.evaluate(() =>
            window.readinessCalls.filter((call) => call.kind === "bugs"),
          )
        ).length,
        0,
      );
    }),
);

test('revoking a source permission clears cached evidence and a pending AI explanation immediately', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(base);await ready(page);
  await page.getByRole('button',{name:'Open evidence brief',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>window.revokeReadinessBugs());await page.getByRole('dialog').waitFor({state:'hidden'});
  await ready(page);
  await expect(page.getByRole('button',{name:'Open evidence brief',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Open AI evidence brief',exact:true})).toBeDisabled();
  assert.equal((await page.evaluate(() => window.readinessCalls.filter(call => call.kind === 'ai'))).length, 1);
  await expect(page.getByRole('link',{name:'Review defect: Payment is captured twice after retry'})).toHaveCount(0);
  assert.match(await page.locator('.rr-layout-tile').last().textContent(),/—.*Unavailable/s);
  await page.evaluate(()=>window.finishReadinessAi());await expect(page.getByRole('dialog')).toHaveCount(0);
}));

async function downloadEvidence(page) {
  await openSources(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export evidence',exact:true}).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^release-evidence-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('readiness search, check drilldowns, exact Story relationships and exports retain the applied evidence scope', {timeout:90000}, async()=>withPage(async(page,base)=>{
  await page.goto(base);
  await ready(page);
  const metrics = await metricValues(page);
  const search = page.getByRole('searchbox',{name:'Search evidence',exact:true});
  const filter = page.getByRole('combobox',{name:'Filter evidence',exact:true});
  const toolbar=await page.locator('.rr-evidence-toolbar').evaluate(node=>{
    const search=node.querySelector('.rr-search').getBoundingClientRect(),filter=node.querySelector('select').getBoundingClientRect();
    return {search:search.toJSON(),filter:filter.toJSON()};
  });
  assert.ok(Math.abs(toolbar.search.top-toolbar.filter.top)<2,'desktop search and filter share the same row');
  assert.ok(toolbar.search.width>200&&toolbar.filter.width>100,'both inline controls remain usable');
  assert.match(await page.locator('.rr-actions > li').first().innerText(),/Payment is captured twice/,'known critical evidence leads the action queue');

  await search.fill('duplicate charge');
  await expect(page.locator('.rr-actions > li')).toHaveCount(1);
  assert.match(await page.locator('.rr-actions').innerText(),/Recover abandoned payments/);
  await filter.selectOption('bugs');
  await page.getByRole('heading',{name:'No matching evidence',exact:true}).waitFor();
  assert.deepEqual(await metricValues(page),metrics,'local filters never change scope denominators');
  const exportWithNoLocalMatches = await downloadEvidence(page);
  assert.deepEqual(exportWithNoLocalMatches.scope,{project_id:'project',release_id:null,release:'Autumn 2026',sprint:null});
  assert.equal(exportWithNoLocalMatches.stories.length,3,'export includes the applied scope, not local search matches');
  assert.equal(exportWithNoLocalMatches.runs.length,2);
  assert.equal(exportWithNoLocalMatches.checks.length,6);
  assert.equal(exportWithNoLocalMatches.metrics.passing_outcomes.percent,67,'separate failed and passed data rows remain distinct');
  assert.deepEqual(exportWithNoLocalMatches.runs.find(run=>run.id==='r1').outcomes.map(row=>row.id),['res1','res2','res3','res4']);
  assert.equal(exportWithNoLocalMatches.runs.find(run=>run.id==='r2').unassessed,1,'planned missing results remain visible');
  assert.equal(exportWithNoLocalMatches.runs[0].environment,'Saved staging');
  assert.deepEqual(exportWithNoLocalMatches.source_limits,{page_size:100,maximum_pages:10,run_limit:10,result_attempt_limit:300});
  assert.ok(exportWithNoLocalMatches.sources.every(source=>source.available&&source.status==='complete'));
  assert.equal(exportWithNoLocalMatches.assessment.provisional,false);
  assert.ok(exportWithNoLocalMatches.readiness_index, 'export includes the transparent advisory index');
  assert.ok(Array.isArray(exportWithNoLocalMatches.readiness_index.components));
  assert.equal(exportWithNoLocalMatches.readiness_index.components.length, 4);
  assert.doesNotMatch(JSON.stringify(exportWithNoLocalMatches),/SENSITIVE_FIXTURE_MARKER|"snapshot"|"readinessScore"|"confidence"/);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();

  await evidence(page).getByRole('tab',{name:/Traceability/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Traceability/})).toHaveAttribute('aria-selected','true');
  await search.fill('CP-142');
  await expect(page.locator('.rr-story-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Inspect evidence: Customers can securely complete checkout',exact:true}).click();
  const inspector = page.locator('.rr-story-inspector');
  await inspector.locator('summary').filter({hasText:'Linked tests'}).click();
  await inspector.locator('summary').filter({hasText:'Execution evidence'}).click();
  await inspector.locator('summary').filter({hasText:'Open Defects'}).click();
  assert.deepEqual(await inspector.locator('a[href^="/test-cases"]').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),['/test-cases?case=c1&project_id=project','/test-cases?case=c2&project_id=project']);
  assert.deepEqual(await inspector.locator('a[href^="/executions"]').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),['/executions?execution=r1&project_id=project','/executions?execution=r2&project_id=project']);
  assert.equal(await inspector.getByRole('link',{name:/Payment is captured twice/}).getAttribute('href'),'/issues?issue=bug1&project_id=project');
  await page.screenshot({path:`${screenshotRoot}/readiness-story-inspector.png`,fullPage:true});
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.getByRole('button',{name:'Inspect evidence: Customers can securely complete checkout',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.classList.contains('rr-story-inspector'));
    const bounds=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,inspector:document.querySelector('.rr-story-inspector').getBoundingClientRect().toJSON()}));
    assert.ok(bounds.document<=width+1&&bounds.inspector.right<=width+1,'Story inspector stays within the mobile page');
    assert.ok(bounds.inspector.top>=0&&bounds.inspector.top<800,'mobile inspection moves the selected evidence into view');
    if(width===390)await page.screenshot({path:`${screenshotRoot}/readiness-story-inspector-mobile.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1200});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:`${screenshotRoot}/readiness-story-inspector-dark.png`,fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.rr-evidence-toolbar select')).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.rr-search input')).backgroundColor==='rgba(0, 0, 0, 0)');

  const gateNames = {'Failed test outcomes': 'Latest-result pass rate', 'Priority Story coverage': 'Priority story coverage', 'Cases awaiting assessment': 'Execution completion'};
  const drills=[
    ['Critical defect exposure','Defects','critical','.rr-record-explorer--bugs tbody > tr',1],
    ['Failed test outcomes','Execution evidence','failed','.rr-run',1],
    ['Priority Story coverage','Traceability','priority','.rr-story-row',1],
    ['Cases awaiting assessment','Test cases','unassessed','.rr-record-explorer--cases tbody > tr',1],
    ['Blocked test evidence','Execution evidence','blocked','.rr-run',1],
    ['Evidence freshness','Execution evidence','all','.rr-run',2],
  ];
  for(const [check,tab,value,selector,count] of drills){
    await inspectGate(page, gateNames[check] || check);
    await expect(evidence(page).getByRole('tab',{name:new RegExp(tab)})).toHaveAttribute("aria-selected", "true");
    await expect(filter).toHaveValue(value);
    await expect(search).toHaveValue('');
    assert.equal(await page.locator(selector).count(),count,check+' opens the relevant evidence');
    if(value==='priority')assert.match(await page.locator('.rr-story-inspector h3').innerText(),/Recover abandoned payments/,'a check never leaves a hidden, unrelated Story in the inspector');
    assert.match(await page.locator('.rr-check-detail').innerText(),new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.deepEqual(await metricValues(page),metrics);
  }
  await search.fill('Archived Firefox');
  await expect(page.locator('.rr-run')).toHaveCount(1);
  assert.match(await page.locator('.rr-run').innerText(),/Planned Firefox confirmation/);
  await page.evaluate(()=>window.revokeReadinessBugs());
  await ready(page);
  await expect(page.locator('.rr-layout-tile').last()).toContainText('Unavailable');
  const restrictedExport=await downloadEvidence(page);
  assert.equal(restrictedExport.assessment.provisional,true);
  assert.equal(restrictedExport.metrics.open_defects,null);
  assert.deepEqual(restrictedExport.open_defects,[]);
  assert.ok(restrictedExport.stories.every(story=>story.open_defect_ids.length===0));
  assert.equal(restrictedExport.sources.find(source=>source.source==='bugs').status,'unavailable');
  const restrictedGate = page.locator('.rr-layout-gate').filter({hasText:'Critical defect exposure'});
  await restrictedGate.locator('summary').click();
  assert.equal(await restrictedGate.getByRole('button',{name:'Inspect gate evidence',exact:true}).isDisabled(),true);
}));

test('readiness treats policy refresh errors, unknown freshness and missing release permission as incomplete evidence', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=release-denied`);
  await page.getByRole('heading',{name:'This release could not be loaded in the current project.',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.readinessContextCalls),[],'a known missing release grant does not send an unauthorized context request');
  assert.deepEqual(await page.evaluate(()=>window.readinessCalls),[],'unverified context cannot fetch a wider project scope');
  await page.getByRole('button',{name:'Change scope',exact:true}).first().click();
  await ready(page);

  await page.goto(`${base}?scenario=empty`);
  await openEvidence(page);
  const unknownFreshness = page.locator('.rr-layout-gate').filter({hasText:'Evidence freshness'});
  assert.equal(await unknownFreshness.locator('.rr-layout-gate-stat').innerText(),'—');
  assert.equal((await downloadEvidence(page)).checks.find(check=>check.id==='evidence-freshness').count,null);

  await page.goto(base);
  await page.locator('.rr-layout-hero').getByText('Loaded sources complete',{exact:false}).waitFor();
  await openSources(page);
  await page.evaluate(()=>window.readinessFailFlags=true);
  await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Some sources could not be refreshed'}).waitFor();
  await expect(page.locator('.rr-layout-hero .rr-badge')).toContainText(/provisional/i);
  await expect(page.locator('.rr-layout-hero').getByText('Loaded sources complete',{exact:false})).toHaveCount(0);
  const uncertain=await downloadEvidence(page);
  assert.equal(uncertain.assessment.provisional,true);
  assert.ok(uncertain.checks.every(check=>check.state!=='pass'),'cached source rows cannot clear checks after policy refresh fails');
  assert.equal(uncertain.stories.length,3,'a failed refresh preserves available evidence');
  await page.evaluate(()=>window.readinessFailFlags=false);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.locator('.rr-layout-hero').getByText('Loaded sources complete',{exact:false}).waitFor();
}));


test('case explorer retains run-only and missing-detail IDs without collapsing conflicting outcome rows', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=explorers`);
  await ready(page);
  await evidence(page).getByRole('tab',{name:/Test cases/}).click();
  const explorer=page.locator('.rr-record-explorer--cases');
  const primaryRows=explorer.locator('tbody > tr:not(.rr-record-detail-row)');
  await expect(primaryRows).toHaveCount(11);
  for(const id of ['c-missing','c-run-only','c-planned-only']){
    const row=primaryRows.filter({has:page.locator(`a[href="/test-cases?case=${id}&project_id=project"]`)});
    await expect(row).toHaveCount(1);
    assert.match(await row.innerText(),/Case details are outside the loaded evidence/);
  }
  const mixed=primaryRows.filter({has:page.getByRole('link',{name:'Card payment succeeds',exact:true})});
  await expect(mixed).toHaveCount(1);
  assert.match(await mixed.innerText(),/Failed outcomes.*1 passed.*1 failed/s);
  await mixed.getByRole('button',{name:'Inspect evidence for Card payment succeeds',exact:true}).click();
  const details=page.getByRole('region',{name:'Evidence for Card payment succeeds',exact:true});
  await expect(details.locator('.rr-case-result-list > li')).toHaveCount(2);
  assert.match(await details.innerText(),/card-a.*res1.*failed.*card-b.*res2.*passed/si);
  assert.equal(await details.getByRole('link',{name:'Release candidate · Chrome and Safari',exact:true}).last().getAttribute('href'),'/executions?execution=r1&project_id=project');

  const filter=page.getByRole('combobox',{name:'Filter evidence',exact:true});
  await filter.selectOption('unassessed');
  await expect(explorer.getByRole('link',{name:'c-planned-only',exact:true})).toHaveCount(1);
  await expect(explorer.getByRole('link',{name:'c-missing',exact:true})).toHaveCount(1);
  await expect(explorer.getByRole('link',{name:'c-run-only',exact:true})).toHaveCount(0);
  await filter.selectOption('failed');
  await expect(primaryRows).toHaveCount(2);
  await expect(explorer.getByRole('link',{name:'c-run-only',exact:true})).toHaveCount(1);
  await filter.selectOption('passed');
  await expect(explorer.getByRole('link',{name:'Card payment succeeds',exact:true})).toHaveCount(0);
  await filter.selectOption('all');
  await explorer.getByRole('button',{name:'Inspect evidence for Card payment succeeds',exact:true}).click();
  await page.locator('.rr-evidence').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:`${screenshotRoot}/readiness-case-explorer.png`,fullPage:false});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.rr-evidence-toolbar select')).backgroundColor==='rgb(24, 34, 49)');
  await page.screenshot({path:`${screenshotRoot}/readiness-case-explorer-dark.png`,fullPage:false});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.rr-evidence-toolbar select')).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.rr-search input')).backgroundColor==='rgba(0, 0, 0, 0)');
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:1100});
    await page.waitForFunction(()=>{
      const selected=document.querySelector('.rr-layout-drilldown [role=tab][aria-selected=true]').getBoundingClientRect();
      const strip=document.querySelector('.rr-layout-drilldown [role=tablist]').getBoundingClientRect();
      return selected.left>=strip.left-1&&selected.right<=strip.right+1;
    });
    const bounds=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,right:document.querySelector('.rr-record-explorer--cases').getBoundingClientRect().right}));
    assert.ok(bounds.doc<=width+1&&bounds.right<=width+1,`Case evidence overflow at ${width}: ${JSON.stringify(bounds)}`);
    if(width===390){
      await page.locator('.rr-evidence').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
      await page.screenshot({path:`${screenshotRoot}/readiness-case-explorer-mobile.png`,fullPage:false});
    }
  }
}));

test('Bug explorer filters scoped open records and follows exact relationships without exposing resolved bugs', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=explorers`);
  await ready(page);
  await evidence(page).getByRole('tab',{name:/Defects/}).click();
  const explorer=page.locator('.rr-record-explorer--bugs');
  const rows=explorer.locator('tbody > tr');
  await expect(rows).toHaveCount(8);
  await expect(explorer.getByRole('link',{name:'Resolved checkout alignment',exact:true})).toHaveCount(0);
  const unlinked=rows.filter({has:page.getByRole('link',{name:'Unlinked release bug',exact:true})});
  assert.match(await unlinked.innerText(),/No linked evidence in the loaded scope/);
  const filter=page.getByRole('combobox',{name:'Filter evidence',exact:true});
  await filter.selectOption('linked');
  await expect(rows).toHaveCount(7);
  await expect(explorer.getByRole('link',{name:'Unlinked release bug',exact:true})).toHaveCount(0);
  await filter.selectOption('critical');
  await expect(rows).toHaveCount(1);
  assert.equal(await explorer.getByRole('link',{name:'Payment is captured twice after retry',exact:true}).getAttribute('href'),'/issues?issue=bug1&project_id=project');
  await explorer.locator('.rr-bug-links > summary').click();
  assert.equal(await explorer.getByRole('link',{name:'Card payment succeeds',exact:true}).getAttribute('href'),'/test-cases?case=c1&project_id=project');
  assert.equal(await explorer.getByRole('link',{name:'Release candidate · Chrome and Safari',exact:true}).getAttribute('href'),'/executions?execution=r1&project_id=project');
  await page.locator('.rr-evidence').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:`${screenshotRoot}/readiness-bug-explorer.png`,fullPage:false});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.rr-evidence-toolbar select')).backgroundColor==='rgb(24, 34, 49)');
  await page.screenshot({path:`${screenshotRoot}/readiness-bug-explorer-dark.png`,fullPage:false});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.rr-evidence-toolbar select')).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.rr-search input')).backgroundColor==='rgba(0, 0, 0, 0)');
  await page.setViewportSize({width:390,height:1100});
  await page.waitForFunction(()=>{
    const selected=document.querySelector('.rr-layout-drilldown [role=tab][aria-selected=true]').getBoundingClientRect();
    const strip=document.querySelector('.rr-layout-drilldown [role=tablist]').getBoundingClientRect();
    return selected.left>=strip.left-1&&selected.right<=strip.right+1;
  });
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Bug relationships fit the mobile viewport');
  await page.locator('.rr-evidence').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:`${screenshotRoot}/readiness-bug-explorer-mobile.png`,fullPage:false});
  await explorer.getByRole('button',{name:/CP-142.*Customers can securely complete checkout/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Traceability/})).toHaveAttribute("aria-selected", "true");
  assert.match(await page.locator('.rr-story-inspector h3').innerText(),/Customers can securely complete checkout/);
  await page.waitForFunction(()=>{
    const inspector=document.querySelector('.rr-story-inspector');
    const bounds=inspector?.getBoundingClientRect();
    return document.activeElement===inspector&&bounds.top>=-1&&bounds.top<innerHeight-100;
  }).catch(async error=>{
    console.error('Mobile Story navigation',await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,250),inspector:document.querySelector('.rr-story-inspector')?.getBoundingClientRect().toJSON(),url:location.href})));
    await page.screenshot({path:`${screenshotRoot}/readiness-story-navigation-failure.png`,fullPage:false});
    throw error;
  });
}));

test('evidence URL preserves filter, search, selected Story and observed check through reload and browser Back', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=explorers`);
  await ready(page);
  await evidence(page).getByRole('tab',{name:/Traceability/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Traceability/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('searchbox',{name:'Search evidence',exact:true}).fill('CP-142');
  await page.getByRole('button',{name:'Inspect evidence: Customers can securely complete checkout',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('evidence_story')==='s1');
  const storyUrl=new URL(page.url());
  assert.equal(storyUrl.searchParams.get('evidence_view'),'stories');
  assert.equal(storyUrl.searchParams.get('evidence_search'),'CP-142');
  assert.equal(storyUrl.searchParams.get('release'),'Autumn 2026');
  await inspectGate(page, 'Critical defect exposure');
  await page.waitForURL(url=>url.searchParams.get('evidence_check')==='critical-defects');
  assert.equal(new URL(page.url()).searchParams.get('evidence_view'),'bugs');
  assert.equal(new URL(page.url()).searchParams.get('evidence_filter'),'critical');
  await page.reload();
  await ready(page);
  await expect(evidence(page).getByRole('tab',{name:/Defects/})).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole('combobox',{name:'Filter evidence',exact:true})).toHaveValue('critical');
  assert.match(await page.locator('.rr-check-detail').innerText(),/Critical defect exposure/);
  await page.goBack();
  await page.waitForURL(url=>url.searchParams.get('evidence_story')==='s1');
  await expect(evidence(page).getByRole('tab',{name:/Traceability/})).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole('searchbox',{name:'Search evidence',exact:true})).toHaveValue('CP-142');
  assert.match(await page.locator('.rr-story-inspector h3').innerText(),/Customers can securely complete checkout/);
  assert.equal(new URL(page.url()).searchParams.get('evidence_check'),null);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('searchbox',{name:'Search evidence',exact:true})).toHaveValue('CP-142');
  assert.match(await page.locator('.rr-story-inspector h3').innerText(),/Customers can securely complete checkout/);
}));

test('scope funnel distinguishes unique cases from outcome percentages and preserves blocking-filter semantics', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(base);
  await ready(page);
  await page.getByRole('combobox',{name:'Filter evidence',exact:true}).selectOption('blocking');
  await expect(page.locator('.rr-actions > li')).toHaveCount(2);
  assert.match(await page.locator('.rr-actions').innerText(),/Payment is captured twice.*Recover abandoned payments/s);
  assert.doesNotMatch(await page.locator('.rr-actions').innerText(),/Release candidate · Chrome and Safari/,'a failed outcome alone is not part of the defined blocking-signal sum');
  await page.locator('.rr-layout-tabs').getByRole('tab',{name:/Traceability/}).click();
  const map=page.locator('.rr-layout-funnel');
  assert.equal(await map.getByRole('button',{name:/Scoped test cases/}).locator('strong').innerText(),'3');
  assert.equal(await map.getByRole('button',{name:/Executed test cases/}).locator('strong').innerText(),'2');
  assert.equal(await map.getByRole('button',{name:/Passing test cases/}).locator('strong').innerText(),'1');
  await map.getByRole('button',{name:/Passing test cases/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Test cases/})).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole('combobox',{name:'Filter evidence',exact:true})).toHaveValue('passed');
  await expect(page.locator('.rr-record-explorer--cases tbody > tr')).toHaveCount(1);
  await expect(page.locator('.rr-record-explorer--cases').getByRole('link',{name:'Confirmation uses customer locale',exact:true})).toHaveCount(1);
  await map.getByRole('button',{name:/Covered stories/}).click();
  await expect(page.getByRole('combobox',{name:'Filter evidence',exact:true})).toHaveValue('covered');
  await expect(page.locator('.rr-story-row')).toHaveCount(2);
  await map.getByRole('button',{name:/Open Defects/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Defects/})).toHaveAttribute("aria-selected", "true");
  const exported=await downloadEvidence(page);
  assert.equal(exported.metrics.passing_outcomes.percent,67,'two passing outcomes of three are distinct from one fully passing case');
  assert.equal(exported.readiness_index.components.length,4);
  assert.equal(exported.readiness_index.score,39,'known critical exposure caps the advisory index');
  assert.ok(exported.readiness_index.caps.some(cap=>cap.id==='critical-defects'&&cap.maximum===39));
  assert.ok(exported.readiness_index.rawScore>=exported.readiness_index.score);
  assert.doesNotMatch(JSON.stringify(exported),/"confidence"/);
  await page.setViewportSize({width:390,height:1000});
  await map.getByRole('button',{name:/Executed test cases/}).click();
  await expect(evidence(page).getByRole('tab',{name:/Test cases/})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('combobox',{name:'Filter evidence',exact:true})).toHaveValue('executed');
  await page.waitForFunction(()=>{
    const tab=document.querySelector('.rr-layout-drilldown [role="tab"][aria-selected="true"]');
    const bounds=tab?.getBoundingClientRect();
    return document.activeElement===tab&&bounds.top>=-1&&bounds.bottom<=innerHeight+1;
  });
}));

test('every linked Story record remains reachable beyond five related cases, runs and Bugs', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=explorers`);
  await ready(page);
  await evidence(page).getByRole('tab',{name:/Traceability/}).click();
  await page.getByRole('button',{name:'Inspect evidence: Customers can securely complete checkout',exact:true}).click();
  const inspector=page.locator('.rr-story-inspector');
  for(const label of ['Linked tests','Execution evidence','Open Defects']) await inspector.locator('summary').filter({hasText:label}).click();
  for(const [prefix,lastId,param] of [['/test-cases','c-missing','case'],['/executions','r7','execution'],['/issues','bug9','issue']]){
    assert.ok(await inspector.locator(`a[href^="${prefix}?"]`).count()>5,`${prefix}: every linked record is rendered`);
    await expect(inspector.locator(`a[href="${prefix}?${param}=${lastId}&project_id=project"]`)).toHaveCount(1);
  }
}));

test('permission fallbacks preserve available records and never present inaccessible runs or bugs as passing evidence', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=cases-denied&evidence_view=cases`);
  await ready(page);
  assert.equal((await page.evaluate(()=>window.readinessCalls.filter(call=>call.kind==='cases'))).length,0);
  assert.match(await evidence(page).getByRole('tabpanel').innerText(),/Test case evidence is unavailable/);
  await expect(evidence(page).getByRole('tab',{name:/Test cases/}).locator('span')).toHaveText('—');
  const hiddenCases=await downloadEvidence(page);
  assert.equal(hiddenCases.readiness_index.score,null);
  await page.locator('.rr-layout-tabs').getByRole('tab',{name:/Traceability/}).click();
  assert.equal(await page.locator('.rr-layout-funnel').getByRole('button',{name:/Scoped test cases/}).isDisabled(),true);

  await page.goto(`${base}?scenario=runs-denied&evidence_view=cases&evidence_filter=passed`);
  await ready(page);
  assert.equal((await page.evaluate(()=>window.readinessCalls.filter(call=>call.kind==='runs'))).length,0);
  assert.match(await evidence(page).getByRole('tabpanel').innerText(),/Run evidence is unavailable/);
  await expect(evidence(page).getByRole('tab',{name:/Execution evidence/}).locator('span')).toHaveText('—');
  await page.getByRole('combobox',{name:'Filter evidence',exact:true}).selectOption('all');
  await expect(page.locator('.rr-record-explorer--cases tbody > tr')).toHaveCount(3);
  await expect(page.locator('.rr-case-state')).toHaveCount(0);
  assert.equal((await downloadEvidence(page)).readiness_index.score,null);

  await page.goto(`${base}?scenario=restricted&evidence_view=bugs`);
  await ready(page);
  assert.match(await evidence(page).getByRole('tabpanel').innerText(),/Defect evidence is unavailable/);
  await expect(evidence(page).getByRole('tab',{name:/Defects/}).locator('span')).toHaveText('—');
  assert.equal((await page.evaluate(()=>window.readinessCalls.filter(call=>call.kind==='bugs'))).length,0);
  assert.equal((await downloadEvidence(page)).readiness_index.score,null);
}));
