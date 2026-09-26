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
  });
});
