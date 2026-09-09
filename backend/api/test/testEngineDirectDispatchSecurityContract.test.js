const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("direct Test Engine dispatch sends the centrally resolved shared secret", async () => {
  const source = await fs.readFile(
    path.join(__dirname, "../src/services/testEngineDispatch.service.js"),
    "utf8"
  );

  assert.match(
    source,
    /const dispatchSecret = resolveTestEngineSecret\(\);[\s\S]*?resilientHttpRequest\(`\$\{engineHost\}\/api\/v1\/runs`[\s\S]*?"x-hellotest-testengine-secret": dispatchSecret/
  );
});
