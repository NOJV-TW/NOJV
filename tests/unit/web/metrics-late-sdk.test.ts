import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import {
  apiRequestDuration,
  sseConnectionDroppedTotal,
} from "../../../apps/web/src/lib/server/metrics";

const webRequire = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { metrics: metricsApi } = webRequire(
  "@opentelemetry/api",
) as typeof import("@opentelemetry/api");
const { metrics } = webRequire(
  "@opentelemetry/sdk-node",
) as typeof import("@opentelemetry/sdk-node");

afterEach(() => {
  metricsApi.disable();
});

describe("web metrics registered after the module loads", () => {
  it("records into a MeterProvider installed after import, as the bundled server does", async () => {
    const exporter = new metrics.InMemoryMetricExporter(
      metrics.AggregationTemporality.CUMULATIVE,
    );
    const reader = new metrics.PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    metricsApi.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));

    apiRequestDuration.record(0.2, { route: "/api/x", method: "GET", status_class: "2xx" });
    sseConnectionDroppedTotal.add(1);
    await reader.forceFlush();

    const names = exporter
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .map((metric) => metric.descriptor.name);
    expect(names).toEqual(
      expect.arrayContaining(["api_request_duration_seconds", "sse_connection_dropped_total"]),
    );
    const latency = exporter
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "api_request_duration_seconds");
    const point = latency?.dataPoints[0]?.value as { buckets: { boundaries: number[] } };
    expect(point.buckets.boundaries).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ]);
  });
});
