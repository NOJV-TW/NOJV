import { ipViolationLogRepo, type TransactionClient } from "@nojv/db";

export type ViolationType = "whitelist" | "binding";

// Per-request IP gating would otherwise let one bad-IP student spam the log
// (and the per-exam cap would then bury everyone else). Collapse repeats of the
// same (exam, user, type) within this window down to a single row.
export const IP_VIOLATION_LOG_THROTTLE_SECONDS = 60;

export interface LogViolationInput {
  examId: string;
  userId: string;
  expectedIp: string | null;
  actualIp: string;
  violationType: ViolationType;
}

/** True when enough time has passed since the last identical violation to log again. */
export function isViolationLogDue(
  lastAt: Date | null,
  now: Date,
  windowSeconds: number,
): boolean {
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() >= windowSeconds * 1000;
}

/**
 * Write an `IpViolationLog` row. Only exams have proctoring, so every row
 * is tied to an exam — contests are public and do not log IP events.
 */
export async function logViolation(input: LogViolationInput) {
  return ipViolationLogRepo.create(input);
}

export async function logViolationInTx(tx: TransactionClient, input: LogViolationInput) {
  return ipViolationLogRepo.withTx(tx).create(input);
}

/**
 * Throttled variant: skip the write when an identical violation was logged
 * within {@link IP_VIOLATION_LOG_THROTTLE_SECONDS}. Returns `true` when a row
 * was written.
 */
export async function logViolationThrottled(
  input: LogViolationInput,
  now: Date = new Date(),
): Promise<boolean> {
  const lastAt = await ipViolationLogRepo.findLastViolationAt({
    examId: input.examId,
    userId: input.userId,
    violationType: input.violationType,
  });
  if (!isViolationLogDue(lastAt, now, IP_VIOLATION_LOG_THROTTLE_SECONDS)) {
    return false;
  }
  await ipViolationLogRepo.create(input);
  return true;
}

export async function logViolationThrottledInTx(
  tx: TransactionClient,
  input: LogViolationInput,
  now: Date = new Date(),
): Promise<boolean> {
  const repo = ipViolationLogRepo.withTx(tx);
  const lastAt = await repo.findLastViolationAt({
    examId: input.examId,
    userId: input.userId,
    violationType: input.violationType,
  });
  if (!isViolationLogDue(lastAt, now, IP_VIOLATION_LOG_THROTTLE_SECONDS)) {
    return false;
  }
  await repo.create(input);
  return true;
}
