import { describe, expect, it } from "vitest";

import { durableWorkMetricAttributes } from "../../../apps/worker/src/activities/durable-work-metrics";

describe("durable work metrics", () => {
  it("only emits registry-bounded kind and outcome labels", () => {
    const registeredKinds = new Set(["notify", "reindex"]);

    expect(durableWorkMetricAttributes("notify", "retry", registeredKinds)).toEqual({
      kind: "notify",
      outcome: "retry",
    });
    expect(durableWorkMetricAttributes("tenant-12345", "dead", registeredKinds)).toEqual({
      kind: "unregistered",
      outcome: "dead",
    });
  });
});
