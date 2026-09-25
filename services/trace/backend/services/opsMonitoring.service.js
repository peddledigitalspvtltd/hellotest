const { readBoundedResponseJson } = require('@hellotest/platform/backend/src/utils/boundedResponse');

const METRICS = [
  ['request_rate', 'API requests / second', 'req/s', 'sum(rate(hellotest_http_requests_total[5m]))'],
  ['latency', 'API p95 latency', 's', 'histogram_quantile(0.95, sum by (le) (rate(hellotest_http_request_duration_seconds_bucket[5m])))'],
  ['errors', 'API server errors', '%', '100 * sum(rate(hellotest_http_requests_total{status_class="5xx"}[5m])) / clamp_min(sum(rate(hellotest_http_requests_total[5m])), 0.001)'],
  ['memory', 'API memory', 'MiB', 'sum(hellotest_process_memory_bytes{type="rss"}) / 1048576'],
  ['running', 'Runs in progress', '', 'sum(hellotest_runs_running)'],
  ['queued', 'Runs queued', '', 'sum(hellotest_runs_queued)']
];
const SECTIONS = new Set(['dashboard', 'logs', 'alerts']);
const sanitize = value => String(value ?? '')
  .replace(/((?:authorization|cookie|set-cookie|password|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:bearer\s+)?[^,\s}]+)/gi, '$1[REDACTED]')
  .replace(/(\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]+:)[^@\s]+@/gi, '$1[REDACTED]@')
  .replace(/\bBearer\s+[a-z\d._~+/-]+=*/gi, 'Bearer [REDACTED]')
  .slice(0, 4000);

function createReader({ fetchImpl = fetch, environment = process.env, now = Date.now } = {}) {
  // Three fixed cache keys and coalesced requests bound load across projects/users.
  const cache = new Map();
  const pending = new Map();
  async function readJson(base, path) {
    const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Monitoring backend unavailable');
    }
    return readBoundedResponseJson(response, { maxBytes: 512 * 1024, label: 'Monitoring response' });
  }
  const prometheus = path => readJson(environment.OPS_PROMETHEUS_URL || 'http://hellotest-ops-prometheus:9090', path);
  async function collect(section) {
    if (section === 'dashboard') {
      const expression = METRICS.map(([id, , , query]) => `label_replace((${query}), "metric", "${id}", "", "")`).join(' or ');
      const [metrics, services] = await Promise.all([
        prometheus(`/api/v1/query?query=${encodeURIComponent(expression)}`),
        prometheus('/api/v1/query?query=up')
      ]);
      if (metrics?.status !== 'success' || services?.status !== 'success') throw new Error('Invalid metrics response');
      return {
        metrics: METRICS.map(([id, label, unit]) => {
          const sample = metrics.data?.result?.find(item => item.metric?.metric === id)?.value?.[1];
          return { id, label, unit, value: sample != null && Number.isFinite(Number(sample)) ? Number(sample) : null };
        }),
        services: (services.data?.result || []).slice(0, 50).map(item => ({ name: sanitize(item.metric?.job), available: item.value?.[1] === '1' }))
      };
    }
    if (section === 'logs') {
      const params = new URLSearchParams({ query: '{container=~"hellotest.*|local-run-testengine.*"}', limit: '100', direction: 'backward', since: '15m' });
      const data = await readJson(environment.OPS_LOKI_URL || 'http://hellotest-ops-loki:3100', `/loki/api/v1/query_range?${params}`);
      if (data?.status !== 'success' || !Array.isArray(data.data?.result)) throw new Error('Invalid logs response');
      const logs = data.data.result.flatMap(stream => (stream.values || []).map(([timestamp, line]) => ({
        timestamp: String(timestamp), time: new Date(Number(BigInt(timestamp) / 1000000n)).toISOString(),
        container: sanitize(stream.stream?.container), message: sanitize(line)
      }))).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100);
      return { logs, limit: 100, window: '15 minutes' };
    }
    const data = await readJson(environment.OPS_ALERTMANAGER_URL || 'http://hellotest-ops-alertmanager:9093', '/api/v2/alerts');
    if (!Array.isArray(data)) throw new Error('Invalid alerts response');
    return { alerts: data.slice(0, 100).map(alert => ({
      id: sanitize(alert.fingerprint), name: sanitize(alert.labels?.alertname), severity: sanitize(alert.labels?.severity || 'info'),
      state: sanitize(alert.status?.state), summary: sanitize(alert.annotations?.summary),
      description: sanitize(alert.annotations?.description), starts_at: alert.startsAt
    })), limit: 100 };
  }
  return async function snapshot(section) {
    if (!SECTIONS.has(section)) { const error = new Error('Unknown monitoring section'); error.statusCode = 400; throw error; }
    const existing = cache.get(section);
    if (existing && now() < existing.expires) return existing.data;
    if (pending.has(section)) return pending.get(section);
    const promise = (async () => {
      const enabled = environment.OPS_MONITORING_ENABLED === 'true';
      let data = { section, checked_at: new Date(now()).toISOString(), state: enabled ? 'available' : 'not_configured' };
      if (enabled) {
        try { data = { ...data, ...await collect(section) }; }
        catch { data.state = 'unavailable'; }
      }
      cache.set(section, { data, expires: now() + 15000 });
      return data;
    })();
    pending.set(section, promise);
    try { return await promise; } finally { pending.delete(section); }
  };
}

module.exports = { createReader, snapshot: createReader() };
