const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
test('typed section repair reproduces failure, validates browser runs and applies only verified instructions',{skip:process.env.AUTOMATION_AGENT_POSTGRES!=='1',timeout:120000},async()=>{
 const primary=new URL(process.env.DATABASE_URL),observation=new URL(process.env.OBS_DATABASE_URL);assert.match(primary.pathname,/^\/agent_verify_automation_[a-z0-9_]+$/);assert.equal(primary.href,observation.href);
 const db=require('../../../platform/backend/src/db'),obsDb=require('../../../platform/backend/src/obsDb');
 try {
  assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS projects").get()).projects,null);
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
  const userId=randomUUID(),projectId=randomUUID(),appTypeId=randomUUID(),roleId=randomUUID();
  await db.prepare('INSERT INTO roles(id,name) VALUES(?,?)').run(roleId,'Disposable automation administrator');await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,?,?,TRUE,'active')").run(userId,'automation-agent@example.test','not-a-login','Automation fixture');
  await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(projectId,'Disposable automation checks',userId);await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),projectId,userId,roleId);await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(appTypeId,projectId,'Browser fixture');
  await require('../helpers/automationRepairChecks').run({db,obsDb,user:{id:userId,role:'admin'},projectId,appTypeId,instructionRepair:true});
 }finally{await obsDb.close();await db.close();}
});
