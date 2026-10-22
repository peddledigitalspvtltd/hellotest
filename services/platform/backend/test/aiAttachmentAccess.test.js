const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const file = require.resolve('../services/aiAttachmentAccess.service');
const local = createRequire(file);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

function fixture(t) {
  const previous = process.env.HELLOTEST_API_PUBLIC_URL;
  process.env.HELLOTEST_API_PUBLIC_URL = 'https://app.example.test/api';
  t.after(() => { if (previous === undefined) delete process.env.HELLOTEST_API_PUBLIC_URL; else process.env.HELLOTEST_API_PUBLIC_URL = previous; });
  const state = { secret:'fixture-only-session-secret-with-32-characters',user:{id:'user-1',status:'active'}, row:{id:'file-1',project_id:'project-1',checksum_sha256:'a'.repeat(64)}, allowed:true, copies:[], uploads:[] };
  const attachments = {
    download:async ({user,id}) => {
      if (!state.allowed || user.id !== state.user.id || id !== state.row.id) throw Object.assign(new Error('Permission denied'),{statusCode:403});
      return {row:{...state.row},stream:Readable.from([Buffer.from('private bytes')])};
    },
    upload:async input => {
      const bytes=[];for await(const chunk of input.stream)bytes.push(chunk);
      const checksum=createHash('sha256').update(Buffer.concat(bytes)).digest('hex');
      assert.equal(checksum,input.expectedSha256);
      state.uploads.push({...input,bytes:Buffer.concat(bytes)});
      state.row={...state.row,checksum_sha256:checksum};
      return{id:state.row.id,filename:input.fileName,checksum};
    },
    copyToEntity:async input => {state.copies.push(input);return{id:'copied-1'};}
  };
  const overrides = {
    '../src/db':{prepare:()=>({get:async id=>id===state.user.id?{...state.user}:null})},
    './attachment.service':attachments,
    './permission.service':{hasPermission:async()=>state.allowed},
    '../src/security/runtimeSecrets':{resolveSessionSecret:()=> state.secret,INSECURE_DEFAULTS:new Set(['hellotest-dev-secret'])},
    '../src/utils/llmTraceContext':{current:()=>({actor_id:state.user.id,project_id:'project-1'})}
  };
  const module={exports:{}};
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>overrides[id]||local(id),module,module.exports);
  return{service:module.exports,state};
}

test('AI file links deliver exact authorized bytes and bind file, source version, project and expiry',async t=>{
  const{service,state}=fixture(t);
  const access=await service.createAccess({user:state.user,id:'file-1',projectId:'project-1'});
  const url=new URL(access.url),token=url.searchParams.get('token');
  assert.equal(url.origin,'https://app.example.test');assert.equal(url.pathname,'/api/attachments/file-1/ai-content');
  const result=await service.download({id:'file-1',token});
  const bytes=[];for await(const part of result.stream)bytes.push(part);assert.equal(Buffer.concat(bytes).toString(),'private bytes');
  await assert.rejects(service.download({id:'another-file',token}),{statusCode:403});
  await assert.rejects(service.download({id:'file-1',token:token+'x'}),{statusCode:403});
  state.row.checksum_sha256='b'.repeat(64);
  await assert.rejects(service.download({id:'file-1',token}),{statusCode:403});
  state.row.checksum_sha256='a'.repeat(64);state.row.project_id='another-project';
  await assert.rejects(service.download({id:'file-1',token}),{statusCode:403});
  state.row.project_id='project-1';
  const original=Date.now;t.mock.method(Date,'now',()=>original()+601_000);
  await assert.rejects(service.download({id:'file-1',token}),{statusCode:403});
});

test('issued links recheck disabled users and revoked file access and cannot cross project at issuance',async t=>{
  const{service,state}=fixture(t);
  await assert.rejects(service.createAccess({user:state.user,id:'file-1',projectId:'another-project'}),{statusCode:403});
  state.row.checksum_sha256=null;await assert.rejects(service.createAccess({user:state.user,id:'file-1',projectId:'project-1'}),{statusCode:409});state.row.checksum_sha256='a'.repeat(64);
  const access=await service.createAccess({user:state.user,id:'file-1',projectId:'project-1'}),token=new URL(access.url).searchParams.get('token');
  state.allowed=false;await assert.rejects(service.download({id:'file-1',token}),{statusCode:403});
  state.allowed=true;state.user.status='disabled';await assert.rejects(service.download({id:'file-1',token}),{statusCode:403});
});

test('default development secrets cannot issue or verify a public file capability',async t=>{
  const{service,state}=fixture(t);
  const access=await service.createAccess({user:state.user,id:'file-1',projectId:'project-1'}),token=new URL(access.url).searchParams.get('token');
  state.secret='hellotest-dev-secret';
  await assert.rejects(service.createAccess({user:state.user,id:'file-1',projectId:'project-1'}),{statusCode:503});
  await assert.rejects(service.download({id:'file-1',token}),{statusCode:503});
});

test('model reference preparation persists verified private bytes and provides an expiring URL',async t=>{
  const{service,state}=fixture(t);let retained;
  const init={body:JSON.stringify({messages:[{role:'user',content:[{type:'text',text:'Write a test'},{type:'image_url',image_url:{url:png,detail:'low'}}]}]})};
  const result=await service.prepareImages(init,{persistReferenceImages:true,referenceImageNames:['original.png'],onReferenceAttachments:items=>{retained=items;}});
  const payload=JSON.parse(result.body),image=payload.messages[0].content[1].image_url;
  assert.match(image.url,/^https:\/\/app\.example\.test\/api\/attachments\/file-1\/ai-content\?token=/);
  assert.equal(image.detail,'low');assert.equal(payload.messages[0].content[0].text,'Write a test');
  assert.equal(state.uploads[0].entityType,'project');assert.equal(state.uploads[0].entityId,'project-1');
  assert.equal(state.uploads[0].fileName,'original.png');assert.deepEqual(state.uploads[0].bytes,Buffer.from(png.split(',')[1],'base64'));
  assert.equal(retained[0].id,'file-1');
  const downloaded=await service.download({id:'file-1',token:new URL(image.url).searchParams.get('token')});downloaded.stream.destroy();
});

test('local model input keeps inline bytes and references copy only into the authorized project',async t=>{
  const{service,state}=fixture(t);process.env.HELLOTEST_API_PUBLIC_URL='http://localhost:3000';
  const init={body:JSON.stringify({messages:[{role:'user',content:[{type:'image_url',image_url:{url:png}}]}]})};
  assert.equal((await service.prepareImages(init,{persistReferenceImages:true})).body,init.body);
  await assert.rejects(service.createAccess({user:state.user,id:'file-1',projectId:'project-1'}),{statusCode:503});
  await service.retainReferences({userId:'user-1',projectId:'project-1',entityId:'case-1',ids:['file-1','file-1']});
  assert.equal(state.copies.length,1);assert.equal(state.copies[0].entityType,'test_case');assert.equal(state.copies[0].entityId,'case-1');
  await assert.rejects(service.retainReferences({userId:'user-1',projectId:'other',entityId:'case-2',ids:['file-1']}),{statusCode:403});
  assert.equal(state.copies.length,1);
  assert.throws(()=>service.referenceIds(Array(13).fill('file-1')),{statusCode:400});
  assert.deepEqual(service.contextReferenceIds('Write cases\n[HELLOTEST_SMART_CONTEXT_START]\n'+JSON.stringify({files:[{id:'file-1'},{id:'file-1'}]})+'\n[HELLOTEST_SMART_CONTEXT_END]'),['file-1']);
  assert.deepEqual(service.contextReferenceIds('Write cases about file-1'),[]);
});
