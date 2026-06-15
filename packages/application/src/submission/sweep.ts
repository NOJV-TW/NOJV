import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  SUBMISSION_PENDING_TIMEOUT_SETTING_KEY,
  submissionPendingTimeoutMinutesSchema,
} from "@nojv/core";
import { platformSettingRepo, submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";

import { ValidationError } from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";

const PENDING_STATUSES = ["pending_upload", "queued", "compiling", "running"];

const REJUDGE_LOG_RETENTION_DAYS = 90;

export async function getSubmissionPendingTimeoutMinutes(): Promise<number> {
  const row = await platformSettingRepo.get(SUBMISSION_PENDING_TIMEOUT_SETTING_KEY);
  if (!row) return DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES;
  const parsed = submissionPendingTimeoutMinutesSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES;
}

export async function setSubmissionPendingTimeoutMinutes(minutes: number): Promise<void> {
  const parsed = submissionPendingTimeoutMinutesSchema.safeParse(minutes);
  if (!parsed.success) {
    throw new ValidationError("Pending timeout must be between 10 and 1440 minutes.");
  }
  await platformSettingRepo.set(SUBMISSION_PENDING_TIMEOUT_SETTING_KEY, String(parsed.data));
}

export interface SweepStaleSubmissionsResult {
  scanned: number;
  killed: number;
  failed: number;
  rejudgeLogsPruned: number;
}

export async function sweepStaleSubmissions(): Promise<SweepStaleSubmissionsResult> {
  const timeoutMinutes = await getSubmissionPendingTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
  const stale = await submissionRepo.findStalePendingIds(cutoff);

  let killed = 0;
  let failed = 0;
  for (const { id } of stale) {
    try {
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

  return { scanned: stale.length, killed, failed, rejudgeLogsPruned: pruned.count };
}
