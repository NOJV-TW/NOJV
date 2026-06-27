import { NodeSDK, metrics } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

let started = false;
let sdk: NodeSDK | null = null;

function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function startOtel(): void {
  if (started) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — metrics export disabled in production.",
      );
    }
    return;
  }

  if (!URL.canParse(endpoint)) {
    console.warn(`[otel] Invalid OTEL_EXPORTER_OTLP_ENDPOINT: ${endpoint}`);
    return;
  }

  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

  const exporter = new OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
    ...(headers ? { headers } : {}),
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME_WEB ?? "nojv-web",
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
