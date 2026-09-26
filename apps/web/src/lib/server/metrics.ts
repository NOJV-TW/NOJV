import { metrics, type Attributes, type Counter, type Histogram } from "@opentelemetry/api";

const REQUEST_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const CONNECTION_SECONDS = [1, 5, 15, 30, 60, 300, 900, 1800, 3600];

function lazyHistogram(
  name: string,
  options: { description: string; unit: string },
  boundaries: number[],
) {
  let instrument: Histogram | undefined;
  return {
    record(value: number, attributes?: Attributes) {
      instrument ??= metrics.getMeter("@nojv/web").createHistogram(name, {
        ...options,
        advice: { explicitBucketBoundaries: boundaries },
      });
      instrument.record(value, attributes);
    },
  };
}

function lazyCounter(name: string, options: { description: string }) {
  let instrument: Counter | undefined;
  return {
    add(value: number, attributes?: Attributes) {
      instrument ??= metrics.getMeter("@nojv/web").createCounter(name, options);
      instrument.add(value, attributes);
    },
  };
}

export const apiRequestDuration = lazyHistogram(
  "api_request_duration_seconds",
  { description: "API request duration measured at the SvelteKit hook boundary", unit: "s" },
  REQUEST_SECONDS,
);

export interface ApiRequestLabels {
  route: string;
  method: string;
  status_class: string;
}

export const healthProbeDuration = lazyHistogram(
  "health_probe_duration_seconds",
  {
    description: "Web health probe duration outside the API SLO request population",
    unit: "s",
  },
  REQUEST_SECONDS,
);

export interface HealthProbeLabels {
  probe: "live" | "ready";
  result: "success" | "failure";
}

export function statusClass(status: number): string {
  return `${String(Math.floor(status / 100))}xx`;
}

export const sseConnectionDuration = lazyHistogram(
  "sse_connection_duration_seconds",
  { description: "SSE connection lifetime measured from stream start to cleanup", unit: "s" },
  CONNECTION_SECONDS,
);

export const sseConnectionDroppedTotal = lazyCounter("sse_connection_dropped_total", {
  description: "SSE connections closed due to server-side fault",
});

export type SseCloseReason = "client_abort" | "timeout" | "controller_error";
