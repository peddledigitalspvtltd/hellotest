import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const require=createRequire(new URL('../../services/platform/backend/package.json',import.meta.url));
const {Client}=require('pg');
const values=Object.fromEntries(readFileSync(new URL('../../.hellotest/local.env',import.meta.url),'utf8').split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
const adminUrl=new URL(process.env.PAIRED_LOCAL_TEST_DATABASE_URL||values.DATABASE_URL);
if(adminUrl.hostname==='postgres')adminUrl.hostname='127.0.0.1';
if(!['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname))throw Error('Paired local verification requires a disposable local database.');
adminUrl.pathname='/postgres';const name='agent_verify_paired_local_'+Date.now();
const admin=new Client({connectionString:adminUrl.href});await admin.connect();let created=false;
try{
 await admin.query(`CREATE DATABASE ${name}`);created=true;const url=new URL(adminUrl);url.pathname='/'+name;
 const child=spawn(process.execPath,['--test','services/platform/backend/test/integration/pairedLocalExecution.postgres.test.js'],{stdio:'inherit',env:{...process.env,DATABASE_URL:url.href,OBS_DATABASE_URL:url.href,PAIRED_LOCAL_POSTGRES_TEST:'1',APP_MODE:'local',HELLOTEST_SCHEMA_MODE:'verify',STORAGE_PROVIDER:'local',ENABLE_OBSERVABILITY:'false',OPS_MONITORING_ENABLED:'false',REDIS_URL:'redis://127.0.0.1:1',LOG_LEVEL:'error',HELLOTEST_PUBLIC_API_BASE_URL:'',HELLOTEST_MCP_INTERNAL_URL:'',SESSION_SECRET:'paired-local-fixture-session-secret-for-disposable-db',TESTENGINE_SHARED_SECRET:'paired-local-fixture-service-secret-do-not-use-in-production'}});
 const [code,signal]=await once(child,'exit');process.exitCode=code===0&&!signal?0:code||1;
}finally{if(created)await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}
