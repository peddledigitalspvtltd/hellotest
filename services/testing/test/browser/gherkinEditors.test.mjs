import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

// Run against npm run dev. Supply PLAYWRIGHT_MODULE and CHROME_EXECUTABLE when
// using an existing browser installation instead of Playwright's bundled one.
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../../platform/frontend/", import.meta.url);
const longValue = "customer-" + "long-unbroken-value".repeat(80);
const fragment = 'Given use @t.customer then continue\nWhen submit the message\n  """\n  Given this is literal payload\n  """\nAnd confirm review\nThen see success\nAnd record event';
const fixtureSource = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "/src/auth/AuthContext";
import { GherkinEditor } from "/services/testing/frontend/components/GherkinEditor";
import { SharedStepGherkinEditor } from "/services/testing/frontend/components/SharedStepGherkinEditor";
import { StepParameterDialog } from "/services/testing/frontend/components/StepParameterDialog";
import { buildStepParameterDefinitionsFromValues } from "/src/shared/lib/stepParameters";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const fragment = ${JSON.stringify(fragment)};
const initial = "Feature: Editor checks\\n\\nScenario: Editor checks\\n" + fragment;
const defaults = { "t.customer": ${JSON.stringify(longValue)}, "t.dynamic": "{{randomString:12}}", "t.second": "second value" };
function Fixture() {
  const [caseValue, setCaseValue] = useState(initial);
  const [sharedValue, setSharedValue] = useState(fragment);
  const [values, setValues] = useState(defaults);
  const [dialog, setDialog] = useState(false);
  return <main style={{ padding: 16, maxWidth: 1000, margin: "auto" }}>
    <button onClick={() => { setCaseValue(initial); setSharedValue(fragment); }}>Reset editors</button>
    <button onClick={() => setDialog(true)}>Open parameters</button>
    <div className="case-host test-case-workspace-shell"><div className="test-case-details-form"><div className="test-case-detail-primary">
      <GherkinEditor value={caseValue} onChange={setCaseValue} featureTitle="Editor checks" minimalBehaviorEditor parameterValues={values} />
    </div></div></div>
    <div className="shared-host"><SharedStepGherkinEditor value={sharedValue} onChange={setSharedValue} groupName="Reusable checkout" parameterValues={values} /></div>
    <output hidden data-testid="case-source">{caseValue}</output><output hidden data-testid="shared-source">{sharedValue}</output>
    {dialog ? <StepParameterDialog title="Test Params" subtitle="Review parameter values" parameters={buildStepParameterDefinitionsFromValues(values)} values={values} onChange={(name, value) => setValues(current => ({ ...current, [name]: value }))} onClose={() => setDialog(false)} previewValues={{ "t.dynamic": ${JSON.stringify(longValue)} }} /> : null}
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Fixture /></AuthProvider></QueryClientProvider>);
`;

test("Gherkin parameters and arbitrary step moves work with application CSS", { timeout: 90000 }, async () => {
  const name = `gherkin-qa-${randomUUID()}`;
  const htmlPath = new URL(`${name}.html`, frontendRoot);
  const sourcePath = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  try {
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(sourcePath, fixtureSource);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`);
    await page.getByRole("button", { name: "Open parameters", exact: true }).waitFor();
    if (process.env.BROWSER_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, "gherkin-editors-desktop.png"), fullPage: true, animations: "disabled" });

    for (const [host, label, sourceId] of [[".case-host", "behavior step", "case-source"], [".shared-host", "shared Gherkin step", "shared-source"]]) {
      const preview = page.locator(`${host} .gherkin-step-value-button`);
      assert.equal(await preview.innerText(), `use ${longValue} then continue`);
      assert.equal(await preview.locator("input").count(), 0);
      const bounds = await preview.evaluate(el => ({ height: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      assert.ok(bounds.height > 26, "long resolved values wrap into multiple lines");
      assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, "the preview has no horizontal overflow");
      await preview.click();
      const input = page.locator(`${host} .gherkin-step-text-input`).first();
      assert.equal(await input.inputValue(), "use @t.customer then continue");
      assert.equal(await input.evaluate(el => el === document.activeElement), true);
      await input.press("Tab");
      assert.equal(await preview.count(), 1, "blur restores the resolved preview");

      await page.getByRole("combobox", { name: `Move ${label} 1 to position`, exact: true }).selectOption({ value: "4" });
      let source = await page.getByTestId(sourceId).textContent();
      assert.ok(source.indexOf("And record event") < source.indexOf("Given use @t.customer"), `${host}: ${source}`);
      assert.ok(source.includes('When submit the message\n  """\n  Given this is literal payload\n  """'));

      await page.getByRole("button", { name: "Reset editors", exact: true }).click();
      const row = page.locator(`${host} .gherkin-minimal-step`).nth(3);
      const handle = page.getByRole("button", { name: `Drag ${label} 1 to reorder`, exact: true });
      await handle.scrollIntoViewIfNeeded();
      const handleBounds = await handle.boundingBox();
      const start = { x: handleBounds.x + handleBounds.width / 2, y: handleBounds.y + handleBounds.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 12, { steps: 4 });
      await row.scrollIntoViewIfNeeded();
      const rowBounds = await row.boundingBox();
      await page.mouse.move(rowBounds.x + 30, rowBounds.y + rowBounds.height - 2, { steps: 12 });
      await page.mouse.up();
      source = await page.getByTestId(sourceId).textContent();
      assert.ok(source.indexOf("Then see success") < source.indexOf("Given use @t.customer"), `${host}: ${source}`);
      assert.ok(source.indexOf("Given use @t.customer") < source.indexOf("And record event"));
      await page.getByRole("button", { name: "Reset editors", exact: true }).click();
    }

    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("button", { name: "Open parameters", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Test Params", exact: true });
      await dialog.waitFor();
      if (process.env.BROWSER_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `gherkin-parameters-${width}.png`), animations: "disabled" });
      const geometry = await dialog.evaluate(el => {
        const rows = [...el.querySelectorAll(".step-parameter-row")].map(row => row.getBoundingClientRect());
        const overflow = [...el.querySelectorAll(".step-parameter-input-row, .step-parameter-value-input, .step-parameter-resolved-preview")].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className);
        const bounds = el.getBoundingClientRect();
        return { rows: rows.map(row => ({ top: row.top, bottom: row.bottom })), left: bounds.left, right: bounds.right, viewport: innerWidth, overflow };
      });
      assert.deepEqual(geometry.overflow, [], `parameter values fit at ${width}px`);
      assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `dialog fits viewport at ${width}px`);
      for (let i = 1; i < geometry.rows.length; i++) assert.ok(geometry.rows[i - 1].bottom <= geometry.rows[i].top + 1, `parameter rows do not overlap at ${width}px`);
      const fields = dialog.locator("textarea.step-parameter-value-input");
      assert.equal(await fields.first().inputValue(), longValue);
      await fields.first().fill("first line\nsecond line");
      assert.equal(await fields.first().inputValue(), "first line\nsecond line");
      await fields.first().fill(longValue);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      for (const host of [".case-host", ".shared-host"]) {
        const fit = await page.locator(`${host} .gherkin-step-value-button`).evaluate(el => el.scrollWidth <= el.clientWidth + 1);
        assert.equal(fit, true, `Gherkin values wrap at ${width}px`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([unlink(htmlPath).catch(() => {}), unlink(sourcePath).catch(() => {})]);
  }
});
