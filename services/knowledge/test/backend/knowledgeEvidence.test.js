const test=require('node:test');
const assert=require('node:assert/strict');
const {createEvidenceReader}=require('../../backend/services/knowledgeEvidence.service');
const {fingerprint}=require('../../../platform/backend/src/security/aiTextPolicy');
const user={id:'reader'};
const row={id:'fragment',project_id:'project',document_id:'document',source_id:'source',content:'Reviewed source passage',version:2,version_hash:'a'.repeat(64),source_hash:'b'.repeat(64),is_current:true,source_kind:'text',required_permission:null};
function fixture({denied=false,missing=false,revokeAfterRead=false}={}){
 let calls=0,sql;
 const access={getEvidenceAccess:async input=>{calls++;assert.equal(input.requireCurrentNativeRecords,true);return{allowed:denied||revokeAfterRead&&calls>1?[]:input.evidence};},
  predicate:()=>({sql:'fixture_acl=TRUE',params:[]}),applicationContextPredicate:()=> 'fixture_context=TRUE',applicationRecordPredicate:()=> 'fixture_native=TRUE'};
 const fetch=createEvidenceReader({access,store:{prepare:value=>{sql=value;return{get:async(...params)=>{assert.deepEqual(params.slice(0,2),['fragment','project']);return missing?undefined:row;}};}}});
 return {fetch,query:()=>sql,calls:()=>calls};
}
test('exact evidence reads retain immutable citation identity and reapply ACL, revision, index and native gates during hydration',async()=>{
 const f=fixture(),result=await f.fetch({projectId:'project',user,fragmentId:'fragment',expectedDocumentId:'document',expectedVersionHash:row.version_hash});
 assert.equal(result.fragment.content,row.content);assert.equal(result.citation.source_version,'2');assert.equal(result.citation.version_hash,row.version_hash);assert.equal(result.citation.chunk_hash,fingerprint(row.content));assert.equal(result.citation.id,'K-fragment');
 assert.equal(Object.hasOwn(result.fragment,'required_permission'),false);assert.equal(f.calls(),2);
 for(const gate of ['fixture_acl=TRUE','fixture_context=TRUE','fixture_native=TRUE','indexes.is_current=TRUE','indexes.document_version=documents.version'])assert.ok(f.query().includes(gate));
});
test('denied, removed and concurrently revoked fragments never return content; expected revisions fail explicitly',async()=>{
 for(const options of [{denied:true},{missing:true},{revokeAfterRead:true}])await assert.rejects(fixture(options).fetch({projectId:'project',user,fragmentId:'fragment'}),{code:'KNOWLEDGE_EVIDENCE_UNAVAILABLE'});
 for(const expected of [{expectedDocumentId:'old-document'},{expectedVersionHash:'c'.repeat(64)}])await assert.rejects(fixture().fetch({projectId:'project',user,fragmentId:'fragment',...expected}),{statusCode:409,code:'KNOWLEDGE_EVIDENCE_CHANGED'});
});
test('historical exact reads use the same explicit timestamp in authorization and content selection',async()=>{
 const f=fixture(),asOf='2026-10-01T00:00:00.000Z';await f.fetch({projectId:'project',user,fragmentId:'fragment',asOf});
 assert.ok(f.query().includes('documents.effective_from<=?::timestamptz'));assert.ok(!f.query().includes('indexes.is_current=TRUE'));
 const controller=new AbortController();controller.abort();await assert.rejects(f.fetch({projectId:'project',user,fragmentId:'fragment',signal:controller.signal}));
});
