const crypto = require("crypto");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");
const fp = require("fastify-plugin");
const { context, trace } = require("@opentelemetry/api");
const db = require("../db");
const obsDb = require("../obsDb");
const { runtimeHealthService } = require("../services/runtimeHealth.service");

const metricsState = {
  inflight: 0,
  aborted: 0,
  seriesOverflow: 0,
  requests: new Map(),
  errors: new Map([
    ["authorization", 0],
    ["capacity", 0],
    ["database", 0],
    ["timeout", 0],
    ["upstream", 0],
    ["internal", 0]
  ])
};

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const parsedSeriesLimit = Number(process.env.OBSERVABILITY_MAX_HTTP_SERIES || 4_096);
const MAX_HTTP_METRIC_SERIES = Number.isFinite(parsedSeriesLimit)
  ? Math.max(256, Math.min(20_000, Math.trunc(parsedSeriesLimit)))
  : 4_096;
const parsedMetricsQueryTimeout = Number(process.env.METRICS_DB_QUERY_TIMEOUT_MS || 1_500);
const METRICS_DB_QUERY_TIMEOUT_MS = Number.isFinite(parsedMetricsQueryTimeout)
  ? Math.max(100, Math.min(10_000, Math.trunc(parsedMetricsQueryTimeout)))
  : 1_500;
const NOISY_LOG_ROUTES = new Set([
  "/health",
  "/health/live",
  "/health/ready",
  "/metrics",
  "/testengine/internal/jobs/lease"
]);
const parsedSampleRate = Number(process.env.NOISY_REQUEST_LOG_SAMPLE_RATE || 0.01);
const NOISY_LOG_SAMPLE_RATE = Number.isFinite(parsedSampleRate)
  ? Math.max(0, Math.min(1, parsedSampleRate))
  : 0.01;
const parsedSlowRequestMs = Number(process.env.SLOW_REQUEST_LOG_MS || 1_000);
const SLOW_REQUEST_MS = Number.isFinite(parsedSlowRequestMs)
  ? Math.max(100, parsedSlowRequestMs)
  : 1_000;

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let previousEventLoopUtilization = performance.eventLoopUtilization();

const formatLabelValue = (value) => {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
};

const getRequestRouteLabel = (request, reply) => {
  if (request.routeOptions?.url) {
    const route = String(request.routeOptions.url);
    return route.length <= 160 ? route : "route_too_long";
  }

  if (request.routerPath) {
    const route = String(request.routerPath);
    return route.length <= 160 ? route : "route_too_long";
  }

  if (reply.statusCode === 404) {
    return "unmatched";
  }

  // Raw paths are user-controlled and can create an unbounded Prometheus label
  // set. Only Fastify's registered route templates are exported.
  return "unknown";
};

const resolveTraceContext = (headerValue) => {
  if (typeof headerValue !== "string") {
    return null;
  }

  const trimmedValue = headerValue.trim();
  const match = TRACEPARENT_PATTERN.exec(trimmedValue);

  if (!match) {
    return null;
  }

  return {
    traceId: match[1].toLowerCase(),
    traceparent: trimmedValue.toLowerCase()
  };
};

const nextTraceContext = (incomingTraceparent) => {
  const activeSpanContext = trace.getSpan(context.active())?.spanContext();
  if (activeSpanContext?.traceId && activeSpanContext?.spanId) {
    const flags = Number(activeSpanContext.traceFlags || 0).toString(16).padStart(2, "0");
    return {
      traceId: activeSpanContext.traceId,
      traceparent: `00-${activeSpanContext.traceId}-${activeSpanContext.spanId}-${flags}`
    };
  }

  const existingContext = resolveTraceContext(incomingTraceparent);
  const traceId = existingContext?.traceId || crypto.randomBytes(16).toString("hex");
  const spanId = crypto.randomBytes(8).toString("hex");

  return {
    traceId,
    traceparent: `00-${traceId}-${spanId}-01`
  };
};

const recordRequestMetric = ({ method, route, statusCode, durationMs }) => {
  let metricMethod = String(method || "UNKNOWN").toUpperCase().slice(0, 16);
  let metricRoute = route;
  let statusClass = `${Math.floor(Number(statusCode) / 100)}xx`;
  let key = `${metricMethod}|${metricRoute}|${statusClass}`;

  if (!metricsState.requests.has(key) && metricsState.requests.size >= MAX_HTTP_METRIC_SERIES) {
    metricsState.seriesOverflow += 1;
    metricMethod = "OVERFLOW";
    metricRoute = "cardinality_overflow";
    statusClass = "other";
    key = `${metricMethod}|${metricRoute}|${statusClass}`;
  }

  const entry = metricsState.requests.get(key) || {
    method: metricMethod,
    route: metricRoute,
    statusClass,
    total: 0,
    durationSecondsSum: 0,
    durationBucketCounts: DURATION_BUCKETS_SECONDS.map(() => 0)
  };

  entry.total += 1;
  const durationSeconds = durationMs / 1000;
  entry.durationSecondsSum += durationSeconds;
  DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
    if (durationSeconds <= bucket) entry.durationBucketCounts[index] += 1;
  });
  metricsState.requests.set(key, entry);
};

const classifyError = (error, statusCode) => {
  const code = String(error?.code || error?.name || "").toUpperCase();
  const status = Number(error?.statusCode || statusCode || 500);
  if ([401, 403].includes(status)) return "authorization";
  if ([429, 503].includes(status) || code.includes("CAPACITY")) return "capacity";
  if (code.includes("TIMEOUT") || code.includes("ABORT")) return "timeout";
  if (/^(?:PG|SQL)|DATABASE|CONNECTION_TERMINATED/.test(code)) return "database";
  if (/UPSTREAM|ECONN|ENOTFOUND|EAI_AGAIN|FETCH/.test(code)) return "upstream";
  return "internal";
};

const recordErrorMetric = (error, statusCode) => {
  const kind = classifyError(error, statusCode);
  metricsState.errors.set(kind, (metricsState.errors.get(kind) || 0) + 1);
};

const numberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readEventLoopMetrics = () => {
  const utilization = performance.eventLoopUtilization(previousEventLoopUtilization);
  previousEventLoopUtilization = performance.eventLoopUtilization();
  const p99Seconds = numberOrZero(eventLoopDelay.percentile(99)) / 1_000_000_000;
  const maxSeconds = numberOrZero(eventLoopDelay.max) / 1_000_000_000;
  eventLoopDelay.reset();
  return {
    utilization: Math.max(0, Math.min(1, numberOrZero(utilization.utilization))),
    p99Seconds,
    maxSeconds
  };
};

const renderMetrics = ({ engineMetrics = null, databasePools = {}, capacityMetrics = null } = {}) => {
  const memoryUsage = process.memoryUsage();
  const eventLoop = readEventLoopMetrics();
  const lines = [
    "# HELP hellotest_http_requests_total Total HTTP requests handled by the API.",
    "# TYPE hellotest_http_requests_total counter"
  ];

  for (const entry of metricsState.requests.values()) {
    const labels = `method="${formatLabelValue(entry.method)}",route="${formatLabelValue(entry.route)}",status_class="${formatLabelValue(entry.statusClass)}"`;
    lines.push(`hellotest_http_requests_total{${labels}} ${entry.total}`);
  }

  lines.push("# HELP hellotest_http_request_duration_seconds HTTP request latency in seconds.");
  lines.push("# TYPE hellotest_http_request_duration_seconds histogram");

  for (const entry of metricsState.requests.values()) {
    const labels = `method="${formatLabelValue(entry.method)}",route="${formatLabelValue(entry.route)}",status_class="${formatLabelValue(entry.statusClass)}"`;
    DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      lines.push(`hellotest_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${entry.durationBucketCounts[index]}`);
    });
    lines.push(`hellotest_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${entry.total}`);
    lines.push(`hellotest_http_request_duration_seconds_sum{${labels}} ${entry.durationSecondsSum.toFixed(6)}`);
    lines.push(`hellotest_http_request_duration_seconds_count{${labels}} ${entry.total}`);
  }

  lines.push("# HELP hellotest_http_requests_inflight Currently active HTTP requests.");
  lines.push("# TYPE hellotest_http_requests_inflight gauge");
  lines.push(`hellotest_http_requests_inflight ${metricsState.inflight}`);

  lines.push("# HELP hellotest_http_requests_aborted_total Requests disconnected before a response completed.");
  lines.push("# TYPE hellotest_http_requests_aborted_total counter");
  lines.push(`hellotest_http_requests_aborted_total ${metricsState.aborted}`);

  lines.push("# HELP hellotest_observability_series_overflow_total New HTTP label sets aggregated after reaching the cardinality budget.");
  lines.push("# TYPE hellotest_observability_series_overflow_total counter");
  lines.push(`hellotest_observability_series_overflow_total ${metricsState.seriesOverflow}`);

  lines.push("# HELP hellotest_errors_total Operational errors grouped into bounded failure classes.");
  lines.push("# TYPE hellotest_errors_total counter");
  for (const [kind, total] of metricsState.errors.entries()) {
    lines.push(`hellotest_errors_total{kind="${formatLabelValue(kind)}"} ${total}`);
  }

  lines.push("# HELP hellotest_process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE hellotest_process_uptime_seconds gauge");
  lines.push(`hellotest_process_uptime_seconds ${process.uptime().toFixed(3)}`);

  lines.push("# HELP hellotest_process_memory_bytes Resident memory usage by type.");
  lines.push("# TYPE hellotest_process_memory_bytes gauge");

  for (const [memoryType, value] of Object.entries(memoryUsage)) {
    lines.push(`hellotest_process_memory_bytes{type="${formatLabelValue(memoryType)}"} ${value}`);
  }

  lines.push("# HELP hellotest_nodejs_event_loop_utilization_ratio Event-loop utilization since the previous scrape.");
  lines.push("# TYPE hellotest_nodejs_event_loop_utilization_ratio gauge");
  lines.push(`hellotest_nodejs_event_loop_utilization_ratio ${eventLoop.utilization.toFixed(6)}`);
  lines.push("# HELP hellotest_nodejs_event_loop_delay_seconds Event-loop delay observed since the previous scrape.");
  lines.push("# TYPE hellotest_nodejs_event_loop_delay_seconds gauge");
  lines.push(`hellotest_nodejs_event_loop_delay_seconds{quantile="0.99"} ${eventLoop.p99Seconds.toFixed(6)}`);
  lines.push(`hellotest_nodejs_event_loop_delay_seconds{quantile="max"} ${eventLoop.maxSeconds.toFixed(6)}`);

  lines.push("# HELP hellotest_database_pool_connections PostgreSQL pool connections by state.");
  lines.push("# TYPE hellotest_database_pool_connections gauge");
  lines.push("# HELP hellotest_database_pool_waiting PostgreSQL queries waiting for a pooled connection.");
  lines.push("# TYPE hellotest_database_pool_waiting gauge");
  lines.push("# HELP hellotest_database_pool_saturated Whether a PostgreSQL pool is saturated.");
  lines.push("# TYPE hellotest_database_pool_saturated gauge");
  lines.push("# HELP hellotest_database_pool_utilization_ratio Active PostgreSQL connections divided by pool capacity.");
  lines.push("# TYPE hellotest_database_pool_utilization_ratio gauge");
  lines.push("# HELP hellotest_database_pool_background_errors_total Idle PostgreSQL client errors observed by the pool.");
  lines.push("# TYPE hellotest_database_pool_background_errors_total counter");
  for (const [poolName, pool] of Object.entries(databasePools)) {
    const poolLabel = formatLabelValue(poolName);
    lines.push(`hellotest_database_pool_connections{pool="${poolLabel}",state="active"} ${pool.active || 0}`);
    lines.push(`hellotest_database_pool_connections{pool="${poolLabel}",state="idle"} ${pool.idle || 0}`);
    lines.push(`hellotest_database_pool_connections{pool="${poolLabel}",state="max"} ${pool.max || 0}`);
    lines.push(`hellotest_database_pool_waiting{pool="${poolLabel}"} ${pool.waiting || 0}`);
    lines.push(`hellotest_database_pool_saturated{pool="${poolLabel}"} ${pool.saturated ? 1 : 0}`);
    lines.push(`hellotest_database_pool_utilization_ratio{pool="${poolLabel}"} ${numberOrZero(pool.utilization).toFixed(6)}`);
    lines.push(`hellotest_database_pool_background_errors_total{pool="${poolLabel}"} ${numberOrZero(pool.background_error_count)}`);
  }

  if (capacityMetrics) {
    const max = Math.max(1, numberOrZero(capacityMetrics.max));
    const maxLarge = Math.max(1, numberOrZero(capacityMetrics.maxLarge));
    lines.push("# HELP hellotest_capacity_active_requests Requests admitted by the capacity guard.");
    lines.push("# TYPE hellotest_capacity_active_requests gauge");
    lines.push(`hellotest_capacity_active_requests{class="all"} ${numberOrZero(capacityMetrics.active)}`);
    lines.push(`hellotest_capacity_active_requests{class="large"} ${numberOrZero(capacityMetrics.activeLarge)}`);
    lines.push("# HELP hellotest_capacity_limit Configured concurrent-request capacity.");
    lines.push("# TYPE hellotest_capacity_limit gauge");
    lines.push(`hellotest_capacity_limit{class="all"} ${max}`);
    lines.push(`hellotest_capacity_limit{class="large"} ${maxLarge}`);
    lines.push("# HELP hellotest_capacity_utilization_ratio Admitted requests divided by configured capacity.");
    lines.push("# TYPE hellotest_capacity_utilization_ratio gauge");
    lines.push(`hellotest_capacity_utilization_ratio{class="all"} ${(numberOrZero(capacityMetrics.active) / max).toFixed(6)}`);
    lines.push(`hellotest_capacity_utilization_ratio{class="large"} ${(numberOrZero(capacityMetrics.activeLarge) / maxLarge).toFixed(6)}`);
    lines.push("# HELP hellotest_capacity_rejections_total Requests rejected to prevent overload.");
    lines.push("# TYPE hellotest_capacity_rejections_total counter");
    lines.push(`hellotest_capacity_rejections_total{class="all"} ${numberOrZero(capacityMetrics.rejected)}`);
    lines.push(`hellotest_capacity_rejections_total{class="large"} ${numberOrZero(capacityMetrics.rejectedLarge)}`);
  }

  if (engineMetrics) {
    lines.push("# HELP hellotest_runs_total Total HelloTest execution runs.");
    lines.push("# TYPE hellotest_runs_total gauge");
    lines.push(`hellotest_runs_total ${engineMetrics.total || 0}`);

    lines.push("# HELP hellotest_runs_running Number of HelloTest execution runs currently running.");
    lines.push("# TYPE hellotest_runs_running gauge");
    lines.push(`hellotest_runs_running ${engineMetrics.running || 0}`);

    lines.push("# HELP hellotest_runs_queued Number of queued HelloTest execution runs.");
    lines.push("# TYPE hellotest_runs_queued gauge");
    lines.push(`hellotest_runs_queued ${engineMetrics.queued || 0}`);

    lines.push("# HELP hellotest_run_queue_oldest_age_seconds Age of the oldest queued Test Engine job.");
    lines.push("# TYPE hellotest_run_queue_oldest_age_seconds gauge");
    lines.push(`hellotest_run_queue_oldest_age_seconds ${numberOrZero(engineMetrics.oldest_queued_age_seconds).toFixed(3)}`);

    lines.push("# HELP hellotest_run_expired_leases Number of Test Engine jobs whose lease has expired.");
    lines.push("# TYPE hellotest_run_expired_leases gauge");
    lines.push(`hellotest_run_expired_leases ${numberOrZero(engineMetrics.expired_leases)}`);

    lines.push("# HELP hellotest_run_recent_failures Number of Test Engine jobs failed during the last fifteen minutes.");
    lines.push("# TYPE hellotest_run_recent_failures gauge");
    lines.push(`hellotest_run_recent_failures ${numberOrZero(engineMetrics.recent_failures)}`);

    if (engineMetrics.last_heartbeat_at) {
      lines.push("# HELP hellotest_run_heartbeat_timestamp Timestamp of the most recent heartbeat.");
      lines.push("# TYPE hellotest_run_heartbeat_timestamp gauge");
      lines.push(`hellotest_run_heartbeat_timestamp ${Math.floor(new Date(engineMetrics.last_heartbeat_at).getTime() / 1000)}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const getEngineMetrics = async () => {
  const sql = `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      MAX(heartbeat_at) AS last_heartbeat_at,
      COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at) FILTER (WHERE status = 'queued'))), 0) AS oldest_queued_age_seconds,
      COUNT(*) FILTER (WHERE status = 'leased' AND lease_expires_at < CURRENT_TIMESTAMP) AS expired_leases,
      COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes') AS recent_failures
    FROM test_engine_jobs
  `;
  const operation = obsDb.pool?.query
    ? obsDb.pool.query({ text: sql, query_timeout: METRICS_DB_QUERY_TIMEOUT_MS })
    : obsDb.query(sql);
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(
      `Execution metrics query timed out after ${METRICS_DB_QUERY_TIMEOUT_MS}ms`
    )), METRICS_DB_QUERY_TIMEOUT_MS);
    timeoutHandle.unref?.();
  });

  const result = await Promise.race([operation, timeout]).finally(() => clearTimeout(timeoutHandle));

  return result.rows[0] || {};
};

async function observabilityPlugin(fastify) {
  fastify.decorateRequest("traceId", null);
  fastify.decorateRequest("traceparent", null);
  fastify.decorateRequest("startedAtNs", null);
  fastify.decorateRequest("observabilityFinalized", false);

  const finalizeInflight = (request) => {
    if (request.observabilityFinalized) return false;
    request.observabilityFinalized = true;
    metricsState.inflight = Math.max(0, metricsState.inflight - 1);
    return true;
  };

  fastify.addHook("onRequest", async (request, reply) => {
    metricsState.inflight += 1;
    request.startedAtNs = process.hrtime.bigint();

    const traceContext = nextTraceContext(request.headers.traceparent);
    request.traceId = traceContext.traceId;
    request.traceparent = traceContext.traceparent;

    reply.header("X-Trace-ID", traceContext.traceId);
    reply.header("traceparent", traceContext.traceparent);

    reply.raw.once("close", () => {
      // A normal response may emit close before the async onResponse hook runs.
      if (reply.raw.writableFinished) return;
      if (!finalizeInflight(request)) return;
      metricsState.aborted += 1;
      request.log.warn({
        event: "http_request_aborted",
        method: request.method,
        route: getRequestRouteLabel(request, reply),
        trace_id: request.traceId,
        request_id: request.id
      }, "HTTP connection closed before the response completed");
    });
  });

  fastify.addHook("onError", async (_request, reply, error) => {
    recordErrorMetric(error, reply.statusCode);
  });

  fastify.addHook("onResponse", async (request, reply) => {
    finalizeInflight(request);

    if (!request.startedAtNs) {
      return;
    }

    const elapsedNs = process.hrtime.bigint() - request.startedAtNs;
    const durationMs = Number(elapsedNs) / 1_000_000;
    const route = getRequestRouteLabel(request, reply);

    recordRequestMetric({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs
    });

    const important = reply.statusCode >= 400 || durationMs >= SLOW_REQUEST_MS;
    const sampled = !NOISY_LOG_ROUTES.has(route) || Math.random() < NOISY_LOG_SAMPLE_RATE;
    if (important || sampled) {
      const level = reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info";
      request.log[level]({
        event: "http_request_completed",
        method: request.method,
        route,
        status_code: reply.statusCode,
        duration_ms: Number(durationMs.toFixed(3)),
        trace_id: request.traceId,
        request_id: request.id,
        sampled: !important && NOISY_LOG_ROUTES.has(route)
      }, "HTTP request completed");
    }
  });

  const livenessPayload = () => ({
    ok: true,
    status: "alive",
    service: "hellotest-api",
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    timestamp: new Date().toISOString()
  });

  fastify.get("/health", async () => {
    return livenessPayload();
  });

  fastify.get("/health/live", async () => {
    return {
      ...livenessPayload(),
      probe: "liveness"
    };
  });

  fastify.get("/health/ready", async (request, reply) => {
    const snapshot = await runtimeHealthService.runChecks({ includeOptional: false });
    const ok = snapshot.status === "ready";
    if (!ok) {
      request.log.warn({ checks: snapshot.checks.map(({ key, status }) => ({ key, status })) }, "Readiness probe failed");
      reply.code(503);
    }

    return {
      ok,
      probe: "readiness",
      ...snapshot
    };
  });

  fastify.get("/metrics", async (_request, reply) => {
    const engineMetrics = await getEngineMetrics().catch((error) => {
      fastify.log.warn({ error }, "Execution metrics are temporarily unavailable");
      return null;
    });

    const capacityMetrics = typeof fastify.capacityGuard?.snapshot === "function"
      ? fastify.capacityGuard.snapshot()
      : null;

    reply
      .header("Cache-Control", "no-store")
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics({
        engineMetrics,
        databasePools: {
          main: db.getPoolStats?.() || {},
          execution: obsDb.getPoolStats?.() || {}
        },
        capacityMetrics
      }));
  });
}

module.exports = fp(observabilityPlugin, {
  name: "hellotest-observability"
});
