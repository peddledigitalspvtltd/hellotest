const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), "utf8");

test("request telemetry keeps complete metrics while sampling noisy success logs", () => {
  const app = read("../src/app.js");
  const observability = read("../src/plugins/observability.js");

  assert.match(app, /disableRequestLogging:\s*true/);
  assert.match(observability, /NOISY_LOG_ROUTES[\s\S]*?\/testengine\/internal\/jobs\/lease/);
  assert.match(observability, /const important = reply\.statusCode >= 400 \|\| durationMs >= SLOW_REQUEST_MS/);
  assert.match(observability, /event:\s*"http_request_completed"/);

  const metricPosition = observability.indexOf("recordRequestMetric({", observability.indexOf("fastify.addHook(\"onResponse\""));
  const samplingPosition = observability.indexOf("const sampled =", metricPosition);
  assert.ok(metricPosition > -1 && samplingPosition > metricPosition, "request metrics must be recorded before log sampling");
});
