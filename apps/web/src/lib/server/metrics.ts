import { metrics, type Attributes, type Counter, type Histogram } from "@opentelemetry/api";

function lazyHistogram(name: string, options: { description: string; unit: string }) {
  let instrument: Histogram | undefined;
  return {
    record(value: number, attributes?: Attributes) {
      instrument ??= metrics.getMeter("@nojv/web").createHistogram(name, options);
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

export const apiRequestDuration = lazyHistogram("api_request_duration_seconds", {
  description: "API request duration measured at the SvelteKit hook boundary",
  unit: "s",
});

export interface ApiRequestLabels {
  route: string;
  method: string;
  status_class: string;
}

export const healthProbeDuration = lazyHistogram("health_probe_duration_seconds", {
  description: "Web health probe duration outside the API SLO request population",
  unit: "s",
});

export interface HealthProbeLabels {
  probe: "live" | "ready";
  result: "success" | "failure";
}

export function statusClass(status: number): string {
  return `${String(Math.floor(status / 100))}xx`;
}

export const sseConnectionDuration = lazyHistogram("sse_connection_duration_seconds", {
  description: "SSE connection lifetime measured from stream start to cleanup",
  unit: "s",
});

export const sseConnectionDroppedTotal = lazyCounter("sse_connection_dropped_total", {
  description: "SSE connections closed due to server-side fault",
});

export type SseCloseReason = "client_abort" | "timeout" | "controller_error";
