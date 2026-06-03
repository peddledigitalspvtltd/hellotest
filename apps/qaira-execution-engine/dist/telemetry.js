import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { config } from "./config.js";
let sdk = null;
export const initializeTelemetry = async () => {
    if (!config.enableObservability || !config.otelEndpoint) {
        return;
    }
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
    const traceExporter = new OTLPTraceExporter({ url: config.otelEndpoint });
    sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [SemanticResourceAttributes.SERVICE_NAME]: "qaira-execution-engine",
            [SemanticResourceAttributes.SERVICE_NAMESPACE]: "qaira"
        }),
        traceExporter
    });
    try {
        await sdk.start();
    }
    catch (error) {
        sdk = null;
        // Observability is optional; workers must still execute tests when OTel is unavailable.
        console.warn("Telemetry unavailable; continuing without tracing", error);
    }
};
export const shutdownTelemetry = async () => {
    if (sdk) {
        await sdk.shutdown();
    }
};
//# sourceMappingURL=telemetry.js.map