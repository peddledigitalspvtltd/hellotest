const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("workspace user routes expose authenticated CRUD with plain-password setup", async () => {
  const [routes, service] = await Promise.all([
    readSource("../src/routes/users.js"),
    readSource("../src/services/user.service.js")
  ]);

  assert.match(routes, /fastify\.post\("\/users", \{ preHandler: \[fastify\.authenticate\] \}/);
  assert.match(routes, /password: \{ required: true, type: "string", minLength: 6, maxLength: 128 \}/);
  assert.match(routes, /fastify\.delete\("\/users\/:id", \{ preHandler: \[fastify\.authenticate\] \}/);
  assert.match(service, /password \? hashPassword\(password\) : password_hash/);
  assert.match(service, /default_role_id/);
});

test("Sprint persistence and API support complete CRUD with an empty Story selection", async () => {
  const [routes, service, schema, bootstrap] = await Promise.all([
    readSource("../src/routes/requirementIterations.routes.js"),
    readSource("../src/services/requirementIteration.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js")
  ]);

  for (const route of [
    'fastify.get("/requirement-iterations"',
    'fastify.post("/requirement-iterations"',
    'fastify.get("/requirement-iterations/:id"',
    'fastify.put("/requirement-iterations/:id"',
    'fastify.delete("/requirement-iterations/:id"'
  ]) assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(service, /requirement_ids = \[\]/);
  assert.match(service, /assignment: requirementIds\.length \? \{/);
  assert.match(service, /: null/);
  assert.match(service, /sprint,\s*assignment:/);
  assert.match(service, /ensureSprintStoriesComplete/);
  assert.match(service, /DELIVERY_STORIES_INCOMPLETE/);
  assert.match(schema, /start_date TIMESTAMPTZ/);
  assert.match(schema, /external_references JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(bootstrap, /data_type = 'date'/);
});

test("Product Management persists releases, Story delivery targets, related Stories, and evidence-based readiness", async () => {
  const [releaseRoutes, releaseService, storyRoutes, storyService, iterationRoutes, catalog, schema, bootstrap, permissions] = await Promise.all([
    readSource("../src/routes/requirementReleases.routes.js"),
    readSource("../src/services/requirementRelease.service.js"),
    readSource("../src/routes/requirements.routes.js"),
    readSource("../src/services/requirement.service.js"),
    readSource("../src/routes/requirementIterations.routes.js"),
    readSource("../src/domain/catalog.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/security/permissions.catalog.js")
  ]);

  for (const route of [
    'fastify.get("/requirement-releases"',
    'fastify.post("/requirement-releases"',
    'fastify.get("/requirement-releases/readiness"',
    'fastify.get("/requirement-releases/:id/readiness"',
    'fastify.put("/requirement-releases/:id"',
    'fastify.delete("/requirement-releases/:id"'
  ]) assert.match(releaseRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(releaseRoutes, /project_id: \{ required: true, type: "string" \}/);
  assert.match(releaseService, /sprint_ids/);
  assert.match(releaseService, /LEFT JOIN requirement_release_items/);
  assert.match(releaseService, /requirements\.iteration_id IN/);
  assert.match(releaseService, /release_membership_source/);
  assert.match(releaseService, /UPDATE requirements[\s\S]*release = \?, fix_version = \?/);
  assert.match(releaseService, /testCoverage \|\| 0\) \* 0\.3/);
  assert.match(releaseService, /passRate \|\| 0\) \* 0\.5/);
  assert.match(releaseService, /bugHealth \* 0\.2/);
  assert.match(releaseService, /automation_is_informational: true/);
  assert.match(releaseService, /exports\.listReadiness/);
  assert.match(releaseService, /Promise\.all\(releases\.map/);
  assert.match(releaseService, /ensureReleaseStoriesComplete/);
  assert.match(releaseService, /DELIVERY_STORIES_INCOMPLETE/);
  assert.match(storyRoutes, /\/requirements\/:id\/related-requirements/);
  assert.match(storyService, /requirement_relations/);
  assert.match(iterationRoutes, /slippage_stories/);
  assert.match(iterationRoutes, /on_course_stories/);
  for (const status of ["dev_ready", "dev_in_progress", "dev_blocked", "dev_done", "qa_ready", "qa_in_progress", "qa_blocked", "qa_done"]) {
    assert.match(catalog, new RegExp(`value: "${status}"`));
  }
  for (const field of ["dev_completion_target_date", "qa_completion_target_date", "scrum_team", "specification_format", "specification_content"]) {
    assert.match(schema, new RegExp(field));
    assert.match(bootstrap, new RegExp(field));
  }
  assert.match(schema, /CREATE TABLE IF NOT EXISTS requirement_releases/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS requirement_release_items/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS requirement_relations/);
  assert.match(permissions, /\["GET", "\/requirement-releases\/:id\/readiness", "requirement_iteration\.view"\]/);
  assert.match(permissions, /\["GET", "\/requirement-releases\/readiness", "requirement_iteration\.view"\]/);
});

test("Bug creation requires a project so saved Bugs remain visible in project lists", async () => {
  const [routes, service, schema, bootstrap, seed] = await Promise.all([
    readSource("../src/routes/issues.routes.js"),
    readSource("../src/services/issues.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/seed.sql")
  ]);

  assert.match(routes, /project_id: \{ required: true, type: "string" \}/);
  assert.match(service, /if \(!project_id \|\| !user_id \|\| !title \|\| !message\)/);
  assert.match(service, /const project = await db\.prepare\("SELECT id FROM projects WHERE id = \?"\)\.get\(project_id\)/);
  assert.match(service, /displayIdService\.createDisplayId\("issue"\)/);
  assert.match(service, /deriveTestCaseImpactScope/);
  assert.match(service, /test_case_module_cases\.module_id/);
  assert.match(service, /requirement_test_cases\.requirement_id/);
  assert.match(service, /resolvedModuleIds/);
  assert.match(service, /resolvedRequirementIds/);
  assert.match(service, /feedback\.display_id/);
  assert.doesNotMatch(service, /project_id \|\| null/);
  assert.match(schema, /CREATE TABLE feedback \([\s\S]*?display_id TEXT UNIQUE,[\s\S]*?project_id TEXT NOT NULL,/);
  assert.match(bootstrap, /SET display_id = 'BUG-' \|\| \(existing\.max_sequence \+ missing\.sequence\)/);
  assert.match(bootstrap, /UPDATE feedback[\s\S]*?WHERE feedback\.project_id IS NULL[\s\S]*?COUNT\(DISTINCT project_members\.project_id\)[\s\S]*?= 1/);
  assert.match(seed, /INSERT INTO feedback \(id, project_id, user_id, title, message, status\)/);
});

test("project catalog returns exact Stories, Modules, Cases, and Bugs counts", async () => {
  const service = await readSource("../src/services/project.service.js");

  assert.match(service, /FROM requirements WHERE requirements\.project_id = p\.id\) AS story_count/);
  assert.match(service, /FROM test_case_modules[\s\S]*WHERE app_types\.project_id = p\.id[\s\S]*AS module_count/);
  assert.match(service, /FROM test_cases[\s\S]*WHERE app_types\.project_id = p\.id[\s\S]*AS case_count/);
  assert.match(service, /FROM feedback WHERE feedback\.project_id = p\.id\) AS bug_count/);
});

test("project visibility, catalog locks, and per-user favorites are persisted and access-aware", async () => {
  const [routes, service, schema, bootstrap, permissions] = await Promise.all([
    readSource("../src/routes/projects.routes.js"),
    readSource("../src/services/project.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/security/permissions.catalog.js")
  ]);

  assert.match(schema, /visibility TEXT NOT NULL DEFAULT 'public' CHECK \(visibility IN \('private', 'public'\)\)/);
  assert.match(schema, /CREATE TABLE project_favorites/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS project_favorites/);
  assert.match(routes, /fastify\.get\("\/projects\/catalog"/);
  assert.match(routes, /fastify\.put\("\/projects\/:id\/favorite"/);
  assert.match(routes, /fastify\.delete\("\/projects\/:id\/favorite"/);
  assert.match(service, /normalizedVisibility === "public" \? await selectAdminUsers\.all\(\) : \[\]/);
  assert.match(service, /CASE WHEN catalog\.has_access THEN catalog\.description ELSE NULL END/);
  assert.match(service, /INSERT INTO project_favorites/);
  assert.match(permissions, /\["GET", "\/projects\/catalog", "project\.view"\]/);
});

test("project attachments use project scope and transparent gzip persistence", async () => {
  const [attachmentService, entityScope, schema, bootstrap, projectService] = await Promise.all([
    readSource("../src/services/attachment.service.js"),
    readSource("../src/services/entityScope.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/project.service.js")
  ]);

  assert.match(entityScope, /project: \{[\s\S]*SELECT id, id AS project_id FROM projects/);
  assert.match(attachmentService, /createGzip/);
  assert.match(attachmentService, /createGunzip/);
  assert.match(attachmentService, /compression: "gzip"/);
  assert.match(attachmentService, /stored_size_bytes/);
  assert.match(schema, /stored_size_bytes BIGINT NOT NULL DEFAULT 0/);
  assert.match(schema, /compression TEXT NOT NULL DEFAULT 'none'/);
  assert.match(bootstrap, /ALTER TABLE attachments ADD COLUMN IF NOT EXISTS stored_size_bytes/);
  assert.match(projectService, /attachmentService\.listProjectObjects\(id\)/);
  assert.match(projectService, /attachmentService\.purgeProjectObjects\(id, projectAttachmentObjects\)/);
});
