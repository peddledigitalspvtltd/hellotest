'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const oauth = require('../../backend/oauth');

const addresses = { resource: 'https://qa.example.test/api/mcp' };
const validRequest = overrides => ({
  response_type: 'code', client_id: 'client-a',
  redirect_uri: 'https://host.example.test/callback', state: 'random-state',
  scope: 'knowledge actions', resource: addresses.resource,
  code_challenge: 'A'.repeat(43), code_challenge_method: 'S256',
  ...overrides
});

test('redirect URIs must be absolute, safe, and HTTPS except for loopback or native schemes', () => {
  assert.equal(oauth.normalizeRedirectUri('https://host.example.test/callback'), 'https://host.example.test/callback');
  assert.equal(oauth.normalizeRedirectUri('http://localhost:4300/callback'), 'http://localhost:4300/callback');
  assert.equal(oauth.normalizeRedirectUri('com.example.host:/oauth/callback'), 'com.example.host:/oauth/callback');
  for (const value of [
    '/relative/callback', 'http://host.example.test/callback', 'https://user:pass@host.example.test/callback',
    'https://host.example.test/callback#token', 'javascript:alert(1)', 'https://host.example.test/callback\n'
  ]) assert.throws(() => oauth.normalizeRedirectUri(value), { code: 'invalid_redirect_uri' });
});

test('authorization input requires resource binding, state, and S256 PKCE and normalizes prerequisites', () => {
  const request = oauth.normalizeAuthorizationInput(validRequest(), addresses);
  assert.deepEqual(request.scopes, ['knowledge', 'records', 'actions']);
  assert.equal(request.resource, addresses.resource);
  for (const override of [
    { response_type: 'token' }, { state: '' }, { code_challenge_method: 'plain' },
    { code_challenge: 'short' }, { resource: 'https://other.example.test/mcp' },
    { scope: '' }, { scope: ['knowledge'] }, { scope: 'unknown' }
  ]) assert.throws(() => oauth.normalizeAuthorizationInput(validRequest(override), addresses));
});

test('OAuth discovery publishes only public-client authorization-code with S256', () => {
  const req = { protocol: 'https', hostname: 'qa.example.test' };
  const metadata = oauth.authServerMetadata(req, 'https://qa.example.test/api/mcp');
  assert.equal(metadata.issuer, 'https://qa.example.test');
  assert.equal(metadata.authorization_endpoint, 'https://qa.example.test/mcp/oauth/authorize');
  assert.deepEqual(metadata.grant_types_supported, ['authorization_code']);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.equal(metadata.client_id_metadata_document_supported, false);
});
