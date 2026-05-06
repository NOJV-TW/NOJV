import { metrics, type Histogram } from "@opentelemetry/api";

const meter = metrics.getMeter("@nojv/temporal", "0.1.0");

export const judgeLatencyHistogram = meter.createHistogram("judge_latency_seconds", {
  description: "End-to-end judge latency from submission.createdAt to verdict commit",
  unit: "s",
});

export type JudgeLatencyArgs = {
  startedAtMs: number;
  completedAtMs: number;
  mode: "standard" | "advanced";
  verdict: string;
};

export function recordJudgeLatency(hist: Histogram, args: JudgeLatencyArgs): void {
  // Clamp negative durations from clock skew to 0; not expected in practice.
  const seconds = Math.max(0, (args.completedAtMs - args.startedAtMs) / 1000);
  hist.record(seconds, { mode: args.mode, verdict: args.verdict });
}
