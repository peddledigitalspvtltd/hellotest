const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');const {execFileSync}=require('node:child_process');
const portable=require('@hellotest/contracts/evidence'),knowledge=require('../../backend/services/knowledgeContracts.service');
const packet=()=>knowledge.buildContextPacket({retrievalRequest:knowledge.buildRetrievalRequest({projectId:'p',query:'What changed?'}),evidence:[{evidence_id:'e1',source_id:'source',content:'A retry preserves one order.',is_current:true}],authorization:{enforced:true}});
test('Knowledge compatibility and builders use the exact portable runtime schema/validator owner',()=>{
 const compatibility=require('../../backend/services/knowledgeContractSchemas.service');assert.equal(compatibility,portable);assert.equal(knowledge.JSON_SCHEMAS,portable.JSON_SCHEMAS);assert.equal(knowledge.validateContract,portable.validateContract);const value=packet();assert.equal(portable.validateContract(value,'ContextPacket'),value);
});
test('version1 portable move preserves the pre-move contract fingerprint and generated declarations',()=>{
 const digest=createHash('sha256').update(JSON.stringify({VERSION:portable.VERSION,PRESENTATIONS:portable.PRESENTATIONS,STAGES:portable.STAGES,JSON_SCHEMAS:portable.JSON_SCHEMAS,MODEL_ANSWER_SCHEMA:portable.MODEL_ANSWER_SCHEMA})).digest('hex');assert.equal(digest,fs.readFileSync(path.resolve(__dirname,'../fixtures/evidence-contract-v1.sha256'),'utf8').trim());execFileSync(process.execPath,[path.resolve(__dirname,'../../../../scripts/build/generate-evidence-contract-types.mjs'),'--check'],{stdio:'pipe'});
});
test('portable schema has no service dependencies and scope selection has one canonical key list',()=>{
 const source=fs.readFileSync(require.resolve('@hellotest/contracts/evidence'),'utf8');assert.deepEqual([...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match=>match[1]),['../agents/evidenceScopeFields.json']);
 const fields=require('@hellotest/contracts/agents/evidenceScopeFields.json');assert.deepEqual(Object.keys(portable.JSON_SCHEMAS.RetrievalRequest.properties.filters.properties.evidence_scope.properties).sort(),fields.map(field=>field.key).sort());
 const normalized=require('../../../platform/backend/src/utils/agentEvidenceScopeSql').normalize({story_id:'story',test_case_id:'case',unknown_id:'must-not-widen'});assert.deepEqual(normalized,{story_id:'story',test_case_id:'case'});
});
test('portable validator retains evidence identity, exact packet witnesses and claim support invariants',()=>{
 const duplicated=packet();duplicated.evidence.push({...duplicated.evidence[0]});duplicated.coverage.evidence_count=2;assert.throws(()=>portable.validateContract(duplicated,'ContextPacket'),{code:'ERR_CONTRACT_VALIDATION'});
 const foreign=packet();foreign.relationships=[{source:'one',target:'two',type:'TESTS',evidence_ids:['foreign-proof']}];assert.throws(()=>portable.validateContract(foreign,'ContextPacket'),{code:'ERR_CONTRACT_VALIDATION'});
 const answer={contract_type:'AnswerContract',contract_version:'1.0',answer_id:'answer',status:'answered',summary:'One order remains.',claims:[{claim_id:'claim',statement:'One order remains.',classification:'SUPPORTED',support_method:'EXTRACTIVE',evidence_ids:['foreign-proof']}],citation_ids:['e1'],grounding:{},limitations:packet().limitations,presentation:{recommended_type:'TEXT',structured_payload:{}}};assert.throws(()=>portable.validateContract(answer,'AnswerContract'),{code:'ERR_CONTRACT_VALIDATION'});
 const bound={...answer,claims:[{...answer.claims[0],support_method:'CITATION_BOUND',evidence_ids:['e1']}]};assert.throws(()=>portable.validateContract(bound,'AnswerContract'),{code:'ERR_CONTRACT_VALIDATION'});
});

test('both relationship aliases validate every witness, including a populated alias next to an empty one',()=>{
 const valid={source:'one',target:'two',type:'TESTS',evidence_ids:['e1']};
 for(const [first,second] of [[[],[{...valid,evidence_ids:['foreign']}]],[[{...valid,evidence_ids:['foreign']}],[]],[[valid],[{...valid,evidence_ids:['foreign']}]],[[{...valid,evidence_ids:['foreign']}],[valid]]]){
  const value=packet();value.relationship_evidence=first;value.relationships=second;assert.throws(()=>portable.validateContract(value,'ContextPacket'),{code:'ERR_CONTRACT_VALIDATION'});
 }
 const both=packet();both.relationship_evidence=[valid];both.relationships=[{...valid,type:'RELATED_TO'}];assert.equal(portable.validateContract(both,'ContextPacket'),both);
 const alternate=packet();alternate.relationship_evidence=[];alternate.relationships=[valid];assert.equal(portable.validateContract(alternate,'ContextPacket'),alternate);
});

test('generated portable types compile current envelopes and reject unsupported shapes without claiming normalization',()=>{
 const ts=require('typescript'),file=path.resolve(__dirname,'../fixtures/portableEvidenceTypes.ts');
 const program=ts.createProgram([file],{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,skipLibCheck:false});
 const errors=[...program.getSyntacticDiagnostics(program.getSourceFile(file)),...program.getSemanticDiagnostics(program.getSourceFile(file)),...program.getSemanticDiagnostics(program.getSourceFile(require.resolve('@hellotest/contracts/evidence').replace(/\.js$/,'.d.ts')))];
 assert.deepEqual(errors.map(error=>ts.flattenDiagnosticMessageText(error.messageText,' ')),[]);
});
