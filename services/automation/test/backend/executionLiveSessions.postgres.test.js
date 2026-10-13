const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('dispatched live sessions use native PostgreSQL metadata and cannot cross project or run scope', {skip:process.env.EXECUTION_LIVE_POSTGRES !== '1'}, async () => {
 assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_live_sessions_[a-z0-9_]+$/);
 const db=require('@hellotest/platform/backend/src/db');
 const obs=require('@hellotest/platform/backend/src/obsDb');
 const dispatch=require('../../backend/services/testEngineDispatch.service');
 try {
  assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null);
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
  for(const id of ['project-a','project-b']) await db.prepare('INSERT INTO projects(id,name) VALUES (?,?)').run(id,id);
  for(const [id,project,execution,url] of [
   ['matching','project-a','run-a','http://host.docker.internal:4313/api/v1/live-session?provider=playwright'],
   ['foreign-project','project-b','run-a','http://localhost:9999/api/v1/live-session'],
   ['foreign-run','project-a','run-b','http://localhost:9998/api/v1/live-session'],
   ['secret-url','project-a','run-a','https://user:private@example.test/live']
  ]) await obs.prepare("INSERT INTO workspace_transactions(id,project_id,category,action,status,title,related_kind,related_id,metadata) VALUES (?,?,'automation','testengine_run','running',?,'testengine_run',?,?)").run(id,project,id,id,{execution_id:execution,live_view_url:url,active_web_engine:'playwright'});
  const sessions=await dispatch.getExecutionLiveSessions({id:'run-a',project_id:'project-a',status:'running'});
  assert.deepEqual(sessions,[{engine_run_id:'matching',provider:'playwright',url:'http://localhost:4313/api/v1/live-session?provider=playwright&run_id=matching'}]);
  await obs.prepare("UPDATE workspace_transactions SET status='completed' WHERE id='matching'").run();
  assert.deepEqual(await dispatch.getExecutionLiveSessions({id:'run-a',project_id:'project-a',status:'running'}),[]);
 } finally {await Promise.all([db.close(),obs.close()]);}
});
