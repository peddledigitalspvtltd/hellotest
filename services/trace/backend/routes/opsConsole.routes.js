const projectService = require('@hellotest/platform/backend/public/projectAccess');
const session = require('../services/opsGrafana.service');
const consoleService = require('../services/opsConsole.service');
const { Readable, Transform } = require('node:stream');
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode, publicMessage: message });

module.exports = async function (fastify) {
  fastify.post('/ops-telemetry/console-session/:provider', { bodyLimit: 4096, preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    const { provider } = req.params;
    consoleService.definition(provider);
    const projectId = req.body?.project_id;
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 128 || !req.headers.authorization?.startsWith('Bearer ') || req.authMethod === 'api_key') throw fail('A signed-in administrator and project are required.', 403);
    await projectService.getProject(projectId, req.user.id);
    const readiness = await consoleService.gateway.ready(provider);
    const token = session.sealSession({ console: provider, user_id: req.user.id, project_id: projectId, authorization: req.headers.authorization });
    const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    reply.header('cache-control', 'no-store').header('set-cookie', `${consoleService.cookie(provider)}=${token}; Path=${consoleService.prefix(provider)}/; HttpOnly; SameSite=Strict; Max-Age=${session.TTL / 1000}${secure ? '; Secure' : ''}`);
    const services = provider === 'traces' && Array.isArray(readiness?.data) ? readiness.data.filter(value => typeof value === 'string') : [];
    const service = services.includes('hellotest-api') ? 'hellotest-api' : services[0];
    const destination = provider === 'alerts' ? '#/alerts' : `search${service ? `?service=${encodeURIComponent(service)}&lookback=1h&limit=20` : ''}`;
    return { url: `${consoleService.prefix(provider)}/${destination}`, expires_at: new Date(Date.now() + session.TTL).toISOString() };
  });
  const authorize = async req => {
    const { provider } = req.params;
    const name = consoleService.cookie(provider);
    if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site console access is not allowed.', 403);
    const token = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    let capability;
    try { capability = session.openSession(token); } catch { throw fail('Console session expired. Use Reconnect to retry.', 401); }
    if (capability.console !== provider) throw fail('Console session mismatch.', 403);
    req.headers.authorization = capability.authorization;
    req.query.project_id = capability.project_id;
    await fastify.requireAdmin(req);
    if (req.user.id !== capability.user_id) throw fail('Console session mismatch.', 403);
    await projectService.getProject(capability.project_id, req.user.id);
  };
  fastify.get('/ops-telemetry/console/:provider/*', { preHandler: [authorize] }, async (req, reply) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const cleanup = () => { clearTimeout(timeout); controller.abort(); };
    reply.raw.once('close', cleanup);
    try {
      const upstream = await consoleService.gateway.request({ provider: req.params.provider, path: req.params['*'], query: req.query, signal: controller.signal });
      if (!upstream.ok) { await upstream.body?.cancel(); throw fail('The console is temporarily unavailable. Use Reconnect to retry.', 502); }
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
        .header('x-frame-options', 'SAMEORIGIN').header('content-security-policy', "frame-ancestors 'self'")
        .header('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
      // Stream large console bundles rather than buffering them per visitor.
      let bytes = 0;
      const source = Readable.fromWeb(upstream.body);
      const bounded = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > 20 * 1024 * 1024 ? new Error('Console response exceeded its limit') : null, chunk);
      } });
      source.once('error', error => bounded.destroy(error));
      bounded.once('close', () => { source.destroy(); cleanup(); });
      return reply.send(source.pipe(bounded));
    } catch (error) { cleanup(); reply.raw.off('close', cleanup); throw error.statusCode ? error : fail('The console is temporarily unavailable. Use Reconnect to retry.', 502); }
  });
};
