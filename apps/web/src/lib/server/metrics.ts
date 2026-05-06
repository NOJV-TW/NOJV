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
