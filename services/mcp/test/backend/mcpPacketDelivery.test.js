const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const contracts=require('@hellotest/knowledge/backend/services/knowledgeContracts.service');
const {normalizePacket,normalizeRetrievalResult}=require('../../backend/packetDelivery');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const request=contracts.buildRetrievalRequest({projectId:'project',query:'Explain checkout',budgets:{max_context_tokens:4000}});
 const hits=['first','second'].map(name=>({source_id:'text:'+name,source_kind:'text',chunk_id:name,title:name,content:'Authorized '+name+' sensitive source passage.',is_current:true,
  citation:{id:'K-'+name,source_hash:'a'.repeat(64),version_hash:'b'.repeat(64),chunk_hash:hash('Authorized '+name+' sensitive source passage.')}}));
 const packet=contracts.buildContextPacket({retrievalRequest:request,evidence:hits,
  relationships:[{source:'source-a',target:'source-b',type:'RELATED_TO',provenance_type:'SOURCE_EXPLICIT',endpoints_authorized:true,evidence_ids:['K-first']},
   {source:'source-b',target:'source-c',type:'RELATED_TO',provenance_type:'SOURCE_EXPLICIT',endpoints_authorized:true,evidence_ids:['K-second']}],
  authorization:{project_scope_enforced:true,source_acl_enforced:true}});
 const first=packet.evidence[0],length=Array.from(first.content).length;
 first.content_scope={kind:'source_chunk_excerpt',offset_unit:'unicode_codepoint',source_length:length,segments:[{source_start:0,source_end:length,content_start:0,content_end:length}],omitted_codepoints:0};
 return {packet,hits};
}

test('MCP display changes preserve immutable source provenance and remove only unsupported relationship proofs',()=>{
 const {packet}=fixture(),sourceEvidenceHash=packet.evidence[0].integrity.evidence_hash;
 packet.evidence[0].content=packet.evidence[0].content.replace('sensitive','[REDACTED]');
 const delivered=normalizePacket(packet),first=delivered.evidence[0];
 assert.equal(first.integrity.source_hash,'a'.repeat(64));assert.equal(first.integrity.version_hash,'b'.repeat(64));
 assert.equal(first.integrity.chunk_hash,packet.evidence[0].integrity.chunk_hash);assert.equal(first.integrity.evidence_hash,hash(first.content));
 assert.equal(first.content_scope,undefined);assert.equal(first.visibility.state,'PARTIAL');assert.equal(first.representation_type,'MCP_DELIVERY_EXCERPT');
 assert.equal(delivered.retrieval.delivery.evidence[0].source_evidence_hash,sourceEvidenceHash);
 assert.equal(delivered.retrieval.delivery.evidence[0].rendered_evidence_hash,first.integrity.evidence_hash);
 assert.deepEqual(delivered.relationships.map(edge=>edge.evidence_ids),[['K-second']]);assert.equal(delivered.retrieval.delivery.omitted_relationship_count,1);
 assert.equal(delivered.limitations.authorization_partial,true);assert.equal(delivered.limitations.retrieval_status,'PARTIAL');
 assert.doesNotThrow(()=>contracts.validateContract(delivered,'ContextPacket'));
 assert.equal(normalizePacket(delivered),delivered,'Normalizing a delivered representation must be idempotent.');
});

test('local chatbot packet, hits and retained packet metadata use one normalized delivered representation',()=>{
 const {packet,hits}=fixture();
 packet.evidence[0].content='Shortened source excerpt';
 const original={packet,hits,retrieval:{context_packet:packet,returned_count:2},budget:{tool_calls_used:1}};
 const result=normalizeRetrievalResult(original);
 assert.equal(result.hits[0].content,'Shortened source excerpt');assert.equal(result.hits[0].content_scope,undefined);
 assert.equal(result.hits[0].citation.evidence_hash,result.packet.evidence[0].integrity.evidence_hash);
 assert.equal(result.retrieval.context_packet,result.packet);assert.equal(result.budget,original.budget);
 assert.equal(result.hits[1].content,hits[1].content);assert.equal(result.packet.evidence.length,2);
});
