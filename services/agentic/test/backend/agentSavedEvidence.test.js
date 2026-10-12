const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agenticAssistant.service.js');
test('saved review access rechecks indexed source ACLs before exposing findings or accepting proposals',async()=>{
 const native=createRequire(filename);let checked=false;
 const mocks={
  '@hellotest/platform/backend/services/workspaceTransaction.service':{getTransaction:async()=>({id:'review',category:'ai_agent',related_kind:'agentic_assistant_session',project_id:'project',metadata:{evidence_permissions:['knowledge.view'],citations:[{id:'citation-1',source_id:'source-1',chunk_id:'chunk-1',source_kind:'text'}]}})},
  '@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({id:'project'})},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/platform/backend/services/optionalEvidenceAccess.service':{getOptionalEvidenceAccess:async()=>({'knowledge.view':true})},
  '@hellotest/knowledge/backend/services/knowledgeRetrieval.service':{authorizeFreshEvidence:async({projectId,hits})=>{checked=true;assert.equal(projectId,'project');assert.equal(hits[0].chunk_id,'chunk-1');return {allowed:[],denied_ids:['citation-1']};}}
 };
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports);
 await assert.rejects(module.exports.getSession('review',{id:'actor'}),error=>error.statusCode===403&&/Source access/.test(error.message));assert.equal(checked,true);
});
