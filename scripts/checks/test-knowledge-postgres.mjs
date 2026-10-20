// Local integration proof only. SQL uses a disposable database; the vector
// fixture creates and removes its own randomly named Qdrant collection.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(new URL('../../services/platform/backend/package.json', import.meta.url));
const { Client } = require('pg');
const envFile = new URL('../../.hellotest/local.env', import.meta.url);
const values = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, 'utf8').split('\n')
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; })) : {};
const connection = process.env.KNOWLEDGE_TEST_ADMIN_DATABASE_URL || values.DATABASE_URL;
if (!connection) throw new Error('Configure a local KNOWLEDGE_TEST_ADMIN_DATABASE_URL or .hellotest/local.env.');
const adminUrl = new URL(connection);
if (adminUrl.hostname === 'postgres') adminUrl.hostname = '127.0.0.1';
if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)) throw new Error('This runner only uses a local disposable database.');
adminUrl.pathname = '/postgres';
const name = 'agent_verify_knowledge_' + Date.now();
const admin = new Client({ connectionString: adminUrl.href });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE ${name}`); created = true;
  const testUrl = new URL(adminUrl); testUrl.pathname = '/' + name;
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1',
    'services/platform/backend/test/knowledgeRepositoryLifecycle.test.js',
    'services/knowledge/test/backend/knowledgeVectorConsistency.postgres.test.js'], {
    stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl.href, OBS_DATABASE_URL: testUrl.href,
      KNOWLEDGE_POSTGRES_TEST: '1', KNOWLEDGE_VECTOR_POSTGRES_TEST: '1', APP_MODE: 'local',
      STORAGE_PROVIDER: 'local', HELLOTEST_SCHEMA_MODE: 'verify', ENABLE_OBSERVABILITY: 'false',
      OPS_MONITORING_ENABLED: 'false', REDIS_URL: 'redis://127.0.0.1:1', LOG_LEVEL: 'error' }
  });
  const [code, signal] = await once(child, 'exit'); process.exitCode = code === 0 && !signal ? 0 : code || 1;
} finally {
  if (created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
