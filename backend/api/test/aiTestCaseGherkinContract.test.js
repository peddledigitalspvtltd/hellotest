const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, "..", relativePath), "utf8");

test("designed Test Cases preserve Gherkin authoring through preview and acceptance", async () => {
  const [service, routes] = await Promise.all([
    readSource("src/services/requirementDesign.service.js"),
    readSource("src/routes/testCases.routes.js")
  ]);

  assert.match(routes, /authoring_mode: \{ required: false, type: "string", enum: \["structured", "gherkin"\] \}/);
  assert.match(service, /gherkin_document must be a complete executable Gherkin document/);
  assert.match(service, /Use Feature, Background when shared setup exists, Scenario or Scenario Outline/);
  assert.match(service, /Examples when the scenario is data-driven/);
  assert.match(service, /gherkin_document: candidate\.gherkin_document/);
  assert.match(service, /parameter_values: candidate\.parameter_values/);
});

test("scheduled generation stores and reuses the requested authoring mode", async () => {
  const [service, bootstrap, schema] = await Promise.all([
    readSource("src/services/aiTestCaseGeneration.service.js"),
    readSource("src/db/bootstrap.js"),
    readSource("../db/schema.sql")
  ]);

  assert.match(service, /normalizedAuthoringMode/);
  assert.match(service, /authoring_mode: job\.authoring_mode \|\| "structured"/);
  assert.match(service, /gherkin_document: candidate\.gherkin_document/);
  assert.match(bootstrap, /authoring_mode TEXT NOT NULL DEFAULT 'structured'/);
  assert.match(schema, /authoring_mode TEXT NOT NULL DEFAULT 'structured'/);
});

test("AI Test Case improvement generates and validates native Gherkin", async () => {
  const [service, routes] = await Promise.all([
    readSource("src/services/aiCaseAuthoring.service.js"),
    readSource("src/routes/testCases.routes.js")
  ]);

  assert.match(routes, /previewCaseAuthoring\(\{[\s\S]*?authoring_mode: req\.body\.authoring_mode/);
  assert.match(service, /Requested output format/);
  assert.match(service, /Return one complete, valid Gherkin document/);
  assert.match(service, /AI authoring response did not include a valid Gherkin Feature and Scenario/);
  assert.match(service, /authoring_mode: "gherkin"/);
  assert.match(service, /gherkin_document,/);
});
