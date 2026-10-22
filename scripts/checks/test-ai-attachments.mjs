import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(new URL('../../services/platform/backend/package.json', import.meta.url));
const { Client } = require('pg');
const { Client: Storage } = require('minio');
const values = Object.fromEntries(readFileSync(new URL('../../.hellotest/local.env', import.meta.url), 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => { const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)]; }));
const adminUrl = new URL(process.env.AI_FILES_TEST_ADMIN_DATABASE_URL || values.DATABASE_URL);
if (adminUrl.hostname === 'postgres') adminUrl.hostname = '127.0.0.1';
if (!['localhost','127.0.0.1'].includes(adminUrl.hostname)) throw new Error('This runner only creates a local disposable database.');
adminUrl.pathname = '/postgres';
const name = `agent_verify_ai_files_${Date.now()}`, bucket = name.replaceAll('_','-');
const storageOptions = {endPoint:'127.0.0.1',port:Number(values.MINIO_PORT||9000),useSSL:values.MINIO_USE_SSL==='true',accessKey:values.MINIO_ACCESS_KEY||values.MINIO_ROOT_USER,secretKey:values.MINIO_SECRET_KEY||values.MINIO_ROOT_PASSWORD};
const storage = new Storage(storageOptions);
const admin = new Client({connectionString:adminUrl.href});
await admin.connect();
try {
  await admin.query(`CREATE DATABASE ${name}`);
  await storage.makeBucket(bucket);
  const testUrl=new URL(adminUrl);testUrl.pathname=`/${name}`;
  const child=spawn(process.execPath,['--test','services/platform/backend/test/integration/aiAttachments.postgres.test.js'],{stdio:'inherit',env:{...process.env,
    DATABASE_URL:testUrl.href,OBS_DATABASE_URL:testUrl.href,AI_ATTACHMENTS_POSTGRES_TEST:'1',APP_MODE:'local',STORAGE_PROVIDER:'minio',
    MINIO_ENDPOINT:'127.0.0.1',MINIO_PORT:String(storageOptions.port),MINIO_USE_SSL:String(storageOptions.useSSL),MINIO_ACCESS_KEY:storageOptions.accessKey,MINIO_SECRET_KEY:storageOptions.secretKey,MINIO_BUCKET:bucket,
    SESSION_SECRET:'fixture-only-ai-file-access-secret-at-least-32-characters',HELLOTEST_API_PUBLIC_URL:'https://files.example.test/api',REDIS_URL:'redis://127.0.0.1:1',LOG_LEVEL:'error'}});
  const[code]=await once(child,'exit');process.exitCode=code||0;
} finally {
  try { for await(const item of storage.listObjectsV2(bucket,'',true)) await storage.removeObject(bucket,item.name); await storage.removeBucket(bucket); }
  finally { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); }
}
