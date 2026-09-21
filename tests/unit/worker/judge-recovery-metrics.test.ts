import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const { metrics } = createRequire(
  new URL("../../../apps/worker/package.json", import.meta.url),
)("@opentelemetry/api");

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  gauge: vi.fn((name: string) => ({ name })),
}));

import {
  JUDGE_RECOVERY_METRICS,
  startJudgeRecoveryMetrics,
} from "../../../apps/worker/src/judge-recovery-metrics";
import { AlertRuleDefSchema } from "../../../infra/grafana/schemas";

const snapshot = {
  queueDepth: 8,
  oldestQueueSeconds: 750,
  blocked: 2,
  stalled: 1,
  legacySystemErrors: 3,
  observedAt: 1700000000,
};
beforeEach(() => {
  vi.clearAllMocks();
  metrics.disable();
  metrics.setGlobalMeterProvider({
    getMeter: () =>
      ({
        createObservableGauge: mocks.gauge,
        addBatchObservableCallback: mocks.add,
        removeBatchObservableCallback: mocks.remove,
      }) as never,
  });
});
afterEach(() => metrics.disable());

describe("Judge recovery SQL metrics observer", () => {
  it("publishes a complete bounded-cardinality snapshot without a judge worker or Temporal activity", async () => {
    const read = vi.fn().mockResolvedValue(snapshot);
    const stop = startJudgeRecoveryMetrics(read);
    const tick = mocks.add.mock.calls[0][0];
    const result = { observe: vi.fn() };
    await tick(result);
    expect(read).toHaveBeenCalledOnce();
    expect(result.observe).toHaveBeenCalledTimes(6);
    expect(result.observe).toHaveBeenCalledWith(
      { name: JUDGE_RECOVERY_METRICS.oldestQueueSeconds },
      750,
    );
    expect(result.observe).toHaveBeenCalledWith(
      { name: JUDGE_RECOVERY_METRICS.observedAt },
      1700000000,
    );
    expect(result.observe.mock.calls.every((call) => call.length === 2)).toBe(true);
    stop();
    expect(mocks.remove).toHaveBeenCalledWith(tick, mocks.add.mock.calls[0][1]);
  });

  it("never publishes a fresh heartbeat or false zero counts on a failed query, then resumes next collection", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("database offline"))
      .mockResolvedValue(snapshot);
    startJudgeRecoveryMetrics(read);
    const tick = mocks.add.mock.calls[0][0];
    const result = { observe: vi.fn() };
    await expect(tick(result)).resolves.toBeUndefined();
    expect(result.observe).not.toHaveBeenCalled();
    await tick(result);
    expect(result.observe).toHaveBeenCalledTimes(6);
  });

  it("rejects invalid snapshots atomically", async () => {
    startJudgeRecoveryMetrics(async () => ({ ...snapshot, stalled: Number.NaN }));
    const result = { observe: vi.fn() };
    await mocks.add.mock.calls[0][0](result);
    expect(result.observe).not.toHaveBeenCalled();
  });

  it("ships alert rules backed by these actual producers with missing-data detection", () => {
    const rules: ReturnType<typeof AlertRuleDefSchema.parse>[] = JSON.parse(
      readFileSync(
        new URL("../../../infra/grafana/alerts/slo-alerts.json", import.meta.url),
        "utf8",
      ),
    ).map((rule: unknown) => AlertRuleDefSchema.parse(rule));
    const observer = rules.find((rule) => rule.uid === "nojv-judge-recovery-observer-stale");
    expect(observer!.expr).toContain(JUDGE_RECOVERY_METRICS.observedAt);
    expect(observer!.expr).toContain("or vector(");
    expect(observer!.noDataState).toBe("Alerting");
    for (const uid of [
      "nojv-submissions-stuck",
      "nojv-judge-queue-age",
      "nojv-judge-recovery-blocked",
      "nojv-judge-legacy-system-errors",
    ]) {
      const rule = rules.find((candidate) => candidate.uid === uid);
      expect(
        Object.values(JUDGE_RECOVERY_METRICS).some((name) => rule!.expr.includes(name)),
      ).toBe(true);
      expect(rule!.noDataState).toBe("Alerting");
      expect(rule!.summary).not.toContain("Placeholder");
    }
  });
});
