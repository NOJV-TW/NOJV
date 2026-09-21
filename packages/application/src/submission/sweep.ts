import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  submissionPendingTimeoutMinutesSchema,
} from "@nojv/core";
import {
  authCleanupRepo,
  submissionRejudgeLogRepo,
  submissionRepo,
  prismaAdapterClient as db,
  runTransaction,
} from "@nojv/db";

import { reconcileJudgeExecutions } from "./judge-recovery";
import { getDomainOrchestration } from "../shared/orchestration";
import { toJsonValue } from "../shared/to-json-value";
import { deriveSystemErrorVerdictSummary } from "./mutations";

const REJUDGE_LOG_RETENTION_DAYS = 90;

export function getSubmissionPendingTimeoutMinutes(): number {
  const parsed = submissionPendingTimeoutMinutesSchema.safeParse(
    process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES,
  );
  return parsed.success ? parsed.data : DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES;
}

export interface SweepStaleSubmissionsResult {
  scanned: number;
  killed: number;
  failed: number;
  skipped: number;
  rejudgeLogsPruned: number;
  expiredSessionsPruned: number;
  expiredVerificationsPruned: number;
}

export async function sweepStaleSubmissions(): Promise<SweepStaleSubmissionsResult> {
  await reconcileJudgeExecutions();
  const timeoutMinutes = getSubmissionPendingTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
  const stale = await submissionRepo.findStalePendingIds(cutoff);

  const openRejudgeLogs = (
    await submissionRejudgeLogRepo.listForSubmissionIds(stale.map((s) => s.id))
  ).filter((log) => log.newVerdict === null);
  const recentRejudgeSubmissionIds = new Set(
    openRejudgeLogs.filter((log) => log.createdAt >= cutoff).map((log) => log.submissionId),
  );

  let killed = 0;
  let failed = 0;
  let skipped = 0;
  for (const { id } of stale) {
    if (recentRejudgeSubmissionIds.has(id)) {
      skipped += 1;
      continue;
    }
    try {
      const execution = await db.judgeExecution.findFirst({
        where: { submissionId: id },
        orderBy: { generation: "desc" },
      });
      if (execution) {
        skipped += 1;
        continue;
      }
      const submission = await submissionRepo.findById(id);
      const workflowId =
        submission?.activeJudgeRunId ??
        openRejudgeLogs.find((log) => log.submissionId === id)?.rejudgeRunId ??
        undefined;
      const state = await getDomainOrchestration().describeSubmissionJudge(id, workflowId);
      if (state?.running) {
        skipped += 1;
        continue;
      }
      const updated = await runTransaction(async (tx) => {
        const updated = await tx.submission.updateMany({
          where: {
            id,
            updatedAt: { lt: cutoff },
            status: { in: ["pending_upload", "queued", "compiling", "running"] },
          },
          data: {
            activeJudgeRunId: null,
            status: "system_error",
            verdictSummary: toJsonValue(
              deriveSystemErrorVerdictSummary(
                "Original judge version is unavailable for this legacy submission. A teacher rejudge is required to select a new version.",
              ),
            ),
          },
        });
        if (updated.count)
          await tx.durableWork.updateMany({
            where: {
              kind: "submission.judge.dispatch",
              dedupeKey: id,
              status: { in: ["pending", "leased"] },
            },
            data: {
              status: "cancelled",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
              lastError: "Original judge version is unavailable.",
            },
          });
        return updated;
      });
      killed += updated.count;
    } catch (error) {
      console.error("Failed to reconcile stale submission", { submissionId: id }, error);
      failed += 1;
    }
  }

  const rejudgeRetentionCutoff = new Date(
    Date.now() - REJUDGE_LOG_RETENTION_DAYS * 24 * 60 * 60_000,
  );
  const pruned = await submissionRejudgeLogRepo.deleteOlderThan(rejudgeRetentionCutoff);

  const now = new Date();
  const expiredSessions = await authCleanupRepo.deleteExpiredSessions(now);
  const expiredVerifications = await authCleanupRepo.deleteExpiredVerifications(now);

  return {
    scanned: stale.length,
    killed,
    failed,
    skipped,
    rejudgeLogsPruned: pruned.count,
    expiredSessionsPruned: expiredSessions.count,
    expiredVerificationsPruned: expiredVerifications.count,
  };
}
