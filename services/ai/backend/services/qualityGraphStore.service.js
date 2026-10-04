const db = require('@hellotest/platform/backend/src/db');
const { randomUUID } = require('node:crypto');
const { hash, buildGraph } = require('./qualityEvidenceRules');

async function persist(snapshot, user) {
  const changes = require('./qualityGraphChanges');
  const graph = buildGraph(snapshot), id = randomUUID();
  // The same scope includes the actor and the actual accessible source set.
  // A narrower permission scope must never tombstone another user's index.
  const scopeKey = hash([snapshot.scope,user.id,snapshot.limitations]);
  const contentHash = hash([graph.nodes.map(node=>[node.id,node.revision]),graph.edges]);
  await db.transaction(async()=>{
    await db.query("SET LOCAL statement_timeout = '8000ms'");
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`quality-graph:${snapshot.project_id}:${scopeKey}`);
    const previous = await db.prepare('SELECT id,observed_at FROM quality_graph_snapshots WHERE project_id=? AND scope_key=? ORDER BY observed_at DESC LIMIT 1').get(snapshot.project_id,scopeKey);
    await db.prepare(`INSERT INTO quality_graph_snapshots(id,project_id,scope_key,scope,captured_by,content_hash,observed_at,complete,limitations) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id,snapshot.project_id,scopeKey,snapshot.scope,user.id,contentHash,snapshot.as_of,snapshot.complete,snapshot.limitations);
    await db.prepare(`INSERT INTO quality_graph_nodes(project_id,entity_id,revision,kind,title,first_observed_at)
      SELECT ?,n.id,n.revision,n.kind,n.title,?::timestamptz FROM jsonb_to_recordset(?::jsonb) AS n(id text,revision text,kind text,title text)
      ON CONFLICT DO NOTHING`).run(snapshot.project_id,snapshot.as_of,graph.nodes);
    await db.prepare(`INSERT INTO quality_graph_snapshot_nodes(project_id,snapshot_id,entity_id,revision)
      SELECT ?,?,n.id,n.revision FROM jsonb_to_recordset(?::jsonb) AS n(id text,revision text)`).run(snapshot.project_id,id,graph.nodes);
    await db.prepare(`INSERT INTO quality_graph_edges(project_id,snapshot_id,id,source_id,source_revision,target_id,target_revision,relation_type,origin,validation_state,evidence_ids,observed_at)
      SELECT ?,?,e.id,e.source,e.source_revision,e.target,e.target_revision,e.relation,e.origin,e.evidence_status,COALESCE(e.evidence_ids,jsonb_build_array(e.source,e.target)),?::timestamptz
      FROM jsonb_to_recordset(?::jsonb) AS e(id text,source text,source_revision text,target text,target_revision text,relation text,origin text,evidence_status text,evidence_ids jsonb)`)
      .run(snapshot.project_id,id,snapshot.as_of,graph.edges);
    // Missing nodes can mean deletion or lost scope. Only complete comparable
    // snapshots can establish removal, and an older concurrent read cannot win.
    if (snapshot.complete && previous && new Date(previous.observed_at) <= new Date(snapshot.as_of)) await db.prepare(`INSERT INTO quality_graph_tombstones(project_id,snapshot_id,entity_id,previous_revision,reason,observed_at)
      SELECT ?,?,old.entity_id,old.revision,'absent_from_complete_scope',?::timestamptz FROM quality_graph_snapshot_nodes old WHERE old.snapshot_id=?
      AND NOT EXISTS(SELECT 1 FROM quality_graph_snapshot_nodes current WHERE current.snapshot_id=? AND current.entity_id=old.entity_id)`)
      .run(snapshot.project_id,id,snapshot.as_of,previous.id,id);
  })();
  return { snapshot_id:id,content_hash:contentHash,observed_at:snapshot.as_of,mode:'revision_index',...await changes.freshness(snapshot.project_id,id),refresh:'Source changes invalidate saved assessments. Authoritative sources are read again for every assessment.' };
}
module.exports = { persist };
