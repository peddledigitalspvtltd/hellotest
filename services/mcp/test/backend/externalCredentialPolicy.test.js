'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../../backend/externalCredentialPolicy');

const env = values => ({
  NODE_ENV: 'test', HELLOTEST_MCP_OAUTH_ENABLED: undefined,
  HELLOTEST_MCP_PUBLIC_URL: undefined, ...values
});

test('local development may use OAuth or explicit manual credentials', () => {
  assert.equal(policy.oauthEnabled(env({ HELLOTEST_MCP_OAUTH_ENABLED: 'true' })), true);
  assert.equal(policy.externalCredentialsEnabled(env({})), true);
  assert.equal(policy.manualCredentialIssuanceEnabled(env({})), true);
});

test('production requires an enabled OAuth flow and a clean public HTTPS MCP URL', () => {
  const valid = {
    NODE_ENV: 'production', HELLOTEST_MCP_OAUTH_ENABLED: 'true',
    HELLOTEST_MCP_PUBLIC_URL: 'https://qa.example.test/api/mcp'
  };
  assert.equal(policy.oauthEnabled(env(valid)), true);
  assert.equal(policy.externalCredentialsEnabled(env(valid)), true);
  assert.equal(policy.manualCredentialIssuanceEnabled(env(valid)), false);
  for (const publicUrl of [
    undefined, 'http://qa.example.test/api/mcp', 'https://qa.example.test/mcp?x=1',
    'https://user:secret@qa.example.test/api/mcp', 'https://qa.example.test/api/other'
  ]) {
    assert.equal(policy.oauthEnabled(env({ ...valid, HELLOTEST_MCP_PUBLIC_URL: publicUrl })), false, String(publicUrl));
  }
  assert.equal(policy.externalCredentialsEnabled(env({ NODE_ENV: 'production' })), false);
});

test('a missing OAuth consent flow stays explicit in production policy', () => {
  const configured = {
    NODE_ENV: 'production', HELLOTEST_MCP_OAUTH_ENABLED: 'false',
    HELLOTEST_MCP_PUBLIC_URL: 'https://qa.example.test/api/mcp'
  };
  assert.equal(policy.oauthEnabled(env(configured)), false);
  assert.equal(policy.externalCredentialsEnabled(env(configured)), false);
  assert.equal(policy.manualCredentialIssuanceEnabled(env(configured)), false);
});
