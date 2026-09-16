import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
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
test(
  "release review preserves rows, scopes requests, supports drilldown and keyboard tabs across responsive themes",
  { timeout: 90000 },
  async () =>
    withPage(async (page, base) => {
      await page.goto(base);
      await page
        .getByRole("heading", { name: "Attention required", exact: true })
        .waitFor();
      assert.match(
        await page.locator(".rr-metrics").innerText(),
        /2 of 3 cases.*2 passed · 1 failed/s,
      );
      assert.equal(
        await page
          .getByRole("link", {
            name: "Review defect: Payment is captured twice after retry",
          })
          .getAttribute("href"),
        "/issues?issue=bug1&project_id=project",
      );
      assert.match(
        await page.locator(".rr-actions").innerText(),
        /1 failed · 1 paused/,
      );
      const calls = await page.evaluate(() => window.readinessCalls);
      assert.ok(calls.every((call) => call.input.project_id === "project"));
      await page.screenshot({
        path: `${screenshotRoot}/readiness-after-desktop.png`,
        fullPage: true,
      });
      const review = page.getByRole("tab", { name: /Review/ });
      await review.focus();
      await review.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: /Stories/ })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.match(
        await page.locator(".rr-story-row").first().innerText(),
        /1 failed/,
      );
      await page.getByRole("tab", { name: /Stories/ }).press("End");
      assert.equal(
        await page
          .getByRole("tab", { name: /Runs/ })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.match(
        await page.locator(".rr-run").first().innerText(),
        /2 passed.*1 failed.*1 not assessed/s,
      );
      assert.match(await page.locator(".rr-run").first().innerText(), /Saved staging.*Saved Chromium 128/s);
      assert.match(await page.locator(".rr-run").last().innerText(), /Archived staging.*Archived Firefox.*1 not assessed/s);
      await page.screenshot({
        path: `${screenshotRoot}/readiness-runs.png`,
        fullPage: true,
      });
      await page.getByRole("tab", { name: /Runs/ }).press("Home");
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        const bounds = await page.evaluate(() => ({
          screen: innerWidth,
          doc: document.documentElement.scrollWidth,
          component: document
            .querySelector(".release-review")
            .getBoundingClientRect().right,
        }));
        assert.ok(
          bounds.doc <= width + 1 && bounds.component <= width + 1,
          `Overflow ${width}: ${JSON.stringify(bounds)}`,
        );
        if (width === 390)
          await page.screenshot({
            path: `${screenshotRoot}/readiness-after-mobile.png`,
            fullPage: true,
          });
      }
      await page.setViewportSize({ width: 1440, height: 1200 });
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".rr-scope input")).backgroundColor === "rgb(24, 34, 49)");
      await page.screenshot({
        path: `${screenshotRoot}/readiness-after-dark.png`,
        fullPage: true,
      });
      assert.equal(
        await page
          .locator(".release-review")
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--rr-bg").trim(),
          ),
        "#182231",
      );
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "light"),
      );
      await page
        .getByRole("button", { name: "Explain release", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.match(
        await page.getByRole("dialog").innerText(),
        /AI scope: Autumn 2026 · all sprints/,
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /Close/ })
        .first()
        .click();
      await page.getByLabel("Release / fix version").fill("Winter 2026");
      await page.getByLabel("Sprint", { exact: true }).fill("Sprint 25");
      await page
        .getByRole("button", { name: "Apply scope", exact: true })
        .click();
      await page.waitForFunction(() =>
        window.readinessCalls.some(
          (call) =>
            call.kind === "runs" &&
            call.input.release === "Winter 2026" &&
            call.input.sprint === "Sprint 25",
        ),
      );
      await page.evaluate(() => window.finishReadinessAi());
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.evaluate(() =>
        window.setReadinessPreferences({
          language: "es",
          locale: "es-ES",
          timeZone: "UTC",
          hourCycle: "h23",
        }),
      );
      await page
        .getByRole("heading", {
          name: "Preparación del lanzamiento",
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: `${screenshotRoot}/readiness-spanish.png`,
        fullPage: true,
      });
    }),
);
test(
  "release review loads more evidence and recovers without discarding cached records",
  { timeout: 60000 },
  async () =>
    withPage(async (page, base) => {
      await page.goto(`${base}?scenario=partial`);
      await page
        .getByRole("heading", { name: "Attention required", exact: true })
        .waitFor();
      await page.locator(".rr-decision").getByText("Limited evidence", { exact: true }).waitFor();
      await page.locator('.rr-boundary .hierarchy-auto-load-sentinel').evaluate(node => node.scrollIntoView({block:'center'}));
      await page
        .getByText("Loaded sources complete", { exact: true })
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
        await page.locator(".rr-metric").last().innerText(),
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
      await page
        .getByRole("heading", {
          name: "Evidence is not yet sufficient",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.locator(".rr-metric").filter({ hasText: "—" }).count(),
        3,
      );
      await page.screenshot({
        path: `${screenshotRoot}/readiness-empty.png`,
        fullPage: true,
      });
      await page.goto(`${base}?scenario=linked`);
      await page.getByRole("heading",{name:"Attention required",exact:true}).waitFor();
      await page.getByRole("tab",{name:/Stories/}).click();
      assert.equal(await page.locator(".rr-story-row").count(),1);
      assert.match(await page.locator(".rr-story-row").innerText(),/CP-143/);
      assert.equal((await page.evaluate(()=>window.readinessCalls.filter(call=>call.kind==='stories'))).length,0);
      assert.equal(await page.getByLabel("Release / fix version").isDisabled(),true);
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
      await page
        .getByRole("heading", { name: "Attention required", exact: true })
        .waitFor();
      await page.goto(`${base}?scenario=restricted`);
      await page
        .getByRole("heading", { name: "Attention required", exact: true })
        .waitFor();
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
  await page.goto(base);await page.getByRole('heading',{name:'Attention required',exact:true}).waitFor();
  await page.getByRole('button',{name:'Explain release',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>window.revokeReadinessBugs());await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Attention required',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Explain release',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Review defect: Payment is captured twice after retry'}).count(),0);
  assert.match(await page.locator('.rr-metric').last().innerText(),/—.*Unavailable/s);
  await page.evaluate(()=>window.finishReadinessAi());assert.equal(await page.getByRole('dialog').count(),0);
}));

async function downloadEvidence(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export evidence',exact:true}).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^release-evidence-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('readiness search, check drilldowns, exact Story relationships and exports retain the applied evidence scope', {timeout:90000}, async()=>withPage(async(page,base)=>{
  await page.goto(base);
  await page.getByRole('heading',{name:'Attention required',exact:true}).waitFor();
  const metrics = await page.locator('.rr-metrics').innerText();
  const search = page.getByRole('searchbox',{name:'Search evidence',exact:true});
  const filter = page.getByRole('combobox',{name:'Filter evidence',exact:true});
  const toolbar=await page.locator('.rr-evidence-toolbar').evaluate(node=>{
    const search=node.querySelector('.rr-search').getBoundingClientRect(),filter=node.querySelector('select').getBoundingClientRect();
    return {search:search.toJSON(),filter:filter.toJSON()};
  });
  assert.ok(Math.abs(toolbar.search.top-toolbar.filter.top)<2,'desktop search and filter share the same row');
  assert.ok(toolbar.search.width>200&&toolbar.filter.width>100,'both inline controls remain usable');
  assert.equal(await page.locator('.rr-checks > li').count(),6,'all six observed checks are available');
  assert.match(await page.locator('.rr-actions > li').first().innerText(),/Payment is captured twice/,'known critical evidence leads the action queue');

  await search.fill('duplicate charge');
  assert.equal(await page.locator('.rr-actions > li').count(),1);
  assert.match(await page.locator('.rr-actions').innerText(),/Recover abandoned payments/);
  await filter.selectOption('bugs');
  await page.getByRole('heading',{name:'No matching evidence',exact:true}).waitFor();
  assert.equal(await page.locator('.rr-metrics').innerText(),metrics,'local filters never change scope denominators');
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
  assert.doesNotMatch(JSON.stringify(exportWithNoLocalMatches),/SENSITIVE_FIXTURE_MARKER|"snapshot"|"readinessScore"|"confidence"/);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();

  await page.getByRole('tab',{name:/Stories/}).click();
  await search.fill('CP-142');
  assert.equal(await page.locator('.rr-story-row').count(),1);
  await page.getByRole('button',{name:'Inspect evidence: Customers can securely complete checkout',exact:true}).click();
  const inspector = page.locator('.rr-story-inspector');
  await inspector.locator('summary').filter({hasText:'Linked tests'}).click();
  await inspector.locator('summary').filter({hasText:'Runs'}).click();
  await inspector.locator('summary').filter({hasText:'Open defects'}).click();
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

  const drills=[
    ['Critical defects','Review','critical','.rr-actions > li',1],
    ['Failed test outcomes','Runs','failed','.rr-run',1],
    ['Uncovered P1 / P2 stories','Stories','priority','.rr-story-row',1],
    ['Cases awaiting assessment','Stories','unassessed','.rr-story-row',1],
    ['Blocked test evidence','Runs','blocked','.rr-run',1],
    ['Evidence freshness','Runs','all','.rr-run',2],
  ];
  for(const [check,tab,value,selector,count] of drills){
    await page.getByRole('button',{name:`Inspect ${check} evidence`,exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:new RegExp(tab)}).getAttribute('aria-selected'),'true');
    assert.equal(await filter.inputValue(),value);
    assert.equal(await search.inputValue(),'','check drilldown clears an unrelated search');
    assert.equal(await page.locator(selector).count(),count,check+' opens the relevant evidence');
    if(value==='priority')assert.match(await page.locator('.rr-story-inspector h3').innerText(),/Recover abandoned payments/,'a check never leaves a hidden, unrelated Story in the inspector');
    assert.match(await page.locator('.rr-check-detail').innerText(),new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.equal(await page.locator('.rr-metrics').innerText(),metrics);
  }
  await search.fill('Archived Firefox');
  assert.equal(await page.locator('.rr-run').count(),1,'run search uses saved context labels');
  assert.match(await page.locator('.rr-run').innerText(),/Planned Firefox confirmation/);
  await page.evaluate(()=>window.revokeReadinessBugs());
  await page.getByRole('heading',{name:'Attention required',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.rr-metric:last-child').textContent.includes('Unavailable'));
  const restrictedExport=await downloadEvidence(page);
  assert.equal(restrictedExport.assessment.provisional,true);
  assert.equal(restrictedExport.metrics.open_defects,null);
  assert.deepEqual(restrictedExport.open_defects,[]);
  assert.ok(restrictedExport.stories.every(story=>story.open_defect_ids.length===0));
  assert.equal(restrictedExport.sources.find(source=>source.source==='bugs').status,'unavailable');
  assert.equal(await page.getByRole('button',{name:'Inspect Critical defects evidence',exact:true}).isDisabled(),true);
}));

test('readiness treats policy refresh errors, unknown freshness and missing release permission as incomplete evidence', {timeout:60000}, async()=>withPage(async(page,base)=>{
  await page.goto(`${base}?scenario=release-denied`);
  await page.getByRole('heading',{name:'This release could not be loaded in the current project.',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.readinessContextCalls),[],'a known missing release grant does not send an unauthorized context request');
  assert.deepEqual(await page.evaluate(()=>window.readinessCalls),[],'unverified context cannot fetch a wider project scope');
  await page.getByRole('button',{name:'Change scope',exact:true}).first().click();
  await page.getByRole('heading',{name:'Attention required',exact:true}).waitFor();

  await page.goto(`${base}?scenario=empty`);
  await page.getByRole('heading',{name:'Evidence is not yet sufficient',exact:true}).waitFor();
  const unknownFreshness=page.getByRole('button',{name:'Inspect Evidence freshness evidence',exact:true});
  assert.equal(await unknownFreshness.locator('strong').innerText(),'—');
  assert.equal((await downloadEvidence(page)).checks.find(check=>check.id==='evidence-freshness').count,null);

  await page.goto(base);
  await page.getByText('Loaded sources complete',{exact:true}).waitFor();
  await page.evaluate(()=>window.readinessFailFlags=true);
  await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Some sources could not be refreshed'}).waitFor();
  await page.locator('.rr-decision').getByText('Limited evidence',{exact:true}).waitFor();
  assert.equal(await page.getByText('Loaded sources complete',{exact:true}).count(),0);
  const uncertain=await downloadEvidence(page);
  assert.equal(uncertain.assessment.provisional,true);
  assert.ok(uncertain.checks.every(check=>check.state!=='pass'),'cached source rows cannot clear checks after policy refresh fails');
  assert.equal(uncertain.stories.length,3,'a failed refresh preserves available evidence');
  await page.evaluate(()=>window.readinessFailFlags=false);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Loaded sources complete',{exact:true}).waitFor();
}));
