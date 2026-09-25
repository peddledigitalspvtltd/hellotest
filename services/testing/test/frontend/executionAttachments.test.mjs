import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const load = () => {
  const state = { enabled: true, uploads: [] };
  const api = { attachments: { meta: async () => ({ enabled: state.enabled, uploadLimit: 25 * 1024 * 1024 }) }, executionResultAttachments: {
    upload: async (id, file, options) => { state.uploads.push({ id, file, options }); return { attachment: { id: "attachment" }, revision: 4 }; }
  } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("../../frontend/lib/executionAttachments.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({ platformApi: api, testingApi: api }), File, Uint8Array, DataView, Blob, Set, URL });
  return { helper: exports, state };
};

test("evidence MIME inference supports native log/text files while rejecting active HTML", async () => {
  const { helper } = load();
  assert.equal(helper.executionAttachmentMimeType({ name: "failure.LOG", type: "" }), "text/plain");
  assert.equal(helper.executionAttachmentMimeType({ name: "trace.zip", type: "application/octet-stream" }), "application/zip");
  assert.throws(() => helper.executionAttachmentMimeType({ name: "report.html", type: "text/html" }), /Use an image/);
  const original = new File(["exact recorded evidence"], "failure.log");
  const prepared = await helper.prepareExecutionAttachment(original);
  assert.equal(prepared.type, "text/plain");
  assert.equal(await prepared.text(), "exact recorded evidence");
});

test("small evidence and media keep their original bytes; invalid size rejects before conversion", async () => {
  const { helper } = load();
  for (const [name, mime] of [["screenshot.png", "image/png"], ["clip.webm", "video/webm"], ["motion.webp", "image/webp"], ["archive.zip", "application/zip"]]) {
    const file = new File([new Uint8Array([0, 1, 99, 255])], name, { type: mime });
    assert.equal(await helper.prepareExecutionAttachment(file), file);
  }
  await assert.rejects(helper.prepareExecutionAttachment(new File([], "empty.txt", { type: "text/plain" })), /non-empty/);
  await assert.rejects(helper.prepareExecutionAttachment({ size: helper.MAX_EXECUTION_ATTACHMENT_BYTES + 1 }), /25 MB/);
  await assert.rejects(helper.prepareExecutionAttachment(new File(["0123456789"], "size.txt", { type: "text/plain" }), 5), /1 KB/);
});

test("animated PNG detection walks metadata chunks without confusing static image data", () => {
  const { helper } = load();
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (name, data = []) => [0, 0, 0, data.length, ...name.split("").map(char => char.charCodeAt(0)), ...data, 0, 0, 0, 0];
  assert.equal(helper.isAnimatedPng(new Uint8Array([...signature, ...chunk("tEXt", [65]), ...chunk("acTL", [0, 0])])), true);
  assert.equal(helper.isAnimatedPng(new Uint8Array([...signature, ...chunk("IDAT", [97, 99, 84, 76])])), false);
  assert.equal(helper.isAnimatedPng(new Uint8Array([...signature, 127, 255, 255, 255, 97, 99, 84, 77])), false);
});

test("step upload sends a File with the internal result and revision, never inline file data", async () => {
  const { helper, state } = load();
  const file = new File(["recorded evidence"], "evidence.txt", { type: "text/plain" });
  const options = { stepId: "frozen-step", expectedRevision: 3 };
  const saved = await helper.uploadExecutionAttachment("internal-result", file, options);
  assert.equal(saved.revision, 4);
  assert.equal(state.uploads[0].id, "internal-result");
  assert.equal(state.uploads[0].file, file);
  assert.equal(state.uploads[0].options, options);
  state.enabled = false;
  await assert.rejects(helper.uploadExecutionAttachment("internal-result", file), /storage is disabled/);
  await assert.rejects(helper.uploadExecutionAttachment("", file), /Save the case result/);
  assert.equal(state.uploads.length, 1);
});
