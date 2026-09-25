const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function templates(rows = []) {
  const filename = path.resolve(__dirname, "../../backend/services/aiPromptTemplate.service.js");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const requests = [];
  const db = { prepare: sql => ({ all: async (...args) => { requests.push({ sql, args }); return rows; } }) };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(id => id === "@hellotest/platform/backend/src/db" ? db : localRequire(id), module, module.exports);
  return { service: module.exports, requests };
}

test("empty projects receive scoped selectable Story creation and completion templates", async () => {
  const { service, requests } = templates();
  for (const [scope, minimum] of [["requirement_creation", 4], ["requirement_completion", 2]]) {
    const results = await service.listPromptTemplates({ project_id: "project", scope });
    assert.ok(results.length >= minimum);
    assert.ok(results.every(item => item.scope === scope && item.built_in && item.is_active && item.project_id === "project"));
    assert.ok(results.every(item => item.applies_to.includes("requirements") && !item.applies_to.includes("test_cases")));
    assert.ok(results.every(item => item.prompt_text.length < 700 && item.prompt_text.includes("schema")));
    assert.ok(results.every(item => item.test_count >= 1 && item.test_count <= (scope === "requirement_creation" ? 6 : 1)));
    assert.deepEqual(requests.at(-1).args, ["project", scope, null]);
  }
  const testCaseTemplates = await service.listPromptTemplates({ project_id: "project", scope: "test_case_generation" });
  assert.deepEqual(testCaseTemplates.map(item => item.test_count), [8, 10, 6]);
  assert.ok(testCaseTemplates.every(item => !item.id.startsWith("builtin-story")));
});

test("saved Story templates remain available with counts bounded to the actual generation contract", async () => {
  const { service } = templates([{ id: "saved", scope: "requirement_creation", name: "Our pattern", prompt_text: "Use the current product brief", project_id: "project", test_count: 50, applies_to: ["requirements"] }]);
  const results = await service.listPromptTemplates({ project_id: "project", scope: "requirement_creation" });
  assert.equal(results[0].id, "saved");
  assert.equal(results[0].test_count, 6);
  assert.ok(results.some(item => item.id === "builtin-story-user-outcome"));
});
