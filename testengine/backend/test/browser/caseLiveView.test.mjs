import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createWebRunSession, captureLiveSessionScreenshot, getLiveSessionStatus } from "../../dist/lib/webEngine.js";

test("concurrent case browsers retain distinct run-scoped Live View and never fall back after a case ends", { timeout: 30000 }, async t => {
  const app = Fastify();
  app.get("/:color", async (request, reply) => reply.type("text/html").send(`<!doctype html><body style="margin:0;background:${request.params.color === "red" ? "red" : "blue"}"><h1>${request.params.color}</h1></body>`));
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const sessions = ["red", "blue"].map(color => createWebRunSession({ engine_run_id: `case-${color}`, browser: "chromium", headless: true, web_engine: { active: "playwright" },
    environment: { base_url: `${base}/${color}` }, run_timeout_seconds: 20, max_repair_attempts: 0, artifact_policy: { trace_mode: "off", video_mode: "off", capture_console: false, capture_network: false }, steps: [] }));
  t.after(async () => { await Promise.all(sessions.map(session => session.stop("passed"))); });
  await Promise.all(sessions.map(session => session.start()));
  assert.equal(getLiveSessionStatus("playwright", "case-red").session_id, "case-red:playwright");
  assert.equal(getLiveSessionStatus("playwright", "case-blue").session_id, "case-blue:playwright");
  const red = await captureLiveSessionScreenshot("playwright", "case-red");
  const blue = await captureLiveSessionScreenshot("playwright", "case-blue");
  assert.ok(red?.length > 100);assert.ok(blue?.length > 100);assert.notDeepEqual(red, blue);
  await sessions[0].stop("passed");
  assert.equal(getLiveSessionStatus("playwright", "case-red").available, false);
  assert.equal(await captureLiveSessionScreenshot("playwright", "case-red"), null);
  assert.equal(getLiveSessionStatus("playwright", "case-blue").available, true);
  assert.equal(await captureLiveSessionScreenshot("playwright", "unknown-case"), null);
});
