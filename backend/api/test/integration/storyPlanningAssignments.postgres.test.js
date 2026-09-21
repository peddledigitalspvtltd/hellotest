const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Story Sprint and Release assignments remain scoped, atomic and consistent", {
  skip: process.env.STORY_PLANNING_POSTGRES !== "1", timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_story_planning_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require("../../src/db");
  const obsDb = require("../../src/obsDb");
  const stories = require("../../src/services/requirement.service");
  const iterations = require("../../src/services/requirementIteration.service");
  const read = id => db.prepare("SELECT * FROM requirements WHERE id = ?").get(id);
  const memberships = id => db.prepare("SELECT release_id,source FROM requirement_release_items WHERE requirement_id = ? ORDER BY release_id").all(id);
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash) VALUES ('planner','planner@example.test','not-a-login');
      INSERT INTO projects(id,name) VALUES ('project','Planning'),('foreign','Other project');
      INSERT INTO requirement_iterations(id,project_id,name,state)
        VALUES ('sprint','project','Sprint Alpha','active'),('closed-sprint','project','Previous Sprint','closed'),('foreign-sprint','foreign','Other Sprint','future');
      INSERT INTO requirement_releases(id,project_id,name,fix_version,state,sprint_ids)
        VALUES ('old','project','First delivery','v1','planned','["sprint"]'),
          ('new','project','Next delivery','v2','planned','[]'),('independent','project','Independent scope','extra','planned','[]'),
          ('closed','project','Completed delivery','v0','released','[]'),('foreign-release','foreign','Other delivery','v9','planned','[]');`);
    let storyId;
    await t.test("create persists both IDs and canonical labels in one transaction", async () => {
      const created = await stories.createRequirement({ project_id: "project", title: "Mapped story", iteration_id: "sprint", release_id: "old", created_by: "planner" });
      storyId = created.id;
      const row = await read(storyId);
      assert.equal(row.iteration_id, "sprint");
      assert.equal(row.sprint, "Sprint Alpha");
      assert.equal(row.release, "First delivery");
      assert.equal(row.fix_version, "v1");
      assert.deepEqual(await memberships(storyId), [{ release_id: "old", source: "manual" }]);
    });
    await t.test("changing direct Release preserves Sprint inheritance and independent manual scope", async () => {
      await db.prepare("INSERT INTO requirement_release_items(release_id,requirement_id,source) VALUES ('independent',?,'manual')").run(storyId);
      await stories.updateRequirement(storyId, { release_id: "new", release: "Untrusted label", fix_version: "Wrong version", updated_by: "planner" });
      assert.equal((await read(storyId)).release, "Next delivery");
      assert.equal((await read(storyId)).fix_version, "v2");
      assert.deepEqual(await memberships(storyId), [
        { release_id: "independent", source: "manual" }, { release_id: "new", source: "manual" }, { release_id: "old", source: "sprint" }
      ]);
      await stories.updateRequirement(storyId, { release_id: "", updated_by: "planner" });
      assert.equal((await read(storyId)).release, null);
      assert.equal((await read(storyId)).fix_version, null);
      assert.deepEqual(await memberships(storyId), [{ release_id: "independent", source: "manual" }, { release_id: "old", source: "sprint" }]);
    });
    await t.test("foreign, missing or completed release rolls back Story creation and update", async () => {
      for (const [release_id, statusCode] of [["foreign-release", 400], ["missing", 404], ["closed", 409]]) {
        await assert.rejects(stories.createRequirement({ project_id: "project", title: `Rejected ${release_id}`, release_id, created_by: "planner" }), { statusCode });
        const before = await read(storyId);
        await assert.rejects(stories.updateRequirement(storyId, { title: "Must roll back", release_id, updated_by: "planner" }), { statusCode });
        assert.deepEqual(await read(storyId), before);
      }
      assert.equal((await db.prepare("SELECT count(*)::int AS count FROM requirements WHERE title LIKE 'Rejected %'").get()).count, 0);
    });
    await t.test("new Sprint assignments reject closed and foreign targets without disturbing the saved scope", async () => {
      const before = await read(storyId);
      await assert.rejects(stories.updateRequirement(storyId, { iteration_id: "foreign-sprint" }), /same project/);
      await assert.rejects(stories.updateRequirement(storyId, { iteration_id: "closed-sprint" }), { statusCode: 409, code: "SPRINT_SCOPE_LOCKED" });
      await assert.rejects(stories.createRequirement({ project_id: "project", title: "Closed Sprint story", iteration_id: "closed-sprint" }), { statusCode: 409 });
      assert.deepEqual(await read(storyId), before);
      await stories.updateRequirement(storyId, { title: "Unrelated edit" });
      assert.equal((await read(storyId)).iteration_id, "sprint");
    });
    await t.test("CSV imports persist explicit planning IDs and omit assignments on later title-only upserts", async () => {
      const imported = await stories.bulkImportRequirements({ project_id: "project", created_by: "planner", rows: [{ title: "Imported scoped story", iteration_id: "sprint", release_id: "new" }] });
      assert.equal(imported.errors.length, 0);
      const row = await db.prepare("SELECT * FROM requirements WHERE title='Imported scoped story'").get();
      assert.equal(row.iteration_id, "sprint");
      assert.equal(row.release, "Next delivery");
      assert.ok((await memberships(row.id)).some(item => item.release_id === "new" && item.source === "manual"));
      const updated = await stories.bulkImportRequirements({ project_id: "project", created_by: "planner", rows: [{ title: "Imported scoped story", description: "Updated description" }] });
      assert.equal(updated.errors.length, 0);
      assert.equal((await read(row.id)).iteration_id, "sprint");
      assert.equal((await read(row.id)).release, "Next delivery");
    });
    await t.test("moving a Story replaces origin Sprint membership and inherited Release scope", async () => {
      const next = await iterations.createIteration({ project_id: "project", name: "Sprint Beta", created_by: "planner" });
      await db.prepare("INSERT INTO requirement_releases(id,project_id,name,fix_version,sprint_ids) VALUES ('destination','project','Next Sprint delivery','v4',?::jsonb)").run(JSON.stringify([next.id]));
      const created = await stories.createRequirement({ project_id: "project", title: "Story to move", iteration_id: "sprint", created_by: "planner" });
      assert.deepEqual(await memberships(created.id), [{ release_id: "old", source: "sprint" }]);
      const receipt = await iterations.assignRequirements(next.id, [created.id]);
      assert.deepEqual(receipt.assigned_issue_ids, [created.id]);
      assert.equal((await read(created.id)).iteration_id, next.id);
      assert.equal((await read(created.id)).sprint, "Sprint Beta");
      assert.ok(!(await iterations.getIteration("sprint")).requirement_ids.includes(created.id));
      assert.ok((await iterations.getIteration(next.id)).requirement_ids.includes(created.id));
      const originPage = await stories.getRequirementsPage({ project_id: "project", sprint_id: "sprint" });
      const destinationPage = await stories.getRequirementsPage({ project_id: "project", sprint_id: next.id });
      assert.ok(!originPage.items.some(item => item.id === created.id));
      assert.deepEqual(destinationPage.items.map(item => item.id), [created.id]);
      assert.deepEqual(await memberships(created.id), [{ release_id: "destination", source: "sprint" }]);
      await stories.updateRequirement(created.id, { iteration_id: "sprint", updated_by: "planner" });
      assert.ok(!(await iterations.getIteration(next.id)).requirement_ids.includes(created.id));
      assert.deepEqual(await memberships(created.id), [{ release_id: "old", source: "sprint" }]);
    });
  } finally { await Promise.all([db.close(), obsDb.close()]); }
});
