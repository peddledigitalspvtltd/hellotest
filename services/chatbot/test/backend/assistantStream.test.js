const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { streamAssistant, runConnectedAssistant } = require("../../backend/http/assistantStream");

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

test("progress precedes one complete checked result without answer chunks", async () => {
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
  assert.equal(run.frames.length, 2);
  assert.doesNotMatch(run.frames.join(""), /event: answer_delta/);
  assert.deepEqual(JSON.parse(run.frames[1].split("data: ")[1]), saved);
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

test("a slow reader is awaited before closing the complete answer", async () => {
  const run = fixture();
  let writes = 0;
  run.raw.write = value => { run.frames.push(value); writes++; if (writes === 1) { queueMicrotask(() => run.raw.emit("drain")); return false; } return true; };
  await streamAssistant(run.req, run.reply, async () => ({ assistant_message: { ...saved.assistant_message, content: "x".repeat(600) } }));
  assert.equal(run.frames.length, 1);
  assert.equal(run.frames.filter(frame => frame.startsWith("event: answer_delta")).length, 0);
  assert.match(run.frames.at(-1), /^event: result/);
  assert.equal(run.raw.listenerCount("drain"), 0);
});

test('the single result preserves a long Unicode answer, paragraphs and its citation contract', async () => {
 const run = fixture();
 const content = "Café 🧪 first paragraph.\n\nSecond paragraph with **evidence**.\n\n- First outcome\n- Second outcome".repeat(80);
 const complete = { assistant_message: { ...saved.assistant_message, content, answer_contract: { supported_claims: [{ statement: content, citation_ids: ['e1'] }] }, citations: [{ id: 'e1' }] } };
 await streamAssistant(run.req, run.reply, async () => complete);
 assert.equal(run.frames.length, 1);
 assert.match(run.frames[0], /^event: result/);
 assert.deepEqual(JSON.parse(run.frames[0].split('data: ')[1]), complete);
});

test('JSON responses cancel the same active task on disconnect and release connection listeners',async()=>{
 const run=fixture();run.req.raw=new EventEmitter();let signal;
 const pending=runConnectedAssistant(run.req,run.reply,async connection=>{
  signal=connection.signal;
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 });
 run.req.raw.emit('aborted');
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal(signal.aborted,true);assert.equal(run.req.raw.listenerCount('aborted'),0);assert.equal(run.raw.listenerCount('close'),0);
});

test('closed connections never begin JSON or streamed model work',async()=>{
 const run=fixture();run.req.raw={aborted:true};let calls=0;
 await assert.rejects(runConnectedAssistant({...run.req,raw:Object.assign(new EventEmitter(),{aborted:true})},run.reply,()=>{calls++;}),{name:'AbortError'});
 await streamAssistant(run.req,run.reply,()=>{calls++;});
 assert.equal(calls,0);assert.equal(run.frames.length,0);
});
