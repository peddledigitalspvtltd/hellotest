import { runDisposablePostgresTest } from './disposablePostgresTest.mjs';

await runDisposablePostgresTest({
  databaseUrlEnv: 'AUTOMATION_SUITE_TEST_DATABASE_URL',
  databasePrefix: 'automation_suite',
  testFile: 'services/automation/test/backend/suiteDispatchLifecycle.postgres.test.js',
  testToggle: 'AUTOMATION_SUITE_POSTGRES_TEST',
  fixturePrefix: 'suite'
});
