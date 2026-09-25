const crypto = require("crypto");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const apiPackage = require("../package.json");
const { config } = require("./config");

const state = {
  enabled: config.enableObservability,
  exporterConfigured: false,
  started: false,
  error: null,
  endpoint: null
};

const resolveTraceExporterUrl = (endpoint) => {
  const normalized = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!normalized) return null;
  return normalized.endsWith("/v1/traces") ? normalized : `${normalized}/v1/traces`;
};

let sdk = null;

if (config.enableObservability) {
  // Export is best-effort: bounded queues and deadlines protect application
  // memory and shutdown when the telemetry network is unavailable.
  process.env.OTEL_BSP_MAX_QUEUE_SIZE ||= "512";
  process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE ||= "128";
  process.env.OTEL_BSP_EXPORT_TIMEOUT ||= "2000";
  process.env.OTEL_TRACES_SAMPLER ||= "parentbased_traceidratio";
  process.env.OTEL_TRACES_SAMPLER_ARG ||= "0.1";
  const exporterUrl = resolveTraceExporterUrl(config.otelEndpoint);
  state.endpoint = exporterUrl;
  state.exporterConfigured = Boolean(exporterUrl);

  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "hellotest-api",
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: process.env.OTEL_SERVICE_NAMESPACE || "hellotest",
        [SemanticResourceAttributes.SERVICE_VERSION]: apiPackage.version,
        [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.env.OTEL_SERVICE_INSTANCE_ID || crypto.randomUUID(),
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.DEPLOYMENT_ENVIRONMENT || config.appMode
      }),
      traceExporter: exporterUrl ? new OTLPTraceExporter({ url: exporterUrl, timeoutMillis: 2000, concurrencyLimit: 2 }) : undefined,
      instrumentations: [getNodeAutoInstrumentations()]
    });
    sdk.start();
    state.started = true;
  } catch (error) {
    state.error = error.message;
    console.warn("Tracing disabled after startup error:", error.message);
  }
}

const shutdown = async () => {
  if (!sdk || !state.started) return;
  await sdk.shutdown();
  state.started = false;
};

module.exports = {
  getState: () => ({ ...state }),
  resolveTraceExporterUrl,
  sdk,
  shutdown
};
