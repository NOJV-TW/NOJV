import { metrics } from "@opentelemetry/api";

import type { DurableWorkOutcome } from "./durable-work-runner";

const meter = metrics.getMeter("@nojv/worker", "0.1.0");
const outcomeCounter = meter.createCounter("durable_work_outcomes_total", {
  description: "Durable work handler outcomes grouped by registered kind",
});

export function durableWorkMetricAttributes(
  kind: string,
  outcome: DurableWorkOutcome,
  registeredKinds: ReadonlySet<string>,
): { kind: string; outcome: DurableWorkOutcome } {
  return {
    kind: registeredKinds.has(kind) ? kind : "unregistered",
    outcome,
  };
}

export function recordDurableWorkOutcome(
  kind: string,
  outcome: DurableWorkOutcome,
  registeredKinds: ReadonlySet<string>,
): void {
  outcomeCounter.add(1, durableWorkMetricAttributes(kind, outcome, registeredKinds));
}
