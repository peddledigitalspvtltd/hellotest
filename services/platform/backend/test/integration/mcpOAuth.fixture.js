'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

async function verify({ app, createToken }) {
  const previousFlag = process.env.HELLOTEST_MCP_OAUTH_ENABLED;
  process.env.HELLOTEST_MCP_OAUTH_ENABLED = 'true';
  try {
    const metadataResponse = await app.inject({ url: '/mcp/oauth/authorization-server-metadata' });
    assert.equal(metadataResponse.statusCode, 200, metadataResponse.body);
    const metadata = metadataResponse.json();
    assert.equal(metadata.code_challenge_methods_supported.includes('S256'), true);
    assert.equal(metadata.token_endpoint_auth_methods_supported.includes('none'), true);

    const resourceResponse = await app.inject({ url: '/mcp/oauth/resource-metadata' });
    assert.equal(resourceResponse.statusCode, 200, resourceResponse.body);
    const resource = resourceResponse.json().resource;
    assert.equal(resource, 'http://localhost/api/mcp');

    const badRegistration = await app.inject({
      method: 'POST', url: '/agentic-workflows/mcp/oauth/register',
      payload: { client_name: 'Untrusted host', redirect_uris: ['http://attacker.example/callback'] }
    });
    assert.equal(badRegistration.statusCode, 400);
    assert.equal(badRegistration.json().error, 'invalid_redirect_uri');

    const registered = await app.inject({
      method: 'POST', url: '/agentic-workflows/mcp/oauth/register',
      payload: { client_name: 'OAuth integration fixture', redirect_uris: ['https://client.example.test/callback'] }
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const client = registered.json();
    assert.equal(client.token_endpoint_auth_method, 'none');
    assert.equal(Object.hasOwn(client, 'client_secret'), false);

    const loginToken = createToken({ id: 'mcp-a' });
    const sessionHeaders = { authorization: `Bearer ${loginToken}` };
    const codeVerifier = randomBytes(32).toString('base64url').slice(0, 43);
    const oauth = require('@hellotest/mcp/backend/oauth');
    const codeChallenge = oauth.sha256Base64Url(codeVerifier);
    const state = randomBytes(24).toString('base64url');
    const authorizationParams = {
      response_type: 'code', client_id: client.client_id,
      redirect_uri: client.redirect_uris[0], state, scope: 'knowledge records actions',
      resource, code_challenge: codeChallenge, code_challenge_method: 'S256'
    };
    const authorization = await app.inject({
      method: 'POST', url: '/agentic-workflows/mcp/oauth/authorize-request',
      headers: sessionHeaders, payload: authorizationParams
    });
    assert.equal(authorization.statusCode, 200, authorization.body);
    assert.deepEqual(authorization.json().scopes, ['knowledge', 'records', 'actions']);
    const repeatedAuthorization = await app.inject({
      method: 'POST', url: '/agentic-workflows/mcp/oauth/authorize-request',
      headers: sessionHeaders, payload: authorizationParams
    });
    assert.equal(repeatedAuthorization.statusCode, 200, repeatedAuthorization.body);
    assert.equal(repeatedAuthorization.json().request_id, authorization.json().request_id, 'same live browser request is idempotent');

    const emptyGrant = await app.inject({
      method: 'POST', url: `/agentic-workflows/mcp/oauth/authorize-request/${authorization.json().request_id}/decision`,
      headers: sessionHeaders, payload: { approved: true, projectId: 'mcp-p-a', scopes: [] }
    });
    assert.equal(emptyGrant.statusCode, 400);
    assert.equal(emptyGrant.json().code, 'INVALID_REQUEST');
    assert.equal(emptyGrant.json().message, 'Choose at least one requested tool set.');

    const consent = await app.inject({
      method: 'POST', url: `/agentic-workflows/mcp/oauth/authorize-request/${authorization.json().request_id}/decision`,
      headers: sessionHeaders, payload: { approved: true, projectId: 'mcp-p-a', scopes: ['knowledge', 'actions'] }
    });
    assert.equal(consent.statusCode, 200, consent.body);
    const callback = new URL(consent.json().redirect_to);
    assert.equal(callback.origin, 'https://client.example.test');
    assert.equal(callback.searchParams.get('state'), state);
    const authorizationCode = callback.searchParams.get('code');
    assert.ok(authorizationCode);

    const postForm = (url, fields) => app.inject({
      method: 'POST', url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(fields).toString()
    });
    const tokenEndpoint = '/agentic-workflows/mcp/oauth/token';
    const tokenParams = {
      grant_type: 'authorization_code', code: authorizationCode,
      client_id: client.client_id, redirect_uri: client.redirect_uris[0],
      code_verifier: codeVerifier, resource
    };
    const wrongResource = await postForm(tokenEndpoint, { ...tokenParams, resource: 'https://elsewhere.example/mcp' });
    assert.equal(wrongResource.statusCode, 400);
    assert.equal(wrongResource.json().error, 'invalid_grant');
    const wrongVerifier = await postForm(tokenEndpoint, { ...tokenParams, code_verifier: `${codeVerifier}x` });
    assert.equal(wrongVerifier.statusCode, 400);
    assert.equal(wrongVerifier.json().error, 'invalid_grant');
    const duplicateFields = await app.inject({
      method: 'POST', url: tokenEndpoint,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `grant_type=authorization_code&grant_type=client_credentials`
    });
    assert.equal(duplicateFields.statusCode, 400);

    const exchanged = await postForm(tokenEndpoint, tokenParams);
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    assert.equal(exchanged.headers['cache-control'], 'no-store');
    const token = exchanged.json();
    assert.deepEqual(token.scope.split(' '), ['knowledge', 'records', 'actions']);
    assert.equal(token.resource, resource);
    const actor = await require('@hellotest/mcp/backend/auth').authenticate(token.access_token);
    assert.equal(actor.user.id, 'mcp-a');
    assert.equal(actor.projectId, 'mcp-p-a');
    assert.deepEqual(actor.scopes, ['knowledge', 'records', 'actions']);

    const mcpResponse = await app.inject({
      method: 'POST', url: '/mcp',
      headers: {
        host: 'localhost', authorization: `Bearer ${token.access_token}`,
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list'
      },
      payload: { jsonrpc: '2.0', id: 'oauth-fixture', method: 'tools/list', params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {}
      } } }
    });
    assert.equal(mcpResponse.statusCode, 200, mcpResponse.body);
    assert.ok(mcpResponse.body.includes('hellotest_context_build'));

    const replay = await postForm(tokenEndpoint, tokenParams);
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().error, 'invalid_grant');

    const revoke = await postForm('/agentic-workflows/mcp/oauth/revoke', {
      token: token.access_token, token_type_hint: 'access_token', client_id: client.client_id
    });
    assert.equal(revoke.statusCode, 200, revoke.body);
    await assert.rejects(require('@hellotest/mcp/backend/auth').authenticate(token.access_token), { statusCode: 401 });

    const deniedState = randomBytes(24).toString('base64url');
    const deniedRequest = await app.inject({
      method: 'POST', url: '/agentic-workflows/mcp/oauth/authorize-request', headers: sessionHeaders,
      payload: { ...authorizationParams, state: deniedState }
    });
    assert.equal(deniedRequest.statusCode, 200, deniedRequest.body);
    const denied = await app.inject({
      method: 'POST', url: `/agentic-workflows/mcp/oauth/authorize-request/${deniedRequest.json().request_id}/decision`,
      headers: sessionHeaders, payload: { approved: false }
    });
    assert.equal(denied.statusCode, 200, denied.body);
    const denialCallback = new URL(denied.json().redirect_to);
    assert.equal(denialCallback.searchParams.get('error'), 'access_denied');
    assert.equal(denialCallback.searchParams.get('state'), deniedState);
  } finally {
    if (previousFlag === undefined) delete process.env.HELLOTEST_MCP_OAUTH_ENABLED;
    else process.env.HELLOTEST_MCP_OAUTH_ENABLED = previousFlag;
  }
}

module.exports = { verify };
