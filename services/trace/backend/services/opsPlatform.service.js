const COMPONENTS = [
  ['haproxy', 'Traffic gateway', 'http://hellotest-ops-haproxy:8404/health', 64],
  ['prometheus', 'Metrics', 'http://hellotest-ops-prometheus:9090/-/ready', 256],
  ['grafana', 'Dashboards', 'http://hellotest-ops-grafana:3000/api/ops-telemetry/grafana/api/health', 256],
  ['loki', 'Log storage', 'http://hellotest-ops-loki:3100/ready', 384],
  ['jaeger', 'Trace storage', 'http://hellotest-ops-jaeger:13133/status', 256],
  ['alloy', 'Container log collection', 'http://hellotest-ops-alloy:12345/-/ready', 192],
  ['otel-collector', 'Application telemetry', 'http://hellotest-ops-otel-collector:13133/', 256],
  ['alertmanager', 'Alert routing', 'http://hellotest-ops-alertmanager:9093/-/ready', 64]
];

function createMonitor({ fetchImpl = fetch, environment = process.env, now = Date.now } = {}) {
  let cached;
  let expires = 0;
  let pending;
  return async function snapshot() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const enabled = environment.OPS_MONITORING_ENABLED === 'true';
      const items = [];
      // At most four outstanding sockets; each component has its own deadline.
      for (let offset = 0; offset < COMPONENTS.length; offset += 4) {
        items.push(...await Promise.all(COMPONENTS.slice(offset, offset + 4).map(async ([id, purpose, endpoint, memory]) => {
          const item = { id, purpose, state: 'not_configured', memory_limit_mib: memory };
          if (!enabled) return item;
          const start = now();
          try {
            const configured = environment[`OPS_${id.toUpperCase().replaceAll('-', '_')}_HEALTH_URL`] || endpoint;
            const response = await fetchImpl(configured, { signal: AbortSignal.timeout(1500), redirect: 'error' });
            item.state = response.ok ? 'available' : 'unavailable';
            await response.body?.cancel().catch(() => {});
          } catch { item.state = 'unavailable'; }
          item.latency_ms = Math.max(0, now() - start);
          return item;
        })));
      }
      cached = {
        checked_at: new Date(now()).toISOString(), enabled,
        state: !enabled ? 'not_configured' : items.every(item => item.state === 'available') ? 'available' : 'degraded',
        components: items,
        policy: { metrics_retention: '2 days / 256 MB', logs_retention: '24 hours', trace_capacity: '2,000 recent traces', telemetry_queue: '4 MB per exporter; drops on prolonged outage' }
      };
      expires = now() + 30000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
module.exports = { createMonitor, snapshot: createMonitor() };
