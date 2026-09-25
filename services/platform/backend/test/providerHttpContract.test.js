const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { _internals } = require("../src/utils/llmHttpClient");
const { readBoundedResponseBuffer } = require("../src/utils/boundedResponse");

test("LLM provider responses are bounded before callers parse them", async () => {
  let aborted = false;
  const controller = { abort: () => { aborted = true; } };
  const oversized = new Response(Buffer.alloc(2_048), {
    headers: { "content-length": "2048", "content-type": "application/json" }
  });

  await assert.rejects(
    _internals.bufferResponseWithinDeadline(oversized, controller, 1_024),
    /exceeded 1024 bytes/
  );
  assert.equal(aborted, true);

  const safe = new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" }
  });
  const buffered = await _internals.bufferResponseWithinDeadline(safe, { abort() {} }, 1_024);
  assert.deepEqual(await buffered.json(), { ok: true });
});

test("the shared LLM client applies bounded buffering by default", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/utils/llmHttpClient.js"), "utf8");
  assert.match(source, /resilientHttpRequest\(url, init/);
  assert.match(source, /bufferResponse: options\.bufferResponse !== false/);
  assert.match(source, /idempotent: options\.idempotent === true/);
});

test("chunked provider responses are stopped when they cross the byte budget", async () => {
  let aborted = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(800));
      controller.enqueue(new Uint8Array(800));
      controller.close();
    }
  }));

  await assert.rejects(readBoundedResponseBuffer(response, {
    maxBytes: 1_024,
    abort: () => { aborted = true; },
    label: "Test provider response"
  }), /Test provider response exceeded 1024 bytes/);
  assert.equal(aborted, true);
});

test("non-LLM provider adapters use timeouts and bounded readers", () => {
  for (const [relativePath, label] of [
    ["../../../integration/backend/services/integration.service.js", "Integration provider response"],
    ["../../../automation/backend/services/localAgent.service.js", "Local execution provider response"],
    ["../../../manual/backend/services/requirement.service.js", "Connected workspace response"],
    ["../../../integration/backend/services/projectSync.service.js", "Synchronization provider response"]
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.ok(source.includes(label), `${relativePath} must use its bounded provider response contract`);
  }
});
