const db = require('@hellotest/platform/backend/src/db');
let running = false;
async function processPending() {
  if (running) return;
  running = true;
  try {
    await db.transaction(async () => {
      await db.query("SET LOCAL statement_timeout = '4s'");
      await db.query(`DELETE FROM quality_graph_change_outbox WHERE id IN (SELECT id FROM quality_graph_change_outbox
        WHERE processed_at < CURRENT_TIMESTAMP-INTERVAL '30 days' ORDER BY processed_at LIMIT 2000)`);
      const events = await db.prepare(`SELECT * FROM quality_graph_change_outbox WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200`).all();
      if (!events.length) return;
      for (const project of new Set(events.map(event=>event.project_id))) {
        // Invalidation is deliberately conservative. An old event delivered
        // late may require an extra refresh, but cannot leave stale data fresh.
        await db.prepare(`UPDATE quality_graph_snapshots SET invalidated_at=COALESCE(invalidated_at,CURRENT_TIMESTAMP)
          WHERE project_id=? AND invalidated_at IS NULL`).run(project);
      }
      for (const event of events.filter(event=>event.operation==='DELETE'&&event.entity_id)) {
        await db.prepare(`INSERT INTO quality_graph_tombstones(project_id,snapshot_id,entity_id,previous_revision,reason,observed_at)
          SELECT project_id,snapshot_id,entity_id,revision,'recorded_source_deletion',? FROM quality_graph_snapshot_nodes
          WHERE project_id=? AND entity_id=? ON CONFLICT(snapshot_id,entity_id) DO NOTHING`).run(event.occurred_at,event.project_id,event.entity_id);
      }
      await db.prepare(`UPDATE quality_graph_change_outbox SET processed_at=CURRENT_TIMESTAMP WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::jsonb))`).run(events.map(event=>event.id));
    })();
  } finally { running=false; }
}
async function freshness(projectId,snapshotId) {
  const row=await db.prepare(`SELECT invalidated_at,EXISTS(SELECT 1 FROM quality_graph_change_outbox e WHERE e.project_id=s.project_id AND processed_at IS NULL) AS pending,
    EXISTS(SELECT 1 FROM quality_graph_change_outbox e WHERE e.project_id=s.project_id AND e.processed_at>=s.observed_at) AS changed_during_capture
    FROM quality_graph_snapshots s WHERE s.project_id=? AND s.id=?`).get(projectId,snapshotId);
  return { freshness:!row?'unavailable':row.invalidated_at||row.changed_during_capture?'stale':row.pending?'changes_pending':'current',invalidated_at:row?.invalidated_at||null };
}
module.exports={processPending,freshness};
