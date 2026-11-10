import test from "node:test";
import assert from "node:assert/strict";
import { LiveViewSessionRegistry } from "../dist/lib/liveViewSessions.js";

const entry = (id, screenshot) => ({ id: `${id}:playwright`, provider: "playwright", startedAt: "2026-11-10T00:00:00Z", url: async () => "https://fixture.test", screenshot });

test("case viewers share each frame and cannot queue concurrent browser screenshot commands", async () => {
  let now = 0, captures = 0, release;
  const registry = new LiveViewSessionRegistry({ now: () => now });
  registry.register(entry("case", async () => { captures++; return new Promise(resolve => { release = resolve; }); }));
  const viewers = [registry.capture("playwright", "case"), registry.capture("playwright", "case")];
  await Promise.resolve();
  assert.equal(captures, 1);
  release(Buffer.from("frame-one"));
  assert.deepEqual((await Promise.all(viewers)).map(image => image.toString()), ["frame-one", "frame-one"]);
  assert.equal((await registry.capture("playwright", "case")).toString(), "frame-one");
  assert.equal(captures, 1);
  now = 501;
  const next = registry.capture("playwright", "case");
  await Promise.resolve();
  assert.equal(captures, 2);
  release(Buffer.from("frame-two"));
  assert.equal((await next).toString(), "frame-two");
});

test("closing or replacing a case discards its in-flight frame without exposing another session", async () => {
  let release;
  const registry = new LiveViewSessionRegistry();
  registry.register(entry("case", () => new Promise(resolve => { release = resolve; })));
  registry.register(entry("other", async () => Buffer.from("unrelated")));
  const old = registry.capture("playwright", "case");
  await Promise.resolve();
  registry.unregister("case:playwright");
  assert.equal(registry.status("playwright", "case").available, false);
  assert.equal(await registry.capture("playwright", "case"), null);
  registry.register(entry("case", async () => Buffer.from("replacement")));
  release(Buffer.from("ended"));
  assert.equal(await old, null);
  assert.equal((await registry.capture("playwright", "case")).toString(), "replacement");
});

test("a stalled driver returns a bounded empty frame and keeps only one pending capture", async () => {
  let captures = 0, release;
  const registry = new LiveViewSessionRegistry({ captureTimeoutMs: 10 });
  registry.register(entry("case", () => { captures++; return new Promise(resolve => { release = resolve; }); }));
  assert.equal(await registry.capture("playwright", "case"), null);
  assert.equal(await registry.capture("playwright", "case"), null);
  assert.equal(captures, 1);
  release(null);
  registry.unregister("case:playwright");
});
