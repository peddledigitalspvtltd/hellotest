import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../../platform/frontend/", import.meta.url);
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CaseRunAttachmentPanel } from "/services/testing/frontend/components/CaseRunAttachmentPanel";
import { prepareExecutionAttachment, isAnimatedPng } from "/services/testing/frontend/lib/executionAttachments";
import { api } from "/src/lib/api";
import "/src/styles.css";
window.fixtureState = { uploads: [], deletes: [], ensured: [], starts: 0, case: "first", permissions: true, rows: new Map(), records: new Map(), failUpload: false };
const state = window.fixtureState;
api.attachments.meta = async () => ({ enabled: true, uploadLimit: 25 * 1024 * 1024 });
api.executionResultAttachments.list = async id => state.rows.get(id) || [];
api.executionResultAttachments.upload = async (id, file) => {
  if (state.failUpload) throw new Error("Storage unavailable; retry the upload.");
  const row = { id: "attachment-" + (state.uploads.length + 1), entity_id: id, entity_type: "execution_result", project_id: "project", filename: file.name, mimeType: file.type, size: file.size, created: "2026-09-10T08:00:00Z" };
  state.uploads.push({ resultId: id, name: file.name, size: file.size, mime: file.type, isFile: file instanceof File });
  state.rows.set(id, [...(state.rows.get(id) || []), row]);
  return { attachment: row, revision: 1 };
};
api.executionResultAttachments.delete = async (resultId, id) => {
  state.deletes.push({ resultId, id }); state.rows.set(resultId, state.rows.get(resultId).filter(row => row.id !== id));
  return { deleted: true, id, revision: 1 };
};
api.executionResults.transition = async () => { state.starts++; throw new Error("An attachment must not start a case"); };
window.verifyCompression = async () => {
  const canvas = document.createElement("canvas"); canvas.width = 2600; canvas.height = 1500;
  const context = canvas.getContext("2d"); const pixels = context.createImageData(canvas.width, canvas.height);
  let seed = 117;
  for (let i = 0; i < pixels.data.length; i += 4) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels.data[i] = seed & 255; pixels.data[i+1] = (seed >>> 8) & 255; pixels.data[i+2] = (seed >>> 16) & 255; pixels.data[i+3] = 180; }
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  const large = new File([blob], "large-screenshot.png", { type: "image/png" }); window.largeFixtureFile = large;
  const compressed = await prepareExecutionAttachment(large);
  const bitmap = await createImageBitmap(compressed);
  const alphaCanvas = document.createElement("canvas"); alphaCanvas.width = 1; alphaCanvas.height = 1;
  const alphaContext = alphaCanvas.getContext("2d"); alphaContext.drawImage(bitmap, 0, 0);
  const alpha = alphaContext.getImageData(0, 0, 1, 1).data[3]; const width = bitmap.width; bitmap.close();
  const small = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "small.png", { type: "image/png" });
  const animation = new Uint8Array(1024 * 1024 + 100); animation.set([137,80,78,71,13,10,26,10]); animation.set([0,0,0,8,97,99,84,76], 8);
  const animatedPng = new File([animation], "animated.png", { type: "image/png" });
  const webp = new File([new Uint8Array(1024 * 1024 + 100)], "animated.webp", { type: "image/webp" });
  const text = new File(["case evidence"], "trace.log");
  return { sourceSize: large.size, outputSize: compressed.size, mime: compressed.type, name: compressed.name, width, alpha,
    smallPreserved: await prepareExecutionAttachment(small) === small, animatedPngPreserved: await prepareExecutionAttachment(animatedPng) === animatedPng,
    webpPreserved: await prepareExecutionAttachment(webp) === webp, animationDetected: isAnimatedPng(animation), textMime: (await prepareExecutionAttachment(text)).type };
};
function Fixture() {
  const [selected, setSelected] = useState("first");
  const [canEdit, setCanEdit] = useState(true);
  const [generation, setGeneration] = useState(0);
  state.case = selected;
  const id = state.records.get(selected)?.id;
  return <main style={{ maxWidth: 800, margin: "auto", padding: 16 }}>
    <button onClick={() => setSelected(selected === "first" ? "second" : "first")}>Switch case</button>
    <button onClick={() => setCanEdit(!canEdit)}>Toggle attachment permissions</button>
    <button onClick={() => setGeneration(generation + 1)}>Reopen attachments</button>
    <h1>{selected} case</h1>
    <CaseRunAttachmentPanel key={selected + generation} resultId={id} executionId="run" testCaseId={selected} iterationKey="row-0"
      canView canUpload={canEdit} canDelete={canEdit} ensureResult={async () => {
        state.ensured.push(selected);
        const result = { id: "result-" + selected, revision: 1, status: "pending", duration_ms: 0, started_at: null };
        state.records.set(selected, result); return result;
      }} />
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Fixture /></QueryClientProvider>);
`;

test("case attachment preparation preserves animations and uploads files into a pending case-result scope", { timeout: 90000 }, async () => {
  const name = "attachment-browser-" + randomUUID();
  const paths = [new URL(name + ".html", root), new URL(name + ".tsx", root)];
  let browser;
  try {
    await writeFile(paths[0], `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(paths[1], fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`);
    await page.getByRole("heading", { name: "first case", exact: true }).waitFor();
    const compressed = await page.evaluate(() => window.verifyCompression());
    assert.ok(compressed.sourceSize > 1024 * 1024);
    assert.ok(compressed.outputSize < compressed.sourceSize);
    assert.equal(compressed.mime, "image/webp");
    assert.equal(compressed.name, "large-screenshot.webp");
    assert.equal(compressed.width, 2400);
    assert.ok(Math.abs(compressed.alpha - 180) <= 2, "Transparent screenshots retain their alpha channel");
    assert.equal(compressed.smallPreserved, true);
    assert.equal(compressed.animatedPngPreserved, true);
    assert.equal(compressed.webpPreserved, true);
    assert.equal(compressed.animationDetected, true);
    assert.equal(compressed.textMime, "text/plain");
    await page.evaluate(() => {
      const files = new DataTransfer(); files.items.add(window.largeFixtureFile);
      const input = document.querySelector('[aria-label="Choose case attachments"]'); input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByRole("status").filter({ hasText: "1 attachment saved" }).waitFor();
    const state = await page.evaluate(() => ({ uploads: window.fixtureState.uploads, ensured: window.fixtureState.ensured, starts: window.fixtureState.starts, result: window.fixtureState.records.get("first") }));
    assert.deepEqual(state.ensured, ["first"]);
    assert.equal(state.starts, 0);
    assert.equal(state.result.status, "pending");
    assert.equal(state.result.started_at, null);
    assert.equal(state.result.duration_ms, 0);
    assert.equal(state.uploads[0].resultId, "result-first");
    assert.equal(state.uploads[0].mime, "image/webp");
    assert.equal(state.uploads[0].isFile, true);
    await page.getByRole("button", { name: "Reopen attachments", exact: true }).click();
    await page.getByRole("button", { name: "Download large-screenshot.webp", exact: true }).waitFor();
    await page.getByRole("button", { name: "Switch case", exact: true }).click();
    await page.getByRole("heading", { name: "second case", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Download large-screenshot.webp", exact: true }).count(), 0);
    await page.getByLabel("Choose case attachments").setInputFiles({ name: "result.log", mimeType: "", buffer: Buffer.from("second case evidence") });
    await page.getByRole("status").filter({ hasText: "1 attachment saved" }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureState.uploads.at(-1).resultId), "result-second");
    await page.getByRole("button", { name: "Delete result.log", exact: true }).click();
    await page.getByRole("button", { name: "Delete attachment", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Attachment removed" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixtureState.deletes), [{ resultId: "result-second", id: "attachment-2" }]);
    await page.evaluate(() => window.fixtureState.failUpload = true);
    await page.getByLabel("Choose case attachments").setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry evidence") });
    await page.getByRole("alert").filter({ hasText: "Storage unavailable" }).waitFor();
    await page.evaluate(() => window.fixtureState.failUpload = false);
    await page.getByLabel("Choose case attachments").setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry evidence") });
    await page.getByRole("button", { name: "Download retry.txt", exact: true }).waitFor();
    await page.getByRole("button", { name: "Toggle attachment permissions", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Browse files", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Delete retry.txt", exact: true }).count(), 0);
    for (const width of [1000, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Attachment panel fits at ${width}px`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled(paths.map(path => unlink(path)));
  }
});
