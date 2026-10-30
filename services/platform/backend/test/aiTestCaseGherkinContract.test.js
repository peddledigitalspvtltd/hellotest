const { sourceFile } = require("./helpers/sourceFile");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const catalog = require('../../shared/aiFeatureCatalog.json');

const readSource = (relativePath) => readFile(relativePath.startsWith("src/services/") || relativePath.startsWith("src/routes/") ? sourceFile(relativePath, relativePath.includes("/routes/") ? "routes" : "services") : path.join(__dirname, "..", relativePath), "utf8");

test("designed Test Cases preserve Gherkin authoring through preview and acceptance", async () => {
  const [service, routes] = await Promise.all([
    readSource("src/services/requirementDesign.service.js"),
    readSource("src/routes/testCases.routes.js")
  ]);

  assert.match(routes, /authoring_mode: \{ required: false, type: "string", enum: \["structured", "gherkin"\] \}/);
  const instructions = catalog.find(item => item.id === 'ai.test_case.design').defaults.instruction_blocks['format.gherkin'];
  assert.match(instructions, /complete.*Gherkin document/);
  assert.match(instructions, /Background.*Scenario.*Scenario Outline/);
  assert.match(instructions, /Examples/);
  assert.match(service, /caseOutputSchema\(authoringMode/);
  assert.match(service, /validateNativeArtifactOutput\('ai\.test_case\.design'/);
  assert.match(service, /gherkin_document: candidate\.gherkin_document/);
  assert.match(service, /parameter_values: candidate\.parameter_values/);
});

test("scheduled generation stores and reuses the requested authoring mode", async () => {
  const [service, bootstrap, schema] = await Promise.all([
    readSource("src/services/aiTestCaseGeneration.service.js"),
    readSource("src/db/bootstrap.js"),
    readSource("instance-setup-data/schema-setup/schema.sql")
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
  const instructions = catalog.find(item => item.id === 'ai.case_authoring.full_case').defaults.instruction_blocks['format.gherkin'];
  assert.match(instructions, /Return one complete, valid Gherkin document/);
  assert.match(service, /application_contract:\{output_schema:caseOutputSchema\(authoringMode/);
  assert.match(service, /validateNativeArtifactOutput\('ai\.case_authoring\.full_case'/);
  assert.match(service, /AI authoring response did not include a valid Gherkin Feature and Scenario/);
  assert.match(service, /authoring_mode: "gherkin"/);
  assert.match(service, /gherkin_document,/);
});
