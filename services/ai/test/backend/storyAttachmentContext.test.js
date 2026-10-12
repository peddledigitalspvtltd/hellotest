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
test.after(()=>require('@hellotest/platform/backend/src/db').close());
