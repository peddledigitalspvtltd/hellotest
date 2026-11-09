import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../services/platform/backend/package.json', import.meta.url));
const { Client } = require('pg');
const localEnv = new URL('../../.hellotest/local.env', import.meta.url);

function localDatabaseUrl() {
  return Object.fromEntries(readFileSync(localEnv, 'utf8').split('\n')
    .filter(line => /^[A-Z_]+=/.test(line))
    .map(line => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    })).DATABASE_URL;
}

export async function runDisposablePostgresTest({ databaseUrlEnv, databasePrefix, testFile, testToggle, fixturePrefix }) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(databasePrefix)) throw new TypeError('Invalid disposable database prefix.');
  const configured = process.env[databaseUrlEnv] || localDatabaseUrl();
  const adminUrl = new URL(configured);
  if (adminUrl.hostname === 'postgres') adminUrl.hostname = '127.0.0.1';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)) {
    throw new Error(`${databasePrefix} verification requires a disposable local PostgreSQL database.`);
  }

  adminUrl.pathname = '/postgres';
  const name = `agent_verify_${databasePrefix}_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 3000 });
  let created = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;

    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${name}`;
    const child = spawn(process.execPath, ['--test', testFile], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl.href,
        POSTGRES_URL: databaseUrl.href,
        OBS_DATABASE_URL: databaseUrl.href,
        OBS_POSTGRES_URL: databaseUrl.href,
        [testToggle]: '1',
        APP_MODE: 'local',
        HELLOTEST_SCHEMA_MODE: 'verify',
        STORAGE_PROVIDER: 'local',
        ENABLE_OBSERVABILITY: 'false',
        OPS_MONITORING_ENABLED: 'false',
        REDIS_URL: 'redis://127.0.0.1:1',
        LOG_LEVEL: 'error',
        HELLOTEST_PUBLIC_API_BASE_URL: '',
        HELLOTEST_MCP_INTERNAL_URL: '',
        SESSION_SECRET: `${fixturePrefix}-fixture-session-secret-for-disposable-db`,
        TESTENGINE_SHARED_SECRET: `${fixturePrefix}-fixture-service-secret-do-not-use-in-production`
      }
    });
    const [code, signal] = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
    });
    process.exitCode = code === 0 && !signal ? 0 : code || 1;
  } catch (error) {
    console.error(`Disposable ${databasePrefix} PostgreSQL verification could not complete: ${error.code || error.message}`);
    process.exitCode = 1;
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
