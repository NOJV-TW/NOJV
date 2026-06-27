import { NodeSDK, metrics } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

let started = false;
let sdk: NodeSDK | null = null;

export function startOtel(): void {
  if (started) return;
  const endpoint = process.env.GRAFANA_OTLP_ENDPOINT;
  if (!endpoint) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[otel] GRAFANA_OTLP_ENDPOINT not set — metrics export disabled in production.",
      );
    }
    return;
  }

  if (!URL.canParse(endpoint)) {
    console.warn(`[otel] Invalid GRAFANA_OTLP_ENDPOINT: ${endpoint}`);
    return;
  }

  const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
  const token = process.env.GRAFANA_OTLP_TOKEN;
  const headers =
    instanceId && token
      ? { Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString("base64")}` }
      : undefined;

  const exporter = new OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
    ...(headers ? { headers } : {}),
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME_WORKER ?? "nojv-worker",
      "service.version": process.env.npm_package_version ?? "0.0.0",
      "deployment.environment.name": process.env.NODE_ENV ?? "development",
    }),
    metricReader: new metrics.PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 30_000,
    }),
    spanProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  sdk.start();
  started = true;
}

export async function shutdownOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    return;
  }
}

startOtel();
