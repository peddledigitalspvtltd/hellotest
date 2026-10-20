const {createHash} = require('crypto');
const {KINDS,fail,text,list,number} = require('./knowledgeGraphContracts');
const {assertRetrievalActive} = require('@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming');
const VERSION='source-graph/1';
const edgeId=(project,source,type,target)=>`KGE-${createHash('sha256').update(JSON.stringify([project,source,type,target])).digest('hex')}`;

// Only structured fields emitted by the native application serializers qualify.
// Arbitrary uploaded text mentioning an ID is not a verified product relation.
function extractReferences(source) {
  const refs=[], metadata=source.metadata || {};
  const add=(kind,ids,type,reverse=false,marker='')=>{for(const id of list(typeof ids==='string'?[ids]:ids,50)){if(text(id))refs.push({kind,ref_id:text(id),type,reverse,marker});}};
  if(source.source_kind==='requirement')add('test_case',metadata.linked_test_case_ids,'TESTS',true,'Linked Test Case IDs');
  if(source.source_kind==='test_case')add('requirement',metadata.requirement_ids,'TESTS',false,'Requirement IDs');
  if(source.source_kind==='bug'){
    add('requirement',metadata.linked_requirement_ids,'HAS_DEFECT',true,'Linked Story IDs');
    add('test_case',metadata.linked_test_case_ids,'HAS_DEFECT',true,'Linked Test Case IDs');
    add('execution',metadata.linked_test_run_id,'HAS_DEFECT',true,'Linked Test Run ID');
  }
  return [...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
}
const proofFor=(chunks,reference)=>{
  for(const chunk of chunks){
    if(typeof chunk.content!=='string')continue;
    let start=0;
    for(const line of chunk.content.split('\n')){
      const colon=line.indexOf(':'),label=colon>=0?line.slice(0,colon).replace(/ \(\d+\)$/,''):'';
      if(label===reference.marker&&line.slice(colon+1).split(',').map(value=>value.trim()).includes(reference.ref_id)&&line.length<=4000){
        // Exact serializer field and exact list member, never an ID prefix or
        // a marker embedded in user prose from a neighbouring paragraph.
        return {chunk,span_start:Array.from(chunk.content.slice(0,start)).length,span_end:Array.from(chunk.content.slice(0,start+line.length)).length};
      }
      start+=line.length+1;
    }
  }
  return null;
};

function createProjection({db}) {
  const upsertNode=async(source,connection)=>{
    await connection.prepare(`INSERT INTO ai_knowledge_graph_nodes (id,project_id,source_id,entity_type,entity_key,title)
      VALUES (?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,entity_type=EXCLUDED.entity_type,
      entity_key=EXCLUDED.entity_key,tombstoned_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE ai_knowledge_graph_nodes.project_id=EXCLUDED.project_id`).run(source.id,source.project_id,source.id,source.source_kind,source.source_ref_id||source.id,source.title||source.id);
  };
  const syncDocument=async({projectId,source,document,chunks=[]}={},options={})=>{
    const connection=options.db||db;
    const active=()=>assertRetrievalActive(options.signal);
    active();
    if(!text(projectId)||!source?.id||source.project_id!==projectId||!KINDS.includes(source.source_kind)||!document?.id||!Number.isSafeInteger(document.version)||document.version<1||!text(document.checksum_sha256))throw fail('A scoped immutable document and source are required for graph projection.');
    const totalChunks=options.totalChunkCount??chunks.length;
    if(!Number.isSafeInteger(totalChunks)||totalChunks<chunks.length)throw fail('The graph fragment count must cover the supplied document fragments.');
    const omittedChunks=Math.max(0,totalChunks-3000);
    chunks=chunks.slice(0,3000);
    for(const chunk of chunks)if(!chunk.id||chunk.source_id!==source.id||chunk.document_id!==document.id||typeof chunk.content!=='string')throw fail('Graph fragments must belong to the exact supplied document and source.');
    await upsertNode(source,connection);
    await connection.prepare('DELETE FROM ai_knowledge_graph_chunk_entities WHERE document_id=? AND project_id=?').run(document.id,projectId);
    // Reconciliation is per immutable revision. Other sources' and human proofs survive.
    await connection.prepare("DELETE FROM ai_knowledge_graph_edge_evidence WHERE document_id=? AND project_id=? AND provenance_type='DETERMINISTIC'").run(document.id,projectId);
    if(chunks.length)await connection.prepare(`INSERT INTO ai_knowledge_graph_chunk_entities(project_id,chunk_id,node_id,source_id,document_id)
      SELECT ?,fragment.id,?,fragment.source_id,fragment.document_id FROM jsonb_to_recordset(?::jsonb) AS fragment(id TEXT,source_id TEXT,document_id TEXT)
      ON CONFLICT DO NOTHING`).run(projectId,source.id,chunks.map(chunk=>({id:chunk.id,source_id:chunk.source_id,document_id:chunk.document_id})));
    await connection.prepare(`UPDATE ai_knowledge_graph_nodes SET metadata=metadata||?::jsonb WHERE id=? AND project_id=?`).run({projection_fragment_limit:3000,projection_omitted_fragments:omittedChunks},source.id,projectId);
    let unresolved=0,edges=0;
    for(const ref of extractReferences(source)){
      active();
      const proof=proofFor(chunks,ref);
      if(!proof){unresolved++;continue;}
      const target=await connection.prepare("SELECT id,project_id,source_kind,source_ref_id,title FROM ai_knowledge_sources WHERE project_id=? AND source_kind=? AND source_ref_id=? AND extraction_status='ready'").get(projectId,ref.kind,ref.ref_id);
      if(!target||target.id===source.id){unresolved++;continue;}
      await upsertNode(target,connection);
      const sourceId=ref.reverse?target.id:source.id,targetId=ref.reverse?source.id:target.id;
      const id=edgeId(projectId,sourceId,ref.type,targetId);
      const row=await connection.prepare(`INSERT INTO ai_knowledge_graph_edges(id,project_id,source_node_id,target_node_id,relation_type,status,provenance_type,metadata)
        VALUES (?,?,?,?,?,'ACTIVE','DETERMINISTIC',?) ON CONFLICT(project_id,source_node_id,relation_type,target_node_id)
        DO UPDATE SET valid_to=NULL,status='ACTIVE',updated_at=CURRENT_TIMESTAMP
        WHERE ai_knowledge_graph_edges.provenance_type='DETERMINISTIC' AND ai_knowledge_graph_edges.status<>'REJECTED' RETURNING id`).get(id,projectId,sourceId,targetId,ref.type,{processing_version:VERSION});
      // A rejected/curated assertion cannot be approved by an ingestion retry.
      if(!row){unresolved++;continue;}
      await connection.prepare(`INSERT INTO ai_knowledge_graph_edge_evidence(edge_id,project_id,chunk_id,document_id,source_id,document_version,version_hash,span_start,span_end,provenance_type)
        VALUES (?,?,?,?,?,?,?,?,?,'DETERMINISTIC') ON CONFLICT(edge_id,chunk_id) DO UPDATE SET span_start=EXCLUDED.span_start,span_end=EXCLUDED.span_end
        WHERE ai_knowledge_graph_edge_evidence.provenance_type='DETERMINISTIC'`).run(row.id,projectId,proof.chunk.id,document.id,source.id,document.version,document.checksum_sha256,proof.span_start,proof.span_end);
      edges++;
    }
    // Activation calls this before flipping the current revision. The new
    // document replaces this source's old proofs; unrelated current witnesses
    // survive. Retain immutable evidence/history while closing unsupported edges.
    await connection.prepare(`UPDATE ai_knowledge_graph_edges edges SET status='TOMBSTONED',valid_to=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE edges.project_id=? AND edges.status='ACTIVE' AND edges.provenance_type='DETERMINISTIC'
      AND (edges.source_node_id=? OR edges.target_node_id=? OR EXISTS(SELECT 1 FROM ai_knowledge_graph_edge_evidence prior WHERE prior.edge_id=edges.id AND prior.source_id=?))
      AND NOT EXISTS(SELECT 1 FROM ai_knowledge_graph_edge_evidence evidence JOIN ai_knowledge_documents documents ON documents.id=evidence.document_id
        JOIN ai_knowledge_sources sources ON sources.id=evidence.source_id
        WHERE evidence.edge_id=edges.id AND evidence.provenance_type IN('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED')
        AND ((evidence.source_id=? AND evidence.document_id=?) OR(evidence.source_id<>? AND documents.is_active=TRUE AND sources.extraction_status='ready')))`)
      .run(projectId,source.id,source.id,source.id,source.id,document.id,source.id);
    await connection.prepare(`INSERT INTO ai_knowledge_graph_projection_states(document_id,project_id,unresolved_count,projected_edge_count,processing_version,next_attempt_at)
      VALUES (?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '60 seconds') ON CONFLICT(document_id) DO UPDATE SET unresolved_count=EXCLUDED.unresolved_count,
      projected_edge_count=EXCLUDED.projected_edge_count,processing_version=EXCLUDED.processing_version,reconciled_at=CURRENT_TIMESTAMP,next_attempt_at=EXCLUDED.next_attempt_at`).run(document.id,projectId,unresolved,edges,VERSION);
    active();
    return {document_id:document.id,node_id:source.id,edge_count:edges,unresolved_count:unresolved,processing_version:VERSION,partial:omittedChunks>0,omitted_chunk_count:omittedChunks};
  };
  const archiveSource=async({projectId,sourceId}={},options={})=>{const connection=options.db||db;await connection.prepare('UPDATE ai_knowledge_graph_nodes SET tombstoned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND source_id=?').run(projectId,sourceId);
    await connection.prepare("UPDATE ai_knowledge_graph_edges SET status='TOMBSTONED',valid_to=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND status='ACTIVE' AND(source_node_id=? OR target_node_id=?)").run(projectId,sourceId,sourceId);
    return {source_id:sourceId,tombstoned:true};};
  const projectDocument=async(documentId,signal)=>db.transaction(async()=>{
    assertRetrievalActive(signal);
    const row=await db.prepare(`SELECT documents.id AS document_id,documents.version AS graph_document_version,documents.checksum_sha256 AS graph_version_hash,sources.* FROM ai_knowledge_documents documents
      JOIN ai_knowledge_sources sources ON sources.id=documents.source_id JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id
      WHERE documents.id=? AND documents.is_active=TRUE AND sources.extraction_status='ready' AND indexes.required_indexes_ready=TRUE AND indexes.is_current=TRUE FOR UPDATE OF sources,documents`).get(documentId);
    if(!row)return null;
    assertRetrievalActive(signal);
    const chunks=await db.prepare('SELECT id,document_id,source_id,content,char_start,char_end FROM ai_knowledge_chunks WHERE document_id=? ORDER BY chunk_index LIMIT 3001').all(documentId);
    assertRetrievalActive(signal);
    // The capped body read cannot determine how many later fragments were
    // omitted. Count IDs only through UNIQUE(document_id,chunk_index), and only
    // when that read filled its cap; no additional fragment bodies are loaded.
    const totalChunkCount=chunks.length===3001?Number((await db.prepare('SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_chunks WHERE document_id=?').get(documentId)).count):chunks.length;
    return syncDocument({projectId:row.project_id,source:row,document:{id:row.document_id,version:Number(row.graph_document_version),checksum_sha256:row.graph_version_hash},chunks},{signal,totalChunkCount});
  })();
  const reconcilePage=async({projectId,cursor='',limit=15,signal}={})=>{
    assertRetrievalActive(signal);
    const count=number(limit,15,1,30);
    const rows=await db.prepare(`SELECT documents.id FROM ai_knowledge_documents documents JOIN ai_knowledge_sources sources ON sources.id=documents.source_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id WHERE documents.project_id=? AND documents.id>? AND documents.is_active=TRUE
      AND sources.extraction_status='ready' AND indexes.required_indexes_ready=TRUE ORDER BY documents.id LIMIT ?`).all(projectId,text(cursor),count+1);
    const results=[];for(const row of rows.slice(0,count)){assertRetrievalActive(signal);const result=await projectDocument(row.id,signal);if(result)results.push(result);}
    return {processed:results.length,results,next_cursor:rows.length>count?rows[count-1].id:null};
  };
  const processBackfill=async({limit=5}={})=>{
    const count=number(limit,5,1,30);
    const rows=await db.prepare(`SELECT documents.id FROM ai_knowledge_documents documents JOIN ai_knowledge_sources sources ON sources.id=documents.source_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id LEFT JOIN ai_knowledge_graph_projection_states projections ON projections.document_id=documents.id
      WHERE documents.is_active=TRUE AND sources.extraction_status='ready' AND indexes.required_indexes_ready=TRUE
      AND (projections.document_id IS NULL OR projections.processing_version<>? OR(projections.unresolved_count>0 AND projections.next_attempt_at<=CURRENT_TIMESTAMP))
      ORDER BY COALESCE(projections.reconciled_at,documents.created_at),documents.id LIMIT ?`).all(VERSION,count);
    let processed=0;for(const row of rows){if(await projectDocument(row.id))processed++;}return {processed};
  };
  return {syncDocument,archiveSource,reconcilePage,processBackfill};
}
module.exports={createProjection,extractReferences,proofFor,edgeId,VERSION};
