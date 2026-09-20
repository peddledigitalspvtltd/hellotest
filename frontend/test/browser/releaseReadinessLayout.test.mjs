import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightModule);
const { expect } = require(`${playwrightModule}/test`);
const root = new URL("../../", import.meta.url);
const fixture = await readFile(new URL("./fixtures/releaseReadiness.fixture.tsx", import.meta.url), "utf8");
const screenshotRoot = "/tmp/qaira-readiness-layout";

async function withPage(run) {
  const name = `readiness-layout-${randomUUID()}`;
  const html = new URL(`${name}.html`, root);
  const tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    await mkdir(screenshotRoot, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { errors.push(`Unexpected API request: ${route.request().url()}`); return route.abort(); });
    await run(page, `${process.env.VITE_TEST_URL || "http://127.0.0.1:5179"}/${name}.html`);
    assert.deepEqual(errors, [], "layout interactions do not throw or bypass the fixture API");
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
}

async function openReadiness(page, base, query = "") {
  await page.goto(`${base}${query}`);
  await page.getByRole("heading", { name: "Release readiness", exact: true }).waitFor();
  await expect(page.locator(".rr-layout-tabs").getByRole("tab")).toHaveCount(3);
}

function mainTab(page, name) {
  return page.locator(".rr-layout-tabs").getByRole("tab", { name: new RegExp(name) });
}

test("reference content order and accordion disclosures match the supplied decision room", { timeout: 60000 }, async () => withPage(async (page, base) => {
  await openReadiness(page, base);
  const tiles = page.locator(".rr-layout-tiles > details.rr-layout-tile");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.locator(":scope > summary")).toHaveText([/Story coverage/, /Latest pass rate/, /Blocking signals/]);
  assert.match(await tiles.nth(0).innerText(), /67/);
  assert.match(await tiles.nth(1).innerText(), /67/);
  await tiles.nth(0).locator(":scope > summary").click();
  await expect(tiles.nth(0)).toHaveAttribute("open", "");
  await tiles.nth(1).locator(":scope > summary").click();
  await expect(tiles.nth(1)).toHaveAttribute("open", "");
  await expect(tiles.nth(0)).not.toHaveAttribute("open", "");

  const gates = page.locator(".rr-layout-gates > details.rr-layout-gate");
  await expect(gates).toHaveCount(6);
  await gates.nth(0).locator(":scope > summary").click();
  await expect(gates.nth(0)).toHaveAttribute("open", "");
  await gates.nth(1).locator(":scope > summary").click();
  await expect(gates.nth(1)).toHaveAttribute("open", "");
  await expect(gates.nth(0)).not.toHaveAttribute("open", "");
  await expect(gates.nth(1).getByRole("button", { name: /Inspect gate evidence/ })).toBeVisible();

  const positions = await page.evaluate(() => [
    ".rr-layout-hero", ".rr-layout-tiles", ".rr-layout-tabs", ".rr-layout-gates",
    ".rr-layout-panel.is-ai", ".rr-layout-panel.is-risk", ".rr-layout-panel.is-next", ".rr-layout-footer",
  ].map(selector => ({ selector, top: document.querySelector(selector)?.getBoundingClientRect().top })));
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index].top > positions[index - 1].top, `${positions[index].selector} follows ${positions[index - 1].selector}`);
  }
  await expect(page.locator(".rr-layout-panel.is-ai").getByRole("button", { name: "Open evidence brief", exact: true })).toBeVisible();
  await expect(page.locator(".rr-layout-panel.is-next").getByRole("button", { name: "Open AI evidence brief", exact: true })).toBeVisible();
  assert.match(await page.locator(".rr-layout-panel.is-risk").innerText(), /CP-142.*Customers can securely complete checkout/s);
  await expect(page.locator(".rr-layout-panel.is-risk").getByRole("button", { name: "Open Story evidence", exact: true })).toBeVisible();
  await page.locator(".rr-layout-panel.is-next .rr-layout-queue").getByRole("button", { name: /CP-143/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("evidence_story")).toBe("s2");
  await expect(page.locator(".rr-layout-drilldown .rr-story-inspector")).toContainText("Recover abandoned payments without a duplicate charge");
  await page.getByRole("button", { name: "Close evidence", exact: true }).click();
  await expect(page.locator(".rr-layout-drilldown")).toBeHidden();
  assert.match(await page.locator(".rr-layout-panel.is-risk").innerText(), /CP-142/, "inspecting another Story does not replace the leading risk in the decision brief");
  await page.locator(".rr-layout-footer").getByRole("button", { name: /Review scope, permissions, and source notices/ }).click();
  await expect(page.locator(".rr-layout-source-details")).toHaveAttribute("open", "");
  assert.match(await page.locator(".rr-layout-source-details").innerText(), /Stories.*3.*Test cases.*3/s);
}));

async function assertFitsViewport(page, width) {
  await page.setViewportSize({ width, height: 1100 });
  const bounds = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    component: document.querySelector(".release-review").getBoundingClientRect().toJSON(),
  }));
  assert.ok(bounds.document <= width + 1 && bounds.component.right <= width + 1,
    `Release readiness overflows at ${width}px: ${JSON.stringify(bounds)}`);
}

async function captureLayout(page, name) {
  const viewport = page.viewportSize();
  const height = Math.ceil(await page.locator(".release-review").evaluate(node => node.scrollHeight)) + 40;
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.locator(".workspace-main").evaluate(node => node.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${screenshotRoot}/${name}.png`, fullPage: true, animations: "disabled" });
  await page.setViewportSize(viewport);
}

test("reference layout keeps three primary tabs and opens full evidence from header shortcuts", { timeout: 90000 }, async () => withPage(async (page, base) => {
  await openReadiness(page, base);
  const primary = page.locator(".rr-layout-tabs");
  await expect(primary.getByRole("tab")).toHaveText([/Decision brief/, /Traceability/, /Execution evidence/]);
  await expect(mainTab(page, "Decision brief")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".rr-layout-drilldown")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Release / fix version", exact: true })).toHaveValue("Autumn 2026");
  await expect(page.getByRole("button", { name: "Apply scope", exact: true })).toHaveCount(0);

  await mainTab(page, "Decision brief").focus();
  await mainTab(page, "Decision brief").press("ArrowRight");
  await expect(mainTab(page, "Traceability")).toHaveAttribute("aria-selected", "true");
  await mainTab(page, "Traceability").press("End");
  await expect(mainTab(page, "Execution evidence")).toHaveAttribute("aria-selected", "true");
  await mainTab(page, "Execution evidence").press("Home");
  await expect(mainTab(page, "Decision brief")).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Review gaps", exact: true }).click();
  const drilldown = page.locator(".rr-layout-drilldown");
  await expect(drilldown).toBeVisible();
  await expect(drilldown.getByRole("tab")).toHaveCount(5);
  await expect(drilldown.getByRole("tab", { name: /Traceability/ })).toHaveAttribute("aria-selected", "true");
  await expect(drilldown.getByRole("combobox", { name: "Filter evidence", exact: true })).toHaveValue("uncovered");
  await expect(drilldown.locator(".rr-story-row")).toHaveCount(1);
  assert.match(await drilldown.locator(".rr-story-row").innerText(), /CP-143/);

  await page.getByRole("button", { name: "Execution evidence", exact: true }).click();
  await expect(drilldown.getByRole("tab", { name: /Execution evidence/ })).toHaveAttribute("aria-selected", "true");
  await expect(drilldown.locator(".rr-run")).toHaveCount(2);
  assert.match(await drilldown.locator(".rr-run").first().innerText(), /Saved staging.*Saved Chromium 128.*2 passed.*1 failed/s);
  assert.match(await drilldown.locator(".rr-run").last().innerText(), /Archived staging.*Archived Firefox.*1 not assessed/s);

  await page.getByRole("button", { name: "Open Defects", exact: true }).click();
  await expect(drilldown.getByRole("tab", { name: /Defects/ })).toHaveAttribute("aria-selected", "true");
  await expect(drilldown.getByRole("link", { name: "Payment is captured twice after retry", exact: true })).toHaveAttribute("href", "/issues?issue=bug1&project_id=project");
}));

test("inline scope controls apply immediately and keep evidence requests scoped", { timeout: 60000 }, async () => withPage(async (page, base) => {
  await openReadiness(page, base);
  await page.getByRole("combobox", { name: "Sprint", exact: true }).selectOption("Sprint 24");
  await expect.poll(() => new URL(page.url()).searchParams.get("sprint")).toBe("Sprint 24");
  await expect.poll(() => new URL(page.url()).searchParams.get("release")).toBe(null);
  await page.waitForFunction(() => window.readinessCalls.some(call => call.kind === "runs" && !call.input.release && call.input.sprint === "Sprint 24"));
  assert.ok((await page.evaluate(() => window.readinessCalls)).every(call => call.input.project_id === "project"));
  await page.getByRole("combobox", { name: "Release / fix version", exact: true }).selectOption("Autumn 2026");
  await expect(page.getByRole("combobox", { name: "Sprint", exact: true })).toHaveValue("");
  await page.waitForFunction(() => window.readinessCalls.some(call => call.kind === "runs" && call.input.release === "Autumn 2026" && !call.input.sprint));
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Release / fix version", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Sprint", exact: true })).toHaveValue("Sprint 24");
}));

test("all three reference panels fit desktop and narrow mobile widths in both themes", { timeout: 90000 }, async () => withPage(async (page, base) => {
  await openReadiness(page, base);
  await captureLayout(page, "decision-desktop");
  for (const width of [1440, 1024, 768, 390, 320]) {
    for (const name of ["Decision brief", "Traceability", "Execution evidence"]) {
      await mainTab(page, name).click();
      await assertFitsViewport(page, width);
      const tabBounds = await mainTab(page, name).boundingBox();
      assert.ok(tabBounds.x >= 0 && tabBounds.x + tabBounds.width <= width + 1, `${name} stays reachable at ${width}px`);
      if (width === 1440 && name !== "Decision brief") await captureLayout(page, name === "Traceability" ? "traceability-desktop" : "execution-desktop");
    }
  }
  await mainTab(page, "Decision brief").click();
  await page.setViewportSize({ width: 390, height: 1100 });
  await captureLayout(page, "decision-mobile");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await assertFitsViewport(page, 390);
  await captureLayout(page, "decision-dark-mobile");
  await page.setViewportSize({ width: 1440, height: 1200 });
  await captureLayout(page, "decision-dark-desktop");
}));

test("both decision brief AI placements open the scoped explanation and revoke it with source access", { timeout: 60000 }, async () => withPage(async (page, base) => {
  await openReadiness(page, base);
  const assist = page.getByRole("button", { name: "Open evidence brief", exact: true });
  const actions = page.getByRole("button", { name: "Open AI evidence brief", exact: true });
  await expect(assist).toBeVisible();
  await expect(actions).toBeVisible();
  await assist.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  assert.match(await page.getByRole("dialog").innerText(), /AI scope: Autumn 2026 · all sprints/);
  await page.getByRole("dialog").getByRole("button", { name: /Close/ }).first().click();
  await page.evaluate(() => window.finishReadinessAi());
  await actions.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  assert.equal((await page.evaluate(() => window.readinessCalls.filter(call => call.kind === "ai"))).length, 2);
  await page.evaluate(() => window.revokeReadinessBugs());
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => window.finishReadinessAi());
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Defects", exact: true })).toBeDisabled();
}));

test("unavailable sources stay unavailable in the new layout and shortcuts", { timeout: 90000 }, async () => withPage(async (page, base) => {
  for (const [scenario, deniedSource, shortcut] of [
    ["cases-denied", "cases", "Review gaps"],
    ["runs-denied", "runs", "Execution evidence"],
    ["restricted", "bugs", "Open Defects"],
  ]) {
    await openReadiness(page, base, `?scenario=${scenario}`);
    await expect(page.getByRole("button", { name: shortcut, exact: true })).toBeDisabled();
    assert.equal((await page.evaluate(source => window.readinessCalls.filter(call => call.kind === source), deniedSource)).length, 0, `${deniedSource} is never fetched without access`);
    await mainTab(page, "Traceability").click();
    await assertFitsViewport(page, 390);
  }
  await openReadiness(page, base, "?scenario=empty");
  await expect(page.locator(".rr-layout-hero .rr-badge")).toContainText("Evidence is not yet sufficient");
  await assertFitsViewport(page, 320);
  await openReadiness(page, base, "?scenario=linked");
  assert.equal((await page.evaluate(() => window.readinessCalls.filter(call => call.kind === "stories"))).length, 0);
  await page.getByRole("combobox", { name: "Release / fix version", exact: true }).selectOption("");
  await expect.poll(() => new URL(page.url()).searchParams.get("release_id")).toBe(null);
  await page.waitForFunction(() => window.readinessCalls.some(call => call.kind === "stories"));
}));
