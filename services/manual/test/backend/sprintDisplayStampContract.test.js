const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

const functionSection = (source, exportName, nextExportName) => {
  const start = source.indexOf(`exports.${exportName}`);
  const end = nextExportName ? source.indexOf(`exports.${nextExportName}`, start + exportName.length) : source.length;
  assert.notEqual(start, -1, `${exportName} must exist`);
  assert.notEqual(end, -1, `${nextExportName} must follow ${exportName}`);
  return source.slice(start, end);
};

test("native Sprint lifecycle keeps the readable Story sprint stamp coherent", async () => {
  const source = await readSource("../../backend/services/requirementIteration.service.js");
  const create = functionSection(source, "createIteration", "updateIteration");
  const update = functionSection(source, "updateIteration", "assignRequirements");
  const assign = functionSection(source, "assignRequirements", "removeRequirements");
  const remove = functionSection(source, "removeRequirements", "deleteIteration");
  const removeIteration = functionSection(source, "deleteIteration");

  assert.match(create, /SET iteration_id = \?, sprint = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(create, /\.run\(id, normalizedName, requirementId\)/);

  assert.match(update, /sprint = CASE WHEN sprint IN \(\?, \?\) THEN NULL ELSE sprint END/);
  assert.match(update, /SET iteration_id = \?, sprint = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(update, /SET sprint = \?, updated_at = CURRENT_TIMESTAMP\s+WHERE iteration_id = \?/);
  assert.match(update, /\.run\(nextName, id\)/);

  assert.match(assign, /sprint = CASE WHEN sprint = \? THEN NULL ELSE sprint END/);
  assert.match(assign, /SET iteration_id = \?, sprint = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(assign, /\.run\(id, iteration\.name, requirementId\)/);
  assert.match(remove, /sprint = CASE WHEN sprint = \? THEN NULL ELSE sprint END/);
  assert.match(removeIteration, /sprint = CASE WHEN sprint = \? THEN NULL ELSE sprint END/);

  for (const section of [remove, removeIteration]) {
    assert.match(section, /WHERE iteration_id = \?/);
    assert.doesNotMatch(section, /SET sprint = NULL/);
  }
});

test("direct Story create and update derive native Sprint names but preserve unrelated Jira text on unassign", async () => {
  const source = await readSource("../../backend/services/requirement.service.js");
  const create = functionSection(source, "createRequirement", "getRequirements");
  const update = functionSection(source, "updateRequirement", "previewRequirementOptimization");

  assert.match(source, /SELECT id, project_id, name, state\s+FROM requirement_iterations/);
  assert.match(create, /const nativeIteration = await ensureIterationBelongsToProject/);
  assert.match(create, /nativeIteration\?\.name \|\| normalizeText\(sprint\)/);

  assert.match(update, /const \[previousIteration, nextIteration\] = await Promise\.all/);
  assert.match(update, /const nextSprint = nextIteration\s+\? nextIteration\.name/);
  assert.match(update, /data\.sprint !== undefined\s+\? normalizeText\(data\.sprint\)/);
  assert.match(update, /previousIteration\?\.name === normalizeText\(existing\.sprint\)\s+\? null\s+: existing\.sprint/);
  assert.match(update, /nextSprint,[\s\S]*nextIterationId/);
});
