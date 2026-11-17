import { runDisposablePostgresTest } from './disposablePostgresTest.mjs';

await runDisposablePostgresTest({
  databaseUrlEnv: 'AUTOMATION_ADMISSION_TEST_DATABASE_URL', databasePrefix: 'authoring_admission',
  testFile: 'services/automation/test/backend/automationAuthoringAdmission.postgres.test.js',
  testToggle: 'AUTOMATION_ADMISSION_POSTGRES_TEST', fixturePrefix: 'authoring'
});
