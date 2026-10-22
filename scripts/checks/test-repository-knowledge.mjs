import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require=createRequire(new URL('../../services/platform/backend/package.json',import.meta.url));
const {Client}=require('pg');
const values=Object.fromEntries(readFileSync(new URL('../../.hellotest/local.env',import.meta.url),'utf8').split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
const adminUrl=new URL(process.env.REPOSITORY_KNOWLEDGE_ADMIN_DATABASE_URL||values.DATABASE_URL);
if(adminUrl.hostname==='postgres')adminUrl.hostname='127.0.0.1';
if(!['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname))throw Error('This check only creates a local disposable database.');
adminUrl.pathname='/postgres';
const name='agent_verify_repository_knowledge_'+Date.now();
const admin=new Client({connectionString:adminUrl.href});await admin.connect();let created=false;
try {
  await admin.query(`CREATE DATABASE ${name}`);created=true;
  const database=new URL(adminUrl);database.pathname='/'+name;
  const child=spawn(process.execPath,['--test','services/platform/backend/test/integration/repositoryKnowledgePublication.postgres.test.js'],{stdio:'inherit',env:{...process.env,
    DATABASE_URL:database.href,OBS_DATABASE_URL:database.href,REPOSITORY_KNOWLEDGE_POSTGRES:'1',KNOWLEDGE_VECTOR_STORE:'postgresql',
    APP_MODE:'local',STORAGE_PROVIDER:'local',HELLOTEST_SCHEMA_MODE:'verify',ENABLE_OBSERVABILITY:'false',OPS_MONITORING_ENABLED:'false',REDIS_URL:'redis://127.0.0.1:1',LOG_LEVEL:'error'}});
  const[code,signal]=await once(child,'exit');process.exitCode=code===0&&!signal?0:code||1;
}finally{if(created)await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}
