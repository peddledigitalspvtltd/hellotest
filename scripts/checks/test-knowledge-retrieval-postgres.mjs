// Local integration proof for Knowledge retrieval, graph and indexing SQL.
// The default run includes both synthetic and curated Launchpad retrieval
// evaluations. Each fixture gets a migrated disposable database that is dropped
// afterwards. Refuses anything that is not a local PostgreSQL server.
//
//   KNOWLEDGE_TEST_ADMIN_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres \
//     node scripts/checks/test-knowledge-retrieval-postgres.mjs [extra test files...]
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
// The tests assert this exact naming before touching anything. Each file gets its OWN
// disposable database: background reconciliation such as the graph backfill is global
// to a database, so files must not see each other's rows.
const stamp = Date.now();
const runs = process.argv.length > 2 ? process.argv.slice(2).map(file => ({ file, env: {} })) : [
  { file: 'services/knowledge/test/backend/knowledgeRetrieval.postgres.test.js', env: {} },
  { file: 'services/knowledge/test/backend/knowledgeGraph.postgres.test.js', env: {} },
  { file: 'services/knowledge/test/backend/knowledgeRetrievalEvaluation.postgres.test.js', env: {} },
  { file: 'services/knowledge/test/backend/knowledgeRetrievalEvaluation.postgres.test.js', env: {
    KNOWLEDGE_GOLDEN_SET: 'services/knowledge/test/golden/retrieval.launchpad-curated.json'
  } },
  { file: 'services/chatbot/test/backend/knowledgeAssistantTurn.postgres.test.js', env: {} }
];
const admin = new Client({ connectionString: adminUrl.href });
await admin.connect();
let failed = 0;
try {
  for (const [index, run] of runs.entries()) {
    const { file, env: testEnv = {} } = run;
    const name = `agent_verify_knowledge_retrieval_${stamp}${index}`;
    let created = false;
    try {
      await admin.query(`CREATE DATABASE ${name}`); created = true;
      const testUrl = new URL(adminUrl); testUrl.pathname = '/' + name;
      const child = spawn(process.execPath, ['--test', '--test-concurrency=1', file], {
        stdio: 'inherit', env: { ...process.env, ...testEnv, DATABASE_URL: testUrl.href, OBS_DATABASE_URL: testUrl.href,
          KNOWLEDGE_RETRIEVAL_POSTGRES_TEST: '1', APP_MODE: 'local', STORAGE_PROVIDER: 'local',
          ENABLE_OBSERVABILITY: 'false', OPS_MONITORING_ENABLED: 'false', REDIS_URL: 'redis://127.0.0.1:1', LOG_LEVEL: 'error' }
      });
      const [code, signal] = await once(child, 'exit');
      if (code !== 0 || signal) failed += 1;
    } finally {
      if (created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }
} finally {
  await admin.end();
}
process.exitCode = failed ? 1 : 0;
