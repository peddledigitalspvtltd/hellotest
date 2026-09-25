const crypto = require('node:crypto');
const { resolveSessionSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const { readBoundedResponseJson } = require('@hellotest/platform/backend/src/utils/boundedResponse');

const PREFIX = '/api/ops-telemetry/grafana';
const COOKIE = 'hellotest_grafana';
const TTL = 15 * 60 * 1000;
const VIEWER = 'hellotest-embedded-viewer';
const EMAIL = 'hellotest-embedded-viewer@localhost.invalid';
const fail = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode, publicMessage: message });
const key = () => crypto.createHash('sha256').update(`ops-grafana:${resolveSessionSecret()}`).digest();

function sealSession(payload, now = Date.now()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...payload, expires: now + TTL })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function openSession(token, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const bytes = Buffer.from(token, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (!value.authorization?.startsWith('Bearer ') || !value.project_id || !value.user_id || value.expires <= now) throw new Error();
    return value;
  } catch { throw fail('Grafana session expired. Reconnect from the Grafana dashboard tab.', 401); }
}

function allowedRequest(method, path) {
  // No user-controlled destinations, traversal, write APIs, or arbitrary proxy routes.
  if (typeof path !== 'string' || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(part => part === '..' || part === '.')) return false;
  if (method === 'POST') return path === 'api/ds/query' || path === 'api/frontend-metrics';
  if (!['GET', 'HEAD'].includes(method)) return false;
  return path === '' || /^d\/hellotest-runtime-overview(?:\/[^/]*)?$/.test(path)
    || /^public\/[a-zA-Z0-9_./-]+$/.test(path)
    || /^(?:api\/(?:health|frontend\/settings|user(?:\/orgs|\/preferences)?|org(?:\/preferences)?|search|annotations|datasources)|api\/dashboards\/(?:home|uid\/hellotest-runtime-overview))$/.test(path)
    || /^api\/folders\/[a-zA-Z0-9_-]+$/.test(path)
    || path === 'api/prometheus/grafana/api/v1/rules'
    || /^api\/datasources\/uid\/(?:prometheus|loki|jaeger)(?:\/health|\/resources\/[a-zA-Z0-9_./-]+)?$/.test(path);
}

function createGateway({ fetchImpl = fetch, environment = process.env, now = Date.now } = {}) {
  let authorization;
  let expires = 0;
  let pending;
  const base = () => (environment.OPS_GRAFANA_URL || 'http://hellotest-ops-grafana:3000').replace(/\/$/, '') + PREFIX;
  const adminAuth = () => {
    if (environment.OPS_MONITORING_ENABLED !== 'true' || !environment.OPS_GRAFANA_PASSWORD) throw fail('Grafana embedding is not configured. Restart the local stack to connect monitoring.');
    return 'Basic ' + Buffer.from(`${environment.OPS_GRAFANA_USER || 'admin'}:${environment.OPS_GRAFANA_PASSWORD}`).toString('base64');
  };
  async function adminRequest(path, method = 'GET', body) {
    const result = await fetchImpl(base() + path, { method, redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: adminAuth(), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await readBoundedResponseJson(result, { maxBytes: 128 * 1024 });
    return { status: result.status, data };
  }
  async function provision() {
    adminAuth();
    // Deterministic per-install secret; no browser credentials or disk token store.
    const password = crypto.createHmac('sha256', environment.OPS_GRAFANA_PASSWORD).update('hellotest-grafana-viewer-v1').digest('base64url');
    let result = await adminRequest(`/api/users/lookup?loginOrEmail=${VIEWER}`);
    if (result.status === 404) {
      const created = await adminRequest('/api/admin/users', 'POST', { name: 'HelloTest embedded dashboard', login: VIEWER, email: EMAIL, password, OrgId: 1 });
      if (![200, 201, 412].includes(created.status)) throw fail('Grafana could not prepare read-only access. Check its configuration and retry.');
      result = await adminRequest(`/api/users/lookup?loginOrEmail=${VIEWER}`);
    }
    const user = result.data;
    if (result.status !== 200 || !Number.isInteger(user?.id) || user.login !== VIEWER || user.email !== EMAIL || user.isGrafanaAdmin) throw fail('Grafana read-only account could not be verified.');
    const membership = await adminRequest(`/api/users/${user.id}/orgs`);
    if (membership.status !== 200 || !Array.isArray(membership.data) || membership.data.length !== 1 || membership.data[0].orgId !== 1 || membership.data[0].role !== 'Viewer') throw fail('Grafana embedded account must have only the Viewer role.');
    const reset = await adminRequest(`/api/admin/users/${user.id}/password`, 'PUT', { password });
    if (reset.status !== 200) throw fail('Grafana read-only credentials could not be refreshed.');
    authorization = 'Basic ' + Buffer.from(`${VIEWER}:${password}`).toString('base64');
    expires = now() + 60 * 60 * 1000;
    return authorization;
  }
  async function ready() {
    if (authorization && now() < expires) return authorization;
    if (!pending) pending = provision();
    try { return await pending; } finally { pending = null; }
  }
  async function request({ method, path, query, body, signal }) {
    if (!allowedRequest(method, path)) throw fail('This Grafana operation is not available in the embedded dashboard.', 403);
    const auth = await ready();
    const target = new URL(`${base()}/${path}`);
    for (const [name, value] of Object.entries(query || {})) if (name !== 'project_id' && typeof value === 'string') target.searchParams.set(name, value);
    if (method === 'POST' && path === 'api/ds/query') {
      if (!Array.isArray(body?.queries) || body.queries.length > 20 || body.queries.some(item => !['prometheus', 'loki', 'jaeger', '-- Mixed --', '__expr__'].includes(item.datasource?.uid))) throw fail('Unsupported dashboard query.', 400);
    }
    const response = await fetchImpl(target, { method, signal, redirect: 'manual', headers: { Authorization: auth, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
    if (response.status === 401) { authorization = null; expires = 0; }
    return response;
  }
  return { ready, request };
}
module.exports = { PREFIX, COOKIE, TTL, sealSession, openSession, allowedRequest, createGateway, gateway: createGateway() };
