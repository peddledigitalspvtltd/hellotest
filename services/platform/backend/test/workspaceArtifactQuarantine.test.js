const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../services/workspaceTransaction.service'),'utf8');
function fixture(){
 const originalBytes='unchanged protected image bytes';
 let transaction={id:'activity',project_id:'project',created_by:'author',category:'automation_build',metadata:{agent_activity:true,existing_progress:{saved:1}}};
 let user={id:'author',is_workspace_admin:false,status:'active'},denied='',membership=true;
 const artifacts=new Map(['one','two','other'].map(id=>[id,{id,transaction_id:'activity',mime_type:'image/jpeg',content:originalBytes,file_name:'same-name.jpg'}]));
 artifacts.set('foreign',{id:'foreign',transaction_id:'another',mime_type:'image/jpeg',content:originalBytes});
 artifacts.set('text',{id:'text',transaction_id:'activity',mime_type:'text/plain',content:'log'});
 const calls=[],events=[],module={exports:{}};
 const obs={prepare:sql=>({get:async id=>{if(sql.includes('FOR UPDATE')){calls.push('lock');return{id};}if(sql.includes('workspace_transaction_artifacts')){calls.push('artifact');return artifacts.get(id);}},run:async(content,id)=>{assert.equal(id,'activity');assert.match(sql,/metadata = metadata \|\|/);calls.push('flags');transaction.metadata={...transaction.metadata,...JSON.parse(content)};}}),transaction:callback=>async()=>{const before=structuredClone(transaction);try{return await callback();}catch(error){transaction=before;throw error;}}};
 vm.runInNewContext(source,{module,exports:module.exports,Buffer,require:id=>id==='../src/db'?{prepare:sql=>({get:async id=>{calls.push('user');assert.equal(id,'author');assert.doesNotMatch(sql,/\brole\b/,'Session role is derived from is_workspace_admin; users has no role column');return user;}})}:id==='../src/obsDb'?obs:id==='crypto'?require('crypto'):id==='./project.service'?{getProject:async(project,actor)=>{calls.push('membership');assert.equal(project,'project');assert.equal(actor,user.id);if(!membership)throw Object.assign(new Error('Forbidden'),{statusCode:403});}}:id==='./optionalEvidenceAccess.service'?{getOptionalEvidenceAccess:async(actor,project,codes)=>{calls.push('permissions');assert.equal(actor.id,user.id);assert.equal(project,'project');return Object.fromEntries(codes.map(code=>[code,code!==denied]));}}:id==='../src/utils/batchHydration'?{placeholdersFor:()=>''}:{}});
 module.exports.getTransaction=async()=>structuredClone(transaction);
 module.exports.appendTransactionEvent=async(id,event)=>{assert.equal(id,'activity');events.push(structuredClone(event));};
 return {service:module.exports,artifacts,calls,events,transaction:()=>transaction,setUser:value=>{user=value;},deny:code=>{denied=code;},membership:value=>{membership=value;}};
}

test('exact browser-image quarantine is reversible, idempotent and retains bytes, unrelated images and audit',async()=>{
 const f=fixture(),before=[...f.artifacts.values()].map(row=>row.content);
 const result=await f.service.setArtifactQuarantine('activity',{artifact_ids:['one','two'],user_id:'author'});
 assert.equal(result.changed_count,2);assert.equal(f.events.length,1);assert.equal(f.events[0].phase,'artifact.privacy.quarantined');
 assert.deepEqual([...f.artifacts.values()].map(row=>row.content),before);
 assert.equal(f.transaction().metadata.existing_progress.saved,1);
 for(const id of ['one','two'])assert.throws(()=>f.service.assertTransactionArtifactReadable(f.transaction(),f.artifacts.get(id)),error=>error.statusCode===403&&error.code==='ARTIFACT_PRIVACY_QUARANTINED');
 assert.doesNotThrow(()=>f.service.assertTransactionArtifactReadable(f.transaction(),f.artifacts.get('other')),'The same filename does not broaden quarantine');
 const again=await f.service.setArtifactQuarantine('activity',{artifact_ids:['one','two'],user_id:'author'});assert.equal(again.changed_count,0);assert.equal(f.events.length,1);
 await f.service.setArtifactQuarantine('activity',{artifact_ids:['one'],user_id:'author',quarantined:false});
 assert.doesNotThrow(()=>f.service.assertTransactionArtifactReadable(f.transaction(),f.artifacts.get('one')));
 assert.throws(()=>f.service.assertTransactionArtifactReadable(f.transaction(),f.artifacts.get('two')),error=>error.statusCode===403);
 assert.equal(f.events[1].phase,'artifact.privacy.released');assert.equal(f.transaction().metadata.artifact_quarantine.one.quarantined_by,'author');
 assert.doesNotMatch(JSON.stringify(f.events),/unchanged protected image bytes/);
 assert.equal(f.calls[0],'lock');assert.ok(f.calls.indexOf('permissions')<f.calls.indexOf('artifact'));
});

test('quarantine validates every exact owner/image and rejects ambiguous selections without partial flags',async()=>{
 for(const artifact_ids of [[],['one','one'],['one','foreign'],['one','missing'],['one','text'],Array.from({length:21},(_,i)=>`image-${i}`)]){
  const f=fixture();await assert.rejects(f.service.setArtifactQuarantine('activity',{artifact_ids,user_id:'author'}),error=>[400,404].includes(error.statusCode));
  assert.equal(f.transaction().metadata.artifact_quarantine,undefined);assert.equal(f.events.length,0);
 }
 const f=fixture();assert.throws(()=>f.service.assertTransactionArtifactReadable(f.transaction(),f.artifacts.get('foreign')),error=>error.statusCode===404);
});

test('current actor, ownership, membership and every management/content permission are required',async()=>{
 for(const code of ['transaction.manage','automation.build','automation.view','automation.code.view','automation.ai']){
  const f=fixture();f.deny(code);await assert.rejects(f.service.setArtifactQuarantine('activity',{artifact_ids:['one'],user_id:'author'}),error=>error.statusCode===403);assert.equal(f.events.length,0);assert.ok(!f.calls.includes('artifact'));
 }
 for(const user of [null,{id:'author',is_workspace_admin:false,status:'suspended'},{id:'another',is_workspace_admin:false,status:'active'}]){
  const f=fixture();f.setUser(user);await assert.rejects(f.service.setArtifactQuarantine('activity',{artifact_ids:['one'],user_id:'author'}),error=>error.statusCode===403);assert.equal(f.events.length,0);
 }
 const f=fixture();f.membership(false);await assert.rejects(f.service.setArtifactQuarantine('activity',{artifact_ids:['one'],user_id:'author'}),error=>error.statusCode===403);assert.equal(f.events.length,0);
});
