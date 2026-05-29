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
  | "client_abort"
  | "timeout"
  | "subscribe_failed"
  | "controller_error";

export const examHeartbeatMissTotal = meter.createCounter("exam_heartbeat_miss_total", {
  description:
    "Heartbeats received after a gap longer than the expected 30s cadence (client missed at least one cycle)",
});

export type HeartbeatGapBucket = "30s_to_60s" | "60s_to_120s" | "over_120s";

export function heartbeatGapBucket(gapSec: number): HeartbeatGapBucket | null {
  if (gapSec <= 30) return null;
  if (gapSec < 60) return "30s_to_60s";
  if (gapSec < 120) return "60s_to_120s";
  return "over_120s";
}
