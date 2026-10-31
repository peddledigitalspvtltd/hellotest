import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(new URL('../../services/platform/backend/package.json', import.meta.url));
const { Client } = require('pg');
const values = Object.fromEntries(readFileSync(new URL('../../.hellotest/local.env', import.meta.url), 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
const adminUrl = new URL(process.env.QUALITY_AGENT_TEST_ADMIN_DATABASE_URL || values.DATABASE_URL);
if (adminUrl.hostname === 'postgres') adminUrl.hostname = '127.0.0.1';
if (!['localhost', '127.0.0.1'].includes(adminUrl.hostname)) throw new Error('Quality Agent verification requires a local disposable database.');
adminUrl.pathname = '/postgres';
const databaseName = 'quality_agent_verify_' + Date.now();
const admin = new Client({ connectionString: adminUrl.href });
await admin.connect();
let originalError;
try {
  await admin.query(`CREATE DATABASE ${databaseName}`);
  const testUrl = new URL(adminUrl); testUrl.pathname = '/' + databaseName;
  const child = spawn(process.execPath, ['--test', 'services/platform/backend/test/integration/qualityAgents.postgres.test.js'], { stdio: 'inherit', env: { ...process.env,
    DATABASE_URL: testUrl.href, OBS_DATABASE_URL: testUrl.href, QUALITY_AGENT_POSTGRES_TEST: '1', KNOWLEDGE_VECTOR_STORE: 'postgresql',
    SESSION_SECRET: 'quality-stream-fixture-never-use-in-production', APP_MODE: 'local', STORAGE_PROVIDER: 'local', HELLOTEST_SCHEMA_MODE: 'verify',
    ENABLE_OBSERVABILITY: 'false', OPS_MONITORING_ENABLED: 'false', REDIS_URL: 'redis://127.0.0.1:1', LOG_LEVEL: 'error' } });
  const [code] = await once(child, 'exit'); process.exitCode = Number.isInteger(code) ? code : 1;
} catch (error) { originalError = error; throw error; }
finally {
  const failures = [];
  try { await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); } catch (error) { failures.push(error); }
  try { await admin.end(); } catch (error) { failures.push(error); }
  if (!originalError && failures.length) throw new AggregateError(failures, 'Disposable quality database cleanup failed.');
}
