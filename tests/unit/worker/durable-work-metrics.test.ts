import { describe, expect, it } from "vitest";

import { durableWorkMetricAttributes } from "../../../apps/worker/src/activities/durable-work-metrics";

describe("durable work metrics", () => {
  it("only emits registry-bounded kind and outcome labels", () => {
    const registeredKinds = new Set(["notify", "reindex"]);

    expect(durableWorkMetricAttributes("notify", "retry", registeredKinds)).toEqual({
      kind: "notify",
      outcome: "retry",
      delivery_semantics: "not_applicable",
    });
    expect(durableWorkMetricAttributes("tenant-12345", "dead", registeredKinds)).toEqual({
      kind: "unregistered",
      outcome: "dead",
      delivery_semantics: "not_applicable",
    });
  });

  it("labels SMTP work with its honest at-least-once delivery semantics", () => {
    expect(
      durableWorkMetricAttributes(
        "notification.email",
        "succeeded",
        new Set(["notification.email"]),
      ),
    ).toEqual({
      kind: "notification.email",
      outcome: "succeeded",
      delivery_semantics: "at_least_once",
    });
  });
});
