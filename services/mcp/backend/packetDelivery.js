const {createHash}=require('node:crypto');
const hash=text=>createHash('sha256').update(text).digest('hex');

// MCP redaction/result limits run after native retrieval assembled its packet.
// Reconcile the delivered representation without rewriting immutable source
// revisions, pretending omitted text was read, or retaining unsupported edges.
function normalizePacket(packet){
 if(packet?.contract_type!=='ContextPacket'||!Array.isArray(packet.evidence))return packet;
 const changed=[];
 const evidence=packet.evidence.map(item=>{
  const original=item.integrity?.evidence_hash;
  if(typeof item.content!=='string'||!/^[a-f0-9]{64}$/i.test(original||'')||hash(item.content)===original)return item;
  const {content_scope,...safe}=item;
  const rendered=hash(item.content);
  changed.push({evidence_id:item.evidence_id,source_evidence_hash:original,rendered_evidence_hash:rendered,source_offsets_removed:Boolean(content_scope)});
  return {...safe,representation_type:'MCP_DELIVERY_EXCERPT',visibility:{...item.visibility,state:'PARTIAL'},integrity:{...item.integrity,evidence_hash:rendered}};
 });
 if(!changed.length)return packet;
 const changedIds=new Set(changed.map(item=>item.evidence_id));
 const retain=edges=>(edges||[]).filter(edge=>!(edge.evidence_ids||[]).some(id=>changedIds.has(id)));
 const relationships=retain(packet.relationships),relationshipEvidence=retain(packet.relationship_evidence);
 const removed=Math.max((packet.relationships?.length||0)-relationships.length,(packet.relationship_evidence?.length||0)-relationshipEvidence.length);
 const note='MCP delivery redacted or shortened these source excerpts. Immutable source/chunk/version hashes remain unchanged. Removed offsets and relationship witnesses cannot be inferred from the delivered text; original retrieval coverage is not proof of complete source review.';
 const result={...packet,evidence,relationships,relationship_evidence:relationshipEvidence,
  authorization_coverage:{...packet.authorization_coverage,fully_visible_objects:evidence.filter(item=>item.visibility?.state==='FULL').length,
   partially_visible_objects:Math.max(packet.authorization_coverage?.partially_visible_objects||0,evidence.filter(item=>item.visibility?.state==='PARTIAL').length)},
  limitations:{...packet.limitations,authorization_partial:true,retrieval_status:packet.limitations?.retrieval_status==='FAILED'?'FAILED':'PARTIAL'},
  retrieval:{...packet.retrieval,status:packet.retrieval?.status==='FAILED'?'FAILED':'PARTIAL',delivery:{...packet.retrieval?.delivery,evidence:changed,omitted_relationship_count:removed,note}}};
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>180000)throw Object.assign(new Error('The delivered context exceeds its safe result budget. Narrow the selected sources or evidence budget.'),{statusCode:413,code:'MCP_RESULT_TOO_LARGE'});
 return result;
}

function normalizeRetrievalResult(result){
 const packet=normalizePacket(result?.packet);
 if(!result||packet===result.packet)return result;
 const accepted=new Map(packet.evidence.map(item=>[item.evidence_id,item]));
 return {...result,packet,hits:(result.hits||[]).filter(hit=>accepted.has(hit.citation?.id||hit.evidence_id)).map(hit=>{
  const item=accepted.get(hit.citation?.id||hit.evidence_id);
  return {...hit,content:item.content,...(item.content_scope?{content_scope:item.content_scope}:{content_scope:undefined}),
   citation:{...hit.citation,evidence_hash:item.integrity?.evidence_hash,representation_type:item.representation_type}};
 }),retrieval:{...result.retrieval,...packet.retrieval,context_packet:packet}};
}
module.exports={normalizePacket,normalizeRetrievalResult};
