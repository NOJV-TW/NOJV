import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const { metrics } = createRequire(
  new URL("../../../apps/worker/package.json", import.meta.url),
)("@opentelemetry/api");

import {
  BACKUP_LAST_SUCCESS_METRIC,
  startBackupFreshnessMetrics,
  toBackupCronJobStatus,
} from "../../../apps/worker/src/backup-freshness-metrics";

const mocks = vi.hoisted(() => ({
  addCallback: vi.fn(),
  removeCallback: vi.fn(),
  createObservableGauge: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createObservableGauge.mockReturnValue({
    addCallback: mocks.addCallback,
    removeCallback: mocks.removeCallback,
  });
  metrics.disable();
  metrics.setGlobalMeterProvider({
    getMeter: () => ({ createObservableGauge: mocks.createObservableGauge }) as never,
  });
});
afterEach(() => metrics.disable());

describe("backup CronJob freshness", () => {
  it("reports the last successful run per backup component", () => {
    expect(
      toBackupCronJobStatus({
        metadata: {
          labels: { "app.kubernetes.io/component": "postgres-dump" },
          creationTimestamp: new Date("2026-01-01T00:00:00Z"),
        },
        status: { lastSuccessfulTime: new Date("2026-09-26T19:04:30Z") },
      }),
    ).toEqual({
      component: "postgres-dump",
      lastSuccessSeconds: Date.parse("2026-09-26T19:04:30Z") / 1000,
    });
  });

  it("starts the staleness clock at creation for a CronJob that never succeeded", () => {
    expect(
      toBackupCronJobStatus({
        metadata: {
          labels: { "app.kubernetes.io/component": "minio-backup" },
          creationTimestamp: new Date("2026-09-20T00:00:00Z"),
        },
      })?.lastSuccessSeconds,
    ).toBe(Date.parse("2026-09-20T00:00:00Z") / 1000);
    expect(toBackupCronJobStatus({ metadata: { creationTimestamp: new Date() } })).toBeNull();
  });

  it("observes each CronJob and publishes nothing when the API read fails", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("api server unavailable"))
      .mockResolvedValue([
        { component: "postgres-dump", lastSuccessSeconds: 100 },
        { component: "minio-backup", lastSuccessSeconds: 200 },
      ]);
    const stop = startBackupFreshnessMetrics(read);
    expect(mocks.createObservableGauge).toHaveBeenCalledWith(BACKUP_LAST_SUCCESS_METRIC);
    const tick = mocks.addCallback.mock.calls[0][0];
    const result = { observe: vi.fn() };

    await expect(tick(result)).resolves.toBeUndefined();
    expect(result.observe).not.toHaveBeenCalled();

    await tick(result);
    expect(result.observe).toHaveBeenCalledWith(100, { component: "postgres-dump" });
    expect(result.observe).toHaveBeenCalledWith(200, { component: "minio-backup" });

    stop();
    expect(mocks.removeCallback).toHaveBeenCalledWith(tick);
  });
});
