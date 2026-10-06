import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const require=createRequire(new URL('../../services/platform/backend/package.json',import.meta.url));
const {Client}=require('pg');
const envFile=readFileSync(new URL('../../.hellotest/local.env',import.meta.url),'utf8');
const values=Object.fromEntries(envFile.split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));
const adminUrl=new URL(process.env.MCP_TEST_ADMIN_DATABASE_URL||values.DATABASE_URL);
if(adminUrl.hostname==='postgres')adminUrl.hostname='127.0.0.1';
if(!['localhost','127.0.0.1'].includes(adminUrl.hostname))throw new Error('This runner only uses a local disposable database.');
adminUrl.pathname='/postgres';const name='agent_verify_mcp_'+Date.now();
const admin=new Client({connectionString:adminUrl.href});await admin.connect();
try{
 await admin.query(`CREATE DATABASE ${name}`);
 const testUrl=new URL(adminUrl);testUrl.pathname='/'+name;
 const child=spawn(process.execPath,['--test','services/platform/backend/test/integration/mcp.postgres.test.js'],{stdio:'inherit',env:{...process.env,DATABASE_URL:testUrl.href,OBS_DATABASE_URL:testUrl.href,MCP_POSTGRES_TEST:'1',SESSION_SECRET:'mcp-integration-tests-never-use-this-in-production',APP_MODE:'local',STORAGE_PROVIDER:'local',HELLOTEST_SCHEMA_MODE:'verify',ENABLE_OBSERVABILITY:'false',OPS_MONITORING_ENABLED:'false',REDIS_URL:'redis://127.0.0.1:1',LOG_LEVEL:'error'}});
 const [code]=await once(child,'exit');process.exitCode=code||0;
}finally{await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}
