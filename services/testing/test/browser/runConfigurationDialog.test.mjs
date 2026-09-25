import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../../platform/frontend/", import.meta.url);
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "/src/auth/AuthContext";
import { api, sessionStorage } from "/src/lib/api";
import { RunConfigurationDialog } from "/services/testing/frontend/components/RunConfigurationDialog";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const limited = new URLSearchParams(location.search).has("limited");
const session = { token: "fixture", user: { id: "qa", role: limited ? "member" : "admin", permissions: ["run.view"] } };
sessionStorage.write(session);
api.auth.session = async () => session;
api.metadata.domain = async () => ({ test_environments: { browsers: [], mobile_os: [] }, test_data_sets: { modes: [] } });
window.resourceRequests = 0;
const list = async () => { window.resourceRequests++; return [{ id: "live", project_id: "project", name: "Current staging", description: "Current source", base_url: "https://current.example.test", variables: [] }]; };
api.testEnvironments.list = list; api.testConfigurations.list = list; api.testDataSets.list = list;
const snapshots = {
  environment: { id: "deleted-env", name: "Frozen staging", description: "<p>Environment saved with the run.</p>", base_url: "https://staging.example.test", variables: [{ id: "region", key: "REGION", value: "eu-west-1" }, { id: "secret", key: "API_KEY", value: "", is_secret: true, has_stored_value: true }] },
  configuration: { id: "deleted-config", name: "Frozen device matrix", description: "<p>Three saved combinations.</p>", targets: [{ id: "one", os: "Legacy Linux", browser: "Legacy browser", mobile_os: "", version: "118" }, { id: "two", os: "macOS", browser: "Safari", mobile_os: "iOS", version: "17.4" }, { id: "three", os: "Windows", browser: "Chrome", mobile_os: "", version: "120" }], variables: [] },
  data: { id: "deleted-data", name: "Frozen customer data", description: "<p>Exact resolved customer values.</p>", mode: "table", columns: ["email", "reference"], rows: [{ email: "created-at-run@example.test", reference: "long-value-".repeat(90) }], template_rows: [{ email: "{{yopmail}}", reference: "{{randomString:8}}" }] }
};
function Fixture() {
  const [resource, setResource] = useState(null);
  const isFallback = resource === "missing" || resource === "live";
  return <main style={{ padding: 16 }}>
    {Object.keys(snapshots).map(key => <button key={key} onClick={() => setResource(key)}>Open {key}</button>)}
    <button onClick={() => setResource("missing")}>Open missing</button>
    <button onClick={() => setResource("live")}>Open live</button>
    {resource ? <RunConfigurationDialog resource={isFallback ? "environment" : resource} projectId="project" resourceId={isFallback ? resource : snapshots[resource].id} snapshot={snapshots[resource]} onClose={() => setResource(null)} /> : null}
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AuthProvider><Fixture /></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test("run dialogs reuse read-only resource forms and retain frozen values across viewport sizes", { timeout: 90000 }, async () => {
  const name = `run-configuration-qa-${randomUUID()}`;
  const htmlPath = new URL(`${name}.html`, frontendRoot);
  const sourcePath = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  try {
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(sourcePath, source);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`;
    await page.goto(url);
    for (const width of [1440, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const resource of ["environment", "configuration", "data"]) {
        const trigger = page.getByRole("button", { name: `Open ${resource}`, exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Saved with this run", { exact: true }).waitFor();
        assert.equal(await dialog.locator("form.resource-form").count(), 1);
        assert.equal(await dialog.locator("[contenteditable=true]").count(), 0);
        assert.equal(await dialog.locator("form :is(input, textarea, select, button):enabled").count(), 0);
        assert.equal(await dialog.getByRole("button", { name: "Save", exact: true }).count(), 0);
        const bounds = await dialog.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, height: element.getBoundingClientRect().height, client: element.clientWidth, scroll: element.scrollWidth }));
        assert.ok(bounds.left >= 0 && bounds.right <= width + 1, JSON.stringify({ resource, width, bounds }));
        assert.ok(bounds.height <= 900 && bounds.scroll <= bounds.client + 1, JSON.stringify({ resource, width, bounds }));
        if (resource === "configuration") {
          assert.equal(await dialog.getByRole("combobox", { name: "Host OS for target row 1", exact: true }).inputValue(), "Legacy Linux");
          assert.equal(await dialog.getByRole("combobox", { name: "Browser for target row 1", exact: true }).inputValue(), "Legacy browser");
          assert.equal(await dialog.getByRole("combobox", { name: "Mobile OS for target row 2", exact: true }).inputValue(), "iOS");
          assert.equal(await dialog.locator(".configuration-matrix-table tbody tr").count(), 3);
        }
        if (resource === "data") {
          assert.equal(await dialog.locator('textarea').filter({ hasText: "created-at-run@example.test" }).count(), 1);
          assert.equal(await dialog.getByText("Sample before run").count(), 0);
          assert.equal(await dialog.getByText("{{yopmail}}", { exact: true }).count(), 0);
        }
        if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-${resource}-${width}.png`), animations: "disabled" });
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      }
    }
    assert.equal(await page.evaluate(() => window.resourceRequests), 0, "saved snapshots must not query or depend on deleted originals");
    await page.getByRole("button", { name: "Open missing", exact: true }).click();
    await page.getByText("Environment is no longer available", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.resourceRequests), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "Open live", exact: true }).click();
    await page.getByText(/These are the current resource values/).waitFor();
    assert.equal(await page.locator('input[value="Current staging"]').count(), 1);
    assert.equal(await page.getByText("Saved with this run", { exact: true }).count(), 0);
    await page.keyboard.press("Escape");

    await page.goto(`${url}?limited`);
    await page.getByRole("button", { name: "Open environment", exact: true }).click();
    await page.getByText("Saved with this run", { exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Open current/ }).count(), 0, "run-only access cannot navigate to protected source editors");
    assert.equal(await page.locator('input[value="Frozen staging"]').count(), 1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open live", exact: true }).click();
    await page.getByText("Access is unavailable", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.resourceRequests), 0, "missing-snapshot fallback must respect source permissions");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(htmlPath), unlink(sourcePath)]);
  }
});
