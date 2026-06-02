import { ipViolationLogRepo, type TransactionClient } from "@nojv/db";

export type ViolationType = "whitelist" | "binding";

export const IP_VIOLATION_LOG_THROTTLE_SECONDS = 60;

export interface LogViolationInput {
  examId: string;
  userId: string;
  expectedIp: string | null;
  actualIp: string;
  violationType: ViolationType;
}

export function isViolationLogDue(
  lastAt: Date | null,
  now: Date,
  windowSeconds: number,
): boolean {
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() >= windowSeconds * 1000;
}

export async function logViolation(input: LogViolationInput) {
  return ipViolationLogRepo.create(input);
}

export async function logViolationInTx(tx: TransactionClient, input: LogViolationInput) {
  return ipViolationLogRepo.withTx(tx).create(input);
}

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
