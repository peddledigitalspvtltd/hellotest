import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);

test("workspace discovery supports keyboard navigation, private recents, non-destructive refresh and responsive chrome", { timeout: 120000 }, async () => {
  const source = await readFile(new URL("./workspaceShell.test.mjs", import.meta.url), "utf8");
  let fixture = source.match(/const fixture=`([\s\S]*?)`;\nconst adminFixture/)[1];
  fixture += "\nimport '/src/product-experience.css';";
  fixture = fixture.replace(/import \{(?:IssuesPage|SettingsPage|AgenticWorkflowsPage|RequirementsPage|TestCasesPage|ExecutionsPage)\} from '[^']+';/g, "");
  fixture = fixture.replace(/function Screen\(\)\{[^\n]*\}/, "function Screen(){const route=useLocation();const auth=useAuth();window.testRestrict=async()=>{session.user.role='member';session.user.workspace_permissions=['workspace.view'];session.user.project_permissions={project:['dashboard.view']};await auth.refreshSession()};return route.pathname==='/'?<OverviewPage/>:<div className='page-content'><h1>Test Case Library</h1><label>Unsaved draft<input aria-label='Unsaved draft' defaultValue='Keep this edit'/></label></div>}");
  fixture = fixture.replace("get:()=>!search.has('disabled')", "get:(_,key)=>key!=='hellotest.ai.chatbot'&&!search.has('disabled')");
  const name = "workspace-discovery-" + randomUUID();
  const html = new URL(name + ".html", root), tsx = new URL(name + ".tsx", root);
  const artifacts = process.env.WORKSPACE_SCREENSHOT_DIR || "/tmp/qaira-workspace-redesign";
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(12000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5179"}/${name}.html`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "Investigate 2 failed or blocked results", exact: true }).waitFor();
    assert.equal(await page.locator(".qa-header-actions").getByRole("button", { name: "Explain project signals", exact: true }).count(), 1);
    await page.screenshot({ path: artifacts + "/dashboard-desktop.png", fullPage: true });

    for(const icon of await page.locator('.workspace-scope-trigger__icon').all()) {
      const style=await icon.evaluate(node=>({foreground:getComputedStyle(node).color,opacity:getComputedStyle(node).opacity,project:Boolean(node.closest('.workspace-scope-trigger--project'))}));assert.equal(style.opacity,'1');assert.equal(style.foreground,style.project?'rgb(249, 164, 135)':'rgb(169, 217, 195)','Scope icons retain their dark-sidebar colors in light theme');
    }
    const scopeColors=await page.locator('.workspace-scope-trigger__icon').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    assert.deepEqual(await page.locator('.workspace-scope-trigger__icon').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color)),scopeColors);
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    for (const name of ['Project Overview', 'Test Runs & Results', 'Test Plan', 'Agentic AI Studio', 'AI Knowledge Base', 'Test Automation', 'Test Data & Configuration']) {
      const link = page.locator('#app-sidebar').getByRole('link', {name,exact:true});
      await link.waitFor();
      assert.equal(await link.locator('.nav-link-icon > :not(.nav-link-icon-badge)').count(),1, `${name} has its previous icon`);
    }
    const automationLink = page.locator('#app-sidebar [data-nav-identity="automation"]');
    const planningLink = page.locator('#app-sidebar [data-nav-identity="test-plan"]');
    assert.ok((await automationLink.boundingBox()).y < (await planningLink.boundingBox()).y, 'Automation appears before Test Plan');
    const dataLink = page.locator('#app-sidebar [data-nav-identity="environment"]');
    assert.ok((await dataLink.boundingBox()).y < (await planningLink.boundingBox()).y, 'Test Data & Configuration appears before Test Plan');
    const planningIcon = await page.locator('[data-nav-identity="test-plan"] .nav-link-icon > :not(.nav-link-icon-badge)').boundingBox();
    const standardIcon = await page.locator('[data-nav-identity="projects"] .nav-link-icon > :not(.nav-link-icon-badge)').boundingBox();
    assert.equal(planningIcon.width, 19, 'Navigation uses the administration icon canvas');
    assert.equal(planningIcon.width, standardIcon.width, 'Sidebar icons share the same canvas');
    assert.equal(await page.locator('#app-sidebar .nav-group-label').count(), 0, 'Sidebar has no section labels');
    const order = await page.locator('#app-sidebar .nav-link').evaluateAll(nodes => nodes.map(node => node.dataset.navIdentity));
    assert.deepEqual(order.slice(0, 5), ['overview', 'projects', 'agentic-workflows', 'knowledge', 'product-management']);
    const sidebarBox = await page.locator('#app-sidebar').boundingBox();assert.ok(Math.abs(sidebarBox.width-256)<2,'expanded desktop sidebar matches administration at 256px: '+sidebarBox.width);
    assert.equal(await page.locator('#app-sidebar .nav-link-label').first().evaluate(node=>getComputedStyle(node).fontSize),'12px');
    assert.match(await page.locator('#app-sidebar').evaluate(node=>getComputedStyle(node).backgroundImage), /rgb\(16, 38, 53\)/, 'Sidebar uses the administration navy background');
    assert.equal(await page.locator('#app-sidebar .nav-link.is-active').first().evaluate(node=>getComputedStyle(node).color), 'rgb(255, 255, 255)', 'Selected navigation stays readable on navy');
    await page.locator('.nav-list').evaluate(node=>node.scrollTop=node.scrollHeight);
    const collapseIcon=await page.getByRole('button',{name:'Collapse sidebar',exact:true}).locator('svg').boundingBox();
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    await page.locator('.sidebar.is-collapsed').waitFor();
    const expandIcon=await page.getByRole('button',{name:'Expand sidebar',exact:true}).locator('svg').boundingBox();
    assert.equal(expandIcon.width,collapseIcon.width);assert.equal(expandIcon.height,collapseIcon.height);
    const dashboardIcon=page.locator('[data-nav-identity="overview"] .nav-link-icon svg');assert.equal(await dashboardIcon.isVisible(),true);
    const iconBounds=await dashboardIcon.boundingBox();const collapsedBounds=await page.locator('#app-sidebar').boundingBox();assert.ok(iconBounds.width>0&&iconBounds.x>=collapsedBounds.x&&iconBounds.x+iconBounds.width<=collapsedBounds.x+collapsedBounds.width,'Dashboard icon fits the collapsed rail');
    const navigationBounds=await page.locator('.nav-list').boundingBox();assert.ok(iconBounds.y>=navigationBounds.y&&iconBounds.y+iconBounds.height<=navigationBounds.y+navigationBounds.height,'Dashboard remains visible after collapsing a scrolled sidebar');
    const scopeBounds = await page.locator('.workspace-project-switcher').boundingBox();
    for (const id of ['overview', 'projects']) {
      const link = page.locator(`#app-sidebar [data-nav-identity="${id}"]`);
      const bounds = await link.boundingBox();
      assert.ok(bounds.y >= scopeBounds.y + scopeBounds.height, `${id} stays below the project and app selectors`);
      assert.ok(bounds.y >= navigationBounds.y && bounds.y + bounds.height <= navigationBounds.y + navigationBounds.height, `${id} stays inside the collapsed navigation viewport`);
      const clickable = await link.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      assert.equal(clickable, true, `${id} is not covered by another sidebar control`);
    }
    await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
    const options = page.getByRole("button", { name: "Workspace options", exact: true });
    await options.click();
    await page.getByRole("menuitem", { name: "Language & region", exact: true }).waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getByRole("menuitem", { name: "Switch to dark theme", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await options.evaluate(element => element === document.activeElement), true);
    const calls = await page.evaluate(() => window.overviewCalls.length);
    await options.click();
    await page.getByRole("menuitem", { name: "Refresh current screen", exact: true }).click();
    await page.waitForFunction(count => window.overviewCalls.length > count, calls);
    assert.equal(await page.locator(".qa-metric strong").first().textContent(), "75%");

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "What would you like to do?", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.locator(".navigator-result").count(), 10);
    await page.screenshot({ path: artifacts + "/navigator-desktop.png" });
    const search = dialog.getByRole("searchbox");
    await search.fill("test cases");
    await search.press("ArrowDown");
    assert.equal(await dialog.getByRole("link", { name: "Test cases", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("ArrowUp");
    assert.equal(await search.evaluate(element => element === document.activeElement), true);
    await search.press("Enter");
    await page.getByRole("heading", { name: "Test Case Library", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Unsaved draft", exact: true }).fill("Edited but not saved");
    await options.click(); await page.getByRole("menuitem", { name: "Refresh current screen", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Unsaved draft", exact: true }).inputValue(), "Edited but not saved");
    await page.keyboard.press("Control+k");
    await dialog.waitFor();
    assert.equal(await dialog.locator(".navigator-result-title").first().textContent(), "Test cases");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.testRestrict());
    await page.getByRole("heading", { name: "You need access to this area", exact: true }).waitFor();
    await page.keyboard.press("Control+k");
    await dialog.waitFor(); await dialog.getByRole("searchbox").fill("test cases");
    assert.equal(await dialog.getByRole("link", { name: "Test cases", exact: true }).count(), 0);
    await page.keyboard.press("Escape");

    await page.goto(url);
    await page.getByRole("heading", { name: "Investigate 2 failed or blocked results", exact: true }).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: artifacts + `/dashboard-mobile-${width}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#app-sidebar").contains(document.activeElement));
    await page.screenshot({ path: artifacts + "/navigation-mobile.png" });
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Open navigation", exact: true }).evaluate(element => element === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
