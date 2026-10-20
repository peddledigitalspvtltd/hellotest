const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const platformRequire=require('node:module').createRequire(path.resolve(__dirname,'../../../platform/backend/package.json'));

test('accepted Story files retain original bytes with scoped permissions and concurrent verified upload retries',{skip:process.env.STORY_ATTACHMENTS_POSTGRES!=='1',timeout:180000},async()=>{
 const url=new URL(process.env.DATABASE_URL);
 assert.match(url.pathname,/^\/agent_verify_story_attachments(?:_[a-z0-9]+)?$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');
 assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
 assert.equal(process.env.MINIO_ENDPOINT,'127.0.0.1');assert.equal(process.env.MINIO_PORT,'55440');assert.match(process.env.MINIO_BUCKET,/^agent-verify-/);
 const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
 const app=platformRequire('fastify')();
 try{
  assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null,'Use an empty owned fixture database.');
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
  await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
  const actor=randomUUID(),viewer=randomUUID(),project=randomUUID(),otherProject=randomUUID(),story=randomUUID(),declined=randomUUID(),foreignStory=randomUUID(),role=randomUUID();
  for(const id of [actor,viewer])await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,'fixture-only','Attachment reviewer',?,'active')").run(id,`${id}@example.test`,id===actor);
  for(const id of [project,otherProject])await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Disposable Story attachments')").run(id);
  await db.prepare("INSERT INTO roles(id,name) VALUES(?,'Fixture without attachment grants')").run(role);
  for(const user of [actor,viewer])await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,user,role);
  for(const id of [story,declined])await db.prepare("INSERT INTO requirements(id,project_id,title) VALUES(?,?,'Reviewed Story')").run(id,project);
  await db.prepare("INSERT INTO requirements(id,project_id,title) VALUES(?,?,'Foreign Story')").run(foreignStory,otherProject);
  let user={id:actor,is_workspace_admin:true};
  app.decorate('authenticate',async request=>{request.user=user;});
  await app.register(platformRequire('@fastify/multipart'),{limits:{fileSize:1024*1024,fields:10}});
  await app.register(require('../../../platform/backend/routes/attachments.routes'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2kAAAAASUVORK5CYII=','base64');
  const text=Buffer.from('Original business rules: delivery preferences remain unchanged.\n'.repeat(80));
  const upload=async(bytes,{entity=story,scopeProject=project,name='original.png',mime='image/png',checksum=createHash('sha256').update(bytes).digest('hex')}={})=>{
   const boundary=`fixture-${randomUUID()}`;
   const fields={project_id:scopeProject,entity_type:'requirement',entity_id:entity,checksum_sha256:checksum};
   const prefix=Object.entries(fields).map(([key,value])=>`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
   return app.inject({method:'POST',url:'/attachments',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(prefix+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)])});
  };
  const concurrent=await Promise.all([upload(png),upload(png)]);
  assert.ok(concurrent.every(result=>result.statusCode===200),concurrent.map(result=>result.body).join('\n'));
  assert.equal(concurrent[0].json().id,concurrent[1].json().id,'Concurrent response-loss retries create one attachment.');
  const image=concurrent[0].json();assert.equal(image.entity_id,story);assert.equal(image.mimeType,'image/png');assert.equal(image.compression,'none');assert.equal(image.size,png.length);
  const document=await upload(text,{name:'business-rules.txt',mime:'text/plain'});assert.equal(document.statusCode,200,document.body);assert.equal(document.json().compression,'gzip');
  for(const [receipt,original]of [[image,png],[document.json(),text]]){
   const downloaded=await app.inject({method:'GET',url:`/attachments/${receipt.id}/download`});assert.equal(downloaded.statusCode,200);assert.deepEqual(downloaded.rawPayload,original);
  }
  assert.equal((await upload(Buffer.from('different bytes'),{checksum:image.checksum})).statusCode,400,'A forged replay checksum is still verified against request bytes.');
  assert.equal((await upload(text,{name:'wrong-checksum.txt',mime:'text/plain',checksum:'0'.repeat(64)})).statusCode,400);
  assert.equal((await upload(png,{entity:foreignStory})).statusCode,403);
  assert.equal((await upload(png,{checksum:'not-a-digest'})).statusCode,400);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM attachments WHERE entity_id=?').get(story)).count,2);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM attachments WHERE entity_id=?').get(declined)).count,0,'Unaccepted Story drafts receive no original files.');
  const storage=new (platformRequire('minio').Client)({endPoint:'127.0.0.1',port:55440,useSSL:false,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY});
  const stored=[];for await(const object of storage.listObjectsV2(process.env.MINIO_BUCKET,`${project}/requirement/${story}/`,true))stored.push(object);
  assert.equal(stored.length,2,'Rejected checksums leave no orphan object.');
  user={id:viewer,is_workspace_admin:false};
  assert.equal((await upload(png)).statusCode,403,'Idempotent replay cannot bypass attachment.create.');
  assert.equal((await app.inject({method:'GET',url:`/attachments?project_id=${project}&entity_type=requirement&entity_id=${story}`})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:`/attachments/${image.id}/download`})).statusCode,403);
 }finally{await app.close();await Promise.all([db.close(),obs.close()]);}
});
