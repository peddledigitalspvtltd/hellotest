import { runDisposablePostgresTest } from './disposablePostgresTest.mjs';

await runDisposablePostgresTest({
  databaseUrlEnv: 'WEB_RECORDER_TEST_DATABASE_URL',
  databasePrefix: 'web_recorder',
  testFile: 'services/automation/test/backend/webRecorderPersistence.postgres.test.js',
  testToggle: 'WEB_RECORDER_POSTGRES_TEST',
  fixturePrefix: 'recorder'
});
