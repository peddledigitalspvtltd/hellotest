import {runDisposablePostgresTest} from './disposablePostgresTest.mjs';
await runDisposablePostgresTest({databaseUrlEnv:'WALKTHROUGH_EXECUTION_TEST_DATABASE_URL',databasePrefix:'walkthrough_execution',testFile:'services/testing/test/backend/walkthroughExecution.postgres.test.js',testToggle:'WALKTHROUGH_EXECUTION_POSTGRES',fixturePrefix:'walkthrough'});
