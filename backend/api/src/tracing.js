const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { config } = require('./config');

if (!config.enableObservability) {
  module.exports = null;
  return;
}

const otelUrl = config.otelEndpoint
  ? `${config.otelEndpoint.replace(/\/+$/, '')}/v1/traces`
  : undefined;

const traceExporter = otelUrl ? new OTLPTraceExporter({ url: otelUrl }) : undefined;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'hellotest-api',
  }),
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

// Initialize the SDK and register with the global tracer provider
try {
  sdk.start();
} catch (error) {
  console.warn('Tracing disabled after startup error:', error.message);
}

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;
