import { metrics, type BatchObservableResult } from "@opentelemetry/api";
import { runTransaction } from "@nojv/db";

import { createLogger } from "./logger.js";

const logger = createLogger("judge-recovery-metrics");

export interface JudgeRecoverySnapshot {
  queueDepth: number;
  oldestQueueSeconds: number;
  blocked: number;
  stalled: number;
  legacySystemErrors: number;
  observedAt: number;
}

export const JUDGE_RECOVERY_METRICS = {
  queueDepth: "nojv_judge_queue_depth",
  oldestQueueSeconds: "nojv_judge_queue_oldest_seconds",
  blocked: "nojv_judge_executions_blocked",
  stalled: "nojv_submissions_stuck",
  legacySystemErrors: "nojv_judge_legacy_system_errors",
  observedAt: "nojv_judge_recovery_last_success_timestamp_seconds",
} as const;

export async function readJudgeRecoverySnapshot(): Promise<JudgeRecoverySnapshot> {
  return runTransaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
    const [snapshot] = await tx.$queryRaw<JudgeRecoverySnapshot[]>`
      SELECT
        COUNT(*) FILTER (WHERE state IN ('queued', 'waiting_capacity', 'recovering'))::float8 AS "queueDepth",
        COALESCE(GREATEST(EXTRACT(EPOCH FROM NOW() - MIN("queuedAt") FILTER (
          WHERE state IN ('queued', 'waiting_capacity', 'recovering')
        )), 0), 0)::float8 AS "oldestQueueSeconds",
        COUNT(*) FILTER (WHERE state = 'blocked')::float8 AS blocked,
        COUNT(*) FILTER (WHERE "lastProgressAt" < NOW() - INTERVAL '10 minutes' AND (
          (state IN ('queued', 'waiting_capacity', 'recovering', 'finalizing') AND "nextAttemptAt" <= NOW())
          OR (state = 'running' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()))
        ))::float8 AS stalled,
        (SELECT COUNT(*)::float8 FROM "Submission" s WHERE s.status = 'system_error'
          AND NOT EXISTS (SELECT 1 FROM "JudgeExecution" j WHERE j."submissionId" = s.id)
        ) AS "legacySystemErrors",
        EXTRACT(EPOCH FROM NOW())::float8 AS "observedAt"
      FROM "JudgeExecution" WHERE state NOT IN ('completed', 'cancelled')
    `;
    if (!snapshot) throw new Error("Judge recovery metrics returned no snapshot.");
    return snapshot;
  });
}

export function startJudgeRecoveryMetrics(
  readSnapshot: () => Promise<JudgeRecoverySnapshot> = readJudgeRecoverySnapshot,
): () => void {
  const meter = metrics.getMeter("@nojv/judge-recovery", "0.1.0");
  const gauges = Object.entries(JUDGE_RECOVERY_METRICS).map(([key, name]) => ({
    key: key as keyof JudgeRecoverySnapshot,
    gauge: meter.createObservableGauge(name),
  }));
  const observe = async (result: BatchObservableResult) => {
    try {
      const snapshot = await readSnapshot();
      if (gauges.some(({ key }) => !Number.isFinite(snapshot[key]) || snapshot[key] < 0)) {
        throw new Error("Judge recovery metrics returned an invalid snapshot.");
      }
      for (const { key, gauge } of gauges) result.observe(gauge, snapshot[key]);
    } catch (error) {
      logger.warn("Judge recovery metrics snapshot failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const instruments = gauges.map(({ gauge }) => gauge);
  meter.addBatchObservableCallback(observe, instruments);
  return () => meter.removeBatchObservableCallback(observe, instruments);
}
