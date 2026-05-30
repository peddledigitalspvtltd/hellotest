import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { config } from "./config.js";

let sdk: NodeSDK | null = null;

export const initializeTelemetry = async () => {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const traceExporter = new OTLPTraceExporter({ url: config.otelEndpoint });

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: "qaira-execution-engine",
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: "qaira"
    }),
    traceExporter
  });

  await sdk.start();
};

export const shutdownTelemetry = async () => {
  if (sdk) {
    await sdk.shutdown();
  }
};
