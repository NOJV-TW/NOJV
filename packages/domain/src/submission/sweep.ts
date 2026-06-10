import {
  DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES,
  SUBMISSION_PENDING_TIMEOUT_SETTING_KEY,
  submissionPendingTimeoutMinutesSchema,
} from "@nojv/core";
import { platformSettingRepo, submissionRepo } from "@nojv/db";
import { terminateSubmissionJudge } from "@nojv/temporal";

import { ValidationError } from "../shared/errors";

const PENDING_STATUSES = ["queued", "compiling", "running"];

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
}

export async function sweepStaleSubmissions(): Promise<SweepStaleSubmissionsResult> {
  const timeoutMinutes = await getSubmissionPendingTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
  const stale = await submissionRepo.findStalePendingIds(cutoff);

  let killed = 0;
  let failed = 0;
  for (const { id } of stale) {
    try {
      // Terminate before marking so a still-alive workflow can't overwrite the verdict later.
      await terminateSubmissionJudge(id, "submission pending timeout exceeded");
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

  return { scanned: stale.length, killed, failed };
}
