import { metrics } from "@opentelemetry/api";

export type CapacitySignal = "unschedulable" | "wallClockTimeout";

const listeners = new Set<(signal: CapacitySignal) => void>();
const signalCounter = metrics
  .getMeter("nojv-judge")
  .createCounter("judge_capacity_signals_total");

export function onCapacitySignal(listener: (signal: CapacitySignal) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitCapacitySignal(signal: CapacitySignal): void {
  signalCounter.add(1, { signal });
  for (const listener of listeners) listener(signal);
}
