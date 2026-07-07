import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  submissionPendingTimeoutMinutesSchema,
} from "@nojv/core";
import { authCleanupRepo, submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";

import { getDomainOrchestration } from "../shared/orchestration";

const PENDING_STATUSES = ["pending_upload", "queued", "compiling", "running"];

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
  const timeoutMinutes = getSubmissionPendingTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
  const stale = await submissionRepo.findStalePendingIds(cutoff);

  const openRejudgeSubmissionIds = new Set(
    (await submissionRejudgeLogRepo.listForSubmissionIds(stale.map((s) => s.id)))
      .filter((log) => log.newVerdict === null)
      .map((log) => log.submissionId),
  );

  let killed = 0;
  let failed = 0;
  let skipped = 0;
  for (const { id } of stale) {
    if (openRejudgeSubmissionIds.has(id)) {
      skipped += 1;
      continue;
    }
    try {
      const state = await getDomainOrchestration().describeSubmissionJudge(id);
      if (state?.running) {
        skipped += 1;
        continue;
      }
      await getDomainOrchestration().terminateSubmissionJudge(
        id,
        "submission pending timeout exceeded",
      );
      const updated = await submissionRepo.updateStatusIfIn(
        id,
        PENDING_STATUSES,
        "system_error",
      );
      killed += updated.count;
    } catch {
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
