const assert = require("node:assert/strict");
const test = require("node:test");
const { parseAiJson } = require("../src/utils/aiJsonResponse");

test("AI JSON parsing preserves arrays, fenced JSON and braces inside text", () => {
  const value = { cases: [{ title: 'Expected {"status":"ok"}', note: "A closing } is valid inside text" }] };
  assert.deepEqual(parseAiJson(JSON.stringify(value)), value);
  assert.deepEqual(parseAiJson(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``), value);
  assert.deepEqual(parseAiJson(`Result:\n${JSON.stringify(value)}\nReview before saving.`), value);
  assert.deepEqual(parseAiJson(JSON.stringify(value.cases)), value.cases);
});

test("AI JSON parsing rejects incomplete documents and scalar responses", () => {
  for (const content of ['', 'null', '"draft"', '{"title":"partial', '[{"title":"draft"}']) {
    assert.throws(() => parseAiJson(content), error => error.statusCode === 502 && error.code === "AI_INVALID_OUTPUT");
  }
});
