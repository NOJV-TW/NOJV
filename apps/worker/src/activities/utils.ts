import { metrics, type Histogram } from "@opentelemetry/api";

export { getRedis } from "@nojv/redis";

const meter = metrics.getMeter("@nojv/worker", "0.1.0");

export const judgeLatencyHistogram = meter.createHistogram("judge_latency_seconds", {
  description: "End-to-end judge latency from submission.createdAt to verdict commit",
  unit: "s",
});

export interface JudgeLatencyArgs {
  startedAtMs: number;
  completedAtMs: number;
  mode: "standard" | "advanced";
  verdict: string;
}

export function recordJudgeLatency(hist: Histogram, args: JudgeLatencyArgs): void {
  const seconds = Math.max(0, (args.completedAtMs - args.startedAtMs) / 1000);
  hist.record(seconds, { mode: args.mode, verdict: args.verdict });
}
