const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("Release scope exposes an authenticated additive Story and Sprint contract", async () => {
  const [routes, service, permissions] = await Promise.all([
    readSource("../src/routes/requirementReleases.routes.js"),
    readSource("../src/services/requirementRelease.service.js"),
    readSource("../src/security/permissions.catalog.js")
  ]);

  assert.match(routes, /fastify\.post\("\/requirement-releases\/:id\/scope"/);
  assert.match(routes, /requirement_ids: \{ required: false, type: "array", items: "string" \}/);
  assert.match(routes, /sprint_ids: \{ required: false, type: "array", items: "string" \}/);
  assert.match(routes, /ensureReleaseAccess\(req\.params\.id, req\.user\.id\)/);
  assert.match(routes, /service\.appendScope\(req\.params\.id/);
  assert.match(permissions, /\["POST", "\/requirement-releases\/:id\/scope", "requirement_iteration\.update"\]/);

  const appendScope = service.slice(service.indexOf("exports.appendScope"), service.indexOf("exports.listReleases"));
  assert.match(appendScope, /release\.persisted_state === "released"/);
  assert.match(appendScope, /RELEASE_SCOPE_LOCKED/);
  assert.match(appendScope, /SELECT id FROM requirement_releases WHERE id = \? FOR UPDATE/);
  assert.match(appendScope, /const release = await exports\.getRelease\(releaseId\)/);
  assert.match(appendScope, /WHERE release_id = \? AND source = 'manual'/);
  assert.match(appendScope, /\.\.\.existingDirectRows\.map/);
  assert.match(appendScope, /\.\.\.appendedRequirementIds/);
  assert.match(appendScope, /\.\.\.\(Array\.isArray\(release\.sprint_ids\)/);
  assert.match(appendScope, /\.\.\.appendedSprintIds/);
  assert.match(appendScope, /replaceMembership\(release, nextRequirementIds, nextSprintIds\)/);
  assert.doesNotMatch(appendScope, /requirement_ids:\s*release\.requirement_ids/);
});
