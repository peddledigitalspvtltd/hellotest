import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(new URL("../../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);
const main = await readFile(new URL("src/main.tsx", root), "utf8");
const appStyles = [...main.matchAll(/^import "\.\/(.+\.css)";$/gm)].map(([, path]) => `import "/src/${path}";`).join("\n");
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "/src/platform/components/AppShell";
import { AuthProvider } from "/src/auth/AuthContext";
import { LocalizationProvider } from "/src/context/LocalizationContext";
import { api, sessionStorage } from "/src/lib/api";
import { setCurrentScope } from "/src/platform/hooks/useCurrentProject";
${appStyles}
const shortLayout = new URLSearchParams(location.search).has("short-layout");
const session = { token: "modal-scroll-fixture", user: { id: "reviewer", name: "Reviewer", role: "admin", email: "reviewer@example.test" } };
function stub(object) {
  for (const [name, value] of Object.entries(object)) {
    if (typeof value === "function") object[name] = async () => [];
    else if (value && typeof value === "object") stub(value);
  }
}
stub(api);
sessionStorage.write(session);
setCurrentScope("project", "web");
api.auth.session = async () => session;
api.settings.getLocalization = async () => ({ strings: {} });
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: (_, key) => key !== "hellotest.ai.chatbot" || shortLayout }) });
api.projects.list = async () => [{ id: "project", name: "Commerce platform", status: "active" }];
api.metadata.workspaceScopes = async () => ({ projects: await api.projects.list() });
api.appTypes.list = async () => [{ id: "web", name: "Checkout", project_id: "project", type: "web" }];
api.notifications.unreadCount = async () => ({ total: 0, by_preference: {} });
api.metadata.domain = async () => ({});
function Screen() {
  const [open, setOpen] = useState(false);
  return <section className="page-content" style={{ padding: 20 }}>
    <h1>Workspace scroll fixture</h1>
    <button onClick={() => setOpen(true)}>Open inline dialog</button>
    {!shortLayout && Array.from({ length: 25 }, (_, index) => <p key={index} style={{ minHeight: 75 }}>Workspace record {index + 1}</p>)}
    {open && <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true" aria-label="Inline dialog">
      <button onClick={() => setOpen(false)}>Close inline dialog</button>
    </div></div>}
  </section>;
}
const router = createMemoryRouter([{ path: "/", element: <AppShell />, children: [{ index: true, element: <Screen /> }] }]);
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider><LocalizationProvider><RouterProvider router={router}/></LocalizationProvider></AuthProvider>
  </QueryClientProvider>
);
`;

async function readScrollState(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector("#app-sidebar");
    const nav = sidebar.querySelector(".nav-list");
    const footerBottom = sidebar.querySelector(".sidebar-footer").getBoundingClientRect().bottom;
    const { top, width, height } = sidebar.getBoundingClientRect();
    const { backgroundColor, backgroundImage } = getComputedStyle(sidebar);
    return { pageTop: document.scrollingElement.scrollTop, navTop: nav.scrollTop, top, width, height, footerBottom, backgroundColor, backgroundImage };
  });
}

async function withWorkspaceFixture(check) {
  const name = "workspace-modal-scroll-" + randomUUID();
  const html = new URL(name + ".html", root), tsx = new URL(name + ".tsx", root);
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/${name}.tsx"></script>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    await check(browser, `${process.env.VITE_TEST_URL || "http://127.0.0.1:5179"}/${name}.html`);
  } finally {
    await browser?.close();
    await Promise.all([rm(html, { force: true }), rm(tsx, { force: true })]);
  }
}

test("modal opening and closing preserve the workspace and sidebar scroll positions", { timeout: 45000 }, async () => {
  await withWorkspaceFixture(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 540 }, reducedMotion: "reduce" });
    await page.goto(url);
    await page.getByRole("heading", { name: "Workspace scroll fixture" }).waitFor();
    await page.mouse.move(900, 360);
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.scrollingElement.scrollTop > 0, undefined, { timeout: 3000 });
    const start = page.locator('#app-sidebar [data-nav-identity="overview"]');
    await start.focus();
    await page.evaluate(() => {
      document.querySelector(".nav-list").scrollTop = 100;
      document.scrollingElement.scrollTop = 240;
    });
    const scrolled = await readScrollState(page);
    assert.ok(scrolled.pageTop > 0 && scrolled.navTop > 0, "the fixture scrolls both areas");

    await page.keyboard.press("Control+k");
    const navigator = page.getByRole("dialog", { name: "What would you like to do?" });
    await navigator.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[role="dialog"] input[type="search"]'));
    assert.deepEqual(await readScrollState(page), scrolled, "the modal leaves the workspace and rail in place");
    await page.mouse.move(12, 400);
    await page.mouse.wheel(0, 500);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await readScrollState(page), scrolled, "background wheel input does not scroll the workspace");
    await navigator.locator(".navigator-results").hover();
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => document.querySelector(".navigator-results").scrollTop > 0);
    assert.deepEqual(await readScrollState(page), scrolled, "the dialog can scroll independently");
    await page.keyboard.press("Escape");
    await navigator.waitFor({ state: "hidden" });
    assert.equal(await start.evaluate(element => element === document.activeElement), true, "closing restores keyboard focus");
    assert.deepEqual(await readScrollState(page), scrolled, "focus restoration leaves the sidebar scroll offset in place");

    await page.getByRole("button", { name: "Open inline dialog" }).focus();
    await page.evaluate(() => { document.scrollingElement.scrollTop = 240; });
    const inlineBaseline = await readScrollState(page);
    await page.keyboard.press("Enter");
    const inlineDialog = page.getByRole("dialog", { name: "Inline dialog" });
    await inlineDialog.waitFor();
    assert.deepEqual(await readScrollState(page), inlineBaseline, "inline dialogs share the stable scroll lock");
    await inlineDialog.getByRole("button", { name: "Close inline dialog" }).click();

    await page.mouse.move(900, 360);
    await page.mouse.wheel(0, 10_000);
    await page.waitForFunction(() => {
      const scroll = document.scrollingElement;
      return scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1;
    }, undefined, { timeout: 3000 });
    const bottom = await page.evaluate(() => ({
      mainBottom: document.querySelector(".workspace-main").getBoundingClientRect().bottom,
      lastRecordBottom: document.querySelector(".page-content > p:last-of-type").getBoundingClientRect().bottom,
      viewportBottom: innerHeight
    }));
    assert.ok(Math.abs(bottom.mainBottom - bottom.viewportBottom) <= 1, "the document ends at the workspace content");
    assert.ok(bottom.viewportBottom - bottom.lastRecordBottom >= 0 && bottom.viewportBottom - bottom.lastRecordBottom <= 48,
      `scrolling ends within a small space after the last record (${bottom.viewportBottom - bottom.lastRecordBottom}px)`);

    await page.setViewportSize({ width: 390, height: 620 });
    await page.evaluate(() => { document.scrollingElement.scrollTop = 180; });
    const mobileTop = (await readScrollState(page)).pageTop;
    assert.ok(mobileTop > 0);
    const openNavigation = page.getByRole("button", { name: "Open navigation", exact: true });
    await openNavigation.click();
    await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.scrollingElement).overflowY), "hidden");
    assert.equal((await readScrollState(page)).pageTop, mobileTop);
    await page.keyboard.press("Escape");
    assert.equal(await openNavigation.evaluate(element => element === document.activeElement), true);
    assert.equal((await readScrollState(page)).pageTop, mobileTop, "closing mobile navigation preserves the workspace position");
    await page.mouse.move(195, 480);
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(top => document.scrollingElement.scrollTop > top, mobileTop, { timeout: 3000 });
  });
});

test("assistant loading feedback leaves short workspace pages within the viewport", { timeout: 45000 }, async () => {
  await withWorkspaceFixture(async (browser, url) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }]) {
      const page = await browser.newPage({ viewport });
      let loadAssistant;
      const assistantGate = new Promise((resolve) => { loadAssistant = resolve; });
      try {
        await page.route("**/GroundedAssistant.tsx*", async (route) => {
          await assistantGate;
          await route.continue();
        });
        await page.goto(`${url}?short-layout`, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Workspace scroll fixture" }).waitFor();
        await page.getByText("Loading Ask HelloTest…", { exact: true }).waitFor();
        const geometry = await page.evaluate(() => {
          const shell = document.querySelector(".app-shell");
          return {
            documentHeight: document.scrollingElement.scrollHeight,
            shellBottom: shell.getBoundingClientRect().bottom,
            documentCanvas: getComputedStyle(document.documentElement).backgroundColor,
            shellCanvas: getComputedStyle(shell).backgroundColor,
          };
        });
        assert.equal(geometry.documentHeight, viewport.height, `workspace stays within the viewport at ${viewport.width}px`);
        assert.equal(geometry.shellBottom, viewport.height);
        assert.equal(geometry.documentCanvas, geometry.shellCanvas);
        loadAssistant();
        await page.getByRole("button", { name: "Ask HelloTest", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight), viewport.height);
      } finally {
        loadAssistant();
        await page.close();
      }
    }
  });
});
