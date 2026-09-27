const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("@hellotest/platform/backend/src/db");
const batches = require("../../backend/services/batchProcess.service");

test("batch jobs preserve explicit browser action authorization and default it off", async context => {
  context.mock.method(db.pool, "query", async () => ({ rows: [{ id: "app", project_id: "project" }] }));
  context.mock.method(batches, "queueBatchJob", async input => input);
  for (const authorization of [undefined, false, true, "true"]) {
    const job = await batches.queueAutomationBuild({ app_type_id: "app", test_case_ids: ["case"], created_by: "user", allow_browser_actions: authorization });
    assert.equal(job.payload.allow_browser_actions, authorization === true);
    assert.equal(job.title, "Build with automation agent");
  }
});
