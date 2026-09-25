const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("Modules persist ordered Requirement selections and hydrate their ids", async () => {
  const [schema, bootstrap, service] = await Promise.all([
    readSource("../../../platform/backend/instance-setup-data/schema-setup/schema.sql"),
    readSource("../../../platform/backend/src/db/bootstrap.js"),
    readSource("../../backend/services/testCaseModule.service.js")
  ]);

  for (const source of [schema, bootstrap]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS test_case_module_requirements/);
    assert.match(source, /module_id TEXT NOT NULL REFERENCES test_case_modules\(id\) ON DELETE CASCADE/);
    assert.match(source, /requirement_id TEXT NOT NULL REFERENCES requirements\(id\) ON DELETE CASCADE/);
    assert.match(source, /PRIMARY KEY \(module_id, requirement_id\)/);
    assert.match(source, /idx_test_case_module_requirements_module_sort/);
  }

  assert.match(service, /SELECT requirement_id[\s\S]*FROM test_case_module_requirements[\s\S]*ORDER BY sort_order ASC/);
  assert.match(service, /requirement_ids: requirementRows\.map\(\(row\) => row\.requirement_id\)/);
  assert.match(service, /AS requirement_ids/);
  assert.match(service, /requirement_ids: parseStoredIds\(module\.requirement_ids\)/);
});

test("Module create and update validate Requirement project scope and replace only explicit selections", async () => {
  const [routes, service] = await Promise.all([
    readSource("../../backend/routes/testCaseModules.routes.js"),
    readSource("../../backend/services/testCaseModule.service.js")
  ]);

  assert.equal(
    (routes.match(/requirement_ids: \{ required: false, type: "array", items: "string" \}/g) || []).length,
    2
  );
  assert.match(service, /SELECT id, project_id[\s\S]*FROM app_types/);
  assert.match(service, /SELECT id, project_id[\s\S]*FROM requirements/);
  assert.match(service, /Requirement not found:/);
  assert.match(service, /Requirement must belong to the same project as the module/);
  assert.match(service, /createModule = async \(\{[\s\S]*requirement_ids = \[\]/);
  assert.match(service, /ensureRequirementsMatchProject\(requirementIds, appType\.project_id\)/);
  assert.match(service, /INSERT INTO test_case_module_requirements \(module_id, requirement_id, sort_order\)/);
  assert.match(service, /data\.requirement_ids !== undefined \? normalizeTextList\(data\.requirement_ids\) : null/);
  assert.match(service, /if \(requirementIds !== null\) \{[\s\S]*deleteModuleRequirements\.run\(id\)/);
});

test("Create Module resolves the complete deduplicated linked-case scope for selected Requirements", async () => {
  const [routes, testCaseService, moduleService, openapi] = await Promise.all([
    readSource("../../backend/routes/testCases.routes.js"),
    readSource("../../backend/services/testCase.service.js"),
    readSource("../../backend/services/testCaseModule.service.js"),
    readSource("../../../../openapi.yaml")
  ]);

  const routeStart = routes.indexOf('fastify.post("/test-cases/resolve-requirements"');
  const routeEnd = routes.indexOf('fastify.get("/test-cases/:id/versions"', routeStart);
  const resolverRoute = routes.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(resolverRoute, /await fastify\.authenticate\(req\)/);
  assert.match(resolverRoute, /requirement_ids: \{ required: true, type: "array", items: "string", minItems: 1, maxItems: 100 \}/);
  assert.match(resolverRoute, /projectService\.getProject\(appType\.project_id, req\.user\.id\)/);
  assert.match(resolverRoute, /resolveRequirementScopes\(selectedRequirementIds\)/);
  assert.match(resolverRoute, /byId\.get\(id\)\.project_id !== appType\.project_id/);
  assert.doesNotMatch(resolverRoute, /getRequirement\(/);
  assert.match(resolverRoute, /service\.getTestCasesForRequirements/);

  assert.match(testCaseService, /exports\.getTestCasesForRequirements = async/);
  assert.match(testCaseService, /WHERE test_cases\.app_type_id = \?/);
  assert.match(testCaseService, /EXISTS \([\s\S]*FROM requirement_test_cases[\s\S]*requirement_test_cases\.test_case_id = test_cases\.id/);
  assert.match(testCaseService, /requirement_test_cases\.requirement_id IN \(\$\{placeholders\}\)/);
  const resolverService = testCaseService.slice(testCaseService.indexOf('exports.getTestCasesForRequirements = async'), testCaseService.indexOf('exports.getTestCase = async'));
  assert.match(resolverService, /test_cases\.requirement_id IN \(\$\{placeholders\}\) OR EXISTS/);
  assert.match(resolverService, /AS requirement_ids/);
  assert.match(resolverService, /detail_complete: false, summary_complete: false/);
  assert.doesNotMatch(resolverService, /hydrateTestCases|SELECT test_cases\.\*|execution_results|test_steps/);
  assert.match(moduleService, /ensureCasesMatchAppType\(caseIds, module\.app_type_id\)/);
  assert.match(openapi, /\/test-cases\/resolve-requirements:[\s\S]*summary: Resolve all app-scoped Test Cases linked to selected Requirements/);
});
