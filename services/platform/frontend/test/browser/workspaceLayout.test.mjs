// Run with a local Playwright installation, without a backend or user data:
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright-core/index.mjs BROWSER_EXECUTABLE_PATH=/path/to/chrome node --test test/browser/workspaceLayout.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright-core";
const { chromium } = playwrightPath
  ? await import(pathToFileURL(playwrightPath).href)
  : require(playwrightModule);
const sourceRoot = new URL("../../src/", import.meta.url);
const { outputText } = ts.transpileModule(await readFile(new URL("components/WorkspaceMasterDetail.tsx", sourceRoot), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
});
const componentModule = { exports: {} };
new Function("require", "module", "exports", outputText)(require, componentModule, componentModule.exports);
const { WorkspaceMasterDetail } = componentModule.exports;
const cssFiles = ["styles.css", "dark-theme.css", "catalog-list.css", "modal-system.css", "execution-run-builder.css", "workspace-layout.css", "pages/ExecutionsPage.case-run.css"];
const css = (await Promise.all(cssFiles.map(file => readFile(new URL(file, sourceRoot), "utf8")))).join("\n");
let browser;
before(async () => {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); });

const markup = (mode, sidebar, width) => {
  const focused = mode === "run" || mode === "case";
  const h = React.createElement;
  const panelClass = mode === "run" ? "execution-case-run-workspace" : mode === "case" ? "panel card test-case-workspace-shell" : "panel card";
  const detail = h("section", { className: panelClass }, h("header", {}, h("h1", {}, `${mode} detail`)), h("div", {}, "Steps and details"));
  const workspace = renderToStaticMarkup(h(WorkspaceMasterDetail, {
    isDetailOpen: mode !== "browse", browseView: h("section", { className: "panel card" }, "Library"), detailView: detail
  }));
  return `<html data-sidebar="${sidebar}"><style>${css}</style><body><div id="root"><div class="app-shell app-layout app-layout--workspace-wide"><aside class="sidebar${sidebar === "collapsed" && width > 768 ? " is-collapsed" : ""}">Navigation</aside>${width <= 768 ? '<button class="sidebar-backdrop" aria-hidden="true"></button>' : ""}<main class="workspace-main main main--library-fill" data-route="${mode === "run" ? "/executions" : mode === "story" ? "/stories" : "/test-cases"}">${width <= 768 ? '<div class="mobile-sidebar-bar">Navigation</div>' : ""}<div class="page-content ${mode === "run" ? "page-content--executions-full" : "page-content--library-full"}${focused ? " page-content--workspace-focus" : ""}">${workspace}</div></main></div></div></body></html>`;
};

for (const width of [390, 768, 1024, 1440]) {
  for (const sidebar of ["collapsed", "expanded"]) {
    test(`opening and closing case details preserves layout at ${width}px with ${sidebar} sidebar`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        // Cases can be opened from the module library, Story links, or a run
        // inspector. Include return transitions to catch lingering shell rules.
        for (const mode of ["browse", "module", "case", "module", "story", "case", "story", "run", "browse"]) {
          await page.setContent(markup(mode, sidebar, width));
          const bounds = await page.evaluate(() => {
            const rect = selector => {
              const element = document.querySelector(selector);
              const box = element.getBoundingClientRect();
              return { x: box.x, width: box.width, height: box.height, display: getComputedStyle(element).display };
            };
            return { main: rect(".workspace-main"), panel: rect(".workspace-master-detail-panel"), sidebar: rect(".sidebar"), content: rect(".page-content") };
          });
          const focused = mode === "case" || mode === "run";
          if (focused || width <= 768) {
            assert.ok(Math.abs(bounds.main.width - width) < 1, `${mode}: main width ${bounds.main.width} should fill ${width}`);
            assert.ok(Math.abs(bounds.main.x) < 1, `${mode}: main starts at viewport edge`);
          } else {
            assert.notEqual(bounds.sidebar.display, "none", `${mode}: sidebar restored`);
            assert.ok(bounds.main.width > width * 0.65, `${mode}: main must not occupy sidebar column`);
            assert.ok(Math.abs(bounds.main.x - bounds.sidebar.width) < 1, `${mode}: main follows sidebar`);
          }
          assert.ok(bounds.panel.width > bounds.main.width * 0.85, `${mode}: detail fills content column`);
          assert.ok(bounds.panel.x + bounds.panel.width <= width + 1, `${mode}: detail stays inside viewport`);
          if (focused) {
            assert.equal(bounds.sidebar.display, "none", `${mode}: focused sidebar hidden`);
            assert.ok(bounds.content.height > 850, `${mode}: focused content fills viewport height`);
          }
        }
      } finally { await page.close(); }
    });
  }
}
