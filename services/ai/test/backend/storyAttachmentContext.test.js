const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const attachments = require('@hellotest/platform/backend/services/attachment.service');
const reader = require('../../backend/services/storyAttachmentContext');
const item = { id:'file',story_id:'story',mime_type:'text/plain',size_bytes:20000 };
const row = { project_id:'project',entity_type:'requirement',entity_id:'story',checksum_sha256:'version-checksum' };
test('live attachment context reads only a bounded authorized text excerpt and closes the stream',async t=>{
 const stream=Readable.from([Buffer.from('Source evidence '.repeat(1500))]);
 const download=t.mock.method(attachments,'download',async input=>{assert.equal(input.user.id,'reviewer');assert.equal(input.id,'file');return {row,stream};});
 const result=await reader.excerpt({item,projectId:'project',user:{id:'reviewer'}});
 assert.equal(download.mock.callCount(),1);assert.equal(result.status,'excerpt');assert.ok(result.excerpt.length<=600);assert.equal(result.excerpt_truncated,true);assert.equal(result.checksum_sha256,'version-checksum');assert.equal(stream.destroyed,true);
});
test('foreign Story/project files and stalled reads return explicit gaps without file content',async t=>{
 let stream=Readable.from([Buffer.from('FOREIGN_PRIVATE_CONTENT')]);
 t.mock.method(attachments,'download',async()=>({row:{...row,project_id:'foreign'},stream}));
 const foreign=await reader.excerpt({item,projectId:'project',user:{id:'reviewer'}});
 assert.equal(foreign.status,'unavailable');assert.doesNotMatch(JSON.stringify(foreign),/FOREIGN_PRIVATE_CONTENT/);assert.equal(stream.destroyed,true);
 t.mock.restoreAll();stream=new Readable({read(){}});
 t.mock.method(attachments,'download',async()=>({row,stream}));
 const stalled=await reader.excerpt({item,projectId:'project',user:{id:'reviewer'},timeoutMs:20});
 assert.equal(stalled.status,'unavailable');assert.equal(stream.destroyed,true);
});
test('binary and large attachments stay metadata-only and never trigger a download',async t=>{
 const download=t.mock.method(attachments,'download',async()=>assert.fail('Unbounded file read'));
 for(const candidate of [{...item,mime_type:'image/png'},{...item,size_bytes:64001}])assert.equal((await reader.excerpt({item:candidate,projectId:'project',user:{id:'reviewer'}})).status,'metadata_only');
 assert.equal(download.mock.callCount(),0);
});
test('workflow attachment retrieval uses the exact Story and checks both read permissions before querying',async t=>{
 const access=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
 let permitted=false;
 t.mock.method(access,'getOptionalEvidenceAccess',async(user,project,codes)=>{
  assert.deepEqual([user.id,project,codes],['reviewer','project',['requirement.view','attachment.view']]);
  return {'requirement.view':true,'attachment.view':permitted};
 });
 const db=require('@hellotest/platform/backend/src/db');
 const prepare=t.mock.method(db,'prepare',sql=>({all:async(...args)=>{
  assert.match(sql,/entity_type = 'requirement' AND entity_id = \?/);
  assert.deepEqual(args,['project','story']);
  return [{...item,file_name:'contract.txt'}];
 }}));
 t.mock.method(attachments,'download',async()=>({row,stream:Readable.from(['Only this Story’s requirement.'])}));
 const input={storyId:'story',projectId:'project',user:{id:'reviewer'}};
 assert.deepEqual(await reader.readStoryAttachments(input),[]);
 assert.equal(prepare.mock.callCount(),0);
 permitted=true;
 const [evidence]=await reader.readStoryAttachments(input);
 assert.equal(evidence.id,'file');assert.equal(evidence.story_id,'story');
 assert.equal(evidence.excerpt,'Only this Story’s requirement.');
});
test.after(()=>require('@hellotest/platform/backend/src/db').close());
