const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("automation cases persist validated many-to-many manual case links", async () => {
  const [service, bootstrap, routes, versions] = await Promise.all([
    readSource("../src/services/testCase.service.js"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/services/testCaseVersion.service.js")
  ]);

  assert.match(bootstrap, /ADD COLUMN IF NOT EXISTS manual_test_case_id TEXT REFERENCES test_cases\(id\) ON DELETE SET NULL/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS automation_case_links/);
  assert.match(bootstrap, /idx_automation_case_links_manual/);
  assert.match(service, /Automation cases must link only to manual test cases/);
  assert.match(service, /Automation and manual test cases must belong to the same application/);
  assert.match(routes, /manual_test_case_id: \{ required: false, type: "string" \}/);
  assert.match(routes, /manual_test_case_ids: \{ required: false, type: "array", items: "string" \}/);
  assert.match(versions, /"manual_test_case_id"/);
  assert.match(versions, /"manual_test_case_ids"/);
});
