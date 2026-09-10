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
        await page.locator(".rr-run").innerText(),
        /2 passed.*1 failed.*1 not assessed/s,
      );
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
      await page.getByText("Limited evidence", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Load more evidence", exact: true })
        .click();
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
        () =>
          !document
            .querySelector(".rr-actions")
            .textContent.includes("Payment is captured twice"),
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
