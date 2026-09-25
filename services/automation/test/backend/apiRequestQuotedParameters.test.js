const assert = require("node:assert/strict");
const test = require("node:test");
const { executeApiRequestStep } = require("../../backend/services/apiRequestExecution.service");

test("API execution resolves quoted dataset columns in URL, headers, body and assertions", async (context) => {
  let sentRequest;
  context.mock.method(globalThis, "fetch", async (url, options) => {
    sentRequest = { url, ...options };
    return new Response("Hello Jay", { status: 200, headers: { "content-type": "text/plain" } });
  });
  const result = await executeApiRequestStep({
    api_request: {
      method: "POST",
      url: "@s.[API Host]/users/@t.[123]",
      body_mode: "text",
      body: String.raw`@t.[First Name]|@t.[price.total]|@t.[closing\]]|@t.[folder\\file]|@t.username|@t.|email@t.username`,
      headers: [{ key: "@r.[Header Name]", value: "@r.[Run ID]" }],
      validations: [{ kind: "body_contains", expected: "@t.[First Name]" }]
    },
    parameter_values: {
      "s.api host": "https://example.test",
      "t.123": "42",
      "t.first name": "Jay",
      "@t.[price.total]": "19.95",
      "t.closing]": "bracket",
      "t.folder\\file": "slash",
      "t.username": "qa",
      "t.t": "do-not-replace-incomplete-scope",
      "r.header name": "X-Run",
      "r.run id": "run-1"
    }
  });
  assert.equal(sentRequest.url, "https://example.test/users/42");
  assert.equal(sentRequest.body, "Jay|19.95|bracket|slash|qa|@t.|email@t.username");
  assert.equal(sentRequest.headers.get("x-run"), "run-1");
  assert.equal(result.status, "passed");
  assert.equal(result.detail.assertions[0].expected, "Jay");
});

test("API capture destinations keep their references while dynamic paths resolve and saved values update", async (context) => {
  const sentRequests = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    sentRequests.push({ url, ...options });
    return new Response(JSON.stringify({ token: "new-token", refresh: "new-refresh", escaped: "new-escaped" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const escapedDestination = String.raw`@r.[Token\]path\\id]`;
  const result = await executeApiRequestStep({
    api_request: { method: "POST", url: "https://example.test/token", body_mode: "text", body: "@r.token|@r.[Refresh Token]", captures: [
      { path: "@t.token_path", parameter: "@r.token" },
      { path: "@t.refresh_path", parameter: "@r.[Refresh Token]" },
      { path: "@t.escaped_path", parameter: escapedDestination }
    ] },
    parameter_values: { "t.token_path": "$.token", "t.refresh_path": "$.refresh", "t.escaped_path": "$.escaped", "r.token": "previous-token", "r.refresh token": "previous-refresh", "r.token]path\\id": "previous-escaped" }
  });
  assert.equal(sentRequests[0].body, "previous-token|previous-refresh");
  assert.deepEqual(result.captures, { "@r.token": "new-token", "@r.[Refresh Token]": "new-refresh", [escapedDestination]: "new-escaped" });
  await executeApiRequestStep({ api_request: { method: "POST", url: "https://example.test/next", body_mode: "text", body: `@r.token|@r.[Refresh Token]|${escapedDestination}` }, parameter_values: result.captures });
  assert.equal(sentRequests[1].body, "new-token|new-refresh|new-escaped");
});
