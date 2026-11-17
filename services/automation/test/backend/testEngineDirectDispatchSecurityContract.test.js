const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("direct Test Engine dispatch sends the centrally resolved shared secret", async () => {
  const source = require('../helpers/implementationSource').implementationSource('dispatch/executionPlanning');

  assert.match(
    source,
    /const dispatchSecret = resolveTestEngineSecret\(\);[\s\S]*?resilientHttpRequest\(`\$\{engineHost\}\/api\/v1\/runs`[\s\S]*?"x-hellotest-testengine-secret": dispatchSecret/
  );
});
