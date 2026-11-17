const {createHash} = require('crypto');
const {KINDS,fail,text,list,number} = require('./knowledgeGraphContracts');
const {NATIVE_KINDS,DOCUMENT_KINDS} = require('./knowledgeOntology');
const {LINK_FIELDS} = require('./knowledgeLinkLabels');
const {IDENTIFIER_PATTERN} = require('./knowledgeLexicalQuery');
const {claimFairQueueRow} = require('./knowledgeQueueFairness.service');
const {assertRetrievalActive} = require('@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming');

// 3: display-ID aliases, MENTIONS edges, unresolved-reference ledger and
// exponential retry. Raising the version re-projects every document in the
// background through processBackfill.
const VERSION='source-graph/3';
const MENTION_LIMIT=50;
const MENTION_WITNESSES=3;
// A link whose target is not indexed yet is retried with exponential backoff
// (1m, 2m, 4m ...) up to this ceiling, and immediately when the target arrives.
const BACKOFF_BASE_SECONDS=60;
const BACKOFF_CEILING_SECONDS=6*3600;
const MENTION_GENERATOR='knowledge-mentions';
const edgeId=(project,source,type,target)=>`KGE-${createHash('sha256').update(JSON.stringify([project,source,type,target])).digest('hex')}`;
const codepoints=value=>Array.from(value).length;

const retryDelaySeconds=attempt=>Math.min(BACKOFF_CEILING_SECONDS,BACKOFF_BASE_SECONDS*2**Math.max(0,Math.min(attempt,20)));

const displayIdOf=source=>{
  const value=source?.metadata?.display_id;
  return typeof value==='string'&&text(value)?text(value,255):null;
};

// Only structured fields emitted by the native application serializers qualify
// as verified product relations. Their ids come from metadata, and the labels
// that witness them in the text come from knowledgeLinkLabels, shared with the
// serializers so the two cannot drift apart.
function extractReferences(source) {
  const refs=[], metadata=source.metadata || {};
  const add=(spec,ids)=>{for(const id of (typeof ids==='string'?[ids]:Array.isArray(ids)?ids:[])){if(text(id))refs.push({field:spec.field,kind:spec.kind,ref_id:text(id),type:spec.type,reverse:spec.reverse,marker:spec.label});}};
  for(const spec of LINK_FIELDS[source.source_kind]||[])add(spec,metadata[spec.field]);
  return [...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()];
}
function declaredReferenceCount(source) {
  const metadata=source.metadata||{};
  return (LINK_FIELDS[source.source_kind]||[]).reduce((total,spec)=>{
    const raw=typeof metadata[spec.field]==='string'?[metadata[spec.field]]:Array.isArray(metadata[spec.field])?metadata[spec.field]:[];
    const known=new Set(raw.filter(value=>typeof value==='string'&&text(value)).map(value=>text(value))).size;
    const declared=spec.countField?metadata[spec.countField]:undefined;
    return total+Math.max(known,Number.isSafeInteger(declared)&&declared>=0?declared:0);
  },0);
}
const proofFor=(chunks,reference)=>{
  for(const chunk of chunks){
    const structured=Array.isArray(chunk.relationship_records)?chunk.relationship_records:Array.isArray(chunk.metadata?.relationship_records)?chunk.metadata.relationship_records:[];
    const record=structured.find(item=>item.field===reference.field&&item.kind===reference.kind&&item.ref_id===reference.ref_id&&item.type===reference.type);
    if(record&&Number.isSafeInteger(record.span_start)&&Number.isSafeInteger(record.span_end))return{chunk,span_start:record.span_start,span_end:record.span_end};
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

// Exact display IDs (STORY-12, TC-0045) in free-form material. Each distinct ID
// keeps up to MENTION_WITNESSES occurrences with their code-point spans.
const findMentions=chunks=>{
  const found=new Map();
  for(const chunk of chunks){
    if(typeof chunk.content!=='string')continue;
    for(const match of chunk.content.matchAll(new RegExp(IDENTIFIER_PATTERN.source,'gi'))){
      const id=match[0].toUpperCase();
      if(!found.has(id)){if(found.size>=MENTION_LIMIT*4)break;found.set(id,[]);}
      const witnesses=found.get(id);
      if(witnesses.length>=MENTION_WITNESSES||witnesses.some(item=>item.chunk.id===chunk.id))continue;
      const start=codepoints(chunk.content.slice(0,match.index));
      witnesses.push({chunk,span_start:start,span_end:start+codepoints(match[0])});
    }
  }
  return found;
};

function createProjection({db}) {
  // Returns whether the node is new (or was tombstoned): the moment other
  // documents that were waiting for this record can be re-projected.
  const upsertNode=async(source,connection)=>{
    const before=await connection.prepare('SELECT tombstoned_at FROM ai_knowledge_graph_nodes WHERE id=? AND project_id=?').get(source.id,source.project_id);
    const display=displayIdOf(source);
    // Aliases are merged, not replaced: curated aliases survive re-projection.
    await connection.prepare(`INSERT INTO ai_knowledge_graph_nodes (id,project_id,source_id,entity_type,entity_key,title,aliases)
      VALUES (?,?,?,?,?,?,?::jsonb) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,entity_type=EXCLUDED.entity_type,
      entity_key=EXCLUDED.entity_key,tombstoned_at=NULL,updated_at=CURRENT_TIMESTAMP,
      aliases=(SELECT COALESCE(jsonb_agg(DISTINCT alias),'[]'::jsonb) FROM jsonb_array_elements(ai_knowledge_graph_nodes.aliases||EXCLUDED.aliases) AS alias)
      WHERE ai_knowledge_graph_nodes.project_id=EXCLUDED.project_id`).run(source.id,source.project_id,source.id,source.source_kind,source.source_ref_id||source.id,source.title||source.id,display?[display]:[]);
    return !before||before.tombstoned_at!==null;
  };
  // Wake documents that were waiting for this record: links to it that could not
  // be resolved, and free-form documents whose text mentions its display ID.
  const requeueDependents=async(source,connection)=>{
    if(!NATIVE_KINDS.includes(source.source_kind))return;
    const refs=[source.source_ref_id,displayIdOf(source)&&displayIdOf(source).toUpperCase()].filter(Boolean);
    if(refs.length)await connection.prepare(`UPDATE ai_knowledge_graph_projection_states states SET next_attempt_at=CURRENT_TIMESTAMP,attempt_count=0
      WHERE states.project_id=? AND states.document_id IN(SELECT refs.document_id FROM ai_knowledge_graph_unresolved_refs refs
        WHERE refs.project_id=? AND refs.target_kind=? AND refs.reason='target_not_indexed' AND refs.target_ref IN(SELECT jsonb_array_elements_text(?::jsonb)))`).run(source.project_id,source.project_id,source.source_kind,refs);
    const display=displayIdOf(source);
    if(display)await connection.prepare(`UPDATE ai_knowledge_graph_projection_states states SET unresolved_count=GREATEST(states.unresolved_count,1),next_attempt_at=CURRENT_TIMESTAMP,attempt_count=0
      WHERE states.project_id=? AND states.document_id IN(SELECT DISTINCT chunks.document_id FROM ai_knowledge_chunks chunks
        JOIN ai_knowledge_documents documents ON documents.id=chunks.document_id AND documents.is_active=TRUE
        JOIN ai_knowledge_sources sources ON sources.id=chunks.source_id
        WHERE chunks.project_id=? AND sources.source_kind IN(${DOCUMENT_KINDS.map(()=>'?').join(',')}) AND chunks.search_vector @@ plainto_tsquery('simple',?) LIMIT ${MENTION_LIMIT})`).run(source.project_id,source.project_id,...DOCUMENT_KINDS,display);
  };
  // One edge plus its witnesses. A rejected or curated assertion is never
  // revived or overwritten by an ingestion retry.
  const writeEdge=async({connection,projectId,sourceId,targetId,type,provenance,generator,document,source,witnesses})=>{
    const id=edgeId(projectId,sourceId,type,targetId);
    const row=await connection.prepare(`INSERT INTO ai_knowledge_graph_edges(id,project_id,source_node_id,target_node_id,relation_type,status,provenance_type,metadata)
      VALUES (?,?,?,?,?,'ACTIVE',?,?) ON CONFLICT(project_id,source_node_id,relation_type,target_node_id)
      DO UPDATE SET valid_to=NULL,status='ACTIVE',updated_at=CURRENT_TIMESTAMP
      WHERE ai_knowledge_graph_edges.provenance_type=EXCLUDED.provenance_type AND ai_knowledge_graph_edges.status<>'REJECTED' RETURNING id`).get(id,projectId,sourceId,targetId,type,provenance,{processing_version:VERSION,...(generator?{generator}:{})});
    if(!row)return false;
    for(const proof of witnesses){
      await connection.prepare(`INSERT INTO ai_knowledge_graph_edge_evidence(edge_id,project_id,chunk_id,document_id,source_id,document_version,version_hash,span_start,span_end,provenance_type)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(edge_id,chunk_id) DO UPDATE SET span_start=EXCLUDED.span_start,span_end=EXCLUDED.span_end
        WHERE ai_knowledge_graph_edge_evidence.provenance_type=EXCLUDED.provenance_type`).run(row.id,projectId,proof.chunk.id,document.id,source.id,document.version,document.checksum_sha256,proof.span_start,proof.span_end,provenance);
    }
    return true;
  };
  const syncDocument=async({projectId,source,document,chunks=[]}={},options={})=>{
    const connection=options.db||db;
    const active=()=>assertRetrievalActive(options.signal);
    active();
    if(!text(projectId)||!source?.id||source.project_id!==projectId||!KINDS.includes(source.source_kind)||!document?.id||!Number.isSafeInteger(document.version)||document.version<1||!text(document.checksum_sha256))throw fail('A scoped immutable document and source are required for graph projection.');
    const totalChunks=options.totalChunkCount??chunks.length;
    if(!Number.isSafeInteger(totalChunks)||totalChunks<chunks.length)throw fail('The graph fragment count must cover the supplied document fragments.');
    const omittedChunks=Math.max(0,totalChunks-50_000);
    chunks=chunks.slice(0,50_000);
    for(const chunk of chunks)if(!chunk.id||chunk.source_id!==source.id||chunk.document_id!==document.id||typeof chunk.content!=='string')throw fail('Graph fragments must belong to the exact supplied document and source.');
    const arrived=await upsertNode(source,connection);
    if(arrived)await requeueDependents(source,connection);
    await connection.prepare('DELETE FROM ai_knowledge_graph_chunk_entities WHERE document_id=? AND project_id=?').run(document.id,projectId);
    await connection.prepare('DELETE FROM ai_knowledge_graph_unresolved_refs WHERE document_id=? AND project_id=?').run(document.id,projectId);
    // Reconciliation is per immutable revision. Other sources' and human proofs survive.
    await connection.prepare("DELETE FROM ai_knowledge_graph_edge_evidence WHERE document_id=? AND project_id=? AND provenance_type='DETERMINISTIC'").run(document.id,projectId);
    await connection.prepare(`DELETE FROM ai_knowledge_graph_edge_evidence evidence USING ai_knowledge_graph_edges edges
      WHERE evidence.document_id=? AND evidence.project_id=? AND edges.id=evidence.edge_id AND edges.project_id=evidence.project_id
      AND edges.relation_type='MENTIONS' AND edges.metadata->>'generator'=?`).run(document.id,projectId,MENTION_GENERATOR);
    if(chunks.length)await connection.prepare(`INSERT INTO ai_knowledge_graph_chunk_entities(project_id,chunk_id,node_id,source_id,document_id)
      SELECT ?,fragment.id,?,fragment.source_id,fragment.document_id FROM jsonb_to_recordset(?::jsonb) AS fragment(id TEXT,source_id TEXT,document_id TEXT)
      ON CONFLICT DO NOTHING`).run(projectId,source.id,chunks.map(chunk=>({id:chunk.id,source_id:chunk.source_id,document_id:chunk.document_id})));
    const references=extractReferences(source),declaredReferences=declaredReferenceCount(source),omittedReferences=Math.max(0,declaredReferences-references.length);
    await connection.prepare(`UPDATE ai_knowledge_graph_nodes SET metadata=metadata||?::jsonb WHERE id=? AND project_id=?`).run({projection_fragment_limit:50_000,projection_omitted_fragments:omittedChunks,
      projection_reference_limit_per_field:null,projection_declared_references:declaredReferences,projection_omitted_references:omittedReferences},source.id,projectId);
    let retryable=0,witnessMissing=0,edges=0,mentions=0;
    const unresolved=async(kind,ref,reason)=>connection.prepare(`INSERT INTO ai_knowledge_graph_unresolved_refs(project_id,document_id,target_kind,target_ref,reason)
      VALUES (?,?,?,?,?) ON CONFLICT(document_id,target_kind,target_ref) DO NOTHING`).run(projectId,document.id,kind,ref,reason);
    for(const ref of references){
      active();
      const proof=proofFor(chunks,ref);
      // The serializer's text no longer carries the declared link: surfaced as its
      // own reason (retrying cannot fix it) rather than looking like a missing target.
      if(!proof){witnessMissing++;await unresolved(ref.kind,ref.ref_id,'witness_missing');continue;}
      const target=await connection.prepare("SELECT id,project_id,source_kind,source_ref_id,title,metadata FROM ai_knowledge_sources WHERE project_id=? AND source_kind=? AND source_ref_id=? AND extraction_status='ready'").get(projectId,ref.kind,ref.ref_id);
      if(!target||target.id===source.id){retryable++;await unresolved(ref.kind,ref.ref_id,'target_not_indexed');continue;}
      await upsertNode(target,connection);
      const written=await writeEdge({connection,projectId,sourceId:ref.reverse?target.id:source.id,targetId:ref.reverse?source.id:target.id,type:ref.type,provenance:'DETERMINISTIC',document,source,witnesses:[proof]});
      if(!written){await unresolved(ref.kind,ref.ref_id,'edge_rejected');continue;}
      edges++;
    }
    // Every execution result is its own run.view-protected source. The edge
    // uses that result fragment as proof, while both endpoint records retain
    // their own current permission checks. A run summary cannot declassify a
    // test's result or logs.
    if(source.source_kind==='execution_result'){
      const metadata=source.metadata||{},caseId=text(metadata.test_case_id),runId=text(metadata.execution_id);
      const proof=chunks.find(chunk=>typeof chunk.content==='string'&&chunk.content.includes(`Test Case ID: ${caseId}`)&&chunk.content.includes(`Test Run ID: ${runId}`));
      const [testCase,run]=await Promise.all([
        caseId?connection.prepare("SELECT id,project_id,source_kind,source_ref_id,title,metadata FROM ai_knowledge_sources WHERE project_id=? AND source_kind='test_case' AND source_ref_id=? AND extraction_status='ready'").get(projectId,caseId):null,
        runId?connection.prepare("SELECT id,project_id,source_kind,source_ref_id,title,metadata FROM ai_knowledge_sources WHERE project_id=? AND source_kind='execution' AND source_ref_id=? AND extraction_status='ready'").get(projectId,runId):null
      ]);
      if(!proof){witnessMissing++;await unresolved('test_case',caseId||source.id,'witness_missing');}
      else if(!testCase||!run){retryable++;if(!testCase)await unresolved('test_case',caseId||source.id,'target_not_indexed');if(!run)await unresolved('execution',runId||source.id,'target_not_indexed');}
      else{
        await upsertNode(testCase,connection);await upsertNode(run,connection);
        const line=proof.content.trim(),offset=proof.content.indexOf(line);
        const evidence={chunk:proof,span_start:codepoints(proof.content.slice(0,offset)),span_end:codepoints(proof.content.slice(0,offset+line.length))};
        if(await writeEdge({connection,projectId,sourceId:testCase.id,targetId:run.id,type:'EXECUTED_IN',provenance:'DETERMINISTIC',document,source,witnesses:[evidence]}))edges++;
      }
    }
    // Free-form material that quotes an exact display ID gets a weaker MENTIONS
    // edge. It never counts as coverage: TESTS/DEPENDS_ON stay reserved for
    // links verified from native records.
    if(DOCUMENT_KINDS.includes(source.source_kind)&&chunks.length){
      const found=findMentions(chunks);
      if(found.size){
        const candidates=await connection.prepare(`SELECT id,project_id,source_kind,source_ref_id,title,metadata FROM ai_knowledge_sources
          WHERE project_id=? AND extraction_status='ready' AND source_kind IN(${NATIVE_KINDS.map(()=>'?').join(',')})
          AND UPPER(COALESCE(metadata->>'display_id',''))IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY id LIMIT ${MENTION_LIMIT}`).all(projectId,...NATIVE_KINDS,[...found.keys()]);
        for(const target of candidates){
          active();
          const witnesses=found.get(String(displayIdOf(target)||'').toUpperCase());
          if(!witnesses?.length||target.id===source.id)continue;
          await upsertNode(target,connection);
          if(await writeEdge({connection,projectId,sourceId:source.id,targetId:target.id,type:'MENTIONS',provenance:'SOURCE_EXPLICIT',generator:MENTION_GENERATOR,document,source,witnesses}))mentions++;
        }
      }
    }
    // Activation calls this before flipping the current revision. The new
    // document replaces this source's old proofs; unrelated current witnesses
    // survive. Retain immutable evidence/history while closing unsupported edges.
    await connection.prepare(`UPDATE ai_knowledge_graph_edges edges SET status='TOMBSTONED',valid_to=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE edges.project_id=? AND edges.status='ACTIVE'
      AND (edges.provenance_type='DETERMINISTIC' OR (edges.relation_type='MENTIONS' AND edges.provenance_type='SOURCE_EXPLICIT' AND edges.metadata->>'generator'=?))
      AND (edges.source_node_id=? OR edges.target_node_id=? OR EXISTS(SELECT 1 FROM ai_knowledge_graph_edge_evidence prior WHERE prior.edge_id=edges.id AND prior.source_id=?))
      AND NOT EXISTS(SELECT 1 FROM ai_knowledge_graph_edge_evidence evidence JOIN ai_knowledge_documents documents ON documents.id=evidence.document_id
        JOIN ai_knowledge_sources sources ON sources.id=evidence.source_id
        WHERE evidence.edge_id=edges.id AND evidence.provenance_type IN('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED')
        AND ((evidence.source_id=? AND evidence.document_id=?) OR(evidence.source_id<>? AND documents.is_active=TRUE AND sources.extraction_status='ready')))`)
      .run(projectId,MENTION_GENERATOR,source.id,source.id,source.id,source.id,document.id,source.id);
    // Exponential backoff: only links whose target may yet arrive are retried,
    // and each consecutive unresolved pass doubles the wait up to the ceiling.
    const prior=await connection.prepare('SELECT unresolved_count,attempt_count FROM ai_knowledge_graph_projection_states WHERE document_id=?').get(document.id);
    const attempt=retryable>0&&prior&&Number(prior.unresolved_count)>0?Math.min(Number(prior.attempt_count||0)+1,20):0;
    await connection.prepare(`INSERT INTO ai_knowledge_graph_projection_states(document_id,project_id,unresolved_count,projected_edge_count,processing_version,attempt_count,next_attempt_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 second')) ON CONFLICT(document_id) DO UPDATE SET unresolved_count=EXCLUDED.unresolved_count,
      projected_edge_count=EXCLUDED.projected_edge_count,processing_version=EXCLUDED.processing_version,attempt_count=EXCLUDED.attempt_count,
      reconciled_at=CURRENT_TIMESTAMP,next_attempt_at=EXCLUDED.next_attempt_at`).run(document.id,projectId,retryable,edges+mentions,VERSION,attempt,retryDelaySeconds(attempt));
    active();
    const unresolvedTotal=retryable+witnessMissing;
    return {document_id:document.id,node_id:source.id,edge_count:edges,mention_count:mentions,unresolved_count:unresolvedTotal,retryable_unresolved_count:retryable,witness_missing_count:witnessMissing,
      processing_version:VERSION,partial:omittedChunks>0||omittedReferences>0||unresolvedTotal>0,omitted_chunk_count:omittedChunks,omitted_reference_count:omittedReferences};
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
    const chunks=await db.prepare('SELECT id,document_id,source_id,content,char_start,char_end,metadata FROM ai_knowledge_chunks WHERE document_id=? ORDER BY chunk_index LIMIT 50001').all(documentId);
    assertRetrievalActive(signal);
    // The capped body read cannot determine how many later fragments were
    // omitted. Count IDs only through UNIQUE(document_id,chunk_index), and only
    // when that read filled its cap; no additional fragment bodies are loaded.
    const totalChunkCount=chunks.length===50001?Number((await db.prepare('SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_chunks WHERE document_id=?').get(documentId)).count):chunks.length;
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
    let processed=0;
    for(let index=0;index<count;index++){
      const row=await claimFairQueueRow({stage:'graph_projection',sql:`SELECT documents.id,documents.project_id FROM ai_knowledge_documents documents
        JOIN ai_knowledge_sources sources ON sources.id=documents.source_id JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id
        LEFT JOIN ai_knowledge_graph_projection_states projections ON projections.document_id=documents.id
        LEFT JOIN ai_knowledge_worker_project_fairness fairness ON fairness.queue_stage='graph_projection' AND fairness.project_id=documents.project_id
        WHERE documents.is_active=TRUE AND sources.extraction_status='ready' AND indexes.required_indexes_ready=TRUE
          AND (projections.document_id IS NULL OR projections.processing_version<>? OR(projections.unresolved_count>0 AND projections.next_attempt_at<=CURRENT_TIMESTAMP))
        ORDER BY fairness.last_served_at ASC NULLS FIRST,COALESCE(projections.reconciled_at,documents.created_at),documents.id
        LIMIT 1 FOR UPDATE OF documents SKIP LOCKED`,params:[VERSION]});
      if(!row)break;
      if(await projectDocument(row.id))processed++;
    }
    return {processed};
  };
  return {syncDocument,archiveSource,reconcilePage,processBackfill};
}
module.exports={createProjection,extractReferences,proofFor,edgeId,findMentions,retryDelaySeconds,BACKOFF_BASE_SECONDS,BACKOFF_CEILING_SECONDS,VERSION};
