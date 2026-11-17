import {runDisposablePostgresTest} from './disposablePostgresTest.mjs';
await runDisposablePostgresTest({databaseUrlEnv:'AUTH_LOGIN_TEST_DATABASE_URL',databasePrefix:'auth_login',testFile:'services/platform/test/backend/authLoginProtection.postgres.test.js',testToggle:'AUTH_LOGIN_POSTGRES',fixturePrefix:'auth-login'});
