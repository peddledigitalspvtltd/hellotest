const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const file=require.resolve('../../backend/services/aiTestCaseGeneration.service'),local=createRequire(file);
function fixture({persistError,attachmentError}={}){
 const calls={provider:0,persist:0,attachments:0},module={exports:{}};
 const source=fs.readFileSync(file,'utf8')+'\nmodule.exports.testGenerate=generateCasesForRequirementWithRetry;';
 new Function('require','module','exports',source)(id=>{
  if(id==='@hellotest/platform/backend/src/db')return {prepare:()=>({get:async()=>null,all:async()=>[],run:async()=>({changes:1})}),transaction:fn=>fn};
  if(id.endsWith('/requirementDesign.service'))return {previewRequirementTestCases:async()=>{calls.provider++;return {cases:[{title:'Generated native draft',steps:[],reference_attachment_ids:[]}]};}};
  if(id.endsWith('/testCase.service'))return {createTestCase:async()=>{calls.persist++;if(persistError)throw persistError;return {id:'saved-case'};}};
  if(id.endsWith('/workspaceTransaction.service'))return {};
  if(id.endsWith('/aiAttachmentAccess.service'))return {contextReferenceIds:()=>[],retainReferences:async()=>{calls.attachments++;if(attachmentError)throw attachmentError;}};
  return local(id);
 },module,module.exports);
 return {calls,generate:()=>module.exports.testGenerate({job:{id:'job',created_by:'user',max_cases_per_requirement:1},requirement:{id:'story'},appType:{id:'app',project_id:'project'},assertLease:()=>{}})};
}
test('post-generation persistence capacity failure never starts another model request',async()=>{
 const f=fixture({persistError:Object.assign(new Error('Storage circuit open'),{code:'DEPENDENCY_CIRCUIT_OPEN'})});
 await assert.rejects(f.generate(),{code:'DEPENDENCY_CIRCUIT_OPEN',retryable:false,model_output_received:true,generation_stage:'persistence',created_cases_count:0});
 assert.deepEqual(f.calls,{provider:1,persist:1,attachments:0});
});
test('attachment retention failure preserves the count of saved drafts without regenerating them',async()=>{
 const f=fixture({attachmentError:Object.assign(new Error('Attachment capacity unavailable'),{statusCode:429})});
 await assert.rejects(f.generate(),{retryable:false,model_output_received:true,created_cases_count:1});
 assert.deepEqual(f.calls,{provider:1,persist:1,attachments:1});
});
test('a successful native proposal is persisted and counted once',async()=>{
 const f=fixture();assert.equal(await f.generate(),1);assert.deepEqual(f.calls,{provider:1,persist:1,attachments:1});
});
