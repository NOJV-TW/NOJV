import { metrics, type Histogram } from "@opentelemetry/api";

const meter = metrics.getMeter("@nojv/web");

export const apiRequestDuration: Histogram = meter.createHistogram(
  "api_request_duration_seconds",
  {
    description: "API request duration measured at the SvelteKit hook boundary",
    unit: "s",
  },
);

export interface ApiRequestLabels {
  route: string;
  method: string;
  status_class: string;
}

export const healthProbeDuration: Histogram = meter.createHistogram(
  "health_probe_duration_seconds",
  {
    description: "Web health probe duration outside the API SLO request population",
    unit: "s",
  },
);

export interface HealthProbeLabels {
  probe: "live" | "ready" | "health";
  result: "success" | "failure";
}

export function statusClass(status: number): string {
  return `${String(Math.floor(status / 100))}xx`;
}

export const sseConnectionDuration: Histogram = meter.createHistogram(
  "sse_connection_duration_seconds",
  {
    description: "SSE connection lifetime measured from stream start to cleanup",
    unit: "s",
  },
);

export const sseConnectionDroppedTotal = meter.createCounter("sse_connection_dropped_total", {
  description: "SSE connections closed due to server-side fault",
});

export type SseCloseReason =
  "client_abort" | "timeout" | "subscribe_failed" | "controller_error";
