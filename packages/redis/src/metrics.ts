import { metrics, type Histogram } from "@opentelemetry/api";

const meter = metrics.getMeter("@nojv/redis", "0.1.0");

export const scoreboardUpdateLatency: Histogram = meter.createHistogram(
  "scoreboard_update_latency_seconds",
  {
    description: "Redis scoreboard update latency from updateScoreboard call to commit",
    unit: "s",
  },
);

export type ScoreboardUpdateMode = "icpc" | "ioi";
