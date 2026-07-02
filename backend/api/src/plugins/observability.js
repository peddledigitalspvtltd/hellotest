const crypto = require("crypto");
const fp = require("fastify-plugin");
const db = require("../db");
const obsDb = require("../obsDb");

const metricsState = {
  inflight: 0,
  requests: new Map()
};

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const formatLabelValue = (value) => {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
};

const getRequestRouteLabel = (request, reply) => {
  if (request.routeOptions?.url) {
    return request.routeOptions.url;
  }

  if (request.routerPath) {
    return request.routerPath;
  }

  if (reply.statusCode === 404) {
    return "unmatched";
  }

  const rawUrl = request.raw?.url || request.url || "";
  const pathname = rawUrl.split("?")[0] || "unknown";
  return pathname || "unknown";
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
  const existingContext = resolveTraceContext(incomingTraceparent);
  const traceId = existingContext?.traceId || crypto.randomBytes(16).toString("hex");
  const spanId = crypto.randomBytes(8).toString("hex");

  return {
    traceId,
    traceparent: `00-${traceId}-${spanId}-01`
  };
};

const recordRequestMetric = ({ method, route, statusCode, durationMs }) => {
  const key = `${method}|${route}|${statusCode}`;
  const entry = metricsState.requests.get(key) || {
    method,
    route,
    statusCode,
    total: 0,
    durationMsSum: 0
  };

  entry.total += 1;
  entry.durationMsSum += durationMs;
  metricsState.requests.set(key, entry);
};

const renderMetrics = (engineMetrics = {}) => {
  const memoryUsage = process.memoryUsage();
  const lines = [
    "# HELP qaira_http_requests_total Total HTTP requests handled by the API.",
    "# TYPE qaira_http_requests_total counter"
  ];

  for (const entry of metricsState.requests.values()) {
    const labels = `method="${formatLabelValue(entry.method)}",route="${formatLabelValue(entry.route)}",status="${formatLabelValue(entry.statusCode)}"`;
    lines.push(`qaira_http_requests_total{${labels}} ${entry.total}`);
  }

  lines.push("# HELP qaira_http_request_duration_ms_sum Cumulative request latency in milliseconds.");
  lines.push("# TYPE qaira_http_request_duration_ms_sum counter");

  for (const entry of metricsState.requests.values()) {
    const labels = `method="${formatLabelValue(entry.method)}",route="${formatLabelValue(entry.route)}",status="${formatLabelValue(entry.statusCode)}"`;
    lines.push(`qaira_http_request_duration_ms_sum{${labels}} ${entry.durationMsSum.toFixed(3)}`);
  }

  lines.push("# HELP qaira_http_request_duration_ms_count Request latency observation count.");
  lines.push("# TYPE qaira_http_request_duration_ms_count counter");

  for (const entry of metricsState.requests.values()) {
    const labels = `method="${formatLabelValue(entry.method)}",route="${formatLabelValue(entry.route)}",status="${formatLabelValue(entry.statusCode)}"`;
    lines.push(`qaira_http_request_duration_ms_count{${labels}} ${entry.total}`);
  }

  lines.push("# HELP qaira_http_requests_inflight Currently active HTTP requests.");
  lines.push("# TYPE qaira_http_requests_inflight gauge");
  lines.push(`qaira_http_requests_inflight ${metricsState.inflight}`);

  lines.push("# HELP qaira_process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE qaira_process_uptime_seconds gauge");
  lines.push(`qaira_process_uptime_seconds ${process.uptime().toFixed(3)}`);

  lines.push("# HELP qaira_process_memory_bytes Resident memory usage by type.");
  lines.push("# TYPE qaira_process_memory_bytes gauge");

  for (const [memoryType, value] of Object.entries(memoryUsage)) {
    lines.push(`qaira_process_memory_bytes{type="${formatLabelValue(memoryType)}"} ${value}`);
  }

  if (engineMetrics) {
    lines.push("# HELP qaira_runs_total Total Qaira execution runs.");
    lines.push("# TYPE qaira_runs_total gauge");
    lines.push(`qaira_runs_total ${engineMetrics.total || 0}`);

    lines.push("# HELP qaira_runs_running Number of Qaira execution runs currently running.");
    lines.push("# TYPE qaira_runs_running gauge");
    lines.push(`qaira_runs_running ${engineMetrics.running || 0}`);

    lines.push("# HELP qaira_runs_queued Number of queued Qaira execution runs.");
    lines.push("# TYPE qaira_runs_queued gauge");
    lines.push(`qaira_runs_queued ${engineMetrics.queued || 0}`);

    if (engineMetrics.last_heartbeat_at) {
      lines.push("# HELP qaira_run_heartbeat_timestamp Timestamp of the most recent heartbeat.");
      lines.push("# TYPE qaira_run_heartbeat_timestamp gauge");
      lines.push(`qaira_run_heartbeat_timestamp ${Math.floor(new Date(engineMetrics.last_heartbeat_at).getTime() / 1000)}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const getEngineMetrics = async () => {
  const result = await obsDb.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      MAX(heartbeat_at) AS last_heartbeat_at
    FROM test_engine_jobs
  `);

  return result.rows[0] || {};
};

async function observabilityPlugin(fastify) {
  fastify.decorateRequest("traceId", null);
  fastify.decorateRequest("traceparent", null);
  fastify.decorateRequest("startedAtNs", null);

  fastify.addHook("onRequest", async (request, reply) => {
    metricsState.inflight += 1;
    request.startedAtNs = process.hrtime.bigint();

    const traceContext = nextTraceContext(request.headers.traceparent);
    request.traceId = traceContext.traceId;
    request.traceparent = traceContext.traceparent;

    reply.header("X-Trace-ID", traceContext.traceId);
    reply.header("traceparent", traceContext.traceparent);
  });

  fastify.addHook("onResponse", async (request, reply) => {
    metricsState.inflight = Math.max(0, metricsState.inflight - 1);

    if (!request.startedAtNs) {
      return;
    }

    const elapsedNs = process.hrtime.bigint() - request.startedAtNs;
    const durationMs = Number(elapsedNs) / 1_000_000;

    recordRequestMetric({
      method: request.method,
      route: getRequestRouteLabel(request, reply),
      statusCode: reply.statusCode,
      durationMs
    });
  });

  fastify.get("/health", async () => {
    return {
      ok: true,
      service: "qaira-api",
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString()
    };
  });

  fastify.get("/health/ready", async (request, reply) => {
    try {
      await db.query("SELECT 1 AS ready");

      return {
        ok: true,
        service: "qaira-api",
        database: "ready",
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      request.log.error(error, "Readiness probe failed");
      reply.code(503);
      return {
        ok: false,
        service: "qaira-api",
        database: "unavailable",
        timestamp: new Date().toISOString()
      };
    }
  });

  fastify.get("/metrics", async (_request, reply) => {
    const engineMetrics = await getEngineMetrics();

    reply
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics(engineMetrics));
  });
}

module.exports = fp(observabilityPlugin, {
  name: "qaira-observability"
});
