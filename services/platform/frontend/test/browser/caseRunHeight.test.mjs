// Real AppShell and ExecutionsPage with isolated API fixtures; no backend writes.
// CHROME_EXECUTABLE=/path/to/chrome VITE_TEST_URL=http://127.0.0.1:5182 node --test test/browser/caseRunHeight.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../", import.meta.url);
// Share the established shell fixture so this checks the production chrome,
// routing, case snapshots and assistant alongside the case-run stylesheet.
const shellSource = await readFile(new URL("./workspaceShell.test.mjs", import.meta.url), "utf8");
const fixture = shellSource.match(/const fixture=`([\s\S]*?)`;\nconst adminFixture/)[1];

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity
    ).map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function geometry(page) {
  return page.evaluate(() => {
    const selectors = [".workspace-main", ".page-content--workspace-focus", ".workspace-master-detail", ".workspace-master-detail-panel", ".execution-case-run-workspace", ".execution-case-run-footer", ".grounded-assistant-trigger"];
    const boxes = Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector);
      return [selector, { ...element.getBoundingClientRect().toJSON(), clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }];
    }));
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.scrollingElement.scrollHeight, documentTop: document.scrollingElement.scrollTop, boxes };
  });
}

async function assertLayout(page, label) {
  const result = await geometry(page);
  const main = result.boxes[".workspace-main"];
  const runner = result.boxes[".execution-case-run-workspace"];
  const footer = result.boxes[".execution-case-run-footer"];
  const evidence = `${label}: ${JSON.stringify(result)}`;
  assert.ok(Math.abs(main.top) <= 1 && Math.abs(main.height - result.height) <= 1, `Page uses full viewport; ${evidence}`);
  assert.ok(Math.abs(footer.bottom - result.height) <= 1, `Footer reaches viewport bottom; ${evidence}`);
  assert.ok(result.documentWidth <= result.width + 1, `No document horizontal overflow; ${evidence}`);
  assert.ok(result.documentHeight <= result.height + 1, `No second document scrollbar; ${evidence}`);
  assert.equal(result.documentTop, 0, `Document does not scroll; ${evidence}`);
  for (const selector of [".page-content--workspace-focus", ".workspace-master-detail", ".workspace-master-detail-panel"]) {
    const wrapper = result.boxes[selector];
    assert.ok(Math.abs(wrapper.top - runner.top) <= 1 && Math.abs(wrapper.bottom - runner.bottom) <= 1,
      `Wrapper grows with runner instead of adding a blank tail (${selector}); ${evidence}`);
  }
  assert.ok(Math.abs(main.scrollHeight - runner.height) <= 1, `Page scroll range ends with runner; ${evidence}`);
  return result;
}

async function assertAssistantClear(page, label) {
  const launcher = page.getByRole("button", { name: "Open HelloTest grounded assistant", exact: true });
  for (const hover of [false, true]) {
    if (hover) await launcher.hover();
    else await page.mouse.move(2, 2);
    await settle(page);
    const result = await geometry(page);
    const assistant = result.boxes[".grounded-assistant-trigger"];
    const controls = await page.locator(".execution-case-run-footer button, .execution-case-run-navigation, .execution-case-run-references input, .execution-case-run-references textarea, .execution-case-run-references button").evaluateAll(elements => {
      const footerTop = document.querySelector(".execution-case-run-footer").getBoundingClientRect().top;
      return elements.map(element => {
        const bounds = element.getBoundingClientRect().toJSON();
        // While scrolling, the opaque sticky footer masks body content below
        // its top edge. Compare only the visible portion of those controls.
        return {
          label: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("placeholder") || element.tagName,
          ...bounds,
          top: Math.max(0, bounds.top),
          bottom: Math.min(bounds.bottom, element.closest(".execution-case-run-footer") ? innerHeight : footerTop)
        };
      }).filter(bounds => bounds.width > 0 && bounds.bottom > bounds.top);
    });
    for (const control of controls) {
      const overlaps = assistant.left < control.right && assistant.right > control.left
        && assistant.top < control.bottom && assistant.bottom > control.top;
      assert.equal(overlaps, false,
        `${label}: assistant ${hover ? "hover" : "normal"} does not cover ${control.label}; ${JSON.stringify({ assistant, control })}`);
    }
  }
  await page.mouse.move(2, 2);
}

test("case-run content fills available height and shares one scrollbar across tabs and viewport sizes", async () => {
  const stem = `case-run-height-fixture-${randomUUID()}`;
  const html = new URL(`${stem}.html`, frontendRoot);
  const tsx = new URL(`${stem}.tsx`, frontendRoot);
  const artifacts = process.env.CASE_RUN_HEIGHT_SCREENSHOT_DIR || "/tmp/qaira-case-height";
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${stem}.tsx"></script></body></html>`);
    await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const unexpectedRequests = [];
    await context.route("**/api/**", route => {
      unexpectedRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5182"}/${stem}.html?route=${encodeURIComponent("/executions?execution=run1&testCase=case1")}`);
    await page.locator(".execution-case-run-header").waitFor();
    await page.locator(".execution-case-run-references input").waitFor();
    await settle(page);
    const scroller = page.locator(".workspace-main");

    for (const [width, height] of [[1440, 900], [1440, 1200], [1440, 1600], [1024, 900], [768, 900], [390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await settle(page);
      for (const tab of ["Overview", "History", "Logs", "Attachments"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await scroller.evaluate(element => { element.scrollTop = 0; });
        await settle(page);
        const label = `${width}x${height} ${tab}`;
        const top = await assertLayout(page, `${label} at top`);
        if (width === 1440 && height === 1600) {
          assert.ok(top.boxes[".workspace-main"].scrollHeight <= height + 1, `${label}: short content uses available space without scrolling`);
        }
        await assertAssistantClear(page, label);
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await settle(page);
        await assertLayout(page, `${label} at bottom`);
        await assertAssistantClear(page, `${label} at bottom`);
        await page.screenshot({ path: `${artifacts}/final-${width}-${height}-${tab.toLowerCase()}.png` });
      }
    }

    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await settle(page);
    const initial = await geometry(page);
    assert.ok(initial.boxes[".workspace-main"].scrollHeight > initial.height + 100, "Overview fixture has meaningful overflow on a laptop");
    await page.locator(".execution-case-run-header").hover();
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector(".workspace-main").scrollTop > 100);
    const references = page.locator(".execution-case-run-references input").first();
    await references.scrollIntoViewIfNeeded();
    await references.hover();
    const before = await scroller.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, -200);
    await page.waitForFunction(previous => document.querySelector(".workspace-main").scrollTop < previous - 50, before);
    assert.equal(await references.inputValue(), "", "Wheel over traceability input preserves its value");
    await settle(page);
    await assertLayout(page, "Wheel over controls");
    assert.deepEqual(errors, [], "No browser rendering errors");
    assert.deepEqual(unexpectedRequests, [], "All API calls are stubbed; no live reads or writes");
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
