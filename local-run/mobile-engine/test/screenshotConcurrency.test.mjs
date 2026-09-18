import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { app, sessions } from "../src/server.js";
import { DEVELOPMENT_MOBILE_ENGINE_SECRET, MOBILE_ENGINE_SECRET_HEADER } from "../src/security.js";

test("overlapping recorder screenshots share one driver call without caching completed or failed captures", async (t) => {
  let calls = 0;
  let resolveCapture;
  let fail = false;
  const driver = { takeScreenshot: () => {
    calls += 1;
    if (fail) return Promise.reject(new Error("capture failed"));
    return new Promise((resolve) => { resolveCapture = resolve; });
  } };
  sessions.set("screen-test", { id: "screen-test", driver });
  sessions.set("screen-other", { id: "screen-other", driver: { takeScreenshot: async () => Buffer.from("other device").toString("base64") } });
  t.after(async () => { sessions.delete("screen-test"); sessions.delete("screen-other"); await app.close(); });
  const take = () => app.inject({ method: "GET", url: "/api/v1/mobile/recorder/sessions/screen-test/screenshot", headers: { [MOBILE_ENGINE_SECRET_HEADER]: DEVELOPMENT_MOBILE_ENGINE_SECRET } });
  const pending = Array.from({ length: 20 }, () => take().then((response) => response));
  while (!resolveCapture) await nextTurn();
  await nextTurn();
  assert.equal(calls, 1, "20 concurrent viewers cause one device call");
  const other = await app.inject({ method: "GET", url: "/api/v1/mobile/recorder/sessions/screen-other/screenshot", headers: { [MOBILE_ENGINE_SECRET_HEADER]: DEVELOPMENT_MOBILE_ENGINE_SECRET } });
  assert.equal(other.body, "other device", "A second session never receives the first driver's pending frame");
  resolveCapture(Buffer.from("first frame").toString("base64"));
  const responses = await Promise.all(pending);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "first frame");
    assert.equal(response.headers["cache-control"], "no-store");
  }
  fail = true;
  assert.equal((await take()).statusCode, 500);
  assert.equal((await take()).statusCode, 500);
  assert.equal(calls, 3, "Failures do not poison later captures");
  fail = false;
  const fresh = take().then((response) => response);
  await nextTurn();
  resolveCapture(Buffer.from("new frame").toString("base64"));
  assert.equal((await fresh).body, "new frame");
  assert.equal(calls, 4);
});
