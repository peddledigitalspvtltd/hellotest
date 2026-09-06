import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD, "lib/apiEngine.js"))
  : new URL("../dist/lib/apiEngine.js", import.meta.url);
const { executeApiStepInEngine } = await import(runtimeUrl.href);

test("API captures retain standard and quoted destinations while resolving paths and later inputs", async (context) => {
  const sentRequests = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    sentRequests.push({ url, ...options });
    return new Response(JSON.stringify({ token: "new-token", refresh: "new-refresh", escaped: "new-escaped" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const escapedDestination = String.raw`@r.[Token\]path\\id]`;
  const envelope = { case_parameters: { token_path: "$.token", refresh_path: "$.refresh", escaped_path: "$.escaped" } };
  const result = await executeApiStepInEngine(envelope, { api_request: {
    method: "POST", url: "https://example.test/token", body_mode: "text", body: "@r.token|@r.[Refresh Token]",
    captures: [
      { path: "@t.token_path", parameter: "@r.token" },
      { path: "@t.refresh_path", parameter: "@r.[Refresh Token]" },
      { path: "@t.escaped_path", parameter: escapedDestination }
    ]
  } }, { "r.token": "previous-token", "r.refresh token": "previous-refresh", "r.token]path\\id": "previous-escaped" });
  assert.equal(sentRequests[0].body, "previous-token|previous-refresh");
  assert.deepEqual(result.captures, { "@r.token": "new-token", "@r.[Refresh Token]": "new-refresh", [escapedDestination]: "new-escaped" });
  await executeApiStepInEngine(envelope, { api_request: { method: "POST", url: "https://example.test/next", body_mode: "text", body: `@r.token|@r.[Refresh Token]|${escapedDestination}` } }, result.captures);
  assert.equal(sentRequests[1].body, "new-token|new-refresh|new-escaped");
});
