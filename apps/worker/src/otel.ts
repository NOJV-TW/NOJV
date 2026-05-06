import { NodeSDK, metrics } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";

let started = false;
let sdk: NodeSDK | null = null;

export function startOtel(): void {
	if (started) return;
	const endpoint = process.env.GRAFANA_OTLP_ENDPOINT;
	const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
	const token = process.env.GRAFANA_OTLP_TOKEN;
	if (!endpoint || !instanceId || !token) return;

	if (!URL.canParse(endpoint)) {
		console.warn(`[otel] Invalid GRAFANA_OTLP_ENDPOINT: ${endpoint}`);
		return;
	}

	const auth = Buffer.from(`${instanceId}:${token}`).toString("base64");

	const exporter = new OTLPMetricExporter({
		url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
		headers: { Authorization: `Basic ${auth}` },
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
		// best-effort flush; swallow errors so caller's shutdown sequence isn't blocked
	}
}

// Self-execute at module load so that a side-effect-only `import "./otel.js"`
// (placed as the very first import in index.ts) registers import-in-the-middle
// hooks BEFORE pg/ioredis/etc. are evaluated by subsequent imports. The
// `started` flag keeps this idempotent.
startOtel();
