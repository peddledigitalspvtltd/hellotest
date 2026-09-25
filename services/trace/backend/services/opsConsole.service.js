const { readBoundedResponseJson } = require('@hellotest/platform/backend/src/utils/boundedResponse');
const definitions = {
  traces: { name: 'Distributed traces', variable: 'OPS_JAEGER_URL', origin: 'http://hellotest-ops-jaeger:16686', health: 'api/services' },
  alerts: { name: 'Alertmanager', variable: 'OPS_ALERTMANAGER_URL', origin: 'http://hellotest-ops-alertmanager:9093', health: 'api/v2/status' }
};
const failure = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode, publicMessage: message });
function definition(provider) {
  if (!Object.hasOwn(definitions, provider)) throw failure('Unknown monitoring console.', 404);
  return definitions[provider];
}
function allowedPath(provider, path) {
  definition(provider);
  if (typeof path !== 'string' || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return false;
  if (provider === 'alerts') return /^(?:|script\.js|favicon\.ico|lib\/[a-zA-Z0-9_./-]+|api\/v2\/(?:status|receivers|alerts(?:\/groups)?|silences|silence\/[a-zA-Z0-9-]+))$/.test(path);
  return /^(?:|search|dependencies|deep-dependencies|monitor|quality-metrics|trace\/(?:[a-fA-F0-9]+|compare)|static\/[a-zA-Z0-9_./-]+|api\/(?:v3\/)?(?:trace-summaries|services(?:\/[^/]+\/operations)?|operations|traces(?:\/[a-fA-F0-9]+)?|dependencies|metrics\/[a-zA-Z0-9_/-]+))$/.test(path);
}
const prefix = provider => { definition(provider); return `/api/ops-telemetry/console/${provider}`; };
const cookie = provider => { definition(provider); return `hellotest_ops_${provider}`; };
function createGateway({ fetchImpl = fetch, environment = process.env } = {}) {
  const request = async ({ provider, path, query, signal }) => {
    const config = definition(provider);
    if (environment.OPS_MONITORING_ENABLED !== 'true') throw failure('Monitoring is disabled for this deployment.');
    if (!allowedPath(provider, path)) throw failure('This console supports read-only inspection. This operation is not available.', 403);
    const url = new URL(path, (environment[config.variable] || config.origin).replace(/\/$/, '') + '/');
    for (const [key, value] of Object.entries(query || {})) {
      if (key === 'project_id') continue;
      for (const item of (Array.isArray(value) ? value.slice(0, 20) : [value])) if (typeof item === 'string') url.searchParams.append(key, item);
    }
    // No browser Authorization, cookies, arbitrary destination, or write methods are forwarded.
    return fetchImpl(url, { method: 'GET', signal, redirect: 'manual' });
  };
  const ready = async provider => {
    const config = definition(provider);
    try {
      const response = await request({ provider, path: config.health, signal: AbortSignal.timeout(5000) });
      if (!response.ok) { await response.body?.cancel(); throw failure(`${config.name} is unavailable. Reconnect to retry.`); }
      return await readBoundedResponseJson(response, { maxBytes: 256 * 1024 });
    } catch (error) {
      if (error.statusCode) throw error;
      throw failure(`${config.name} is unavailable. Reconnect to retry.`);
    }
  };
  return { request, ready };
}
module.exports = { definition, allowedPath, prefix, cookie, createGateway, gateway: createGateway() };
