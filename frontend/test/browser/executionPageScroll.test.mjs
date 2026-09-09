import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const sourceRoot = new URL("../../src/", import.meta.url);
const css = (await Promise.all([
  "styles.css", "dark-theme.css", "catalog-list.css", "modal-system.css",
  "execution-run-builder.css", "workspace-layout.css", "pages/ExecutionsPage.command-center.css"
].map(file => readFile(new URL(file, sourceRoot), "utf8")))).join("\n");
const rows = Array.from({ length: 30 }, (_, index) => `<article class="execution-command-case-row"><button class="execution-command-case-inspect">Case ${index + 1}</button></article>`).join("");
const modules = Array.from({ length: 12 }, (_, index) => `<button class="execution-command-tree-row">Module ${index + 1}</button>`).join("");
const markup = `<html data-sidebar="collapsed"><style>${css}</style><body><div id="root"><div class="app-shell app-layout app-layout--workspace-wide"><aside class="sidebar is-collapsed">Navigation</aside><main class="workspace-main main main--library-fill" data-route="/executions"><div class="page-content page-content--executions-full page-content--execution-command-center"><div class="workspace-master-detail is-detail-open"><div class="workspace-master-detail-panel">
  <section class="execution-command-center execution-run-command-center">
    <header class="execution-command-header"><button id="run-action" class="execution-command-button">Run action</button><input id="run-name" aria-label="Run name" value="Regression run"><select id="run-select" aria-label="Assignee"><option value="qa">QA team</option><option value="dev">Development team</option></select></header>
    <div class="execution-command-content">
      <aside class="execution-command-hierarchy"><label class="execution-command-search"><input id="tree-search" aria-label="Search hierarchy"></label><div class="execution-command-tree">${modules}</div></aside>
      <main class="execution-command-cases"><header class="execution-command-cases-header">Run cases</header><div class="execution-command-case-toolbar"><input id="case-search" aria-label="Search cases"></div><div class="execution-command-case-list is-list">${rows}</div></main>
      <aside class="execution-command-analysis"><div class="execution-command-log-line" id="log-line">${"Failure details and readable trace context. ".repeat(80)}</div><details class="execution-command-disclosure" open><summary>Run analysis</summary><div class="execution-command-analysis-copy" id="analysis-copy"><p>${"Analysis notes. ".repeat(160)}</p></div></details><textarea id="run-notes" aria-label="Notes" rows="3">${"A note\n".repeat(30)}</textarea></aside>
    </div>
    <footer class="execution-command-footer">End of run</footer>
  </section>
</div></div></div></main></div></div></body></html>`;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) }); });
after(async () => { await browser?.close(); });

for (const width of [1440, 1024, 390]) {
  test(`run page scrolls over controls and panels at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    try {
      await page.setContent(markup);
      const pageScroll = () => page.locator(".workspace-main").evaluate(el => el.scrollTop);
      const moveWheel = async (selector, delta) => {
        const target = page.locator(selector).first();
        await target.scrollIntoViewIfNeeded();
        await target.hover();
        const previous = await pageScroll();
        await page.mouse.wheel(0, delta);
        await page.waitForFunction(({ previous, delta }) => {
          const current = document.querySelector(".workspace-main").scrollTop;
          return delta > 0 ? current > previous + 10 : current < previous - 10;
        }, { previous, delta }, { timeout: 1500 });
      };

      for (const selector of ["#run-action", "#run-name", "#run-select", "#tree-search", ".execution-command-tree-row", "#case-search", ".execution-command-case-inspect"]) {
        await moveWheel(selector, 280);
      }
      assert.equal(await page.locator("#run-select").inputValue(), "qa", "scrolling does not change the selected assignee");
      for (const selector of ["#log-line", "#analysis-copy"]) {
        const panel = page.locator(selector);
        await panel.evaluate(el => el.scrollTop = el.scrollHeight);
        await moveWheel(selector, -280);
      }

      const nestedScrollers = await page.locator(".execution-run-command-center").evaluate(el =>
        [...el.querySelectorAll(".execution-command-tree, .execution-command-case-list, .execution-command-log-line, .execution-command-disclosure > div")]
          .filter(node => ["auto", "scroll"].includes(getComputedStyle(node).overflowY))
          .map(node => node.className)
      );
      assert.deepEqual(nestedScrollers, [], "layout panels share the page scrollbar");
      await page.locator(".execution-command-footer").scrollIntoViewIfNeeded();
      assert.equal(await page.locator(".execution-command-footer").isVisible(), true);

      const notes = page.locator("#run-notes");
      await notes.scrollIntoViewIfNeeded();
      await notes.fill("New first line\nSecond line");
      assert.equal(await notes.inputValue(), "New first line\nSecond line", "notes remain editable");
    } finally { await page.close(); }
  });
}
