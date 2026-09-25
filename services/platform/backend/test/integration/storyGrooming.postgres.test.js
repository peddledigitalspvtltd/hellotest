const assert = require("node:assert/strict");
const test = require("node:test");

test("AI Groom Story reads permitted linked evidence and scoped counts in PostgreSQL", {
  skip: process.env.STORY_GROOMING_POSTGRES !== "1",
  timeout: 30_000
}, async (t) => {
  const db = require("../../src/db");
  const service = require("../../../../manual/backend/services/requirementWorkspace.service");
  const featureFlags = require("../../services/featureFlag.service");
  const selection = require("../../../../integration/backend/services/aiLlmSelection.service");
  t.mock.method(featureFlags, "getDisabledPermissionCodes", async () => []);
  t.mock.method(selection, "resolveLlmIntegrationForUsage", async () => null);

  try {
    // All fixture records stay in transaction-local temporary tables. Restrict
    // the search path so no application tables can be read or modified.
    await db.transaction(async () => {
      await db.query(`
        SET LOCAL search_path TO pg_temp, pg_catalog;
        CREATE TEMP TABLE entity_comments(id text, entity_type text, entity_id text, body text, created_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE attachments(id text, entity_type text, entity_id text, file_name text, mime_type text, size_bytes bigint, created_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE app_types(id text, project_id text) ON COMMIT DROP;
        CREATE TEMP TABLE test_cases(id text, display_id text, title text, status text, app_type_id text, requirement_id text) ON COMMIT DROP;
        CREATE TEMP TABLE requirement_test_cases(requirement_id text, test_case_id text) ON COMMIT DROP;
        CREATE TEMP TABLE feedback(id text, jira_bug_key text, title text, status text, project_id text, created_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE requirement_defects(requirement_id text, issue_id text) ON COMMIT DROP;
        INSERT INTO app_types VALUES ('app', 'project'), ('foreign-app', 'foreign-project');
        INSERT INTO test_cases
          SELECT 'case-' || n, 'TC-' || n, 'Case ' || n, 'ready', 'app', 'another-story'
          FROM generate_series(1, 51) n;
        INSERT INTO requirement_test_cases SELECT 'story', 'case-' || n FROM generate_series(1, 51) n;
        INSERT INTO test_cases VALUES ('foreign-case', 'TC-foreign', 'Foreign case', 'ready', 'foreign-app', 'story');
        INSERT INTO requirement_test_cases VALUES ('story', 'foreign-case');
        INSERT INTO feedback VALUES
          ('defect', 'BUG-1', 'Linked issue', 'open', 'project', CURRENT_TIMESTAMP),
          ('foreign-defect', 'BUG-foreign', 'Foreign issue', 'open', 'foreign-project', CURRENT_TIMESTAMP);
        INSERT INTO requirement_defects VALUES ('story', 'defect'), ('story', 'foreign-defect');
      `);
      const input = {
        requirement: {
          id: "story", title: "Review reports", status: "draft",
          description: "As a reviewer, I want to inspect a report so that I can decide its next state."
        },
        project: { id: "project" },
        user: { id: "admin", role: "admin" }
      };
      const preview = await service.previewGrooming(input);
      assert.equal(preview.preview_only, true);
      assert.equal(preview.context.included.related_project_records, 50);
      assert.equal(preview.context.omitted.related_project_records, 1);
      assert.equal(preview.context.included.linked_tickets, 1);
      assert.equal(preview.context.omitted.linked_tickets, 0);
      assert.deepEqual(preview.context.partial_sources, ["related_project_records"]);
      assert.deepEqual(preview.context.unavailable_sources, []);
      assert.ok(preview.context.sources.every((source) => !source.ref.includes("foreign")));
      assert.equal(preview.grooming.readiness.checks.find((check) => check.id === "test-coverage").status, "met");
      assert.equal(preview.generation_mode, "deterministic");

      const empty = await service.previewGrooming({ ...input, requirement: { ...input.requirement, id: "unlinked-story" } });
      assert.equal(empty.context.included.related_project_records, 0);
      assert.equal(empty.context.omitted.related_project_records, 0);
      assert.equal(empty.grooming.readiness.checks.find((check) => check.id === "test-coverage").status, "missing");
    })();
  } finally {
    await db.close();
  }
});
