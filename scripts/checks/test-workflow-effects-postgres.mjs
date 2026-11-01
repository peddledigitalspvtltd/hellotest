import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const require=createRequire(new URL('../../services/platform/backend/package.json',import.meta.url));
const {Client}=require('pg');
const values=process.env.WORKFLOW_EFFECTS_ADMIN_DATABASE_URL?{}:Object.fromEntries(readFileSync(new URL('../../.hellotest/local.env',import.meta.url),'utf8').split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
const adminUrl=new URL(process.env.WORKFLOW_EFFECTS_ADMIN_DATABASE_URL||values.DATABASE_URL);
if(adminUrl.hostname==='postgres')adminUrl.hostname='127.0.0.1';
if(!['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname))throw Error('Workflow effects verification requires a disposable local database.');
adminUrl.pathname='/postgres';const name='agent_verify_workflow_effects_'+Date.now();
const admin=new Client({connectionString:adminUrl.href});await admin.connect();let created=false;
try{
 await admin.query(`CREATE DATABASE ${name}`);created=true;const url=new URL(adminUrl);url.pathname='/'+name;
 const child=spawn(process.execPath,['--test','services/platform/backend/test/integration/workflowEffects.postgres.test.js'],{stdio:'inherit',env:{...process.env,
  DATABASE_URL:url.href,POSTGRES_URL:url.href,OBS_DATABASE_URL:url.href,OBS_POSTGRES_URL:url.href,HELLOTEST_MCP_DATABASE_URL:url.href,
  WORKFLOW_EFFECTS_POSTGRES_TEST:'1',TEMPORAL_ADDRESS:'',HELLOTEST_MCP_INTERNAL_URL:'',HELLOTEST_MCP_PUBLIC_URL:'',
  APP_MODE:'local',HELLOTEST_SCHEMA_MODE:'verify',KNOWLEDGE_VECTOR_STORE:'postgresql',STORAGE_PROVIDER:'local',
  SESSION_SECRET:'workflow-effects-fixture-session-never-use-in-production',ENABLE_OBSERVABILITY:'false',OPS_MONITORING_ENABLED:'false',REDIS_URL:'redis://127.0.0.1:1',LOG_LEVEL:'error'}});
 const [code,signal]=await once(child,'exit');process.exitCode=code===0&&!signal?0:code||1;
}finally{if(created)await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}
