import { metrics, type Histogram } from "@opentelemetry/api";

import { getRedis, scoreboard, cooldown, cache } from "@nojv/redis";

// --- Metrics ------------------------------------------------------------

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
  // Clamp negative durations from clock skew to 0; not expected in practice.
  const seconds = Math.max(0, (args.completedAtMs - args.startedAtMs) / 1000);
  hist.record(seconds, { mode: args.mode, verdict: args.verdict });
}

// --- Redis re-exports ---------------------------------------------------

export { getRedis };

export const updateScoreboard = scoreboard.updateScoreboard;
export const getScoreboard = scoreboard.getScoreboard;
export const setCooldown = cooldown.setCooldown;
export const checkCooldown = cooldown.checkCooldown;
export const cacheGet = cache.cacheGet;
export const cacheSet = cache.cacheSet;
export const cacheDel = cache.cacheDel;
