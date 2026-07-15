import { metrics } from "@opentelemetry/api";

import type { DurableWorkOutcome } from "./durable-work-runner";

const meter = metrics.getMeter("@nojv/worker", "0.1.0");
const outcomeCounter = meter.createCounter("durable_work_outcomes_total", {
  description: "Durable work handler outcomes grouped by kind and delivery semantics",
});

export function durableWorkMetricAttributes(
  kind: string,
  outcome: DurableWorkOutcome,
  registeredKinds: ReadonlySet<string>,
): {
  kind: string;
  outcome: DurableWorkOutcome;
  delivery_semantics: "at_least_once" | "not_applicable";
} {
  const boundedKind = registeredKinds.has(kind) ? kind : "unregistered";
  return {
    kind: boundedKind,
    outcome,
    delivery_semantics:
      boundedKind === "notification.email" ? "at_least_once" : "not_applicable",
  };
}

export function recordDurableWorkOutcome(
  kind: string,
  outcome: DurableWorkOutcome,
  registeredKinds: ReadonlySet<string>,
): void {
  outcomeCounter.add(1, durableWorkMetricAttributes(kind, outcome, registeredKinds));
}
