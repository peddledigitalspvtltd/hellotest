const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const features = require('@hellotest/platform/backend/services/featureFlag.service');
const projectAccess = require('@hellotest/platform/backend/public/projectAccess');
const authorization = require('./knowledgeAuthorization.service');
const {sanitizeAiText,fingerprint} = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const {assertRetrievalActive,boundedRetrievalStage} = require('@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming');
const {createProjection} = require('./knowledgeGraphProjection.service');
const {KINDS,RELATIONS,PERMISSIONS,LIMITS,describe,fail,text,list,number} = require('./knowledgeGraphContracts');
const {reachableGraph,packGraph} = require('./knowledgeGraphPacking');
const {compactGraphEvidence} = require('./knowledgeGraphEvidence');
const {impliedRelations} = require('./knowledgeOntology');

const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const publicNode = row => ({id:row.id,source_id:row.id,kind:row.entity_type,type:row.entity_type,ref_id:row.entity_key,key:row.entity_key,
  title:sanitizeAiText(text(row.title,500)).text,aliases:list(row.aliases,30).filter(value=>typeof value==='string').map(value=>sanitizeAiText(text(value,255)).text).filter(Boolean),
  ...(row.created_at ? {created_at:date(row.created_at)} : {}),...(row.updated_at ? {updated_at:date(row.updated_at)} : {}),
  evidence_state:'CURRENT',confidence:null});

function createGraph(dependencies={}) {
  const store=dependencies.db||db,acl=dependencies.authorization||authorization,grants=dependencies.permissions||permissions;
  const flags=dependencies.features||features,projects=dependencies.projectAccess||projectAccess;
  const projection=createProjection({db:store});
  const execution=(options={})=>{
    const timeout=number(options.timeoutMs,6000,1,LIMITS.max_timeout_ms),deadline=Date.now()+timeout;
    return {signal:options.signal,remaining:()=>Math.max(0,deadline-Date.now()),run(task){return boundedRetrievalStage(task,{signal:options.signal,timeoutMs:this.remaining(),code:'KNOWLEDGE_GRAPH_TIMEOUT'});}};
  };
  const scope=async({projectId,user,sourceKinds},work)=>{
    if(!text(projectId)||!user?.id)throw fail('An authenticated project scope is required.','KNOWLEDGE_GRAPH_FORBIDDEN',403);
    await work.run(()=>projects.getProject(projectId,user.id));
    const active=await work.run(()=>store.prepare('SELECT id FROM users WHERE id=? AND status=\'active\'').get(user.id));
    if(!active)throw fail('Knowledge graph access is unavailable.','KNOWLEDGE_GRAPH_FORBIDDEN',403);
    const check=async(permission)=>await grants.hasPermission(user,permission,projectId)&&await flags.areEnabled(flags.getFeatureKeysForPermission(permission),{user});
    if(!await work.run(()=>check('knowledge.view')))throw fail('Permission required: knowledge.view','KNOWLEDGE_GRAPH_FORBIDDEN',403);
    const native=Object.entries(PERMISSIONS),allowed=await work.run(()=>Promise.all(native.map(async([kind,permission])=>[kind,await check(permission)])));
    if(sourceKinds!==undefined&&(!Array.isArray(sourceKinds)||sourceKinds.length>KINDS.length||sourceKinds.some(kind=>!KINDS.includes(kind))))throw fail('Choose supported Knowledge source kinds.');
    return {projectId,user,kinds:KINDS.filter(kind=>(sourceKinds===undefined||sourceKinds.includes(kind))&&(!PERMISSIONS[kind]||allowed.find(([item])=>item===kind)?.[1])),permissions:['knowledge.view',...allowed.filter(([,ok])=>ok).map(([kind])=>PERMISSIONS[kind])]};
  };
  // This predicate is applied in the adjacency query BEFORE its per-node LIMIT.
  // Nodes with all fragments denied cannot leak their title or consume fanout.
  const visible=(source,access,appTypeId)=>{
    const documents=`${source}_documents`,chunks=`${source}_chunks`,indexes=`${source}_indexes`;
    const policy=acl.predicate({user:access.user,projectId:access.projectId,source,document:documents,chunk:chunks});
    return {sql:`${source}.project_id=? AND ${source}.extraction_status='ready' AND ${source}.source_kind IN (${access.kinds.map(()=>'?').join(',')||'NULL'})
      AND ${(acl.applicationRecordPredicate||authorization.applicationRecordPredicate)({source})}
      AND(${source}.required_permission IS NULL OR ${source}.required_permission IN(${access.permissions.map(()=>'?').join(',')}))
      ${appTypeId?`AND(${source}.app_type_id=? OR ${source}.app_type_id IS NULL)`:''}
      AND EXISTS(SELECT 1 FROM ai_knowledge_documents ${documents} JOIN ai_knowledge_chunks ${chunks} ON ${chunks}.document_id=${documents}.id AND ${chunks}.source_id=${source}.id
        JOIN ai_knowledge_index_states ${indexes} ON ${indexes}.document_id=${documents}.id WHERE ${documents}.source_id=${source}.id AND ${documents}.project_id=${source}.project_id
        AND ${chunks}.project_id=${source}.project_id AND ${documents}.is_active=TRUE
        AND ${documents}.effective_from<=CURRENT_TIMESTAMP AND(${documents}.effective_to IS NULL OR ${documents}.effective_to>CURRENT_TIMESTAMP)
        AND ${indexes}.required_indexes_ready=TRUE AND ${indexes}.is_current=TRUE
        AND ${indexes}.project_id=${source}.project_id AND ${indexes}.source_id=${source}.id AND ${indexes}.document_version=${documents}.version
        AND ${acl.applicationContextPredicate({source,document:documents})} AND ${policy.sql})`,params:[access.projectId,...access.kinds,...access.permissions,...(appTypeId?[appTypeId]:[]),...policy.params]};
  };
  // Display IDs (STORY-12, TC-0045) are what people type. They live in source
  // metadata, so they resolve without waiting for a node to be re-projected, and
  // the expression matches idx_ai_knowledge_sources_display_id.
  const DISPLAY_ID="UPPER(COALESCE(sources.metadata->>'display_id',''))";
  const readNodes=async({identifiers=[],query='',limit=30,appTypeId},access,work)=>{
    const selectors=[],args=[];
    for(const identifier of identifiers){
      const value=typeof identifier==='string'?identifier:identifier?.ref_id;
      if(typeof value!=='string'||value.trim().length>255)throw fail('Use an exact identifier of at most 255 characters.');
      if(typeof identifier==='string'&&text(identifier)){selectors.push('nodes.id=?');args.push(text(identifier));}
      else if(identifier&&KINDS.includes(identifier.kind)&&text(identifier.ref_id)){selectors.push(`(nodes.entity_type=? AND(nodes.entity_key=? OR nodes.id=? OR ${DISPLAY_ID}=UPPER(?)))`);args.push(identifier.kind,text(identifier.ref_id),text(identifier.ref_id),text(identifier.ref_id));}
      else throw fail('Use canonical source IDs or typed native record identifiers.');
    }
    if(text(query)){selectors.push(`(nodes.id=? OR nodes.entity_key=? OR LOWER(sources.title)=LOWER(?) OR ${DISPLAY_ID}=UPPER(?) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(nodes.aliases) alias(value) WHERE LOWER(alias.value)=LOWER(?)))`);args.push(text(query),text(query),text(query),text(query),text(query));}
    if(!selectors.length)return [];
    const gate=visible('sources',access,appTypeId);
    return work.run(()=>store.prepare(`SELECT nodes.id,nodes.entity_type,nodes.entity_key,sources.title AS title,nodes.aliases,nodes.created_at,nodes.updated_at FROM ai_knowledge_graph_nodes nodes
      JOIN ai_knowledge_sources sources ON sources.id=nodes.source_id AND sources.project_id=nodes.project_id
      WHERE nodes.project_id=? AND nodes.tombstoned_at IS NULL AND(${selectors.join(' OR ')}) AND ${gate.sql} ORDER BY nodes.entity_type,nodes.entity_key,nodes.id LIMIT ?`).all(access.projectId,...args,...gate.params,limit));
  };
  const resolve=async(options={})=>{
    options={...options,app_type_id:options.app_type_id||options.appTypeId};
    if(options.identifiers!==undefined&&(!Array.isArray(options.identifiers)||options.identifiers.length>30))throw fail('Choose up to 30 exact identifiers.');
    if(options.query!==undefined&&(typeof options.query!=='string'||options.query.trim().length>255))throw fail('Use an exact query of at most 255 characters.');
    const work=execution(options),access=await scope(options,work),identifiers=list(options.identifiers||options.seeds,30);
    const limit=number(options.limit,20,1,30),rows=await readNodes({identifiers,query:options.query,limit:limit+1,appTypeId:options.app_type_id},access,work);
    const nodes=rows.slice(0,limit).map(publicNode);
    return {nodes,ambiguous:Boolean((text(options.query)||identifiers.length===1)&&rows.length>1),unresolved:identifiers.filter(identifier=>!nodes.some(node=>typeof identifier==='string'?node.id===identifier:node.kind===identifier.kind&&[node.id,node.key].includes(identifier.ref_id))),partial:rows.length>limit};
  };
  // One query expands a whole hop. The frontier is passed as an ID array, every
  // visibility and proof gate is applied BEFORE the per-node fanout window, so a
  // node whose fragments are all denied can neither leak its title nor consume
  // another node's fanout. ROW_NUMBER() per anchor replaces the old per-node LIMIT.
  const adjacent=async(frontier,options,access,work)=>{
    const origin=visible('origins',access,options.app_type_id),target=visible('targets',access,options.app_type_id);
    const proof=acl.predicate({user:access.user,projectId:access.projectId,source:'proof_sources',document:'proof_documents',chunk:'proof_chunks'});
    const permission=access.permissions.length?`(proof_sources.required_permission IS NULL OR proof_sources.required_permission IN(${access.permissions.map(()=>'?').join(',')}))`:'proof_sources.required_permission IS NULL';
    const halves=[],halfParams=[];
    if(options.direction!=='inbound'){halves.push('SELECT frontier.node_id AS anchor_id,edges.id AS edge_id FROM frontier JOIN ai_knowledge_graph_edges edges ON edges.project_id=? AND edges.source_node_id=frontier.node_id');halfParams.push(access.projectId);}
    if(options.direction!=='outbound'){halves.push('SELECT frontier.node_id AS anchor_id,edges.id AS edge_id FROM frontier JOIN ai_knowledge_graph_edges edges ON edges.project_id=? AND edges.target_node_id=frontier.node_id');halfParams.push(access.projectId);}
    const preferred=list(options.preferRelations,RELATIONS.length).filter(type=>RELATIONS.includes(type));
    const ranking=`${preferred.length?`CASE WHEN edges.relation_type IN(${preferred.map(()=>'?').join(',')}) THEN 0 ELSE 1 END,`:''}${options.query?"ts_rank_cd(witness.search_vector,plainto_tsquery('simple',?)) DESC,":''}edges.relation_type,edges.id`;
    return work.run(()=>store.prepare(`WITH frontier AS(SELECT value AS node_id FROM jsonb_array_elements_text(?::jsonb) AS value),
      anchored AS(${halves.join(' UNION ALL ')})
      SELECT ranked.id,ranked.source_node_id,ranked.target_node_id,ranked.relation_type,ranked.provenance_type,ranked.valid_from,ranked.valid_to,ranked.observed_at,
        ranked.source_kind,ranked.source_key,ranked.source_title,ranked.source_aliases,ranked.target_kind,ranked.target_key,ranked.target_title,ranked.target_aliases,
        ranked.chunk_id,ranked.document_id,ranked.evidence_source_id,ranked.document_version,ranked.version_hash,ranked.span_start,ranked.span_end,ranked.content,ranked.heading,
        ranked.char_start,ranked.char_end,ranked.evidence_source_kind,ranked.evidence_source_ref_id,ranked.evidence_title,ranked.source_hash,ranked.effective_from,ranked.effective_to,ranked.anchor_id
      FROM(SELECT edges.id,edges.source_node_id,edges.target_node_id,edges.relation_type,edges.provenance_type,edges.valid_from,edges.valid_to,edges.created_at AS observed_at,
        source_nodes.entity_type AS source_kind,source_nodes.entity_key AS source_key,origins.title AS source_title,source_nodes.aliases AS source_aliases,
        target_nodes.entity_type AS target_kind,target_nodes.entity_key AS target_key,targets.title AS target_title,target_nodes.aliases AS target_aliases,witness.*,anchored.anchor_id,
        ROW_NUMBER() OVER(PARTITION BY anchored.anchor_id ORDER BY ${ranking}) AS fanout_rank
      FROM anchored JOIN ai_knowledge_graph_edges edges ON edges.id=anchored.edge_id
      JOIN ai_knowledge_graph_nodes source_nodes ON source_nodes.id=edges.source_node_id AND source_nodes.project_id=edges.project_id
      JOIN ai_knowledge_graph_nodes target_nodes ON target_nodes.id=edges.target_node_id AND target_nodes.project_id=edges.project_id
      JOIN ai_knowledge_sources origins ON origins.id=source_nodes.source_id JOIN ai_knowledge_sources targets ON targets.id=target_nodes.source_id
      JOIN LATERAL(SELECT evidence.chunk_id,evidence.document_id,evidence.source_id AS evidence_source_id,evidence.document_version,evidence.version_hash,evidence.span_start,evidence.span_end,
        proof_chunks.content,proof_chunks.heading,proof_chunks.char_start,proof_chunks.char_end,proof_chunks.search_vector,proof_sources.source_kind AS evidence_source_kind,proof_sources.source_ref_id AS evidence_source_ref_id,
        proof_sources.title AS evidence_title,proof_sources.checksum_sha256 AS source_hash,proof_documents.effective_from,proof_documents.effective_to
        FROM ai_knowledge_graph_edge_evidence evidence JOIN ai_knowledge_chunks proof_chunks ON proof_chunks.id=evidence.chunk_id AND proof_chunks.project_id=evidence.project_id AND proof_chunks.document_id=evidence.document_id AND proof_chunks.source_id=evidence.source_id
        JOIN ai_knowledge_documents proof_documents ON proof_documents.id=evidence.document_id AND proof_documents.source_id=evidence.source_id AND proof_documents.version=evidence.document_version AND proof_documents.checksum_sha256=evidence.version_hash
        JOIN ai_knowledge_sources proof_sources ON proof_sources.id=evidence.source_id AND proof_sources.project_id=evidence.project_id
        JOIN ai_knowledge_index_states proof_indexes ON proof_indexes.document_id=proof_documents.id
        WHERE evidence.edge_id=edges.id AND evidence.project_id=edges.project_id AND proof_documents.is_active=TRUE
        AND proof_documents.effective_from<=CURRENT_TIMESTAMP AND(proof_documents.effective_to IS NULL OR proof_documents.effective_to>CURRENT_TIMESTAMP)
        AND proof_indexes.required_indexes_ready=TRUE AND proof_indexes.is_current=TRUE AND proof_sources.extraction_status='ready'
        AND proof_indexes.project_id=edges.project_id AND proof_indexes.source_id=proof_sources.id AND proof_indexes.document_version=proof_documents.version
        AND evidence.provenance_type IN('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED') AND ${permission}
        AND proof_sources.source_kind IN(${access.kinds.map(()=>'?').join(',')||'NULL'})
        ${options.app_type_id?'AND(proof_sources.app_type_id=? OR proof_sources.app_type_id IS NULL)':''}
        AND ${(acl.applicationRecordPredicate||authorization.applicationRecordPredicate)({source:'proof_sources'})}
        AND ${acl.applicationContextPredicate({source:'proof_sources',document:'proof_documents'})} AND ${proof.sql}
        ORDER BY proof_documents.created_at DESC,evidence.document_id,evidence.chunk_id LIMIT 1) witness ON TRUE
      WHERE edges.project_id=? AND edges.status='ACTIVE' AND edges.valid_to IS NULL AND edges.valid_from<=CURRENT_TIMESTAMP
        ${options.includedEdgeIds?.length?`AND edges.id IN(${options.includedEdgeIds.map(()=>'?').join(',')})`:''}
        ${options.excludedEdgeIds?.length?`AND edges.id NOT IN(${options.excludedEdgeIds.map(()=>'?').join(',')})`:''}
        AND edges.provenance_type IN('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED') AND source_nodes.tombstoned_at IS NULL AND target_nodes.tombstoned_at IS NULL
        ${options.relationTypes.length?`AND edges.relation_type IN(${options.relationTypes.map(()=>'?').join(',')})`:''} AND ${origin.sql} AND ${target.sql}
      ) ranked WHERE ranked.fanout_rank<=? ORDER BY ranked.anchor_id,ranked.fanout_rank`).all(
        frontier,...halfParams,...preferred,...(options.query?[text(options.query,2000)]:[]),
        ...access.permissions,...access.kinds,...(options.app_type_id?[options.app_type_id]:[]),...proof.params,
        access.projectId,...(options.includedEdgeIds||[]),...(options.excludedEdgeIds||[]),...options.relationTypes,...origin.params,...target.params,options.fanout));
  };
  const evidenceHit=(row,projectId)=>{
    if(typeof row.content!=='string'||row.content.length>128000||!Number.isSafeInteger(row.span_start)||!Number.isSafeInteger(row.span_end)||row.span_start<0||row.span_end>Array.from(row.content).length||row.span_end<=row.span_start||row.span_end-row.span_start>4000)return null;
    const excerpt=row.content,id=`K-${row.chunk_id}`;
    return {project_id:projectId,source_id:row.evidence_source_id,canonical_id:row.evidence_source_id,source_kind:row.evidence_source_kind,source_ref_id:row.evidence_source_ref_id,
      document_id:row.document_id,chunk_id:row.chunk_id,fragment_id:row.chunk_id,title:sanitizeAiText(text(row.evidence_title,500)).text,content:excerpt,score:0,is_current:true,source_version:String(row.document_version),effective_from:row.effective_from,effective_to:row.effective_to,
      citation:{id,source_id:row.evidence_source_id,source_kind:row.evidence_source_kind,source_ref_id:row.evidence_source_ref_id,document_id:row.document_id,chunk_id:row.chunk_id,fragment_id:row.chunk_id,source_version:String(row.document_version),version_hash:row.version_hash,source_hash:row.source_hash,chunk_hash:fingerprint(row.content),effective_from:row.effective_from,effective_to:row.effective_to,location:{heading:row.heading||null,char_start:Number(row.char_start||0),char_end:Number(row.char_end||0)}}};
  };
  const flip=direction=>direction==='outbound'?'inbound':direction==='inbound'?'outbound':'both';
  // Validate and normalise once; expand and trace share it.
  const prepare=async(options)=>{
    options={...options,app_type_id:options.app_type_id||options.appTypeId};
    if(options.relationTypes!==undefined&&(!Array.isArray(options.relationTypes)||options.relationTypes.length>RELATIONS.length))throw fail(`Choose up to ${RELATIONS.length} supported relationship types.`);
    const work=execution(options),access=await scope(options,work);
    const input={...options,direction:options.direction||'both',hops:number(options.hops,2,0,3),fanout:number(options.fanout,5,1,12),maxNodes:number(options.maxNodes,60,1,120),maxEdges:number(options.maxEdges,80,0,160),maxEvidence:number(options.maxEvidence,20,0,30),
      // The budget is measured in UTF-8 bytes of the serialized graph (about a quarter of the model tokens). maxBytes is the honest name; maxTokens is kept as an alias.
      maxTokens:number(options.maxBytes??options.maxTokens,4000,256,8000),relationTypes:list(options.relationTypes,RELATIONS.length)};
    if(!['both','outbound','inbound'].includes(input.direction)||input.relationTypes.some(type=>!RELATIONS.includes(type)))throw fail('Choose supported directions and relationship types.');
    return {input,work,access,options};
  };
  // Walk outward from seeds, one query per hop. Returns raw maps; authorization
  // is rechecked, pruned and packed in finalize().
  const walk=async({input,access,work,seeds,direction=input.direction,hops=input.hops,limits=input,preferRelations,includedEdgeIds})=>{
    const roots=await readNodes({identifiers:seeds,limit:limits.maxNodes,appTypeId:input.app_type_id},access,work);
    const nodes=new Map(roots.map(row=>[row.id,publicNode(row)])),edges=new Map(),evidence=new Map(),queued=new Set(nodes.keys()),visited=new Set();
    let frontier=roots.map(row=>({id:row.id,depth:0,path:[row.id]})),fanoutReached=false,budgetReached=false,queryCount=0;
    for(let depth=0;depth<hops&&frontier.length;depth++){
      assertRetrievalActive(work.signal);
      if(edges.size>=limits.maxEdges||limits.maxEvidence===0){budgetReached=true;break;}
      const level=new Map();for(const item of frontier)if(!visited.has(item.id)){visited.add(item.id);level.set(item.id,item);}
      if(!level.size)break;
      const fanout=Math.min(input.fanout,limits.maxEdges-edges.size);
      const rows=await adjacent(JSON.stringify([...level.keys()]),{...input,direction,preferRelations,includedEdgeIds,excludedEdgeIds:[...edges.keys()],fanout},access,work);queryCount++;
      const perAnchor=new Map();for(const row of rows)perAnchor.set(row.anchor_id,(perAnchor.get(row.anchor_id)||0)+1);
      fanoutReached ||= [...perAnchor.values()].some(count=>count>=fanout);
      const next=[];
      for(const row of rows){
        if(edges.has(row.id))continue;
        const proof=evidenceHit(row,access.projectId);if(!proof)continue;
        const anchor=level.get(row.anchor_id)||level.get(row.source_node_id)||level.get(row.target_node_id);if(!anchor)continue;
        if(!evidence.has(proof.chunk_id)&&evidence.size>=limits.maxEvidence){budgetReached=true;continue;}
        const neighbor=row.source_node_id===anchor.id?row.target_node_id:row.source_node_id;
        if(!nodes.has(neighbor)&&nodes.size>=limits.maxNodes){budgetReached=true;continue;}
        if(!nodes.has(neighbor))nodes.set(neighbor,publicNode(row.source_node_id===neighbor?{id:neighbor,entity_type:row.source_kind,entity_key:row.source_key,title:row.source_title,aliases:row.source_aliases}:{id:neighbor,entity_type:row.target_kind,entity_key:row.target_key,title:row.target_title,aliases:row.target_aliases}));
        evidence.set(proof.chunk_id,proof);
        edges.set(row.id,{id:row.id,source:row.source_node_id,target:row.target_node_id,type:row.relation_type,provenance_type:row.provenance_type,
          valid_from:date(row.valid_from),valid_to:date(row.valid_to),observed_at:date(row.observed_at),confidence:null,
          depth:anchor.depth+1,path:[...anchor.path,neighbor],evidence_ids:[proof.citation.id],witness_span:{evidence_id:proof.citation.id,start:row.span_start,end:row.span_end,offset_unit:'unicode_codepoint',offset_basis:'source_chunk'}});
        if(!queued.has(neighbor)&&anchor.depth+1<hops){queued.add(neighbor);next.push({id:neighbor,depth:anchor.depth+1,path:[...anchor.path,neighbor]});}
        if(edges.size>=limits.maxEdges){budgetReached=true;break;}
      }
      frontier=next;
    }
    return {roots,nodes,edges,evidence,fanoutReached,budgetReached,queryCount};
  };
  const mergeWalks=walks=>walks.reduce((merged,item)=>{
    for(const [key,value] of item.nodes)if(!merged.nodes.has(key))merged.nodes.set(key,value);
    for(const [key,value] of item.edges)if(!merged.edges.has(key))merged.edges.set(key,value);
    for(const [key,value] of item.evidence)if(!merged.evidence.has(key))merged.evidence.set(key,value);
    merged.roots.push(...item.roots.filter(row=>!merged.roots.some(root=>root.id===row.id)));
    merged.fanoutReached||=item.fanoutReached;merged.budgetReached||=item.budgetReached;merged.queryCount+=item.queryCount;
    return merged;
  },{roots:[],nodes:new Map(),edges:new Map(),evidence:new Map(),fanoutReached:false,budgetReached:false,queryCount:0});
  // Recheck after the walk so revocation, archive and active-version changes
  // during expansion cannot turn a cached path into authorized evidence.
  const finalize=async({input,work,options,walked,hops=input.hops,direction=input.direction,extra={}})=>{
    const {roots,nodes,edges,evidence,fanoutReached,budgetReached,queryCount}=walked;
    const finalAccess=await scope(options,work),freshRows=nodes.size?await readNodes({identifiers:[...nodes.keys()],limit:input.maxNodes,appTypeId:input.app_type_id},finalAccess,work):[];
    const freshNodes=new Map(freshRows.map(row=>[row.id,publicNode(row)]));
    const allowed=await work.run(()=>acl.getEvidenceAccess({projectId:finalAccess.projectId,user:finalAccess.user,evidence:[...evidence.values()],signal:work.signal,timeoutMs:work.remaining(),requireCurrentNativeRecords:true,allowedSourceKinds:finalAccess.kinds,appTypeId:input.app_type_id}));
    const allowedIds=new Set(allowed.allowed.map(hit=>hit.citation.id)),pruned=[...edges.values()].filter(edge=>freshNodes.has(edge.source)&&freshNodes.has(edge.target)&&edge.evidence_ids.every(id=>allowedIds.has(id)));
    const reachable=reachableGraph({nodes:[...freshNodes.values()],edges:pruned,seeds:roots.map(row=>row.id),hops,direction});
    const safeEdges=reachable.edges,retained=new Set(reachable.nodes.map(node=>node.id)),proofIds=new Set(safeEdges.flatMap(edge=>edge.evidence_ids));
    const partialAuthorization=Boolean(allowed.partial||freshNodes.size<nodes.size);
    const compactProofs=allowed.allowed.filter(hit=>proofIds.has(hit.citation.id)).map(hit=>compactGraphEvidence(hit,safeEdges.filter(edge=>edge.evidence_ids.includes(hit.citation.id)).map(edge=>edge.witness_span))).filter(Boolean);
    return packGraph({contract_type:'KnowledgeGraph',schema_version:'knowledge-graph/1',project_id:finalAccess.projectId,seeds:reachable.seeds,nodes:reachable.nodes,edges:safeEdges,evidence:compactProofs,
      limitations:{partial:budgetReached||fanoutReached||partialAuthorization,budget_reached:budgetReached,fanout_reached:fanoutReached,authorization_partial:partialAuthorization,not_exhaustive:true,gaps:roots.length?[]:['No authorized, current source matched the supplied identifiers.']},
      stats:{hops:input.hops,frontier_queries:queryCount,node_count:retained.size,edge_count:safeEdges.length,evidence_count:proofIds.size,bounded:true,ranking_strategy:input.query?'lexical_evidence':'stable_relation_id',...extra}},input.maxTokens);
  };
  const expand=async(options={})=>{
    const {input,work,access,options:normalized}=await prepare(options);
    if(!Array.isArray(options.seeds)||options.seeds.length>6)throw fail('Choose one to six exact graph seeds.');
    if(!options.seeds.length)throw fail('Choose at least one exact graph seed.');
    const walked=await walk({input,access,work,seeds:options.seeds,preferRelations:list(options.preferRelations,RELATIONS.length).filter(type=>RELATIONS.includes(type))});
    return finalize({input,work,options:normalized,walked});
  };
  // Context traces may retain only edge identities. Re-read those exact edges
  // through the ordinary endpoint, witness, ACL and current-version gates.
  const readWitnessedEdges=async({projectId,user,relationships=[],appTypeId,signal,timeoutMs}={})=>{
    const refs=(Array.isArray(relationships)?relationships:[]).slice(0,12).filter(item=>item&&typeof item==='object'
      &&typeof item.knowledge_edge_id==='string'&&typeof item.source_canonical_id==='string'&&typeof item.target_canonical_id==='string');
    if(!refs.length)return{edges:[],nodes:[],evidence:[],limitations:{partial:false,not_exhaustive:true}};
    const includedEdgeIds=[...new Set(refs.map(item=>item.knowledge_edge_id))].slice(0,12);
    const seeds=[...new Set(refs.flatMap(item=>[item.source_canonical_id,item.target_canonical_id]))].slice(0,24);
    const {input,work,access,options:normalized}=await prepare({projectId,user,app_type_id:appTypeId,signal,timeoutMs,hops:1,fanout:12,maxNodes:60,maxEdges:12,maxEvidence:12,maxBytes:8000});
    const walked=await walk({input,access,work,seeds,hops:1,limits:input,includedEdgeIds});
    return finalize({input,work,options:normalized,walked,hops:1,direction:'both',extra:{requested_edge_count:includedEdgeIds.length}});
  };
  // Trace walks from BOTH ends and meets in the middle. Each side reaches half
  // the depth, so the per-node fanout cap prunes far less of the search space
  // than a single deep walk from the source, and edges of the relation types the
  // two endpoint kinds imply are preferred when a node's fanout is capped.
  const trace=async(options={})=>{
    const source=options.source,target=options.target;if(!source||!target)throw fail('Choose exact source and target identifiers.');
    const {input,work,access,options:normalized}=await prepare({...options,seeds:[source]});
    const maxPaths=number(options.maxPaths,3,1,5);
    const resolved=await resolve({...options,timeoutMs:Math.max(1,work.remaining()),identifiers:[target],limit:2});
    const targetNode=resolved.ambiguous?null:resolved.nodes[0]||null,targetId=targetNode?.id||null;
    const forwardHops=targetId?Math.ceil(input.hops/2):input.hops,backwardHops=input.hops-forwardHops;
    const half=cap=>targetId?Math.ceil(cap/2):cap;
    const limits={maxNodes:half(input.maxNodes),maxEdges:half(input.maxEdges),maxEvidence:half(input.maxEvidence)};
    const forward=await walk({input,access,work,seeds:[source],hops:forwardHops,limits,
      direction:input.direction,preferRelations:input.relationTypes.length?undefined:impliedRelations(null,targetNode?.kind)});
    const sourceKind=forward.roots[0]?.entity_type,preferRelations=input.relationTypes.length?undefined:impliedRelations(sourceKind,targetNode?.kind);
    const walks=[forward];
    if(targetId&&backwardHops>0)walks.push(await walk({input,access,work,seeds:[targetId],hops:backwardHops,limits,direction:flip(input.direction),preferRelations}));
    else if(targetId)walks.push(await walk({input,access,work,seeds:[targetId],hops:0,limits,direction:'both'}));
    const walked=mergeWalks(walks);
    const graph=await finalize({input,work,options:normalized,walked,hops:Math.max(forwardHops,backwardHops),direction:'both',extra:{trace:'bidirectional',forward_hops:forwardHops,backward_hops:backwardHops}});
    const start=graph.seeds.find(id=>id===forward.roots[0]?.id),paths=[],queue=start?[{node:start,nodes:[start],edges:[]}]:[];
    let states=0;const ceiling=Math.max(1,graph.edges.length)*Math.max(1,input.hops)*maxPaths;
    while(queue.length&&paths.length<maxPaths&&states++<ceiling){
      const current=queue.shift();if(current.node===targetId){paths.push({...current,evidence_ids:[...new Set(current.edges.flatMap(id=>graph.edges.find(edge=>edge.id===id)?.evidence_ids||[]))]});continue;}
      if(current.edges.length>=input.hops)continue;
      for(const edge of graph.edges){const next=edge.source===current.node&&options.direction!=='inbound'?edge.target:edge.target===current.node&&options.direction!=='outbound'?edge.source:null;
        if(next&&!current.nodes.includes(next))queue.push({node:next,nodes:[...current.nodes,next],edges:[...current.edges,edge.id]});}
    }
    return packGraph({...graph,paths,limitations:{...graph.limitations,gaps:paths.length?graph.limitations.gaps:[...graph.limitations.gaps,resolved.ambiguous?'The target identifier is ambiguous. Choose an exact canonical source ID.':'No authorized witnessed path was found within the requested bounds.']}},input.maxTokens);
  };
  const reconcilePage=async(options={})=>{const work=execution({...options,timeoutMs:options.timeoutMs||20000});await scope(options,work);if(!await work.run(()=>grants.hasPermission(options.user,'knowledge.manage',options.projectId)))throw fail('Permission required: knowledge.manage','KNOWLEDGE_GRAPH_FORBIDDEN',403);return work.run(signal=>projection.reconcilePage({...options,signal}));};
  return {describe,resolve,resolveNodes:resolve,expand,trace,readWitnessedEdges,reconcilePage,syncDocument:projection.syncDocument,archiveSource:projection.archiveSource,processBackfill:projection.processBackfill,_internals:{visible,adjacent,evidenceHit}};
}
module.exports={...createGraph(),createGraph};
