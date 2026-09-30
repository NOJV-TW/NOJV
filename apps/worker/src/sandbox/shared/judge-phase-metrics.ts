import { metrics } from "@opentelemetry/api";
import type { V1Pod } from "@kubernetes/client-node";
import type { Language, RawCaseRun } from "@nojv/core";
import { createLogger } from "../../logger";

const logger = createLogger("judge-resources");

const meter = metrics.getMeter("nojv-judge");
const PHASE_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 300];
const MEMORY_BYTES = [16, 32, 64, 128, 256, 512, 1024, 2048].map((mib) => mib * 1024 * 1024);
const duration = meter.createHistogram("judge_phase_duration_seconds", {
  unit: "s",
  advice: { explicitBucketBoundaries: PHASE_SECONDS },
});
const cleanupFailures = meter.createCounter("judge_cleanup_pending_total");
const wallClockTimeouts = meter.createCounter("judge_wall_clock_timeouts_total");
const cpu = meter.createHistogram("judge_cpu_seconds", {
  unit: "s",
  advice: { explicitBucketBoundaries: PHASE_SECONDS },
});
const throttled = meter.createHistogram("judge_cpu_throttled_seconds", {
  unit: "s",
  advice: { explicitBucketBoundaries: PHASE_SECONDS },
});
const peakMemory = meter.createHistogram("judge_memory_peak_bytes", {
  unit: "By",
  advice: { explicitBucketBoundaries: MEMORY_BYTES },
});

export type JudgePhase =
  | "queue"
  | "admission"
  | "schedule"
  | "startup"
  | "prepare"
  | "execute"
  | "checker"
  | "collect"
  | "cleanup"
  | "end_to_end";
export type JudgeMode = "standard" | "checker" | "interactive" | "advanced";

export function recordJudgePhase(
  phase: JudgePhase,
  milliseconds: number,
  mode: JudgeMode,
  language: Language,
  result: "success" | "failure" = "success",
): void {
  if (Number.isFinite(milliseconds) && milliseconds >= 0)
    duration.record(milliseconds / 1000, { phase, mode, language, result });
}

export function recordCleanupPending(mode: JudgeMode, language: Language): void {
  cleanupFailures.add(1, { phase: "cleanup", mode, language, result: "failure" });
}

export function recordWallClockTimeouts(
  runs: readonly RawCaseRun[],
  timeoutMs: number,
  language: Language,
): void {
  const count = runs.filter(
    (run) => run.errorVerdict === "TLE" && run.timeMs < timeoutMs,
  ).length;
  if (count > 0) wallClockTimeouts.add(count, { language });
}

function timestamp(value: Date | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function containerPhase(name: string, mode: JudgeMode): JudgePhase | undefined {
  if (
    name.startsWith("prepare") ||
    ["prep", "materialize", "materialize-solution", "materialize-interactor"].includes(name)
  )
    return "prepare";
  if (name.startsWith("case-") || ["solution", "run"].includes(name)) return "execute";
  if (
    ["interactor", "grader", "judge"].includes(name) ||
    (name === "runner" && mode === "checker")
  )
    return "checker";
  if (name === "publish-artifact") return "collect";
  return undefined;
}

export function podPhaseTimings(
  pod: V1Pod,
  mode: JudgeMode = "standard",
): Partial<Record<JudgePhase, number>> {
  const created = timestamp(pod.metadata?.creationTimestamp);
  const scheduled = timestamp(
    pod.status?.conditions?.find((c) => c.type === "PodScheduled" && c.status === "True")
      ?.lastTransitionTime,
  );
  const statuses = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  const starts = statuses
    .map((s) => timestamp(s.state?.terminated?.startedAt ?? s.state?.running?.startedAt))
    .filter((t): t is number => t !== undefined);
  const timings: Partial<Record<JudgePhase, number>> = {};
  if (created !== undefined && scheduled !== undefined && scheduled >= created)
    timings.schedule = scheduled - created;
  if (scheduled !== undefined && starts.length && Math.min(...starts) >= scheduled)
    timings.startup = Math.min(...starts) - scheduled;
  for (const status of statuses) {
    const start = timestamp(status.state?.terminated?.startedAt);
    const end = timestamp(status.state?.terminated?.finishedAt);
    if (start === undefined || end === undefined || end < start) continue;
    const phase = containerPhase(status.name, mode);
    if (phase) timings[phase] = Math.max(timings[phase] ?? 0, end - start);
  }
  return timings;
}

export function recordRunnerResources(
  logs: string,
  mode: JudgeMode,
  language: Language,
  phase: JudgePhase = "execute",
  context?: { jobName: string; container: string },
): void {
  const labels = { phase, mode, language };
  for (const line of logs.split("\n")) {
    if (!line.includes('"nojvResourceUsage"') || line.length > 16_384) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || !("nojvResourceUsage" in value))
      continue;
    const usage = value.nojvResourceUsage;
    if (typeof usage !== "object" || usage === null) continue;
    const measured: Record<string, number> = {};
    const record = (key: string, histogram: typeof cpu, divisor: number) => {
      if (!(key in usage)) return;
      const measurement = (usage as Record<string, unknown>)[key];
      if (
        typeof measurement === "number" &&
        Number.isSafeInteger(measurement) &&
        measurement >= 0
      ) {
        histogram.record(measurement / divisor, labels);
        measured[key] = measurement;
      }
    };
    record("cpuUsec", cpu, 1_000_000);
    record("throttledUsec", throttled, 1_000_000);
    record("memoryPeakBytes", peakMemory, 1);
    if (context && Object.keys(measured).length)
      logger.info("Sandbox resource measurements", { ...context, ...labels, ...measured });
  }
}
