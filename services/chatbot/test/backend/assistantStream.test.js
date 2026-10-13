const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { streamAssistant, answerDeliveryEvents } = require("../../backend/http/assistantStream");

function fixture() {
  const raw = new EventEmitter();
  const frames = [];
  Object.assign(raw, {
    writableLength: 0, writableEnded: false, destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(value) { frames.push(value); return true; },
    end() { this.writableEnded = true; },
    destroy() { this.destroyed = true; this.emit("close"); }
  });
  return { raw, frames, reply: { raw, hijack() {}, getHeaders: () => ({ "X-Request-ID": "request" }) }, req: { log: { error() {} } } };
}
const saved = { assistant_message: { id: "answer-1", role: "assistant", content: "Café 🧪 is cited evidence.", citations: [] } };

test("answer delivery is Unicode-safe, bounded and does not deliver pending turns", () => {
  const deltas = [...answerDeliveryEvents(saved, 5)];
  assert.equal(deltas.map(delta => delta.text).join(""), saved.assistant_message.content);
  assert.deepEqual(deltas.map(delta => delta.sequence), deltas.map((_, index) => index));
  assert.ok(deltas.every(delta => delta.verification === "complete" && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(delta.text)));
  assert.deepEqual([...answerDeliveryEvents({ pending: true })], []);
  assert.equal([...answerDeliveryEvents(saved, 0)].length, 1);
});

test("progress precedes checked deltas and only the authoritative result completes delivery", async () => {
  const run = fixture();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const operation = streamAssistant(run.req, run.reply, async ({ onProgress }) => {
    onProgress({ contract_type: "RetrievalEvent", stage: "VALIDATION" });
    await pending;
    return saved;
  });
  assert.equal(run.frames.length, 1, "No answer data before the service has completed its checks and save");
  assert.match(run.frames[0], /^event: progress/);
  finish();
  await operation;
  assert.match(run.frames[1], /^event: answer_delta/);
  assert.match(run.frames.at(-1), /^event: result/);
  assert.equal(run.raw.writableEnded, true);
  assert.equal(run.raw.listenerCount("close"), 0);
  assert.match(run.raw.headers["Content-Type"], /text\/event-stream/);
});

test("disconnect cancels active work and cannot publish a terminal answer", async () => {
  const run = fixture();
  let signal;
  await streamAssistant(run.req, run.reply, async input => {
    signal = input.signal;
    run.raw.destroy();
    return saved;
  });
  assert.equal(signal.aborted, true);
  assert.equal(run.frames.length, 0);
});

test("a failing provider sends a public error, never provider text or a success result", async () => {
  const run = fixture();
  await streamAssistant(run.req, run.reply, async () => { throw Object.assign(new Error("provider body contains secret"), { code: "MODEL_UNAVAILABLE", statusCode: 502 }); });
  assert.equal(run.frames.length, 1);
  assert.match(run.frames[0], /^event: error/);
  assert.doesNotMatch(run.frames[0], /secret|event: result/);
  assert.equal(run.raw.writableEnded, true);
});

test("a slow reader is awaited before more answer data is written", async () => {
  const run = fixture();
  let writes = 0;
  run.raw.write = value => { run.frames.push(value); writes++; if (writes === 1) { queueMicrotask(() => run.raw.emit("drain")); return false; } return true; };
  await streamAssistant(run.req, run.reply, async () => ({ assistant_message: { ...saved.assistant_message, content: "x".repeat(600) } }));
  assert.equal(run.frames.filter(frame => frame.startsWith("event: answer_delta")).length, 3);
  assert.match(run.frames.at(-1), /^event: result/);
  assert.equal(run.raw.listenerCount("drain"), 0);
});

test('verified delivery preserves paragraph boundaries and Markdown across small chunks',()=>{
 const content="First paragraph.\n\nSecond paragraph with **evidence**.\n\n- First outcome\n- Second outcome";
 const events=[...answerDeliveryEvents({assistant_message:{...saved.assistant_message,content}},{chunkSize:7})];
 assert.equal(events.map(event=>event.text).join(''),content);
});
