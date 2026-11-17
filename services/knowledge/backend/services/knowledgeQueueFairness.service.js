"use strict";

const db = require("@hellotest/platform/backend/src/db");

const STAGES = new Set(["ingestion", "graph_projection", "vector_projection", "semantic_work"]);

// Serialize only the short claim transaction for a stage. The actual work runs
// without the advisory lock, while every claimant sees the last project served
// and rotates to the next due project before taking a second item.
const claimFairQueueRow = async ({ stage, sql, params = [], claim } = {}) => {
  if (!STAGES.has(stage) || typeof sql !== "string" || !sql.trim()) throw new Error("Use a registered Knowledge queue stage and query.");
  return db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`hellotest:knowledge:${stage}`);
    const row = await db.prepare(sql).get(...params);
    if (!row) return null;
    const result = typeof claim === "function" ? await claim(row) : row;
    if (result && row.project_id) {
      await db.prepare(`INSERT INTO ai_knowledge_worker_project_fairness(queue_stage,project_id,last_served_at)
        VALUES(?,?,clock_timestamp()) ON CONFLICT(queue_stage,project_id)
        DO UPDATE SET last_served_at=EXCLUDED.last_served_at`).run(stage, row.project_id);
    }
    return result;
  })();
};

module.exports = { STAGES: Object.freeze([...STAGES]), claimFairQueueRow };
