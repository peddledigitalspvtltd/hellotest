'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const auth = require('./auth');
const toolSets = require('./toolSets');
const policy = require('./externalCredentialPolicy');

const AUTHORIZATION_TTL_SECONDS = 5 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const MAX_REDIRECT_URIS = 10;
const MAX_SCOPE_COUNT = toolSets.SET_IDS.length;
const registrationBuckets = new Map();

const error = (code, message, statusCode = 400) => Object.assign(new Error(message), {
  code, statusCode, publicMessage: message
});

const originOf = value => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
};

function publicAddresses(req, mcpPublicUrl) {
  const configuredApp = originOf(process.env.HELLOTEST_PUBLIC_URL);
  const configuredMcp = originOf(mcpPublicUrl);
  const requestOrigin = originOf(`${req.protocol}://${req.hostname}`);
  const issuer = configuredApp || configuredMcp || requestOrigin;
  if (!issuer) throw error('MCP_OAUTH_CONFIGURATION_INVALID', 'Configure a valid public HelloTest URL before enabling MCP OAuth.', 503);
  const resource = mcpPublicUrl || `${issuer}/api/mcp`;
  const apiBase = resource.replace(/\/mcp\/?$/, '');
  return {
    issuer,
    resource,
    authorizationEndpoint: `${issuer}/mcp/oauth/authorize`,
    tokenEndpoint: `${apiBase}/agentic-workflows/mcp/oauth/token`,
    registrationEndpoint: `${apiBase}/agentic-workflows/mcp/oauth/register`,
    revocationEndpoint: `${apiBase}/agentic-workflows/mcp/oauth/revoke`,
    authorizationMetadata: `${issuer}/.well-known/oauth-authorization-server`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource`
  };
}

function verifyEnabled() {
  if (!policy.oauthEnabled()) throw policy.unavailable();
}

function normalizeRedirectUri(value) {
  if (typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw error('invalid_redirect_uri', 'Register an absolute redirect URI without control characters.');
  }
  let url;
  try { url = new URL(value); }
  catch { throw error('invalid_redirect_uri', 'Register an absolute redirect URI.'); }
  if (url.username || url.password || url.hash) throw error('invalid_redirect_uri', 'Redirect URIs cannot include credentials or a fragment.');
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
      throw error('invalid_redirect_uri', 'Use HTTPS, or HTTP on a loopback address for a local native client.');
    }
  } else if (url.protocol !== 'https:') {
    const scheme = url.protocol.slice(0, -1);
    if (!/^[a-z][a-z0-9+.-]{1,31}$/i.test(scheme) || ['javascript', 'data', 'file', 'ftp'].includes(scheme.toLowerCase())) {
      throw error('invalid_redirect_uri', 'Use HTTPS, a loopback URI, or a registered native-app URI scheme.');
    }
  }
  return value;
}

function allowRegistration(address, now = Date.now()) {
  const key = String(address || 'unknown').slice(0, 100);
  const current = registrationBuckets.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= 60 * 60_000) {
    current.startedAt = now;
    current.count = 0;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  registrationBuckets.set(key, current);
  if (registrationBuckets.size > 4_096) {
    for (const [id, bucket] of registrationBuckets) {
      if (now - bucket.startedAt >= 60 * 60_000 || registrationBuckets.size > 4_096) registrationBuckets.delete(id);
    }
  }
  return true;
}

function authServerMetadata(req, mcpPublicUrl) {
  const addresses = publicAddresses(req, mcpPublicUrl);
  return {
    issuer: addresses.issuer,
    authorization_endpoint: addresses.authorizationEndpoint,
    token_endpoint: addresses.tokenEndpoint,
    registration_endpoint: addresses.registrationEndpoint,
    revocation_endpoint: addresses.revocationEndpoint,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...toolSets.SET_IDS],
    client_id_metadata_document_supported: false
  };
}

function resourceMetadata(req, mcpPublicUrl) {
  const addresses = publicAddresses(req, mcpPublicUrl);
  return {
    resource: addresses.resource,
    authorization_servers: [addresses.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...toolSets.SET_IDS],
    resource_documentation: `${addresses.issuer}/agentic-workflows`
  };
}

function registrationResponse(client) {
  const native = client.redirect_uris.some(uri => {
    const protocol = new URL(uri).protocol;
    return protocol !== 'https:';
  });
  return {
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: native ? 'native' : 'web',
    client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000)
  };
}

async function registerClient(input, { address } = {}) {
  verifyEnabled();
  if (!allowRegistration(address)) throw error('too_many_requests', 'Client registration is temporarily rate limited.', 429);
  const clientName = typeof input?.client_name === 'string' ? input.client_name.trim() : '';
  if (!clientName || clientName.length > 120 || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw error('invalid_client_metadata', 'Provide a client name between 1 and 120 characters.');
  }
  if (input?.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none') {
    throw error('invalid_client_metadata', 'HelloTest supports public MCP clients with PKCE and no client secret.');
  }
  if (input?.grant_types !== undefined && (!Array.isArray(input.grant_types) || input.grant_types.length !== 1 || input.grant_types[0] !== 'authorization_code')) {
    throw error('invalid_client_metadata', 'Only the authorization_code grant is supported.');
  }
  if (input?.response_types !== undefined && (!Array.isArray(input.response_types) || input.response_types.length !== 1 || input.response_types[0] !== 'code')) {
    throw error('invalid_client_metadata', 'Only the code response type is supported.');
  }
  if (!Array.isArray(input?.redirect_uris) || !input.redirect_uris.length || input.redirect_uris.length > MAX_REDIRECT_URIS) {
    throw error('invalid_redirect_uri', `Register between 1 and ${MAX_REDIRECT_URIS} redirect URIs.`);
  }
  const redirectUris = [...new Set(input.redirect_uris.map(normalizeRedirectUri))];
  const client = {
    client_id: randomUUID(), client_name: clientName, redirect_uris: redirectUris,
    created_at: new Date().toISOString()
  };
  await db.prepare(`INSERT INTO mcp_oauth_clients(client_id,client_name,redirect_uris)
    VALUES (?,?,?::jsonb)`).run(client.client_id, client.client_name, JSON.stringify(redirectUris));
  return registrationResponse(client);
}

function normalizeAuthorizationInput(input, addresses) {
  if (input?.response_type !== 'code') throw error('unsupported_response_type', 'Only the authorization code flow is supported.');
  const clientId = typeof input.client_id === 'string' ? input.client_id : '';
  const redirectUri = normalizeRedirectUri(input.redirect_uri);
  const state = typeof input.state === 'string' ? input.state : '';
  if (!clientId || clientId.length > 128) throw error('invalid_client', 'The OAuth client is not registered.');
  if (!state || state.length > 512 || /[\u0000-\u001f\u007f]/.test(state)) throw error('invalid_request', 'Include a valid OAuth state value.');
  if (input.code_challenge_method !== 'S256' || typeof input.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge)) {
    throw error('invalid_request', 'A PKCE S256 code challenge is required.');
  }
  if (input.resource !== addresses.resource) throw error('invalid_target', 'The authorization request must name this HelloTest MCP resource.');
  let scopes;
  try {
    const requested = input.scope === undefined
      ? [...toolSets.DEFAULT_SCOPES]
      : typeof input.scope === 'string' && input.scope.trim()
        ? input.scope.trim().split(/\s+/)
        : (() => { throw new Error('scope must be a non-empty string'); })();
    if (requested.length > MAX_SCOPE_COUNT) throw new Error('too many scopes');
    scopes = toolSets.normalizeScopes(requested);
  } catch {
    throw error('invalid_scope', `Choose MCP tool sets from: ${toolSets.SET_IDS.join(', ')}.`);
  }
  return { clientId, redirectUri, state, codeChallenge: input.code_challenge, resource: addresses.resource, scopes };
}

async function createAuthorizationRequest(user, input, addresses) {
  verifyEnabled();
  const normalized = normalizeAuthorizationInput(input, addresses);
  const client = await db.prepare('SELECT client_id,client_name,redirect_uris FROM mcp_oauth_clients WHERE client_id=?').get(normalized.clientId);
  if (!client || !client.redirect_uris.includes(normalized.redirectUri)) throw error('invalid_client', 'The client or redirect URI is not registered.');
  const previous = await db.prepare(`SELECT id,expires_at FROM mcp_oauth_authorization_requests
    WHERE user_id=? AND client_id=? AND redirect_uri=? AND state=? AND code_challenge=?
      AND scopes=?::jsonb AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`).get(
    user.id, client.client_id, normalized.redirectUri, normalized.state, normalized.codeChallenge, JSON.stringify(normalized.scopes));
  if (previous) return {
    request_id: previous.id, client_name: client.client_name, redirect_uri: normalized.redirectUri,
    resource: normalized.resource, scopes: normalized.scopes, expires_at: previous.expires_at
  };
  const outstanding = await db.prepare(`SELECT COUNT(*)::INTEGER AS count FROM mcp_oauth_authorization_requests
    WHERE user_id=? AND consumed_at IS NULL AND expires_at>NOW()`).get(user.id);
  if (Number(outstanding?.count || 0) >= 30) throw error('too_many_requests', 'Finish or cancel an existing MCP authorization request first.', 429);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_SECONDS * 1000).toISOString();
  await db.prepare(`DELETE FROM mcp_oauth_authorization_requests WHERE expires_at < NOW() OR consumed_at IS NOT NULL`).run();
  await db.prepare(`INSERT INTO mcp_oauth_authorization_requests
    (id,client_id,user_id,redirect_uri,resource,scopes,code_challenge,code_challenge_method,state,expires_at)
    VALUES (?,?,?,?,?,?::jsonb,?,'S256',?,?)`).run(id, client.client_id, user.id, normalized.redirectUri,
    normalized.resource, JSON.stringify(normalized.scopes), normalized.codeChallenge, normalized.state, expiresAt);
  return {
    request_id: id, client_name: client.client_name, redirect_uri: normalized.redirectUri,
    resource: normalized.resource, scopes: normalized.scopes, expires_at: expiresAt
  };
}

function redirectWithError(redirectUri, code, state) {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('error', code);
  redirect.searchParams.set('state', state);
  return redirect.href;
}

async function decideAuthorization({ user, requestId, approved, projectId, scopes = [] }) {
  verifyEnabled();
  if (typeof approved !== 'boolean') throw error('invalid_request', 'Choose whether to approve or deny this request.');
  const request = await db.prepare(`SELECT * FROM mcp_oauth_authorization_requests
    WHERE id=? AND user_id=? AND consumed_at IS NULL AND expires_at>NOW()`).get(requestId, user.id);
  if (!request) throw error('invalid_request', 'This authorization request expired or was already used.', 410);
  if (!approved) {
    await db.prepare('UPDATE mcp_oauth_authorization_requests SET consumed_at=NOW() WHERE id=? AND consumed_at IS NULL').run(requestId);
    return { redirect_to: redirectWithError(request.redirect_uri, 'access_denied', request.state) };
  }
  const requested = Array.isArray(request.scopes) ? request.scopes : [];
  const grantedInput = scopes === undefined ? requested : scopes;
  if (!Array.isArray(grantedInput) || !grantedInput.length) throw error('invalid_scope', 'Choose at least one requested tool set.');
  if (grantedInput.some(scope => !requested.includes(scope))) throw error('invalid_scope', 'You can only grant tool sets requested by this client.');
  let granted;
  try { granted = toolSets.normalizeScopes(grantedInput); }
  catch { throw error('invalid_scope', 'Choose valid MCP tool sets.'); }
  if (granted.some(scope => !requested.includes(scope))) throw error('invalid_scope', 'The requested scopes do not include the prerequisite tool set.');
  const actor = await auth.principal(user.id, projectId, request.client_id);
  await auth.permit(actor, 'project.view');

  const code = randomBytes(32).toString('base64url');
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
  await db.transaction(async () => {
    const locked = await db.prepare(`SELECT id FROM mcp_oauth_authorization_requests
      WHERE id=? AND user_id=? AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`).get(requestId, user.id);
    if (!locked) throw error('invalid_request', 'This authorization request expired or was already used.', 410);
    await db.prepare(`INSERT INTO mcp_oauth_codes
      (code_hash,client_id,user_id,project_id,redirect_uri,resource,scopes,code_challenge,expires_at)
      VALUES (?,?,?,?,?,?,?::jsonb,?,?)`).run(codeHash, request.client_id, user.id, projectId,
      request.redirect_uri, request.resource, JSON.stringify(granted), request.code_challenge, expiresAt);
    await db.prepare('UPDATE mcp_oauth_authorization_requests SET consumed_at=NOW() WHERE id=?').run(requestId);
  })();
  const redirect = new URL(request.redirect_uri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', request.state);
  return { redirect_to: redirect.href };
}

const sha256Base64Url = value => createHash('sha256').update(value).digest('base64url');
const sha256Hex = value => createHash('sha256').update(value).digest('hex');

async function exchangeAuthorizationCode(input) {
  verifyEnabled();
  if (input.grant_type !== 'authorization_code') throw error('unsupported_grant_type', 'Only authorization_code is supported.');
  const { code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier } = input;
  if (typeof code !== 'string' || code.length < 32 || code.length > 256 || typeof clientId !== 'string') {
    throw error('invalid_grant', 'The authorization code is invalid or expired.');
  }
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) {
    throw error('invalid_grant', 'The PKCE verifier is invalid.');
  }
  const codeHash = sha256Hex(code);
  const row = await db.transaction(async () => {
    const current = await db.prepare(`SELECT * FROM mcp_oauth_codes
      WHERE code_hash=? AND client_id=? AND redirect_uri=? AND consumed_at IS NULL AND expires_at>NOW()
      FOR UPDATE`).get(codeHash, clientId, redirectUri);
    if (!current || input.resource !== current.resource || sha256Base64Url(verifier) !== current.code_challenge) throw error('invalid_grant', 'The authorization code, resource or PKCE verifier is invalid.');
    await db.prepare('UPDATE mcp_oauth_codes SET consumed_at=NOW() WHERE code_hash=?').run(codeHash);
    return current;
  })();
  const scopes = Array.isArray(row.scopes) ? row.scopes : [...toolSets.DEFAULT_SCOPES];
  const issued = await auth.issue({ id: row.user_id }, row.project_id, clientId, {
    scopes, clientKey: auth.clientKeyFor(row.user_id, row.project_id, clientId), ttlSeconds: 3600
  });
  return {
    access_token: issued.token, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((Date.parse(issued.expires_at) - Date.now()) / 1000)),
    scope: scopes.join(' '), resource: row.resource, project_id: row.project_id
  };
}

async function revokeToken(input) {
  verifyEnabled();
  if (input.token_type_hint && input.token_type_hint !== 'access_token') return {};
  if (typeof input.token !== 'string') return {};
  try {
    const claims = auth.decode(input.token);
    if (claims.client_id !== input.client_id) return {};
    const client = await db.prepare('SELECT client_id FROM mcp_oauth_clients WHERE client_id=?').get(input.client_id);
    if (!client) return {};
    await db.prepare(`UPDATE mcp_credentials SET revoked_at=NOW()
      WHERE id=? AND client_id=? AND user_id=? AND project_id=? AND internal=FALSE AND revoked_at IS NULL`)
      .run(claims.jti, input.client_id, claims.sub, claims.project_id);
  } catch { /* RFC 7009 deliberately does not distinguish an invalid token. */ }
  return {};
}

function registerOAuthRoutes(app, { mcpPublicUrl } = {}) {
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      const params = new URLSearchParams(body);
      const result = {};
      for (const [key, value] of params) {
        if (Object.hasOwn(result, key)) return done(error('invalid_request', 'OAuth form fields must not be repeated.'));
        result[key] = value;
      }
      done(null, result);
    });
  }
  app.get('/mcp/oauth/authorization-server-metadata', async req => authServerMetadata(req, mcpPublicUrl));
  app.get('/mcp/oauth/resource-metadata', async req => resourceMetadata(req, mcpPublicUrl));
  app.post('/agentic-workflows/mcp/oauth/register', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try { return reply.code(201).send(await registerClient(req.body, { address: req.ip })); }
    catch (failure) {
      return reply.code(failure.statusCode || 400).send({
        error: failure.code || 'invalid_client_metadata', error_description: failure.publicMessage || 'The OAuth client could not be registered.'
      });
    }
  });
  app.post('/agentic-workflows/mcp/oauth/authorize-request', async req => {
    await app.authenticate(req);
    if (req.apiKey) throw error('invalid_request', 'Authorize MCP access from a signed-in browser session.', 403);
    const addresses = publicAddresses(req, mcpPublicUrl);
    return createAuthorizationRequest(req.user, req.body, addresses);
  });
  app.post('/agentic-workflows/mcp/oauth/authorize-request/:id/decision', async req => {
    await app.authenticate(req);
    if (req.apiKey) throw error('invalid_request', 'Authorize MCP access from a signed-in browser session.', 403);
    return decideAuthorization({ user: req.user, requestId: req.params.id, ...req.body });
  });
  app.post('/agentic-workflows/mcp/oauth/token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    try { return await exchangeAuthorizationCode(req.body || {}); }
    catch (failure) {
      return reply.code(failure.statusCode || 400).send({
        error: failure.code || 'invalid_request', error_description: failure.publicMessage || 'The OAuth request could not be completed.'
      });
    }
  });
  app.post('/agentic-workflows/mcp/oauth/revoke', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    return revokeToken(req.body || {});
  });
}

module.exports = {
  AUTHORIZATION_CODE_TTL_SECONDS,
  AUTHORIZATION_TTL_SECONDS,
  authServerMetadata,
  createAuthorizationRequest,
  decideAuthorization,
  exchangeAuthorizationCode,
  normalizeAuthorizationInput,
  normalizeRedirectUri,
  publicAddresses,
  registerClient,
  registerOAuthRoutes,
  resourceMetadata,
  revokeToken,
  sha256Base64Url
};
